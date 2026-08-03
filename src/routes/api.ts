import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppConfig } from "../config";
import {
  CreateChatSchema,
  createSharedChat,
  getChat,
  listChats,
  suspendChat,
  activateChat,
  deleteChat,
} from "../service";
import { baseUrl } from "../util";
import { rowToPublic } from "../db";

export function apiRoutes(cfg: AppConfig) {
  const app = new Hono();

  // Health público (sin auth)
  app.get("/health", (c) => c.json({ ok: true }));

  // Middleware de API key para el resto de /api/*
  app.use("*", async (c, next) => {
    const auth = c.req.header("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!cfg.agentApiKeys.includes(token)) {
      return c.json({ error: "Unauthorized: API key inválida o ausente" }, 401);
    }
    await next();
  });

  app.post("/chats", zValidator("json", CreateChatSchema), async (c) => {
    const input = c.req.valid("json");
    const result = await createSharedChat(input);
    return c.json(result, 201);
  });

  // Listar todos los chats (incluye suspendidos; los eliminados no existen).
  app.get("/chats", (c) => {
    const limitRaw = Number(c.req.query("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 100;
    const rows = listChats(limit);
    return c.json(rows.map((r) => rowToPublic(r, baseUrl())));
  });

  app.get("/chats/:id", async (c) => {
    const row = getChat(c.req.param("id"));
    if (!row) return c.json({ error: "No encontrado" }, 404);
    return c.json(rowToPublic(row, baseUrl()));
  });

  // Suspender: deja de ser público pero no se borra.
  app.post("/chats/:id/suspend", (c) => {
    const ok = suspendChat(c.req.param("id"));
    if (!ok) return c.json({ error: "No encontrado" }, 404);
    return c.json({ ok: true, id: c.req.param("id"), suspended: true });
  });

  // Reactivar: vuelve a estar público.
  app.post("/chats/:id/activate", (c) => {
    const ok = activateChat(c.req.param("id"));
    if (!ok) return c.json({ error: "No encontrado" }, 404);
    return c.json({ ok: true, id: c.req.param("id"), suspended: false });
  });

  // Eliminar: borrado físico.
  app.delete("/chats/:id", (c) => {
    const ok = deleteChat(c.req.param("id"));
    if (!ok) return c.json({ error: "No encontrado" }, 404);
    return c.json({ ok: true, id: c.req.param("id"), deleted: true });
  });

  return app;
}
