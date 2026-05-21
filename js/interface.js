const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ── Authentication Check ───────────────────────────────────────────────────────
(function() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '../html/login.html';
  }
})();

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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

// ─── Sidebar Nav Links ────────────────────────────────────────────────────────

document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', function () {
    if (this.id === 'nav-logout' || this.id === 'nav-profile') return;
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    this.classList.add('active');
    closeSidebar();
  });
});

const navNotif = document.getElementById('nav-notif');
if (navNotif) {
  navNotif.addEventListener('click', (e) => {
    e.preventDefault();
    closeSidebar();
    setTimeout(() => { window.location.href = 'notification.html'; }, 200);
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

const navMessages = document.getElementById('nav-messages');
if (navMessages) {
  navMessages.addEventListener('click', (e) => {
    e.preventDefault();
    closeSidebar();
    setTimeout(() => { window.location.href = 'messages.html'; }, 200);
  });
}

const navProfile = document.getElementById('nav-profile');
if (navProfile) {
  navProfile.addEventListener('click', (e) => {
    e.preventDefault();
    closeSidebar();
    setTimeout(() => { window.location.href = 'profile.html'; }, 200);
  });
}

const navLogout = document.getElementById('nav-logout');
if (navLogout) {
  navLogout.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
  });
}

// ═══════════════════════════════════════════
// AUTH & USER
// ═══════════════════════════════════════════

async function loadUser() {
  const token = localStorage.getItem('token');
  const user  = JSON.parse(localStorage.getItem('user') || 'null');

  if (!token || !user) {
    window.location.href = 'login.html';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/users/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      window.location.href = 'login.html';
      return;
    }

    const data = await res.json();
    localStorage.setItem('user', JSON.stringify(data));
    updateUI(data);

  } catch (err) {
    console.error('Error loading user:', err);
    if (user) updateUI(user);
  }
}

// ═══════════════════════════════════════════
// UPDATE UI  (sidebar only)
// ═══════════════════════════════════════════

function updateUI(user) {
  const name = user.name || 'USER';

  // ─── Hero welcome message ───
  const heroH2 = document.querySelector('.hero h2');
  if (heroH2) {
    heroH2.innerHTML = `
      WELCOME BACK,<br />
      <strong>${name.toUpperCase()}.</strong><br />
      LET'S GET STARTED.
    `;
  }

  // ─── Sidebar user card ───
  const sidebarName = document.getElementById('sidebar-user-name');
  if (sidebarName) sidebarName.textContent = name.toUpperCase();

  const sidebarAvatar = document.getElementById('sidebar-avatar');
  if (sidebarAvatar) {
    if (user.avatar_url) {
      sidebarAvatar.innerHTML = `<img src="${user.avatar_url}" alt="${name}" style="width:100%;height:100%;object-fit:cover;display:block;" />`;
    } else {
      const parts = name.trim().split(' ');
      sidebarAvatar.textContent = parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : name.charAt(0).toUpperCase();
    }
  }
}

// Listen for avatar/name changes from profile.html
window.addEventListener('storage', (e) => {
  if (e.key === 'user' && e.newValue) {
    updateUI(JSON.parse(e.newValue));
  }
});

// ═══════════════════════════════════════════
// REVEAL ANIMATION
// ═══════════════════════════════════════════

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.classList.add('show');
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ═══════════════════════════════════════════
// CARD TILT EFFECT
// ═══════════════════════════════════════════

document.querySelectorAll('.action-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const rect    = card.getBoundingClientRect();
    const x       = e.clientX - rect.left;
    const y       = e.clientY - rect.top;
    const rotateX = (y - rect.height / 2) / -28;
    const rotateY = (x - rect.width  / 2) /  28;
    card.style.transform = `translateY(-8px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
});

// ═══════════════════════════════════════════
// CUSTOM MODAL
// ═══════════════════════════════════════════

function showModal({ title, label, placeholder, confirmText, onConfirm }) {
  const existing = document.getElementById('ls-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ls-modal-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0;
    background:rgba(0,0,0,0.65);
    display:flex; align-items:center; justify-content:center;
    z-index:9999;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes lsUp { from { transform:translateY(16px); opacity:0 } to { transform:translateY(0); opacity:1 } }
      #ls-modal { width:340px; background:#fff; border:2px solid #000; animation:lsUp .2s ease; font-family:'Inter',sans-serif; }
      #ls-modal-title { background:#000; color:#fff; font-size:12px; font-weight:900; letter-spacing:3px; padding:14px 18px; }
      #ls-modal-body { padding:20px 18px 16px; }
      #ls-modal-label { display:block; font-size:10px; font-weight:900; letter-spacing:2px; color:#777; margin-bottom:8px; }
      #ls-modal-input { width:100%; height:44px; border:2px solid #000; padding:0 12px; font-size:14px; font-weight:600; font-family:'Inter',sans-serif; outline:none; background:#f9f9f9; box-sizing:border-box; transition:border-color .15s; }
      #ls-modal-input:focus { background:#fff; border-color:#000; }
      #ls-modal-error { font-size:11px; font-weight:700; color:#dc2626; margin-top:6px; min-height:16px; display:block; }
      #ls-modal-actions { display:flex; border-top:2px solid #000; }
      #ls-modal-cancel { flex:1; height:48px; border:none; border-right:2px solid #000; background:#fff; font-size:11px; font-weight:900; letter-spacing:2px; cursor:pointer; font-family:'Inter',sans-serif; }
      #ls-modal-cancel:hover { background:#f0f0f0; }
      #ls-modal-confirm { flex:1; height:48px; border:none; background:#dc2626; color:#fff; font-size:11px; font-weight:900; letter-spacing:2px; cursor:pointer; font-family:'Inter',sans-serif; }
      #ls-modal-confirm:hover { background:#b91c1c; }
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
    overlay.style.transition = 'opacity .15s ease';
    setTimeout(() => overlay.remove(), 150);
  }

  function submit() {
    const value = input.value.trim();
    if (!value) {
      error.textContent = 'This field cannot be empty.';
      input.style.borderColor = '#dc2626';
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
    if (e.key === 'Escape') { close(); }
    if (e.key !== 'Enter')  { error.textContent = ''; input.style.borderColor = '#000'; }
  });
}

// ═══════════════════════════════════════════
// ACTION CARDS
// ═══════════════════════════════════════════

const createCard = document.getElementById('create-workspace-btn');
if (createCard) {
  createCard.addEventListener('click', () => {
    showModal({
      title:       'CREATE WORKSPACE',
      label:       'WORKSPACE NAME',
      placeholder: 'e.g. My Team Hub',
      confirmText: 'CREATE',
      onConfirm: (name) => {
        sessionStorage.setItem('ws_action', 'create');
        sessionStorage.setItem('ws_name', name);
        window.location.href = 'workspace.html';
      }
    });
  });
}

const joinCard = document.getElementById('join-workspace-btn');
if (joinCard) {
  joinCard.addEventListener('click', () => {
    showModal({
      title:       'JOIN WORKSPACE',
      label:       'INVITE CODE',
      placeholder: 'Enter your invite code',
      confirmText: 'JOIN',
      onConfirm: (code) => {
        sessionStorage.setItem('ws_action', 'join');
        sessionStorage.setItem('ws_code', code);
        window.location.href = 'workspace.html';
      }
    });
  });
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════

loadUser(); 