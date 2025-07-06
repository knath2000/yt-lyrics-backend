import { PlayDlDownloader } from './playDlDownloader.js';
import { YtDlpDownloader } from './ytDlpDownloader.js';

export interface DownloadResult {
  audioPath: string;
  title: string;
  duration: number;
  method: string;
}

/**
 * HybridDownloader: A resilient YouTube audio downloader that combines multiple strategies
 * 
 * This downloader implements a two-tier approach:
 * 1. Primary: play-dl (modern, actively maintained, often more resilient)
 * 2. Fallback: yt-dlp (proven, comprehensive, with multi-strategy approach)
 * 
 * This maximizes success rate by leveraging the strengths of both libraries.
 */
export class HybridDownloader {
  private playDlDownloader: PlayDlDownloader;
  private ytDlpDownloader: YtDlpDownloader;

  constructor(cookieFilePath?: string) {
    this.playDlDownloader = new PlayDlDownloader();
    this.ytDlpDownloader = new YtDlpDownloader(cookieFilePath);
  }

  /**
   * Download audio using hybrid approach: play-dl first, then yt-dlp fallback
   */
  async downloadAudio(youtubeUrl: string, outputDir: string): Promise<DownloadResult> {
    console.log('🎵 Starting hybrid download strategy...');

    let playDlError: Error | null = null;

    // Strategy 1: Try play-dl first
    try {
      console.log('📡 Attempting download with play-dl (primary method)...');
      const result = await this.playDlDownloader.downloadAudio(youtubeUrl, outputDir);
      console.log('✅ play-dl download successful!');
      return result;
    } catch (error) {
      playDlError = error as Error;
      console.warn('⚠️ play-dl download failed:', playDlError.message);
      console.log('🔄 Falling back to yt-dlp...');
    }

    // Strategy 2: Fallback to yt-dlp with its multi-strategy approach
    try {
      console.log('📡 Attempting download with yt-dlp (fallback method)...');
      const result = await this.ytDlpDownloader.downloadAudio(youtubeUrl, outputDir);
      console.log('✅ yt-dlp download successful!');
      return result;
    } catch (ytDlpError) {
      console.error('❌ yt-dlp download also failed:', (ytDlpError as Error).message);
      throw new Error(`All download methods failed. play-dl error: ${playDlError?.message || 'Unknown'}. yt-dlp error: ${(ytDlpError as Error).message}`);
    }
  }

  /**
   * Check video availability using both methods
   */
  async checkVideoAvailability(youtubeUrl: string): Promise<{ available: boolean; method?: string; error?: string }> {
    // Try play-dl first
    try {
      const playDlCheck = await this.playDlDownloader.checkVideoAvailability(youtubeUrl);
      if (playDlCheck.available) {
        return { available: true, method: 'play-dl' };
      }
    } catch (error) {
      console.warn('play-dl availability check failed:', error);
    }

    // Fallback to yt-dlp metadata check
    try {
      const metadata = await this.ytDlpDownloader.getVideoMetadata(youtubeUrl);
      if (metadata.title !== 'Unknown Title') {
        return { available: true, method: 'yt-dlp' };
      }
    } catch (error) {
      return { 
        available: false, 
        error: `Both methods failed to access video: ${(error as Error).message}` 
      };
    }

    return { available: false, error: 'Video not accessible by either method' };
  }

  /**
   * Get video metadata using the most reliable method available
   */
  async getVideoMetadata(youtubeUrl: string): Promise<{ title: string; duration: number; method: string }> {
    // Try play-dl first
    try {
      const metadata = await this.playDlDownloader.getVideoMetadata(youtubeUrl);
      if (metadata.title !== 'Unknown Title') {
        return { ...metadata, method: 'play-dl' };
      }
    } catch (error) {
      console.warn('play-dl metadata fetch failed:', error);
    }

    // Fallback to yt-dlp
    try {
      const metadata = await this.ytDlpDownloader.getVideoMetadata(youtubeUrl);
      return { ...metadata, method: 'yt-dlp' };
    } catch (error) {
      console.warn('yt-dlp metadata fetch failed:', error);
      return { title: 'Unknown Title', duration: 0, method: 'none' };
    }
  }

  /**
   * Check availability of both download methods
   */
  static async checkDownloadersAvailability(): Promise<{
    playDl: { available: boolean; version?: string };
    ytDlp: { available: boolean; version?: string };
  }> {
    const [playDlStatus, ytDlpStatus] = await Promise.all([
      PlayDlDownloader.checkPlayDlAvailability(),
      YtDlpDownloader.checkYtDlpAvailability()
    ]);

    return {
      playDl: playDlStatus,
      ytDlp: ytDlpStatus
    };
  }
}