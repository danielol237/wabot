// ── Pokémon Game State ────────────────────────────────────────
// Manages trainers, teams, inventories, battles. Persists to disk.
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { fetchSpecies, getRandomPokemonId, getTypeEffectiveness } = require("./pokemonData");

const DATA_DIR = path.join(__dirname, "../../data");
const STATE_FILE = path.join(DATA_DIR, "pokemon.json");

// In-memory state
let state = { trainers: {}, battles: {} };

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch (e) { console.error("Pokemon state load error:", e.message); }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) { console.error("Pokemon state save error:", e.message); }
}

load();

// ── Trainer ───────────────────────────────────────────────────
function getTrainer(userId) {
  if (!state.trainers[userId]) {
    state.trainers[userId] = {
      id: userId,
      name: "",
      team: [],        // max 6 Pokémon
      pc: [],          // storage
      inventory: { pokeballs: 10, greatballs: 5, ultraballs: 2, potions: 5, superpotions: 3 },
      badges: 0,
      wins: 0,
      losses: 0,
      xp: 0,
      level: 1,
      lastDaily: 0,
      selectedTeam: 0, // which team slot is active for battle
    };
    save();
  }
  return state.trainers[userId];
}

function getXPForLevel(level) {
  return level * level * 100;
}

function addXP(userId, amount) {
  const t = getTrainer(userId);
  t.xp += amount;
  while (t.xp >= getXPForLevel(t.level)) {
    t.xp -= getXPForLevel(t.level);
    t.level++;
  }
  save();
}

// ── Pokémon instances ────────────────────────────────────────
function createPokemonInstance(speciesId, level = 5) {
  return {
    uid: uuidv4().slice(0, 8),
    speciesId,
    level,
    xp: 0,
    nickname: "",
    hp: 0, // calculated on demand
    maxHp: 0,
    attack: 0,
    defense: 0,
    spAttack: 0,
    spDefense: 0,
    speed: 0,
    nature: ["Adamant","Modest","Jolly","Timid","Brave","Bold","Calm","Careful","Sassy","Quiet","Naive","Serious"][Math.floor(Math.random() * 12)],
    friendship: 50,
  };
}

async function recalcStats(pkmn) {
  const species = await fetchSpecies(pkmn.speciesId);
  const level = pkmn.level;
  const natureMods = {
    Adamant: { attack: 1.1, spAttack: 0.9 }, Modest: { spAttack: 1.1, attack: 0.9 },
    Jolly: { speed: 1.1, spAttack: 0.9 }, Timid: { speed: 1.1, attack: 0.9 },
    Brave: { attack: 1.1, speed: 0.9 }, Bold: { defense: 1.1, attack: 0.9 },
    Calm: { spDefense: 1.1, attack: 0.9 }, Careful: { spDefense: 1.1, spAttack: 0.9 },
    Sassy: { spDefense: 1.1, speed: 0.9 }, Quiet: { spAttack: 1.1, speed: 0.9 },
    Naive: { speed: 1.1, spDefense: 0.9 }, Serious: {},
  };
  const mod = natureMods[pkmn.nature] || {};
  pkmn.maxHp = Math.floor((2 * species.stats.hp * level) / 100) + level + 10;
  pkmn.attack = Math.floor(Math.floor((2 * species.stats.attack * level) / 100 + 5) * (mod.attack || 1));
  pkmn.defense = Math.floor(Math.floor((2 * species.stats.defense * level) / 100 + 5) * (mod.defense || 1));
  pkmn.spAttack = Math.floor(Math.floor((2 * species.stats.spAttack * level) / 100 + 5) * (mod.spAttack || 1));
  pkmn.spDefense = Math.floor(Math.floor((2 * species.stats.spDefense * level) / 100 + 5) * (mod.spDefense || 1));
  pkmn.speed = Math.floor(Math.floor((2 * species.stats.speed * level) / 100 + 5) * (mod.speed || 1));
  if (pkmn.hp === 0 || pkmn.hp > pkmn.maxHp) pkmn.hp = pkmn.maxHp;
}

// ── Catch ────────────────────────────────────────────────────
async function attemptCatch(userId, ballType = "pokeball") {
  const t = getTrainer(userId);
  const ballMap = { pokeball: "pokeballs", greatball: "greatballs", ultraball: "ultraballs" };
  const ballKey = ballMap[ballType] || "pokeballs";

  if ((t.inventory[ballKey] || 0) <= 0) return { success: false, error: `No ${ballType}s left!` };

  t.inventory[ballKey]--;
  const speciesId = getRandomPokemonId();
  const species = await fetchSpecies(speciesId);

  // Catch rate based on ball type
  const rates = { pokeball: 0.4, greatball: 0.55, ultraball: 0.7 };
  const caught = Math.random() < (rates[ballType] || 0.4);

  if (caught) {
    const level = Math.floor(Math.random() * 10) + 1;
    const pkmn = createPokemonInstance(speciesId, level);
    await recalcStats(pkmn);

    if (t.team.length < 6) {
      t.team.push(pkmn);
    } else {
      t.pc.push(pkmn);
    }
    save();
    return { success: true, species, pkmn, level, ballType };
  }

  save();
  return { success: false, species, ballType, ranAway: Math.random() < 0.3 };
}

// ── Battle ────────────────────────────────────────────────────
function createBattle(userId1, userId2) {
  const t1 = getTrainer(userId1);
  const t2 = getTrainer(userId2);
  
  if (t1.team.length === 0) return { error: `${userId1} has no Pokémon!` };
  if (t2.team.length === 0) return { error: `${userId2} has no Pokémon!` };

  const battleId = uuidv4().slice(0, 8);
  const battle = {
    id: battleId,
    user1: userId1,
    user2: userId2,
    active1: 0, // index in team
    active2: 0,
    turn: userId1, // who goes first
    state: "active", // active | finished
    winner: null,
    log: [],
  };

  state.battles[battleId] = battle;
  save();
  return { success: true, battleId, battle };
}

async function executeTurn(battleId, userId, action, targetIndex) {
  const battle = state.battles[battleId];
  if (!battle || battle.state !== "active") return { error: "Battle not found or finished." };
  if (battle.turn !== userId) return { error: "Not your turn!" };

  const isUser1 = userId === battle.user1;
  const t1 = getTrainer(battle.user1);
  const t2 = getTrainer(battle.user2);
  const attacker = isUser1 ? t1.team[battle.active1] : t2.team[battle.active2];
  const defender = isUser1 ? t2.team[battle.active2] : t2.team[battle.active1];

  if (!attacker || !defender) return { error: "One side has no active Pokémon." };

  await recalcStats(attacker);
  await recalcStats(defender);

  let result = {};

  if (action === "attack") {
    const aSpecies = await fetchSpecies(attacker.speciesId);
    const dSpecies = await fetchSpecies(defender.speciesId);
    
    // Simple damage formula
    const atkStat = attacker.attack;
    const defStat = defender.defense;
    const basePower = 60;
    const level = attacker.level;
    const stab = aSpecies.types.includes(dSpecies.types[0]) ? 1.5 : 1;
    const typeEff = getTypeEffectiveness(aSpecies.types[0], dSpecies.types);
    const random = 0.85 + Math.random() * 0.15;
    
    let damage = Math.floor((((2 * level / 5 + 2) * basePower * atkStat / defStat) / 50 + 2) * stab * typeEff * random);
    damage = Math.max(1, damage);
    
    defender.hp -= damage;
    
    const effectiveness = typeEff > 1 ? " (Super effective!)" : typeEff < 1 && typeEff > 0 ? " (Not very effective...)" : typeEff === 0 ? " (No effect...)" : "";
    
    result = {
      action: "attack",
      attacker: isUser1 ? "user1" : "user2",
      defender: isUser1 ? "user2" : "user1",
      damage,
      effectiveness: typeEff,
      effectivenessText: effectiveness,
      defenderHp: Math.max(0, defender.hp),
      defenderMaxHp: defender.maxHp,
    };
    battle.log.push(`${attacker.nickname || aSpecies.name} used Tackle! ${damage} damage${effectiveness}`);

    // Check faint
    if (defender.hp <= 0) {
      result.fainted = true;
      battle.log.push(`${defender.nickname || dSpecies.name} fainted!`);
      
      // Check if the loser has more Pokémon
      const loserTeam = isUser1 ? t2.team : t1.team;
      const hasNext = loserTeam.find((p, i) => p.hp > 0 && i !== (isUser1 ? battle.active2 : battle.active1));
      
      if (!hasNext) {
        battle.state = "finished";
        battle.winner = userId;
        const winner = isUser1 ? t1 : t2;
        const loser = isUser1 ? t2 : t1;
        winner.wins++;
        loser.losses++;
        addXP(userId, 50);
        result.battleOver = true;
        result.winner = userId;
        battle.log.push(`${isUser1 ? t1.name || battle.user1 : t2.name || battle.user2} wins!`);
      } else {
        // Auto-switch to next available
        const nextIdx = loserTeam.findIndex((p) => p.hp > 0);
        if (isUser1) battle.active2 = nextIdx;
        else battle.active1 = nextIdx;
        result.switched = true;
      }
    }
  } else if (action === "switch" && targetIndex !== undefined) {
    const team = isUser1 ? t1.team : t2.team;
    if (team[targetIndex] && team[targetIndex].hp > 0) {
      if (isUser1) battle.active1 = targetIndex;
      else battle.active2 = targetIndex;
      const newPkmn = await fetchSpecies(team[targetIndex].speciesId);
      result = { action: "switch", switchedTo: newPkmn.name };
      battle.log.push(`Switched to ${newPkmn.name}!`);
    } else {
      return { error: "Invalid or fainted Pokémon." };
    }
  } else if (action === "run") {
    const ran = Math.random() < 0.5;
    if (ran) {
      battle.state = "finished";
      result = { action: "run", success: true };
      battle.log.push("Ran away successfully!");
    } else {
      result = { action: "run", success: false };
      battle.log.push("Couldn't escape!");
    }
  }

  // Switch turn
  battle.turn = isUser1 ? battle.user2 : battle.user1;
  save();
  return { success: true, result, battle };
}

function getBattleState(battleId) {
  return state.battles[battleId] || null;
}

function getPokemonSummary(pkmn, species) {
  const name = pkmn.nickname || species.name;
  const hpBar = pkmn.maxHp > 0 ? "█".repeat(Math.max(1, Math.round((pkmn.hp / pkmn.maxHp) * 10))) + "░".repeat(Math.max(0, 10 - Math.round((pkmn.hp / pkmn.maxHp) * 10))) : "░".repeat(10);
  return `${name} Lv${pkmn.level} [${pkmn.hp}/${pkmn.maxHp}HP] ${hpBar} (${pkmn.nature})`;
}

module.exports = {
  getTrainer, addXP, attemptCatch, createBattle, executeTurn, getBattleState,
  createPokemonInstance, recalcStats, getPokemonSummary, getXPForLevel,
};
