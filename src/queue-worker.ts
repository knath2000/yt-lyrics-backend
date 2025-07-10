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
  private worker: TranscriptionWorker | null = null;
  private modalClient: ModalClient | null = null;
  private isRunning = false;
  private pollInterval = 5000; // 5 seconds

  constructor() {
    // Cloudinary is now configured in the centralized module

    // Modal credentials are required for optimal GPU processing
    if (process.env.MODAL_TOKEN_ID && process.env.MODAL_TOKEN_SECRET) {
      this.modalClient = new ModalClient();
      console.log("🚀 Modal GPU processing enabled – jobs will be processed on high-performance A10G GPUs");
    } else {
      console.warn("⚠️ Modal GPU processing unavailable – please configure MODAL_TOKEN_ID and MODAL_TOKEN_SECRET for optimal performance");
    }

    // Initialize cookie jar (creates cookies.txt from env secret if provided)
    const cookieFilePath = initializeCookieJar();

    // Note: TranscriptionWorker is kept for potential future local fallback scenarios
    // but primary processing now occurs on Modal GPU infrastructure
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      this.worker = new TranscriptionWorker(
        openaiApiKey,
        pool, // database pool
        cloudinary, // cloudinary instance
        "./temp", // work directory
        cookieFilePath // provide cookie file path for any future local processing needs
      );
    }

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

    console.log(`📋 Processing job ${jobId} for URL: ${youtubeUrl}`);

    // Update job status to processing
    await safeDbQuery(
      'UPDATE jobs SET status = $1, updated_at = $2 WHERE id = $3',
      ['processing', new Date(), jobId]
    );

    // Update in-memory progress
    jobProgress.set(jobId, {
      id: jobId,
      status: "processing",
      pct: 5,
      statusMessage: "Starting processing..."
    });

    try {
      let resultUrl: string;

      if (this.modalClient) {
        console.log(`🎯 CORRECT ARCHITECTURE: Fly.io downloads first, Modal processes`);
        
        // STEP 1: Fly.io attempts YouTube download
        jobProgress.set(jobId, {
          id: jobId,
          status: "processing",
          pct: 10,
          statusMessage: "[Fly.io] Attempting YouTube download..."
        });

        let audioUrl: string | null = null;
        let downloadError: string | null = null;

        if (this.worker) {
          try {
            console.log(`📥 [Fly.io] Attempting YouTube download for job ${jobId}...`);
            
            // Try Fly.io download using the new public method
            const downloadResult = await this.worker.downloadAudioForModal(youtubeUrl, jobId);
            
            audioUrl = downloadResult.audioUrl;
            
            jobProgress.set(jobId, {
              id: jobId,
              status: "processing",
              pct: 25,
              statusMessage: "[Fly.io] Download successful, sending to Modal GPU..."
            });
            
          } catch (error) {
            downloadError = (error as Error).message;
            console.log(`❌ [Fly.io] Download failed: ${downloadError}`);
            console.log(`🔄 [Modal] Will attempt download as fallback...`);
            
            jobProgress.set(jobId, {
              id: jobId,
              status: "processing",
              pct: 15,
              statusMessage: "[Fly.io] Download failed, Modal will attempt download..."
            });
          }
        }

        // STEP 2: Send job to Modal (with or without pre-downloaded audio)
        console.log(`🚀 [Modal] Processing job ${jobId} with GPU...`);
        
        const modalInput = {
          youtube_url: youtubeUrl,
          job_id: jobId,
          audio_url: audioUrl, // null if Fly.io download failed
          fly_download_error: downloadError // inform Modal of Fly.io failure
        };

        const modalResult: ModalJobResult = await this.modalClient.submitJob(modalInput);
        
        if (modalResult.status === "error") {
          throw new Error(`Modal GPU processing failed: ${modalResult.error?.message || "Unknown Modal error"}`);
        }

        console.log(`✅ [Modal] Job ${jobId} completed successfully`);

        // Extract result URL from Modal response
        if (modalResult.output && modalResult.output.results_url) {
          resultUrl = modalResult.output.results_url;
        } else if (modalResult.output && modalResult.output.resultUrl) {
          resultUrl = modalResult.output.resultUrl;
        } else {
          throw new Error("Modal did not return a valid result URL");
        }

        console.log(`📄 Job ${jobId} completed with result URL: ${resultUrl}`);
        
      } else {
        // No Modal available - this should be rare in production
        throw new Error("Modal GPU processing unavailable. Please configure MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables.");
      }

      // Update database with completed status and result URL
      await safeDbQuery(
        'UPDATE jobs SET status = $1, results_url = $2, updated_at = $3 WHERE id = $4',
        ['completed', resultUrl, new Date(), jobId]
      );

      // Update in-memory progress to completed
      jobProgress.set(jobId, {
        id: jobId,
        status: "done",
        pct: 100,
        statusMessage: "Processing completed successfully!",
        resultUrl: resultUrl
      });

      console.log(`✅ Job ${jobId} completed successfully`);

    } catch (error: any) {
      console.error(`❌ Job ${jobId} failed:`, error);

      // Update database with error status
      await safeDbQuery(
        'UPDATE jobs SET status = $1, error_message = $2, updated_at = $3 WHERE id = $4',
        ['error', error.message, new Date(), jobId]
      );

      // Update in-memory progress to error
      jobProgress.set(jobId, {
        id: jobId,
        status: "error",
        pct: 0,
        statusMessage: `Processing failed: ${error.message}`,
        error: error.message
      });
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

  private extractVideoId(youtubeUrl: string): string {
    const url = new URL(youtubeUrl);
    const videoId = url.searchParams.get('v');
    if (videoId) {
      return videoId;
    }
    const pathSegments = url.pathname.split('/');
    const lastSegment = pathSegments[pathSegments.length - 1];
    if (lastSegment.length === 11) { // YouTube video IDs are 11 characters
      return lastSegment;
    }
    throw new Error(`Could not extract video ID from URL: ${youtubeUrl}`);
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