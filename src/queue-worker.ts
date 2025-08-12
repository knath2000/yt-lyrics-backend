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

// Enhanced processing step interface for detailed tracking
interface ProcessingStep {
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  percentage: number;
  message: string;
  timestamp: string;
  duration?: number; // in seconds
}

// Processing stage constants for consistent tracking
const PROCESSING_STAGES = {
  INITIALIZATION: 'initialization',
  DOWNLOAD: 'download', 
  VOCAL_SEPARATION: 'vocal_separation',
  TRANSCRIPTION: 'transcription',
  ALIGNMENT: 'alignment',
  FINALIZATION: 'finalization'
} as const;

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
   * Update job progress with detailed step tracking
   */
  private async updateJobProgress(
    jobId: string, 
    stage: string, 
    percentage: number, 
    message: string, 
    status: 'processing' | 'done' | 'error' = 'processing'
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    
    // Create processing step
    const step: ProcessingStep = {
      status: status === 'processing' ? 'in_progress' : (status === 'done' ? 'completed' : 'error'),
      percentage,
      message,
      timestamp
    };

    // Update in-memory progress
    jobProgress.set(jobId, {
      id: jobId,
      status,
      pct: percentage,
      statusMessage: message
    });

    // Update database with comprehensive metadata
    try {
      await safeDbQuery(
        `UPDATE jobs SET 
          status = $1, 
          pct = $2, 
          status_message = $3, 
          updated_at = $4,
          current_stage = $5,
          progress_log = COALESCE(progress_log, '[]'::jsonb) || $6::jsonb
        WHERE id = $7`,
        [status, percentage, message, new Date(), stage, JSON.stringify([step]), jobId]
      );
      
      console.log(`📊 [${jobId}] ${stage}: ${percentage}% - ${message}`);
    } catch (error) {
      console.error(`❌ Failed to update job progress for ${jobId}:`, error);
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

    // Initialize processing with detailed tracking
    await this.updateJobProgress(jobId, PROCESSING_STAGES.INITIALIZATION, 5, "Starting processing...");

    try {
      let resultUrl: string;

      if (this.modalClient) {
        console.log(`🎯 CORRECT ARCHITECTURE: Railway downloads first, Modal processes`);
        
        // STEP 1: Railway attempts cache check and download
        await this.updateJobProgress(jobId, PROCESSING_STAGES.DOWNLOAD, 10, "[Railway] Checking cache and attempting download...");

        let audioUrl: string | null = null;
        let downloadError: string | null = null;

        if (this.worker) {
          try {
            console.log(`🔍 [Railway] Checking cache and attempting download for job ${jobId}...`);
            
            // Try Fly.io cache check + download using the enhanced method
            const downloadResult = await this.worker.downloadAudioForModal(youtubeUrl, jobId);
            
            audioUrl = downloadResult.audioUrl;
            
            console.log(`✅ [Railway] Audio ready: ${audioUrl}`);
            await this.updateJobProgress(jobId, PROCESSING_STAGES.DOWNLOAD, 15, "[Railway] Audio ready, preparing for GPU processing...");
          } catch (error) {
            downloadError = (error as Error).message;
            console.log(`❌ [Railway] Audio preparation failed: ${downloadError}`);
            await this.updateJobProgress(jobId, PROCESSING_STAGES.DOWNLOAD, 15, `[Railway] Audio preparation failed: ${downloadError}. Modal will attempt fallback download...`);
          }
        } else {
          console.log(`⚠️ [Railway] No worker available, Modal will handle download`);
          await this.updateJobProgress(jobId, PROCESSING_STAGES.DOWNLOAD, 15, "[Railway] No local worker, Modal will handle download...");
        }

        // STEP 2: Hand off to Modal for GPU processing
        await this.updateJobProgress(jobId, PROCESSING_STAGES.TRANSCRIPTION, 20, "[Modal] Starting GPU processing...");
        
        const modalStartTime = Date.now();
        console.log(`🚀 [Modal] Submitting job to Modal GPU infrastructure...`);
        
        const modalResult: ModalJobResult = await this.modalClient.submitJob({
          youtube_url: youtubeUrl,
          audio_url: audioUrl, // Can be null if Fly.io download failed
          job_id: jobId,
          openai_model: openaiModel || "whisper-1",
          download_error: downloadError // Inform Modal about download status
        }, (progressUpdate) => {
          // Map Modal progress (30%-95%) to overall job progress  
          const overallProgress = Math.round(30 + (progressUpdate.percentage * 0.65));
          this.updateJobProgress(
            jobId, 
            progressUpdate.stage || PROCESSING_STAGES.TRANSCRIPTION,
            overallProgress,
            `[Modal] ${progressUpdate.message}`
          );
        });

        const modalDuration = (Date.now() - modalStartTime) / 1000;
        
        if (modalResult.success && modalResult.result) {
          console.log(`✅ [Modal] Processing completed in ${modalDuration.toFixed(1)}s`);
          await this.updateJobProgress(jobId, PROCESSING_STAGES.FINALIZATION, 95, "[Modal] Processing completed, finalizing...");
          
          // Update database with Modal results and processing metadata
          await safeDbQuery(
            `UPDATE jobs SET 
              status = $1, 
              pct = $2, 
              results_url = $3, 
              updated_at = $4,
              processing_method = $5,
              processing_time_seconds = $6,
              video_id = $7
            WHERE id = $8`,
            [
              'done', 
              100, 
              modalResult.result.result_url, 
              new Date(),
              modalResult.result.processing_method || 'modal_gpu',
              modalDuration,
              this.extractVideoId(youtubeUrl),
              jobId
            ]
          );

          // Update in-memory progress
          jobProgress.set(jobId, {
            id: jobId,
            status: "done",
            pct: 100,
            resultUrl: modalResult.result.result_url,
            statusMessage: "✅ Processing completed successfully"
          });
          
          console.log(`🎉 Job ${jobId} completed successfully: ${modalResult.result.result_url}`);
        } else {
          const errorMessage = modalResult.error?.message || "Modal processing failed";
          throw new Error(errorMessage);
        }
      } else {
        // Fallback to local processing if Modal is not available
        console.log(`⚠️ No Modal client available, falling back to local processing`);
        await this.updateJobProgress(jobId, PROCESSING_STAGES.TRANSCRIPTION, 20, "Starting local processing...");
        
        if (!this.worker) {
          throw new Error("No transcription worker available for local processing");
        }

        const localResult = await this.worker.processJob(jobId, youtubeUrl, undefined, openaiModel || "whisper-1");
        
        await safeDbQuery(
          'UPDATE jobs SET status = $1, pct = $2, results_url = $3, updated_at = $4, processing_method = $5 WHERE id = $6',
          ['done', 100, localResult.resultUrl, new Date(), 'local_cpu', jobId]
        );

        jobProgress.set(jobId, {
          id: jobId,
          status: "done",
          pct: 100,
          resultUrl: localResult.resultUrl,
          statusMessage: "✅ Local processing completed"
        });
      }

    } catch (error) {
      const errorMessage = (error as Error).message;
      console.error(`❌ Job ${jobId} failed:`, errorMessage);
      
      await safeDbQuery(
        'UPDATE jobs SET status = $1, error_message = $2, updated_at = $3 WHERE id = $4',
        ['error', errorMessage, new Date(), jobId]
      );

      jobProgress.set(jobId, {
        id: jobId,
        status: "error",
        pct: 0,
        error: errorMessage,
        statusMessage: `❌ Processing failed: ${errorMessage}`
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  setupGracefulShutdown() {
    const shutdown = () => {
      console.log("🛑 Received shutdown signal, stopping queue worker...");
      this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  private extractVideoId(youtubeUrl: string): string {
    const match = youtubeUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : '';
  }

  // Public method to get job progress (used by API routes)
  getJobProgress(jobId: string): Job | undefined {
    return jobProgress.get(jobId);
  }
}

export { QueueWorker };

// Main execution - check if this file is being run directly (ESM compatible)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const queueWorker = new QueueWorker();
  queueWorker.setupGracefulShutdown();
  queueWorker.start().catch(console.error);
}