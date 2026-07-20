// ── Pokémon Moves ─────────────────────────────────────────────
// Data for all learnable moves with type, power, accuracy, PP.

const MOVES = [
  // Normal
  { name: "Tackle",      type: "normal",   power: 40,  acc: 100, pp: 35, cat: "physical", desc: "A basic tackle attack." },
  { name: "Scratch",     type: "normal",   power: 40,  acc: 100, pp: 35, cat: "physical" },
  { name: "Quick Attack",type: "normal",   power: 40,  acc: 100, pp: 30, cat: "physical", priority: 1 },
  { name: "Hyper Beam",  type: "normal",   power: 150, acc: 90,  pp: 5,  cat: "special", recharge: true },
  { name: "Body Slam",   type: "normal",   power: 85,  acc: 100, pp: 15, cat: "physical", effect: "paralyze" },
  { name: "Double-Edge", type: "normal",   power: 120, acc: 100, pp: 15, cat: "physical", recoil: 0.25 },
  // Fire
  { name: "Flamethrower",type: "fire",     power: 90,  acc: 100, pp: 15, cat: "special", effect: "burn" },
  { name: "Fire Blast",  type: "fire",     power: 110, acc: 85,  pp: 5,  cat: "special", effect: "burn" },
  { name: "Ember",       type: "fire",     power: 40,  acc: 100, pp: 25, cat: "special", effect: "burn" },
  { name: "Fire Punch",  type: "fire",     power: 75,  acc: 100, pp: 15, cat: "physical", effect: "burn" },
  { name: "Flame Charge",type: "fire",     power: 50,  acc: 100, pp: 20, cat: "physical", self: "speedUp" },
  // Water
  { name: "Water Gun",   type: "water",    power: 40,  acc: 100, pp: 25, cat: "special" },
  { name: "Hydro Pump",  type: "water",    power: 110, acc: 80,  pp: 5,  cat: "special" },
  { name: "Surf",        type: "water",    power: 90,  acc: 100, pp: 15, cat: "special" },
  { name: "Waterfall",   type: "water",    power: 80,  acc: 100, pp: 15, cat: "physical" },
  { name: "Bubble Beam", type: "water",    power: 65,  acc: 100, pp: 20, cat: "special", effect: "speedDown" },
  // Electric
  { name: "Thunderbolt", type: "electric", power: 90,  acc: 100, pp: 15, cat: "special", effect: "paralyze" },
  { name: "Thunder",     type: "electric", power: 110, acc: 70,  pp: 10, cat: "special", effect: "paralyze" },
  { name: "Thunder Shock",type: "electric",power: 40,  acc: 100, pp: 30, cat: "special", effect: "paralyze" },
  { name: "Spark",       type: "electric", power: 65,  acc: 100, pp: 20, cat: "physical", effect: "paralyze" },
  { name: "Wild Charge", type: "electric", power: 90,  acc: 100, pp: 15, cat: "physical", recoil: 0.25 },
  // Grass
  { name: "Vine Whip",   type: "grass",    power: 45,  acc: 100, pp: 25, cat: "physical" },
  { name: "Razor Leaf",  type: "grass",    power: 55,  acc: 95,  pp: 25, cat: "physical", crit: true },
  { name: "Solar Beam",  type: "grass",    power: 120, acc: 100, pp: 10, cat: "special", charge: true },
  { name: "Energy Ball", type: "grass",    power: 90,  acc: 100, pp: 10, cat: "special", effect: "spDefDown" },
  { name: "Leaf Blade",  type: "grass",    power: 90,  acc: 100, pp: 15, cat: "physical", crit: true },
  // Ice
  { name: "Ice Beam",    type: "ice",      power: 90,  acc: 100, pp: 10, cat: "special", effect: "freeze" },
  { name: "Blizzard",    type: "ice",      power: 110, acc: 70,  pp: 5,  cat: "special", effect: "freeze" },
  { name: "Ice Punch",   type: "ice",      power: 75,  acc: 100, pp: 15, cat: "physical", effect: "freeze" },
  { name: "Avalanche",   type: "ice",      power: 60,  acc: 100, pp: 10, cat: "physical", priority: -1 },
  // Fighting
  { name: "Karate Chop", type: "fighting", power: 50,  acc: 100, pp: 25, cat: "physical", crit: true },
  { name: "Brick Break", type: "fighting", power: 75,  acc: 100, pp: 15, cat: "physical" },
  { name: "Close Combat",type: "fighting", power: 120, acc: 100, pp: 5,  cat: "physical", self: "defDownSpDefDown" },
  { name: "Aura Sphere", type: "fighting", power: 80,  acc: 999, pp: 20, cat: "special" },
  { name: "Low Kick",    type: "fighting", power: 50,  acc: 100, pp: 20, cat: "physical" },
  // Poison
  { name: "Sludge Bomb", type: "poison",   power: 90,  acc: 100, pp: 10, cat: "special", effect: "poison" },
  { name: "Poison Jab",  type: "poison",   power: 80,  acc: 100, pp: 20, cat: "physical", effect: "poison" },
  { name: "Toxic",       type: "poison",   power: 0,   acc: 90,  pp: 10, cat: "status", effect: "toxic" },
  { name: "Acid",        type: "poison",   power: 40,  acc: 100, pp: 30, cat: "special", effect: "spDefDown" },
  // Ground
  { name: "Dig",         type: "ground",   power: 80,  acc: 100, pp: 10, cat: "physical" },
  { name: "Earthquake",  type: "ground",   power: 100, acc: 100, pp: 10, cat: "physical" },
  { name: "Bulldoze",    type: "ground",   power: 60,  acc: 100, pp: 20, cat: "physical", effect: "speedDown" },
  { name: "Mud Shot",    type: "ground",   power: 55,  acc: 95,  pp: 15, cat: "special", effect: "speedDown" },
  // Flying
  { name: "Fly",         type: "flying",   power: 90,  acc: 95,  pp: 15, cat: "physical" },
  { name: "Wing Attack", type: "flying",   power: 60,  acc: 100, pp: 35, cat: "physical" },
  { name: "Air Slash",   type: "flying",   power: 75,  acc: 95,  pp: 20, cat: "special" },
  { name: "Drill Peck",  type: "flying",   power: 80,  acc: 100, pp: 20, cat: "physical" },
  // Psychic
  { name: "Psychic",     type: "psychic",  power: 90,  acc: 100, pp: 10, cat: "special", effect: "spDefDown" },
  { name: "Confusion",   type: "psychic",  power: 50,  acc: 100, pp: 25, cat: "special", effect: "confuse" },
  { name: "Psybeam",     type: "psychic",  power: 65,  acc: 100, pp: 20, cat: "special", effect: "confuse" },
  { name: "Future Sight",type: "psychic",  power: 120, acc: 100, pp: 10, cat: "special" },
  // Bug
  { name: "Bug Bite",    type: "bug",      power: 60,  acc: 100, pp: 20, cat: "physical" },
  { name: "X-Scissor",   type: "bug",      power: 80,  acc: 100, pp: 15, cat: "physical" },
  { name: "Signal Beam", type: "bug",      power: 75,  acc: 100, pp: 15, cat: "special", effect: "confuse" },
  { name: "U-Turn",      type: "bug",      power: 70,  acc: 100, pp: 20, cat: "physical" },
  // Rock
  { name: "Rock Slide",  type: "rock",     power: 75,  acc: 90,  pp: 10, cat: "physical" },
  { name: "Stone Edge",  type: "rock",     power: 100, acc: 80,  pp: 5,  cat: "physical", crit: true },
  { name: "Rock Throw",  type: "rock",     power: 50,  acc: 90,  pp: 15, cat: "physical" },
  { name: "Power Gem",   type: "rock",     power: 80,  acc: 100, pp: 20, cat: "special" },
  // Ghost
  { name: "Shadow Ball", type: "ghost",    power: 80,  acc: 100, pp: 15, cat: "special", effect: "spDefDown" },
  { name: "Shadow Claw", type: "ghost",    power: 70,  acc: 100, pp: 15, cat: "physical", crit: true },
  { name: "Lick",        type: "ghost",    power: 30,  acc: 100, pp: 30, cat: "physical", effect: "paralyze" },
  { name: "Night Shade", type: "ghost",    power: 60,  acc: 100, pp: 15, cat: "special" },
  // Dragon
  { name: "Dragon Claw", type: "dragon",   power: 80,  acc: 100, pp: 15, cat: "physical" },
  { name: "Dragon Pulse",type: "dragon",   power: 85,  acc: 100, pp: 10, cat: "special" },
  { name: "Dragon Breath",type: "dragon",  power: 60,  acc: 100, pp: 20, cat: "special", effect: "paralyze" },
  { name: "Outrage",     type: "dragon",   power: 120, acc: 100, pp: 10, cat: "physical", self: "confuse" },
  // Dark
  { name: "Dark Pulse",  type: "dark",     power: 80,  acc: 100, pp: 15, cat: "special" },
  { name: "Crunch",      type: "dark",     power: 80,  acc: 100, pp: 15, cat: "physical", effect: "defDown" },
  { name: "Bite",        type: "dark",     power: 60,  acc: 100, pp: 25, cat: "physical" },
  { name: "Night Slash", type: "dark",     power: 70,  acc: 100, pp: 15, cat: "physical", crit: true },
  // Steel
  { name: "Iron Tail",   type: "steel",    power: 100, acc: 75,  pp: 15, cat: "physical", effect: "defDown" },
  { name: "Steel Wing",  type: "steel",    power: 70,  acc: 90,  pp: 25, cat: "physical" },
  { name: "Flash Cannon",type: "steel",    power: 80,  acc: 100, pp: 10, cat: "special", effect: "spDefDown" },
  { name: "Bullet Punch",type: "steel",    power: 40,  acc: 100, pp: 30, cat: "physical", priority: 1 },
  // Fairy
  { name: "Moonblast",   type: "fairy",    power: 95,  acc: 100, pp: 15, cat: "special", effect: "spAtkDown" },
  { name: "Play Rough",  type: "fairy",    power: 90,  acc: 90,  pp: 15, cat: "physical", effect: "atkDown" },
  { name: "Dazzling Gleam",type: "fairy",  power: 80,  acc: 100, pp: 10, cat: "special" },
  { name: "Charm",       type: "fairy",    power: 0,   acc: 100, pp: 20, cat: "status", effect: "atkDown" },
];

// Get type-appropriate moves for a Pokémon based on its types
function getMovesForTypes(types, level) {
  // Filter moves that match the Pokémon's types (STAB)
  const typeSet = new Set(types.map(t => t.toLowerCase()));
  const typeMoves = MOVES.filter(m => typeSet.has(m.type));

  // Also include some normal-type moves as filler
  const normalMoves = MOVES.filter(m => m.type === "normal" && m.name !== "Hyper Beam");
  
  const pool = [...typeMoves, ...normalMoves];
  
  // Pick 4 random moves, prioritizing higher power at higher levels
  const available = pool.filter(m => (m.power || 0) <= 30 + level * 3 || m.power === 0);
  if (available.length < 4) {
    // Fallback: include some moves that might be slightly above level
    const allPool = [...typeMoves, ...normalMoves];
    const sorted = [...allPool].sort((a, b) => (a.power || 0) - (b.power || 0));
    const chosen = [];
    const indices = new Set();
    while (chosen.length < 4 && chosen.length < sorted.length) {
      const idx = Math.floor(Math.random() * sorted.length);
      if (!indices.has(idx)) {
        indices.add(idx);
        chosen.push(sorted[idx]);
      }
    }
    return chosen.length > 0 ? chosen : [MOVES[0], MOVES[1], MOVES[2], MOVES[3]]; // Basic tackle/scratch/quick attack
  }

  // Pick 4, weighted towards higher power at higher levels
  const selected = [];
  const used = new Set();
  for (let i = 0; i < 4 && used.size < available.length; i++) {
    const idx = Math.floor(Math.random() * available.length);
    if (!used.has(idx)) {
      used.add(idx);
      selected.push(available[idx]);
    }
  }
  return selected.length === 4 ? selected : selected.concat(MOVES.slice(0, 4 - selected.length));
}

// Get move by name
function getMove(name) {
  return MOVES.find(m => m.name.toLowerCase() === name.toLowerCase());
}

// Get all moves
function getAllMoves() { return MOVES; }

module.exports = { MOVES, getMovesForTypes, getMove, getAllMoves };
