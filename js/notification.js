const API_BASE   = 'https://linksphere-5bef.onrender.com/api';
const SOCKET_URL = 'https://linksphere-5bef.onrender.com';

let currentFilter = 'all';
let socket        = null;

// ═══════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════

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
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });

document.getElementById('nav-logout').addEventListener('click', e => {
  e.preventDefault();
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'login.html';
});

// ═══════════════════════════════════════════
// AUTH & USER
// ═══════════════════════════════════════════

function getToken() {
  const t = localStorage.getItem('token');
  if (!t) window.location.href = 'login.html';
  return t;
}

function getUser() {
  return JSON.parse(localStorage.getItem('user') || 'null');
}

function loadUser() {
  const token = localStorage.getItem('token');
  const user  = JSON.parse(localStorage.getItem('user') || 'null');
  if (!token) { window.location.href = 'login.html'; return; }
  if (user) updateSidebarUser(user);

  fetch(`${API_BASE}/users/profile`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data) { localStorage.setItem('user', JSON.stringify(data)); updateSidebarUser(data); }
    })
    .catch(() => {});
}

function updateSidebarUser(user) {
  const name = user.name || 'USER';

  const nameEl = document.getElementById('sidebar-user-name');
  if (nameEl) nameEl.textContent = name.toUpperCase();

  const av = document.getElementById('sidebar-avatar');
  if (av) {
    if (user.avatar_url) {
      av.innerHTML = `<img src="${user.avatar_url}" alt="${name}" style="width:100%;height:100%;object-fit:cover;display:block;" />`;
    } else {
      const parts = name.trim().split(' ');
      av.textContent = parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : name.charAt(0).toUpperCase();
    }
  }
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// SVG icons per notification type — no emojis
function getTypeIcon(type) {
  const icons = {
    access_granted:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><polyline points="20 6 9 17 4 12"/></svg>`,
    access_revoked:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    role_changed:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><rect x="3" y="11" width="18" height="11"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
    role_updated:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><rect x="3" y="11" width="18" height="11"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
    kicked:          `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    message:         `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
    dm:              `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    reaction:        `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
    channel_message: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
    system:          `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M12 2v2M12 20v2M2 12h2M20 12h2M17.66 17.66l-1.41-1.41M6.34 17.66l1.41-1.41"/></svg>`,
  };
  return icons[type] || `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="square"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>`;
}

// ═══════════════════════════════════════════
// MUTED CHANNELS
// ═══════════════════════════════════════════

const MUTED_KEY = 'ls_muted_channels';

function getMuted() {
  try { return JSON.parse(localStorage.getItem(MUTED_KEY) || '[]'); }
  catch { return []; }
}

function saveMuted(list) {
  localStorage.setItem(MUTED_KEY, JSON.stringify(list));
}

function isChannelMuted(id) {
  return getMuted().some(c => c.channel_id === id);
}

function renderMutedChannels() {
  const list  = document.getElementById('muted-channels-list');
  const count = document.getElementById('activeCount');
  const muted = getMuted();

  if (count) count.textContent = muted.length;
  if (!list) return;

  if (!muted.length) {
    list.innerHTML = '<p class="no-muted">No muted channels yet.</p>';
    return;
  }

  list.innerHTML = muted.map(ch => `
    <div class="channel-row">
      <span class="channel-name">#${escapeHtml(ch.name.toLowerCase())}</span>
      <button class="channel-unmute-btn" data-id="${ch.channel_id}">Unmute</button>
    </div>
  `).join('');

  list.querySelectorAll('.channel-unmute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      saveMuted(getMuted().filter(c => c.channel_id !== btn.dataset.id));
      renderMutedChannels();
      showToast('Channel unmuted');
    });
  });
}

async function openMuteModal() {
  const token = getToken();
  if (!token) return;

  const wsRes = await fetch(`${API_BASE}/workspaces`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!wsRes.ok) { showToast('Failed to load workspaces'); return; }
  const workspaces = await wsRes.json();

  let allChannels = [];
  await Promise.allSettled(workspaces.map(async ws => {
    const r = await fetch(`${API_BASE}/channels?workspace_id=${ws.workspace_id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (r.ok) {
      (await r.json())
        .filter(ch => (ch.type || 'text') === 'text')
        .forEach(ch => allChannels.push({ channel_id: ch.channel_id, name: ch.name, workspace_name: ws.name }));
    }
  }));

  const muted   = getMuted();
  const unmuted = allChannels.filter(ch => !muted.some(m => m.channel_id === ch.channel_id));

  const old = document.getElementById('mute-modal');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mute-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';

  overlay.innerHTML = `
    <div style="width:360px;background:#fff;border:2px solid #000;font-family:Inter,sans-serif;">
      <div style="background:#000;color:#fff;padding:14px 18px;font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;">
        <span>Mute a Channel</span>
        <button id="mm-close" style="background:none;border:none;color:#fff;font-size:16px;cursor:pointer;font-weight:900;">✕</button>
      </div>
      <div style="max-height:360px;overflow-y:auto;">
        ${unmuted.length ? unmuted.map(ch => `
          <div class="mm-opt" data-id="${ch.channel_id}" data-name="${escapeHtml(ch.name)}"
            style="padding:14px 18px;border-bottom:1px solid #f0f0f0;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background .1s;">
            <div>
              <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">#${escapeHtml(ch.name.toLowerCase())}</div>
              <div style="font-size:10px;color:#aaa;margin-top:2px;">${escapeHtml(ch.workspace_name)}</div>
            </div>
            <span style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#dc2626;">Mute</span>
          </div>
        `).join('') : '<p style="padding:20px;font-size:12px;color:#bbb;text-align:center;">All channels are muted.</p>'}
      </div>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('mm-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('.mm-opt').forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = '#fafafa');
    item.addEventListener('mouseleave', () => item.style.background = '');
    item.addEventListener('click', () => {
      saveMuted([...getMuted(), { channel_id: item.dataset.id, name: item.dataset.name }]);
      renderMutedChannels();
      overlay.remove();
      showToast(`#${item.dataset.name.toLowerCase()} muted`);
    });
  });
}

// ═══════════════════════════════════════════
// PUSH SWITCH
// ═══════════════════════════════════════════

function isPushOn() {
  return document.getElementById('pushSwitch').classList.contains('active');
}

function initPushSwitch() {
  const sw = document.getElementById('pushSwitch');
  if (!sw) return;
  sw.addEventListener('click', function () {
    this.classList.toggle('active');
    showToast(this.classList.contains('active') ? 'Push alerts on' : 'Push alerts off');
  });
}

// ═══════════════════════════════════════════
// RENDER NOTIFICATIONS
// ═══════════════════════════════════════════

function renderNotifications(notifications) {
  const list = document.getElementById('notif-list');
  list.innerHTML = '';

  const filtered = currentFilter === 'unread'
    ? notifications.filter(n => !n.read_at)
    : notifications;

  if (!filtered.length) {
    list.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square">
            <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
        </div>
        <div class="notif-empty-title">No Notifications</div>
        <div class="notif-empty-sub">${currentFilter === 'unread' ? "You're all caught up!" : 'Nothing here yet.'}</div>
      </div>`;
    return;
  }

  filtered.forEach(n => {
    const isUnread = !n.read_at;
    const item = document.createElement('div');
    item.className = `notif-item ${isUnread ? 'unread' : 'read'}`;
    item.dataset.id = n.notification_id;

    item.innerHTML = `
      <div class="notif-dot"></div>
      <div class="notif-type-icon type-${escapeHtml(n.type || 'system')}">${getTypeIcon(n.type)}</div>
      <div class="notif-body">
        <div class="notif-title">${escapeHtml(n.title || 'Notification')}</div>
        ${n.message ? `<div class="notif-message">${escapeHtml(n.message)}</div>` : ''}
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
      <button class="notif-delete-btn" data-id="${n.notification_id}" title="Delete">
        <svg width="10" height="10" viewBox="0 0 18 18" fill="none">
          <line x1="1" y1="1" x2="17" y2="17" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/>
          <line x1="17" y1="1" x2="1"  y2="17" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/>
        </svg>
      </button>`;

    item.addEventListener('click', async e => {
      if (e.target.closest('.notif-delete-btn')) return;
      if (!isUnread) return;
      await markAsRead(n.notification_id, item);
    });

    item.querySelector('.notif-delete-btn').addEventListener('click', async e => {
      e.stopPropagation();
      await deleteNotification(n.notification_id, item);
    });

    list.appendChild(item);
  });
}

// ═══════════════════════════════════════════
// LOAD NOTIFICATIONS
// ═══════════════════════════════════════════

async function loadNotifications() {
  const token = getToken();
  if (!token) return;

  const list = document.getElementById('notif-list');
  list.innerHTML = '<div class="notif-spinner-wrap"><div class="notif-spinner"></div></div>';

  try {
    const res = await fetch(`${API_BASE}/notifications?limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error();
    renderNotifications(await res.json());
    updateUnreadBadge();
  } catch {
    list.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-title">Could Not Load</div>
        <div class="notif-empty-sub">Check your connection and try again.</div>
      </div>`;
  }
}

// ═══════════════════════════════════════════
// UNREAD BADGE
// ═══════════════════════════════════════════

async function updateUnreadBadge() {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/notifications/unread-count`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const { unread_count } = await res.json();
      const badge  = document.getElementById('unread-badge');
      const sbadge = document.getElementById('sidebar-notif-badge');
      if (badge)  { badge.textContent  = unread_count; badge.style.display  = unread_count > 0 ? 'inline-flex' : 'none'; }
      if (sbadge) { sbadge.textContent = unread_count; sbadge.style.display = unread_count > 0 ? 'flex'        : 'none'; }
    }
  } catch {}
}

// ═══════════════════════════════════════════
// MARK AS READ
// ═══════════════════════════════════════════

async function markAsRead(id, el) {
  const token = getToken();
  if (!token) return;
  const res = await fetch(`${API_BASE}/notifications/${id}/read`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (res.ok) { el.classList.replace('unread', 'read'); updateUnreadBadge(); }
}

async function markAllAsRead() {
  const token = getToken();
  if (!token) return;
  const res = await fetch(`${API_BASE}/notifications/read-all`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (res.ok) { showToast('All marked as read'); loadNotifications(); }
}

// ═══════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════

async function deleteNotification(id, el) {
  const token = getToken();
  if (!token) return;
  const res = await fetch(`${API_BASE}/notifications/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (res.ok) {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity    = '0';
    el.style.transform  = 'translateX(16px)';
    setTimeout(() => { el.remove(); updateUnreadBadge(); }, 220);
    showToast('Notification deleted');
  }
}

async function deleteAll() {
  const token = getToken();
  if (!token) return;
  const res = await fetch(`${API_BASE}/notifications`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (res.ok) { showToast('All notifications cleared'); loadNotifications(); }
}

// ═══════════════════════════════════════════
// SAVE NOTIFICATION TO BACKEND
// ═══════════════════════════════════════════

async function saveNotif(title, message, type) {
  const token = getToken();
  const me    = getUser();
  if (!token || !me) return;
  await fetch(`${API_BASE}/notifications`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ user_id: me.user_id, title, message, type }),
  }).catch(() => {});
}

// ═══════════════════════════════════════════
// SOCKET
// ═══════════════════════════════════════════

function initSocket() {
  const token = getToken();
  if (!token) return;
  const me = getUser();
  if (!me) return;

  socket = io(SOCKET_URL, { auth: { token }, reconnection: true });

  socket.on('connect', () => {
    socket.emit('join_user_room', me.user_id);
    socket.emit('register', { userId: me.user_id });
  });

  socket.on('new_notification', () => {
    loadNotifications();
    updateUnreadBadge();
  });

  socket.on('new_dm', async data => {
    if (data.sender_id === me.user_id || !isPushOn()) return;
    await saveNotif('New Direct Message', `You have a new message from ${data.sender_name || data.sender_username || 'Someone'}`, 'dm');
    loadNotifications();
    updateUnreadBadge();
    showToast(`New message from ${data.sender_name || 'Someone'}`);
  });

  socket.on('new_channel_message', async data => {
    if (!isPushOn() || isChannelMuted(data.channel_id)) return;
    await saveNotif(`#${data.channel_name || 'channel'}`, `New message from ${data.sender_name || 'Someone'}`, 'channel_message');
    loadNotifications();
    updateUnreadBadge();
    showToast(`New message in #${data.channel_name || 'channel'}`);
  });

  socket.on('dm_reaction_added', async data => {
    if (data.reactor_id === me.user_id || !isPushOn()) return;
    await saveNotif('New Reaction', `${data.reactor_name || 'Someone'} reacted to your message`, 'reaction');
    loadNotifications();
    updateUnreadBadge();
  });

  socket.on('reaction_added', async data => {
    if (data.reactor_id === me.user_id)         return;
    if (data.message_owner_id !== me.user_id)   return;
    if (!isPushOn())                             return;
    if (data.reaction?.channel_id && isChannelMuted(data.reaction.channel_id)) return;
    await saveNotif('New Reaction', `${data.reactor_name || 'Someone'} reacted to your message in #${data.channel_name || 'channel'}`, 'reaction');
    loadNotifications();
    updateUnreadBadge();
  });

  socket.on('role_updated', async data => {
    if (!isPushOn()) return;
    await saveNotif('Role Updated', `You were promoted to ${data.role} in ${data.workspace_name || 'a workspace'}`, 'role_updated');
    loadNotifications();
    updateUnreadBadge();
    showToast(`You are now a ${data.role}`);
  });
}



// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadUser();
  initPushSwitch();
  renderMutedChannels();
  loadNotifications();
  initSocket();

  document.getElementById('add-mute-btn').addEventListener('click', openMuteModal);
});