// Tema compartido (estética editorial "Marginalia") para las vistas públicas y admin.
// Modos: light | dark | system. El toggle muestra UN solo icono (el activo) y cicla.

export const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cg%20clip-path%3D%22url%28%23clip0_378_9639%29%22%3E%3Cpath%20d%3D%22M12%2024C18.6274%2024%2024%2018.6274%2024%2012C24%205.37258%2018.6274%200%2012%200C5.37258%200%200%205.37258%200%2012C0%2018.6274%205.37258%2024%2012%2024Z%22%20fill%3D%22%232781F6%22%2F%3E%3Cpath%20d%3D%22M17.1256%2017.1258H11.5622C8.4955%2017.1258%205.99976%2014.6299%205.99976%2011.5624C8.4955%206%2011.5623%206C14.6298%206%2017.1256%208.49591%2017.1256%2011.5624V17.1258Z%22%20fill%3D%22white%22%20stroke%3D%22white%22%20stroke-width%3D%220.28125%22%2F%3E%3C%2Fg%3E%3Cdefs%3E%3CclipPath%20id%3D%22clip0_378_9639%22%3E%3Crect%20width%3D%2224%22%20height%3D%2224%22%20fill%3D%22white%22%2F%3E%3C%2FclipPath%3E%3C%2Fdefs%3E%3C%2Fsvg%3E";

export function faviconLink(): string {
  return `<link rel="icon" type="image/svg+xml" href="${FAVICON}">`;
}

export const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;

// Variables de tema + estilos del toggle de un solo botón.
export const THEME_CSS = `
:root {
  color-scheme: light dark;
  --font-ui: "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --font-serif: "Lora", Georgia, "Times New Roman", serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
html[data-theme="light"] {
  color-scheme: light;
  --bg: #f5f8f9; --fg: #15262b; --muted: #5c7277; --faint: #93a8ac;
  --surface: #ffffff; --surface-2: #ecf3f4; --border: #d8e4e6; --border-strong: #c2d4d7;
  --accent: #0e8f9e; --accent-strong: #0b7a87; --accent-soft: rgba(14,143,158,.1);
  --user-bubble: #d9ecee; --user-border: #b8dade;
  --code-bg: #eff5f6; --code-border: #dbe7e9;
  --shadow: 0 1px 2px rgba(21,38,43,.05), 0 8px 28px rgba(21,38,43,.07);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0d171a; --fg: #d9e8ea; --muted: #8aa3a8; --faint: #5c7075;
  --surface: #142327; --surface-2: #1b2e33; --border: #244046; --border-strong: #33555a;
  --accent: #22d3ee; --accent-strong: #67e8f9; --accent-soft: rgba(34,211,238,.12);
  --user-bubble: #0f2830; --user-border: #1c4450;
  --code-bg: #0a1214; --code-border: #1e3237;
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.38);
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--font-ui); line-height: 1.6; transition: background .25s ease, color .25s ease; }
a { color: var(--accent); }

/* Botón único de tema: muestra solo el icono activo, cicla al hacer click. */
.theme-btn { flex: 0 0 auto; width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--fg); font-size: 1.05rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform .15s ease, border-color .2s ease, background .2s ease; }
.theme-btn:hover { border-color: var(--accent); transform: rotate(20deg); }
`;

// El botón solo (el script le pone el icono activo).
export function themeToggleHtml(): string {
  return `<button type="button" id="theme-btn" class="theme-btn" title="Cambiar tema"></button>`;
}

// Script: aplica el tema antes del paint (sin FOUC), cicla system→light→dark, y
// actualiza el icono único del botón. Persiste en localStorage.
export const THEME_SCRIPT = `
(function () {
  var ICONS = { system: "💻", light: "☀️", dark: "🌙" };
  var ORDER = ["system", "light", "dark"];
  var stored = null;
  try { stored = localStorage.getItem("cs-theme"); } catch (e) {}
  if (ORDER.indexOf(stored) === -1) stored = "system";
  function resolve(theme) {
    if (theme !== "system") return theme;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  function apply(theme) {
    document.documentElement.setAttribute("data-theme", resolve(theme));
  }
  // Aplica el tema antes del primer paint (sin FOUC).
  apply(stored);
  function setIcon(theme) {
    var btn = document.getElementById("theme-btn");
    if (btn) btn.textContent = ICONS[theme] || ICONS.system;
  }
  function wireButton() {
    var btn = document.getElementById("theme-btn");
    if (!btn) return;
    setIcon(stored);
    btn.addEventListener("click", function () {
      var i = ORDER.indexOf(stored);
      stored = ORDER[(i + 1) % ORDER.length];
      try { localStorage.setItem("cs-theme", stored); } catch (e) {}
      apply(stored);
      setIcon(stored);
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireButton);
  } else {
    wireButton();
  }
  if (stored === "system" && window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { apply("system"); });
  }
})();
`;
