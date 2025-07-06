import { TranscriptionWorker } from "./worker.js";
import { cloudinary } from "./cloudinary.js";
import { pool } from "./db.js";
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
  private isRunning = false;
  private pollInterval = 5000; // 5 seconds

  constructor() {
    // Cloudinary is now configured in the centralized module

    // Initialize TranscriptionWorker with required parameters
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }

    this.worker = new TranscriptionWorker(
      openaiApiKey,
      pool, // database pool
      cloudinary, // cloudinary instance
      "./temp" // work directory (unauthenticated download; no cookies)
      , undefined // no cookie file path
    );
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
    // Check database for queued jobs
    const result = await pool.query(
      `SELECT id, youtube_url FROM jobs
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      // No jobs to process
      return;
    }

    const { id: jobId, youtube_url: youtubeUrl } = result.rows[0];
    
    console.log(`📋 Processing job ${jobId} for URL: ${youtubeUrl}`);

    // Update job status to processing
    await pool.query(
      'UPDATE jobs SET status = $1, updated_at = $2 WHERE id = $3',
      ['processing', new Date(), jobId]
    );

    try {
      // Process the job using the existing worker
      const result = await this.worker.processJob(
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
        }
      );

      // Job completed successfully - the worker already updated the database
      // Just update our in-memory tracking and log success
      jobProgress.set(jobId, {
        id: jobId,
        status: "done",
        pct: 100,
        resultUrl: result.resultUrl,
        statusMessage: "Complete!"
      });
      
      console.log(`✅ Job ${jobId} completed successfully with result URL: ${result.resultUrl}`);
      
      // Remove from in-memory store since it's now in database
      jobProgress.delete(jobId);
      
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