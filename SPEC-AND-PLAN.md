# chat-share — Especificación y Plan de Ejecución

> Documento de traspaso. El desarrollo fue iniciado por un agente de Hermes y quedó
> interrumpido por límite de créditos. Otro agente puede retomar desde aquí sin más
> contexto conversacional.

---

## 1. Visión del producto

**chat-share** es una aplicación autoalojada tipo "ChatGPT Share" pensada para **agentes de IA**:
un agente (Hermes Agent, Claude, Codex, etc.) publica una conversación a través de la API/MCP
y recibe un **enlace público único** (`/s/<id>`) que un humano puede abrir en el navegador para
ver la conversación renderizada en HTML bonito (markdown, roles, etc.).

**Funcionalidades clave:**

- Publicación de conversaciones por parte de agentes de IA (API REST + servidor MCP).
- Opciones al publicar: **contraseña opcional** y **tiempo de expiración** (1h / 24h / 7d / 30d / nunca).
  El agente pregunta al usuario y pasa los parámetros.
- Vista pública HTML del chat (render markdown sanitizado, distinción visual por rol).
- **Panel de administración** protegido con login **OIDC vía PocketID**: listar todos los chats
  compartidos, ver estadísticas (vistas, fecha, expiración), **revocar/eliminar** enlaces.
- Código abierto en GitHub + **GitHub Actions** que compila y publica la imagen Docker en GHCR
  automáticamente (tags: `latest`, semver).
- Despliegue final: VPS Hetzner de Vicente (Dokploy), donde ya vive PocketID, Miniflux, etc.

**Usuario:** Vicente Méndez (homelab Proxmox + VPS Hetzner con Dokploy; PocketID como IdP).

---

## 2. Decisiones de arquitectura (YA TOMADAS — no reabrir)

| Decisión | Elección | Motivo |
|---|---|---|
| Lenguaje/runtime | **TypeScript + Bun** | Mismo stack que `vmhq-mcp` de Vicente |
| Framework HTTP | **Hono** (con `@hono/node-server`) | Ligero, rápido, compatible Bun |
| Acceso de agentes | **API REST + servidor MCP** (wrapper en la misma app, endpoint `/mcp`) | Decisión explícita del usuario |
| MCP SDK | `@modelcontextprotocol/sdk` (Streamable HTTP transport) | SDK oficial |
| Base de datos | **SQLite** vía `bun:sqlite` (WAL) | Cero dependencias externas, ideal para autoalojado |
| Hash de contraseñas | **argon2** (paquete `argon2`) | Estándar actual |
| Render markdown | `marked` + `dompurify` + `jsdom` (sanitización server-side) | Seguridad XSS |
| Auth panel admin | **OIDC Authorization Code Flow contra PocketID** (implementar a mano, sin passport) | PocketID ya es el IdP del usuario |
| Contenedor | Dockerfile multi-etapa (oven/bun) → imagen final distroless-ish o `oven/bun:alpine` | Imagen pequeña |
| CI/CD | GitHub Actions → build multi-arch (amd64+arm64) → push a **GHCR** (`ghcr.io/<owner>/chat-share`) | Pedido explícito |
| Repo | `/root/git/chat-share` (local, inicializado con git). Remoto GitHub pendiente de crear | — |

---

## 3. Estado actual del trabajo

### Hecho ✅ (v0.1.0 funcional)
1. Repo creado en `/root/git/chat-share`, `git init`, `bun init`, deps instaladas.
2. `src/db.ts` — esquema SQLite (`shared_chats`) + `rowToPublic`.
3. `src/util.ts` — `newId`, `baseUrl`, `parseExpiry`, `EXPIRY_PRESETS` (errores de tipos corregidos).
4. `src/config.ts` — `loadConfig` con validación de env (exige `SESSION_SECRET`, `AGENT_API_KEY`).
5. `src/service.ts` — lógica de negocio compartida (crear/obtener/listar/revocar, argon2, disponibilidad).
6. `src/routes/api.ts` — REST: `POST/GET/DELETE /api/chats` + `GET /api/health` (health sin auth).
7. `src/mcp.ts` — servidor MCP Streamable HTTP stateless, 3 tools (`share_conversation`,
   `revoke_shared_chat`, `get_shared_chat_info`). Nota: SDK 1.30 cambió la firma de
   `registerTool` a `registerTool(name, {description, inputSchema}, cb)` — el código ya está adaptado.
8. `src/views/chatPage.ts` — HTML de conversación (markdown sanitizado con marked+dompurify),
   formulario de contraseña, página de expirado/revocado.
9. `src/routes/public.ts` — vista `/s/:id`, unlock con cookie HMAC + rate-limit en memoria,
   contador de vistas, headers noindex/no-store.
10. `src/oidc.ts` — cliente OIDC (discovery, PKCE, intercambio de code, validación id_token con
    `jose`), sesión stateless firmada (HMAC con `timingSafeEqual`).
11. `src/routes/admin.ts` — login OIDC (PKCE, state/nonce en cookies), callback, middleware de
    sesión, tabla admin con revocar/copiar, logout.
12. `src/index.ts` — monta todo + arranca `@hono/node-server`.
13. `Dockerfile` (multi-etapa, `oven/bun:1-alpine`), `.dockerignore`, `.gitignore` (data),
    `.github/workflows/docker.yml` (GHCR multi-arch), `README.md` completo.
14. Tests (`test/app.test.ts`) — **5 pasan, 0 fallan**: health, auth, crear/consultar, vista
    pública con markdown, revocar.
15. **Probado en vivo** (servidor corriendo): health, crear con password+expiry 24h, unlock con
    cookie correcta, revocar→404, expirado→410, markdown renderiza, contador de vistas,
    panel admin sin OIDC→503, MCP `tools/list` y `tools/call` OK. Typecheck (`tsc --noEmit`) limpio.

### Pendiente ❌ (para el agente que continúa)
- **Commit inicial + crear repo GitHub con `gh` y push** (verificar `gh auth status`).
- Verificar que el workflow GHCR corre y publica.
- Si `argon2` falla al construir en `oven/bun:1-alpine` (binario nativo), cambiar runtime a
  `oven/bun:1` (Debian slim) o fallback a scrypt de `node:crypto`.
- Despliegue final en Dokploy (fuera del repo).

### Nota de entorno
- Bun está en `~/.bun/bin` pero **NO está en el PATH por defecto**. Anteponer siempre:
  `export PATH="$HOME/.bun/bin:$PATH"` antes de `bun`/`bun test`.
- El tool `write_file`/`patch` reporta diagnósticos LSP de TypeScript — corregir los errores
  que introduzca cada archivo antes de seguir.

---

## 4. Especificación funcional detallada

### 4.1 Modelo de datos (ya implementado en `src/db.ts`)

Tabla `shared_chats`:
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | TEXT PK | nanoid(12) alfabeto sin look-alikes |
| `title` | TEXT | Título del chat |
| `agent` | TEXT | Nombre del agente/app que publica (default `'unknown'`) |
| `messages` | TEXT | JSON: `[{role, content, name?, ts?}]` |
| `password_hash` | TEXT NULL | argon2; null = público |
| `expires_at` | INTEGER NULL | epoch ms; null = nunca expira |
| `views` | INTEGER | Contador de vistas |
| `created_at` | INTEGER | epoch ms |
| `last_viewed_at` | INTEGER NULL | — |
| `revoked` | INTEGER 0/1 | 1 = eliminado lógico |

**Reglas de disponibilidad:** `available = !revoked && !expired`.

### 4.2 API REST (para agentes vía curl/HTTP)

Auth de publicación: **API key** por header `Authorization: Bearer <AGENT_API_KEY>`
(env `AGENT_API_KEY`; si hay varias, separadas por coma). Sin key configurada → rechazar con 500
(config inválida). La vista pública `/s/:id` y el panel admin NO usan esta key.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/chats` | API key | Crea chat compartido |
| `GET` | `/api/chats/:id` | API key | Metadatos (sin mensajes) |
| `DELETE` | `/api/chats/:id` | API key | Revoca (soft delete) |
| `GET` | `/api/health` | — | `{"ok":true}` |

**Body `POST /api/chats`** (validar con zod):
```json
{
  "title": "string (1..200)",
  "agent": "string opcional, ej. 'hermes-agent'",
  "messages": [{"role": "user|assistant|system|tool", "content": "string", "name?": "string", "ts?": "number"}],
  "password": "string opcional (si viene, se hashea con argon2)",
  "expires_in": "string opcional: '1h'|'24h'|'7d'|'30d'|'<n>m|<n>h|<n>d' — null/omitido = nunca"
}
```
**Respuesta 201:**
```json
{ "id": "abc123...", "url": "https://share.dominio.cl/s/abc123...", "expires_at": "...", "password_protected": true }
```

### 4.3 Servidor MCP (endpoint `/mcp`, mismo proceso)

Usar `@modelcontextprotocol/sdk` con **StreamableHTTPServerTransport** (stateless o con
sesión en memoria; preferir stateless para simplicidad en Docker). Auth: misma API key por
header `Authorization` (el transport la propaga; validar en middleware Hono antes de delegar).

**Tools MCP a exponer:**

1. `share_conversation`
   - Input: `{ title, messages[], password?, expires_in?, agent? }` (mismo schema zod que REST).
   - Output: texto + structured content con `url`, `id`, `expires_at`.
   - **Descripción del tool clave para el UX**: debe instruir al agente a *preguntar al usuario*
     si quiere contraseña y expiración antes de llamar, cuando el usuario no lo haya indicado.
2. `revoke_shared_chat` — `{ id }` → revoca.
3. `get_shared_chat_info` — `{ id }` → metadatos (vistas, expiración, disponibilidad).

### 4.4 Vista pública `/s/:id`

- `GET /s/:id` → HTML completo (sin frameworks cliente, CSS inline en `<style>`, tema oscuro
  agradable, responsive). Render: servidor, markdown por mensaje con `marked` + `dompurify`(jsdom).
- Si `revoked` → página 404/410 "Este enlace fue eliminado".
- Si expirado → página 410 "Este enlace expiró".
- Si tiene `password_hash` → formulario `POST /s/:id/unlock` (campo password). Verificar con
  argon2; si ok, setear cookie firmada `unlock_<id>=<hmac>` (HMAC con `SESSION_SECRET`) y mostrar.
  Rate-limit básico por IP en memoria (p.ej. 10 intentos/5 min) para frenar fuerza bruta.
- Cada vista exitosa: `views++`, `last_viewed_at=now`.
- Headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex` (los chats compartidos no deben
  indexarse en buscadores).
- Diseño de mensajes: burbujas/bloques por rol (user vs assistant vs system/tool), header con
  título, agente, fecha, nº de vistas. Footer "Shared via chat-share (self-hosted)".

### 4.5 Panel admin `/admin` (OIDC PocketID)

- `GET /admin/login` → redirige a PocketID authorize (Authorization Code + PKCE recomendado).
- `GET /admin/callback` → intercambia code por tokens, valida `id_token` (JWKS de PocketID:
  `<OIDC_ISSUER>/.well-known/jwks.json`), crea **sesión** (cookie `admin_session` firmada,
  HMAC-SHA256 con `SESSION_SECRET`, payload = sub+email+exp; o tabla de sesiones en SQLite si se
  prefiere stateful — cookie firmada stateless es suficiente).
- Middleware `requireAdmin` en todas las rutas `/admin/*` (excepto login/callback).
- `GET /admin` → tabla HTML: título, agente, creado, expira, vistas, protegido (🔒), estado
  (activo/expirado/revocado), acciones (copiar URL, revocar).
- `POST /admin/chats/:id/revoke` → revoca y vuelve a `/admin`.
- `GET /admin/logout` → borra cookie (+ redirect a `end_session_endpoint` de PocketID si existe).
- **Sin auto-registro ni multiusuario local**: cualquier usuario que autentique en PocketID entra
  (PocketID ya controla quién existe). Opcional: env `ADMIN_ALLOWED_SUBS` (subs separados por
  coma) para restringir aún más.

### 4.6 Variables de entorno

| Var | Requerida | Default | Descripción |
|---|---|---|---|
| `PORT` | no | `3000` | Puerto HTTP |
| `BASE_URL` | **sí** (prod) | `http://localhost:3000` | URL pública base para generar enlaces |
| `DB_PATH` | no | `./data/chat-share.db` | Ruta SQLite (montar volumen) |
| `AGENT_API_KEY` | **sí** | — | Keys de agentes (separadas por coma) |
| `SESSION_SECRET` | **sí** | — | Secreto HMAC cookies/unlock (≥32 chars aleatorios) |
| `OIDC_ISSUER` | **sí** | — | p.ej. `https://id.vmhq.cl` |
| `OIDC_CLIENT_ID` | **sí** | — | Client ID de PocketID |
| `OIDC_CLIENT_SECRET` | no | — | Si el cliente es confidencial |
| `ADMIN_ALLOWED_SUBS` | no | — | Restringir acceso admin por sub OIDC |

Validar al arranque: si falta alguna requerida → log claro y `process.exit(1)`.

---

## 5. Docker + CI/CD + Repo GitHub

### 5.1 Dockerfile (multi-etapa)
```dockerfile
# build
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .

# runtime
FROM oven/bun:1-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "run", "src/index.ts"]
```
(Opcional: compilar a binario con `bun build --compile` para imagen aún más pequeña — mejora futura, no bloqueante.)

### 5.2 `.dockerignore`
`node_modules`, `.git`, `data`, `*.md` (excepto README si se quiere), `.github`.

### 5.3 GitHub Actions `.github/workflows/docker.yml`
- Trigger: push a `main` + tags `v*`.
- Login GHCR con `GITHUB_TOKEN` (permiso `packages: write`).
- `docker/setup-buildx-action` + `docker/build-push-action`: plataformas `linux/amd64,linux/arm64`,
  tags `ghcr.io/<owner>/chat-share:latest` + semver si tag. Cache `type=gha`.

### 5.4 Crear repo remoto
- Vicente tiene `gh` autenticado en el LXC (verificar con `gh auth status`).
- `gh repo create chat-share --public --source=/root/git/chat-share --push`
- Descripción sugerida: "Self-hosted shareable chat links for AI agents — REST + MCP, OIDC admin panel".
- Topics: `selfhosted`, `mcp`, `ai-agents`, `hono`, `bun`, `docker`.

---

## 6. Plan de ejecución (para el agente que continúa)

> Trabajar en `/root/git/chat-share`. Recordar `export PATH="$HOME/.bun/bin:$PATH"`.
> Ir commiteando por hitos. Marcar todos conforme se completa.

1. **[~10 min] Arreglar `src/util.ts`** (errores §3.1) y verificar `bun run` typecheck
   (`bunx tsc --noEmit` si se agrega `tsconfig.json` — crear uno mínimo con `module: ESNext`,
   `moduleResolution: bundler`, `types: ["bun"]`).
2. **[core] `src/index.ts`**: app Hono, arranque con `@hono/node-server`, validación de env,
   middleware de logging simple, montaje de rutas. Endpoint `/api/health`.
3. **[core] `src/routes/api.ts`**: `POST /api/chats` (zod validator, argon2 hash, parseExpiry,
   insert SQLite, respuesta con URL), `GET`/`DELETE /api/chats/:id`. Middleware `requireApiKey`.
4. **[mcp] `src/mcp.ts`**: servidor MCP con `McpServer` + `StreamableHTTPServerTransport`
   (stateless: `sessionIdGenerator: undefined`), registrar los 3 tools de §4.3 reutilizando la
   lógica de `api.ts` (extraer funciones de servicio compartidas en `src/service.ts` para no
   duplicar). Montar en `/mcp` tras middleware de API key.
5. **[público] `src/routes/public.ts` + `src/views/chatPage.ts`**: HTML de conversación,
   páginas de expirado/revocado, formulario de contraseña, verificación argon2 + cookie HMAC,
   rate-limit en memoria, contador de vistas, headers noindex/no-store.
6. **[admin] `src/oidc.ts` + `src/routes/admin.ts` + `src/views/adminPage.ts`**: discovery
   (`GET <issuer>/.well-known/openid-configuration` al arranque, cachear), authorize URL con
   state+nonce en cookie, callback con intercambio de code (fetch a token endpoint), validación
   de id_token vía JWKS (implementar verificación RS256 con `node:crypto` o usar librería
   `jose` si se prefiere — **`jose` es la opción recomendada, añadirla con bun**), sesión
   cookie firmada, middleware `requireAdmin`, tabla de chats con acciones, logout.
7. **[docker] Dockerfile + .dockerignore** según §5.1/§5.2. Probar build local si hay Docker
   en el LXC (`docker build -t chat-share .`); si no, dejar validado sintácticamente.
8. **[ci] `.github/workflows/docker.yml`** según §5.3.
9. **[docs] README.md**: qué es, screenshots placeholder, quickstart Docker (`docker run` y
   `docker-compose.yml` de ejemplo), tabla de env vars, cómo crear el cliente OIDC en PocketID
   (redirect URI: `https://<dominio>/admin/callback`), ejemplo curl de publicación, ejemplo de
   config MCP en Hermes (`hermes mcp add` o config.yaml) y ejemplo de skill mínima para Hermes
   que llame a la API REST (opcional, carpeta `examples/hermes-skill/`).
10. **[tests] `bun test`**: tests de `parseExpiry`, del flujo REST crear→obtener→revocar, y de
    disponibilidad (expirado/revocado). Usar app Hono con `app.request()` para tests HTTP sin
    levantar puerto.
11. **[entrega] Commit final, crear repo GitHub con `gh`, push, verificar que el workflow
    corre y publica en GHCR. Entregar a Vicente: URL del repo, instrucciones de despliegue en
    Dokploy (imagen GHCR, volumen `/app/data`, env vars, dominio p.ej. `share.vmhq.cl` con
    certificado del reverse proxy de Dokploy) y recordatorio de crear el cliente en PocketID.**

### Riesgos / pitfalls conocidos
- **argon2** es binario nativo: en Alpine puede necesitar rebuild. Si falla en `oven/bun:1-alpine`,
  usar `oven/bun:1` (Debian slim) como runtime o cambiar a hash con `node:crypto` scrypt
  (aceptable fallback, documentarlo).
- MCP StreamableHTTP en modo stateless: cada request crea transport+server nuevo; verificar con
  `curl -X POST /mcp -H 'Authorization: Bearer KEY' -H 'Content-Type: application/json' -H
  'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`.
- Validación de id_token: no reinventar JWT — usar `jose` (`bun add jose`).
- `bun:sqlite` en tests: usar `DB_PATH=:memory:` o archivo temporal por test.

---

## 7. Despliegue final (referencia para Vicente)

1. Crear cliente OIDC en PocketID: redirect `https://share.<dominio>/admin/callback`.
2. Dokploy → nuevo servicio Docker desde `ghcr.io/<owner>/chat-share:latest`, volumen
   `chat-share-data:/app/data`, env vars (§4.6), dominio `share.<dominio>` con TLS.
3. En Hermes: añadir MCP `chat-share` apuntando a `https://share.<dominio>/mcp` con header
   `Authorization: Bearer <AGENT_API_KEY>` (y/o instalar la skill de ejemplo que usa curl).
4. Uso: "Comparte esta conversación" → el agente pregunta contraseña/expiración → devuelve enlace.
