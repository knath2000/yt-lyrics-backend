import { TranscriptionWorker } from "./worker.js";
import { cloudinary } from "./cloudinary.js";
import { pool } from "./db.js";
import { ModalClient, ModalJobResult } from "./utils/modalClient.js";
import { logger } from "./utils/logger.js";
import { fileURLToPath } from "url";
import { safeDbQuery } from "./db.js";
import { initializeCookieJar } from "./setup.js";

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
  private modalClient: ModalClient | null = null;
  private isRunning = false;
  private pollInterval = 5000; // 5 seconds

  constructor() {
    // Cloudinary is now configured in the centralized module

    // Initialize TranscriptionWorker with required parameters
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    // If Modal credentials present, initialize client for fallback processing
    if (process.env.MODAL_TOKEN_ID && process.env.MODAL_TOKEN_SECRET) {
      this.modalClient = new ModalClient();
      console.log("🔄 Modal integration enabled as fallback – jobs will try local processing first, then Modal if needed");
    } else {
      console.log("🏠 Local-only processing – no Modal fallback available");
    }

    // Initialize cookie jar (creates cookies.txt from env secret if provided)
    const cookieFilePath = initializeCookieJar();

    this.worker = new TranscriptionWorker(
      openaiApiKey,
      pool, // database pool
      cloudinary, // cloudinary instance
      "./temp", // work directory
      cookieFilePath // provide cookie file path so authenticated yt-dlp strategies can run
    );

    if (process.env.DATABASE_URL) {
      try {
        const url = new URL(process.env.DATABASE_URL);
        console.log(`🔗 QueueWorker connected to DB host=${url.host} db=${url.pathname}`);
      } catch (_) {
        console.log(`🔗 QueueWorker DATABASE_URL=${process.env.DATABASE_URL}`);
      }
    } else {
      console.warn('⚠️ No DATABASE_URL env var found in QueueWorker');
    }
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

    let lastHeartbeat = Date.now();

    while (this.isRunning) {
      try {
        await this.processNextJob();
        await this.sleep(this.pollInterval);

        // Heartbeat log every 60 seconds
        if (Date.now() - lastHeartbeat >= 60000) {
          logger.info("💓 QueueWorker heartbeat – still alive");
          lastHeartbeat = Date.now();
        }
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
    const result = await safeDbQuery(
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
    await safeDbQuery(
      'UPDATE jobs SET status = $1, updated_at = $2 WHERE id = $3',
      ['processing', new Date(), jobId]
    );

    try {
      let resultUrl: string;

      // 🔄 TIERED PROCESSING APPROACH:
      // 1. Try local processing first (cost-effective)
      // 2. Fallback to Modal if local fails (reliability)
      
      console.log(`🏠 Attempting local processing for job ${jobId}...`);
      
      try {
        // Try local processing first
        const localResult = await this.worker.processJob(
          jobId,
          youtubeUrl,
          (pct: number, status: string) => {
            // Update in-memory progress for real-time API access
            jobProgress.set(jobId, {
              id: jobId,
              status: "processing",
              pct,
              statusMessage: `[LOCAL] ${status}`
            });
            console.log(`Job ${jobId}: ${pct}% - [LOCAL] ${status}`);
          },
          openaiModel,
          demucsModel
        );

        resultUrl = localResult.resultUrl;
        console.log(`✅ Job ${jobId} completed via LOCAL processing with result URL: ${resultUrl}`);

      } catch (localError) {
        console.log(`❌ Local processing failed for job ${jobId}: ${(localError as Error).message}`);
        
        if (this.modalClient) {
          console.log(`🚀 Falling back to Modal GPU processing for job ${jobId}...`);
          
          // Reset progress to indicate fallback
          jobProgress.set(jobId, {
            id: jobId,
            status: "processing",
            pct: 5,
            statusMessage: "[FALLBACK] Retrying with Modal GPU processing..."
          });
          
          const modalInput = {
            youtube_url: youtubeUrl,
            job_id: jobId
          };

          const modalResult: ModalJobResult = await this.modalClient.submitJob(modalInput);
          
          if (modalResult.status === "error") {
            throw new Error(`Modal fallback also failed: ${modalResult.error?.message || "Modal processing failed"}`);
          }

          console.log(`✅ Modal fallback transcription job ${jobId} completed, uploading results to Cloudinary...`);

          // Check if Modal already provided a resultUrl (if it uploaded to Cloudinary itself)
          if (modalResult.output && modalResult.output.resultUrl) {
            resultUrl = modalResult.output.resultUrl;
            console.log(`📄 Using Modal-provided result URL: ${resultUrl}`);
          } else {
            // Upload Modal results to Cloudinary ourselves
            resultUrl = await this.uploadRunPodResultsToCloudinary(jobId, modalResult.output);
          }

          console.log(`✅ Job ${jobId} completed via MODAL FALLBACK with result URL: ${resultUrl}`);
          
        } else {
          // No Modal fallback available - re-throw the local error
          console.log(`❌ No Modal fallback available for job ${jobId} - local processing failed`);
          throw localError;
        }
      }

      // Update database with completed status and result URL
      await safeDbQuery(
        'UPDATE jobs SET status = $1, results_url = $2, updated_at = $3 WHERE id = $4',
        ['completed', resultUrl, new Date(), jobId]
      );

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
      // Persist failure to database
      await safeDbQuery(
        'UPDATE jobs SET status = $1, error_message = $2, updated_at = $3 WHERE id = $4',
        ['error', (error as Error).message, new Date(), jobId]
      );
      
      logger.error(`Job ${jobId} failed completely: ${(error as Error).message}`);
      
      // Remove from in-memory store to prevent stale entries
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