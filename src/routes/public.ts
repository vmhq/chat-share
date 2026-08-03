import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import { getChat, availability, parseMessages, checkPassword, incrementViews } from "../service";
import { chatPageHtml, passwordFormHtml, gonePageHtml } from "../views/chatPage";

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function cookieName(id: string): string {
  return `unlock_${id}`;
}

// Zona horaria de visualización (Chile continental).
const TZ = "America/Santiago";

// Rate-limit en memoria por (IP, chat) para el endpoint de contraseña.
// Clave compuesta IP|chat evita que un atacante bloquee el acceso a un chat popular.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS_ENTRIES = 10_000;
function rateLimited(ip: string, chatId: string): boolean {
  const key = `${ip}|${chatId}`;
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    // Mantener el mapa acotado: purgar entradas expiradas si crece demasiado.
    if (attempts.size > MAX_ATTEMPTS_ENTRIES) {
      for (const [k, v] of attempts) {
        if (now > v.resetAt) attempts.delete(k);
      }
    }
    attempts.set(key, { count: 1, resetAt: now + 5 * 60_000 });
    return false;
  }
  rec.count += 1;
  return rec.count > 10;
}

export function publicRoutes(cfg: AppConfig) {
  const app = new Hono();

  app.get("/s/:id", (c) => {
    const id = c.req.param("id");
    const row = getChat(id);
    if (!row) return c.body(gonePageHtml("revoked"), 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });

    const { available, status } = availability(row);
    if (!available) {
      const code = status === "expired" ? 410 : 404;
      const reason = status === "expired" ? "expired" : status === "suspended" ? "suspended" : "revoked";
      return c.body(gonePageHtml(reason), code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    }

    // Si está protegido y no hay cookie válida, pedir contraseña.
    if (row.password_hash) {
      const cookie = c.req.header("Cookie") ?? "";
      const expected = sign(id, cfg.sessionSecret);
      if (!cookie.includes(`${cookieName(id)}=${expected}`)) {
        return c.html(passwordFormHtml(id));
      }
    }

    incrementViews(id);
    const fresh = getChat(id)!;
    return c.html(
      chatPageHtml({
        id,
        title: fresh.title,
        agent: fresh.agent,
        messages: parseMessages(fresh),
        views: fresh.views,
        createdAt: new Date(fresh.created_at).toLocaleString("es-CL", { timeZone: TZ }),
        locked: !!fresh.password_hash,
      }),
      200,
      { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }
    );
  });

  app.post("/s/:id/unlock", async (c) => {
    const id = c.req.param("id");
    const row = getChat(id);
    if (!row) return c.text("No encontrado", 404);

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (rateLimited(ip, id)) {
      return c.text("Demasiados intentos, intenta de nuevo en unos minutos.", 429);
    }

    const form = await c.req.parseBody();
    const password = typeof form["password"] === "string" ? form["password"] : "";
    const ok = await checkPassword(row, password);
    if (!ok) return c.html(passwordFormHtml(id, "Contraseña incorrecta"));

    const value = sign(id, cfg.sessionSecret);
    const secure = cfg.cookieSecure ? "; Secure" : "";
    c.header("Set-Cookie", `${cookieName(id)}=${value}; HttpOnly; Path=/s/${id}; SameSite=Lax${secure}; Max-Age=604800`);
    return c.redirect(`/s/${id}`);
  });

  return app;
}
