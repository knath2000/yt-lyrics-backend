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
 * Executes a command and returns its stdout.
 * @param command The command to execute.
 * @param args The arguments for the command.
 * @returns A promise that resolves with the stdout.
 */
async function executeCommand(command: string, args: string[]): Promise<string> {
  const process = spawn(command, args);
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
    throw new Error(`Command "${command} ${args.join(" ")}" failed with exit code ${exitCode}:\n${stderr}`);
  }

  return stdout;
}

async function getAvailableImpersonationTargets(ytDlpPath: string): Promise<string[]> {
  try {
    const stdout = await executeCommand(ytDlpPath, ['--list-impersonate-targets']);
    // Filter out header and invalid lines, take the first word of each valid line
    const targets = stdout
      .trim()
      .split('\n')
      .slice(2) // Skip header lines
      .map(s => s.trim().split(/\s+/)[0])
      .filter(Boolean);
    console.log(`Available yt-dlp impersonation targets: ${targets.join(', ')}`);
    if (targets.length === 0) {
        console.warn("No impersonation targets found from command output.");
        return ['chrome-110']; // Sensible fallback
    }
    return targets;
  } catch (error) {
    console.warn("Could not list yt-dlp impersonation targets, using fallbacks.", error);
    return ['chrome-110', 'chrome-99']; // Sensible fallbacks
  }
}

async function getYtDlpPath(): Promise<string> {
    const binaryPath = '/usr/local/bin/yt-dlp_binary';
    try {
        await fs.promises.access(binaryPath, fs.constants.X_OK);
        console.log(`Using pre-built yt-dlp binary at ${binaryPath}`);
        return binaryPath;
    } catch {
        console.log('Pre-built yt-dlp binary not found or not executable, using yt-dlp from PATH.');
        return 'yt-dlp';
    }
}

async function downloadWithYtDlp(youtubeUrl: string, outputDir: string, cookieFilePath: string | null): Promise<DownloadResult> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ytDlpPath = await getYtDlpPath();

  const effectiveCookiePath = cookieFilePath || path.resolve(process.cwd(), 'cookies.txt');
  const cookieArgs = fs.existsSync(effectiveCookiePath) ? [`--cookies`, effectiveCookiePath] : [];

  let title: string = '';
  let duration: number = 0;
  
  try {
    const infoArgs = ["--print", "%(title)s|%(duration)s", "--no-playlist", youtubeUrl];
    const infoStdout = await executeCommand(ytDlpPath, infoArgs);
    const [fetchedTitle, durationStr] = infoStdout.trim().split('|');
    title = fetchedTitle || 'Unknown Title';
    duration = parseInt(durationStr, 10) || 0;
  } catch (e) {
    const error = e as Error;
    console.warn("Could not fetch video metadata anead of time.", error.message);
    title = `video_${Date.now()}`;
  }
  
  const cleanTitle = title.replace(/[<>:"\/\\|?*]/g, "").replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().substring(0, 80);
  const safeFilename = cleanTitle || `audio_${Date.now()}`;
  const outputTemplate = path.join(outputDir, `${safeFilename}.%(ext)s`);
  
  const baseMethods: YtDlpMethod[] = [
    { name: "default-best", args: ["-f", "bestaudio/best"], description: "Default best audio" },
  ];
  
  const impersonationTargets = await getAvailableImpersonationTargets(ytDlpPath);
  for (const target of impersonationTargets) {
      baseMethods.push({
          name: `impersonate-${target}`,
          args: ["--impersonate", target],
          description: `Impersonate ${target}`
      });
  }

  let lastError: Error | null = null;

  for (const method of baseMethods) {
    console.log(`Attempting download with method: ${method.name} (${method.description})`);
    
    const downloadArgs = [
        youtubeUrl,
        ...cookieArgs,
        ...method.args,
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
        console.log(`Executing: ${ytDlpPath} ${downloadArgs.join(" ")}`);
        await executeCommand(ytDlpPath, downloadArgs);

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
      console.error(`Method ${method.name} failed:`, lastError.message);
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