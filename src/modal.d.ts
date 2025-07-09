declare module "modal" {
  interface ModalClient {
    function(name: string): ModalFunction;
  }

  interface ModalFunction {
    call(input: any): Promise<ModalRun>;
    get(runId: string): Promise<ModalStatus>;
  }

  interface ModalRun {
    id: string;
  }

  interface ModalStatus {
    status: "Pending" | "Running" | "Completed" | "Error";
    output?: any;
    error?: {
      message: string;
    };
    progress?: {
      pct: number;
      stage?: string;
    };
  }

  interface ModalConfig {
    tokenId: string;
    tokenSecret: string;
  }

  function createClient(config: ModalConfig): ModalClient;

  export default {
    createClient
  };
} 