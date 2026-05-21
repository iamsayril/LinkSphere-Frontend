const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ─── Pulse animation ──────────────────────────────────────────────────────────

const style = document.createElement('style');
style.textContent = `
  .pulse { animation: quickPulse .45s ease both !important; }
  @keyframes quickPulse {
    0%   { transform: scale(1); }
    45%  { transform: scale(.985); box-shadow: 4px 4px 0 #000; }
    100% { transform: scale(1); }
  }
`;
document.head.appendChild(style);

function attachPulse() {}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('token');
}

function getUser() {
  return JSON.parse(localStorage.getItem('user') || 'null');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  }).toUpperCase();
}

function formatTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit'
  }).toUpperCase();
}

function getIconClass(action_type) {
  switch (action_type) {
    case 'channel_created':
    case 'channel_deleted':
    case 'channel_renamed':  return 'message';
    case 'member_joined':
    case 'member_removed':   return 'user-add';
    case 'role_updated':     return 'shield';
    case 'message_deleted':  return 'message';
    default:                 return 'message';
  }
}

function getDescription(log) {
  return escapeHtml(log.description || log.action_type);
}

// ─── Render Logs ──────────────────────────────────────────────────────────────

function renderLogs(logs) {
  const content = document.getElementById('audit-content');

  if (!logs.length) {
    content.innerHTML = `
      <div style="text-align:center;padding:60px 0;font-size:13px;font-weight:700;letter-spacing:0.1em;opacity:0.4;">
        NO AUDIT LOGS YET
      </div>`;
    return;
  }

  // Group by date
  const groups = {};
  logs.forEach(log => {
    const date = formatDate(log.created_at);
    if (!groups[date]) groups[date] = [];
    groups[date].push(log);
  });

  let delay = 0.08;
  content.innerHTML = Object.entries(groups).map(([date, items]) => `
    <section class="date-group">
      <h2>${date}</h2>
      ${items.map(log => {
        const name = (log.actor_name || 'Unknown').toUpperCase();
        const initial = name.charAt(0);
        const icon = getIconClass(log.action_type);
        const time = formatTime(log.created_at);
        const d = (delay += 0.1).toFixed(2);
        const avatarUrl = log.user?.avatar_url || log.avatar_url || null;
        const avatarHtml = avatarUrl
          ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" />`
          : initial;
        return `
          <article class="log-card" style="--delay: ${d}s">
            <div class="avatar-wrap">
              <span class="avatar-name">${escapeHtml(name)}</span>
              <div class="avatar">${avatarHtml}</div>
            </div>
            <div class="log-content">
              <div class="log-top">
                <span class="name" style="visibility:hidden;"></span>
                <span class="icon ${icon}" aria-hidden="true"></span>
              </div>
              <p>${getDescription(log)}</p>
              <time>${time}</time>
            </div>
          </article>
        `;
      }).join('')}
    </section>
  `).join('');

  attachPulse();
}

// ─── Load Workspaces ──────────────────────────────────────────────────────────

async function loadWorkspaces() {
  const token = getToken();
  const me    = getUser();
  if (!token || !me) return;

  const loading  = document.getElementById('audit-loading');
  const wsSelect = document.getElementById('audit-workspace-select');
  const select   = document.getElementById('workspace-select');

  try {
    const res  = await fetch(`${API_BASE}/workspaces`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) { loading.textContent = 'Failed to load workspaces.'; return; }

    // Only show workspaces where user is owner
    const owned = data.filter(ws => ws.user_id === me.user_id);

    loading.style.display = 'none';

    if (!owned.length) {
      document.getElementById('audit-content').innerHTML = `
        <div style="text-align:center;padding:60px 0;font-size:13px;font-weight:700;letter-spacing:0.1em;opacity:0.4;">
          YOU DON'T OWN ANY WORKSPACES
        </div>`;
      return;
    }

    // Populate select
    owned.forEach(ws => {
      const opt = document.createElement('option');
      opt.value       = ws.workspace_id;
      opt.textContent = ws.name.toUpperCase();
      select.appendChild(opt);
    });

    wsSelect.style.display = 'block';

    // Auto-load first workspace
    loadAuditLogs(owned[0].workspace_id);
    select.value = owned[0].workspace_id;

    select.addEventListener('change', () => {
      if (select.value) loadAuditLogs(select.value);
    });

  } catch (err) {
    loading.textContent = 'Could not reach server.';
    console.error(err);
  }
}

// ─── Load Audit Logs ──────────────────────────────────────────────────────────

async function loadAuditLogs(workspaceId) {
  const token = getToken();
  if (!token) return;

  const content = document.getElementById('audit-content');
  content.innerHTML = `
    <div style="text-align:center;padding:60px 0;font-size:13px;font-weight:700;letter-spacing:0.1em;opacity:0.4;">
      LOADING...
    </div>`;

  try {
    const res  = await fetch(`${API_BASE}/audit-logs/${workspaceId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) { content.innerHTML = `<p style="text-align:center;opacity:0.4;">${data.error}</p>`; return; }
    renderLogs(data);
  } catch (err) {
    content.innerHTML = `<p style="text-align:center;opacity:0.4;">Could not reach server.</p>`;
    console.error(err);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

loadWorkspaces();