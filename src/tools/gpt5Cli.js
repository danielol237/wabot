// GPT-5 CLI integration for ARIA
// Uses the unofficial Android ChatGPT API (android.chat.openai.com)
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'https://android.chat.openai.com';
const MEMORY_FILE = path.join(os.homedir(), '.gpt5_memory.json');

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    }
  } catch (e) {}
  return { conversations: {} };
}

function saveMemory(memory) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2)); } catch (e) {}
}

async function chatGPT(prompt, userId = 'default') {
  const memory = loadMemory();
  let conv = memory.conversations[userId];
  if (!conv) {
    conv = { messages: [], chatId: null, promptCount: 0 };
    memory.conversations[userId] = conv;
  }

  // Auto-rotate device after 10 prompts
  if (conv.promptCount >= 10) {
    conv.chatId = null;
    conv.promptCount = 0;
  }

  const deviceId = `device-${userId}-${Date.now()}`.replace(/[^a-zA-Z0-9-]/g, '');
  const messages = [
    ...conv.messages.slice(-10),
    { role: 'user', content: prompt }
  ];

  try {
    const res = await fetch(`${BASE}/backend-anon/f/conversation`, {
      method: 'POST',
      headers: {
        'User-Agent': 'ChatGPT/1.2026.181 (Android 16; Neo/1.0; build 2222222)',
        'OAI-Package-Name': 'com.openai.chatgpt',
        'OAI-Client-Type': 'android',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Device-Tier': 'upper_mid',
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        action: 'next',
        messages,
        model: 'auto',
        history_and_training_disabled: false,
        enable_message_followups: true,
        force_use_sse: true,
        supported_encodings: ['v1'],
        stream: true,
      }),
    });

    let fullText = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const parts = data?.v?.message?.content?.parts;
            if (parts?.[0]) fullText += parts[0];
          } catch (e) {}
        }
      }
    }

    conv.messages.push({ role: 'user', content: prompt });
    conv.messages.push({ role: 'assistant', content: fullText });
    conv.promptCount++;
    conv.chatId = conv.chatId || `chat-${Date.now()}`;
    saveMemory(memory);
    return fullText.trim() || 'No response from GPT-5.';
  } catch (err) {
    return `Error: ${err.message || 'Failed to reach GPT-5 API'}`;
  }
}

module.exports = { chatGPT };
