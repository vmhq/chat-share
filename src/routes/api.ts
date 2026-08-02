import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppConfig } from "../config";
import { CreateChatSchema, createSharedChat, getChat, revokeChat } from "../service";
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

  app.get("/chats/:id", async (c) => {
    const row = getChat(c.req.param("id"));
    if (!row) return c.json({ error: "No encontrado" }, 404);
    return c.json(rowToPublic(row, baseUrl()));
  });

  app.delete("/chats/:id", async (c) => {
    const ok = revokeChat(c.req.param("id"));
    if (!ok) return c.json({ error: "No encontrado" }, 404);
    return c.json({ ok: true, id: c.req.param("id"), revoked: true });
  });

  return app;
}
