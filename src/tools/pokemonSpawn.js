// Pokémon Spawn Engine — configurable daily spawn rates
// !pspawn set <N> controls how many wild Pokémon appear per day

const { getTrainer, createMonster, recalc, save, state } = require("./pokemonGame");
const { fetchSpecies, randomId, getSprite } = require("./pokemonData");

const DEFAULT_SPAWNS_PER_DAY = 10;
const MAX_SPAWNS_PER_DAY = 50;
const MIN_SPAWNS_PER_DAY = 1;

// Rarity tiers — higher = rarer
const RARITY_TIERS = {
  common: { weight: 60, minLevel: 1, maxLevel: 20, shinyRate: 0.005 },
  uncommon: { weight: 25, minLevel: 5, maxLevel: 35, shinyRate: 0.01 },
  rare: { weight: 10, minLevel: 15, maxLevel: 50, shinyRate: 0.02 },
  legendary: { weight: 4, minLevel: 30, maxLevel: 70, shinyRate: 0.04 },
  mythical: { weight: 1, minLevel: 40, maxLevel: 85, shinyRate: 0.06 },
};

// Time-of-day type biases
const TIME_TYPES = {
  morning: { boost: ["normal", "flying", "grass"], bias: 1.5 },
  day: { boost: ["fire", "fighting", "ground", "rock"], bias: 1.5 },
  evening: { boost: ["psychic", "dark", "poison"], bias: 1.5 },
  night: { boost: ["dark", "ghost", "water", "ice"], bias: 2.0 },
};

function getTimePeriod() {
  const h = new Date().getHours();
  if (h < 6) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "day";
  if (h < 21) return "evening";
  return "night";
}

function getDayKey() {
  return new Date().toISOString().slice(0, 10); // "2026-07-31"
}

// Get or init spawn config for a user
function getSpawnConfig(uid) {
  if (!state.spawnConfig) state.spawnConfig = {};
  if (!state.spawnConfig[uid]) {
    state.spawnConfig[uid] = {
      dailyLimit: DEFAULT_SPAWNS_PER_DAY,
      enabled: true,
    };
    save();
  }
  // Ensure daily tracking object exists
  if (!state.spawnConfig[uid].daily) state.spawnConfig[uid].daily = {};
  return state.spawnConfig[uid];
}

// Get remaining spawns for today
function getRemainingSpawns(uid) {
  const cfg = getSpawnConfig(uid);
  const day = getDayKey();
  const used = cfg.daily[day]?.used || 0;
  return Math.max(0, cfg.dailyLimit - used);
}

// Check if a spawn is due based on time since last spawn
function isSpawnDue(uid) {
  const cfg = getSpawnConfig(uid);
  if (!cfg.enabled || cfg.dailyLimit <= 0) return false;

  const day = getDayKey();
  const today = cfg.daily[day];
  if (!today) return true; // first spawn of the day

  const used = today.used || 0;
  if (used >= cfg.dailyLimit) return false;

  // Distribute spawns evenly across waking hours (6am - midnight = 18h)
  const hoursActive = 18;
  const intervalMinutes = (hoursActive * 60) / cfg.dailyLimit;
  const minutesSinceLastSpawn = (Date.now() - (today.lastSpawnTime || 0)) / 60000;

  return minutesSinceLastSpawn >= intervalMinutes;
}

// Mark a spawn as consumed
function consumeSpawn(uid) {
  const cfg = getSpawnConfig(uid);
  const day = getDayKey();
  if (!cfg.daily[day]) cfg.daily[day] = { used: 0, lastSpawnTime: 0 };
  cfg.daily[day].used = (cfg.daily[day].used || 0) + 1;
  cfg.daily[day].lastSpawnTime = Date.now();
  save();
}

// Check if the last spawn was a while ago (for the "still waiting" status)
function getTimeUntilNextSpawn(uid) {
  const cfg = getSpawnConfig(uid);
  if (!cfg.enabled || cfg.dailyLimit <= 0) return Infinity;
  const day = getDayKey();
  const today = cfg.daily[day];
  if (!today || !today.lastSpawnTime) return 0;

  const hoursActive = 18;
  const intervalMinutes = (hoursActive * 60) / cfg.dailyLimit;
  const elapsed = (Date.now() - today.lastSpawnTime) / 60000;
  const remaining = Math.max(0, intervalMinutes - elapsed);
  return Math.round(remaining);
}

// Set spawn limit
function setSpawnLimit(uid, limit) {
  const clamped = Math.max(MIN_SPAWNS_PER_DAY, Math.min(MAX_SPAWNS_PER_DAY, limit));
  const cfg = getSpawnConfig(uid);
  cfg.dailyLimit = clamped;
  save();
  return clamped;
}

// Generate a spawn — picks rarity, then species, then creates the mon
async function generateSpawn(uid) {
  const trainer = getTrainer(uid);
  const levelBonus = Math.min(trainer.level, 50); // cap at lv50 bonus

  // Pick rarity based on trainer level
  const roll = Math.random() * 100;
  let rarity = "common";
  let cumulative = 0;
  for (const [key, tier] of Object.entries(RARITY_TIERS)) {
    const effectiveWeight = tier.weight + (key === "legendary" || key === "mythical" ? levelBonus * 0.2 : levelBonus * 0.3);
    cumulative += effectiveWeight;
    if (roll < cumulative) { rarity = key; break; }
  }

  const tier = RARITY_TIERS[rarity];
  const minLv = tier.minLevel + Math.floor(levelBonus * 0.3);
  const maxLv = Math.min(tier.maxLevel + Math.floor(levelBonus * 0.5), 100);
  const level = Math.floor(Math.random() * (maxLv - minLv + 1)) + minLv;

  // Get a random Pokémon ID
  const speciesId = randomId();
  const species = await fetchSpecies(speciesId);
  if (!species || !species.name) return null;

  const mon = createMonster(speciesId, level);
  await recalc(mon);

  // Override shiny based on tier rate + level bonus
  const shinyRate = tier.shinyRate + (levelBonus * 0.0005);
  mon.shiny = Math.random() < shinyRate;

  // Apply time-of-day type boost — if species matches boosted type, extra XP
  const period = getTimePeriod();
  const xpMultiplier = TIME_TYPES[period].boost.includes(species.types?.[0]?.toLowerCase() || "")
    ? 1.5
    : 1.0;

  return {
    species,
    mon,
    rarity,
    xpMultiplier,
    period,
    sprite: getSprite(speciesId),
  };
}

// Get stats for the status display
function getSpawnStats(uid) {
  const cfg = getSpawnConfig(uid);
  const remaining = getRemainingSpawns(uid);
  const nextIn = getTimeUntilNextSpawn(uid);
  const day = getDayKey();
  const today = cfg.daily[day];

  return {
    dailyLimit: cfg.dailyLimit,
    remaining,
    totalToday: today?.used || 0,
    nextSpawnMinutes: nextIn,
    enabled: cfg.enabled,
  };
}

module.exports = {
  getSpawnConfig,
  getRemainingSpawns,
  isSpawnDue,
  consumeSpawn,
  setSpawnLimit,
  generateSpawn,
  getSpawnStats,
  getTimePeriod,
  DEFAULT_SPAWNS_PER_DAY,
  MAX_SPAWNS_PER_DAY,
};
