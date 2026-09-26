function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderShell({ user, activeView, content, csrfToken }) {
  const isNav = (v) => activeView === v ? 'active' : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>ARIA Operator Workspace</title>
  <link rel="stylesheet" href="/dashboard/styles/dashboard.css">
</head>
<body>
  <div class="aria-app">
    <!-- Sidebar Navigation -->
    <aside class="aria-sidebar">
      <div class="aria-brand">
        <img class="aria-brand-mark" src="/aria-mark.png" alt="ARIA Symbol">
        <div>
          <div class="aria-brand-title">ARIA</div>
          <div class="aria-brand-subtitle">Operator Space</div>
        </div>
      </div>

      <div class="aria-nav-group">Workspace</div>
      <a class="aria-nav-item ${isNav('home')}" href="/dashboard?view=home">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
        <span>Home</span>
      </a>
      <a class="aria-nav-item ${isNav('missions')}" href="/dashboard?view=missions">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        <span>Missions</span>
      </a>
      <a class="aria-nav-item ${isNav('activity')}" href="/dashboard?view=activity">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span>Activity</span>
      </a>
      <a class="aria-nav-item ${isNav('projects')}" href="/dashboard/atlas">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span>Projects (Atlas)</span>
      </a>

      <div class="aria-nav-group">System & Channel</div>
      <a class="aria-nav-item ${isNav('pairing')}" href="/dashboard?view=pairing">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        <span>WhatsApp Pairing</span>
      </a>
      <a class="aria-nav-item ${isNav('connectors')}" href="/dashboard?view=connectors">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        <span>Connectors</span>
      </a>
      <a class="aria-nav-item ${isNav('runtime')}" href="/dashboard?view=runtime">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
        <span>Runtime</span>
      </a>
      <a class="aria-nav-item ${isNav('services')}" href="/dashboard?view=services">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        <span>Services</span>
      </a>

      <div class="aria-nav-group">Knowledge</div>
      <a class="aria-nav-item ${isNav('memory')}" href="/dashboard?view=memory">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span>Memory</span>
      </a>
      <a class="aria-nav-item ${isNav('research')}" href="/dashboard?view=research">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span>Research</span>
      </a>

      <div class="aria-nav-group">Ecosystem</div>
      <a class="aria-nav-item ${isNav('github')}" href="/dashboard?view=github">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
        <span>GitHub</span>
      </a>
      <a class="aria-nav-item ${isNav('companion')}" href="/dashboard?view=companion">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
        <span>Companion</span>
      </a>

      <div class="aria-nav-group">Account</div>
      <a class="aria-nav-item ${isNav('settings')}" href="/dashboard?view=settings">
        <svg class="aria-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>Settings</span>
      </a>

      <div class="aria-sidebar-footer">
        <div class="aria-status-badge">
          <div class="aria-status-dot"></div>
          <span>ARIA Online</span>
        </div>
        <form method="POST" action="/dashboard/api/auth/logout" style="margin-top:10px;">
          <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
          <button class="aria-btn" style="width:100%;text-align:left;" type="submit">Sign Out</button>
        </form>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="aria-main">
      <header class="aria-header">
        <div class="aria-header-left">
          <img class="aria-mobile-logo" src="/aria-mark.png" alt="ARIA">
          <div>
            <div class="aria-page-title">${esc(activeView.toUpperCase())}</div>
            <div class="aria-page-sub">Central Operator View · User: ${esc(user?.username || 'Owner')} (${esc(user?.role || 'owner')})</div>
          </div>
        </div>
        <div class="aria-header-right">
          <button class="aria-btn aria-mobile-more-btn" onclick="toggleMobileDrawer()" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            <span>More</span>
          </button>
        </div>
      </header>

      <div id="aria-workspace-root">
        ${content}
      </div>
    </main>

    <!-- Contextual Right Panel (Desktop) -->
    <aside class="aria-context-panel">
      <div class="aria-panel-section">
        <div class="aria-panel-title">System State</div>
        <div style="font-size:12px;margin-bottom:6px;display:flex;justify-content:space-between;">
          <span style="color:var(--aria-secondary);">Status</span>
          <span class="mono" style="color:var(--aria-green);">ONLINE</span>
        </div>
        <div style="font-size:12px;margin-bottom:6px;display:flex;justify-content:space-between;">
          <span style="color:var(--aria-secondary);">State</span>
          <span class="mono">EXECUTING</span>
        </div>
      </div>

      <div class="aria-panel-section">
        <div class="aria-panel-title">Connectors</div>
        <div id="aria-context-connectors">
          <div style="color:var(--aria-secondary);font-size:12px;">Loading connectors...</div>
        </div>
      </div>
    </aside>
  </div>

  <!-- Mobile Drawer Overlay -->
  <div id="aria-mobile-drawer" class="aria-mobile-drawer">
    <div class="aria-drawer-header">
      <span class="aria-drawer-title">System Navigation</span>
      <button class="aria-btn aria-btn-sm" onclick="toggleMobileDrawer()">Close</button>
    </div>
    <div class="aria-drawer-links">
      <a href="/dashboard?view=home" class="${isNav('home')}">Home</a>
      <a href="/dashboard?view=missions" class="${isNav('missions')}">Missions</a>
      <a href="/dashboard?view=pairing" class="${isNav('pairing')}">WhatsApp Pairing</a>
      <a href="/dashboard?view=connectors" class="${isNav('connectors')}">Connectors</a>
      <a href="/dashboard?view=activity" class="${isNav('activity')}">Activity</a>
      <a href="/dashboard/atlas">Projects (Atlas)</a>
      <a href="/dashboard?view=github" class="${isNav('github')}">GitHub Workspace</a>
      <a href="/dashboard?view=companion" class="${isNav('companion')}">Android Companion</a>
      <a href="/dashboard?view=runtime" class="${isNav('runtime')}">Runtime Console</a>
      <a href="/dashboard?view=services" class="${isNav('services')}">Services</a>
      <a href="/dashboard?view=memory" class="${isNav('memory')}">Memory Layer</a>
      <a href="/dashboard?view=research" class="${isNav('research')}">Research</a>
      <a href="/dashboard?view=settings" class="${isNav('settings')}">Settings</a>
    </div>
  </div>

  <!-- Mobile Bottom Navigation -->
  <nav class="aria-mobile-nav">
    <a class="aria-mobile-item ${isNav('home')}" href="/dashboard?view=home">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      <span>Home</span>
    </a>
    <a class="aria-mobile-item ${isNav('missions')}" href="/dashboard?view=missions">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      <span>Missions</span>
    </a>
    <a class="aria-mobile-item ${isNav('pairing')}" href="/dashboard?view=pairing">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      <span>Pairing</span>
    </a>
    <a class="aria-mobile-item ${isNav('connectors')}" href="/dashboard?view=connectors">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      <span>Connectors</span>
    </a>
    <a class="aria-mobile-item ${isNav('activity')}" href="/dashboard?view=activity">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      <span>Activity</span>
    </a>
  </nav>

  <script>
    window.ARIA_CSRF = ${JSON.stringify(csrfToken)};
    function toggleMobileDrawer() {
      const d = document.getElementById('aria-mobile-drawer');
      if (d) d.classList.toggle('open');
    }

    if (!!window.EventSource) {
      try {
        const sse = new EventSource('/api/stream');
        sse.onmessage = function(e) {
          try {
            const payload = JSON.parse(e.data);
            if (payload && payload.type && payload.type.startsWith('task.')) {
              const urlParams = new URLSearchParams(window.location.search);
              if (urlParams.get('view') === 'missions') {
                window.location.reload();
              }
            }
          } catch (_) {}
        };
      } catch (_) {}
    }
  </script>
</body>
</html>`;
}

function renderSetupPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>ARIA - First Run Setup</title>
  <link rel="stylesheet" href="/dashboard/styles/dashboard.css">
  <style>
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--aria-bg); }
    .setup-card { background: var(--aria-surface); border: 1px solid var(--aria-border); border-radius: 12px; width: 380px; max-width: 90vw; padding: 32px; text-align: center; }
  </style>
</head>
<body>
  <div class="setup-card">
    <img src="/aria-mark.png" alt="ARIA" style="width:48px;height:48px;margin-bottom:16px;">
    <h2 style="margin-bottom:6px;">Initialize ARIA</h2>
    <p style="color:var(--aria-secondary);font-size:12px;margin-bottom:24px;">Create the primary owner account for this ARIA instance.</p>
    <form id="setupForm">
      <div style="text-align:left;margin-bottom:12px;">
        <label style="font-size:11px;color:var(--aria-secondary);display:block;margin-bottom:4px;">Username</label>
        <input class="aria-input" type="text" name="username" required autofocus placeholder="e.g. owner">
      </div>
      <div style="text-align:left;margin-bottom:20px;">
        <label style="font-size:11px;color:var(--aria-secondary);display:block;margin-bottom:4px;">Password</label>
        <input class="aria-input" type="password" name="password" required placeholder="At least 8 characters">
      </div>
      <button class="aria-btn aria-btn-primary" style="width:100%;" type="submit">Create Owner Account</button>
      <div id="setupError" style="color:var(--aria-red);font-size:12px;margin-top:12px;display:none;"></div>
    </form>
  </div>
  <script>
    document.getElementById('setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('setupError');
      err.style.display = 'none';
      const username = e.target.username.value;
      const password = e.target.password.value;
      try {
        const res = await fetch('/dashboard/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          window.location.href = '/dashboard';
        } else {
          err.textContent = data.error?.message || 'Setup failed.';
          err.style.display = 'block';
        }
      } catch (e) {
        err.textContent = 'Connection error.';
        err.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>ARIA - Operator Login</title>
  <link rel="stylesheet" href="/dashboard/styles/dashboard.css">
  <style>
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--aria-bg); }
    .login-card { background: var(--aria-surface); border: 1px solid var(--aria-border); border-radius: 12px; width: 380px; max-width: 90vw; padding: 32px; text-align: center; }
  </style>
</head>
<body>
  <div class="login-card">
    <img src="/aria-mark.png" alt="ARIA" style="width:48px;height:48px;margin-bottom:16px;">
    <h2 style="margin-bottom:6px;">Welcome Back</h2>
    <p style="color:var(--aria-secondary);font-size:12px;margin-bottom:24px;">Sign in to access your ARIA Operator Workspace.</p>
    <form id="loginForm">
      <div style="text-align:left;margin-bottom:12px;">
        <label style="font-size:11px;color:var(--aria-secondary);display:block;margin-bottom:4px;">Username</label>
        <input class="aria-input" type="text" name="username" required autofocus placeholder="e.g. owner">
      </div>
      <div style="text-align:left;margin-bottom:16px;">
        <label style="font-size:11px;color:var(--aria-secondary);display:block;margin-bottom:4px;">Password</label>
        <input class="aria-input" type="password" name="password" required placeholder="Enter password">
      </div>
      <div style="text-align:left;margin-bottom:20px;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="rememberMe" name="rememberMe" style="cursor:pointer;">
        <label for="rememberMe" style="font-size:12px;color:var(--aria-secondary);cursor:pointer;">Remember me for 30 days</label>
      </div>
      <button class="aria-btn aria-btn-primary" style="width:100%;" type="submit">Unlock Workspace</button>
      <div id="loginError" style="color:var(--aria-red);font-size:12px;margin-top:12px;display:none;"></div>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('loginError');
      err.style.display = 'none';
      const username = e.target.username.value;
      const password = e.target.password.value;
      const rememberMe = e.target.rememberMe.checked;
      try {
        const res = await fetch('/dashboard/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, rememberMe })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          window.location.href = '/dashboard';
        } else {
          err.textContent = data.error?.message || 'Invalid credentials.';
          err.style.display = 'block';
        }
      } catch (e) {
        err.textContent = 'Connection error.';
        err.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

module.exports = {
  renderShell,
  renderSetupPage,
  renderLoginPage
};
