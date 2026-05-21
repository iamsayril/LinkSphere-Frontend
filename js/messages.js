const API_BASE = 'https://linksphere-5bef.onrender.com/api';
const SOCKET_URL = 'https://linksphere-5bef.onrender.com';

// ── Authentication Check ───────────────────────────────────────────────────────
(function() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '../html/login.html';
  }
})();

let currentDmUser = null;
let dmPolling     = null;
let attachedFiles = [];
let socket = null;
let currentCallRequest = null;
let incomingCallAudio = null;

// ─── Initialize Socket.io ─────────────────────────────────────────────────────

function initializeSocket() {
  if (socket) return;

  // Reuse the global socket created by call-handler.js if available
  if (window._chSocket) {
    socket = window._chSocket;
    // Re-attach messages.js-specific listeners below
  } else {
    const token = getToken();
    if (!token) return;

    socket = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });
    window._chSocket = socket;
  }
  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);

    // Join user room immediately on every connect/reconnect
    // so io.to(`user:${userId}`) can reach this socket
    const me = getUser();
    if (me?.user_id) {
      socket.emit('join_user_room', me.user_id);
      console.log('Joined user room:', me.user_id);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  // ── Listen for incoming calls ──────────────────────────────────────────────
  socket.on('incoming_call', async (data) => {
    const { caller, callerId, roomName } = data;
    currentCallRequest = { caller, callerId, roomName, isInitiator: false };

    // Fetch full caller profile to display in modal
    let callerProfile = { name: caller, avatar_url: null, email: '' };
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/dm/conversations`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const conversations = await res.json();
        const conversation = conversations.find(c => c.user_id === callerId);
        if (conversation) {
          callerProfile = {
            name: conversation.name || caller,
            avatar_url: conversation.avatar_url || null,
            email: conversation.email || '',
            status: 'Online',
          };
        }
      }
    } catch (err) {
      console.error('Could not fetch caller profile:', err);
    }

    playCallSound();
    showDialingModal(callerProfile, false);
  });

  socket.on('dm_reaction_added', () => {
    if (currentDmUser) loadDmMessages();
  });

  socket.on('dm_reaction_removed', () => {
    if (currentDmUser) loadDmMessages();
  });

  socket.on('connect', () => {
    if (currentDmUser) loadDmMessages();
  });

  // ── Listen for call rejection ──────────────────────────────────────────────
  socket.on('call_rejected', (data) => {
  const overlay = document.getElementById('voice-call-overlay');
  if (!overlay) return;
  const statusText = overlay.querySelector('#dialing-status-text');
  if (data?.noAnswer) {
    if (statusText) statusText.textContent = 'No answer';
    return; // stop here — don't remove overlay
  }
  if (statusText) statusText.textContent = 'Call rejected';
  setTimeout(() => overlay.remove(), 2000);
});

  // ── Listen for call cancellation ──────────────────────────────────────────
  socket.on('call_cancelled', () => {
  const overlay = document.getElementById('voice-call-overlay');
  if (overlay) {
    const statusText = overlay.querySelector('#dialing-status-text');
    if (statusText) statusText.textContent = 'Call cancelled';
    setTimeout(() => overlay.remove(), 2000);
  }
});

  // ── Listen for peer ending the call ──────────────────────────────────────
  socket.on('call_ended', () => {
    const callScreen = document.getElementById('dm-call-screen');
    if (callScreen) {
      endInPageCall(callScreen);
    }
  });

  // ── Listen for call being accepted — caller joins the LiveKit room ─────────
  socket.on('call_accepted', async (data) => {
    const overlay = document.getElementById('voice-call-overlay');
    if (overlay) overlay.remove();

    const { roomName } = data;
    const authToken = getToken();
    const me = getUser();

    try {
      const res = await fetch(`${API_BASE}/calls/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomName,
          participantName: me.name || me.user_id,
        }),
      });

      if (!res.ok) {
        console.error('Caller failed to get LiveKit token');
        return;
      }

      const { token: livekitToken, serverUrl } = await res.json();

      try {
  const callRes = await fetch(`${API_BASE}/calls/dm`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ receiver_id: currentDmUser.user_id, room_name: roomName, call_type: 'audio' }),
  });
  if (callRes.ok) {
    const callData = await callRes.json();
    window._dmCallId = callData.dm_call?.dm_call_id || null;
  }
} catch (err) {
  console.error('Could not log call start:', err);
}

startInPageVoiceCall({
  user: currentDmUser,
  roomName,
  livekitToken,
  serverUrl,
});
    } catch (err) {
      console.error('Caller join error:', err);
    }
  });
}

// ─── Play incoming call sound ─────────────────────────────────────────────────

function playCallSound() {
  if (!incomingCallAudio) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  }
}

// ─── Smooth navigate ──────────────────────────────────────────────────────────

function navigateTo(url) {
  window.location.href = url;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getToken() {
  const token = localStorage.getItem('token');
  if (!token) { window.location.href = 'login.html'; return null; }
  return token;
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

function getFileCategoryIcon(type, name) {
  if (type.includes('pdf'))                                        return '📄';
  if (type.includes('word') || type.includes('document') || name.endsWith('.docx') || name.endsWith('.doc')) return '📝';
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv') || name.endsWith('.xlsx') || name.endsWith('.csv')) return '📊';
  if (type.includes('presentation') || name.endsWith('.pptx') || name.endsWith('.ppt')) return '📑';
  if (type.includes('zip') || type.includes('rar') || type.includes('7z') || name.endsWith('.zip') || name.endsWith('.rar')) return '🗜️';
  if (name.endsWith('.md') || name.endsWith('.txt') || type.includes('text/plain') || type.includes('markdown')) return '📋';
  if (type.includes('json') || name.endsWith('.json'))            return '🔧';
  if (type.includes('javascript') || name.endsWith('.js') || name.endsWith('.ts')) return '⚙️';
  if (name.endsWith('.html') || name.endsWith('.css'))            return '🌐';
  return '📎';
}

function timeAgo(dateStr) {
  const now  = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60)     return 'NOW';
  if (diff < 3600)   return `${Math.floor(diff / 60)}M AGO`;
  if (diff < 86400)  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800) return 'YESTERDAY';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase();
}

function avatarEl(name, avatarUrl, className = 'avatar') {
  const el = document.createElement('div');
  el.className = className;
  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.alt = name;
    el.appendChild(img);
  } else {
    el.textContent = (name || '?').charAt(0).toUpperCase();
  }
  return el;
}

// ─── File Upload Helpers ──────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(file) {
  const t = file.type;
  if (t.startsWith('image/')) return '🖼️';
  if (t.startsWith('video/')) return '🎬';
  if (t.startsWith('audio/')) return '🎵';
  if (t.includes('pdf'))      return '📄';
  if (t.includes('zip') || t.includes('rar')) return '🗜️';
  if (t.includes('word') || t.includes('document')) return '📝';
  if (t.includes('sheet') || t.includes('excel') || t.includes('csv')) return '📊';
  return '📎';
}

function renderAttachmentPreview() {
  const preview = document.getElementById('dm-attachments-preview');
  if (!preview) return;

  if (!attachedFiles.length) {
    preview.style.display = 'none';
    return;
  }

  preview.style.display = 'flex';
  preview.innerHTML = '';

  attachedFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'attach-item';

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      item.innerHTML = `
        <img class="attach-thumb" src="${url}" alt="${escapeHtml(file.name)}" />
        <div class="attach-info">
          <div class="attach-name">${escapeHtml(file.name)}</div>
          <div class="attach-size">${formatSize(file.size)}</div>
        </div>
        <button class="attach-remove" data-idx="${idx}">✕</button>`;
    } else {
      item.innerHTML = `
        <span class="attach-icon">${getFileIcon(file)}</span>
        <div class="attach-info">
          <div class="attach-name">${escapeHtml(file.name)}</div>
          <div class="attach-size">${formatSize(file.size)}</div>
        </div>
        <button class="attach-remove" data-idx="${idx}">✕</button>`;
    }

    preview.appendChild(item);
  });

  preview.querySelectorAll('.attach-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      attachedFiles.splice(parseInt(e.currentTarget.dataset.idx), 1);
      renderAttachmentPreview();
    });
  });
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function openLightbox(imageUrl) {
  const overlay = document.getElementById('lightbox-overlay');
  const img = document.getElementById('lightbox-image');
  if (!overlay || !img) return;
  img.src = imageUrl;
  overlay.style.display = 'flex';
}

function closeLightbox() {
  const overlay = document.getElementById('lightbox-overlay');
  if (overlay) overlay.style.display = 'none';
}

function setupLightboxListeners() {
  document.querySelectorAll('.message-img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.src));
  });
}

// ─── Self Info ────────────────────────────────────────────────────────────────

async function populateSelfInfo() {
  const token = getToken();
  if (!token) return;
  let me = getUser();
  try {
    const res = await fetch(`${API_BASE}/users/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const fresh = await res.json();
      me = { ...me, ...fresh };
      localStorage.setItem('user', JSON.stringify(me));
    }
  } catch (_) {}
  if (!me) return;
  const nameEl   = document.getElementById('self-name-el');
  const avatarEl = document.getElementById('self-avatar-el');
  if (nameEl)   nameEl.textContent = (me.name || 'YOU').toUpperCase();
  if (avatarEl) {
    if (me.avatar_url) {
      const img = document.createElement('img');
      img.src = me.avatar_url;
      img.alt = me.name;
      avatarEl.innerHTML = '';
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = (me.name || 'Y').charAt(0).toUpperCase();
    }
  }
}

// ─── Sidebar search filter ────────────────────────────────────────────────────

document.getElementById('sidebar-search-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#conversation-list .message-card').forEach(card => {
    const name = card.dataset.name || '';
    card.style.display = name.toLowerCase().includes(q) ? '' : 'none';
  });
});

// ─── Load Conversations ───────────────────────────────────────────────────────

async function loadConversations() {
  const token = getToken();
  if (!token) return;

  const list = document.getElementById('conversation-list');
  list.innerHTML = '<div class="spinner"></div>';

  try {
    const res  = await fetch(`${API_BASE}/dm/conversations`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok) {
      list.innerHTML = `<p class="empty-state">⚠ ${escapeHtml(data.error || 'Failed to load.')}</p>`;
      return;
    }

    renderConversations(data);
  } catch (err) {
    list.innerHTML = '<p class="empty-state"><span class="empty-icon">⚠</span>Could not reach server.</p>';
    console.error(err);
  }
}

function renderConversations(conversations) {
  const list = document.getElementById('conversation-list');

  if (!conversations.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">✉</span>
        NO MESSAGES YET<br>TAP + TO START A CONVERSATION
      </div>
    `;
    return;
  }

  list.innerHTML = '';
  conversations.forEach((conv, i) => {
    const card = document.createElement('article');
    card.className        = 'message-card';
    card.dataset.name     = conv.name || '';
    card.style.animationDelay = `${i * 0.05}s`;

    const av = avatarEl(conv.name, conv.avatar_url);

    const info = document.createElement('div');
    info.className = 'message-info';
    info.innerHTML = `
      <div class="message-top">
        <h3>${escapeHtml(conv.name || 'Unknown')}</h3>
        <span>${conv.last_message_at ? timeAgo(conv.last_message_at) : ''}</span>
      </div>
      <p>${escapeHtml(conv.last_message || 'No messages yet')}</p>
    `;

    card.appendChild(av);
    card.appendChild(info);

    if (conv.unread_count > 0) {
      const badge = document.createElement('div');
      badge.className   = 'unread-badge';
      badge.textContent = conv.unread_count > 9 ? '9+' : conv.unread_count;
      card.appendChild(badge);
    }

    card.addEventListener('click', () => {
      document.querySelectorAll('#conversation-list .message-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      card.classList.add('clicked');
      setTimeout(() => card.classList.remove('clicked'), 250);

      const badge = card.querySelector('.unread-badge');
      if (badge) badge.remove();

      openDm(conv);
    });

    list.appendChild(card);
  });
}

// ─── Open DM Panel ────────────────────────────────────────────────────────────

function openDm(user) {
  currentDmUser = user;

  const panelAvatar = document.getElementById('dm-panel-avatar');
  if (user.avatar_url) {
    const img = document.createElement('img');
    img.src = user.avatar_url;
    img.alt = user.name;
    panelAvatar.innerHTML = '';
    panelAvatar.appendChild(img);
  } else {
    panelAvatar.textContent = (user.name || '?').charAt(0).toUpperCase();
  }

  document.getElementById('dm-panel-name').textContent    = user.name || 'Unknown';
  document.getElementById('dm-input').placeholder         = `Message ${user.name || ''}...`;
  document.getElementById('dm-messages').innerHTML        = '<div class="spinner"></div>';

  const _msb = document.getElementById('msg-search-bar-container');
  const _msi = document.getElementById('msg-search-input');
  if (_msb) { _msb.style.display = 'none'; }
  if (_msi) { _msi.value = ''; }
  clearDmSearch();

  const voiceCallBtn = document.getElementById('voice-call-btn');
  if (voiceCallBtn) {
    voiceCallBtn.disabled = false;
    voiceCallBtn.style.opacity = '1';
  }

  attachedFiles = [];
  renderAttachmentPreview();

  document.getElementById('chat-empty').style.display = 'none';
  document.getElementById('chat-inner').style.display = 'flex';

  document.getElementById('dm-panel').classList.add('open');
  document.getElementById('dm-panel').classList.add('mobile-open');
  
  if (window.innerWidth <= 700) {
    document.querySelector('.sidebar').classList.add('hidden');
    document.querySelector('.sidebar').classList.remove('active');
  }

  loadDmMessages();
  if (dmPolling) clearInterval(dmPolling);
  dmPolling = setInterval(loadDmMessages, 6000);
}

function closeDm() {
  document.getElementById('chat-inner').style.display = 'none';
  document.getElementById('chat-empty').style.display = '';

  document.getElementById('dm-panel').classList.remove('open');
  document.getElementById('dm-panel').classList.remove('mobile-open');
  
  if (window.innerWidth <= 700) {
    document.querySelector('.sidebar').classList.remove('hidden');
    document.querySelector('.sidebar').classList.add('active');
  }

  document.querySelectorAll('#conversation-list .message-card').forEach(c => c.classList.remove('active'));

  const voiceCallBtn = document.getElementById('voice-call-btn');
  if (voiceCallBtn) {
    voiceCallBtn.disabled = true;
    voiceCallBtn.style.opacity = '0.5';
  }

  if (dmPolling) { clearInterval(dmPolling); dmPolling = null; }
  currentDmUser = null;

  attachedFiles = [];
  renderAttachmentPreview();

  loadConversations();
}

// ─── Load DM Messages ─────────────────────────────────────────────────────────

async function loadDmMessages() {
  if (!currentDmUser) return;
  const token = getToken();
  if (!token) return;

  const container = document.getElementById('dm-messages');

  try {
    const res  = await fetch(`${API_BASE}/dm/${currentDmUser.user_id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Failed to load DMs:', data);
      container.innerHTML = '<p class="no-dm-messages">⚠ Failed to load messages.</p>';
      return;
    }
    renderDmMessages(data);
  } catch (err) {
    console.error('Error loading DMs:', err);
    container.innerHTML = '<p class="no-dm-messages">⚠ Could not reach server.</p>';
  }
}

function renderDmMessages(messages) {
  const container = document.getElementById('dm-messages');
  const me = getUser();

  if (!messages.length) {
    container.innerHTML = '<p class="no-dm-messages">NO MESSAGES YET<br>SAY HELLO! 👋</p>';
    return;
  }

  const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 60;

  container.innerHTML = messages.map(msg => {
    const isMe = msg.sender_id === me?.user_id;
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let fileHtml = '';
    if (msg.file_url) {
      const type = msg.file_type || '';
      const name = escapeHtml(msg.file_name || 'File');
      const url  = escapeHtml(msg.file_url);
      const size = msg.file_size ? formatSize(msg.file_size) : '';

      if (type.startsWith('image/')) {
        fileHtml = `<img class="message-img" src="${url}" alt="${name}" />`;
      } else if (type.startsWith('video/')) {
        fileHtml = `
          <div class="message-video-wrap">
            <video class="message-video" controls preload="metadata">
              <source src="${url}" type="${escapeHtml(type)}" />
            </video>
            <div class="message-video-meta">
              <span class="message-file-icon">🎬</span>
              <span class="message-file-name">${name}</span>
              ${size ? `<span class="message-file-size">${size}</span>` : ''}
            </div>
          </div>`;
      } else if (type.startsWith('audio/')) {
        fileHtml = `
          <div class="message-audio-wrap">
            <div class="message-audio-header">
              <span class="message-file-icon">🎵</span>
              <div>
                <div class="message-file-name">${name}</div>
                ${size ? `<div class="message-file-size">${size}</div>` : ''}
              </div>
            </div>
            <audio class="message-audio" controls preload="metadata">
              <source src="${url}" type="${escapeHtml(type)}" />
            </audio>
          </div>`;
      } else {
        const icon = getFileCategoryIcon(type, msg.file_name || '');
        fileHtml = `
          <a class="message-download-card" href="${url}" download="${name}" target="_blank" rel="noopener noreferrer">
            <span class="message-download-icon">${icon}</span>
            <div class="message-download-info">
              <div class="message-file-name">${name}</div>
              ${size ? `<div class="message-file-size">${size}</div>` : ''}
            </div>
            <span class="message-download-arrow">⬇</span>
          </a>`;
      }
    }

    // Build reactions HTML
    const reactionsHtml = buildReactionsHtml(msg.dm_reaction || [], msg.dm_id, me?.user_id, 'dm', isMe);

    return `
      <div class="dm-message ${isMe ? 'mine' : 'theirs'}" data-msg-id="${msg.dm_id}">
        <div class="dm-meta"><span>${time}</span></div>
        ${msg.content ? `<div class="dm-bubble">${escapeHtml(msg.content)}</div>` : ''}
        ${fileHtml}
        ${reactionsHtml}
      </div>
    `;
  }).join('');

  if (wasAtBottom) container.scrollTop = container.scrollHeight;
  setupLightboxListeners();
  setupReactionListeners();
}

// ─── Send DM ──────────────────────────────────────────────────────────────────

async function sendDm() {
  if (!currentDmUser) return;
  const token   = getToken();
  const input   = document.getElementById('dm-input');
  const content = input.value.trim();
  const files   = [...attachedFiles];

  if (!token || (!content && !files.length)) return;

  input.value   = '';
  input.style.height = 'auto';
  attachedFiles = [];
  renderAttachmentPreview();

  if (content) {
    try {
      const res = await fetch(`${API_BASE}/dm`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ receiver_id: currentDmUser.user_id, content }),
      });
      if (!res.ok) { console.error('Failed to send DM'); }
    } catch (err) {
      console.error('Error sending DM:', err);
    }
  }

  if (files.length) {
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('receiver_id', currentDmUser.user_id);

        const res = await fetch(`${API_BASE}/dm/upload`, {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body:    formData,
        });

        if (!res.ok) {
          const err = await res.json();
          console.error('File upload failed:', err);
        }
      } catch (err) {
        console.error('Error uploading file:', err);
      }
    }
  }

  loadDmMessages();
}


// ─── Reactions ────────────────────────────────────────────────────────────────

function buildReactionsHtml(reactions, messageId, myUserId, type, isMe = false) {
  const groups = {};
  (reactions || []).forEach(r => {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, reacted: false };
    groups[r.emoji].count++;
    if (r.user_id === myUserId) groups[r.emoji].reacted = true;
  });

  const pills = Object.entries(groups).map(([emoji, { count, reacted }]) => `
    <button class="reaction-pill ${reacted ? 'reacted' : ''}"
      data-emoji="${emoji}" data-msg-id="${messageId}" data-type="${type}">
      ${emoji} <span>${count}</span>
    </button>
  `).join('');

  const trigger = `
    <div class="reaction-bar" data-msg-id="${messageId}" data-type="${type}">
      <button class="reaction-trigger" title="Add reaction">😊</button>
      <div class="emoji-picker" style="display:none;">
        ${['👍','❤️','😂','😮','😢','🔥','🎉','👀'].map(e =>
          `<button class="emoji-opt" data-emoji="${e}" data-msg-id="${messageId}" data-type="${type}">${e}</button>`
        ).join('')}
      </div>
    </div>
  `;

  return isMe
    ? `<div class="message-bubble-wrap"><div class="reactions-row">${trigger}${pills}</div></div>`
    : `<div class="message-bubble-wrap"><div class="reactions-row">${pills}${trigger}</div></div>`;
}

function setupReactionListeners() {
  // Emoji picker toggle
  document.querySelectorAll('.reaction-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bar    = btn.closest('.reaction-bar');
      const picker = bar.querySelector('.emoji-picker');
      const isOpen = picker.style.display !== 'none';
      document.querySelectorAll('.emoji-picker').forEach(p => p.style.display = 'none');
      picker.style.display = isOpen ? 'none' : 'flex';
    });
  });

  // Emoji selection
  document.querySelectorAll('.emoji-opt').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { emoji, msgId } = btn.dataset;
      btn.closest('.emoji-picker').style.display = 'none';
      await toggleReaction(msgId, emoji, 'dm');
    });
  });

  // Reaction pill toggle (add or remove)
  document.querySelectorAll('.reaction-pill').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { emoji, msgId } = btn.dataset;
      await toggleReaction(msgId, emoji, 'dm');
    });
  });

  // Close pickers when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.emoji-picker').forEach(p => p.style.display = 'none');
  }, { once: false, capture: false });
}

async function toggleReaction(messageId, emoji, type) {
  const token = getToken();
  if (!token) return;

  const pill = document.querySelector(`.reaction-pill[data-msg-id="${messageId}"][data-emoji="${emoji}"]`);
  const alreadyReacted = pill?.classList.contains('reacted');

  if (alreadyReacted) {
    await fetch(`${API_BASE}/dm/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
  } else {
    // Remove any existing reaction by this user on this message first
    const existingPill = document.querySelector(`.reaction-pill[data-msg-id="${messageId}"].reacted`);
    if (existingPill) {
      const existingEmoji = existingPill.dataset.emoji;
      await fetch(`${API_BASE}/dm/${messageId}/reactions/${encodeURIComponent(existingEmoji)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    }
    await fetch(`${API_BASE}/dm/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
  }

  if (type === 'dm') await loadDmMessages();
  else await loadMessages(currentChannelId);
}

// ─── Auto-resize textarea ─────────────────────────────────────────────────────

document.getElementById('dm-input').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

// ─── User Search (New DM) ─────────────────────────────────────────────────────

let searchTimeout = null;

function openNewDmModal() {
  document.getElementById('new-dm-modal').style.display = 'flex';
  document.getElementById('user-search-input').value    = '';
  document.getElementById('user-search-results').innerHTML = '';
  setTimeout(() => document.getElementById('user-search-input').focus(), 100);
}

function closeNewDmModal() {
  document.getElementById('new-dm-modal').style.display = 'none';
}

document.getElementById('user-search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  if (!query) {
    document.getElementById('user-search-results').innerHTML = '';
    return;
  }
  searchTimeout = setTimeout(() => searchUsers(query), 300);
});

async function searchUsers(query) {
  const token = getToken();
  if (!token) return;

  const results = document.getElementById('user-search-results');
  results.innerHTML = '<div class="spinner" style="margin:16px auto;width:20px;height:20px;border-width:3px;"></div>';

  try {
    const res  = await fetch(`${API_BASE}/users/search?query=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok || !data.length) {
      results.innerHTML = '<p style="font-size:12px;font-weight:700;color:#999;padding:8px;">No users found.</p>';
      return;
    }

    const me = getUser();
    results.innerHTML = '';
    data
      .filter(u => u.user_id !== me?.user_id)
      .forEach(user => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
          <div class="search-result-avatar">${(user.name || '?').charAt(0).toUpperCase()}</div>
          <div class="search-result-info">
            <strong>${escapeHtml(user.name || 'Unknown')}</strong>
            <span>${escapeHtml(user.email || '')}</span>
          </div>
        `;
        item.addEventListener('click', () => {
          closeNewDmModal();
          openDm(user);
        });
        results.appendChild(item);
      });
  } catch (err) {
    results.innerHTML = '<p style="font-size:12px;font-weight:700;color:#999;padding:8px;">Error searching.</p>';
  }
}

// ─── Load Workspaces into Rail ────────────────────────────────────────────────

async function loadWorkspacesIntoRail() {
  const token = getToken();
  if (!token) return;

  const rail   = document.querySelector('.server-bar');
  const addBtn = rail.querySelector('.rail-add-ws');

  try {
    const res  = await fetch(`${API_BASE}/workspaces`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) return;

    rail.querySelectorAll('.server-icon.workspace').forEach(el => el.remove());

    data.forEach(ws => {
      const icon = document.createElement('div');
      icon.className  = 'server-icon workspace';
      icon.title      = ws.name;
      icon.dataset.id = ws.workspace_id;

      const imgUrl = ws.icon_url || ws.avatar_url || ws.image_url || null;
      if (imgUrl) {
        const img = document.createElement('img');
        img.src            = imgUrl;
        img.alt            = ws.name;
        img.style.cssText  = 'width:100%;height:100%;object-fit:cover;display:block;';
        icon.appendChild(img);
      } else {
        icon.textContent = ws.name.charAt(0).toUpperCase();
      }

      icon.addEventListener('click', () => {
        sessionStorage.setItem('ws_open_id', ws.workspace_id);
        navigateTo('workspace.html');
      });
      rail.insertBefore(icon, addBtn);
    });
  } catch (err) {
    console.error('Could not load workspaces into rail:', err);
  }
}

// ─── File Input ───────────────────────────────────────────────────────────────

document.getElementById('dm-file-input').addEventListener('change', e => {
  attachedFiles.push(...Array.from(e.target.files));
  e.target.value = '';
  renderAttachmentPreview();
});

// ─── Event Listeners ──────────────────────────────────────────────────────────

document.getElementById('new-dm-btn').addEventListener('click', () => {
  document.getElementById('new-dm-btn').animate(
    [{ transform: 'scale(1) rotate(0deg)' }, { transform: 'scale(0.85) rotate(10deg)' }, { transform: 'scale(1) rotate(0deg)' }],
    { duration: 280, easing: 'ease-out' }
  );
  openNewDmModal();
});

document.getElementById('dm-modal-cancel').addEventListener('click', closeNewDmModal);
document.getElementById('new-dm-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('new-dm-modal')) closeNewDmModal();
});

document.getElementById('dm-back').addEventListener('click', closeDm);
document.getElementById('dm-send-btn').addEventListener('click', sendDm);
document.getElementById('dm-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDm(); }
});

document.getElementById('rail-home').addEventListener('click', () => {
  loadConversations();
});

document.querySelector('.rail-add-ws').addEventListener('click', () => {
  navigateTo('workspace.html');
});

// ─── Voice Call Button ────────────────────────────────────────────────────────

document.getElementById('voice-call-btn').addEventListener('click', () => {
  if (!currentDmUser) {
    alert('Please select a conversation first.');
    return;
  }
  startVoiceCall(currentDmUser);
});

function startVoiceCall(user) {
  if (!socket) initializeSocket();

  const me = getUser();
  // Generate stable room name from both user IDs so both sides use the same room
  const roomName = ['dm', me.user_id, user.user_id].sort().join('_');

  if (socket && socket.connected) {
    socket.emit('outgoing_call', {
      receiverId:   user.user_id,
      receiverName: user.name,
      callerId:     me.user_id,
      callerName:   me.name,
      roomName,
    });
  }

  showDialingModal(user, true);
}

// ─── Dialing Modal ────────────────────────────────────────────────────────────

function showDialingModal(user, isInitiator = false) {
  const existing = document.getElementById('voice-call-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'voice-call-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';

  let avatarHTML = '';
  if (user.avatar_url) {
    avatarHTML = `<img src="${user.avatar_url}" alt="${escapeHtml(user.name)}" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    avatarHTML = (user.name || '?').charAt(0).toUpperCase();
  }

  const buttonsHTML = isInitiator
    ? `<button id="dialing-cancel-btn" style="height:48px;padding:0 24px;border:2px solid var(--black);background:var(--white);font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;transition:background 0.1s;">CANCEL CALL</button>`
    : `<div style="display:flex;gap:12px;justify-content:center;">
        <button id="dialing-decline-btn" style="height:48px;padding:0 24px;border:2px solid var(--black);background:var(--white);font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;">DECLINE</button>
        <button id="dialing-accept-btn" style="height:48px;padding:0 24px;border:2px solid var(--red);background:var(--red);color:var(--white);font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;">ACCEPT</button>
      </div>`;



  overlay.innerHTML = `
    <div class="modal-box" style="width:380px;">
      <div class="modal-title">VOICE CALL</div>
      <div class="modal-body" style="text-align:center;padding:40px 24px;">
        <div style="width:80px;height:80px;background:var(--black);color:var(--white);font-family:'Black Han Sans',sans-serif;font-size:32px;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;border:2px solid var(--black);overflow:hidden;">
          ${avatarHTML}
        </div>
        <div style="font-family:'Black Han Sans',sans-serif;font-size:16px;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;">
          ${escapeHtml(user.name || 'User')}
        </div>
        <div style="font-size:12px;color:var(--gray-600);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:32px;" id="dialing-status-text">
          ${isInitiator ? 'Requesting call...' : 'Incoming call...'}
        </div>
        <div style="display:flex;gap:12px;justify-content:center;">
          ${buttonsHTML}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const statusText = overlay.querySelector('#dialing-status-text');

  function closeDialingModal() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s ease';
    setTimeout(() => overlay.remove(), 150);
  }

  if (isInitiator) {
    const cancelBtn = overlay.querySelector('#dialing-cancel-btn');
    cancelBtn.addEventListener('mouseover', () => cancelBtn.style.background = 'var(--gray-100)');
    cancelBtn.addEventListener('mouseout',  () => cancelBtn.style.background = 'var(--white)');
    cancelBtn.addEventListener('click', () => {
  if (socket) {
    socket.emit('call_cancelled_by_initiator', { receiverId: currentDmUser?.user_id });
  }
  closeDialingModal();
});
  } else {
    const declineBtn = overlay.querySelector('#dialing-decline-btn');
    const acceptBtn  = overlay.querySelector('#dialing-accept-btn');
    // ── 30s countdown for receiver ──
let countdown = 20;
const countdownEl = document.createElement('div');
countdownEl.style.display = 'none';
statusText.parentNode.insertBefore(countdownEl, statusText.nextSibling);

const countdownTimer = setInterval(() => {
  countdown--;
  countdownEl.textContent = `AUTO-DECLINE IN ${countdown}S`;
  if (countdown <= 0) {
    clearInterval(countdownTimer);
    // Notify caller of no answer
    if (socket && currentCallRequest) {
      socket.emit('call_declined', { callerId: currentCallRequest.callerId, noAnswer: true });
    }
    currentCallRequest = null;
    closeDialingModal();
  }
}, 1000);

// Clear countdown if manually declined or accepted
declineBtn.addEventListener('click', () => clearInterval(countdownTimer), { once: true });
acceptBtn.addEventListener('click',  () => clearInterval(countdownTimer), { once: true });

    declineBtn.addEventListener('mouseover', () => declineBtn.style.background = 'var(--gray-100)');
    declineBtn.addEventListener('mouseout',  () => declineBtn.style.background = 'var(--white)');
    acceptBtn.addEventListener('mouseover',  () => acceptBtn.style.background = 'var(--red-dark)');
    acceptBtn.addEventListener('mouseout',   () => acceptBtn.style.background = 'var(--red)');

    declineBtn.addEventListener('click', () => {
      if (socket && currentCallRequest) {
        socket.emit('call_declined', { callerId: currentCallRequest.callerId });
      }
      currentCallRequest = null;
      closeDialingModal();
    });

    acceptBtn.addEventListener('click', async () => {
      acceptBtn.disabled     = true;
      acceptBtn.textContent  = 'CONNECTING...';
      statusText.textContent = 'Starting call...';

      try {
        const authToken = getToken();
        const me        = getUser();

        const roomName = currentCallRequest?.roomName || ['dm', me.user_id, currentCallRequest?.callerId].sort().join('_');

        const res = await fetch(`${API_BASE}/calls/token`, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({
            roomName,
            participantName: me.name || me.user_id,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          statusText.textContent = err.error || 'Failed to start call';
          acceptBtn.disabled     = false;
          acceptBtn.textContent  = 'ACCEPT';
          return;
        }

        const { token: livekitToken, serverUrl } = await res.json();

        // Notify caller that call was accepted, send roomName back
        if (socket && currentCallRequest) {
          socket.emit('call_accepted', {
            callerId: currentCallRequest.callerId,
            roomName,
          });
        }
        currentCallRequest = null;

        try {
  const callRes = await fetch(`${API_BASE}/calls/dm`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ room_name: roomName, call_type: 'audio' }),
  });
  if (callRes.ok) {
    const callData = await callRes.json();
    window._dmCallId = callData.call?.call_id || null;
  }
} catch (err) {
  console.error('Could not log call start:', err);
}

closeDialingModal();
startInPageVoiceCall({ user, roomName, livekitToken, serverUrl });

      } catch (err) {
        console.error('Call error:', err);
        statusText.textContent = 'Connection failed. Try again.';
        acceptBtn.disabled     = false;
        acceptBtn.textContent  = 'ACCEPT';
      }
    });

    overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeDialingModal();
});
  }
}

// ─── In-Page Voice/Video Call — LiveKit state ─────────────────────────────────

let livekitRoom       = null;
let callMicEnabled    = false;
let callCamEnabled    = false;
let callTimerSecs     = 0;
let callTimerInterval = null;
let callAudioCtx      = null;
let callAnalyser      = null;
let callLevelTimer    = null;

// ─── Start In-Page Call ───────────────────────────────────────────────────────

function startInPageVoiceCall({ user, roomName, livekitToken, serverUrl }) {
  document.getElementById('dm-call-screen')?.remove();

  const me = getUser();

  let peerAvatarHTML = user.avatar_url
    ? `<img src="${user.avatar_url}" alt="${escapeHtml(user.name)}" />`
    : (user.name || '?').charAt(0).toUpperCase();

  let myAvatarHTML = me?.avatar_url
    ? `<img src="${me.avatar_url}" alt="${escapeHtml(me.name)}" />`
    : (me?.name || 'Y').charAt(0).toUpperCase();

  const screen = document.createElement('div');
  screen.id = 'dm-call-screen';

  screen.innerHTML = `
    <div class="dm-call-header">
      <div class="dm-call-header-left">
        <div class="dm-call-logo">✣</div>
        <div class="dm-call-meta">
          <span class="dm-call-label">PRIVATE CALL</span>
          <span class="dm-call-peer-name">${escapeHtml((user.name || 'User').toUpperCase())}</span>
        </div>
      </div>
      <div class="dm-call-header-right">
        <div class="dm-call-status-badge" id="dm-call-status">CONNECTING</div>
        <div class="dm-call-timer" id="dm-call-timer">00:00:00</div>
      </div>
    </div>

    <div class="dm-call-stage">
      <div class="dm-call-tile-peer" id="dm-call-peer-tile">
        <video id="dm-call-peer-video" autoplay playsinline></video>
        <audio id="dm-call-peer-audio" autoplay></audio>
        <div class="dm-call-tile-avatar" id="dm-call-peer-avatar">${peerAvatarHTML}</div>
        <div class="dm-call-tile-name">${escapeHtml((user.name || 'User').toUpperCase())}</div>
        <div class="dm-call-peer-meter" id="dm-call-peer-meter">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>

      <div class="dm-call-tile-self" id="dm-call-self-tile">
        <video id="dm-call-self-video" autoplay muted playsinline></video>
        <div class="dm-call-tile-avatar dm-call-self-avatar" id="dm-call-self-avatar">${myAvatarHTML}</div>
        <div class="dm-call-self-name">${escapeHtml((me?.name || 'You').toUpperCase())}</div>
        <div class="dm-call-self-meter" id="dm-call-self-meter">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>
    </div>

    <div class="dm-call-controls">
      <div class="dm-call-ctrl-group">
        <button class="dm-call-ctrl" id="dm-ctrl-mute">
          <div class="dm-call-ctrl-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/>
            </svg>
          </div>
          <span>MIC</span>
        </button>

        <button class="dm-call-ctrl" id="dm-ctrl-video">
          <div class="dm-call-ctrl-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M4 6h11a2 2 0 0 1 2 2v1.25L22 6.5v11l-5-2.75V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/>
            </svg>
          </div>
          <span>VIDEO</span>
        </button>
      </div>

      <button class="dm-call-ctrl-end" id="dm-ctrl-end">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.7-.36 1.06-.2 1.1.45 2.3.7 3.54.7.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.57 21 3 13.43 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.2 1.01L6.6 10.8Z"/>
        </svg>
        <span>END CALL</span>
      </button>
    </div>
  `;

  document.body.appendChild(screen);
  requestAnimationFrame(() => screen.classList.add('dm-call-screen-visible'));

  // ── Timer ──────────────────────────────────────────────────────────────────
  callTimerSecs = 0;
  clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    callTimerSecs++;
    const h = String(Math.floor(callTimerSecs / 3600)).padStart(2, '0');
    const m = String(Math.floor((callTimerSecs % 3600) / 60)).padStart(2, '0');
    const s = String(callTimerSecs % 60).padStart(2, '0');
    screen.querySelector('#dm-call-timer').textContent = `${h}:${m}:${s}`;
  }, 1000);

  // ── Mic toggle ─────────────────────────────────────────────────────────────
  screen.querySelector('#dm-ctrl-mute').addEventListener('click', async () => {
    if (!livekitRoom) return;
    callMicEnabled = !callMicEnabled;
    await livekitRoom.localParticipant.setMicrophoneEnabled(callMicEnabled);
    const btn = screen.querySelector('#dm-ctrl-mute');
    btn.classList.toggle('dm-call-ctrl-on', callMicEnabled);
    btn.querySelector('span').textContent = callMicEnabled ? 'MIC ON' : 'MIC';
  });

  // ── Video toggle ───────────────────────────────────────────────────────────
  screen.querySelector('#dm-ctrl-video').addEventListener('click', async () => {
    if (!livekitRoom) return;
    callCamEnabled = !callCamEnabled;

    const selfVideo  = screen.querySelector('#dm-call-self-video');
    const selfAvatar = screen.querySelector('#dm-call-self-avatar');
    const selfTile   = screen.querySelector('#dm-call-self-tile');
    const btn        = screen.querySelector('#dm-ctrl-video');

    if (callCamEnabled) {
      await livekitRoom.localParticipant.setCameraEnabled(true);

      // Wait for the track to be ready then attach it locally
      const attachLocal = () => {
        const camPub = livekitRoom.localParticipant.getTrackPublication(LivekitClient.Track.Source.Camera);
        if (camPub?.track) {
          camPub.track.attach(selfVideo);
          selfVideo.style.display = 'block';
          selfAvatar.style.display = 'none';
          selfTile.classList.add('has-video');
        }
      };

      // Try immediately, then retry once after a short delay if track isn't ready yet
      attachLocal();
      setTimeout(attachLocal, 500);

    } else {
      await livekitRoom.localParticipant.setCameraEnabled(false);
      selfVideo.srcObject = null;
      selfVideo.style.display = 'none';
      selfAvatar.style.display = 'flex';
      selfTile.classList.remove('has-video');
    }

    btn.classList.toggle('dm-call-ctrl-on', callCamEnabled);
    btn.querySelector('span').textContent = callCamEnabled ? 'CAM ON' : 'VIDEO';
  });

  // ── End call ───────────────────────────────────────────────────────────────
  screen.querySelector('#dm-ctrl-end').addEventListener('click', () => {
    endInPageCall(screen);
  });

  // ── Connect ────────────────────────────────────────────────────────────────
  connectDmCall({ screen, livekitToken, serverUrl });
}

// ─── Connect to LiveKit ───────────────────────────────────────────────────────

async function connectDmCall({ screen, livekitToken, serverUrl }) {
  const statusEl = screen.querySelector('#dm-call-status');

  try {
    const { Room, RoomEvent, Track } = LivekitClient;

    livekitRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      },
    });

    livekitRoom.on(RoomEvent.ParticipantConnected, () => {
      statusEl.textContent = 'LIVE';
      statusEl.classList.add('dm-call-status-live');
      screen.querySelector('#dm-call-peer-tile').classList.add('dm-tile-connected');
    });

    livekitRoom.on(RoomEvent.ParticipantDisconnected, () => {
  statusEl.textContent = 'PEER LEFT';
  statusEl.classList.remove('dm-call-status-live');
  // Notify peer and end call automatically
  if (socket && currentDmUser) {
    socket.emit('call_ended', { userId: currentDmUser.user_id });
  }
  setTimeout(() => endInPageCall(screen), 1500);
});

    livekitRoom.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const el = screen.querySelector('#dm-call-peer-audio');
        if (el) track.attach(el);
      }
      if (track.kind === Track.Kind.Video) {
        const videoEl  = screen.querySelector('#dm-call-peer-video');
        const avatarEl = screen.querySelector('#dm-call-peer-avatar');
        const peerTile = screen.querySelector('#dm-call-peer-tile');
        if (videoEl) {
          track.attach(videoEl);
          videoEl.style.display = 'block';
          if (avatarEl) avatarEl.style.display = 'none';
          peerTile?.classList.add('has-video');
        }
      }
    });

    livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Video) {
        const videoEl  = screen.querySelector('#dm-call-peer-video');
        const avatarEl = screen.querySelector('#dm-call-peer-avatar');
        const peerTile = screen.querySelector('#dm-call-peer-tile');
        if (videoEl) {
          track.detach(videoEl);
          videoEl.style.display = 'none';
          if (avatarEl) avatarEl.style.display = 'flex';
          peerTile?.classList.remove('has-video');
        }
      }
    });

    livekitRoom.on(RoomEvent.Disconnected, () => {
  statusEl.textContent = 'ENDED';
  if (socket && currentDmUser) {
    socket.emit('call_ended', { userId: currentDmUser.user_id });
  }
  endInPageCall(screen);
});

    await livekitRoom.connect(serverUrl, livekitToken);

    // Enable mic on connect
    await livekitRoom.localParticipant.setMicrophoneEnabled(true);
    callMicEnabled = true;
    const muteBtn = screen.querySelector('#dm-ctrl-mute');
    muteBtn.classList.add('dm-call-ctrl-on');
    muteBtn.querySelector('span').textContent = 'MIC ON';

    // Voice meter for self
    const micPub = livekitRoom.localParticipant.getTrackPublication(LivekitClient.Track.Source.Microphone);
    if (micPub?.track) {
      startCallVoiceMeter(micPub.track.mediaStreamTrack, screen.querySelector('#dm-call-self-meter'));
    }

    // Handle participants already in room
    livekitRoom.remoteParticipants.forEach((participant) => {
      statusEl.textContent = 'LIVE';
      statusEl.classList.add('dm-call-status-live');
      screen.querySelector('#dm-call-peer-tile').classList.add('dm-tile-connected');

      participant.trackPublications.forEach((pub) => {
        if (!pub.track) return;
        if (pub.track.kind === Track.Kind.Audio) {
          const el = screen.querySelector('#dm-call-peer-audio');
          if (el) pub.track.attach(el);
        }
        if (pub.track.kind === Track.Kind.Video) {
          const videoEl  = screen.querySelector('#dm-call-peer-video');
          const avatarEl = screen.querySelector('#dm-call-peer-avatar');
          if (videoEl) {
            pub.track.attach(videoEl);
            videoEl.style.display = 'block';
            if (avatarEl) avatarEl.style.display = 'none';
          }
        }
      });
    });

    if (livekitRoom.remoteParticipants.size === 0) {
      statusEl.textContent = 'WAITING...';
    }

  } catch (err) {
    console.error('LiveKit DM call error:', err);
    statusEl.textContent = 'FAILED';
  }
}

// ─── Voice Meter ──────────────────────────────────────────────────────────────

function startCallVoiceMeter(mediaStreamTrack, meterEl) {
  if (!meterEl) return;
  callAudioCtx  = new (window.AudioContext || window.webkitAudioContext)();
  const source  = callAudioCtx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
  callAnalyser  = callAudioCtx.createAnalyser();
  callAnalyser.fftSize = 256;
  source.connect(callAnalyser);
  const data  = new Uint8Array(callAnalyser.frequencyBinCount);
  const spans = meterEl.querySelectorAll('span');

  clearInterval(callLevelTimer);
  callLevelTimer = setInterval(() => {
    if (!callAnalyser) return;
    callAnalyser.getByteFrequencyData(data);
    const level = data.reduce((s, v) => s + v, 0) / data.length;
    spans.forEach((span, i) => {
      span.classList.toggle('active', level > (i + 1) * (100 / spans.length));
    });
  }, 100);
}

// ─── End Call ─────────────────────────────────────────────────────────────────

function endInPageCall(screen) {
  clearInterval(callTimerInterval);
  clearInterval(callLevelTimer);

  if (window._dmCallId) {
    fetch(`${API_BASE}/calls/dm/${window._dmCallId}/end`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
    }).catch(err => console.error('Could not log call end:', err));
    window._dmCallId = null;
  }

  if (livekitRoom) {
    livekitRoom.disconnect();
    livekitRoom = null;
  }

  if (callAudioCtx) {
    callAudioCtx.close();
    callAudioCtx = null;
    callAnalyser = null;
  }

  callMicEnabled = false;
  callCamEnabled = false;

  screen.classList.remove('dm-call-screen-visible');
  setTimeout(() => screen?.remove(), 300);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

populateSelfInfo();
loadConversations();
loadWorkspacesIntoRail();

// Check for pending call BEFORE initializeSocket so we launch ASAP
const _urlParams = new URLSearchParams(window.location.search);
const _callUserId = _urlParams.get('callUserId');
const _pendingCall = sessionStorage.getItem('_ch_pending_call');

if (_callUserId && _pendingCall) {
  sessionStorage.removeItem('_ch_pending_call');
  const _callData = JSON.parse(_pendingCall);
  openDm(_callData.user);
  initializeSocket();
  // Give socket a moment to connect, then immediately join the call
  setTimeout(() => startInPageVoiceCall(_callData), 100);
} else {
  initializeSocket();
}

// Initialize mobile layout
if (window.innerWidth <= 700) {
  const sidebar = document.querySelector('.sidebar');
  const dmPanel = document.getElementById('dm-panel');
  if (sidebar) sidebar.classList.remove('active');
  if (dmPanel) dmPanel.classList.remove('hidden');
}

// ─── Lightbox event listeners ─────────────────────────────────────────────────

const lightboxClose   = document.getElementById('lightbox-close');
const lightboxOverlay = document.getElementById('lightbox-overlay');

if (lightboxClose) {
  lightboxClose.addEventListener('click', closeLightbox);
}

if (lightboxOverlay) {
  lightboxOverlay.addEventListener('click', (e) => {
    if (e.target === lightboxOverlay) closeLightbox();
  });
}

document.addEventListener('keydown', (e) => {
   if (e.key === 'Escape' && lightboxOverlay && lightboxOverlay.style.display === 'flex') {
    closeLightbox();
  }
});
// ─── In-Chat Message Search ───────────────────────────────────────────────────

(function setupDmSearch() {
  const searchBtn   = document.getElementById('msg-search-btn');
  const searchBar   = document.getElementById('msg-search-bar-container');
  const searchInput = document.getElementById('msg-search-input');
  const searchClear = document.getElementById('msg-search-clear-btn');

  if (!searchBtn || !searchBar || !searchInput) return;

  searchBtn.addEventListener('click', () => {
    const isOpen = searchBar.style.display === 'flex';
    if (isOpen) {
      searchBar.style.display = 'none';
      searchInput.value = '';
      clearDmSearch();
    } else {
      searchBar.style.display = 'flex';
      searchInput.focus();
    }
  });

  searchInput.addEventListener('input', () => {
    filterDmMessages(searchInput.value.trim().toLowerCase());
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchBar.style.display = 'none';
    clearDmSearch();
  });
})();

function filterDmMessages(query) {
  const container = document.getElementById('dm-messages');
  if (!container) return;

  const messages = container.querySelectorAll('.dm-message');
  if (!query) {
    messages.forEach(msg => {
      msg.style.display = '';
      msg.querySelectorAll('mark.search-highlight').forEach(mark => {
        mark.replaceWith(mark.textContent);
      });
    });
    return;
  }

  messages.forEach(msg => {
    const bubble = msg.querySelector('.dm-bubble');
    const bubbleText = bubble?.textContent?.toLowerCase() || '';
    const fileNames = Array.from(msg.querySelectorAll('.message-file-name'))
      .map(el => el.textContent.toLowerCase()).join(' ');

    if (bubbleText.includes(query) || fileNames.includes(query)) {
      msg.style.display = '';
      if (bubble) {
        const original = bubble.textContent;
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        bubble.innerHTML = original.replace(regex, '<mark class="search-highlight" style="background:#ffe066;border-radius:2px;padding:0 1px;">$1</mark>');
      }
    } else {
      msg.style.display = 'none';
    }
  });
}

function clearDmSearch() {
  const container = document.getElementById('dm-messages');
  if (!container) return;
  container.querySelectorAll('.dm-message').forEach(msg => {
    msg.style.display = '';
    msg.querySelectorAll('mark.search-highlight').forEach(mark => {
      mark.replaceWith(mark.textContent);
    });
  });
}