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
    return stdout.trim().split('\n').map(s => s.trim()).filter(Boolean);
  } catch (error) {
    console.warn("Could not list yt-dlp impersonation targets, using fallbacks.", error);
    return [];
  }
}

async function downloadWithYtDlp(youtubeUrl: string, outputDir: string, cookieFilePath: string | null): Promise<DownloadResult> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const effectiveCookiePath = cookieFilePath || path.resolve(process.cwd(), 'cookies.txt');
  const cookieArg = fs.existsSync(effectiveCookiePath) ? `--cookies "${effectiveCookiePath}"` : "";

  // --- Methods to attempt ---
  const methods: YtDlpMethod[] = [
    { name: "default-safe", args: ["-f", "18/22/best"], description: "Default safe pre-merged formats" },
    { name: "best-audio", args: ["-f", "bestaudio/best"], description: "Best audio only" },
  ];

  const impersonationTargets = await getAvailableImpersonationTargets();
  const targetsToTry = impersonationTargets.length > 0 ? impersonationTargets : ['chrome-110', 'chrome-99'];

  for (const target of targetsToTry) {
      methods.push({
          name: `impersonate-${target}`,
          args: ["--impersonate", target, "-f", "18/22/best"],
          description: `Impersonate ${target} with safe formats`
      });
  }

  let lastError: Error | null = null;

  for (const method of methods) {
    console.log(`Attempting download with method: ${method.name} (${method.description})`);
    
    try {
        // --- Get Info (Title, Duration) ---
        const infoArgs = [
            `"${youtubeUrl}"`,
            "--no-playlist",
            "--print", `"%(title)s|%(duration)s"`
        ].join(" ");
        const infoCmd = `yt-dlp ${infoArgs}`;
        const { stdout: infoStdout } = await execAsync(infoCmd);
        const [title, durationStr] = infoStdout.trim().split('|');
        const duration = parseInt(durationStr, 10) || 0;

        // --- Download Audio ---
        const cleanTitle = title.replace(/[<>:"\/\\|?*]/g, "").replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().substring(0, 80);
        const safeFilename = cleanTitle || `audio_${Date.now()}`;
        const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`);

        const downloadArgs = [
            `"${youtubeUrl}"`,
            cookieArg,
            ...method.args,
            "-x", // extract audio
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "-o", `"${outputTemplate}"`,
            isRailway() ? "--no-check-certificate" : "",
            isRailway() ? "--ignore-errors" : "",
            isRailway() ? "--socket-timeout 30" : ""
        ].filter(Boolean).join(" ");

        const downloadCmd = `yt-dlp ${downloadArgs}`;
        console.log(`Executing download: ${downloadCmd}`);
        await execAsync(downloadCmd);

        const files = fs.readdirSync(outputDir);
        const downloadedFile = files.find(f => f.startsWith(safeFilename) && f.endsWith('.mp3'));

        if (!downloadedFile) {
            throw new Error(`Could not find the extracted file in ${outputDir}.`);
        }

        console.log(`Successfully downloaded using method: ${method.name}`);
        return {
            audioPath: path.join(outputDir, downloadedFile),
            title,
            duration,
        };

    } catch (e) {
      lastError = e as Error;
      console.error(`Method ${method.name} failed:`, lastError.message);
    }
  }

  throw new Error(`All yt-dlp methods failed. Last error: ${lastError?.message || "Unknown error"}`);
}

function isRailway(): boolean {
    return !!(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
}

export async function downloadYouTubeAudio(
  youtubeUrl: string,
  outputDir: string,
  cookieFilePath: string | null = null
): Promise<DownloadResult> {
  return await downloadWithYtDlp(youtubeUrl, outputDir, cookieFilePath);
}