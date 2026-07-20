// ── Pokémon Data v2 ──────────────────────────────────────────
// All 9 generations, animated sprites, evolution chains, type chart.
// Fetch from PokeAPI with local cache.

const axios = require("axios");

// ── Types ────────────────────────────────────────────────────
const TYPE_CHART = {
  normal:   { immune: ["ghost"], weak: ["fighting"], resist: [], strong: [], weakTo: ["rock","steel"] },
  fire:     { weak: ["water","ground","rock"], resist: ["fire","grass","ice","bug","steel","fairy"], strong: ["grass","ice","bug","steel"], weakTo: ["fire","water","rock","dragon"] },
  water:    { weak: ["electric","grass"], resist: ["fire","water","ice","steel"], strong: ["fire","ground","rock"], weakTo: ["water","grass","dragon"] },
  electric: { weak: ["ground"], resist: ["electric","flying","steel"], strong: ["water","flying"], weakTo: ["electric","grass","dragon"] },
  grass:    { weak: ["fire","ice","poison","flying","bug"], resist: ["water","electric","grass","ground"], strong: ["water","ground","rock"], weakTo: ["fire","grass","poison","flying","bug","dragon","steel"] },
  ice:      { weak: ["fire","fighting","rock","steel"], resist: ["ice"], strong: ["grass","ground","flying","dragon"], weakTo: ["fire","water","ice","steel"] },
  fighting: { weak: ["flying","psychic","fairy"], resist: ["bug","rock","dark"], strong: ["normal","ice","rock","dark","steel"], weakTo: ["poison","flying","psychic","bug","fairy"] },
  poison:   { weak: ["ground","psychic"], resist: ["grass","fighting","poison","bug","fairy"], strong: ["grass","fairy"], weakTo: ["poison","ground","rock","ghost"] },
  ground:   { weak: ["water","grass","ice"], resist: ["poison","rock"], immune: ["electric"], strong: ["fire","electric","poison","rock","steel"], weakTo: ["grass","bug"] },
  flying:   { weak: ["rock","electric","ice"], resist: ["grass","fighting","bug"], immune: ["ground"], strong: ["grass","fighting","bug"], weakTo: ["electric","rock","steel"] },
  psychic:  { weak: ["bug","ghost","dark"], resist: ["fighting","psychic"], strong: ["fighting","poison"], weakTo: ["psychic","steel"] },
  bug:      { weak: ["fire","flying","rock"], resist: ["grass","fighting","ground"], strong: ["grass","psychic","dark"], weakTo: ["fire","fighting","poison","flying","ghost","steel","fairy"] },
  rock:     { weak: ["water","grass","fighting","ground","steel"], resist: ["normal","fire","poison","flying"], strong: ["fire","ice","flying","bug"], weakTo: ["fighting","ground","steel"] },
  ghost:    { weak: ["ghost","dark"], resist: ["poison","bug"], immune: ["normal","fighting"], strong: ["psychic","ghost"], weakTo: ["dark"] },
  dragon:   { weak: ["ice","dragon","fairy"], resist: ["fire","water","electric","grass"], strong: ["dragon"], weakTo: ["steel","fairy"] },
  dark:     { weak: ["fighting","bug","fairy"], resist: ["ghost","dark"], immune: ["psychic"], strong: ["psychic","ghost"], weakTo: ["fighting","dark","fairy"] },
  steel:    { weak: ["fire","fighting","ground"], resist: ["normal","grass","ice","flying","psychic","bug","rock","dragon","steel","fairy"], immune: ["poison"], strong: ["ice","rock","fairy"], weakTo: ["fire","water","electric","steel"] },
  fairy:    { weak: ["poison","steel"], resist: ["fighting","bug","dark"], immune: ["dragon"], strong: ["fighting","dragon","dark"], weakTo: ["fire","poison","steel"] },
};

function getEffectiveness(moveType, defTypes) {
  let m = 1;
  for (const dt of defTypes) {
    const t = dt.toLowerCase();
    if (TYPE_CHART[moveType]?.immune?.includes(t)) return 0;
    if (TYPE_CHART[moveType]?.weak?.includes(t)) m *= 2;
    if (TYPE_CHART[moveType]?.resist?.includes(t)) m *= 0.5;
    if (TYPE_CHART[t]?.immune?.includes(moveType)) return 0;
    if (TYPE_CHART[t]?.weak?.includes(moveType)) m *= 2;
    if (TYPE_CHART[t]?.resist?.includes(moveType)) m *= 0.5;
  }
  return m;
}

// ── Items ────────────────────────────────────────────────────
const ITEMS = {
  pokeball:     { name: "Poké Ball",     type: "ball",   catchRate: 1,   price: 200, desc: "A basic ball for catching wild Pokémon." },
  greatball:    { name: "Great Ball",    type: "ball",   catchRate: 1.5, price: 600, desc: "A better ball with higher catch rate." },
  ultraball:    { name: "Ultra Ball",    type: "ball",   catchRate: 2,   price: 1200, desc: "The best standard ball." },
  masterball:   { name: "Master Ball",   type: "ball",   catchRate: 99,  price: 0, desc: "Catches any Pokémon without fail! (Rare)" },
  potion:       { name: "Potion",        type: "heal",   healAmt: 20,    price: 300, desc: "Restores 20 HP." },
  superpotion:  { name: "Super Potion",  type: "heal",   healAmt: 50,    price: 700, desc: "Restores 50 HP." },
  hyperpotion:  { name: "Hyper Potion",  type: "heal",   healAmt: 200,   price: 1500, desc: "Restores 200 HP." },
  fullrestore:  { name: "Full Restore",  type: "heal",   healAmt: 9999,  price: 3000, desc: "Fully restores HP and status." },
  rarecandy:    { name: "Rare Candy",    type: "level",  price: 5000, desc: "Instantly raises a Pokémon by 1 level." },
  firestone:    { name: "Fire Stone",    type: "evo",    price: 2100, desc: "Evolves certain Fire-type Pokémon." },
  waterstone:   { name: "Water Stone",   type: "evo",    price: 2100, desc: "Evolves certain Water-type Pokémon." },
  thunderstone: { name: "Thunder Stone",  type: "evo",    price: 2100, desc: "Evolves certain Electric-type Pokémon." },
  leafstone:    { name: "Leaf Stone",    type: "evo",    price: 2100, desc: "Evolves certain Grass-type Pokémon." },
  moonstone:    { name: "Moon Stone",    type: "evo",    price: 2100, desc: "Evolves certain Pokémon." },
  dawnstone:    { name: "Dawn Stone",    type: "evo",    price: 2100, desc: "Evolves certain Pokémon." },
  duskstone:    { name: "Dusk Stone",    type: "evo",    price: 2100, desc: "Evolves certain Pokémon." },
  shinystone:   { name: "Shiny Stone",   type: "evo",    price: 2100, desc: "Evolves certain Pokémon." },
  kingsrock:    { name: "King's Rock",   type: "evo",    price: 2500, desc: "Evolves certain Pokémon when held." },
  metalcoat:    { name: "Metal Coat",    type: "evo",    price: 2500, desc: "Evolves certain Steel-type Pokémon." },
  dragonfang:   { name: "Dragon Fang",   type: "evo",    price: 2500, desc: "Evolves certain Dragon-type Pokémon." },
  meganite_x:   { name: "Mega Stone X",  type: "mega",   price: 10000, desc: "Mega Evolves certain Pokémon." },
  meganite_y:   { name: "Mega Stone Y",  type: "mega",   price: 10000, desc: "Mega Evolves certain Pokémon." },
};

// ── Animated sprite URLs ────────────────────────────────────
function getSprite(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/${id}.gif`;
}

function getBackSprite(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/back/${id}.gif`;
}

function getArtwork(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

// ── Species cache ────────────────────────────────────────────
const cache = new Map();

async function fetchSpecies(id) {
  if (cache.has(id)) return cache.get(id);
  try {
    const res = await axios.get(`https://pokeapi.co/api/v2/pokemon/${id}`, { timeout: 5000 });
    const d = res.data;
    const sr = await axios.get(`https://pokeapi.co/api/v2/pokemon-species/${id}`, { timeout: 5000 });
    const s = sr.data;

    const mon = {
      id: d.id,
      name: d.name.charAt(0).toUpperCase() + d.name.slice(1),
      types: d.types.map(t => t.type.name),
      stats: {
        hp: d.stats[0].base_stat, attack: d.stats[1].base_stat, defense: d.stats[2].base_stat,
        spAttack: d.stats[3].base_stat, spDefense: d.stats[4].base_stat, speed: d.stats[5].base_stat,
      },
      sprite: getSprite(d.id),
      backSprite: getBackSprite(d.id),
      artwork: getArtwork(d.id),
      genus: s.genera?.find(g => g.language.name === "en")?.genus || "Pokémon",
      flavor: s.flavor_text_entries?.find(f => f.language.name === "en")?.flavor_text?.replace(/[\n\f]/g, " ") || "",
      baseExp: d.base_experience || 0,
      height: d.height / 10 + "m",
      weight: d.weight / 10 + "kg",
      isBaby: s.is_baby,
      evoChain: null, // Will be populated from evolution chain API
    };
    cache.set(id, mon);
    return mon;
  } catch {
    return { id, name: `#${id}`, types: ["normal"], stats: { hp: 50, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 }, sprite: "", artwork: "" };
  }
}

async function searchMon(query) {
  query = query.toLowerCase().trim();
  if (/^\d+$/.test(query)) return fetchSpecies(parseInt(query));
  try {
    const r = await axios.get(`https://pokeapi.co/api/v2/pokemon/${query}`, { timeout: 5000 });
    return fetchSpecies(r.data.id);
  } catch {
    try {
      const r = await axios.get(`https://pokeapi.co/api/v2/pokemon?limit=2000&offset=0`, { timeout: 10000 });
      const match = r.data.results.find(mon => mon.name.includes(query));
      if (match) return fetchSpecies(parseInt(match.url.split("/").slice(-2, -1)[0]));
    } catch {}
    return null;
  }
}

function randomId() {
  const r = Math.random();
  if (r < 0.4) return 1 + Math.floor(Math.random() * 151);      // Gen 1
  if (r < 0.55) return 152 + Math.floor(Math.random() * 100);    // Gen 2
  if (r < 0.7) return 252 + Math.floor(Math.random() * 135);     // Gen 3
  if (r < 0.8) return 387 + Math.floor(Math.random() * 107);     // Gen 4
  if (r < 0.87) return 494 + Math.floor(Math.random() * 156);    // Gen 5
  if (r < 0.92) return 650 + Math.floor(Math.random() * 72);     // Gen 6
  if (r < 0.96) return 722 + Math.floor(Math.random() * 88);     // Gen 7
  if (r < 0.99) return 810 + Math.floor(Math.random() * 96);     // Gen 8
  return 906 + Math.floor(Math.random() * 110);                   // Gen 9
}

module.exports = { fetchSpecies, searchMon, randomId, getSprite, getBackSprite, getArtwork, getEffectiveness, TYPE_CHART, ITEMS, cache };
