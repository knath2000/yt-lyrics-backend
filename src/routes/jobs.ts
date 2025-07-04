import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs"; // Import readFileSync directly
import { TranscriptionWorker } from "../worker.js";
import { cloudinary } from "../cloudinary.js";
import { pool } from "../db.js";
import { jobProgress } from "../queue-worker.js"; // Import shared progress map

interface Job {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  pct: number;
  resultUrl?: string;
  error?: string;
  statusMessage?: string;
}

// Export a function that creates and returns the router,
// accepting the worker and cloudinary as dependencies.
// Database pool is imported from centralized db.ts module.
export default function createJobsRouter(
  worker: TranscriptionWorker,
  cloudinaryInstance: typeof cloudinary
): Router {
  const router = Router();

  // POST /api/jobs
  router.post("/", async (req, res) => {
    const bodySchema = z.object({ youtubeUrl: z.string().url() });
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const id = uuidv4();
    const job: Job = { id, status: "queued", pct: 0 };
    jobProgress.set(id, job);

    // Initialize job in database
    await pool.query(
      `INSERT INTO jobs (id, youtube_url, status, created_at)
       VALUES ($1, $2, $3, $4)`,
      [id, parse.data.youtubeUrl, 'queued', new Date()]
    );

    // DO NOT start processing here - let the queue worker handle it
    // processJobAsync(id, parse.data.youtubeUrl, worker); // REMOVED - causes SIGTERM

    res.status(201).json({ jobId: id });
  });

  // GET /api/jobs/:id
  router.get("/:id", async (req, res) => {
    // Check in-memory progress first for real-time updates
    const progressJob = jobProgress.get(req.params.id);
    if (progressJob) {
      return res.json({
        status: progressJob.status,
        pct: progressJob.pct,
        resultUrl: progressJob.resultUrl,
        statusMessage: progressJob.statusMessage,
        error: progressJob.error
      });
    }

    // Fall back to database for completed jobs
    try {
      const result = await pool.query(
        'SELECT id, status, results_url, error_message FROM jobs WHERE id = $1',
        [req.params.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Job not found" });
      }

      const dbJob = result.rows[0];
      res.json({
        status: dbJob.status,
        pct: dbJob.status === 'completed' ? 100 : 0,
        resultUrl: dbJob.results_url,
        statusMessage: dbJob.status === 'completed' ? 'Complete!' : 'Processing...',
        error: dbJob.error_message
      });
    } catch (error) {
      console.error('Database error:', error);
      res.status(500).json({ error: "Database error" });
    }
  });

  // GET /api/jobs/:id/progress - Real-time progress endpoint
  router.get("/:id/progress", async (req, res) => {
    // Check in-memory progress for real-time updates
    const progressJob = jobProgress.get(req.params.id);
    if (progressJob) {
      return res.json({
        status: progressJob.status,
        pct: progressJob.pct,
        statusMessage: progressJob.statusMessage,
        error: progressJob.error
      });
    }

    // Fall back to database for completed/queued jobs
    try {
      const result = await pool.query(
        'SELECT id, status, error_message FROM jobs WHERE id = $1',
        [req.params.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Job not found" });
      }

      const dbJob = result.rows[0];
      res.json({
        status: dbJob.status,
        pct: dbJob.status === 'completed' ? 100 : 0,
        statusMessage: dbJob.status === 'completed' ? 'Complete!' :
                      dbJob.status === 'queued' ? 'Waiting in queue...' : 'Processing...',
        error: dbJob.error_message
      });
    } catch (error) {
      console.error('Database error:', error);
      res.status(500).json({ error: "Database error" });
    }
  });

  // GET /api/jobs/:id/result
  router.get("/:id/result", async (req, res) => {
    try {
      // Get job from database
      const result = await pool.query(
        'SELECT id, status, results_url FROM jobs WHERE id = $1',
        [req.params.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Job not found" });
      }

      const job = result.rows[0];
      if (job.status !== "completed" || !job.results_url) {
        return res.status(400).json({ error: "Result not ready" });
      }
      
      // For Cloudinary URLs, redirect to the secure URL
      // The client can fetch the JSON directly from Cloudinary
      res.redirect(job.results_url);
      
    } catch (error) {
      console.error(`Error fetching results for job ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to fetch results", details: (error as Error).message });
    }
  });

  // Async job processing function
  async function processJobAsync(jobId: string, youtubeUrl: string, workerInstance: TranscriptionWorker) {
    const job = jobProgress.get(jobId);
    if (!job) return;

    try {
      job.status = "processing";
      job.statusMessage = "Starting...";
      
      // Update database status
      await pool.query(
        'UPDATE jobs SET status = $1, updated_at = $2 WHERE id = $3',
        ['processing', new Date(), jobId]
      );
      
      const result = await workerInstance.processJob( // Use injected worker
        jobId,
        youtubeUrl,
        (pct: number, status: string) => {
          job.pct = pct;
          job.statusMessage = status;
          console.log(`Job ${jobId}: ${pct}% - ${status}`);
        }
      );

      job.status = "done";
      job.pct = 100;
      job.resultUrl = result.resultUrl;
      job.statusMessage = "Complete!";
      
      console.log(`Job ${jobId} completed successfully`);
      
      // Remove from in-memory store since it's now in database
      jobProgress.delete(jobId);
      
    } catch (error) {
      job.status = "error";
      job.error = (error as Error).message;
      job.statusMessage = "Failed";
      
      // Update database with error
      await pool.query(
        'UPDATE jobs SET status = $1, error_message = $2, updated_at = $3 WHERE id = $4',
        ['error', (error as Error).message, new Date(), jobId]
      );
      
      console.error(`Job ${jobId} failed:`, error);
    }
  }

  return router;
} 