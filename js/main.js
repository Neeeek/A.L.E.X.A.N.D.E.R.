import { INCIDENT_DATA_URL } from "../config.js";

// ---- joke config ---------------------------------------------------------
// Arbitrary "historical incident count" used purely for the fake uptime %
// stat and the mock sparkline. Not sourced from the gist — it's set dressing.
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
  return data; // { lastIncidentDate: "YYYY-MM-DD", note?: string }
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
    return { days, lastIncidentDate: data.lastIncidentDate, status: "operational" };
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

// ---- sparkline (mock 30-day incident history) --------------------------

// Small deterministic PRNG so the chart looks the same across reloads
// instead of jittering randomly every time.
function seededRandom(seed) {
  let t = seed + 0x6d2b79f5;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSparklineData() {
  const days = 30;
  const rand = seededRandom(HISTORICAL_INCIDENT_COUNT * 1337);
  // scatter a handful of "incident" days across the older part of the
  // window so the most recent days always read as healthy/green.
  const incidentCount = Math.min(Math.max(HISTORICAL_INCIDENT_COUNT % 6, 2), 5);
  const incidentIdx = new Set();
  while (incidentIdx.size < incidentCount) {
    incidentIdx.add(Math.floor(rand() * (days - 6))); // keep last 6 days clean
  }

  const bars = [];
  for (let i = 0; i < days; i++) {
    const isIncident = incidentIdx.has(i);
    const height = isIncident ? 25 + rand() * 20 : 65 + rand() * 35;
    bars.push({ isIncident, height: Math.round(height) });
  }
  return bars;
}

function renderSparkline() {
  const bars = buildSparklineData();
  const today = new Date();
  sparklineEl.innerHTML = "";
  bars.forEach((bar, i) => {
    const daysAgo = bars.length - 1 - i;
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const label = `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${
      bar.isIncident ? "degraded" : "operational"
    }`;

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

  const { days, lastIncidentDate } = result;

  showSuccess();
  animateCountUp(heroNumberEl, hasLoadedOnce ? lastRenderedDays ?? 0 : 0, days);

  const uptimePct = (days / (days + HISTORICAL_INCIDENT_COUNT)) * 100;
  uptimeValueEl.textContent = `${uptimePct.toFixed(1)}%`;
  incidentCountValueEl.textContent = String(HISTORICAL_INCIDENT_COUNT);

  const parsedDate = new Date(lastIncidentDate + "T00:00:00");
  lastIncidentDateEl.textContent = parsedDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  if (!hasLoadedOnce) {
    renderSparkline();
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
