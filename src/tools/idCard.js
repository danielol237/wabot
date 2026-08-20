const { createCanvas, registerFont } = require("canvas");
const fs = require("fs");
const path = require("path");

// Cameroon ID card dimensions (standard CRId format)
const WIDTH = 856;
const HEIGHT = 540;

// Pre-built Cameroon ID card template with official colors
const CAMEROON_ID = {
  primaryColor: "#007a3d",      // Cameroon green
  secondaryColor: "#ce1126",    // Cameroon red
  accentColor: "#fcd116",       // Cameroon yellow
  bgColor: "#f5f5f0",
  headerText: "REPUBLIQUE DU CAMEROUN",
  subheader: "UN — UNITÉ — PATRIE",
  cardType: "CARTE D'IDENTITÉ NATIONALE",
};

function extractDetails(text) {
  const details = {
    firstName: "",
    lastName: "",
    dob: "",
    nationality: "CAMEROUNAIS(E)",
    idNumber: "",
    issueDate: "",
    expiryDate: "",
    address: "",
    sex: ""
  };
  
  const lines = String(text || "").split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
  
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("nom") || lower.startsWith("last") || lower.startsWith("surname")) {
      details.lastName = line.replace(/^(nom|last name|surname)[:\s]*/i, "").trim();
    } else if (lower.includes("prénom") || lower.includes("firstname") || lower.includes("first name")) {
      details.firstName = line.replace(/^(prénom|firstname|first name)[:\s]*/i, "").trim();
    } else if (lower.includes("date de naissance") || lower.includes("dob") || lower.includes("date of birth")) {
      details.dob = line.replace(/^(date de naissance|dob|date of birth)[:\s]*/i, "").trim();
    } else if (lower.includes("no") || lower.includes("numéro") || lower.includes("id number")) {
      details.idNumber = line.replace(/^(no|numéro|id number)[:\s]*/i, "").trim();
    } else if (lower.includes("sexe") || lower.includes("gender") || lower.includes("sex")) {
      details.sex = line.replace(/^(sexe|gender|sex)[:\s]*/i, "").trim();
    } else if (lower.includes("adresse")) {
      details.address = line.replace(/^(adresse|address)[:\s]*/i, "").trim();
    } else if (lower.includes("nationalité") || lower.includes("nationality")) {
      details.nationality = line.replace(/^(nationalité|nationality)[:\s]*/i, "").trim().toUpperCase();
    }
  }
  
  return details;
}

function generateIdCard(imageBuffer, details, country = "cameroon") {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  
  const template = country === "cameroon" ? CAMEROON_ID : {
    primaryColor: "#0033a0",
    secondaryColor: "#ff0000",
    accentColor: "#ffd700",
    bgColor: "#f0f0f0",
    headerText: "NATIONAL IDENTITY CARD",
    subheader: "",
    cardType: "IDENTITY CARD",
  };
  
  // Background
  ctx.fillStyle = template.bgColor;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  
  // Border
  ctx.strokeStyle = template.primaryColor;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, WIDTH - 8, HEIGHT - 8);
  
  // Top header bar
  ctx.fillStyle = template.primaryColor;
  ctx.fillRect(0, 0, WIDTH, 80);
  
  // Header text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.fillText(template.headerText, WIDTH / 2, 35);
  
  if (template.subheader) {
    ctx.font = "14px Arial";
    ctx.fillText(template.subheader, WIDTH / 2, 60);
  }
  
  // Card type
  ctx.font = "bold 18px Arial";
  ctx.fillStyle = template.secondaryColor;
  ctx.fillText(template.cardType, WIDTH / 2, 110);
  
  // Photo area (left side)
  const photoX = 40;
  const photoY = 130;
  const photoW = 200;
  const photoH = 240;
  
  ctx.fillStyle = "#e0e0e0";
  ctx.fillRect(photoX, photoY, photoW, photoH);
  ctx.strokeStyle = template.primaryColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(photoX, photoY, photoW, photoH);
  
  // Draw user photo if provided
  if (imageBuffer) {
    try {
      const Jimp = require('jimp');
      const image = Jimp.read(imageBuffer).then(img => {
        img.resize(photoW - 10, photoH - 10);
        img.getBase64Async('image/jpeg').then(data => {
          const fs = require('fs');
          const tempPath = '/tmp/id_card_photo.jpg';
          const buf = Buffer.from(data.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
          fs.writeFileSync(tempPath, buf);
        });
      });
    } catch (e) {
      // Fallback: draw placeholder
      ctx.fillStyle = "#999";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.fillText("PHOTO", photoX + photoW/2, photoY + photoH/2);
    }
  }
  
  // Photo placeholder
  ctx.fillStyle = "#888";
  ctx.beginPath();
  ctx.arc(photoX + photoW/2, photoY + photoH/2 - 20, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(photoX + photoW/2 - 35, photoY + photoH/2 + 20, 70, 50);
  
  // Details section (right side)
  const detailX = 270;
  let detailY = 140;
  ctx.textAlign = "left";
  
  ctx.font = "bold 16px Arial";
  ctx.fillStyle = template.primaryColor;
  
  const fields = [
    { label: "Nom / Last Name", value: details.lastName || "_________" },
    { label: "Prénom / First Name", value: details.firstName || "_________" },
    { label: "Date de Naissance", value: details.dob || "_________" },
    { label: "Sexe", value: details.sex || "___" },
    { label: "Nationalité", value: details.nationality },
    { label: "N° Carte", value: details.idNumber || "_________" },
    { label: "Délivré le", value: details.issueDate || "_________" },
    { label: "Valable jusqu'au", value: details.expiryDate || "_________" },
  ];
  
  for (const field of fields) {
    ctx.font = "13px Arial";
    ctx.fillStyle = "#666";
    ctx.fillText(field.label, detailX, detailY);
    
    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "#000";
    ctx.fillText(field.value, detailX, detailY + 25);
    
    detailY += 55;
  }
  
  // Bottom accent stripe
  ctx.fillStyle = template.secondaryColor;
  ctx.fillRect(0, HEIGHT - 30, WIDTH, 15);
  ctx.fillStyle = template.accentColor;
  ctx.fillRect(0, HEIGHT - 15, WIDTH, 15);
  
  // Generate buffer
  const buffer = canvas.toBuffer("image/jpeg", { quality: 0.9 });
  return buffer;
}

function getMissingFields(details) {
  const missing = [];
  if (!details.firstName) missing.push("first name");
  if (!details.lastName) missing.push("last name");
  if (!details.dob) missing.push("date of birth");
  if (!details.idNumber) missing.push("ID number");
  return missing;
}

module.exports = { generateIdCard, extractDetails, getMissingFields, WIDTH, HEIGHT };
