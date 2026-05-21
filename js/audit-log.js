const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ── Sidebar ────────────────────────────────────────────────────
const menuBtn        = document.getElementById('menu-btn');
const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarClose   = document.getElementById('sidebar-close');

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('show');
  document.body.style.overflow = '';
}

menuBtn.addEventListener('click', openSidebar);
sidebarClose.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', function () {
    if (this.id === 'nav-logout') return;
    closeSidebar();
  });
});

const navLogout = document.getElementById('nav-logout');
if (navLogout) {
  navLogout.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setTimeout(() => { window.location.href = 'login.html'; }, 200);
  });
}

const navMessages = document.getElementById('nav-messages');
if (navMessages) {
  navMessages.addEventListener('click', (e) => {
    e.preventDefault();
    closeSidebar();
    setTimeout(() => { window.location.href = 'messages.html'; }, 200);
  });
}

const navWorkspace = document.getElementById('nav-workspace');
if (navWorkspace) {
  navWorkspace.addEventListener('click', (e) => {
    e.preventDefault();
    closeSidebar();
    setTimeout(() => { window.location.href = 'workspace.html'; }, 200);
  });
}

// ── Load sidebar user info ────────────────────────────────────
async function loadSidebarUser() {
  const user = getUser();
  if (!user) return;

  const userNameEl = document.getElementById('sidebar-user-name');
  const avatarEl = document.getElementById('sidebar-avatar');

  if (userNameEl) userNameEl.textContent = (user.username || 'User').toUpperCase();
  
  if (avatarEl) {
    const initial = (user.username || '?').charAt(0).toUpperCase();
    if (user.avatar_url) {
      avatarEl.innerHTML = `<img src="${user.avatar_url}" alt="${user.username}" />`;
    } else {
      avatarEl.textContent = initial;
    }
  }
}

// ── Pulse animation ────────────────────────────────────────────
const _style = document.createElement('style');
_style.textContent = `
  .pulse { animation: quickPulse .45s ease both !important; }
  @keyframes quickPulse {
    0%   { transform: scale(1); }
    45%  { transform: scale(.985); box-shadow: 4px 4px 0 #000; }
    100% { transform: scale(1); }
  }
`;
document.head.appendChild(_style);

// ── Auth ───────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('token');
const getUser  = () => JSON.parse(localStorage.getItem('user') || 'null');

// ── Helpers ────────────────────────────────────────────────────
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  }).toUpperCase();
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit'
  }).toUpperCase();
}

function getIconClass(action_type) {
  switch (action_type) {
    case 'channel_created':
    case 'channel_renamed':  return 'message';
    case 'channel_deleted':
    case 'message_deleted':  return 'trash';
    case 'member_joined':
    case 'member_removed':   return 'user-add';
    case 'role_updated':     return 'shield';
    default:                 return 'message';
  }
}

function getDescription(log) {
  return escapeHtml(log.description || log.action_type);
}

// ── Render logs ────────────────────────────────────────────────
function renderLogs(logs) {
  const content = document.getElementById('audit-content');

  if (!logs.length) {
    content.innerHTML = `<div class="state-msg">No audit logs yet</div>`;
    return;
  }

  // Group by date
  const groups = {};
  logs.forEach(log => {
    const key = formatDate(log.created_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  });

  let delay = 0;
  content.innerHTML = Object.entries(groups).map(([date, items]) => `
    <section class="date-group">
      <h2>${date}</h2>
      ${items.map(log => {
        const name      = (log.actor_name || 'Unknown').toUpperCase();
        const initial   = name.charAt(0);
        const icon      = getIconClass(log.action_type);
        const time      = formatTime(log.created_at);
        const d         = (delay += 0.08).toFixed(2);
        const avatarUrl = log.user?.avatar_url || log.avatar_url || null;
        const avatarHtml = avatarUrl
          ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" />`
          : escapeHtml(initial);

        return `
          <article class="log-card" style="--delay:${d}s">
            <div class="card-left">
              <div class="avatar-wrap">
                <span class="avatar-name">${escapeHtml(name)}</span>
                <div class="avatar">${avatarHtml}</div>
              </div>
              <div class="log-content">
                <p>${getDescription(log)}</p>
                <time>${time}</time>
              </div>
            </div>
            <span class="icon ${icon}" aria-hidden="true"></span>
          </article>
        `;
      }).join('')}
    </section>
  `).join('');
}

// ── Load workspaces ────────────────────────────────────────────
async function loadWorkspaces() {
  const token    = getToken();
  const me       = getUser();
  const loading  = document.getElementById('audit-loading');
  const wsSelect = document.getElementById('audit-workspace-select');
  const select   = document.getElementById('workspace-select');

  if (!token || !me) {
    loading.textContent = 'NOT AUTHENTICATED';
    return;
  }

  // ID passed from server-settings.js via sessionStorage
  const preselectedId = sessionStorage.getItem('audit_ws_id') || null;

  try {
    const res  = await fetch(`${API_BASE}/workspaces`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    loading.style.display = 'none';

    if (!res.ok) {
      document.getElementById('audit-content').innerHTML =
        `<div class="state-msg">Failed to load workspaces</div>`;
      return;
    }

    const owned = data.filter(ws => ws.user_id === me.user_id);

    if (!owned.length) {
      document.getElementById('audit-content').innerHTML =
        `<div class="state-msg">You don't own any workspaces</div>`;
      return;
    }

    owned.forEach(ws => {
      const opt = document.createElement('option');
      opt.value       = ws.workspace_id;
      opt.textContent = ws.name.toUpperCase();
      select.appendChild(opt);
    });

    wsSelect.style.display = 'block';

    // Pre-select the workspace that was active in server settings, or fall back to first
    const target = preselectedId && owned.find(ws => ws.workspace_id === preselectedId)
      ? preselectedId
      : owned[0].workspace_id;

    select.value = target;
    loadAuditLogs(target);

    // Clear the passed ID now that we've consumed it
    sessionStorage.removeItem('audit_ws_id');

    select.addEventListener('change', () => {
      if (select.value) loadAuditLogs(select.value);
    });

  } catch (err) {
    document.getElementById('audit-loading').textContent = 'COULD NOT REACH SERVER';
    console.error(err);
  }
}

// ── Load audit logs ────────────────────────────────────────────
async function loadAuditLogs(workspaceId) {
  const token = getToken();
  if (!token) return;

  document.getElementById('audit-content').innerHTML =
    `<div class="state-msg">Loading...</div>`;

  try {
    const res  = await fetch(`${API_BASE}/audit-logs/${workspaceId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('audit-content').innerHTML =
        `<div class="state-msg">${escapeHtml(data.error || 'Error loading logs')}</div>`;
      return;
    }

    renderLogs(data);
  } catch (err) {
    document.getElementById('audit-content').innerHTML =
      `<div class="state-msg">Could not reach server</div>`;
    console.error(err);
  }
}

// ── Init ───────────────────────────────────────────────────────
loadSidebarUser();
loadWorkspaces();