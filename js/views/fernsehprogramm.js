// Ansicht "Fernsehprogramm" (#/fernsehprogramm) inkl. Watchlist.
import { weekdayCodeFromIso } from "../habits.js";
import {
  listWatchlistItems,
  getWatchlistItem,
  createWatchlistItem,
  updateWatchlistItem,
  deleteWatchlistItem,
  listViewingLog,
  listAllViewingLogEntries,
  logViewing,
  deleteViewingLogEntry,
  getEffectiveDuration,
  computeAverageRating,
  filterWatchlistItems,
  // autoplanWatchlistForDates/applyWatchlistSwap (tasks-basierte Wochenbelegung) werden seit dem
  // Sender-Autopiloten (migration-036.sql, broadcast_program) nicht mehr importiert — bleiben in
  // js/watchlist.js samt Tests erhalten.
  listBroadcastProgram,
  listBroadcastSlots,
  listUpcomingWatchEvents,
  listInterestProfile,
  buildBroadcastWeek,
  logProgramSignal,
  rollingDates,
  weekStartsFor,
  timeToMinutes,
  findOnAirIndex,
  defaultOpenIndex,
  findDisplacedSlots,
  summarizeInterestProfile,
} from "../watchlist.js";
import { todayISO, formatShortDate } from "../ui/dates.js";
import { WEEKDAY_LABEL, escapeHtml } from "../ui/dom.js";
import { showToast, showConfirm, showLoading, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";

/* ---------- Fernsehprogramm ---------- */

const watchlistViewState = { items: [], logEntries: [] };

const WATCHLIST_TYPE_LABEL = { serie: "Serie", anime: "Anime", film: "Film", doku: "Doku", youtube: "YouTube" };

// Farbe + Icon pro Typ — für die farbige Typ-Badge und die Cover-Kachel der Aktiv-Karten. Farben aus
// bestehenden Tokens (kein neuer Palettenwildwuchs); YouTube bewusst danger-nah (Marken-Rot-Anmutung).
const WATCHLIST_TYPE_COLOR = {
  serie: "var(--color-accent)",
  anime: "var(--color-cat-gesundheit)",
  film: "var(--color-accent-warm)",
  doku: "var(--color-success)",
  youtube: "var(--color-danger)",
};
const WATCHLIST_TYPE_ICON = { serie: "📺", anime: "🌸", film: "🎬", doku: "🌍", youtube: "▶" };

function buildWatchlistTypeBadge(type) {
  const label = WATCHLIST_TYPE_LABEL[type] || type;
  return `<span class="wl-type-badge" style="--b:${WATCHLIST_TYPE_COLOR[type] || "var(--color-text-muted)"}">${label}</span>`;
}

// " · S1E4" wenn Staffel/Folge gepflegt sind (nur bei serie/anime relevant), sonst "".
export function buildCurrentEpisodeLabel(item) {
  if (!item || (item.current_season == null && item.current_episode == null)) return "";
  return ` · S${item.current_season ?? "?"}E${item.current_episode ?? "?"}`;
}

// Reichere Fortschrittszeile für die Aktiv-Karte: "Staffel S · Folge E von Y", wenn Staffel/Folge und
// die Folgenzahl der aktuellen Staffel (episode_counts_by_season) gepflegt sind — sonst Fallback auf
// buildCurrentEpisodeLabel (ohne führendes " · "). Siehe wissensdatenbank/features/
// watchlist-fernsehprogramm.md, "Automatische Metadaten-Anreicherung".
function buildEpisodeProgressLabel(item) {
  if (!item) return "";
  const counts = item.episode_counts_by_season;
  const total = counts && item.current_season != null ? counts[String(item.current_season)] : null;
  if (item.current_season != null && item.current_episode != null && total != null) {
    return `Staffel ${item.current_season} · Folge ${item.current_episode} von ${total}`;
  }
  return buildCurrentEpisodeLabel(item).replace(/^ · /, "");
}

// Staffelfinale erkannt, wenn die aktuelle Folge die letzte der aktuellen Staffel ist — verlangt
// gepflegte episode_counts_by_season (jsonb { "1":10, ... }). Ohne diese Daten kein Signal (kein
// Blocker, exakt wie buildEpisodeProgressBar). Siehe wissensdatenbank/features/
// watchlist-fernsehprogramm.md bzw. implementieren-jetzt.md ("Fernsehprogramm-Umbau").
function isSeasonFinale(item) {
  const counts = item && item.episode_counts_by_season;
  if (!counts || typeof counts !== "object" || item.current_season == null || item.current_episode == null) return false;
  const seasonTotal = counts[String(item.current_season)];
  if (seasonTotal == null) return false;
  return item.current_episode === Number(seasonTotal);
}

// Gesamt-Serienfortschritt als Balken: abgeschlossene Staffeln (voll) + aktuelle Folge, geteilt durch
// die Summe aller bekannten Staffel-Folgenzahlen. Nur wenn Staffel/Folge und episode_counts_by_season
// gepflegt sind — sonst leer (kein Balken).
function buildEpisodeProgressBar(item) {
  const counts = item && item.episode_counts_by_season;
  if (!counts || typeof counts !== "object" || item.current_season == null || item.current_episode == null) return "";
  const seasonTotal = counts[String(item.current_season)];
  if (seasonTotal == null) return "";
  let watched = 0;
  let total = 0;
  for (const [season, n] of Object.entries(counts)) {
    const num = Number(n) || 0;
    total += num;
    if (Number(season) < item.current_season) watched += num;
  }
  watched += Math.min(item.current_episode, Number(seasonTotal) || 0);
  if (total <= 0) return "";
  const pct = Math.min(100, Math.round((watched / total) * 100));
  return `<span class="watchlist-progress" aria-hidden="true" title="${watched} von ${total} Folgen"><span class="watchlist-progress-fill" style="width:${pct}%"></span></span>`;
}

// episode_counts_by_season (jsonb-Objekt { "1":10, "2":8 }) <-> Komma-Liste ("10, 8") fürs Textfeld.
// Nach Staffelnummer sortiert formatiert; leere/ungültige Eingabe -> null.
function formatEpisodeCounts(counts) {
  if (!counts || typeof counts !== "object") return "";
  const seasons = Object.keys(counts).map(Number).sort((a, b) => a - b);
  return seasons.map((s) => counts[String(s)]).join(", ");
}

function parseEpisodeCounts(text) {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const obj = {};
  parts.forEach((p, i) => {
    const n = Number(p);
    if (!Number.isNaN(n)) obj[String(i + 1)] = n;
  });
  return Object.keys(obj).length ? obj : null;
}
const WATCHLIST_STATUS_LABEL = {
  aktiv: "Aktiv",
  geplant: "Geplant",
  irgendwann: "Irgendwann",
  beendet: "Beendet",
  wartet_auf_neue_staffel: "Wartet auf neue Staffel",
};

// Programm-State des Sender-Autopiloten. selected bleibt über Re-Renders (nach einer Aktion) stehen,
// open = Index der aufgeklappten Zeile im gewählten Tag, menu = null | "more" | "rate".
const tvState = { dates: [], selected: null, entries: [], slots: [], events: [], profile: [], open: -1, menu: null };

const TV_SLOT_LABEL = {
  stamm: "Stamm",
  film: "Film",
  doku: "Doku",
  schnupper: "Schnupper",
  premiere: "Premiere",
  live: "Live",
  vorschau: "Vorschau",
  wiederholung: "Wiederholung",
};

export async function renderFernsehprogrammView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/fernsehprogramm.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  showLoading("tv-prog");

  // Seit 2026-10-04 (migration-036.sql) kommt das Programm aus broadcast_program, das
  // build_broadcast_week() serverseitig baut — die frühere tasks-basierte Wochenbelegung
  // (autoplanWatchlistForDates) läuft hier nicht mehr. Rollendes 7-Tage-Fenster statt Kalenderwoche,
  // siehe rollingDates() in js/watchlist.js.
  const today = todayISO();
  const dates = rollingDates(today);
  const [items, logEntries, entries, slots, events, profile] = await Promise.all([
    listWatchlistItems(),
    listAllViewingLogEntries(),
    listBroadcastProgram(dates[0], dates[dates.length - 1]),
    listBroadcastSlots(),
    listUpcomingWatchEvents(),
    listInterestProfile(),
  ]);
  if (myGeneration !== state.renderGeneration) return;
  watchlistViewState.items = items;
  watchlistViewState.logEntries = logEntries;
  Object.assign(tvState, { dates, entries, slots, events, profile, menu: null });
  if (!dates.includes(tvState.selected)) tvState.selected = today;
  tvState.open = defaultOpenIndex(tvEntriesForSelected(), tvItemsById(), tvState.selected === today, tvNowMinutes());

  renderTvWeek();
  renderTvProgram();
  renderTvUpcoming();
  renderTvLearn();
  wireTvRebuild();
  renderWatchlistOverview();
  wireWatchlistFilters();
  wireWatchlistQuickAddForm();
  wireWatchlistPanelToggle();
}

// Watchlist-Übersicht ist standardmäßig eingeklappt — beim Öffnen des Tabs soll nur das Programm
// direkt sichtbar sein, die volle Watchlist bleibt über den Toggle erreichbar.
function wireWatchlistPanelToggle() {
  const panel = document.getElementById("watchlist-panel");
  document.getElementById("watchlist-toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
}

function tvItemsById() {
  return new Map(watchlistViewState.items.map((i) => [i.id, i]));
}

function tvNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function tvEntriesForDate(date) {
  return tvState.entries.filter((e) => e.air_date === date);
}

function tvEntriesForSelected() {
  return tvEntriesForDate(tvState.selected);
}

function renderTvWeek() {
  const today = todayISO();
  const el = document.getElementById("tv-week");
  el.innerHTML = tvState.dates
    .map((date) => {
      const dots = tvEntriesForDate(date)
        .map((e) => `<i class="${e.status !== "geplant" ? "is-done" : ""}" style="--k:var(--k-${e.slot_kind})"></i>`)
        .join("");
      return `
        <button type="button" class="tv-day ${date === today ? "is-today" : ""}" role="tab" aria-selected="${date === tvState.selected}" data-date="${date}">
          <span class="tv-day-name">${WEEKDAY_LABEL[weekdayCodeFromIso(date)]}</span>
          <span class="tv-day-num">${Number(date.slice(8, 10))}</span>
          <span class="tv-dots">${dots}</span>
        </button>`;
    })
    .join("");
  el.querySelectorAll(".tv-day").forEach((btn) => {
    btn.addEventListener("click", () => {
      tvState.selected = btn.dataset.date;
      tvState.open = defaultOpenIndex(tvEntriesForSelected(), tvItemsById(), btn.dataset.date === todayISO(), tvNowMinutes());
      tvState.menu = null;
      renderTvWeek();
      renderTvProgram();
    });
  });
}

function tvEntryTitle(entry, item) {
  if (item) return item.title;
  return entry.event?.title || "Termin";
}

function tvEntryMeta(entry, item) {
  if (!item) return entry.event?.competition || TV_SLOT_LABEL[entry.slot_kind] || "";
  const parts = [WATCHLIST_TYPE_LABEL[item.type] || item.type];
  const episode = buildCurrentEpisodeLabel(item).replace(/^ · /, "");
  if (entry.slot_kind === "schnupper" && item.current_episode == null) parts.push("Folge 1");
  else if (episode) parts.push(episode);
  parts.push(`${getEffectiveDuration(item)} Min`);
  return parts.join(" · ");
}

function tvRightSide(entry, item, isOnAir) {
  if (isOnAir) return `<span class="tv-badge is-on-air">LÄUFT</span>`;
  if (entry.status === "gesehen") return `<span class="tv-state">✓</span>`;
  if (entry.status === "uebersprungen") return `<span class="tv-state">übersprungen</span>`;
  if (entry.status === "verdraengt") return `<span class="tv-state">verdrängt</span>`;
  if (entry.slot_kind === "live") return `<span class="tv-badge">LIVE</span>`;
  if (entry.slot_kind === "schnupper" || entry.slot_kind === "premiere") return `<span class="tv-badge">NEU</span>`;
  if (item && isSeasonFinale(item)) return `<span class="tv-badge" style="--k:var(--color-accent-warm)">FINALE</span>`;
  return "";
}

function tvActionsHtml(entry, item) {
  if (entry.slot_kind === "schnupper" && item) {
    return `
      <div class="tv-acts">
        <button type="button" class="tv-act is-green" data-act="sample_keep"><span class="tv-key"></span>👍 Weiterschauen</button>
        <button type="button" class="tv-act is-red" data-act="sample_drop"><span class="tv-key"></span>👎 Absetzen</button>
        <button type="button" class="tv-act is-more" data-act="more" aria-label="Mehr" aria-expanded="${tvState.menu !== null}">⋯</button>
      </div>`;
  }
  return `
    <div class="tv-acts">
      <button type="button" class="tv-act is-green" data-act="watched"><span class="tv-key"></span>Gesehen</button>
      <button type="button" class="tv-act is-red" data-act="skipped"><span class="tv-key"></span>Heute nicht</button>
      ${item ? `<button type="button" class="tv-act is-more" data-act="more" aria-label="Mehr" aria-expanded="${tvState.menu !== null}">⋯</button>` : ""}
    </div>`;
}

function tvMenuHtml(entry, item) {
  if (!item || !tvState.menu) return "";
  if (tvState.menu === "rate") {
    const chips = Array.from({ length: 10 }, (_, i) => `<button type="button" data-rate="${i + 1}">${i + 1}</button>`).join("");
    return `<div class="tv-menu"><div class="tv-rating" role="group" aria-label="Bewertung 1–10">${chips}</div></div>`;
  }
  const isSample = entry.slot_kind === "schnupper";
  return `
    <div class="tv-menu">
      ${isSample ? `<button type="button" class="tv-menu-btn" data-act="skipped">Heute nicht</button>` : ""}
      <button type="button" class="tv-menu-btn" data-act="rate">Gesehen und bewerten …</button>
      ${isSample ? "" : `<button type="button" class="tv-menu-btn" data-act="binged">🔥 Gebinged (mehrere Folgen am Stück)</button>`}
      ${isSample ? "" : `<button type="button" class="tv-menu-btn" data-act="abandoned">Abgebrochen</button>`}
      <button type="button" class="tv-menu-btn" data-act="detail">Details zur Sendung</button>
    </div>`;
}

function renderTvProgram() {
  const prog = document.getElementById("tv-prog");
  const empty = document.getElementById("tv-empty-state");
  const itemsById = tvItemsById();
  const entries = tvEntriesForSelected();
  const isToday = tvState.selected === todayISO();
  const nowMin = tvNowMinutes();
  const onAir = isToday ? findOnAirIndex(entries, itemsById, nowMin) : -1;

  const rows = entries.map((entry, idx) => {
    const item = entry.watchlist_item_id ? itemsById.get(entry.watchlist_item_id) : null;
    const isOpen = idx === tvState.open && entry.status === "geplant";
    const isOnAir = idx === onAir;
    let progress = "";
    if (isOnAir) {
      const start = timeToMinutes(entry.start_time);
      const duration = item ? getEffectiveDuration(item) : 120;
      const pct = Math.min(100, Math.round(((nowMin - start) / duration) * 100));
      progress = `<span class="tv-onair-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
    }
    const why = entry.reason && (isOpen || isOnAir) ? `<span class="tv-why">${escapeHtml(entry.reason)}</span>` : "";
    return {
      minutes: timeToMinutes(entry.start_time),
      html: `
        <div class="tv-row ${isOnAir ? "is-on-air" : ""} ${entry.status !== "geplant" ? "is-done" : ""}" style="--k:var(--k-${entry.slot_kind})">
          <button type="button" class="tv-row-main" data-idx="${idx}" aria-expanded="${isOpen}">
            <span class="tv-time">${entry.start_time.slice(0, 5)}</span>
            <span>
              <span class="tv-title">${escapeHtml(tvEntryTitle(entry, item))}</span>
              <span class="tv-meta">${escapeHtml(tvEntryMeta(entry, item))}</span>
              ${why}
            </span>
            ${tvRightSide(entry, item, isOnAir)}
          </button>
          ${progress}
          ${isOpen ? tvActionsHtml(entry, item) + tvMenuHtml(entry, item) : ""}
        </div>`,
    };
  });

  // Verdrängte Slots als gestrichelte Platzhalter einsortieren, damit eine Lücke erklärt ist.
  for (const { slot, blocker } of findDisplacedSlots(tvState.slots, entries, tvState.selected)) {
    const blockerTitle = tvEntryTitle(blocker, blocker.watchlist_item_id ? itemsById.get(blocker.watchlist_item_id) : null);
    rows.push({
      minutes: timeToMinutes(slot.start_time),
      html: `
        <div class="tv-row is-displaced" style="--k:var(--k-${slot.slot_kind})">
          <div class="tv-row-main">
            <span class="tv-time">${slot.start_time.slice(0, 5)}</span>
            <span>
              <span class="tv-title">${escapeHtml(slot.slot_name)}</span>
              <span class="tv-meta">verdrängt durch ${escapeHtml(blockerTitle)}</span>
            </span>
            <span></span>
          </div>
        </div>`,
    });
  }
  rows.sort((a, b) => a.minutes - b.minutes);
  prog.innerHTML = rows.map((r) => r.html).join("");

  // Leerer Tag: Wenn im ganzen Fenster noch kein Programm existiert (frisch eingerichtet oder Cron
  // noch nicht gelaufen), direkt "Programm erstellen" anbieten statt nur "Sendepause".
  const windowEmpty = tvState.entries.length === 0;
  empty.hidden = rows.length > 0;
  document.getElementById("tv-empty-title").textContent = windowEmpty ? "Noch kein Programm" : "Sendepause";
  document.getElementById("tv-empty-text").textContent = windowEmpty
    ? tvState.slots.length === 0
      ? "Es gibt noch kein Sendeschema (broadcast_slots)."
      : "Der Autopilot baut es sonntags automatisch — oder jetzt sofort."
    : "Für diesen Tag ist nichts eingeplant.";
  const buildBtn = document.getElementById("tv-build");
  buildBtn.hidden = !(windowEmpty && tvState.slots.length > 0);
  buildBtn.onclick = () => rebuildTvProgram();

  prog.querySelectorAll(".tv-row-main[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      tvState.open = tvState.open === idx ? -1 : idx;
      tvState.menu = null;
      renderTvProgram();
    });
  });
  prog.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => handleTvAction(btn.dataset.act));
  });
  prog.querySelectorAll("[data-rate]").forEach((btn) => {
    btn.addEventListener("click", () => handleTvAction("watched", Number(btn.dataset.rate)));
  });
}

const TV_ACTION_TOAST = {
  watched: (t) => `✓ ${t} gesehen`,
  skipped: (t) => `${t} übersprungen`,
  binged: (t) => `🔥 ${t} gebinged`,
  abandoned: (t) => `${t} abgebrochen`,
  sample_keep: (t) => `👍 ${t} ist jetzt aktiv`,
  sample_drop: (t) => `👎 ${t} abgesetzt`,
};

async function handleTvAction(act, rating = null) {
  const entries = tvEntriesForSelected();
  const entry = entries[tvState.open];
  if (!entry) return;
  const item = entry.watchlist_item_id ? tvItemsById().get(entry.watchlist_item_id) : null;

  if (act === "more") {
    tvState.menu = tvState.menu ? null : "more";
    return renderTvProgram();
  }
  if (act === "rate") {
    tvState.menu = "rate";
    return renderTvProgram();
  }
  if (act === "detail") {
    if (item) await openWatchlistDetail(item.id);
    return;
  }

  await withErrorToast(async () => {
    await logProgramSignal({ entry, item, kind: act, rating });
    const title = tvEntryTitle(entry, item);
    let message = TV_ACTION_TOAST[act](title);
    // Komfortzonen-Regel aus watch_learn_from_log: Selbst Eingetragenes wird durchs Überspringen
    // nicht abgewertet — das einmal sichtbar machen, damit "Heute nicht" sich nicht wie Strafe anfühlt.
    if (act === "skipped" && item?.source === "selbst") message += " – wird nicht abgewertet";
    showToast(message);
    await renderFernsehprogrammView();
  });
}

function renderTvUpcoming() {
  const wrap = document.getElementById("tv-upcoming");
  const strip = document.getElementById("tv-upcoming-strip");
  const today = todayISO();
  // Termine aus watch_events plus Staffelstarts, die nur als next_season_release_date am Item hängen.
  const chips = tvState.events.map((ev) => {
    const d = new Date(ev.starts_at);
    const dayLabel = WEEKDAY_LABEL[weekdayCodeFromIso(isoFromDate(d))];
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const kind = ev.kind === "sport" ? "live" : ev.kind === "release" ? "premiere" : ev.kind === "trailer" ? "vorschau" : ev.kind;
    const badge = { live: "LIVE", premiere: "NEU", vorschau: "▶" }[kind] || "";
    return { at: d.getTime(), html: `<span class="tv-chip"><span class="tv-mono">${dayLabel} ${time}</span>${badge ? `<span class="tv-badge" style="--k:var(--k-${kind})">${badge}</span>` : ""}${escapeHtml(ev.title)}</span>` };
  });
  for (const item of watchlistViewState.items) {
    const date = item.next_season_release_date;
    if (!date || date <= today || daysBetween(today, date) > 30) continue;
    if (tvState.events.some((ev) => ev.watchlist_item_id === item.id)) continue;
    chips.push({
      at: new Date(date + "T00:00:00").getTime(),
      html: `<span class="tv-chip"><span class="tv-mono">${WEEKDAY_LABEL[weekdayCodeFromIso(date)]} ${Number(date.slice(8, 10))}.</span><span class="tv-badge" style="--k:var(--k-premiere)">NEU</span>${escapeHtml(item.title)}</span>`,
    });
  }
  chips.sort((a, b) => a.at - b.at);
  wrap.hidden = chips.length === 0;
  strip.innerHTML = chips.map((c) => c.html).join("");
}

function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + "T00:00:00") - new Date(fromIso + "T00:00:00")) / 86400000);
}

function renderTvLearn() {
  const btn = document.getElementById("tv-learn");
  const sum = document.getElementById("tv-learn-sum");
  const bars = document.getElementById("tv-learn-bars");
  const { up, down, all } = summarizeInterestProfile(tvState.profile);

  if (all.length === 0) {
    sum.textContent = "noch keine Signale";
    bars.innerHTML = `<span class="tv-learn-note">Jedes ✓, 👍/👎 und „Heute nicht“ formt dein Profil. Selbst Eingetragenes wird durchs Überspringen nie abgewertet.</span>`;
  } else {
    const label = (r) => escapeHtml(WATCHLIST_TYPE_LABEL[r.value] || r.value);
    sum.innerHTML = [
      up.length ? `<b class="tv-up">▲</b> ${up.map(label).join(" · ")}` : "",
      down.length ? `<b class="tv-down">▼</b> ${down.map(label).join(" · ")}` : "",
    ].filter(Boolean).join("&nbsp;&nbsp;");
    const top = all.slice(0, 6).concat(all.slice(6).filter((r) => Number(r.weight) < 0).slice(-2));
    const max = Math.max(...top.map((r) => Math.abs(Number(r.weight))), 1);
    bars.innerHTML =
      top
        .map((r) => {
          const w = Number(r.weight);
          const pct = (Math.abs(w) / max) * 50;
          const style = `left:${w >= 0 ? 50 : 50 - pct}%;width:${pct}%;background:var(${w >= 0 ? "--color-success" : "--color-danger"})`;
          return `<span class="tv-bar"><span>${label(r)}</span><span class="tv-bar-track"><i style="${style}"></i></span><span class="tv-bar-val">${w > 0 ? "+" : ""}${w.toFixed(1)}</span></span>`;
        })
        .join("") + `<span class="tv-learn-note">Selbst Eingetragenes wird durchs Überspringen nie abgewertet.</span>`;
  }
  btn.addEventListener("click", () => {
    bars.hidden = !bars.hidden;
    btn.setAttribute("aria-expanded", String(!bars.hidden));
  });
}

function wireTvRebuild() {
  document.getElementById("tv-rebuild").addEventListener("click", () => {
    if (!confirm("Programm neu mischen? Bereits Gesehenes bleibt, alles noch Geplante wird neu verteilt.")) return;
    rebuildTvProgram();
  });
}

// build_broadcast_week baut wochenweise (Mo-Start) — das rollende Fenster kann zwei Wochen berühren.
async function rebuildTvProgram() {
  await withErrorToast(async () => {
    let count = 0;
    for (const weekStart of weekStartsFor(tvState.dates)) count += await buildBroadcastWeek(weekStart);
    showToast(count > 0 ? `Programm steht: ${count} Sendungen` : "Nichts zum Einplanen gefunden");
    await renderFernsehprogrammView();
  });
}

const RATING_STAR_PATH =
  "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z";

// Skala ist 1-10 (siehe computeAverageRating in js/watchlist.js) — hier auf 5 Sterne in
// 0,5er-Schritten gerundet, damit "gut bewertet" beim Überfliegen mehrerer Einträge auf einen
// Blick auffällt, statt jede Zahl einzeln lesen zu müssen. Die Ø-Zahl bleibt als Beleg daneben.
function buildRatingStarsHtml(avg) {
  if (avg == null) return `<span class="rating-num">—</span>`;
  const star = (cls) => `<svg class="${cls}" viewBox="0 0 24 24"><path d="${RATING_STAR_PATH}"/></svg>`;
  const scaled = Math.round((avg / 2) * 2) / 2;
  const full = Math.floor(scaled);
  const half = scaled - full === 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  const starsHtml = star("filled").repeat(full) + (half ? star("half") : "") + star("empty").repeat(empty);
  return `<span class="rating-stars">${starsHtml}</span><span class="rating-num">${avg.toFixed(1)}</span>`;
}

function computeAvgRatingByItemId() {
  const avgByItemId = {};
  for (const item of watchlistViewState.items) {
    const entries = watchlistViewState.logEntries.filter((e) => e.watchlist_item_id === item.id);
    avgByItemId[item.id] = computeAverageRating(entries);
  }
  return avgByItemId;
}

// Filter-Auswahl liegt in einem eigenen State statt in <select>.value — die Filter sind jetzt
// mobil-taugliche Chips (Toggle, erneuter Klug hebt auf → leer = "alle"), siehe wissensdatenbank/
// features/watchlist-fernsehprogramm.md, "Layout-Zielbild" (War Room 2026-07-25).
const watchlistFilterState = { type: "", minRating: "", genre: "", title: "" };

// Feste Gruppen-Reihenfolge nach status. Leere Gruppen werden nicht gerendert (status ist immer
// gesetzt, DB-Default 'geplant' — kein "ohne Status"-Fall).
const WATCHLIST_STATUS_GROUPS = [
  { key: "aktiv", label: "Aktiv", statuses: ["aktiv"], rich: true, collapsible: false },
  { key: "warteschlange", label: "Warteschlange", statuses: ["geplant", "irgendwann"], rich: false, collapsible: true },
  { key: "abgeschlossen", label: "Abgeschlossen", statuses: ["beendet", "wartet_auf_neue_staffel"], rich: false, collapsible: false },
];

// Aktiv-Eintrag = reichere Karte: Titel, Fortschritt (buildCurrentEpisodeLabel als Fallback — die
// Metadaten-Anreicherung "Folge X von Y" existiert noch nicht), Plattform, Ø-Rating.
function buildWatchlistActiveCard(item, avg) {
  const card = document.createElement("div");
  card.className = "watchlist-active-card";
  const meta = [];
  const episode = buildEpisodeProgressLabel(item);
  if (episode) meta.push(episode);
  if (item.platform) meta.push(escapeHtml(item.platform));
  card.innerHTML =
    `<div class="watchlist-cover" style="--b:${WATCHLIST_TYPE_COLOR[item.type] || "var(--color-accent)"}" aria-hidden="true">${WATCHLIST_TYPE_ICON[item.type] || "📺"}</div>` +
    `<div class="watchlist-active-body">` +
    `<div class="watchlist-active-top"><span class="task-title">${escapeHtml(item.title)}</span>${buildRatingStarsHtml(avg)}</div>` +
    `<div class="watchlist-active-meta">${buildWatchlistTypeBadge(item.type)}${isSeasonFinale(item) ? `<span class="watchlist-finale-badge">🏁 Staffelfinale</span>` : ""}${meta.length ? `<span>${meta.join(" · ")}</span>` : ""}</div>` +
    buildEpisodeProgressBar(item) +
    `</div>`;
  card.addEventListener("click", () => openWatchlistDetail(item.id));
  return card;
}

function buildWatchlistSlimRow(item, avg) {
  const li = document.createElement("li");
  li.className = "rating-row";
  li.innerHTML = `<span class="task-title">${buildWatchlistTypeBadge(item.type)}${escapeHtml(item.title)}${buildCurrentEpisodeLabel(item)}</span>${buildRatingStarsHtml(avg)}`;
  li.addEventListener("click", () => openWatchlistDetail(item.id));
  return li;
}

function renderWatchlistOverview() {
  const container = document.getElementById("watchlist-overview");
  const emptyState = document.getElementById("watchlist-overview-empty-state");

  if (watchlistViewState.items.length === 0) {
    emptyState.hidden = false;
    container.innerHTML = "";
    updateWatchlistFilterCount();
    return;
  }
  emptyState.hidden = true;
  updateWatchlistFilterCount();

  const avgByItemId = computeAvgRatingByItemId();
  const filtered = filterWatchlistItems(
    watchlistViewState.items,
    {
      type: watchlistFilterState.type || undefined,
      minAvgRating: watchlistFilterState.minRating ? Number(watchlistFilterState.minRating) : undefined,
    },
    avgByItemId
  );
  // Genre bewusst als Teilstring-Suche (nicht filterWatchlistItems' exakter Tag-Match) — Genres sind
  // frei eingegebene Tags.
  const genre = watchlistFilterState.genre.trim().toLowerCase();
  const genreFiltered = genre ? filtered.filter((i) => i.genres?.some((g) => g.toLowerCase().includes(genre))) : filtered;
  const title = watchlistFilterState.title.trim().toLowerCase();
  const items = title ? genreFiltered.filter((i) => i.title?.toLowerCase().includes(title)) : genreFiltered;

  container.innerHTML = "";
  if (items.length === 0) {
    const note = document.createElement("p");
    note.className = "kanban-empty";
    note.textContent = "Keine Treffer für die aktuellen Filter.";
    container.appendChild(note);
    return;
  }

  for (const group of WATCHLIST_STATUS_GROUPS) {
    const groupItems = items.filter((i) => group.statuses.includes(i.status));
    if (groupItems.length === 0) continue; // leere Gruppen nicht rendern

    const section = document.createElement("section");
    section.className = "watchlist-group";
    const header = document.createElement("div");
    header.className = "watchlist-group-header";
    header.innerHTML = `<span class="watchlist-group-title">${group.label}</span><span class="count">${groupItems.length}</span>`;
    section.appendChild(header);

    const body = document.createElement("div");
    body.className = "watchlist-group-body";

    const appendItems = (list) => {
      for (const item of list) {
        body.appendChild(group.rich ? buildWatchlistActiveCard(item, avgByItemId[item.id]) : buildWatchlistSlimRow(item, avgByItemId[item.id]));
      }
    };

    // Warteschlange: erste 5 + "+N weitere" (bisheriges Verhalten, jetzt gruppen-lokal).
    if (group.collapsible && groupItems.length > 5) {
      appendItems(groupItems.slice(0, 5));
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "events-widget-more";
      moreBtn.textContent = `+${groupItems.length - 5} weitere`;
      moreBtn.addEventListener("click", () => {
        body.innerHTML = "";
        appendItems(groupItems);
        moreBtn.remove();
      });
      section.appendChild(body);
      section.appendChild(moreBtn);
    } else {
      appendItems(groupItems);
      section.appendChild(body);
    }
    container.appendChild(section);
  }
}

function updateWatchlistFilterCount() {
  const badge = document.getElementById("watchlist-filter-count");
  if (!badge) return;
  const count = [watchlistFilterState.type, watchlistFilterState.minRating, watchlistFilterState.genre, watchlistFilterState.title].filter(Boolean).length;
  badge.hidden = count === 0;
  badge.textContent = String(count);
}

function wireWatchlistFilters() {
  const toggleBtn = document.getElementById("watchlist-filter-toggle");
  const filterBar = document.getElementById("watchlist-filter-bar");
  toggleBtn.addEventListener("click", () => {
    const open = filterBar.hidden;
    filterBar.hidden = !open;
    toggleBtn.setAttribute("aria-expanded", String(open));
  });

  // Typ-/Rating-Chips: Einzelauswahl mit Toggle (erneuter Klick auf den aktiven Chip → "alle").
  const wireChipGroup = (groupId, dataAttr, stateKey) => {
    const group = document.getElementById(groupId);
    group.addEventListener("click", (e) => {
      const chip = e.target.closest(".pot-chip");
      if (!chip) return;
      const value = chip.dataset[dataAttr];
      watchlistFilterState[stateKey] = watchlistFilterState[stateKey] === value ? "" : value;
      group.querySelectorAll(".pot-chip").forEach((c) => {
        c.dataset.active = String(c.dataset[dataAttr] === watchlistFilterState[stateKey]);
      });
      renderWatchlistOverview();
    });
  };
  wireChipGroup("watchlist-filter-type", "type", "type");
  wireChipGroup("watchlist-filter-rating", "rating", "minRating");

  const genreInput = document.getElementById("watchlist-filter-genre");
  genreInput.addEventListener("input", () => {
    watchlistFilterState.genre = genreInput.value;
    renderWatchlistOverview();
  });

  const titleInput = document.getElementById("watchlist-filter-title");
  titleInput.addEventListener("input", () => {
    watchlistFilterState.title = titleInput.value;
    renderWatchlistOverview();
  });
}

function wireWatchlistQuickAddForm() {
  const toggleBtn = document.getElementById("watchlist-quick-add-toggle");
  const form = document.getElementById("watchlist-quick-form");
  const titleInput = document.getElementById("watchlist-quick-title");
  const typeSelect = document.getElementById("watchlist-quick-type");
  const cancelBtn = document.getElementById("watchlist-quick-cancel");

  const closeForm = () => {
    form.hidden = true;
    form.reset();
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      titleInput.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    await withErrorToast(async () => {
      await createWatchlistItem({ title, type: typeSelect.value });
      closeForm();
      await renderFernsehprogrammView();
    });
  });
}

// ----- Watchlist-Detail (Modal) -----

async function openWatchlistDetail(itemId) {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    state.closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = close;

  root.innerHTML = `
    <div class="modal-backdrop" id="watchlist-detail-backdrop">
      <div class="modal-card" id="watchlist-detail-card" role="dialog" aria-modal="true" aria-label="Watchlist-Eintrag"></div>
    </div>`;
  document.getElementById("watchlist-detail-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "watchlist-detail-backdrop") close();
  });

  await renderWatchlistDetailCard(itemId, close);
}

async function renderWatchlistDetailCard(itemId, close) {
  const [item, log] = await Promise.all([getWatchlistItem(itemId), listViewingLog(itemId)]);
  const card = document.getElementById("watchlist-detail-card");
  if (!item || !card) {
    close();
    return;
  }

  const avg = computeAverageRating(log);
  const logHtml = log.length
    ? log
        .map((entry) => {
          const ratingIcon = entry.rating != null ? `${entry.rating}/10` : "übersprungen";
          const epLabel = entry.season != null || entry.episode != null ? `S${entry.season ?? "?"}E${entry.episode ?? "?"} · ` : "";
          return `
          <li class="task-item">
            <span class="task-title">${epLabel}${ratingIcon} · ${formatShortDate(entry.watched_at.slice(0, 10))}</span>
            <button type="button" class="icon-btn icon-btn-danger watchlist-log-delete" data-log-id="${entry.id}" aria-label="Sichtung löschen">×</button>
          </li>`;
        })
        .join("")
    : `<div class="empty-state-rich"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><strong>Noch keine Sichtung</strong><span>Logge unten die erste Folge oder Sitzung.</span></div>`;

  card.innerHTML = `
    <h2 class="modal-view-title">${escapeHtml(item.title)}</h2>
    <p class="status-message">Ø Bewertung: ${buildRatingStarsHtml(avg)}</p>

    <label class="modal-label">Titel
      <input type="text" class="input" id="wd-title" value="${escapeHtml(item.title)}" />
    </label>
    <label class="modal-label">Typ
      <select class="select" id="wd-type">
        ${Object.entries(WATCHLIST_TYPE_LABEL)
          .map(([v, l]) => `<option value="${v}" ${item.type === v ? "selected" : ""}>${l}</option>`)
          .join("")}
      </select>
    </label>
    <label class="modal-label">Status
      <select class="select" id="wd-status">
        ${Object.entries(WATCHLIST_STATUS_LABEL)
          .map(([v, l]) => `<option value="${v}" ${item.status === v ? "selected" : ""}>${l}</option>`)
          .join("")}
      </select>
    </label>
    <label class="modal-label">Genres (Komma-getrennt)
      <input type="text" class="input" id="wd-genres" value="${escapeHtml((item.genres || []).join(", "))}" />
    </label>
    <label class="modal-label">Plattform
      <input type="text" class="input" id="wd-platform" value="${escapeHtml(item.platform || "")}" />
    </label>
    <label class="modal-label">Dauer-Override in Min. (leer = Typ-Standard, ${getEffectiveDuration({ type: item.type, duration_minutes: null })} Min.)
      <input type="number" class="input" id="wd-duration" value="${item.duration_minutes ?? ""}" min="1" />
    </label>
    <label class="modal-label">Staffel
      <input type="number" class="input" id="wd-season" value="${item.current_season ?? ""}" min="1" />
    </label>
    <label class="modal-label">Folge
      <input type="number" class="input" id="wd-episode" value="${item.current_episode ?? ""}" min="1" />
    </label>
    <label class="modal-label">Staffeln gesamt
      <input type="number" class="input" id="wd-season-count" value="${item.season_count ?? ""}" min="1" />
    </label>
    <label class="modal-label">Folgen je Staffel (Komma-getrennt, z.B. 10, 8, 12)
      <input type="text" class="input" id="wd-episode-counts" value="${escapeHtml(formatEpisodeCounts(item.episode_counts_by_season))}" />
    </label>
    <label class="modal-label">Release-Termin nächste Staffel
      <input type="date" class="input" id="wd-release-date" value="${item.next_season_release_date || ""}" />
    </label>

    <div class="modal-actions">
      <button class="btn" type="button" id="wd-save">Speichern</button>
      <button class="btn btn-secondary" type="button" id="wd-close">Schließen</button>
    </div>

    <h3>Episodenguide</h3>
    <ul class="task-list" id="wd-log-list">${logHtml}</ul>

    <button class="btn" type="button" id="wd-delete" style="background:var(--color-danger)">Eintrag löschen</button>
  `;

  document.getElementById("wd-close").addEventListener("click", close);

  document.getElementById("wd-save").addEventListener("click", async () => {
    const genres = document
      .getElementById("wd-genres")
      .value.split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    const durationRaw = document.getElementById("wd-duration").value;
    const seasonRaw = document.getElementById("wd-season").value;
    const episodeRaw = document.getElementById("wd-episode").value;
    const seasonCountRaw = document.getElementById("wd-season-count").value;
    const episodeCounts = parseEpisodeCounts(document.getElementById("wd-episode-counts").value);
    await withErrorToast(async () => {
      await updateWatchlistItem(item.id, {
        title: document.getElementById("wd-title").value.trim() || item.title,
        type: document.getElementById("wd-type").value,
        status: document.getElementById("wd-status").value,
        genres,
        platform: document.getElementById("wd-platform").value.trim() || null,
        duration_minutes: durationRaw ? Number(durationRaw) : null,
        current_season: seasonRaw ? Number(seasonRaw) : null,
        current_episode: episodeRaw ? Number(episodeRaw) : null,
        season_count: seasonCountRaw ? Number(seasonCountRaw) : null,
        episode_counts_by_season: episodeCounts,
        next_season_release_date: document.getElementById("wd-release-date").value || null,
      });
      showToast("Gespeichert.");
      close();
      await renderFernsehprogrammView();
    });
  });

  document.getElementById("wd-delete").addEventListener("click", async () => {
    const ok = await showConfirm(
      `„${item.title}" wirklich löschen? Das entfernt auch alle geloggten Sichtungen und geplanten Fernsehprogramm-Termine.`,
      { confirmLabel: "Löschen", danger: true }
    );
    if (!ok) return;
    await withErrorToast(async () => {
      await deleteWatchlistItem(item.id);
      close();
      await renderFernsehprogrammView();
    });
  });

  card.querySelectorAll(".watchlist-log-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await withErrorToast(async () => {
        await deleteViewingLogEntry(btn.dataset.logId);
        await renderWatchlistDetailCard(itemId, close);
      });
    });
  });
}

// Öffnet direkt beim Abhaken einer Watchlist-Aufgabe ein kleines 1-10-Bewertungs-Popup (plus
// "Überspringen"). Loggt die Sichtung immer (auch bei Überspringen, rating bleibt dann null) und rückt bei
// Serien/Anime current_episode automatisch eine Folge weiter — einfache v1-Warteschlangenlogik
// ohne Staffel-Rollover, der bleibt manuell über next_season_release_date (siehe Plan). Gibt die
// neue Log-Zeilen-ID zurück, damit showCompleteUndoToast sie bei Rückgängig mit entfernen kann.
export async function promptWatchlistRating(task) {
  const item = task.watchlist_item_id ? await getWatchlistItem(task.watchlist_item_id) : null;
  if (!item) return null;

  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    document.body.style.overflow = "hidden";

    const close = (logId) => {
      root.innerHTML = "";
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
      state.closeActiveModal = null;
      resolve(logId);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") submit(null);
    };
    document.addEventListener("keydown", onKeydown);
    state.closeActiveModal = () => close(null);

    const submit = async (rating) => {
      const logRow = await logViewing({
        watchlistItemId: item.id,
        rating,
        season: item.current_season,
        episode: item.current_episode,
      });
      // Neu angelegte Items starten mit current_episode=null (kein Default beim Anlegen) — die
      // erste Sichtung soll den Auto-Fortschritt trotzdem anstoßen statt still zu bleiben, bis der
      // Nutzer manuell eine Startfolge im Bearbeiten-Modal einträgt.
      if (!["film", "doku", "youtube"].includes(item.type)) {
        await updateWatchlistItem(item.id, { current_episode: (item.current_episode ?? 0) + 1 });
      }
      close(logRow.id);
    };

    // Eigener Pfad statt submit(null): loggt kind="skipped" (keine echte Sichtung) und lässt
    // current_episode unangetastet — anders als "Überspringen" (Bewertung übersprungen, aber
    // tatsächlich geschaut, kind bleibt "watched").
    const submitNotWatched = async () => {
      const logRow = await logViewing({
        watchlistItemId: item.id,
        rating: null,
        season: item.current_season,
        episode: item.current_episode,
        kind: "skipped",
      });
      close(logRow.id);
    };

    const ratingChipsHtml = Array.from(
      { length: 10 },
      (_, i) => `<button type="button" class="effort-chip" data-rating="${i + 1}">${i + 1}</button>`
    ).join("");

    root.innerHTML = `
      <div class="modal-backdrop" id="rating-backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Bewertung">
          <h2 class="modal-view-title">„${escapeHtml(item.title)}" geschaut — wie war's?</h2>
          <div class="effort-chips" id="rating-chips" role="group" aria-label="Bewertung 1-10">${ratingChipsHtml}</div>
          <button class="btn btn-secondary" type="button" id="rating-skip">Überspringen</button>
          <button class="btn btn-secondary" type="button" id="rating-not-watched">Nicht geschaut</button>
        </div>
      </div>`;
    document.getElementById("rating-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "rating-backdrop") submit(null);
    });
    document.getElementById("rating-chips").addEventListener("click", (e) => {
      const chip = e.target.closest(".effort-chip");
      if (chip) submit(Number(chip.dataset.rating));
    });
    document.getElementById("rating-skip").addEventListener("click", () => submit(null));
    document.getElementById("rating-not-watched").addEventListener("click", () => submitNotWatched());
  });
}
