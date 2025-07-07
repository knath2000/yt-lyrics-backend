import { Pool } from "pg";
import { OpenAI } from "openai";
import { parseSrt, SrtSegment } from "../utils/srt.js";

export class EmbeddingService {
  constructor(private pool: Pool, private openai: OpenAI, private embeddingModel: string = "text-embedding-3-small") {}

  private async embedText(text: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return res.data[0].embedding as unknown as number[];
  }

  public async ingestCorrection(params: {
    youtubeUrl: string;
    title?: string;
    artist?: string;
    srtContent: string;
  }): Promise<{ inserted: number }> {
    const { youtubeUrl, title, artist, srtContent } = params;
    const videoId = this.extractVideoId(youtubeUrl);
    if (!videoId) throw new Error("Unable to extract video ID from URL");

    const segments = parseSrt(srtContent);
    let inserted = 0;
    for (const seg of segments) {
      const embedding = await this.embedText(seg.text);
      await this.pool.query(
        `INSERT INTO corrected_segments (youtube_video_id, artist, track_title, segment_text, start_sec, end_sec, embed_vector)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [videoId, artist ?? null, title ?? null, seg.text, seg.start, seg.end, embedding]
      );
      inserted++;
    }
    return { inserted };
  }

  private extractVideoId(youtubeUrl: string): string | null {
    try {
      const url = new URL(youtubeUrl);
      if (url.hostname.includes("youtu.be")) {
        return url.pathname.substring(1);
      }
      if (url.searchParams.has("v")) {
        return url.searchParams.get("v");
      }
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.substring(8);
      }
    } catch (_) {
      // fallthrough to regex
    }
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.*|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/] {11})/;
    const match = youtubeUrl.match(regex);
    return match ? match[1] : null;
  }
} 