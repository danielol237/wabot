const modules = [
  "./src/tools/zaiMedia",
  "./src/tools/visionAI",
  "./src/tools/imageGen",
  "./src/tools/deathBattleVideo",
  "./src/tools/selfAwareness",
  "./src/tools/learnerPortal",
  "./src/animeSite",
  "./src/dashboard",
  "./src/website",
];
for (const modulePath of modules) {
  const loaded = require(`../${modulePath}`);
  if (!loaded || !["object", "function"].includes(typeof loaded)) throw new Error(`Unexpected export shape: ${modulePath}`);
  process.stdout.write(`imported ${modulePath}\n`);
}
