import fetch from "node-fetch";

export interface RunPodJobResult {
  words: any[];
  srt: string;
  plain: string;
  resultUrl: string;
}

export class RunPodClient {
  private apiKey: string;
  private endpointId: string;

  constructor(apiKey: string, endpointId: string) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
  }

  /**
   * Submit a neww RunPod job. Returns requestId.
   */
  private async submitJob(input: any): Promise<string> {
    const resp = await fetch(`https://api.runpod.ai/v2/${this.endpointId}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ input })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`RunPod submit failed: HTTP ${resp.status} – ${text}`);
    }
    const data: any = await resp.json();
    if (!data?.id) throw new Error("RunPod submit: missing request id");
    return data.id;
  }

  /** Poll job until COMPLETED or FAILED */
  private async pollJob(requestId: string, onProgress?: (pct: number, status: string) => void): Promise<any> {
    const statusUrl = `https://api.runpod.ai/v2/${this.endpointId}/status/${requestId}`;
    while (true) {
      const resp = await fetch(statusUrl, {
        headers: { "Authorization": `Bearer ${this.apiKey}` }
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`RunPod status failed: HTTP ${resp.status} – ${text}`);
      }
      const data: any = await resp.json();
      if (data.status === "COMPLETED") return data.output;
      if (data.status === "FAILED") throw new Error(data.error || "RunPod job failed");
      if (data.status === "IN_PROGRESS" || data.status === "PROCESSING") {
        if (data?.output?.pct && onProgress) onProgress(data.output.pct, data.output.status || "processing");
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  /**
   * High-level helper that runs a transcription job via RunPod and returns result in same shape as local worker.
   */
  async runTranscription(youtubeUrl: string, onProgress?: (pct: number, status: string) => void): Promise<RunPodJobResult> {
    const requestId = await this.submitJob({ youtubeUrl });
    const output = await this.pollJob(requestId, onProgress);
    return output as RunPodJobResult;
  }
} 