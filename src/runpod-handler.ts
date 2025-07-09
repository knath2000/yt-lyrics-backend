import "dotenv/config";
// @ts-ignore – runpod-sdk has no types published yet
import runpod from "runpod-sdk";
import { v4 as uuidv4 } from "uuid";
import { TranscriptionWorker } from "./worker.js";
import { cloudinary } from "./cloudinary.js";
import { pool } from "./db.js";

// Use memory-safe mode; serverless worker likely runs on limited RAM/CPU
const tw = new TranscriptionWorker(
  process.env.OPENAI_API_KEY || "demo-key",
  pool,
  cloudinary,
  "./temp",
  null,
  process.env.DEMUCS_MODEL || "htdemucs",
  true // force memory-safe
);

/**
 * RunPod serverless handler
 * Expected input: { youtubeUrl: string }
 * Returns: { resultUrl: string }
 */
async function handler(job: any) {
  const youtubeUrl = job.input?.youtubeUrl;
  if (!youtubeUrl) {
    throw new Error("youtubeUrl is required in input");
  }

  const jobId = uuidv4();
  const result = await tw.processJob(jobId, youtubeUrl, undefined, undefined, undefined, true);
  return { resultUrl: result.resultUrl };
}

runpod.serverless.start({ handler }); 