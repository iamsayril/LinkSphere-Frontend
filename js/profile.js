const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('token');
}

function getUser() {
  return JSON.parse(localStorage.getItem('user') || 'null');
}

// ─── Avatar Helpers ───────────────────────────────────────────────────────────

function getAvatarColor(name) {
  const colors = [
    '#4f46e5', '#7c3aed', '#db2777', '#dc2626',
    '#d97706', '#059669', '#0891b2', '#0284c7'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function renderAvatar(user) {
  const img = document.getElementById('profile-avatar');
  if (user.avatar_url) {
    img.src = user.avatar_url;
  } else {
    img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'U')}&background=000000&color=fff&size=400&rounded=false`;
  }
}

// ─── Load Profile ─────────────────────────────────────────────────────────────

async function loadProfile() {
  const token = getToken();
  if (!token) { window.location.href = 'login.html'; return; }

  try {
    const res = await fetch(`${API_BASE}/users/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) { window.location.href = 'login.html'; return; }

    const data = await res.json();

    document.getElementById('profile-name').textContent  = data.name  || 'No Name';
    document.getElementById('profile-email').textContent = data.email || '';

    document.getElementById('edit-name').value  = data.name  || '';
    document.getElementById('edit-email').value = data.email || '';

    localStorage.setItem('user', JSON.stringify(data));
    renderAvatar(data);

  } catch (err) {
    console.error('Error loading profile:', err);
  }
}

// ─── Avatar Upload ────────────────────────────────────────────────────────────

const avatarOverlay  = document.getElementById('avatar-overlay');
const avatarInput    = document.getElementById('avatar-input');
const avatarStatus   = document.getElementById('avatar-status');
const avatarBox      = document.querySelector('.avatar-box');

avatarBox.addEventListener('mouseenter', () => {
  avatarOverlay.style.opacity = '1';
});
avatarBox.addEventListener('mouseleave', () => {
  avatarOverlay.style.opacity = '0';
});

avatarOverlay.addEventListener('click', (e) => {
  e.stopPropagation();
  avatarInput.click();
});

avatarBox.addEventListener('click', () => {
  avatarInput.click();
});

avatarInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    avatarStatus.style.color = '#d30000';
    avatarStatus.textContent = 'Only JPG, PNG, GIF, WEBP allowed.';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    avatarStatus.style.color = '#d30000';
    avatarStatus.textContent = 'File must be under 5MB.';
    return;
  }

  avatarStatus.style.color = '#000';
  avatarStatus.textContent = 'Uploading...';

  const token = getToken();
  const formData = new FormData();
  formData.append('avatar', file);

  try {
    const res = await fetch(`${API_BASE}/users/avatar`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      avatarStatus.style.color = '#d30000';
      avatarStatus.textContent = data.error || 'Upload failed.';
      return;
    }

    renderAvatar(data);
    localStorage.setItem('user', JSON.stringify(data));

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'user',
      newValue: JSON.stringify(data)
    }));

    avatarStatus.style.color = '#059669';
    avatarStatus.textContent = 'Avatar updated!';
    setTimeout(() => { avatarStatus.textContent = ''; }, 3000);

  } catch (err) {
    avatarStatus.style.color = '#d30000';
    avatarStatus.textContent = 'Network error. Please try again.';
  }

  avatarInput.value = '';
});

// ─── Edit Profile Modal ───────────────────────────────────────────────────────

const editModal = document.getElementById('edit-modal');
const editError = document.getElementById('edit-error');

document.getElementById('edit-profile-btn').addEventListener('click', () => {
  editModal.style.display = 'flex';
});

document.getElementById('edit-cancel-btn').addEventListener('click', () => {
  editModal.style.display = 'none';
  editError.style.display = 'none';
});

document.getElementById('edit-save-btn').addEventListener('click', async () => {
  const name  = document.getElementById('edit-name').value.trim();
  const email = document.getElementById('edit-email').value.trim();  // ← FIX: read email
  const token = getToken();

  if (!name) {
    editError.textContent   = 'Name is required.';
    editError.style.display = 'block';
    return;
  }

  if (!email) {
    editError.textContent   = 'Email is required.';
    editError.style.display = 'block';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/users/profile`, {
      method:  'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ name, email }),  // ← FIX: include email in request
    });

    const data = await res.json();

    if (!res.ok) {
      editError.textContent   = data.message || data.error || 'Failed to update profile.';
      editError.style.display = 'block';
      return;
    }

    document.getElementById('profile-name').textContent  = data.name;
    document.getElementById('profile-email').textContent = data.email;  // ← FIX: update displayed email
    localStorage.setItem('user', JSON.stringify(data));
    renderAvatar(data);
    editModal.style.display = 'none';
    editError.style.display = 'none';
    alert('Profile updated successfully!');

  } catch (err) {
    editError.textContent   = 'Network error. Please try again.';
    editError.style.display = 'block';
  }
});

// ─── Change Password Modal ────────────────────────────────────────────────────

const passwordModal = document.getElementById('password-modal');
const passwordError = document.getElementById('password-error');

document.getElementById('change-password-btn').addEventListener('click', () => {
  passwordModal.style.display = 'flex';
});

document.getElementById('password-cancel-btn').addEventListener('click', () => {
  passwordModal.style.display  = 'none';
  passwordError.style.display  = 'none';
  document.getElementById('current-password').value = '';
  document.getElementById('new-password').value     = '';
  document.getElementById('confirm-password').value = '';
});

document.getElementById('password-save-btn').addEventListener('click', async () => {
  const currentPassword = document.getElementById('current-password').value;
  const newPassword     = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  const token           = getToken();

  if (!currentPassword || !newPassword || !confirmPassword) {
    passwordError.textContent   = 'Please fill in all fields.';
    passwordError.style.display = 'block';
    return;
  }

  if (newPassword.length < 6) {
    passwordError.textContent   = 'Password must be at least 6 characters.';
    passwordError.style.display = 'block';
    return;
  }

  if (newPassword !== confirmPassword) {
    passwordError.textContent   = 'Passwords do not match.';
    passwordError.style.display = 'block';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/users/password`, {
      method:  'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });

    const data = await res.json();

    if (!res.ok) {
      passwordError.textContent   = data.message || data.error || 'Failed to change password.';
      passwordError.style.display = 'block';
      return;
    }

    passwordModal.style.display  = 'none';
    passwordError.style.display  = 'none';
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value     = '';
    document.getElementById('confirm-password').value = '';
    alert('Password changed successfully!');

  } catch (err) {
    passwordError.textContent   = 'Network error. Please try again.';
    passwordError.style.display = 'block';
  }
});

// ─── Reveal Animation ─────────────────────────────────────────────────────────

const revealItems = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('show');
    });
  },
  { threshold: 0.15 }
);
revealItems.forEach(item => revealObserver.observe(item));

// ─── Theme Toggle ─────────────────────────────────────────────────────────────

const themeButtons = document.querySelectorAll('.theme-toggle button');
themeButtons.forEach(button => {
  button.addEventListener('click', () => {
    themeButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    if (button.dataset.theme === 'dark') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

document.querySelector('.logout-btn').addEventListener('click', () => {
  const confirmLogout = confirm('Are you sure you want to logout?');
  if (confirmLogout) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '../html/login.html';
  }
});

// ─── Delete Account ───────────────────────────────────────────────────────────

document.querySelector('.delete-btn').addEventListener('click', async () => {
  const confirmDelete = confirm('Are you sure? This will permanently delete your account.');
  if (!confirmDelete) return;

  const password = prompt('Enter your password to confirm deletion:');
  if (!password) return;

  const token = getToken();

  try {
    const res = await fetch(`${API_BASE}/users/profile`, {
      method:  'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.message || data.error || 'Failed to delete account.');
      return;
    }

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    alert('Account deleted successfully.');
    window.location.href = '../html/login.html';

  } catch (err) {
    alert('Network error. Please try again.');
  }
});

// ─── Back Button ──────────────────────────────────────────────────────────────

document.querySelector('.back-btn').addEventListener('click', () => {
  window.history.back();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadProfile();