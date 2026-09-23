const { generateCodingText } = require("./codingProvider");

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseJsonObject(value) {
  const text = String(value || "").replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Requirements provider returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

function inferProduct(request) {
  const text = clean(request, 1600);
  const lower = text.toLowerCase();
  let type = "web application";
  if (/portfolio|resume|personal brand/.test(lower)) type = "portfolio website";
  else if (/barber|salon|restaurant|cafe|shop|store|clinic|agency|business/.test(lower)) type = "business website";
  else if (/dashboard|admin|analytics|operations/.test(lower)) type = "dashboard";
  else if (/blog|article|magazine|news/.test(lower)) type = "content website";
  else if (/landing|marketing|startup|product page/.test(lower)) type = "marketing website";
  else if (/todo|task manager|kanban|tracker/.test(lower)) type = "productivity web app";
  const audience = /for ([^,.!?]+?)(?: with| that| including|$)/i.exec(text)?.[1] || "the people who will use the product";
  const featureWords = [
    ["booking", "booking flow"], ["appointment", "appointment flow"], ["contact", "contact action"],
    ["whatsapp", "WhatsApp contact action"], ["price|pricing|services", "services or pricing section"],
    ["login|auth", "authentication flow"], ["search", "search interaction"], ["filter", "filter interaction"],
    ["cart|checkout|shop|store", "shopping flow"], ["dashboard|analytics", "summary metrics and activity"],
    ["map|location|address", "location information"], ["testimonial|review", "social proof"],
  ];
  const features = featureWords.filter(([pattern]) => new RegExp(pattern, "i").test(lower)).map(([, label]) => label);
  if (!features.length) features.push(type === "portfolio website" ? "project showcase and contact action" : "clear primary call to action and useful content sections");
  const stack = /react|vite|next\.js|nextjs/.test(lower) ? "the requested JavaScript framework" : "accessible HTML, CSS, and JavaScript with no unnecessary dependencies";
  const selfRequested = /\b(?:aria|yourself|your own|the companion|the bot|the assistant)\b/i.test(text);
  return {
    originalRequest: text,
    productType: type,
    selfRequested,
    subjectContext: selfRequested
      ? "The product is about ARIA, the WhatsApp AI companion: a persistent Node.js service with conversational AI, shared memory, media processing, vision, coding/build workflows, GitHub integration, and authenticated WhatsApp actions. Describe only capabilities actually available in the connected runtime; never invent links, credentials, or successful actions."
      : "Use the user's stated domain and do not substitute a generic dashboard or starter app.",
    audience: clean(audience, 180),
    features: [...new Set(features)].slice(0, 8),
    stack,
    defaults: ["professional visual hierarchy", "responsive mobile layout", "keyboard-accessible interactions", "visible loading and empty states", "realistic domain-specific copy"],
    acceptanceCriteria: ["every requested feature has a visible or callable path", "all referenced files and DOM targets exist", "no placeholder or fake controls", "the project runs using its documented command"],
  };
}

async function analyzeRequirements(request) {
  const inferred = inferProduct(request);
  try {
    const response = await generateCodingText(`Analyze this software request before implementation. Do not write code. Return JSON only with this shape: {"productType":"...","audience":"...","features":["..."],"pagesOrSections":["..."],"interactions":["..."],"stack":"...","acceptanceCriteria":["..."]}. Preserve the user's intent, infer sensible professional defaults, and do not ask questions. Request: ${inferred.originalRequest}`, {
      system: "You are ARIA's product requirements analyst. Extract an actionable, specific product contract from the user's request. Never invent credentials or external integrations. Return valid JSON only.",
      maxTokens: 3000,
      temperature: 0.1,
    });
    const parsed = parseJsonObject(response);
    return {
      ...inferred,
      ...parsed,
      features: Array.isArray(parsed.features) && parsed.features.length ? parsed.features.map((x) => clean(x, 180)).slice(0, 10) : inferred.features,
      pagesOrSections: Array.isArray(parsed.pagesOrSections) ? parsed.pagesOrSections.map((x) => clean(x, 180)).slice(0, 12) : [],
      interactions: Array.isArray(parsed.interactions) ? parsed.interactions.map((x) => clean(x, 180)).slice(0, 12) : [],
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria) && parsed.acceptanceCriteria.length ? parsed.acceptanceCriteria.map((x) => clean(x, 220)).slice(0, 10) : inferred.acceptanceCriteria,
      analyzedBy: "coding-provider",
    };
  } catch (error) {
    return { ...inferred, analyzedBy: "deterministic-safe-defaults", analysisWarning: clean(error.message, 240) };
  }
}

function contractPrompt(contract) {
  return [
    `Product type: ${contract.productType}`,
    `Audience: ${contract.audience}`,
    `Original request: ${contract.originalRequest}`,
    `Subject context: ${contract.subjectContext || "Use the user's stated domain; do not substitute a generic product."}`,
    `Features: ${(contract.features || []).join("; ")}`,
    `Pages/sections: ${(contract.pagesOrSections || []).join("; ") || "infer a coherent single-page information architecture"}`,
    `Interactions: ${(contract.interactions || []).join("; ") || "wire the primary actions and navigation"}`,
    `Stack: ${contract.stack}`,
    `Defaults: ${(contract.defaults || []).join("; ")}`,
    `Acceptance criteria: ${(contract.acceptanceCriteria || []).join("; ")}`,
  ].join("\n");
}

module.exports = { inferProduct, analyzeRequirements, contractPrompt, _test: { clean } };
