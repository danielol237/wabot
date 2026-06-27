const axios = require("axios");

// Keyless CoinGecko public API — no signup, no key, confirmed working endpoint.
// Rate limit is shared/IP-based (~10-30 calls/min), which is plenty for periodic
// background checks (every 30 min) rather than rapid polling.
async function getCryptoPrice(coinId) {
  try {
    const res = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: { ids: coinId.toLowerCase(), vs_currencies: "usd" },
      timeout: 10000,
    });

    const price = res.data?.[coinId.toLowerCase()]?.usd;
    if (price === undefined) return { success: false, error: `Couldn't find a coin called "${coinId}". Try the full name, e.g. "bitcoin" not "btc".` };

    return { success: true, price };
  } catch (err) {
    console.error("Price check error:", err.message);
    return { success: false, error: err.message };
  }
}

// Parses a condition string like "below 80000" or "above 100k" into a checkable function
function parseCondition(conditionText) {
  const lower = conditionText.toLowerCase().replace(/,/g, "");
  const match = lower.match(/(below|under|above|over)\s*\$?([\d.]+)\s*(k|m)?/);
  if (!match) return null;

  const direction = match[1] === "below" || match[1] === "under" ? "below" : "above";
  let value = parseFloat(match[2]);
  if (match[3] === "k") value *= 1000;
  if (match[3] === "m") value *= 1000000;

  return {
    direction,
    value,
    check: (price) => (direction === "below" ? price < value : price > value),
    label: `${direction} $${value.toLocaleString()}`,
  };
}

module.exports = { getCryptoPrice, parseCondition };
