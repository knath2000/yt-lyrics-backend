import ytdl from "ytdl-core";
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

async function downloadWithYtDlp(youtubeUrl: string, outputDir: string): Promise<DownloadResult> {
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Strategy 1: Try with mweb client (often works without authentication)
    console.log(`Getting video info for: ${youtubeUrl}`);
    let infoCmd = `yt-dlp --print "%(title)s|%(duration)s" --no-warnings --extractor-args "youtube:player_client=mweb" "${youtubeUrl}"`;
    
    let infoResult: { stdout: string; stderr: string } | null = null;
    try {
      infoResult = await execAsync(infoCmd);
    } catch (mwebError) {
      console.log(`mweb client failed, trying with browser cookies...`);
      
      // Strategy 2: Try with browser cookies (Chrome first, then Firefox)
      const browsers = ['chrome', 'firefox', 'safari', 'edge'];
      let cookieSuccess = false;
      
      for (const browser of browsers) {
        try {
          console.log(`Attempting with ${browser} cookies...`);
          infoCmd = `yt-dlp --print "%(title)s|%(duration)s" --no-warnings --cookies-from-browser ${browser} "${youtubeUrl}"`;
          infoResult = await execAsync(infoCmd);
          cookieSuccess = true;
          console.log(`Successfully authenticated with ${browser} cookies`);
          break;
        } catch (browserError) {
          console.log(`${browser} cookies failed: ${browserError}`);
          continue;
        }
      }
      
      if (!cookieSuccess) {
        // Strategy 3: Try alternative extractors or basic approach
        console.log(`Browser cookies failed, trying basic approach with different user agent...`);
        infoCmd = `yt-dlp --print "%(title)s|%(duration)s" --no-warnings --user-agent "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" "${youtubeUrl}"`;
        try {
          infoResult = await execAsync(infoCmd);
        } catch (basicError) {
          throw new Error(`All authentication methods failed. Last error: ${basicError}`);
        }
      }
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
    console.log(`Downloading audio...`);
    let downloadCmd = infoCmd.replace('--print "%(title)s|%(duration)s"', `-x --audio-format mp3 --audio-quality 0 --no-playlist -o "${outputTemplate}"`);
    
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

async function downloadWithYtdlCore(youtubeUrl: string, outputDir: string): Promise<DownloadResult> {
  // Validate YouTube URL
  if (!ytdl.validateURL(youtubeUrl)) {
    throw new Error("Invalid YouTube URL");
  }

  // Get video info
  const info = await ytdl.getInfo(youtubeUrl);
  const title = info.videoDetails.title.replace(/[^\w\s-]/g, "").trim();
  const duration = parseInt(info.videoDetails.lengthSeconds);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const audioPath = path.join(outputDir, `${title}.webm`);

  // Download audio stream
  const audioStream = ytdl(youtubeUrl, {
    quality: "highestaudio",
    filter: "audioonly",
  });

  const writeStream = fs.createWriteStream(audioPath);
  audioStream.pipe(writeStream);

  return new Promise((resolve, reject) => {
    writeStream.on("finish", () => {
      resolve({
        audioPath,
        title,
        duration,
      });
    });

    writeStream.on("error", reject);
    audioStream.on("error", reject);
  });
}

export async function downloadYouTubeAudio(
  youtubeUrl: string,
  outputDir: string
): Promise<DownloadResult> {
  // Try yt-dlp first (more reliable)
  try {
    console.log("Attempting download with yt-dlp...");
    return await downloadWithYtDlp(youtubeUrl, outputDir);
  } catch (ytDlpError) {
    console.log(`yt-dlp failed: ${(ytDlpError as Error).message}`);
    console.log("Falling back to ytdl-core...");
    
    // Fallback to ytdl-core
    try {
      return await downloadWithYtdlCore(youtubeUrl, outputDir);
    } catch (ytdlError) {
      throw new Error(`Both download methods failed. yt-dlp: ${(ytDlpError as Error).message}, ytdl-core: ${(ytdlError as Error).message}`);
    }
  }
} 