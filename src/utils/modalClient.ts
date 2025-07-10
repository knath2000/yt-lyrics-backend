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

    // Modal endpoint URL format: https://<workspace>--<app-name>-<function-name>.modal.run
    // The workspace should be the actual Modal workspace (knath2000), not the app name

    const safeAppName = appName.toLowerCase().replace(/_/g, "-");
    const safeFunctionName = functionName.toLowerCase().replace(/_/g, "-");

    // Use the correct workspace name - knath2000, not the app name
    const workspace = "knath2000";
    
    // Combine app + function into single label part per Modal docs
    const label = `${safeAppName}-${safeFunctionName}`;

    this.modalEndpoint = `https://${workspace}--${label}.modal.run`;
  }

  async submitJob(input: any): Promise<ModalJobResult> {
    try {
      console.log(`🚀 Calling Modal function at: ${this.modalEndpoint}`);
      
      // Modal functions expect parameters as top-level properties in the JSON body
      const modalPayload = {
        youtube_url: input.youtube_url,
        auto_terminate: true
      };
      
      const response = await fetch(this.modalEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(modalPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Modal function call failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      
      // Check if the result contains an error
      if (result.error) {
        return {
          id: `modal-error-${Date.now()}`,
          status: "error",
          error: {
            message: result.error
          }
        };
      }
      
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