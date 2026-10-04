// Ansicht "Cockpit" (#/cockpit).
import { listTasks } from "../tasks.js";
import { listAreas } from "../areas.js";
import { listThoughts, updateThought } from "../thoughts.js";
import { listTransactions } from "../finance.js";
import { listHabitsForToday, listHabitCompletionsSince } from "../habits.js";
import {
  INSIGHT_WINDOW_DAYS,
  listReflectionsSince,
  listTaskFeedbackSince,
  shiftIsoDate,
  buildMoodStrip,
  averageMood,
  averageRatingByArea,
  moodByHabitDays,
} from "../insights.js";
import { listWatchlistItems, isWatchlistTask, listBroadcastProgram, defaultOpenIndex } from "../watchlist.js";
import { listPantryItems } from "../pantry.js";
import { listGames } from "../games.js";
import { listOpenFollowupGroups, countOpenFollowups } from "../followups.js";
import { todayISO } from "../ui/dates.js";
import { escapeHtml } from "../ui/dom.js";
import { withErrorToast } from "../ui/modals.js";
import { openFollowupPopup } from "../ui/popups.js";
import { state } from "../ui/state.js";
import { buildCurrentEpisodeLabel } from "./fernsehprogramm.js";
import { pantryExpiryStatus } from "./kuehlschrank.js";

/* ---------- Cockpit ---------- */

// Ruhige Kachel-Eingangs-Ebene (wissensdatenbank/features/bento-os-vision.md, Bau-Schritt 2). V1:
// read-only, EIN Blick pro Kachel, Klick springt in den jeweiligen Tab. Nur auf heute vorhandenen
// Daten (Habits/Tasks/Watchlist/Gaming). Bewusst kein Default-Landing — hängt vorerst im "Mehr"-
// Menü, kann später via MORE_ROUTES/currentRoute nach vorne gezogen werden.
export async function renderCockpitView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/cockpit.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();

  const today = todayISO();
  // Gezielte Abfragen statt listTasks()/listTransactions() ohne Filter — sonst wächst die Ladezeit des
  // Cockpits mit der gesamten Historie, obwohl nur heute bzw. der laufende Monat angezeigt wird.
  const monthIso = today.slice(0, 7);
  const insightFrom = shiftIsoDate(today, -(INSIGHT_WINDOW_DAYS - 1));
  const [
    todayTasks,
    habitTasks,
    recentCompletions,
    reflections,
    feedback,
    areas,
    games,
    watchlistItems,
    transactions,
    pantryItems,
    todayProgram,
  ] =
    await Promise.all([
      listTasks({ plannedDate: today }),
      listTasks({ isHabit: true }),
      listHabitCompletionsSince(insightFrom),
      listReflectionsSince(insightFrom).catch(() => []),
      listTaskFeedbackSince(insightFrom).catch(() => []),
      listAreas(),
      listGames(),
      listWatchlistItems(),
      listTransactions({ from: `${monthIso}-01` }),
      listPantryItems(),
      listBroadcastProgram(today, today),
    ]);
  if (myGeneration !== state.renderGeneration) return;

  // Habits: heute fällig + wie viele davon schon erledigt (über habit_completions, nicht tasks.status).
  const dueHabits = listHabitsForToday(habitTasks, recentCompletions, today);

  // Aufgaben: offen heute (Top-Level, ohne Watchlist-Zeilen).
  const openTodayTasks = todayTasks.filter(
    (t) => t.planned_date === today && t.status !== "done" && !t.parent_task_id && !isWatchlistTask(t)
  );
  const openToday = openTodayTasks.length;
  const tasksGlance = openToday ? `${openToday} offen` : "alles erledigt";
  // Nächste Aufgabe für die Subzeile: Priorität absteigend, bei Gleichstand ältere zuerst — spiegelt
  // byPriorityThenAge aus planner.js (dort nicht exportiert, darum hier klein inline).
  const priorityRank = { high: 2, medium: 1, low: 0 };
  const nextTask = [...openTodayTasks].sort(
    (a, b) =>
      (priorityRank[b.priority] ?? 1) - (priorityRank[a.priority] ?? 1) ||
      new Date(a.created_at) - new Date(b.created_at)
  )[0];

  // Watchlist: laufende bzw. nächste offene Sendung aus dem heutigen broadcast_program, sonst "—".
  const itemsById = new Map(watchlistItems.map((i) => [i.id, i]));
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const watchIdx = defaultOpenIndex(todayProgram, itemsById, true, nowMinutes);
  const todayWatch = watchIdx !== -1 ? todayProgram[watchIdx] : null;
  const watchItem = todayWatch?.watchlist_item_id ? itemsById.get(todayWatch.watchlist_item_id) : null;
  const watchGlance = todayWatch
    ? `${todayWatch.start_time.slice(0, 5)} ${watchItem ? watchItem.title : todayWatch.event?.title ?? "Termin"}${buildCurrentEpisodeLabel(watchItem)}`
    : "—";

  // Gaming: aktuell gespieltes Spiel, sonst "—".
  const playing = games.find((g) => g.status === "playing");
  const gamingGlance = playing ? playing.title : "—";

  // Finanzen: Summe der Ausgaben im laufenden Kalendermonat — leichtgewichtiger Glance ohne die
  // volle Topf-/Budget-Logik des Finanzen-Tabs (die bleibt Quelle der Wahrheit dort).
  const monthExpenses = transactions
    .filter((t) => t.direction === "expense" && typeof t.occurred_at === "string" && t.occurred_at.slice(0, 7) === monthIso)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const financeGlance = `${monthExpenses.toFixed(0)} € diesen Monat`;

  // Kühlschrank: kritische Zutaten (abgelaufen oder läuft bald ab) haben Vorrang vor der reinen
  // Bestandszahl — das ist der eigentlich handlungsrelevante Blick.
  const pantryCritical = pantryItems.filter((p) => pantryExpiryStatus(p.expires_at, today)).length;
  const pantryGlance = pantryCritical
    ? `${pantryCritical} ${pantryCritical === 1 ? "läuft" : "laufen"} bald ab`
    : pantryItems.length
      ? `${pantryItems.length} Zutaten`
      : "leer";

  // Folgevorschläge: Kachel nur zeigen, wenn welche offen sind. Klick öffnet direkt das Popup
  // (kein eigener Tab/Route), siehe wissensdatenbank/features/folgeaufgaben-vorschlaege.md.
  const openFollowups = await countOpenFollowups().catch(() => 0);
  if (myGeneration !== state.renderGeneration) return;

  const habitsHasDue = dueHabits.length > 0;
  const grid = document.getElementById("cockpit-grid");
  grid.append(
    buildCockpitTile("Habits", habitsHasDue ? "heute fällig" : "nichts fällig", "habits", {
      color: "var(--color-success)",
      // Chip-Streifen statt Ring: zeigt WELCHE Habits dran sind (grün = erledigt, grau = offen),
      // max. 7 sichtbar + „+N". Siehe wissensdatenbank/implementieren-jetzt.md („Kanban + Bento").
      chips: habitsHasDue ? dueHabits.slice(0, 7).map((h) => ({ label: h.title, done: h.done })) : null,
      chipsOverflow: habitsHasDue ? Math.max(0, dueHabits.length - 7) : 0,
    }),
    buildCockpitTile("Aufgaben", tasksGlance, "today", {
      color: "var(--color-accent)",
      subline: nextTask ? `↳ ${nextTask.title}` : null,
    }),
    buildCockpitTile("Watchlist", watchGlance, "fernsehprogramm", { color: "var(--color-cat-gesundheit)" }),
    buildCockpitTile("Gaming", gamingGlance, "games", { color: "var(--color-accent-warm)" }),
    buildCockpitTile("Finanzen", financeGlance, "finance", { color: "var(--color-cat-transport)" }),
    buildCockpitTile("Kühlschrank", pantryGlance, "kuehlschrank", { color: "var(--color-cat-wohnen)" })
  );
  const insightTile = buildInsightTile({ reflections, feedback, completions: recentCompletions, areas, today });
  if (insightTile) grid.append(insightTile);
  if (openFollowups > 0) {
    const tile = buildCockpitTile("Folgevorschläge", `${openFollowups} offen`, null, {
      color: "var(--color-accent-warm)",
      hero: true,
    });
    tile.addEventListener("click", async () => {
      state.followupPopupSnoozed = false;
      openFollowupPopup(await listOpenFollowupGroups());
    });
    grid.append(tile);
  }

  // Gedanken zum Klären: unklare Gedanken, die der Pulse nicht sicher einordnen konnte. Kachel nur
  // zeigen, wenn welche offen sind (wie die Folgevorschläge). Klick öffnet den Resolver.
  const unclearThoughts = await listThoughts("unclear").catch(() => []);
  if (myGeneration !== state.renderGeneration) return;
  if (unclearThoughts.length > 0) {
    const tile = buildCockpitTile("Gedanken zum Klären", `${unclearThoughts.length} offen`, null, {
      color: "var(--color-accent)",
      hero: true,
    });
    tile.addEventListener("click", () => openThoughtResolverPopup(unclearThoughts));
    grid.append(tile);
  }
}

// Rückfrage-Resolver (siehe wissensdatenbank/leben-os-betriebsmodell.md, "Der Pulse-Router"): zeigt
// unklare Gedanken mit den vom Pulse notierten Kandidaten. Tippt der Nutzer einen Kandidaten, hält die
// App nur die Wahl fest (status zurück auf 'raw' + 'Nutzerwahl: …') — die eigentliche Zuordnung macht
// der nächste Pulse-Lauf (Intelligenz bleibt im Skill). "Verwerfen" schließt den Gedanken ab.
function openThoughtResolverPopup(thoughts) {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";
  const remaining = [...thoughts];

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    state.closeActiveModal = null;
    renderCockpitView();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = close;

  // Kandidaten stehen in routing_note als "Kandidaten: A / B" — den Präfix abtrennen und splitten.
  const parseCandidates = (note) => {
    if (!note) return [];
    return note.replace(/^Kandidaten:\s*/i, "").split("/").map((s) => s.trim()).filter(Boolean);
  };

  const render = () => {
    root.innerHTML = `
      <div class="modal-backdrop" id="thought-resolver-backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Gedanken zum Klären">
          <h2>Gedanken zum Klären</h2>
          <p style="margin:-4px 0 8px;color:var(--color-text-subtle);font-size:.9rem;">Tippe einen Kandidaten — der nächste Pulse ordnet den Gedanken entsprechend ein.</p>
          <ul class="task-list" id="thought-resolver-list">
            ${remaining
              .map((t) => {
                const chips = parseCandidates(t.routing_note)
                  .map((c) => `<button type="button" class="priority-chip" data-pick="${escapeHtml(c)}" data-id="${t.id}">${escapeHtml(c)}</button>`)
                  .join("");
                return `<li class="task-item" style="flex-direction:column;align-items:stretch;gap:6px;">
                  <span class="task-title">${escapeHtml(t.body)}</span>
                  <div class="priority-chips" role="group">${chips}
                    <button type="button" class="priority-chip" data-discard="${t.id}">Verwerfen</button>
                  </div>
                </li>`;
              })
              .join("")}
          </ul>
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" id="thought-resolver-close">Schließen</button>
          </div>
        </div>
      </div>`;

    document.getElementById("thought-resolver-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "thought-resolver-backdrop") close();
    });
    document.getElementById("thought-resolver-close").addEventListener("click", close);

    const resolve = async (id, patch) => {
      await withErrorToast(async () => {
        await updateThought(id, patch);
        const idx = remaining.findIndex((t) => t.id === id);
        if (idx >= 0) remaining.splice(idx, 1);
        if (remaining.length === 0) close();
        else render();
      });
    };

    root.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () =>
        resolve(btn.dataset.id, { status: "raw", routing_note: `Nutzerwahl: ${btn.dataset.pick}` })
      );
    });
    root.querySelectorAll("[data-discard]").forEach((btn) => {
      btn.addEventListener("click", () =>
        resolve(btn.dataset.discard, { status: "processed", routing_note: "verworfen" })
      );
    });
  };

  render();
}

// opts: { color } farbcodiert die Kachel an ihre Domäne (Oberkante + Punkt); { ring:{done,total} }
// zeigt statt Text einen Mini-Fortschrittsring (nur für Zähl-Glances wie Habits sinnvoll);
// { hero } hebt eine Aktions-Kachel (z.B. Folgevorschläge) vom Navigations-Raster ab.
// Rückblick-Kachel (js/insights.js): spiegelt Stimmung, Aufgaben-Feedback und Habit-Wirkung zurück,
// statt die Daten nur zu sammeln. null, solange es noch gar nichts auszuwerten gibt.
function buildInsightTile({ reflections, feedback, completions, areas, today }) {
  const strip = buildMoodStrip(reflections, today);
  const moodAvg = averageMood(strip);
  const byArea = averageRatingByArea(feedback);
  const habitEffect = moodByHabitDays(reflections, completions);
  if (moodAvg == null && byArea.length === 0 && !habitEffect) return null;

  const fmt = (n) => n.toFixed(1).replace(".", ",");
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const tile = document.createElement("div");
  tile.className = "cockpit-tile cockpit-tile-insight";
  tile.style.setProperty("--tile-color", "var(--color-accent)");

  const bars = strip
    .map((d) => {
      const label = `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}.: ${d.mood ?? "—"}`;
      return d.mood == null
        ? `<span class="insight-bar is-empty" title="${label}"></span>`
        : `<span class="insight-bar" style="--mood:${d.mood}" title="${label}"></span>`;
    })
    .join("");

  const lines = [];
  if (habitEffect) {
    const diff = habitEffect.withAvg - habitEffect.withoutAvg;
    const verdict = Math.abs(diff) < 0.3 ? "kaum Unterschied" : diff > 0 ? `+${fmt(diff)} mit Habit` : `${fmt(diff)} mit Habit`;
    lines.push(
      `Stimmung an Habit-Tagen Ø ${fmt(habitEffect.withAvg)}, sonst Ø ${fmt(habitEffect.withoutAvg)} <span class="insight-muted">(${verdict})</span>`
    );
  }
  if (byArea.length) {
    const name = (row) => escapeHtml(areaById.get(row.areaId)?.name ?? "Ohne Bereich");
    const best = byArea[0];
    const worst = byArea[byArea.length - 1];
    lines.push(
      byArea.length > 1
        ? `Läuft gut: <strong>${name(best)}</strong> Ø ${fmt(best.avg)} · zäh: <strong>${name(worst)}</strong> Ø ${fmt(worst.avg)}`
        : `Aufgaben-Feedback <strong>${name(best)}</strong> Ø ${fmt(best.avg)}`
    );
  }

  tile.innerHTML = `
    <span class="cockpit-tile-label"><span class="cockpit-tile-dot" aria-hidden="true"></span>Rückblick</span>
    <div class="insight-mood-row">
      <span class="insight-bars" aria-label="Stimmung der letzten 14 Tage">${bars}</span>
      <span class="cockpit-tile-glance">${moodAvg == null ? "—" : `Ø ${fmt(moodAvg)}`}</span>
    </div>
    ${lines.map((l) => `<span class="insight-line">${l}</span>`).join("")}
  `;
  return tile;
}

function buildCockpitTile(label, glance, targetRoute, opts = {}) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "cockpit-tile" + (opts.hero ? " cockpit-tile-hero" : "");
  if (opts.color) tile.style.setProperty("--tile-color", opts.color);

  const labelEl = document.createElement("span");
  labelEl.className = "cockpit-tile-label";
  labelEl.innerHTML = `<span class="cockpit-tile-dot" aria-hidden="true"></span>${escapeHtml(label)}`;
  tile.append(labelEl);

  if (opts.chips && opts.chips.length) {
    // Chip-Streifen (z.B. Habits): grün = erledigt, grau = offen, dann optional „+N".
    const chipsWrap = document.createElement("span");
    chipsWrap.className = "cockpit-tile-chips";
    opts.chips.forEach((c) => {
      const chip = document.createElement("span");
      chip.className = "cockpit-chip" + (c.done ? " is-done" : "");
      chip.textContent = c.label;
      chip.title = c.label;
      chipsWrap.append(chip);
    });
    if (opts.chipsOverflow > 0) {
      const more = document.createElement("span");
      more.className = "cockpit-chip cockpit-chip-more";
      more.textContent = `+${opts.chipsOverflow}`;
      chipsWrap.append(more);
    }
    tile.append(chipsWrap);
  } else if (opts.ring && opts.ring.total > 0) {
    const pct = Math.round((opts.ring.done / opts.ring.total) * 100);
    const row = document.createElement("span");
    row.className = "cockpit-tile-ringrow";
    row.innerHTML =
      `<span class="cockpit-ring" style="--ring-pct:${pct}"><span>${opts.ring.done}/${opts.ring.total}</span></span>` +
      `<span class="cockpit-tile-glance">${escapeHtml(glance)}</span>`;
    tile.append(row);
  } else {
    const glanceEl = document.createElement("span");
    glanceEl.className = "cockpit-tile-glance";
    glanceEl.textContent = glance;
    tile.append(glanceEl);
  }

  // Optionale leise Subzeile (z. B. der nächste Aufgabentitel unter „N offen") — nur im Nicht-Ring-Fall.
  if (opts.subline) {
    const sublineEl = document.createElement("span");
    sublineEl.className = "cockpit-tile-subline";
    sublineEl.textContent = opts.subline;
    tile.append(sublineEl);
  }

  // targetRoute null = Kachel ohne Tab-Ziel (der Aufrufer hängt einen eigenen Click-Handler an,
  // z. B. die Folgevorschläge-Kachel, die stattdessen das Popup öffnet).
  if (targetRoute) {
    tile.addEventListener("click", () => {
      location.hash = `#/${targetRoute}`;
    });
  }
  return tile;
}
