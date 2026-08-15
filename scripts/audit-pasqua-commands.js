const { commands, detectCommandCollisions } = require("../src/utils/commandRouter");

const requested = `
antibot antidemote antigroupmention antigroupstatus antihijack antimention antipromote approve clearwarn confirmkick deploy getgpp introcard kickall listactive listadmins listinactive membercount setgoodbyemsg setgpp setwelcomemsg slowmode
ascii b64decode b64encode base base64 bin binary caesar capitalize charcount clap datefmt dedupe factorial fibonacci fontmaker gcd hash hexdecode hexencode iss lcm leet len lower lowerall md5 mirror mock morse password pct percentage pp prime qrcode quoted randomcolor reverse roman rot13 sha1 sha256 shorturl slugify spongebob timestamp timezone title unascii unbin upper urldecode urlencode uuid vapor vowelcount wordcount
randomanimal randomanime randomcity randomcountry randomdrink randomemoji randomfood randomletter randomname randomnumber randompokemon randompp randomword
8ball advice answer awoo beauty blush bonk brainteaser choose chucknorris colorname compliment cry dadjoke emoji friendship hug insult kill kiss lovecalc match meme milf motivate2 neverhaveiever owofy pass2 pat pickup poke predict punch quote rate riddle shinobu simp slap smack truth2 wcg wink yomama
aichat essay summarize
private public setbio setname setpp`.trim().split(/\s+/);

const excluded = new Set(["approve", "confirmkick", "private", "public"]);
const entries = commands.map((command) => ({ name: command.name, aliases: command.aliases || [], category: command.category, ownerOnly: !!command.ownerOnly, description: command.description }));
const triggerMap = new Map();
for (const command of entries) {
  for (const trigger of [command.name, ...command.aliases]) triggerMap.set(trigger, command);
}
const missing = requested.filter((name) => !triggerMap.has(name) && !excluded.has(name));
const intentionalExclusions = requested.filter((name) => !triggerMap.has(name) && excluded.has(name));
const present = requested.filter((name) => triggerMap.has(name)).map((name) => ({ requested: name, command: triggerMap.get(name).name, category: triggerMap.get(name).category, ownerOnly: triggerMap.get(name).ownerOnly }));
process.stdout.write(JSON.stringify({ requestedCount: requested.length, registeredCount: commands.length, missing, intentionalExclusions, present, collisions: detectCommandCollisions() }, null, 2));
