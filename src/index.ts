import "dotenv/config";
import express from "express";
import cors from "cors";
import createJobsRouter from "./routes/jobs.js";
import { initializeCookieJar, setupDatabase } from "./setup.js";
import { TranscriptionWorker } from "./worker.js";
import QueueWorker from "./queue-worker.js";
import { Server } from "http";
import { cloudinary } from "./cloudinary.js";
import { pool } from "./db.js";

// Initialize the cookie jar at application startup
const cookieFilePath = initializeCookieJar();

// Database pool is imported from centralized db.ts module
// Database setup will be handled at startup to ensure connectivity
// Health check endpoint will verify connectivity

const app = express();

// CORS configuration for frontend access
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'https://vercel.app',
    'https://*.vercel.app',
    'https://youtube-lyrics-frontend.vercel.app',
    'https://yt-lyrics-backend.onrender.com',
    'https://*.onrender.com',
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// For development, use permissive CORS. For production, use specific origins
const isDevelopment = process.env.NODE_ENV !== 'production';
if (isDevelopment) {
  app.use(cors({
    origin: true,
    credentials: true,
    optionsSuccessStatus: 200,
  }));
} else {
  app.use(cors(corsOptions));
}

app.use(express.json());

// Create TranscriptionWorker instance
// Explicitly disable memory-safe mode in production to utilize full 8GB RAM server
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
const worker = new TranscriptionWorker(
  process.env.OPENAI_API_KEY || "demo-key",
  pool,
  cloudinary,
  "./temp",
  cookieFilePath,
  "htdemucs", // Use htdemucs model
  !isProduction // Disable memory-safe mode in production (false = performance mode)
);

// Create and use the jobs router, injecting the worker, database pool, and cloudinary
app.use("/api/jobs", createJobsRouter(worker, cloudinary));

// Initialize queue worker
let queueWorker: QueueWorker | null = null;

// 🆕 GRACEFUL SHUTDOWN STATE
let isShuttingDown = false;
let shutdownStartTime: number | null = null;

// 🆕 DATABASE SETUP STATE
let databaseSetupCompleted = false;

// 🆕 ENHANCED HEALTH CHECK WITH DATABASE CONNECTIVITY
app.get("/health", async (req, res) => {
  const health: any = {
    status: isShuttingDown ? "shutting_down" : "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: {
      status: "unknown",
      connected: false
    },
    ...(isShuttingDown && shutdownStartTime && {
      shutdownStartTime: new Date(shutdownStartTime).toISOString(),
      shutdownDuration: Date.now() - shutdownStartTime
    })
  };

  // Test database connectivity
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    health.database.status = "connected";
    health.database.connected = true;
    health.database.currentTime = result.rows[0].current_time;
    
    // Setup database tables if not already done (lazy initialization)
    if (!databaseSetupCompleted) {
      try {
        await setupDatabase();
        health.database.tablesSetup = true;
        databaseSetupCompleted = true;
        console.log("✅ Database setup completed via health check");
      } catch (setupError) {
        console.warn('Database setup warning:', setupError);
        health.database.tablesSetup = false;
        health.database.setupError = (setupError as Error).message;
        databaseSetupCompleted = false;
      }
    } else {
      health.database.tablesSetup = true;
    }
  } catch (dbError) {
    console.warn('Database health check failed:', dbError);
    health.database.status = "disconnected";
    health.database.connected = false;
    health.database.error = (dbError as Error).message;
    health.status = "degraded";
  }
  
  // Return appropriate status code
  let statusCode = 200;
  if (isShuttingDown) {
    statusCode = 503;
  } else if (!health.database.connected) {
    statusCode = 503; // Service unavailable if database is down
  }
  
  res.status(statusCode).json(health);
});

// 🆕 METRICS ENDPOINT FOR RENDER MONITORING
app.get("/metrics", (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    pid: process.pid,
    platform: process.platform,
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    status: isShuttingDown ? "shutting_down" : "healthy"
  };
  
  res.json(metrics);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// Initialize database and start both server and queue worker
async function startServer() {
  try {
    console.log("🔄 Setting up database...");
    await setupDatabase();
    console.log("✅ Database setup completed");
    databaseSetupCompleted = true;
  } catch (error) {
    console.warn("⚠️ Database setup failed during startup, will retry during health checks:", error);
    databaseSetupCompleted = false;
  }
  
  // Start the HTTP server
  const server: Server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Backend listening on http://0.0.0.0:${PORT}`);
    console.log(`✅ Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`✅ Process PID: ${process.pid}`);
  });
  
  // Start the queue worker
  try {
    console.log("🔄 Starting queue worker...");
    queueWorker = new QueueWorker();
    // Start queue worker in background (don't await)
    queueWorker.start().catch(error => {
      console.error("❌ Queue worker failed:", error);
    });
    console.log("✅ Queue worker started");
  } catch (error) {
    console.error("❌ Failed to start queue worker:", error);
    // Don't fail the entire startup if queue worker fails
  }
  
  return server;
}

// Start the server
let server: Server;
startServer().then(s => {
  server = s;
}).catch(error => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});

// 🆕 GRACEFUL SHUTDOWN FUNCTION
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`🔄 Received ${signal}, starting graceful shutdown...`);
  isShuttingDown = true;
  shutdownStartTime = Date.now();

  // Set up forced shutdown timeout (Railway gives ~10 seconds)
  const forceShutdownTimer = setTimeout(() => {
    console.error("⚠️ Graceful shutdown timeout, forcing exit...");
    process.exit(1);
  }, 8000); // 8 seconds to leave buffer

  try {
    // 1. Stop accepting new connections
    console.log("🔄 Stopping server from accepting new connections...");
    if (server) {
      server.close((err) => {
        if (err) {
          console.error("❌ Error closing server:", err);
        } else {
          console.log("✅ Server closed successfully");
        }
      });
    }

    // 2. Wait for existing connections to finish (with timeout)
    if (server) {
      await new Promise<void>((resolve) => {
        const checkConnections = () => {
          // @ts-ignore - accessing internal server state
          const connections = server._connections;
          if (connections === 0) {
            console.log("✅ All connections closed");
            resolve();
          } else {
            console.log(`🔄 Waiting for ${connections} connections to close...`);
            setTimeout(checkConnections, 100);
          }
        };
        
        // Start checking immediately, but also set a timeout
        checkConnections();
        setTimeout(() => {
          console.log("⚠️ Connection close timeout, proceeding with shutdown");
          resolve();
        }, 5000);
      });
    }

    // 3. Stop queue worker
    console.log("🔄 Stopping queue worker...");
    if (queueWorker) {
      queueWorker.stop();
    }

    // 4. Cleanup worker resources (since worker.cleanup() no longer takes args)
    console.log("🔄 Cleaning up TranscriptionWorker...");
    if (typeof worker.cleanup === 'function') {
      await worker.cleanup();
    }

    // 5. Clear any timers
    clearTimeout(forceShutdownTimer);

    console.log("✅ Graceful shutdown completed successfully");
    process.exit(0);

  } catch (error) {
    console.error("❌ Error during graceful shutdown:", error);
    clearTimeout(forceShutdownTimer);
    process.exit(1);
  }
}

// 🆕 SIGNAL HANDLERS FOR GRACEFUL SHUTDOWN
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 🆕 UNHANDLED ERROR HANDLERS
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// 🆕 STARTUP SUCCESS LOG
console.log("✅ Signal handlers registered successfully");
console.log("✅ Application startup complete");