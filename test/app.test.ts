import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { loadConfig } from "../src/config";
import { apiRoutes } from "../src/routes/api";
import { publicRoutes } from "../src/routes/public";
import { adminRoutes } from "../src/routes/admin";
import { OidcClient, issueSession } from "../src/oidc";

// Config de test mínima
function testCfg() {
  process.env.SESSION_SECRET = "test-secret";
  process.env.AGENT_API_KEY = "testkey";
  process.env.BASE_URL = "http://test.local";
  const cfg = loadConfig();
  return cfg;
}

// Réplica del montaje real de index.ts
function buildApp() {
  const cfg = testCfg();
  const app = new Hono();
  app.route("/api", apiRoutes(cfg));
  app.route("/", publicRoutes(cfg));
  return app;
}

// Helper para generar una sesión admin válida (como la emitiría el callback OIDC).
function adminSession(cfg: ReturnType<typeof testCfg>): string {
  return issueSession(cfg, { sub: "user-123", email: "admin@test.cl", exp: Math.floor(Date.now() / 1000) + 3600 });
}

function csrfFor(cfg: ReturnType<typeof testCfg>, sub: string): string {
  return createHmac("sha256", cfg.sessionSecret).update(`csrf:${sub}`).digest("hex");
}

describe("chat-share API", () => {
  test("health sin auth", async () => {
    const app = buildApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("POST /api/chats requiere API key", async () => {
    const app = buildApp();
    const res = await app.request("/api/chats", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("crear y consultar un chat", async () => {
    const app = buildApp();
    const createRes = await app.request("/api/chats", {
      method: "POST",
      headers: {
        Authorization: "Bearer testkey",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test",
        messages: [{ role: "user", content: "hola" }],
        expires_in: "1h",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; url: string };
    expect(created.id).toBeTruthy();
    expect(created.url).toContain("/s/");

    const getRes = await app.request(`/api/chats/${created.id}`, {
      headers: { Authorization: "Bearer testkey" },
    });
    const info = (await getRes.json()) as { views: number; available: boolean };
    expect(info.views).toBe(0);
    expect(info.available).toBe(true);
  });

  test("vista pública muestra la conversación", async () => {
    const app = buildApp();
    const createRes = await app.request("/api/chats", {
      method: "POST",
      headers: {
        Authorization: "Bearer testkey",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Público",
        messages: [{ role: "assistant", content: "Hola **mundo**" }],
      }),
    });
    const { id } = (await createRes.json()) as { id: string };
    const page = await app.request(`/s/${id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<strong>mundo</strong>");
    expect(html).toContain("Público");
  });

  test("listar chats (GET /api/chats)", async () => {
    const app = buildApp();
    await app.request("/api/chats", {
      method: "POST",
      headers: { Authorization: "Bearer testkey", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Uno", messages: [{ role: "user", content: "a" }] }),
    });
    await app.request("/api/chats", {
      method: "POST",
      headers: { Authorization: "Bearer testkey", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Dos", messages: [{ role: "user", content: "b" }] }),
    });
    const res = await app.request("/api/chats", { headers: { Authorization: "Bearer testkey" } });
    expect(res.status).toBe(200);
    const list = (await res.json()) as { title: string; suspended: boolean }[];
    const titles = list.map((c) => c.title);
    expect(titles).toContain("Uno");
    expect(titles).toContain("Dos");
  });

  test("suspender y reactivar un chat", async () => {
    const app = buildApp();
    const createRes = await app.request("/api/chats", {
      method: "POST",
      headers: { Authorization: "Bearer testkey", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "S", messages: [{ role: "user", content: "x" }] }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // Activo por defecto → público
    expect((await app.request(`/s/${id}`)).status).toBe(200);

    // Suspender → deja de ser público pero sigue en la DB
    const susp = await app.request(`/api/chats/${id}/suspend`, {
      method: "POST",
      headers: { Authorization: "Bearer testkey" },
    });
    expect(susp.status).toBe(200);
    expect((await susp.json())).toMatchObject({ ok: true, suspended: true });
    expect((await app.request(`/s/${id}`)).status).toBe(404);

    // Reactivar → vuelve a estar público
    const act = await app.request(`/api/chats/${id}/activate`, {
      method: "POST",
      headers: { Authorization: "Bearer testkey" },
    });
    expect(act.status).toBe(200);
    expect((await app.request(`/s/${id}`)).status).toBe(200);
  });

  test("eliminar un chat lo borra de la DB", async () => {
    const app = buildApp();
    const createRes = await app.request("/api/chats", {
      method: "POST",
      headers: { Authorization: "Bearer testkey", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "R", messages: [{ role: "user", content: "x" }] }),
    });
    const { id } = (await createRes.json()) as { id: string };
    await app.request(`/api/chats/${id}`, { method: "DELETE", headers: { Authorization: "Bearer testkey" } });
    const page = await app.request(`/s/${id}`);
    expect(page.status).toBe(404);
    const html = await page.text();
    expect(html).toContain("eliminado");
  });
});

describe("chat-share admin (CSRF)", () => {
  function buildAdminApp() {
    const cfg = testCfg();
    const oidc = new OidcClient(cfg); // sin init(): el middleware de sesión no lo necesita
    const app = new Hono();
    app.route("/", adminRoutes(cfg, oidc)); // igual que index.ts: rutas ya incluyen /admin
    app.route("/", publicRoutes(cfg));
    return { app, cfg };
  }

  test("revocar sin token CSRF devuelve 403", async () => {
    const { app, cfg } = buildAdminApp();
    // Crear un chat vía API
    const api = new Hono();
    api.route("/api", apiRoutes(cfg));
    const createRes = await api.request("/api/chats", {
      method: "POST",
      headers: { Authorization: "Bearer testkey", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "victima", messages: [{ role: "user", content: "x" }] }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const res = await app.request(`/admin/chats/${id}/revoke`, {
      method: "POST",
      headers: { Cookie: `admin_session=${adminSession(cfg)}` },
    });
    expect(res.status).toBe(403);

    // El chat debe seguir accesible
    const page = await app.request(`/s/${id}`);
    expect(page.status).toBe(200);
  });

  test("revocar con token CSRF válido funciona", async () => {
    const { app, cfg } = buildAdminApp();
    const api = new Hono();
    api.route("/api", apiRoutes(cfg));
    const createRes = await api.request("/api/chats", {
      method: "POST",
      headers: { Authorization: "Bearer testkey", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "victima2", messages: [{ role: "user", content: "x" }] }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const body = new URLSearchParams({ _csrf: csrfFor(cfg, "user-123") });
    const res = await app.request(`/admin/chats/${id}/revoke`, {
      method: "POST",
      headers: {
        Cookie: `admin_session=${adminSession(cfg)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    expect(res.status).toBe(302);

    const page = await app.request(`/s/${id}`);
    expect(page.status).toBe(404);
  });
});
