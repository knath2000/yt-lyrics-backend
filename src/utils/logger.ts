export const logger = {
  info: (...args: any[]) => console.log("[YT-LYRICS]", ...args),
  warn: (...args: any[]) => console.warn("[YT-LYRICS]", ...args),
  error: (...args: any[]) => console.error("[YT-LYRICS]", ...args),
  runpodError: (...args: any[]) => console.error("[RUNPOD-ERROR]", ...args),
}; 