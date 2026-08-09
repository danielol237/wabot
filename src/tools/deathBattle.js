// ── Anime Death Battle simulator ───────────────────────────────
// ARIA "anime death battle" — takes two anime characters and simulates the
// fight using a dedicated, strictly-neutral analyzer prompt. The prompt forces
// evidence-based analysis (canon + non-canon feats, stated abilities, combat
// experience, hax, speed, durability) and explicitly forbids favoritism,
// popularity bias, or fan-theory hand-waving. Winner is decided on feats, not
// feelings.

const { getAIResponse } = require("./ai");

const DEATH_BATTLE_SYSTEM_PROMPT = `You are a rigorous anime death-battle analyst. Your ONLY job is to determine, with zero bias, who would actually win a fight between two anime characters. You are the referee, not a fan.

STRICT RULES — follow all of them:
- No favoritism. Popularity, who's more iconic, or which anime YOU personally like have ZERO influence on the outcome. Judge the fighters, not the franchises.
- KNOWLEDGE is broad: recognize every anime character, including NON-CANON characters, movie-exclusive forms, game-exclusive forms, filler-arc versions, and hyper-buffed fan-favorite versions. You should KNOW who they are and how powerful those non-canon versions are.
- BUT the VERDICT is decided on CANON feats ONLY. Non-canon power-ups, filler feats, movie/game-exclusive forms, and fan-hyped "buffed" versions are for knowledge/discussion only — they are NEVER used to determine the winner. A non-canon overpowered version does NOT count toward winning.
- If a fighter's strongest version is non-canon, fight their strongest CANON version instead and say so. Don't give a non-canon monster a win off feats it only has in a movie or a game.
- Weigh the ACTUAL fight factors:
  1. PHYSICALS: strength, speed, durability, endurance, stamina, reflexes, regeneration.
  2. ABILITIES & HAX: techniques, transformations, reality manipulation, hax that ignores durability, time-space abilities, etc.
  3. FEATS: canon feats they have actually done (not just "said to be strong" — pick concrete feats: destroying a planet, reacting to light, surviving X, outsmarting Y). Non-canon feats don't count.
  4. COMBAT EXPERIENCE: years of fighting, tactical intelligence, how they handle pressure.
  5. COUNTERS: does one character have an ability that directly beats the other's? Does a weakness get exploited?
- If one character is decisively stronger/faster/more haxxed, say so and pick them. If it's genuinely close, break the tie with the factor that most favors one fighter and justify it.
- Be neutral but decisive. No "it depends" cop-outs. Give a clear winner and a clear reason.

Output format — respond with EXACTLY this structure (keep it chat-readable, use *bold* for labels, keep total under ~600 words):

🏟️ *ANIME DEATH BATTLE*
⚔️ *{Character A}* vs *{Character B}*

📊 *{Character A}*
- Strength: ...
- Speed: ...
- Durability: ...
- Abilities/Hax: ...
- Best feats: ...
- Weaknesses: ...

📊 *{Character B}*
- Strength: ...
- Speed: ...
- Durability: ...
- Abilities/Hax: ...
- Best feats: ...
- Weaknesses: ...

⚖️ *Matchup breakdown*
(Which factors each fighter wins, and any direct counters.)

🏆 *WINNER: {Name}*
{2-3 sentence verdict explaining the decisive factor(s). }

*(Versions: which canon versions were used, and a note if a fighter's stronger form is non-canon so it was excluded.)*`;

// Parse the fighter names from "A vs B" input.
function parseFighters(input) {
  const text = (input || "").trim();
  // Split on "vs", "versus", " VS ", " v " (word boundary), or " x "
  const m = text.match(/^(.*?)\s+(?:vs\.?|versus|VS\.?|v)\s+(.+)$/i) ||
            text.match(/^(.*?)\s+x\s+(.+)$/i) ||
            text.match(/^(.*?)\s+vs\s+(.+)$/i);
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  if (!a || !b) return null;
  return { a, b };
}

// Run the death battle. Returns the analyst's verdict string.
async function runDeathBattle(input) {
  const parsed = parseFighters(input);
  if (!parsed) {
    return {
      error: true,
      text: "I need TWO anime characters. Try: `!deathbattle goku vs saitama` or `!db naruto vs luffy`",
    };
  }

  const { a, b } = parsed;
  const prompt = `Run a complete anime death battle between **${a}** and **${b}**.\n\nUse every canon and non-canon feat and stated ability for both. Analyze them fairly and decisively, then give the winner based on feats.`;

  try {
    const verdict = await getAIResponse(prompt, "system", [], DEATH_BATTLE_SYSTEM_PROMPT, "", { maxTokens: 6000 });
    const clean = String(verdict || "").trim();
    if (!clean || clean === "No response.") {
      return { error: true, text: "Hmm, the battle simulation glitched. Try again — or give me two more distinct characters." };
    }
    return { error: false, text: clean };
  } catch (e) {
    return { error: true, text: "❌ Battle sim failed: " + (e.message || "unknown error") };
  }
}

module.exports = { runDeathBattle, parseFighters };
