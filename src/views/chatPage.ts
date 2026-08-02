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

export interface ChatPageData {
  id: string;
  title: string;
  agent: string;
  messages: Message[];
  views: number;
  createdAt: string;
  locked: boolean;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);
}

function messageHtml(m: Message): string {
  const label = ROLE_LABEL[m.role] ?? m.role;
  return `<div class="msg ${m.role}">
    <div class="meta"><span class="role">${label}</span>${m.name ? `<span class="name">${esc(m.name)}</span>` : ""}</div>
    <div class="body">${renderMarkdown(m.content)}</div>
  </div>`;
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
  body { margin: 0; background: #0f1115; color: #e6e6e6; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.6; }
  header { padding: 20px 24px; border-bottom: 1px solid #23262e; background: #16181f; }
  header h1 { margin: 0 0 6px; font-size: 1.3rem; }
  .meta { color: #8b93a1; font-size: .85rem; }
  .meta span { margin-right: 14px; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 60px; }
  .msg { border: 1px solid #23262e; border-radius: 12px; padding: 14px 18px; margin-bottom: 14px; background: #171a21; }
  .msg .meta { margin-bottom: 8px; }
  .msg .role { font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; }
  .msg.user .role { color: #7aa2ff; }
  .msg.assistant .role { color: #7ee0a3; }
  .msg.system .role { color: #f0b26b; }
  .msg.tool .role { color: #c79cf0; }
  .msg .name { margin-left: 8px; font-style: italic; }
  .msg .body > :first-child { margin-top: 0; }
  .msg .body > :last-child { margin-bottom: 0; }
  pre { background: #0d0f14; border: 1px solid #23262e; border-radius: 8px; padding: 12px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  p code, li code { background: #23262e; padding: 2px 5px; border-radius: 4px; }
  blockquote { border-left: 3px solid #3a3f4b; margin-left: 0; padding-left: 14px; color: #b6bdca; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #2a2e38; padding: 6px 10px; }
  a { color: #7aa2ff; }
  footer { text-align: center; color: #5b6270; font-size: .8rem; padding: 24px; }
  .locked { max-width: 420px; margin: 60px auto; text-align: center; }
  .locked input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #2a2e38; background: #16181f; color: #e6e6e6; font-size: 1rem; margin: 10px 0; }
  .locked button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: #3b6cff; color: #fff; font-size: 1rem; cursor: pointer; }
  .error { color: #ff7a7a; }
  .placeholder { color: #8b93a1; }
</style>
</head>
<body>
<header>
  <h1>${esc(d.title)}</h1>
  <div class="meta">
    <span>👤 ${esc(d.agent)}</span>
    <span>🕒 ${esc(d.createdAt)}</span>
    <span>👁️ ${d.views} vistas</span>
  </div>
</header>
<main>
  ${messagesHtml}
</main>
<footer>Compartido con chat-share · autoalojado</footer>
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
