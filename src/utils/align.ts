import { TranscriptionWord, TranscriptionResult } from "./openaiTranscriber.js";

export interface AlignedWord extends TranscriptionWord {}

export interface AlignmentResult {
  words: AlignedWord[];
  srt: string;
  plain: string;
}

export class WordAligner {
  
  async alignWords(transcription: TranscriptionResult): Promise<AlignmentResult> {
    // For now, use the Whisper timestamps as-is
    // TODO: Implement WhisperX or StableTS for better forced alignment
    const alignedWords: AlignedWord[] = transcription.words.map((word) => ({
      ...word,
      
    }));

    const srt = this.generateSRT(alignedWords);
    const plain = transcription.text;

    return {
      words: alignedWords,
      srt,
      plain,
    };
  }

  private generateSRT(words: AlignedWord[]): string {
    let srt = "";
    let subtitleIndex = 1;
    
    // Group words into subtitle chunks (every 10 words or 5 seconds)
    const chunks: AlignedWord[][] = [];
    let currentChunk: AlignedWord[] = [];
    let chunkStartTime = 0;

    for (const word of words) {
      if (currentChunk.length === 0) {
        chunkStartTime = word.start;
      }

      currentChunk.push(word);

      // Create new chunk if we have 10 words or 5 seconds have passed
      if (currentChunk.length >= 10 || (word.end - chunkStartTime) >= 5) {
        chunks.push([...currentChunk]);
        currentChunk = [];
      }
    }

    // Add remaining words
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    // Generate SRT format
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;

      const startTime = this.formatSRTTime(chunk[0].start);
      const endTime = this.formatSRTTime(chunk[chunk.length - 1].end);
      const text = chunk.map(w => w.word).join(" ");

      srt += `${subtitleIndex}\n`;
      srt += `${startTime} --> ${endTime}\n`;
      srt += `${text}\n\n`;
      subtitleIndex++;
    }

    return srt;
  }

  private formatSRTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
      .toString()
      .padStart(3, "0")}`;
  }
} 