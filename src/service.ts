import { z } from "zod";
import { db, type SharedChatRow } from "./db";
import { newId, parseExpiry, baseUrl, isExpired } from "./util";
import { hash as argonHash, verify as argonVerify } from "argon2";

// ---------- Validation ----------
const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().min(1),
  name: z.string().max(200).optional(),
  ts: z.number().int().optional(),
});

export const CreateChatSchema = z.object({
  title: z.string().min(1).max(200),
  agent: z.string().min(1).max(100).default("unknown"),
  messages: z.array(MessageSchema).min(1).max(500),
  password: z.string().min(1).max(200).optional(),
  expires_in: z
    .union([
      z.enum(["1h", "24h", "7d", "30d", "never"]),
      z.string().regex(/^\d+\s*(m|h|d)$/i, "Formato inválido"),
    ])
    .optional(),
});

export type CreateChatInput = z.infer<typeof CreateChatSchema>;
export type Message = z.infer<typeof MessageSchema>;

// ---------- Service ----------
export interface CreateResult {
  id: string;
  url: string;
  expires_at: string | null;
  password_protected: boolean;
}

export async function createSharedChat(input: CreateChatInput): Promise<CreateResult> {
  const id = newId();
  const passwordHash = input.password ? await argonHash(input.password) : null;
  const expiresAt =
    input.expires_in && input.expires_in !== "never" ? parseExpiry(input.expires_in) : null;
  const now = Date.now();

  db.run(
    `INSERT INTO shared_chats (id, title, agent, messages, password_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.agent,
      JSON.stringify(input.messages),
      passwordHash,
      expiresAt,
      now,
    ]
  );
  return {
    id,
    url: `${baseUrl()}/s/${id}`,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    password_protected: !!passwordHash,
  };
}

export function getChat(id: string): SharedChatRow | null {
  return db.query("SELECT * FROM shared_chats WHERE id = ?").get(id) as SharedChatRow | null;
}

export function listChats(limit = 100): SharedChatRow[] {
  return db
    .query("SELECT * FROM shared_chats ORDER BY created_at DESC LIMIT ?")
    .all(limit) as SharedChatRow[];
}

export function revokeChat(id: string): boolean {
  const r = db.run("UPDATE shared_chats SET revoked = 1 WHERE id = ?", [id]);
  return r.changes > 0;
}

export function incrementViews(id: string): void {
  db.run(
    "UPDATE shared_chats SET views = views + 1, last_viewed_at = ? WHERE id = ?",
    [Date.now(), id]
  );
}

export function availability(r: SharedChatRow): {
  available: boolean;
  status: "active" | "expired" | "revoked";
} {
  if (r.revoked) return { available: false, status: "revoked" };
  if (isExpired(r.expires_at)) return { available: false, status: "expired" };
  return { available: true, status: "active" };
}

export async function checkPassword(r: SharedChatRow, candidate: string): Promise<boolean> {
  if (!r.password_hash) return true;
  return argonVerify(r.password_hash, candidate);
}

export function parseMessages(r: SharedChatRow): Message[] {
  try {
    return JSON.parse(r.messages) as Message[];
  } catch {
    return [];
  }
}
