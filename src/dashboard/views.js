function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderShell({ user, activeView, content, csrfToken }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
      <a class="aria-nav-item ${activeView === 'home' ? 'active' : ''}" href="/dashboard?view=home">Home</a>
      <a class="aria-nav-item ${activeView === 'missions' ? 'active' : ''}" href="/dashboard?view=missions">Missions</a>
      <a class="aria-nav-item ${activeView === 'activity' ? 'active' : ''}" href="/dashboard?view=activity">Activity</a>
      <a class="aria-nav-item ${activeView === 'projects' ? 'active' : ''}" href="/dashboard/atlas">Projects (Atlas)</a>

      <div class="aria-nav-group">System</div>
      <a class="aria-nav-item ${activeView === 'runtime' ? 'active' : ''}" href="/dashboard?view=runtime">Runtime</a>
      <a class="aria-nav-item ${activeView === 'connectors' ? 'active' : ''}" href="/dashboard?view=connectors">Connectors</a>
      <a class="aria-nav-item ${activeView === 'services' ? 'active' : ''}" href="/dashboard?view=services">Services</a>

      <div class="aria-nav-group">Knowledge</div>
      <a class="aria-nav-item ${activeView === 'memory' ? 'active' : ''}" href="/dashboard?view=memory">Memory</a>
      <a class="aria-nav-item ${activeView === 'research' ? 'active' : ''}" href="/dashboard?view=research">Research</a>

      <div class="aria-nav-group">Ecosystem</div>
      <a class="aria-nav-item ${activeView === 'github' ? 'active' : ''}" href="/dashboard?view=github">GitHub</a>
      <a class="aria-nav-item ${activeView === 'companion' ? 'active' : ''}" href="/dashboard?view=companion">Companion</a>
      <a class="aria-nav-item ${activeView === 'pairing' ? 'active' : ''}" href="/dashboard?view=pairing">WhatsApp Pairing</a>

      <div class="aria-nav-group">Account</div>
      <a class="aria-nav-item ${activeView === 'settings' ? 'active' : ''}" href="/dashboard?view=settings">Settings</a>

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
        <div>
          <div class="aria-page-title">${esc(activeView.toUpperCase())}</div>
          <div class="aria-page-sub">Central Operator View · User: ${esc(user?.username || 'Owner')} (${esc(user?.role || 'owner')})</div>
        </div>
      </header>

      <div id="aria-workspace-root">
        ${content}
      </div>
    </main>

    <!-- Contextual Right Panel -->
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

  <!-- Mobile Navigation -->
  <nav class="aria-mobile-nav">
    <a class="aria-mobile-item" href="/dashboard?view=home"><span>Home</span></a>
    <a class="aria-mobile-item" href="/dashboard?view=missions"><span>Missions</span></a>
    <a class="aria-mobile-item" href="/dashboard?view=connectors"><span>Connectors</span></a>
    <a class="aria-mobile-item" href="/dashboard?view=activity"><span>Activity</span></a>
  </nav>

  <script>
    window.ARIA_CSRF = ${JSON.stringify(csrfToken)};
  </script>
</body>
</html>`;
}

function renderSetupPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ARIA - First Run Setup</title>
  <link rel="stylesheet" href="/dashboard/styles/dashboard.css">
  <style>
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .setup-card { background: var(--aria-surface); border: 1px solid var(--aria-border); border-radius: 12px; width: 380px; padding: 32px; text-align: center; }
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ARIA - Operator Login</title>
  <link rel="stylesheet" href="/dashboard/styles/dashboard.css">
  <style>
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .login-card { background: var(--aria-surface); border: 1px solid var(--aria-border); border-radius: 12px; width: 380px; padding: 32px; text-align: center; }
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
      <div style="text-align:left;margin-bottom:20px;">
        <label style="font-size:11px;color:var(--aria-secondary);display:block;margin-bottom:4px;">Password</label>
        <input class="aria-input" type="password" name="password" required placeholder="Enter password">
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
          body: JSON.stringify({ username, password })
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
