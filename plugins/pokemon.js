// Pokémon Plugin v2 — original names, all features, animated GIFs
const { getTrainer, addXP, xpForLevel, save, wildEncounter, attemptCatch,
  createBattle, battleAction, createMonster, recalc,
  moveToPC, moveToTeam, swapTeam, evolve, healAll, useItem,
  createTrade, acceptTrade } = require("../src/tools/pokemonGame");
const { fetchSpecies, searchMon, getSprite, getBackSprite, getArtwork, getEffectiveness, ITEMS } = require("../src/tools/pokemonData");
const { getMove } = require("../src/tools/pokemonMoves");

module.exports = {
  name: "pokemon",
  commands: {
    // ── WILD ENCOUNTER ──────────────────────────────────────
    // ── START YOUR JOURNEY ─────────────────────────────────
    // 9 starter Pokémon, one from each generation
    starters: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (t.team.length > 0) return ctx.reply("You already have Pokémon! Your journey has already begun.");

      const STORTERS = [
        { ids: [1, 4, 7], gen: "Kanto", name: "Bulbasaur/Charmander/Squirtle" },
        { ids: [152, 155, 158], gen: "Johto", name: "Chikorita/Cyndaquil/Totodile" },
        { ids: [252, 255, 258], gen: "Hoenn", name: "Treecko/Torchic/Mudkip" },
        { ids: [387, 390, 393], gen: "Sinnoh", name: "Turtwig/Chimchar/Piplup" },
        { ids: [495, 498, 501], gen: "Unova", name: "Snivy/Tepig/Oshawott" },
        { ids: [650, 653, 656], gen: "Kalos", name: "Chespin/Fennekin/Froakie" },
        { ids: [722, 725, 728], gen: "Alola", name: "Rowlet/Litten/Popplio" },
        { ids: [810, 813, 816], gen: "Galar", name: "Grookey/Scorbunny/Sobble" },
        { ids: [906, 909, 912], gen: "Paldea", name: "Sprigatito/Fuecoco/Quaxly" },
      ];

      // If no arguments, show all regions
      if (!args[0]) {
        let text = "🌟 *Choose your starter Pokémon!* 🌟\n\n";
        text += "Pick 3 from any region:\n\n";
        STORTERS.forEach((r, i) => {
          text += (i + 1) + ". " + r.gen + " — " + r.name + "\n";
        });
        text += "\nUse *!starters <region #> <slot> (1-3)*\n";
        text += "Example: *!starters 1 1* (pick Gen 1 for slot 1)\n";
        text += "Do this 3 times to pick your team of 3!";
        return ctx.reply(text);
      }

      // Pick a starter
      const regionIdx = parseInt(args[0]) - 1;
      const slotNum = parseInt(args[1]) || (t.team.length + 1);
      if (isNaN(regionIdx) || regionIdx < 0 || regionIdx >= STORTERS.length) return ctx.reply("Invalid region. Use *!starters* to see regions.");
      
      // Show the 3 choices for this region
      const region = STORTERS[regionIdx];
      const speciesList = await Promise.all(region.ids.map(id => fetchSpecies(id)));
      
      if (!args[2]) {
        let text = "🌟 *" + region.gen + " starters*\n\n";
        speciesList.forEach((s, i) => {
          text += (i + 1) + ". " + s.name + " — " + s.types.join("/") + "\n";
        });
        text += "\nChoose: *!starters " + (regionIdx + 1) + " " + (slotNum) + " <1/2/3>*";
        return ctx.reply(text);
      }

      const choice = parseInt(args[2]) - 1;
      if (isNaN(choice) || choice < 0 || choice >= speciesList.length) return ctx.reply("Invalid choice. Pick 1, 2, or 3.");

      const chosen = speciesList[choice];
      const mon = createMonster(chosen.id, 10);
      await recalc(mon);
      
      // Add to team (or first available slot)
      while (t.team.length < slotNum - 1 && t.team.length < 6) {
        // Fill empty slots if needed
        t.team.push(null);
      }
      if (slotNum <= 6) {
        if (t.team[slotNum - 1]) return ctx.reply("Slot " + slotNum + " is already taken!");
        t.team[slotNum - 1] = mon;
      } else {
        t.team.push(mon);
      }
      
      // Remove null entries
      t.team = t.team.filter(m => m !== null);
      save();

      await sock.sendMessage(msg.key.remoteJid, {
        image: { url: chosen.sprite },
        caption: "🌟 " + t.name + " chose " + chosen.name + " (Lv10)!\n\nYour journey begins!" + (t.team.length < 3 ? "\nPick more with *!starters*" : "\nUse *!hunt* to find wild Pokémon!")
      });
    },
    journey: "starters",
    begin: "starters",

    hunt: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (t.team.length >= 6) return ctx.reply("Your party is full! Use *!store* to send some to PC.");

      await ctx.react("🌿");
      const enc = await wildEncounter(uid);
      const shinyTag = enc.mon.shiny ? "✨ SHINY! ✨" : "";

      // Send animated sprite + encounter text
      await sock.sendMessage(msg.key.remoteJid, {
        image: { url: enc.species.sprite || enc.species.artwork },
        caption: `🌿 *Wild ${enc.species.name} appeared!* ${shinyTag}\nLv${enc.mon.level} | ${enc.species.types.join("/")}\nHP: ${enc.mon.hp}/${enc.mon.maxHp}\n\nUse *!throw <ball>* to catch it\nUse *!fight* to battle it\nUse *!flee* to run`
      });
    },

    throw: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      // Check if in a wild encounter — simplified: just attempt catch
      const enc = await wildEncounter(uid);
      const ball = (args[0] || "pokeball").toLowerCase();
      const result = await attemptCatch(uid, enc.mon, ball);
      if (result.error) return ctx.reply("❌ " + result.error);
      if (result.success) {
        const xpGain = 20 + enc.mon.level * 2;
        addXP(uid, xpGain);
        ctx.reply(`🎉 *Gotcha! ${enc.species.name} was caught!*\nLv${enc.mon.level} | ${enc.mon.nature} nature${enc.mon.shiny ? " ✨ SHINY" : ""}\n⭐ +${xpGain} XP`);
      } else {
        const hpBar = "█".repeat(Math.max(1, Math.round((enc.mon.hp / enc.mon.maxHp) * 10))) + "░".repeat(Math.max(0, 10 - Math.round((enc.mon.hp / enc.mon.maxHp) * 10)));
        ctx.reply(`💨 *${enc.species.name} broke free!*\nHP: ${hpBar} ${enc.mon.hp}/${enc.mon.maxHp}\n` + (result.ranAway ? "It ran away!" : "Try again!"));
      }
    },

    fight: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (t.team.length === 0) return ctx.reply("No Pokémon in your party! Use *!hunt* first.");
      if (t.team[0].hp <= 0) return ctx.reply("Your Pokémon has fainted! Use *!heal* to restore them.");
      // Simplified wild battle - just do damage and give XP
      const enc = await wildEncounter(uid);
      const dmg = Math.floor(Math.random() * 20) + 10;
      const xpGain = 8 + enc.mon.level;
      addXP(uid, xpGain);
      ctx.reply(`⚔️ *${t.team[0].nickname || (await fetchSpecies(t.team[0].speciesId)).name} used Tackle!*\n${dmg} damage to wild ${enc.species.name}!\n⭐ +${xpGain} XP`);
    },

    flee: async (sock, msg, args, ctx) => {
      ctx.reply("🏃 You fled from the wild Pokémon!");
    },

    // ── PARTY & STORAGE ──────────────────────────────────────
    party: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (t.team.length === 0) return ctx.reply("No Pokémon! Use *!hunt* to find some.");

      let text = `🏆 *${t.name || "Trainer"}* — Lv${t.level} | ${t.wins}W/${t.losses}L | ⭐ ${t.xp}/${xpForLevel(t.level)} XP\n\n`;
      text += `*Party (${t.team.length}/6)*\n\n`;

      for (let i = 0; i < t.team.length; i++) {
        const p = t.team[i];
        const s = await fetchSpecies(p.speciesId);
        const hpBar = "█".repeat(Math.max(1, Math.round((p.hp / p.maxHp) * 10))) + "░".repeat(Math.max(0, 10 - Math.round((p.hp / p.maxHp) * 10)));
        text += `${i + 1}. ${p.shiny ? "✨ " : ""}*${p.nickname || s.name}* Lv${p.level}\n   HP ${hpBar} ${p.hp}/${p.maxHp} | ${p.nature}\n`;
      }
      if (t.pc.length > 0) text += `\n📦 *PC:* ${t.pc.length} stored (use *!pc* to view)`;
      text += `\n\n💰 ${t.coins} coins | 🎒 ${Object.entries(t.items).filter(([k, v]) => v > 0).length} item types`;

      await sock.sendMessage(msg.key.remoteJid, {
        image: { url: getArtwork(t.team[0].speciesId) },
        caption: text
      });
    },

    pc: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (t.pc.length === 0) return ctx.reply("PC is empty.");
      let text = `*📦 Pokémon Storage (${t.pc.length} total)*\n\n`;
      for (let i = 0; i < Math.min(t.pc.length, 30); i++) {
        const p = t.pc[i];
        const s = await fetchSpecies(p.speciesId);
        text += `${i + 1}. ${p.shiny ? "✨ " : ""}*${p.nickname || s.name}* Lv${p.level} HP:${p.hp}/${p.maxHp}\n`;
      }
      if (t.pc.length > 30) text += `\n...and ${t.pc.length - 30} more`;
      text += `\n\nUse *!withdraw <num>* to move to party`;
      ctx.reply(text);
    },

    store: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const idx = parseInt(args[0]) - 1;
      if (isNaN(idx)) return ctx.reply("Usage: *!store <number>* (from your party)");
      const r = moveToPC(uid, idx);
      if (r.error) return ctx.reply("❌ " + r.error);
      ctx.reply("✅ Moved to PC.");
    },
    t2pc: "store",

    withdraw: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const idx = parseInt(args[0]) - 1;
      if (isNaN(idx)) return ctx.reply("Usage: *!withdraw <number>* (from PC)");
      const r = moveToTeam(uid, idx);
      if (r.error) return ctx.reply("❌ " + r.error);
      ctx.reply("✅ Moved to party.");
    },
    t2party: "withdraw",

    swap: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const i = parseInt(args[0]) - 1, j = parseInt(args[1]) - 1;
      if (isNaN(i) || isNaN(j)) return ctx.reply("Usage: *!swap <num1> <num2>*");
      const r = swapTeam(uid, i, j);
      if (r.error) return ctx.reply("❌ " + r.error);
      ctx.reply("✅ Swapped positions.");
    },

    // ── DUEL (PvP Battle) ───────────────────────────────────
    duel: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      const target = mentioned?.[0] || args[0];
      if (!target) return ctx.reply("Tag someone to duel! Use *!duel @user*");
      if (target.includes(uid)) return ctx.reply("Can't duel yourself!");
      const r = createBattle(uid, target);
      if (r.error) return ctx.reply("❌ " + r.error);
      const t1 = getTrainer(uid), t2 = getTrainer(target);
      const s1 = await fetchSpecies(t1.team[0].speciesId);
      const s2 = await fetchSpecies(t2.team[0].speciesId);

      const moves1 = t1.team[0].moves || [];
      const moves2 = t2.team[0].moves || [];
      let moveText = "\n\n*Your moves:*\n";
      moves1.forEach((m, i) => {
        moveText += (i + 1) + ". " + m.name + " (" + m.type + ", " + (m.power || 0) + ")\n";
      });

      await sock.sendMessage(msg.key.remoteJid, {
        image: { url: s1.sprite },
        caption: `⚔️ *Duel started!* (ID: \`${r.id}\`)\n\n${t1.name || uid.slice(0, 8)}: ${s1.name} Lv${t1.team[0].level}\n⚡ VS ⚡\n${t2.name || target.slice(0, 8)}: ${s2.name} Lv${t2.team[0].level}\n\nUse *!strike ${r.id} <move#>${moveText}\n*!switch ${r.id} <n>* to switch\n*!surrender ${r.id}* to forfeit`
      });
    },

    strike: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const bid = args[0];
      const moveIdx = parseInt(args[1]) - 1;
      if (!bid) return ctx.reply("Usage: *!strike <battleId> <move#>*");
      
      // If no move specified, show available moves
      if (isNaN(moveIdx)) {
        const b = Object.values(require("../src/tools/pokemonGame").battleState || {}).find(bs => bs.id === bid);
        // Try to find the battle
        const t = getTrainer(uid);
        if (t.team[0]?.moves) {
          let txt = "⚔️ *Choose a move*\n\n";
          t.team[0].moves.forEach((m, i) => {
            txt += (i + 1) + ". " + m.name + " (" + m.type + ", " + (m.power || 0) + ")\n";
          });
          txt += "\nUse *!strike " + bid + " <number>*";
          return ctx.reply(txt);
        }
        return ctx.reply("Usage: *!strike <battleId> <move#>*");
      }

      const r = await battleAction(bid, uid, "attack", moveIdx);
      if (r.error) return ctx.reply("❌ " + r.error);

      const b = r.result;

      if (b.action === "miss") {
        return ctx.reply(`❌ ${b.attName}'s ${b.moveName} missed!`);
      }

      if (b.battleOver) {
        return ctx.reply(`🏆 *Battle Over!* ${b.winner === uid ? "You win!" : "You lost!"}\n\n${b.description}`);
      }

      // Show moves for next turn
      const t = getTrainer(uid);
      let moveList = "\n\n*Your moves:*\n";
      (t.team[0]?.moves || []).forEach((m, i) => {
        moveList += (i + 1) + ". " + m.name + " (" + m.type + ", " + (m.power || 0) + ")\n";
      });

      await sock.sendMessage(msg.key.remoteJid, {
        image: { url: b.attSprite || getSprite(1) },
        caption: `⚔️ *Duel Update*\n\n${b.description}${b.fainted ? "*💀 " + b.fainted + " fainted!*\n" : ""}${b.switched ? "*🔄 Opponent switched!*\n" : ""}${moveList}\nUse *!strike ${bid} <move#>*`
      });
    },

    surrender: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const bid = args[0];
      if (!bid) return ctx.reply("Usage: *!surrender <battleId>*");
      const r = await battleAction(bid, uid, "run");
      ctx.reply(r.result?.success ? "🏳️ You surrendered!" : "Couldn't surrender!");
    },

    // ── DEX ──────────────────────────────────────────────────
    dex: async (sock, msg, args, ctx) => {
      const q = args.join(" ");
      if (!q) return ctx.reply("Usage: *!dex <name or #>*");
      const s = await searchMon(q);
      if (!s) return ctx.reply("Not found.");
      const text = `📖 *${s.name}* #${s.id}\n${s.genus}\n\n${s.flavor.slice(0, 300)}\n\nType: ${s.types.join("/")}\nStats: HP${s.stats.hp} ATK${s.stats.attack} DEF${s.stats.defense} SPA${s.stats.spAttack} SPD${s.stats.spDefense} SPE${s.stats.speed}\nHt: ${s.height} Wt: ${s.weight}`;

      if (s.artwork) {
        await sock.sendMessage(msg.key.remoteJid, { image: { url: s.artwork }, caption: text });
      } else {
        ctx.reply(text);
      }
    },

    // ── HEAL ─────────────────────────────────────────────────
    heal: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const count = healAll(uid);
      ctx.reply(count > 0 ? `💊 Healed ${count} Pokémon!` : "All Pokémon are healthy!");
    },

    // ── SHOP ─────────────────────────────────────────────────
    mart: async (sock, msg, args, ctx) => {
      const items = Object.entries(ITEMS);
      let text = "🏪 *Poké Mart*\n\n";
      items.forEach(([k, v]) => {
        text += `• *${v.name}* — ${v.price} coins\n  ${v.desc}\n`;
      });
      text += `\nUse *!buy <item> [count]* to purchase\nUse *!bag* to see your items`;
      ctx.reply(text);
    },

    buy: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const itemName = args[0]?.toLowerCase();
      const count = parseInt(args[1]) || 1;
      const item = ITEMS[itemName];
      if (!item) return ctx.reply("Item not found. Check *!mart*");
      const cost = item.price * count;
      if (t.coins < cost) return ctx.reply(`Need ${cost} coins, you have ${t.coins}.`);
      t.coins -= cost;
      t.items[itemName] = (t.items[itemName] || 0) + count;
      save();
      ctx.reply(`✅ Bought ${count}x ${item.name} for ${cost} coins.`);
    },
    bag: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const inv = Object.entries(t.items).filter(([k, v]) => v > 0);
      if (inv.length === 0) return ctx.reply("Your bag is empty. Check *!mart*");
      let text = "🎒 *Bag*\n\n";
      inv.forEach(([k, v]) => {
        const item = ITEMS[k];
        if (item) text += `• *${item.name}* x${v}\n`;
      });
      text += `\n💰 ${t.coins} coins`;
      ctx.reply(text);
    },

    // ── USE ITEM ────────────────────────────────────────────
    use: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const itemName = args[0]?.toLowerCase();
      const target = parseInt(args[1]) - 1;
      if (!itemName || isNaN(target)) return ctx.reply("Usage: *!use <item> <party#>*");
      const r = useItem(uid, itemName, target);
      if (r.error) return ctx.reply("❌ " + r.error);
      ctx.reply(`✅ Used ${r.name}!${r.heal ? " Restored " + r.heal + " HP." : ""}${r.newLevel ? " Leveled up to " + r.newLevel + "!" : ""}`);
    },

    // ── EVOLVE ──────────────────────────────────────────────
    evolve: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const idx = parseInt(args[0]) - 1;
      if (isNaN(idx)) return ctx.reply("Usage: *!evolve <party#>*");
      await ctx.react("✨");
      const r = await evolve(uid, idx);
      if (r.error) return ctx.reply("❌ " + r.error);

      await sock.sendMessage(msg.key.remoteJid, {
        image: { url: r.sprite },
        caption: `✨ *${r.oldName} is evolving!*\n\n🎉 *${r.oldName} evolved into ${r.newName}!*`
      });
    },

    // ── MATCHUP ─────────────────────────────────────────────
    matchup: async (sock, msg, args, ctx) => {
      const types = args.join(" ").toLowerCase().split(/[/\s]+/);
      if (types.length === 0) return ctx.reply("Usage: *!matchup fire water*");
      const atk = types[0];
      const defs = types.slice(1);
      if (defs.length === 0) return ctx.reply("Need at least 1 defending type.");
      const eff = getEffectiveness(atk, defs);
      let text = `⚔️ *${atk.toUpperCase()} vs ${defs.join("/").toUpperCase()}*\n\n`;
      text += eff > 1 ? "💥 Super effective! (x" + eff + ")" : eff === 1 ? "➖ Normal damage" : eff === 0 ? "❌ No effect!" : "⚠️ Not very effective... (x" + eff + ")";
      ctx.reply(text);
    },

    // ── BADGES ──────────────────────────────────────────────

    // ── MOVES & LEARNING ─────────────────────────────────────
    learn: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const partyIdx = parseInt(args[0]) - 1;
      
      if (isNaN(partyIdx) || !t.team[partyIdx]) return ctx.reply("Usage: *!learn <party#> [move name] [slot to forget]*");
      const mon = t.team[partyIdx];
      const s = await fetchSpecies(mon.speciesId);
      const { fetchLearnableMoves, findMoveByName } = require("../src/tools/pokemonLearnset");

      // Show learnable moves if no move specified
      const moveName = args.slice(1, -1).join(" ");
      const forgetSlot = parseInt(args[args.length - 1]);

      if (!moveName || isNaN(forgetSlot)) {
        const learnable = await fetchLearnableMoves(mon.speciesId, mon.level);
        if (learnable.length === 0) return ctx.reply(s.name + " can't learn any more moves right now.");
        
        let text = "*" + s.name + " (Lv" + mon.level + ")* can learn:\n\n";
        learnable.slice(0, 30).forEach(m => {
          if (m.method === "level-up") {
            text += "• " + m.name + " (Lv" + m.learnLevel + ")\n";
          } else {
            text += "• " + m.name + "\n";
          }
        });
        text += "\n\n*Current moves:*\n";
        (mon.moves || []).forEach((m, i) => {
          text += (i + 1) + ". " + m.name + " (" + (m.type || "?") + ")\n";
        });
        text += "\nTo learn: *!learn " + (partyIdx + 1) + " <move name> <slot 1-4>*";
        return ctx.reply(text);
      }

      // Find the move
      const moveData = findMoveByName(moveName);
      if (!moveData) return ctx.reply("Move not found. Check the name.");
      
      const slotIdx = forgetSlot - 1;
      if (slotIdx < 0 || slotIdx > 3) return ctx.reply("Slot must be 1-4.");

      // Check if already knows it
      if (mon.moves?.some(m => m.name.toLowerCase() === moveData.name.toLowerCase())) {
        return ctx.reply(s.name + " already knows " + moveData.name + "!");
      }

      // Replace move
      if (!mon.moves) mon.moves = [];
      if (mon.moves.length <= slotIdx) {
        // Add new move to empty slot
        mon.moves.push(moveData);
      } else {
        mon.moves[slotIdx] = moveData;
      }

      save();
      ctx.reply("✅ " + s.name + " learned " + moveData.name + "! (forgot " + (mon.moves[slotIdx]?.name || "nothing") + ")");
    },

    pmi: async (sock, msg, args, ctx) => {
      const moveName = args.join(" ");
      if (!moveName) return ctx.reply("Usage: *!pmi <move name>*");
      const { findMoveByName } = require("../src/tools/pokemonLearnset");
      const move = findMoveByName(moveName);
      if (!move) return ctx.reply("Move not found.");
      
      const effText = move.type.charAt(0).toUpperCase() + move.type.slice(1);
      let text = "*" + move.name + "*\n";
      text += "Type: " + effText + "\n";
      text += "Category: " + (move.cat || "status").charAt(0).toUpperCase() + (move.cat || "status").slice(1) + "\n";
      text += "Power: " + (move.power || "—") + "\n";
      text += "Accuracy: " + (move.acc || "—") + "\n";
      text += "PP: " + (move.pp || "—") + "\n";
      if (move.desc) text += "\n" + move.desc;
      ctx.reply(text);
    },

    badges: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const badges = t.badges.length > 0 ? t.badges.map((b, i) => `${i + 1}. ${b}`).join("\n") : "No badges yet. Challenge gyms to earn them!";
      ctx.reply(`🏅 *${t.name || "Trainer"}'s Badges*\n\n${badges}`);
    },
  },
};
