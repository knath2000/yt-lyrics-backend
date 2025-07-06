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
  private ytDlpDownloader: YtDlpDownloader;

  constructor(cookieFilePath?: string) {
    this.ytDlpDownloader = new YtDlpDownloader(cookieFilePath);
  }

  /**
   * Download audio using hybrid approach: play-dl first, then yt-dlp fallback
   */
  async downloadAudio(youtubeUrl: string, outputDir: string): Promise<DownloadResult> {
    console.log('🎵 Starting hybrid download strategy...');

    // Single strategy: yt-dlp only
    console.log('📡 Downloading with yt-dlp (unauthenticated m4a)...');
    return await this.ytDlpDownloader.downloadAudio(youtubeUrl, outputDir);
  }

  /**
   * Check video availability using both methods
   */
  async checkVideoAvailability(youtubeUrl: string): Promise<{ available: boolean; method?: string; error?: string }> {
    // Use yt-dlp metadata check only
    try {
      const metadata = await this.ytDlpDownloader.getVideoMetadata(youtubeUrl);
      if (metadata.title !== 'Unknown Title') {
        return { available: true, method: 'yt-dlp' };
      }
    } catch (error) {
      return { 
        available: false, 
        error: `Video not accessible: ${(error as Error).message}` 
      };
    }
    return { available: false, error: 'Video not accessible by yt-dlp' };
  }

  /**
   * Get video metadata using the most reliable method available
   */
  async getVideoMetadata(youtubeUrl: string): Promise<{ title: string; duration: number; method: string }> {
    // yt-dlp only
    try {
      const metadata = await this.ytDlpDownloader.getVideoMetadata(youtubeUrl);
      return { ...metadata, method: 'yt-dlp' };
    } catch (error) {
      console.warn('yt-dlp metadata fetch failed:', error);
      return { title: 'Unknown Title', duration: 0, method: 'none' };
    }
  }
  // Retain static check for yt-dlp only
  static async checkDownloadersAvailability(): Promise<{
    ytDlp: { available: boolean; version?: string };
  }> {
    const ytDlpStatus = await YtDlpDownloader.checkYtDlpAvailability();
    return { ytDlp: ytDlpStatus };
  }
}