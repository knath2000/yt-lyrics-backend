import { TranscriptionWorker } from "./worker.js";
import { cloudinary } from "./cloudinary.js";
import { pool } from "./db.js";
import { RunPodClient } from "./utils/runpodClient.js";
import { fileURLToPath } from "url";

interface Job {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  pct: number;
  resultUrl?: string;
  error?: string;
  statusMessage?: string;
}

// In-memory job progress tracking (for real-time updates)
const jobProgress = new Map<string, Job>();

class QueueWorker {
  private worker: TranscriptionWorker;
  private runpodClient: RunPodClient | null = null;
  private isRunning = false;
  private pollInterval = 5000; // 5 seconds

  constructor() {
    // Cloudinary is now configured in the centralized module

    // Initialize TranscriptionWorker with required parameters
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    // If RUNPOD config present, initialize client
    if (process.env.RUNPOD_API_KEY && process.env.RUNPOD_ENDPOINT_ID) {
      this.runpodClient = new RunPodClient(process.env.RUNPOD_API_KEY, process.env.RUNPOD_ENDPOINT_ID);
      console.log("RunPod integration enabled – jobs will be offloaded to Serverless endpoint");
    }

    this.worker = new TranscriptionWorker(
      openaiApiKey,
      pool, // database pool
      cloudinary, // cloudinary instance
      "./temp" // work directory (unauthenticated download; no cookies)
      , undefined // no cookie file path
    );
  }

  /**
   * Upload RunPod transcription results to Cloudinary and return secure URLs
   * This mimics what TranscriptionWorker.processJob() does for local processing
   */
  private async uploadRunPodResultsToCloudinary(jobId: string, runpodResult: any): Promise<string> {
    try {
      // Upload JSON results to Cloudinary
      const jsonUploadResult = await cloudinary.uploader.upload(
        `data:application/json;base64,${Buffer.from(JSON.stringify(runpodResult)).toString('base64')}`,
        {
          resource_type: 'raw',
          public_id: `transcriptions/${jobId}/results`,
          format: 'json',
          overwrite: true,
          tags: ['transcription_results', `job:${jobId}`]
        }
      );

      // Upload SRT file to Cloudinary if present
      if (runpodResult.srt) {
        await cloudinary.uploader.upload(
          `data:text/plain;base64,${Buffer.from(runpodResult.srt).toString('base64')}`,
          {
            resource_type: 'raw',
            public_id: `transcriptions/${jobId}/subtitles`,
            format: 'srt',
            overwrite: true,
            tags: ['transcription_subtitles', `job:${jobId}`]
          }
        );
      }

      console.log(`✅ Uploaded RunPod results for job ${jobId} to Cloudinary: ${jsonUploadResult.secure_url}`);
      return jsonUploadResult.secure_url;

    } catch (uploadError) {
      console.error(`❌ Failed to upload RunPod results for job ${jobId} to Cloudinary:`, uploadError);
      throw new Error(`Failed to upload results to Cloudinary: ${(uploadError as Error).message}`);
    }
  }

  async start() {
    if (this.isRunning) {
      console.log("Queue worker is already running");
      return;
    }

    this.isRunning = true;
    console.log("🚀 Queue worker started - polling for jobs every", this.pollInterval, "ms");

    while (this.isRunning) {
      try {
        await this.processNextJob();
        await this.sleep(this.pollInterval);
      } catch (error) {
        console.error("❌ Queue worker error:", error);
        await this.sleep(this.pollInterval);
      }
    }
  }

  stop() {
    console.log("🛑 Stopping queue worker...");
    this.isRunning = false;
  }

  private async processNextJob() {
    console.log("⏳ Polling database for queued jobs...");
    // Check database for queued jobs
    const result = await pool.query(
      `SELECT id, youtube_url, openai_model FROM jobs
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`
    );

    console.log(`🔍 Found ${result.rows.length} queued job(s)`);

    if (result.rows.length === 0) {
      // No jobs to process
      return;
    }

    const { id: jobId, youtube_url: youtubeUrl, openai_model: openaiModel } = result.rows[0];

    // For current testing we use the **same** Demucs model (standard htdemucs)
    // regardless of the chosen transcription model preset.
    const demucsModel = "htdemucs";
    
    console.log(`📋 Processing job ${jobId} for URL: ${youtubeUrl}`);

    // Update job status to processing
    await pool.query(
      'UPDATE jobs SET status = $1, updated_at = $2 WHERE id = $3',
      ['processing', new Date(), jobId]
    );

    try {
      let result;
      let resultUrl: string;

      if (this.runpodClient) {
        // Offload to RunPod
        console.log(`🚀 Submitting job ${jobId} to RunPod endpoint`);
        result = await this.runpodClient.runTranscription(youtubeUrl, (pct, status) => {
          jobProgress.set(jobId, { id: jobId, status: "processing", pct, statusMessage: status });
        });

        console.log(`✅ RunPod job ${jobId} completed, uploading results to Cloudinary...`);

        // Check if RunPod already provided a resultUrl (if it uploaded to Cloudinary itself)
        if (result.resultUrl) {
          resultUrl = result.resultUrl;
          console.log(`📄 Using RunPod-provided result URL: ${resultUrl}`);
        } else {
          // Upload RunPod results to Cloudinary ourselves
          resultUrl = await this.uploadRunPodResultsToCloudinary(jobId, result);
        }

        // Update database with completed status and result URL
        await pool.query(
          'UPDATE jobs SET status = $1, results_url = $2, updated_at = $3 WHERE id = $4',
          ['completed', resultUrl, new Date(), jobId]
        );

        console.log(`✅ Job ${jobId} completed via RunPod with result URL: ${resultUrl}`);

      } else {
        // Local processing
        result = await this.worker.processJob(
          jobId,
          youtubeUrl,
          (pct: number, status: string) => {
            // Update in-memory progress for real-time API access
            jobProgress.set(jobId, {
              id: jobId,
              status: "processing",
              pct,
              statusMessage: status
            });
            console.log(`Job ${jobId}: ${pct}% - ${status}`);
          },
          openaiModel,
          demucsModel
        );

        resultUrl = result.resultUrl;
        console.log(`✅ Job ${jobId} completed via local worker with result URL: ${resultUrl}`);
      }

      // Update in-memory tracking for immediate API access
      jobProgress.set(jobId, {
        id: jobId,
        status: "done",
        pct: 100,
        resultUrl: resultUrl,
        statusMessage: "Complete!"
      });
      
      // Remove from in-memory store after a brief delay to allow final status checks
      setTimeout(() => {
        jobProgress.delete(jobId);
      }, 10000); // 10 seconds grace period
      
    } catch (error) {
      // Update database with error
      await pool.query(
        'UPDATE jobs SET status = $1, error_message = $2, updated_at = $3 WHERE id = $4',
        ['error', (error as Error).message, new Date(), jobId]
      );
      
      console.error(`❌ Job ${jobId} failed:`, error);
      
      // Remove from in-memory store
      jobProgress.delete(jobId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Graceful shutdown handler
  setupGracefulShutdown() {
    const shutdown = () => {
      console.log("🔄 Received shutdown signal, stopping queue worker...");
      this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

// Export the job progress map so the API can access it
export { jobProgress };

// Main execution - check if this file is being run directly (ESM compatible)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const queueWorker = new QueueWorker();
  queueWorker.setupGracefulShutdown();
  queueWorker.start().catch(console.error);
}

export default QueueWorker;