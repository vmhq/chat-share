import type { Context } from "hono";
import type { AppConfig } from "./config";
import { OidcClient } from "./oidc";
import { handleMcpRequest } from "./mcp";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * Autentica una request /mcp y delega en el servidor MCP.
 * Orden de preferencia:
 *   1. API key (AGENT_API_KEY)
 *   2. Access token OAuth de PocketID (validado por JWKS)
 * Si ninguna es válida, devuelve 401 con WWW-Authenticate (RFC 9728).
 */
export async function handleMcpAuth(
  c: Context,
  cfg: AppConfig,
  oidc: OidcClient
): Promise<Response> {
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
      const authInfo: AuthInfo = {
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
}
