// src/db.ts
import { Pool } from "pg";
import { logger } from "./utils/logger.js";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function safeDbQuery(text: string, params?: any[]) {
  try {
    logger.info("[DB] Executing query", text.trim().split("\n").join(" "), params ? JSON.stringify(params) : "[]");
    // @ts-ignore
    return await pool.query(text, params);
  } catch (err: any) {
    logger.error("[DB] Query failed", err.message);
    throw err;
  }
}