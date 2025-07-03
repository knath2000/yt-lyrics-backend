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
    const { stdout } = await execAsync('yt-dlp --print-impersonate-targets');
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

  // Dynamically get available impersonation targets
  const availableImpersonationTargets = await getAvailableImpersonationTargets();

  const dynamicMethods: YtDlpMethod[] = [];
  if (availableImpersonationTargets.length > 0) {
    for (const target of availableImpersonationTargets) {
      dynamicMethods.push({
        name: `${target}-impersonation`,
        args: ["--impersonate", target],
        description: `Impersonating ${target}`
      });
    }
  } else {
    // Fallback known good targets if no dynamic targets are found
    dynamicMethods.push(
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

  const prioritizedFallbackMethods: YtDlpMethod[] = [
    // Method 1: No impersonation, but with a robust User-Agent and headers (prioritize this)
    {
      name: "no-impersonation-robust-ua",
      args: [],
      description: "No impersonation, robust User-Agent"
    },
    // Method 2: Basic yt-dlp with minimal headers, relying on default behavior
    {
      name: "basic-yt-dlp",
      args: [],
      description: "Basic yt-dlp"
    },
    ...dynamicMethods // Add dynamically detected or hardcoded impersonation methods here
  ];

  for (const method of prioritizedFallbackMethods) {
    console.log(`Attempting download with method: ${method.name} (${method.description})`);
    
    // Define common yt-dlp options including general impersonation and headers
    const commonYtDlpArgs = [
      "--rm-cache-dir",
      "--no-playlist",
      "--no-warnings",
      ...method.args, // Inject method-specific arguments here
      cookieArg,
      `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"`, // Updated User-Agent
      `--add-header "Accept-Language: en-US,en;q=0.9"`, // Add Accept-Language header
      `--referer "https://www.youtube.com/"` // Ensure consistent Referer header
    ].filter(Boolean).join(" "); // Filter out empty strings and join

    try {
      console.log(`Getting video info for: ${youtubeUrl} using method: ${method.name}`);
      let infoCmd = `yt-dlp --print \"%(title)s|%(duration)s\" ${commonYtDlpArgs} \"${youtubeUrl}\"`;
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
      const downloadCmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputTemplate}" ${commonYtDlpArgs} \"${youtubeUrl}\"`;
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