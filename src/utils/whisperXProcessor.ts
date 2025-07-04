import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

export class WhisperXProcessor {
  async alignAudio(audioPath: string, transcriptionText: string): Promise<TranscriptionWord[]> {
    // Save transcription texts to a temporary file for reference
    const tempTxtPath = `${audioPath}.txt`;
    fs.writeFileSync(tempTxtPath, transcriptionText);

    return new Promise((resolve, reject) => {
      // Modern WhisperX CLI: whisperx audio_file [options]
      // No subcommands like "align", just direct audio processing with alignment
      const whisperXProcess = spawn("whisperx", [
        audioPath,                              // Audio file as positional argument
        "--compute_type", "float16",            // Use float16 for better performance
        "--output_dir", path.dirname(audioPath),
        "--output_format", "json",
        "--model", "base",                      // Whisper model for transcription
        "--align_model", "WAV2VEC2_ASR_BASE_960H", // Wav2Vec2 model for alignment
        "--interpolate_method", "linear",       // Interpolation method for alignment
        "--chunk_size", "30",                   // Process in 30-second chunks
      ]);

      let stdout = "";
      let stderr = "";

      whisperXProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      whisperXProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      whisperXProcess.on("close", (code) => {
        // Clean up temporary text file
        try {
          fs.unlinkSync(tempTxtPath);
        } catch (e) {
          console.warn("Could not clean up temp file:", e);
        }

        if (code !== 0) {
          console.error(`WhisperX process exited with code ${code}`);
          console.error(`WhisperX stdout: ${stdout}`);
          console.error(`WhisperX stderr: ${stderr}`);
          return reject(new Error(`WhisperX alignment failed: ${stderr || stdout}`));
        }

        try {
          // WhisperX outputs a JSON file with the same name as the audio file
          const baseName = path.basename(audioPath, path.extname(audioPath));
          const jsonOutputPath = path.join(path.dirname(audioPath), `${baseName}.json`);
          
          if (!fs.existsSync(jsonOutputPath)) {
            return reject(new Error(`WhisperX output file not found: ${jsonOutputPath}`));
          }
          
          const result = JSON.parse(fs.readFileSync(jsonOutputPath, "utf8"));
          
          // Clean up the generated JSON file
          try {
            fs.unlinkSync(jsonOutputPath);
          } catch (e) {
            console.warn("Could not clean up JSON output file:", e);
          }

          // Modern WhisperX outputs segments with word-level timestamps
          if (result && result.segments) {
            const words: TranscriptionWord[] = [];
            
            for (const segment of result.segments) {
              if (segment.words) {
                for (const word of segment.words) {
                  words.push({
                    word: word.word || word.text,
                    start: word.start,
                    end: word.end,
                  });
                }
              }
            }
            
            if (words.length > 0) {
              resolve(words);
            } else {
              reject(new Error("WhisperX output contained no word-level timestamps."));
            }
          } else {
            reject(new Error("WhisperX output format not recognized - missing segments."));
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse WhisperX output: ${parseError}`));
        }
      });
    });
  }
}