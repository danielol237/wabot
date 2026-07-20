// ── Pokémon Data ──────────────────────────────────────────────
// Fetches species, types, moves from PokeAPI. Caches aggressively.
// Falls back to essential built-in data if API is unreachable.

const axios = require("axios");

const TYPE_CHART = {
  normal:   { weak: ["fighting"], resist: [], immune: ["ghost"], strong: [], weakTo: ["rock","steel"] },
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

// Cache for species data
const speciesCache = new Map();
const MAX_POKEMON = 898; // up to Gen 8 (Sword/Shield)

function getTypeEffectiveness(attackType, defenderTypes) {
  let multiplier = 1;
  for (const defType of defenderTypes) {
    const t = defType.toLowerCase();
    if (TYPE_CHART[attackType]?.immune?.includes(t)) return 0;
    if (TYPE_CHART[attackType]?.weak?.includes(t)) multiplier *= 2;
    if (TYPE_CHART[attackType]?.resist?.includes(t)) multiplier *= 0.5;
    if (TYPE_CHART[t]?.immune?.includes(attackType)) return 0;
    if (TYPE_CHART[t]?.weak?.includes(attackType)) multiplier *= 2;
    if (TYPE_CHART[t]?.resist?.includes(attackType)) multiplier *= 0.5;
  }
  return multiplier;
}

async function fetchSpecies(id) {
  if (speciesCache.has(id)) return speciesCache.get(id);
  try {
    const res = await axios.get(`https://pokeapi.co/api/v2/pokemon/${id}`, { timeout: 5000 });
    const data = res.data;
    const species = await axios.get(`https://pokeapi.co/api/v2/pokemon-species/${id}`, { timeout: 5000 });
    const speciesData = species.data;

    const pokemon = {
      id: data.id,
      name: data.name.charAt(0).toUpperCase() + data.name.slice(1),
      types: data.types.map(t => t.type.name),
      stats: {
        hp: data.stats[0].base_stat,
        attack: data.stats[1].base_stat,
        defense: data.stats[2].base_stat,
        spAttack: data.stats[3].base_stat,
        spDefense: data.stats[4].base_stat,
        speed: data.stats[5].base_stat,
      },
      sprite: data.sprites.front_default,
      artwork: data.sprites.other?.official_artwork?.front_default || data.sprites.front_default,
      genus: speciesData.genera?.find(g => g.language.name === "en")?.genus || "Pokémon",
      flavor: speciesData.flavor_text_entries?.find(f => f.language.name === "en")?.flavor_text?.replace(/[\n\f]/g, " ") || "",
      baseExperience: data.base_experience || 0,
      height: data.height / 10 + "m",
      weight: data.weight / 10 + "kg",
    };
    speciesCache.set(id, pokemon);
    return pokemon;
  } catch (e) {
    // Return minimal data if API fails
    return { id, name: `Pokemon #${id}`, types: ["normal"], stats: { hp: 50, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 }, sprite: "" };
  }
}

async function searchPokemon(query) {
  query = query.toLowerCase().trim();
  // Check if it's a number
  if (/^\d+$/.test(query)) return fetchSpecies(parseInt(query));
  // Search by name via API
  try {
    const res = await axios.get(`https://pokeapi.co/api/v2/pokemon/${query}`, { timeout: 5000 });
    return fetchSpecies(res.data.id);
  } catch {
    // Try search endpoint
    try {
      const res = await axios.get(`https://pokeapi.co/api/v2/pokemon?limit=100000&offset=0`, { timeout: 5000 });
      const match = res.data.results.find(r => r.name.includes(query));
      if (match) {
        const id = parseInt(match.url.split("/").slice(-2, -1)[0]);
        return fetchSpecies(id);
      }
    } catch {}
    return null;
  }
}

function getRandomPokemonId() {
  // Weighted towards earlier gens (they're more iconic)
  const roll = Math.random();
  if (roll < 0.5) return Math.floor(Math.random() * 151) + 1; // Gen 1
  if (roll < 0.7) return Math.floor(Math.random() * 100) + 152; // Gen 2
  if (roll < 0.85) return Math.floor(Math.random() * 135) + 252; // Gen 3
  return Math.floor(Math.random() * (MAX_POKEMON - 386)) + 387;
}

module.exports = { fetchSpecies, searchPokemon, getRandomPokemonId, getTypeEffectiveness, TYPE_CHART, speciesCache };
