'use strict';

// ─── LiveKit SDK ──────────────────────────────────────────────────────────────
const { Room, RoomEvent, Track } = LivekitClient;

// ─── State ────────────────────────────────────────────────────────────────────
let seconds       = 0;
let micEnabled    = false;
let cameraEnabled = false;
let audioContext  = null;
let analyser      = null;
let levelTimer    = null;
let room          = null;

// ─── DOM refs (static — exist in HTML from the start) ────────────────────────
const timerEl      = document.getElementById('timer');
const toast        = document.getElementById('miniToast');
const muteBtn      = document.getElementById('muteBtn');
const videoBtn     = document.getElementById('videoBtn');
const moreBtn      = document.getElementById('moreBtn');
const leaveBtn     = document.getElementById('leaveBtn');
const privacyPanel = document.getElementById('privacyPanel');
const privacyText  = document.getElementById('privacyText');
const privacyBtn   = document.getElementById('privacyBtn');

// ─── Dynamic DOM refs (resolved after tile is injected) ───────────────────────
let localVideo  = null;
let voiceMeter  = null;
let micBadge    = null;

// ─── Timer ────────────────────────────────────────────────────────────────────
function formatTime(s) {
  return [Math.floor(s/3600), Math.floor((s%3600)/60), s%60]
    .map(n => String(n).padStart(2,'0')).join(':');
}

function startSyncedTimer(startTimeIso) {
  const startMs = new Date(startTimeIso).getTime();
  function tick() {
    seconds = Math.floor((Date.now() - startMs) / 1000);
    timerEl.textContent = formatTime(seconds);
  }
  tick();
  return setInterval(tick, 1000);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1700);
}

// ─── UI state (safe — only called after tile is built) ───────────────────────
function updateUiState() {
  muteBtn.classList.toggle('is-live', micEnabled);
  videoBtn.classList.toggle('is-live', cameraEnabled);
  if (voiceMeter)  voiceMeter.classList.toggle('listening', micEnabled);
  if (micBadge)    micBadge.style.background = micEnabled ? '#dc2626' : '#000';
  muteBtn.querySelector('span').textContent  = micEnabled    ? 'Mic On'   : 'Mic';
  videoBtn.querySelector('span').textContent = cameraEnabled ? 'Video On' : 'Video';
}

// ─── Recalculate grid layout based on participant count ───────────────────────
function updateGridLayout() {
  const grid  = document.getElementById('participantsGrid');
  const tiles = grid.querySelectorAll('.participant');
  tiles.forEach(t => t.classList.remove('active'));
}

// ─── Avatar HTML helper ───────────────────────────────────────────────────────
function avatarInnerHTML(name, avatarUrl) {
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}"
              style="width:100%;height:100%;object-fit:cover;border-radius:0;display:block;" />`;
  }
  return escapeHtml((name || '?').charAt(0).toUpperCase());
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Build LOCAL participant tile ─────────────────────────────────────────────
function buildLocalTile(user) {
  const grid     = document.getElementById('participantsGrid');
  const existing = document.getElementById('local-tile');
  if (existing) existing.remove();

  const emptyState = document.getElementById('participantsEmpty');
  if (emptyState) emptyState.remove();

  const initial   = (user.name || user.user_id || '?').charAt(0).toUpperCase();
  const hasAvatar = !!user.avatar_url;

  const article = document.createElement('article');
  article.className = 'participant';
  article.style     = '--delay:.08s';
  article.id        = 'local-tile';

  article.innerHTML = `
    <div class="tile-content" id="localTileContent">
      <video id="localVideo" autoplay muted playsinline
       style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
              display:none;z-index:2;"></video>
      <div class="local-avatar-wrap" id="localAvatarWrap"
           style="position:absolute;inset:0;display:flex;align-items:center;
                  justify-content:center;z-index:1;background:#000;">
        ${hasAvatar
          ? `<img src="${escapeHtml(user.avatar_url)}" alt="${escapeHtml(user.name)}"
                  id="localAvatarImg"
                  style="width:100%;height:100%;object-fit:cover;display:block;" />`
          : `<span class="initial" id="localInitial">${initial}</span>`
        }
      </div>

      <button class="mic-badge" id="micBadge" aria-label="Microphone status"
              style="z-index:3;">
        <svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>
      </button>

      <span class="name-tag" style="z-index:3;">${escapeHtml(user.name || 'You')}</span>

      <div class="voice-meter" id="voiceMeter" aria-hidden="true" style="z-index:3;">
        <span></span><span></span><span></span><span></span>
      </div>
    </div>
  `;

  grid.insertBefore(article, grid.firstChild);

  localVideo = document.getElementById('localVideo');
  console.log('localVideo ref set:', localVideo);
  voiceMeter = document.getElementById('voiceMeter');
  micBadge   = document.getElementById('micBadge');

  updateGridLayout();
}

async function hydrateTileAvatar(userId) {
  const authToken = localStorage.getItem('token');
  if (!authToken || !userId) return;
  try {
    const res = await fetch(`https://linksphere-5bef.onrender.com/api/users/${userId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const user = await res.json();

    const tile = document.getElementById(`tile-${userId}`);
    if (tile) {
      const nameTag = tile.querySelector('.name-tag');
      if (nameTag) nameTag.textContent = user.name || userId;
    }

    if (!user.avatar_url) return;
    const wrap = document.getElementById(`avatar-wrap-${userId}`);
    if (!wrap) return;
    wrap.innerHTML = `<img src="${escapeHtml(user.avatar_url)}" alt="${escapeHtml(user.name || userId)}"
      style="width:100%;height:100%;object-fit:cover;display:block;" />`;
  } catch (err) {
    console.warn('Could not hydrate avatar for', userId, err);
  }
}

// ─── Remote participant tile ──────────────────────────────────────────────────
function addRemoteTile(participant) {
  if (document.getElementById(`tile-${participant.identity}`)) return;

  const grid      = document.getElementById('participantsGrid');
  const meta      = parseParticipantMeta(participant);
  const name      = meta.name || participant.name || participant.identity || 'User';
  const hasAvatar = !!meta.avatarUrl;

  setTimeout(() => hydrateTileAvatar(participant.identity), 0);

  const article = document.createElement('article');
  article.className = 'participant';
  article.id        = `tile-${participant.identity}`;
  article.style     = '--delay:.3s';
  article.dataset.name = name;

  article.innerHTML = `
    <div class="tile-content">
      <video id="video-${participant.identity}" autoplay playsinline
             style="position:absolute;inset:0;width:100%;height:100%;
                    object-fit:cover;display:none;z-index:0;"></video>

      <audio id="audio-${participant.identity}" autoplay></audio>

      <div class="remote-avatar-wrap" id="avatar-wrap-${participant.identity}"
           style="position:absolute;inset:0;display:flex;align-items:center;
                  justify-content:center;z-index:1;background:#000;">
        ${hasAvatar
          ? `<img src="${escapeHtml(meta.avatarUrl)}" alt="${escapeHtml(name)}"
                  style="width:100%;height:100%;object-fit:cover;display:block;" />`
          : `<span class="initial">${escapeHtml(name.charAt(0).toUpperCase())}</span>`
        }
      </div>

      <span class="name-tag" style="z-index:3;">${escapeHtml(name)}</span>

      <div class="voice-meter" id="meter-${participant.identity}" aria-hidden="true"
           style="z-index:3;">
        <span></span><span></span><span></span><span></span>
      </div>
    </div>
  `;

  grid.appendChild(article);
  updateGridLayout();
}

function removeRemoteTile(participant) {
  document.getElementById(`tile-${participant.identity}`)?.remove();
  updateGridLayout();
}

// ─── Parse avatar/name from participant metadata ──────────────────────────────
function parseParticipantMeta(participant) {
  try {
    if (participant.metadata) {
      return JSON.parse(participant.metadata);
    }
  } catch (_) {}
  return { avatarUrl: null };
}

// ─── Track attach / detach ────────────────────────────────────────────────────
function attachTrack(track, participant) {
  if (track.kind === Track.Kind.Video) {
    const videoEl    = document.getElementById(`video-${participant.identity}`);
    const avatarWrap = document.getElementById(`avatar-wrap-${participant.identity}`);
    if (videoEl) {
      track.attach(videoEl);
      videoEl.style.display = 'block';
      if (avatarWrap) avatarWrap.style.display = 'none';
    }
  }
  if (track.kind === Track.Kind.Audio) {
    const audioEl = document.getElementById(`audio-${participant.identity}`);
    if (audioEl) track.attach(audioEl);
  }
}

function detachTrack(track, participant) {
  if (track.kind === Track.Kind.Video) {
    const videoEl    = document.getElementById(`video-${participant.identity}`);
    const avatarWrap = document.getElementById(`avatar-wrap-${participant.identity}`);
    if (videoEl) {
      track.detach(videoEl);
      videoEl.style.display = 'none';
      videoEl.srcObject = null;
    }
    if (avatarWrap) {
      avatarWrap.style.display = 'flex';
      avatarWrap.style.zIndex  = '2';
    }
  }
  if (track.kind === Track.Kind.Audio) {
    const audioEl = document.getElementById(`audio-${participant.identity}`);
    if (audioEl) track.detach(audioEl);
  }
}

// ─── Voice meter ──────────────────────────────────────────────────────────────
function startVoiceMeter(stream) {
  const tracks = stream.getAudioTracks();
  if (!tracks.length) return;
  audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(new MediaStream(tracks));
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  clearInterval(levelTimer);
  levelTimer = setInterval(() => {
    if (!micEnabled || !analyser || !voiceMeter) return;
    analyser.getByteFrequencyData(data);
    const level = data.reduce((s,v) => s+v, 0) / data.length;
    voiceMeter.style.transform = `scaleY(${Math.max(1, Math.min(1.75, 1+level/110))})`;
  }, 120);
}

// ─── Connect to LiveKit ───────────────────────────────────────────────────────
async function connectToLiveKit({ livekitToken, serverUrl, callType='voice', channelName='Lobby', user={} } = {}) {
  const callStatusEl = document.querySelector('.call-status strong');
if (callStatusEl) callStatusEl.textContent = '● LIVE';

  if (!livekitToken || !serverUrl) {
    showToast('No call session found');
    privacyText.textContent = 'No call session. Go back and start a call.';
    return;
  }

  try {
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
      },
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
  addRemoteTile(participant);
  // attach already-published tracks (important for mobile)
  participant.trackPublications.forEach((pub) => {
    if (pub.isSubscribed && pub.track) {
      attachTrack(pub.track, participant);
    }
  });
  const tile = document.getElementById(`tile-${participant.identity}`);
  const name = tile?.dataset.name || parseParticipantMeta(participant).name || 'A user';
  showToast(`${name} joined`);
});

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      const tile = document.getElementById(`tile-${participant.identity}`);
      const name = tile?.dataset.name || parseParticipantMeta(participant).name || 'A user';
      removeRemoteTile(participant);
      showToast(`${name} left`);
    });

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      attachTrack(track, participant);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      detachTrack(track, participant);
    });

    room.on(RoomEvent.TrackUnpublished, (_pub, participant) => {
  const videoEl    = document.getElementById(`video-${participant.identity}`);
  const avatarWrap = document.getElementById(`avatar-wrap-${participant.identity}`);
  if (videoEl) {
    videoEl.style.display = 'none';
    videoEl.srcObject = null;
  }
  if (avatarWrap) {
    avatarWrap.style.display = 'flex';
    avatarWrap.style.zIndex  = '2';
  }
});

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      document.querySelectorAll('.voice-meter').forEach(el => el.classList.remove('listening'));
      speakers.forEach(p => {
        const el = document.getElementById(
          p.isLocal ? 'voiceMeter' : `meter-${p.identity}`
        );
        if (el) el.classList.add('listening');
      });
    });

    room.on(RoomEvent.Disconnected, () => {
      showToast('Disconnected from call');
      cleanup();
    });

    // LocalTrackPublished: handled by videoBtn click directly

   await room.connect(serverUrl, livekitToken);

    // Always join with mic only — camera off by default
try {
  await room.localParticipant.setMicrophoneEnabled(true);
} catch (err) {
  console.warn('Mic failed:', err);
}
cameraEnabled = false;

    micEnabled = true;

    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micPub?.track) {
      startVoiceMeter(new MediaStream([micPub.track.mediaStreamTrack]));
    }

    room.remoteParticipants.forEach((participant) => {
      addRemoteTile(participant);
      participant.trackPublications.forEach((pub) => {
        if (pub.track) attachTrack(pub.track, participant);
      });
    });

    privacyPanel.style.transition   = 'all 0.4s ease';
    privacyPanel.style.maxHeight    = '0';
    privacyPanel.style.padding      = '0 12px';
    privacyPanel.style.marginBottom = '0';
    privacyPanel.style.overflow     = 'hidden';
    privacyPanel.style.border       = 'none';
    setTimeout(() => { privacyPanel.style.display = 'none'; }, 420);

    updateUiState();
    showToast('Connected to ' + channelName);

  } catch (err) {
    console.error('LiveKit connection error:', err);
    privacyText.textContent = `Connection failed: ${err.message}`;
    showToast('Failed to connect');
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
function cleanup() {
  clearInterval(window._timerInterval);
  clearInterval(levelTimer);
  if (room) { room.disconnect(); room = null; }
  micEnabled = false; cameraEnabled = false;
  updateUiState();
}

// ─── Control buttons ──────────────────────────────────────────────────────────
muteBtn.addEventListener('click', async () => {
  if (!room) return;
  micEnabled = !micEnabled;
  await room.localParticipant.setMicrophoneEnabled(micEnabled);
  updateUiState();
  showToast(micEnabled ? 'Microphone on' : 'Microphone off');
});

videoBtn.addEventListener('click', async () => {
  if (!room) return;
  cameraEnabled = !cameraEnabled;

  const avatarWrap = document.getElementById('localAvatarWrap');

  if (cameraEnabled) {
  try {
    await room.localParticipant.setCameraEnabled(true);

    const attachLocal = () => {
      const camPub = [...room.localParticipant.trackPublications.values()].find(p => p.source === 'camera');
      const vid    = document.getElementById('localVideo');
      const wrap   = document.getElementById('localAvatarWrap');
      console.log('attachLocal camPub:', camPub, 'track:', camPub?.track);
      if (camPub?.track && vid) {
        camPub.track.attach(vid);
        vid.style.display = 'block';
        vid.style.zIndex  = '10';
        if (wrap) { wrap.style.display = 'none'; wrap.style.zIndex = '0'; }
      }
    };

    attachLocal();
    setTimeout(attachLocal, 500);
    setTimeout(attachLocal, 1500);

  } catch (err) {
    console.error('Camera error:', err);
    showToast('Camera access denied');
    cameraEnabled = false;
  }
  } else {
  await room.localParticipant.setCameraEnabled(false);
  const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (camPub?.track && localVideo) {
    camPub.track.detach(localVideo);
  }
  if (localVideo) {
    localVideo.srcObject = null;
    localVideo.style.display = 'none';
  }
  const avatarWrapCheck = document.getElementById('localAvatarWrap');
  if (avatarWrapCheck) {
    avatarWrapCheck.style.display    = 'flex';
    avatarWrapCheck.style.background = '#000';
    avatarWrapCheck.style.zIndex     = '2';
  }
}

  updateUiState();
  showToast(cameraEnabled ? 'Camera on' : 'Camera off');
});

// ─── Leave button — logs leave to Supabase then disconnects ──────────────────
leaveBtn.addEventListener('click', async () => {
  leaveBtn.animate(
    [{transform:'scale(1)'},{transform:'scale(.92)'},{transform:'scale(1)'}],
    {duration:260, easing:'ease-out'}
  );
  showToast('Leaving call...');

  // POST /api/calls/:callId/leave — marks this user's left_at in call_participant
  if (window._channelCallId) {
    try {
      await fetch(`https://linksphere-5bef.onrender.com/api/calls/${window._channelCallId}/leave`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type':  'application/json',
        },
      });
    } catch (err) {
      console.warn('Could not log channel call leave:', err);
    }
    window._channelCallId = null;
  }

  setTimeout(() => {
    cleanup();
    window.history.back();
  }, 600);
});

moreBtn.addEventListener('click', () => {
  if (privacyPanel.style.display === 'none') {
    privacyPanel.style.display      = 'flex';
    privacyPanel.style.maxHeight    = '200px';
    privacyPanel.style.padding      = '12px';
    privacyPanel.style.marginBottom = '28px';
    privacyPanel.style.border       = '2px solid #000';
  }
  privacyPanel.scrollIntoView({behavior:'smooth', block:'center'});
  privacyPanel.animate(
    [{transform:'scale(1)'},{transform:'scale(1.03)'},{transform:'scale(1)'}],
    {duration:360, easing:'ease-out'}
  );
  showToast('Connection info');
});

privacyBtn.addEventListener('click', () => {
  connectToLiveKit({});
});

window.addEventListener('beforeunload', () => {
  if (window._channelCallId) {
    const token = localStorage.getItem('token');
    navigator.sendBeacon(
      `https://linksphere-5bef.onrender.com/api/calls/${window._channelCallId}/leave?token=${token}`,
      new Blob([JSON.stringify({})], { type: 'application/json' })
    );
    window._channelCallId = null;
  }
});

// ─── INIT: Voice Channel Join ─────────────────────────────────────────────────
(async () => {
  // workspace.js must store BOTH of these in sessionStorage before navigating here:
  //   sessionStorage.setItem('voice_channel_id',   channel.channel_id);   // UUID
  //   sessionStorage.setItem('voice_channel_name', channel.channel_name); // display name
  const voiceChannelId   = sessionStorage.getItem('voice_channel_id');
const voiceChannelName = sessionStorage.getItem('voice_channel_name');

if (!voiceChannelId || !voiceChannelName) {
  privacyText.textContent = 'No voice channel session. Go back and click a voice channel.';
  const emptyState = document.getElementById('participantsEmpty');
  if (emptyState) emptyState.remove();
  return;
}

// ← ADD HERE
document.title = `${voiceChannelName} - Voice Channel`;
const brandH1 = document.querySelector('.brand-wrap h1');
if (brandH1) brandH1.textContent = voiceChannelName;
const callStatusEl = document.querySelector('.call-status strong');
if (callStatusEl) callStatusEl.textContent = '● LIVE';

  sessionStorage.removeItem('voice_channel_id');
sessionStorage.removeItem('voice_channel_name');
sessionStorage.removeItem('call_start_time');  // ← add this

  const authToken = localStorage.getItem('token');
  const userStr   = localStorage.getItem('user') || '{}';
  const user      = JSON.parse(userStr);

  if (!authToken) {
    privacyText.textContent = 'Not authenticated. Please log in.';
    const emptyState = document.getElementById('participantsEmpty');
    if (emptyState) emptyState.remove();
    return;
  }

  // ── 1. Build local tile first (removes the spinner) ───────────────────────
  buildLocalTile(user);

  // ── 3. Fetch LiveKit token ─────────────────────────────────────────────────
  let livekitToken, serverUrl;
  try {
    const tokenRes = await fetch('https://linksphere-5bef.onrender.com/api/calls/token', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
  roomName:        voiceChannelId,
  participantName: user.user_id,
  metadata:        JSON.stringify({ avatarUrl: user.avatar_url || null, name: user.name || 'User' }),
}),
    });

    if (!tokenRes.ok) throw new Error('Failed to get LiveKit token');
    ({ token: livekitToken, serverUrl } = await tokenRes.json());
  } catch (err) {
    console.error('Token fetch failed:', err);
    privacyText.textContent = `Failed to connect: ${err.message}`;
    showToast('Connection failed');
    return;
  }

  // ── 4. Log call start / join to Supabase ──────────────────────────────────
  //
  // Strategy:
  //   • Try POST /api/calls  (startCall) — creates a new call row + adds caller
  //     as first call_participant row.
  //   • If 409 → a call is already active in this channel. Use the returned
  //     call_id and POST /api/calls/:id/join — upserts this user into
  //     call_participant with a fresh joined_at.
  //   • Store the call_id in window._channelCallId so leaveBtn can log leave.
  //
  try {
    const startRes = await fetch('https://linksphere-5bef.onrender.com/api/calls', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        channel_id: voiceChannelId,   // ← the actual channel UUID
        call_type:  'video',
      }),
    });

    if (startRes.ok) {
      const startData = await startRes.json();
      window._channelCallId = startData.call?.call_id ?? null;
      const startTime = startData.call?.start_time ?? new Date().toISOString();
      sessionStorage.setItem('call_start_time', startTime);
      window._timerInterval = startSyncedTimer(startTime);
      console.log('[Call] Started new call:', window._channelCallId);

    } else if (startRes.status === 409) {
      const conflictData = await startRes.json();
      const existingCallId = conflictData.call_id ?? null;
      window._channelCallId = existingCallId;

      if (existingCallId) {
        const joinRes = await fetch(`https://linksphere-5bef.onrender.com/api/calls/${existingCallId}/join`, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ audio_only: false }),
        });

        if (!joinRes.ok) {
          console.warn('[Call] joinCall responded with', joinRes.status);
        } else {
          const joinData = await joinRes.json();
          const joinStartTime = joinData.call?.start_time
            ?? sessionStorage.getItem('call_start_time')
            ?? new Date().toISOString();
          sessionStorage.setItem('call_start_time', joinStartTime);
          window._timerInterval = startSyncedTimer(joinStartTime);
          console.log('[Call] Joined existing call:', existingCallId);
        }
      }

    } else {
      // Unexpected error — log it but don't block the voice connection
      console.warn('[Call] startCall responded with', startRes.status);
    }

  } catch (err) {
    // Non-fatal — user can still be in the voice channel even if DB logging fails
    console.warn('[Call] Could not log call to Supabase:', err);
  }

  // ── 5. Connect to LiveKit ──────────────────────────────────────────────────
  await connectToLiveKit({
    livekitToken,
    serverUrl,
    callType:    'video',
    channelName: voiceChannelName,
    user,
  });

})();