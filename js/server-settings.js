const API_BASE = 'https://linksphere-5bef.onrender.com/api';

// ── Authentication Check ───────────────────────────────────────────────────────
(function() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '../html/login.html';
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const toast           = document.getElementById('toast');
  const saveBtn         = document.getElementById('saveBtn');
  const deleteBtn       = document.querySelector('.delete-btn');
  const nameInput       = document.getElementById('workspaceName');
  const workspaceDesc   = document.getElementById('workspaceDesc');
  const codeEl          = document.getElementById('inviteCode');
  const hintEl          = document.getElementById('inviteHint');
  const copyBtn         = document.getElementById('copyBtn');
  const regenBtn        = document.getElementById('regenBtn');

  // Icon upload refs
  const avatarBtn         = document.getElementById('avatarBtn');
  const avatarInner       = document.getElementById('avatarInner');
  const avatarInitial     = document.getElementById('avatarInitial');
  const heroIconLabel     = document.getElementById('heroIconLabel');
  const iconFileInput     = document.getElementById('iconFileInput');
  const iconUploadStatus  = document.getElementById('iconUploadStatus');
  const iconUploadFill    = document.getElementById('iconUploadFill');
  const iconUploadMsg     = document.getElementById('iconUploadMsg');
  const removeIconBtn     = document.getElementById('removeIconBtn');

  // ── State ─────────────────────────────────────────────────────────────────
  let currentWorkspace  = null;
  let pendingIconFile   = null;
  let currentIconUrl    = null;
  let toastTimeout      = null;

  // ── Toast helper ──────────────────────────────────────────────────────────
  function showToast(msg) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  function getToken() { return localStorage.getItem('token'); }
  function getUser()  { return JSON.parse(localStorage.getItem('user') || 'null'); }
  function getWorkspaceId() { return sessionStorage.getItem('settings_ws_id') || null; }

  // ── XSS guard ─────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

  // =========================================================================
  // ── AUDIT LOG NAVIGATION ──────────────────────────────────────────────────
  // =========================================================================

  // Find the Audit Log menu row by its text content and wire up navigation.
  // Stores the current workspace ID in sessionStorage so audit-log.js can
  // pre-select the right workspace on load.
  const auditLogBtn = Array.from(document.querySelectorAll('.menu-row'))
    .find(btn => btn.textContent.trim().toUpperCase().includes('AUDIT LOG'));

  if (auditLogBtn) {
    auditLogBtn.addEventListener('click', () => {
      const wsId = getWorkspaceId();
      if (wsId) sessionStorage.setItem('audit_ws_id', wsId);
      window.location.href = '../html/audit-log.html';
    });
  }

  // =========================================================================
  // ── WORKSPACE ICON LOGIC ──────────────────────────────────────────────────
  // =========================================================================

  function renderAvatar(name, iconUrl) {
    currentIconUrl = iconUrl || null;

    if (iconUrl) {
      avatarInner.innerHTML = `<img src="${escapeHtml(iconUrl)}" alt="${escapeHtml(name || 'Workspace icon')}" />`;
      heroIconLabel.textContent = 'Change Icon';
      removeIconBtn.style.display = 'flex';
    } else {
      const initial = (name || '?').charAt(0).toUpperCase();
      avatarInner.innerHTML = `<span class="avatar-initial" id="avatarInitial">${escapeHtml(initial)}</span>`;
      heroIconLabel.textContent = 'Upload Icon';
      removeIconBtn.style.display = 'none';
    }
  }

  function setUploadStatus(visible, msg = '', progress = 0, type = '') {
    iconUploadStatus.style.display = visible ? 'flex' : 'none';
    if (!visible) return;
    iconUploadFill.style.width = `${progress}%`;
    iconUploadMsg.textContent  = msg;
    iconUploadMsg.className    = `icon-upload-msg${type ? ' ' + type : ''}`;
  }

  avatarBtn.addEventListener('click', () => {
    iconFileInput.value = '';
    iconFileInput.click();
  });

  // File selected — validate and preview locally only; upload happens on Save
  iconFileInput.addEventListener('change', () => {
    const file = iconFileInput.files[0];
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showToast('UNSUPPORTED FORMAT — USE JPG, PNG, GIF OR WEBP');
      return;
    }

    const maxMb = 8;
    if (file.size > maxMb * 1024 * 1024) {
      showToast(`IMAGE TOO LARGE — MAX ${maxMb}MB`);
      return;
    }

    pendingIconFile = file;
    const objectUrl = URL.createObjectURL(file);
    avatarInner.innerHTML = `<img src="${objectUrl}" alt="Preview" />`;
    heroIconLabel.textContent = 'Icon ready — save to apply';
    removeIconBtn.style.display = 'none';
    setUploadStatus(true, 'Image selected — click Save Changes to apply', 100, 'pending');
    showToast('IMAGE SELECTED — CLICK SAVE CHANGES');
  });

  // Remove icon button
  removeIconBtn.addEventListener('click', async () => {
    const wsId  = getWorkspaceId();
    const token = getToken();
    if (!wsId || !token) return;

    removeIconBtn.disabled = true;
    removeIconBtn.textContent = 'Removing…';

    try {
      // Use FormData with empty/null to clear icon via icon endpoint
      const formData = new FormData();
      formData.append('icon', new Blob(), ''); // Send empty blob

      const res = await fetch(`${API_BASE}/workspaces/${wsId}/icon`, {
        method:  'PATCH',
        headers: { 'Authorization': `Bearer ${token}` },
        body:    formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      // Fully delete the icon
      currentIconUrl = null;
      pendingIconFile = null;
      
      // Update UI to show icon removed
      renderAvatar(nameInput.value || currentWorkspace?.name || '', null);
      if (currentWorkspace) currentWorkspace.icon_url = null;

      try {
        window.dispatchEvent(new CustomEvent('workspace:icon_updated', {
          detail: { workspaceId: wsId, iconUrl: null },
        }));
      } catch (_) {}

      showToast('WORKSPACE ICON REMOVED');

    } catch (err) {
      console.error('Remove icon error:', err);
      showToast('COULD NOT REMOVE ICON');
    } finally {
      removeIconBtn.disabled = false;
      removeIconBtn.textContent = '';
      removeIconBtn.innerHTML = '<i data-lucide="trash-2"></i> Remove Icon';
      lucide.createIcons();
    }
  });

  // =========================================================================
  // ── LOAD WORKSPACE INFO ───────────────────────────────────────────────────
  // =========================================================================

  async function loadWorkspaceInfo() {
    const token = getToken();
    const wsId  = getWorkspaceId();
    if (!token) return;

    try {
      let ws = null;

      if (wsId) {
        const res = await fetch(`${API_BASE}/workspaces/${wsId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) ws = await res.json();
      }

      if (!ws) {
        const res  = await fetch(`${API_BASE}/workspaces`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data) && data.length) {
          ws = wsId ? (data.find(w => w.workspace_id === wsId) || data[0]) : data[0];
          if (ws?.workspace_id) sessionStorage.setItem('settings_ws_id', ws.workspace_id);
        }
      }

      if (!ws) return;

      currentWorkspace = ws;
      nameInput.value = (ws.name || '').toUpperCase();

      if (workspaceDesc) {
        workspaceDesc.textContent = ws.description || ws.desc || `#${(ws.name || 'workspace').toLowerCase()}`;
      }

      renderAvatar(ws.name, ws.icon_url || null);

    } catch (err) {
      console.error('loadWorkspaceInfo error:', err);
    }
  }

  // =========================================================================
  // ── SAVE CHANGES ─────────────────────────────────────────────────────────
  // =========================================================================

  saveBtn.addEventListener('click', async () => {
    const token = getToken();
    const wsId  = getWorkspaceId();
    const name  = nameInput.value.trim();

    if (!name) { showToast('WORKSPACE NAME CANNOT BE EMPTY'); return; }
    if (!token) { showToast('NOT AUTHENTICATED — PLEASE LOG IN'); return; }
    if (!wsId) { showToast('NO WORKSPACE SELECTED'); return; }

    saveBtn.textContent = 'Saving…';
    saveBtn.disabled = true;
    saveBtn.style.pointerEvents = 'none';

    let iconUploaded = false;
    let nameUpdated = false;

    try {
      // 1. Upload pending icon if one was selected
      if (pendingIconFile) {
        setUploadStatus(true, 'Uploading icon…', 30);
        const formData = new FormData();
        formData.append('icon', pendingIconFile);

        const iconRes = await fetch(`${API_BASE}/workspaces/${wsId}/icon`, {
          method:  'PATCH',
          headers: { 'Authorization': `Bearer ${token}` },
          body:    formData,
        });

        setUploadStatus(true, 'Processing…', 70);

        if (!iconRes.ok) {
          const data = await iconRes.json().catch(() => ({}));
          throw new Error(data.error || `Icon upload failed (${iconRes.status})`);
        }

        const iconData = await iconRes.json();
        const newUrl =
          iconData.icon_url ||
          iconData.url      ||
          iconData.workspace?.icon_url ||
          null;

        currentIconUrl  = newUrl || currentIconUrl;
        pendingIconFile = null;
        renderAvatar(name, currentIconUrl);
        setUploadStatus(true, 'Icon saved!', 100, 'success');
        iconUploaded = true;

        try {
          window.dispatchEvent(new CustomEvent('workspace:icon_updated', {
            detail: { workspaceId: wsId, iconUrl: currentIconUrl },
          }));
        } catch (_) {}

        setTimeout(() => setUploadStatus(false), 1500);
      }

      // 2. Save workspace name
      const nameRes = await fetch(`${API_BASE}/workspaces/${wsId}`, {
        method:  'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!nameRes.ok) {
        const data = await nameRes.json().catch(() => ({}));
        throw new Error(data.error || `Name save failed (${nameRes.status})`);
      }

      // 3. Update local state
      if (currentWorkspace) currentWorkspace.name = name;
      if (workspaceDesc) workspaceDesc.textContent = `#${name.toLowerCase()}`;
      if (!currentIconUrl) renderAvatar(name, null);
      nameUpdated = true;

      try {
        window.dispatchEvent(new CustomEvent('workspace:name_updated', {
          detail: { workspaceId: wsId, name },
        }));
      } catch (_) {}

      // 4. Success feedback
      saveBtn.textContent = '✓ Saved';
      saveBtn.classList.add('save-success');
      showToast('CHANGES SAVED SUCCESSFULLY');
      
      setTimeout(() => {
        saveBtn.textContent = 'Save Changes';
        saveBtn.classList.remove('save-success');
      }, 2000);

    } catch (err) {
      console.error('saveBtn error:', err);
      const errorMsg = err.message || 'COULD NOT SAVE CHANGES';
      // Filter out confusing backend errors
      const userMsg = errorMsg.includes('userid') ? 'SESSION EXPIRED — PLEASE LOG IN AGAIN' : errorMsg;
      showToast(userMsg);
      renderAvatar(nameInput.value || currentWorkspace?.name || '', currentIconUrl);
      setUploadStatus(false);
      saveBtn.textContent = 'Save Changes';
    } finally {
      saveBtn.disabled = false;
      saveBtn.style.pointerEvents = '';
    }
  });

  // =========================================================================
  // ── TAB SWITCHING ─────────────────────────────────────────────────────────
  // =========================================================================

  const settingsView = document.getElementById('settings-view');
  const membersView  = document.getElementById('members-view');
  const topbarTitle  = document.getElementById('topbar-title');
  const burgerBtn    = document.getElementById('burgerBtn');
  const burgerMenu   = document.getElementById('burgerMenu');
  const menuItems    = document.querySelectorAll('.burger-menu-item');

  // Burger menu toggle
  burgerBtn.addEventListener('click', () => {
    const isVisible = burgerMenu.style.display !== 'none';
    burgerMenu.style.display = isVisible ? 'none' : '';
  });

  // Close burger menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!burgerBtn.contains(e.target) && !burgerMenu.contains(e.target)) {
      burgerMenu.style.display = 'none';
    }
  });

  function switchTab(tab) {
    menuItems.forEach(item => item.classList.toggle('selected', item.dataset.tab === tab));
    burgerMenu.style.display = 'none';

    if (tab === 'members') {
      settingsView.style.display = 'none';
      membersView.style.display  = '';
      topbarTitle.textContent    = 'Members';
      saveBtn.style.visibility   = 'hidden';
      loadMembers();
    } else if (tab === 'settings') {
      settingsView.style.display = '';
      membersView.style.display  = 'none';
      topbarTitle.textContent    = 'Workspace Settings';
      saveBtn.style.visibility   = 'visible';
    }
  }

  menuItems.forEach(item => item.addEventListener('click', () => switchTab(item.dataset.tab)));

  // Set initial tab to settings
  switchTab('settings');

  // =========================================================================
  // ── INVITE CODE ───────────────────────────────────────────────────────────
  // =========================================================================

  async function loadInviteCode() {
    const token = getToken();
    const wsId  = getWorkspaceId();
    if (!token) { setHint('Not logged in.', true); return; }

    codeEl.textContent = '––––––––';
    codeEl.classList.add('loading');
    setHint('Loading invite code…', false);

    try {
      let code = null;

      if (wsId) {
        const res = await fetch(`${API_BASE}/workspaces/${wsId}/invite`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          code = data.invite_code || data.code || null;
        }
      }

      if (!code) {
        const res  = await fetch(`${API_BASE}/workspaces`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data) && data.length) {
          const ws = wsId ? data.find(w => w.workspace_id === wsId) || data[0] : data[0];
          code = ws.invite_code || ws.code || null;
          if (ws.workspace_id) sessionStorage.setItem('settings_ws_id', ws.workspace_id);
        }
      }

      codeEl.classList.remove('loading');

      if (code) {
        codeEl.textContent = code.toUpperCase();
        setHint('Anyone with this code can join your workspace.', false);
      } else {
        codeEl.textContent = 'N/A';
        setHint('Invite codes not supported by server.', true);
      }

    } catch (err) {
      codeEl.classList.remove('loading');
      codeEl.textContent = 'ERROR';
      setHint('Could not load invite code. Check connection.', true);
      console.error('Invite code error:', err);
    }
  }

  async function regenInviteCode() {
    const token = getToken();
    const wsId  = getWorkspaceId();
    if (!token || !wsId) { setHint('Cannot regenerate: no workspace found.', true); return; }

    regenBtn.classList.add('spinning');
    setHint('Generating new code…', false);

    try {
      const res = await fetch(`${API_BASE}/workspaces/${wsId}/invite/regenerate`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });

      regenBtn.classList.remove('spinning');

      if (res.ok) {
        const data = await res.json();
        const code = data.invite_code || data.code || null;
        if (code) {
          codeEl.textContent = code.toUpperCase();
          codeEl.classList.remove('copied');
          setHint('New code generated. Old code is now invalid.', false);
          showToast('New invite code generated');
        } else {
          setHint('Regenerated, but no code returned.', true);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setHint(data.error || 'Failed to regenerate code.', true);
      }

    } catch (err) {
      regenBtn.classList.remove('spinning');
      setHint('Could not regenerate. Check connection.', true);
      console.error('Regen error:', err);
    }
  }

  async function copyCode() {
    const code = codeEl.textContent.trim();
    if (!code || code === '––––––––' || code === 'N/A' || code === 'ERROR') return;

    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }

    codeEl.classList.add('copied');
    copyBtn.classList.add('copied');
    setHint('Copied to clipboard!', false);
    showToast('Invite code copied');

    setTimeout(() => {
      codeEl.classList.remove('copied');
      copyBtn.classList.remove('copied');
      setHint('Anyone with this code can join your workspace.', false);
    }, 2000);
  }

  function setHint(text, isError) {
    hintEl.textContent = text;
    hintEl.classList.toggle('error', isError);
  }

  copyBtn.addEventListener('click', copyCode);
  regenBtn.addEventListener('click', regenInviteCode);

  // =========================================================================
  // ── MEMBERS ───────────────────────────────────────────────────────────────
  // =========================================================================

  let membersCache = null;

  async function loadMembers() {
    if (membersCache) { renderMembers(membersCache.members, membersCache.myRole); return; }

    const token = getToken();
    const wsId  = getWorkspaceId();
    const list  = document.getElementById('members-list');
    const count = document.getElementById('membersCount');

    if (!token || !wsId) {
      list.innerHTML = '<p class="members-empty">No workspace selected.</p>';
      return;
    }

    list.innerHTML = '<div class="spinner-wrap"><div class="members-spinner"></div></div>';

    try {
      const res  = await fetch(`${API_BASE}/workspaces/${wsId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) {
        list.innerHTML = `<p class="members-empty">⚠ ${escapeHtml(data.error || 'Failed to load members.')}</p>`;
        return;
      }

      const me     = getUser();
      const myself = data.find(m => m.user_id === me?.user_id);
      const myRole = myself?.role || 'member';

      membersCache = { members: data, myRole };
      count.textContent = data.length;
      renderMembers(data, myRole);

    } catch (err) {
      list.innerHTML = '<p class="members-empty">Could not reach server.</p>';
      console.error('Members error:', err);
    }
  }

  function renderMembers(members, myRole) {
    const me   = getUser();
    const list = document.getElementById('members-list');

    const order = { owner: 0, admin: 1, member: 2 };
    const sorted = [...members].sort((a, b) =>
      (order[a.role] ?? 3) - (order[b.role] ?? 3) ||
      (a.name || '').localeCompare(b.name || '')
    );

    list.innerHTML = '';

    sorted.forEach((m, i) => {
      const isMe     = me && m.user_id === me.user_id;
      const isOwner  = m.role === 'owner';
      const joinDate = m.join_at
        ? new Date(m.join_at).toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }).toUpperCase()
        : '—';

      const row = document.createElement('div');
      row.className      = 'member-row';
      row.dataset.userId = m.user_id;
      row.dataset.role   = m.role;
      row.style.animationDelay = `${i * 0.04}s`;

      const avatarHtml = m.avatar_url
        ? `<div class="member-avatar"><img src="${escapeHtml(m.avatar_url)}" alt="${escapeHtml(m.name || '')}" /></div>`
        : `<div class="member-avatar">${escapeHtml((m.name || '?').charAt(0).toUpperCase())}</div>`;

      row.innerHTML = `
        ${avatarHtml}
        <div class="member-info">
          <div class="member-name">
            ${escapeHtml(m.name || 'Unknown')}
            ${isMe ? '<span class="member-you">YOU</span>' : ''}
          </div>
          <div class="member-meta">${escapeHtml(m.email || '')} · JOINED ${joinDate}</div>
        </div>
      `;

      const controls = document.createElement('div');
      controls.className = 'member-controls';

      if (!isMe && !isOwner) {
        if (myRole === 'owner') {
          const select = document.createElement('select');
          select.className = 'role-select';
          select.innerHTML = `
            <option value="admin"  ${m.role === 'admin'  ? 'selected' : ''}>ADMIN</option>
            <option value="member" ${m.role === 'member' ? 'selected' : ''}>MEMBER</option>
          `;
          select.addEventListener('change', () => changeRole(m.user_id, select.value, select));
          controls.appendChild(select);
        } else {
          const badge = document.createElement('span');
          badge.className   = `member-badge member-badge--${m.role}`;
          badge.textContent = m.role.toUpperCase();
          controls.appendChild(badge);
        }

        if (myRole === 'owner' || myRole === 'admin') {
          const kickBtn = document.createElement('button');
          kickBtn.className = 'kick-btn';
          kickBtn.title     = 'Remove member';
          kickBtn.innerHTML = '<i data-lucide="user-x"></i>';
          kickBtn.addEventListener('click', () => confirmKick(kickBtn, m.user_id, m.name));
          controls.appendChild(kickBtn);
        }

      } else {
        const badge = document.createElement('span');
        badge.className   = `member-badge member-badge--${m.role}`;
        badge.textContent = m.role.toUpperCase();
        controls.appendChild(badge);
      }

      row.appendChild(controls);
      list.appendChild(row);
    });

    lucide.createIcons();
  }

  async function changeRole(userId, newRole, selectEl) {
    const token = getToken();
    const wsId  = getWorkspaceId();
    if (!token || !wsId) return;

    selectEl.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/workspaces/${wsId}/members/${userId}`, {
        method:  'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ role: newRole }),
      });

      if (res.ok) {
        if (membersCache) {
          const m = membersCache.members.find(m => m.user_id === userId);
          if (m) m.role = newRole;
        }
        showToast(`ROLE UPDATED TO ${newRole.toUpperCase()}`);
        selectEl.classList.add('role-saved');
        setTimeout(() => selectEl.classList.remove('role-saved'), 1200);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'FAILED TO UPDATE ROLE');
        const cached = membersCache?.members.find(m => m.user_id === userId);
        if (cached) selectEl.value = cached.role;
      }

    } catch (err) {
      showToast('COULD NOT REACH SERVER');
      console.error('changeRole error:', err);
    } finally {
      selectEl.disabled = false;
    }
  }

  let armedKick = null;

  function confirmKick(btn, userId, name) {
    if (armedKick && armedKick.userId === userId) {
      clearTimeout(armedKick.timer);
      armedKick = null;
      kickMember(btn, userId, name);
      return;
    }

    if (armedKick) {
      armedKick.btn.classList.remove('armed');
      clearTimeout(armedKick.timer);
    }

    btn.classList.add('armed');
    btn.animate(
      [{ transform:'translateX(0)' },{ transform:'translateX(-5px)' },
       { transform:'translateX(5px)' },{ transform:'translateX(0)' }],
      { duration:300, easing:'ease-in-out' }
    );

    const timer = setTimeout(() => {
      btn.classList.remove('armed');
      armedKick = null;
    }, 3000);

    armedKick = { btn, userId, timer };
  }

  async function kickMember(btn, userId, name) {
    const token = getToken();
    const wsId  = getWorkspaceId();
    if (!token || !wsId) return;

    btn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/workspaces/${wsId}/members/${userId}`, {
        method:  'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        if (membersCache) {
          membersCache.members = membersCache.members.filter(m => m.user_id !== userId);
          document.getElementById('membersCount').textContent = membersCache.members.length;
        }
        const row = document.querySelector(`.member-row[data-user-id="${userId}"]`);
        if (row) {
          row.style.transition = 'opacity .25s, transform .25s';
          row.style.opacity    = '0';
          row.style.transform  = 'translateX(20px)';
          setTimeout(() => row.remove(), 260);
        }
        showToast(`${(name || 'MEMBER').toUpperCase()} REMOVED`);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'FAILED TO REMOVE MEMBER');
        btn.disabled = false;
      }

    } catch (err) {
      showToast('COULD NOT REACH SERVER');
      btn.disabled = false;
      console.error('kickMember error:', err);
    }
  }

  document.addEventListener('click', (e) => {
    if (armedKick && !armedKick.btn.contains(e.target)) {
      armedKick.btn.classList.remove('armed');
      clearTimeout(armedKick.timer);
      armedKick = null;
    }
  });

  // =========================================================================
  // ── DELETE WORKSPACE ──────────────────────────────────────────────────────
  // =========================================================================

  function showDeleteConfirmation() {
    const existing = document.getElementById('delete-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'delete-confirm-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.6);
      display:flex;align-items:center;justify-content:center;z-index:10000;
    `;

    overlay.innerHTML = `
      <style>
        @keyframes slideUp { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
        #dcm { width:360px;background:#fff;border:2px solid #111;font-family:Inter,sans-serif;animation:slideUp .2s ease; }
        #dcm-h { background:#cc1414;color:#fff;font-size:13px;font-weight:900;letter-spacing:.15em;padding:16px 20px;text-transform:uppercase; }
        #dcm-b { padding:24px 20px;font-size:14px;color:#333;line-height:1.6; }
        #dcm-b p { margin:0 0 16px; }
        #dcm-a { display:flex;border-top:2px solid #111; }
        .dcm-cancel { flex:1;height:48px;border:none;border-right:2px solid #111;background:#f4f4f4;font-size:12px;font-weight:700;letter-spacing:.12em;cursor:pointer;text-transform:uppercase;font-family:Inter,sans-serif;transition:background .15s; }
        .dcm-cancel:hover { background:#e0e0e0; }
        .dcm-delete { flex:1;height:48px;border:none;background:#cc1414;color:#fff;font-size:12px;font-weight:700;letter-spacing:.12em;cursor:pointer;text-transform:uppercase;font-family:Inter,sans-serif;transition:background .15s; }
        .dcm-delete:hover { background:#a00f0f; }
        .dcm-delete:disabled { background:#999;cursor:not-allowed; }
      </style>
      <div id="dcm">
        <div id="dcm-h">DELETE WORKSPACE</div>
        <div id="dcm-b">
          <p>Are you sure you want to delete this workspace?</p>
          <p><strong>This action cannot be undone.</strong> All channels, messages, and members will be permanently deleted.</p>
        </div>
        <div id="dcm-a">
          <button class="dcm-cancel">CANCEL</button>
          <button class="dcm-delete">DELETE WORKSPACE</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cancelBtn  = overlay.querySelector('.dcm-cancel');
    const confirmBtn = overlay.querySelector('.dcm-delete');

    function close() {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity .15s ease';
      setTimeout(() => overlay.remove(), 150);
    }

    cancelBtn.addEventListener('click', close);
    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled    = true;
      confirmBtn.textContent = 'DELETING...';
      deleteWorkspace(confirmBtn, close);
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    setTimeout(() => confirmBtn.focus(), 100);
  }

  async function deleteWorkspace(btn, closeModal) {
    const token = getToken();
    const wsId  = getWorkspaceId();

    if (!token || !wsId) {
      showToast('ERROR: Workspace not found');
      btn.disabled = false;
      btn.textContent = 'DELETE WORKSPACE';
      return;
    }

    const step = (msg) => { btn.textContent = msg; };

    try {
      step('LOADING CHANNELS...');
      const chRes  = await fetch(`${API_BASE}/channels?workspace_id=${wsId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      const channels = chRes.ok ? await chRes.json() : [];

      step('DELETING MESSAGES...');
      for (const ch of channels) {
        const mRes = await fetch(`${API_BASE}/channels/${ch.channel_id}/messages`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null);
        if (mRes?.ok) {
          const msgs = await mRes.json();
          for (const msg of msgs) {
            await fetch(`${API_BASE}/channels/${ch.channel_id}/messages/${msg.message_id}`, { method:'DELETE', headers:{ 'Authorization':`Bearer ${token}` } }).catch(()=>{});
          }
        }
      }

      step('DELETING CHANNELS...');
      for (const ch of channels) {
        await fetch(`${API_BASE}/channels/${ch.channel_id}`, { method:'DELETE', headers:{ 'Authorization':`Bearer ${token}` } }).catch(()=>{});
      }

      step('DELETING WORKSPACE...');
      const res = await fetch(`${API_BASE}/workspaces/${wsId}`, { method:'DELETE', headers:{ 'Authorization':`Bearer ${token}` } });

      if (res.ok) {
        closeModal();
        showToast('WORKSPACE DELETED');
        sessionStorage.removeItem('settings_ws_id');
        setTimeout(() => { window.location.href = '../html/workspace.html'; }, 800);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'FAILED TO DELETE WORKSPACE');
        btn.disabled = false;
        btn.textContent = 'DELETE WORKSPACE';
      }

    } catch (err) {
      console.error('deleteWorkspace error:', err);
      showToast('COULD NOT REACH SERVER');
      btn.disabled = false;
      btn.textContent = 'DELETE WORKSPACE';
    }
  }

  deleteBtn.addEventListener('click', showDeleteConfirmation);

  // =========================================================================
  // ── RIPPLE ────────────────────────────────────────────────────────────────
  // =========================================================================

  document.querySelectorAll('[data-ripple]').forEach((button) => {
    button.style.position = 'relative';
    button.style.overflow = 'hidden';
    button.addEventListener('click', (event) => {
      const rect   = button.getBoundingClientRect();
      const circle = document.createElement('span');
      const size   = Math.max(rect.width, rect.height);
      circle.className    = 'ripple';
      circle.style.width  = circle.style.height = `${size}px`;
      circle.style.left   = `${event.clientX - rect.left - size / 2}px`;
      circle.style.top    = `${event.clientY - rect.top  - size / 2}px`;
      button.appendChild(circle);
      circle.addEventListener('animationend', () => circle.remove());
    });
  });

  // =========================================================================
  // ── INIT ──────────────────────────────────────────────────────────────────
  // =========================================================================

  loadWorkspaceInfo();
  loadInviteCode();

  // Auto-open tab if coming from workspace
  const openTab = sessionStorage.getItem('settings_open_tab');
  if (openTab) {
    sessionStorage.removeItem('settings_open_tab');
    const tabBtn = document.querySelector(`[data-tab="${openTab}"]`);
    if (tabBtn) tabBtn.click();
  }
});