import { customAlphabet } from "nanoid";

// URL-safe, no look-alikes
const nano = customAlphabet("23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ", 12);
export const newId = () => nano();

// Una sola fuente de verdad: loadConfig() lo setea desde BASE_URL.
let configuredBaseUrl: string = "http://localhost:3000";
export function setBaseUrl(url: string): void {
  configuredBaseUrl = url.replace(/\/+$/, "");
}
export function baseUrl(): string {
  return configuredBaseUrl;
}

export function parseExpiry(input?: string | null): number | null {
  if (!input) return null;
  const now = Date.now();
  const m = /^(\d+)\s*(m|h|d)$/i.exec(input.trim());
  if (!m || !m[1] || !m[2]) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
  return now + ms;
}

export function isExpired(expiresAt: number | null, now: number = Date.now()): boolean {
  return expiresAt !== null && now > expiresAt;
}

export const EXPIRY_PRESETS: Record<string, number | null> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  never: null,
};
