// Lightweight party/fun commands — all self-contained, no external API needed
// except where noted. Kept PG — no NSFW, no real-money gambling.

const JOKES = [
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my computer I needed a break, and it said no problem — it'll go to sleep.",
  "Why did the developer go broke? Because he used up all his cache.",
  "I would tell you a UDP joke, but you might not get it.",
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "There are 10 types of people in the world: those who understand binary, and those who don't.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I'm reading a book about anti-gravity. It's impossible to put down.",
];

const TRUTHS = [
  "What's the most embarrassing thing you've ever done in public?",
  "What's a lie you told that you never got caught for?",
  "Who's the last person you stalked on social media?",
  "What's the weirdest thing you've ever Googled?",
  "What's your biggest fear that you've never told anyone?",
  "Have you ever cheated on a test?",
  "What's the most trouble you've ever been in?",
];

const DARES = [
  "Send the 5th photo in your gallery, no matter what it is.",
  "Text your crush 'I miss you' right now.",
  "Speak in an accent for the next 10 minutes.",
  "Post an embarrassing selfie as your status for 1 hour.",
  "Call a random contact and sing happy birthday to them.",
  "Let the group pick your profile picture for the next hour.",
];

const WYR = [
  "Would you rather have unlimited money or unlimited time?",
  "Would you rather know when you'll die or how you'll die?",
  "Would you rather be able to fly or be invisible?",
  "Would you rather lose all your memories or never make new ones?",
  "Would you rather always be 10 minutes late or always be 20 minutes early?",
];

const ROASTS = [
  "You're a waste of air, and everyone around you knows it.",
  "Even your own mother looks at you and wonders where she went wrong.",
  "Nobody's scared of you. Even the mirror rejects you.",
  "You talk all that big man shit but your girl left because you can't satisfy her. Sad.",
  "Fuck you? You couldn't even handle a woman with that lil carrot you call a dick. Sit down.",
  "You're the reason your family stopped having reunions.",
  "Your existence is a burden nobody asked for.",
  "You'd be a disappointment even if you tried.",
  "People tolerate you out of pity, not respect.",
  "You couldn't even be a good example of a bad person.",
  "Your face is the reason cameras get nervous.",
  "You're so forgettable, even your own shadow leaves when you walk.",
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getJoke() { return randomFrom(JOKES); }
function getTruth() { return randomFrom(TRUTHS); }
function getDare() { return randomFrom(DARES); }
function getWouldYouRather() { return randomFrom(WYR); }
function getRoast() { return randomFrom(ROASTS); }

// Fun "compatibility" generator between two names — just for laughs, deterministic per pair
// so the same two names always get the same number (feels less random/fake).
function getShipPercentage(name1, name2) {
  const combined = (name1 + name2).toLowerCase().split("").sort().join("");
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 31 + combined.charCodeAt(i)) % 100;
  }
  return Math.abs(hash);
}

function getShipEmoji(percentage) {
  if (percentage >= 90) return "💞 Soulmates!";
  if (percentage >= 70) return "❤️ Great match!";
  if (percentage >= 50) return "💛 Could work!";
  if (percentage >= 30) return "💔 Rocky road...";
  return "☠️ Stay away from each other";
}

module.exports = { getJoke, getTruth, getDare, getWouldYouRather, getRoast, getShipPercentage, getShipEmoji };
