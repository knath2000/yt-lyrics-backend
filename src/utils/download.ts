import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

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
    console.warn("Could not list yt-dlp impersonation targets, using fallbacks.", error);
    return ['chrome-110', 'chrome-99']; // Sensible fallbacks
  }
}

async function downloadWithYtDlp(youtubeUrl: string, outputDir: string, cookieFilePath: string | null): Promise<DownloadResult> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const effectiveCookiePath = cookieFilePath || path.resolve(process.cwd(), 'cookies.txt');
  const cookieArgs = fs.existsSync(effectiveCookiePath) ? [`--cookies`, `"${effectiveCookiePath}"`] : [];

  let title: string = '';
  let duration: number = 0;

  // First, try to get video metadata. This may fail, but we can proceed without it.
  try {
    const infoCmd = `yt-dlp --print "%(title)s|%(duration)s" --no-playlist "${youtubeUrl}"`;
    const { stdout: infoStdout } = await execAsync(infoCmd);
    const [fetchedTitle, durationStr] = infoStdout.trim().split('|');
    title = fetchedTitle || 'Unknown Title';
    duration = parseInt(durationStr, 10) || 0;
  } catch (e) {
    const error = e as Error;
    console.warn("Could not fetch video metadata beforehand, will proceed with download attempt and derive metadata later.", error.message);
    title = `video_${Date.now()}`; // Fallback title
  }
  
  const cleanTitle = title.replace(/[<>:"\/\\|?*]/g, "").replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().substring(0, 80);
  const safeFilename = cleanTitle || `audio_${Date.now()}`;
  const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`);
  
  // --- Create a list of methods to try ---
  const baseMethods: YtDlpMethod[] = [
    { name: "default-best", args: ["-f", "bestaudio/best"], description: "Default best audio" },
    { name: "safe-mp4", args: ["-f", "18"], description: "Safe pre-merged MP4" },
  ];
  
  const impersonationTargets = await getAvailableImpersonationTargets();
  for (const target of impersonationTargets) {
      baseMethods.push({
          name: `impersonate-${target}`,
          args: ["--impersonate", target, "-f", "bestaudio/best"],
          description: `Impersonate ${target}`
      });
  }

  let lastError: Error | null = null;

  for (const method of baseMethods) {
    console.log(`Attempting download with method: ${method.name} (${method.description})`);
    
    const downloadArgs = [
        `"${youtubeUrl}"`,
        ...cookieArgs,
        ...method.args,
        "-x", // extract audio
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", `"${outputTemplate}"`,
        "--no-check-certificate", 
        "--ignore-errors",
        "--socket-timeout", "30",
        "--retries", "3"
    ];

    const downloadCmd = `yt-dlp ${downloadArgs.join(" ")}`;
    
    try {
        console.log(`Executing: ${downloadCmd}`);
        await execAsync(downloadCmd);

        const files = fs.readdirSync(outputDir);
        const downloadedFile = files.find(f => f.startsWith(safeFilename) && f.endsWith('.mp3'));

        if (!downloadedFile) {
            throw new Error(`Could not find the extracted file in ${outputDir}.`);
        }

        console.log(`Successfully downloaded using method: ${method.name}`);
        // If we didn't get duration before, try to get it now from the file
        if (duration === 0) {
            // Simplified: in a real case, we'd use ffprobe here.
            // For now, we'll return 0.
        }
        return {
            audioPath: path.join(outputDir, downloadedFile),
            title,
            duration,
        };
    } catch (e) {
      lastError = e as Error;
      console.error(`Method ${method.name} failed:`, lastError.message);
      // If one method fails, try the next.
    }
  }

  throw new Error(`All yt-dlp download methods failed. Last error: ${lastError?.message || "Unknown error"}`);
}

export async function downloadYouTubeAudio(
  youtubeUrl: string,
  outputDir: string,
  cookieFilePath: string | null = null
): Promise<DownloadResult> {
  return await downloadWithYtDlp(youtubeUrl, outputDir, cookieFilePath);
}