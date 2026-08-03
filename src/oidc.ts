import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppConfig } from "./config";

export interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  issuer: string;
}

export class OidcClient {
  private cfg: AppConfig;
  private discovery: OidcDiscovery | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(cfg: AppConfig) {
    this.cfg = cfg;
  }

  async init(): Promise<void> {
    if (!this.cfg.oidcIssuer) return;
    const base = this.cfg.oidcIssuer.replace(/\/+$/, "");
    const res = await fetch(`${base}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`OIDC discovery falló: ${res.status}`);
    this.discovery = (await res.json()) as OidcDiscovery;
    this.jwks = createRemoteJWKSet(new URL(this.discovery.jwks_uri), {
      timeoutDuration: 10_000,
    });
    console.log(`[oidc] Discovery OK para ${this.cfg.oidcIssuer}`);
  }

  enabled(): boolean {
    return !!this.discovery;
  }

  authorizeUrl(state: string, nonce: string): string {
    if (!this.discovery) throw new Error("OIDC no inicializado");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.oidcClientId!,
      redirect_uri: `${this.cfg.baseUrl}/admin/callback`,
      scope: "openid profile email",
      state,
      nonce,
      // PKCE: verifier en cookie, desafío aquí (S256). Secret opcional.
    });
    if (this.cfg.oidcClientSecret) params.set("client_secret", this.cfg.oidcClientSecret);
    return `${this.discovery.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * URL de cierre de sesión RP-initiated (OIDC): redirige al end_session_endpoint
   * del proveedor (PocketID) para terminar también la sesión SSO del IdP.
   * Si el proveedor no expone end_session_endpoint, devuelve null (logout solo local).
   */
  logoutUrl(postLogoutRedirectUri: string): string | null {
    if (!this.discovery?.end_session_endpoint) return null;
    const params = new URLSearchParams({
      client_id: this.cfg.oidcClientId!,
      post_logout_redirect_uri: postLogoutRedirectUri,
    });
    return `${this.discovery.end_session_endpoint}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ idToken: string; raw: unknown }> {
    if (!this.discovery) throw new Error("OIDC no inicializado");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.cfg.oidcClientId!,
      redirect_uri: `${this.cfg.baseUrl}/admin/callback`,
    });
    if (this.cfg.oidcClientSecret) body.set("client_secret", this.cfg.oidcClientSecret);
    const res = await fetch(this.discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Token exchange falló (${res.status}): ${txt}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const idToken = raw["id_token"] as string;
    if (!idToken) throw new Error("No se recibió id_token");
    return { idToken, raw };
  }

  async verifyIdToken(idToken: string, expectedNonce?: string): Promise<Record<string, unknown>> {
    if (!this.jwks) throw new Error("JWKS no inicializado");
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: this.discovery!.issuer,
      audience: this.cfg.oidcClientId!,
    });
    if (expectedNonce && payload.nonce !== expectedNonce) {
      throw new Error("nonce no coincide");
    }
    return payload;
  }

  /**
   * Valida un access token (JWT) emitido por PocketID contra sus JWKS.
   * Exige issuer y, si está configurada, la audiencia (OIDC_AUDIENCE).
   * Devuelve el payload (sub, scopes, exp, etc.) si es válido, o null si no.
   * NOTE: solo funciona si PocketID emite access tokens como JWT firmados.
   */
  async verifyAccessToken(accessToken: string): Promise<Record<string, unknown> | null> {
    if (!this.jwks || !this.discovery) return null;
    try {
      const { payload } = await jwtVerify(accessToken, this.jwks, {
        issuer: this.discovery.issuer,
        audience: this.cfg.oidcAudience ?? undefined,
      });
      if (payload.exp && payload.exp < Date.now() / 1000) return null;
      return payload;
    } catch {
      return null;
    }
  }
}

// ---------- Sesión stateless firmada ----------
export interface SessionClaims {
  sub: string;
  email?: string;
  name?: string;
  exp: number;
}

export function issueSession(cfg: AppConfig, claims: SessionClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", cfg.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(cfg: AppConfig, token: string | undefined): SessionClaims | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", cfg.sessionSecret).update(payload).digest();
  const provided = Buffer.from(sig, "base64url");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionClaims;
    if (claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
