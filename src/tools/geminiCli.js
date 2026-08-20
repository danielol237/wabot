const axios = require("axios");
const crypto = require("crypto");

// Gemini unofficial API client — reverse-engineered from Gemini web
// No API key needed, works via browser session emulation
const BASE = "https://gemini.google.com";

async function sendMessage(prompt, options = {}) {
  const { model = "gemini-2.0-flash-exp", thinkMode = false } = options;
  
  try {
    const reqId = crypto.randomUUID();
    
    // Build payload similar to Gemini web app
    const inner = new Array(80).fill(null);
    inner[0] = [prompt, 0, null, null, null, null, 0];
    inner[1] = ["en"];
    inner[2] = ["", "", "", null, null, null, null, null, null, ""];
    inner[6] = [0];
    inner[7] = 1;
    inner[10] = 1;
    inner[11] = 0;
    inner[17] = [[thinkMode ? "1" : "0"]];
    inner[18] = 0;
    inner[27] = 1;
    inner[30] = [4];
    inner[41] = [2];
    inner[53] = 0;
    inner[59] = reqId;
    inner[61] = [];
    inner[68] = 1;
    inner[79] = model;

    const outer = [null, JSON.stringify(inner)];
    
    const res = await axios.post(
      `${BASE}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`,
      new URLSearchParams({
        f_req: JSON.stringify(outer),
        _reqid: reqId.slice(0, 8),
        rt: "c"
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": BASE,
          "Referer": `${BASE}/app`,
          "X-Same-Domain": "1",
          "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        },
        timeout: 60000,
      }
    );

    // Parse response
    const data = res.data;
    if (typeof data === "string") {
      const lines = data.split("\n");
      for (const line of lines) {
        if (line.startsWith("['")) {
          try {
            const parsed = JSON.parse(line.slice(1, -1));
            if (parsed[0] && parsed[0][0] && parsed[0][0][4]) {
              return { 
                text: parsed[0][0][4].join("\n"), 
                provider: "gemini",
                model 
              };
            }
          } catch (e) {}
        }
      }
    }
    
    return { text: data?.toString() || "No response from Gemini.", provider: "gemini" };
  } catch (err) {
    return { text: null, error: err.message || "Failed to reach Gemini API", provider: "gemini" };
  }
}

module.exports = { sendMessage };
