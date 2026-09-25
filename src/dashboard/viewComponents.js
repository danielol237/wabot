function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderHomeView(data) {
  const aria = data.aria || {};
  const system = data.system || {};
  const connectors = data.connectors || {};
  const missions = data.missions || {};

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:14px;margin-bottom:24px;">
      <div class="aria-row-card">
        <div style="color:var(--aria-secondary);font-size:11px;font-weight:700;">ARIA STATUS</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;" class="mono">${esc(aria.status ? aria.status.toUpperCase() : 'OFFLINE')}</div>
        <div style="color:var(--aria-secondary);font-size:11px;margin-top:2px;">State: ${esc(aria.state || 'idle')}</div>
      </div>
      <div class="aria-row-card">
        <div style="color:var(--aria-secondary);font-size:11px;font-weight:700;">SYSTEM UPTIME</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;" class="mono">${Math.floor((system.uptimeSeconds || 0) / 3600)}h ${Math.floor(((system.uptimeSeconds || 0) % 3600) / 60)}m</div>
        <div style="color:var(--aria-secondary);font-size:11px;margin-top:2px;">Memory: ${system.memoryMB || 0} MB</div>
      </div>
      <div class="aria-row-card">
        <div style="color:var(--aria-secondary);font-size:11px;font-weight:700;">CONNECTORS</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;" class="mono">${connectors.connected || 0} / ${connectors.total || 0}</div>
        <div style="color:var(--aria-secondary);font-size:11px;margin-top:2px;">Healthy: ${connectors.healthy || 0}</div>
      </div>
      <div class="aria-row-card">
        <div style="color:var(--aria-secondary);font-size:11px;font-weight:700;">ACTIVE MISSIONS</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;" class="mono">${missions.active || 0}</div>
        <div style="color:var(--aria-secondary);font-size:11px;margin-top:2px;">Completed: ${missions.completed || 0}</div>
      </div>
    </div>

    <div class="aria-row-card" style="margin-bottom:24px;">
      <div class="aria-row-header">
        <span style="font-weight:700;">ACTIVE MISSION</span>
        <span class="aria-badge ${aria.state === 'executing' ? 'green' : 'muted'}">${esc(aria.state || 'IDLE')}</span>
      </div>
      <div style="font-size:14px;font-weight:600;margin-bottom:6px;">${esc(aria.currentTask || 'No active task currently executing.')}</div>
      <div style="color:var(--aria-secondary);font-size:12px;">ARIA is operating autonomously in the workspace environment.</div>
    </div>
  `;
}

function renderMissionsView(missionsData) {
  const missions = missionsData.missions || [];
  return `
    <div style="margin-bottom:20px;">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">MISSION WORKSPACE</h3>
      ${missions.length === 0 ? `
        <div class="aria-row-card"><div style="color:var(--aria-secondary);text-align:center;padding:20px;">No missions recorded. Send a mission command to start.</div></div>
      ` : missions.map(m => `
        <div class="aria-row-card">
          <div class="aria-row-header">
            <span class="mono" style="font-weight:700;">${esc(m.id)}</span>
            <span class="aria-badge ${m.status === 'completed' ? 'green' : m.status === 'running' ? 'amber' : 'muted'}">${esc(m.status)}</span>
          </div>
          <div style="font-size:14px;font-weight:600;margin-bottom:8px;">${esc(m.title)}</div>
          <div style="font-size:12px;color:var(--aria-secondary);margin-bottom:6px;">Step: ${esc(m.currentStep)}</div>
          <div style="font-size:11px;color:var(--aria-muted);" class="mono">Started: ${esc(m.startedAt)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderConnectorsView(data) {
  const connectors = data.connectors || [];
  const summary = data.summary || {};

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;margin-bottom:20px;">
      <div class="aria-row-card"><div style="color:var(--aria-secondary);font-size:10px;font-weight:700;">TOTAL</div><div style="font-size:18px;font-weight:700;" class="mono">${summary.total || 0}</div></div>
      <div class="aria-row-card"><div style="color:var(--aria-secondary);font-size:10px;font-weight:700;">CONNECTED</div><div style="font-size:18px;font-weight:700;color:var(--aria-green);" class="mono">${summary.connected || 0}</div></div>
      <div class="aria-row-card"><div style="color:var(--aria-secondary);font-size:10px;font-weight:700;">HEALTHY</div><div style="font-size:18px;font-weight:700;color:var(--aria-green);" class="mono">${summary.healthy || 0}</div></div>
      <div class="aria-row-card"><div style="color:var(--aria-secondary);font-size:10px;font-weight:700;">DEGRADED</div><div style="font-size:18px;font-weight:700;color:var(--aria-amber);" class="mono">${summary.degraded || 0}</div></div>
      <div class="aria-row-card"><div style="color:var(--aria-secondary);font-size:10px;font-weight:700;">OFFLINE</div><div style="font-size:18px;font-weight:700;color:var(--aria-red);" class="mono">${summary.offline || 0}</div></div>
    </div>

    <div class="aria-row-card">
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
              <td><span style="font-weight:600;">${esc(c.name)}</span></td>
              <td><span class="mono" style="color:var(--aria-secondary);">${esc(c.category)}</span></td>
              <td><span class="aria-badge ${c.status === 'connected' ? 'green' : c.status === 'available' ? 'muted' : 'amber'}">${esc(c.status)}</span></td>
              <td><span class="aria-badge ${c.health === 'healthy' ? 'green' : 'red'}">${esc(c.health)}</span></td>
              <td><span class="mono">${c.latencyMs || 0} ms</span></td>
              <td><span style="color:var(--aria-secondary);font-size:11px;">${(c.capabilities || []).join(', ')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderGitHubView(ghData, repoData) {
  return `
    <div class="aria-row-card" style="margin-bottom:20px;">
      <div class="aria-row-header">
        <span style="font-weight:700;">GITHUB WORKSPACE</span>
        <span class="aria-badge ${ghData.connected ? 'green' : 'amber'}">${ghData.connected ? 'CONNECTED' : 'AUTH REQUIRED'}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;">
        <div>
          <div style="color:var(--aria-secondary);font-size:11px;">Repository</div>
          <div style="font-size:14px;font-weight:600;" class="mono">${esc(repoData.fullName || 'danielol237/wabot')}</div>
        </div>
        <div>
          <div style="color:var(--aria-secondary);font-size:11px;">Branch</div>
          <div style="font-size:14px;font-weight:600;" class="mono">${esc(repoData.branch || 'main')}</div>
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
    <div class="aria-row-card">
      <div class="aria-row-header">
        <span style="font-weight:700;">ANDROID COMPANION</span>
        <span class="aria-badge ${devices.length > 0 ? 'green' : 'muted'}">${devices.length > 0 ? 'CONNECTED' : 'DISCONNECTED'}</span>
      </div>
      ${devices.length === 0 ? `
        <div style="color:var(--aria-secondary);text-align:center;padding:24px;">No ARIA Companion devices currently connected.</div>
      ` : devices.map(d => `
        <div style="border-top:1px solid var(--aria-border);padding-top:12px;margin-top:12px;">
          <div style="font-size:14px;font-weight:600;">${esc(d.name)} (${esc(d.platform)})</div>
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
    <div class="aria-row-card">
      <div class="aria-row-header">
        <span style="font-weight:700;">RECENT SYSTEM ACTIVITY</span>
      </div>
      ${events.length === 0 ? `
        <div style="color:var(--aria-secondary);text-align:center;padding:20px;">No recent activity recorded.</div>
      ` : events.map(e => `
        <div style="padding:8px 0;border-bottom:1px solid var(--aria-border);">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-weight:600;">${esc(e.title)}</span>
            <span class="mono" style="font-size:11px;color:var(--aria-muted);">${esc(e.timestamp)}</span>
          </div>
          <div style="color:var(--aria-secondary);font-size:12px;margin-top:2px;">${esc(e.description)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRuntimeView(sysData) {
  const runtime = sysData.runtime || {};
  const resources = sysData.resources || {};
  return `
    <div class="aria-row-card" style="margin-bottom:16px;">
      <div class="aria-row-header"><span style="font-weight:700;">NODE.JS RUNTIME CONSOLE</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;">
        <div><span style="color:var(--aria-secondary);font-size:11px;">Version</span><div class="mono">${esc(runtime.nodeVersion)}</div></div>
        <div><span style="color:var(--aria-secondary);font-size:11px;">Platform</span><div class="mono">${esc(runtime.platform)}</div></div>
        <div><span style="color:var(--aria-secondary);font-size:11px;">PID</span><div class="mono">${esc(runtime.pid)}</div></div>
        <div><span style="color:var(--aria-secondary);font-size:11px;">Uptime</span><div class="mono">${Math.floor((runtime.uptimeSeconds || 0) / 3600)}h ${Math.floor(((runtime.uptimeSeconds || 0) % 3600) / 60)}m</div></div>
      </div>
    </div>
    <div class="aria-row-card">
      <div class="aria-row-header"><span style="font-weight:700;">RESOURCE METRICS</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;">
        <div><span style="color:var(--aria-secondary);font-size:11px;">Memory Used</span><div class="mono">${resources.memoryMB} MB (${resources.memoryPercent}%)</div></div>
        <div><span style="color:var(--aria-secondary);font-size:11px;">CPU Utilization</span><div class="mono">${resources.cpuPercent}%</div></div>
      </div>
    </div>
  `;
}

function renderServicesView(srvData) {
  const services = srvData.services || [];
  return `
    <div class="aria-row-card">
      <div class="aria-row-header"><span style="font-weight:700;">ARIA SYSTEM SERVICES</span></div>
      ${services.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--aria-border);">
          <div>
            <div style="font-weight:600;">${esc(s.name)}</div>
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
    <div class="aria-row-card">
      <div class="aria-row-header"><span style="font-weight:700;">SEMANTIC MEMORY LAYER</span></div>
      ${memories.length === 0 ? `
        <div style="color:var(--aria-secondary);text-align:center;padding:20px;">No memory records found.</div>
      ` : memories.map(m => `
        <div style="padding:10px 0;border-bottom:1px solid var(--aria-border);">
          <div style="font-weight:600;">${esc(m.title)}</div>
          <div style="color:var(--aria-secondary);font-size:12px;margin-top:4px;">${esc(m.content)}</div>
          <div style="color:var(--aria-muted);font-size:10px;margin-top:4px;" class="mono">Type: ${esc(m.type)} · Created: ${esc(m.createdAt)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderResearchView() {
  return `
    <div class="aria-row-card">
      <div class="aria-row-header"><span style="font-weight:700;">AUTONOMOUS RESEARCH WORKSPACE</span></div>
      <div style="color:var(--aria-secondary);padding:14px 0;">Research capability engine is available. Active research queries and findings will be recorded here.</div>
    </div>
  `;
}

function renderPairingView() {
  return `
    <div class="aria-row-card">
      <div class="aria-row-header"><span style="font-weight:700;">WHATSAPP PHONE PAIRING</span></div>
      <div style="color:var(--aria-secondary);margin-bottom:14px;">Connect ARIA by phone number or QR code fallback.</div>
      <a class="aria-btn aria-btn-primary" href="/qr" target="_blank" rel="noopener">Open QR Pairing Page</a>
    </div>
  `;
}

function renderSettingsView(user) {
  return `
    <div class="aria-row-card">
      <div class="aria-row-header"><span style="font-weight:700;">ACCOUNT & OPERATOR SETTINGS</span></div>
      <div style="margin-bottom:12px;">
        <div style="color:var(--aria-secondary);font-size:11px;">Authenticated User</div>
        <div style="font-size:14px;font-weight:600;">${esc(user?.username || 'owner')}</div>
      </div>
      <div>
        <div style="color:var(--aria-secondary);font-size:11px;">Assigned Role</div>
        <div style="font-size:14px;font-weight:600;" class="mono">${esc(user?.role || 'owner')}</div>
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
