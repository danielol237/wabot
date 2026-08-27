function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function entries(history) {
  return Array.isArray(history)
    ? history.filter((item) => item && typeof item.content === "string").slice(-10).map((item) => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: String(item.content).slice(0, 1200),
        normalized: normalize(item.content),
      }))
    : [];
}

function buildDialogueAwareness(history, currentText) {
  const recent = entries(history);
  const current = normalize(currentText);
  if (!current) return "";

  const priorUserTurns = recent.filter((item) => item.role === "user");
  const sameQuestionCount = priorUserTurns.filter((item) => item.normalized === current).length;
  const lastAssistant = [...recent].reverse().find((item) => item.role === "assistant");
  const lastUser = [...priorUserTurns].reverse()[0];
  const shortRepeat = current.length <= 80 && sameQuestionCount > 0;
  const recentLoop = sameQuestionCount >= 1 && recent.length >= 3;
  const asksIdentity = /^(?:who(?: are you)?|what(?:'s| is) your name|who is he|who are you)\??$/i.test(String(currentText).trim());
  const asksAboutLoop = /\b(?:loop|repeat(?:ing)?|again|same thing|stuck|confused)\b/i.test(String(currentText));

  const signals = [];
  if (shortRepeat || recentLoop) {
    signals.push("The user has repeated this question or a near-identical turn. Do not give the same canned answer again; acknowledge the repetition and answer in a fresh, context-aware way.");
  }
  if (asksIdentity && lastAssistant?.normalized && /aria|daughter|creator|daniel|mastermind|built|who/.test(lastAssistant.normalized)) {
    signals.push("This looks like a playful identity callback. Connect the answer to the immediately preceding joke or identity exchange instead of restarting an introduction.");
  }
  if (asksAboutLoop) {
    signals.push("The user is commenting on the conversation pattern itself. Respond at the meta-conversational level and show that you noticed what has been repeating.");
  }
  if (lastUser && lastUser.normalized === current && lastAssistant) {
    signals.push(`The previous user turn was also “${lastUser.content.slice(0, 160)}”; the previous assistant reply was “${lastAssistant.content.slice(0, 240)}”. Build on that exchange rather than ignoring it.`);
  }

  if (!signals.length) return "\n\n[Dialogue awareness] No obvious repetition loop detected. Still answer the current message in relation to the latest exchange, not as an isolated prompt.";
  return `\n\n[Dialogue awareness — important]
${signals.map((signal) => `- ${signal}`).join("\n")}`;
}

module.exports = { buildDialogueAwareness, _test: { normalize, entries } };
