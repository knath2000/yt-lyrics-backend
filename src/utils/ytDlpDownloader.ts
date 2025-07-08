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
 * Implements a **single** unauthenticated m4a download strategy. Cookie-based
 * or multi-strategy fallbacks were removed to reduce complexity and avoid the
 * overhead of creating temporary cookie files.
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
    // Previous resilient multi-strategy chain (v2025-07-06)
    // 1. Try authenticated m4a (requires cookies)
    // 2. Fallback to unauthenticated m4a
    // 3. Try authenticated generic best format (cookies)
    // 4. Final fallback to unauthenticated generic best format
    // NOTE: Additional strategies can be appended but MUST use the
    //       `authenticated-` prefix if they explicitly require cookies.

    const downloadMethods: DownloadMethod[] = [
      {
        name: "authenticated-m4a",
        description: "Authenticated, m4a Format (requires cookies)",
        command: (url: string, output: string, cookiePath?: string) => {
          if (!cookiePath) throw new Error('No cookie file supplied for authenticated method');
          return [
            url,
            '--cookies', cookiePath,
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '--no-playlist',
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '-o', `${output}.%(ext)s`,
            '--no-check-certificate',
            '--ignore-errors',
            '--socket-timeout', '30',
            '--retries', '3',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--referer', 'https://www.youtube.com/',
            '--add-header', 'Accept-Language:en-US,en;q=0.9',
            '--extractor-args', 'youtube:player_client=ios'
          ];
        }
      },
      {
        name: "unauthenticated-m4a",
        description: "Unauthenticated, m4a Format (no cookies)",
        command: (url: string, output: string) => [
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
            '--retries', '3',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--referer', 'https://www.youtube.com/',
            '--add-header', 'Accept-Language:en-US,en;q=0.9',
            '--extractor-args', 'youtube:player_client=ios'
        ]
      },
      {
        name: "authenticated-generic",
        description: "Authenticated, Generic Format (any best format with cookies)",
        command: (url: string, output: string, cookiePath?: string) => {
          if (!cookiePath) throw new Error('No cookie file supplied for authenticated method');
          return [
            url,
            '--cookies', cookiePath,
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '--no-playlist',
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '-o', `${output}.%(ext)s`,
            '--no-check-certificate',
            '--ignore-errors',
            '--socket-timeout', '30',
            '--retries', '3',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--referer', 'https://www.youtube.com/',
            '--add-header', 'Accept-Language:en-US,en;q=0.9',
            '--extractor-args', 'youtube:player_client=ios'
          ];
        }
      },
      {
        name: "unauthenticated-generic",
        description: "Unauthenticated, Generic Format (any best format)",
        command: (url: string, output: string) => [
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
            '--retries', '3',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--referer', 'https://www.youtube.com/',
            '--add-header', 'Accept-Language:en-US,en;q=0.9',
            '--extractor-args', 'youtube:player_client=ios'
        ]
      }
    ];

    let lastError: Error | null = null;
    let tempCookieFile: string | null = null;

    try {
      // Only create a temporary cookie file if we'll actually attempt
      // an authenticated download method (none exist in the simplified
      // pipeline). This preserves previous behaviour for future extension
      // but avoids unnecessary cookie-file chatter in logs.
      // Detect if *explicit* authenticated methods are present. We purposefully look
      // for names that *start with* the prefix `authenticated-` to avoid false
      // positives such as the word "unauthenticated" (which naturally contains
      // the substring "authenticated").
      const hasAuthenticatedMethod = downloadMethods.some((m) => m.name.startsWith('authenticated-'));
      if (hasAuthenticatedMethod && (this.cookieFilePath || process.env.YOUTUBE_COOKIES_CONTENT)) {
        tempCookieFile = await this.createTempCookieFile(outputDir);
      }

      // Try each download method in sequence
      for (const method of downloadMethods) {
        try {
          console.log(`Attempting download with method: ${method.name} (${method.description})`);
          
          // Skip authenticated methods if no cookies are available for methods that
          // explicitly require them (names prefixed with `authenticated-`).
          if (method.name.startsWith('authenticated-') && !tempCookieFile) {
            console.log(`Skipping ${method.name}: No cookies available`);
            continue;
          }

          const args = method.command(youtubeUrl, baseOutputPath, tempCookieFile || undefined);
          console.log(`Executing: yt-dlp ${args.join(' ')}`);

          const result = execFileSync('yt-dlp', args, {
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
          console.error(`❌ Method ${method.name} failed:`);
          console.error(`   Error message: ${lastError.message}`);
          
          // Log detailed error information for execFileSync errors
          if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
            const execError = error as any; // execFileSync error has stdout, stderr, status properties
            console.error(`   stdout: ${execError.stdout || '(empty)'}`);
            console.error(`   stderr: ${execError.stderr || '(empty)'}`);
            console.error(`   exit code: ${execError.status || 'unknown'}`);
          }
          
          // Log the full command that failed
          const args = method.command(youtubeUrl, baseOutputPath, tempCookieFile || undefined);
          console.error(`   Failed command: yt-dlp ${args.join(' ')}`);
          
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
      } else if (fs.existsSync('/tmp/cookies.txt')) {
        // Fallback: copy the cookie jar created at startup (if any)
        try {
          const cookieContent = fs.readFileSync('/tmp/cookies.txt', 'utf8');
          fs.writeFileSync(tempCookiePath, cookieContent);
          console.log('Created temporary cookie file from /tmp/cookies.txt');
          return tempCookiePath;
        } catch {
          // ignore read errors – will return null below
        }
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
  async getVideoMetadata(youtubeUrl: string): Promise<{ title: string; duration: number }> {
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