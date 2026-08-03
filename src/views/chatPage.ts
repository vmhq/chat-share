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

const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cg%20clip-path%3D%22url%28%23clip0_378_9639%29%22%3E%3Cpath%20d%3D%22M12%2024C18.6274%2024%2024%2018.6274%2024%2012C24%205.37258%2018.6274%200%2012%200C5.37258%200%200%205.37258%200%2012C0%2018.6274%205.37258%2024%2012%2024Z%22%20fill%3D%22%232781F6%22%2F%3E%3Cpath%20d%3D%22M17.1256%2017.1258H11.5622C8.4955%2017.1258%205.99976%2014.6299%205.99976%2011.5624C8.4955%206%2011.5623%206C14.6298%206%2017.1256%208.49591%2017.1256%2011.5624V17.1258Z%22%20fill%3D%22white%22%20stroke%3D%22white%22%20stroke-width%3D%220.28125%22%2F%3E%3C%2Fg%3E%3Cdefs%3E%3CclipPath%20id%3D%22clip0_378_9639%22%3E%3Crect%20width%3D%2224%22%20height%3D%2224%22%20fill%3D%22white%22%2F%3E%3C%2FclipPath%3E%3C%2Fdefs%3E%3C%2Fsvg%3E";

function faviconLink(): string {
  return `<link rel="icon" type="image/svg+xml" href="${FAVICON}">`;
}

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
  /* ---------- Tema editorial (Marginalia) ---------- */
  :root {
    color-scheme: light dark;
    --font-ui: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    --font-serif: "Lora", Georgia, "Times New Roman", serif;
    --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  html[data-theme="light"] {
    color-scheme: light;
    --bg: #faf9f6;
    --fg: #211f1b;
    --muted: #6f6a5e;
    --faint: #9a948a;
    --surface: #ffffff;
    --surface-2: #f2f0ea;
    --border: #e6e2d9;
    --border-strong: #d4cfc3;
    --accent: #c2410c;
    --accent-soft: rgba(194, 65, 12, .08);
    --user-bubble: #efe6d8;
    --user-border: #e0d2bc;
    --code-bg: #f4f2ec;
    --code-border: #e2ddd2;
    --shadow: 0 1px 2px rgba(33,31,27,.05), 0 6px 20px rgba(33,31,27,.06);
  }
  html[data-theme="dark"] {
    color-scheme: dark;
    --bg: #14130f;
    --fg: #e8e5df;
    --muted: #a29c8e;
    --faint: #6f6a5e;
    --surface: #1c1a16;
    --surface-2: #24211c;
    --border: #2c2923;
    --border-strong: #3a362e;
    --accent: #f97316;
    --accent-soft: rgba(249,115,22,.12);
    --user-bubble: #2b2518;
    --user-border: #463a24;
    --code-bg: #100f0c;
    --code-border: #2a2720;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-ui); line-height: 1.65; transition: background .25s ease, color .25s ease; }
  a { color: var(--accent); }

  header { position: sticky; top: 0; z-index: 10; padding: 14px 24px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 85%, transparent); backdrop-filter: blur(10px); }
  .header-inner { max-width: 820px; margin: 0 auto; display: flex; align-items: center; gap: 14px; }
  .brandmark { flex: 0 0 auto; font-family: var(--font-serif); font-size: .72rem; font-weight: 600; letter-spacing: .42em; text-transform: uppercase; color: var(--accent); transform: translateX(.42em); }
  .titles { min-width: 0; flex: 1; }
  .titles h1 { margin: 0; font-family: var(--font-serif); font-size: 1.2rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: var(--muted); font-size: .8rem; margin-top: 2px; }
  .meta span { margin-right: 14px; }

  .theme-toggle { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; border: 1px solid var(--border); border-radius: 999px; padding: 3px; background: var(--surface); }
  .theme-toggle button { border: 0; background: transparent; cursor: pointer; width: 28px; height: 28px; border-radius: 999px; font-size: .95rem; display: flex; align-items: center; justify-content: center; color: var(--faint); transition: background .15s ease; }
  .theme-toggle button.active { background: var(--surface-2); color: var(--fg); }
  .theme-toggle button:hover { color: var(--fg); }

  main { max-width: 820px; margin: 0 auto; padding: 28px 16px 48px; display: flex; flex-direction: column; gap: 22px; }
  .row { display: flex; gap: 12px; align-items: flex-start; }
  .row.user { justify-content: flex-end; }
  .avatar { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; margin-top: 2px; background: var(--surface-2); border: 1px solid var(--border); }
  .avatar.user { order: 2; }
  .col { display: flex; flex-direction: column; max-width: 82%; }
  .col.right { align-items: flex-end; }
  .who { font-size: .78rem; font-weight: 600; letter-spacing: .02em; color: var(--muted); margin: 2px 6px 5px; }
  .who .name { margin-left: 8px; font-weight: 400; font-style: italic; color: var(--faint); }
  .bubble { border-radius: 4px 14px 14px 14px; padding: 14px 18px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); font-family: var(--font-serif); font-size: 1.02rem; }
  .bubble.user { background: var(--user-bubble); border-color: var(--user-border); border-radius: 14px 4px 14px 14px; }
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

  footer { text-align: center; font-family: var(--font-serif); font-size: .66rem; letter-spacing: .4em; text-transform: uppercase; color: var(--faint); padding: 28px 24px 36px; transform: translateX(.2em); }

  .locked { max-width: 420px; margin: 60px auto; text-align: center; }
  .locked input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--fg); font-size: 1rem; margin: 10px 0; font-family: var(--font-ui); }
  .locked button { width: 100%; padding: 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font-size: 1rem; cursor: pointer; font-family: var(--font-ui); }
  .error { color: var(--accent); }
  .placeholder { color: var(--faint); }

  @media (max-width: 600px) {
    .col { max-width: 100%; }
    header { padding: 10px 14px; }
    main { padding: 20px 12px 40px; }
  }
</style>
<script>
  (function () {
    // Tema: light | dark | system. Aplica antes del primer paint (evita FOUC).
    var stored = null;
    try { stored = localStorage.getItem("cs-theme"); } catch (e) {}
    if (!stored) stored = "system";
    function apply(theme) {
      var resolved = theme === "system"
        ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      document.documentElement.setAttribute("data-theme", resolved);
    }
    apply(stored);
    window.__csSetTheme = function (theme) {
      try { localStorage.setItem("cs-theme", theme); } catch (e) {}
      apply(theme);
      // Marca el botón activo
      document.querySelectorAll(".theme-toggle button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.theme === theme);
      });
    };
    // Reacciona a cambios de preferencia del sistema cuando está en modo "system".
    if (stored === "system" && window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        apply("system");
      });
    }
  })();
</script>
</head>
<body data-theme-init>
<header>
  <div class="header-inner">
    <div class="brandmark">Chat&nbsp;Share</div>
    <div class="titles">
      <h1>${esc(d.title)}</h1>
      <div class="meta">
        <span>${esc(agentName)}</span>
        <span>${esc(d.createdAt)}</span>
        <span>${d.views} vistas</span>
      </div>
    </div>
    <div class="theme-toggle" role="group" aria-label="Tema">
      <button type="button" data-theme="light" title="Modo claro" onclick="window.__csSetTheme('light')">☀️</button>
      <button type="button" data-theme="dark" title="Modo oscuro" onclick="window.__csSetTheme('dark')">🌙</button>
      <button type="button" data-theme="system" title="Seguir sistema" onclick="window.__csSetTheme('system')">💻</button>
    </div>
  </div>
</header>
<main>
  ${messagesHtml}
</main>
<footer>Chat&nbsp;Share&nbsp;·&nbsp;VMHQ</footer>
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
${faviconLink()}
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
