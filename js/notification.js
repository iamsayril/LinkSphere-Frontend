const API_BASE   = 'https://linksphere-5bef.onrender.com/api';
const SOCKET_URL = 'https://linksphere-5bef.onrender.com';

let currentFilter = 'all';
let socket        = null;

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getToken() {
  const token = localStorage.getItem('token');
  if (!token) { window.location.href = 'login.html'; return null; }
  return token;
}

function getUser() {
  return JSON.parse(localStorage.getItem('user') || 'null');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'default') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show${type === 'danger' ? ' danger' : ''}`;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function getTypeIcon(type) {
  const icons = {
    access_granted:  '✓',
    access_revoked:  '🚫',
    role_changed:    '🛡',
    kicked:          '👋',
    message:         '💬',
    dm:              '✉',
    reaction:        '😊',
    channel_message: '💬',
    role_updated:    '🛡',
    system:          '⚙',
  };
  return icons[type] || '🔔';
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ─── Muted Channels ───────────────────────────────────────────────────────────

const MUTED_KEY = 'ls_muted_channels';

function getMutedChannels() {
  try { return JSON.parse(localStorage.getItem(MUTED_KEY) || '[]'); }
  catch { return []; }
}

function saveMutedChannels(list) {
  localStorage.setItem(MUTED_KEY, JSON.stringify(list));
}

function isChannelMuted(channelId) {
  return getMutedChannels().some(c => c.channel_id === channelId);
}

function updateMutedCount() {
  const el = document.getElementById('activeCount');
  if (el) el.textContent = `${getMutedChannels().length} Muted`;
}

function renderMutedChannels() {
  const list = document.getElementById('muted-channels-list');
  if (!list) return;
  const muted = getMutedChannels();

  if (!muted.length) {
    list.innerHTML = '<p style="padding:12px 16px;font-size:13px;opacity:0.5;">No muted channels yet.</p>';
    updateMutedCount();
    return;
  }

  list.innerHTML = muted.map(ch => `
    <div class="channel" data-channel-id="${ch.channel_id}">
      <b>#${escapeHtml(ch.name.toLowerCase())}</b>
      <button class="unmute-btn" data-channel-id="${ch.channel_id}">Unmute</button>
    </div>
  `).join('');

  list.querySelectorAll('.unmute-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const updated = getMutedChannels().filter(c => c.channel_id !== btn.dataset.channelId);
      saveMutedChannels(updated);
      renderMutedChannels();
      showToast('Channel unmuted');
    });
  });

  updateMutedCount();
}

async function openMuteChannelModal() {
  const token = getToken();
  if (!token) return;

  const wsRes = await fetch(`${API_BASE}/workspaces`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!wsRes.ok) { showToast('Failed to load workspaces', 'danger'); return; }
  const workspaces = await wsRes.json();

  let allChannels = [];
  await Promise.allSettled(workspaces.map(async ws => {
    const res = await fetch(`${API_BASE}/channels?workspace_id=${ws.workspace_id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const channels = await res.json();
      channels
        .filter(ch => (ch.type || 'text') === 'text')
        .forEach(ch => allChannels.push({
          channel_id:     ch.channel_id,
          name:           ch.name,
          workspace_name: ws.name,
        }));
    }
  }));

  const muted   = getMutedChannels();
  const unmuted = allChannels.filter(ch => !muted.some(m => m.channel_id === ch.channel_id));

  const existing = document.getElementById('mute-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mute-modal-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;z-index:9999;
  `;

  overlay.innerHTML = `
    <div style="width:360px;background:#fff;border:2px solid #000;font-family:Inter,Arial,sans-serif;">
      <div style="background:#000;color:#fff;padding:14px 18px;font-size:13px;font-weight:900;letter-spacing:0.15em;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;">
        <span>Mute a Channel</span>
        <button id="mute-modal-close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;">✕</button>
      </div>
      <div style="padding:16px 18px;max-height:360px;overflow-y:auto;">
        ${unmuted.length ? unmuted.map(ch => `
          <div class="mute-option" data-channel-id="${ch.channel_id}" data-name="${escapeHtml(ch.name)}"
            style="padding:12px 14px;border:2px solid #000;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.15s;">
            <div>
              <b style="font-size:14px;">#${escapeHtml(ch.name.toLowerCase())}</b>
              <div style="font-size:11px;opacity:0.5;margin-top:2px;">${escapeHtml(ch.workspace_name)}</div>
            </div>
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#bc0100;">Mute</span>
          </div>
        `).join('') : '<p style="font-size:13px;opacity:0.5;text-align:center;padding:20px;">All channels are muted.</p>'}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('mute-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('.mute-option').forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = '#f3f3f3');
    item.addEventListener('mouseleave', () => item.style.background = '#fff');
    item.addEventListener('click', () => {
      const updated = [...getMutedChannels(), { channel_id: item.dataset.channelId, name: item.dataset.name }];
      saveMutedChannels(updated);
      renderMutedChannels();
      overlay.remove();
      showToast(`#${item.dataset.name.toLowerCase()} muted`);
    });
  });
}

// ─── Push Switch ──────────────────────────────────────────────────────────────

function isPushOn() {
  const sw = document.getElementById('pushSwitch');
  return sw ? sw.classList.contains('active') : true;
}

function initPushSwitch() {
  const sw = document.getElementById('pushSwitch');
  if (!sw) return;
  sw.addEventListener('click', () => {
    sw.classList.toggle('active');
    showToast(sw.classList.contains('active') ? 'Push alerts on' : 'Push alerts off');
  });
}

// ─── Render notifications ─────────────────────────────────────────────────────

function renderNotifications(notifications) {
  const list = document.getElementById('notif-list');
  list.innerHTML = '';

  const filtered = currentFilter === 'unread'
    ? notifications.filter(n => !n.read_at)
    : notifications;

  if (!filtered.length) {
    list.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-icon">🔔</div>
        <div class="notif-empty-title">NO NOTIFICATIONS</div>
        <div class="notif-empty-sub">${currentFilter === 'unread' ? 'You\'re all caught up!' : 'Nothing here yet.'}</div>
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
      <button class="notif-delete-btn" data-id="${n.notification_id}" title="Delete">✕</button>
    `;

    item.addEventListener('click', async (e) => {
      if (e.target.closest('.notif-delete-btn')) return;
      if (!isUnread) return;
      await markAsRead(n.notification_id, item);
    });

    item.querySelector('.notif-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteNotification(n.notification_id, item);
    });

    list.appendChild(item);
  });
}

// ─── Load notifications ───────────────────────────────────────────────────────

async function loadNotifications() {
  const token = getToken();
  if (!token) return;

  const list = document.getElementById('notif-list');
  list.innerHTML = `<div class="notif-spinner-wrap"><div class="notif-spinner"></div></div>`;

  try {
    const res = await fetch(`${API_BASE}/notifications?limit=50`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    renderNotifications(data);
    updateUnreadBadge();
  } catch (err) {
    list.innerHTML = `<div class="notif-empty"><div class="notif-empty-icon">⚠</div><div class="notif-empty-title">COULD NOT LOAD</div><div class="notif-empty-sub">Check your connection and try again.</div></div>`;
  }
}

// ─── Update unread badge ──────────────────────────────────────────────────────

async function updateUnreadBadge() {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/notifications/unread-count`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const { unread_count } = await res.json();
      const badge = document.getElementById('unread-badge');
      if (badge) {
        badge.textContent = unread_count;
        badge.style.display = unread_count > 0 ? 'inline-block' : 'none';
      }
    }
  } catch (err) {
    console.warn('updateUnreadBadge error:', err);
  }
}

// ─── Mark as read ─────────────────────────────────────────────────────────────

async function markAsRead(notificationId, itemEl) {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/notifications/${notificationId}/read`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      itemEl.classList.remove('unread');
      itemEl.classList.add('read');
      updateUnreadBadge();
    }
  } catch (err) {
    console.error('markAsRead error:', err);
  }
}

// ─── Mark all as read ─────────────────────────────────────────────────────────

async function markAllAsRead() {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/notifications/read-all`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      showToast('ALL NOTIFICATIONS MARKED AS READ');
      loadNotifications();
    }
  } catch (err) {
    showToast('COULD NOT MARK AS READ', 'danger');
  }
}

// ─── Delete single ────────────────────────────────────────────────────────────

async function deleteNotification(notificationId, itemEl) {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/notifications/${notificationId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      itemEl.style.transition = 'opacity 0.2s, transform 0.2s';
      itemEl.style.opacity = '0';
      itemEl.style.transform = 'translateX(20px)';
      setTimeout(() => { itemEl.remove(); updateUnreadBadge(); }, 220);
      showToast('NOTIFICATION DELETED');
    }
  } catch (err) {
    showToast('COULD NOT DELETE', 'danger');
  }
}

// ─── Delete all ───────────────────────────────────────────────────────────────

async function deleteAllNotifications() {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/notifications`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      showToast('ALL NOTIFICATIONS CLEARED');
      loadNotifications();
    }
  } catch (err) {
    showToast('COULD NOT CLEAR', 'danger');
  }
}

// ─── Save notification to backend ────────────────────────────────────────────

async function saveNotificationToBackend(title, message, type) {
  const token = getToken();
  const me    = getUser();
  if (!token || !me) return;
  try {
    await fetch(`${API_BASE}/notifications`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: me.user_id, title, message, type }),
    });
  } catch (err) {
    console.warn('saveNotificationToBackend error:', err);
  }
}

// ─── Socket ───────────────────────────────────────────────────────────────────

function initSocket() {
  const token = getToken();
  if (!token) return;
  const me = getUser();
  if (!me) return;

  socket = io(SOCKET_URL, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
  });

  socket.on('connect', () => {
    socket.emit('join_user_room', me.user_id);
    socket.emit('register', { userId: me.user_id });
  });

  // Backend-saved notification
  socket.on('new_notification', () => {
    loadNotifications();
    updateUnreadBadge();
  });

  // New DM received
  socket.on('new_dm', async (data) => {
    if (data.sender_id === me.user_id) return;
    if (!isPushOn()) return;
    const senderName = data.sender_name || 'Someone';
    await saveNotificationToBackend(
      'New Direct Message',
      `You have a new message from ${senderName}`,
      'dm'
    );
    loadNotifications();
    updateUnreadBadge();
    showToast(`New message from ${senderName}`);
  });

  // New channel message
  socket.on('new_channel_message', async (data) => {
    if (!isPushOn()) return;
    if (isChannelMuted(data.channel_id)) return;
    await saveNotificationToBackend(
      `#${data.channel_name || 'channel'}`,
      `New message from ${data.sender_name || 'Someone'}`,
      'channel_message'
    );
    loadNotifications();
    updateUnreadBadge();
    showToast(`New message in #${data.channel_name || 'channel'}`);
  });

  // Reaction on your DM
  socket.on('dm_reaction_added', async (data) => {
    if (data.reactor_id === me.user_id) return;
    if (!isPushOn()) return;
    const emoji      = data.emoji || data.reaction?.emoji || '❤️';
    const reactorName = data.reactor_name || 'Someone';
    await saveNotificationToBackend(
      'New Reaction',
      `${reactorName} reacted ${emoji} to your message`,
      'reaction'
    );
    loadNotifications();
    updateUnreadBadge();
    showToast(`${reactorName} reacted ${emoji}`);
  });

  // Reaction on your channel message
  socket.on('reaction_added', async (data) => {
    if (data.reactor_id === me.user_id) return;
    if (data.message_owner_id !== me.user_id) return;
    if (!isPushOn()) return;
    if (data.reaction?.channel_id && isChannelMuted(data.reaction.channel_id)) return;
    const emoji       = data.emoji || '❤️';
    const reactorName = data.reactor_name || 'Someone';
    await saveNotificationToBackend(
      'New Reaction',
      `${reactorName} reacted ${emoji} to your message in #${data.channel_name || 'channel'}`,
      'reaction'
    );
    loadNotifications();
    updateUnreadBadge();
    showToast(`${reactorName} reacted ${emoji}`);
  });

  // Role updated
  socket.on('role_updated', async (data) => {
    if (!isPushOn()) return;
    await saveNotificationToBackend(
      'Role Updated',
      `You were promoted to ${data.role} in ${data.workspace_name || 'a workspace'}`,
      'role_updated'
    );
    loadNotifications();
    updateUnreadBadge();
    showToast(`You are now a ${data.role}`);
  });
}

// ─── Burger Menu ──────────────────────────────────────────────────────────────

function initBurgerMenu() {
  const burgerBtn     = document.getElementById('burger-btn');
  const burgerSidebar = document.getElementById('burger-sidebar');
  const overlay       = document.getElementById('sidebar-overlay');
  const closeBtn      = document.getElementById('burger-close-btn');

  function openSidebar()  { burgerSidebar.classList.add('open');    overlay.classList.add('open'); }
  function closeSidebar() { burgerSidebar.classList.remove('open'); overlay.classList.remove('open'); }

  burgerBtn.addEventListener('click', openSidebar);
  closeBtn.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

function initFilterTabs() {
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      loadNotifications();
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initBurgerMenu();
  initFilterTabs();
  initPushSwitch();
  renderMutedChannels();
  loadNotifications();
  initSocket();

  const addMuteBtn = document.getElementById('add-mute-btn');
  if (addMuteBtn) addMuteBtn.addEventListener('click', openMuteChannelModal);

  document.getElementById('mark-all-btn').addEventListener('click', markAllAsRead);
  document.getElementById('clear-all-btn').addEventListener('click', () => {
    if (confirm('Clear all notifications? This cannot be undone.')) {
      deleteAllNotifications();
    }
  });
});