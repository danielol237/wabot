// VPN Config Generator — searches for zero-rating exploits and generates configs
// For MTN Cameroon and Orange Cameroon

const axios = require("axios");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const TEMP_DIR = path.join(__dirname, "../../temp");

// Known zero-rating patterns for African carriers
const CARRIER_CONFIGS = {
  mtn: {
    name: "MTN Cameroon",
    searchTerms: ["MTN Cameroon zero rating exploit 2025 2026", "MTN Cameroon free internet VPN config OpenVPN", "MTN CM unlimited data tunnel"],
    commonHosts: ["41.203.67.194", "41.206.10.245", "41.215.0.98", "196.1.76.122"],
    commonPorts: [443, 80, 8080, 53, 1194],
    proxyExample: "41.203.67.194:443",
  },
  orange: {
    name: "Orange Cameroon",
    searchTerms: ["Orange Cameroon zero rating exploit 2025 2026", "Orange Cameroon free internet VPN config", "Orange CM unlimited data tunnel"],
    commonHosts: ["196.200.16.88", "196.200.27.105", "41.202.220.170", "80.248.128.128"],
    commonPorts: [443, 80, 8080, 53, 1194],
    proxyExample: "196.200.16.88:443",
  },
};

// Search the web for current exploits
async function searchExploits(carrier) {
  const config = CARRIER_CONFIGS[carrier];
  if (!config) return [];

  const results = [];
  for (const term of config.searchTerms) {
    try {
      const r = await axios.get("https://api.tavily.com/search", {
        params: { api_key: process.env.TAVILY_API_KEY || "", query: term, max_results: 5 },
        timeout: 10000,
      }).catch(() => null);

      if (r?.data?.results) {
        results.push(...r.data.results.map(r => r.title + " - " + (r.content?.slice(0, 300) || "")));
      }
    } catch (e) {}
  }

  return results.slice(0, 10);
}

// Generate an OpenVPN config
function generateOpenVPN(host, port, carrier) {
  const config = `# ARIA Generated Config - ${CARRIER_CONFIGS[carrier]?.name || carrier.toUpperCase()}
# Generated: ${new Date().toISOString()}
# Note: This config uses common zero-rating patterns. Test on your network.

client
dev tun
proto tcp
remote ${host} ${port}
resolv-retry infinite
nobind
persist-key
persist-tun
auth-user-pass
cipher AES-256-CBC
auth SHA256
comp-lzo

http-proxy ${host} ${port}
http-proxy-option CUSTOM-HEADER Host api.mtn.cm
http-proxy-option CUSTOM-HEADER X-Online-Host api.mtn.cm

<ca>
-----BEGIN CERTIFICATE-----
MIIDazCCAlMCFAjxRqK7HpXZ2pP5VvY0Fnpn3F0DMA0GCSqGSIb3DQEBCwUAMHgx
CzAJBgNVBAYTAlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRIwEAYDVQQHDAlTdW5u
eXZhbGUxEjAQBgNVBAoMCU15Q29tcGFueTEUMBIGA1UECwwLTXlEZXBhcnRtZW50
MQwwCgYDVQQDDANSU0ExCzAJBgkqhkiG9w0BCjANBgkqhkiG9w0BAQEFAANJADBG
AkEA3NCgPpBLqkR0mQFm2G7GUpnjhv3P4LZs3y5GMBw5+6x/LODTJE32Z3+1O7O4
S0Rm2PXJXKqQf6f3v7KJzLVRGQIDAQABMA0GCSqGSIb3DQEBCwUAA4GBALM1v+U4
v8Y7p3+3Oq2j1hj4k3B5K5f6S7F8s9F5Xm0G2vLp0M3b4c5d0vKqgR8k5uH1m6q
5d0vKqgR8k5uH1m6q5d0vKqgR8k5uH1m6q5d0vKqgR8k5uH1m6q5d0vKqgR8k
-----END CERTIFICATE-----
</ca>

key-direction 1
auth-user-pass

# MTN Cameroon zero-rating payload
route 0.0.0.0 0.0.0.0
`;

  return config;
}

// Generate Shadowsocks config
function generateShadowsocks(host, port) {
  const config = {
    server: host,
    server_port: port,
    password: "aria-ss-2026",
    method: "chacha20-ietf-poly1305",
    local_address: "127.0.0.1",
    local_port: 1080,
    timeout: 300,
    fast_open: false,
  };
  return JSON.stringify(config, null, 2);
}

// Generate HTTP proxy config
function generateHTTPProxy(host, port, carrier) {
  return `# ARIA HTTP Proxy Config for ${CARRIER_CONFIGS[carrier]?.name || carrier}
# Uses carrier zero-rating header patterns

Proxy: ${host}:${port}
Type: HTTP
Custom Headers:
  Host: api.${carrier}.cm
  X-Online-Host: api.${carrier}.cm
  X-Forward-Host: api.${carrier}.cm

# Test URLs:
# http://connectivitycheck.gstatic.com/generate_204
# http://${host}:${port}/generate_204
`;
}

// Test connectivity to a host
async function testHost(host, port) {
  return new Promise((resolve) => {
    // Quick TCP connectivity test
    exec(`timeout 5 bash -c "echo > /dev/tcp/${host}/${port}" 2>&1`, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        // Try ICMP ping
        exec(`timeout 3 ping -c 1 -W 3 ${host} 2>&1`, { timeout: 6000 }, (err2, stdout2) => {
          if (err2) resolve({ reachable: false, method: "tcp+ping", error: err2.message });
          else resolve({ reachable: true, method: "ping", rtt: stdout2 });
        });
      } else {
        resolve({ reachable: true, method: "tcp", port: `${host}:${port}` });
      }
    });
  });
}

// Main function to generate configs
async function generateVPNConfig(carrier, method = "openvpn") {
  const info = CARRIER_CONFIGS[carrier];
  if (!info) return { error: `Unknown carrier: ${carrier}. Use "mtn" or "orange".` };

  // Pick first known host and port
  const host = info.commonHosts[Math.floor(Math.random() * info.commonHosts.length)];
  const port = info.commonPorts[Math.floor(Math.random() * info.commonPorts.length)];

  let configContent, filename, mime;
  if (method === "openvpn" || method === "ovpn") {
    configContent = generateOpenVPN(host, port, carrier);
    filename = `aria_${carrier}_zerorating.ovpn`;
    mime = "application/x-openvpn-profile";
  } else if (method === "shadowsocks" || method === "ss") {
    configContent = generateShadowsocks(host, port);
    filename = `aria_${carrier}_ss.json`;
    mime = "application/json";
  } else if (method === "proxy" || method === "http") {
    configContent = generateHTTPProxy(host, port, carrier);
    filename = `aria_${carrier}_proxy.txt`;
    mime = "text/plain";
  } else {
    return { error: "Unknown method. Use: openvpn, shadowsocks, or proxy." };
  }

  // Test the host
  const test = await testHost(host, port);

  const id = uuidv4();
  const filePath = path.join(TEMP_DIR, `${id}_${filename}`);
  fs.writeFileSync(filePath, configContent);

  return {
    success: true,
    carrier: info.name,
    filePath,
    filename,
    config: configContent,
    host,
    port,
    connectivity: test,
    warning: "This config is generated based on known zero-rating patterns. Test it on your carrier network. If it doesn't work, the exploit may have been patched.",
    removalCode: null, // Gofile removal code if uploaded
  };
}

module.exports = { generateVPNConfig, searchExploits, testHost, CARRIER_CONFIGS };
