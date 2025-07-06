import { stream, video_basic_info, setToken, getFreeClientID } from 'play-dl';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

export interface DownloadResult {
  audioPath: string;
  title: string;
  duration: number;
  method: string;
}

/**
 * PlayDlDownloader: A modern YouTube audio downloader using play-dl library
 * 
 * This downloader uses the play-dl library which is actively maintained and
 * often more resilient to YouTube's anti-scraping measures than yt-dlp.
 * It provides a programmatic Node.js interface for streaming YouTube audio.
 */
export class PlayDlDownloader {
  private initialized = false;

  constructor() {
    // Initialize play-dl on first use
  }

  /**
   * Initialize play-dl library with free client ID
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Use free client ID for basic functionality
      const clientID = await getFreeClientID();
      if (clientID) {
        setToken({
          soundcloud: {
            client_id: clientID
          }
        });
      }
      this.initialized = true;
      console.log('✅ play-dl initialized successfully');
    } catch (error) {
      console.warn('⚠️ play-dl initialization failed, continuing without token:', error);
      this.initialized = true; // Continue anyway
    }
  }

  /**
   * Download audio from YouTube URL using play-dl
   */
  async downloadAudio(youtubeUrl: string, outputDir: string): Promise<DownloadResult> {
    await this.initialize();

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `video_${timestamp}.mp3`);

    try {
      console.log('🎵 Fetching video info with play-dl...');
      
      // Get video information
      const info = await video_basic_info(youtubeUrl);
      if (!info || !info.video_details) {
        throw new Error('Could not fetch video information');
      }

      const videoDetails = info.video_details;
      console.log(`📹 Video: ${videoDetails.title} (${Math.floor(videoDetails.durationInSec / 60)}:${(videoDetails.durationInSec % 60).toString().padStart(2, '0')})`);

      // Get audio stream
      console.log('🎧 Getting audio stream...');
      const audioStream = await stream(youtubeUrl, { 
        discordPlayerCompatibility: false
      });

      if (!audioStream || !audioStream.stream) {
        throw new Error('Could not get audio stream');
      }

      console.log(`📡 Stream type: ${audioStream.type}`);

      // Create write stream and download
      console.log('💾 Downloading audio...');
      const writeStream = fs.createWriteStream(outputPath);
      
      // Use pipeline for proper error handling and cleanup
      await pipeline(audioStream.stream, writeStream);

      // Verify file was created and has content
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      console.log(`✅ Successfully downloaded ${Math.round(stats.size / 1024 / 1024 * 100) / 100}MB to ${outputPath}`);

      return {
        audioPath: outputPath,
        title: videoDetails.title || 'Unknown Title',
        duration: videoDetails.durationInSec || 0,
        method: 'play-dl'
      };

    } catch (error) {
      // Clean up partial file if it exists
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up partial file:', cleanupError);
        }
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ play-dl download failed:', errorMessage);
      throw new Error(`play-dl download failed: ${errorMessage}`);
    }
  }

  /**
   * Check if play-dl can access the video (basic availability check)
   */
  async checkVideoAvailability(youtubeUrl: string): Promise<{ available: boolean; error?: string }> {
    try {
      await this.initialize();
      const info = await video_basic_info(youtubeUrl);
      return {
        available: !!(info && info.video_details)
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get video metadata without downloading
   */
  async getVideoMetadata(youtubeUrl: string): Promise<{ title: string; duration: number }> {
    try {
      await this.initialize();
      const info = await video_basic_info(youtubeUrl);
      
      if (!info || !info.video_details) {
        throw new Error('Could not fetch video information');
      }

      return {
        title: info.video_details.title || 'Unknown Title',
        duration: info.video_details.durationInSec || 0
      };
    } catch (error) {
      console.warn('Could not fetch video metadata with play-dl:', error);
      return {
        title: 'Unknown Title',
        duration: 0
      };
    }
  }

  /**
   * Check if play-dl is working properly
   */
  static async checkPlayDlAvailability(): Promise<{ available: boolean; version?: string }> {
    try {
      // Try to import and use a basic function
      const { getFreeClientID } = await import('play-dl');
      const clientID = await getFreeClientID();
      
      return {
        available: true,
        version: 'play-dl (latest)' // play-dl doesn't expose version easily
      };
    } catch (error) {
      return {
        available: false
      };
    }
  }
}