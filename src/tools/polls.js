// ── Polls & Voting ──────────────────────────────────────────────
// Create polls, vote via number/reaction, ARIA tallies results.
// Poll state is in-memory (volatile). For persistent polls, add disk save.

const polls = new Map(); // pollId -> { question, options, votes, creator, chatId, active }

function createPoll(question, options, creator, chatId) {
  const id = `poll_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const votes = {};
  options.forEach((_, i) => { votes[i] = []; });
  
  polls.set(id, {
    id,
    question,
    options,
    votes,
    creator,
    chatId,
    active: true,
    createdAt: Date.now(),
    voterSet: new Set(), // track who voted to prevent double-voting
  });

  return id;
}

function vote(pollId, optionIndex, voter) {
  const poll = polls.get(pollId);
  if (!poll || !poll.active) return { success: false, error: "Poll not found or closed." };
  if (poll.voterSet.has(voter)) return { success: false, error: "You already voted." };
  if (optionIndex < 0 || optionIndex >= poll.options.length) return { success: false, error: "Invalid option." };

  poll.votes[optionIndex].push(voter);
  poll.voterSet.add(voter);
  return { success: true };
}

function closePoll(pollId, userId) {
  const poll = polls.get(pollId);
  if (!poll) return { success: false, error: "Poll not found." };
  if (poll.creator !== userId) return { success: false, error: "Only the poll creator can close it." };
  poll.active = false;
  return { success: true, result: getPollResults(pollId) };
}

function getPollResults(pollId) {
  const poll = polls.get(pollId);
  if (!poll) return null;

  const totalVotes = Object.values(poll.votes).reduce((s, v) => s + v.length, 0);
  const results = poll.options.map((opt, i) => ({
    option: opt,
    votes: poll.votes[i].length,
    percentage: totalVotes > 0 ? Math.round((poll.votes[i].length / totalVotes) * 100) : 0,
  }));

  return {
    question: poll.question,
    active: poll.active,
    totalVotes,
    results,
    options: poll.options,
  };
}

function formatPoll(pollId) {
  const poll = polls.get(pollId);
  if (!poll) return null;

  const totalVotes = Object.values(poll.votes).reduce((s, v) => s + v.length, 0);
  let text = `*📊 ${poll.question}*\n\n`;
  
  poll.options.forEach((opt, i) => {
    const count = poll.votes[i].length;
    const bar = count > 0 ? "▓".repeat(Math.max(1, Math.round((count / Math.max(totalVotes, 1)) * 10))) : "░".repeat(10);
    text += `${i + 1}. ${opt}\n   ${bar} ${count} vote${count !== 1 ? "s" : ""}\n`;
  });

  text += `\nTotal: ${totalVotes} vote${totalVotes !== 1 ? "s" : ""}`;
  if (poll.active) text += `\n_Vote by replying with \`!vote ${pollId.slice(-6)} <number>\`_`;
  else text += `\n_(Closed)_`;

  return text;
}

function formatPollShort(poll) {
  return `📊 *${poll.question}* — ${Object.values(poll.votes).reduce((s, v) => s + v.length, 0)} votes (ID: \`${poll.id.slice(-6)}\`)`;
}

function getActivePolls(chatId) {
  return [...polls.values()].filter((p) => p.chatId === chatId && p.active);
}

function findPollByShortId(shortId) {
  for (const [id, poll] of polls) {
    if (id.endsWith(shortId)) return poll;
  }
  return null;
}

module.exports = { createPoll, vote, closePoll, getPollResults, formatPoll, formatPollShort, getActivePolls, findPollByShortId };
