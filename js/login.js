const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ─── Helpers ────────────────────────────────────────────────────────────────

function showError(formEl, message) {
  let box = formEl.querySelector('.error-box');
  if (!box) {
    box = document.createElement('div');
    box.className = 'error-box';
    box.style.cssText = `
      background: #fff0f0;
      border: 1px solid #bc0100;
      color: #bc0100;
      padding: 10px 14px;
      font-size: 13px;
      margin-bottom: 16px;
      letter-spacing: 0.5px;
    `;
    formEl.prepend(box);
  }
  box.textContent = message;
  box.style.display = 'block';
}

function clearError(formEl) {
  const box = formEl.querySelector('.error-box');
  if (box) box.style.display = 'none';
}

function setLoading(btn, isLoading, originalText) {
  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'PLEASE WAIT...' : originalText;
  btn.style.opacity = isLoading ? '0.7' : '1';
}

function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

// ─── Login ────────────────────────────────────────────────────────────────────

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(loginForm);

    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn      = document.getElementById('login-btn');

    if (!email || !password) {
      showError(loginForm, 'Please fill in all fields.');
      return;
    }

    setLoading(btn, true, 'LOGIN');

    try {
      const res  = await fetch(`${API_BASE}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(loginForm, data.message || 'Login failed. Please try again.');
        return;
      }

      saveSession(data.token, data.user);
      window.location.href = '../html/interface.html';

    } catch (err) {
      showError(loginForm, 'Network error. Please check your connection.');
    } finally {
      setLoading(btn, false, 'LOGIN');
    }
  });
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

const googleBtn = document.getElementById('google-login-btn');
if (googleBtn) {
  googleBtn.addEventListener('click', async () => {
    try {
      const res  = await fetch(`${API_BASE}/auth/google`, { method: 'GET' });
      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Google login is not available right now.');
      }
    } catch (err) {
      alert('Network error. Please check your connection.');
    }
  });
}