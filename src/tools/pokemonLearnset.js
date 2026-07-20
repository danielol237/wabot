// Fetch learnable moves for a Pokémon from PokeAPI
// Returns moves learnable at the current level or below

const axios = require("axios");

const learnCache = new Map();

async function fetchLearnableMoves(speciesId, level) {
  const key = `${speciesId}-${level}`;
  if (learnCache.has(key)) return learnCache.get(key);

  try {
    const res = await axios.get(`https://pokeapi.co/api/v2/pokemon/${speciesId}`, { timeout: 10000 });
    const allMoves = res.data.moves || [];

    // Get moves learnable at or below current level via level-up
    const levelUpMoves = allMoves
      .filter(m => {
        const detail = m.version_group_details?.find(d => d.move_learn_method?.name === "level-up");
        return detail && detail.level_learned_at <= level;
      })
      .map(m => ({
        name: m.move.name.charAt(0).toUpperCase() + m.move.name.slice(1).replace(/-/g, " "),
        learnLevel: m.version_group_details.find(d => d.move_learn_method?.name === "level-up")?.level_learned_at || 0,
        method: "level-up",
      }));

    // Also get TM/egg/tutor moves (available regardless of level)
    const otherMoves = allMoves
      .filter(m => {
        const details = m.version_group_details || [];
        return details.some(d => d.move_learn_method?.name !== "level-up" && ["machine", "egg", "tutor"].includes(d.move_learn_method?.name || ""));
      })
      .map(m => ({
        name: m.move.name.charAt(0).toUpperCase() + m.move.name.slice(1).replace(/-/g, " "),
        learnLevel: 0,
        method: "other",
      }));

    // Unique by name
    const seen = new Set();
    const allUnique = [...levelUpMoves, ...otherMoves].filter(m => {
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });

    // Sort: level-up moves first (by level), then others
    allUnique.sort((a, b) => {
      if (a.method === "level-up" && b.method === "level-up") return a.learnLevel - b.learnLevel;
      if (a.method === "level-up") return -1;
      if (b.method === "level-up") return 1;
      return a.name.localeCompare(b.name);
    });

    learnCache.set(key, allUnique);
    return allUnique;
  } catch (e) {
    console.error(`Failed to fetch moves for #${speciesId}:`, e.message);
    return [];
  }
}

// Match a move name from our internal list
function findMoveByName(name) {
  const { MOVES } = require("./pokemonMoves");
  return MOVES.find(m => m.name.toLowerCase() === name.toLowerCase());
}

module.exports = { fetchLearnableMoves, findMoveByName };
