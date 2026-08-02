import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? "./data/chat-share.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS shared_chats (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  agent         TEXT NOT NULL DEFAULT 'unknown',
  messages      TEXT NOT NULL,          -- JSON array of {role, content, name?, ts?}
  password_hash TEXT,                   -- argon2 hash, null = public
  expires_at    INTEGER,                -- unix epoch ms, null = never
  views         INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_viewed_at INTEGER,
  revoked       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shared_created ON shared_chats(created_at DESC);
`);

export interface SharedChatRow {
  id: string;
  title: string;
  agent: string;
  messages: string; // JSON
  password_hash: string | null;
  expires_at: number | null;
  views: number;
  created_at: number;
  last_viewed_at: number | null;
  revoked: 0 | 1;
}

export function rowToPublic(r: SharedChatRow, baseUrl: string) {
  const expired = r.expires_at !== null && Date.now() > r.expires_at;
  const available = !r.revoked && !expired;
  return {
    id: r.id,
    url: `${baseUrl}/s/${r.id}`,
    title: r.title,
    agent: r.agent,
    views: r.views,
    created_at: new Date(r.created_at).toISOString(),
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    expired,
    revoked: !!r.revoked,
    available,
    password_protected: !!r.password_hash,
  };
}
