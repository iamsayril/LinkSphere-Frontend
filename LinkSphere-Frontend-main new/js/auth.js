// ─── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://gheoghkgtiftjqyecfei.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qL-End-7Yfwav2bMtrqYTw__eU2JPlK';
const API_BASE     = 'https://linksphere-5bef.onrender.com/api';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Backend Session Exchange ─────────────────────────────────────────────────

async function exchangeToken(access_token) {
  const res = await fetch(`${API_BASE}/auth/session`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ access_token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Session exchange failed');
  localStorage.setItem('token', data.token);
  localStorage.setItem('user',  JSON.stringify(data.user));
  return data;
}

// ─── Auth Helpers ──────────────────────────────────────────────────────────

async function requireAuth() {
  const session = await checkAuth();
  if (!session) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

async function initAuth() {
  const session = await checkAuth();
  if (!session) {
    window.location.href = 'login.html';
  }
  return session;
}

async function redirectIfAuthenticated() {
  const session = await checkAuth();
  if (session) {
    window.location.href = 'interface.html';
  }
}

async function checkAuth() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data?.session) return null;
    return data.session;
  } catch (error) {
    console.error('Error checking auth:', error);
    return null;
  }
}

async function getCurrentUser() {
  try {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error || !data?.user) return null;
    return data.user;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

async function handleLogout() {
  try {
    localStorage.removeItem('pending_email');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  } catch (error) {
    console.error('Error logging out:', error);
    alert('Error logging out');
  }
}

// ─── UI Helpers ────────────────────────────────────────────────────────────

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

function showSuccess(formEl, message) {
  clearError(formEl);
  let box = formEl.querySelector('.success-box');
  if (!box) {
    box = document.createElement('div');
    box.className = 'success-box';
    box.style.cssText = `
      background: #f0fff4;
      border: 1px solid #16a34a;
      color: #15803d;
      padding: 14px 16px;
      font-size: 13px;
      margin-bottom: 16px;
      letter-spacing: 0.5px;
      line-height: 1.6;
    `;
    formEl.prepend(box);
  }
  box.innerHTML = message;
  box.style.display = 'block';
}

function clearError(formEl) {
  const box = formEl.querySelector('.error-box');
  if (box) box.style.display = 'none';
}

function setLoading(btn, isLoading, originalText) {
  btn.disabled      = isLoading;
  btn.textContent   = isLoading ? 'PLEASE WAIT...' : originalText;
  btn.style.opacity = isLoading ? '0.7' : '1';
  btn.style.cursor  = isLoading ? 'not-allowed' : 'pointer';
}

// ─── Sign Up ────────────────────────────────────────────────────────────────

const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(signupForm);

    const name     = document.getElementById('signup-name').value.trim();
    const email    = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const btn      = document.getElementById('signup-btn');

    if (!name || !email || !password) {
      showError(signupForm, 'Please fill in all fields.');
      return;
    }

    if (password.length < 6) {
      showError(signupForm, 'Password must be at least 6 characters.');
      return;
    }

    setLoading(btn, true, 'SIGN UP');

    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${window.location.origin}/html/login.html`,
        },
      });

      if (error) {
        showError(signupForm, error.message || 'Registration failed. Please try again.');
        return;
      }

      // Insert user into user table
      if (data.user) {
        const { error: insertError } = await supabaseClient
          .from('user')
          .insert([{
            user_id:    data.user.id,
            email,
            name,
            status:     'pending',
            created_at: new Date().toISOString(),
          }]);

        if (insertError) {
          console.error('Insert error:', insertError);
          showError(signupForm, `Insert failed: ${insertError.message}`);
          return;
        }
      }

      // ✅ If session exists (email confirm disabled), exchange for backend JWT
      if (data.session) {
        try {
          await exchangeToken(data.session.access_token);
          window.location.href = 'interface.html';
          return;
        } catch (err) {
          console.error('Token exchange error:', err);
        }
      }

      // Email confirmation required
      localStorage.setItem('pending_email', email);
      showSuccess(
        signupForm,
        `<strong>Almost there!</strong><br>
         We sent a confirmation email to <strong>${email}</strong>.<br>
         Click the <em>"Confirm your email"</em> link in that email,<br>
         then return to log in.`
      );

      signupForm.querySelectorAll('input, button[type="submit"]')
        .forEach(el => (el.disabled = true));

    } catch (err) {
      console.error('Signup error:', err);
      showError(signupForm, 'Network error. Please check your connection.');
    } finally {
      setLoading(btn, false, 'SIGN UP');
    }
  });
}

// ─── Login ──────────────────────────────────────────────────────────────────

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
      // Step 1: Supabase login
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        showError(loginForm, error.message || 'Login failed. Please try again.');
        return;
      }

      // Step 2: ✅ Exchange Supabase token for backend JWT
      await exchangeToken(data.session.access_token);

      localStorage.removeItem('pending_email');
      window.location.href = 'interface.html';

    } catch (err) {
      console.error('Login error:', err);
      showError(loginForm, 'Network error. Please check your connection.');
    } finally {
      setLoading(btn, false, 'LOGIN');
    }
  });
}

// ─── Google OAuth ──────────────────────────────────────────────────────────

const googleSignupBtn = document.getElementById('google-signup-btn');
if (googleSignupBtn) {
  googleSignupBtn.addEventListener('click', async () => {
    try {
      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/html/interface.html`,
        },
      });
      if (error) alert('Google login error: ' + error.message);
    } catch (err) {
      alert('Network error. Please check your connection.');
    }
  });
}

const googleLoginBtn = document.getElementById('google-login-btn');
if (googleLoginBtn) {
  googleLoginBtn.addEventListener('click', async () => {
    try {
      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/html/interface.html`,
        },
      });
      if (error) alert('Google login error: ' + error.message);
    } catch (err) {
      alert('Network error. Please check your connection.');
    }
  });
}