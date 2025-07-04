import path from "path";
import fs from "fs";
import { YtDlpDownloader } from "./utils/download.js";
import { OpenAITranscriber } from "./utils/openaiTranscriber.js";
import { WordAligner } from "./utils/align.js";
import { WhisperXProcessor } from "./utils/whisperXProcessor.js";
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
  private whisperXProcessor: WhisperXProcessor;
  private ytDlpDownloader: YtDlpDownloader;
  private workDir: string;
  private cookieFilePath: string | null;
  private activeJobs: Set<string> = new Set(); // 🆕 Track active jobs

  constructor(
    openaiApiKey: string,
    workDir = "./temp",
    cookieFilePath: string | null = null,
    demucsModel: string = "htdemucs", // Current supported model (demucs deprecated Jan 2025)
    demucsMemorySafeMode: boolean = true // Default to memory-safe mode for Railway
  ) {
    // Railway memory optimization: Force memory-safe mode in production
    const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
    if (isRailway) {
      demucsMemorySafeMode = true;
      console.log('Railway environment detected: Forcing memory-safe mode for htdemucs');
    }
    
    this.transcriber = new OpenAITranscriber(openaiApiKey);
    this.wordAligner = new WordAligner();
    this.demucsProcessor = new DemucsProcessor(demucsModel, demucsMemorySafeMode);
    this.whisperXProcessor = new WhisperXProcessor();
    this.ytDlpDownloader = new YtDlpDownloader();
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
    
    // 🆕 Track active job
    this.activeJobs.add(jobId);

    try {
      onProgress?.(5, "Downloading YouTube audio...");
      
      // Step 1: Download YouTube audio
      const downloadResult = await this.ytDlpDownloader.downloadAudio(youtubeUrl, jobDir);
      console.log(`Downloaded: ${downloadResult.title}`);
      
      onProgress?.(20, "Processing audio...");
      
      let audioToTranscribe = downloadResult.audioPath;
      
      // Step 2: Optional vocal separation with Demucs
      const demucsAvailable = await this.demucsProcessor.isDemucsAvailable();
      if (demucsAvailable) {
        // If in memory-safe mode and audio duration is long, skip Demucs
        // Assuming 600 seconds (10 minutes) as the threshold for "long" audio for memory-safe mode
        const DEMUCS_SKIP_THRESHOLD_SECONDS = 600;
        if (this.demucsProcessor.isMemorySafe() && downloadResult.duration > DEMUCS_SKIP_THRESHOLD_SECONDS) {
          console.log(`Demucs skipped for long audio (${downloadResult.duration}s) in memory-safe mode.`);
          onProgress?.(30, "Skipping vocal separation for long audio in memory-safe mode...");
        } else {
          onProgress?.(30, "Separating vocals with Demucs...");
          const demucsResult = await this.demucsProcessor.separateVocals(
            downloadResult.audioPath,
            jobDir
          );
          audioToTranscribe = demucsResult.vocalsPath;
          console.log("Vocal separation completed");
        }
      } else {
        console.log("Demucs not available, using original audio");
      }
      
      onProgress?.(50, "Transcribing with OpenAI 4o-mini...");
      
      // Step 3: Transcribe with Whisper
      const transcription = await this.transcriber.transcribeAudio(audioToTranscribe);
      console.log(`Transcribed text: "${transcription.text.substring(0, 50)}..."`);
      
      onProgress?.(75, "Aligning word timestamps with WhisperX...");
      
      // Step 4: Forced alignment using WhisperX
      const alignedWords = await this.whisperXProcessor.alignAudio(
        audioToTranscribe,
        transcription.text
      );
      console.log(`Aligned ${alignedWords.length} words with WhisperX`);

      const alignment = await this.wordAligner.alignWords({
        text: transcription.text,
        words: alignedWords,
      });
      
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
    } finally {
      // 🆕 Remove from active jobs
      this.activeJobs.delete(jobId);
    }
  }

  // 🆕 CLEANUP METHOD FOR GRACEFUL SHUTDOWN
  async cleanup(): Promise<void> { // Removed jobId argument
    console.log("🔄 Starting TranscriptionWorker cleanup...");
    
    try {
      // 1. Wait for active jobs to complete (with timeout)
      if (this.activeJobs.size > 0) {
        console.log(`🔄 Waiting for ${this.activeJobs.size} active jobs to complete...`);
        
        const waitStart = Date.now();
        const maxWait = 5000; // 5 seconds max wait
        
        while (this.activeJobs.size > 0 && (Date.now() - waitStart) < maxWait) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (this.activeJobs.size > 0) {
          console.log(`⚠️ ${this.activeJobs.size} jobs still active after timeout, proceeding with cleanup`);
        } else {
          console.log("✅ All active jobs completed");
        }
      }

      // 2. Cleanup temp files in work directory (iterate through all)
      console.log("🔄 Cleaning up temporary files...");
      if (fs.existsSync(this.workDir)) {
        const items = fs.readdirSync(this.workDir);
        for (const item of items) {
          const itemPath = path.join(this.workDir, item);
          try {
            const stats = fs.statSync(itemPath);
            if (stats.isDirectory()) {
              fs.rmSync(itemPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(itemPath);
            }
            console.log(`🗑️ Deleted: ${itemPath}`);
          } catch (err) {
            console.warn(`⚠️ Could not delete ${itemPath}:`, err);
          }
        }
      }

      // 3. Cleanup individual processors if they have cleanup methods
      // Trans criber, WordAligner, DemucsProcessor, WhisperXProcessor
      // Assuming these will implement their own `cleanup` methods if needed.
      // Current interface does not show them having cleanup

      console.log("✅ TranscriptionWorker cleanup completed");
      
    } catch (error) {
      console.error("❌ Error during TranscriptionWorker cleanup:", error);
      throw error;
    }
  }

  // 🆕 GET ACTIVE JOBS COUNT
  getActiveJobsCount(): number {
    return this.activeJobs.size;
  }

  // 🆕 GET ACTIVE JOB IDS
  getActiveJobIds(): string[] {
    return Array.from(this.activeJobs);
  }
}