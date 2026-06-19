const axios = require("axios");

// ── Translation (free, no key — uses Google Translate's public endpoint) ──
async function translateText(text, targetLang) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await axios.get(url, { timeout: 10000 });
    const translated = res.data[0].map((part) => part[0]).join("");
    const detectedLang = res.data[2];
    return { success: true, translated, detectedLang };
  } catch (err) {
    console.error("Translation error:", err.message);
    return { success: false, error: err.message };
  }
}

// ── Currency conversion (free, no key) ──
async function convertCurrency(amount, from, to) {
  try {
    const url = `https://api.exchangerate-api.com/v4/latest/${from.toUpperCase()}`;
    const res = await axios.get(url, { timeout: 10000 });
    const rate = res.data.rates[to.toUpperCase()];
    if (!rate) return { success: false, error: `Currency ${to} not found.` };
    const result = (amount * rate).toFixed(2);
    return { success: true, result, rate };
  } catch (err) {
    console.error("Currency conversion error:", err.message);
    return { success: false, error: err.message };
  }
}

// ── Unit conversion (basic common conversions, no API needed) ──
const UNIT_CONVERSIONS = {
  // length
  "km_mi": (v) => v * 0.621371,
  "mi_km": (v) => v / 0.621371,
  "m_ft": (v) => v * 3.28084,
  "ft_m": (v) => v / 3.28084,
  "cm_in": (v) => v * 0.393701,
  "in_cm": (v) => v / 0.393701,
  // weight
  "kg_lb": (v) => v * 2.20462,
  "lb_kg": (v) => v / 2.20462,
  "g_oz": (v) => v * 0.035274,
  "oz_g": (v) => v / 0.035274,
  // temperature
  "c_f": (v) => (v * 9) / 5 + 32,
  "f_c": (v) => ((v - 32) * 5) / 9,
};

function convertUnit(value, fromUnit, toUnit) {
  const key = `${fromUnit.toLowerCase()}_${toUnit.toLowerCase()}`;
  const fn = UNIT_CONVERSIONS[key];
  if (!fn) return { success: false, error: `Conversion ${fromUnit} → ${toUnit} not supported.` };
  return { success: true, result: fn(value).toFixed(2) };
}

// ── Weather (free, no key — uses open-meteo) ──
async function getWeather(cityName) {
  try {
    // First geocode the city name to coordinates
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`;
    const geoRes = await axios.get(geoUrl, { timeout: 10000 });
    const place = geoRes.data?.results?.[0];
    if (!place) return { success: false, error: `Couldn't find location: ${cityName}` };

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
    const weatherRes = await axios.get(weatherUrl, { timeout: 10000 });
    const current = weatherRes.data.current;

    return {
      success: true,
      location: `${place.name}, ${place.country}`,
      temp: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      weatherCode: current.weather_code,
    };
  } catch (err) {
    console.error("Weather error:", err.message);
    return { success: false, error: err.message };
  }
}

function weatherCodeToDescription(code) {
  const map = {
    0: "☀️ Clear sky", 1: "🌤️ Mostly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast",
    45: "🌫️ Foggy", 48: "🌫️ Foggy", 51: "🌦️ Light drizzle", 61: "🌧️ Light rain",
    63: "🌧️ Moderate rain", 65: "🌧️ Heavy rain", 71: "🌨️ Light snow", 80: "🌧️ Rain showers",
    95: "⛈️ Thunderstorm",
  };
  return map[code] || "🌡️ Unknown conditions";
}

module.exports = { translateText, convertCurrency, convertUnit, getWeather, weatherCodeToDescription };
