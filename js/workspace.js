const API_BASE = 'https://linksphere-5bef.onrender.com/api';
const SOCKET_URL = 'https://linksphere-5bef.onrender.com';

// ── Authentication Check ───────────────────────────────────────────────────────
(function() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '../html/login.html';
  }
})();

let currentWorkspace     = null;
let currentChannelId     = null;
let currentChannelName   = null;
let currentChannelType   = 'text';
let messagePolling       = null;
let attachedFiles        = [];
let socket              = null;
let currentCallRequest   = null;
// WebRTC state for voice channel camera thumbnails
let localStream = null;
let localAudioEnabled = true;
let peerConnections = {}; // peerConnections[channelId] = { userId: RTCPeerConnection }
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let remoteStreams = {}; // remoteStreams[channelId] = { userId: MediaStream }
let voiceGridOpen = false;

const DEFAULT_TEXT_CHANNEL  = 'General';
const DEFAULT_VOICE_CHANNEL = 'Lobby';

function getChannelType(channel) {
  const type = String(channel?.type || '').toLowerCase();
  if (type.includes('voice')) return 'voice';
  if (type.includes('text')) return 'text';

  const name = String(channel?.name || '');
  if (name.startsWith('voice_')) return 'voice';
  const nameLower = name.toLowerCase();
  if (nameLower === DEFAULT_VOICE_CHANNEL.toLowerCase()) return 'voice';
  if (nameLower === 'lobby') return 'voice';

  const description = String(channel?.description || '').toLowerCase();
  if (description.includes('voice') || description.includes('call')) return 'voice';

  return 'text';
}

function getChannelDisplayName(channel) {
  const name = String(channel?.name || '');
  const display = name.startsWith('voice_') ? name.slice('voice_'.length) : name;
  return display.charAt(0).toUpperCase() + display.slice(1);
}

function isDefaultChannel(channel) {
  const display = getChannelDisplayName(channel).toLowerCase();
  return display === DEFAULT_TEXT_CHANNEL.toLowerCase() || display === DEFAULT_VOICE_CHANNEL.toLowerCase();
}

// ─── Initialize Socket.io ─────────────────────────────────────────────────────

function initializeSocket() {
  if (socket) return; // Already connected
  
  const token = getToken();
  if (!token) return;
  
  socket = io(SOCKET_URL, {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    // Auto-register user for WebRTC signaling
    const user = getUser();
    if (user && user.user_id) {
      socket.emit('register', { userId: user.user_id });
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

    // Show call modal with receiver UI (ACCEPT/DECLINE)
    playCallSound();
    showDialingModal(callerProfile, false);
  });
    socket.on('reaction_added', () => {
    if (currentChannelId) loadMessages(currentChannelId);
  });

  socket.on('reaction_removed', () => {
    if (currentChannelId) loadMessages(currentChannelId);
  });

  // ── Listen for call rejection ──────────────────────────────────────────────
  socket.on('call_rejected', () => {
    const overlay = document.getElementById('voice-call-overlay');
    if (overlay) {
      const statusText = overlay.querySelector('#dialing-status-text');
      if (statusText) statusText.textContent = 'Call rejected';
      setTimeout(() => overlay.remove(), 2000);
    }
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


  // ── Listen for voice channel member joined ───────────────────────────────
  socket.on('voice_member_joined', (data) => {
    const { channelId, userId, userName } = data;
    
    if (!voiceChannelMembers[channelId]) voiceChannelMembers[channelId] = [];
    
    if (!voiceChannelMembers[channelId].some(m => m.user_id === userId)) {
      voiceChannelMembers[channelId].push({
        user_id: userId,
        name: userName,
        status: 'online',
        muted: false,
        cameraOn: false,
      });
    }
    
    if (currentChannelId === channelId && currentChannelType === 'voice') {
      renderVoiceChannelMembers(channelId);
      if (voiceGridOpen) renderVoiceGrid(channelId);
    }
    renderVoiceSidebarMembers(channelId);
  });

  // ── Listen for voice channel member left ──────────────────────────────────
  socket.on('voice_member_left', (data) => {
    const { channelId, userId } = data;
    
    if (voiceChannelMembers[channelId]) {
      voiceChannelMembers[channelId] = voiceChannelMembers[channelId].filter(
        m => m.user_id !== userId
      );
    }
    
    if (currentChannelId === channelId && currentChannelType === 'voice') {
      renderVoiceChannelMembers(channelId);
      if (voiceGridOpen) renderVoiceGrid(channelId);
    }
    renderVoiceSidebarMembers(channelId);
  });

  // ── Listen for voice member mute state change ─────────────────────────────
  socket.on('voice_member_mute_changed', (data) => {
    const { channelId, userId, muted } = data;
    
    if (voiceChannelMembers[channelId]) {
      const member = voiceChannelMembers[channelId].find(m => m.user_id === userId);
      if (member) member.muted = muted;
    }
    
    if (currentChannelId === channelId && currentChannelType === 'voice') {
      renderVoiceChannelMembers(channelId);
    }
    renderVoiceSidebarMembers(channelId);
  });

  socket.on('voice_member_camera_changed', (data) => {
    const { channelId, userId, cameraOn } = data;
    
    if (voiceChannelMembers[channelId]) {
      const member = voiceChannelMembers[channelId].find(m => m.user_id === userId);
      if (member) member.cameraOn = cameraOn;
    }
    
    if (currentChannelId === channelId && currentChannelType === 'voice') {
      renderVoiceChannelMembers(channelId);
      // Refresh grid if open
      if (voiceGridOpen) {
        renderVoiceGrid(channelId);
      }
      // If a remote turned camera on, ensure we handle signaling to receive their stream
      if (cameraOn && socket && getUser()?.user_id !== userId) {
        // Ask remote to initiate WebRTC with us by emitting a request
        socket.emit('webrtc_request_offer', { channelId, toUserId: userId });
      }
    }
  });

  // WebRTC signaling handlers
  socket.on('webrtc_offer', async (data) => {
    try {
      const { channelId, fromUserId, sdp } = data;
      const me = getUser();
      if (!me || me.user_id === fromUserId) return;

      if (!peerConnections[channelId]) peerConnections[channelId] = {};
      // create peer connection for this remote
      const pc = new RTCPeerConnection(ICE_CONFIG);
      peerConnections[channelId][fromUserId] = pc;

      // attach local tracks if we have camera (send our audio+video if available)
      if (localStream) {
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          socket.emit('webrtc_ice_candidate', { channelId, toUserId: fromUserId, candidate: ev.candidate });
        }
      };

      pc.ontrack = (ev) => {
        // remote stream received — attach to member tile
        const remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream(ev.track ? [ev.track] : []);
        if (!remoteStreams[channelId]) remoteStreams[channelId] = {};
        remoteStreams[channelId][fromUserId] = remoteStream;
        attachRemoteStreamToMember(channelId, fromUserId, remoteStream);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('webrtc_answer', { channelId, toUserId: fromUserId, sdp: pc.localDescription });
    } catch (err) {
      console.error('Error handling webrtc_offer', err);
    }
  });

  socket.on('webrtc_answer', async (data) => {
    try {
      const { channelId, fromUserId, sdp } = data;
      const pc = peerConnections[channelId] && peerConnections[channelId][fromUserId];
      if (pc && sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    } catch (err) {
      console.error('Error handling webrtc_answer', err);
    }
  });

  socket.on('webrtc_ice_candidate', async (data) => {
    try {
      const { channelId, fromUserId, candidate } = data;
      const pc = peerConnections[channelId] && peerConnections[channelId][fromUserId];
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (err) {
      console.error('Error adding ICE candidate', err);
    }
  });

  // Remote requested we create an offer to them (they turned camera on)
  socket.on('webrtc_request_offer', async (data) => {
    try {
      const { channelId, fromUserId } = data; // fromUserId is the one requesting
      const me = getUser();
      if (!me) return;
      // create peer connection and offer to the requester
      if (!peerConnections[channelId]) peerConnections[channelId] = {};
      if (peerConnections[channelId][fromUserId]) return; // already exists

      const pc = new RTCPeerConnection(ICE_CONFIG);
      peerConnections[channelId][fromUserId] = pc;

      if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

      pc.onicecandidate = (ev) => {
        if (ev.candidate) socket.emit('webrtc_ice_candidate', { channelId, toUserId: fromUserId, candidate: ev.candidate });
      };

      pc.ontrack = (ev) => {
        const remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream(ev.track ? [ev.track] : []);
        if (!remoteStreams[channelId]) remoteStreams[channelId] = {};
        remoteStreams[channelId][fromUserId] = remoteStream;
        attachRemoteStreamToMember(channelId, fromUserId, remoteStream);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc_offer', { channelId, toUserId: fromUserId, sdp: pc.localDescription });
    } catch (err) {
      console.error('Error creating offer', err);
    }
  });

  // Listen for when member is kicked from a private channel
  socket.on('user_kicked_from_channel', (data) => {
    const { channelId, channelName, memberName } = data;
    const me = getUser();
    if (!me) return;

    console.log('⚠️ KICKED EVENT RECEIVED:', { channelId, channelName, memberName });

    showKickNotificationModal(channelName, memberName);

    if (currentChannelId === channelId) {
      closeChatPanel();
      setChannelContent('<p class="status-msg" style="color:#cc1414;font-size:14px;font-weight:600;">🔒 You have been removed from this private channel by the owner.</p>');
      currentChannelId = null;
    }

    if (currentWorkspace) {
      setTimeout(() => loadWorkspace(currentWorkspace), 800);
    }
  });

  // Fallback: direct targeted kick notification
  socket.on('you_were_kicked', (data) => {
    const { channelId, channelName, memberName } = data;
    const me = getUser();
    if (!me) return;

    console.log('⚠️ YOU_WERE_KICKED EVENT RECEIVED:', { channelId, channelName, memberName });

    showKickNotificationModal(channelName, memberName);

    if (currentChannelId === channelId) {
      closeChatPanel();
      setChannelContent('<p class="status-msg" style="color:#cc1414;font-size:14px;font-weight:600;">🔒 You have been removed from this private channel by the owner.</p>');
      currentChannelId = null;
    }

    if (currentWorkspace) {
      setTimeout(() => loadWorkspace(currentWorkspace), 800);
    }
  });


}

// ─── Play incoming call sound ─────────────────────────────────────────────────

function playCallSound() {
  try {
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
  } catch (err) {
    console.error('Error playing call sound:', err);
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

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function setChannelContent(html) {
  document.getElementById('channel-content').innerHTML = html;
}

function showChannelSpinner(message = 'Loading...') {
  setChannelContent(`<div class="spinner"></div><p class="status-msg">${message}</p>`);
}

function showChannelError(message) {
  setChannelContent(`<p class="status-msg error">⚠ ${message}</p>`);
}

function setSidebarWsName(name) {
  document.getElementById('sidebar-ws-name').textContent = name.toUpperCase();
}

function renderUserProfile() {
  const user = getUser();
  if (!user) return;

  const profileImg  = document.getElementById('profile-img');
  const nameEl      = document.getElementById('profile-user-name');
  const statusEl    = document.getElementById('profile-user-status');

  if (nameEl)   nameEl.textContent   = (user.name || user.username || 'User').toUpperCase();
  if (statusEl) statusEl.textContent = 'Online';

  if (!profileImg) return;

  if (user.avatar_url) {
    profileImg.style.padding  = '0';
    profileImg.style.overflow = 'hidden';
    profileImg.innerHTML = `<img src="${escapeHtml(user.avatar_url)}" alt="${escapeHtml(user.name || '')}" style="width:100%;height:100%;object-fit:cover;display:block;" />`;
  } else {
    const initial = (user.name || 'U').charAt(0).toUpperCase();
    profileImg.innerHTML = '';
    profileImg.textContent = initial;
    profileImg.style.background    = 'linear-gradient(135deg, #cc1414, #111)';
    profileImg.style.color         = '#fff';
    profileImg.style.display       = 'flex';
    profileImg.style.alignItems    = 'center';
    profileImg.style.justifyContent = 'center';
    profileImg.style.fontFamily    = "'Black Han Sans', sans-serif";
    profileImg.style.fontSize      = '14px';
  }
}
// ─── Chat panel open / close ──────────────────────────────────────────────────

function openChatPanel() {
  document.getElementById('chat-empty').style.display = 'none';
  document.getElementById('chat-inner').style.display = 'flex';
  document.getElementById('chat-panel').classList.add('mobile-open');
  document.getElementById('chat-panel').classList.add('open');
  document.querySelector('.sidebar').classList.add('hidden');
  document.querySelector('.sidebar').classList.remove('active');
}

function closeChatPanel() {
  document.getElementById('chat-inner').style.display = 'none';
  document.getElementById('chat-empty').style.display = '';
  document.getElementById('chat-panel').classList.remove('mobile-open');
  document.getElementById('chat-panel').classList.remove('open');
  document.querySelector('.sidebar').classList.remove('hidden');
  document.querySelector('.sidebar').classList.add('active');
}

// ─── Custom Modal ─────────────────────────────────────────────────────────────

function showModal({ title, label, placeholder, confirmText, onConfirm }) {
  const existing = document.getElementById('ls-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ls-modal-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes lsSlideUp {
        from { transform: translateY(20px); opacity: 0 }
        to   { transform: translateY(0);    opacity: 1 }
      }
      #ls-modal {
        width: 340px; background: #fff;
        border: 2px solid #111;
        font-family: 'DM Sans', Arial, Helvetica, sans-serif;
        animation: lsSlideUp 0.2s ease;
      }
      #ls-modal-title {
        background: #111; color: #fff;
        font-size: 13px; font-weight: 900;
        letter-spacing: 0.15em; padding: 14px 18px;
        font-family: 'Black Han Sans', sans-serif;
      }
      #ls-modal-body { padding: 20px 18px; }
      #ls-modal-label {
        display: block; font-size: 10px; font-weight: 700;
        letter-spacing: 0.12em; color: #666; margin-bottom: 8px;
        text-transform: uppercase;
      }
      #ls-modal-input {
        width: 100%; height: 42px; border: 2px solid #111;
        padding: 0 12px; font-size: 14px;
        font-family: 'DM Sans', Arial, Helvetica, sans-serif;
        outline: none; background: #f4f4f4; box-sizing: border-box;
      }
      #ls-modal-input:focus { background: #fff; }
      #ls-modal-error {
        font-size: 11px; font-weight: 700; color: #cc1414;
        margin-top: 6px; min-height: 16px; display: block;
      }
      #ls-modal-actions { display: flex; border-top: 2px solid #111; }
      #ls-modal-cancel {
        flex: 1; height: 48px; border: none; border-right: 2px solid #111;
        background: #fff; font-size: 12px; font-weight: 700;
        letter-spacing: 0.12em; cursor: pointer;
        font-family: 'DM Sans', Arial, Helvetica, sans-serif;
        text-transform: uppercase;
      }
      #ls-modal-cancel:hover { background: #f4f4f4; }
      #ls-modal-confirm {
        flex: 1; height: 48px; border: none;
        background: #cc1414; color: #fff;
        font-size: 12px; font-weight: 700;
        letter-spacing: 0.12em; cursor: pointer;
        font-family: 'DM Sans', Arial, Helvetica, sans-serif;
        text-transform: uppercase;
      }
      #ls-modal-confirm:hover { background: #a00f0f; }
    </style>
    <div id="ls-modal">
      <div id="ls-modal-title">${title}</div>
      <div id="ls-modal-body">
        <label id="ls-modal-label" for="ls-modal-input">${label}</label>
        <input id="ls-modal-input" type="text" placeholder="${placeholder}" autocomplete="off" />
        <span id="ls-modal-error"></span>
      </div>
      <div id="ls-modal-actions">
        <button id="ls-modal-cancel">CANCEL</button>
        <button id="ls-modal-confirm">${confirmText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input   = document.getElementById('ls-modal-input');
  const error   = document.getElementById('ls-modal-error');
  const cancel  = document.getElementById('ls-modal-cancel');
  const confirm = document.getElementById('ls-modal-confirm');

  input.focus();

  function close() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s ease';
    setTimeout(() => overlay.remove(), 150);
  }

  function submit() {
    const value = input.value.trim();
    if (!value) {
      error.textContent = 'This field cannot be empty.';
      input.style.borderColor = '#cc1414';
      input.focus();
      return;
    }
    close();
    onConfirm(value);
  }

  cancel.addEventListener('click', close);
  confirm.addEventListener('click', submit);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); submit(); }
    if (e.key === 'Escape') close();
    if (e.key !== 'Enter')  { error.textContent = ''; input.style.borderColor = '#111'; }
  });
}

// ─── Error Modal ──────────────────────────────────────────────────────────────

function showErrorModal(message) {
  const existing = document.getElementById('ls-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ls-modal-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;

  overlay.innerHTML = `
    <div style="
      width: 340px; background: #fff;
      border: 2px solid #111;
      font-family: 'DM Sans', Arial, Helvetica, sans-serif;
    ">
      <div style="background:#cc1414; color:#fff; font-size:13px; font-weight:900; letter-spacing:0.15em; padding:14px 18px;">
        ERROR
      </div>
      <div style="padding:20px 18px; font-size:13px; font-weight:600; color:#111; line-height:1.6;">
        ${message}
      </div>
      <div style="border-top: 2px solid #111;">
        <button id="ls-error-ok" style="
          width:100%; height:48px; border:none;
          background:#111; color:#fff;
          font-size:12px; font-weight:700; letter-spacing:0.12em;
          cursor:pointer; font-family:'DM Sans',Arial,Helvetica,sans-serif;
          text-transform:uppercase;
        ">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function close() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s ease';
    setTimeout(() => overlay.remove(), 150);
  }

  document.getElementById('ls-error-ok').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Enter') { close(); document.removeEventListener('keydown', onKey); }
  });
}

// ─── Kick Notification Modal ──────────────────────────────────────────────────

function showKickNotificationModal(channelName, memberName) {
  const existing = document.getElementById('kick-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'kick-modal-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 10000;
  `;

  overlay.innerHTML = `
    <div style="
      width: 360px; background: #fff;
      border: 2px solid #111;
      font-family: 'DM Sans', Arial, Helvetica, sans-serif;
      box-shadow: 8px 8px 0 rgba(0,0,0,0.1);
    ">
      <div style="background:#cc1414; color:#fff; font-size:13px; font-weight:900; letter-spacing:0.15em; padding:14px 18px; display:flex; align-items:center; gap:10px;">
        <span style="font-size:18px;">🔓</span>
        <span>CHANNEL ACCESS REVOKED</span>
      </div>
      <div style="padding:24px 18px; line-height:1.6;">
        <div style="font-size:12px; font-weight:700; color:#111; margin-bottom:12px;">
          You have been removed from the private channel.
        </div>
        <div style="padding:12px; background:#fff5f5; border:1px solid #ffcccc; border-radius:2px;">
          <div style="font-size:10px; font-weight:700; color:#cc1414; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:4px;">📌 Channel</div>
          <div style="font-size:12px; font-weight:600; color:#111;">${escapeHtml(channelName)}</div>
        </div>
        <div style="font-size:11px; color:#666; margin-top:16px; line-height:1.5;">
          The workspace owner has removed you from this private channel. You no longer have access to this channel or its messages.
        </div>
      </div>
      <div style="border-top: 2px solid #111;">
        <button id="kick-modal-ok" style="
          width:100%; height:48px; border:none;
          background:#111; color:#fff;
          font-size:12px; font-weight:700; letter-spacing:0.12em;
          cursor:pointer; font-family:'DM Sans',Arial,Helvetica,sans-serif;
          text-transform:uppercase;
          transition: all 0.1s;
        ">UNDERSTOOD</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function close() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s ease';
    setTimeout(() => overlay.remove(), 150);
  }

  const okBtn = document.getElementById('kick-modal-ok');
  okBtn.addEventListener('mouseover', () => okBtn.style.background = '#333');
  okBtn.addEventListener('mouseout', () => okBtn.style.background = '#111');
  okBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Enter') { close(); document.removeEventListener('keydown', onKey); }
  });
}

// ─── Toast Notification ───────────────────────────────────────────────────────

function showToast(message, duration = 3000) {
  const existing = document.getElementById('ls-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'ls-toast';
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #111; color: #fff;
    font-family: 'DM Sans', Arial, sans-serif;
    font-size: 12px; font-weight: 700; letter-spacing: 0.08em;
    padding: 12px 20px; border: 2px solid #cc1414;
    z-index: 99999; white-space: nowrap;
    animation: lsToastIn 0.2s ease;
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes lsToastIn {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes lsToastOut {
      from { opacity: 1; transform: translateX(-50%) translateY(0); }
      to   { opacity: 0; transform: translateX(-50%) translateY(10px); }
    }
  `;
  document.head.appendChild(style);

  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'lsToastOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// ─── Workspace Icon Helper ────────────────────────────────────────────────────

function buildWorkspaceIcon(ws) {
  const icon = document.createElement('div');
  icon.className  = 'server-icon workspace';
  icon.title      = ws.name;
  icon.dataset.id = ws.workspace_id;

  if (ws.icon_url) {
    const img = document.createElement('img');
    img.src              = ws.icon_url;
    img.alt              = ws.name;
    img.style.cssText    = 'width:100%;height:100%;object-fit:cover;display:block;';
    icon.style.padding   = '0';
    icon.style.overflow  = 'hidden';
    icon.appendChild(img);
  } else {
    icon.textContent = ws.name.charAt(0).toUpperCase();
  }

  return icon;
}

// ─── XSS Guard ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
        socket.emit('call_cancelled_by_initiator', { receiverId: currentChannelId });
      }
      closeDialingModal();
    });
  } else {
    const declineBtn = overlay.querySelector('#dialing-decline-btn');
    const acceptBtn  = overlay.querySelector('#dialing-accept-btn');

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
            roomName: currentCallRequest.roomName,
            participantName: me.name || me.user_id,
          }),
        });

        if (!res.ok) {
          console.error('Receiver failed to get LiveKit token');
          acceptBtn.disabled = false;
          return;
        }

        const { token: livekitToken, serverUrl } = await res.json();
        currentCallRequest = null;
        closeDialingModal();

        // Join call
        openLiveKitRoom(currentCallRequest?.roomName || 'call-room', livekitToken, serverUrl);
      } catch (err) {
        console.error('Error accepting call:', err);
        acceptBtn.disabled = false;
      }
    });
  }
}

// ─── Voice Channel Join Confirmation ──────────────────────────────────────────

function showVoiceChannelJoinConfirmation(channelId, channelName) {
  const existing = document.getElementById('voice-join-confirm-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'voice-join-confirm-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';

  overlay.innerHTML = `
    <div style="width:360px;background:var(--white);border:2px solid var(--black);padding:32px 24px;text-align:center;">
      <div style="font-family:'Black Han Sans',sans-serif;font-size:18px;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:20px;">
        Join Voice Channel?
      </div>
      <div style="font-size:16px;font-weight:600;margin-bottom:12px;">
        🔊 ${escapeHtml(channelName)}
      </div>
      <div style="font-size:13px;color:var(--gray-600);margin-bottom:32px;">
        Join this voice channel to connect with other members
      </div>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button id="voice-join-cancel-btn" style="height:44px;padding:0 24px;border:2px solid var(--black);background:var(--white);font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;transition:all 0.1s;flex:1;">CANCEL</button>
        <button id="voice-join-confirm-btn" style="height:44px;padding:0 24px;border:2px solid var(--red);background:var(--red);color:var(--white);font-family:'DM Sans',Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;flex:1;">JOIN</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function close() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s ease';
    setTimeout(() => overlay.remove(), 150);
  }

  const cancelBtn = document.getElementById('voice-join-cancel-btn');
  const confirmBtn = document.getElementById('voice-join-confirm-btn');

  cancelBtn.addEventListener('mouseover', () => cancelBtn.style.background = 'var(--gray-100)');
  cancelBtn.addEventListener('mouseout',  () => cancelBtn.style.background = 'var(--white)');
  confirmBtn.addEventListener('mouseover',  () => confirmBtn.style.background = 'var(--red-dark)');
  confirmBtn.addEventListener('mouseout',   () => confirmBtn.style.background = 'var(--red)');

  cancelBtn.addEventListener('click', close);

  confirmBtn.addEventListener('click', async () => {
    const user = getUser();
    const isOwner = currentWorkspace?.user_id === user?.user_id;
    const isAdmin = currentWorkspace?.myRole === 'admin';

    if (!isOwner && !isAdmin) {
      const token = getToken();
      try {
        const res = await fetch(`${API_BASE}/channels/${channelId}/access`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const accessList = res.ok ? await res.json() : [];
        const cached = window._channelAccessCache?.[channelId];
        const list = (Array.isArray(accessList) && accessList.length) ? accessList : (cached || []);
        if (!window._channelAccessCache) window._channelAccessCache = {};
        window._channelAccessCache[channelId] = list;
        if (list.length > 0 && !list.some(a => a.user_id === user?.user_id)) {
          close();
          showErrorModal(`🔒 Private Voice Channel Access Denied\n\nThe channel "🔊 ${escapeHtml(channelName)}" is private. Only the owner or members with specific permission can access it.\n\nPlease contact the workspace owner if you believe you should have access.`);
          return;
        }
      } catch (err) {
        close();
        showErrorModal(`🔒 Private Voice Channel Access Denied\n\nThe channel "🔊 ${escapeHtml(channelName)}" is private. Only the owner or members with specific permission can access it.\n\nPlease contact the workspace owner if you believe you should have access.`);
        return;
      }
    }

    // Store voice channel info and navigate to channel.html
    sessionStorage.setItem('voice_channel_id', channelId);
    sessionStorage.setItem('voice_channel_name', channelName);
    window.location.href = 'channel.html';
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// ─── File Helpers ─────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(file) {
  const t = file.type || '';
  const n = file.name || '';
  if (t.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(n)) return '🖼️';
  if (t.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(n))          return '🎬';
  if (t.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac)$/i.test(n))          return '🎵';
  if (t.includes('pdf')      || n.endsWith('.pdf'))                              return '📄';
  if (t.includes('zip')      || /\.(zip|rar|7z)$/i.test(n))                     return '🗜️';
  if (t.includes('word')     || /\.(doc|docx)$/i.test(n))                       return '📝';
  if (t.includes('sheet')    || /\.(xls|xlsx|csv)$/i.test(n))                   return '📊';
  return '📎';
}

function getFileCategoryIcon(type, name) {
  if (type.includes('pdf'))                                                                                    return '📄';
  if (type.includes('word') || type.includes('document') || name.endsWith('.docx') || name.endsWith('.doc')) return '📝';
  if (type.includes('sheet') || type.includes('excel') || type.includes('csv') || name.endsWith('.xlsx') || name.endsWith('.csv')) return '📊';
  if (type.includes('presentation') || name.endsWith('.pptx') || name.endsWith('.ppt'))                      return '📑';
  if (type.includes('zip') || type.includes('rar') || type.includes('7z') || name.endsWith('.zip') || name.endsWith('.rar')) return '🗜️';
  if (name.endsWith('.md') || name.endsWith('.txt') || type.includes('text/plain') || type.includes('markdown')) return '📋';
  if (type.includes('json') || name.endsWith('.json'))                                                        return '🔧';
  if (type.includes('javascript') || name.endsWith('.js') || name.endsWith('.ts'))                           return '⚙️';
  if (name.endsWith('.html') || name.endsWith('.css'))                                                        return '🌐';
  return '📎';
}

function renderAttachmentPreview() {
  const preview = document.getElementById('attachments-preview');
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

// ─── Build file HTML from a file record ───────────────────────────────────────

function buildFileHtml(f) {
  const fname   = f.file_name || '';
  const ext     = fname.split('.').pop().toLowerCase();
  const rawType = f.file_type || '';
  const url     = escapeHtml(f.file_url || '');
  const name    = escapeHtml(fname || 'File');
  const size    = (f.file_size || f.size) ? formatSize(f.file_size || f.size) : '';

  const isImage = rawType.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext);
  const isVideo = rawType.startsWith('video/') || ['mp4','mov','avi','mkv','webm'].includes(ext);
  const isAudio = rawType.startsWith('audio/') || ['mp3','wav','ogg','flac','aac','m4a'].includes(ext);

  if (isImage) {
    return `<img class="message-img" src="${url}" alt="${name}" />`;
  }
  if (isVideo) {
    return `
      <div class="message-video-wrap">
        <video class="message-video" controls preload="metadata">
          <source src="${url}" type="${escapeHtml(rawType)}" />
        </video>
        <div class="message-video-meta">
          <span class="message-file-icon">🎬</span>
          <span class="message-file-name">${name}</span>
          ${size ? `<span class="message-file-size">${size}</span>` : ''}
        </div>
      </div>`;
  }
  if (isAudio) {
    return `
      <div class="message-audio-wrap">
        <div class="message-audio-header">
          <span class="message-file-icon">🎵</span>
          <div>
            <div class="message-file-name">${name}</div>
            ${size ? `<div class="message-file-size">${size}</div>` : ''}
          </div>
        </div>
        <audio class="message-audio" controls preload="metadata">
          <source src="${url}" type="${escapeHtml(rawType)}" />
        </audio>
      </div>`;
  }
  return `
    <a class="message-download-card" href="${url}" download="${name}" target="_blank" rel="noopener noreferrer">
      <span class="message-download-icon">${getFileCategoryIcon(rawType, fname)}</span>
      <div class="message-download-info">
        <div class="message-file-name">${name}</div>
        ${size ? `<div class="message-file-size">${size}</div>` : ''}
      </div>
      <span class="message-download-arrow">⬇</span>
    </a>`;
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

// ─── Load Workspaces ──────────────────────────────────────────────────────────

async function loadWorkspaces() {
  const token = getToken();
  if (!token) return;

  setSidebarWsName('Loading');
  showChannelSpinner('Connecting to server...');

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${API_BASE}/workspaces`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();

    if (!res.ok) {
      setSidebarWsName('Error');
      showChannelError(data.error || 'Failed to load workspaces.');
      return;
    }

    renderWorkspaces(data);

  } catch (err) {
    if (err.name === 'AbortError') {
      setSidebarWsName('Offline');
      showChannelError('Server is waking up (Render cold start). Please refresh in 30 seconds.');
    } else {
      setSidebarWsName('Error');
      showChannelError('Could not reach the server. Check your connection.');
    }
    console.error('Error loading workspaces:', err);
  }
}

// ─── Render Workspaces ────────────────────────────────────────────────────────

function renderWorkspaces(workspaces) {
  const serverBar = document.querySelector('.server-bar');
  serverBar.querySelectorAll('.server-icon.workspace').forEach(el => el.remove());
  const addBtn = serverBar.querySelector('.add-btn');

  if (!workspaces.length) {
    setSidebarWsName('No Workspace');
    setChannelContent('<p class="status-msg">Create or join a workspace to get started.</p>');
    return;
  }

  workspaces.forEach(ws => {
    const icon = buildWorkspaceIcon(ws);
    icon.addEventListener('click', () => loadWorkspace(ws));
    serverBar.insertBefore(icon, addBtn);
  });

  window.addEventListener('workspace:icon_updated', (e) => {
    const { workspaceId, iconUrl } = e.detail;
    const el = serverBar.querySelector(`.server-icon.workspace[data-id="${workspaceId}"]`);
    if (!el) return;
    if (iconUrl) {
      el.textContent    = '';
      el.style.padding  = '0';
      el.style.overflow = 'hidden';
      const img = document.createElement('img');
      img.src           = iconUrl;
      img.alt           = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      el.appendChild(img);
    } else {
      el.innerHTML = el.title.charAt(0).toUpperCase();
    }

    if (currentWorkspace?.workspace_id === workspaceId) {
      currentWorkspace.icon_url = iconUrl;
    }
  });

  loadWorkspace(workspaces[0]);
}

// ─── Load Workspace ───────────────────────────────────────────────────────────

async function loadWorkspace(workspace) {

  const token = getToken();
  if (!token) return;

  if (messagePolling) { clearInterval(messagePolling); messagePolling = null; }

  currentWorkspace = workspace;
  setSidebarWsName(workspace.name);
  const user = getUser();
  const isOwner = workspace.user_id === user?.user_id;
const chevron = document.querySelector('.sidebar-ws-chevron');
  if (chevron) chevron.style.visibility = isOwner ? 'visible' : 'hidden';
  sidebarWsBtn.style.cursor = isOwner ? 'pointer' : 'default';
  sidebarWsBtn.style.pointerEvents = isOwner ? 'auto' : 'none';

  // Fetch and store current user's role in this workspace
  try {
    const token = getToken();
    const res = await fetch(`${API_BASE}/workspaces/${workspace.workspace_id}/members`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const members = await res.json();
      const me = members.find(m => m.user_id === user?.user_id);
      currentWorkspace.myRole = me?.role || 'member';
    }
  } catch (err) {
    console.warn('Could not fetch member role:', err);
    currentWorkspace.myRole = isOwner ? 'owner' : 'member';
  }
  showChannelSpinner('Loading channels...');
  closeChatPanel();

  document.querySelectorAll('.server-icon.workspace').forEach(icon => {
    icon.classList.toggle('active-ws', icon.dataset.id === workspace.workspace_id);
  });

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${API_BASE}/channels?workspace_id=${workspace.workspace_id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    let data = await res.json();

    if (!res.ok) {
      showChannelError(data.error || 'Failed to load channels.');
      return;
    }

    const createdDefaults = await ensureDefaultChannels(workspace.workspace_id, token, data);
    if (createdDefaults) {
      const refreshRes = await fetch(`${API_BASE}/channels?workspace_id=${workspace.workspace_id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const refreshed = await refreshRes.json();
      if (refreshRes.ok) {
        data = refreshed;
      }
    }

    console.log('RAW API channels:', JSON.stringify(data));
    renderChannels(data); 

  } catch (err) {
    showChannelError(
      err.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : 'Could not load channels. Check your connection.'
    );
    console.error('Error loading channels:', err);
  }
}

// ─── Render Channels ──────────────────────────────────────────────────────────

function renderChannels(channels) {
  const content = document.getElementById('channel-content');
  content.innerHTML = '';

  if (!Array.isArray(channels)) channels = [];
  console.log('channels from API:', JSON.stringify(channels.map(c => ({ name: c.name, is_private: c.is_private, type: c.type }))));

  let textChannels  = channels.filter(ch => getChannelType(ch) === 'text');
  const voiceChannels = channels.filter(ch => getChannelType(ch) === 'voice');

  // Sort text channels: "General" always first, then alphabetically
  textChannels = textChannels.sort((a, b) => {
    const aName = (a.name || '').toLowerCase();
    const bName = (b.name || '').toLowerCase();
    if (aName === 'general') return -1;
    if (bName === 'general') return 1;
    return aName.localeCompare(bName);
  });

  const textHeader = document.createElement('h4');
  textHeader.innerHTML = 'TEXT CHANNELS';
  content.appendChild(textHeader);

  if (textChannels.length === 0) {
    const empty = document.createElement('p');
    empty.className   = 'status-msg';
    empty.textContent = 'No text channels available.';
    content.appendChild(empty);
  } else {
    textChannels.forEach(ch => {
      const user = getUser();
      const isOwner = currentWorkspace?.user_id === user?.user_id;
      const isAdmin = currentWorkspace?.myRole === 'admin';

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative; display:flex; align-items:center;';

      const btn = document.createElement('button');
      btn.className    = 'channel';
      btn.dataset.id   = ch.channel_id;
      btn.dataset.name = ch.name;
      btn.innerHTML = ch.is_private
        ? `<span style="display:inline-flex;align-items:center;gap:5px;">
            <span style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="opacity:0.7;">
                <path d="M5 11a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1H5zm0-2h14a3 3 0 013 3v8a3 3 0 01-3 3H5a3 3 0 01-3-3v-8a3 3 0 013-3z"/>
                <path d="M12 2a5 5 0 015 5v3H7V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v1h6V7a3 3 0 00-3-3z"/>
              </svg>
              <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" style="position:absolute;bottom:-2px;right:-3px;opacity:0.9;">
                <text x="2" y="18" font-size="18" font-weight="900" font-family="monospace">#</text>
              </svg>
            </span>
            ${escapeHtml(ch.name.toLowerCase())}
           </span>`
        : `# ${escapeHtml(ch.name.toLowerCase())}`;
      btn.style.flex   = '1';
      btn.addEventListener('click', async () => {
        if (ch.is_private) {
          const user = getUser();
          const isOwner = currentWorkspace?.user_id === user?.user_id;
          const isAdmin = currentWorkspace?.myRole === 'admin';
          if (!isOwner && !isAdmin) {
            const token = getToken();
            try {
              const res = await fetch(`${API_BASE}/channels/${ch.channel_id}/access`, {
                headers: { 'Authorization': `Bearer ${token}` },
              });
              const accessList = res.ok ? await res.json() : [];
              const cached = window._channelAccessCache?.[ch.channel_id];
              const list = (Array.isArray(accessList) && accessList.length) ? accessList : (cached || []);
              if (!window._channelAccessCache) window._channelAccessCache = {};
              window._channelAccessCache[ch.channel_id] = list;
              if (!list.some(a => a.user_id === user?.user_id)) {
                showErrorModal(`🔒 Private Text Channel Access Denied\n\nThe channel "#${escapeHtml(ch.name)}" is private. Only the owner or members with specific permission can access it.\n\nPlease contact the workspace owner if you believe you should have access.`);
                return;
              }
            } catch (err) {
              showErrorModal(`🔒 Private Text Channel Access Denied\n\nThe channel "#${escapeHtml(ch.name)}" is private. Only the owner or members with specific permission can access it.\n\nPlease contact the workspace owner if you believe you should have access.`);
              return;
            }
          }
        }
        document.querySelectorAll('.channel').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        openChannel(ch.channel_id, ch.name, getChannelType(ch));
      });

      wrapper.appendChild(btn);

      if ((isOwner || isAdmin) && !isDefaultChannel(ch)) {
        const canRename = isOwner || (!ch.is_private && isAdmin);
        const canDelete = isOwner;

        if (canRename || canDelete) {
          if (isOwner && ch.is_private) {
            const manageBtn = document.createElement('button');
            manageBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;
            manageBtn.title = 'Manage Access';
            manageBtn.style.cssText = `
              position: absolute; right: 30px;
              background: none; border: none;
              cursor: pointer; color: #aaa;
              padding: 0 4px; line-height: 1;
              display: none; align-items: center; justify-content: center;
            `;
            wrapper.addEventListener('mouseenter', () => manageBtn.style.display = 'flex');
            wrapper.addEventListener('mouseleave', () => manageBtn.style.display = 'none');
            manageBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              showChannelAccessModal(ch.channel_id, ch.name);
            });
            wrapper.appendChild(manageBtn);
          }

          const menuBtn = document.createElement('button');
          menuBtn.innerHTML = '⋯';
          menuBtn.style.cssText = `
            position: absolute; right: 8px;
            background: none; border: none;
            font-size: 16px; font-weight: 900;
            cursor: pointer; color: #aaa;
            padding: 0 4px; line-height: 1;
            display: none;
          `;

          wrapper.addEventListener('mouseenter', () => menuBtn.style.display = 'block');
          wrapper.addEventListener('mouseleave', () => menuBtn.style.display = 'none');

          menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.ch-dropdown').forEach(d => d.remove());

            const dropdown = document.createElement('div');
            dropdown.className = 'ch-dropdown';
            dropdown.style.cssText = `
              position: absolute; right: 0; top: 100%;
              background: #fff; border: 2px solid #111;
              z-index: 999; min-width: 140px;
              box-shadow: 4px 4px 0 #111;
            `;

            if (canRename) {
              const renameBtn = document.createElement('button');
              renameBtn.textContent = 'Rename';
              renameBtn.style.cssText = `
                width: 100%; padding: 10px 14px; border: none;
                background: none; text-align: left;
                font-family: 'DM Sans', Arial, sans-serif;
                font-size: 12px; font-weight: 700;
                text-transform: uppercase; cursor: pointer;
                border-bottom: 1px solid #eee;
              `;
              renameBtn.addEventListener('mouseenter', () => renameBtn.style.background = '#f4f4f4');
              renameBtn.addEventListener('mouseleave', () => renameBtn.style.background = 'none');
              renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.remove();
                showModal({
                  title:       'RENAME CHANNEL',
                  label:       'NEW CHANNEL NAME',
                  placeholder: ch.name,
                  confirmText: 'RENAME',
                  onConfirm:   async (newName) => {
                    const token = getToken();
                    try {
                      const res = await fetch(`${API_BASE}/channels/${ch.channel_id}`, {
                        method:  'PATCH',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ name: newName }),
                      });
                      if (!res.ok) {
                        const data = await res.json();
                        showErrorModal(data.error || 'Failed to rename channel');
                        return;
                      }
                      loadWorkspace(currentWorkspace);
                    } catch (err) {
                      showErrorModal('Could not rename channel. Check your connection.');
                    }
                  },
                });
              });
              dropdown.appendChild(renameBtn);
            }

            if (canDelete) {
              const deleteBtn = document.createElement('button');
              deleteBtn.textContent = 'Delete';
              deleteBtn.style.cssText = `
                width: 100%; padding: 10px 14px; border: none;
                background: none; text-align: left;
                font-family: 'DM Sans', Arial, sans-serif;
                font-size: 12px; font-weight: 700;
                text-transform: uppercase; cursor: pointer;
                color: #cc1414;
              `;
              deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = '#fff0f0');
              deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = 'none');
              deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                dropdown.remove();
                const token = getToken();
                try {
                  const res = await fetch(`${API_BASE}/channels/${ch.channel_id}`, {
                    method:  'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` },
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    showErrorModal(data.error || 'Failed to delete channel');
                    return;
                  }
                  loadWorkspace(currentWorkspace);
                } catch (err) {
                  showErrorModal('Could not delete channel. Check your connection.');
                }
              });
              dropdown.appendChild(deleteBtn);
            }

            wrapper.appendChild(dropdown);
            setTimeout(() => {
              document.addEventListener('click', () => dropdown.remove(), { once: true });
            }, 0);
          });

          wrapper.appendChild(menuBtn);
        }
      }

      content.appendChild(wrapper);
    });
  }

  if (voiceChannels.length > 0) {
    const voiceHeader = document.createElement('h4');
    voiceHeader.style.marginTop = '16px';
    voiceHeader.innerHTML = 'VOICE CHANNELS';
    content.appendChild(voiceHeader);

    voiceChannels.forEach(ch => {
      const wrapper = document.createElement('div');
      wrapper.className = 'voice-channel-wrapper';
      wrapper.dataset.channelId = ch.channel_id;
      wrapper.style.cssText = 'position: relative; display: flex; flex-direction: column;';

      const user = getUser();
      const isOwner = currentWorkspace?.user_id === user?.user_id;
      const isAdmin = currentWorkspace?.myRole === 'admin';

      const btn = document.createElement('button');
      btn.className    = 'channel voice-channel';
      btn.dataset.id   = ch.channel_id;
      btn.dataset.name = getChannelDisplayName(ch);
      btn.innerHTML = ch.is_private
        ? `<span style="display:inline-flex;align-items:center;gap:5px;">
            <span style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="opacity:0.7;">
                <path d="M5 11a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1H5zm0-2h14a3 3 0 013 3v8a3 3 0 01-3 3H5a3 3 0 01-3-3v-8a3 3 0 013-3z"/>
                <path d="M12 2a5 5 0 015 5v3H7V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v1h6V7a3 3 0 00-3-3z"/>
              </svg>
              <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" style="position:absolute;bottom:-2px;right:-3px;opacity:0.9;">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
            </span>
            ${escapeHtml(getChannelDisplayName(ch))}
           </span>`
        : `🔊 ${escapeHtml(getChannelDisplayName(ch))}`;
      btn.dataset.name = getChannelDisplayName(ch);

      btn.addEventListener('click', async () => {
        if (ch.is_private) {
          const user = getUser();
          const isOwner = currentWorkspace?.user_id === user?.user_id;
          const isAdmin = currentWorkspace?.myRole === 'admin';
          if (!isOwner && !isAdmin) {
            const token = getToken();
            try {
              const res = await fetch(`${API_BASE}/channels/${ch.channel_id}/access`, {
                headers: { 'Authorization': `Bearer ${token}` },
              });
              const accessList = res.ok ? await res.json() : [];
              const cached = window._channelAccessCache?.[ch.channel_id];
              const list = (Array.isArray(accessList) && accessList.length) ? accessList : (cached || []);
              if (!window._channelAccessCache) window._channelAccessCache = {};
              window._channelAccessCache[ch.channel_id] = list;
              if (!list.some(a => a.user_id === user?.user_id)) {
                showErrorModal(`🔒 Private Voice Channel Access Denied\n\nThe channel "🔊 ${escapeHtml(getChannelDisplayName(ch))}" is private. Only the owner or members with specific permission can access it.\n\nPlease contact the workspace owner if you believe you should have access.`);
                return;
              }
            } catch (err) {
              showErrorModal(`🔒 Private Voice Channel Access Denied\n\nThe channel "🔊 ${escapeHtml(getChannelDisplayName(ch))}" is private. Only the owner or members with specific permission can access it.\n\nPlease contact the workspace owner if you believe you should have access.`);
              return;
            }
          }
        }
        document.querySelectorAll('.channel').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        // Store channelId for access check in join confirmation
        sessionStorage.setItem('voice_channel_access_checked', ch.channel_id);
        showVoiceChannelJoinConfirmation(ch.channel_id, getChannelDisplayName(ch));
      });

      if ((isOwner || isAdmin) && !isDefaultChannel(ch)) {
        const canRename = isOwner || (!ch.is_private && isAdmin);
        const canDelete = isOwner;

        if (canRename || canDelete) {
          if (isOwner && ch.is_private) {
            const manageBtn = document.createElement('button');
            manageBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;
            manageBtn.title = 'Manage Access';
            manageBtn.style.cssText = `
              position: absolute; right: 30px; top: 50%;
              transform: translateY(-50%);
              background: none; border: none;
              cursor: pointer; color: #aaa;
              padding: 0 4px; line-height: 1;
              display: none; align-items: center; justify-content: center;
              z-index: 1;
            `;
            wrapper.addEventListener('mouseenter', () => manageBtn.style.display = 'flex');
            wrapper.addEventListener('mouseleave', () => manageBtn.style.display = 'none');
            manageBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              showChannelAccessModal(ch.channel_id, getChannelDisplayName(ch));
            });
            wrapper.appendChild(manageBtn);
          }

          const menuBtn = document.createElement('button');
          menuBtn.innerHTML = '⋯';
          menuBtn.style.cssText = `
            position: absolute; right: 8px; top: 50%;
            transform: translateY(-50%);
            background: none; border: none;
            font-size: 16px; font-weight: 900;
            cursor: pointer; color: #aaa;
            padding: 0 4px; line-height: 1;
            display: none;
            z-index: 1;
          `;

          wrapper.addEventListener('mouseenter', () => menuBtn.style.display = 'block');
          wrapper.addEventListener('mouseleave', () => menuBtn.style.display = 'none');

          menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.ch-dropdown').forEach(d => d.remove());

            const dropdown = document.createElement('div');
            dropdown.className = 'ch-dropdown';
            dropdown.style.cssText = `
              position: absolute; right: 0; top: 100%;
              background: #fff; border: 2px solid #111;
              z-index: 999; min-width: 140px;
              box-shadow: 4px 4px 0 #111;
            `;

            if (canRename) {
              const renameBtn = document.createElement('button');
              renameBtn.textContent = 'Rename';
              renameBtn.style.cssText = `
                width: 100%; padding: 10px 14px; border: none;
                background: none; text-align: left;
                font-family: 'DM Sans', Arial, sans-serif;
                font-size: 12px; font-weight: 700;
                text-transform: uppercase; cursor: pointer;
                border-bottom: 1px solid #eee;
              `;
              renameBtn.addEventListener('mouseenter', () => renameBtn.style.background = '#f4f4f4');
              renameBtn.addEventListener('mouseleave', () => renameBtn.style.background = 'none');
              renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.remove();
                showModal({
                  title:       'RENAME CHANNEL',
                  label:       'NEW CHANNEL NAME',
                  placeholder: getChannelDisplayName(ch),
                  confirmText: 'RENAME',
                  onConfirm:   async (newName) => {
                    const token = getToken();
                    const isVoice = getChannelType(ch) === 'voice';
                    const storeName = isVoice ? `voice_${newName}` : newName.toLowerCase();
                    try {
                      const res = await fetch(`${API_BASE}/channels/${ch.channel_id}`, {
                        method:  'PATCH',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ name: storeName }),
                      });
                      if (!res.ok) {
                        const data = await res.json();
                        showErrorModal(data.error || 'Failed to rename channel');
                        return;
                      }
                      loadWorkspace(currentWorkspace);
                    } catch (err) {
                      showErrorModal('Could not rename channel. Check your connection.');
                    }
                  },
                });
              });
              dropdown.appendChild(renameBtn);
            }

            if (canDelete) {
              const deleteBtn = document.createElement('button');
              deleteBtn.textContent = 'Delete';
              deleteBtn.style.cssText = `
                width: 100%; padding: 10px 14px; border: none;
                background: none; text-align: left;
                font-family: 'DM Sans', Arial, sans-serif;
                font-size: 12px; font-weight: 700;
                text-transform: uppercase; cursor: pointer;
                color: #cc1414;
              `;
              deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = '#fff0f0');
              deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = 'none');
              deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                dropdown.remove();
                const token = getToken();
                try {
                  const res = await fetch(`${API_BASE}/channels/${ch.channel_id}`, {
                    method:  'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` },
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    showErrorModal(data.error || 'Failed to delete channel');
                    return;
                  }
                  loadWorkspace(currentWorkspace);
                } catch (err) {
                  showErrorModal('Could not delete channel. Check your connection.');
                }
              });
              dropdown.appendChild(deleteBtn);
            }

            wrapper.appendChild(dropdown);
            setTimeout(() => {
              document.addEventListener('click', () => dropdown.remove(), { once: true });
            }, 0);
          });

          wrapper.appendChild(menuBtn);
        }
      }

      const membersSub = document.createElement('div');
      membersSub.className = 'voice-sidebar-members';
      membersSub.id = `voice-sidebar-members-${ch.channel_id}`;

      wrapper.appendChild(btn);
      wrapper.appendChild(membersSub);
      content.appendChild(wrapper);

      // Fetch from API in case members are already in the channel
      fetchAndRenderVoiceSidebarMembers(ch.channel_id);
    });
  }

  const generalChannel = content.querySelector('[data-name="General"]');
  if (generalChannel) {
    generalChannel.click();
  } else {
    const firstTextChannel = content.querySelector('.channel:not(.voice-channel)');
    if (firstTextChannel) firstTextChannel.click();
  }

  attachChannelButtonListener();
}

// ─── Channel Access Modal ─────────────────────────────────────────────────────

async function showChannelAccessModal(channelId, channelName) {
  const existing = document.getElementById('ch-access-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ch-access-modal-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;

  overlay.innerHTML = `
    <div style="width:400px; background:#fff; border:2px solid #111; font-family:'DM Sans',Arial,sans-serif;">
      <div style="background:#111; color:#fff; font-size:13px; font-weight:900; letter-spacing:0.15em; padding:14px 18px; font-family:'Black Han Sans',sans-serif; display:flex; align-items:center; justify-content:space-between;">
        <span>🔒 ${escapeHtml(channelName)} — ACCESS</span>
        <button id="ch-access-close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;font-weight:900;line-height:1;">✕</button>
      </div>
      <div style="padding:16px 18px; border-bottom:2px solid #111;">
        <div style="font-size:10px; font-weight:700; letter-spacing:0.12em; color:#666; text-transform:uppercase; margin-bottom:10px;">MEMBERS WITH ACCESS</div>
        <div id="ch-access-list" style="display:flex; flex-direction:column; gap:8px; max-height:300px; overflow-y:auto;">
          <div style="text-align:center; padding:20px; color:#aaa; font-size:13px;">Loading...</div>
        </div>
      </div>
      <div style="padding:14px 18px;">
        <div style="font-size:10px; font-weight:700; letter-spacing:0.12em; color:#666; text-transform:uppercase; margin-bottom:10px;">ADD MEMBER</div>
        <div style="display:flex; gap:8px;">
          <select id="ch-access-select" style="flex:1; height:40px; border:2px solid #111; background:#f4f4f4; font-family:'DM Sans',Arial,sans-serif; font-size:13px; padding:0 10px; outline:none;">
            <option value="">Select a member...</option>
          </select>
          <button id="ch-access-add-btn" style="height:40px; padding:0 16px; border:none; background:#111; color:#fff; font-family:'DM Sans',Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; cursor:pointer;">ADD</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const token = getToken();
  if (!window._channelAccessCache) window._channelAccessCache = {};
  let localAccessList = window._channelAccessCache[channelId] ? [...window._channelAccessCache[channelId]] : [];

  async function loadAccess() {
    const list = document.getElementById('ch-access-list');
    const select = document.getElementById('ch-access-select');
    try {
      const membersRes = await fetch(`${API_BASE}/workspaces/${currentWorkspace.workspace_id}/members`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const allMembers = membersRes.ok ? await membersRes.json() : [];
      const me = getUser();

      try {
        const accessRes = await fetch(`${API_BASE}/channels/${channelId}/access`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (accessRes.ok) {
          const data = await accessRes.json();
          if (Array.isArray(data) && data.length) {
            localAccessList = data;
            window._channelAccessCache[channelId] = [...data];
          }
        }
      } catch (e) {
        console.warn('Access endpoint not available, using local list');
      }

      const accessIds = new Set(localAccessList.map(a => a.user_id));
      const ownerMember = allMembers.find(m => m.user_id === currentWorkspace.user_id);
      const displayList = localAccessList.filter(a => a.user_id !== currentWorkspace.user_id);

      const ownerRow = ownerMember ? `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #eee;background:#f9f9f9;">
          <div style="width:32px;height:32px;background:#cc1414;color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Black Han Sans',sans-serif;font-size:13px;flex-shrink:0;overflow:hidden;">
            ${ownerMember.avatar_url ? `<img src="${escapeHtml(ownerMember.avatar_url)}" style="width:100%;height:100%;object-fit:cover;" />` : (ownerMember.name || 'O').charAt(0).toUpperCase()}
          </div>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:700;">${escapeHtml(ownerMember.name || 'Owner')} <span style="color:#cc1414;font-size:10px;">OWNER</span></div>
            <div style="font-size:11px;color:#888;">Full access</div>
          </div>
        </div>` : '';

      const memberRows = displayList.map(a => {
        const matched = allMembers.find(m => m.user_id === a.user_id) || a;
        const initial = (matched.name || 'U').charAt(0).toUpperCase();
        const isMe = a.user_id === me?.user_id;
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #eee;">
            <div style="width:32px;height:32px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Black Han Sans',sans-serif;font-size:13px;flex-shrink:0;overflow:hidden;">
              ${matched.avatar_url ? `<img src="${escapeHtml(matched.avatar_url)}" style="width:100%;height:100%;object-fit:cover;" />` : initial}
            </div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;">${escapeHtml(matched.name || 'Unknown')} ${isMe ? '<span style="color:#cc1414;font-size:10px;">(YOU)</span>' : ''}</div>
              <div style="font-size:11px;color:#888;">${escapeHtml(matched.role || 'member')}</div>
            </div>
            <button class="ch-access-kick-btn" data-user-id="${a.user_id}" data-user-name="${escapeHtml(matched.name || 'Unknown')}" style="border:none;background:none;color:#cc1414;cursor:pointer;font-size:13px;font-weight:700;padding:4px 8px;" title="Kick member from channel">✕</button>
          </div>`;
      }).join('');

      list.innerHTML = ownerRow + (displayList.length ? memberRows : `<div style="text-align:center;padding:12px;color:#aaa;font-size:13px;">No other members have access yet.</div>`);

      list.querySelectorAll('.ch-access-kick-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = btn.dataset.userId;
          const userName = btn.dataset.userName;
          
          // Emit socket event immediately for real-time notification
          if (socket && socket.connected) {
            socket.emit('kick_member_from_channel', { 
              targetUserId: userId,
              channelId, 
              channelName, 
              memberName: userName,
              workspaceId: currentWorkspace?.workspace_id
            });
          } else {
            console.warn('Socket not connected, kick notification may be delayed');
          }
          
          try {
            // Remove access from backend
            await fetch(`${API_BASE}/channels/${channelId}/access/${userId}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` },
            });
          } catch (e) {
            console.error('Error kicking member:', e);
          }
          
          localAccessList = localAccessList.filter(a => a.user_id !== userId);
          window._channelAccessCache[channelId] = [...localAccessList];
          
          // Show toast notification about member removal
          showToast(`✓ ${userName} removed from channel`);
          
          loadAccess();
        });
      });

      select.innerHTML = '<option value="">Select a member...</option>';
      allMembers
        .filter(m => !accessIds.has(m.user_id) && m.user_id !== currentWorkspace.user_id)
        .forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.user_id;
          opt.textContent = (m.name || m.username || 'Unknown') + (m.role === 'admin' ? ' (Admin)' : '');
          select.appendChild(opt);
        });

    } catch (err) {
      console.error('loadAccess error:', err);
      document.getElementById('ch-access-list').innerHTML = `<div style="text-align:center;padding:16px;color:#cc1414;font-size:13px;">Failed to load members.</div>`;
    }
  }

  loadAccess();

  document.getElementById('ch-access-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('ch-access-add-btn').addEventListener('click', async () => {
    const select = document.getElementById('ch-access-select');
    const userId = select.value;
    if (!userId) return;

    const addBtn = document.getElementById('ch-access-add-btn');
    addBtn.disabled = true;
    addBtn.textContent = '...';

    try {
      await fetch(`${API_BASE}/channels/${channelId}/access`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
    } catch (e) {
      console.warn('POST access endpoint not available');
    }

    const membersRes = await fetch(`${API_BASE}/workspaces/${currentWorkspace.workspace_id}/members`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const allMembers = membersRes.ok ? await membersRes.json() : [];
    const member = allMembers.find(m => m.user_id === userId);
    if (member && !localAccessList.some(a => a.user_id === userId)) {
      localAccessList.push({ ...member, user_id: userId });
    }
    window._channelAccessCache[channelId] = [...localAccessList];

    addBtn.disabled = false;
    addBtn.textContent = 'ADD';
    select.value = '';

    const memberName = member?.name || 'Member';
    showToast(`✓ ${memberName} added to channel`);

    await loadAccess();
  });
}

// ─── Create Channel ───────────────────────────────────────────────────────────

async function createChannel(name, type = 'text', isPrivate = false) {
  const token = getToken();
  if (!token || !currentWorkspace) return;

  const storeName = type === 'voice' ? `voice_${name.toLowerCase()}` : name.toLowerCase();

  try {
    const res = await fetch(`${API_BASE}/channels`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: storeName, type, workspace_id: currentWorkspace.workspace_id, is_private: isPrivate }),
    });
    const data = await res.json();
    console.log('createChannel API response:', data);
    if (!res.ok) { showErrorModal(data.error || 'Failed to create channel'); return; }
    await new Promise(resolve => setTimeout(resolve, 500));
    await loadWorkspace(currentWorkspace);
    if (type === 'voice') {
      const content = document.getElementById('channel-content');
      const voiceBtn = Array.from(content.querySelectorAll('.channel.voice-channel'))
        .find(btn => btn.dataset.name.toLowerCase().includes(name.toLowerCase()));
      if (voiceBtn) voiceBtn.click();
    }
  } catch (err) {
    console.error('Error creating channel:', err);
    showErrorModal('Could not create channel. Check your connection.');
  }
}

// ─── Open Channel ─────────────────────────────────────────────────────────────

function openChannel(channelId, channelName, channelType = 'text') {
  console.log('openChannel fired:', channelId, channelName);
  const searchBar = document.getElementById('search-bar-container');
  const searchInput = document.getElementById('search-input');
  if (searchBar) { searchBar.style.display = 'none'; }
  if (searchInput) { searchInput.value = ''; }
  clearSearch();
  if (messagePolling) { clearInterval(messagePolling); messagePolling = null; }

  currentChannelType = channelType;
  currentChannelId   = channelId;
  currentChannelName = channelName;

  document.querySelector('.chat-channel-name').textContent = channelType === 'voice'
    ? `🔊 ${channelName}`
    : `# ${channelName}`;

    // Show members button only for workspace owner
  const membersBtn = document.getElementById('members-btn');
  console.log('membersBtn element:', membersBtn);
  console.log('currentWorkspace:', currentWorkspace);
  if (membersBtn) {
    const user = getUser();
    const isOwner = currentWorkspace?.user_id === user?.user_id;
    console.log('isOwner:', isOwner, 'workspace owner:', currentWorkspace?.user_id, 'user:', user?.user_id);
    membersBtn.style.display = isOwner ? 'flex' : 'none';
  }

  document.getElementById('chat-input').placeholder = `Message #${channelName}`;
  
  attachedFiles = [];
  renderAttachmentPreview();

  openChatPanel();

  // Always hide chat/messages area for voice channels by default
  const messagesDiv = document.getElementById('chat-messages');
  const inputBar = document.getElementById('chat-input-bar');
  if (channelType === 'voice') {
    showVoiceChannelView(channelId, channelName);
    if (messagesDiv) messagesDiv.style.display = 'none';
    if (inputBar) inputBar.style.display = 'none';
  } else {
    hideVoiceChannelView();
    if (messagesDiv) {
      messagesDiv.style.display = 'flex';
      messagesDiv.innerHTML = '<div class="spinner"></div>';
    }
    if (inputBar) inputBar.style.display = 'flex';
    loadMessages(channelId);
    messagePolling = setInterval(() => loadMessages(channelId), 15000);
  }
}

// ─── Voice Channel View (Discord-like) ────────────────────────────────────────

let voiceChannelMembers = {};
let isUserInVoice = false;

function showVoiceChannelView(channelId, channelName) {
  const container = document.getElementById('voice-channel-container');
  const messagesDiv = document.getElementById('chat-messages');
  const inputBar = document.getElementById('chat-input-bar');
  const membersList = document.getElementById('voice-members-container');
  const minimizedBar = document.getElementById('voice-members-minimized');
  
  if (!container) return;
  
  container.style.display = 'flex';
  if (membersList) membersList.style.display = 'flex';
  if (minimizedBar) minimizedBar.style.display = 'none';
  if (messagesDiv) messagesDiv.style.display = 'none';
  if (inputBar) inputBar.style.display = 'none';
  
  document.getElementById('voice-channel-title').textContent = escapeHtml(channelName);
  
  renderVoiceChannelMembers(channelId);
  
  // Setup buttons
  setupVoiceChannelButtons(channelId);
}

function hideVoiceChannelView() {
  const container = document.getElementById('voice-channel-container');
  
  if (container) container.style.display = 'none';
  
  isUserInVoice = false;
}

function setupVoiceChannelButtons(channelId) {
  const joinBtn = document.getElementById('voice-join-btn');
  const leaveBtn = document.getElementById('voice-leave-btn');
  const chatToggleBtn = document.getElementById('voice-toggle-chat-btn');
  const gridBtn = document.getElementById('voice-grid-btn');
  const gridBackBtn = document.getElementById('voice-grid-back-btn');
  
  if (!joinBtn || !leaveBtn) return;
  
  // Remove old listeners by cloning
  const newJoinBtn = joinBtn.cloneNode(true);
  const newLeaveBtn = leaveBtn.cloneNode(true);
  let newChatToggleBtn = null;
  if (chatToggleBtn) {
    newChatToggleBtn = chatToggleBtn.cloneNode(true);
  }
  let newGridBtn = null;
  if (gridBtn) {
    newGridBtn = gridBtn.cloneNode(true);
  }
  let newGridBackBtn = null;
  if (gridBackBtn) {
    newGridBackBtn = gridBackBtn.cloneNode(true);
  }
  
  joinBtn.parentNode.replaceChild(newJoinBtn, joinBtn);
  leaveBtn.parentNode.replaceChild(newLeaveBtn, leaveBtn);
  if (chatToggleBtn && newChatToggleBtn) {
    chatToggleBtn.parentNode.replaceChild(newChatToggleBtn, chatToggleBtn);
  }
  if (gridBtn && newGridBtn) {
    gridBtn.parentNode.replaceChild(newGridBtn, gridBtn);
  }
  if (gridBackBtn && newGridBackBtn) {
    gridBackBtn.parentNode.replaceChild(newGridBackBtn, gridBackBtn);
  }
  
  newJoinBtn.addEventListener('click', () => joinVoiceChannel(channelId));
  newLeaveBtn.addEventListener('click', () => leaveVoiceChannel(channelId));
  // Open the chat panel for this voice channel when the user requests it
  if (newChatToggleBtn) newChatToggleBtn.addEventListener('click', () => openVoiceChatPanel(channelId));
  // Minimize/expand voice member list
  const minimizeBtn = document.getElementById('voice-minimize-btn');
  if (minimizeBtn) {
    minimizeBtn.style.display = 'inline-flex';
    minimizeBtn.onclick = () => toggleVoiceMinimize();
    minimizeBtn.querySelector('.icon').textContent = '🗕';
    minimizeBtn.title = 'Minimize Voice Panel';
  }
  if (newGridBtn) newGridBtn.style.display = 'none';
  if (newGridBackBtn) {
    newGridBackBtn.addEventListener('click', closeVoiceGridView);
  }
}

function toggleVoiceMinimize() {
  const container = document.getElementById('voice-members-container');
  const minimized = document.getElementById('voice-members-minimized');
  const btn = document.getElementById('voice-minimize-btn');
  if (!container || !minimized || !btn) return;

  const isMinimized = container.style.display === 'none';
  if (isMinimized) {
    container.style.display = 'block';
    minimized.style.display = 'none';
    btn.querySelector('.icon').textContent = '🗕';
    btn.title = 'Minimize Voice Panel';
  } else {
    container.style.display = 'none';
    minimized.style.display = 'flex';
    btn.querySelector('.icon').textContent = '🗖';
    btn.title = 'Expand Voice Panel';
  }
}

function minimizeVoiceMembers() {
  const btn = document.getElementById('voice-minimize-btn');
  document.getElementById('voice-members-container').style.display = 'none';
  document.getElementById('voice-members-minimized').style.display = 'flex';
  if (btn) {
    btn.querySelector('.icon').textContent = '🗖';
    btn.title = 'Expand Voice Panel';
  }
}

function expandVoiceMembers() {
  const btn = document.getElementById('voice-minimize-btn');
  document.getElementById('voice-members-container').style.display = 'block';
  document.getElementById('voice-members-minimized').style.display = 'none';
  if (btn) {
    btn.querySelector('.icon').textContent = '🗕';
    btn.title = 'Minimize Voice Panel';
  }
}

// Open the chat panel for a voice channel (only when user clicks the chat icon)
function openVoiceChatPanel(channelId) {
  const messagesDiv = document.getElementById('chat-messages');
  const inputBar = document.getElementById('chat-input-bar');
  if (!messagesDiv) return;

  messagesDiv.style.display = 'flex';
  if (inputBar) inputBar.style.display = 'flex';

  // Ensure current channel context is set so sendMessage and other actions work
  currentChannelId = channelId;
  currentChannelType = 'voice';
  const title = document.getElementById('voice-channel-title') ? document.getElementById('voice-channel-title').textContent : '';
  document.querySelector('.chat-channel-name').textContent = `🔊 ${title}`;

  // Load messages and start polling for new ones
  messagesDiv.innerHTML = '<div class="spinner"></div>';
  loadMessages(channelId);
  if (messagePolling) clearInterval(messagePolling);
  messagePolling = setInterval(() => loadMessages(channelId), 15000);
}

function closeVoiceChatPanel() {
  const messagesDiv = document.getElementById('chat-messages');
  const inputBar = document.getElementById('chat-input-bar');
  if (messagesDiv) messagesDiv.style.display = 'none';
  if (inputBar) inputBar.style.display = 'none';
  if (messagePolling) { clearInterval(messagePolling); messagePolling = null; }
}

function toggleVoiceChatPanel() {
  const container = document.getElementById('voice-channel-container');
  const messagesDiv = document.getElementById('chat-messages');
  const inputBar = document.getElementById('chat-input-bar');
  
  if (!container || !messagesDiv) return;
  
  const isContainerVisible = container.style.display !== 'none';
  
  if (isContainerVisible) {
    // Hide voice channel members, show chat only
    container.style.display = 'none';
    messagesDiv.style.flex = '1';
  } else {
    // Show voice channel members with chat
    container.style.display = 'flex';
    container.style.flex = '0 0 45%';
    messagesDiv.style.flex = '1';
  }
}

async function joinVoiceChannel(channelId) {
  const token = getToken();
  const user = getUser();
  
  if (!token || !user) return;

  // Check if user has permission to join private voice channel
  const currentChannel = document.querySelector(`[data-id="${channelId}"]`)?.closest('.voice-channel-wrapper');
  if (currentChannel) {
    const channelBtn = document.querySelector(`[data-id="${channelId}"].voice-channel`);
    if (channelBtn) {
      const isPrivate = channelBtn.innerHTML.includes('svg') && channelBtn.innerHTML.includes('lock');
      if (isPrivate) {
        const isOwner = currentWorkspace?.user_id === user?.user_id;
        const isAdmin = currentWorkspace?.myRole === 'admin';
        if (!isOwner && !isAdmin) {
          try {
            const accessRes = await fetch(`${API_BASE}/channels/${channelId}/access`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            const accessList = accessRes.ok ? await accessRes.json() : [];
            if (!accessList.some(a => a.user_id === user?.user_id)) {
              showErrorModal(`🔒 Private Voice Channel Access Denied\n\nYou do not have permission to join this private voice channel.\n\nPlease contact the workspace owner if you believe you should have access.`);
              return;
            }
          } catch (err) {
            console.error('Error checking voice channel access:', err);
            showErrorModal(`🔒 Private Voice Channel Access Denied\n\nCould not verify your access to this private voice channel.`);
            return;
          }
        }
      }
    }
  }
  
  try {
    isUserInVoice = true;
    const joinBtn = document.getElementById('voice-join-btn');
    const leaveBtn = document.getElementById('voice-leave-btn');
    const gridBtn = document.getElementById('voice-grid-btn');
    
    if (joinBtn) joinBtn.style.display = 'none';
    if (leaveBtn) leaveBtn.style.display = 'flex';
    if (gridBtn) gridBtn.style.display = 'none';
    
    // Emit socket event for real-time updates
    if (socket) {
      socket.emit('voice_member_joined', {
        channelId,
        userId: user.user_id,
        userName: user.name,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Add user to local state (only voice call participants, not all members)
    if (!voiceChannelMembers[channelId]) voiceChannelMembers[channelId] = [];
    if (!voiceChannelMembers[channelId].some(m => m.user_id === user.user_id)) {
      voiceChannelMembers[channelId].push({
        user_id: user.user_id,
        name: user.name,
        avatar_url: user.avatar_url || null,
        status: 'online',
        muted: false,
        cameraOn: false,
      });
    }
    console.log('AFTER PUSH:', JSON.stringify(voiceChannelMembers[channelId]));
    
    renderVoiceChannelMembers(channelId);
    // Small delay to ensure state is set before rendering sidebar
    setTimeout(() => renderVoiceSidebarMembers(channelId), 50);
    // Always hide chat/messages area when joining voice channel
    const messagesDiv = document.getElementById('chat-messages');
    const inputBar = document.getElementById('chat-input-bar');
    if (messagesDiv) messagesDiv.style.display = 'none';
    if (inputBar) inputBar.style.display = 'none';
  } catch (err) {
    console.error('Error joining voice channel:', err);
    isUserInVoice = false;
  }
}

async function leaveVoiceChannel(channelId) {
  const token = getToken();
  const user = getUser();
  
  if (!token || !user) return;
  
  try {
    isUserInVoice = false;
    const joinBtn = document.getElementById('voice-join-btn');
    const leaveBtn = document.getElementById('voice-leave-btn');
    const gridBtn = document.getElementById('voice-grid-btn');
    
    if (joinBtn) joinBtn.style.display = 'flex';
    if (leaveBtn) leaveBtn.style.display = 'none';
    if (gridBtn) gridBtn.style.display = 'none';
    // Always hide chat/messages area when leaving voice channel
    const messagesDiv = document.getElementById('chat-messages');
    const inputBar = document.getElementById('chat-input-bar');
    if (messagesDiv) messagesDiv.style.display = 'none';
    if (inputBar) inputBar.style.display = 'none';
    
    // Close grid view if open
    if (voiceGridOpen) closeVoiceGridView();
    
    // Emit socket event for real-time updates
    if (socket) {
      socket.emit('voice_member_left', {
        channelId,
        userId: user.user_id,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Remove user from local state
    if (voiceChannelMembers[channelId]) {
      voiceChannelMembers[channelId] = voiceChannelMembers[channelId].filter(
        m => m.user_id !== user.user_id
      );
    }
    // If leaving, stop our camera and cleanup peer connections and remote streams for this channel
    stopLocalCamera(channelId);
    if (peerConnections[channelId]) {
      Object.values(peerConnections[channelId]).forEach(pc => { try { pc.close(); } catch(e){} });
      delete peerConnections[channelId];
    }
    if (remoteStreams[channelId]) delete remoteStreams[channelId];
    
    renderVoiceChannelMembers(channelId);
    renderVoiceSidebarMembers(channelId);
  } catch (err) {
    console.error('Error leaving voice channel:', err);
  }
}

async function renderVoiceChannelMembers(channelId) {
  const list = document.getElementById('voice-members-list');
  const memberCount = document.getElementById('voice-member-count');
  const user = getUser();
  
  if (!list || !memberCount) return;
  
  // Only show users who have actually joined the voice call
  let members = voiceChannelMembers[channelId] || [];
  
  if (!members.length) {
    // No participants API — members tracked via socket events only
  }
  
  // Update member count
  memberCount.textContent = `${members.length} member${members.length !== 1 ? 's' : ''}`;

  // Render minimized bar
  const minimizedBar = document.getElementById('voice-members-minimized');
  if (minimizedBar) {
    if (!members.length) {
      minimizedBar.innerHTML = '<span style="color: var(--gray-400); font-size: 13px;">No one in the voice channel.</span>';
    } else {
      minimizedBar.innerHTML = members.map(member => {
        const name = escapeHtml(member.name || member.username || 'Unknown');
        const initial = name.charAt(0).toUpperCase();
        const isMuted = member.muted || false;
        const cameraOn = member.cameraOn || false;
        return `<div class=\"voice-member-mini\">
          <div class=\"voice-member-avatar-mini\" style=\"position:relative;\">
            ${member.avatar_url ? `<img src=\"${escapeHtml(member.avatar_url)}\" alt=\"${name}\" />` : initial}
            <span class=\"voice-member-status-dot${isMuted ? ' muted' : ''}\"></span>
            ${cameraOn ? '<span class=\"mini-cam\">📷</span>' : ''}
          </div>
        </div>`;
      }).join('');
    }
  }
  if (!members.length) {
    list.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--gray-400); font-size: 14px;">No one in the voice channel. Be the first to join!</div>';
    return;
  }
  list.innerHTML = members.map(member => {
    const name = escapeHtml(member.name || member.username || 'Unknown');
    const initial = name.charAt(0).toUpperCase();
    const isMe = member.user_id === user?.user_id;
    const isMuted = member.muted || false;
    const cameraOn = member.cameraOn || false;
    const status = member.status || 'online';
    
    return `
      <div class="voice-member-row" data-user-id="${member.user_id}">
        <div class="voice-member-avatar-small" style="position: relative;">
          ${member.avatar_url 
            ? `<img src="${escapeHtml(member.avatar_url)}" alt="${name}" />` 
            : initial
          }
          ${cameraOn ? '<span class="voice-camera-badge">📷</span>' : ''}
        </div>
        <div class="voice-member-info-row">
          <div class="voice-member-name-row">${name} ${isMe ? '<span style="color: var(--red); font-size: 10px;">(YOU)</span>' : ''}</div>
          <div class="voice-member-status-indicator">
            <span class="voice-member-status-dot ${isMuted ? 'muted' : ''}"></span>
            <span>${isMuted ? '🔇 MUTED' : '🔊 TALKING'}</span>
          </div>
        </div>
        <div class="voice-member-actions-row">
          <button class="voice-member-action-btn-small mute-btn" title="${isMuted ? 'Unmute' : 'Mute'}" data-user-id="${member.user_id}" data-muted="${isMuted}">
            ${isMuted ? '🔇' : '🎤'}
          </button>
          <button class="voice-member-action-btn-small camera-btn ${cameraOn ? 'active' : ''}" title="${cameraOn ? 'Turn Off Camera' : 'Turn On Camera'}" data-user-id="${member.user_id}" data-camera="${cameraOn ? 'on' : 'off'}">
            📷
          </button>
          ${isMe && cameraOn ? `<button class="voice-member-action-btn-small audio-mute-btn" id="voice-audio-mute-btn" title="Mute Microphone">
            ${localAudioEnabled ? '🔊' : '🔇'}
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners for mute buttons
  list.querySelectorAll('.mute-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userId = btn.dataset.userId;
      const isMuted = btn.dataset.muted === 'true';
      toggleMuteUser(channelId, userId, !isMuted);
    });
  });
  
  // Add event listeners for camera buttons
  list.querySelectorAll('.camera-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userId = btn.dataset.userId;
      const isCameraOn = btn.dataset.camera === 'on';
      toggleCameraUser(channelId, userId, !isCameraOn);
    });
  });

  // Add event listener for audio mute button (local user only)
  const audioMuteBtn = list.querySelector('.audio-mute-btn');
  if (audioMuteBtn) {
    audioMuteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAudioMute();
    });
  }

  // Re-attach any existing streams after render
  if (!remoteStreams[channelId]) remoteStreams[channelId] = {};
  Object.keys(remoteStreams[channelId]).forEach(userId => {
    const stream = remoteStreams[channelId][userId];
    if (stream) attachRemoteStreamToMember(channelId, userId, stream);
  });
  // Attach local preview if available
  const me = getUser();
  if (me && localStream) attachLocalStreamToMember(channelId, me.user_id, localStream);
}

async function fetchAndRenderVoiceSidebarMembers(channelId) {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/channels/${channelId}/voice-members`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      // Merge API data with local state instead of overwriting
      const existing = voiceChannelMembers[channelId] || [];
      const apiMembers = Array.isArray(data) ? data : [];
      // Add API members not already in local state
      apiMembers.forEach(m => {
        if (!existing.some(e => e.user_id === m.user_id)) {
          existing.push(m);
        }
      });
      voiceChannelMembers[channelId] = existing;
    }
  } catch (err) {
    console.warn('Could not fetch voice members:', err);
  }
  if (!voiceChannelMembers[channelId]) voiceChannelMembers[channelId] = [];
  renderVoiceSidebarMembers(channelId);
}

function renderVoiceSidebarMembers(channelId) {
  const sub = document.getElementById(`voice-sidebar-members-${channelId}`);
  console.log('renderVoiceSidebarMembers', channelId, sub, voiceChannelMembers[channelId]);
  console.log('ALL voiceChannelMembers:', JSON.stringify(voiceChannelMembers));
  if (!sub) return;
  const members = voiceChannelMembers[channelId] || [];
  if (!members.length) {
    sub.innerHTML = '';
    return;
  }
  sub.innerHTML = members.map(m => {
    const name = escapeHtml(m.name || 'Unknown');
    const initial = name.charAt(0).toUpperCase();
    const isMuted = m.muted || false;
    return `
      <div class="voice-sidebar-member">
        <div class="voice-sidebar-avatar">${m.avatar_url ? `<img src="${escapeHtml(m.avatar_url)}" alt="${name}" />` : initial}</div>
        <span class="voice-sidebar-name">${name}</span>
        <span class="voice-sidebar-icon">${isMuted ? '🔇' : '🎤'}</span>
      </div>`;
  }).join('');
}

async function toggleMuteUser(channelId, userId, mute) {
  if (!voiceChannelMembers[channelId]) return;
  
  const member = voiceChannelMembers[channelId].find(m => m.user_id === userId);
  if (member) {
    member.muted = mute;
    renderVoiceChannelMembers(channelId);
    if (socket) {
      socket.emit('voice_member_mute_changed', {
        channelId,
        userId,
        muted: mute,
      });
    }
  }
}

async function toggleCameraUser(channelId, userId, cameraOn) {
  // Update camera state in the member object
  if (!voiceChannelMembers[channelId]) return;
  
  const member = voiceChannelMembers[channelId].find(m => m.user_id === userId);
  if (member) {
    member.cameraOn = cameraOn;
    // If this is the local user, manage local camera stream and WebRTC offers
    const me = getUser();
    if (me && me.user_id === userId) {
      if (cameraOn) {
        await startLocalCamera(channelId);
      } else {
        stopLocalCamera(channelId);
      }
    }
    renderVoiceChannelMembers(channelId);
    if (socket) {
      socket.emit('voice_member_camera_changed', {
        channelId,
        userId,
        cameraOn,
      });
    }
  }
}

async function startLocalCamera(channelId) {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showErrorModal('Camera access is not supported in this browser.');
      return;
    }

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: true });
      // Mute local audio by default to avoid feedback (user can unmute)
      localStream.getAudioTracks().forEach(t => t.enabled = localAudioEnabled);
    }

    // attach local preview to our member tile
    const me = getUser();
    if (me) attachLocalStreamToMember(channelId, me.user_id, localStream);

    // Create peer connections and offer to other participants so they can receive our stream
    const members = (voiceChannelMembers[channelId] || []).filter(m => m.user_id !== me.user_id);
    if (!peerConnections[channelId]) peerConnections[channelId] = {};

    for (const m of members) {
      const peerId = m.user_id;
      if (peerConnections[channelId][peerId]) continue;

      const pc = new RTCPeerConnection(ICE_CONFIG);
      peerConnections[channelId][peerId] = pc;

      // add local tracks
      if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

      pc.onicecandidate = (ev) => {
        if (ev.candidate) socket.emit('webrtc_ice_candidate', { channelId, toUserId: peerId, candidate: ev.candidate });
      };

      pc.ontrack = (ev) => {
        const remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream(ev.track ? [ev.track] : []);
        attachRemoteStreamToMember(channelId, peerId, remoteStream);
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', { channelId, toUserId: peerId, sdp: pc.localDescription });
      } catch (err) {
        console.error('Error creating offer for', peerId, err);
      }
    }
  } catch (err) {
    console.error('Error starting local camera', err);
  }
}

function stopLocalCamera(channelId) {
  try {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }

    // Close and remove peer connections for this channel
    if (peerConnections[channelId]) {
      Object.values(peerConnections[channelId]).forEach(pc => {
        try { pc.close(); } catch (e) {}
      });
      peerConnections[channelId] = {};
    }

    // Remove local video element from our tile
    const me = getUser();
    if (me) detachStreamFromMember(channelId, me.user_id);
  } catch (err) {
    console.error('Error stopping local camera', err);
  }
}

function attachLocalStreamToMember(channelId, userId, stream) {
  const row = document.querySelector(`.voice-member-row[data-user-id="${userId}"]`);
  if (!row) return;
  const avatar = row.querySelector('.voice-member-avatar-small');
  if (!avatar) return;

  // remove existing video if any
  detachStreamFromMember(channelId, userId);

  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true; // mute local preview
  video.playsInline = true;
  video.srcObject = stream;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  video.className = 'voice-tile-video';

  avatar.appendChild(video);
}

function attachRemoteStreamToMember(channelId, userId, stream) {
  const row = document.querySelector(`.voice-member-row[data-user-id="${userId}"]`);
  if (!row) return;
  const avatar = row.querySelector('.voice-member-avatar-small');
  if (!avatar) return;
  if (!remoteStreams[channelId]) remoteStreams[channelId] = {};
  remoteStreams[channelId][userId] = stream;

  // remove existing video if any
  detachStreamFromMember(channelId, userId);

  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = false;
  video.playsInline = true;
  video.srcObject = stream;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  video.className = 'voice-tile-video';

  avatar.appendChild(video);
}

function detachStreamFromMember(channelId, userId) {
  const row = document.querySelector(`.voice-member-row[data-user-id="${userId}"]`);
  if (!row) return;
  const avatar = row.querySelector('.voice-member-avatar-small');
  if (!avatar) return;
  const video = avatar.querySelector('.voice-tile-video');
  if (video) {
    try { if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); } } catch (e) {}
    video.remove();
  }
}

// ─── Audio Mute Control ───────────────────────────────────────────────────────

function toggleAudioMute() {
  if (!localStream) return;
  localAudioEnabled = !localAudioEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = localAudioEnabled);
  
  // Update button state
  const muteBtn = document.getElementById('voice-audio-mute-btn');
  if (muteBtn) {
    muteBtn.textContent = localAudioEnabled ? '🔊' : '🔇';
    muteBtn.title = localAudioEnabled ? 'Mute' : 'Unmute';
  }
  
  // Emit event so others know your audio state
  if (socket && currentChannelId) {
    socket.emit('voice_member_audio_changed', {
      channelId: currentChannelId,
      userId: getUser().user_id,
      audioEnabled: localAudioEnabled,
    });
  }
}

// ─── Voice Grid View (Discord Stage-like) ────────────────────────────────────

function openVoiceGridView(channelId) {
  voiceGridOpen = true;
  const grid = document.getElementById('voice-grid-view');
  const container = document.getElementById('voice-channel-container');
  
  if (!grid || !container) return;
  
  container.style.display = 'none';
  grid.style.display = 'flex';
  
  // Populate grid with members who have cameras on
  renderVoiceGrid(channelId);
}

function closeVoiceGridView() {
  voiceGridOpen = false;
  const grid = document.getElementById('voice-grid-view');
  const container = document.getElementById('voice-channel-container');
  
  if (!grid || !container) return;
  
  grid.style.display = 'none';
  container.style.display = 'flex';
}

function renderVoiceGrid(channelId) {
  const grid = document.getElementById('voice-grid-content');
  if (!grid) return;
  
  const members = voiceChannelMembers[channelId] || [];
  const user = getUser();
  
  if (!members.length) {
    grid.innerHTML = '<div style="flex:1; display:flex; align-items:center; justify-content:center; color:var(--gray-400); font-size:14px; grid-column:1/-1;">No members in voice channel.</div>';
    return;
  }
  
  // Sort: camera on first, then by name
  const sorted = [...members].sort((a, b) => {
    if (a.cameraOn !== b.cameraOn) return b.cameraOn ? 1 : -1;
    return (a.name || '').localeCompare(b.name || '');
  });
  
  grid.innerHTML = sorted.map(member => {
    const name = escapeHtml(member.name || 'Unknown');
    const initial = name.charAt(0).toUpperCase();
    const isMe = member.user_id === user?.user_id;
    const isMuted = member.muted || false;
    const cameraOn = member.cameraOn || false;
    const isMicMuted = !(member.audioEnabled || false);
    
    if (cameraOn) {
      return `
        <div class="voice-grid-tile camera-on" data-user-id="${member.user_id}">
          <div class="voice-grid-video-container">
            <div class="voice-grid-overlay">
              <div class="voice-grid-name">${name} ${isMe ? '(YOU)' : ''}</div>
              <div class="voice-grid-indicators">
                ${isMuted ? '<span title="Camera muted">📷</span>' : ''}
                ${isMicMuted ? '<span title="Mic muted">🔇</span>' : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="voice-grid-tile camera-off" data-user-id="${member.user_id}">
          <div class="voice-grid-avatar-card">
            <div class="voice-grid-avatar">
              ${member.avatar_url 
                ? `<img src="${escapeHtml(member.avatar_url)}" alt="${name}" />` 
                : initial
              }
            </div>
            <div class="voice-grid-card-name">${name} ${isMe ? '(YOU)' : ''}</div>
            <div class="voice-grid-card-status">
              ${isMuted ? '🔇 MUTED' : '🔊 TALKING'}
              ${isMicMuted ? ' • 🔇' : ''}
            </div>
          </div>
        </div>
      `;
    }
  }).join('');
  
  // Attach streams to tiles
  sorted.forEach(member => {
    if (member.cameraOn) {
      const tile = grid.querySelector(`.voice-grid-tile[data-user-id="${member.user_id}"]`);
      if (tile) {
        if (member.user_id === user?.user_id && localStream) {
          attachLocalStreamToGrid(channelId, member.user_id, localStream);
        } else if (remoteStreams[channelId] && remoteStreams[channelId][member.user_id]) {
          attachRemoteStreamToGrid(channelId, member.user_id, remoteStreams[channelId][member.user_id]);
        }
      }
    }
  });
}

function attachLocalStreamToGrid(channelId, userId, stream) {
  const tile = document.querySelector(`.voice-grid-tile[data-user-id="${userId}"]`);
  if (!tile) return;
  const container = tile.querySelector('.voice-grid-video-container');
  if (!container) return;
  
  const existingVideo = container.querySelector('video');
  if (existingVideo) existingVideo.remove();
  
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  
  container.insertBefore(video, container.firstChild);
}

function attachRemoteStreamToGrid(channelId, userId, stream) {
  const tile = document.querySelector(`.voice-grid-tile[data-user-id="${userId}"]`);
  if (!tile) return;
  const container = tile.querySelector('.voice-grid-video-container');
  if (!container) return;
  
  const existingVideo = container.querySelector('video');
  if (existingVideo) existingVideo.remove();
  
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = false;
  video.playsInline = true;
  video.srcObject = stream;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  
  container.insertBefore(video, container.firstChild);
}

// ─── Load Messages ────────────────────────────────────────────────────────────

async function loadMessages(channelId) {
  const token = getToken();
  if (!token) return;

  try {
    const res  = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) { console.error('Failed to load messages:', data); return; }
    renderMessages(data);
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

// ─── Render Messages ──────────────────────────────────────────────────────────

function renderMessages(messages) {
  const container = document.getElementById('chat-messages');
  const user      = getUser();

  if (!messages.length) {
    container.innerHTML = '<p class="no-messages">No messages yet. Say hello! 👋</p>';
    return;
  }

  const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

  container.innerHTML = messages.map(msg => {
    const isMe = msg.user?.user_id === user?.user_id;
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let fileHtml = '';

    if (msg.files && msg.files.length > 0) {
      fileHtml = msg.files.map(f => buildFileHtml(f)).join('');
    }
    else if (msg.file_url) {
      fileHtml = buildFileHtml({
        file_name: msg.file_name,
        file_url:  msg.file_url,
        file_type: msg.file_type,
        file_size: msg.file_size,
        size:      msg.file_size,
      });
    }

    const bubbleHtml = msg.content && msg.content.trim() && msg.content.trim() !== ' '
      ? `<div class="message-bubble">${escapeHtml(msg.content)}</div>`
      : '';

    // REPLACE WITH:
     const reactionsHtml = buildReactionsHtml(msg.reactions || [], msg.message_id, user?.user_id, 'channel', isMe);

    return `
      <div class="message ${isMe ? 'mine' : ''}" data-msg-id="${msg.message_id}">
        <div class="message-meta">
          <strong>${isMe ? 'You' : escapeHtml(msg.user?.name || 'Unknown')}</strong>
          <span class="message-time">${time}</span>
        </div>
        ${bubbleHtml}
        ${fileHtml}
        ${reactionsHtml}
      </div>
    `;
  }).join('');

  if (isAtBottom) container.scrollTop = container.scrollHeight;

  setupLightboxListeners();
  setupReactionListeners();

  // Re-apply search filter if active
  const searchInput = document.getElementById('search-input');
  if (searchInput && searchInput.value.trim()) {
    filterMessages(searchInput.value.trim().toLowerCase());
  }
}

// ─── Send Message ─────────────────────────────────────────────────────────────

async function sendMessage() {
  const token   = getToken();
  const input   = document.getElementById('chat-input');
  const content = input.value.trim();
  const files   = [...attachedFiles];

  if (!token || (!content && !files.length) || !currentChannelId) return;

  input.value   = '';
  attachedFiles = [];
  renderAttachmentPreview();

  let messageId = null;
  try {
    const res = await fetch(`${API_BASE}/channels/${currentChannelId}/messages`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ content: content || ' ', channel_id: currentChannelId }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Failed to send message:', data);
    } else {
      messageId = data.message_id || data.id || data.channel_message_id;
    }
  } catch (err) {
    console.error('Error sending message:', err);
  }

  if (files.length && messageId) {
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('message_id', messageId);

        const res = await fetch(`${API_BASE}/files/upload`, {
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

  loadMessages(currentChannelId);
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
    ? `<div class="reactions-row">${trigger}${pills}</div>`
    : `<div class="reactions-row">${pills}${trigger}</div>`;
}

function setupReactionListeners() {
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

  document.querySelectorAll('.emoji-opt').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { emoji, msgId, type } = btn.dataset;
      btn.closest('.emoji-picker').style.display = 'none';
      await toggleReaction(msgId, emoji, type);
    });
  });

  document.querySelectorAll('.reaction-pill').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { emoji, msgId, type } = btn.dataset;
      await toggleReaction(msgId, emoji, type);
    });
  });
}

async function toggleReaction(messageId, emoji, type) {
  const token = getToken();
  if (!token) return;

  const pill = document.querySelector(`.reaction-pill[data-msg-id="${messageId}"][data-emoji="${emoji}"]`);
  const alreadyReacted = pill?.classList.contains('reacted');

  if (alreadyReacted) {
    await fetch(`${API_BASE}/channels/${currentChannelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
  } else {
    // Remove any existing reaction by this user on this message first
    const existingPills = document.querySelectorAll(`.reaction-pill[data-msg-id="${messageId}"].reacted`);
    for (const existingPill of existingPills) {
      const existingEmoji = existingPill.dataset.emoji;
      await fetch(`${API_BASE}/channels/${currentChannelId}/messages/${messageId}/reactions/${encodeURIComponent(existingEmoji)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    }
    await fetch(`${API_BASE}/channels/${currentChannelId}/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
  }

  loadMessages(currentChannelId);
}

// ─── Search ───────────────────────────────────────────────────────────────────

(function setupSearch() {
  const searchBtn = document.querySelector('.icon-btn[title="Search messages"]');
  const searchBar = document.getElementById('search-bar-container');
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear-btn');

  if (!searchBtn || !searchBar || !searchInput) return;

  searchBtn.addEventListener('click', () => {
    const isOpen = searchBar.style.display === 'flex';
    if (isOpen) {
      searchBar.style.display = 'none';
      searchInput.value = '';
      clearSearch();
    } else {
      searchBar.style.display = 'flex';
      searchInput.focus();
    }
  });

  searchInput.addEventListener('input', () => {
    filterMessages(searchInput.value.trim().toLowerCase());
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchBar.style.display = 'none';
    clearSearch();
  });
})();

function filterMessages(query) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const messages = container.querySelectorAll('.message');
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
    const bubble = msg.querySelector('.message-bubble');
    const senderEl = msg.querySelector('.message-meta strong');
    const bubbleText = bubble?.textContent?.toLowerCase() || '';
    const senderText = senderEl?.textContent?.toLowerCase() || '';
    const fileNames = Array.from(msg.querySelectorAll('.message-file-name'))
      .map(el => el.textContent.toLowerCase()).join(' ');

    if (bubbleText.includes(query) || senderText.includes(query) || fileNames.includes(query)) {
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

function clearSearch() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.querySelectorAll('.message').forEach(msg => {
    msg.style.display = '';
    msg.querySelectorAll('mark.search-highlight').forEach(mark => {
      mark.replaceWith(mark.textContent);
    });
  });
}

// ─── Members Button ───────────────────────────────────────────────────────────

const membersNavBtn = document.getElementById('members-btn');
if (membersNavBtn) {
  membersNavBtn.addEventListener('click', () => {
    if (currentWorkspace) {
      sessionStorage.setItem('settings_ws_id', currentWorkspace.workspace_id);
      sessionStorage.setItem('settings_open_tab', 'members');
      navigateTo('../html/server-settings.html');
    }
  });
}

document.getElementById('send-btn').addEventListener('click', sendMessage);
// ─── Event Listeners ──────────────────────────────────────────────────────────


document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

document.getElementById('file-input').addEventListener('change', e => {
  attachedFiles.push(...Array.from(e.target.files));
  e.target.value = '';
  renderAttachmentPreview();
});

document.querySelector('.back-to-channels').addEventListener('click', () => {
  closeChatPanel();
  attachedFiles = [];
  renderAttachmentPreview();
  document.querySelectorAll('.channel').forEach(c => c.classList.remove('active'));
  if (messagePolling) { clearInterval(messagePolling); messagePolling = null; }
});

const sidebarWsBtn      = document.getElementById('sidebar-ws-btn');
const sidebarWsDropdown = document.getElementById('sidebar-ws-dropdown');

sidebarWsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const user = getUser();
  const isOwner = currentWorkspace?.user_id === user?.user_id;
  if (!isOwner) return;
  const isOpen = sidebarWsDropdown.style.display !== 'none';
  sidebarWsDropdown.style.display = isOpen ? 'none' : 'block';
  sidebarWsBtn.classList.toggle('dropdown-open', !isOpen);
});

document.addEventListener('click', () => {
  sidebarWsDropdown.style.display = 'none';
  sidebarWsBtn.classList.remove('dropdown-open');
});

document.getElementById('go-to-settings').addEventListener('click', () => {
  if (currentWorkspace) {
    sessionStorage.setItem('settings_ws_id', currentWorkspace.workspace_id);
  }
  navigateTo('../html/server-settings.html');
});

document.querySelector('.server-icon.logo').addEventListener('click', () => {
  navigateTo('messages.html');
});

document.querySelector('.add-btn').addEventListener('click', () => {
  document.querySelector('.add-btn').animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.2) rotate(90deg)' }, { transform: 'scale(1)' }],
    { duration: 400, easing: 'ease' }
  );
  showWorkspaceActionModal();
});

function showWorkspaceActionModal() {
  const existing = document.getElementById('ws-action-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ws-action-modal-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes wsModalSlideUp {
        from { transform: translateY(20px); opacity: 0 }
        to   { transform: translateY(0);    opacity: 1 }
      }
      #ws-action-modal {
        width: 340px; background: #fff;
        border: 2px solid #111;
        font-family: 'DM Sans', Arial, Helvetica, sans-serif;
        animation: wsModalSlideUp 0.2s ease;
      }
      #ws-action-modal-title {
        background: #111; color: #fff;
        font-size: 13px; font-weight: 900;
        letter-spacing: 0.15em; padding: 14px 18px;
        font-family: 'Black Han Sans', sans-serif;
        text-transform: uppercase;
      }
      #ws-action-modal-body {
        padding: 20px 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .ws-action-btn {
        border: 2px solid #111;
        background: #fff;
        padding: 16px;
        font-family: 'DM Sans', Arial, sans-serif;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 14px;
        text-align: left;
        transition: background 0.15s, transform 0.1s, box-shadow 0.1s;
        width: 100%;
      }
      .ws-action-btn:hover {
        background: #f4f4f4;
        transform: translateY(-2px);
        box-shadow: 0 4px 0 #111;
      }
      .ws-action-icon {
        font-size: 22px;
        font-weight: 900;
        color: #cc1414;
        flex-shrink: 0;
        width: 32px;
        text-align: center;
      }
      .ws-action-text strong {
        display: block;
        font-family: 'Black Han Sans', sans-serif;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 3px;
      }
      .ws-action-text span {
        font-size: 11px;
        color: #666;
        font-weight: 400;
        line-height: 1.4;
      }
    </style>
    <div id="ws-action-modal">
      <div id="ws-action-modal-title" style="display:flex; align-items:center; justify-content:space-between;">
        <span>WORKSPACE</span>
        <button id="ws-action-close-btn" style="
          background: none; border: none; color: #fff;
          font-size: 20px; font-weight: 900; cursor: pointer;
          line-height: 1; padding: 0; opacity: 0.8;
          font-family: 'DM Sans', Arial, sans-serif;
        ">✕</button>
      </div>
      <div id="ws-action-modal-body">
        <button class="ws-action-btn" id="ws-create-btn">
          <div class="ws-action-icon">+</div>
          <div class="ws-action-text">
            <strong>Create a Workspace</strong>
            <span>Start fresh and invite your team to collaborate.</span>
          </div>
        </button>
        <button class="ws-action-btn" id="ws-join-btn">
          <div class="ws-action-icon">⤵</div>
          <div class="ws-action-text">
            <strong>Join a Workspace</strong>
            <span>Enter an invite code to jump right into the action.</span>
          </div>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s ease';
    setTimeout(() => overlay.remove(), 150);
  };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.getElementById('ws-action-close-btn').addEventListener('click', close);
  document.getElementById('ws-create-btn').addEventListener('click', () => {
    close();
    showModal({
      title:       'CREATE WORKSPACE',
      label:       'WORKSPACE NAME',
      placeholder: 'e.g. Design Team',
      confirmText: 'CREATE',
      onConfirm:   (name) => { if (name && name.trim()) createWorkspace(name.trim()); },
    });
  });

  document.getElementById('ws-join-btn').addEventListener('click', () => {
    close();
    showModal({
      title:       'JOIN WORKSPACE',
      label:       'INVITE CODE',
      placeholder: 'e.g. ABC123',
      confirmText: 'JOIN',
      onConfirm:   (code) => { if (code && code.trim()) joinWorkspace(code.trim()); },
    });
  });
}

// ─── Add Channel Button ───────────────────────────────────────────────────────

function attachChannelButtonListener() {
  const sidebarAddBtn = document.querySelector('.sidebar-add-btn');
  if (!sidebarAddBtn) return;
  const newBtn = sidebarAddBtn.cloneNode(true);
  sidebarAddBtn.parentNode.replaceChild(newBtn, sidebarAddBtn);

  const user = getUser();
  const isOwner = currentWorkspace?.user_id === user?.user_id;
  const isAdmin = currentWorkspace?.myRole === 'admin';

  if (!isOwner && !isAdmin) {
    newBtn.style.display = 'none';
    return;
  }

  newBtn.style.display = '';
  newBtn.addEventListener('click', showChannelTypeModal);
}

function showChannelTypeModal() {
  const existing = document.getElementById('channel-type-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'channel-type-modal-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes modalSlideUp {
        from { transform: translateY(20px); opacity: 0 }
        to   { transform: translateY(0);    opacity: 1 }
      }
      #channel-type-modal {
        width: 340px; background: #fff;
        border: 2px solid #111;
        font-family: 'DM Sans', Arial, Helvetica, sans-serif;
        animation: modalSlideUp 0.2s ease;
      }
      #channel-type-modal-title {
        background: #111; color: #fff;
        font-size: 13px; font-weight: 900;
        letter-spacing: 0.15em; padding: 14px 18px;
        font-family: 'Black Han Sans', sans-serif;
        text-transform: uppercase;
      }
      #channel-type-modal-body {
        padding: 20px 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .channel-type-btn {
        border: 2px solid #111;
        background: #fff;
        padding: 14px 16px;
        font-family: 'DM Sans', Arial, sans-serif;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 12px;
        transition: background 0.15s, transform 0.1s;
      }
      .channel-type-btn:hover {
        background: #f4f4f4;
        transform: translateY(-2px);
        box-shadow: 0 4px 0 #111;
      }
      .channel-type-icon {
        font-size: 18px;
        font-weight: 900;
        color: #cc1414;
      }
    </style>
    <div id="channel-type-modal">
      <div id="channel-type-modal-title">CREATE CHANNEL</div>
      <div id="channel-type-modal-body">
        <button class="channel-type-btn" id="create-text-btn">
          <span class="channel-type-icon">#</span>
          <span>Text Channel</span>
        </button>
        <button class="channel-type-btn" id="create-voice-btn">
          <span class="channel-type-icon">🔊</span>
          <span>Voice Channel</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('create-text-btn').addEventListener('click', () => {
    close();
    showChannelCreateModal('CREATE TEXT CHANNEL', 'e.g. general', 'text');
  });

  document.getElementById('create-voice-btn').addEventListener('click', () => {
    close();
    showChannelCreateModal('CREATE VOICE CHANNEL', 'e.g. Lobby', 'voice');
  });
}

// ─── Channel Create Modal (with Private toggle) ───────────────────────────────

function showChannelCreateModal(title, placeholder, type) {
  const existing = document.getElementById('ch-create-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ch-create-modal-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999;
  `;

  overlay.innerHTML = `
    <div id="ch-create-modal" style="
      width: 340px; background: #fff;
      border: 2px solid #111;
      font-family: 'DM Sans', Arial, Helvetica, sans-serif;
    ">
      <div style="
        background: #111; color: #fff;
        font-size: 13px; font-weight: 900;
        letter-spacing: 0.15em; padding: 14px 18px;
        font-family: 'Black Han Sans', sans-serif;
        text-transform: uppercase;
      ">${title}</div>

      <div style="padding: 20px 18px;">

        <label style="display:block; font-size:10px; font-weight:700;
          letter-spacing:0.12em; color:#666; margin-bottom:8px;
          text-transform:uppercase;">CHANNEL NAME</label>
        <input id="ch-create-name" type="text" placeholder="${placeholder}"
          autocomplete="off" style="
          width:100%; height:42px; border:2px solid #111;
          padding:0 12px; font-size:14px;
          font-family:'DM Sans',Arial,sans-serif;
          outline:none; background:#f4f4f4; box-sizing:border-box;
        "/>
        <span id="ch-create-error" style="
          font-size:11px; font-weight:700; color:#cc1414;
          margin-top:6px; min-height:16px; display:block;
        "></span>

        <!-- Private Channel Toggle (owner only) -->
        <div id="ch-private-toggle-section" style="
          margin-top:16px; padding:14px;
          border:2px solid #111; background:#f9f9f9;
          display:${currentWorkspace?.user_id === getUser()?.user_id ? 'flex' : 'none'};
          align-items:flex-start; gap:12px;
        ">
          <div style="flex:1;">
            <div style="
              font-size:12px; font-weight:900;
              letter-spacing:0.08em; text-transform:uppercase;
              margin-bottom:4px; display:flex; align-items:center; gap:6px;
            ">
              🔒 PRIVATE CHANNEL
            </div>
            <div style="font-size:11px; color:#666; font-weight:500; line-height:1.5;">
              Only you and members you invite can see this channel.
            </div>
          </div>
          <label style="
            position:relative; display:inline-block;
            width:44px; height:24px; flex-shrink:0; margin-top:2px;
          ">
            <input type="checkbox" id="ch-create-private" style="opacity:0;width:0;height:0;" />
            <span id="ch-create-toggle-track" style="
              position:absolute; inset:0;
              background:#ccc; border:2px solid #111;
              cursor:pointer; transition:background 0.2s;
            "></span>
            <span id="ch-create-toggle-thumb" style="
              position:absolute; left:2px; top:2px;
              width:16px; height:16px;
              background:#111; transition:transform 0.2s;
            "></span>
          </label>
        </div>

      </div>

      <div style="display:flex; border-top:2px solid #111;">
        <button id="ch-create-cancel" style="
          flex:1; height:48px; border:none; border-right:2px solid #111;
          background:#fff; font-size:12px; font-weight:700;
          letter-spacing:0.12em; cursor:pointer;
          font-family:'DM Sans',Arial,sans-serif; text-transform:uppercase;
        ">CANCEL</button>
        <button id="ch-create-confirm" style="
          flex:1; height:48px; border:none;
          background:#cc1414; color:#fff;
          font-size:12px; font-weight:700;
          letter-spacing:0.12em; cursor:pointer;
          font-family:'DM Sans',Arial,sans-serif; text-transform:uppercase;
        ">CREATE</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const nameInput   = document.getElementById('ch-create-name');
  const errorEl     = document.getElementById('ch-create-error');
  const checkbox    = document.getElementById('ch-create-private');
  const track       = document.getElementById('ch-create-toggle-track');
  const thumb       = document.getElementById('ch-create-toggle-thumb');
  const cancelBtn   = document.getElementById('ch-create-cancel');
  const confirmBtn  = document.getElementById('ch-create-confirm');

  nameInput.focus();

  // Toggle animation
  function updateToggle() {
    if (checkbox.checked) {
      track.style.background = '#cc1414';
      thumb.style.transform  = 'translateX(20px)';
    } else {
      track.style.background = '#ccc';
      thumb.style.transform  = 'translateX(0)';
    }
  }

  checkbox.addEventListener('change', updateToggle);

  // Clicking track or thumb toggles the checkbox
  [track, thumb].forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      checkbox.checked = !checkbox.checked;
      updateToggle();
    });
  });

  function close() {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s ease';
    setTimeout(() => overlay.remove(), 150);
  }

  function submit() {
    const name      = nameInput.value.trim();
    const isPrivate = checkbox.checked;

    if (!name) {
      errorEl.textContent         = 'Channel name cannot be empty.';
      nameInput.style.borderColor = '#cc1414';
      nameInput.focus();
      return;
    }

    close();
    createChannel(name, type, isPrivate);
  }

  cancelBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', submit);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); submit(); }
    if (e.key === 'Escape') close();
    errorEl.textContent         = '';
    nameInput.style.borderColor = '#111';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachChannelButtonListener);
} else {
  attachChannelButtonListener();
}

// ─── Create Workspace ─────────────────────────────────────────────────────────

async function createWorkspace(name) {
  const token = getToken();
  if (!token) return;

  try {
    const res  = await fetch(`${API_BASE}/workspaces`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) { showErrorModal(data.error || 'Failed to create workspace'); return; }

    const newWorkspaceId = data.workspace_id || data.id || data.workspace?.id || data.workspace?.workspace_id;
    if (newWorkspaceId) {
      await createDefaultChannels(newWorkspaceId, token);
    }

    loadWorkspaces();
  } catch (err) {
    console.error('Error creating workspace:', err);
    showErrorModal('Could not create workspace. Check your connection.');
  }
}

// ─── Create Default Channels ──────────────────────────────────────────────────

async function createDefaultChannels(workspaceId, token) {
  const channelRequests = [
    { name: DEFAULT_TEXT_CHANNEL, type: 'text' },
    { name: DEFAULT_VOICE_CHANNEL, type: 'voice' },
  ].map(channel => {
    return fetch(`${API_BASE}/channels`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: channel.name, type: channel.type, workspace_id: workspaceId }),
    });
  });

  try {
    await Promise.allSettled(channelRequests);
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err) {
    console.error('Error creating default channels:', err);
  }
}

async function ensureDefaultChannels(workspaceId, token, channels = []) {
  if (!Array.isArray(channels)) channels = [];

  const channelNames = channels
    .filter(ch => ch && ch.name)
    .map(ch => ch.name.toLowerCase());

  const requests = [];
  if (!channelNames.includes(DEFAULT_TEXT_CHANNEL.toLowerCase())) {
    requests.push(fetch(`${API_BASE}/channels`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: DEFAULT_TEXT_CHANNEL, type: 'text', workspace_id: workspaceId }),
    }));
  }

  if (!channelNames.includes(DEFAULT_VOICE_CHANNEL.toLowerCase())) {
    requests.push(fetch(`${API_BASE}/channels`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: DEFAULT_VOICE_CHANNEL, type: 'voice', workspace_id: workspaceId }),
    }));
  }

  if (!requests.length) return false;

  try {
    await Promise.allSettled(requests);
    await new Promise(resolve => setTimeout(resolve, 500));
    return true;
  } catch (err) {
    console.error('Error ensuring default channels:', err);
    return false;
  }
}

// ─── Join Workspace ───────────────────────────────────────────────────────────

async function joinWorkspace(code) {
  const token = getToken();
  if (!token) return;

  setSidebarWsName('Joining');
  showChannelSpinner('Joining workspace...');

  try {
    const res  = await fetch(`${API_BASE}/workspaces/join`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ invite_code: code }),
    });
    const data = await res.json();
    if (!res.ok) {
      showErrorModal(data.error || 'Invalid invite code. Please try again.');
      showChannelError(data.error || 'Failed to join workspace.');
      return;
    }
    loadWorkspaces();
  } catch (err) {
    console.error('Error joining workspace:', err);
    showChannelError('Could not join workspace. Check your connection.');
  }
}

// ─── Load Workspaces and open a specific one ──────────────────────────────────

async function loadWorkspacesAndOpen(targetId) {
  const token = getToken();
  if (!token) return;

  setSidebarWsName('Loading');
  showChannelSpinner('Loading workspace...');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${API_BASE}/workspaces`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();

    if (!res.ok) {
      setSidebarWsName('Error');
      showChannelError(data.error || 'Failed to load workspaces.');
      return;
    }

    renderWorkspaces(data);

    const target = data.find(ws => ws.workspace_id === targetId);
    if (target) loadWorkspace(target);

  } catch (err) {
    if (err.name === 'AbortError') {
      setSidebarWsName('Offline');
      showChannelError('Server is waking up. Please refresh in 30 seconds.');
    } else {
      setSidebarWsName('Error');
      showChannelError('Could not reach the server. Check your connection.');
    }
    console.error('Error loading workspaces:', err);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  renderUserProfile();
  
  // Initialize mobile layout
  if (window.innerWidth <= 700) {
    const sidebar = document.querySelector('.sidebar');
    const chatPanel = document.getElementById('chat-panel');
    if (sidebar) sidebar.classList.remove('active');
    if (chatPanel) chatPanel.classList.remove('hidden');
  }
  
  const action = sessionStorage.getItem('ws_action');
  const openId = sessionStorage.getItem('ws_open_id');

  if (action === 'create') {
    const name = sessionStorage.getItem('ws_name');
    sessionStorage.removeItem('ws_action');
    sessionStorage.removeItem('ws_name');
    if (name) await createWorkspace(name);
    else loadWorkspaces();

  } else if (action === 'join') {
    const code = sessionStorage.getItem('ws_code');
    sessionStorage.removeItem('ws_action');
    sessionStorage.removeItem('ws_code');
    if (code) await joinWorkspace(code);
    else loadWorkspaces();

  } else if (openId) {
    sessionStorage.removeItem('ws_open_id');
    await loadWorkspacesAndOpen(openId);

  } else {
    loadWorkspaces();
  }
}

init();
initializeSocket();

// ─── Lightbox event listeners ─────────────────────────────────────────────────

const lightboxClose = document.getElementById('lightbox-close');
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