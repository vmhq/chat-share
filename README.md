# chat-share

Share AI agent conversations via unique public links. Self-hosted, with a REST API + MCP
server for agents, and an admin panel protected by OIDC login (via PocketID).

It's like ChatGPT's "Share" feature, but self-hosted and designed so AI agents themselves
(Hermes, Claude, Codex, etc.) publish and manage the links.

## ✨ Features

- **REST API + MCP** for AI agents to publish conversations and get a `/s/<id>` link.
- **Public link** rendered as nice HTML (markdown, syntax highlighting, role-styled bubbles).
- **Optional password** (argon2-hashed) to protect the link.
- **Optional expiration** (`1h`, `24h`, `7d`, `30d`, or never).
- **Admin panel** with **OIDC (PocketID)** login: view all chats, view counts, expiration,
  revoke/delete links.
- View counter and status (active / expired / revoked).
- SQLite (WAL), no external dependencies. Small multi-arch Docker image.

## 🚀 Docker quickstart

```bash
docker run -d --name chat-share \
  -p 3000:3000 \
  -v chat-share-data:/app/data \
  -e BASE_URL="https://share.yourdomain.cl" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e AGENT_API_KEY="a-secret-key" \
  -e OIDC_ISSUER="https://id.yourdomain.cl" \
  -e OIDC_CLIENT_ID="chat-share" \
  -e ADMIN_ALLOWED_SUBS="<user-sub>" \
  ghcr.io/<your-user>/chat-share:latest
```

Or with `docker-compose.yml` (see `docker-compose.yml` in the repo root):

```yaml
services:
  chat-share:
    image: ghcr.io/<your-user>/chat-share:latest
    restart: unless-stopped
    ports: ["3000:3000"]
    volumes: ["chat-share-data:/app/data"]
    env_file: .env
volumes:
  chat-share-data:
```

Copy `.env.example` to `.env`, fill it in, and run `docker compose up -d`.

## ⚙️ Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `BASE_URL` | yes (prod) | `http://localhost:3000` | Public base URL used to generate links |
| `DB_PATH` | no | `./data/chat-share.db` | SQLite path (mount a volume) |
| `AGENT_API_KEY` | yes | — | Agent keys (comma-separated) |
| `SESSION_SECRET` | yes | — | HMAC secret for cookies (≥32 random chars) |
| `OIDC_ISSUER` | yes* | — | PocketID issuer (e.g. `https://id.yourdomain.cl`) |
| `OIDC_CLIENT_ID` | yes* | — | Admin panel client ID |
| `OIDC_CLIENT_SECRET` | no | — | Client secret (if the client is confidential) |
| `OIDC_AUDIENCE` | no | — | Audience required when validating MCP OAuth access tokens |
| `ADMIN_ALLOWED_SUBS` | no | — | OIDC subs allowed in the admin panel (comma-separated) |
| `COOKIE_SECURE` | no | `true` | `Secure` flag on cookies (set `false` only on local HTTP) |
| `BODY_LIMIT` | no | `1048576` | Request body limit in bytes for API/MCP/unlock |

\* OIDC is optional: without `OIDC_ISSUER`/`OIDC_CLIENT_ID` the admin panel is disabled,
but the API and public links keep working.

## 🤖 Publishing from an AI agent

### Via REST API (curl)

```bash
curl -X POST https://share.yourdomain.cl/api/chats \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Network issue fix",
    "agent": "hermes-agent",
    "messages": [
      {"role": "user", "content": "How do I configure DNS?"},
      {"role": "assistant", "content": "Edit `/etc/resolv.conf`..."}
    ],
    "password": "optional-123",
    "expires_in": "7d"
  }'
```

Response:

```json
{
  "id": "mWqq9mPEdrRZ",
  "url": "https://share.yourdomain.cl/s/mWqq9mPEdrRZ",
  "expires_at": "2026-08-09T19:39:52.728Z",
  "password_protected": true
}
```

### Via MCP

The `/mcp` endpoint is an **MCP Streamable HTTP** server (stateless). Tools:

| Tool | Description |
|---|---|
| `share_conversation` | Publishes a conversation → returns a URL. Asks the user about password/expiration if they didn't specify any. |
| `revoke_shared_chat` | Revokes a link (`id`). |
| `get_shared_chat_info` | Link metadata (`views`, `expires_at`, status). |

**MCP authentication** — two mechanisms are supported:

1. **API key** (same as the REST API): header `Authorization: Bearer <AGENT_API_KEY>`.
2. **OAuth 2.0 against PocketID**: the server acts as a *resource server* that delegates
   authorization to PocketID. Standard discovery flow:
   - Metadata: `https://share.yourdomain.cl/.well-known/oauth-protected-resource/mcp`
   - The client does an OAuth login at PocketID and receives an *access token* sent as
     `Authorization: Bearer <access_token>`.
   - The server validates the token against PocketID's **JWKS** (`OIDC_ISSUER` config).

**Configure in Hermes** (`config.yaml` or `hermes mcp add`):

```yaml
mcp:
  servers:
    chat-share:
      transport: streamable-http
      url: https://share.yourdomain.cl/mcp
      headers:
        Authorization: "Bearer YOUR_API_KEY"
```

If you prefer OAuth over an API key, point the MCP client at the metadata URL above and
Hermes/Claude/Codex will perform the OAuth login against PocketID automatically.

When the MCP authenticates via OAuth, the `agent` field of published chats reflects the
user's identity (PocketID email/sub) instead of a generic name.

## 🔐 Admin panel

1. Create an OIDC client in **PocketID** with redirect URI `https://share.yourdomain.cl/admin/callback`.
2. Configure `OIDC_ISSUER` and `OIDC_CLIENT_ID` (plus `OIDC_CLIENT_SECRET` if applicable).
3. Go to `/admin`. You'll see all shared chats: title, agent, date, expiration, views,
   password protection, status, and actions (copy URL / revoke).

The flow uses Authorization Code + PKCE, validates the `id_token` against the issuer's JWKS
and creates a signed stateless session (HMAC).

## 🐳 Docker image / CI

- **Multi-stage Dockerfile** → small runtime image (`oven/bun:1-alpine`).
- **GitHub Actions** (`.github/workflows/docker.yml`): on every push to `main` or tag `v*`
  it builds for `linux/amd64` and `linux/arm64` and publishes to **GHCR** (`ghcr.io/<repo>/chat-share`).

## 🧪 Development

```bash
bun install
bun run src/index.ts   # requires SESSION_SECRET and AGENT_API_KEY
bunx tsc --noEmit      # typecheck
bun test               # tests
```

## 📄 License

MIT
