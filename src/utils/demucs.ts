import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface AudioBackendInfo {
  available: boolean;
  backends: string[];
  recommendations: string[];
}

export interface DemucsResult {
  vocalsPath: string;
  instrumentalsPath: string;
}

export class DemucsProcessor {
  private defaultModel: string | null;
  private memorySafeMode: boolean;
  private segmentLength: number;

  constructor(
    defaultModel: string | null = "demucs_v2", // Use lightweight model for Railway
    memorySafeMode: boolean = true, // Enable memory-safe mode by default
    segmentLength: number = 15 // Process in 15-second chunks
  ) {
    this.defaultModel = defaultModel;
    this.memorySafeMode = memorySafeMode;
    this.segmentLength = segmentLength;
  }

  /**
   * Check if processor is in memory-safe mode
   */
  isMemorySafe(): boolean {
    return this.memorySafeMode;
  }
  private async checkAudioBackends(): Promise<AudioBackendInfo> {
    const info: AudioBackendInfo = {
      available: false,
      backends: [],
      recommendations: []
    };

    try {
      // Check if soundfile is available (most reliable backend)
      const { stdout } = await execAsync('python3 -c "import soundfile; print(soundfile.__version__)"', { timeout: 5000 });
      if (stdout.trim()) {
        info.backends.push('soundfile');
        info.available = true;
      }
    } catch (e) {
      info.recommendations.push('Install soundfile: pip3 install soundfile');
    }

    try {
      // Check if librosa is available (fallback backend)
      const { stdout } = await execAsync('python3 -c "import librosa; print(librosa.__version__)"', { timeout: 5000 });
      if (stdout.trim()) {
        info.backends.push('librosa');
        info.available = true;
      }
    } catch (e) {
      info.recommendations.push('Install librosa: pip3 install librosa');
    }

    return info;
  }

  private async runDemucs(input: string, outputDir: string): Promise<void> {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Check audio backends first
    const backendInfo = await this.checkAudioBackends();
    if (!backendInfo.available) {
      throw new Error(
        `Audio backend not available for Demucs. Please install required libraries:\n${backendInfo.recommendations.join('\n')}`
      );
    }

    // Railway-optimized Demucs options for 1GB RAM limit
    const cmdParts = [
      '--two-stems=vocals',
      '--mp3',  // Use MP3 output format (more compatible)
      '--device=cpu',  // Force CPU to avoid CUDA issues
      '-o', `"${outputDir}"`,
    ];

    // Memory optimization parameters for Railway deployment
    if (this.memorySafeMode) {
      cmdParts.push('--segment', this.segmentLength.toString()); // Process in chunks
      cmdParts.push('--overlap', '0.1'); // Reduce overlap from default 0.25 to 0.1
      cmdParts.push('--shifts', '0'); // Disable ensemble averaging to save memory
      console.log(`Memory-safe mode enabled: ${this.segmentLength}s segments, 0.1 overlap, no shifts`);
    }

    // Use lightweight model optimized for memory constraints
    if (this.defaultModel) {
      cmdParts.unshift('-n', this.defaultModel);
    } else {
      // Fallback to demucs_v2 if no model specified
      cmdParts.unshift('-n', 'demucs_v2');
    }

    const cmdString = `demucs ${cmdParts.join(' ')} "${input}"`;

    console.log(`Running Demucs with command: ${cmdString}`);
    console.log(`Available audio backends: ${backendInfo.backends.join(', ')}`);

    try {
      const { stdout, stderr } = await execAsync(cmdString, { 
        maxBuffer: 1024 * 1024 * 10,
        env: {
          ...process.env,
          // Set environment variables for better audio backend compatibility
          TORCHAUDIO_BACKEND: 'soundfile',
          LIBROSA_CACHE_DIR: path.join(outputDir, '.librosa_cache')
        }
      });
      
      if (stderr && stderr.includes('RuntimeError')) {
        console.warn('Demucs stderr:', stderr);
      }
      if (stdout) {
        console.log('Demucs stdout:', stdout);
      }
    } catch (error: any) {
      // Enhanced error handling for audio backend issues
      if (error.message.includes('backend to handle uri') || 
          error.message.includes('torchaudio') ||
          error.message.includes('soundfile')) {
        throw new Error(
          `Audio backend error in Demucs. Try installing additional audio libraries:\n` +
          `pip3 install soundfile librosa\n` +
          `Original error: ${error.message}`
        );
      }
      throw error;
    }
  }
  
  async separateVocals(audioPath: string, outputDir: string): Promise<DemucsResult> {
    const inputExists = fs.existsSync(audioPath);
    if (!inputExists) {
      throw new Error(`Audio file not found for Demucs: ${audioPath}`);
    }

    // Run Demucs
    await this.runDemucs(audioPath, outputDir);

    // Demucs will create outputDir/<model>/<basename>/vocals.wav etc.
    const base = path.parse(audioPath).name;
    // Find the created subdirectory recursively
    const candidates: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (stat.isFile()) {
          if ((entry.toLowerCase() === "vocals.wav" || entry.toLowerCase() === "vocals.mp3") && full.includes(base)) {
            candidates.push(full);
          }
        }
      }
    };
    walk(outputDir);

    if (candidates.length === 0) {
      throw new Error("Demucs finished but vocals file not found");
    }
    const vocalsPath = candidates[0];
    const vocalsDir = path.dirname(vocalsPath);
    
    // Look for instrumentals file (no_vocals.wav/mp3 or other.wav/mp3)
    const possibleInstrumentals = [
      path.join(vocalsDir, "no_vocals.wav"),
      path.join(vocalsDir, "no_vocals.mp3"),
      path.join(vocalsDir, "other.wav"),
      path.join(vocalsDir, "other.mp3")
    ];
    
    let instrumentalsPath = vocalsPath; // fallback to vocals if no instrumentals found
    for (const candidate of possibleInstrumentals) {
      if (fs.existsSync(candidate)) {
        instrumentalsPath = candidate;
        break;
      }
    }

    return {
      vocalsPath,
      instrumentalsPath,
    };
  }

  async isDemucsAvailable(): Promise<boolean> {
    try {
      await execAsync("demucs --help", { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}