import fetch from "node-fetch";

export interface RunPodJobResult {
  words: any[];
  srt: string;
  plain: string;
  resultUrl?: string; // Optional - may be provided if RunPod uploads to Cloudinary
}

export class RunPodClient {
  private apiKey: string;
  private endpointId: string;

  constructor(apiKey: string, endpointId: string) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
  }

  /**
   * Submit a new RunPod job. Returns requestId.
   */
  private async submitJob(input: any): Promise<string> {
    const resp = await fetch(`https://api.runpod.ai/v2/${this.endpointId}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ 
        input: {
          ...input,
          // Signal to RunPod worker to terminate after completion
          auto_terminate: true
        }
      })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`RunPod submit failed: HTTP ${resp.status} – ${text}`);
    }
    const data: any = await resp.json();
    if (!data?.id) throw new Error("RunPod submit: missing request id");
    console.log(`🚀 RunPod job submitted with ID: ${data.id}`);
    return data.id;
  }

  /** Poll job until COMPLETED or FAILED */
  private async pollJob(requestId: string, onProgress?: (pct: number, status: string) => void): Promise<any> {
    const statusUrl = `https://api.runpod.ai/v2/${this.endpointId}/status/${requestId}`;
    let lastStatus = '';
    
    while (true) {
      const resp = await fetch(statusUrl, {
        headers: { "Authorization": `Bearer ${this.apiKey}` }
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`RunPod status failed: HTTP ${resp.status} – ${text}`);
      }
      const data: any = await resp.json();
      
      // Log status changes
      if (data.status !== lastStatus) {
        console.log(`📊 RunPod job ${requestId} status: ${data.status}`);
        lastStatus = data.status;
      }
      
      if (data.status === "COMPLETED") {
        console.log(`✅ RunPod job ${requestId} completed successfully`);
        return data.output;
      }
      
      if (data.status === "FAILED") {
        const errorMsg = data.error || "RunPod job failed without specific error message";
        console.error(`❌ RunPod job ${requestId} failed: ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      if (data.status === "IN_PROGRESS" || data.status === "PROCESSING") {
        if (data?.output?.pct && onProgress) {
          onProgress(data.output.pct, data.output.status || "processing");
        }
      }
      
      // Wait 5 seconds before next poll
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  /**
   * High-level helper that runs a transcription job via RunPod and returns result in same shape as local worker.
   */
  async runTranscription(youtubeUrl: string, onProgress?: (pct: number, status: string) => void): Promise<RunPodJobResult> {
    console.log(`🎬 Starting RunPod transcription for: ${youtubeUrl}`);
    
    try {
      const requestId = await this.submitJob({ youtubeUrl });
      const output = await this.pollJob(requestId, onProgress);
      
      // Validate output structure
      if (!output || typeof output !== 'object') {
        throw new Error("RunPod returned invalid output format");
      }
      
      // Ensure required fields are present
      const result: RunPodJobResult = {
        words: output.words || [],
        srt: output.srt || "",
        plain: output.plain || "",
        resultUrl: output.resultUrl // Optional field
      };
      
      console.log(`🎉 RunPod transcription completed successfully`);
      return result;
      
    } catch (error) {
      console.error(`❌ RunPod transcription failed:`, error);
      throw error;
    }
  }
} 