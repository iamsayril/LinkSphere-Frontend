const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ─── Auth Check & Load User ───────────────────────────────────────────────────

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

// ─── Update UI ────────────────────────────────────────────────────────────────

function updateUI(user) {
  const name = user.name || 'USER';

  // Welcome message
  const heroH2 = document.querySelector('.hero h2');
  heroH2.innerHTML = `
    WELCOME BACK,<br />
    <strong>${name.toUpperCase()}.</strong><br />
    LET'S GET STARTED.
  `;

  // Profile avatar
  const initial = document.getElementById('profile-initial');
  if (!initial) return;

  if (user.avatar_url) {
    initial.innerHTML = `<img src="${user.avatar_url}" style="
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 0%;
      display: block;
    "/>`;
  } else {
    initial.innerHTML = '';
    const parts = name.trim().split(' ');
    initial.textContent = parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.charAt(0).toUpperCase();
    initial.style.backgroundColor = '#000';
  }
}

// ─── Listen for avatar changes from profile.html ──────────────────────────────

window.addEventListener('storage', (e) => {
  if (e.key === 'user' && e.newValue) {
    const user = JSON.parse(e.newValue);
    updateUI(user);
  }
});

// ─── Reveal Animation ─────────────────────────────────────────────────────────

const revealElements = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.classList.add('show');
  });
}, { threshold: 0.15 });
revealElements.forEach(el => revealObserver.observe(el));

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

const navItems = document.querySelectorAll('.bottom-nav a');
navItems.forEach(item => {
  item.addEventListener('click', e => {
    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');
  });
});

// FIXED: was '../html/workspace.html' — both files are in html/ so no prefix needed
navItems[3].addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = 'workspace.html';
});

// ─── Card Tilt Effect ─────────────────────────────────────────────────────────

const cards = document.querySelectorAll('.action-card');
cards.forEach(card => {
  card.addEventListener('mousemove', e => {
    const rect    = card.getBoundingClientRect();
    const x       = e.clientX - rect.left;
    const y       = e.clientY - rect.top;
    const rotateX = (y - rect.height / 2) / -25;
    const rotateY = (x - rect.width / 2) / 25;
    card.style.transform = `translateY(-10px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
});

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
        width: 320px; background: #fff;
        border: 2px solid #000;
        font-family: Arial, Helvetica, sans-serif;
        animation: lsSlideUp 0.2s ease;
      }
      #ls-modal-title {
        background: #000; color: #fff;
        font-size: 13px; font-weight: 900;
        letter-spacing: 3px; padding: 14px 18px;
      }
      #ls-modal-body { padding: 20px 18px; }
      #ls-modal-label {
        display: block; font-size: 11px; font-weight: 900;
        letter-spacing: 1.5px; color: #5e5e5e; margin-bottom: 8px;
      }
      #ls-modal-input {
        width: 100%; height: 42px; border: 2px solid #000;
        padding: 0 12px; font-size: 14px; font-weight: 600;
        font-family: Arial, Helvetica, sans-serif;
        outline: none; background: #f9f9f9; box-sizing: border-box;
      }
      #ls-modal-input:focus { background: #fff; }
      #ls-modal-error {
        font-size: 11px; font-weight: 700; color: #dc2626;
        margin-top: 6px; min-height: 16px; display: block;
      }
      #ls-modal-actions { display: flex; border-top: 2px solid #000; }
      #ls-modal-cancel {
        flex: 1; height: 48px; border: none; border-right: 2px solid #000;
        background: #fff; font-size: 12px; font-weight: 900;
        letter-spacing: 2px; cursor: pointer; font-family: Arial, Helvetica, sans-serif;
      }
      #ls-modal-cancel:hover { background: #f0f0f0; }
      #ls-modal-confirm {
        flex: 1; height: 48px; border: none;
        background: #dc2626; color: #fff;
        font-size: 12px; font-weight: 900;
        letter-spacing: 2px; cursor: pointer; font-family: Arial, Helvetica, sans-serif;
      }
      #ls-modal-confirm:hover { background: #bc0100; }
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
    if (e.key === 'Escape') close();
    if (e.key !== 'Enter')  { error.textContent = ''; input.style.borderColor = '#000'; }
  });
}

// ─── Action Cards ─────────────────────────────────────────────────────────────

const [createCard, joinCard] = document.querySelectorAll('.action-card');

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

// ─── Profile Button ───────────────────────────────────────────────────────────

document.querySelector('.profile-btn').addEventListener('click', () => {
  window.location.href = 'profile.html';
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadUser();