import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { TranscriptionWorker } from "../worker.js";

interface Job {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  pct: number;
  resultUrl?: string;
  error?: string;
  statusMessage?: string;
}

// Simple in-memory job store (replace with DB later)
const jobs = new Map<string, Job>();

// Export a function that creates and returns the router,
// accepting the worker as a dependency.
export default function createJobsRouter(worker: TranscriptionWorker): Router {
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
    jobs.set(id, job);

    // Start processing asynchronously
    processJobAsync(id, parse.data.youtubeUrl, worker); // Pass worker to async function

    res.status(201).json({ jobId: id });
  });

  // GET /api/jobs/:id
  router.get("/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    
    res.json({ 
      status: job.status, 
      pct: job.pct, 
      resultUrl: job.resultUrl,
      statusMessage: job.statusMessage,
      error: job.error
    });
  });

  // GET /api/jobs/:id/result
  router.get("/:id/result", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "done" || !job.resultUrl) {
      return res.status(400).json({ error: "Result not ready" });
    }
    
    try {
      // Read the results file from local storage
      const resultsData = JSON.parse(require("fs").readFileSync(job.resultUrl, "utf8"));
      res.json(resultsData);
    } catch (error) {
      res.status(500).json({ error: "Failed to read results" });
    }
  });

  // Async job processing function
  async function processJobAsync(jobId: string, youtubeUrl: string, workerInstance: TranscriptionWorker) {
    const job = jobs.get(jobId);
    if (!job) return;

    try {
      job.status = "processing";
      job.statusMessage = "Starting...";
      
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
      
    } catch (error) {
      job.status = "error";
      job.error = (error as Error).message;
      job.statusMessage = "Failed";
      console.error(`Job ${jobId} failed:`, error);
    }
  }

  return router;
} 