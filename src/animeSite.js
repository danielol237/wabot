// ARIA Anime — public catalog, watch, and authorized download routes.
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const router = express.Router();
const service = require("./tools/animeService");
const { resolveEpisode } = require("./tools/sourceResolver");
const { enqueueAnimeJob, retryJob, getJob, getOwnerStats, findActiveJob, snapshot: animeSnapshot } = require("./tools/animeJobManager");
const { issueMediaToken, verifyMediaToken, issueFileToken, verifyFileToken, validateMediaTarget } = require("./utils/mediaAccess");
const { error: logError } = require("./utils/logger");

function safePageError(res, scope, err) {
  logError(`[${scope}]`, err?.stack || err?.message || err);
  return res.status(500).send("This page is temporarily unavailable. Please try again.");
}

router.use(express.urlencoded({ extended: true }));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PROVIDER_LABEL = { jikan: "MAL", anilist: "AniList", consumet: "Consumet", animepahe: "AnimePahe", gogoanime: "Gogoanime", omnisave: "OmniSave" };
const QUALITY_OPTIONS = ["best", "360", "480", "720", "1080"];
function normalizeQuality(value) { const q = String(value || "best").toLowerCase(); return QUALITY_OPTIONS.includes(q) ? q : "best"; }
function qualityLabel(q) { return q === "best" ? "Auto" : `${q}p`; }
function qualityLinks(basePath, query = {}, selected = "best") {
  return QUALITY_OPTIONS.map((q) => {
    const params = new URLSearchParams({ ...query, quality: q });
    return `<a class="quality-chip${q === selected ? " active" : ""}" href="${esc(`${basePath}?${params.toString()}`)}">${esc(qualityLabel(q))}</a>`;
  }).join("");
}
function providerDiagnostics(report) {
  return (report?.diagnostics || []).map((d) => `<div class="source-row"><span>${esc(providerLabel(d.provider))}</span><span class="source-state ${d.candidateCount ? "ok" : "bad"}">${d.candidateCount ? `${esc(d.candidateCount)} source${d.candidateCount === 1 ? "" : "s"}` : esc(d.error || "no source")}</span></div>`).join("");
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function detailsFast(entry) {
  return withTimeout(service.getDetails(entry), 10000, { id: entry.id, provider: entry.provider, title: entry.title || "Anime", blocked: true });
}

const publicDownloadAttempts = new Map();
const PUBLIC_DOWNLOAD_WINDOW_MS = 60 * 60 * 1000;
const PUBLIC_DOWNLOAD_LIMIT = Math.max(1, Number(process.env.ANIME_PUBLIC_DOWNLOADS_PER_HOUR || 10));
const PUBLIC_ACTIVE_LIMIT = Math.max(1, Number(process.env.ANIME_PUBLIC_ACTIVE_LIMIT || 3));
const PUBLIC_QUEUE_LIMIT = Math.max(10, Number(process.env.ANIME_PUBLIC_QUEUE_LIMIT || 100));

const PUBLIC_SESSION_COOKIE = "aria_anime_sid";
const PUBLIC_SESSION_MAX_AGE = 30 * 24 * 60 * 60;
function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  const found = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}
function publicOwnerId(req, res) {
  let sessionId = readCookie(req, PUBLIC_SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(sessionId)) {
    sessionId = crypto.randomBytes(32).toString("base64url");
    if (res && !res.headersSent) {
      const secure = req.secure || req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production" ? "; Secure" : "";
      res.append("Set-Cookie", `${PUBLIC_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Max-Age=${PUBLIC_SESSION_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax${secure}`);
    }
  }
  return `session:${sessionId}`;
}

function publicDownloadQuota(req, ownerId) {
  const now = Date.now();
  const key = ownerId || publicOwnerId(req, null);
  let record = publicDownloadAttempts.get(key);
  if (!record || record.resetAt <= now) record = { count: 0, resetAt: now + PUBLIC_DOWNLOAD_WINDOW_MS };
  const ownerStats = getOwnerStats(key);
  const global = animeSnapshot().counts;
  if (ownerStats.active >= PUBLIC_ACTIVE_LIMIT) return { ok: false, status: 429, message: "You already have the maximum number of active downloads. Wait for one to finish." };
  if ((global.queued || 0) + (global.running || 0) >= PUBLIC_QUEUE_LIMIT) return { ok: false, status: 503, message: "The download queue is full. Please try again later." };
  if (record.count >= PUBLIC_DOWNLOAD_LIMIT) return { ok: false, status: 429, message: "Download limit reached for this hour. Please try again later." };
  record.count++;
  publicDownloadAttempts.set(key, record);
  if (publicDownloadAttempts.size > 5000) {
    for (const [id, value] of publicDownloadAttempts) if (value.resetAt <= now) publicDownloadAttempts.delete(id);
  }
  return { ok: true, key };
}

function publicJobAllowed(job, ownerId) {
  return !!job && !!job.ownerId && job.ownerId === ownerId;
}

function providerLabel(provider) {
  return PROVIDER_LABEL[provider] || provider || "Catalog";
}
function officialWatchLinks(details) {
  const links = (details?.externalLinks || []).filter((link) => link?.url && /^https:\/\//i.test(link.url) && (String(link.type || "").toUpperCase() === "STREAMING" || /crunchyroll|hidive|netflix|disney|hulu|amazon|prime video|funimation|youtube/i.test(String(link.site || ""))));
  if (!links.length) return "";
  const seen = new Set();
  const unique = links.filter((link) => { const key = String(link.url); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 8);
  return `<section class="official-links"><div><span class="eyebrow">Where to watch</span><h3>Official streaming options</h3><p>Availability depends on your region and subscription. ARIA sends you to the service instead of exposing an unverified mirror.</p></div><div class="official-link-grid">${unique.map((link) => `<a class="official-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(link.site || "Official service")}</span><span aria-hidden="true">↗</span></a>`).join("")}</div></section>`;
}

function titleHref(item) {
  return `/anime/title/${encodeURIComponent(item.id)}?prov=${encodeURIComponent(item.provider || "anilist")}`;
}

function button(href, label, tone = "primary", extra = "") {
  return `<a class="btn btn-${tone}" href="${esc(href)}" ${extra}>${esc(label)}</a>`;
}

function layout(title, inner) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0d12"><meta name="description" content="ARIA Anime — a clean catalog for authorized viewing and downloads."><script>try{const saved=localStorage.getItem("aria-anime-theme");document.documentElement.dataset.theme=saved||((window.matchMedia&&window.matchMedia("(prefers-color-scheme:dark)").matches)?"dark":"light")}catch(_){document.documentElement.dataset.theme="light"}</script>
<title>${esc(title)} · ARIA Anime</title>
<style>
:root{--bg:#0b0d12;--surface:#131720;--surface-2:#181d28;--surface-3:#202735;--line:#2a3240;--text:#f4f6fa;--muted:#9ba6b8;--subtle:#697386;--accent:#ff5d6c;--accent-2:#ff8a5b;--ok:#42d6a2;--warn:#f5c451;--danger:#ff7b8a;--radius:16px;--shadow:0 18px 48px rgba(0,0,0,.25)}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}a{color:inherit}.top{position:sticky;top:0;z-index:20;background:rgba(11,13,18,.96);border-bottom:1px solid var(--line)}.top-in{width:min(1180px,100%);margin:auto;padding:12px 20px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:18px}.brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;white-space:nowrap}.brand-mark{display:block;width:34px;height:34px;object-fit:cover;overflow:hidden;border:1px solid #394354;border-radius:10px;background:#0b0d12;box-shadow:0 6px 18px rgba(255,107,107,.14)}.brand-name{font-size:15px;font-weight:800;letter-spacing:.02em}.brand-name b{color:var(--accent);font-weight:800}.nav{display:flex;gap:3px;align-items:center}.nav a,.account-link{padding:8px 10px;border-radius:9px;color:var(--muted);font-size:12px;font-weight:700;text-decoration:none}.nav a:hover,.account-link:hover{background:var(--surface);color:var(--text)}.search{display:flex;gap:8px;min-width:0}.search input{width:100%;min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:10px 12px;font:inherit;font-size:13px;outline:0}.search input:focus{border-color:var(--accent)}.search button{border:0;border-radius:9px;background:var(--accent);color:#1b0d11;padding:0 16px;font-weight:850;cursor:pointer}.account-link{border:1px solid var(--line);white-space:nowrap}.main{width:min(1180px,100%);margin:auto;padding:28px 20px 64px}.hero{position:relative;isolation:isolate;min-height:360px;overflow:hidden;border:1px solid var(--line);border-radius:22px;background:var(--surface);box-shadow:var(--shadow);padding:34px;display:flex;align-items:flex-end}.hero-art{position:absolute;inset:0 0 0 35%;z-index:-2;background:var(--surface-2)}.hero-art img{width:100%;height:100%;display:block;object-fit:cover;opacity:.62}.hero-art:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,var(--surface) 0%,rgba(19,23,32,.94) 28%,rgba(19,23,32,.3) 75%,rgba(19,23,32,.08))}.hero-copy{max-width:600px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--accent);font-size:10px;font-weight:850}.hero h1{margin:12px 0 0;font-size:clamp(30px,5vw,58px);line-height:1.02;letter-spacing:-.045em}.hero p{max-width:540px;color:var(--muted);font-size:14px;margin:12px 0 0;line-height:1.65}.hero-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:16px}.meta-pill,.badge{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;background:rgba(32,39,53,.82);color:var(--muted);padding:4px 9px;font-size:11px;font-weight:700}.meta-pill.score,.badge.score{color:var(--warn)}.hero-actions,.detail-actions,.download-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;border-radius:9px;border:1px solid transparent;padding:9px 14px;text-decoration:none;font-size:12px;font-weight:850;cursor:pointer}.btn-primary{background:var(--accent);color:#1e0e11}.btn-secondary{background:var(--surface-2);border-color:var(--line);color:var(--text)}.btn-secondary:hover{border-color:var(--accent)}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:34px 0 14px}.section-title{font-size:20px;line-height:1.1;font-weight:850;letter-spacing:-.02em}.section-title:before{content:"";display:inline-block;width:4px;height:18px;margin-right:9px;vertical-align:-2px;border-radius:9px;background:var(--accent)}.section-sub{color:var(--subtle);font-size:12px}.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px}.card{min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--surface);text-decoration:none;transition:border-color .15s,transform .15s}.card:hover{border-color:#6b7484;transform:translateY(-2px)}.cover{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;background:var(--surface-2)}.card-body{padding:11px}.card-title{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-height:34px;font-size:12px;font-weight:800;line-height:1.4}.card-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.badge.provider{background:#202735;color:#b5bfce}.empty{padding:32px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);text-align:center;font-size:13px}.detail{display:grid;grid-template-columns:220px minmax(0,1fr);gap:26px;padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}.poster{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:12px;background:var(--surface-2)}.detail h1{margin:0;font-size:clamp(25px,4vw,40px);line-height:1.05;letter-spacing:-.04em}.metaline{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;color:var(--muted);font-size:12px}.desc{max-width:760px;margin-top:15px;color:#c7ced9;font-size:14px;line-height:1.7}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.tag{border:1px solid var(--line);border-radius:999px;padding:4px 9px;color:var(--muted);font-size:11px}.episode-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.episode{min-width:0;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.episode-number{font-weight:850}.episode-name{overflow:hidden;margin-top:3px;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.episode-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px}.episode-actions .btn{min-height:34px;padding:7px 6px;font-size:11px}.manual{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}.manual input{width:120px;background:var(--surface-2);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:10px;font:inherit}.source-note{margin-top:14px;color:var(--subtle);font-size:11px;line-height:1.6}.player-shell{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:#000;box-shadow:var(--shadow)}.player-shell video{display:block;width:100%;max-height:72vh;background:#000}.watch-head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:14px}.watch-head h1{margin:0;font-size:clamp(20px,4vw,32px);letter-spacing:-.035em}.watch-head p{margin:4px 0 0;color:var(--muted);font-size:12px}.job{max-width:760px;padding:20px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.job-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:13px}.job-label{color:var(--muted)}.status{display:inline-flex;padding:4px 9px;border-radius:999px;background:#18352f;color:var(--ok);font-size:11px;font-weight:850}.status.failed{background:#3b2028;color:var(--danger)}.status.pending{background:#3b321c;color:var(--warn)}.progress-track{height:8px;margin-top:8px;overflow:hidden;border-radius:999px;background:var(--surface-2)}.progress-bar{height:100%;border-radius:inherit;background:var(--accent)}.filter-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}.filter-bar select{background:var(--surface);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:10px 12px;font:inherit;font-size:12px}.footer{padding:22px 20px;border-top:1px solid var(--line);color:var(--subtle);text-align:center;font-size:11px}
@media(max-width:1050px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}.episode-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.top-in{grid-template-columns:auto 1fr auto}.nav{display:none}}
@media(max-width:680px){.top-in{grid-template-columns:auto auto;gap:10px;padding:10px 14px}.brand-name{font-size:14px}.account-link{margin-left:auto}.search{grid-column:1/-1;grid-row:2}.search button{padding:0 13px}.main{padding:18px 14px 48px}.hero{min-height:440px;padding:22px;border-radius:16px;align-items:flex-end}.hero-art{inset:0 0 42% 0}.hero-art:after{background:linear-gradient(0deg,var(--surface) 7%,rgba(19,23,32,.7) 55%,rgba(19,23,32,.05))}.hero h1{font-size:36px}.hero p{font-size:13px}.hero-actions{display:grid;grid-template-columns:1fr 1fr}.hero-actions .btn{min-height:44px}.section-head{margin-top:28px}.section-title{font-size:18px}.section-sub{display:none}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card-body{padding:10px}.detail{grid-template-columns:96px minmax(0,1fr);gap:14px;padding:14px;border-radius:14px}.detail h1{font-size:22px}.detail .desc{grid-column:1/-1;font-size:13px;margin-top:0}.detail-actions{grid-column:1/-1;margin-top:0}.detail-actions .btn{flex:1}.episode-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.episode{padding:10px}.episode-actions{grid-template-columns:1fr}.watch-head{align-items:flex-start;flex-direction:column}.watch-head .btn{width:100%}.download-actions{display:grid;grid-template-columns:1fr}.download-actions .btn{width:100%}.footer{padding-bottom:30px}}
@media(max-width:360px){.brand-name{font-size:12px}.account-link{font-size:11px;padding:7px}.hero{min-height:420px;padding:18px}.hero-actions{display:grid;grid-template-columns:1fr}.detail{grid-template-columns:82px minmax(0,1fr)}}
/* ARIA V9 editorial system */
:root{--bg:#fbfafc;--surface:#fff;--surface-2:#f4f0f7;--surface-3:#ece6f0;--line:#e7e1eb;--text:#1a1720;--muted:#6d6678;--subtle:#938b9d;--accent:#8e6bd6;--accent-2:#ed7184;--ok:#3a9c8e;--warn:#b47a31;--danger:#c54f66;--radius:16px;--shadow:0 18px 52px rgba(55,36,76,.10)}
html{background:var(--bg)}body{background:radial-gradient(circle at 90% 0%,#f3eafa 0,transparent 35%),var(--bg);color:var(--text);font-family:"DM Sans",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.top{background:rgba(251,250,252,.92);backdrop-filter:blur(18px);border-bottom:1px solid rgba(231,225,235,.9)}.top-in{width:min(1240px,100%);padding:14px 24px;grid-template-columns:auto minmax(220px,1fr) auto;gap:28px}.brand{gap:11px}.brand-mark{width:38px;height:38px;border:0;border-radius:12px;background:#f2eafa;box-shadow:0 8px 24px rgba(142,107,214,.18)}.brand-name{font-size:14px;letter-spacing:.12em;color:var(--text);font-weight:900}.brand-name b{display:block;color:var(--accent);font-size:10px;letter-spacing:.22em;margin-top:1px}.nav{gap:4px}.nav a,.account-link{padding:9px 11px;border-radius:10px;color:var(--muted);font-size:12px}.nav a:hover,.account-link:hover{background:var(--surface-2);color:var(--text)}.search input{background:var(--surface);border-color:var(--line);border-radius:12px;padding:11px 13px;color:var(--text)}.search input:focus{border-color:var(--accent);box-shadow:0 0 0 4px rgba(142,107,214,.12)}.search button{border-radius:12px;background:var(--text);color:#fff;padding:0 18px}.main{width:min(1240px,100%);padding:38px 24px 76px}.hero{min-height:430px;border:1px solid var(--line);border-radius:24px;background:var(--surface);box-shadow:var(--shadow);padding:42px}.hero-art{inset:0 0 0 38%;background:var(--surface-2)}.hero-art:after{background:linear-gradient(90deg,#fff 0%,rgba(255,255,255,.94) 22%,rgba(255,255,255,.35) 70%,rgba(255,255,255,0) 100%)}.hero h1{font-family:Georgia,"Times New Roman",serif;font-weight:500;color:var(--text);font-size:clamp(34px,5vw,66px);letter-spacing:-.055em}.hero p{color:var(--muted);font-size:15px;max-width:520px}.eyebrow{color:var(--accent);letter-spacing:.18em}.meta-pill,.badge{background:rgba(255,255,255,.84);border-color:var(--line);color:var(--muted)}.meta-pill.score,.badge.score{color:var(--warn)}.btn{min-height:44px;border-radius:12px;padding:10px 16px;font-size:12px;letter-spacing:.01em}.btn-primary{background:var(--text);color:#fff}.btn-primary:hover{background:#332b3d}.btn-secondary{background:var(--surface);border-color:var(--line);color:var(--text)}.btn-secondary:hover{border-color:var(--accent);color:var(--accent)}.section-head{margin:42px 0 16px}.section-title{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:26px;color:var(--text)}.section-title:before{width:5px;height:20px;background:var(--accent-2)}.section-sub{color:var(--subtle)}.grid{grid-template-columns:repeat(6,minmax(0,1fr));gap:16px}.card{border-color:var(--line);border-radius:16px;background:var(--surface);box-shadow:0 7px 25px rgba(55,36,76,.05)}.card:hover{border-color:#cbb9e7;box-shadow:0 14px 32px rgba(142,107,214,.12);transform:translateY(-4px)}.cover{background:var(--surface-2)}.card-body{padding:13px}.card-title{font-size:13px;color:var(--text)}.badge.provider{background:var(--surface-2);color:var(--muted)}.empty{background:var(--surface);border-color:#d9cde3;color:var(--muted)}.detail{border-color:var(--line);border-radius:20px;background:var(--surface);box-shadow:var(--shadow);padding:28px}.detail h1,.watch-head h1,.job h1{font-family:Georgia,"Times New Roman",serif;font-weight:500;color:var(--text)}.metaline,.desc,.source-note,.watch-head p,.job-label{color:var(--muted)}.tag{border-color:var(--line);background:var(--surface-2);color:var(--muted)}.episode{border-color:var(--line);border-radius:14px;background:var(--surface)}.episode-actions .btn{min-height:38px}.player-shell{border-color:var(--line);border-radius:18px;box-shadow:var(--shadow)}.job{border-color:var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--shadow)}.status{background:#e3f4f1;color:var(--ok)}.status.failed{background:#fae6ea;color:var(--danger)}.status.pending{background:#fff2dc;color:var(--warn)}.progress-track{background:var(--surface-3)}.progress-bar{background:linear-gradient(90deg,var(--accent),var(--accent-2))}.filter-bar select{background:var(--surface);border-color:var(--line);color:var(--text);border-radius:12px}.footer{background:#f4f0f7;border-color:var(--line);color:var(--muted)}
@media(max-width:1050px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:680px){.top-in{grid-template-columns:auto auto;padding:11px 14px;gap:10px}.brand-mark{width:34px;height:34px}.search input{min-height:44px}.search button{min-height:44px;padding:0 15px}.main{padding:22px 14px 54px}.hero{min-height:500px;padding:24px;border-radius:18px}.hero-art{inset:0 0 45% 0}.hero-art:after{background:linear-gradient(0deg,#fff 8%,rgba(255,255,255,.80) 58%,rgba(255,255,255,.08) 100%)}.hero h1{font-size:40px}.hero-actions{gap:10px}.section-head{margin-top:34px}.section-title{font-size:23px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card-body{padding:11px}.detail{padding:18px}.episode-actions{gap:8px}.footer{padding:24px 14px}}
@media(max-width:360px){.hero h1{font-size:34px}.hero-actions{grid-template-columns:1fr}.brand-name{font-size:12px}}
/* ARIA Anime V10 streaming-product system */
:root{--bg:#f8f7fb;--surface:#fff;--surface-2:#f3eff8;--surface-3:#ebe5f1;--line:#e5deea;--text:#1b1721;--muted:#706779;--subtle:#978da1;--accent:#8e6bd6;--accent-2:#ed7184;--ok:#3a9c8e;--warn:#b47a31;--danger:#c54f66;--shadow:0 18px 50px rgba(55,36,76,.10)}html{background:var(--bg);scroll-behavior:smooth}body{background:radial-gradient(850px 480px at 90% 0,#f1eafb,transparent 64%),radial-gradient(700px 400px at -10% 90%,#e5f3f1,transparent 58%),var(--bg);color:var(--text)}.top{box-shadow:0 8px 28px rgba(55,36,76,.05)}.top-in{width:min(1280px,100%);padding:14px 28px;gap:30px}.brand-mark{box-shadow:0 8px 22px rgba(142,107,214,.16)}.nav a,.account-link{font-weight:750}.nav a:hover,.account-link:hover{background:var(--surface-2);color:var(--text)}.main{width:min(1280px,100%);padding:34px 28px 82px}.hero{min-height:470px;padding:48px;border-radius:28px;background:linear-gradient(135deg,#fff 0%,#f3ecfb 100%);border-color:#e1d6eb;box-shadow:0 24px 70px rgba(55,36,76,.12)}.hero-art{inset:0 0 0 38%;background:#eee7f5}.hero-art img{mix-blend-mode:multiply;opacity:.75}.hero-art:after{background:linear-gradient(90deg,#fff 0%,rgba(255,255,255,.96) 23%,rgba(255,255,255,.42) 74%,rgba(255,255,255,.04))}.hero-copy{position:relative;z-index:1}.hero h1{font-family:Georgia,"Times New Roman",serif;font-weight:500;color:var(--text)}.hero p{color:var(--muted)}.hero-meta{gap:8px}.meta-pill,.badge{background:rgba(255,255,255,.82);border-color:var(--line)}.hero-actions{margin-top:24px}.btn{border-radius:13px;min-height:46px}.btn-primary{background:var(--text);color:#fff}.btn-primary:hover{background:var(--accent)}.btn-secondary{background:rgba(255,255,255,.78);border-color:var(--line);color:var(--text)}.section-head{margin:48px 0 17px}.section-title{font-family:Georgia,"Times New Roman",serif;font-weight:500;font-size:29px}.section-title:before{background:var(--accent-2)}.section-sub{color:var(--subtle)}.grid{gap:18px}.card{border-color:var(--line);border-radius:17px;background:rgba(255,255,255,.92);box-shadow:0 8px 26px rgba(55,36,76,.045)}.card:hover{border-color:#cbb9e7;box-shadow:0 18px 38px rgba(142,107,214,.14)}.card-title{color:var(--text);font-size:13px}.cover{background:var(--surface-2)}.card-meta{gap:6px}.badge.provider{background:var(--surface-2);color:var(--muted)}.detail{border-color:var(--line);border-radius:24px;background:rgba(255,255,255,.92);box-shadow:var(--shadow);padding:32px}.detail h1,.watch-head h1,.job h1{font-family:Georgia,"Times New Roman",serif;font-weight:500}.desc,.metaline,.source-note,.watch-head p,.job-label{color:var(--muted)}.detail-actions{margin-top:22px}.episode-grid{gap:12px}.episode{background:rgba(255,255,255,.82);border-color:var(--line);border-radius:15px;transition:.16s}.episode:hover{border-color:#cbb9e7;box-shadow:0 10px 24px rgba(142,107,214,.09);transform:translateY(-2px)}.episode-number{color:var(--text)}.episode-name{color:var(--muted)}.episode-actions{gap:8px}.episode-actions .btn{min-height:38px;padding:8px 6px}.player-shell{border-color:#25212d;border-radius:20px;box-shadow:0 22px 62px rgba(55,36,76,.18)}.player-shell video{aspect-ratio:16/9;max-height:none}.watch-head{align-items:flex-end;margin-bottom:18px}.watch-head h1{font-size:clamp(28px,5vw,44px)}.job{border-color:var(--line);border-radius:20px;background:rgba(255,255,255,.92);box-shadow:var(--shadow)}.status{background:#e3f4f1;color:var(--ok)}.status.failed{background:#fae6ea;color:var(--danger)}.status.pending{background:#fff2dc;color:var(--warn)}.progress-track{background:var(--surface-3)}.progress-bar{background:linear-gradient(90deg,var(--accent),var(--accent-2))}.quality-strip{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px}.quality-label{color:var(--muted);font-size:12px;font-weight:800}.quality-chip{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:7px 11px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--muted);font-size:11px;font-weight:850;text-decoration:none}.quality-chip:hover,.quality-chip.active{background:var(--surface-2);border-color:#cbb9e7;color:var(--accent)}.source-card{margin-top:18px;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--surface-2)}.official-links{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,320px);gap:18px;align-items:center;margin-top:20px;padding:18px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(135deg,var(--surface),var(--surface-2))}.official-links h3{margin:5px 0 4px;font-size:16px}.official-links p{margin:0;color:var(--muted);font-size:12px;line-height:1.6}.official-link-grid{display:grid;gap:7px}.official-link{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--text);font-size:12px;font-weight:850;text-decoration:none}.official-link:hover{border-color:var(--accent);color:var(--accent)}.source-card h3{margin:0 0 10px;font-size:13px}.source-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line);font-size:12px}.source-state{max-width:68%;text-align:right;overflow-wrap:anywhere}.source-state.ok{color:var(--ok)}.source-state.bad{color:var(--danger)}.download-actions{margin-top:18px}.download-actions .btn{flex:1}.empty{border-color:#d9cde3;background:rgba(255,255,255,.68);border-radius:16px;color:var(--muted)}.footer{background:#f3eff8;border-color:var(--line);color:var(--muted)}@media(max-width:680px){.top-in{padding:11px 14px}.main{padding:22px 14px 60px}.hero{min-height:520px;padding:25px;border-radius:20px}.hero-art{inset:0 0 44% 0}.hero-art:after{background:linear-gradient(0deg,#fff 6%,rgba(255,255,255,.82) 56%,rgba(255,255,255,.06) 100%)}.hero h1{font-size:40px}.hero-actions{display:grid;grid-template-columns:1fr 1fr}.hero-actions .btn{width:100%}.detail{padding:19px;border-radius:19px}.watch-head{gap:12px}.watch-head .btn{width:100%}.source-state{max-width:58%}.quality-strip{gap:6px}.quality-chip{min-width:54px}.download-actions{display:grid;grid-template-columns:1fr}.download-actions .btn{width:100%}}
.quick-start{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;margin-top:22px;padding:22px 24px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(135deg,#fff,#f4eff8);box-shadow:0 10px 28px rgba(55,36,76,.05)}.quick-start h2{margin:5px 0 6px;font-family:Georgia,"Times New Roman",serif;font-size:26px;font-weight:500;letter-spacing:-.04em}.quick-start p{max-width:690px;margin:0;color:var(--muted);font-size:13px;line-height:1.7}.quick-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.quality-menu{position:relative;min-width:0}.quality-menu summary{display:flex;align-items:center;justify-content:center;min-height:38px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--text);font-size:11px;font-weight:850;cursor:pointer;list-style:none}.quality-menu summary::-webkit-details-marker{display:none}.quality-menu[open] summary,.quality-menu summary:hover{border-color:#cbb9e7;color:var(--accent)}.quality-menu-pop{position:absolute;z-index:10;right:0;top:calc(100% + 7px);display:grid;grid-template-columns:repeat(2,minmax(60px,1fr));gap:6px;min-width:150px;padding:8px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:0 16px 36px rgba(55,36,76,.16)}.quality-menu-pop .btn{min-height:34px;padding:7px 8px;font-size:11px}.episode-actions>.btn-primary{flex:1}.episode-actions>.quality-menu{flex:1}
@media(max-width:680px){.quick-start{grid-template-columns:1fr;padding:18px}.quick-actions{justify-content:flex-start}.quick-actions .btn{flex:1}.quality-menu-pop{right:auto;left:0}.official-links{grid-template-columns:1fr;padding:16px}.official-link-grid{grid-template-columns:1fr 1fr}}
.theme-toggle{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:38px;padding:8px 11px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--muted);font:inherit;font-size:11px;font-weight:850;cursor:pointer;white-space:nowrap}.theme-toggle:hover{border-color:var(--accent);color:var(--accent)}.theme-toggle .theme-icon{font-size:14px;line-height:1}
:root[data-theme="dark"]{--bg:#0c0e13;--surface:#141821;--surface-2:#1a202b;--surface-3:#232b38;--line:#2b3544;--text:#f6f7fb;--muted:#aeb7c7;--subtle:#7f8a9d;--accent:#c9a7ff;--accent-2:#ff8b9a;--ok:#55d5b4;--warn:#f4c96a;--danger:#ff8798;--shadow:0 20px 60px rgba(0,0,0,.32)}:root[data-theme="dark"] body{background:radial-gradient(850px 480px at 90% 0,#222036,transparent 64%),radial-gradient(700px 400px at -10% 90%,#102a2a,transparent 58%),var(--bg)}:root[data-theme="dark"] .top{background:rgba(12,14,19,.9);border-color:rgba(43,53,68,.9)}:root[data-theme="dark"] .brand-mark{background:#1b1625;box-shadow:0 8px 24px rgba(201,167,255,.16)}:root[data-theme="dark"] .search input,:root[data-theme="dark"] .account-link,:root[data-theme="dark"] .theme-toggle{background:var(--surface);color:var(--text);border-color:var(--line)}:root[data-theme="dark"] .search button{background:var(--accent);color:#1d1325}:root[data-theme="dark"] .hero{background:linear-gradient(135deg,#141821 0%,#1e1a2d 100%);border-color:var(--line)}:root[data-theme="dark"] .hero-art{background:#1a202b}:root[data-theme="dark"] .hero-art img{mix-blend-mode:screen;opacity:.58}:root[data-theme="dark"] .hero-art:after{background:linear-gradient(90deg,#141821 0%,rgba(20,24,33,.95) 23%,rgba(20,24,33,.38) 74%,rgba(20,24,33,.04))}:root[data-theme="dark"] .btn-primary{background:var(--accent);color:#1d1325}:root[data-theme="dark"] .btn-primary:hover{background:#dfc9ff}:root[data-theme="dark"] .btn-secondary{background:var(--surface-2);border-color:var(--line);color:var(--text)}:root[data-theme="dark"] .meta-pill,:root[data-theme="dark"] .badge{background:rgba(26,32,43,.86);border-color:var(--line);color:var(--muted)}:root[data-theme="dark"] .card,:root[data-theme="dark"] .detail,:root[data-theme="dark"] .episode,:root[data-theme="dark"] .job{background:var(--surface);border-color:var(--line)}:root[data-theme="dark"] .card:hover,:root[data-theme="dark"] .episode:hover{border-color:#77619b;box-shadow:0 16px 34px rgba(0,0,0,.24)}:root[data-theme="dark"] .quick-start{background:linear-gradient(135deg,#141821,#201c2e);border-color:var(--line)}:root[data-theme="dark"] .quality-menu summary,:root[data-theme="dark"] .quality-menu-pop,:root[data-theme="dark"] .quality-chip{background:var(--surface);border-color:var(--line);color:var(--muted)}:root[data-theme="dark"] .quality-chip:hover,:root[data-theme="dark"] .quality-chip.active{background:var(--surface-2);border-color:#77619b;color:var(--accent)}:root[data-theme="dark"] .source-card{background:var(--surface-2);border-color:var(--line)}:root[data-theme="dark"] .empty{background:var(--surface);border-color:var(--line);color:var(--muted)}:root[data-theme="dark"] .footer{background:#11151d;border-color:var(--line);color:var(--muted)}@media(max-width:680px){:root[data-theme="dark"] .hero-art:after{background:linear-gradient(0deg,#141821 8%,rgba(20,24,33,.82) 58%,rgba(20,24,33,.08) 100%)}.theme-toggle{padding:8px 9px}.theme-toggle .theme-label{display:none}}
</style></head><body>
<header class="top"><div class="top-in">
<a class="brand" href="/anime" aria-label="ARIA Anime home"><img class="brand-mark" src="/aria-mark.png" alt="ARIA mark" width="34" height="34" /><span class="brand-name">ARIA <b>ANIME</b></span></a>
<nav class="nav" aria-label="Primary"><a href="/anime/browse">Browse</a><a href="/anime/trending">Trending</a><a href="/anime/latest">Latest</a></nav>
<form class="search" action="/anime/search" method="get"><input name="q" aria-label="Search anime" placeholder="Search anime…" autocomplete="off"><button type="submit">Search</button></form>
<a class="account-link" href="/portal/login">Learner sign in</a><button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch color theme"><span class="theme-icon" aria-hidden="true">◐</span><span class="theme-label">Theme</span></button>
</div></header><main class="main">${inner}</main><footer class="footer">ARIA Anime · catalog metadata and media delivery are limited to configured authorized sources.</footer><script>(()=>{const key="aria-anime-theme";const root=document.documentElement;const button=document.getElementById("theme-toggle");const setTheme=(theme)=>{root.dataset.theme=theme;try{localStorage.setItem(key,theme)}catch(_){}};const current=()=>root.dataset.theme||"light";const sync=()=>{if(!button)return;const dark=current()==="dark";button.querySelector(".theme-icon").textContent=dark?"☼":"◐";button.querySelector(".theme-label").textContent=dark?"Light":"Dark";button.setAttribute("aria-label",dark?"Switch to light theme":"Switch to dark theme")};if(button){button.addEventListener("click",()=>{setTheme(current()==="dark"?"light":"dark");sync()});sync()}})();</script></body></html>`;
}

function cardGrid(items) {
  if (!items?.length) return `<div class="empty">No titles matched this view.</div>`;
  return `<div class="grid">${items.map((a) => `<a class="card" href="${esc(titleHref(a))}">
    ${a.cover ? `<img class="cover" src="${esc(a.cover)}" alt="" loading="lazy" onerror="this.remove()">` : `<div class="cover"></div>`}
    <div class="card-body"><div class="card-title">${esc(a.title)}</div><div class="card-meta"><span class="badge provider">${esc(providerLabel(a.provider))}</span>${a.rating ? `<span class="badge score">★ ${esc(a.rating)}</span>` : ""}</div></div>
  </a>`).join("")}</div>`;
}

async function homePage() {
  const [trending, latest] = await Promise.all([
    service.getTrending().catch(() => []),
    service.getLatest().catch(() => []),
  ]);
  const hero = trending[0];
  const heroHtml = hero ? `<section class="hero"><div class="hero-art">${hero.cover ? `<img src="${esc(hero.cover)}" alt="" loading="eager">` : ""}</div><div class="hero-copy"><div class="eyebrow">Featured this week · ${esc(providerLabel(hero.provider))}</div><h1>${esc(hero.title)}</h1><p>${esc(hero.overview || hero.description || "Open a title to see available episodes and authorized media options.")}</p><div class="hero-meta"><span class="meta-pill score">${hero.rating ? `★ ${esc(hero.rating)}` : "Featured"}</span>${hero.year ? `<span class="meta-pill">${esc(hero.year)}</span>` : ""}${hero.type ? `<span class="meta-pill">${esc(hero.type)}</span>` : ""}</div><div class="hero-actions">${button(titleHref(hero), "Open title", "primary")}${button("/anime/browse", "Browse catalog", "secondary")}</div></div></section>` : `<section class="hero"><div class="hero-copy"><div class="eyebrow">ARIA Anime</div><h1>Find your next series.</h1><p>Search the catalog or browse the latest metadata.</p></div></section>`;
  const quickStart = `<section class="quick-start"><div><span class="eyebrow">Your next watch</span><h2>Find it fast. Keep your place.</h2><p>Search by title, browse what is airing, or open a series and choose an episode. Playback is validated before ARIA exposes it, and downloads offer explicit 360p, 480p, and 720p requests when the source supports them.</p></div><div class="quick-actions">${button("/anime/browse", "Browse catalog", "primary")}${button("/anime/trending", "See what is trending", "secondary")}${button("/anime/latest", "Latest episodes", "secondary")}</div></section>`;
  return layout("Home", `${heroHtml}${quickStart}<div class="section-head"><h2 class="section-title">Trending now</h2><span class="section-sub">Popular titles</span></div>${cardGrid(trending.slice(0, 18))}<div class="section-head"><h2 class="section-title">Recently updated</h2><span class="section-sub">New catalog entries</span></div>${cardGrid(latest.slice(0, 18))}`);
}

async function searchPage(query) {
  const results = query ? await service.searchAnime(query).catch(() => []) : [];
  return layout(query ? `Search: ${query}` : "Search", `<div class="section-head"><h1 class="section-title">${esc(query ? `Results for “${query}”` : "Search anime")}</h1><span class="section-sub">${results.length ? `${results.length} safe results` : "Try a title, season, or character"}</span></div>${cardGrid(results)}`);
}

async function trendingPage() {
  return layout("Trending", `<div class="section-head"><h1 class="section-title">Trending</h1></div>${cardGrid(await service.getTrending().catch(() => []))}`);
}

async function latestPage() {
  return layout("Latest", `<div class="section-head"><h1 class="section-title">Recently updated</h1></div>${cardGrid(await service.getLatest().catch(() => []))}`);
}

async function browsePage(req) {
  const genre = String(req.query.genre || "");
  const year = String(req.query.year || "");
  const type = String(req.query.type || "");
  const items = await service.browseAnime({ genre, year, type, perPage: 24 }).catch(() => []);
  const genres = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Thriller"];
  const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
  return layout("Browse", `<form class="filter-bar" method="get" action="/anime/browse"><select name="genre"><option value="">All genres</option>${genres.map((g) => `<option value="${esc(g)}" ${g === genre ? "selected" : ""}>${esc(g)}</option>`).join("")}</select><select name="year"><option value="">All years</option>${years.map((y) => `<option value="${y}" ${String(y) === year ? "selected" : ""}>${y}</option>`).join("")}</select><button class="btn btn-primary" type="submit">Apply filters</button></form><div class="section-head"><h1 class="section-title">Browse catalog</h1><span class="section-sub">Public metadata · safe titles only</span></div>${cardGrid(items)}`);
}

function episodeActions(id, provider, number) {
  const base = `/anime/watch/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${encodeURIComponent(number)}`;
  const downloadBase = `/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${encodeURIComponent(number)}`;
  return `<div class="episode-actions"><a class="btn btn-primary" href="${esc(base)}">Watch</a><details class="quality-menu"><summary>Download</summary><div class="quality-menu-pop">${["360", "480", "720"].map((q) => button(`${downloadBase}&quality=${q}`, `${q}p`, "secondary")).join("")}${button(`${downloadBase}&quality=best`, "Auto", "secondary")}</div></details></div>`;
}

async function titlePage(req) {
  const id = String(req.params.id);
  const provider = String(req.query.prov || "anilist");
  const entry = { id, provider, title: "" };
  const [details, episodes] = await Promise.all([detailsFast(entry), withTimeout(service.getEpisodes(entry), 10000, [])]);
  if (!service.isCatalogSafe(details) || details.blocked) return layout("Title unavailable", `<div class="empty"><h1>Title unavailable</h1><p>This title is not included in the public catalog.</p>${button("/anime", "Back to home", "primary")}</div>`);
  const episodeHtml = episodes.length ? `<div class="episode-grid">${episodes.map((ep) => `<div class="episode"><div class="episode-number">Episode ${esc(ep.number)}</div><div class="episode-name">${esc(ep.title)}</div>${episodeActions(id, provider, ep.number)}</div>`).join("")}</div>` : `<div class="empty">Episode metadata is unavailable for this provider. Enter an episode number and choose a quality to try the configured authorized resolver.<div class="manual"><input id="manual-ep" type="number" min="1" value="1" aria-label="Episode number"><select id="manual-quality" aria-label="Download quality"><option value="best">Auto</option><option value="360">360p</option><option value="480">480p</option><option value="720">720p</option></select>${button(`/anime/watch/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=1`, "Watch", "primary", 'id="manual-watch"')}${button(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=1&quality=best`, "Download", "secondary", 'id="manual-dl"')}</div></div>`;
  const script = episodes.length ? "" : `<script>(function(){const i=document.getElementById('manual-ep'),q=document.getElementById('manual-quality'),w=document.getElementById('manual-watch'),d=document.getElementById('manual-dl');function sync(){const n=Math.max(1,parseInt(i.value||'1',10));const quality=q.value||'best';w.href=w.href.replace(/ep=\\d+/, 'ep='+n);d.href=d.href.replace(/ep=\\d+/, 'ep='+n).replace(/quality=[^&]+/, 'quality='+quality)}i.addEventListener('input',sync);q.addEventListener('change',sync)})();</script>`;
  return layout(details.title || "Anime", `<section class="detail">${details.cover ? `<img class="poster" src="${esc(details.cover)}" alt="" onerror="this.remove()">` : `<div class="poster"></div>`}<div><div class="eyebrow">${esc(providerLabel(provider))}</div><h1>${esc(details.title || "Untitled")}</h1><div class="metaline">${details.rating ? `<span>★ ${esc(details.rating)}</span>` : ""}${details.type ? `<span>${esc(details.type)}</span>` : ""}${details.year ? `<span>${esc(details.year)}</span>` : ""}${details.status ? `<span>${esc(details.status)}</span>` : ""}</div>${details.genres?.length ? `<div class="tags">${details.genres.slice(0, 8).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}</div>` : ""}<p class="desc">${esc(details.description || "Episode availability depends on the configured authorized source.")}</p>${officialWatchLinks(details)}<div class="detail-actions">${button("/anime/browse", "Back to catalog", "secondary")}</div></div></section><div class="section-head"><h2 class="section-title">Episodes${details.episodes ? ` · ${esc(details.episodes)}` : ""}</h2></div>${episodeHtml}${script}`);
}

async function watchPage(req) {
  const id = String(req.params.id);
  const provider = String(req.query.prov || "anilist");
  const episode = Math.max(1, Number(req.query.ep) || 1);
  const quality = normalizeQuality(req.query.quality);
  const details = await detailsFast({ id, provider, title: "" });
  if (details.blocked || !service.isCatalogSafe(details)) return layout("Title unavailable", `<div class="empty"><h1>Title unavailable</h1><p>This title is not included in the public catalog.</p>${button("/anime", "Back to home", "primary")}</div>`);
  const report = await withTimeout(resolveEpisode(details.title || id, episode, { preference: provider === "anilist" ? null : provider, quality }), 30000, null);
  const source = report?.selected;
  if (!source?.url) return layout("Watch unavailable", `<div class="empty"><h1>${esc(details.title || "Anime")} · episode ${episode}</h1><p>There is no validated playable source for <strong>${esc(qualityLabel(quality))}</strong> right now. The provider report below is live diagnostic data, not a promise that a source exists.</p><div class="quality-strip"><span class="quality-label">Try another quality</span>${qualityLinks(`/anime/watch/${encodeURIComponent(id)}`, { prov: provider, ep: episode }, quality)}</div><div class="source-card"><h3>Source status</h3>${providerDiagnostics(report) || `<div class="source-row"><span>Resolver</span><span class="source-state bad">No diagnostic data</span></div>`}</div><div class="detail-actions">${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Back to episodes", "secondary")}</div></div>`);
  const mediaToken = issueMediaToken({ url: source.url, headers: source.headers, provider: source.provider });
  if (!mediaToken) return layout("Watch unavailable", `<div class="empty"><h1>Playback is not configured</h1><p>The operator must set a media signing secret before playback can be served securely.</p>${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Back to episodes", "secondary")}</div>`);
  const mediaUrl = `/anime/proxy?t=${encodeURIComponent(mediaToken)}`;
  const isHls = source.type === "hls" || /\.m3u8(?:\?|$)/i.test(source.url);
  const playerScript = isHls ? `<script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script><script>const v=document.getElementById('player'),u=${JSON.stringify(mediaUrl)};if(window.Hls&&Hls.isSupported()){const h=new Hls({enableWorker:true});h.loadSource(u);h.attachMedia(v)}else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=u}else{v.outerHTML='<div class="empty">This browser cannot play this HLS stream.</div>'}</script>` : `<script>document.getElementById('player').src=${JSON.stringify(mediaUrl)};</script>`;
  return layout("Watch", `<div class="watch-head"><div><div class="eyebrow">Now playing</div><h1>${esc(details.title || source.title || "Anime")} · episode ${episode}</h1><p>${esc(providerLabel(source.provider))}${source.height ? ` · ${esc(source.height)}p` : ""} · requested ${esc(qualityLabel(quality))}${source.quality && source.quality !== "unknown" ? ` · source ${esc(source.quality)}` : ""}</p></div>${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Episodes", "secondary")}</div><div class="player-shell"><video id="player" controls playsinline preload="metadata"></video></div><div class="quality-strip"><span class="quality-label">Playback quality</span>${qualityLinks(`/anime/watch/${encodeURIComponent(id)}`, { prov: provider, ep: episode }, quality)}</div><div class="source-card"><h3>Resolved source</h3><div class="source-row"><span>Provider</span><span class="source-state ok">${esc(providerLabel(source.provider))}</span></div><div class="source-row"><span>Validation</span><span class="source-state ok">Playable source verified</span></div></div>${playerScript}`);
}

function downloadErrorPanel(job, id, provider, episode, quality) {
  const code = String(job?.error?.code || "DOWNLOAD_FAILED");
  const detail = String(job?.error?.message || "The source could not be downloaded.");
  let heading = "Download temporarily unavailable";
  let message = "ARIA could not prepare a validated media file for this episode. No incomplete file was offered.";
  if (code === "DEPENDENCY_MISSING") {
    heading = "Media runtime is not ready";
    message = "The deployment has not passed its media-runtime check yet. The operator must finish the runtime build, then this download can be retried safely.";
  } else if (code === "SOURCE_NOT_FOUND") {
    heading = "No playable source passed validation";
    message = "ARIA found the catalog entry, but no configured authorized source is currently safe and playable for this episode. Try another quality or return later.";
  } else if (code === "MEDIA_TOO_LARGE") {
    heading = "File is too large to deliver here";
    message = "The selected source exceeds the configured delivery limit. Try a lower quality or use the browser download when an eligible source is available.";
  }
  const retry = button(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${episode}&quality=${encodeURIComponent(quality)}&job=${encodeURIComponent(job.id)}&retry=1`, "Retry download", "primary");
  return `<div class="empty download-error"><h2>${esc(heading)}</h2><p>${esc(message)}</p><div class="detail-actions">${retry}${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Back to episodes", "secondary")}</div><details><summary>Technical details</summary><code>${esc(code)}: ${esc(detail)}</code></details></div>`;
}

async function downloadPage(req, res) {
  const id = String(req.params.id);
  const provider = String(req.query.prov || "anilist");
  const episode = Math.max(1, Number(req.query.ep) || 1);
  const quality = normalizeQuality(req.query.quality);
  const ownerId = publicOwnerId(req, res);
  let job = req.query.job ? getJob(String(req.query.job)) : null;
  if (job && job.ownerId && !publicJobAllowed(job, ownerId)) return res.status(403).send("This download job belongs to another session.");
  const details = await detailsFast({ id, provider, title: "" });
  const catalogSafe = !details.blocked && service.isCatalogSafe(details);
  // Establish the signed public session and a tracked job before provider metadata
  // can fail. The worker will later report SOURCE_NOT_FOUND instead of returning a
  // session-less HTML dead end during an upstream outage.
  if (!catalogSafe && !job) {
    const quota = publicDownloadQuota(req, ownerId);
    if (!quota.ok) return res.status(quota.status).send(quota.message);
    job = enqueueAnimeJob({ name: details.title || `Anime ${id}`, episode, preferred: provider === "anilist" ? null : provider, quality, sock: null, chatId: null, quotedMsg: null, ownerId, sessionId: ownerId, createdBy: "public-anime" });
    return res.redirect(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${episode}&quality=${encodeURIComponent(quality)}&job=${encodeURIComponent(job.id)}`);
  }
  if (req.query.retry === "1" && job?.status === "failed") {
    const quota = publicDownloadQuota(req, ownerId);
    if (!quota.ok) return res.status(quota.status).send(quota.message);
    job = retryJob(job.id) || job;
    return res.redirect(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${episode}&quality=${encodeURIComponent(quality)}&job=${encodeURIComponent(job.id)}`);
  }
  if (!job) {
    const active = findActiveJob({ ownerId, name: details.title || `Anime ${id}`, episode, preferred: provider === "anilist" ? null : provider, quality });
    if (active) {
      job = active;
    } else {
      const quota = publicDownloadQuota(req, ownerId);
      if (!quota.ok) return res.status(quota.status).send(quota.message);
      job = enqueueAnimeJob({ name: details.title || `Anime ${id}`, episode, preferred: provider === "anilist" ? null : provider, quality, sock: null, chatId: null, quotedMsg: null, ownerId, sessionId: ownerId, createdBy: "public-anime" });
    }
    return res.redirect(`/anime/dl/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}&ep=${episode}&quality=${encodeURIComponent(quality)}&job=${encodeURIComponent(job.id)}`);
  }
  const isFailed = job.status === "failed";
  const isDone = job.status === "done";
  const isPending = !isFailed && !isDone;
  const status = isFailed ? "Download failed" : isDone ? "Ready" : job.status === "running" ? "Downloading" : "Queued";
  const statusClass = isFailed ? "failed" : isPending ? "pending" : "";
  const percent = job.progress?.percent == null ? null : Math.max(0, Math.min(100, Math.round(job.progress.percent)));
  const progress = percent == null ? "" : `<div class="job-row"><span class="job-label">Progress</span><span>${percent}%</span></div><div class="progress-track"><div class="progress-bar" style="width:${percent}%"></div></div>`;
  const fileReady = isDone && job.result?.filePath && fs.existsSync(job.result.filePath);
  const fileToken = fileReady ? issueFileToken(job.id, undefined, ownerId) : null;
  const result = fileReady && fileToken ? `<div class="download-actions">${button(`/anime/file/${encodeURIComponent(job.id)}?t=${encodeURIComponent(fileToken)}`, "Download file", "primary")}${button(`/anime/title/${encodeURIComponent(id)}?prov=${encodeURIComponent(provider)}`, "Back to episodes", "secondary")}</div>` : "";
  const error = isFailed ? downloadErrorPanel(job, id, provider, episode, quality) : "";
  const refresh = isPending ? `<script>setTimeout(()=>location.reload(),5000)</script>` : "";
  return layout("Download", `<div class="job"><div class="eyebrow">Episode delivery</div><h1>${esc(details.title || "Anime")} · episode ${episode}</h1><div class="job-row"><span class="job-label">Requested quality</span><span>${esc(qualityLabel(job.quality || quality))}</span></div><div class="job-row"><span class="job-label">Status</span><span class="status ${statusClass}">${esc(status)}</span></div><div class="job-row"><span class="job-label">Job</span><span>${esc(job.id)}</span></div>${progress}</div>${result}${error}${!result && !error ? `<div class="empty">This page refreshes while a validated authorized source is prepared. A download link appears only after the file passes media validation.</div>` : ""}${refresh}`);
}

router.get("/proxy", async (req, res) => {
  const payload = verifyMediaToken(req.query.t);
  if (!payload) return res.status(401).send("This playback link has expired. Open the episode again.");
  const target = await validateMediaTarget(payload.url);
  if (!target.ok) return res.status(403).send("This media source is not authorized.");
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36", ...(payload.headers || {}) };
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = https.get(target.url, { headers, lookup: (_hostname, options, callback) => options?.all ? callback(null, [{ address: target.address, family: target.family }]) : callback(null, target.address, target.family) }, (response) => {
    res.status(response.statusCode || 200);
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) if (response.headers[key]) res.setHeader(key, response.headers[key]);
    res.setHeader("Cache-Control", "private, max-age=60");
    response.pipe(res);
  });
  const closeUpstream = () => { if (!upstream.destroyed) upstream.destroy(); };
  req.once("aborted", closeUpstream);
  res.once("close", closeUpstream);
  upstream.setTimeout(20000, () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", () => { if (!res.headersSent) res.status(502).send("Media source is temporarily unavailable."); else res.end(); });
});

router.get("/", async (req, res) => { try { res.send(await homePage()); } catch (e) { safePageError(res, "anime-home", e); } });
router.get("/search", async (req, res) => { try { res.send(await searchPage(req.query.q || "")); } catch (e) { safePageError(res, "anime-search", e); } });
router.get("/trending", async (req, res) => { try { res.send(await trendingPage()); } catch (e) { safePageError(res, "anime-trending", e); } });
router.get("/latest", async (req, res) => { try { res.send(await latestPage()); } catch (e) { safePageError(res, "anime-latest", e); } });
router.get("/browse", async (req, res) => { try { res.send(await browsePage(req)); } catch (e) { safePageError(res, "anime-browse", e); } });
router.get("/title/:id", async (req, res) => { try { res.send(await titlePage(req)); } catch (e) { safePageError(res, "anime-title", e); } });
router.get("/watch/:id", async (req, res) => { try { res.send(await watchPage(req)); } catch (e) { safePageError(res, "anime-watch", e); } });
router.get("/dl/:id", async (req, res) => { try { const page = await downloadPage(req, res); if (!res.headersSent && page) res.send(page); } catch (e) { if (!res.headersSent) safePageError(res, "anime-download", e); } });
router.get("/file/:id", (req, res) => {
  try {
    const jobId = String(req.params.id);
    const ownerId = publicOwnerId(req, res);
    if (!verifyFileToken(req.query.t, jobId, ownerId)) return res.status(401).send("This download link has expired or belongs to another session. Return to the episode and try again.");
    const job = getJob(jobId);
    if (!publicJobAllowed(job, ownerId)) return res.status(403).send("This download job belongs to another session.");
    const filePath = job?.result?.filePath;
    if (!job || job.status !== "done" || !filePath || !fs.existsSync(filePath)) return res.status(404).send("File not found or no longer available.");
    const safe = `${job.name || "anime"}-ep${job.episode || ""}.mp4`.replace(/[^a-z0-9._-]+/gi, "_");
    res.download(filePath, safe, { headers: { "Content-Type": "video/mp4" } });
  } catch (e) { safePageError(res, "anime-file", e); }
});

module.exports = router;
