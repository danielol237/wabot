// Detects whether a message likely needs current/real-time information that the
// AI's training data wouldn't have — this is what makes ARIA search automatically
// instead of requiring "!search" every time, per the real gap ChatGPT correctly
// identified: the chat path never called searchWeb() on its own.
//
// Deliberately conservative — false negatives (missing a search-worthy question)
// are far less costly than false positives (searching on every casual message,
// burning API calls and adding latency to simple chat).

const REALTIME_SIGNALS = [
  // explicit time references
  "today", "right now", "currently", "this week", "this month", "latest",
  "recent", "recently", "just happened", "breaking",
  // things that change often
  "price of", "stock price", "exchange rate", "weather in", "score",
  "who won", "what's happening", "news about", "news on",
  // current-state questions about people/entities that can change
  "current ceo", "current president", "still the", "is .* still",
];

const STATIC_KNOWLEDGE_SIGNALS = [
  // questions about settled history/facts shouldn't trigger search even if they
  // contain a date-like word, e.g. "what happened in WW2" shouldn't search
  "explain", "how does", "how do", "what is the difference", "define",
  "write me", "build me", "create a", "translate", "calculate",
];

// Pre-compiled static regex to avoid dynamic RegExp compilation in hot message routing paths
const IS_STILL_REGEX = /is .* still/;

function needsRealtimeInfo(message) {
  const lower = message.toLowerCase();

  // If it's clearly a static-knowledge or task request, don't search regardless
  // of any realtime-sounding words that might also appear in it
  if (STATIC_KNOWLEDGE_SIGNALS.some((s) => lower.includes(s))) return false;

  return REALTIME_SIGNALS.some((signal) => {
    if (signal === "is .* still") {
      return IS_STILL_REGEX.test(lower);
    }
    return lower.includes(signal);
  });
}

module.exports = { needsRealtimeInfo };

