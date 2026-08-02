import { Hono } from "hono";
import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "../config";
import { OidcClient, issueSession, verifySession, randomToken, type SessionClaims } from "../oidc";
import { listChats, revokeChat } from "../service";
import { buildRows, adminPageHtml } from "../views/adminPage";
import { baseUrl } from "../util";

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
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
    return c.html(adminPageHtml(rows, claims.email ?? claims.sub, baseUrl()));
  });

  app.post("/admin/chats/:id/revoke", (c) => {
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
      cookie("oidc_state=" + state, 600),
      cookie("oidc_nonce=" + nonce, 600),
      cookie("pkce_verifier=" + verifier, 600),
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
    if (!state || !storedState || !cryptoVerifyStrings(state, storedState, cfg.sessionSecret)) {
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
    c.header("Set-Cookie", cookie(`${SESSION_COOKIE}=${token}`, 8 * 3600));
    return c.redirect("/admin");
  });

  // ---------- Logout ----------
  app.get("/admin/logout", (c) => {
    c.header("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    return c.redirect("/admin/login");
  });

  return app;
}

// ---------- Helpers ----------
function getCookie(header: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header);
  return m ? m[1] : undefined;
}

function cookie(nameValue: string, maxAgeSeconds = 3600): string {
  return `${nameValue}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function cryptoVerifyStrings(a: string, b: string, secret: string): boolean {
  // Firma HMAC sobre ambos para comparación de igualdad
  const ha = createHash("sha256").update(a + secret).digest("hex");
  const hb = createHash("sha256").update(b + secret).digest("hex");
  return ha === hb;
}
