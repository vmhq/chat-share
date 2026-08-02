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

// Rate-limit en memoria por IP para el endpoint de contraseña.
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 5 * 60_000 });
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
    if (!row) return c.body(gonePageHtml("revoked"), 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });

    const { available, status } = availability(row);
    if (!available) {
      const code = status === "expired" ? 410 : 404;
      return c.body(gonePageHtml(status === "expired" ? "expired" : "revoked"), code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
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
        createdAt: new Date(fresh.created_at).toLocaleString("es-CL"),
        locked: !!fresh.password_hash,
      }),
      200,
      { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
    );
  });

  app.post("/s/:id/unlock", async (c) => {
    const id = c.req.param("id");
    const row = getChat(id);
    if (!row) return c.text("No encontrado", 404);

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (rateLimited(ip)) {
      return c.text("Demasiados intentos, intenta de nuevo en unos minutos.", 429);
    }

    const form = await c.req.parseBody();
    const password = typeof form["password"] === "string" ? form["password"] : "";
    const ok = await checkPassword(row, password);
    if (!ok) return c.html(passwordFormHtml(id, "Contraseña incorrecta"));

    const value = sign(id, cfg.sessionSecret);
    c.header("Set-Cookie", `${cookieName(id)}=${value}; HttpOnly; Path=/s/${id}; SameSite=Lax; Max-Age=604800`);
    return c.redirect(`/s/${id}`);
  });

  return app;
}
