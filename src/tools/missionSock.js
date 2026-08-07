// ── Shared mission socket holder ──────────────────────────────
// A tiny module so durableMissions and orchestrator both get the socket
// without circular requires. Set once at startup in index.js.

let sock = null;
function setSock(s) { sock = s; }
function getSock() { return sock; }

module.exports = { setSock, getSock };
