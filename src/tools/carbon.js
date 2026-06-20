const sharp = require("sharp");

// Renders a code snippet as a styled image (carbon.now.sh style) using SVG + sharp.
// No external API needed — builds the image locally so it's fast and has no rate limits.

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function renderCodeImage(code, language = "javascript") {
  const lines = code.split("\n");
  const lineHeight = 24;
  const padding = 40;
  const fontSize = 15;
  const maxLineLength = Math.max(...lines.map((l) => l.length), 20);
  const width = Math.min(Math.max(maxLineLength * 9 + padding * 2, 400), 1200);
  const height = lines.length * lineHeight + padding * 2 + 40;

  const lineElements = lines
    .map((line, i) => {
      const y = padding + 40 + i * lineHeight;
      return `<text x="${padding}" y="${y}" font-family="Consolas, Monaco, monospace" font-size="${fontSize}" fill="#e6e6e6" xml:space="preserve">${escapeXml(line) || " "}</text>`;
    })
    .join("\n");

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="12" fill="#1e1e2e"/>
      <circle cx="${padding}" cy="${padding - 8}" r="6" fill="#ff5f56"/>
      <circle cx="${padding + 20}" cy="${padding - 8}" r="6" fill="#ffbd2e"/>
      <circle cx="${padding + 40}" cy="${padding - 8}" r="6" fill="#27c93f"/>
      <text x="${width / 2}" y="${padding - 4}" font-family="sans-serif" font-size="12" fill="#888" text-anchor="middle">${language}</text>
      ${lineElements}
    </svg>
  `;

  try {
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return { success: true, buffer };
  } catch (err) {
    console.error("Carbon render error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { renderCodeImage };
