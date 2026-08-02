import type { SharedChatRow } from "../db";
import { availability, parseMessages } from "../service";

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
  revoked: "🚫",
};

export function adminPageHtml(rows: AdminViewRow[], userEmail: string | undefined, baseUrl: string, csrf: string): string {
  const trs = rows
    .map((v) => {
      const r = v.row;
      const url = `${baseUrl}/s/${r.id}`;
      const created = new Date(r.created_at).toLocaleString("es-CL", { timeZone: TZ });
      const expires = r.expires_at ? new Date(r.expires_at).toLocaleString("es-CL", { timeZone: TZ }) : "nunca";
      return `<tr>
        <td><a href="${esc(url)}" target="_blank" rel="noopener">${esc(r.title)}</a><br><span class="dim">${esc(r.id)}</span></td>
        <td>${esc(r.agent)}</td>
        <td>${esc(created)}</td>
        <td>${esc(expires)}</td>
        <td>${r.views}</td>
        <td>${r.password_hash ? "🔒" : "—"}</td>
        <td><span class="badge ${v.status}">${STATUS_BADGE[v.status] ?? "•"} ${v.status}</span></td>
        <td class="actions">
          <button class="copy" data-url="${esc(url)}">Copiar</button>
          ${v.status !== "revoked" ? `<form method="post" action="/admin/chats/${esc(r.id)}/revoke" class="inline"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="danger" type="submit">Revocar</button></form>` : ""}
        </td>
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
<title>chat-share · Panel admin</title>
<meta name="robots" content="noindex">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f1115; color: #e6e6e6; font-family: system-ui, sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: #16181f; border-bottom: 1px solid #23262e; }
  header h1 { font-size: 1.15rem; margin: 0; }
  header .user { color: #8b93a1; font-size: .9rem; }
  header a.logout { color: #ff7a7a; text-decoration: none; margin-left: 14px; font-size: .85rem; }
  main { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
  table { width: 100%; border-collapse: collapse; background: #171a21; border-radius: 12px; overflow: hidden; }
  th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #23262e; vertical-align: top; }
  th { background: #1b1e26; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #8b93a1; }
  tr:last-child td { border-bottom: 0; }
  .dim { color: #5b6270; font-size: .8rem; }
  .badge { padding: 2px 8px; border-radius: 20px; font-size: .75rem; white-space: nowrap; }
  .badge.active { background: #14351f; color: #7ee0a3; }
  .badge.expired { background: #33250f; color: #f0b26b; }
  .badge.revoked { background: #331717; color: #ff7a7a; }
  .actions { white-space: nowrap; }
  .actions form.inline { display: inline; }
  button { padding: 6px 12px; border: 0; border-radius: 6px; cursor: pointer; font-size: .8rem; }
  button.copy { background: #23262e; color: #e6e6e6; }
  button.danger { background: #4a1f1f; color: #ff9b9b; margin-left: 6px; }
  .empty { text-align: center; color: #5b6270; padding: 40px; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1d4a2a; color: #e6e6e6; padding: 10px 20px; border-radius: 8px; opacity: 0; transition: opacity .3s; }
  .toast.show { opacity: 1; }
  @media (max-width: 800px) { table { font-size: .85rem; } th:nth-child(2), td:nth-child(2) { display: none; } }
</style>
</head>
<body>
<header>
  <h1>🖥️ chat-share · Panel de administración</h1>
  <div class="user">${userEmail ? esc(userEmail) : ""} <a class="logout" href="/admin/logout">Cerrar sesión</a></div>
</header>
<main>
  <table>
    <thead><tr>
      <th>Título / ID</th><th>Agente</th><th>Creado</th><th>Expira</th><th>Vistas</th><th>🔒</th><th>Estado</th><th>Acciones</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
</main>
<div id="toast" class="toast"></div>
<script>
  document.querySelectorAll('button.copy').forEach(function(b){
    b.addEventListener('click', function(){
      navigator.clipboard.writeText(b.dataset.url).then(function(){
        var t = document.getElementById('toast');
        t.textContent = 'URL copiada al portapapeles';
        t.classList.add('show');
        setTimeout(function(){ t.classList.remove('show'); }, 1800);
      });
    });
  });
</script>
</body>
</html>`;
}
