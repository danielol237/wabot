// ── Pokémon Abilities & Held Items ─────────────────────────
// Abilities give passive bonuses in battle
// Held items boost stats or provide effects

const ABILITIES = [
  // Gen 1
  { name: "Overgrow", desc: "Boosts Grass moves when HP is low", type: "boost", condition: "lowHp", stat: "grass", multiplier: 1.5 },
  { name: "Blaze", desc: "Boosts Fire moves when HP is low", type: "boost", condition: "lowHp", stat: "fire", multiplier: 1.5 },
  { name: "Torrent", desc: "Boosts Water moves when HP is low", type: "boost", condition: "lowHp", stat: "water", multiplier: 1.5 },
  { name: "Swarm", desc: "Boosts Bug moves when HP is low", type: "boost", condition: "lowHp", stat: "bug", multiplier: 1.5 },
  { name: "Intimidate", desc: "Lowers opponent's Attack on switch-in", type: "debuff", target: "opponent", stat: "attack", multiplier: 0.9 },
  { name: "Static", desc: "May paralyze attacker on contact", type: "contact", effect: "paralyze", chance: 0.3 },
  { name: "Levitate", desc: "Immune to Ground-type moves", type: "immunity", immune: "ground" },
  { name: "Sand Veil", desc: "Boosts evasion in sandstorm", type: "evasion", condition: "sandstorm", multiplier: 1.2 },
  { name: "Synchronize", desc: "Passes status conditions back", type: "mirror" },
  { name: "Cute Charm", desc: "May infatuate attacker on contact", type: "contact", effect: "infatuate", chance: 0.3 },
  // Gen 2
  { name: "Guts", desc: "Boosts Attack when statused", type: "boost", condition: "statused", stat: "attack", multiplier: 1.5 },
  { name: "Natural Cure", desc: "Cures status on switch-out", type: "heal" },
  { name: "Serene Grace", desc: "Doubles chance of extra effects", type: "boost", multiplier: 2 },
  { name: "Speed Boost", desc: "Raises Speed each turn", type: "statUp", stat: "speed", amount: 1 },
  { name: "Sturdy", desc: "Prevents one-hit KOs", type: "survive" },
  // Gen 3
  { name: "Drizzle", desc: "Summons rain", type: "weather", weather: "rain" },
  { name: "Drought", desc: "Summons sun", type: "weather", weather: "sun" },
  { name: "Sand Stream", desc: "Summons sandstorm", type: "weather", weather: "sandstorm" },
  { name: "Snow Warning", desc: "Summons hail", type: "weather", weather: "hail" },
  { name: "Pressure", desc: "Increases opponent's move PP usage", type: "pressure", multiplier: 2 },
];

const HELD_ITEMS = [
  { name: "Choice Band", desc: "Boosts Attack by 50% but locks to one move", type: "boost", stat: "attack", multiplier: 1.5, drawback: "lockMove" },
  { name: "Choice Specs", desc: "Boosts Sp. Attack by 50% but locks to one move", type: "boost", stat: "spAttack", multiplier: 1.5, drawback: "lockMove" },
  { name: "Assault Vest", desc: "Boosts Sp. Defense by 50% but can't use status moves", type: "boost", stat: "spDefense", multiplier: 1.5, drawback: "noStatus" },
  { name: "Life Orb", desc: "Boosts damage by 30% but costs HP", type: "boost", stat: "damage", multiplier: 1.3, drawback: "recoil" },
  { name: "Leftovers", desc: "Restores 1/16 HP each turn", type: "regen", amount: 0.0625 },
  { name: "Focus Sash", desc: "Survives a KO hit at 1 HP", type: "survive", condition: "fullHp" },
  { name: "Rocky Helmet", desc: "Damages attacker on contact", type: "contact", damage: 0.125 },
  { name: "King's Rock", desc: "May cause flinching", type: "chance", effect: "flinch", chance: 0.1 },
  { name: "Black Belt", desc: "Boosts Fighting moves", type: "boost", stat: "fighting", multiplier: 1.2 },
  { name: "Magnet", desc: "Boosts Electric moves", type: "boost", stat: "electric", multiplier: 1.2 },
  { name: "Mystic Water", desc: "Boosts Water moves", type: "boost", stat: "water", multiplier: 1.2 },
  { name: "Charcoal", desc: "Boosts Fire moves", type: "boost", stat: "fire", multiplier: 1.2 },
  { name: "Miracle Seed", desc: "Boosts Grass moves", type: "boost", stat: "grass", multiplier: 1.2 },
];

function getRandomAbility() {
  return ABILITIES[Math.floor(Math.random() * ABILITIES.length)];
}

function getRandomHeldItem() {
  return HELD_ITEMS[Math.floor(Math.random() * HELD_ITEMS.length)];
}

function getAbility(name) {
  return ABILITIES.find(a => a.name.toLowerCase() === name.toLowerCase());
}

function getHeldItem(name) {
  return HELD_ITEMS.find(i => i.name.toLowerCase() === name.toLowerCase());
}

module.exports = { ABILITIES, HELD_ITEMS, getRandomAbility, getRandomHeldItem, getAbility, getHeldItem };
