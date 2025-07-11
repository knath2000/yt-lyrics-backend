import path from "path";
import fs from "fs";
import { HybridDownloader } from "./utils/hybridDownloader.js";
import { OpenAITranscriber } from "./utils/openaiTranscriber.js";
import { WordAligner } from "./utils/align.js";
import { WhisperXProcessor } from "./utils/whisperXProcessor.js";
import { DemucsProcessor } from "./utils/demucs.js";
import { cloudinary } from "./cloudinary.js";
import { Pool } from "pg";

export interface JobProcessingResult {
  words: any[];
  srt: string;
  plain: string;
  resultUrl: string;
}

export class TranscriptionWorker {
  private openaiApiKey: string;
  private wordAligner: WordAligner;
  private demucsProcessor: DemucsProcessor;
  private whisperXProcessor: WhisperXProcessor;
  private hybridDownloader: HybridDownloader;
  private workDir: string;
  private cookieFilePath: string | null;
  private activeJobs: Set<string> = new Set(); // 🆕 Track active jobs
  private dbPool: Pool;
  private cloudinary: typeof cloudinary;

  constructor(
    openaiApiKey: string,
    dbPool: Pool,
    cloudinaryInstance: typeof cloudinary,
    workDir = "./temp",
    cookieFilePath: string | null = null,
    demucsModel: string = process.env.DEMUCS_MODEL || "htdemucs_ft", // Default to fine-tuned model unless overridden
    demucsMemorySafeMode?: boolean // Optional override for memory-safe mode
  ) {
    // Determine memory-safe mode: respect env var or explicit param, otherwise optimize for production
    const isProduction = process.env.NODE_ENV === 'production';
    const memorySafeEnv = process.env.DEMUCS_MEMORY_SAFE;
    
    let finalMemorySafeMode: boolean;
    
    if (demucsMemorySafeMode !== undefined) {
      // If explicitly passed in, use that value
      finalMemorySafeMode = demucsMemorySafeMode;
      console.log(`Demucs memory-safe mode explicitly set to: ${finalMemorySafeMode}`);
    } else if (memorySafeEnv !== undefined) {
      // Otherwise, respect the environment variable
      finalMemorySafeMode = memorySafeEnv.toLowerCase() === 'true';
      console.log(`DEMUCS_MEMORY_SAFE environment variable found: ${finalMemorySafeMode}`);
    } else {
      // Default to false in production to use full server resources (8GB RAM upgrade)
      finalMemorySafeMode = !isProduction;
      if (isProduction) {
        console.log('Production environment: Defaulting to memory-safe mode OFF to utilize full server resources (8GB RAM)');
      } else {
        console.log('Development environment: Defaulting to memory-safe mode ON for safety');
      }
    }
    
    this.dbPool = dbPool;
    this.cloudinary = cloudinaryInstance;
    this.openaiApiKey = openaiApiKey; // Save for per-job transcriber instantiation
    this.wordAligner = new WordAligner();
    // Allow overriding model via DEMUCS_MODEL env or constructor param
    const chosenDemucsModel = process.env.DEMUCS_MODEL || demucsModel;
    this.demucsProcessor = new DemucsProcessor(chosenDemucsModel, finalMemorySafeMode);
    this.whisperXProcessor = new WhisperXProcessor();
    // Pass the cookie file path so that authenticated yt-dlp strategies can utilize
    // real browser cookies when available. This dramatically increases the success
    // rate against YouTube’s bot-detection flow.
    this.hybridDownloader = new HybridDownloader(cookieFilePath ?? undefined);
    this.workDir = workDir;
    this.cookieFilePath = cookieFilePath;

    // Ensure work directory exists
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, { recursive: true });
    }
  }

  /**
   * Extract the canonical 11-character YouTube video ID from common URL formats.
   */
  private extractVideoId(youtubeUrl: string): string | null {
    try {
      const url = new URL(youtubeUrl);

      // https://www.youtube.com/watch?v=VIDEO_ID
      if (/(www\.)?youtube\.com/.test(url.hostname) && url.pathname === "/watch") {
        return url.searchParams.get("v");
      }

      // https://youtu.be/VIDEO_ID
      if (url.hostname === "youtu.be") {
        return url.pathname.substring(1);
      }

      // https://www.youtube.com/shorts/VIDEO_ID
      if (/(www\.)?youtube\.com/.test(url.hostname) && url.pathname.startsWith("/shorts/")) {
        return url.pathname.substring("/shorts/".length);
      }
    } catch {
      /* ignore – fall through to regex */
    }

    // Fallback regex extraction
    const regex = /(?:youtube\.com\/(?:.*[?&]v=|v\/|embed\/)|youtu\.be\/)([^"&?\n\r\/]{11})/;
    const match = youtubeUrl.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Attempt to fetch previously-extracted audio from Cloudinary.
   * Returns local path info if successful or null if no cache hit.
   */
  private async tryFetchCachedAudio(videoId: string, outputDir: string): Promise<{ audioPath: string; title: string; duration: number } | null> {
    const publicId = `audio/${videoId}/bestaudio_mp3`;

    try {
      const resource = await this.cloudinary.api.resource(publicId, {
        resource_type: "video",
      });

      if (!resource || !resource.secure_url) return null;

      // Download the cached MP3 to the working directory
      const localPath = path.join(outputDir, `${videoId}.mp3`);

      const response = await fetch(resource.secure_url);
      if (!response.ok) {
        throw new Error(`Failed to fetch cached audio: HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(localPath, Buffer.from(arrayBuffer));

      return {
        audioPath: localPath,
        title: videoId,
        duration: 0, // Duration unknown – not critical for pipeline
      };
    } catch (err: any) {
      // Cache miss or other error – treat as no cache
      if (err?.http_code !== 404) {
        console.warn(`[Cache] Cache lookup error for ${videoId}:`, err.message || err);
      }
      return null;
    }
  }

  /** Utility: upload freshly-downloaded audio to Cloudinary cache */
  private async uploadAudioToCache(videoId: string, filePath: string) {
    try {
      await this.cloudinary.uploader.upload(filePath, {
        resource_type: "video",
        public_id: `audio/${videoId}/bestaudio_mp3`,
        overwrite: true,
        tags: ["yt_audio_cache", `video:${videoId}`],
      });
      console.log(`[Cache] Uploaded audio ${videoId} to Cloudinary cache.`);
    } catch (err: any) {
      console.warn(`[Cache] Failed to upload ${videoId} to Cloudinary:`, err.message || err);
    }
  }

  /**
   * Public method for QueueWorker to attempt YouTube download
   * First checks Cloudinary cache, then downloads if needed
   * Returns the audio URL (cached or newly uploaded) for Modal access
   */
  async downloadAudioForModal(youtubeUrl: string, jobId: string): Promise<{ audioUrl: string; videoId: string }> {
    const videoId = this.extractVideoId(youtubeUrl);
    if (!videoId) {
      throw new Error(`Could not extract video ID from URL: ${youtubeUrl}`);
    }

    const jobDir = path.join(this.workDir, jobId);
    
    // Ensure job directory exists
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    // STEP 1: Check Cloudinary cache first
    const cachePublicId = `audio/${videoId}/bestaudio_mp3`;
    
    try {
      console.log(`🔍 [Fly.io Cache] Checking cache for video ${videoId}...`);
      
      // Check if cached audio exists in Cloudinary
      const resource = await this.cloudinary.api.resource(cachePublicId, {
        resource_type: "video"
      });
      
      if (resource && resource.secure_url) {
        console.log(`✅ [Fly.io Cache] Cache hit! Using cached audio: ${resource.secure_url}`);
        
        return {
          audioUrl: resource.secure_url,
          videoId: videoId
        };
      }
    } catch (cacheError: any) {
      // Cache miss (404) or other error - proceed with download
      if (cacheError?.http_code === 404) {
        console.log(`💾 [Fly.io Cache] No cached audio found for ${videoId}, proceeding with download...`);
      } else {
        console.warn(`⚠️ [Fly.io Cache] Cache check error for ${videoId}:`, cacheError?.message || cacheError?.error || cacheError || 'Unknown error');
        console.log(`🔄 [Fly.io Cache] Proceeding with download despite cache error...`);
      }
    }

    // STEP 2: Cache miss - download using HybridDownloader
    console.log(`📥 [Fly.io] Downloading audio from YouTube for ${videoId}...`);
    
    const downloadResult = await this.hybridDownloader.downloadAudio(youtubeUrl, jobDir);
    
    if (!downloadResult || !downloadResult.audioPath) {
      throw new Error("Download failed - no audio file created");
    }

    console.log(`✅ [Fly.io] Download successful: ${downloadResult.audioPath}`);
    
    // STEP 3: Upload fresh audio to Cloudinary cache for future use
    const audioUploadResult = await this.cloudinary.uploader.upload(downloadResult.audioPath, {
      resource_type: "video",
      public_id: cachePublicId,
      overwrite: true,
      tags: ["yt_audio_cache", `video:${videoId}`]
    });
    
    console.log(`📤 [Fly.io] Audio uploaded to Cloudinary cache: ${audioUploadResult.secure_url}`);
    
    return {
      audioUrl: audioUploadResult.secure_url,
      videoId: videoId
    };
  }

  async processJob(
    jobId: string,
    youtubeUrl: string,
    onProgress?: (pct: number, status: string) => void,
    openaiModel?: string,
    demucsModel?: string, // 🆕 optional per-job Demucs model override
    skipDbUpdate: boolean = false // 🆕 new flag for serverless handler
  ): Promise<JobProcessingResult> {
    const jobDir = path.join(this.workDir, jobId);

    // Guarantee the per-job working directory exists before we attempt any
    // file operations such as writing a cached MP3 from Cloudinary. Without
    // this, tryFetchCachedAudio() would throw an ENOENT error on its first
    // fs.writeFileSync(), which we previously (mis-)interpreted as a cache
    // miss and fell back to a fresh YouTube download.
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    
    // 🆕 Track active job
    this.activeJobs.add(jobId);

    try {
      onProgress?.(5, "Preparing audio (cache check)...");

      // Attempt Cloudinary cache first
      let downloadResult: { audioPath: string; title: string; duration: number };
      const videoId = this.extractVideoId(youtubeUrl);

      if (videoId) {
        const cached = await this.tryFetchCachedAudio(videoId, jobDir);
        if (cached) {
          console.log(`[Cache] Audio cache hit for ${videoId}`);
          onProgress?.(10, "Using cached audio from Cloudinary...");
          downloadResult = cached;
        } else {
          console.log(`[Cache] No cached audio for ${videoId}, downloading from YouTube...`);
          onProgress?.(10, "Downloading YouTube audio...");
          downloadResult = await this.hybridDownloader.downloadAudio(youtubeUrl, jobDir);
          // Upload to cache asynchronously (don’t await to avoid blocking)
          this.uploadAudioToCache(videoId, downloadResult.audioPath).catch(() => {});
        }
      } else {
        // Fallback – proceed with normal download if videoId extraction failed
        onProgress?.(10, "Downloading YouTube audio...");
        downloadResult = await this.hybridDownloader.downloadAudio(youtubeUrl, jobDir);
      }
      console.log(`Downloaded: ${downloadResult.title}`);
      
      onProgress?.(20, "Processing audio...");
      
      let audioToTranscribe = downloadResult.audioPath;
      
      // Step 2: Optional vocal separation with Demucs
      // Decide which DemucsProcessor instance to use – either the default one
      // created in the constructor or a new per-job override when a model
      // parameter is supplied. This leaves global memory-safe configuration
      // unchanged. We purposefully avoid touching any download logic.

      const perJobDemucsProcessor = demucsModel
        ? new DemucsProcessor(
            demucsModel,
            this.demucsProcessor.isMemorySafe() // reuse global memory-safe flag
          )
        : this.demucsProcessor;

      const demucsAvailable = await perJobDemucsProcessor.isDemucsAvailable();
      if (demucsAvailable) {
        // If in memory-safe mode and audio duration is long, skip Demucs
        // Assuming 600 seconds (10 minutes) as the threshold for "long" audio for memory-safe mode
        const DEMUCS_SKIP_THRESHOLD_SECONDS = 600;
        if (perJobDemucsProcessor.isMemorySafe() && downloadResult.duration > DEMUCS_SKIP_THRESHOLD_SECONDS) {
          console.log(`Demucs skipped for long audio (${downloadResult.duration}s) in memory-safe mode.`);
          onProgress?.(30, "Skipping vocal separation for long audio in memory-safe mode...");
        } else {
          onProgress?.(30, "Separating vocals with Demucs...");
          const demucsResult = await perJobDemucsProcessor.separateVocals(
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
      
      // Step 3: Transcribe with Whisper (per-job model override)
      const transcription = await new OpenAITranscriber(this.openaiApiKey, openaiModel).transcribeAudio(audioToTranscribe);
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
      
      onProgress?.(95, "Uploading to cloud storage...");
      
      // Step 6: Upload results to Cloudinary
      const uploadResult = await this.cloudinary.uploader.upload(resultsPath, {
        resource_type: "raw",
        public_id: `transcriptions/${jobId}/results`,
      });
      
      const srtUploadResult = await this.cloudinary.uploader.upload(srtPath, {
        resource_type: "raw",
        public_id: `transcriptions/${jobId}/subtitles`,
      });
      
      // Step 7: Update job metadata in database (skip for serverless context)
      if (!skipDbUpdate) {
        await this.dbPool.query(
          `UPDATE jobs SET
           title = $1,
           duration = $2,
           status = $3,
           results_url = $4,
           srt_url = $5,
           updated_at = $6,
           completed_at = $7
           WHERE id = $8`,
          [
            downloadResult.title,
            downloadResult.duration,
            'completed',
            uploadResult.secure_url,
            srtUploadResult.secure_url,
            new Date(),
            new Date(),
            jobId
          ]
        );
      }
      
      onProgress?.(100, "Complete!");
      
      return {
        words: alignment.words,
        srt: alignment.srt,
        plain: alignment.plain,
        resultUrl: uploadResult.secure_url,
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