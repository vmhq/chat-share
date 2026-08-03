import { marked } from "marked";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import type { Message } from "../service";
import { faviconLink, FONT_LINKS, THEME_CSS, THEME_SCRIPT, themeToggleHtml } from "./theme";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

const ROLE_LABEL: Record<Message["role"], string> = {
  user: "Tú",
  assistant: "Asistente",
  system: "Sistema",
  tool: "Herramienta",
  reasoning: "Cadena de pensamiento",
};

// Avatar por rol (emoji en un círculo con color de fondo).
const ROLE_AVATAR: Record<Message["role"], string> = {
  user: "🙂",
  assistant: "✨",
  system: "⚙️",
  tool: "🛠️",
  reasoning: "🧠",
};

// "hermes-agent" → "Hermes", "claude-code" → "Claude Code", etc.
function agentDisplayName(agent: string): string {
  const clean = agent
    .replace(/[-_]+/g, " ")
    .replace(/\bagent\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "Asistente";
  return clean
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

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
function assistantHtml(m: Message, agentName: string): string {
  return `<div class="row ${m.role}">
    <div class="avatar ${m.role}">${ROLE_AVATAR[m.role] ?? "🤖"}</div>
    <div class="col">
      <div class="who">${esc(agentName)}${m.name && m.name !== agentName ? `<span class="name">${esc(m.name)}</span>` : ""}</div>
      <div class="bubble ${m.role}"><div class="body">${renderMarkdown(m.content)}</div></div>
    </div>
  </div>`;
}

// Mensajes de herramienta/cadena de pensamiento: desplegables (<details>) cerrados por defecto.
// Colapsados = solo texto; al expandir aparece el recuadro.
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

// Mensaje de usuario: burbuja alineada a la derecha, identificado con su nombre.
function userHtml(m: Message): string {
  const name = m.name ? esc(m.name) : "Tú";
  return `<div class="row user">
    <div class="col right">
      <div class="who">${name}</div>
      <div class="bubble user"><div class="body">${renderMarkdown(m.content)}</div></div>
    </div>
    <div class="avatar user">${ROLE_AVATAR.user}</div>
  </div>`;
}

// Agrupa reasoning/tool como preámbulo del mensaje de asistente (su resultado).
function messageListHtml(messages: Message[], agentName: string): string {
  let out = "";
  let prelude: Message[] = [];
  const renderPrelude = (): string =>
    prelude
      .map((m) => collapsibleHtml(m, ROLE_LABEL[m.role]))
      .join("");
  for (const m of messages) {
    if (m.role === "reasoning" || m.role === "tool") {
      prelude.push(m);
    } else if (m.role === "assistant") {
      const pills = renderPrelude();
      prelude = [];
      out += pills
        ? `<div class="turn">${pills}${assistantHtml(m, agentName)}</div>`
        : assistantHtml(m, agentName);
    } else if (m.role === "user") {
      // Un usuario nuevo cierra cualquier preámbulo pendiente.
      const pills = renderPrelude();
      prelude = [];
      out += pills ? `<div class="turn">${pills}</div>` : "";
      out += userHtml(m);
    }
    // "system" se filtra: es ruido técnico, no se muestra.
  }
  if (prelude.length) out += `<div class="turn">${renderPrelude()}</div>`;
  return out;
}

export function chatPageHtml(d: ChatPageData): string {
  const agentName = agentDisplayName(d.agent);
  const messagesHtml = messageListHtml(d.messages, agentName);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}</title>
<meta name="robots" content="noindex">
<meta name="description" content="Conversación compartida">
${faviconLink()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${THEME_CSS}
  /* ---------- Header (chat) ---------- */
  header { position: sticky; top: 0; z-index: 10; padding: 0; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 86%, transparent); backdrop-filter: blur(12px); }
  .header-inner { max-width: 820px; margin: 0 auto; padding: 16px 20px; display: flex; align-items: center; gap: 16px; }
  .brand { flex: 0 0 auto; display: flex; flex-direction: column; gap: 3px; padding-right: 18px; border-right: 1px solid var(--border); }
  .brandmark { font-family: var(--font-serif); font-size: .8rem; font-weight: 600; letter-spacing: .32em; text-transform: uppercase; color: var(--accent); line-height: 1; }
  .brandsub { font-family: var(--font-ui); font-size: .6rem; letter-spacing: .24em; text-transform: uppercase; color: var(--faint); line-height: 1; }
  .titles { min-width: 0; flex: 1; }
  .titles h1 { margin: 0; font-family: var(--font-serif); font-size: 1.15rem; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: var(--muted); font-size: .78rem; margin-top: 3px; display: flex; flex-wrap: wrap; gap: 0 14px; }
  .meta span { display: inline-flex; align-items: center; gap: 4px; }
  .meta .dot { color: var(--faint); }

  main { max-width: 820px; margin: 0 auto; padding: 32px 20px 48px; display: flex; flex-direction: column; gap: 22px; }
  .row { display: flex; gap: 12px; align-items: flex-start; }
  .row.user { justify-content: flex-end; }
  .avatar { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: .95rem; margin-top: 2px; background: var(--surface-2); border: 1px solid var(--border); }
  .avatar.user { order: 2; }
  .col { display: flex; flex-direction: column; max-width: 82%; }
  .col.right { align-items: flex-end; }
  .who { font-size: .74rem; font-weight: 600; letter-spacing: .03em; color: var(--muted); margin: 1px 6px 5px; }
  .who .name { margin-left: 8px; font-weight: 400; font-style: italic; letter-spacing: 0; color: var(--faint); }
  .bubble { border-radius: 4px 16px 16px 16px; padding: 14px 18px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); font-family: var(--font-serif); font-size: 1.02rem; }
  .bubble.user { background: var(--user-bubble); border-color: var(--user-border); border-radius: 16px 4px 16px 16px; }
  .bubble .body > :first-child { margin-top: 0; }
  .bubble .body > :last-child { margin-bottom: 0; }

  .turn { display: flex; flex-direction: column; gap: 3px; }
  .turn details.fold { margin-left: 44px; }
  details.fold { border: none; background: transparent; overflow: hidden; width: fit-content; max-width: 100%; opacity: .6; }
  details.fold summary { display: flex; align-items: center; gap: 6px; padding: 0; cursor: pointer; list-style: none; user-select: none; }
  details.fold summary::-webkit-details-marker { display: none; }
  details.fold:hover { opacity: 1; }
  .fold-avatar { flex: 0 0 auto; width: 14px; height: 14px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: .5rem; line-height: 1; background: var(--surface-2); border: 1px solid var(--border); }
  .fold-label { font-family: var(--font-ui); font-size: .62rem; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--faint); white-space: nowrap; }
  .fold-label .name { margin-left: 5px; font-weight: 400; text-transform: none; font-style: italic; letter-spacing: 0; color: var(--faint); }
  .chevron { color: var(--faint); font-size: .6rem; transition: transform .15s ease; }
  details.fold[open] .chevron { transform: rotate(90deg); }
  details.fold[open] { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 8px 12px; width: 100%; opacity: 1; }
  details.fold[open] summary { padding-bottom: 6px; }
  details.fold[open] .fold-label { color: var(--muted); }
  details.fold[open] .fold-body > .body { font-family: var(--font-serif); font-size: .9rem; }
  .fold-body > .body > :first-child { margin-top: 0; }
  .fold-body > .body > :last-child { margin-bottom: 0; }

  pre { background: var(--code-bg); border: 1px solid var(--code-border); border-radius: 8px; padding: 12px; overflow-x: auto; margin: 8px 0; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: .88em; }
  code { font-family: var(--font-mono); font-size: .9em; }
  p code, li code { background: var(--surface-2); border: 1px solid var(--border); padding: 2px 5px; border-radius: 4px; }
  blockquote { border-left: 3px solid var(--accent); margin-left: 0; padding-left: 14px; color: var(--muted); }
  table { border-collapse: collapse; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; }
  ul, ol { padding-left: 22px; }

  footer { text-align: center; padding: 26px 24px 40px; }
  footer .footer-inner { max-width: 820px; margin: 0 auto; }
  footer .brandmark { font-size: .62rem; letter-spacing: .34em; }
  footer .rule { width: 44px; height: 2px; background: var(--accent); margin: 12px auto 14px; border-radius: 2px; }
  footer .footnote { font-family: var(--font-ui); font-size: .68rem; letter-spacing: .14em; text-transform: uppercase; color: var(--faint); }

  .locked { max-width: 420px; margin: 60px auto; text-align: center; }
  .locked input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg); font-size: 1rem; margin: 10px 0; font-family: var(--font-ui); }
  .locked button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-size: 1rem; cursor: pointer; font-family: var(--font-ui); }
  .error { color: var(--accent); }
  .placeholder { color: var(--faint); }

  @media (max-width: 600px) {
    .col { max-width: 100%; }
    .header-inner { padding: 12px 14px; gap: 12px; }
    .brand { padding-right: 12px; }
    .brandmark { letter-spacing: .22em; font-size: .7rem; }
    main { padding: 24px 14px 40px; }
  }
</style>
<script>${THEME_SCRIPT}</script>
</head>
<body data-theme-init>
<header>
  <div class="header-inner">
    <div class="brand">
      <span class="brandmark">Chat&nbsp;Share</span>
      <span class="brandsub">VMHQ</span>
    </div>
    <div class="titles">
      <h1>${esc(d.title)}</h1>
      <div class="meta">
        <span>${esc(agentName)}</span>
        <span class="dot">·</span>
        <span>${esc(d.createdAt)}</span>
        <span class="dot">·</span>
        <span>${d.views} vistas</span>
      </div>
    </div>
    ${themeToggleHtml()}
  </div>
</header>
<main>
  ${messagesHtml}
</main>
<footer>
  <div class="footer-inner">
    <div class="brandmark">Chat&nbsp;Share</div>
    <div class="rule"></div>
    <div class="footnote">VMHQ</div>
  </div>
</footer>
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
${faviconLink()}
${FONT_LINKS}
<style>
${THEME_CSS}
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-ui); display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { width: 100%; max-width: 400px; padding: 36px 32px; text-align: center; }
  .brandmark { font-family: var(--font-serif); font-size: .7rem; font-weight: 600; letter-spacing: .3em; text-transform: uppercase; color: var(--accent); }
  .card h1 { font-family: var(--font-serif); font-size: 1.15rem; margin: 18px 0 6px; }
  .card p { color: var(--muted); font-size: .9rem; margin: 0 0 8px; }
  .card input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg); font-size: 1rem; margin: 14px 0; font-family: var(--font-ui); }
  .card button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-size: 1rem; cursor: pointer; font-family: var(--font-ui); }
  .error { color: var(--accent); font-size: .85rem; }
  .theme-wrap { position: fixed; top: 16px; right: 16px; }
</style>
<script>${THEME_SCRIPT}</script>
</head>
<body data-theme-init>
<div class="theme-wrap">${themeToggleHtml()}</div>
<div class="card">
  <div class="brandmark">Chat&nbsp;Share</div>
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

export function gonePageHtml(reason: "expired" | "revoked" | "suspended"): string {
  const title =
    reason === "expired"
      ? "Este enlace ha expirado"
      : reason === "suspended"
        ? "Este enlace no está disponible"
        : "Este enlace ha sido eliminado";
  const msg =
    reason === "expired"
      ? "El período de publicación de esta conversación terminó."
      : reason === "suspended"
        ? "El autor suspendió esta conversación temporalmente."
        : "El autor retiró este enlace.";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
${faviconLink()}
${FONT_LINKS}
<style>
${THEME_CSS}
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-ui); display: flex; min-height: 100vh; align-items: center; justify-content: center; text-align: center; }
  .card { max-width: 420px; padding: 32px; }
  .big { font-size: 3rem; }
  .card h1 { font-family: var(--font-serif); font-size: 1.25rem; }
  .card p { color: var(--muted); }
  .theme-wrap { position: fixed; top: 16px; right: 16px; }
</style>
<script>${THEME_SCRIPT}</script>
</head>
<body data-theme-init>
<div class="theme-wrap">${themeToggleHtml()}</div>
<div class="card">
  <div class="big">${reason === "expired" ? "⏳" : "🚫"}</div>
  <h1>${title}</h1>
  <p>${msg}</p>
</div>
</body>
</html>`;
}
