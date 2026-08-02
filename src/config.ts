export interface AppConfig {
  port: number;
  baseUrl: string;
  dbPath: string;
  agentApiKeys: string[];
  sessionSecret: string;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  oidcClientSecret: string | null;
  adminAllowedSubs: string[] | null;
}

export function loadConfig(): AppConfig {
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  const missing: string[] = [];
  if (!sessionSecret) missing.push("SESSION_SECRET");
  if (!process.env.AGENT_API_KEY) missing.push("AGENT_API_KEY");

  const oidcIssuer = process.env.OIDC_ISSUER?.trim() || null;
  const oidcClientId = process.env.OIDC_CLIENT_ID?.trim() || null;
  const adminAllowedSubs = process.env.ADMIN_ALLOWED_SUBS
    ? process.env.ADMIN_ALLOWED_SUBS.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // OIDC requiere ISSUER + CLIENT_ID juntos. CLIENT_SECRET opcional (public clients / PKCE).
  if (oidcIssuer && !oidcClientId) missing.push("OIDC_CLIENT_ID");
  if (oidcClientId && !oidcIssuer) missing.push("OIDC_ISSUER");

  if (missing.length > 0) {
    console.error(`[config] Faltan variables de entorno: ${missing.join(", ")}`);
    process.exit(1);
  }

  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    baseUrl: (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    dbPath: process.env.DB_PATH ?? "./data/chat-share.db",
    agentApiKeys: process.env.AGENT_API_KEY!.split(",").map((k) => k.trim()).filter(Boolean),
    sessionSecret,
    oidcIssuer,
    oidcClientId,
    oidcClientSecret: process.env.OIDC_CLIENT_SECRET?.trim() || null,
    adminAllowedSubs,
  };
}
