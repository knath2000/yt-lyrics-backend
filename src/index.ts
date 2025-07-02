import "dotenv/config";
import express from "express";
import cors from "cors";
import createJobsRouter from "./routes/jobs.js"; // Import the function
import { initializeCookieJar } from "./setup.js"; // Import the new setup function
import { TranscriptionWorker } from "./worker.js"; // Import TranscriptionWorker

// Initialize the cookie jar at application startup
const cookieFilePath = initializeCookieJar();

const app = express();

// CORS configuration for frontend access
const corsOptions = {
  origin: [
    'http://localhost:3000',        // Local development (Next.js default)
    'http://localhost:3001',        // Alternative local port
    'http://127.0.0.1:3000',        // IPv4 localhost
    'https://vercel.app',           // Vercel preview deployments
    'https://*.vercel.app',         // Vercel subdomains
    'https://youtube-lyrics-frontend.vercel.app', // Production frontend (adjust as needed)
    // Add your production frontend domain here when you deploy it
  ],
  credentials: true,
  optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// For development, use permissive CORS. For production, use specific origins
const isDevelopment = process.env.NODE_ENV !== 'production';
if (isDevelopment) {
  // More permissive for development
  app.use(cors({
    origin: true, // Allow any origin in development
    credentials: true,
    optionsSuccessStatus: 200,
  }));
} else {
  app.use(cors(corsOptions));
}

app.use(express.json());

// Create TranscriptionWorker instance
const worker = new TranscriptionWorker(
  process.env.OPENAI_API_KEY || "demo-key",
  undefined, // workDir, using default
  cookieFilePath // Pass the cookie file path
);

// Create and use the jobs router, injecting the worker
app.use("/api/jobs", createJobsRouter(worker));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Use port 7860 for Hugging Face Spaces compatibility, fallback to 4000 for local dev
const PORT = process.env.PORT ? Number(process.env.PORT) : 7860;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on http://0.0.0.0:${PORT}`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
}); 