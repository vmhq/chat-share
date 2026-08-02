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

  // Metadata de OAuth Protected Resource (RFC 9728): anuncia a PocketID como AS.
  // Es el endpoint de descubrimiento estándar para clientes MCP (Hermes/Claude/Codex).
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => {
    const mcpUrl = `${cfg.baseUrl}/mcp`;
    const meta: Record<string, unknown> = {
      resource: mcpUrl,
      scopes_supported: [],
      authorization_servers: cfg.oidcIssuer ? [cfg.oidcIssuer] : [],
    };
    return c.json(meta);
  });

  // MCP endpoint (stateless streamable HTTP).
  // Auth: acepta API key (AGENT_API_KEY) O access token de PocketID (OAuth).
  app.all("/mcp", async (c) => {
    const auth = c.req.header("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    // 1) API key
    if (cfg.agentApiKeys.includes(token)) {
      return handleMcpRequest(c.req.raw);
    }

    // 2) Access token OAuth emitido por PocketID (solo si OIDC está habilitado)
    if (token && cfg.oidcIssuer) {
      const payload = await oidc.verifyAccessToken(token);
      if (payload) {
        const authInfo = {
          token,
          clientId: String(payload.client_id ?? payload.sub ?? "oauth"),
          scopes: Array.isArray(payload.scope)
            ? payload.scope
            : typeof payload.scope === "string"
              ? payload.scope.split(" ")
              : [],
          expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
          extra: {
            sub: payload.sub,
            email: payload.email,
            name: payload.name,
            provider: "pocketid",
          },
        };
        return handleMcpRequest(c.req.raw, authInfo);
      }
    }

    return new Response(
      JSON.stringify({ error: "Unauthorized: se requiere una API key o un access token válido" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer resource_metadata="${cfg.baseUrl}/.well-known/oauth-protected-resource/mcp"`,
        },
      }
    );
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
