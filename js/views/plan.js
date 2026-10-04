// Ansicht "Plan" (#/plan) inkl. Monatskalender und Aufwandsklassen-Durchgang.
import { listTasks, createTask, planTaskCascade } from "../tasks.js";
import { listAreas, updateArea } from "../areas.js";
import {
  suggestTasksForPlan,
  formatTasksForExport,
  savePlanForDate,
  budgetForDate,
  buildEffortClassSlots,
  buildAreaRotationQueue,
  isPlannableCandidate,
} from "../planner.js";
import { listTransactions, listFixedCosts, listCommittedExpenses, getFinanceModuleSettings } from "../finance.js";
import { listWishlistItems, listSavingsPotEntries } from "../wishlist.js";
import { listWatchlistItems, getEffectiveDuration } from "../watchlist.js";
import { todayISO, tomorrowISO, buildMonthGrid, shiftMonth, shiftIsoDay, monthRange } from "../ui/dates.js";
import { BADGE_ICON_BRAINSTORM, escapeHtml } from "../ui/dom.js";
import { friendlyErrorMessage, showLoading, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";
import { compareByPriority } from "../ui/task-helpers.js";

const planState = {
  areas: [],
  areaColorById: {},
  pool: [],
  selected: [],
  targetDate: null,
  calendarMonth: null, // "YYYY-MM-01" — erster Tag des aktuell angezeigten Kalendermonats
  monthTasks: [], // nicht erledigte Aufgaben mit Plandatum im sichtbaren Kalendermonat, siehe loadMonthTasksAndRender()
  watchlistItemsById: new Map(), // für die Budget-Anzeige: Dauer bereits verplanter Watchlist-Aufgaben auflösen (effort bleibt bei denen NULL)
  slotSequence: [], // Aufwandsklassen-Sequenz für den aktuellen Zieltag, siehe buildEffortClassSlots
  slotIndex: -1,
  currentQueue: [], // { areaId, candidate }[] für den aktuellen Slot, siehe buildAreaRotationQueue
  currentQueueIndex: 0,
  servedAreaIds: new Set(), // Bereiche mit echter Auswahl in dieser Sitzung — last_served_at-Update bei finishWalkthrough
  restrundeCandidates: [], // älteste offene Aufgaben für die abschließende Pflicht-Restrunde
};

/* ---------- Plan ---------- */

function updatePlanDateLabel() {
  // "YYYY-MM-DD" als lokales Datum interpretieren (nicht UTC), damit die Wochentagsanzeige
  // unabhängig von der Zeitzone stets zum gewählten Kalendertag passt.
  const [y, m, d] = planState.targetDate.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  document.getElementById("plan-date").textContent = label;

  // Aktiven Schnellwahl-Chip (Heute/Morgen/Übermorgen) markieren, damit der gewählte Tag ablesbar
  // ist statt drei gleich aussehender Chips. Passt keiner (freies Datum), ist keiner aktiv.
  const chipDates = {
    "plan-date-today": todayISO(),
    "plan-date-tomorrow": tomorrowISO(),
    "plan-date-day-after": shiftIsoDay(todayISO(), 2),
  };
  for (const [id, iso] of Object.entries(chipDates)) {
    const el = document.getElementById(id);
    if (el) el.dataset.active = String(iso === planState.targetDate);
  }
}

// Baut den Monatskalender (planState.calendarMonth) inkl. Padding-Tagen aus dem Vor-/Folgemonat,
// mit der Anzahl bereits geplanter Aufgaben je Tag. monthTasks = alle nicht erledigten Aufgaben mit
// Plandatum im sichtbaren Zeitraum (listTasks mit plannedFrom/plannedTo, siehe monthRange()).
// Antippen eines Tages setzt planState.targetDate wie die Heute/Morgen-Chips; Antippen eines
// ausgegrauten Tages aus dem Vor-/Folgemonat wechselt zusätzlich den angezeigten Monat (inkl.
// Neuladen der Aufgaben für den neuen Monat).
function renderMonthCalendar(monthTasks, dateInput) {
  const grid = document.getElementById("month-grid");
  const label = document.getElementById("month-grid-label");
  const today = todayISO();
  const [y, m] = planState.calendarMonth.split("-").map(Number);
  label.textContent = new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  const countByDate = new Map();
  for (const t of monthTasks) {
    countByDate.set(t.planned_date, (countByDate.get(t.planned_date) || 0) + 1);
  }

  grid.innerHTML = "";
  for (const cell of buildMonthGrid(planState.calendarMonth)) {
    const [cy, cm, cd] = cell.iso.split("-").map(Number);
    const localDate = new Date(cy, cm - 1, cd);
    const count = countByDate.get(cell.iso) || 0;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "month-day";
    btn.dataset.iso = cell.iso;
    btn.dataset.inMonth = String(cell.inMonth);
    btn.dataset.today = String(cell.iso === today);
    btn.dataset.load = count === 0 ? "0" : count <= 2 ? "1" : count <= 4 ? "2" : count <= 6 ? "3" : "heavy";
    btn.dataset.selected = String(cell.iso === planState.targetDate);
    const ariaBase = localDate.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
    btn.setAttribute("aria-label", count > 0 ? `${ariaBase} · ${count} geplant` : ariaBase);
    // Tageszahl + (bei Belegung) kleine Anzahl-Ziffer in der Ecke — die Färbung (data-load) gibt das
    // Gefühl, die Ziffer die Präzision.
    const dayNum = document.createElement("span");
    dayNum.className = "month-day-num";
    dayNum.textContent = String(cd);
    btn.appendChild(dayNum);
    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "month-day-count";
      badge.textContent = String(count);
      badge.setAttribute("aria-hidden", "true");
      btn.appendChild(badge);
    }
    btn.addEventListener("click", async () => {
      planState.targetDate = cell.iso;
      dateInput.value = cell.iso;
      updatePlanDateLabel();
      if (!cell.inMonth) {
        planState.calendarMonth = cell.iso.slice(0, 8) + "01";
        await withErrorToast(async () => {
          await loadMonthTasksAndRender(dateInput);
        });
      } else {
        syncMonthCalendarSelection();
      }
    });
    grid.appendChild(btn);
  }
  renderPlannedDayPanel(planState.targetDate);
}

// Hält den Monatskalender (Auswahl-Highlight + Tagesbelegungs-Panel) synchron, wenn
// planState.targetDate über die Heute/Morgen-Chips, das native Datums-Input oder einen Klick im
// Grid selbst geändert wird, ohne dass sich der angezeigte Monat ändert (Monatswechsel lädt direkt
// über renderMonthCalendar neu).
function syncMonthCalendarSelection() {
  document.querySelectorAll("#month-grid .month-day").forEach((el) => {
    el.dataset.selected = String(el.dataset.iso === planState.targetDate);
  });
  renderPlannedDayPanel(planState.targetDate);
}

// Zeigt unter dem Kalender die für den gewählten Tag bereits eingeplanten Aufgaben — gefiltert aus
// planState.monthTasks (bereits für den ganzen sichtbaren Kalendermonat geladen, siehe
// loadMonthTasksAndRender), kein zusätzlicher Request nötig.
function renderPlannedDayPanel(iso) {
  const panel = document.getElementById("week-day-panel");
  if (!panel || !iso) return;
  const heading = document.getElementById("week-day-panel-heading");
  const list = document.getElementById("week-day-panel-list");
  const emptyState = document.getElementById("week-day-panel-empty");

  const [y, m, d] = iso.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  heading.textContent = `Eingeplant für ${label}`;

  const tasksForDay = planState.monthTasks.filter((t) => t.planned_date === iso).sort(compareByPriority);
  const areaColorById = planState.areaColorById;

  list.innerHTML = "";
  emptyState.hidden = tasksForDay.length > 0;
  panel.hidden = false;
  for (const task of tasksForDay) {
    list.appendChild(buildWeekDayTaskRow(task, areaColorById));
  }
}

// Gemeinsame Basis für Plan-Zeilen (Vorschlagsliste + Tagesbelegungs-Panel): Punkt in
// Bereichsfarbe + Titeltext. buildPlanTaskItem ergänzt danach Aufwand/Badge/Entfernen-Button.
function buildPlanRowBase(task, areaColorById, titleText = task.title) {
  const li = document.createElement("li");
  li.className = "task-item";
  if (areaColorById[task.area_id]) {
    li.style.borderLeftColor = areaColorById[task.area_id];
    li.style.setProperty("--task-area-color", areaColorById[task.area_id]);
  }

  const dot = document.createElement("span");
  dot.className = "task-area-dot";
  dot.style.background = areaColorById[task.area_id] || "var(--color-text-subtle)";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = titleText;

  li.append(dot, title);
  return li;
}

// Rein informative Zeile (kein Checkbox-/Löschen-Verhalten wie buildTaskItem/buildPlanTaskItem) —
// das Panel zeigt nur, was für den Tag bereits eingeplant ist.
function buildWeekDayTaskRow(task, areaColorById) {
  return buildPlanRowBase(task, areaColorById);
}

// Backup/Absicherung: alle eigenen Daten als JSON-Datei herunterladen. Erster Datei-Download-
// Codepath der App (bisher gab's nur den Zwischenablage-Export oben) — daily_plans wird bewusst
// nicht mit exportiert, der Zustand steckt schon vollständig in tasks.planned_date.
async function exportAllDataAsJson() {
  const [
    tasks,
    areas,
    transactions,
    fixedCosts,
    committedExpenses,
    financeSettings,
    wishlistItems,
    savingsPotEntries,
  ] = await Promise.all([
    listTasks(),
    listAreas(),
    listTransactions(),
    listFixedCosts(),
    listCommittedExpenses(),
    getFinanceModuleSettings(),
    listWishlistItems(),
    listSavingsPotEntries(),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    tasks,
    areas,
    transactions,
    fixedCosts,
    committedExpenses,
    financeSettings,
    wishlistItems,
    savingsPotEntries,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leben-os-export-${todayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Wirft nach ms Millisekunden ab, falls promise bis dahin weder erfüllt noch abgelehnt wurde — der
// Supabase-Client hat kein eingebautes Timeout, ein hängender Request würde sonst nie ablehnen.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Lädt die Plan-Vorschlagsdaten (Bereiche, offene Aufgaben) und den sichtbaren Kalendermonat. Von
// renderPlanView() getrennt, damit sowohl der initiale Aufruf als auch der Retry-Button nach einem
// Ladefehler dieselbe Logik nutzen. Ohne try/catch + Timeout blieb der Ladezustand (showLoading)
// bei einem fehlschlagenden/hängenden Request für immer stehen.
async function loadPlanData(dateInput) {
  showLoading("suggested-task-list");
  try {
    const [areas, pool, watchlistItems] = await withTimeout(
      Promise.all([listAreas(), listTasks({ status: "open" }), listWatchlistItems()]),
      15000,
      "Zeitüberschreitung beim Laden."
    );
    planState.areas = areas;
    planState.areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));
    planState.pool = pool;
    planState.watchlistItemsById = new Map(watchlistItems.map((i) => [i.id, i]));
    // Startauswahl ist jetzt leer (kein Bereichs-Minimum mehr) — die abschließende Restrunde
    // übernimmt die alte "garantiert"-Funktion, siehe startRestrunde(). Die volle Automatik von
    // suggestTasksForPlan bleibt exklusiv dem "Neu vorschlagen"-Button vorbehalten.
    planState.selected = [];
    planState.slotSequence = buildEffortClassSlots(planState.targetDate);
    planState.slotIndex = -1;
    planState.servedAreaIds = new Set();
    planState.restrundeCandidates = [];

    await loadMonthTasksAndRender(dateInput);
    startEffortWalkthrough();
  } catch (err) {
    renderPlanLoadError(friendlyErrorMessage(err), dateInput);
  }
}

// Lädt die Aufgaben für den aktuell sichtbaren Kalendermonat (planState.calendarMonth) neu und
// rendert den Kalender — eigene Funktion, damit ein Monatswechsel (Prev/Next-Klick oder Antippen
// eines ausgegrauten Nachbarmonats-Tages) nicht Bereiche/Vorschlagspool erneut laden muss.
async function loadMonthTasksAndRender(dateInput) {
  const [firstIso, lastIso] = monthRange(planState.calendarMonth);
  const monthTasks = await withTimeout(
    listTasks({ statusNot: "done", plannedFrom: firstIso, plannedTo: lastIso }),
    15000,
    "Zeitüberschreitung beim Laden."
  );
  planState.monthTasks = monthTasks;
  renderMonthCalendar(monthTasks, dateInput);
}

// Hält den angezeigten Kalendermonat mit planState.targetDate synchron, wenn dieser über die
// Heute/Morgen-Chips oder das native Datums-Input geändert wird (nicht über einen Klick im Grid
// selbst — das behandelt renderMonthCalendar direkt). Lädt nur neu, wenn sich dadurch tatsächlich
// der sichtbare Monat ändert.
async function jumpCalendarToTargetDate(dateInput) {
  const targetMonth = planState.targetDate.slice(0, 8) + "01";
  if (targetMonth !== planState.calendarMonth) {
    planState.calendarMonth = targetMonth;
    await withErrorToast(async () => {
      await loadMonthTasksAndRender(dateInput);
    });
  } else {
    syncMonthCalendarSelection();
  }
}

function renderPlanLoadError(message, dateInput) {
  const list = document.getElementById("suggested-task-list");
  document.getElementById("suggested-empty-state").hidden = true;
  list.innerHTML = "";
  const li = document.createElement("li");
  li.className = "load-error";
  const text = document.createElement("p");
  text.className = "empty-state";
  text.textContent = message;
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "btn btn-secondary";
  retryBtn.textContent = "Erneut versuchen";
  retryBtn.addEventListener("click", () => loadPlanData(dateInput));
  li.append(text, retryBtn);
  list.appendChild(li);
}

export async function renderPlanView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/plan.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();

  planState.targetDate = tomorrowISO();
  planState.calendarMonth = todayISO().slice(0, 8) + "01";
  const dateInput = document.getElementById("plan-date-input");
  dateInput.value = planState.targetDate;
  updatePlanDateLabel();

  document.getElementById("plan-date-today").addEventListener("click", async () => {
    planState.targetDate = todayISO();
    dateInput.value = planState.targetDate;
    updatePlanDateLabel();
    await jumpCalendarToTargetDate(dateInput);
  });
  document.getElementById("plan-date-tomorrow").addEventListener("click", async () => {
    planState.targetDate = tomorrowISO();
    dateInput.value = planState.targetDate;
    updatePlanDateLabel();
    await jumpCalendarToTargetDate(dateInput);
  });
  document.getElementById("plan-date-day-after").addEventListener("click", async () => {
    planState.targetDate = shiftIsoDay(todayISO(), 2);
    dateInput.value = planState.targetDate;
    updatePlanDateLabel();
    await jumpCalendarToTargetDate(dateInput);
  });
  dateInput.addEventListener("change", async () => {
    if (!dateInput.value) return;
    planState.targetDate = dateInput.value;
    updatePlanDateLabel();
    await jumpCalendarToTargetDate(dateInput);
  });
  const stepDay = async (delta) => {
    planState.targetDate = shiftIsoDay(planState.targetDate, delta);
    dateInput.value = planState.targetDate;
    updatePlanDateLabel();
    await jumpCalendarToTargetDate(dateInput);
  };
  document.getElementById("plan-date-prev").addEventListener("click", () => stepDay(-1));
  document.getElementById("plan-date-next").addEventListener("click", () => stepDay(1));
  document.getElementById("month-prev").addEventListener("click", async () => {
    planState.calendarMonth = shiftMonth(planState.calendarMonth, -1);
    await withErrorToast(async () => {
      await loadMonthTasksAndRender(dateInput);
    });
  });
  document.getElementById("month-next").addEventListener("click", async () => {
    planState.calendarMonth = shiftMonth(planState.calendarMonth, 1);
    await withErrorToast(async () => {
      await loadMonthTasksAndRender(dateInput);
    });
  });

  document.getElementById("effort-accept").addEventListener("click", acceptEffortCandidate);
  document.getElementById("effort-skip-area").addEventListener("click", skipEffortArea);
  document.getElementById("effort-skip-class").addEventListener("click", skipEffortClass);
  document.getElementById("restrunde-next").addEventListener("click", finishWalkthrough);
  wirePlanQuickAdd();

  await loadPlanData(dateInput);

  document.getElementById("refresh-suggestion").addEventListener("click", () => {
    planState.selected = suggestTasksForPlan(planState.pool, planState.targetDate);
    renderPlanTaskList();
    renderAddTaskSelect();
  });

  document.getElementById("add-task-select").addEventListener("change", (e) => {
    const taskId = e.target.value;
    if (!taskId) return;
    const task = planState.pool.find((t) => t.id === taskId);
    if (task) planState.selected.push(task);
    renderPlanTaskList();
    renderAddTaskSelect();
  });

  document.getElementById("confirm-plan").addEventListener("click", async () => {
    const status = document.getElementById("plan-status");
    status.textContent = "Speichere Plan…";
    try {
      const targetDate = planState.targetDate;
      const ids = planState.selected.map((t) => t.id);
      await Promise.all(planState.selected.map((task) => planTaskCascade(task, targetDate, planState.pool)));
      await savePlanForDate(targetDate, ids);
      status.textContent = "Plan gespeichert.";
    } catch (err) {
      status.textContent = friendlyErrorMessage(err);
    }
  });

  document.getElementById("export-tasks").addEventListener("click", async () => {
    const status = document.getElementById("export-status");
    const areaNameById = Object.fromEntries(planState.areas.map((a) => [a.id, a.name]));
    const openTasks = await listTasks({ status: "open" });
    const text = formatTasksForExport(openTasks, areaNameById);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "In die Zwischenablage kopiert.";
    } catch {
      status.textContent = text;
    }
  });

  document.getElementById("export-all-json").addEventListener("click", async () => {
    const status = document.getElementById("export-all-status");
    status.textContent = "Exportiere…";
    try {
      await exportAllDataAsJson();
      status.textContent = "Datei heruntergeladen.";
    } catch (err) {
      status.textContent = friendlyErrorMessage(err);
    }
  });
}

function renderPlanTaskList() {
  const list = document.getElementById("suggested-task-list");
  const emptyState = document.getElementById("suggested-empty-state");
  const areaColorById = planState.areaColorById;

  // Bereits für den Zieltag feststehende Aufgaben (v. a. Watchlist-Einträge) laufen mit effort=NULL
  // (siehe autoplanWatchlistForDates in watchlist.js) und wurden bisher unsichtbar mit 0 Minuten
  // mitgezählt — hier per Watchlist-Item-Dauer aufgelöst, damit das angezeigte Budget den echten
  // Tages-Zeitbedarf widerspiegelt. planState.monthTasks deckt den Zieltag bereits ab (siehe
  // loadMonthTasksAndRender/jumpCalendarToTargetDate), kein zusätzlicher Request nötig.
  const committedMinutes = planState.monthTasks
    .filter((t) => t.planned_date === planState.targetDate)
    .reduce((sum, t) => {
      if (t.effort != null) return sum + t.effort;
      const item = t.watchlist_item_id ? planState.watchlistItemsById.get(t.watchlist_item_id) : null;
      return item ? sum + getEffectiveDuration(item) : sum;
    }, 0);
  const suggestedMinutes = planState.selected.reduce((sum, t) => sum + (t.effort || 0), 0);
  // Budget als zweisegmentiger Balken statt reiner Textzeile — verplant (accent) + Vorschlag
  // (accent-warm) gegen das Tagesbudget; bei Überbuchung schlägt der Balken auf danger um.
  const totalBudget = budgetForDate(planState.targetDate);
  const usedMinutes = committedMinutes + suggestedMinutes;
  const over = usedMinutes > totalBudget;
  const committedPct = totalBudget ? Math.min(100, (committedMinutes / totalBudget) * 100) : 0;
  const suggestedPct = totalBudget ? Math.min(100 - committedPct, (suggestedMinutes / totalBudget) * 100) : 0;
  const remaining = totalBudget - usedMinutes;
  const legend = over
    ? `${committedMinutes} verplant · ${suggestedMinutes} Vorschlag · ${usedMinutes - totalBudget} über Budget`
    : `${committedMinutes} verplant · ${suggestedMinutes} Vorschlag${remaining > 0 ? ` · ${remaining} frei` : ""}`;
  document.getElementById("plan-budget").innerHTML = `
    <span class="plan-budget-head">
      <strong>Tagesbudget</strong>
      <span class="plan-budget-nums${over ? " is-over" : ""}">${usedMinutes} / ${totalBudget} min</span>
    </span>
    <span class="plan-budget-bar${over ? " is-over" : ""}">
      <span class="plan-budget-fill committed" style="width:${committedPct}%"></span>
      <span class="plan-budget-fill suggested" style="width:${suggestedPct}%"></span>
    </span>
    <span class="plan-budget-legend">${legend}</span>`;

  list.innerHTML = "";
  if (planState.selected.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  for (const task of planState.selected) {
    list.appendChild(buildPlanTaskItem(task, areaColorById));
  }
}

function buildPlanTaskItem(task, areaColorById) {
  const li = buildPlanRowBase(task, areaColorById, task.title + (task.effort ? ` · ${task.effort} min` : ""));

  if (task.is_brainstorm) {
    const badge = document.createElement("span");
    badge.className = "badge badge-brainstorm";
    badge.innerHTML = BADGE_ICON_BRAINSTORM + "Ohne Bereich";
    li.appendChild(badge);
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "task-remove-btn";
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", "Entfernen");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    planState.selected = planState.selected.filter((t) => t.id !== task.id);
    renderPlanTaskList();
    renderAddTaskSelect();
  });
  li.appendChild(removeBtn);

  return li;
}

// Ad-hoc-Neuanlage direkt in der Plan-Ansicht (implementieren-jetzt.md, Triage 2026-07-20) — das
// bestehende "Weitere Aufgabe hinzufügen"-Select deckt nur bereits existierende offene Aufgaben ab.
// Bereich/Datum ergeben sich aus dem Plan-Kontext selbst (kein Bereich, planState.targetDate).
function wirePlanQuickAdd() {
  const form = document.getElementById("plan-quick-add-form");
  const titleInput = document.getElementById("plan-quick-add-title");
  const effortGroup = document.getElementById("plan-quick-add-effort");

  let selectedEffort = null;
  effortGroup.querySelectorAll(".effort-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const value = Number(chip.dataset.effort);
      selectedEffort = selectedEffort === value ? null : value;
      effortGroup.querySelectorAll(".effort-chip").forEach((c) => {
        c.dataset.active = String(Number(c.dataset.effort) === selectedEffort);
      });
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    await withErrorToast(async () => {
      const task = await createTask({
        title,
        effort: selectedEffort,
        status: "planned",
        plannedDate: planState.targetDate,
      });
      planState.selected.push(task);
      form.reset();
      selectedEffort = null;
      effortGroup.querySelectorAll(".effort-chip").forEach((c) => (c.dataset.active = "false"));
      renderPlanTaskList();
      renderAddTaskSelect();
    });
  });
}

function renderAddTaskSelect() {
  const select = document.getElementById("add-task-select");
  const selectedIds = new Set(planState.selected.map((t) => t.id));
  const available = planState.pool.filter((t) => !selectedIds.has(t.id));

  select.innerHTML =
    `<option value="">Aufgabe wählen…</option>` +
    available.map((t) => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join("");
}

// ----- Aufwandsklassen-geführter Durchgang -----
// wissensdatenbank/features/tagesplan-algorithmus-v2.md, "Entschiedenes Zielbild (V2)" (War Room
// 2026-07-21) — ersetzt den früheren Bereichs-first-Durchgang. Aufwandsklasse ist die Primärachse
// (60 → 30 → 10 → 5 Min., planState.slotSequence via buildEffortClassSlots), Bereichs-Rotation
// (least-recently-served, hochpriorisierte Bereiche springen vor) läuft nur innerhalb einer Klasse
// (planState.currentQueue via buildAreaRotationQueue). Eine echte Auswahl (Übernehmen) springt sofort
// zur nächsten Klasse; Ablehnen zeigt den nächsten Bereich derselben Klasse.
function startEffortWalkthrough() {
  document.getElementById("effort-walkthrough-panel").hidden = false;
  document.getElementById("restrunde-panel").hidden = true;
  document.getElementById("post-walkthrough-panels").hidden = true;
  advanceToNextSlot();
}

function advanceToNextSlot() {
  planState.slotIndex++;
  if (planState.slotIndex >= planState.slotSequence.length) {
    startRestrunde();
    return;
  }
  const effortValue = planState.slotSequence[planState.slotIndex];
  const selectedIds = new Set(planState.selected.map((t) => t.id));
  planState.currentQueue = buildAreaRotationQueue(planState.pool, planState.areas, effortValue, selectedIds);
  planState.currentQueueIndex = 0;
  if (planState.currentQueue.length === 0) {
    advanceToNextSlot(); // stiller Skip, "kein Gate" — keine offenen Aufgaben dieser Klasse übrig
    return;
  }
  renderEffortSlotStep();
}

function renderEffortSlotStep() {
  const effortValue = planState.slotSequence[planState.slotIndex];
  const { areaId, candidate } = planState.currentQueue[planState.currentQueueIndex];
  const area = planState.areas.find((a) => a.id === areaId);
  const areaName = area ? area.name : "Ohne Bereich";

  document.getElementById("effort-progress").textContent =
    `${effortValue} Min. · Bereich ${planState.currentQueueIndex + 1} von ${planState.currentQueue.length}`;
  document.getElementById("effort-area-name").textContent = areaName;

  const row = document.getElementById("effort-candidate-row");
  row.innerHTML = "";
  // Unteraufgabe: Mutter-Titel als Kontext-Präfix, damit ein Teilschritt nicht wie ein zusammenhangloser
  // Fremdkörper wirkt (z. B. „Steuererklärung · Anlage KAP").
  const parent = candidate.parent_task_id ? planState.pool.find((t) => t.id === candidate.parent_task_id) : null;
  const titleWithContext = (parent ? `${parent.title} · ` : "") + candidate.title;
  row.appendChild(
    buildPlanRowBase(candidate, planState.areaColorById, titleWithContext + (candidate.effort ? ` · ${candidate.effort} min` : ""))
  );
}

function acceptEffortCandidate() {
  const { areaId, candidate } = planState.currentQueue[planState.currentQueueIndex];
  planState.selected.push(candidate);
  if (areaId !== null) planState.servedAreaIds.add(areaId);
  advanceToNextSlot();
}

function skipEffortArea() {
  planState.currentQueueIndex++;
  if (planState.currentQueueIndex >= planState.currentQueue.length) {
    advanceToNextSlot(); // Klasse durchprobiert, kein Kandidat gewählt
  } else {
    renderEffortSlotStep();
  }
}

function skipEffortClass() {
  advanceToNextSlot();
}

// Abschließende Pflicht-Runde: garantiert, dass liegen gebliebene Aufgaben nicht dauerhaft im
// aufwandsklassen-geführten Durchgang untergehen (Ersatz für das frühere "Minimum pro Bereich") —
// nur wenn nach dem Durchgang noch Budget übrig UND noch wählbare Aufgaben vorhanden sind.
function startRestrunde() {
  document.getElementById("effort-walkthrough-panel").hidden = true;
  const usedMinutes = planState.selected.reduce((sum, t) => sum + (t.effort || 0), 0);
  const remainingBudget = budgetForDate(planState.targetDate) - usedMinutes;
  const selectedIds = new Set(planState.selected.map((t) => t.id));
  const eligible = planState.pool
    .filter((t) => !selectedIds.has(t.id) && isPlannableCandidate(t, planState.pool))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (remainingBudget <= 0 || eligible.length === 0) {
    finishWalkthrough();
    return;
  }

  planState.restrundeCandidates = eligible.slice(0, 5);
  document.getElementById("restrunde-panel").hidden = false;
  renderRestrundeCandidates();
}

function renderRestrundeCandidates() {
  const wrap = document.getElementById("restrunde-candidates");
  const nextBtn = document.getElementById("restrunde-next");
  wrap.innerHTML = "";
  for (const task of planState.restrundeCandidates) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "pot-chip";
    if (planState.areaColorById[task.area_id]) chip.style.setProperty("--pot-color", planState.areaColorById[task.area_id]);
    chip.dataset.active = String(planState.selected.some((t) => t.id === task.id));
    chip.textContent = task.title + (task.effort ? ` · ${task.effort} min` : "");
    chip.addEventListener("click", () => {
      const wasActive = chip.dataset.active === "true";
      planState.selected = wasActive
        ? planState.selected.filter((t) => t.id !== task.id)
        : [...planState.selected, task];
      chip.dataset.active = String(!wasActive);
      nextBtn.disabled = !planState.restrundeCandidates.some((t) => planState.selected.some((s) => s.id === t.id));
    });
    wrap.appendChild(chip);
  }
  nextBtn.disabled = true;
}

async function finishWalkthrough() {
  document.getElementById("effort-walkthrough-panel").hidden = true;
  document.getElementById("restrunde-panel").hidden = true;
  document.getElementById("post-walkthrough-panels").hidden = false;
  renderPlanTaskList();
  renderAddTaskSelect();

  if (planState.servedAreaIds.size === 0) return;
  const now = new Date().toISOString();
  await withErrorToast(async () => {
    await Promise.all([...planState.servedAreaIds].map((areaId) => updateArea(areaId, { last_served_at: now })));
  });
}
