import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs"; // Import readFileSync directly
import { TranscriptionWorker } from "../worker.js";
import { cloudinary } from "../cloudinary.js";
import { pool } from "../db.js";
import type { QueueWorker } from "../queue-worker.js";

interface Job {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  pct: number;
  resultUrl?: string;
  error?: string;
  statusMessage?: string;
}

interface ProcessingStep {
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  percentage: number;
  message: string;
  timestamp: string;
  duration?: number;
}

interface JobProgressResponse {
  status: string;
  pct: number;
  statusMessage?: string;
  error?: string;
  currentStage?: string;
  processingMethod?: string;
  estimatedTimeRemaining?: number;
}

interface JobStepsResponse {
  steps: ProcessingStep[];
  currentStage?: string;
  estimatedTimeRemaining?: number;
}

// Export a function that creates and returns the router,
// accepting the worker, cloudinary, and queueWorker as dependencies.
// Database pool is imported from centralized db.ts module.
export default function createJobsRouter(
  worker: TranscriptionWorker,
  cloudinaryInstance: typeof cloudinary,
  queueWorker?: QueueWorker
): Router {
  const router = Router();

  // Log DB connection details once
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      console.log(`🔗 JobsRouter connected to DB host=${url.host} db=${url.pathname}`);
    } catch (_) {
      console.log(`🔗 JobsRouter DATABASE_URL=${process.env.DATABASE_URL}`);
    }
  }

  // POST /api/jobs
  router.post("/", async (req, res) => {
    const bodySchema = z.object({
      youtubeUrl: z.string().url(),
      preset: z.enum(["low", "regular", "high"]).optional()
    });
    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const id = uuidv4();

    // Map preset to actual OpenAI model names
    const preset = parse.data.preset ?? "regular";
    // Map presets to concrete OpenAI model IDs
    const openaiModel =
      preset === "high"
        ? "gpt-4o-transcribe" // Highest-quality full GPT-4o audio model
        : preset === "low"
          ? "whisper-large-v3-transcribe" // Whisper large-v3 for baseline quality
          : "gpt-4o-mini-transcribe"; // Default regular quality using GPT-4o-mini

    const job: Job = { id, status: "queued", pct: 0 };
    // Job tracking is now handled by QueueWorker

    // Initialize job in database
    await pool.query(
      `INSERT INTO jobs (id, youtube_url, status, created_at, openai_model)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, parse.data.youtubeUrl, 'queued', new Date(), openaiModel]
    );

    console.log(`🔖 Inserted job ${id} for URL ${parse.data.youtubeUrl}`);

    // Debug: count queued rows immediately after insert
    try {
      const { rows: countRows } = await pool.query("SELECT count(*) FROM jobs WHERE status = 'queued'");
      console.log(`📊 Queued rows in DB now: ${countRows[0].count}`);
    } catch (countErr) {
      console.error('Count query failed:', countErr);
    }

    // DO NOT start processing here - let the queue worker handle it
    // processJobAsync(id, parse.data.youtubeUrl, worker); // REMOVED - causes SIGTERM

    res.status(201).json({ jobId: id });
  });

  // GET /api/jobs/:id
  router.get("/:id", async (req, res) => {
    // Check in-memory progress first for real-time updates
    const progressJob = queueWorker?.getJobProgress(req.params.id);
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
        pct: (dbJob.status === 'completed' || dbJob.status === 'done') ? 100 : 0,
        resultUrl: dbJob.results_url,
        statusMessage: (dbJob.status === 'completed' || dbJob.status === 'done') ? 'Complete!' : 'Processing...',
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
      if ((job.status !== "completed" && job.status !== "done") || !job.results_url) {
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

  // Helper function to calculate estimated time remaining
  function calculateEstimatedTime(currentPct: number, processingMethod?: string): number {
    if (currentPct >= 95) return 0;
    
    // Base estimates by processing method (in seconds)
    const baseEstimates = {
      'groq_whisper': 5,      // Very fast with Groq
      'modal_gpu': 60,        // Modal GPU processing
      'local_cpu': 180        // Local CPU fallback
    };
    
    const baseTime = baseEstimates[processingMethod as keyof typeof baseEstimates] || 60;
    const remainingPct = 100 - currentPct;
    
    return Math.round((remainingPct / 100) * baseTime);
  }

  // GET /api/jobs/:id/steps - Detailed step tracking endpoint
  router.get("/:id/steps", async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT pct, status, current_stage, processing_method, progress_log 
         FROM jobs WHERE id = $1`,
        [req.params.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Job not found" });
      }

      const job = result.rows[0];
      const steps: ProcessingStep[] = job.progress_log || [];
      const estimatedTime = calculateEstimatedTime(job.pct, job.processing_method);

      const response: JobStepsResponse = {
        steps,
        currentStage: job.current_stage,
        estimatedTimeRemaining: estimatedTime
      };

      res.json(response);
    } catch (error) {
      console.error('Database error:', error);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Enhanced progress endpoint with detailed metadata
  router.get("/:id/progress", async (req, res) => {
    // Check in-memory progress for real-time updates
    const progressJob = queueWorker?.getJobProgress(req.params.id);
    if (progressJob) {
      const response: JobProgressResponse = {
        status: progressJob.status,
        pct: progressJob.pct,
        statusMessage: progressJob.statusMessage,
        error: progressJob.error
      };
      return res.json(response);
    }

    // Fall back to database for completed/queued jobs
    try {
      const result = await pool.query(
        `SELECT status, pct, status_message, error_message, current_stage, 
                processing_method, processing_time_seconds 
         FROM jobs WHERE id = $1`,
        [req.params.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Job not found" });
      }

      const job = result.rows[0];
      const estimatedTime = calculateEstimatedTime(job.pct, job.processing_method);

      const response: JobProgressResponse = {
        status: job.status,
        pct: job.pct || 0,
        statusMessage: job.status_message || (
          (job.status === 'completed' || job.status === 'done') ? 'Complete!' :
          job.status === 'queued' ? 'Waiting in queue...' : 'Processing...'
        ),
        error: job.error_message,
        currentStage: job.current_stage,
        processingMethod: job.processing_method,
        estimatedTimeRemaining: estimatedTime
      };

      res.json(response);
    } catch (error) {
      console.error('Database error:', error);
      res.status(500).json({ error: "Database error" });
    }
  });

  return router;
} 