import { Router } from "express";
import { EmbeddingService } from "../services/embeddingService.js";
import { Pool } from "pg";
import { OpenAI } from "openai";

export default function createCorrectionsRouter(pool: Pool): Router {
  const router = Router();
  const openai = new OpenAI();
  const service = new EmbeddingService(pool, openai);

  /**
   * POST /api/corrections
   * Body: { youtubeUrl: string, title?: string, artist?: string, srt: string }
   */
  router.post("/", async (req, res) => {
    try {
      const { youtubeUrl, title, artist, srt } = req.body as {
        youtubeUrl: string;
        title?: string;
        artist?: string;
        srt: string;
      };
      if (!youtubeUrl || !srt) {
        return res.status(400).json({ error: "youtubeUrl and srt are required" });
      }
      const result = await service.ingestCorrection({ youtubeUrl, title, artist, srtContent: srt });
      res.json({ status: "ok", inserted: result.inserted });
    } catch (error) {
      console.error("/api/corrections error", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
} 