const { createCanvas } = require("canvas");
const fs = require("fs");

// Country-specific ID card templates
const COUNTRIES = {
  cameroon: {
    name: "Cameroon",
    flags: ["🇨🇲"],
    colors: { primary: "#007a3d", secondary: "#ce1126", accent: "#fcd116", bg: "#f5f5f0" },
    header: "REPUBLIQUE DU CAMEROUN",
    motto: "UN — UNITÉ — PATRIE",
    cardType: "CARTE D'IDENTITÉ NATIONALE",
    fields: [
      { key: "lastName", label: "Nom / Last Name", required: true },
      { key: "firstName", label: "Prénom / First Name", required: true },
      { key: "dob", label: "Date de Naissance", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sexe", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "N° Carte", required: true, placeholder: "123456789" },
      { key: "issueDate", label: "Délivré le", required: false, placeholder: "DD/MM/YYYY" },
      { key: "expiryDate", label: "Valable jusqu'au", required: false, placeholder: "DD/MM/YYYY" },
      { key: "address", label: "Adresse", required: false },
      { key: "nationality", label: "Nationalité", default: "CAMEROUNAIS(E)" }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  nigeria: {
    name: "Nigeria",
    flags: ["🇳🇬"],
    colors: { primary: "#008751", secondary: "#ffffff", accent: "#008751", bg: "#f8f8f8" },
    header: "FEDERAL REPUBLIC OF NIGERIA",
    motto: "UNITY AND FAITH, PEACE AND PROGRESS",
    cardType: "NATIONAL IDENTITY CARD",
    fields: [
      { key: "lastName", label: "Last Name", required: true },
      { key: "firstName", label: "First Name", required: true },
      { key: "middleName", label: "Middle Name", required: false },
      { key: "dob", label: "Date of Birth", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Gender", required: true, options: ["Male", "Female"] },
      { key: "idNumber", label: "NIN", required: true, placeholder: "12345678901" },
      { key: "issueDate", label: "Date of Issue", required: false, placeholder: "DD/MM/YYYY" },
      { key: "expiryDate", label: "Date of Expiry", required: false, placeholder: "DD/MM/YYYY" },
      { key: "address", label: "Address", required: false },
      { key: "state", label: "State of Origin", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  ghana: {
    name: "Ghana",
    flags: ["🇬🇭"],
    colors: { primary: "#ce1126", secondary: "#000000", accent: "#fcd116", bg: "#fafafa" },
    header: "THE REPUBLIC OF GHANA",
    motto: "FREEDOM AND JUSTICE",
    cardType: "GHANA CARD",
    fields: [
      { key: "lastName", label: "Surname", required: true },
      { key: "firstName", label: "Other Names", required: true },
      { key: "dob", label: "Date of Birth", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sex", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "GhIPSS No.", required: true, placeholder: "X0012345678" },
      { key: "issueDate", label: "Date of Issue", required: false, placeholder: "DD/MM/YYYY" },
      { key: "expiryDate", label: "Date of Expiry", required: false, placeholder: "DD/MM/YYYY" },
      { key: "address", label: "Residential Address", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  senegal: {
    name: "Senegal",
    flags: ["🇸🇳"],
    colors: { primary: "#00853f", secondary: "#f42a4e", accent: "#fff500", bg: "#f5f5f5" },
    header: "REPUBLIQUE DU SENEGAL",
    motto: "UN PEUPLE — UN BUT — UNE FOI",
    cardType: "CARTE D'IDENTITE NATIONALE",
    fields: [
      { key: "lastName", label: "Nom", required: true },
      { key: "firstName", label: "Prénoms", required: true },
      { key: "dob", label: "Date de Naissance", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sexe", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "N° Carte", required: true, placeholder: "123456789" },
      { key: "nationality", label: "Nationalité", default: "Sénégalaise" },
      { key: "address", label: "Adresse", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  IvoryCoast: {
    name: "Côte d'Ivoire",
    flags: ["🇨🇮"],
    colors: { primary: "#f77f00", secondary: "#009e60", accent: "#ffffff", bg: "#fafafa" },
    header: "REPUBLIQUE DE COTE D'IVOIRE",
    motto: "UNITE — DISCIPLINE — TRAVAIL",
    cardType: "CARTE D'IDENTITE NATIONALE",
    fields: [
      { key: "lastName", label: "Nom", required: true },
      { key: "firstName", label: "Prénoms", required: true },
      { key: "dob", label: "Date de Naissance", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sexe", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "N° Carte", required: true, placeholder: "123456789" },
      { key: "nationality", label: "Nationalité", default: "Ivoirienne" },
      { key: "address", label: "Adresse", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  togo: {
    name: "Togo",
    flags: ["🇹🇬"],
    colors: { primary: "#006a4e", secondary: "#ff0000", accent: "#fcd116", bg: "#f5f5f5" },
    header: "REPUBLIQUE TOGOLAISE",
    motto: "PAIX — TRAVAIL — PATRIE",
    cardType: "CARTE D'IDENTITE NATIONALE",
    fields: [
      { key: "lastName", label: "Nom", required: true },
      { key: "firstName", label: "Prénoms", required: true },
      { key: "dob", label: "Date de Naissance", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sexe", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "N° Carte", required: true, placeholder: "123456789" },
      { key: "nationality", label: "Nationalité", default: "Togolaise" },
      { key: "address", label: "Adresse", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  benin: {
    name: "Benin",
    flags: ["🇧🇯"],
    colors: { primary: "#008751", secondary: "#e8112d", accent: "#fcd116", bg: "#f5f5f5" },
    header: "REPUBLIQUE DU BENIN",
    motto: "FRATERNITE — JUSTICE — TRAVAIL",
    cardType: "CARTE D'IDENTITE NATIONALE",
    fields: [
      { key: "lastName", label: "Nom", required: true },
      { key: "firstName", label: "Prénoms", required: true },
      { key: "dob", label: "Date de Naissance", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sexe", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "N° Carte", required: true, placeholder: "123456789" },
      { key: "nationality", label: "Nationalité", default: "Béninoise" },
      { key: "address", label: "Adresse", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  burkina: {
    name: "Burkina Faso",
    flags: ["🇧🇫"],
    colors: { primary: "#009e49", secondary: "#ef2b29", accent: "#fcd116", bg: "#f5f5f5" },
    header: "PAYS DE L'HOMME INTEGR E",
    motto: "UNION — JUSTICE — TRAVAIL",
    cardType: "CARTE D'IDENTITE NATIONALE",
    fields: [
      { key: "lastName", label: "Nom", required: true },
      { key: "firstName", label: "Prénoms", required: true },
      { key: "dob", label: "Date de Naissance", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sexe", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "N° Carte", required: true, placeholder: "123456789" },
      { key: "nationality", label: "Nationalité", default: "Burkinabè" },
      { key: "address", label: "Adresse", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  mali: {
    name: "Mali",
    flags: ["🇲🇱"],
    colors: { primary: "#14b53a", secondary: "#ce1126", accent: "#fcd116", bg: "#fafafa" },
    header: "REPUBLIQUE DU MALI",
    motto: "UN PEUPLE — UN BUT — UNE FOI",
    cardType: "CARTE D'IDENTITE NATIONALE",
    fields: [
      { key: "lastName", label: "Nom", required: true },
      { key: "firstName", label: "Prénoms", required: true },
      { key: "dob", label: "Date de Naissance", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sexe", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "N° Carte", required: true, placeholder: "123456789" },
      { key: "nationality", label: "Nationalité", default: "Malienne" },
      { key: "address", label: "Adresse", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  },
  guinea: {
    name: "Guinea",
    flags: ["🇬🇳"],
    colors: { primary: "#ce1126", secondary: "#fcd116", accent: "#009e60", bg: "#fafafa" },
    header: "REPUBLIQUE DE GUINEE",
    motto: "TRAVAIL — JUSTICE — SOLIDARITE",
    cardType: "CARTE D'IDENTITE NATIONALE",
    fields: [
      { key: "lastName", label: "Nom", required: true },
      { key: "firstName", label: "Prénoms", required: true },
      { key: "dob", label: "Date de Naissance", required: true, placeholder: "DD/MM/YYYY" },
      { key: "sex", label: "Sexe", required: true, options: ["M", "F"] },
      { key: "idNumber", label: "N° Carte", required: true, placeholder: "123456789" },
      { key: "nationality", label: "Nationalité", default: "Guinéenne" },
      { key: "address", label: "Adresse", required: false }
    ],
    layout: {
      photoX: 50, photoY: 120, photoW: 180, photoH: 220,
      textX: 260, textY: 140
    }
  }
};

const WIDTH = 856;
const HEIGHT = 540;

function detectCountry(query) {
  const lower = (query || "").toLowerCase();
  
  for (const [key, country] of Object.entries(COUNTRIES)) {
    if (lower.includes(key.replace(/([A-Z])/g, ' $1').toLowerCase()) ||
        lower.includes(country.name.toLowerCase()) ||
        lower.includes("cameroon") || lower.includes("nigeria") ||
        lower.includes("ghana") || lower.includes("senegal") ||
        lower.includes("ivory") || lower.includes("cote") ||
        lower.includes("togo") || lower.includes("benin") ||
        lower.includes("burkina") || lower.includes("mali") ||
        lower.includes("guinea")) {
      return key;
    }
  }
  return null;
}

function extractDetails(text, countryKey) {
  const country = COUNTRIES[countryKey] || COUNTRIES.cameroon;
  const details = {};
  
  for (const field of country.fields) {
    details[field.key] = "";
  }
  
  const lines = String(text || "").split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
  
  for (const line of lines) {
    const lower = line.toLowerCase();
    
    for (const field of country.fields) {
      const labelLower = field.label.toLowerCase();
      if (lower.includes(field.key) || lower.includes(labelLower.split("/")[0].trim())) {
        const value = line.replace(new RegExp(`.*[:\\s]*`, "i"), "").trim();
        if (value && value !== field.key) {
          details[field.key] = value;
        }
      }
    }
  }
  
  // Set default nationality
  if (country.fields.find(f => f.key === "nationality")) {
    details.nationality = country.fields.find(f => f.key === "nationality")?.default || "";
  }
  
  return details;
}

function getMissingFields(details, countryKey) {
  const country = COUNTRIES[countryKey] || COUNTRIES.cameroon;
  const missing = [];
  
  for (const field of country.fields) {
    if (field.required && !details[field.key]) {
      missing.push(field.label);
    }
  }
  
  return missing;
}

function generateIdCard(imageBuffer, details, countryKey = "cameroon") {
  const country = COUNTRIES[countryKey] || COUNTRIES.cameroon;
  const { colors, header, motto, cardType } = country;
  const { photoX, photoY, photoW, photoH, textX, textY } = country.layout;
  
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  
  // Background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  
  // Decorative border
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, WIDTH - 12, HEIGHT - 12);
  
  ctx.strokeStyle = colors.secondary;
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, WIDTH - 28, HEIGHT - 28);
  
  // Top header bar
  ctx.fillStyle = colors.primary;
  ctx.fillRect(0, 0, WIDTH, 90);
  
  // Header text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px Arial";
  ctx.textAlign = "center";
  ctx.fillText(header, WIDTH / 2, 35);
  
  if (motto) {
    ctx.font = "14px Arial";
    ctx.fillText(motto, WIDTH / 2, 65);
  }
  
  // Card type
  ctx.font = "bold 20px Arial";
  ctx.fillStyle = colors.secondary;
  ctx.fillText(cardType, WIDTH / 2, 115);
  
  // Photo area
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(photoX, photoY, photoW, photoH);
  ctx.strokeStyle = colors.primary;
  ctx.lineWidth = 3;
  ctx.strokeRect(photoX, photoY, photoW, photoH);
  
  // Draw placeholder photo
  ctx.fillStyle = "#aaa";
  ctx.beginPath();
  ctx.arc(photoX + photoW/2, photoY + photoH/2 - 25, 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(photoX + photoW/2 - 30, photoY + photoH/2 + 10, 60, 45);
  
  // Details section
  let yPos = textY;
  ctx.textAlign = "left";
  
  for (const field of country.fields) {
    if (field.key === "nationality" && !details[field.key]) continue;
    
    const value = details[field.key] || "_".repeat(10);
    
    // Label
    ctx.font = "13px Arial";
    ctx.fillStyle = "#666";
    ctx.fillText(field.label, textX, yPos);
    
    // Value
    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "#000";
    ctx.fillText(String(value).slice(0, 30), textX, yPos + 28);
    
    yPos += 55;
  }
  
  // Bottom accent stripe
  ctx.fillStyle = colors.secondary;
  ctx.fillRect(0, HEIGHT - 35, WIDTH, 18);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, HEIGHT - 17, WIDTH, 17);
  
  // Country flag in corner
  ctx.font = "40px Arial";
  ctx.textAlign = "right";
  ctx.fillText(country.flags[0] || "", WIDTH - 30, HEIGHT - 50);
  
  // Watermark
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.font = "bold 80px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = colors.primary;
  ctx.translate(WIDTH/2, HEIGHT/2);
  ctx.rotate(-Math.PI / 6);
  ctx.fillText(cardType, 0, 0);
  ctx.restore();
  
  return canvas.toBuffer("image/jpeg", { quality: 0.9 });
}

module.exports = {
  generateIdCard,
  extractDetails,
  getMissingFields,
  detectCountry,
  COUNTRIES,
  WIDTH,
  HEIGHT
};
