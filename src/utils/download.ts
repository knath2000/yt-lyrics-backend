import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { once } from "events";

export interface DownloadResult {
  audioPath: string;
  title: string;
  duration: number;
}

interface YtDlpMethod {
  name: string;
  args: string[];
  description: string;
}

/**
 * Enhanced YT-DLP downloader with comprehensive fallback strategies
 * Prioritizes cookies from YOUTUBE_COOKIES_CONTENT secret, then falls back to
 * impersonation and proxy methods to overcome bot detection on cloud platforms.
 */
export class YtDlpDownloader {
  private ytDlpPath: string = 'yt-dlp';

  constructor() {
    this.initializeYtDlpPath();
  }

  private async initializeYtDlpPath(): Promise<void> {
    try {
      // Prefer pip-installed yt-dlp with curl_cffi support
      console.log('Using pip-installed yt-dlp with curl_cffi support from PATH.');
      this.ytDlpPath = 'yt-dlp';
    } catch {
      // Fallback to pre-built binary (may lack curl_cffi support)
      const binaryPath = '/usr/local/bin/yt-dlp_binary';
      try {
        await fs.promises.access(binaryPath, fs.constants.X_OK);
        console.log(`Fallback: Using pre-built yt-dlp binary at ${binaryPath} (limited impersonation support)`);
        this.ytDlpPath = binaryPath;
      } catch {
        console.log('No yt-dlp found, using default from PATH.');
        this.ytDlpPath = 'yt-dlp';
      }
    }
  }

  /**
   * Executes a command and returns its stdout.
   */
  private async executeCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    const [exitCode] = await once(process, "close");

    if (exitCode !== 0) {
      const errorMessage = `Command "${command} ${args.join(" ")}" failed with exit code ${exitCode}:\n${stdout}\n${stderr}`;
      throw new Error(errorMessage);
    }

    return { stdout, stderr };
  }

  /**
   * Checks for memory corruption errors that indicate curl_cffi issues
   */
  private hasMemoryCorruptionError(stderr: string): boolean {
    const corruptionPatterns = [
      'double free or corruption',
      'malloc(): corrupted top size',
      'free(): invalid pointer',
      'corrupted size vs. prev_size',
      'malloc(): memory corruption'
    ];
    
    return corruptionPatterns.some(pattern => 
      stderr.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Creates a temporary cookie file from YOUTUBE_COOKIES_CONTENT secret
   */
  private async createCookieFile(jobDir: string): Promise<string | null> {
    const cookieContent = process.env.YOUTUBE_COOKIES_CONTENT;
    
    if (!cookieContent || cookieContent.trim() === '') {
      return null;
    }

    const cookieFilePath = path.join(jobDir, 'cookies.txt');
    
    try {
      await fs.promises.writeFile(cookieFilePath, cookieContent.trim(), 'utf8');
      console.log('Created temporary cookie file from YOUTUBE_COOKIES_CONTENT secret');
      return cookieFilePath;
    } catch (error) {
      console.warn('Failed to create cookie file:', error);
      return null;
    }
  }

  /**
   * Safely deletes the temporary cookie file
   */
  private async cleanupCookieFile(cookieFilePath: string | null): Promise<void> {
    if (!cookieFilePath) return;
    
    try {
      await fs.promises.unlink(cookieFilePath);
      console.log('Cleaned up temporary cookie file');
    } catch (error) {
      console.warn('Failed to cleanup cookie file:', error);
    }
  }

  /**
   * Gets available impersonation targets
   */
  private async getAvailableImpersonationTargets(): Promise<string[]> {
    const validTargets = new Set(['chrome', 'firefox', 'safari', 'edge', 'opera']);
    try {
      const { stdout } = await this.executeCommand(this.ytDlpPath, ['--list-impersonate-targets']);
      const targets = stdout
        .trim()
        .split('\n')
        .map(s => s.trim().split(/\s+/)[0].toLowerCase())
        .filter(s => validTargets.has(s));

      console.log(`Available yt-dlp impersonation targets: ${targets.join(', ')}`);
      if (targets.length > 0) {
        return targets;
      }
      console.warn("No valid impersonation targets found from command output, using default fallback.");
      return ['chrome'];
    } catch (error) {
      console.warn("Could not list yt-dlp impersonation targets, using fallbacks.", error);
      return ['chrome', 'firefox'];
    }
  }

  /**
   * Attempts to fetch video metadata
   */
  private async fetchVideoMetadata(youtubeUrl: string, cookieFilePath: string | null): Promise<{ title: string; duration: number }> {
    const cookieArgs = cookieFilePath ? [`--cookies`, cookieFilePath] : [];
    
    try {
      const infoArgs = [youtubeUrl, "--print", "%(title)s|%(duration)s", "--no-playlist", ...cookieArgs];
      const { stdout } = await this.executeCommand(this.ytDlpPath, infoArgs);
      const [fetchedTitle, durationStr] = stdout.trim().split('|');
      
      return {
        title: fetchedTitle || 'Unknown Title',
        duration: parseInt(durationStr, 10) || 0
      };
    } catch (e) {
      const error = e as Error;
      console.warn("Could not fetch video metadata ahead of time. This might be due to bot detection. Will proceed with download attempts.", error.message);
      return {
        title: `video_${Date.now()}`,
        duration: 0
      };
    }
  }

  /**
   * Builds the download methods array based on available options
   */
  private async buildDownloadMethods(cookieFilePath: string | null): Promise<YtDlpMethod[]> {
    const methods: YtDlpMethod[] = [];

    // Strategy 1: Use cookies if available (highest priority)
    if (cookieFilePath) {
      methods.push({
        name: "cookies-best",
        args: ["-f", "bestaudio/best", "--cookies", cookieFilePath],
        description: "Best audio with cookies"
      });
    }

    // Strategy 2: Default method (no special flags)
    methods.push({
      name: "default-best",
      args: ["-f", "bestaudio/best"],
      description: "Default best audio"
    });

    // Strategy 3: Impersonation methods (if no cookies or cookies failed)
    if (!cookieFilePath) {
      const impersonationTargets = await this.getAvailableImpersonationTargets();
      for (const target of impersonationTargets) {
        methods.push({
          name: `impersonate-${target}`,
          args: ["-f", "bestaudio/best", "--impersonate", target],
          description: `Impersonate ${target}`
        });
      }
    }

    // Strategy 4: Proxy method (last resort)
    const proxyUrl = process.env.PROXY_URL;
    if (proxyUrl && proxyUrl.trim() !== '') {
      methods.push({
        name: "proxy-best",
        args: ["-f", "bestaudio/best", "--proxy", proxyUrl.trim()],
        description: `Best audio via proxy`
      });
    }

    return methods;
  }

  /**
   * Main download method with comprehensive fallback strategies
   */
  public async downloadAudio(youtubeUrl: string, outputDir: string): Promise<DownloadResult> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    let cookieFilePath: string | null = null;
    
    try {
      // Create cookie file from secret if available
      cookieFilePath = await this.createCookieFile(outputDir);
      
      // Fetch video metadata
      const { title, duration } = await this.fetchVideoMetadata(youtubeUrl, cookieFilePath);
      
      // Prepare safe filename
      const cleanTitle = title.replace(/[<>:"\/\\|?*]/g, "").replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().substring(0, 80);
      const safeFilename = cleanTitle || `audio_${Date.now()}`;
      const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`);
      
      // Build download methods
      const methods = await this.buildDownloadMethods(cookieFilePath);
      
      let lastError: Error | null = null;
      let skipImpersonation = false;

      for (const method of methods) {
        // Skip impersonation methods if we detected memory corruption
        if (skipImpersonation && method.name.startsWith('impersonate-')) {
          console.log(`Skipping ${method.name} due to previous memory corruption error`);
          continue;
        }

        console.log(`Attempting download with method: ${method.name} (${method.description})`);
        
        const downloadArgs = [
          youtubeUrl,
          ...method.args,
          "--no-playlist",
          "-x",
          "--audio-format", "mp3",
          "--audio-quality", "0",
          "-o", outputTemplate,
          "--no-check-certificate", 
          "--ignore-errors",
          "--socket-timeout", "30",
          "--retries", "3"
        ];
        
        try {
          console.log(`Executing: ${this.ytDlpPath} ${downloadArgs.join(" ")}`);
          await this.executeCommand(this.ytDlpPath, downloadArgs);

          const files = fs.readdirSync(outputDir);
          const downloadedFile = files.find(f => f.startsWith(safeFilename) && f.endsWith('.mp3'));

          if (!downloadedFile) {
            throw new Error(`Could not find the extracted file in ${outputDir} after download command.`);
          }

          console.log(`Successfully downloaded using method: ${method.name}`);
          return {
            audioPath: path.join(outputDir, downloadedFile),
            title,
            duration,
          };
        } catch (e) {
          lastError = e as Error;
          const errorMessage = lastError.message;
          
          // Check for memory corruption errors
          if (this.hasMemoryCorruptionError(errorMessage)) {
            console.error(`Memory corruption detected in ${method.name}, skipping remaining impersonation methods`);
            skipImpersonation = true;
          }
          
          console.error(`Method ${method.name} failed:`, errorMessage.substring(0, 500));
        }
      }

      throw new Error(`All yt-dlp download methods failed. Last error: ${lastError?.message || "Unknown error"}`);
      
    } finally {
      // Always cleanup the cookie file
      await this.cleanupCookieFile(cookieFilePath);
    }
  }
}

// Legacy function for backward compatibility
export async function downloadYouTubeAudio(
  youtubeUrl: string,
  outputDir: string,
  cookieFilePath: string | null = null
): Promise<DownloadResult> {
  const downloader = new YtDlpDownloader();
  return await downloader.downloadAudio(youtubeUrl, outputDir);
}