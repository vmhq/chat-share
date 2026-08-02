import { Hono } from "hono";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import { OidcClient, issueSession, verifySession, randomToken, type SessionClaims } from "../oidc";
import { listChats, revokeChat } from "../service";
import { buildRows, adminPageHtml } from "../views/adminPage";
import { baseUrl } from "../util";

// Token CSRF stateless: HMAC(sessionSecret, sub) — derivado de la sesión, sin estado extra.
function csrfToken(cfg: AppConfig, sub: string): string {
  return createHmac("sha256", cfg.sessionSecret).update(`csrf:${sub}`).digest("hex");
}

function verifyCsrf(cfg: AppConfig, sub: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = csrfToken(cfg, sub);
  return cryptoVerifyStrings(token, expected);
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url").replace(/=+$/, "");
  return { verifier, challenge };
}

const SESSION_COOKIE = "admin_session";

type Vars = { adminUser: SessionClaims };

export function adminRoutes(cfg: AppConfig, oidc: OidcClient) {
  const app = new Hono<{ Variables: Vars }>();

  // Middleware: exige sesión válida en /admin/* salvo login/callback/logout
  app.use("/admin/*", async (c, next) => {
    const path = c.req.path;
    if (path === "/admin/login" || path === "/admin/callback" || path === "/admin/logout") {
      return next();
    }
    const cookie = c.req.header("Cookie") ?? "";
    const token = getCookie(cookie, SESSION_COOKIE);
    const claims = verifySession(cfg, token);
    if (!claims) return c.redirect("/admin/login");
    if (cfg.adminAllowedSubs && !cfg.adminAllowedSubs.includes(claims.sub)) {
      return c.text("Acceso denegado: tu cuenta no está autorizada para el panel admin.", 403);
    }
    c.set("adminUser", claims);
    await next();
  });

  app.get("/admin", (c) => {
    const claims = c.get("adminUser") as SessionClaims;
    const rows = buildRows(listChats());
    return c.html(adminPageHtml(rows, claims.email ?? claims.sub, baseUrl(), csrfToken(cfg, claims.sub)));
  });

  app.post("/admin/chats/:id/revoke", async (c) => {
    const claims = c.get("adminUser") as SessionClaims;
    // CSRF: requiere el token derivado de la sesión en el body del formulario.
    const form = await c.req.parseBody();
    const token = typeof form["_csrf"] === "string" ? form["_csrf"] : undefined;
    if (!verifyCsrf(cfg, claims.sub, token)) {
      return c.text("Token CSRF inválido. Recarga la página e intenta de nuevo.", 403);
    }
    const id = c.req.param("id");
    revokeChat(id);
    return c.redirect("/admin");
  });

  // ---------- Login ----------
  app.get("/admin/login", (c) => {
    if (!oidc.enabled()) {
      return c.text("El panel admin no está habilitado: faltan variables OIDC_ISSUER/OIDC_CLIENT_ID.", 503);
    }
    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = pkcePair();
    const authUrl = oidc.authorizeUrl(state, nonce);
    // Guardamos state/nonce/verifier en cookies HttpOnly.
    const cookies = [
      cookie(cfg, "oidc_state=" + state, 600),
      cookie(cfg, "oidc_nonce=" + nonce, 600),
      cookie(cfg, "pkce_verifier=" + verifier, 600),
    ];
    c.header("Set-Cookie", cookies.join("; "));
    return c.redirect(authUrl);
  });

  // ---------- Callback ----------
  app.get("/admin/callback", async (c) => {
    const cookieHeader = c.req.header("Cookie") ?? "";
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!code) return c.text("Falta el parámetro code.", 400);

    const storedState = getCookie(cookieHeader, "oidc_state");
    if (!state || !storedState || !cryptoVerifyStrings(state, storedState)) {
      return c.text("Estado OIDC inválido.", 400);
    }

    const verifier = getCookie(cookieHeader, "pkce_verifier");
    const nonce = getCookie(cookieHeader, "oidc_nonce");

    let claims: Record<string, unknown>;
    try {
      const { idToken } = await oidc.exchangeCode(code);
      claims = await oidc.verifyIdToken(idToken, nonce);
    } catch (e) {
      console.error("[admin] callback error:", e);
      return c.text("Falló la autenticación con el proveedor.", 500);
    }

    const session: SessionClaims = {
      sub: String(claims.sub),
      email: typeof claims.email === "string" ? claims.email : undefined,
      name: typeof claims.name === "string" ? claims.name : undefined,
      exp: Math.floor(Date.now() / 1000) + 8 * 3600, // 8h
    };

    const token = issueSession(cfg, session);
    c.header("Set-Cookie", cookie(cfg, `${SESSION_COOKIE}=${token}`, 8 * 3600, "/admin"));
    return c.redirect("/admin");
  });

  // ---------- Logout ----------
  app.get("/admin/logout", (c) => {
    const secure = cfg.cookieSecure ? "; Secure" : "";
    c.header("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/admin; SameSite=Lax${secure}; Max-Age=0`);
    return c.redirect("/admin/login");
  });

  return app;
}

// ---------- Helpers ----------
function getCookie(header: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header);
  return m ? m[1] : undefined;
}

function cookie(cfg: AppConfig, nameValue: string, maxAgeSeconds: number, path = "/"): string {
  const secure = cfg.cookieSecure ? "; Secure" : "";
  return `${nameValue}; HttpOnly; Path=${path}; SameSite=Lax${secure}; Max-Age=${maxAgeSeconds}`;
}

function cryptoVerifyStrings(a: string, b: string): boolean {
  // Comparación en tiempo constante de dos strings
  const ha = Buffer.from(a);
  const hb = Buffer.from(b);
  if (ha.length !== hb.length) return false;
  return timingSafeEqual(ha, hb);
}
