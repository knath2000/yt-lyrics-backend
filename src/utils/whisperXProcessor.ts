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
    // Save transcription text to a temporary file
    const tempTxtPath = `${audioPath}.txt`;
    fs.writeFileSync(tempTxtPath, transcriptionText);

    return new Promise((resolve, reject) => {
      // Command to run whisperx for forced alignment
      // Using --output_dir to specify where to save the JSON output
      // Using --output_format json to get JSON output
      // Using --align_model Basic for a simple alignment model
      const whisperXProcess = spawn("whisperx", [
        "align", // Use the align subcommand
        "--audio", audioPath,
        "--transcript", tempTxtPath, // Pass the transcription text file
        "--compute_type", "float16", // Use float16 for better performance on CPU
        "--output_dir", path.dirname(audioPath),
        "--output_format", "json",
        "--model", "base", // Use a base model for alignment
        "--align_model", "Wav2Vec2-Large-v2", // Specify an alignment model
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
        fs.unlinkSync(tempTxtPath);

        if (code !== 0) {
          console.error(`WhisperX process exited with code ${code}`);
          console.error(`WhisperX stdout: ${stdout}`);
          console.error(`WhisperX stderr: ${stderr}`);
          return reject(new Error(`WhisperX alignment failed: ${stderr || stdout}`));
        }

        try {
          // WhisperX outputs a JSON file with the same name as the audio file
          const jsonOutputPath = path.join(path.dirname(audioPath), `${path.basename(audioPath).split(".")[0]}.json`);
          const result = JSON.parse(fs.readFileSync(jsonOutputPath, "utf8"));
          
          // Clean up the generated JSON file
          fs.unlinkSync(jsonOutputPath);

          if (result && result.word_segments) {
            const words: TranscriptionWord[] = result.word_segments.map((segment: any) => ({
              word: segment.word,
              start: segment.start,
              end: segment.end,
            }));
            resolve(words);
          } else {
            reject(new Error("WhisperX output did not contain word_segments."));
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse WhisperX output: ${parseError}`));
        }
      });
    });
  }
}