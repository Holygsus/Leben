// EXPERIMENT Ghost-Rennen (Meyerdinger-Experiment bdbfb380, Bauplan c6882536, Ablauf 22.11.2026).
// Kachel „Geist der Vorwoche“ im Plan-Tab: die laufende Woche (Montag bis heute) fährt gegen die
// Vorwoche bis zum gleichen Wochentag. Datenquelle sind die Bewertungen (task_feedback) mit dem
// Bereich der Aufgabe, gerechnet in Europe/Berlin. Kein Schema, nur Lesen.
// Strecken: Breite (Anzahl bewerteter Lebensbereiche, Standard), Menge (bewertete Aufgaben),
// Spaß (Bewertungsschnitt). Funkenregen nur beim Überholen auf Breite, nie das Wort „verloren“.
// Rückbau: diese Datei löschen, den mountGhostRace-Aufruf und Import in js/views/plan.js, die
// Section #ghost-race in views/plan.html, den Eintrag in sw.js und den CSS-Block „Ghost-Rennen“.
import { listTaskFeedbackSince, shiftIsoDate } from "./insights.js";
import { listAreas } from "./areas.js";
import { escapeHtml } from "./ui/dom.js";
import { state } from "./ui/state.js";

export const GHOST_RACE_EXPIRY = "2026-11-22";
export const RACE_MODES = ["breite", "menge", "spass"];
const MODE_LABEL = { breite: "Breite", menge: "Menge", spass: "Spaß" };
const DAYS_SHORT = ["M", "D", "M", "D", "F", "S", "S"];
const DAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const LS_MODE = "ghost-race-mode";
const LS_COLLAPSED = "ghost-race-collapsed";
const LS_SPARK = "ghost-race-spark";

/* ---------- Reine Rechnung (in test.js abgedeckt) ---------- */

const berlinFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Kalendertag (YYYY-MM-DD) eines Zeitstempels in Europe/Berlin, unabhängig von der Gerätezeitzone.
export function berlinDay(ts) {
  return berlinFormat.format(new Date(ts));
}

// 0 = Montag … 6 = Sonntag. Mittag als Uhrzeit, damit Sommerzeitwechsel nie den Tag verschieben.
export function weekdayIndex(iso) {
  return (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7;
}

export function mondayOf(iso) {
  return shiftIsoDate(iso, -weekdayIndex(iso));
}

// Eine Woche als 7 Tage mit aufaddierten Ständen. Tage ab `limit` (Index) bleiben null, damit die
// Strecke dort aufhört.
function buildWeek(items, weekStart, limit) {
  const seen = new Set();
  let count = 0;
  let sum = 0;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = shiftIsoDate(weekStart, i);
    const today = items.filter((x) => x.day === date);
    const areas = [...new Set(today.map((x) => x.area_id).filter(Boolean))];
    const newAreas = areas.filter((a) => !seen.has(a));
    areas.forEach((a) => seen.add(a));
    count += today.length;
    today.forEach((x) => (sum += x.rating));
    const done = i < limit;
    days.push({
      date,
      count: today.length,
      areas,
      newAreas,
      breite: done ? seen.size : null,
      menge: done ? count : null,
      spass: done && count ? sum / count : null,
    });
  }
  return days;
}

// feedback: [{ rating, created_at, area_id }], todayIso: Kalendertag in Berlin.
// Ergebnis: { curStart, prevStart, dayIdx, cur: Tag[7], ghost: Tag[7], hasGhost }.
export function buildGhostRace(feedback, todayIso) {
  const curStart = mondayOf(todayIso);
  const prevStart = shiftIsoDate(curStart, -7);
  const dayIdx = weekdayIndex(todayIso);
  const items = (feedback || []).map((f) => ({ ...f, day: berlinDay(f.created_at) }));
  const prevItems = items.filter((x) => x.day >= prevStart && x.day < curStart);
  const curItems = items.filter((x) => x.day >= curStart && x.day <= todayIso);
  return {
    curStart,
    prevStart,
    dayIdx,
    cur: buildWeek(curItems, curStart, dayIdx + 1),
    ghost: buildWeek(prevItems, prevStart, dayIdx + 1),
    hasGhost: prevItems.length > 0,
  };
}

// "ahead" | "behind" | "tie" | "none" — Stand am heutigen Wochentag.
export function raceStanding(race, mode) {
  if (!race.hasGhost) return "none";
  const a = race.cur[race.dayIdx][mode];
  const b = race.ghost[race.dayIdx][mode];
  if (a == null || b == null) return a == null && b == null ? "tie" : a == null ? "behind" : "ahead";
  const d = Math.round((a - b) * 10) / 10;
  return d > 0 ? "ahead" : d < 0 ? "behind" : "tie";
}

// Tag des letzten Überholens auf Breite (Index), nur wenn heute vorn, sonst null.
export function overtakeDay(race) {
  if (raceStanding(race, "breite") !== "ahead") return null;
  let idx = null;
  for (let i = 0; i <= race.dayIdx; i++) {
    const ahead = race.cur[i].breite > race.ghost[i].breite;
    const before = i > 0 && race.cur[i - 1].breite > race.ghost[i - 1].breite;
    if (ahead && !before) idx = i;
  }
  return idx;
}

export function formatRaceValue(mode, v) {
  if (v == null) return "–";
  return mode === "spass" ? v.toFixed(1).replace(".", ",") : String(v);
}

/* ---------- Kachel ---------- */

const STANDING_TEXT = { ahead: "Du vorn", behind: "Geist vorn", tie: "Gleichauf", none: "Kein Geist" };

const tile = { race: null, areasById: new Map(), mode: "breite", selDay: null, el: null };

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* privat/gesperrt: dann eben ohne Merken */
  }
}

// Lädt die Bewertungen ab Vorwochen-Montag und zeichnet die Kachel in `el` (Section #ghost-race).
// Scheitert das Laden, bleibt die Kachel unsichtbar: sie ist ein Extra, nie ein Grund für einen
// kaputten Plan-Tab.
export async function mountGhostRace(el) {
  if (!el) return;
  const myGeneration = state.renderGeneration;
  const todayIso = berlinDay(Date.now());
  const since = shiftIsoDate(mondayOf(todayIso), -8); // ein Tag Puffer für die Zeitzone
  try {
    const [feedback, areas] = await Promise.all([listTaskFeedbackSince(since), listAreas()]);
    if (myGeneration !== state.renderGeneration || !el.isConnected) return;
    tile.race = buildGhostRace(feedback, todayIso);
    tile.areasById = new Map(areas.map((a) => [a.id, a]));
  } catch (err) {
    console.warn("Ghost-Rennen: Bewertungen nicht geladen", err);
    return;
  }
  const savedMode = lsGet(LS_MODE);
  tile.mode = RACE_MODES.includes(savedMode) ? savedMode : "breite";
  tile.selDay = null;
  tile.el = el;
  el.innerHTML = `
    <div class="ghost-race-head">
      <button type="button" class="ghost-race-toggle" id="ghost-race-toggle" aria-controls="ghost-race-body">
        <span class="ghost-race-lab" title="Experiment bis 22.11.2026" aria-label="Experiment bis 22.11.2026">🧪</span>
        <span class="ghost-race-title" title="Geist der Vorwoche">Ghost-Rennen</span>
        <span class="ghost-race-score" id="ghost-race-score"></span>
        <span class="ghost-race-pill" id="ghost-race-pill"></span>
        <span class="ghost-race-chevron" aria-hidden="true">▾</span>
      </button>
    </div>
    <div class="ghost-race-body" id="ghost-race-body">
      <div class="ghost-race-modes" role="group" aria-label="Strecke wählen">
        ${RACE_MODES.map((m) => `<button type="button" class="ghost-race-mode" data-mode="${m}">${MODE_LABEL[m]}</button>`).join("")}
      </div>
      <div class="ghost-race-track">
        <svg class="ghost-race-svg" id="ghost-race-svg" preserveAspectRatio="none" aria-hidden="true"></svg>
        <canvas class="ghost-race-fx" id="ghost-race-fx" aria-hidden="true"></canvas>
        <div class="ghost-race-days">
          ${DAYS_SHORT.map((d, i) => `<button type="button" class="ghost-race-day" data-day="${i}" aria-label="${DAYS_LONG[i]}: Bereiche anzeigen"><span>${d}</span></button>`).join("")}
        </div>
      </div>
    </div>
    <div class="ghost-race-detail" id="ghost-race-detail" hidden></div>`;
  el.hidden = false;

  setCollapsed(lsGet(LS_COLLAPSED) === "1");
  el.querySelector("#ghost-race-toggle").addEventListener("click", () => {
    const collapsed = !el.classList.contains("is-collapsed");
    lsSet(LS_COLLAPSED, collapsed ? "1" : "0");
    setCollapsed(collapsed);
    if (!collapsed) renderTile(true);
  });
  el.querySelectorAll(".ghost-race-mode").forEach((b) =>
    b.addEventListener("click", () => {
      tile.mode = b.dataset.mode;
      lsSet(LS_MODE, tile.mode);
      renderTile(true);
    })
  );
  el.querySelectorAll(".ghost-race-day").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.day);
      tile.selDay = tile.selDay === i ? null : i;
      renderTile(false);
    })
  );
  renderTile(true);
}

function setCollapsed(collapsed) {
  tile.el.classList.toggle("is-collapsed", collapsed);
  tile.el.querySelector("#ghost-race-toggle").setAttribute("aria-expanded", String(!collapsed));
  tile.el.querySelector("#ghost-race-body").hidden = collapsed;
  if (collapsed) tile.el.querySelector("#ghost-race-detail").hidden = true;
}

function renderTile(mayAnimate) {
  const { race, mode, el } = tile;
  const st = raceStanding(race, mode);
  const li = race.dayIdx;
  // Kurz halten, damit die Kopfzeile auf dem Handy in eine Zeile passt, die Strecke steht im title.
  const score = el.querySelector("#ghost-race-score");
  score.innerHTML =
    `du <b>${formatRaceValue(mode, race.cur[li][mode])}</b>` +
    (race.hasGhost ? ` · Geist <b>${formatRaceValue(mode, race.ghost[li][mode])}</b>` : "");
  score.title = MODE_LABEL[mode];
  const pill = el.querySelector("#ghost-race-pill");
  pill.textContent = STANDING_TEXT[st];
  pill.dataset.standing = st;
  el.querySelectorAll(".ghost-race-mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  el.querySelectorAll(".ghost-race-day").forEach((b) => {
    const i = Number(b.dataset.day);
    b.dataset.selected = String(i === tile.selDay);
    b.dataset.future = String(i > li);
  });
  if (el.classList.contains("is-collapsed")) return;
  drawTrack();
  renderDetail();
  if (mayAnimate && mode === "breite") maybeSparks();
}

function drawTrack() {
  const { race, mode, el } = tile;
  const svg = el.querySelector("#ghost-race-svg");
  const W = 140;
  const H = 40;
  const values = [...race.cur, ...(race.hasGhost ? race.ghost : [])].map((d) => d[mode]).filter((v) => v != null);
  const ymin = mode === "spass" ? 1 : 0;
  const ymax = mode === "spass" ? 5 : Math.max(1, ...values);
  const x = (i) => (W / 7) * (i + 0.5);
  const y = (v) => 4 + (H - 8) * (1 - (v - ymin) / (ymax - ymin || 1));
  const path = (days) => {
    let s = "";
    let pen = false;
    days.forEach((d, i) => {
      if (d[mode] == null) return (pen = false);
      s += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(d[mode]).toFixed(1)}`;
      pen = true;
    });
    return s;
  };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const li = race.dayIdx;
  const parts = [];
  if (tile.selDay != null) parts.push(`<rect class="ghost-race-sel" x="${(W / 7) * tile.selDay}" y="0" width="${W / 7}" height="${H}" rx="3"/>`);
  if (race.hasGhost) parts.push(`<path class="ghost-race-line is-ghost" d="${path(race.ghost)}"/>`);
  parts.push(`<path class="ghost-race-line" d="${path(race.cur)}"/>`);
  if (race.hasGhost && race.ghost[li][mode] != null) parts.push(`<circle class="ghost-race-dot is-ghost" cx="${x(li)}" cy="${y(race.ghost[li][mode])}" r="3"/>`);
  if (race.cur[li][mode] != null) parts.push(`<circle class="ghost-race-dot" cx="${x(li)}" cy="${y(race.cur[li][mode])}" r="3"/>`);
  svg.innerHTML = parts.join("");
  tile.geo = { x, y, W, H };
}

function areaChip(id, isNew) {
  const a = tile.areasById.get(id);
  const name = a ? a.name : "Ohne Bereich";
  const color = a?.color || "var(--color-border)";
  return `<span class="ghost-race-chip"><i style="background:${escapeHtml(color)}"></i>${escapeHtml(name)}${isNew ? " <em>neu</em>" : ""}</span>`;
}

function dayLine(who, day, future) {
  let body;
  if (future) body = `<span class="ghost-race-empty">kommt noch</span>`;
  else if (!day.count) body = `<span class="ghost-race-empty">nichts bewertet</span>`;
  else body = day.areas.map((a) => areaChip(a, day.newAreas.includes(a))).join("") || `<span class="ghost-race-empty">${day.count} bewertet</span>`;
  return `<div class="ghost-race-detail-row"><span class="ghost-race-who">${who}</span><span class="ghost-race-chips">${body}</span></div>`;
}

function renderDetail() {
  const detail = tile.el.querySelector("#ghost-race-detail");
  const i = tile.selDay;
  if (i == null) {
    detail.hidden = true;
    detail.innerHTML = "";
    return;
  }
  const { race } = tile;
  const future = i > race.dayIdx;
  detail.innerHTML =
    `<p class="ghost-race-detail-head">${DAYS_LONG[i]}</p>` +
    dayLine("du", race.cur[i], future) +
    (race.hasGhost ? dayLine("Geist", race.ghost[i], false) : "");
  detail.hidden = false;
}

// Funkenregen genau einmal je Überholen (Woche + Tag), nur auf Breite.
function maybeSparks() {
  const oi = overtakeDay(tile.race);
  if (oi == null) return;
  const key = `${tile.race.curStart}:${oi}`;
  if (lsGet(LS_SPARK) === key) return;
  lsSet(LS_SPARK, key);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  sparks(oi);
}

function sparks(dayIdx) {
  const canvas = tile.el.querySelector("#ghost-race-fx");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  const cs = getComputedStyle(document.documentElement);
  const colors = [cs.getPropertyValue("--color-accent-warm").trim(), cs.getPropertyValue("--color-accent").trim(), "#ffd877"];
  const { x, y, W, H } = tile.geo;
  // Die Leinwand ragt über die Strecke hinaus (Platz für die Funken), Ursprung daher über das SVG.
  const sr = tile.el.querySelector("#ghost-race-svg").getBoundingClientRect();
  const ox = sr.left - rect.left + (x(dayIdx) / W) * sr.width;
  const oy = sr.top - rect.top + (y(tile.race.cur[dayIdx].breite) / H) * sr.height;
  const ps = Array.from({ length: 40 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const s = 1 + Math.random() * 2.5;
    return { x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 30 + Math.random() * 25, c: colors[(Math.random() * 3) | 0], r: 1 + Math.random() * 1.4 };
  });
  let f = 0;
  (function tick() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    let alive = 0;
    ps.forEach((p) => {
      if (f > p.life) return;
      alive++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      ctx.globalAlpha = Math.max(0, 1 - f / p.life);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 7);
      ctx.fill();
    });
    f++;
    if (alive && canvas.isConnected) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, rect.width, rect.height);
  })();
}
