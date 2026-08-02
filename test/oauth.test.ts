import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { OidcClient } from "../src/oidc";
import { handleMcpRequest } from "../src/mcp";
import { apiRoutes } from "../src/routes/api";
import { publicRoutes } from "../src/routes/public";

const MOCK_PORT = 3998;
const MOCK_ISSUER = `http://localhost:${MOCK_PORT}`;
const APP_PORT = 3997;

let mock: Subprocess;

function startMockOidc(): Subprocess {
  const p = spawn(["bun", "run", "test/mock-oidc.ts", String(MOCK_PORT)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return p;
}

async function waitFor(url: string, tries = 20): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* noop */
    }
    await Bun.sleep(250);
  }
  throw new Error(`no se pudo conectar a ${url}`);
}

describe("MCP OAuth (PocketID)", () => {
  beforeAll(async () => {
    mock = startMockOidc();
    await waitFor(`${MOCK_ISSUER}/.well-known/openid-configuration`);
  });

  afterAll(() => {
    mock.kill();
  });

  async function buildApp() {
    process.env.SESSION_SECRET = "test-secret";
    process.env.AGENT_API_KEY = "testkey";
    process.env.BASE_URL = `http://localhost:${APP_PORT}`;
    process.env.OIDC_ISSUER = MOCK_ISSUER;
    process.env.OIDC_CLIENT_ID = "chat-share";
    const cfg = loadConfig();
    const oidc = new OidcClient(cfg);
    await oidc.init(); // carga discovery + JWKS del mock
    const app = new Hono();
    app.route("/api", apiRoutes(cfg));
    app.route("/", publicRoutes(cfg));
    app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
      c.json({
        resource: `${cfg.baseUrl}/mcp`,
        scopes_supported: [],
        authorization_servers: cfg.oidcIssuer ? [cfg.oidcIssuer] : [],
      })
    );
    app.all("/mcp", async (c) => {
      const auth = c.req.header("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (cfg.agentApiKeys.includes(token)) return handleMcpRequest(c.req.raw);
      if (token && cfg.oidcIssuer) {
        const payload = await oidc.verifyAccessToken(token);
        if (payload) {
          return handleMcpRequest(c.req.raw, {
            token,
            clientId: String(payload.client_id ?? payload.sub ?? "oauth"),
            scopes: [],
            extra: { sub: payload.sub, email: payload.email },
          });
        }
      }
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    });
    return app;
  }

  test("metadata de resource server anuncia el AS", async () => {
    const app = await buildApp();
    const res = await app.request("/.well-known/oauth-protected-resource/mcp");
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { authorization_servers: string[] };
    expect(meta.authorization_servers).toContain(MOCK_ISSUER);
  });

  test("MCP sin auth devuelve 401", async () => {
    const app = await buildApp();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  test("MCP con access token OAuth válido lista tools", async () => {
    const app = await buildApp();
    // Emitir un token contra el mock (la verificación usa las JWKS del mock)
    const t = await fetch(`${MOCK_ISSUER}/token`).then((r) => r.json());
    const accessToken = t.access_token as string;
    expect(accessToken).toBeTruthy();

    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("share_conversation");
    expect(text).toContain("revoke_shared_chat");
  });

  test("MCP con token inválido devuelve 401", async () => {
    const app = await buildApp();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer token.invalido.xyz",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });
});
