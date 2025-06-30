import OpenAI from "openai";
import fs from "fs";

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  text: string;
  words: TranscriptionWord[];
}

/**
 * Wrapper around OpenAI Audio Transcriptions endpoint.
 * Model is configurable via the `OPENAI_AUDIO_MODEL` env (default: gpt-4o-mini-transcribe).
 */
export class OpenAITranscriber {
  private openai: OpenAI;
  private model: string;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_AUDIO_MODEL ?? "gpt-4o-mini-transcribe";
  }

  private supportsVerbose(): boolean {
    // Whisper family supports word-level timestamps with verbose_json
    return this.model.startsWith("whisper");
  }

  async transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    try {
      const requestBody: any = {
        file: fs.createReadStream(audioPath),
        model: this.model,
        response_format: this.supportsVerbose() ? "verbose_json" : "json",
      };

      if (this.supportsVerbose()) {
        requestBody.timestamp_granularities = ["word"];
      }

      const transcription = await this.openai.audio.transcriptions.create(requestBody);

      const rawWords = (transcription as any).words as Array<{ word: string; start: number; end: number }> | undefined;
      const words: TranscriptionWord[] = rawWords ? rawWords.map((w) => ({ word: w.word, start: w.start, end: w.end })) : [];

      return { text: transcription.text, words };
    } catch (error) {
      throw new Error(`OpenAI transcription failed: ${(error as Error).message}`);
    }
  }
} 