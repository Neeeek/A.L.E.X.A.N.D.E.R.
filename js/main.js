import { INCIDENT_DATA_URL } from "../config.js";

// ---- joke config ---------------------------------------------------------
// Fallback "historical incident count" used only when the gist doesn't
// provide an `incidents` array (older gist format). Real data takes priority.
const HISTORICAL_INCIDENT_COUNT = 12;
const MILESTONES = [7, 30, 100, 365];
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // re-fetch every 5 minutes
const MILESTONE_STORAGE_KEY = "alexander:lastCelebratedDays";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- DOM refs -------------------------------------------------------------
const loadingPanel = document.getElementById("loadingPanel");
const errorPanel = document.getElementById("errorPanel");
const statusPanel = document.getElementById("statusPanel");
const errorMessageEl = document.getElementById("errorMessage");
const retryBtn = document.getElementById("retryBtn");
const heroNumberEl = document.getElementById("heroNumber");
const uptimeValueEl = document.getElementById("uptimeValue");
const incidentCountValueEl = document.getElementById("incidentCountValue");
const lastIncidentDateEl = document.getElementById("lastIncidentDate");
const sparklineEl = document.getElementById("sparkline");
const milestoneBanner = document.getElementById("milestoneBanner");

let hasLoadedOnce = false;
let lastRenderedDays = null;

// ---- data layer (per ALEXANDER_STATUS_INSTRUCTIONS.md) --------------------

async function getIncidentData() {
  // cache-busting param avoids stale CDN responses
  const url = `${INCIDENT_DATA_URL}?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch incident data: ${res.status}`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Incident data is malformed JSON.");
  }
  if (!data || typeof data.lastIncidentDate !== "string") {
    throw new Error("Incident data is malformed.");
  }
  return data; // { lastIncidentDate: "YYYY-MM-DD", incidents?: string[], note?: string }
}

function daysSince(dateString) {
  const last = new Date(dateString + "T00:00:00");
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  // normalize to midnight to avoid off-by-one from time-of-day
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((nowMidnight - last) / msPerDay);
  return Math.max(diff, 0);
}

async function renderStatus() {
  try {
    const data = await getIncidentData();
    const days = daysSince(data.lastIncidentDate);
    return {
      days,
      lastIncidentDate: data.lastIncidentDate,
      incidents: Array.isArray(data.incidents) ? data.incidents : null,
      status: "operational",
    };
  } catch (err) {
    return { error: true, message: err.message };
  }
}

// ---- UI state switching -----------------------------------------------

function showLoading() {
  loadingPanel.hidden = false;
  errorPanel.hidden = true;
  statusPanel.hidden = true;
}

function showError(message) {
  loadingPanel.hidden = true;
  errorPanel.hidden = false;
  statusPanel.hidden = true;
  errorMessageEl.textContent = message || "Couldn't reach the incident log. The satellite may be sulking.";
}

function showSuccess() {
  loadingPanel.hidden = true;
  errorPanel.hidden = true;
  statusPanel.hidden = false;
}

// ---- count-up animation -----------------------------------------------

function animateCountUp(el, from, to, duration = 1200) {
  if (prefersReducedMotion || from === to) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

  function tick(now) {
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeOutExpo(t);
    const value = Math.round(from + (to - from) * eased);
    el.textContent = String(value);
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = String(to);
      el.classList.add("bump");
      setTimeout(() => el.classList.remove("bump"), 350);
    }
  }
  requestAnimationFrame(tick);
}

// ---- sparkline (30-day incident history) --------------------------------

// Small deterministic PRNG so cosmetic bar-height jitter is stable across
// reloads instead of jittering randomly every time.
function seededRandom(seed) {
  let t = seed + 0x6d2b79f5;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h;
}

function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parses gist `incidents: ["YYYY-MM-DD", ...]`. Repeated dates mean multiple
// incidents happened that same day — kept as separate entries so counts add up.
function parseIncidentDates(incidents) {
  if (!Array.isArray(incidents)) return null;
  return incidents
    .filter((d) => typeof d === "string")
    .map((d) => new Date(d + "T00:00:00"))
    .filter((d) => !isNaN(d));
}

function buildSparklineData(incidentDates) {
  const days = 30;
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const countByDay = new Map();
  (incidentDates || []).forEach((d) => {
    const key = formatDateKey(d);
    countByDay.set(key, (countByDay.get(key) || 0) + 1);
  });

  const bars = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(todayMidnight);
    date.setDate(date.getDate() - i);
    const key = formatDateKey(date);
    const count = countByDay.get(key) || 0;
    const isIncident = count > 0;
    const height = isIncident
      ? Math.min(30 + count * 20, 95)
      : Math.round(65 + seededRandom(hashString(key))() * 35);
    bars.push({ isIncident, count, height, date });
  }
  return bars;
}

// Used only when the gist has no `incidents` array (older gist format) —
// scatters a handful of incident days within the 30-day window so the
// chart still reads as a real dashboard instead of a flat green line.
function buildFallbackIncidentDates(count) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const rand = seededRandom(count * 1337);
  const incidentCount = Math.min(Math.max(count % 6, 2), 5);
  const daysAgoSet = new Set();
  while (daysAgoSet.size < incidentCount) {
    daysAgoSet.add(6 + Math.floor(rand() * 24)); // 6-29 days ago, keep last 6 days clean
  }
  return [...daysAgoSet].map((daysAgo) => {
    const d = new Date(todayMidnight);
    d.setDate(d.getDate() - daysAgo);
    return d;
  });
}

function renderSparkline(incidentDates) {
  const bars = buildSparklineData(incidentDates);
  sparklineEl.innerHTML = "";
  bars.forEach((bar, i) => {
    const dateLabel = bar.date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const label = bar.isIncident
      ? `${dateLabel} · ${bar.count} incident${bar.count > 1 ? "s" : ""}`
      : `${dateLabel} · operational`;

    const el = document.createElement("div");
    el.className = "spark-bar" + (bar.isIncident ? " incident" : "");
    el.style.height = `${bar.height}%`;
    el.style.animationDelay = `${i * 18}ms`;
    el.title = label;
    sparklineEl.appendChild(el);
  });
}

// ---- milestone celebration (once per session/load) ---------------------

function maybeCelebrateMilestone(days) {
  const stored = Number(sessionStorage.getItem(MILESTONE_STORAGE_KEY) || 0);
  if (days <= stored) return;

  const crossed = MILESTONES.filter((m) => m > stored && m <= days);
  sessionStorage.setItem(MILESTONE_STORAGE_KEY, String(days));
  if (crossed.length === 0) return;

  celebrateMilestone(crossed[crossed.length - 1]);
}

function celebrateMilestone(milestone) {
  milestoneBanner.textContent = `🎉 ${milestone} days without incident! A.L.E.X.A.N.D.E.R. remains vigilant.`;
  milestoneBanner.hidden = false;
  milestoneBanner.classList.remove("show");
  // force reflow so the animation replays
  void milestoneBanner.offsetWidth;
  milestoneBanner.classList.add("show");

  if (!prefersReducedMotion && typeof window.confetti === "function") {
    window.confetti({
      particleCount: 140,
      spread: 80,
      startVelocity: 45,
      origin: { y: 0.3 },
      colors: ["#34e0a1", "#ff5fa2", "#ff9d4d", "#6dffc4"],
    });
  }

  setTimeout(() => {
    milestoneBanner.classList.remove("show");
    setTimeout(() => {
      milestoneBanner.hidden = true;
    }, 400);
  }, 5000);
}

// ---- main render ---------------------------------------------------------

async function loadStatus() {
  if (!hasLoadedOnce) {
    showLoading();
  }

  const result = await renderStatus();

  if (result.error) {
    showError(result.message);
    return;
  }

  const { days, lastIncidentDate, incidents } = result;

  showSuccess();
  animateCountUp(heroNumberEl, hasLoadedOnce ? lastRenderedDays ?? 0 : 0, days);

  const incidentDates = parseIncidentDates(incidents);
  const historicalCount = incidentDates ? incidentDates.length : HISTORICAL_INCIDENT_COUNT;

  const uptimePct = (days / (days + historicalCount)) * 100;
  uptimeValueEl.textContent = `${uptimePct.toFixed(1)}%`;
  incidentCountValueEl.textContent = String(historicalCount);

  const parsedDate = new Date(lastIncidentDate + "T00:00:00");
  lastIncidentDateEl.textContent = parsedDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  if (!hasLoadedOnce) {
    renderSparkline(incidentDates || buildFallbackIncidentDates(HISTORICAL_INCIDENT_COUNT));
  }

  maybeCelebrateMilestone(days);

  lastRenderedDays = days;
  hasLoadedOnce = true;
}

// ---- wire up --------------------------------------------------------------

retryBtn.addEventListener("click", () => {
  hasLoadedOnce = false;
  loadStatus();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadStatus();
  }
});

setInterval(loadStatus, REFRESH_INTERVAL_MS);

loadStatus();
