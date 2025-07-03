
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

async function downloadWithYtDlp(youtubeUrl: string, outputDir: string, cookieFilePath: string | null): Promise<DownloadResult> {
  // Use the provided cookieFilePath if available, otherwise check for cookies.txt at project root
  const effectiveCookiePath = cookieFilePath || path.resolve(process.cwd(), 'cookies.txt');
  const hasCookiesFile = effectiveCookiePath ? fs.existsSync(effectiveCookiePath) : false;

  const cookieArg = hasCookiesFile ? `--cookies "${effectiveCookiePath}"` : "";

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    console.log(`Getting video info for: ${youtubeUrl}`);
    // Use a more robust user agent to mimic a real browser
    // Define common yt-dlp options including impersonation and headers
    const commonYtDlpArgs = [
      "--rm-cache-dir",
      "--no-playlist",
      "--no-warnings",
      "--impersonate chrome", // Impersonate Chrome for better evasion
      hasCookiesFile ? `--cookies "${effectiveCookiePath}"` : "",
      `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"`, // Updated User-Agent
      `--add-header "Accept-Language: en-US,en;q=0.9"`, // Add Accept-Language header
      `--referer "https://www.youtube.com/"` // Ensure consistent Referer header
    ].filter(Boolean).join(" "); // Filter out empty strings and join

    console.log(`Checking for cookies file at: ${effectiveCookiePath}, Exists: ${hasCookiesFile}`);
    let infoCmd = `yt-dlp --print \"%(title)s|%(duration)s\" ${commonYtDlpArgs} \"${youtubeUrl}\"`;
    
    let infoResult: { stdout: string; stderr: string } | null = null;
    try {
      infoResult = await execAsync(infoCmd);
    } catch (error) {
      // If the initial attempt with cookies.txt and user-agent fails,
      // it means the primary strategy is not working.
      // No further fallbacks for yt-dlp are needed as per the plan.
      throw new Error(`yt-dlp failed to get video info: ${(error as Error).message}`);
    }
    
    if (!infoResult) {
      throw new Error(`Failed to get video information with any method`);
    }
    
    const { stdout: infoOutput, stderr: infoError } = infoResult;
    
    if (infoError) {
      console.log(`yt-dlp info stderr: ${infoError}`);
    }
    
    const [title, durationStr] = infoOutput.trim().split('|');
    const duration = parseInt(durationStr) || 0;

    // Clean title for filename (more conservative cleaning)
    const cleanTitle = title
      .replace(/[<>:"/\\|?*👹🎵🎶💯🔥]/g, "") // Remove special chars and emojis
      .replace(/[^\w\s-]/g, "") // Remove remaining non-alphanumeric chars except spaces and hyphens
      .replace(/\s+/g, " ") // Normalize spaces
      .trim()
      .substring(0, 80); // Shorter filename to avoid path length issues
    console.log(`Clean title: ${cleanTitle}`);
    
    // Use a simpler filename pattern with fallback
    const safeFilename = cleanTitle || `audio_${Date.now()}`;
    const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`);

    // Download audio using the same authentication method that worked for info
    console.log(`Downloading audio with yt-dlp...`);
    const downloadCmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputTemplate}" ${commonYtDlpArgs} \"${youtubeUrl}\"`;
    
    const { stdout: downloadOutput, stderr: downloadError } = await execAsync(downloadCmd);
    
    if (downloadError) {
      console.log(`yt-dlp download stderr: ${downloadError}`);
    }
    
    console.log(`yt-dlp download stdout: ${downloadOutput}`);

    // Find the actual downloaded file
    const files = fs.readdirSync(outputDir);
    console.log(`Files in directory: ${files.join(', ')}`);
    
    const downloadedFile = files.find(f => 
      (f.includes(safeFilename.substring(0, 15)) || f.includes(cleanTitle.substring(0, 15))) && 
      (f.endsWith('.mp3') || f.endsWith('.webm') || f.endsWith('.m4a') || f.endsWith('.wav'))
    );
    
    if (!downloadedFile) {
      // If we can't find by title, get the newest file
      const audioFiles = files.filter(f => f.endsWith('.mp3') || f.endsWith('.webm') || f.endsWith('.m4a') || f.endsWith('.wav'));
      if (audioFiles.length > 0) {
        const newestFile = audioFiles.reduce((a, b) => {
          const aStats = fs.statSync(path.join(outputDir, a));
          const bStats = fs.statSync(path.join(outputDir, b));
          return aStats.mtime > bStats.mtime ? a : b;
        });
        console.log(`Using newest audio file: ${newestFile}`);
        return {
          audioPath: path.join(outputDir, newestFile),
          title: title, // Use original title for display
          duration,
        };
      }
      throw new Error(`Downloaded file not found. Available files: ${files.join(', ')}`);
    }

    console.log(`Found downloaded file: ${downloadedFile}`);
    return {
      audioPath: path.join(outputDir, downloadedFile),
      title: title, // Use original title for display
      duration,
    };
  } catch (error) {
    console.error(`yt-dlp error details:`, error);
    throw new Error(`yt-dlp failed: ${(error as Error).message}`);
  }
}

export async function downloadYouTubeAudio(
  youtubeUrl: string,
  outputDir: string,
  cookieFilePath: string | null = null
): Promise<DownloadResult> {
  // Try yt-dlp (more reliable)
  return await downloadWithYtDlp(youtubeUrl, outputDir, cookieFilePath);
}