import { pool } from "./db.js";
import fs from "fs";
import path from "path";

export function initializeCookieJar(): string {
  const cookieFilePath = path.join(process.cwd(), "cookies.txt");
  
  // Create empty cookies.txt if it doesn't exist
  if (!fs.existsSync(cookieFilePath)) {
    fs.writeFileSync(cookieFilePath, "");
    console.log("Created empty cookies.txt file");
  }
  
  return cookieFilePath;
}

export async function setupDatabase(): Promise<void> {
  try {
    // Create jobs table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(255) PRIMARY KEY,
        youtube_url TEXT NOT NULL,
        title TEXT,
        duration INTEGER,
        status VARCHAR(50) NOT NULL DEFAULT 'queued',
        results_url TEXT,
        srt_url TEXT,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        openai_model TEXT
      );
    `);

    // Create index on status for faster queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `);

    // Create index on created_at for sorting
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    `);

    // Enable pgvector extension for embeddings support
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
    `);

    // Create table to store ground-truth lyric segments and their embeddings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS corrected_segments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        youtube_video_id TEXT NOT NULL,
        artist TEXT,
        track_title TEXT,
        segment_text TEXT NOT NULL,
        start_sec REAL,
        end_sec REAL,
        embed_vector VECTOR(1536), -- OpenAI text-embedding-3-small dimensionality
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Vector index for fast ANN search (requires pgvector ≥0.5 and ANALYZE afterwards)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_corrected_segments_embedding
      ON corrected_segments USING ivfflat (embed_vector vector_cosine_ops);
    `);

    // Ensure openai_model column exists (added for per-job model selection)
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS openai_model TEXT;
    `);

    console.log("Database setup completed successfully");
  } catch (error) {
    console.error("Database setup failed:", error);
    throw error;
  }
}