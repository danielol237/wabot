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

function calcStats(species, level, nature) {
  const mod = NATURE_MODS[nature] || {};
  return {
    maxHp: Math.floor((2 * species.stats.hp * level) / 100) + level + 10,
    attack: Math.floor(Math.floor((2 * species.stats.attack * level) / 100 + 5) * (mod.atk || 1)),
    defense: Math.floor(Math.floor((2 * species.stats.defense * level) / 100 + 5) * (mod.def || 1)),
    spAttack: Math.floor(Math.floor((2 * species.stats.spAttack * level) / 100 + 5) * (mod.spa || 1)),
    spDefense: Math.floor(Math.floor((2 * species.stats.spDefense * level) / 100 + 5) * (mod.spd || 1)),
    speed: Math.floor(Math.floor((2 * species.stats.speed * level) / 100 + 5) * (mod.spe || 1)),
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
    moves: getMovesForTypes(s.types, level).slice(0, 4) };
  return mon;
}

async function recalc(mon) {
  const s = await fetchSpecies(mon.speciesId);
  const st = calcStats(s, mon.level, mon.nature);
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
  const mon = createMonster(id, level);
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
function createBattle(uid1, uid2) {
  const t1 = getTrainer(uid1), t2 = getTrainer(uid2);
  if (t1.team.length === 0) return { error: "No Pokémon in party!" };
  if (t2.team.length === 0) return { error: "They have no Pokémon!" };
  const id = uid();
  state.battles[id] = {
    id, uid1, uid2, active1: 0, active2: 0, turn: uid1,
    state: "active", winner: null, log: [],
  };
  save();
  return { success: true, id };
}

async function battleAction(battleId, uid, action, data) {
  const b = state.battles[battleId];
  if (!b || b.state !== "active") return { error: "Battle not found or over." };
  if (b.turn !== uid) return { error: "Wait your turn!" };

  const isU1 = uid === b.uid1;
  const t1 = getTrainer(b.uid1), t2 = getTrainer(b.uid2);
  const att = isU1 ? t1.team[b.active1] : t2.team[b.active2];
  const def = isU1 ? t2.team[b.active2] : t2.team[b.active1];
  if (!att || !def) return { error: "Missing Pokémon." };

  await recalc(att); await recalc(def);
  const aS = await fetchSpecies(att.speciesId);
  const dS = await fetchSpecies(def.speciesId);

  if (action === "attack") {
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
    
    const dmg = Math.max(1, Math.floor(((2 * att.level / 5 + 2) * basePower * atkStat / defStat) / 50 + 2) * stab * typeEff * (0.85 + Math.random() * 0.15));
    def.hp -= dmg;
    
    const effText = typeEff > 1 ? "💥 Super effective!" : typeEff < 1 && typeEff > 0 ? "⚠️ Not very effective..." : typeEff === 0 ? "❌ No effect!" : "";
    const crit = Math.random() < 0.0625;

    b.log.push({ action: "attack", attacker: isU1 ? 1 : 2, move: move.name, damage: dmg, crit });

    let result = { action: "attack", moveName: move.name, damage: dmg, effectiveness: typeEff, crit, attSprite: aS.sprite, defSprite: dS.sprite, attName: aS.name, defName: dS.name, moveType: move.type };
    result.description = `${aS.name} used ${move.name}!${crit ? " 💥 Critical hit!" : ""}${effText ? " " + effText : ""} (${dmg} DMG)`;

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
async function evolve(uid, teamIdx, stone) {
  const t = getTrainer(uid);
  const mon = t.team[teamIdx];
  if (!mon) return { error: "Invalid Pokémon." };

  // For now, just level up evolution at specific levels
  // Real implementation would check species-specific evolution chains
  if (mon.level < 16) return { error: "Need at least level 16 to evolve." };

  const oldSpecies = await fetchSpecies(mon.speciesId);
  const newId = mon.speciesId + 1; // Simplified - real evolution needs chain data
  const newSpecies = await fetchSpecies(newId);
  if (!newSpecies || newSpecies.id === mon.speciesId) return { error: "This Pokémon can't evolve." };

  mon.speciesId = newId;
  mon.level = Math.max(mon.level, 16);
  await recalc(mon);
  save();
  return { success: true, oldName: oldSpecies.name, newName: newSpecies.name, sprite: newSpecies.sprite };
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
  if (tr.accepted) return { error: "Trade already completed." };
  const t1 = getTrainer(tr.uid1), t2 = getTrainer(tr.uid2);
  const m1 = t1.team.splice(tr.mon1, 1)[0];
  const m2 = t2.team.splice(tr.mon2, 1)[0];
  t1.team.push(m2);
  t2.team.push(m1);
  delete state.trades[tradeId];
  save();
  return { success: true };
}

module.exports = {
  getTrainer, addXP, xpForLevel, save,
  wildEncounter, attemptCatch,
  createBattle, battleAction,
  createMonster, recalc,
  moveToPC, moveToTeam, swapTeam,
  evolve, healAll, useItem,
  createTrade, acceptTrade,
};
