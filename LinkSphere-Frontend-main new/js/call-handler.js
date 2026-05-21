/**
 * call-handler.js
 * ─────────────────────────────────────────────────────────────────
 * Global incoming-call handler. Include this on EVERY page so the
 * receiver gets the incoming-call modal no matter where they are.
 *
 * Requirements on each page:
 *   <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js"></script>
 *   <script src="../js/call-handler.js"></script>   ← this file
 *
 * The script self-initialises as soon as it loads.
 * ─────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  const API_BASE  = 'https://linksphere-5bef.onrender.com/api';
  const SOCKET_URL = 'https://linksphere-5bef.onrender.com';

  // ── Shared state ──────────────────────────────────────────────────────────
  let _socket          = null;
  let _currentCallReq  = null;   // { caller, callerId, roomName }
  let _livekitRoom     = null;
  let _callMicEnabled  = false;
  let _callCamEnabled  = false;
  let _callTimerSecs   = 0;
  let _callTimerInt    = null;
  let _callAudioCtx    = null;
  let _callAnalyser    = null;
  let _callLevelTimer  = null;
  let _dmCallId        = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _getToken() {
    return localStorage.getItem('token');
  }

  function _getUser() {
    return JSON.parse(localStorage.getItem('user') || 'null');
  }

  function _esc(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function _fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ── Inject required CSS (only once) ──────────────────────────────────────

  function _injectStyles() {
    if (document.getElementById('_ch_styles')) return;
    const style = document.createElement('style');
    style.id = '_ch_styles';
    style.textContent = `
      /* ── call-handler overlay styles ── */
      #_ch_overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,.55);
        display: flex; align-items: center; justify-content: center;
        font-family: 'DM Sans', Arial, sans-serif;
      }
      #_ch_overlay .ch-box {
        background: #fff; border: 2px solid #111;
        width: 380px; max-width: 95vw;
        box-shadow: 6px 6px 0 #111;
      }
      #_ch_overlay .ch-title {
        background: #111; color: #fff;
        font-family: 'Black Han Sans', 'DM Sans', sans-serif;
        font-size: 11px; letter-spacing: .15em;
        padding: 10px 16px; text-transform: uppercase;
      }
      #_ch_overlay .ch-body {
        padding: 40px 24px; text-align: center;
      }
      #_ch_overlay .ch-avatar {
        width: 80px; height: 80px;
        background: #111; color: #fff;
        font-family: 'Black Han Sans', sans-serif; font-size: 32px;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 20px; border: 2px solid #111; overflow: hidden;
      }
      #_ch_overlay .ch-avatar img { width:100%; height:100%; object-fit:cover; }
      #_ch_overlay .ch-name {
        font-family: 'Black Han Sans', 'DM Sans', sans-serif;
        font-size: 16px; letter-spacing: .05em;
        text-transform: uppercase; margin-bottom: 6px;
      }
      #_ch_overlay .ch-status {
        font-size: 12px; color: #666;
        letter-spacing: .05em; text-transform: uppercase; margin-bottom: 28px;
      }
      #_ch_overlay .ch-countdown {
        font-size: 11px; color: #999;
        letter-spacing: .05em; margin-bottom: 20px;
      }
      #_ch_overlay .ch-btns { display:flex; gap:12px; justify-content:center; }
      #_ch_overlay .ch-btn {
        height: 44px; padding: 0 22px; border: 2px solid #111;
        font-family: 'DM Sans', Arial, sans-serif;
        font-size: 11px; font-weight: 700; letter-spacing: .12em;
        text-transform: uppercase; cursor: pointer; transition: background .1s;
        background: #fff; color: #111;
      }
      #_ch_overlay .ch-btn-accept {
        background: #e53935; border-color: #e53935; color: #fff;
      }
      #_ch_overlay .ch-btn-accept:hover { background: #b71c1c; border-color: #b71c1c; }
      #_ch_overlay .ch-btn:hover { background: #f5f5f5; }

      /* ── in-page call screen (injected into body) ── */
      #_ch_call_screen {
        position: fixed; inset: 0; z-index: 99998;
        background: #0a0a0a; display: flex; flex-direction: column;
        font-family: 'DM Sans', Arial, sans-serif;
        transform: translateY(100%); transition: transform .3s ease;
      }
      #_ch_call_screen.visible { transform: translateY(0); }
      ._ch_call_header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 20px; border-bottom: 1.5px solid #222; background: #111;
      }
      ._ch_call_header_left { display:flex; align-items:center; gap:12px; }
      ._ch_call_logo { color:#fff; font-size:22px; }
      ._ch_call_label { display:block; font-size:10px; color:#888; letter-spacing:.12em; }
      ._ch_call_peer_name { display:block; font-size:13px; color:#fff; font-weight:700; letter-spacing:.06em; }
      ._ch_call_header_right { display:flex; align-items:center; gap:12px; }
      ._ch_status_badge {
        font-size:10px; font-weight:700; letter-spacing:.1em;
        padding:4px 10px; border:1.5px solid #444; color:#aaa; text-transform:uppercase;
      }
      ._ch_status_badge.live { border-color:#4caf50; color:#4caf50; }
      ._ch_call_timer { font-size:13px; color:#888; font-variant-numeric:tabular-nums; }
      ._ch_stage {
        flex:1; display:flex; align-items:center; justify-content:center;
        gap:24px; padding:24px; position:relative;
      }
      ._ch_tile {
        flex:1; max-width:480px; aspect-ratio:4/3;
        background:#1a1a1a; border:1.5px solid #2a2a2a;
        display:flex; align-items:center; justify-content:center;
        position:relative; overflow:hidden;
      }
      ._ch_tile video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:none; }
      ._ch_tile_avatar {
        width:80px; height:80px; background:#333; color:#fff;
        font-size:30px; display:flex; align-items:center; justify-content:center;
        border:2px solid #444; overflow:hidden;
      }
      ._ch_tile_avatar img { width:100%; height:100%; object-fit:cover; }
      ._ch_tile_name {
        position:absolute; bottom:10px; left:10px;
        font-size:11px; font-weight:700; color:#fff;
        letter-spacing:.08em; text-transform:uppercase;
        background:rgba(0,0,0,.5); padding:3px 7px;
      }
      ._ch_self_tile {
        width: 160px; height: 120px; flex: none;
        background:#111; border:1.5px solid #333;
        position:relative; overflow:hidden;
        display:flex; align-items:center; justify-content:center;
      }
      ._ch_controls {
        display:flex; align-items:center; justify-content:center;
        gap:16px; padding:18px 24px; border-top:1.5px solid #1a1a1a;
        background:#0a0a0a;
      }
      ._ch_ctrl {
        display:flex; flex-direction:column; align-items:center; gap:6px;
        background:none; border:1.5px solid #333; color:#aaa;
        padding:10px 18px; cursor:pointer; font-size:10px;
        font-family:'DM Sans',Arial,sans-serif; font-weight:700;
        letter-spacing:.08em; text-transform:uppercase; transition:all .15s;
      }
      ._ch_ctrl:hover { border-color:#666; color:#fff; }
      ._ch_ctrl.on { border-color:#4caf50; color:#4caf50; }
      ._ch_ctrl_end {
        display:flex; align-items:center; gap:8px;
        background:#e53935; border:none; color:#fff;
        padding:12px 28px; cursor:pointer;
        font-size:11px; font-family:'DM Sans',Arial,sans-serif;
        font-weight:700; letter-spacing:.1em; text-transform:uppercase;
        transition:background .15s;
      }
      ._ch_ctrl_end:hover { background:#b71c1c; }
    `;
    document.head.appendChild(style);
  }

  // ── Play ringing tone ─────────────────────────────────────────────────────

  function _playRing() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (_) {}
  }

  // ── Show incoming call modal ──────────────────────────────────────────────

  function _showIncomingModal(callerProfile) {
    // Remove any stale overlay
    document.getElementById('_ch_overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '_ch_overlay';

    const avatarHTML = callerProfile.avatar_url
      ? `<img src="${_esc(callerProfile.avatar_url)}" alt="${_esc(callerProfile.name)}">`
      : _esc((callerProfile.name || '?').charAt(0).toUpperCase());

    overlay.innerHTML = `
      <div class="ch-box">
        <div class="ch-title">Incoming Voice Call</div>
        <div class="ch-body">
          <div class="ch-avatar">${avatarHTML}</div>
          <div class="ch-name">${_esc(callerProfile.name || 'Unknown')}</div>
          <div class="ch-status" id="_ch_status_txt">Incoming call...</div>
          <div class="ch-countdown" id="_ch_countdown" style="display:none;"></div>
          <div class="ch-btns">
            <button class="ch-btn" id="_ch_decline_btn">DECLINE</button>
            <button class="ch-btn ch-btn-accept" id="_ch_accept_btn">ACCEPT</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const statusTxt   = overlay.querySelector('#_ch_status_txt');
    const countdownEl = overlay.querySelector('#_ch_countdown');
    const declineBtn  = overlay.querySelector('#_ch_decline_btn');
    const acceptBtn   = overlay.querySelector('#_ch_accept_btn');

    // 20-second auto-decline countdown
    let countdown = 20;
    const countdownTimer = setInterval(() => {
      countdown--;
      countdownEl.textContent = `AUTO-DECLINE IN ${countdown}S`;
      if (countdown <= 0) {
        clearInterval(countdownTimer);
        if (_socket && _currentCallReq) {
          _socket.emit('call_declined', { callerId: _currentCallReq.callerId, noAnswer: true });
        }
        _currentCallReq = null;
        _removeOverlay();
      }
    }, 1000);

    function _removeOverlay() {
      clearInterval(countdownTimer);
      const el = document.getElementById('_ch_overlay');
      if (el) { el.style.opacity = '0'; el.style.transition = 'opacity .15s'; setTimeout(() => el?.remove(), 160); }
    }

    declineBtn.addEventListener('click', () => {
      if (_socket && _currentCallReq) {
        _socket.emit('call_declined', { callerId: _currentCallReq.callerId });
      }
      _currentCallReq = null;
      _removeOverlay();
    });

    acceptBtn.addEventListener('click', async () => {
      clearInterval(countdownTimer);
      acceptBtn.disabled    = true;
      acceptBtn.textContent = 'CONNECTING...';
      statusTxt.textContent = 'Starting call...';

      try {
        const authToken = _getToken();
        const me        = _getUser();
        const roomName  = _currentCallReq?.roomName
          || ['dm', me?.user_id, _currentCallReq?.callerId].sort().join('_');

        const res = await fetch(`${API_BASE}/calls/token`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName, participantName: me?.name || me?.user_id }),
        });

        if (!res.ok) {
          const err = await res.json();
          statusTxt.textContent = err.error || 'Failed to start call';
          acceptBtn.disabled    = false;
          acceptBtn.textContent = 'ACCEPT';
          return;
        }

        const { token: livekitToken, serverUrl } = await res.json();

        // Notify caller
        if (_socket && _currentCallReq) {
          _socket.emit('call_accepted', { callerId: _currentCallReq.callerId, roomName });
        }

        // Log call start
        try {
          const callRes = await fetch(`${API_BASE}/calls/dm`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_name: roomName, call_type: 'audio' }),
          });
          if (callRes.ok) {
            const callData = await callRes.json();
            _dmCallId = callData.call?.call_id || callData.dm_call?.dm_call_id || null;
          }
        } catch (_) {}

        const savedReq  = _currentCallReq;
_currentCallReq = null;
_removeOverlay();

if (window.location.pathname.includes('messages.html')) {
  _startCallScreen({
    user: { name: callerProfile.name, avatar_url: callerProfile.avatar_url, user_id: savedReq.callerId },
    roomName, livekitToken, serverUrl,
  });
} else {
  sessionStorage.setItem('_ch_pending_call', JSON.stringify({
    user: { name: callerProfile.name, avatar_url: callerProfile.avatar_url, user_id: savedReq.callerId },
    roomName, livekitToken, serverUrl,
  }));
  window.location.href = `messages.html?callUserId=${savedReq.callerId}`;
}

      } catch (err) {
        console.error('[call-handler] Accept error:', err);
        statusTxt.textContent = 'Connection failed.';
        acceptBtn.disabled    = false;
        acceptBtn.textContent = 'ACCEPT';
      }
    });
  }

  // ── In-page call screen ───────────────────────────────────────────────────

  function _startCallScreen({ user, roomName, livekitToken, serverUrl }) {
    document.getElementById('_ch_call_screen')?.remove();
    const me = _getUser();

    const peerAvatar = user.avatar_url
      ? `<img src="${_esc(user.avatar_url)}" alt="${_esc(user.name)}">`
      : _esc((user.name || '?').charAt(0).toUpperCase());

    const myAvatar = me?.avatar_url
      ? `<img src="${_esc(me.avatar_url)}" alt="${_esc(me.name)}">`
      : _esc((me?.name || 'Y').charAt(0).toUpperCase());

    const screen = document.createElement('div');
    screen.id = '_ch_call_screen';
    screen.innerHTML = `
      <div class="_ch_call_header">
        <div class="_ch_call_header_left">
          <div class="_ch_call_logo">✣</div>
          <div>
            <span class="_ch_call_label">PRIVATE CALL</span>
            <span class="_ch_call_peer_name">${_esc((user.name || 'User').toUpperCase())}</span>
          </div>
        </div>
        <div class="_ch_call_header_right">
          <div class="_ch_status_badge" id="_ch_status">CONNECTING</div>
          <div class="_ch_call_timer" id="_ch_timer">00:00:00</div>
        </div>
      </div>
      <div class="_ch_stage">
        <div class="_ch_tile" id="_ch_peer_tile">
          <video id="_ch_peer_video" autoplay playsinline></video>
          <audio id="_ch_peer_audio" autoplay></audio>
          <div class="_ch_tile_avatar" id="_ch_peer_avatar">${peerAvatar}</div>
          <div class="_ch_tile_name">${_esc((user.name || 'User').toUpperCase())}</div>
        </div>
        <div class="_ch_self_tile" id="_ch_self_tile">
          <video id="_ch_self_video" autoplay muted playsinline></video>
          <div class="_ch_tile_avatar" id="_ch_self_avatar">${myAvatar}</div>
          <div class="_ch_tile_name">${_esc((me?.name || 'You').toUpperCase())}</div>
        </div>
      </div>
      <div class="_ch_controls">
        <button class="_ch_ctrl" id="_ch_ctrl_mic">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/>
          </svg>
          <span>MIC</span>
        </button>
        <button class="_ch_ctrl" id="_ch_ctrl_cam">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M4 6h11a2 2 0 0 1 2 2v1.25L22 6.5v11l-5-2.75V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/>
          </svg>
          <span>VIDEO</span>
        </button>
        <button class="_ch_ctrl_end" id="_ch_ctrl_end">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.7-.36 1.06-.2 1.1.45 2.3.7 3.54.7.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.57 21 3 13.43 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.2 1.01L6.6 10.8Z"/>
          </svg>
          END CALL
        </button>
      </div>
    `;
    document.body.appendChild(screen);
    requestAnimationFrame(() => screen.classList.add('visible'));

    // Timer
    _callTimerSecs = 0;
    clearInterval(_callTimerInt);
    _callTimerInt = setInterval(() => {
      _callTimerSecs++;
      const h = String(Math.floor(_callTimerSecs / 3600)).padStart(2,'0');
      const m = String(Math.floor((_callTimerSecs % 3600) / 60)).padStart(2,'0');
      const s = String(_callTimerSecs % 60).padStart(2,'0');
      const el = document.getElementById('_ch_timer');
      if (el) el.textContent = `${h}:${m}:${s}`;
    }, 1000);

    screen.querySelector('#_ch_ctrl_mic').addEventListener('click', async () => {
      if (!_livekitRoom) return;
      _callMicEnabled = !_callMicEnabled;
      await _livekitRoom.localParticipant.setMicrophoneEnabled(_callMicEnabled);
      const btn = screen.querySelector('#_ch_ctrl_mic');
      btn.classList.toggle('on', _callMicEnabled);
      btn.querySelector('span').textContent = _callMicEnabled ? 'MIC ON' : 'MIC';
    });

    screen.querySelector('#_ch_ctrl_cam').addEventListener('click', async () => {
      if (!_livekitRoom) return;
      _callCamEnabled = !_callCamEnabled;
      const selfVideo  = screen.querySelector('#_ch_self_video');
      const selfAvatar = screen.querySelector('#_ch_self_avatar');
      const btn        = screen.querySelector('#_ch_ctrl_cam');
      if (_callCamEnabled) {
        await _livekitRoom.localParticipant.setCameraEnabled(true);
        const attach = () => {
          const pub = _livekitRoom.localParticipant.getTrackPublication(LivekitClient.Track.Source.Camera);
          if (pub?.track) { pub.track.attach(selfVideo); selfVideo.style.display='block'; selfAvatar.style.display='none'; }
        };
        attach(); setTimeout(attach, 500);
      } else {
        await _livekitRoom.localParticipant.setCameraEnabled(false);
        selfVideo.srcObject = null; selfVideo.style.display='none'; selfAvatar.style.display='flex';
      }
      btn.classList.toggle('on', _callCamEnabled);
      btn.querySelector('span').textContent = _callCamEnabled ? 'CAM ON' : 'VIDEO';
    });

    screen.querySelector('#_ch_ctrl_end').addEventListener('click', () => _endCall(screen, user));

    _connectLiveKit({ screen, livekitToken, serverUrl, user });
  }

  // ── Connect LiveKit ───────────────────────────────────────────────────────

  async function _connectLiveKit({ screen, livekitToken, serverUrl, user }) {
    const statusEl = document.getElementById('_ch_status');
    try {
      const { Room, RoomEvent, Track } = LivekitClient;
      _livekitRoom = new Room({
        adaptiveStream: true, dynacast: true,
        audioCaptureDefaults: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
      });

      _livekitRoom.on(RoomEvent.ParticipantConnected, () => {
        if (statusEl) { statusEl.textContent = 'LIVE'; statusEl.classList.add('live'); }
        document.getElementById('_ch_peer_tile')?.classList.add('dm-tile-connected');
      });

      _livekitRoom.on(RoomEvent.ParticipantDisconnected, () => {
        if (statusEl) { statusEl.textContent = 'PEER LEFT'; statusEl.classList.remove('live'); }
        if (_socket) _socket.emit('call_ended', { userId: user.user_id });
        setTimeout(() => _endCall(screen, user), 1500);
      });

      _livekitRoom.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = document.getElementById('_ch_peer_audio');
          if (el) track.attach(el);
        }
        if (track.kind === Track.Kind.Video) {
          const vid = document.getElementById('_ch_peer_video');
          const av  = document.getElementById('_ch_peer_avatar');
          if (vid) { track.attach(vid); vid.style.display='block'; if(av) av.style.display='none'; }
        }
      });

      _livekitRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Video) {
          const vid = document.getElementById('_ch_peer_video');
          const av  = document.getElementById('_ch_peer_avatar');
          if (vid) { track.detach(vid); vid.style.display='none'; if(av) av.style.display='flex'; }
        }
      });

      _livekitRoom.on(RoomEvent.Disconnected, () => {
        if (_socket) _socket.emit('call_ended', { userId: user.user_id });
        _endCall(screen, user);
      });

      await _livekitRoom.connect(serverUrl, livekitToken);
      await _livekitRoom.localParticipant.setMicrophoneEnabled(true);
      _callMicEnabled = true;
      const micBtn = screen.querySelector('#_ch_ctrl_mic');
      if (micBtn) { micBtn.classList.add('on'); micBtn.querySelector('span').textContent = 'MIC ON'; }

      if (_livekitRoom.remoteParticipants.size === 0 && statusEl) statusEl.textContent = 'WAITING...';

    } catch (err) {
      console.error('[call-handler] LiveKit error:', err);
      if (statusEl) statusEl.textContent = 'FAILED';
    }
  }

  // ── End call ──────────────────────────────────────────────────────────────

  function _endCall(screen, user) {
    clearInterval(_callTimerInt);
    clearInterval(_callLevelTimer);

    if (_dmCallId) {
      fetch(`${API_BASE}/calls/dm/${_dmCallId}/end`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_getToken()}` },
      }).catch(() => {});
      _dmCallId = null;
    }

    if (_livekitRoom) { _livekitRoom.disconnect(); _livekitRoom = null; }
    if (_callAudioCtx) { _callAudioCtx.close(); _callAudioCtx = null; _callAnalyser = null; }

    _callMicEnabled = false;
    _callCamEnabled = false;

    if (screen) {
      screen.classList.remove('visible');
      setTimeout(() => screen?.remove(), 300);
    }
  }

  // ── Socket init ───────────────────────────────────────────────────────────

  function _initSocket() {
    // Avoid double-init (e.g. messages.js also inits its own socket)
    // We piggyback on the existing window._chSocket if present
    if (window._chSocket) { _socket = window._chSocket; return; }

    const token = _getToken();
    if (!token) return;

    _socket = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
    window._chSocket = _socket;   // share with other scripts if needed

    _socket.on('connect', () => {
      console.log('[call-handler] Socket connected:', _socket.id);
      const me = _getUser();
      if (me?.user_id) {
        _socket.emit('join_user_room', me.user_id);
        console.log('[call-handler] Joined user room:', me.user_id);
      }
    });

    _socket.on('disconnect', () => console.log('[call-handler] Socket disconnected'));

    // ── Incoming call ─────────────────────────────────────────────────────
    _socket.on('incoming_call', async (data) => {
      const { caller, callerId, roomName } = data;
      _currentCallReq = { caller, callerId, roomName };

      let callerProfile = { name: caller, avatar_url: null, email: '' };
      try {
        const res = await fetch(`${API_BASE}/dm/conversations`, {
          headers: { 'Authorization': `Bearer ${_getToken()}` },
        });
        if (res.ok) {
          const convs = await res.json();
          const conv  = convs.find(c => c.user_id === callerId);
          if (conv) callerProfile = { name: conv.name || caller, avatar_url: conv.avatar_url || null, email: conv.email || '' };
        }
      } catch (_) {}

      _playRing();
      _showIncomingModal(callerProfile);
    });

    // ── Call cancelled by caller ──────────────────────────────────────────
    _socket.on('call_cancelled', () => {
      const overlay = document.getElementById('_ch_overlay');
      if (overlay) {
        const st = overlay.querySelector('#_ch_status_txt');
        if (st) st.textContent = 'Call cancelled';
        setTimeout(() => overlay.remove(), 2000);
      }
      // Also handle messages.js overlay if on messages page
      const msgOverlay = document.getElementById('voice-call-overlay');
      if (msgOverlay) {
        const st = msgOverlay.querySelector('#dialing-status-text');
        if (st) st.textContent = 'Call cancelled';
        setTimeout(() => msgOverlay.remove(), 2000);
      }
    });

    // ── Call ended by peer ────────────────────────────────────────────────
    _socket.on('call_ended', () => {
      const screen = document.getElementById('_ch_call_screen');
      if (screen) _endCall(screen, {});
      // Also handle messages.js call screen if on messages page
      const msgScreen = document.getElementById('dm-call-screen');
      if (msgScreen && typeof endInPageCall === 'function') endInPageCall(msgScreen);
    });

    // ── Call rejected (for caller) ────────────────────────────────────────
    _socket.on('call_rejected', (data) => {
      const overlay = document.getElementById('voice-call-overlay');
      if (!overlay) return;
      const st = overlay.querySelector('#dialing-status-text');
      if (data?.noAnswer) { if (st) st.textContent = 'No answer'; return; }
      if (st) st.textContent = 'Call rejected';
      setTimeout(() => overlay.remove(), 2000);
    });

    // ── Call accepted (for caller) — handled by messages.js on messages page
    // But if caller is on a different page, we need to handle it here too
    _socket.on('call_accepted', async (data) => {
      // If messages.js is present and handles this, skip
      if (typeof startInPageVoiceCall === 'function') return;

      const overlay = document.getElementById('voice-call-overlay');
      if (overlay) overlay.remove();

      const { roomName } = data;
      const authToken = _getToken();
      const me = _getUser();

      // We need to know who we were calling — stored on window by startVoiceCall
      const callee = window._chCallTarget;
      if (!callee) return;

      try {
        const res = await fetch(`${API_BASE}/calls/token`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName, participantName: me?.name || me?.user_id }),
        });
        if (!res.ok) return;
        const { token: livekitToken, serverUrl } = await res.json();

        try {
          const callRes = await fetch(`${API_BASE}/calls/dm`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiver_id: callee.user_id, room_name: roomName, call_type: 'audio' }),
          });
          if (callRes.ok) {
            const cd = await callRes.json();
            _dmCallId = cd.dm_call?.dm_call_id || cd.call?.call_id || null;
          }
        } catch (_) {}

        _startCallScreen({ user: callee, roomName, livekitToken, serverUrl });
      } catch (err) {
        console.error('[call-handler] Caller join error:', err);
      }
    });
  }

  // ── Public helper: start a call from any page ─────────────────────────────
  // Usage: window.ChCallHandler.startCall({ user_id, name, avatar_url })

  window.ChCallHandler = {
    startCall(user) {
      if (!_socket || !_socket.connected) _initSocket();
      const me       = _getUser();
      const roomName = ['dm', me.user_id, user.user_id].sort().join('_');
      window._chCallTarget = user;

      if (_socket && _socket.connected) {
        _socket.emit('outgoing_call', {
          receiverId:   user.user_id,
          receiverName: user.name,
          callerId:     me.user_id,
          callerName:   me.name,
          roomName,
        });
      }

      // Show dialing modal (reuses messages.js showDialingModal if on messages page,
      // otherwise shows a simple overlay)
      if (typeof showDialingModal === 'function') {
        showDialingModal(user, true);
      } else {
        _showCallerModal(user, roomName);
      }
    },
  };

  function _showCallerModal(user, roomName) {
    document.getElementById('_ch_overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = '_ch_overlay';
    const avatarHTML = user.avatar_url
      ? `<img src="${_esc(user.avatar_url)}" alt="${_esc(user.name)}">`
      : _esc((user.name || '?').charAt(0).toUpperCase());

    overlay.innerHTML = `
      <div class="ch-box">
        <div class="ch-title">Voice Call</div>
        <div class="ch-body">
          <div class="ch-avatar">${avatarHTML}</div>
          <div class="ch-name">${_esc(user.name || 'User')}</div>
          <div class="ch-status" id="_ch_status_txt">Requesting call...</div>
          <div class="ch-btns">
            <button class="ch-btn" id="_ch_cancel_btn">CANCEL CALL</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#_ch_cancel_btn').addEventListener('click', () => {
      if (_socket) _socket.emit('call_cancelled_by_initiator', { receiverId: user.user_id });
      overlay.remove();
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  _injectStyles();

  // Wait for DOM + socket.io to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initSocket);
  } else {
    _initSocket();
  }

})();