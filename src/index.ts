import "dotenv/config";
import express from "express";
import cors from "cors";
import jobsRouter from "./routes/jobs.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/jobs", jobsRouter);

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