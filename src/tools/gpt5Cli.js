const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");

// GPT-5 via unofficial Android ChatGPT API
// This is the PRIMARY provider — set GPT5_API_KEY to enable (any non-empty value)
const BASE = "https://android.chat.openai.com";
const MEMORY_FILE = path.join(os.homedir(), ".gpt5_memory.json");

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    }
  } catch (e) {}
  return { conversations: {} };
}

function saveMemory(memory) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2)); } catch (e) {}
}

async function chatGPT(prompt, userId = "default", history = [], systemPrompt = "") {
  const memory = loadMemory();
  let conv = memory.conversations[userId];
  if (!conv) {
    conv = { messages: [], chatId: null, promptCount: 0 };
    memory.conversations[userId] = conv;
  }

  // Auto-rotate device every 10 prompts
  if (conv.promptCount >= 10) {
    conv.chatId = null;
    conv.promptCount = 0;
  }

  const deviceId = `device-${userId}-${Date.now()}`.replace(/[^a-zA-Z0-9-]/g, "");
  
  // Build message history: system prompt + recent history + new message
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  const recentHistory = history.slice(-10);
  for (const m of recentHistory) {
    if (m.role === "assistant" || m.role === "model") {
      messages.push({ role: "assistant", content: m.content });
    } else {
      messages.push({ role: "user", content: m.content });
    }
  }
  messages.push({ role: "user", content: prompt });

  try {
    const res = await axios.post(
      `${BASE}/backend-anon/f/conversation`,
      {
        action: "next",
        messages,
        model: "auto",
        history_and_training_disabled: false,
        enable_message_followups: true,
        force_use_sse: true,
        supported_encodings: ["v1"],
        stream: false,
      },
      {
        headers: {
          "User-Agent": "ChatGPT/1.2026.181 (Android 16; Neo/1.0; build 2222222)",
          "OAI-Package-Name": "com.openai.chatgpt",
          "OAI-Client-Type": "android",
          "Accept-Language": "en-US,en;q=0.9",
          "X-Device-Tier": "upper_mid",
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        timeout: 60000,
        responseType: "json",
      }
    );

    // Parse SSE-style response
    let fullText = "";
    const data = res.data;
    if (data?.v?.message?.content?.parts) {
      fullText = data.v.message.content.parts[0] || "";
    } else if (typeof data === "string") {
      // Try parsing as SSE lines
      const lines = data.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const parts = parsed?.v?.message?.content?.parts;
            if (parts?.[0]) fullText += parts[0];
          } catch (e) {}
        }
      }
    }

    conv.messages.push({ role: "user", content: prompt });
    conv.messages.push({ role: "assistant", content: fullText });
    conv.promptCount++;
    conv.chatId = conv.chatId || `chat-${Date.now()}`;
    saveMemory(memory);
    
    return { text: fullText.trim() || "No response from GPT-5.", provider: "gpt5" };
  } catch (err) {
    return { text: null, error: err.message || "Failed to reach GPT-5 API", provider: "gpt5" };
  }
}

module.exports = { chatGPT, chatGPTVision, analyzeFile, BASE, MEMORY_FILE };

async function chatGPTVision(imageBase64, question, userId = "default", systemPrompt = "") {
  const memory = loadMemory();
  let conv = memory.conversations[userId];
  if (!conv) {
    conv = { messages: [], chatId: null, promptCount: 0 };
    memory.conversations[userId] = conv;
  }

  if (conv.promptCount >= 10) {
    conv.chatId = null;
    conv.promptCount = 0;
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  
  const recentHistory = conv.messages.slice(-10);
  for (const m of recentHistory) {
    messages.push({ role: m.role, content: m.content });
  }
  
  messages.push({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: imageBase64 } },
      { type: "text", text: question || "What's in this image?" }
    ]
  });

  try {
    const res = await axios.post(
      `${BASE}/backend-anon/f/conversation`,
      {
        action: "next",
        messages,
        model: "auto",
        history_and_training_disabled: false,
        enable_message_followups: true,
        force_use_sse: true,
        supported_encodings: ["v1"],
        stream: false,
      },
      {
        headers: {
          "User-Agent": "ChatGPT/1.2026.181 (Android 16; Neo/1.0; build 2222222)",
          "OAI-Package-Name": "com.openai.chatgpt",
          "OAI-Client-Type": "android",
          "Accept-Language": "en-US,en;q=0.9",
          "X-Device-Tier": "upper_mid",
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        timeout: 60000,
        responseType: "json",
      }
    );

    let fullText = "";
    const data = res.data;
    if (data?.v?.message?.content?.parts) {
      fullText = data.v.message.content.parts[0] || "";
    } else if (typeof data === "string") {
      const lines = data.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const parts = parsed?.v?.message?.content?.parts;
            if (parts?.[0]) fullText += parts[0];
          } catch (e) {}
        }
      }
    }

    return { text: fullText.trim() || "No response from GPT-5.", provider: "gpt5_vision" };
  } catch (err) {
    return { text: null, error: err.message || "Failed to reach GPT-5 API", provider: "gpt5_vision" };
  }
}

async function analyzeFile(filePath, userId = "default", systemPrompt = "") {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent) return { text: null, error: "File is empty", provider: "gpt5_file" };
    
    const prompt = `Please analyze this file content and provide insights:\n\n\`\`\`\n${fileContent.slice(0, 10000)}\n\`\`\``;
    
    return await chatGPT(prompt, userId, [], systemPrompt);
  } catch (err) {
    return { text: null, error: err.message || "Failed to read file", provider: "gpt5_file" };
  }
}
