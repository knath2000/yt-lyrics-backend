export interface ModalJobResult {
  id: string;
  status: "pending" | "running" | "completed" | "error";
  output?: any;
  error?: {
    message: string;
  };
  progress?: {
    pct: number;
    stage?: string;
  };
}

export class ModalClient {
  private appName: string;
  private functionName: string;
  private modalEndpoint: string;

  constructor(
    appName: string = "youtube-transcription",
    functionName: string = "transcribe_youtube"
  ) {
    this.appName = appName;
    this.functionName = functionName;
    // Modal function endpoint URL pattern (this will need to be updated with the actual deployed URL)
    this.modalEndpoint = `https://${appName}--${functionName}.modal.run`;
  }

  async submitJob(input: any): Promise<ModalJobResult> {
    try {
      console.log(`🚀 Calling Modal function at: ${this.modalEndpoint}`);
      
      const response = await fetch(this.modalEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        throw new Error(`Modal function call failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      return {
        id: `modal-${Date.now()}`,
        status: "completed",
        output: result
      };
    } catch (error: any) {
      console.error('❌ Modal job submission failed:', error);
      return {
        id: `modal-error-${Date.now()}`,
        status: "error",
        error: {
          message: error.message || 'Unknown Modal error'
        }
      };
    }
  }

  async getJobStatus(jobId: string): Promise<ModalJobResult> {
    // Simple status check - since we're using HTTP calls directly,
    // we assume jobs complete immediately
    return {
      id: jobId,
      status: "completed"
    };
  }
} 