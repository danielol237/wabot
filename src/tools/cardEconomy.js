const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");
const ECONOMY_FILE = path.join(DATA_DIR, "economy.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Structure: { [userId]: { balance, lastDaily, inventory: [cardId, ...], xp } }
let economy = {};

try {
  if (fs.existsSync(ECONOMY_FILE)) {
    economy = JSON.parse(fs.readFileSync(ECONOMY_FILE, "utf8"));
  }
} catch (err) {
  console.error("Economy file corrupt, starting fresh:", err.message);
  economy = {};
}

function save() {
  try {
    fs.writeFileSync(ECONOMY_FILE, JSON.stringify(economy, null, 2));
  } catch (err) {
    console.error("Failed to save economy:", err.message);
  }
}

// Original creature roster — not Pokémon, own names/lore, simple rarity tiers.
// This is a from-scratch card set themed around elemental spirits.
const CARDS = [
  { id: "embercub", name: "Embercub", rarity: "common", element: "fire", emoji: "🔥" },
  { id: "tidalpup", name: "Tidalpup", rarity: "common", element: "water", emoji: "💧" },
  { id: "rootling", name: "Rootling", rarity: "common", element: "earth", emoji: "🌱" },
  { id: "gustwing", name: "Gustwing", rarity: "common", element: "air", emoji: "🍃" },
  { id: "voltail", name: "Voltail", rarity: "rare", element: "electric", emoji: "⚡" },
  { id: "frostfang", name: "Frostfang", rarity: "rare", element: "ice", emoji: "❄️" },
  { id: "duskmoth", name: "Duskmoth", rarity: "rare", element: "shadow", emoji: "🌙" },
  { id: "sunfeather", name: "Sunfeather", rarity: "epic", element: "light", emoji: "☀️" },
  { id: "magmaurus", name: "Magmaurus", rarity: "epic", element: "fire", emoji: "🌋" },
  { id: "leviadon", name: "Leviadon", rarity: "legendary", element: "water", emoji: "🐋" },
  { id: "stormking", name: "Stormking", rarity: "legendary", element: "electric", emoji: "🌩️" },
  { id: "voidwyrm", name: "Voidwyrm", rarity: "mythic", element: "shadow", emoji: "🐉" },
];

const RARITY_WEIGHTS = { common: 50, rare: 30, epic: 14, legendary: 5, mythic: 1 };
const RARITY_VALUE = { common: 50, rare: 150, epic: 400, legendary: 1000, mythic: 3000 };

function getUser(userId) {
  if (!economy[userId]) {
    economy[userId] = { balance: 100, lastDaily: 0, inventory: [], xp: 0 };
  }
  return economy[userId];
}

function getBalance(userId) {
  return getUser(userId).balance;
}

function addBalance(userId, amount) {
  getUser(userId).balance += amount;
  save();
}

function canClaimDaily(userId) {
  const user = getUser(userId);
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  return now - user.lastDaily >= DAY_MS;
}

function claimDaily(userId) {
  const user = getUser(userId);
  if (!canClaimDaily(userId)) {
    const remaining = 24 * 60 * 60 * 1000 - (Date.now() - user.lastDaily);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    return { success: false, error: `Already claimed. Come back in ${hours}h ${minutes}m.` };
  }
  const reward = 100 + Math.floor(Math.random() * 100);
  user.balance += reward;
  user.lastDaily = Date.now();
  save();
  return { success: true, reward };
}

function rollForCard() {
  const roll = Math.random() * 100;
  let cumulative = 0;
  let chosenRarity = "common";
  for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
    cumulative += weight;
    if (roll <= cumulative) {
      chosenRarity = rarity;
      break;
    }
  }
  const pool = CARDS.filter((c) => c.rarity === chosenRarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

function drawCard(userId, cost = 50) {
  const user = getUser(userId);
  if (user.balance < cost) return { success: false, error: `Need ${cost} coins, you have ${user.balance}.` };

  user.balance -= cost;
  const card = rollForCard();
  user.inventory.push(card.id);
  save();
  return { success: true, card };
}

function getInventory(userId) {
  const user = getUser(userId);
  const counts = {};
  for (const cardId of user.inventory) {
    counts[cardId] = (counts[cardId] || 0) + 1;
  }
  return Object.entries(counts).map(([cardId, count]) => {
    const card = CARDS.find((c) => c.id === cardId);
    return { ...card, count };
  });
}

function sellCard(userId, cardId) {
  const user = getUser(userId);
  const idx = user.inventory.indexOf(cardId);
  if (idx === -1) return { success: false, error: "You don't own that card." };

  const card = CARDS.find((c) => c.id === cardId);
  if (!card) {
    // Unknown card id in inventory — remove it and refund a nominal amount.
    user.inventory.splice(idx, 1);
    save();
    return { success: true, value: 5, card: { id: cardId, name: cardId, rarity: "common" } };
  }
  const value = Math.floor(RARITY_VALUE[card.rarity] * 0.6); // sell for 60% of value
  user.inventory.splice(idx, 1);
  user.balance += value;
  save();
  return { success: true, value, card };
}

function getLeaderboard(limit = 10) {
  return Object.entries(economy)
    .sort((a, b) => b[1].balance - a[1].balance)
    .slice(0, limit)
    .map(([userId, data]) => ({ userId, balance: data.balance }));
}

module.exports = {
  CARDS,
  RARITY_VALUE,
  getBalance,
  addBalance,
  canClaimDaily,
  claimDaily,
  drawCard,
  getInventory,
  sellCard,
  getLeaderboard,
};
