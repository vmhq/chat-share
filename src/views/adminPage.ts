import type { SharedChatRow } from "../db";
import { availability, parseMessages } from "../service";
import { FAVICON, FONT_LINKS, THEME_CSS, THEME_SCRIPT, themeToggleHtml } from "./theme";

export interface AdminViewRow {
  row: SharedChatRow;
  status: string;
  messageCount: number;
  messagesPreview: string;
}

export function buildRows(rows: SharedChatRow[]): AdminViewRow[] {
  return rows.map((r) => {
    const { status } = availability(r);
    const msgs = parseMessages(r);
    const preview =
      msgs[0]?.content && typeof msgs[0].content === "string"
        ? msgs[0].content.slice(0, 80)
        : "";
    return { row: r, status, messageCount: msgs.length, messagesPreview: preview };
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);
}

// Zona horaria de visualización (Chile continental).
const TZ = "America/Santiago";

const STATUS_BADGE: Record<string, string> = {
  active: "🟢",
  expired: "⏳",
  suspended: "🚫",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Activa",
  expired: "Expirada",
  suspended: "Suspendida",
};

export function adminPageHtml(rows: AdminViewRow[], userEmail: string | undefined, baseUrl: string, csrf: string): string {
  const trs = rows
    .map((v) => {
      const r = v.row;
      const url = `${baseUrl}/s/${r.id}`;
      const created = new Date(r.created_at).toLocaleString("es-CL", { timeZone: TZ });
      const expires = r.expires_at ? new Date(r.expires_at).toLocaleString("es-CL", { timeZone: TZ }) : "nunca";
      const isSuspended = v.status === "suspended";
      const actions = [];
      actions.push(`<button class="copy" type="button" data-url="${esc(url)}" aria-label="Copiar enlace de ${esc(r.title)}">Copiar enlace</button>`);
      if (v.status === "active") {
        actions.push(`<form method="post" action="/admin/chats/${esc(r.id)}/suspend" class="inline"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="warn" type="submit" aria-label="Suspender ${esc(r.title)}">Suspender</button></form>`);
      } else if (isSuspended) {
        actions.push(`<form method="post" action="/admin/chats/${esc(r.id)}/activate" class="inline"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="copy" type="submit" aria-label="Reactivar ${esc(r.title)}">Reactivar</button></form>`);
      }
      actions.push(`<form method="post" action="/admin/chats/${esc(r.id)}/delete" class="inline" onsubmit="return confirm('¿Eliminar definitivamente «${esc(r.title)}»? Esta acción no se puede deshacer.');"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="danger" type="submit" aria-label="Eliminar ${esc(r.title)}">Eliminar</button></form>`);
      return `<tr>
        <td><a href="${esc(url)}" target="_blank" rel="noopener">${esc(r.title)}</a><br><span class="dim">${esc(r.id)}</span></td>
        <td>${esc(r.agent)}</td>
        <td data-label="Creado">${esc(created)}</td>
        <td data-label="Expira">${esc(expires)}</td>
        <td data-label="Vistas">${r.views}</td>
        <td data-label="Protegida">${r.password_hash ? "Sí" : "No"}</td>
        <td data-label="Estado"><span class="badge ${v.status}" aria-label="Estado: ${STATUS_LABEL[v.status] ?? v.status}">${STATUS_BADGE[v.status] ?? "•"} ${STATUS_LABEL[v.status] ?? v.status}</span></td>
        <td class="actions">${actions.join(" ")}</td>
      </tr>`;
    })
    .join("");

  const body = rows.length === 0
    ? `<tr><td colspan="8" class="empty">Aún no hay conversaciones compartidas.</td></tr>`
    : trs;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat Share - Panel de administración</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
${FONT_LINKS}
<style>
${THEME_CSS}
  header { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 86%, transparent); backdrop-filter: blur(12px); }
  .header-inner { max-width: 1100px; margin: 0 auto; padding: 16px 20px; display: flex; align-items: center; gap: 16px; }
  .brand { flex: 0 0 auto; display: flex; flex-direction: column; gap: 3px; padding-right: 18px; border-right: 1px solid var(--border); }
  .brandmark { font-family: var(--font-serif); font-size: .8rem; font-weight: 600; letter-spacing: .32em; text-transform: uppercase; color: var(--accent); line-height: 1; }
  .brandsub { font-family: var(--font-ui); font-size: .6rem; letter-spacing: .24em; text-transform: uppercase; color: var(--faint); line-height: 1; }
  .titles { min-width: 0; flex: 1; }
  .titles h1 { margin: 0; font-family: var(--font-serif); font-size: 1.15rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .titles .sub { color: var(--muted); font-size: .76rem; margin-top: 2px; }
  .right { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; }
  .user { color: var(--muted); font-size: .86rem; }
  a.logout { color: var(--accent); text-decoration: none; font-size: .85rem; padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; }
  a.logout:hover { border-color: var(--accent); }
  main { max-width: 1100px; margin: 28px auto 60px; padding: 0 20px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow-x: auto; box-shadow: var(--shadow); }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 13px 16px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); background: var(--surface-2); }
  tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: var(--surface-2); }
  td a { color: var(--fg); text-decoration: none; }
  td a:hover { color: var(--accent); }
  .dim { color: var(--faint); font-size: .8rem; }
  .badge { padding: 2px 10px; border-radius: 20px; font-size: .72rem; white-space: nowrap; font-weight: 500; }
  .badge.active { background: color-mix(in srgb, var(--success) 16%, transparent); color: var(--success); }
  .badge.expired { background: color-mix(in srgb, var(--warning) 16%, transparent); color: var(--warning); }
  .badge.suspended { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
  .actions { white-space: nowrap; min-width: 250px; }
  .actions form.inline { display: inline; }
  button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-size: .78rem; font-family: var(--font-ui); background: var(--surface); color: var(--fg); }
  button:hover { border-color: var(--accent); }
  button.warn { border-color: color-mix(in srgb, var(--warning) 40%, transparent); color: var(--warning); margin-left: 6px; }
  button.warn:hover { background: color-mix(in srgb, var(--warning) 12%, transparent); }
  button.danger { border-color: color-mix(in srgb, var(--danger) 40%, transparent); color: var(--danger); margin-left: 6px; }
  button.danger:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); }
  .empty { text-align: center; color: var(--faint); padding: 44px; }
  footer { text-align: center; padding: 26px 24px 40px; }
  footer .brandmark { font-size: .6rem; letter-spacing: .32em; }
  footer .rule { width: 44px; height: 2px; background: var(--accent); margin: 12px auto 14px; border-radius: 2px; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--surface-2); color: var(--fg); border: 1px solid var(--border); padding: 10px 20px; border-radius: 8px; opacity: 0; transition: opacity .3s; box-shadow: var(--shadow); }
  .toast.show { opacity: 1; }
  @media (max-width: 800px) {
    .header-inner { padding: 12px 14px; gap: 10px; }
    .brand { border-right: 0; padding-right: 0; }
    .brandsub { display: none; }
    .right { gap: 8px; }
    .user { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    a.logout { padding: 9px 10px; }
    table { min-width: 760px; font-size: .85rem; }
    th:nth-child(2), td:nth-child(2) { display: none; }
    .card { border-radius: 10px; }
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
      <h1>Panel de administración</h1>
      <div class="sub">Conversaciones compartidas</div>
    </div>
    <div class="right">
      <span class="user">${userEmail ? esc(userEmail) : ""}</span>
      ${themeToggleHtml()}
      <a class="logout" href="/admin/logout">Cerrar sesión</a>
    </div>
  </div>
</header>
<main>
  <div class="card">
    <table aria-label="Conversaciones compartidas">
      <thead><tr>
        <th scope="col">Título / ID</th><th scope="col">Agente</th><th scope="col">Creado</th><th scope="col">Expira</th><th scope="col">Vistas</th><th scope="col">Protegida</th><th scope="col">Estado</th><th scope="col">Acciones</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</main>
<footer>
  <div class="brandmark">Chat&nbsp;Share</div>
  <div class="rule"></div>
</footer>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
  function showToast(message) {
    var t = document.getElementById('toast');
    t.textContent = message;
    t.classList.add('show');
    setTimeout(function(){ t.classList.remove('show'); }, 2200);
  }
  document.querySelectorAll('button.copy').forEach(function(b){
    b.addEventListener('click', function(){
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        showToast('No se pudo copiar; copia el enlace manualmente.');
        return;
      }
      navigator.clipboard.writeText(b.dataset.url).then(function(){
        showToast('URL copiada al portapapeles');
      }).catch(function(){
        showToast('No se pudo copiar; copia el enlace manualmente.');
      });
    });
  });
</script>
</body>
</html>`;
}
