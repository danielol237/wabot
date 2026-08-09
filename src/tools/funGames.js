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
  "Bro you dey shout for nothing, calm down.",
  "You talk too much. What you even done achieve sef?",
  "Mouth dey work, but the hand no dey follow.",
  "You carry yourself like big man but na small thing.",
  "Shey na fight you want? Because you don find am.",
  "You sabi talk, but the work no dey show.",
  "Who teach you to dey talk like this? It no dey make sense.",
  "You dey form big man but your pocket dey cry every night.",
  "You too dey flex. Small thing wey you get, you dey carry am like gold.",
  "Make you calm down before you talk. You no dey hear yourself.",
  "You get mouth but nothing to back am up. Abeg.",
  "Na so you dey carry on? E no fit take you anywhere.",
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
