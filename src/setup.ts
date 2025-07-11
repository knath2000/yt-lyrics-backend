import { pool } from "./db.js";
import fs from "fs";
import path from "path";
import os from "os";

export function initializeCookieJar(): string | null {
  // Always write cookie jar into the OS temp dir so it is ephemeral and never
  // committed to the repository.  yt-dlp requires a *file* path, so we still
  // generate one when the secret is provided.

  if (process.env.YOUTUBE_COOKIES_CONTENT) {
    const cookieFilePath = path.join(os.tmpdir(), "cookies.txt");
    try {
      fs.writeFileSync(cookieFilePath, process.env.YOUTUBE_COOKIES_CONTENT);
      console.log("Populated temporary cookie jar from YOUTUBE_COOKIES_CONTENT secret");
      return cookieFilePath;
    } catch (err: any) {
      console.error("Failed to write temporary cookie file:", err.message || err);
      return null;
    }
  }

  // No secret provided → run unauthenticated (caller should handle null)
  console.log("No YOUTUBE_COOKIES_CONTENT secret found – proceeding without authenticated cookies");
  return null;
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

    let vectorAvailable = true;
    try {
      // Enable pgvector extension for embeddings support (Postgres extension name: "vector")
      await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
      console.log("pgvector extension ready (vector)");
    } catch (extErr: any) {
      // 0A000 means the extension is not installed on the underlying Postgres instance.
      // We log a warning and continue without embeddings support.
      if (extErr.code === "0A000") {
        vectorAvailable = false;
        console.warn("⚠️  pgvector extension not available – embedding features will be disabled");
      } else {
        throw extErr; // unexpected error – rethrow
      }
    }

    if (vectorAvailable) {
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
    }

    // Ensure openai_model column exists (added for per-job model selection)
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS openai_model TEXT;
    `);

    // Add enhanced progress tracking columns
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pct INTEGER DEFAULT 0;
    `);
    
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_message TEXT;
    `);
    
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS current_stage TEXT;
    `);
    
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS processing_method TEXT;
    `);
    
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS processing_time_seconds REAL;
    `);
    
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS video_id TEXT;
    `);
    
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS progress_log JSONB DEFAULT '[]'::jsonb;
    `);

    console.log("Database setup completed successfully");
  } catch (error) {
    console.error("Database setup failed:", error);
    throw error;
  }
}