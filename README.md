# chat-share

Comparte conversaciones de agentes de IA mediante enlaces públicos únicos. Self-hosted, con
API REST + servidor MCP para agentes, y panel de administración protegido por login OIDC
(vía PocketID).

Es como la función "Compartir" de ChatGPT, pero autoalojada y pensada para que los propios
agentes de IA (Hermes, Claude, Codex, etc.) publiquen y gestionen los enlaces.

## ✨ Características

- **API REST + MCP** para que agentes de IA publiquen conversaciones y reciban un enlace `/s/<id>`.
- **Enlace público** renderizado en HTML bonito (markdown, sintaxis, roles distinguidos).
- **Contraseña opcional** (hasheada con argon2) para proteger el enlace.
- **Expiración opcional** (`1h`, `24h`, `7d`, `30d`, o nunca).
- **Panel de administración** con login **OIDC (PocketID)**: ver todos los chats, vistas,
  expiración, revocar/eliminar enlaces.
- Contador de vistas y estado (activo / expirado / revocado).
- SQLite (WAL), sin dependencias externas. Contenedor Docker pequeño y multi-arquitectura.

## 🚀 Quickstart con Docker

```bash
docker run -d --name chat-share \
  -p 3000:3000 \
  -v chat-share-data:/app/data \
  -e BASE_URL="https://share.tudominio.cl" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e AGENT_API_KEY="una-key-secreta" \
  -e OIDC_ISSUER="https://id.tudominio.cl" \
  -e OIDC_CLIENT_ID="chat-share" \
  -e ADMIN_ALLOWED_SUBS="<sub-del-usuario>" \
  ghcr.io/<tu-usuario>/chat-share:latest
```

O con `docker-compose.yml`:

```yaml
services:
  chat-share:
    image: ghcr.io/<tu-usuario>/chat-share:latest
    restart: unless-stopped
    ports: ["3000:3000"]
    volumes: ["chat-share-data:/app/data"]
    environment:
      BASE_URL: "https://share.tudominio.cl"
      SESSION_SECRET: "cambia-este-secreto"
      AGENT_API_KEY: "una-key-secreta"
      OIDC_ISSUER: "https://id.tudominio.cl"
      OIDC_CLIENT_ID: "chat-share"
      ADMIN_ALLOWED_SUBS: "<sub-del-usuario>"
volumes:
  chat-share-data:
```

## ⚙️ Variables de entorno

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `PORT` | no | `3000` | Puerto HTTP |
| `BASE_URL` | sí (prod) | `http://localhost:3000` | URL pública base para generar enlaces |
| `DB_PATH` | no | `./data/chat-share.db` | Ruta SQLite (montar volumen) |
| `AGENT_API_KEY` | sí | — | Keys de agentes (separadas por coma) |
| `SESSION_SECRET` | sí | — | Secreto HMAC de cookies (≥32 chars aleatorios) |
| `OIDC_ISSUER` | sí* | — | Issuer de PocketID (p. ej. `https://id.tudominio.cl`) |
| `OIDC_CLIENT_ID` | sí* | — | Client ID del panel admin |
| `OIDC_CLIENT_SECRET` | no | — | Client secret (si el cliente es confidencial) |
| `ADMIN_ALLOWED_SUBS` | no | — | Subs OIDC permitidos en el admin (separados por coma) |

\* OIDC es opcional: sin `OIDC_ISSUER`/`OIDC_CLIENT_ID` el panel admin queda deshabilitado,
pero la API y los enlaces públicos funcionan.

## 🤖 Publicar desde un agente de IA

### Vía API REST (curl)

```bash
curl -X POST https://share.tudominio.cl/api/chats \
  -H "Authorization: Bearer TU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Solución al problema de red",
    "agent": "hermes-agent",
    "messages": [
      {"role": "user", "content": "¿Cómo configuro el DNS?"},
      {"role": "assistant", "content": "Edita `/etc/resolv.conf`..."}
    ],
    "password": "opcional-123",
    "expires_in": "7d"
  }'
```

Respuesta:

```json
{
  "id": "mWqq9mPEdrRZ",
  "url": "https://share.tudominio.cl/s/mWqq9mPEdrRZ",
  "expires_at": "2026-08-09T19:39:52.728Z",
  "password_protected": true
}
```

### Vía MCP

El endpoint `/mcp` es un servidor **MCP Streamable HTTP** (stateless). Tools:

| Tool | Descripción |
|---|---|
| `share_conversation` | Publica una conversación → devuelve URL. Pregunta al usuario si quiere contraseña/expiración si no las indicó. |
| `revoke_shared_chat` | Revoca un enlace (`id`). |
| `get_shared_chat_info` | Metadatos de un enlace (`vistas`, `expires_at`, estado). |

**Configurar en Hermes** (`config.yaml` o `hermes mcp add`):

```yaml
mcp:
  servers:
    chat-share:
      transport: streamable-http
      url: https://share.tudominio.cl/mcp
      headers:
        Authorization: "Bearer TU_API_KEY"
```

## 🔐 Panel de administración

1. Crea un cliente OIDC en **PocketID** con redirect URI `https://share.tudominio.cl/admin/callback`.
2. Configura `OIDC_ISSUER` y `OIDC_CLIENT_ID` (y `OIDC_CLIENT_SECRET` si aplica).
3. Accede a `/admin`. Verás todos los chats compartidos: título, agente, fecha, expiración,
   vistas, si está protegido con contraseña, estado y acciones (copiar URL / revocar).

El flujo usa Authorization Code + PKCE, valida el `id_token` contra las JWKS del issuer y crea
una sesión stateless firmada (HMAC).

## 🐳 Imagen Docker / CI

- **Dockerfile** multi-etapa → imagen runtime pequeña (`oven/bun:1-alpine`).
- **GitHub Actions** (`.github/workflows/docker.yml`): en cada push a `main` o tag `v*` compila
  para `linux/amd64` y `linux/arm64` y publica en **GHCR** (`ghcr.io/<repo>/chat-share`).

## 🧪 Desarrollo

```bash
bun install
bun run src/index.ts   # requiere SESSION_SECRET y AGENT_API_KEY
bunx tsc --noEmit      # typecheck
bun test               # tests
```

## 📄 Licencia

MIT
