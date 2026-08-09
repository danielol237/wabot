// ── Pokémon Game Engine v2 ──────────────────────────────────
// Trainers, wild encounters, battles, PC, trading, evolution, items.

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { fetchSpecies, randomId, getEffectiveness, ITEMS } = require("./pokemonData");
const { getMovesForTypes } = require("./pokemonMoves");

const FILE = path.join(__dirname, "../../data/pokemon.json");
let state = { trainers: {}, battles: {}, trades: {} };

function load() {
  try { if (fs.existsSync(FILE)) state = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {}
}
function save() {
  try { fs.writeFileSync(FILE, JSON.stringify(state, null, 2)); } catch (e) { console.error("Save error:", e.message); }
}
load();

// ── Helpers ─────────────────────────────────────────────────
function uid() { return uuidv4().slice(0, 8); }

const NATURES = ["Adamant","Modest","Jolly","Timid","Brave","Bold","Calm","Careful","Sassy","Quiet","Naive","Serious"];

const NATURE_MODS = {
  Adamant: { atk: 1.1, spa: 0.9 }, Modest: { spa: 1.1, atk: 0.9 },
  Jolly: { spe: 1.1, spa: 0.9 }, Timid: { spe: 1.1, atk: 0.9 },
  Brave: { atk: 1.1, spe: 0.9 }, Bold: { def: 1.1, atk: 0.9 },
  Calm: { spd: 1.1, atk: 0.9 }, Careful: { spd: 1.1, spa: 0.9 },
  Sassy: { spd: 1.1, spe: 0.9 }, Quiet: { spa: 1.1, spe: 0.9 },
  Naive: { spe: 1.1, spd: 0.9 }, Serious: {},
};

function calcStats(species, level, nature, ivs, evs) {
  const mod = NATURE_MODS[nature] || {};
  ivs = ivs || { hp: 15, attack: 15, defense: 15, spAttack: 15, spDefense: 15, speed: 15 };
  evs = evs || { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
  return {
    maxHp: Math.floor((2 * (species.stats.hp + (ivs.hp || 15)) * level) / 100) + level + 10 + Math.floor((evs.hp || 0) / 4),
    attack: Math.floor(Math.floor((2 * (species.stats.attack + (ivs.attack || 15)) * level) / 100 + 5) * (mod.atk || 1)) + Math.floor((evs.attack || 0) / 4),
    defense: Math.floor(Math.floor((2 * (species.stats.defense + (ivs.defense || 15)) * level) / 100 + 5) * (mod.def || 1)) + Math.floor((evs.defense || 0) / 4),
    spAttack: Math.floor(Math.floor((2 * (species.stats.spAttack + (ivs.spAttack || 15)) * level) / 100 + 5) * (mod.spa || 1)) + Math.floor((evs.spAttack || 0) / 4),
    spDefense: Math.floor(Math.floor((2 * (species.stats.spDefense + (ivs.spDefense || 15)) * level) / 100 + 5) * (mod.spd || 1)) + Math.floor((evs.spDefense || 0) / 4),
    speed: Math.floor(Math.floor((2 * (species.stats.speed + (ivs.speed || 15)) * level) / 100 + 5) * (mod.spe || 1)) + Math.floor((evs.speed || 0) / 4),
  };
}

// ── Trainer ─────────────────────────────────────────────────
function getTrainer(uid) {
  if (!state.trainers[uid]) {
    state.trainers[uid] = {
      uid, name: "", level: 1, xp: 0, wins: 0, losses: 0,
      team: [], pc: [], badges: [],
      items: { pokeball: 15, greatball: 5, potion: 5, superpotion: 2 },
      lastDaily: 0, coins: 500,
    };
    save();
  }
  return state.trainers[uid];
}

function xpForLevel(l) { return l * l * 100; }

function addXP(uid, amt) {
  const t = getTrainer(uid);
  t.xp += amt;
  while (t.xp >= xpForLevel(t.level)) { t.xp -= xpForLevel(t.level); t.level++; }
  save();
}

// ── Create Monster ──────────────────────────────────────────
async function createMonster(speciesId, level) {
  const s = await fetchSpecies(speciesId);
  const mon = { uid: uid(), speciesId, level, xp: 0, nickname: "", hp: 0, maxHp: 0,
    attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0,
    nature: NATURES[Math.floor(Math.random() * NATURES.length)],
    friendship: 50, shiny: Math.random() < 0.01, evoStone: null, mega: false,
    ivs: { hp: Math.floor(Math.random() * 32), attack: Math.floor(Math.random() * 32), defense: Math.floor(Math.random() * 32),
      spAttack: Math.floor(Math.random() * 32), spDefense: Math.floor(Math.random() * 32), speed: Math.floor(Math.random() * 32) },
    evs: { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 },
    moves: getMovesForTypes(s.types, level).slice(0, 4) };
  // Wire up the ability/held-item battle systems (they were fully implemented but
  // never assigned, so they had zero effect). Monsters gain them at higher levels
  // to keep early-game encounters simple.
  if (level >= 5) {
    const { getRandomAbility, getRandomHeldItem } = require("./pokemonAbilities");
    mon.ability = getRandomAbility().name;
    if (level >= 10) mon.heldItem = getRandomHeldItem().name;
  }
  return mon;
}

async function recalc(mon) {
  const s = await fetchSpecies(mon.speciesId);
  const st = calcStats(s, mon.level, mon.nature, mon.ivs, mon.evs);
  mon.maxHp = st.maxHp; mon.attack = st.attack; mon.defense = st.defense;
  mon.spAttack = st.spAttack; mon.spDefense = st.spDefense; mon.speed = st.speed;
  if (mon.hp === 0 || mon.hp > mon.maxHp) mon.hp = mon.maxHp;
  return s;
}

// ── Wild Encounter ──────────────────────────────────────────
async function wildEncounter(uid) {
  const id = randomId();
  const species = await fetchSpecies(id);
  const level = Math.floor(Math.random() * 15) + 1;
  const mon = await createMonster(id, level);
  await recalc(mon);
  return { species, mon };
}

async function attemptCatch(uid, mon, ballType) {
  const t = getTrainer(uid);
  const item = ITEMS[ballType];
  if (!item || item.type !== "ball") return { success: false, error: "Not a valid ball." };
  if (!t.items[ballType] || t.items[ballType] <= 0) return { success: false, error: `No ${item.name}s left!` };
  t.items[ballType]--;
  const rate = item.catchRate * (1 - (mon.maxHp - mon.hp) / mon.maxHp * 0.5);
  const caught = Math.random() < Math.min(rate * 0.15, 0.85);
  if (caught) {
    mon.hp = mon.maxHp;
    if (t.team.length < 6) t.team.push(mon);
    else t.pc.push(mon);
    save();
    return { success: true, mon };
  }
  save();
  return { success: false, ranAway: Math.random() < 0.2 };
}

// ── Battle ──────────────────────────────────────────────────
// ── PvP Queue ─────────────────────────────────────────────
function getQueue() {
  if (!state.battleQueue) state.battleQueue = [];
  return state.battleQueue;
}

function joinQueue(uid) {
  const queue = getQueue();
  // Check if already in queue
  if (queue.includes(uid)) return { error: "Already in queue!" };
  
  // Check if someone's waiting
  if (queue.length > 0) {
    const opponent = queue.shift();
    save();
    const result = createBattle(uid, opponent);
    if (result.success) {
      return { success: true, battleId: result.id, opponent };
    }
    return { error: "Battle creation failed." };
  }
  
  queue.push(uid);
  save();
  return { success: true, position: queue.length };
}

function leaveQueue(uid) {
  const queue = getQueue();
  const idx = queue.indexOf(uid);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  save();
  return true;
}

function getQueueSize() {
  return getQueue().length;
}

function createBattle(uid1, uid2) {
  const t1 = getTrainer(uid1), t2 = getTrainer(uid2);
  if (t1.team.length === 0) return { error: "No Pokémon in party!" };
  if (t2.team.length === 0) return { error: "They have no Pokémon!" };
  const id = uid();
  
  // Init weather
  const weather = { type: "clear", turnsLeft: 0 };
  
  // Check for weather abilities on active mons
  const mon1 = t1.team[0], mon2 = t2.team[0];
  for (const mon of [mon1, mon2]) {
    const weatherType = checkWeatherAbilities(mon);
    if (weatherType) {
      weather.type = weatherType;
      weather.turnsLeft = WEATHER_TYPES[weatherType]?.duration || 5;
      break; // First weather ability sets the weather
    }
  }
  
  state.battles[id] = {
    id, uid1, uid2, active1: 0, active2: 0, turn: uid1,
    state: "active", winner: null, log: [], weather,
  };
  
  // Apply Intimidate on switch-in
  for (const [isAttacker, mon, oppMon] of [[true, mon1, mon2], [false, mon2, mon1]]) {
    const abilResult = applyAbility(mon.ability, "switchIn", mon, oppMon, null);
    if (abilResult.effect?.type === "debuff") {
      const stat = abilResult.effect.stat;
      const mul = abilResult.effect.multiplier;
      if (stat === "attack") oppMon.attack = Math.floor(oppMon.attack * mul);
      if (stat === "defense") oppMon.defense = Math.floor(oppMon.defense * mul);
      if (stat === "spAttack") oppMon.spAttack = Math.floor(oppMon.spAttack * mul);
      if (stat === "speed") oppMon.speed = Math.floor(oppMon.speed * mul);
    }
  }
  
  save();
  return { success: true, id };
}

// Status effects data
const STATUS_EFFECTS = {
  burn: { name: "Burn", icon: "🔥", dmgPct: 0.0625, atkReduction: 0.5, chance: 0.1 },
  poison: { name: "Poison", icon: "☠️", dmgPct: 0.125, atkReduction: 0, chance: 0.1 },
  paralysis: { name: "Paralysis", icon: "⚡", dmgPct: 0, atkReduction: 0, speedReduction: 0.5, chance: 0.1, missChance: 0.25 },
  sleep: { name: "Sleep", icon: "💤", dmgPct: 0, atkReduction: 0, turns: 3, chance: 0.08 },
  freeze: { name: "Freeze", icon: "❄️", dmgPct: 0, atkReduction: 0, chance: 0.05 },
};

// ── Weather System ──────────────────────────────────────────
const WEATHER_TYPES = {
  clear: { name: "Clear", emoji: "☀️", duration: 0 },
  rain: { name: "Rain", emoji: "🌧️", duration: 5, boostType: "water", resistType: "fire", boostMul: 1.5, resistMul: 0.5 },
  sun: { name: "Sun", emoji: "☀️", duration: 5, boostType: "fire", resistType: "water", boostMul: 1.5, resistMul: 0.5 },
  sandstorm: { name: "Sandstorm", emoji: "🌪️", duration: 5, chipDmg: 0.0625, chipTypes: ["rock", "ground", "steel"] },
  hail: { name: "Hail", emoji: "❄️", duration: 5, chipDmg: 0.0625, chipTypes: ["ice"] },
};

function initWeather(battleId) {
  const b = state.battles[battleId];
  if (!b) return;
  b.weather = { type: "clear", turnsLeft: 0 };
}

function checkWeatherAbilities(mon) {
  // Called when a mon enters battle — checks for weather-summoning abilities
  if (!mon.ability) return null;
  const abil = require("./pokemonAbilities").getAbility(mon.ability);
  if (!abil || abil.type !== "weather") return null;
  return abil.weather;
}

function getWeatherDamage(monType, weather) {
  if (weather.type === "sandstorm" && !weather.chipTypes.includes(monType)) {
    return Math.max(1, Math.floor(weather.chipDmg * 100));
  }
  if (weather.type === "hail" && !weather.chipTypes.includes(monType)) {
    return Math.max(1, Math.floor(weather.chipDmg * 100));
  }
  return 0;
}

function applyWeatherBoosts(moveType, weather) {
  if (moveType === weather.boostType) return weather.boostMul || 1;
  if (moveType === weather.resistType) return weather.resistMul || 1;
  return 1;
}

// ── Ability Activation ─────────────────────────────────────
function applyAbility(abilityName, context, att, def, move) {
  if (!abilityName) return { effect: null, messages: [] };
  const abil = require("./pokemonAbilities").getAbility(abilityName);
  if (!abil) return { effect: null, messages: [] };
  
  const msg = [];
  let effect = null;
  
  switch (abil.type) {
    case "boost":
      if (abil.condition === "lowHp" && att.hp < att.maxHp * 0.3) {
        if (abil.stat === "attack" || abil.stat === "spAttack" || abil.stat === "defense" || abil.stat === "spDefense" || abil.stat === "speed") {
          effect = { type: "statBoost", stat: abil.stat, multiplier: abil.multiplier };
        } else if (move && abil.stat === move.type) {
          effect = { type: "damageBoost", multiplier: abil.multiplier };
        }
      }
      if (abil.condition === "statused" && att.status) {
        effect = { type: "statBoost", stat: abil.stat, multiplier: abil.multiplier };
      }
      break;
    case "debuff":
      if (context === "switchIn") {
        effect = { type: "debuff", target: "opponent", stat: abil.stat, multiplier: abil.multiplier };
        msg.push(`💪 ${abil.name}: ${abil.desc}`);
      }
      break;
    case "contact":
      if (context === "hit" && move?.cat === "physical") {
        if (Math.random() < (abil.chance || 0.3)) {
          effect = { type: "status", status: abil.effect };
          msg.push(`⚡ ${abil.name}: ${abil.desc}`);
        }
      }
      break;
    case "immunity":
      if (context === "hit" && move?.type === abil.immune) {
        effect = { type: "immune" };
        msg.push(`🛡️ ${abil.name}: Immune to ${abil.immune} moves!`);
      }
      break;
    case "survive":
      if (context === "takingDamage" && att.hp <= 0 && (!abil.condition || abil.condition === "fullHp")) {
        att.hp = 1;
        effect = { type: "survive" };
        msg.push(`💪 ${abil.name}: Survived the hit!`);
      }
      break;
    case "statUp":
      if (context === "turnEnd") {
        effect = { type: "statUp", stat: abil.stat, amount: abil.amount };
        msg.push(`⚡ ${abil.name}: ${abil.stat} rose!`);
      }
      break;
  }
  
  return { effect, messages: msg };
}

// ── Held Item Activation ───────────────────────────────────
function applyHeldItem(itemName, context, holder, opponent, move) {
  if (!itemName) return { effect: null, messages: [] };
  const item = require("./pokemonAbilities").getHeldItem(itemName);
  if (!item) return { effect: null, messages: [] };
  
  const msg = [];
  let effect = null;
  
  switch (item.type) {
    case "regen":
      if (context === "turnEnd") {
        const heal = Math.max(1, Math.floor(holder.maxHp * item.amount));
        holder.hp = Math.min(holder.maxHp, holder.hp + heal);
        effect = { type: "heal", amount: heal };
        msg.push(`💚 ${item.name}: Restored ${heal} HP!`);
      }
      break;
    case "boost":
      if (context === "damageCalc" && move) {
        if (item.stat === "damage") {
          effect = { type: "damageBoost", multiplier: item.multiplier };
          if (item.drawback === "recoil") {
            const recoil = Math.max(1, Math.floor(holder.maxHp * 0.1));
            holder.hp -= recoil;
            msg.push(`💥 ${item.name}: Damage up! (-${recoil} HP recoil)`);
          }
        } else if (item.stat === move.type) {
          effect = { type: "damageBoost", multiplier: item.multiplier };
          msg.push(`🔥 ${item.name}: ${move.type} moves boosted!`);
        } else if (["attack", "defense", "spAttack", "spDefense", "speed"].includes(item.stat)) {
          effect = { type: "statBoost", stat: item.stat, multiplier: item.multiplier };
        }
      }
      break;
    case "survive":
      if (context === "takingDamage" && holder.hp <= 0 && item.condition === "fullHp" && holder.hp >= holder.maxHp) {
        holder.hp = 1;
        effect = { type: "survive" };
        msg.push(`🛡️ ${item.name}: Survived!`);
      }
      break;
    case "contact":
      if (context === "hit" && move?.cat === "physical") {
        const dmg = Math.max(1, Math.floor(opponent.maxHp * item.damage));
        opponent.hp -= dmg;
        msg.push(`💥 ${item.name}: ${dmg} damage to attacker!`);
      }
      break;
  }
  
  return { effect, messages: msg };
}

// Move types that can cause status
const STATUS_MOVES = {
  fire: "burn", thunder: "paralysis", ice: "freeze",
  poison: "poison", "poison-powder": "poison", "toxic": "poison",
  "will-o-wisp": "burn", "thunder-wave": "paralysis", "spore": "sleep",
  "hypnosis": "sleep", "sleep-powder": "sleep", "lovely-kiss": "sleep",
  "dark-void": "sleep", "grass-whistle": "sleep", "sing": "sleep",
};

function applyStatusEffect(defMon, moveType) {
  if (defMon.status) return false; // Already has a status
  const status = STATUS_MOVES[moveType] || 
    (Math.random() < 0.05 ? (["burn", "poison", "paralysis"][Math.floor(Math.random() * 3)]) : null);
  if (!status) return false;
  const data = STATUS_EFFECTS[status];
  if (Math.random() < (data.chance || 0.1)) {
    defMon.status = status;
    defMon.statusTurns = status === "sleep" ? (data.turns || 3) : 0;
    return true;
  }
  return false;
}

function processStatus(mon) {
  const result = { damaged: false, wokeUp: false, thawed: false, paralyzed: false };
  if (!mon.status) return result;
  
  if (mon.status === "sleep") {
    mon.statusTurns--;
    if (mon.statusTurns <= 0 || Math.random() < 0.2) {
      mon.status = null;
      result.wokeUp = true;
    }
    return result;
  }
  
  if (mon.status === "freeze" && Math.random() < 0.2) {
    mon.status = null;
    result.thawed = true;
    return result;
  }
  
  if (mon.status === "burn") {
    const dmg = Math.max(1, Math.floor(mon.maxHp * STATUS_EFFECTS.burn.dmgPct));
    mon.hp -= dmg;
    result.damaged = dmg;
  }
  
  if (mon.status === "poison") {
    const dmg = Math.max(1, Math.floor(mon.maxHp * STATUS_EFFECTS.poison.dmgPct));
    mon.hp -= dmg;
    result.damaged = dmg;
  }
  
  return result;
}

function isParalyzed(mon) {
  return mon.status === "paralysis" && Math.random() < 0.25;
}

async function battleAction(battleId, uid, action, data) {
  const b = state.battles[battleId];
  if (!b || b.state !== "active") return { error: "Battle not found or over." };
  if (b.turn !== uid) return { error: "Wait your turn!" };

  const isU1 = uid === b.uid1;
  const t1 = getTrainer(b.uid1), t2 = getTrainer(b.uid2);
  const att = isU1 ? t1.team[b.active1] : t2.team[b.active2];
  // Defender is always the OTHER trainer's active Pokémon. (Bug fix: player 2
  // was reading their own team[active1] instead of player 1's active.)
  const def = isU1 ? t2.team[b.active2] : t1.team[b.active1];
  if (!att || !def) return { error: "Missing Pokémon." };

  await recalc(att); await recalc(def);
  const aS = await fetchSpecies(att.speciesId);
  const dS = await fetchSpecies(def.speciesId);

  if (action === "attack") {
    // Process attacker's status effects (burn damage, sleep check, etc)
    const attStatus = processStatus(att);
    if (att.status === "sleep") {
      b.turn = isU1 ? b.uid2 : b.uid1;
      save();
      return { success: true, result: { action: "asleep", name: aS.name, wokeUp: attStatus.wokeUp } };
    }
    if (isParalyzed(att)) {
      b.turn = isU1 ? b.uid2 : b.uid1;
      save();
      return { success: true, result: { action: "paralyzed", name: aS.name } };
    }
    if (att.status === "freeze") {
      if (!attStatus.thawed) {
        b.turn = isU1 ? b.uid2 : b.uid1;
        save();
        return { success: true, result: { action: "frozen", name: aS.name } };
      }
    }
    
    // Process defender's status effects (burn/poison damage before attack lands)
    const defStatus = processStatus(def);
    
    // Use selected move or default to first move
    const moveIdx = (data !== undefined) ? data : 0;
    const move = att.moves?.[moveIdx] || { name: "Tackle", type: "normal", power: 40, cat: "physical" };
    
    const atkStat = move.cat === "physical" ? att.attack : att.spAttack;
    const defStat = move.cat === "physical" ? def.defense : def.spDefense;
    const basePower = move.power || 40;
    const stab = aS.types.includes(move.type) ? 1.5 : 1;
    const typeEff = getEffectiveness(move.type, dS.types);
    
    // Accuracy check
    const acc = (move.acc || 100) / 100;
    if (Math.random() > acc) {
      b.turn = isU1 ? b.uid2 : b.uid1;
      save();
      return { success: true, result: { action: "miss", attName: aS.name, moveName: move.name, attSprite: aS.sprite } };
    }
    
    // Apply attack reduction from burn
    const effectiveAtk = (att.status === "burn" && move.cat === "physical") ? Math.floor(atkStat * 0.5) : atkStat;
    
    const dmg = Math.max(1, Math.floor(((2 * att.level / 5 + 2) * basePower * effectiveAtk / defStat) / 50 + 2) * stab * typeEff * (0.85 + Math.random() * 0.15));
    def.hp -= dmg;
    
    const effText = typeEff > 1 ? "💥 Super effective!" : typeEff < 1 && typeEff > 0 ? "⚠️ Not very effective..." : typeEff === 0 ? "❌ No effect!" : "";
    const crit = Math.random() < 0.0625;
    
    // Apply status effect from move
    const statusApplied = applyStatusEffect(def, move.type);

    b.log.push({ action: "attack", attacker: isU1 ? 1 : 2, move: move.name, damage: dmg, crit });

    let result = { action: "attack", moveName: move.name, damage: dmg, effectiveness: typeEff, crit, attSprite: aS.sprite, defSprite: dS.sprite, attName: aS.name, defName: dS.name, moveType: move.type };
    result.description = `${aS.name} used ${move.name}!${crit ? " 💥 Critical hit!" : ""}${effText ? " " + effText : ""} (${dmg} DMG)${statusApplied ? " " + STATUS_EFFECTS[def.status].icon + " " + def.status : ""}`;

    if (def.hp <= 0) {
      result.fainted = dS.name;
      b.log.push({ action: "faint", mon: b.active2 });
      const next = (isU1 ? t2.team : t1.team).findIndex((p, i) => p.hp > 0 && i !== (isU1 ? b.active2 : b.active1));
      if (next === -1) {
        b.state = "finished"; b.winner = uid;
        (isU1 ? t1 : t2).wins++; (isU1 ? t2 : t1).losses++;
        addXP(uid, 50);
        result.battleOver = true; result.winner = uid;
        b.log.push({ action: "win", winner: uid });
      } else {
        if (isU1) b.active2 = next; else b.active1 = next;
        result.switched = true;
      }
    }
    b.turn = isU1 ? b.uid2 : b.uid1;
    save();
    return { success: true, result, battleId };
  }

  if (action === "switch") {
    const team = isU1 ? t1.team : t2.team;
    if (data < 0 || data >= team.length || team[data].hp <= 0) return { error: "Invalid switch target." };
    if (isU1) b.active1 = data; else b.active2 = data;
    const ns = await fetchSpecies(team[data].speciesId);
    b.turn = isU1 ? b.uid2 : b.uid1;
    b.log.push({ action: "switch", mon: data });
    save();
    return { success: true, result: { action: "switch", name: ns.name, sprite: ns.sprite } };
  }

  if (action === "run") {
    const ran = Math.random() < 0.5;
    if (ran) { b.state = "finished"; save(); return { success: true, result: { action: "run", success: true } }; }
    b.turn = isU1 ? b.uid2 : b.uid1;
    save();
    return { success: true, result: { action: "run", success: false } };
  }

  return { error: "Unknown action." };
}

// ── PC & Storage ────────────────────────────────────────────
function moveToPC(uid, teamIdx) {
  const t = getTrainer(uid);
  if (teamIdx < 0 || teamIdx >= t.team.length) return { error: "Invalid index." };
  if (t.team.length <= 1) return { error: "Must keep at least 1 Pokémon." };
  t.pc.push(t.team.splice(teamIdx, 1)[0]);
  save();
  return { success: true };
}

function moveToTeam(uid, pcIdx) {
  const t = getTrainer(uid);
  if (pcIdx < 0 || pcIdx >= t.pc.length) return { error: "Invalid index." };
  if (t.team.length >= 6) return { error: "Team is full (max 6)." };
  t.team.push(t.pc.splice(pcIdx, 1)[0]);
  save();
  return { success: true };
}

function swapTeam(uid, i, j) {
  const t = getTrainer(uid);
  if (i < 0 || i >= t.team.length || j < 0 || j >= t.team.length) return { error: "Invalid indices." };
  [t.team[i], t.team[j]] = [t.team[j], t.team[i]];
  save();
  return { success: true };
}

// ── Evolution ───────────────────────────────────────────────
// Fetches evolution chain from PokeAPI to find the correct next form
const evoCache = new Map();

async function getEvoChain(speciesId) {
  if (evoCache.has(speciesId)) return evoCache.get(speciesId);
  try {
    const sr = await require("axios").get(`https://pokeapi.co/api/v2/pokemon-species/${speciesId}`, { timeout: 5000 });
    const chainUrl = sr.data.evolution_chain?.url;
    if (!chainUrl) { evoCache.set(speciesId, null); return null; }
    const cr = await require("axios").get(chainUrl, { timeout: 5000 });
    const chain = cr.data.chain;
    
    // Find the current species in the chain and get next evolution
    function findEvo(node, targetId, currentLevel) {
      const nodeId = parseInt(node.species.url.split("/").slice(-2, -1)[0]);
      if (nodeId === targetId) {
        if (node.evolves_to.length > 0) {
          const next = node.evolves_to[0];
          const nextId = parseInt(next.species.url.split("/").slice(-2, -1)[0]);
          const minLevel = next.evolution_details?.[0]?.min_level || 16;
          const item = next.evolution_details?.[0]?.item?.name || (node.evolves_to.length > 1 ? "multiple" : null);
          return { nextId, minLevel, item, hasBranch: node.evolves_to.length > 1 };
        }
        return null;
      }
      for (const ev of node.evolves_to) {
        const result = findEvo(ev, targetId, currentLevel);
        if (result) return result;
      }
      return null;
    }
    
    const result = findEvo(chain, speciesId, 0);
    evoCache.set(speciesId, result);
    return result;
  } catch { return null; }
}

async function evolve(uid, teamIdx, stone) {
  const t = getTrainer(uid);
  const mon = t.team[teamIdx];
  if (!mon) return { error: "Invalid Pokémon." };

  const evoData = await getEvoChain(mon.speciesId);
  if (!evoData) return { error: "This Pokémon can't evolve further." };
  
  // Check stone requirement
  if (evoData.item && evoData.item !== "multiple") {
    if (!stone || stone.toLowerCase() !== evoData.item) {
      return { error: `${mon.name} needs a ${evoData.item.replace("-", " ")} to evolve!` };
    }
  }
  
  // Level check
  if (mon.level < evoData.minLevel) {
    return { error: `Need level ${evoData.minLevel} to evolve (currently ${mon.level}).` };
  }

  const oldSpecies = await fetchSpecies(mon.speciesId);
  const newSpecies = await fetchSpecies(evoData.nextId);
  if (!newSpecies) return { error: "Evolution data unavailable." };

  const oldName = oldSpecies.name;
  const newName = newSpecies.name;
  
  mon.speciesId = evoData.nextId;
  await recalc(mon);
  save();
  return { success: true, oldName, newName, sprite: newSpecies.sprite, artwork: newSpecies.artwork };
}

// ── Healing ─────────────────────────────────────────────────
function healAll(uid) {
  const t = getTrainer(uid);
  let count = 0;
  for (const m of [...t.team, ...t.pc]) {
    if (m.hp < m.maxHp) { m.hp = m.maxHp; count++; }
  }
  if (count > 0) save();
  return count;
}

function useItem(uid, itemName, teamIdx) {
  const t = getTrainer(uid);
  const item = ITEMS[itemName];
  if (!item) return { error: "Unknown item." };
  if (!t.items[itemName] || t.items[itemName] <= 0) return { error: "No " + item.name + " left!" };

  if (item.type === "heal" && teamIdx !== undefined) {
    const mon = t.team[teamIdx] || t.pc[teamIdx - 100];
    if (!mon) return { error: "Invalid target." };
    mon.hp = Math.min(mon.maxHp, mon.hp + (item.healAmt || 9999));
    t.items[itemName]--;
    save();
    return { success: true, heal: item.healAmt, name: item.name };
  }

  if (item.type === "level" && teamIdx !== undefined) {
    const mon = t.team[teamIdx];
    if (!mon) return { error: "Invalid target." };
    mon.level++;
    recalc(mon);
    t.items[itemName]--;
    save();
    return { success: true, newLevel: mon.level, name: item.name };
  }

  return { error: "Can't use that item here." };
}

// ── Trading ─────────────────────────────────────────────────
function createTrade(uid1, uid2, monIdx1, monIdx2) {
  const t1 = getTrainer(uid1), t2 = getTrainer(uid2);
  if (!t1.team[monIdx1] || !t2.team[monIdx2]) return { error: "Invalid Pokémon selection." };
  const id = uid();
  state.trades[id] = { id, uid1, uid2, mon1: monIdx1, mon2: monIdx2, accepted: false };
  save();
  return { success: true, id };
}

function acceptTrade(tradeId, uid) {
  const tr = state.trades[tradeId];
  if (!tr) return { error: "Trade not found." };
  // Security fix: only the two participants may accept/complete a trade.
  if (uid !== tr.uid1 && uid !== tr.uid2) return { error: "You're not part of this trade." };
  if (tr.accepted) return { error: "Trade already completed." };
  const t1 = getTrainer(tr.uid1), t2 = getTrainer(tr.uid2);
  if (!t1.team[tr.mon1] || !t2.team[tr.mon2]) return { error: "A Pokémon in this trade is no longer available." };
  const m1 = t1.team.splice(tr.mon1, 1)[0];
  const m2 = t2.team.splice(tr.mon2, 1)[0];
  t1.team.push(m2);
  t2.team.push(m1);
  tr.accepted = true;
  delete state.trades[tradeId];
  save();
  return { success: true };
}

module.exports = {
  state,
  getTrainer, addXP, xpForLevel, save,
  wildEncounter, attemptCatch,
  createBattle, battleAction,
  createMonster, recalc,
  moveToPC, moveToTeam, swapTeam,
  evolve, healAll, useItem,
  createTrade, acceptTrade,
  getQueue, joinQueue, leaveQueue, getQueueSize,
  WEATHER_TYPES, applyAbility, applyHeldItem, applyWeatherBoosts, getWeatherDamage,
};
