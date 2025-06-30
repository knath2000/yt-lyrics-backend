# System Patterns - Backend

## Architecture
```
Client (Next.js) ──HTTP──► Express Router (/api/jobs)
                    │
                    ▼
          TranscriptionWorker
   ┌──────────────┬─────────────┬───────────────┐
   │ download.ts  │ demucs.ts   │ whisper.ts    │
   └──────────────┴─────────────┴───────────────┘
                    │
                    ▼
           WordAligner (align.ts)
                    │
                    ▼
               temp/<jobId>/
```

## Key Technical Decisions
- Typed with TypeScript, ES modules (`"type": "module"`).
- Development server uses `tsx watch` for fast reloads.
- Processing is CPU-heavy; kept synchronous within worker for now (future: move to queue).

## Component Relationships
- `routes/jobs.ts` orchestrates job lifecycle and delegates to `TranscriptionWorker`.
- Worker orchestrates util helpers — single-responsibility per file. 