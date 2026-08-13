// ── Unified UserProfile (audit #18) ────────────────────────────
// ARIA's memory is spread across many stores (semanticMemory, userMemory,
// learnedFacts, userPreferences, worldModel, mediaMemory, humanity/mood...).
// That fragmentation meant context for the AI was hand-assembled inline in the
// chat handler, one giant concatenation that was easy to grow and easy to miss a
// store. This module is the ONE place that reads across all stores and returns a
// coherent UserProfile + a context string. Persistence is untouched (each store
// still owns its own file); this only consolidates the READ so the AI sees one
// consistent picture and can't get contradictory context.

const { getUserContext } = require("./userMemory");
const { getPreferences } = require("./userPreferences");
const { getFactsContext } = require("./learnedFacts");
const { getRelevantContext, getProfileContext } = require("./semanticMemory");
const { getWorldContext } = require("./worldModel");

// Build a coherent profile object by reading every memory store for a user.
// Each section is independently guarded so a broken store degrades gracefully
// instead of taking down the whole profile.
function readStores(userId) {
  let user = "", facts = [], preferences = [];
  try { user = getUserContext(userId); } catch (_) {}
  try { preferences = getPreferences(userId); } catch (_) {}
  try { facts = getFactsContext(userId); } catch (_) {}

  let profile = "";
  try { profile = getProfileContext(userId); } catch (_) {}

  let world = "";
  try { world = getWorldContext(userId); } catch (_) {}

  return {
    userMemory: user,
    preferences: Array.isArray(preferences) ? preferences : [],
    facts: Array.isArray(facts) ? facts : [],
    profile,
    world,
    raw: { user, preferences, facts, profile, world },
  };
}

// Build the full AI context string for a message. Deterministic ordering so the
// AI sees stable, coherent sections (person → profile → facts → preferences →
// world → conversation memory). Returns { context, profile }.
function buildUserContext(userId, text) {
  const p = readStores(userId);
  let semantic = "";
  try { semantic = getRelevantContext(userId, text); } catch (_) {}

  const parts = [];
  if (p.userMemory) parts.push(p.userMemory);
  if (semantic) parts.push(semantic);
  if (p.profile) parts.push(p.profile);
  if (p.facts.length) parts.push(`\n\n[Facts I know about you:] ${p.facts}`);
  if (p.preferences.length) parts.push(`\n\n[Your preferences:] ${p.preferences.join("; ")}`);
  if (p.world) parts.push(p.world);

  return {
    context: parts.join("\n"),
    profile: p.raw,
  };
}

module.exports = { readStores, buildUserContext };
