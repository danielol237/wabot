const axios = require("axios");

// Pollinations AI — completely free, no API key needed
// https://pollinations.ai - works via GET endpoint
const BASE_URL = "https://text.pollinations.ai/";

async function sendMessage(prompt, options = {}) {
  try {
    // Use GET endpoint (works reliably)
    const encoded = encodeURIComponent(prompt.slice(0, 1000));
    const res = await axios.get(`${BASE_URL}${encoded}`, { 
      timeout: 30000,
      headers: { "Accept": "text/plain" }
    });
    
    const text = (res.data || "").trim();
    
    if (!text) {
      return { text: null, error: "Empty response from Pollinations", provider: "pollinations" };
    }
    
    return { text, provider: "pollinations" };
  } catch (err) {
    return { text: null, error: err.message || "Pollinations failed", provider: "pollinations" };
  }
}

module.exports = { sendMessage };
