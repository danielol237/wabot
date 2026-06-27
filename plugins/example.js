// Example plugin — copy this file as a starting point for new ones.
// Drop a new .js file in this /plugins folder and restart the bot to load it.

module.exports = {
  name: "example",
  commands: {
    // Triggered by "!ping" (the prefix is added automatically by the handler)
    ping: async (sock, msg, args, ctx) => {
      await ctx.reply("🏓 Pong! Plugin system is working.");
    },

    // Triggered by "!echo whatever you type"
    echo: async (sock, msg, args, ctx) => {
      const text = args.join(" ");
      await ctx.reply(text || "Nothing to echo — try: !echo hello");
    },
  },
};
