// Pokémon Spawn Engine v2 — GLOBAL spawn system
// !pspawn (owner only) controls global spawn rate
// Wild Pokémon appear randomly in active chats

const { getTrainer, createMonster, recalc, save, state } = require("./pokemonGame");
const { fetchSpecies, randomId, getSprite, getArtwork } = require("./pokemonData");

const DEFAULT_SPAWNS_PER_DAY = 20;
const MAX_SPAWNS_PER_DAY = 100;
const MIN_SPAWNS_PER_DAY = 0;

// Rarity tiers — higher weight = more common
const RARITY_TIERS = [
  { key: "common", weight: 50, minLevel: 1, maxLevel: 25, shinyRate: 0.003, emoji: "⬜", label: "Common" },
  { key: "uncommon", weight: 25, minLevel: 5, maxLevel: 40, shinyRate: 0.008, emoji: "🟩", label: "Uncommon" },
  { key: "rare", weight: 15, minLevel: 10, maxLevel: 55, shinyRate: 0.015, emoji: "🟦", label: "Rare" },
  { key: "super_rare", weight: 7, minLevel: 20, maxLevel: 70, shinyRate: 0.025, emoji: "🟪", label: "Super Rare" },
  { key: "legendary", weight: 2.5, minLevel: 35, maxLevel: 85, shinyRate: 0.04, emoji: "🟥", label: "LEGENDARY" },
  { key: "mythical", weight: 0.5, minLevel: 50, maxLevel: 100, shinyRate: 0.08, emoji: "🌟", label: "MYTHICAL" },
];

// Time-of-day type biases
const TIME_TYPES = {
  dawn: { hours: [4, 5, 6], boost: ["normal", "flying", "psychic"], emoji: "🌅" },
  morning: { hours: [7, 8, 9, 10, 11], boost: ["grass", "bug", "fairy"], emoji: "☀️" },
  day: { hours: [12, 13, 14, 15, 16, 17], boost: ["fire", "fighting", "ground", "rock"], emoji: "🌞" },
  evening: { hours: [18, 19, 20], boost: ["psychic", "dark", "poison"], emoji: "🌆" },
  night: { hours: [21, 22, 23, 0, 1, 2, 3], boost: ["dark", "ghost", "water", "ice"], emoji: "🌙" },
};

function getTimePeriod() {
  const h = new Date().getHours();
  for (const [period, data] of Object.entries(TIME_TYPES)) {
    if (data.hours.includes(h)) return { ...data, name: period };
  }
  return { ...TIME_TYPES.day, name: "day" };
}

function getDayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ── Global spawn tracking ───────────────────────────────────
function getGlobalSpawnConfig() {
  if (!state.globalSpawn) {
    state.globalSpawn = {
      dailyLimit: DEFAULT_SPAWNS_PER_DAY,
      enabled: true,
      daily: {},
    };
    save();
  }
  return state.globalSpawn;
}

function getTodaySpawns() {
  const cfg = getGlobalSpawnConfig();
  const day = getDayKey();
  if (!cfg.daily[day]) {
    cfg.daily[day] = { used: 0, lastSpawnTime: 0 };
    save();
  }
  return cfg.daily[day];
}

function getRemainingSpawns() {
  const cfg = getGlobalSpawnConfig();
  const day = getDayKey();
  const used = cfg.daily[day]?.used || 0;
  return Math.max(0, cfg.dailyLimit - used);
}

function isSpawnDue() {
  const cfg = getGlobalSpawnConfig();
  if (!cfg.enabled || cfg.dailyLimit <= 0) return false;

  const today = getTodaySpawns();
  if (today.used >= cfg.dailyLimit) return false;

  // Distribute across 24 hours
  const intervalMinutes = (24 * 60) / cfg.dailyLimit;
  const minutesSinceLast = (Date.now() - today.lastSpawnTime) / 60000;
  return minutesSinceLast >= intervalMinutes;
}

function consumeSpawn() {
  const today = getTodaySpawns();
  today.used = (today.used || 0) + 1;
  today.lastSpawnTime = Date.now();
  save();
}

function setSpawnLimit(limit) {
  const clamped = Math.max(MIN_SPAWNS_PER_DAY, Math.min(MAX_SPAWNS_PER_DAY, limit));
  getGlobalSpawnConfig().dailyLimit = clamped;
  save();
  return clamped;
}

function getSpawnStats() {
  const cfg = getGlobalSpawnConfig();
  const remaining = getRemainingSpawns();
  const today = getTodaySpawns();
  const hoursActive = 24;
  const intervalMin = (hoursActive * 60) / Math.max(cfg.dailyLimit, 1);
  const elapsed = (Date.now() - today.lastSpawnTime) / 60000;
  const nextIn = Math.max(0, Math.round(intervalMin - elapsed));

  return {
    dailyLimit: cfg.dailyLimit,
    remaining,
    totalToday: today.used || 0,
    nextSpawnMinutes: nextIn,
    enabled: cfg.enabled,
    intervalMin: Math.round(intervalMin),
  };
}

// ── Spawn generation ────────────────────────────────────────
async function generateSpawn() {
  const cfg = getGlobalSpawnConfig();

  // Pick rarity with weighted random
  const totalWeight = RARITY_TIERS.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * totalWeight;
  let selectedTier = RARITY_TIERS[0];
  for (const tier of RARITY_TIERS) {
    roll -= tier.weight;
    if (roll <= 0) { selectedTier = tier; break; }
  }

  const tier = selectedTier;
  const level = Math.floor(Math.random() * (tier.maxLevel - tier.minLevel + 1)) + tier.minLevel;

  const speciesId = randomId();
  const species = await fetchSpecies(speciesId);
  if (!species || !species.name) return null;

  const mon = createMonster(speciesId, level);
  await recalc(mon);

  // Shiny
  mon.shiny = Math.random() < tier.shinyRate;

  // Time-of-day boost
  const period = getTimePeriod();
  const primaryType = (species.types?.[0] || "").toLowerCase();
  const hasTypeBoost = period.boost.includes(primaryType);
  const xpMultiplier = hasTypeBoost ? 2.0 : 1.0;

  // Elite stats boost for rare+
  if (tier.key === "legendary" || tier.key === "mythical") {
    mon.ivs = { hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31, speed: 31 };
    await recalc(mon);
  }
  if (tier.key === "super_rare") {
    mon.ivs.hp = Math.max(mon.ivs.hp, 25);
    mon.ivs.attack = Math.max(mon.ivs.attack, 25);
    mon.ivs.defense = Math.max(mon.ivs.defense, 25);
    await recalc(mon);
  }

  return {
    species,
    mon,
    tier,
    xpMultiplier,
    period,
    sprite: getSprite(speciesId),
    artwork: getArtwork(speciesId),
    hasTypeBoost,
  };
}

module.exports = {
  getGlobalSpawnConfig, getSpawnStats, getRemainingSpawns,
  isSpawnDue, consumeSpawn, setSpawnLimit,
  generateSpawn, getTimePeriod,
  DEFAULT_SPAWNS_PER_DAY, MAX_SPAWNS_PER_DAY,
};
