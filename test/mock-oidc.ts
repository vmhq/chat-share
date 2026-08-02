// Mock OIDC server (issuer local) para probar la rama OAuth del MCP.
// Sirve openid-configuration + jwks y firma un access token válido.
import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const spki = publicKey.export({ format: "jwk" });

const PORT = parseInt(process.argv[2] ?? "3999", 10);
const ISSUER = `http://localhost:${PORT}`;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      });
    }
    if (url.pathname === "/.well-known/jwks.json") {
      return Response.json({ keys: [{ ...spki, alg: "RS256", use: "sig", kid: "mock-1" }] });
    }
    if (url.pathname === "/token") {
      // Emitir un access token firmado, exp en 1h
      const token = await new SignJWT({
        sub: "user-123",
        email: "vico@example.cl",
        scope: "openid",
        client_id: "chat-share",
      })
        .setProtectedHeader({ alg: "RS256", kid: "mock-1" })
        .setIssuer(ISSUER)
        .setAudience("chat-share")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      return Response.json({ access_token: token, token_type: "Bearer", expires_in: 3600 });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`mock-oidc listening on ${ISSUER}`);
setInterval(() => {}, 1 << 30);
