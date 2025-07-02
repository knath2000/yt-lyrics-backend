import path from "path";
import fs from "fs";
import { downloadYouTubeAudio } from "./utils/download.js";
import { OpenAITranscriber } from "./utils/openaiTranscriber.js";
import { WordAligner } from "./utils/align.js";
import { DemucsProcessor } from "./utils/demucs.js";

export interface JobProcessingResult {
  words: any[];
  srt: string;
  plain: string;
  resultUrl: string;
}

export class TranscriptionWorker {
  private transcriber: OpenAITranscriber;
  private wordAligner: WordAligner;
  private demucsProcessor: DemucsProcessor;
  private workDir: string;
  private cookieFilePath: string | null;

  constructor(openaiApiKey: string, workDir = "./temp", cookieFilePath: string | null = null) {
    this.transcriber = new OpenAITranscriber(openaiApiKey);
    this.wordAligner = new WordAligner();
    this.demucsProcessor = new DemucsProcessor();
    this.workDir = workDir;
    this.cookieFilePath = cookieFilePath;

    // Ensure work directory exists
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, { recursive: true });
    }
  }

  async processJob(
    jobId: string,
    youtubeUrl: string,
    onProgress?: (pct: number, status: string) => void
  ): Promise<JobProcessingResult> {
    const jobDir = path.join(this.workDir, jobId);
    
    try {
      onProgress?.(5, "Downloading YouTube audio...");
      
      // Step 1: Download YouTube audio
      const downloadResult = await downloadYouTubeAudio(youtubeUrl, jobDir, this.cookieFilePath);
      console.log(`Downloaded: ${downloadResult.title}`);
      
      onProgress?.(20, "Processing audio...");
      
      let audioToTranscribe = downloadResult.audioPath;
      
      // Step 2: Optional vocal separation with Demucs
      const demucsAvailable = await this.demucsProcessor.isDemucsAvailable();
      if (demucsAvailable) {
        onProgress?.(30, "Separating vocals with Demucs...");
        const demucsResult = await this.demucsProcessor.separateVocals(
          downloadResult.audioPath,
          jobDir
        );
        audioToTranscribe = demucsResult.vocalsPath;
        console.log("Vocal separation completed");
      } else {
        console.log("Demucs not available, using original audio");
      }
      
      onProgress?.(50, "Transcribing with OpenAI 4o-mini...");
      
      // Step 3: Transcribe with Whisper
      const transcription = await this.transcriber.transcribeAudio(audioToTranscribe);
      console.log(`Transcribed ${transcription.words.length} words`);
      
      onProgress?.(75, "Aligning word timestamps...");
      
      // Step 4: Forced alignment for better timing
      const alignment = await this.wordAligner.alignWords(transcription);
      
      onProgress?.(90, "Saving results...");
      
      // Step 5: Save results to files
      const resultsPath = path.join(jobDir, "results.json");
      const srtPath = path.join(jobDir, "subtitles.srt");
      
      const results = {
        words: alignment.words,
        srt: alignment.srt,
        plain: alignment.plain,
        metadata: {
          title: downloadResult.title,
          duration: downloadResult.duration,
          processedAt: new Date().toISOString(),
        },
      };
      
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
      fs.writeFileSync(srtPath, alignment.srt);
      
      onProgress?.(100, "Complete!");
      
      // TODO: Upload to S3 and return public URL
      // For now, return local file path
      return {
        words: alignment.words,
        srt: alignment.srt,
        plain: alignment.plain,
        resultUrl: resultsPath,
      };
      
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);
      throw new Error(`Processing failed: ${(error as Error).message}`);
    }
  }

  // Clean up temporary files
  async cleanup(jobId: string): Promise<void> {
    const jobDir = path.join(this.workDir, jobId);
    if (fs.existsSync(jobDir)) {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  }
} 