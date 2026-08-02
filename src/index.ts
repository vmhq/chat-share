import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { apiRoutes } from "./routes/api";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { handleMcpRequest } from "./mcp";
import { OidcClient } from "./oidc";
import { baseUrl } from "./util";

async function main() {
  const cfg = loadConfig();
  const oidc = new OidcClient(cfg);

  const app = new Hono();

  app.get("/", (c) =>
    c.html(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>chat-share</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:dark}body{margin:0;background:#0f1115;color:#e6e6e6;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
.card{max-width:480px;padding:32px}.logo{font-size:2.5rem}h1{margin:8px 0}p{color:#8b93a1}a{color:#7aa2ff;text-decoration:none}
</style></head><body><div class="card"><div class="logo">💬</div><h1>chat-share</h1>
<p>Comparte conversaciones de agentes de IA mediante enlaces públicos. Autoalojado.</p>
${cfg.oidcIssuer ? `<p><a href="/admin">Panel de administración</a></p>` : ""}
<p class="dim" style="color:#5b6270;font-size:.8rem">chat-share · self-hosted</p></div></body></html>`)
  );

  app.route("/api", apiRoutes(cfg));
  app.route("/", publicRoutes(cfg));
  app.route("/", adminRoutes(cfg, oidc));

  // MCP endpoint (stateless streamable HTTP), protegido por API key.
  app.all("/mcp", async (c) => {
    const auth = c.req.header("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!cfg.agentApiKeys.includes(token)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handleMcpRequest(c.req.raw);
  });

  if (cfg.oidcIssuer) {
    try {
      await oidc.init();
    } catch (e) {
      console.error("[startup] Falló la inicialización OIDC:", e);
      process.exit(1);
    }
  }

  console.log(`[chat-share] Servidor escuchando en http://localhost:${cfg.port}`);
  console.log(`[chat-share] URL pública base: ${baseUrl()}`);
  console.log(`[chat-share] Panel admin: ${cfg.oidcIssuer ? "habilitado (OIDC)" : "DESHABILITADO (faltan OIDC_ISSUER/OIDC_CLIENT_ID)"}`);

  serve({ fetch: app.fetch, port: cfg.port });
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
