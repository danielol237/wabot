const { inspectYtDlp } = require("../../utils/mediaRuntime");

function configured(...names) {
  return names.every((name) => Boolean(String(process.env[name] || "").trim()));
}

function item(id, label, ready, mode, nextStep) {
  return { id, label, ready: Boolean(ready), mode, nextStep };
}

function listIntegrations({ whatsappReady = false } = {}) {
  const media = inspectYtDlp();
  const google = configured("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
  const atlas = configured("GITHUB_WEBHOOK_SECRET", "RENDER_WEBHOOK_SECRET");
  return [
    item("whatsapp", "WhatsApp bot", whatsappReady, whatsappReady ? "connected" : "waiting", whatsappReady ? "No action required." : "Complete the WhatsApp pairing flow and keep the session store persistent."),
    item("anime-media", "Anime media runtime", media.available, media.available ? "ready" : "degraded", media.available ? `${media.command || "yt-dlp"}${media.version ? ` · ${media.version}` : ""}` : "Run the Render media build and verify yt-dlp/ffmpeg readiness."),
    item("learner-google", "Learner Google sign-in", google, google ? "configured" : "needs-config", google ? "Add the exact callback URI in Google Cloud Console and keep BASE_URL aligned." : "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL, and the exact callback URI."),
    item("atlas-delivery", "Atlas delivery webhooks", atlas, atlas ? "configured" : "needs-config", atlas ? "Run a verified GitHub/Render delivery test." : "Configure both GitHub and Render webhook secrets, then map repository/service IDs."),
    item("android-companion", "Android Companion", configured("COMPANION_API_KEY"), configured("COMPANION_API_KEY") ? "configured" : "disabled", configured("COMPANION_API_KEY") ? "Add aria.glb to the Android assets and point the client at the live endpoint." : "Set COMPANION_API_KEY before allowing public companion requests."),
    item("pinterest", "Pinterest image batches", configured("PINTEREST_ACCESS_TOKEN"), configured("PINTEREST_ACCESS_TOKEN") ? "official" : "fallback", configured("PINTEREST_ACCESS_TOKEN") ? "Official Pinterest search is enabled." : "Add PINTEREST_ACCESS_TOKEN for official results; public fallback remains available."),
    item("zai-media", "Z.AI media generation", configured("ZHIPU_API_KEY"), configured("ZHIPU_API_KEY") ? "configured" : "fallback", configured("ZHIPU_API_KEY") ? "Image, video, and vision routes may use Z.AI." : "Set ZHIPU_API_KEY and ZHIPU_BASE_URL for Z.AI media routes."),
    item("vercel", "Vercel project delivery", configured("VERCEL_TOKEN"), configured("VERCEL_TOKEN") ? "configured" : "disabled", configured("VERCEL_TOKEN") ? "Deployment requests remain owner-controlled." : "Set VERCEL_TOKEN before enabling project deployment."),
    item("cameroon-payments", "Cameroon payment callbacks", configured("MTN_WEBHOOK_SECRET") || configured("ORANGE_WEBHOOK_SECRET"), configured("MTN_WEBHOOK_SECRET") || configured("ORANGE_WEBHOOK_SECRET") ? "partial" : "sandbox", "Provider-specific merchant onboarding and callback verification are still required before live activation."),
  ];
}

module.exports = { listIntegrations };
