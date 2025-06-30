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

export class WhisperTranscriber {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
    try {
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }

      // Use OpenAI Whisper API with word-level timestamps
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
      });

      // Extract words with timestamps
      const words: TranscriptionWord[] = transcription.words?.map((word) => ({
        word: word.word,
        start: word.start,
        end: word.end,
      })) || [];

      return {
        text: transcription.text,
        words,
      };
    } catch (error) {
      throw new Error(`Whisper transcription failed: ${(error as Error).message}`);
    }
  }

  // Fallback method for ElevenLabs Scribe API
  async transcribeWithElevenLabs(audioPath: string, apiKey: string): Promise<TranscriptionResult> {
    // TODO: Implement ElevenLabs Scribe API integration
    // This would be used as fallback when OpenAI Whisper is busy
    throw new Error("ElevenLabs integration not yet implemented");
  }
} 