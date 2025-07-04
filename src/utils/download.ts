import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - allow dynamic dirname definition if not present

const execAsync = promisify(exec);

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

async function getAvailableImpersonationTargets(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('yt-dlp --list-impersonate-targets');
    const targets = stdout.trim().split('\n').map(s => s.trim()).filter(Boolean);
    console.log(`Available yt-dlp impersonation targets: ${targets.join(', ')}`);
    return targets;
  } catch (error) {
    console.warn("Could not determine available yt-dlp impersonation targets, proceeding without them.", error);
    return [];
  }
}

async function downloadWithYtDlp(youtubeUrl: string, outputDir: string, cookieFilePath: string | null): Promise<DownloadResult> {
  const effectiveCookiePath = cookieFilePath || path.resolve(process.cwd(), 'cookies.txt');
  const hasCookiesFile = effectiveCookiePath ? fs.existsSync(effectiveCookiePath) : false;

  const cookieArg = hasCookiesFile ? `--cookies "${effectiveCookiePath}"` : "";

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let lastError: Error | null = null;

  // Railway-optimized method order: prioritize non-impersonation methods with comprehensive format handling
  const prioritizedFallbackMethods: YtDlpMethod[] = [
    // Method 1: Railway-optimized with comprehensive format fallbacks
    {
      name: "railway-optimized",
      args: [
        "--format", "best[height<=720]/worst[height<=720]/bestaudio/worstaudio/best/worst",
        "--no-check-certificate",
        "--extractor-retries", "3",
        "--prefer-free-formats"
      ],
      description: "Railway-optimized with comprehensive format fallbacks"
    },
    // Method 2: Audio-first approach (since we only need audio)
    {
      name: "audio-first",
      args: [
        "--format", "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best[ext=m4a]/best[ext=mp3]/best/worst",
        "--extract-audio",
        "--prefer-free-formats"
      ],
      description: "Audio-first with multiple format fallbacks"
    },
    // Method 3: Simple progressive fallback
    {
      name: "progressive-fallback",
      args: [
        "--format", "worst/best/bestaudio/worstaudio",
        "--no-check-certificate",
        "--ignore-errors"
      ],
      description: "Progressive quality fallback"
    },
    // Method 4: Any available format (most permissive)
    {
      name: "any-format",
      args: [
        "--format", "best/worst/bestaudio/worstaudio/webm/mp4/3gp",
        "--no-check-certificate",
        "--ignore-errors",
        "--no-warnings",
        "--prefer-free-formats"
      ],
      description: "Accept any available format"
    },
    // Method 5: Last resort - no format specification
    {
      name: "no-format-spec",
      args: [
        "--no-check-certificate",
        "--ignore-errors",
        "--no-warnings"
      ],
      description: "No format specification - use yt-dlp defaults"
    }
  ];

  // Only attempt impersonation if we're not in Railway environment
  const isRailway = process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID;
  if (!isRailway) {
    console.log("Non-Railway environment detected, adding impersonation methods");
    
    // Dynamically get available impersonation targets
    const availableImpersonationTargets = await getAvailableImpersonationTargets();

    if (availableImpersonationTargets.length > 0) {
      for (const target of availableImpersonationTargets) {
        prioritizedFallbackMethods.push({
          name: `${target}-impersonation`,
          args: ["--impersonate", target],
          description: `Impersonating ${target}`
        });
      }
    } else {
      // Fallback known good targets if no dynamic targets are found
      prioritizedFallbackMethods.push(
        {
          name: "chrome-110-impersonation",
          args: ["--impersonate", "chrome-110"],
          description: "Impersonating Chrome 110"
        },
        {
          name: "chrome-99-impersonation",
          args: ["--impersonate", "chrome-99"],
          description: "Impersonating Chrome 99"
        }
      );
    }
  } else {
    console.log("Railway environment detected, skipping impersonation methods");
  }

  for (const method of prioritizedFallbackMethods) {
    console.log(`Attempting download with method: ${method.name} (${method.description})`);
    
    // Define Railway-optimized yt-dlp options
    const isRailway = process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID;
    
    // For info command, use format specification to avoid format resolution errors
    const infoArgs = [
      "--format", "best/worst/bestaudio/worstaudio", // Specify format to prevent resolution errors
      "--rm-cache-dir",
      "--no-playlist",
      "--no-warnings",
      cookieArg
    ].filter(Boolean);

    // Add Railway-specific robustness for info command
    if (isRailway) {
      infoArgs.push(
        "--no-check-certificate",
        "--ignore-errors",
        "--socket-timeout", "30",
        "--prefer-free-formats", // Prefer formats that don't require special handling
        "--no-check-certificate"
      );
    }
    
    // Add headers for info command
    infoArgs.push(
      `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"`,
      `--add-header "Accept-Language: en-US,en;q=0.9"`,
      `--referer "https://www.youtube.com/"`
    );

    // For download command, include method-specific args with additional Railway optimizations
    const downloadArgs = [
      "--rm-cache-dir",
      "--no-playlist",
      "--no-warnings",
      ...method.args, // Include method-specific format args
      cookieArg,
      "--socket-timeout", "30", // Add timeout for Railway stability
      "--retries", "3", // Add retries for network issues
      `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"`,
      `--add-header "Accept-Language: en-US,en;q=0.9"`,
      `--referer "https://www.youtube.com/"`
    ].filter(Boolean);

    try {
      console.log(`Getting video info for: ${youtubeUrl} using method: ${method.name}`);
      const infoCmd = `yt-dlp --print \"%(title)s|%(duration)s\" ${infoArgs.join(" ")} "${youtubeUrl}"`;
      console.log(`Executing info command: ${infoCmd}`);

      const infoResult = await execAsync(infoCmd);
      if (infoResult.stderr) {
        console.log(`yt-dlp info stderr for method ${method.name}: ${infoResult.stderr}`);
      }
      
      const [title, durationStr] = infoResult.stdout.trim().split('|');
      const duration = parseInt(durationStr) || 0;

      const cleanTitle = title
        .replace(/[<>:"/\\|?*👹🎵🎶💯🔥]/g, "")
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 80);
      console.log(`Clean title: ${cleanTitle} for method: ${method.name}`);
      
      const safeFilename = cleanTitle || `audio_${Date.now()}`;
      const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`);

      console.log(`Downloading audio with yt-dlp using method: ${method.name}...`);
      const downloadCmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputTemplate}" ${downloadArgs.join(" ")} "${youtubeUrl}"`;
      console.log(`Executing download command: ${downloadCmd}`);
      
      const { stdout: downloadOutput, stderr: downloadError } = await execAsync(downloadCmd);
      
      if (downloadError) {
        console.log(`yt-dlp download stderr for method ${method.name}: ${downloadError}`);
      }
      console.log(`yt-dlp download stdout for method ${method.name}: ${downloadOutput}`);

      const files = fs.readdirSync(outputDir);
      console.log(`Files in directory after method ${method.name}: ${files.join(', ')}`);
      
      const downloadedFile = files.find(f => 
        (f.includes(safeFilename.substring(0, 15)) || f.includes(cleanTitle.substring(0, 15))) && 
        (f.endsWith('.mp3') || f.endsWith('.webm') || f.endsWith('.m4a') || f.endsWith('.wav'))
      );
      
      if (!downloadedFile) {
        const audioFiles = files.filter(f => f.endsWith('.mp3') || f.endsWith('.webm') || f.endsWith('.m4a') || f.endsWith('.wav'));
        if (audioFiles.length > 0) {
          const newestFile = audioFiles.reduce((a, b) => {
            const aStats = fs.statSync(path.join(outputDir, a));
            const bStats = fs.statSync(path.join(outputDir, b));
            return aStats.mtime > bStats.mtime ? a : b;
          });
          console.log(`Using newest audio file for method ${method.name}: ${newestFile}`);
          return {
            audioPath: path.join(outputDir, newestFile),
            title: title,
            duration,
          };
        }
        throw new Error(`Downloaded file not found for method ${method.name}. Available files: ${files.join(', ')}`);
      }

      console.log(`Found downloaded file for method ${method.name}: ${downloadedFile}`);
      return {
        audioPath: path.join(outputDir, downloadedFile),
        title: title,
        duration,
      };
    } catch (error) {
      console.error(`Attempt with method ${method.name} failed:`, error);
      lastError = error as Error;
      // Continue to the next method
    }
  }

  // All methods failed
  throw new Error(`All yt-dlp download methods failed. Last error: ${lastError?.message || "Unknown error"}`);
}

export async function downloadYouTubeAudio(
  youtubeUrl: string,
  outputDir: string,
  cookieFilePath: string | null = null
): Promise<DownloadResult> {
  return await downloadWithYtDlp(youtubeUrl, outputDir, cookieFilePath);
}