// Pokémon Plugin — catch, battle, team, inventory, pokedex
const { getTrainer, addXP, attemptCatch, createBattle, executeTurn, getBattleState, getPokemonSummary, createPokemonInstance, recalcStats, getXPForLevel } = require("../src/tools/pokemonGame");
const { fetchSpecies, searchPokemon, getRandomPokemonId } = require("../src/tools/pokemonData");

module.exports = {
  name: "pokemon",
  commands: {
    // !catch — try to catch a wild Pokémon
    catch: async (sock, msg, args, ctx) => {
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const ballType = args[0]?.toLowerCase() || "pokeball";
      if (!["pokeball", "greatball", "ultraball"].includes(ballType)) return ctx.reply("Invalid ball! Use pokeball, greatball, or ultraball.");

      await ctx.react("🎯");
      const result = await attemptCatch(senderJid, ballType);

      if (result.error) return ctx.reply("❌ " + result.error);

      if (result.success) {
        const emoji = result.species.types[0] === "fire" ? "🔥" : result.species.types[0] === "water" ? "💧" : "⚡";
        ctx.reply(`${emoji} *Wild ${result.species.name} caught!* Lv${result.level}\nType: ${result.species.types.join("/")}\nAdded to your ${getTrainer(senderJid).team.length <= 6 ? "team" : "PC"}.`);
      } else {
        ctx.reply(`💨 *Wild ${result.species.name} broke free!*` + (result.ranAway ? "\nIt ran away..." : " Try again!"));
      }
    },

    // !team — view your Pokémon team
    team: async (sock, msg, args, ctx) => {
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(senderJid);
      if (t.team.length === 0) return ctx.reply("You have no Pokémon! Use *!catch* to find some.");

      let text = `*${t.name || "Trainer"}* — Level ${t.level} (${t.wins}W/${t.losses}L)\n`;
      text += `*Team (${t.team.length}/6)*\n\n`;

      for (let i = 0; i < t.team.length; i++) {
        const p = t.team[i];
        const species = await fetchSpecies(p.speciesId);
        text += `${i + 1}. ${getPokemonSummary(p, species)}\n`;
      }

      if (t.pc.length > 0) text += `\n📦 PC: ${t.pc.length} Pokémon stored`;
      text += `\n\n🎒 ${t.inventory.pokeballs} Pokéballs | ${t.inventory.greatballs} Great | ${t.inventory.ultraballs} Ultra`;
      text += ` | ${t.inventory.potions} Potions | ${t.inventory.superpotions} Super Potions`;

      ctx.reply(text);
    },

    // !pokedex <name/id> — look up a Pokémon
    pokedex: async (sock, msg, args, ctx) => {
      const q = args.join(" ");
      if (!q) return ctx.reply("Usage: *!pokedex pikachu* or *!pokedex 25*");
      await ctx.react("📖");
      const species = await searchPokemon(q);
      if (!species) return ctx.reply("Pokémon not found. Check the name or ID.");
      const text = `*#${species.id} ${species.name}*\n${species.genus}\n\n📖 ${species.flavor.slice(0, 300)}\n\nType: ${species.types.join("/")}\nStats: HP ${species.stats.hp} | ATK ${species.stats.attack} | DEF ${species.stats.defense} | SPA ${species.stats.spAttack} | SPD ${species.stats.spDefense} | SPE ${species.stats.speed}\nHeight: ${species.height} | Weight: ${species.weight}`;

      if (species.artwork) {
        await sock.sendMessage(msg.key.remoteJid, { image: { url: species.artwork }, caption: text });
      } else {
        ctx.reply(text);
      }
    },
    dex: "pokedex",

    // !battle @user — challenge someone to a battle
    battle: async (sock, msg, args, ctx) => {
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      const target = mentioned?.[0] || args[0];

      if (!target) return ctx.reply("Tag someone to battle! *!battle @user*");
      if (target.includes(senderJid)) return ctx.reply("You can't battle yourself!");

      const t1 = getTrainer(senderJid);
      if (t1.team.length === 0) return ctx.reply("You have no Pokémon to battle with! Use *!catch* first.");
      const t2 = getTrainer(target);
      if (t2.team.length === 0) return ctx.reply("They have no Pokémon!");

      const result = createBattle(senderJid, target);
      if (result.error) return ctx.reply("❌ " + result.error);

      // First turn info
      const p1 = await fetchSpecies(t1.team[0].speciesId);
      const p2 = await fetchSpecies(t2.team[0].speciesId);
      ctx.reply(`⚔️ *Battle started!* (ID: ${result.battleId})\n\n${t1.name || "Trainer 1"}: ${p1.name} Lv${t1.team[0].level}\nVS\n${t2.name || "Trainer 2"}: ${p2.name} Lv${t2.team[0].level}\n\nUse *!attack ${result.battleId}* or *!switch ${result.battleId} <num>* or *!run ${result.battleId}*`);
    },

    // !attack <battleId> — attack in battle
    attack: async (sock, msg, args, ctx) => {
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const battleId = args[0];
      if (!battleId) return ctx.reply("Usage: *!attack <battleId>*");

      const result = await executeTurn(battleId, senderJid, "attack");
      if (result.error) return ctx.reply("❌ " + result.error);

      const { battle } = result;
      const t1 = getTrainer(battle.user1);
      const t2 = getTrainer(battle.user2);
      const p1 = await fetchSpecies(t1.team[battle.active1]?.speciesId);
      const p2 = await fetchSpecies(t2.team[battle.active2]?.speciesId);

      let text = `⚔️ *Battle Update* (ID: ${battleId})\n\n`;
      text += battle.log.slice(-3).join("\n") + "\n\n";
      text += `${t1.name || "T1"}: ${p1.name} [${t1.team[battle.active1].hp}/${t1.team[battle.active1].maxHp}HP]\n`;
      text += `${t2.name || "T2"}: ${p2.name} [${t2.team[battle.active2].hp}/${t2.team[battle.active2].maxHp}HP]`;

      if (result.result.battleOver) {
        text += "\n\n🏆 *Battle Over!*";
      } else {
        text += `\n\nIt's ${battle.turn === battle.user1 ? (t1.name || "T1") : (t2.name || "T2")}'s turn!`;
      }

      ctx.reply(text);
    },

    // !switch <battleId> <num> — switch active Pokémon
    switch: async (sock, msg, args, ctx) => {
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const battleId = args[0];
      const targetIdx = parseInt(args[1]) - 1;
      if (!battleId || isNaN(targetIdx)) return ctx.reply("Usage: *!switch <battleId> <number>*");

      const result = await executeTurn(battleId, senderJid, "switch", targetIdx);
      if (result.error) return ctx.reply("❌ " + result.error);
      ctx.reply("🔄 Switched! " + result.result.switchedTo);
    },

    // !run <battleId> — run from battle
    run: async (sock, msg, args, ctx) => {
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const battleId = args[0];
      if (!battleId) return ctx.reply("Usage: *!run <battleId>*");

      const result = await executeTurn(battleId, senderJid, "run");
      if (result.error) return ctx.reply("❌ " + result.error);
      ctx.reply(result.result.success ? "🏃 Ran away successfully!" : "Couldn't escape!");
    },

    // !shop — buy items
    shop: async (sock, msg, args, ctx) => {
      // Placeholder — would need a currency system
      ctx.reply("🏪 *Poké Mart*\n\nPokéball: 200 coins\nGreat Ball: 600 coins\nUltra Ball: 1200 coins\nPotion: 300 coins\nSuper Potion: 700 coins\n\n*(Economy system coming soon)*");
    },

    // !heal — heal all Pokémon
    heal: async (sock, msg, args, ctx) => {
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const t = getTrainer(senderJid);
      let healed = 0;
      for (const p of [...t.team, ...t.pc]) {
        if (p.hp < p.maxHp) { p.hp = p.maxHp; healed++; }
      }
      if (healed > 0) { ctx.reply(`💊 Healed ${healed} Pokémon!`); } else { ctx.reply("All your Pokémon are already healthy!"); }
    },
  },
};
