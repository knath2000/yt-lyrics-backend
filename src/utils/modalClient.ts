import modal from "modal";

// Simplified error type mirroring previous RunPodUnhealthyError semantics.
export class ModalUnhealthyError extends Error {
  constructor(public requestId: string, message?: string) {
    super(message);
    this.name = "ModalUnhealthyError";
  }
}

/**
 * Wrapper around Modal JS SDK exposing the same methods our QueueWorker expects
 * (runTranscription, cancelJob, purgeQueue). Only runTranscription is fully
 * implemented; cancel/purge are no-ops because Modal auto-cleans functions.
 */
export class ModalClient {
  private client;
  private fn;

  constructor(tokenId: string, tokenSecret: string, appName = "yt-lyrics-transcribe") {
    this.client = modal.createClient({ tokenId, tokenSecret });
    // Fully-qualified function name: <appName>.transcribe_audio
    this.fn = this.client.function(`${appName}.transcribe_audio`);
  }

  /**
   * Kicks off transcription on Modal and waits until completion.
   * A progress callback is invoked whenever we receive a status update.
   */
  async runTranscription(
    youtubeUrl: string,
    onProgress?: (pct: number, status: string) => void
  ): Promise<{ resultUrl?: string; [key: string]: any }> {
    const run = await this.fn.call({ youtube_url: youtubeUrl });

    // Poll until Modal run finishes
    while (true) {
      const status = await this.fn.get(run.id);
      if (status.status === "Completed") {
        // Modal functions return their value directly in .output
        return status.output as any;
      }
      if (status.status === "Error") {
        throw new ModalUnhealthyError(run.id, status.error?.message);
      }
      if (onProgress && typeof status.progress?.pct === "number") {
        onProgress(status.progress.pct, status.progress.stage || status.status);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Modal auto-cancels; keep for interface symmetry
  async cancelJob(_id: string) {
    /* no-op */
  }
  async purgeQueue() {
    /* no-op */
  }
} 