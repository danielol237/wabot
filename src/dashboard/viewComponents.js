function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderHomeView(data) {
  const aria = data.aria || {};
  const system = data.system || {};
  const connectors = data.connectors || {};
  const missions = data.missions || {};
  const whatsapp = data.whatsapp || {};
  const attentionCount = data.attention || 0;

  const isConnected = whatsapp.status === 'connected';

  return `
    <div class="aria-grid-metrics">
      <div class="aria-metric-card">
        <div class="aria-metric-label">ARIA STATUS</div>
        <div class="aria-metric-value mono">${esc(aria.status ? aria.status.toUpperCase() : 'OFFLINE')}</div>
        <div class="aria-metric-sub">State: ${esc(aria.state || 'idle')}</div>
      </div>
      <div class="aria-metric-card">
        <div class="aria-metric-label">SYSTEM UPTIME</div>
        <div class="aria-metric-value mono">${Math.floor((system.uptimeSeconds || 0) / 3600)}h ${Math.floor(((system.uptimeSeconds || 0) % 3600) / 60)}m</div>
        <div class="aria-metric-sub">Memory: ${system.memoryMB || 0} MB</div>
      </div>
      <div class="aria-metric-card">
        <div class="aria-metric-label">CONNECTORS</div>
        <div class="aria-metric-value mono">${connectors.connected || 0} / ${connectors.total || 0}</div>
        <div class="aria-metric-sub">Healthy: ${connectors.healthy || 0} · Degraded: ${connectors.degraded || 0}</div>
      </div>
      <div class="aria-metric-card">
        <div class="aria-metric-label">ACTIVE MISSIONS</div>
        <div class="aria-metric-value mono">${missions.active || 0}</div>
        <div class="aria-metric-sub">Completed: ${missions.completed || 0}</div>
      </div>
    </div>

    <!-- WhatsApp Status & Quick Pair Card -->
    <div class="aria-panel-card aria-quick-pair-card" style="margin-bottom:20px;">
      <div class="aria-panel-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          <span style="font-weight:700;font-size:13px;">WHATSAPP CHANNEL & PAIRING</span>
        </div>
        <span class="aria-badge ${isConnected ? 'green' : 'amber'}" id="aria-home-wa-status-badge">${isConnected ? 'CONNECTED' : 'NEEDS PAIRING'}</span>
      </div>

      <div id="aria-quick-pair-body">
        ${isConnected ? `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--aria-green);">● WhatsApp socket connection active & authenticated</div>
              <div style="font-size:11px;color:var(--aria-secondary);margin-top:2px;">Last activity: ${esc(whatsapp.lastActivity || 'Active now')}</div>
            </div>
            <div style="display:flex;gap:8px;">
              <a href="/dashboard?view=pairing" class="aria-btn aria-btn-sm">Pairing Workspace</a>
              <a href="/qr" target="_blank" rel="noopener" class="aria-btn aria-btn-sm">QR Status</a>
            </div>
          </div>
        ` : `
          <div style="margin-bottom:14px;">
            <div style="font-size:13px;font-weight:600;color:var(--aria-amber);margin-bottom:4px;">WhatsApp is disconnected or awaiting owner pairing.</div>
            <div style="font-size:12px;color:var(--aria-secondary);">Pair using your phone number or scan the QR code to grant ARIA access.</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px;">
            <form id="aria-home-pairing-form" style="display:flex;flex-direction:column;gap:8px;">
              <label style="font-size:11px;color:var(--aria-secondary);font-weight:600;">Link with Phone Number</label>
              <div style="display:flex;gap:6px;">
                <input type="text" id="aria-home-phone-input" class="aria-input" placeholder="e.g. 237600000000" style="flex:1;">
                <button type="submit" class="aria-btn aria-btn-primary" style="white-space:nowrap;">Get Code</button>
              </div>
              <div id="aria-home-pairing-msg" style="font-size:12px;display:none;"></div>
            </form>
            <div style="display:flex;flex-direction:column;justify-content:center;gap:8px;border-left:1px solid var(--aria-border);padding-left:12px;">
              <div style="font-size:11px;color:var(--aria-secondary);">Alternative Method</div>
              <a href="/qr" target="_blank" rel="noopener" class="aria-btn aria-btn-secondary" style="text-align:center;">Open QR Code Page</a>
            </div>
          </div>
        `}
      </div>
    </div>

    ${attentionCount > 0 ? `
      <div class="aria-attention-banner" style="margin-bottom:20px;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>${attentionCount} item(s) require operator attention in Connectors/System space.</span>
      </div>
    ` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px;">
      <!-- Active Mission Workspace -->
      <div class="aria-panel-card">
        <div class="aria-panel-header">
          <span style="font-weight:700;font-size:12px;">ACTIVE MISSION</span>
          <span class="aria-badge ${aria.state === 'executing' ? 'green' : 'muted'}">${esc(aria.state || 'IDLE')}</span>
        </div>
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;">${esc(aria.currentTask || 'No active task currently executing.')}</div>
        <div style="color:var(--aria-secondary);font-size:12px;line-height:1.5;">ARIA is operating autonomously in the workspace environment. Send a command via WhatsApp or create a mission to trigger work.</div>
      </div>

      <!-- Recent System Stream -->
      <div class="aria-panel-card">
        <div class="aria-panel-header">
          <span style="font-weight:700;font-size:12px;">RECENT SYSTEM STREAM</span>
          <a href="/dashboard?view=activity" style="font-size:11px;color:var(--aria-secondary);text-decoration:none;">View All →</a>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div class="aria-stream-item">
            <span class="mono" style="font-size:10px;color:var(--aria-muted);">SYS</span>
            <span style="font-size:12px;flex:1;">Dashboard Operator Workspace Active</span>
            <span class="mono" style="font-size:10px;color:var(--aria-muted);">Now</span>
          </div>
          <div class="aria-stream-item">
            <span class="mono" style="font-size:10px;color:var(--aria-muted);">WA</span>
            <span style="font-size:12px;flex:1;">WhatsApp Socket Health Check (${esc(whatsapp.status || 'online')})</span>
            <span class="mono" style="font-size:10px;color:var(--aria-muted);">Live</span>
          </div>
        </div>
      </div>
    </div>

    <script>
      document.getElementById('aria-home-pairing-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('aria-home-phone-input');
        const msg = document.getElementById('aria-home-pairing-msg');
        if (!input || !msg) return;
        const phone = input.value.trim();
        if (!phone) { msg.style.display='block'; msg.style.color='var(--aria-red)'; msg.textContent='Please enter a valid phone number.'; return; }
        msg.style.display='block'; msg.style.color='var(--aria-secondary)'; msg.textContent='Requesting pairing code from WhatsApp...';
        try {
          const res = await fetch('/dashboard/api/pairing/code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.ARIA_CSRF },
            body: JSON.stringify({ phoneNumber: phone })
          });
          const data = await res.json();
          if (data.success && data.code) {
            msg.style.color='var(--aria-green)';
            msg.innerHTML = '<strong>Pairing Code: <span class="mono" style="font-size:16px;">' + esc(data.code) + '</span></strong><br><span style="font-size:11px;color:var(--aria-secondary);">Open WhatsApp → Linked Devices → Link with Phone Number.</span>';
          } else {
            msg.style.color='var(--aria-red)';
            msg.textContent = data.error || 'Could not generate pairing code.';
          }
        } catch (err) {
          msg.style.color='var(--aria-red)'; msg.textContent = 'Network error while requesting pairing code.';
        }
      });
    </script>
  `;
}

function renderPairingView() {
  return `
    <div style="max-width:800px;margin:0 auto;">
      <div class="aria-panel-card" style="margin-bottom:20px;">
        <div class="aria-panel-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span style="font-size:14px;font-weight:700;">WHATSAPP PAIRING WORKSPACE</span>
          </div>
          <span class="aria-badge muted" id="aria-pairing-status-badge">Checking...</span>
        </div>

        <div style="font-size:12px;color:var(--aria-secondary);margin-bottom:20px;line-height:1.6;">
          Authenticate ARIA's WhatsApp socket using either phone number pairing or QR code scanner. This connects the core ARIA agent directly to your WhatsApp account.
        </div>

        <!-- Phone Number Pairing Container -->
        <div style="background:var(--aria-elevated);border:1px solid var(--aria-border);border-radius:8px;padding:20px;margin-bottom:20px;">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">Option 1: Phone Number Pairing Code</h4>
          <p style="font-size:12px;color:var(--aria-secondary);margin-bottom:14px;">Enter your phone number with country code (e.g. 237600000000 or 14155552671) to receive an 8-character pairing code.</p>

          <form id="aria-pairing-code-form" style="display:flex;gap:10px;flex-wrap:wrap;max-width:500px;margin-bottom:12px;">
            <input type="text" id="aria-pairing-phone-input" class="aria-input" placeholder="Phone number (e.g. 237600000000)" style="flex:1;min-width:200px;">
            <button type="submit" class="aria-btn aria-btn-primary">Generate Pairing Code</button>
          </form>

          <div id="aria-pairing-code-result" style="display:none;padding:16px;background:var(--aria-surface);border:1px solid var(--aria-border);border-radius:8px;margin-top:12px;">
            <!-- Rendered dynamically -->
          </div>
        </div>

        <!-- QR Code Container -->
        <div style="background:var(--aria-elevated);border:1px solid var(--aria-border);border-radius:8px;padding:20px;">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">Option 2: QR Code Scan</h4>
          <p style="font-size:12px;color:var(--aria-secondary);margin-bottom:14px;">Scan the QR code directly from your WhatsApp mobile app under <strong>Linked Devices → Link a Device</strong>.</p>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <a href="/qr" target="_blank" rel="noopener" class="aria-btn aria-btn-secondary">Open Standalone QR Scanner View</a>
            <button class="aria-btn aria-btn-danger" id="aria-pairing-reset-btn" type="button">Reset / Clear Pending Pairing</button>
          </div>
        </div>
      </div>

      <!-- Pairing Instructions Panel -->
      <div class="aria-panel-card">
        <div class="aria-panel-header"><span style="font-size:12px;font-weight:700;">PAIRING STEPS & HELP</span></div>
        <ol style="font-size:12px;color:var(--aria-secondary);line-height:1.8;padding-left:20px;margin:0;">
          <li>Open WhatsApp on your mobile phone.</li>
          <li>Tap <strong>Settings</strong> or <strong>Menu (⋮)</strong> → <strong>Linked Devices</strong>.</li>
          <li>Tap <strong>Link a Device</strong>.</li>
          <li>If using Phone Pairing, select <strong>Link with phone number instead</strong> at the bottom of the WhatsApp screen and enter the code generated above.</li>
          <li>If using QR Code, scan the QR code displayed on the QR scanner page.</li>
        </ol>
      </div>
    </div>

    <script>
      async function refreshPairingStatus() {
        try {
          const res = await fetch('/dashboard/api/pairing');
          if (!res.ok) return;
          const data = await res.json();
          const badge = document.getElementById('aria-pairing-status-badge');
          if (badge) {
            badge.textContent = (data.mode || 'offline').toUpperCase();
            badge.className = 'aria-badge ' + (data.ready ? 'green' : data.pending ? 'amber' : 'muted');
          }
          const resBox = document.getElementById('aria-pairing-code-result');
          if (resBox && data.code) {
            resBox.style.display = 'block';
            resBox.innerHTML = '<div style="font-size:11px;color:var(--aria-secondary);margin-bottom:4px;">ACTIVE PAIRING CODE</div>' +
              '<div class="mono" style="font-size:24px;font-weight:800;color:var(--aria-green);letter-spacing:2px;margin-bottom:8px;">' + esc(data.code) + '</div>' +
              '<div style="font-size:11px;color:var(--aria-muted);">Enter this code in WhatsApp linked devices. Status: ' + esc(data.connection || 'pending') + '</div>';
          }
        } catch (_) {}
      }

      document.getElementById('aria-pairing-code-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = document.getElementById('aria-pairing-phone-input')?.value.trim();
        const resBox = document.getElementById('aria-pairing-code-result');
        if (!resBox) return;
        if (!phone) {
          resBox.style.display = 'block';
          resBox.innerHTML = '<span style="color:var(--aria-red);font-size:12px;">Please enter your phone number with country code.</span>';
          return;
        }
        resBox.style.display = 'block';
        resBox.innerHTML = '<span style="color:var(--aria-secondary);font-size:12px;">Requesting pairing code...</span>';
        try {
          const res = await fetch('/dashboard/api/pairing/code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.ARIA_CSRF },
            body: JSON.stringify({ phoneNumber: phone })
          });
          const data = await res.json();
          if (data.success && data.code) {
            resBox.innerHTML = '<div style="font-size:11px;color:var(--aria-secondary);margin-bottom:4px;">PAIRING CODE ISSUED</div>' +
              '<div class="mono" style="font-size:24px;font-weight:800;color:var(--aria-green);letter-spacing:2px;margin-bottom:8px;">' + esc(data.code) + '</div>' +
              '<div style="font-size:11px;color:var(--aria-secondary);">Enter this code in WhatsApp under <strong>Linked Devices → Link with phone number</strong>.</div>';
            refreshPairingStatus();
          } else {
            resBox.innerHTML = '<span style="color:var(--aria-red);font-size:12px;">' + esc(data.error || 'Failed to obtain pairing code.') + '</span>';
          }
        } catch (_) {
          resBox.innerHTML = '<span style="color:var(--aria-red);font-size:12px;">Network error requesting pairing code.</span>';
        }
      });

      document.getElementById('aria-pairing-reset-btn')?.addEventListener('click', async () => {
        if (!confirm('Clear pending pairing state?')) return;
        try {
          await fetch('/dashboard/api/pairing/reset', {
            method: 'POST',
            headers: { 'X-CSRF-Token': window.ARIA_CSRF }
          });
          const resBox = document.getElementById('aria-pairing-code-result');
          if (resBox) { resBox.style.display = 'none'; resBox.innerHTML = ''; }
          refreshPairingStatus();
        } catch (_) {}
      });

      refreshPairingStatus();
    </script>
  `;
}

function renderStateMachineBar(currentStatus) {
  const stages = [
    "CLASSIFIED", "DISCOVERING", "PLANNING", "EXECUTING",
    "TESTING", "REVIEWING", "VERIFYING", "COMPLETED"
  ];
  const currentIndex = stages.indexOf(currentStatus);
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:8px 0;">` + stages.map((st, idx) => {
    const isDone = currentIndex >= idx || currentStatus === "COMPLETED";
    const isCurrent = currentStatus === st;
    const bg = isCurrent ? "#3B82F6" : (isDone ? "#10B981" : "#1F2937");
    const color = isDone || isCurrent ? "#FFFFFF" : "#9CA3AF";
    return `<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:${bg};color:${color};">${st}</span>`;
  }).join("") + `</div>`;
}

function renderMissionsView(missionsData) {
  const missions = missionsData.missions || [];
  const codingTasks = missionsData.codingTasks || [];

  return `
    <div style="margin-bottom:20px;">
      <div class="aria-panel-header" style="margin-bottom:12px;">
        <span style="font-size:13px;font-weight:700;">CODING TASKS / MISSIONS (${codingTasks.length})</span>
      </div>
      ${codingTasks.length === 0 ? `
        <div class="aria-panel-card"><div style="color:var(--aria-secondary);text-align:center;padding:24px;font-size:12px;">No active or past coding tasks recorded. Send a request like "Aria build a website" in WhatsApp.</div></div>
      ` : codingTasks.map(t => `
        <div class="aria-panel-card" style="margin-bottom:12px;" id="card-${esc(t.id)}">
          <div class="aria-panel-header">
            <span class="mono" style="font-weight:700;font-size:13px;color:#3B82F6;">${esc(t.id)}</span>
            <span class="aria-badge ${t.status === 'COMPLETED' ? 'green' : t.status === 'FAILED' ? 'red' : 'amber'}">${esc(t.status)}</span>
          </div>
          <div style="font-size:14px;font-weight:600;margin:6px 0;">"${esc(t.request || t.title)}"</div>

          <div style="font-size:11px;color:var(--aria-muted);margin-bottom:4px;font-weight:700;">STATUS PIPELINE:</div>
          ${renderStateMachineBar(t.status)}

          <div style="font-size:12px;color:var(--aria-secondary);margin:6px 0;">
            <strong>CURRENT STEP:</strong> ${esc(t.currentStep || t.statusMessage || t.status)}
          </div>

          <div style="font-size:11px;color:var(--aria-muted);margin-top:6px;">
            <strong>CAPABILITIES:</strong> filesystem.read • filesystem.write • terminal.execute • coding.edit • coding.test
          </div>

          <details style="margin-top:8px;">
            <summary style="font-size:11px;color:#3B82F6;cursor:pointer;font-weight:600;">View Complete Event History (${t.events?.length || 0})</summary>
            <div style="font-family:monospace;font-size:11px;background:#0D1117;color:#D1D5DB;padding:8px;border-radius:4px;margin-top:6px;max-height:160px;overflow-y:auto;border:1px solid #1F2937;">
              ${(t.events || []).map(e => `<div><span style="color:#6B7280;">[${esc(e.timestamp ? e.timestamp.slice(11, 19) : '12:00:00')}]</span> <strong style="color:#60A5FA;">${esc(e.state || 'EVENT')}</strong>: ${esc(e.message || e.step || '')}</div>`).join('')}
            </div>
          </details>
        </div>
      `).join('')}

      ${missions.length > 0 ? `
        <div class="aria-panel-header" style="margin:24px 0 12px 0;">
          <span style="font-size:13px;font-weight:700;">BACKGROUND AGENT MISSIONS (${missions.length})</span>
        </div>
        ${missions.map(m => `
          <div class="aria-panel-card" style="margin-bottom:10px;">
            <div class="aria-panel-header">
              <span class="mono" style="font-weight:700;font-size:12px;">${esc(m.id)}</span>
              <span class="aria-badge ${m.status === 'completed' ? 'green' : m.status === 'running' ? 'amber' : 'muted'}">${esc(m.status)}</span>
            </div>
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">${esc(m.title)}</div>
            <div style="font-size:12px;color:var(--aria-secondary);margin-bottom:6px;">Current Step: ${esc(m.currentStep)}</div>
            <div style="font-size:11px;color:var(--aria-muted);" class="mono">Started: ${esc(m.startedAt)}</div>
          </div>
        `).join('')}
      ` : ''}
    </div>
  `;
}

function renderConnectorsView(data) {
  const connectors = data.connectors || [];
  const summary = data.summary || {};

  return `
    <div class="aria-grid-metrics" style="margin-bottom:20px;">
      <div class="aria-metric-card"><div class="aria-metric-label">TOTAL</div><div class="aria-metric-value mono">${summary.total || 0}</div></div>
      <div class="aria-metric-card"><div class="aria-metric-label">CONNECTED</div><div class="aria-metric-value mono" style="color:var(--aria-green);">${summary.connected || 0}</div></div>
      <div class="aria-metric-card"><div class="aria-metric-label">HEALTHY</div><div class="aria-metric-value mono" style="color:var(--aria-green);">${summary.healthy || 0}</div></div>
      <div class="aria-metric-card"><div class="aria-metric-label">DEGRADED</div><div class="aria-metric-value mono" style="color:var(--aria-amber);">${summary.degraded || 0}</div></div>
      <div class="aria-metric-card"><div class="aria-metric-label">OFFLINE</div><div class="aria-metric-value mono" style="color:var(--aria-red);">${summary.offline || 0}</div></div>
    </div>

    <!-- Desktop Table & Responsive Mobile Cards -->
    <div class="aria-panel-card" style="padding:0;overflow:hidden;">
      <div class="aria-table-wrapper">
        <table class="aria-table">
          <thead>
            <tr>
              <th>Connector</th>
              <th>Category</th>
              <th>Status</th>
              <th>Health</th>
              <th>Latency</th>
              <th>Capabilities</th>
            </tr>
          </thead>
          <tbody>
            ${connectors.map(c => `
              <tr>
                <td data-label="Connector"><span style="font-weight:600;">${esc(c.name)}</span></td>
                <td data-label="Category"><span class="mono" style="color:var(--aria-secondary);">${esc(c.category)}</span></td>
                <td data-label="Status"><span class="aria-badge ${c.status === 'connected' ? 'green' : c.status === 'available' ? 'muted' : 'amber'}">${esc(c.status)}</span></td>
                <td data-label="Health"><span class="aria-badge ${c.health === 'healthy' ? 'green' : 'red'}">${esc(c.health)}</span></td>
                <td data-label="Latency"><span class="mono">${c.latencyMs || 0} ms</span></td>
                <td data-label="Capabilities"><span style="color:var(--aria-secondary);font-size:11px;">${(c.capabilities || []).join(', ')}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Mobile Fallback Card View -->
      <div class="aria-mobile-cards-container">
        ${connectors.map(c => `
          <div class="aria-mobile-data-card">
            <div class="aria-mobile-card-header">
              <span class="aria-mobile-card-title">${esc(c.name)}</span>
              <span class="aria-badge ${c.status === 'connected' ? 'green' : c.status === 'available' ? 'muted' : 'amber'}">${esc(c.status)}</span>
            </div>
            <div class="aria-mobile-card-row">
              <span class="aria-mobile-card-label">Category</span>
              <span class="mono" style="font-size:12px;color:var(--aria-secondary);">${esc(c.category)}</span>
            </div>
            <div class="aria-mobile-card-row">
              <span class="aria-mobile-card-label">Health</span>
              <span class="aria-badge ${c.health === 'healthy' ? 'green' : 'red'}">${esc(c.health)}</span>
            </div>
            <div class="aria-mobile-card-row">
              <span class="aria-mobile-card-label">Latency</span>
              <span class="mono" style="font-size:12px;">${c.latencyMs || 0} ms</span>
            </div>
            <div class="aria-mobile-card-row" style="flex-direction:column;align-items:flex-start;gap:4px;">
              <span class="aria-mobile-card-label">Capabilities</span>
              <span style="font-size:11px;color:var(--aria-secondary);">${(c.capabilities || []).join(', ')}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderGitHubView(ghData, repoData) {
  return `
    <div class="aria-panel-card" style="margin-bottom:20px;">
      <div class="aria-panel-header">
        <span style="font-weight:700;font-size:13px;">GITHUB WORKSPACE</span>
        <span class="aria-badge ${ghData.connected ? 'green' : 'amber'}">${ghData.connected ? 'CONNECTED' : 'AUTH REQUIRED'}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:16px;margin-top:12px;">
        <div>
          <div style="color:var(--aria-secondary);font-size:11px;">Repository</div>
          <div style="font-size:13px;font-weight:600;" class="mono">${esc(repoData.fullName || 'danielol237/wabot')}</div>
        </div>
        <div>
          <div style="color:var(--aria-secondary);font-size:11px;">Branch</div>
          <div style="font-size:13px;font-weight:600;" class="mono">${esc(repoData.branch || 'main')}</div>
        </div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--aria-border);">
        <div style="color:var(--aria-secondary);font-size:11px;">Latest Commit</div>
        <div class="mono" style="font-size:12px;margin-top:4px;">${esc(repoData.lastCommit?.sha || 'HEAD')} - ${esc(repoData.lastCommit?.message || 'Update')}</div>
      </div>
    </div>
  `;
}

function renderCompanionView(data) {
  const devices = data.devices || [];

  return `
    <div class="aria-panel-card">
      <div class="aria-panel-header">
        <span style="font-weight:700;font-size:13px;">ANDROID COMPANION</span>
        <span class="aria-badge ${devices.length > 0 ? 'green' : 'muted'}">${devices.length > 0 ? 'CONNECTED' : 'DISCONNECTED'}</span>
      </div>
      ${devices.length === 0 ? `
        <div style="color:var(--aria-secondary);text-align:center;padding:24px;font-size:12px;">No ARIA Companion devices currently connected. Connect via Android Companion app.</div>
      ` : devices.map(d => `
        <div style="border-top:1px solid var(--aria-border);padding-top:12px;margin-top:12px;">
          <div style="font-size:13px;font-weight:600;">${esc(d.name)} (${esc(d.platform)})</div>
          <div style="font-size:11px;color:var(--aria-secondary);margin-top:2px;">Last seen: ${esc(d.lastSeen)} · Latency: ${d.latencyMs} ms</div>
          <div style="font-size:11px;color:var(--aria-muted);margin-top:4px;">Capabilities: ${(d.capabilities || []).join(', ')}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderActivityView(activityData) {
  const events = activityData.events || [];
  return `
    <div class="aria-panel-card">
      <div class="aria-panel-header">
        <span style="font-weight:700;font-size:13px;">RECENT SYSTEM ACTIVITY</span>
      </div>
      ${events.length === 0 ? `
        <div style="color:var(--aria-secondary);text-align:center;padding:20px;font-size:12px;">No recent activity recorded.</div>
      ` : events.map(e => `
        <div style="padding:10px 0;border-bottom:1px solid var(--aria-border);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;font-size:13px;">${esc(e.title)}</span>
            <span class="mono" style="font-size:10px;color:var(--aria-muted);">${esc(e.timestamp)}</span>
          </div>
          <div style="color:var(--aria-secondary);font-size:12px;margin-top:3px;">${esc(e.description)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRuntimeView(sysData) {
  const runtime = sysData.runtime || {};
  const resources = sysData.resources || {};
  return `
    <div class="aria-panel-card" style="margin-bottom:16px;">
      <div class="aria-panel-header"><span style="font-weight:700;font-size:13px;">NODE.JS RUNTIME CONSOLE</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-top:10px;">
        <div><span style="color:var(--aria-secondary);font-size:11px;">Version</span><div class="mono" style="font-size:13px;">${esc(runtime.nodeVersion)}</div></div>
        <div><span style="color:var(--aria-secondary);font-size:11px;">Platform</span><div class="mono" style="font-size:13px;">${esc(runtime.platform)}</div></div>
        <div><span style="color:var(--aria-secondary);font-size:11px;">PID</span><div class="mono" style="font-size:13px;">${esc(runtime.pid)}</div></div>
        <div><span style="color:var(--aria-secondary);font-size:11px;">Uptime</span><div class="mono" style="font-size:13px;">${Math.floor((runtime.uptimeSeconds || 0) / 3600)}h ${Math.floor(((runtime.uptimeSeconds || 0) % 3600) / 60)}m</div></div>
      </div>
    </div>
    <div class="aria-panel-card">
      <div class="aria-panel-header"><span style="font-weight:700;font-size:13px;">RESOURCE METRICS</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-top:10px;">
        <div><span style="color:var(--aria-secondary);font-size:11px;">Memory Used</span><div class="mono" style="font-size:13px;">${resources.memoryMB} MB (${resources.memoryPercent}%)</div></div>
        <div><span style="color:var(--aria-secondary);font-size:11px;">CPU Utilization</span><div class="mono" style="font-size:13px;">${resources.cpuPercent}%</div></div>
      </div>
    </div>
  `;
}

function renderServicesView(srvData) {
  const services = srvData.services || [];
  return `
    <div class="aria-panel-card">
      <div class="aria-panel-header"><span style="font-weight:700;font-size:13px;">ARIA SYSTEM SERVICES</span></div>
      ${services.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--aria-border);">
          <div>
            <div style="font-weight:600;font-size:13px;">${esc(s.name)}</div>
            <div style="color:var(--aria-secondary);font-size:11px;" class="mono">${esc(s.id)}</div>
          </div>
          <div>
            <span class="aria-badge ${s.status === 'running' ? 'green' : 'amber'}">${esc(s.status)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMemoryView(memData) {
  const memories = memData.memories || [];
  return `
    <div class="aria-panel-card">
      <div class="aria-panel-header"><span style="font-weight:700;font-size:13px;">SEMANTIC MEMORY LAYER</span></div>
      ${memories.length === 0 ? `
        <div style="color:var(--aria-secondary);text-align:center;padding:20px;font-size:12px;">No memory records found.</div>
      ` : memories.map(m => `
        <div style="padding:10px 0;border-bottom:1px solid var(--aria-border);">
          <div style="font-weight:600;font-size:13px;">${esc(m.title)}</div>
          <div style="color:var(--aria-secondary);font-size:12px;margin-top:4px;">${esc(m.content)}</div>
          <div style="color:var(--aria-muted);font-size:10px;margin-top:4px;" class="mono">Type: ${esc(m.type)} · Created: ${esc(m.createdAt)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderResearchView() {
  return `
    <div class="aria-panel-card">
      <div class="aria-panel-header"><span style="font-weight:700;font-size:13px;">AUTONOMOUS RESEARCH WORKSPACE</span></div>
      <div style="color:var(--aria-secondary);padding:14px 0;font-size:12px;">Research capability engine is available. Active research queries and findings will be recorded here.</div>
    </div>
  `;
}

function renderSettingsView(user) {
  return `
    <div class="aria-panel-card">
      <div class="aria-panel-header"><span style="font-weight:700;font-size:13px;">ACCOUNT & OPERATOR SETTINGS</span></div>
      <div style="margin-bottom:12px;">
        <div style="color:var(--aria-secondary);font-size:11px;">Authenticated User</div>
        <div style="font-size:13px;font-weight:600;">${esc(user?.username || 'owner')}</div>
      </div>
      <div>
        <div style="color:var(--aria-secondary);font-size:11px;">Assigned Role</div>
        <div style="font-size:13px;font-weight:600;" class="mono">${esc(user?.role || 'owner')}</div>
      </div>
    </div>
  `;
}

module.exports = {
  renderHomeView,
  renderMissionsView,
  renderConnectorsView,
  renderGitHubView,
  renderCompanionView,
  renderActivityView,
  renderRuntimeView,
  renderServicesView,
  renderMemoryView,
  renderResearchView,
  renderPairingView,
  renderSettingsView
};
