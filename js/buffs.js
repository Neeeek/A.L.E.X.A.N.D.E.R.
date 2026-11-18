// Buff Dojo — scroll-driven figure rotation, section glyphs, scroll reveals
// and the "free trial buff" status-effect HUD.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

const stage = document.getElementById("stage");
const stageCol = document.getElementById("stageCol");
const backdrop = document.getElementById("backdrop");
const chakraBar = document.getElementById("chakraBar");
const intro = document.querySelector(".intro");

// ---- scroll + pointer rig ---------------------------------------------------
// Targets are read from scroll/pointer events; the rendered values ease towards
// them each frame so the figure turns smoothly instead of snapping.

const MAX_TURN_DEG = 16; // scroll-driven turn, each way
const POINTER_TURN_DEG = 7;
const POINTER_TILT_DEG = 4;
const EASE = 0.1;

const target = { p: 0, hero: 0, mx: 0, my: 0 };
const current = { ...target };
let frame = 0;

function readScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  target.p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  target.hero = Math.min(1, window.scrollY / window.innerHeight);
  requestFrame();
}

function readPointer(event) {
  target.mx = (event.clientX / window.innerWidth) * 2 - 1;
  target.my = (event.clientY / window.innerHeight) * 2 - 1;
  requestFrame();
}

function requestFrame() {
  if (!frame) frame = requestAnimationFrame(render);
}

function render() {
  frame = 0;
  let settling = false;

  for (const key of Object.keys(target)) {
    const delta = target[key] - current[key];
    if (reduceMotion || Math.abs(delta) < 0.0005) {
      current[key] = target[key];
    } else {
      current[key] += delta * EASE;
      settling = true;
    }
  }

  const { p, hero, mx, my } = current;
  const ry = reduceMotion ? 0 : Math.sin(p * Math.PI * 2) * MAX_TURN_DEG + mx * POINTER_TURN_DEG;
  const rx = reduceMotion ? 0 : -my * POINTER_TILT_DEG;

  for (const el of [stage, stageCol, backdrop, chakraBar, intro]) {
    el.style.setProperty("--p", p.toFixed(4));
    el.style.setProperty("--hero", hero.toFixed(4));
  }
  stage.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
  stage.style.setProperty("--rx", `${rx.toFixed(2)}deg`);

  if (settling) requestFrame();
}

window.addEventListener("scroll", readScroll, { passive: true });
window.addEventListener("resize", readScroll);
if (finePointer && !reduceMotion) {
  window.addEventListener("pointermove", readPointer, { passive: true });
}
readScroll();

// ---- section glyph next to the figure ----------------------------------------

const glyphBox = document.querySelector(".stage-glyph");
const glyphMain = document.getElementById("stageGlyph");
const glyphSub = document.getElementById("stageGlyphSub");

function showGlyph(section) {
  const { glyph, glyphSub: sub } = section.dataset;
  if (glyphMain.textContent === glyph) return;
  glyphMain.textContent = glyph;
  glyphSub.textContent = sub;
  glyphBox.classList.remove("swap");
  void glyphBox.offsetWidth; // restart the animation
  glyphBox.classList.add("swap");
}

const sectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) showGlyph(entry.target);
    }
  },
  { rootMargin: "-50% 0px -50% 0px" }
);
document.querySelectorAll("[data-glyph]").forEach((el) => sectionObserver.observe(el));

// ---- reveal on scroll -----------------------------------------------------------

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      revealObserver.unobserve(entry.target);
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
);
document.querySelectorAll("[data-reveal]").forEach((el) => revealObserver.observe(el));

// ---- status-effect HUD ----------------------------------------------------------

const DEBUFFS = [
  { icon: "😩", label: "Усталость понедельника" },
  { icon: "🫥", label: "Синдром самозванца" },
  { icon: "📭", label: "Проклятие «Мы вам перезвоним»" },
];

const BUFFS = [
  { icon: "🍀", label: "+25 к удаче", time: "24 ч" },
  { icon: "🦁", label: "+20 к уверенности", time: "до оффера" },
  { icon: "🗣️", label: "+15 к красноречию", time: "1 звонок" },
  { icon: "🛡️", label: "Иммунитет к неловкому молчанию", time: "∞" },
];

const SEALS = ["Тигр", "Кабан", "Баран"];
const SEAL_STEP_MS = reduceMotion ? 0 : 420;
const DISPEL_MS = reduceMotion ? 0 : 450;
const CAST_GLOW_MS = 1600;

const effectsEl = document.getElementById("hudEffects");
const sealTrailEl = document.getElementById("sealTrail");
const castBtn = document.getElementById("castBtn");

let buffed = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chip({ icon, label, time }, kind, index = 0) {
  const li = document.createElement("li");
  li.className = `fx ${kind}`;
  li.style.setProperty("--i", index);

  const iconEl = document.createElement("span");
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.textContent = icon;
  li.append(iconEl, label);

  if (time) {
    const timeEl = document.createElement("span");
    timeEl.className = "fx-time";
    timeEl.textContent = time;
    li.append(timeEl);
  }
  return li;
}

function showDebuffs() {
  buffed = false;
  effectsEl.replaceChildren(...DEBUFFS.map((d, i) => chip(d, "debuff", i)));
  sealTrailEl.textContent = "";
  castBtn.textContent = "Наложить бесплатный пробный бафф";
}

function burst() {
  if (reduceMotion || typeof window.confetti !== "function") return;
  const rect = castBtn.getBoundingClientRect();
  window.confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 38,
    origin: {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: rect.top / window.innerHeight,
    },
    colors: ["#8fe9ef", "#c7f7f8", "#c8323b", "#ffffff"],
  });
}

async function cast() {
  castBtn.disabled = true;
  castBtn.textContent = "Складываю печати…";
  stage.classList.add("casting");

  const trail = [];
  for (const seal of SEALS) {
    trail.push(seal);
    sealTrailEl.textContent = trail.join(" → ");
    await wait(SEAL_STEP_MS);
  }

  effectsEl.querySelectorAll(".debuff").forEach((el) => el.classList.add("dispel"));
  await wait(DISPEL_MS);

  effectsEl.replaceChildren(...BUFFS.map((b, i) => chip(b, "buff", i)));
  sealTrailEl.textContent = `Дебаффы сняты · наложено баффов: ${BUFFS.length}`;
  burst();

  buffed = true;
  castBtn.textContent = "Вернуть проклятия";
  castBtn.disabled = false;
  setTimeout(() => stage.classList.remove("casting"), CAST_GLOW_MS);
}

castBtn.addEventListener("click", () => (buffed ? showDebuffs() : cast()));

showDebuffs();
