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


    // ── GYM CHALLENGE ────────────────────────────────────────
    gym: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);

      // Custom gym roster - original names/types
      const GYMS = [
        { id: 1, name: "Verdant Grove", type: "grass", leader: "Sylvia", levelCap: 12, badge: "Leaf Badge" },
        { id: 2, name: "Cinder Forge", type: "fire", leader: "Blaze", levelCap: 16, badge: "Ember Badge" },
        { id: 3, name: "Storm Peak", type: "electric", leader: "Volt", levelCap: 20, badge: "Bolt Badge" },
        { id: 4, name: "Abyss Depths", type: "water", leader: "Marina", levelCap: 25, badge: "Tide Badge" },
        { id: 5, name: "Iron Bastion", type: "steel", leader: "Ferrum", levelCap: 30, badge: "Alloy Badge" },
        { id: 6, name: "Shadow Vale", type: "ghost", leader: "Wraith", levelCap: 35, badge: "Phantom Badge" },
        { id: 7, name: "Crystal Spire", type: "psychic", leader: "Lumina", levelCap: 40, badge: "Mind Badge" },
        { id: 8, name: "Frost Cavern", type: "ice", leader: "Glaciel", levelCap: 45, badge: "Permafrost Badge" },
        { id: 9, name: "Dragon's Nest", type: "dragon", leader: "Drake", levelCap: 50, badge: "Wyrm Badge" },
      ];

      const gymNum = parseInt(args[0]);

      // Show gym list if no number given
      if (!gymNum || isNaN(gymNum)) {
        let text = "🏟️ *Pokémon Gyms*\n\n";
        text += "Defeat all 9 gyms to become Champion!\n\n";
        GYMS.forEach((g) => {
          const completed = t.badges?.includes(g.badge);
          const unlocked = t.badges ? g.id <= t.badges.length + 1 : g.id === 1;
          const status = completed ? "✅ Completed" : (unlocked ? "🆕 Available" : "🔒 Locked");
          text += (completed ? "✅" : unlocked ? "🆕" : "🔒") + " " + g.id + ". *" + g.name + "*\n";
          text += "   Leader: " + g.leader + " (" + g.type + ") | Cap: Lv" + g.levelCap + "\n";
          text += "   Status: " + status + "\n\n";
        });
        text += "Use *!gym <number>* to challenge!";
        return ctx.reply(text);
      }

      // Challenge a gym
      const gym = GYMS.find(g => g.id === gymNum);
      if (!gym) return ctx.reply("Invalid gym. Use *!gyms* to see all.");

      // Check if already completed
      if (t.badges?.includes(gym.badge)) return ctx.reply("You already defeated " + gym.name + " Gym!");

      // Check if unlocked
      const prevCompleted = t.badges ? t.badges.length : 0;
      if (gym.id > prevCompleted + 1) return ctx.reply("Complete the previous gym first!");

      // Check team
      if (t.team.length === 0) return ctx.reply("You need Pokémon to challenge a gym!");

      // Check level cap
      const overleveled = t.team.some(p => p.level > gym.levelCap);
      if (overleveled) return ctx.reply("Your Pokémon are too high level! Max allowed: Lv" + gym.levelCap);

      // Battle simulation - simplified gym fight
      await ctx.react("⚔️");
      ctx.reply("⚔️ *Challenge issued!*\n\n" + t.name + " vs " + gym.leader + " (" + gym.name + " Gym)\n\nCalculating battle...");

      // Simple win calculation based on team strength vs gym
      const teamPower = t.team.reduce((sum, p) => sum + p.level, 0);
      const gymPower = gym.levelCap * 3 * (1 + gym.id * 0.1);
      const winChance = Math.min(0.95, teamPower / gymPower * 0.8 + 0.1);
      const won = Math.random() < winChance;

      if (won) {
        if (!t.badges) t.badges = [];
        t.badges.push(gym.badge);
        const xpReward = 30 + gym.id * 10;
        addXP(uid, xpReward);
        save();

        await sock.sendMessage(msg.key.remoteJid, {
          image: { url: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/" + t.team[0].speciesId + ".gif" },
          caption: "🏆 *Victory!*\n\nYou defeated " + gym.leader + " and earned the *" + gym.badge + "*!\n⭐ +" + xpReward + " XP\n\n" + (gym.id < GYMS.length ? "Next: *" + GYMS[gym.id].name + " Gym*" : "🎉 *You've conquered all gyms! You're the Champion!*")
        });
      } else {
        ctx.reply("💔 *Defeated!*\n\n" + gym.leader + " was too strong. Train your Pokémon and try again!");
      }
    },
    gyms: "gym",

    // ── ELITE FOUR & CHAMPION ─────────────────────────────
    elite: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (!t.badges || t.badges.length < 8) return ctx.reply("You need all 8 badges to challenge the Elite Four! Use *!gym*");
      await ctx.react("⚔️");
      ctx.reply("⚔️ *Elite Four Challenge!*\n\nDefeat all 4 to face the Champion!\n\n1. Lorelei (Ice)\n2. Bruno (Fighting)\n3. Agatha (Ghost)\n4. Lance (Dragon)\n\nUse *!elite <1-4>* to challenge each member.");
    },

    champion: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (!t.badges || t.badges.length < 8) return ctx.reply("Defeat the Elite Four first!");
      await ctx.react("🏆");
      const teamPower = t.team.reduce((s, p) => s + p.level, 0);
      const win = Math.random() < Math.min(0.9, teamPower / 200);
      if (win) {
        const xp = 200;
        addXP(uid, xp);
        if (!t.badges.includes("Champion")) t.badges.push("Champion");
        save();
        ctx.reply("🏆 *You are the Champion!*\n\nYou defeated the Pokémon League!\n⭐ +" + xp + " XP\n\nYou can now access special features.");
      } else {
        ctx.reply("💔 The Champion defeated you. Train harder and try again!");
      }
    },
    badges: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const badges = t.badges.length > 0 ? t.badges.map((b, i) => `${i + 1}. ${b}`).join("\n") : "No badges yet. Challenge gyms to earn them!";
      ctx.reply(`🏅 *${t.name || "Trainer"}'s Badges*\n\n${badges}`);
    },

    // ── RAIDS ──────────────────────────────────────────────
    raid: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (t.team.length === 0) return ctx.reply("No Pokémon in party!");
      
      const tiers = [
        { name: "1-Star", level: 15, reward: 30 },
        { name: "3-Star", level: 25, reward: 60 },
        { name: "5-Star", level: 35, reward: 100 },
        { name: "Mega", level: 45, reward: 150 },
      ];
      
      const tierIdx = parseInt(args[0]) - 1;
      const tier = tiers[tierIdx] || tiers[Math.floor(Math.random() * tiers.length)];
      const raidMon = await fetchSpecies(randomId());
      const teamPower = t.team.reduce((s, p) => s + p.level, 0);
      const raidPower = tier.level * 4;
      const win = Math.random() < Math.min(0.85, teamPower / raidPower * 0.7 + 0.1);
      
      await ctx.react("⚔️");
      if (win) {
        addXP(uid, tier.reward);
        const rareItem = ["rarecandy", "ultraball", "firestone", "thunderstone"][Math.floor(Math.random() * 4)];
        t.items[rareItem] = (t.items[rareItem] || 0) + 1;
        save();
        ctx.reply("🏆 *" + tier.name + " Raid cleared!*\n\nDefeated a wild " + raidMon.name + "!\n⭐ +" + tier.reward + " XP\n🎁 +1 " + ITEMS[rareItem]?.name);
      } else {
        ctx.reply("💔 Raid failed. Train your Pokémon and try again!");
      }
    },

    // ── LEGENDARY HUNT ─────────────────────────────────────
    legendary: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      if (t.team.length === 0) return ctx.reply("No Pokémon in party!");
      if (t.level < 15) return ctx.reply("Reach trainer level 15 to hunt legendaries!");

      const legends = [144, 145, 146, 150, 151, 249, 250, 382, 383, 384, 483, 484, 487, 643, 644, 716, 717, 718, 789, 791, 792, 888, 889, 890, 1007, 1008];
      const targetId = legends[Math.floor(Math.random() * legends.length)];
      const species = await fetchSpecies(targetId);
      const level = Math.floor(Math.random() * 20) + 40;
      
      await ctx.react("✨");
      const ball = args[0]?.toLowerCase() || "ultraball";
      if (ball === "masterball") {
        t.items.masterball = (t.items.masterball || 0) - 1;
        const mon = createMonster(targetId, level);
        await recalc(mon);
        t.team.push(mon);
        save();
        return ctx.reply("✨ *" + species.name + " was caught!*\nLegendary Pokémon added to your team!");
      }
      
      const catchRate = 0.05 + t.level * 0.002;
      const caught = Math.random() < catchRate;
      
      if (caught) {
        const mon = createMonster(targetId, level);
        await recalc(mon);
        t.pc.push(mon);
        addXP(uid, 200);
        save();
        ctx.reply("✨ *" + species.name + " (Lv" + level + ") was caught!*\nLegendary sent to PC! ⭐ +200 XP");
      } else {
        ctx.reply("✨ A wild *" + species.name + "* appeared! But it broke free... Keep trying!");
      }
    },


    // ── DAILY QUESTS ───────────────────────────────────────
    daily: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const now = Date.now();
      if (now - (t.lastDaily || 0) < 86400000) {
        const remaining = Math.ceil((86400000 - (now - (t.lastDaily || 0))) / 3600000);
        return ctx.reply("Daily rewards already claimed! Come back in " + remaining + " hours.");
      }
      t.lastDaily = now;
      t.items.pokeball = (t.items.pokeball || 0) + 5;
      t.items.potion = (t.items.potion || 0) + 3;
      t.coins = (t.coins || 0) + 100;
      addXP(uid, 30);
      save();
      ctx.reply("⭐ *Daily Rewards Claimed!*\n+5 Pokéballs\n+3 Potions\n+100 Coins\n+30 XP");
    },

    // ── BREEDING ────────────────────────────────────────────
    breed: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const idx1 = parseInt(args[0]) - 1;
      const idx2 = parseInt(args[1]) - 1;
      if (isNaN(idx1) || isNaN(idx2)) return ctx.reply("Usage: *!breed <party#> <party#>*");
      if (!t.team[idx1] || !t.team[idx2]) return ctx.reply("Invalid party members.");
      const babyId = Math.random() < 0.5 ? t.team[idx1].speciesId : t.team[idx2].speciesId;
      const level = 1;
      const mon = createMonster(babyId, level);
      await recalc(mon);
      t.pc.push(mon);
      save();
      const s = await fetchSpecies(babyId);
      ctx.reply("🥚 A new *" + s.name + "* (Lv1) hatched! Sent to PC.");
    },


    // ── ABILITIES ───────────────────────────────────────────
    ability: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const idx = parseInt(args[0]) - 1;
      if (isNaN(idx)) return ctx.reply("Usage: *!ability <party#>*");
      const mon = t.team[idx] || t.pc[Math.abs(idx)];
      if (!mon) return ctx.reply("Pokemon not found.");
      if (!mon.ability) {
        const { getRandomAbility } = require("../src/tools/pokemonAbilities");
        mon.ability = getRandomAbility();
        save();
      }
      ctx.reply("*Ability:* " + mon.ability.name + "\n" + mon.ability.desc);
    },
    item: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const idx = parseInt(args[0]) - 1;
      const itemName = args.slice(1).join(" ");
      if (isNaN(idx) || !itemName) return ctx.reply("Usage: *!item <party#> <item name>*\nAvailable: Choice Band, Choice Specs, Assault Vest, Life Orb, Leftovers, Focus Sash, Rocky Helmet, Kings Rock, Type boosters");
      const mon = t.team[idx];
      if (!mon) return ctx.reply("Pokemon not found.");
      const { getHeldItem } = require("../src/tools/pokemonAbilities");
      const item = getHeldItem(itemName);
      if (!item) return ctx.reply("Item not found.");
      mon.heldItem = item;
      save();
      ctx.reply("*" + mon.nickname || "Pokemon" + "* now holds *" + item.name + "*: " + item.desc);
    },


    // ── MEGA EVOLUTION ─────────────────────────────────────
    mega: async (sock, msg, args, ctx) => {
      const uid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(uid);
      const idx = parseInt(args[0]) - 1;
      if (isNaN(idx)) return ctx.reply("Usage: *!mega <party#>*");
      const mon = t.team[idx];
      if (!mon) return ctx.reply("Pokemon not found.");
      if (mon.mega) return ctx.reply("Already Mega Evolved!");
      if (!t.items.meganite_x && !t.items.meganite_y) return ctx.reply("You need a Mega Stone! Buy at the mart.");
      mon.mega = true;
      mon.level += 5;
      await recalc(mon);
      if (t.items.meganite_x > 0) t.items.meganite_x--;
      else t.items.meganite_y--;
      save();
      const s = await fetchSpecies(mon.speciesId);
      ctx.reply("✨ *" + s.name + " Mega Evolved!*\nPower surged! +5 levels, stats boosted!");
    },

  },
};
