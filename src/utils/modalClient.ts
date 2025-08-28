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
  success?: boolean;
  result?: {
    result_url: string;
    processing_method?: string;
  };
}

export interface ModalProgressUpdate {
  percentage: number;
  message: string;
  stage?: string;
}

export interface ModalJobInput {
  youtube_url: string;
  audio_url?: string | null; // Railway-downloaded audio URL (can be null)
  job_id: string;
  openai_model: string;
  download_error?: string | null; // Error from Railway download attempt
}

export class ModalClient {
  private appName: string;
  private functionName: string;
  private modalEndpoint: string;

  constructor(
    appName: string = "youtube-transcription-v3",
    functionName: string = "transcribe_youtube"
  ) {
    this.appName = appName;
    this.functionName = functionName;

    // Use environment variable if available, otherwise construct URL
    const envEndpoint = process.env.MODAL_ENDPOINT;
    if (envEndpoint) {
      this.modalEndpoint = envEndpoint;
      console.log(`[ModalClient] Using environment endpoint: ${this.modalEndpoint}`);
    } else {
      // Fallback to URL construction for backward compatibility
      const workspace = "knath2000";
      const safeAppName = appName.toLowerCase().replace(/_/g, "-");
      const safeFunctionName = functionName.toLowerCase().replace(/_/g, "-");

      // Updated URL format for the deployed web endpoint
      this.modalEndpoint = `https://${workspace}--${safeAppName}-web-endpoint.modal.run`;
      console.log(`[ModalClient] Using constructed endpoint: ${this.modalEndpoint}`);
    }
  }

  async submitJob(input: ModalJobInput, progressCallback?: (update: ModalProgressUpdate) => void): Promise<ModalJobResult> {
    try {
      console.log(`🚀 Calling Modal web endpoint at: ${this.modalEndpoint}`);
      console.log(`📋 Modal input parameters:`, {
        youtube_url: input.youtube_url,
        audio_url: input.audio_url,
        job_id: input.job_id,
        openai_model: input.openai_model,
        download_error: input.download_error
      });
      
      // Use the web endpoint for transcription
      const webEndpoint = `${this.modalEndpoint}/transcribe`;
      
      const modalPayload = {
        youtube_url: input.youtube_url,
        audio_url: input.audio_url,
        job_id: input.job_id,
        openai_model: input.openai_model,
        download_error: input.download_error,
        auto_terminate: true
      };
      
      const response = await fetch(webEndpoint, {
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
          success: false,
          error: {
            message: result.error
          }
        };
      }
      
      return {
        id: `modal-${Date.now()}`,
        status: "completed",
        success: true,
        output: result,
        result: {
          result_url: result.result_url || result.results_url,
          processing_method: result.processing_method
        }
      };
    } catch (error: any) {
      console.error('❌ Modal job submission failed:', error);
      return {
        id: `modal-error-${Date.now()}`,
        status: "error",
        success: false,
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

  async healthCheck(): Promise<{ status: string; message: string }> {
    try {
      const healthEndpoint = `${this.modalEndpoint}/health`;
      console.log(`🏥 Checking Modal health at: ${healthEndpoint}`);

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(healthEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          status: "unhealthy",
          message: `Health check failed: ${response.status} ${response.statusText}`
        };
      }

      const result = await response.json();
      return {
        status: "healthy",
        message: `Modal service healthy: ${result.service || 'unknown'}`
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return {
          status: "unhealthy",
          message: "Health check timed out after 10 seconds"
        };
      }
      return {
        status: "unhealthy",
        message: `Health check error: ${error.message}`
      };
    }
  }
}