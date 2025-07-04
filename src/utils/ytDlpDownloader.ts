import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface DownloadResult {
  audioPath: string;
  title: string;
  duration: number;
  method: string;
}

export interface DownloadMethod {
  name: string;
  description: string;
  command: (url: string, outputPath: string, cookiePath?: string) => string[];
}

/**
 * YtDlpDownloader: A resilient, multi-strategy YouTube audio downloader
 * 
 * Implements a 4-step download strategy to handle YouTube's anti-scraping measures:
 * 1. Authenticated, High-Compatibility Format (m4a with cookies)
 * 2. Unauthenticated, High-Compatibility Format (m4a without cookies)
 * 3. Authenticated, Best Available Format (any format with cookies)
 * 4. Unauthenticated, Best Available Format (any format without cookies)
 * 
 * This approach maximizes success rate against signature extraction failures
 * and other YouTube blocking mechanisms.
 */
export class YtDlpDownloader {
  private cookieFilePath: string | null = null;

  constructor(cookieFilePath?: string) {
    this.cookieFilePath = cookieFilePath || null;
  }

  /**
   * Download audio from YouTube URL using resilient multi-step strategy
   */
  async downloadAudio(youtubeUrl: string, outputDir: string): Promise<DownloadResult> {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = Date.now();
    const baseOutputPath = path.join(outputDir, `video_${timestamp}`);

    // Define the 4-step download strategy
    const downloadMethods: DownloadMethod[] = [
      {
        name: "authenticated-m4a",
        description: "Authenticated, High-Compatibility Format (m4a with cookies)",
        command: (url: string, output: string, cookies?: string) => {
          const args = [
            url,
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '--no-playlist',
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '-o', `${output}.%(ext)s`,
            '--no-check-certificate',
            '--ignore-errors',
            '--socket-timeout', '30',
            '--retries', '3'
          ];
          if (cookies) {
            args.splice(1, 0, '--cookies', cookies);
          }
          return args;
        }
      },
      {
        name: "unauthenticated-m4a",
        description: "Unauthenticated, High-Compatibility Format (m4a without cookies)",
        command: (url: string, output: string) => {
          return [
            url,
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '--no-playlist',
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '-o', `${output}.%(ext)s`,
            '--no-check-certificate',
            '--ignore-errors',
            '--socket-timeout', '30',
            '--retries', '3'
          ];
        }
      },
      {
        name: "authenticated-best",
        description: "Authenticated, Best Available Format (any format with cookies)",
        command: (url: string, output: string, cookies?: string) => {
          const args = [
            url,
            '-f', 'bestaudio/best',
            '--no-playlist',
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '-o', `${output}.%(ext)s`,
            '--no-check-certificate',
            '--ignore-errors',
            '--socket-timeout', '30',
            '--retries', '3'
          ];
          if (cookies) {
            args.splice(1, 0, '--cookies', cookies);
          }
          return args;
        }
      },
      {
        name: "unauthenticated-best",
        description: "Unauthenticated, Best Available Format (any format without cookies)",
        command: (url: string, output: string) => {
          return [
            url,
            '-f', 'bestaudio/best',
            '--no-playlist',
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '-o', `${output}.%(ext)s`,
            '--no-check-certificate',
            '--ignore-errors',
            '--socket-timeout', '30',
            '--retries', '3'
          ];
        }
      }
    ];

    let lastError: Error | null = null;
    let tempCookieFile: string | null = null;

    try {
      // Create temporary cookie file if cookies are available
      if (this.cookieFilePath || process.env.YOUTUBE_COOKIES_CONTENT) {
        tempCookieFile = await this.createTempCookieFile(outputDir);
      }

      // Try each download method in sequence
      for (const method of downloadMethods) {
        try {
          console.log(`Attempting download with method: ${method.name} (${method.description})`);
          
          // Skip authenticated methods if no cookies available
          if (method.name.includes('authenticated') && !tempCookieFile) {
            console.log(`Skipping ${method.name}: No cookies available`);
            continue;
          }

          const args = method.command(youtubeUrl, baseOutputPath, tempCookieFile || undefined);
          console.log(`Executing: yt-dlp ${args.join(' ')}`);

          execFileSync('yt-dlp', args, { 
            stdio: 'pipe',
            timeout: 120000, // 2 minute timeout per attempt
            encoding: 'utf8'
          });

          // Check if download succeeded by looking for output files
          const downloadedFile = this.findDownloadedFile(outputDir, timestamp);
          if (downloadedFile) {
            console.log(`Successfully downloaded using method: ${method.name}`);
            
            // Get video metadata
            const metadata = await this.getVideoMetadata(youtubeUrl);
            
            return {
              audioPath: downloadedFile,
              title: metadata.title,
              duration: metadata.duration,
              method: method.name
            };
          }

        } catch (error) {
          lastError = error as Error;
          console.log(`Method ${method.name} failed: ${lastError.message}`);
          continue;
        }
      }

      // If we get here, all methods failed
      throw new Error(`All download methods failed. Last error: ${lastError?.message || 'Unknown error'}`);

    } finally {
      // Clean up temporary cookie file
      if (tempCookieFile && fs.existsSync(tempCookieFile)) {
        try {
          fs.unlinkSync(tempCookieFile);
          console.log('Cleaned up temporary cookie file');
        } catch (error) {
          console.warn('Failed to clean up temporary cookie file:', error);
        }
      }
    }
  }

  /**
   * Create temporary cookie file from environment variable or existing file
   */
  private async createTempCookieFile(outputDir: string): Promise<string | null> {
    const tempCookiePath = path.join(outputDir, 'cookies.txt');

    try {
      if (process.env.YOUTUBE_COOKIES_CONTENT) {
        // Create from environment variable
        fs.writeFileSync(tempCookiePath, process.env.YOUTUBE_COOKIES_CONTENT);
        console.log('Created temporary cookie file from YOUTUBE_COOKIES_CONTENT secret');
        return tempCookiePath;
      } else if (this.cookieFilePath && fs.existsSync(this.cookieFilePath)) {
        // Copy from existing file
        const cookieContent = fs.readFileSync(this.cookieFilePath, 'utf8');
        fs.writeFileSync(tempCookiePath, cookieContent);
        console.log('Created temporary cookie file from existing cookies');
        return tempCookiePath;
      }
    } catch (error) {
      console.warn('Failed to create temporary cookie file:', error);
    }

    return null;
  }

  /**
   * Find the downloaded audio file in the output directory
   */
  private findDownloadedFile(outputDir: string, timestamp: number): string | null {
    try {
      const files = fs.readdirSync(outputDir);
      const downloadedFile = files.find(file => 
        file.includes(`video_${timestamp}`) && 
        (file.endsWith('.mp3') || file.endsWith('.m4a') || file.endsWith('.webm'))
      );

      if (downloadedFile) {
        const fullPath = path.join(outputDir, downloadedFile);
        const stats = fs.statSync(fullPath);
        
        // Verify file is not empty
        if (stats.size > 0) {
          return fullPath;
        }
      }
    } catch (error) {
      console.warn('Error finding downloaded file:', error);
    }

    return null;
  }

  /**
   * Get video metadata without downloading
   */
  private async getVideoMetadata(youtubeUrl: string): Promise<{ title: string; duration: number }> {
    try {
      const args = [youtubeUrl, '--print', '%(title)s|%(duration)s', '--no-playlist'];
      const output = execFileSync('yt-dlp', args, { 
        encoding: 'utf8',
        timeout: 30000,
        stdio: 'pipe'
      }).trim();

      const [title, durationStr] = output.split('|');
      const duration = parseInt(durationStr) || 0;

      return {
        title: title || 'Unknown Title',
        duration: duration
      };
    } catch (error) {
      console.warn('Could not fetch video metadata ahead of time. This might be due to bot detection. Will proceed with download attempts.', error);
      return {
        title: 'Unknown Title',
        duration: 0
      };
    }
  }

  /**
   * Check if yt-dlp is available and get version info
   */
  static async checkYtDlpAvailability(): Promise<{ available: boolean; version?: string }> {
    try {
      const output = execFileSync('yt-dlp', ['--version'], { 
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      }).trim();

      return {
        available: true,
        version: output
      };
    } catch (error) {
      return {
        available: false
      };
    }
  }
}