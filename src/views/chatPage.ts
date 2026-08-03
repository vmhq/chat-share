import { marked } from "marked";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import type { Message } from "../service";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

const ROLE_LABEL: Record<Message["role"], string> = {
  user: "Usuario",
  assistant: "Asistente",
  system: "Sistema",
  tool: "Herramienta",
};

// Avatar por rol (emoji en un círculo con color de fondo).
const ROLE_AVATAR: Record<Message["role"], string> = {
  user: "🙂",
  assistant: "✨",
  system: "⚙️",
  tool: "🛠️",
};

export interface ChatPageData {
  id: string;
  title: string;
  agent: string;
  messages: Message[];
  views: number;
  createdAt: string;
  locked: boolean;
}

const TZ = "America/Santiago";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);
}

// Mensaje de asistente: avatar a la izquierda + burbuja (siempre visible).
function assistantHtml(m: Message, label: string): string {
  return `<div class="row ${m.role}">
    <div class="avatar ${m.role}">${ROLE_AVATAR[m.role] ?? "🤖"}</div>
    <div class="col">
      <div class="who">${label}${m.name ? `<span class="name">${esc(m.name)}</span>` : ""}</div>
      <div class="bubble ${m.role}"><div class="body">${renderMarkdown(m.content)}</div></div>
    </div>
  </div>`;
}

// Mensajes de sistema/herramienta: desplegables (<details>) cerrados por defecto.
function collapsibleHtml(m: Message, label: string): string {
  return `<details class="fold ${m.role}">
    <summary>
      <span class="fold-avatar ${m.role}">${ROLE_AVATAR[m.role] ?? "🤖"}</span>
      <span class="fold-label">${label}${m.name ? `<span class="name">${esc(m.name)}</span>` : ""}</span>
      <span class="chevron" aria-hidden="true">▸</span>
    </summary>
    <div class="fold-body ${m.role}"><div class="body">${renderMarkdown(m.content)}</div></div>
  </details>`;
}

// Mensaje de usuario: burbuja alineada a la derecha.
function userHtml(m: Message): string {
  return `<div class="row user">
    <div class="col right">
      <div class="bubble user"><div class="body">${renderMarkdown(m.content)}</div></div>
    </div>
    <div class="avatar user">${ROLE_AVATAR.user}</div>
  </div>`;
}

function messageHtml(m: Message): string {
  const label = ROLE_LABEL[m.role] ?? m.role;
  if (m.role === "user") return userHtml(m);
  if (m.role === "system" || m.role === "tool") return collapsibleHtml(m, label);
  return assistantHtml(m, label);
}

export function chatPageHtml(d: ChatPageData): string {
  const messagesHtml = d.messages.map(messageHtml).join("");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}</title>
<meta name="robots" content="noindex">
<meta name="description" content="Conversación compartida">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: #0f1115; color: #e6e6e6; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.65; }
  header { position: sticky; top: 0; z-index: 10; padding: 16px 24px; border-bottom: 1px solid #23262e; background: rgba(22,24,31,.92); backdrop-filter: blur(10px); }
  .header-inner { max-width: 820px; margin: 0 auto; display: flex; align-items: center; gap: 14px; }
  .logo { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg,#3b6cff,#8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: 0 4px 14px rgba(59,108,255,.35); }
  .titles { min-width: 0; }
  .titles h1 { margin: 0; font-size: 1.15rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #8b93a1; font-size: .82rem; margin-top: 2px; }
  .meta span { margin-right: 14px; }
  main { max-width: 820px; margin: 0 auto; padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 20px; }
  .row { display: flex; gap: 12px; align-items: flex-start; }
  .row.user { justify-content: flex-end; }
  .avatar { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; margin-top: 2px; }
  .avatar.assistant { background: linear-gradient(135deg,#3b6cff,#8b5cf6); }
  .avatar.system { background: #3a3f4b; }
  .avatar.tool { background: #4a3a63; }
  .avatar.user { background: #23262e; order: 2; }
  .col { display: flex; flex-direction: column; max-width: 82%; }
  .col.right { align-items: flex-end; }
  .who { font-size: .82rem; font-weight: 600; color: #b6bdca; margin: 2px 4px 4px; }
  .who .name { margin-left: 8px; font-weight: 400; font-style: italic; color: #8b93a1; }
  .bubble { border-radius: 14px; padding: 12px 16px; }
  .bubble.assistant, .bubble.system, .bubble.tool { background: #1b1e26; border: 1px solid #262a34; border-top-left-radius: 4px; }
  .bubble.user { background: #2b3a6b; border: 1px solid #3a4f8a; border-top-right-radius: 4px; }
  .bubble .body > :first-child { margin-top: 0; }
  .bubble .body > :last-child { margin-bottom: 0; }
  details.fold { border: 1px solid #262a34; border-radius: 10px; background: #16181f; overflow: hidden; }
  details.fold summary { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; list-style: none; user-select: none; }
  details.fold summary::-webkit-details-marker { display: none; }
  details.fold summary:hover { background: #1a1d25; }
  .fold-avatar { flex: 0 0 auto; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: .8rem; }
  .fold-avatar.system { background: #3a3f4b; }
  .fold-avatar.tool { background: #4a3a63; }
  .fold-label { font-size: .82rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #b6bdca; flex: 1; }
  .fold-label .name { margin-left: 8px; font-weight: 400; text-transform: none; font-style: italic; color: #8b93a1; }
  .chevron { color: #8b93a1; font-size: .8rem; transition: transform .15s ease; }
  details.fold[open] .chevron { transform: rotate(90deg); }
  .fold-body { padding: 4px 14px 14px; }
  .fold-body > .body > :first-child { margin-top: 0; }
  .fold-body > .body > :last-child { margin-bottom: 0; }
  pre { background: #0d0f14; border: 1px solid #23262e; border-radius: 8px; padding: 12px; overflow-x: auto; margin: 8px 0; white-space: pre-wrap; word-break: break-word; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  p code, li code { background: #23262e; padding: 2px 5px; border-radius: 4px; }
  blockquote { border-left: 3px solid #3a3f4b; margin-left: 0; padding-left: 14px; color: #b6bdca; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #2a2e38; padding: 6px 10px; }
  a { color: #7aa2ff; }
  ul, ol { padding-left: 22px; }
  footer { text-align: center; color: #5b6270; font-size: .8rem; padding: 24px; }
  .locked { max-width: 420px; margin: 60px auto; text-align: center; }
  .locked input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #2a2e38; background: #16181f; color: #e6e6e6; font-size: 1rem; margin: 10px 0; }
  .locked button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: #3b6cff; color: #fff; font-size: 1rem; cursor: pointer; }
  .error { color: #ff7a7a; }
  .placeholder { color: #8b93a1; }
  @media (max-width: 600px) {
    .col { max-width: 100%; }
    header { padding: 12px 16px; }
    main { padding: 16px 12px 40px; }
  }
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <div class="logo">💬</div>
    <div class="titles">
      <h1>${esc(d.title)}</h1>
      <div class="meta">
        <span>👤 ${esc(d.agent)}</span>
        <span>🕒 ${esc(d.createdAt)}</span>
        <span>👁️ ${d.views} vistas</span>
      </div>
    </div>
  </div>
</header>
<main>
  ${messagesHtml}
</main>
<footer>Chat Share - VMHQ</footer>
</body>
</html>`;
}

export function passwordFormHtml(id: string, error?: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Conversación protegida</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f1115; color: #e6e6e6; font-family: system-ui, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { width: 100%; max-width: 420px; padding: 32px; text-align: center; }
  h1 { font-size: 1.1rem; margin: 0 0 6px; }
  p { color: #8b93a1; font-size: .9rem; margin: 0 0 8px; }
  input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #2a2e38; background: #16181f; color: #e6e6e6; font-size: 1rem; margin: 12px 0; }
  button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: #3b6cff; color: #fff; font-size: 1rem; cursor: pointer; }
  .error { color: #ff7a7a; font-size: .85rem; }
</style>
</head>
<body>
<div class="card">
  <h1>🔒 Conversación protegida</h1>
  <p>Ingresa la contraseña para ver esta conversación.</p>
  <form method="post" action="/s/${esc(id)}/unlock">
    <input type="password" name="password" placeholder="Contraseña" autofocus required>
    ${error ? `<div class="error">${esc(error)}</div>` : ""}
    <button type="submit">Ver conversación</button>
  </form>
</div>
</body>
</html>`;
}

export function gonePageHtml(reason: "expired" | "revoked"): string {
  const title = reason === "expired" ? "Este enlace ha expirado" : "Este enlace ha sido eliminado";
  const msg =
    reason === "expired"
      ? "El período de publicación de esta conversación terminó."
      : "El autor retiró este enlace.";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f1115; color: #e6e6e6; font-family: system-ui, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; text-align: center; }
  .card { max-width: 420px; padding: 32px; }
  .big { font-size: 3rem; }
  h1 { font-size: 1.2rem; }
  p { color: #8b93a1; }
</style>
</head>
<body>
<div class="card">
  <div class="big">${reason === "expired" ? "⏳" : "🚫"}</div>
  <h1>${title}</h1>
  <p>${msg}</p>
</div>
</body>
</html>`;
}
