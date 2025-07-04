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

// Helper function to build a clean yt-dlp command
function buildYtDlpCommand(args: string[]): string {
    // It's safer to not manually quote arguments with spaces.
    // Instead, we rely on the fact that `exec` on unix-like systems
    // will use sh, which can handle argument arrays passed to it.
    // However, since we are building a single string, we must be careful.
    // A robust solution would use `spawn`, but to keep changes minimal,
    // we'll construct the string carefully.
    return ['yt-dlp', ...args].join(' ');
}


async function downloadWithYtDlp(youtubeUrl: string, outputDir: string, cookieFilePath: string | null): Promise<DownloadResult> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const effectiveCookiePath = cookieFilePath || path.resolve(process.cwd(), 'cookies.txt');
  const hasCookiesFile = fs.existsSync(effectiveCookiePath);

  // --- Base arguments for all yt-dlp commands ---
  const baseArgs = [
    "--no-playlist",
    "--no-warnings",
    "--rm-cache-dir",
  ];

  if (hasCookiesFile) {
    baseArgs.push(`--cookies`, `"${effectiveCookiePath}"`);
  }

  const isRailway = process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID;
  if (isRailway) {
    baseArgs.push(
      "--no-check-certificate",
      "--ignore-errors",
      "--socket-timeout", "30"
    );
  }

  // --- 1. Get Video Info and Available Formats ---
  console.log("Fetching video info and available formats...");
  const infoArgs = [
      ...baseArgs,
      '--dump-json',
      `"${youtubeUrl}"`
  ];

  let videoInfo;
  try {
      const infoCmd = buildYtDlpCommand(infoArgs);
      console.log(`Executing info command: ${infoCmd}`);
      const { stdout } = await execAsync(infoCmd);
      videoInfo = JSON.parse(stdout);
  } catch (e) {
      const error = e as Error;
      console.error("Failed to fetch video info with --dump-json.", error);
      throw new Error(`Failed to get video info for ${youtubeUrl}. Last error: ${error.message}`);
  }

  const { title, duration, formats } = videoInfo;

  if (!formats || formats.length === 0) {
      throw new Error("No available formats found for this video.");
  }
  
  // --- 2. Select the Best Pre-Merged Format ---
  // Prioritize known good, pre-merged, reasonably sized mp4 formats
  const preferredFormatIds = ['18', '22']; 
  let selectedFormatId: string | null = null;

  for (const id of preferredFormatIds) {
      if (formats.some((f: any) => f.format_id === id)) {
          selectedFormatId = id;
          console.log(`Preferred pre-merged format found: ${selectedFormatId}`);
          break;
      }
  }

  // Fallback if no preferred pre-merged format is found
  if (!selectedFormatId) {
    console.log("No preferred pre-merged format found. Falling back to best audio.");
    // This is less ideal for constrained envs, but a necessary fallback.
    selectedFormatId = "bestaudio/best"; 
  }

  // --- 3. Download the Selected Format and Extract Audio ---
  const cleanTitle = title
    .replace(/[<>:"/\\|?*👹🎵🎶💯🔥]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 80);
  
  const safeFilename = cleanTitle || `audio_${Date.now()}`;
  const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`);

  console.log(`Downloading with format '${selectedFormatId}' and extracting audio...`);
  const downloadArgs = [
    ...baseArgs,
    '-f', selectedFormatId,
    '-x', // Extract audio
    '--audio-format', 'mp3',
    '--audio-quality', '0', // Best quality
    '-o', `"${outputTemplate}"`,
    '--retries', '3',
    `"${youtubeUrl}"`,
  ];
  
  const downloadCmd = buildYtDlpCommand(downloadArgs);
  console.log(`Executing download command: ${downloadCmd}`);
  
  try {
    await execAsync(downloadCmd);
  } catch(e) {
    const error = e as Error;
    console.error("Audio download and extraction failed.", error);
    throw new Error(`Failed to download and extract audio. Last error: ${error.message}`);
  }

  // --- 4. Find the Downloaded File ---
  const files = fs.readdirSync(outputDir);
  const downloadedFile = files.find(f => f.startsWith(safeFilename) && f.endsWith('.mp3'));

  if (!downloadedFile) {
    throw new Error(`Could not find the extracted mp3 file in the output directory. Files found: ${files.join(', ')}`);
  }

  console.log(`Successfully downloaded and extracted audio to: ${downloadedFile}`);
  return {
    audioPath: path.join(outputDir, downloadedFile),
    title: title,
    duration: duration || 0,
  };
}

export async function downloadYouTubeAudio(
  youtubeUrl: string,
  outputDir: string,
  cookieFilePath: string | null = null
): Promise<DownloadResult> {
  return await downloadWithYtDlp(youtubeUrl, outputDir, cookieFilePath);
}