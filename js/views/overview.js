// Ansicht "Übersicht" (#/overview) inkl. Filter, Bereichsbaum, Kanban und Bereichs-Verwaltung.
import {
  listTasks,
  updateTask,
  createTask,
  deleteTask,
  buildTaskTree,
  collectDescendantIds,
  countDescendantsRecursive,
  completeTaskCascade,
  reopenTaskCascade,
  cascadeAreaChange,
} from "../tasks.js";
import { listAreas, createArea, updateArea, deleteArea, swapAreaOrder } from "../areas.js";
import { isHabitTask } from "../habits.js";
import { isWatchlistTask } from "../watchlist.js";
import { listAllCommentedTaskIds } from "../comments.js";
import { createDateChipGroup } from "../ui/date-chips.js";
import { weekStartISO } from "../ui/dates.js";
import {
  BADGE_ICON_OVERDUE,
  escapeHtml,
  buildPinIcon,
  buildDragHandleIcon,
  EMPTY_STATE_SEARCH_ICON,
  buildEmptyState,
} from "../ui/dom.js";
import { showToast, showConfirm, friendlyErrorMessage, showLoading, withErrorToast } from "../ui/modals.js";
import { openTaskFeedbackSheet, triggerFollowupPopupAfterCompletion } from "../ui/popups.js";
import { state, FILTER_STORAGE_KEY, overviewState } from "../ui/state.js";
import { restoreTaskSnapshot, showCompleteUndoToast } from "../ui/task-actions.js";
import { isTaskOverdue, isTaskDueSoon, compareByUrgency, filterTreeNodes } from "../ui/task-helpers.js";
import { openTaskDetail } from "./task-detail.js";

function saveStoredFilters() {
  const { effort, status, search } = overviewState.filters;
  try {
    localStorage.setItem(
      FILTER_STORAGE_KEY,
      JSON.stringify({ effort, status, search, showDone: overviewState.showDone, viewMode: overviewState.viewMode })
    );
  } catch {
    // z.B. Private-Browsing-Modus ohne Storage-Zugriff — Persistenz ist ein Nice-to-have,
    // die Filter sollen trotzdem für die laufende Sitzung normal weiterfunktionieren.
  }
}

function hexToRgbArray(hex) {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(clean.substr(i, 2), 16));
}

function relativeLuminance([r, g, b]) {
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hexToRgbArray(hex1));
  const l2 = relativeLuminance(hexToRgbArray(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// Grobe Prüfung, ob eine Bereichsfarbe im Light- oder Dark-Mode-Hintergrund fast verschwindet.
// Feste Referenzwerte aus variables.css, da zur Laufzeit immer nur ein Theme aktiv ist.
function isLowContrastAreaColor(hex) {
  return contrastRatio(hex, "#FFFFFF") < 1.4 || contrastRatio(hex, "#221E1B") < 1.4;
}

// Blendet eine Warnung neben einem Farb-Input ein, solange die gewählte Farbe zu wenig
// Kontrast gegen helle oder dunkle Oberflächen hat (z.B. Punkt/Rand kaum sichtbar).
function wireColorContrastWarning(colorInput, warningEl) {
  const check = () => {
    warningEl.hidden = !isLowContrastAreaColor(colorInput.value);
  };
  colorInput.addEventListener("input", check);
  check();
}

/* ---------- Overview ---------- */

export async function renderOverviewView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/overview.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  showLoading("area-tree");

  // Filterzustand bleibt über Navigationswechsel (und dank localStorage auch über Reloads) hinweg
  // erhalten — nur die transienten UI-Zustände unten werden bei jedem View-Wechsel geschlossen.
  overviewState.addFormTarget = null;
  overviewState.selectedBrainstormIds.clear();

  await loadOverviewData();
  // Bereiche sollen bei jedem Aufruf der Übersicht eingeklappt starten — anders als in
  // reloadOverview() (das denselben internen Re-Render während der laufenden Sitzung nutzt und den
  // Zustand dort bewusst NICHT zurücksetzt, sonst würde manuelles Aufklappen sofort rückgängig
  // gemacht).
  overviewState.collapsedAreas = new Set(overviewState.areas.map((a) => a.id));
  renderPinnedTasks();
  renderOverviewBody();
  renderNoAreaSection();
  wireOverviewFilters();
  await renderAreaManageList();
  wireNewAreaForm();
  wireAreaManageToggle();
}

// Rendert den Übersichts-Body (Bereichsbaum). Früher gab es hier eine Weiche zur Kanban-Ansicht;
// die wurde im War Room 2026-08-13 verworfen und aus der UI entfernt (renderKanbanBoard bleibt als
// toter Code stehen). Nur die zwei Haupt-Render-Pfade (renderOverviewView/reloadOverview) laufen
// hierüber — die vielen direkten renderAreaTree()-Aufrufe stammen aus Listen-Interaktionen.
function renderOverviewBody() {
  renderAreaTree();
}

async function loadOverviewData() {
  const [areas, tasks, commentedTaskIds] = await Promise.all([listAreas(), listTasks(), listAllCommentedTaskIds()]);
  overviewState.areas = areas;
  overviewState.tasks = tasks;
  overviewState.commentedTaskIds = commentedTaskIds;
}

export async function reloadOverview() {
  await loadOverviewData();
  renderPinnedTasks();
  renderOverviewBody();
  renderNoAreaSection();
  await renderAreaManageList();
}

// Bereiche-Verwaltung ist ein einklappbares Panel in der Übersicht (statt eines eigenen
// Nav-Tabs): "+" öffnet es und fokussiert das Namensfeld, das Zahnrad-Icon schaltet es um.
function wireAreaManageToggle() {
  const panel = document.getElementById("area-manage-panel");
  document.getElementById("area-manage-toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  document.getElementById("area-add-btn").addEventListener("click", () => {
    panel.hidden = false;
    document.getElementById("new-area-name").focus();
  });
  // Alle Bereiche mit einem Klick ein-/ausklappen: sind aktuell alle eingeklappt, wird alles
  // aufgeklappt, sonst alles eingeklappt (spart N Einzelklicks im collapsedAreas-Toggle).
  const collapseAllBtn = document.getElementById("collapse-all-toggle");
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener("click", () => {
      const allCollapsed = overviewState.areas.every((a) => overviewState.collapsedAreas.has(a.id));
      if (allCollapsed) {
        overviewState.collapsedAreas.clear();
      } else {
        overviewState.collapsedAreas = new Set(overviewState.areas.map((a) => a.id));
      }
      renderAreaTree();
    });
  }
}

function taskPassesFilter(task) {
  const { effort, status, search } = overviewState.filters;
  // Erledigte standardmäßig ausblenden, außer die Checkbox ist an oder explizit nach "Erledigt" gefiltert wird.
  if (!status && !overviewState.showDone && task.status === "done") return false;
  if (effort && String(task.effort) !== effort) return false;
  if (status && task.status !== status) return false;
  if (search && !task.title.toLowerCase().includes(search)) return false;
  return true;
}

// Zählt aktive Filter für den Badge am Filter-Toggle — Suchtext, Aufwand/Status-Auswahl und die
// "Erledigte anzeigen"-Checkbox zählen je als ein aktiver Filter.
function countActiveOverviewFilters() {
  const { effort, status, search } = overviewState.filters;
  return [effort, status, search].filter(Boolean).length + (overviewState.showDone ? 1 : 0);
}

function updateFilterCountBadge() {
  const badge = document.getElementById("filter-count");
  if (!badge) return;
  const count = countActiveOverviewFilters();
  badge.hidden = count === 0;
  badge.textContent = String(count);
  const resetBtn = document.getElementById("filter-reset");
  if (resetBtn) resetBtn.hidden = count === 0;
  updateActiveFilterChips();
}

const STATUS_FILTER_LABEL = { open: "Offen", planned: "Geplant", done: "Erledigt" };

// Aktive Filter als sichtbare, einzeln entfernbare Chips — auch wenn die Filterleiste eingeklappt
// ist. Der Zähler-Badge sagt nur "wie viele", die Chips sagen "welche" und lassen sich per Klick lösen.
function updateActiveFilterChips() {
  const wrap = document.getElementById("active-filter-chips");
  if (!wrap) return;
  const { effort, status, search } = overviewState.filters;
  const chips = [];
  if (search) chips.push({ key: "search", label: `„${search}"` });
  if (effort) chips.push({ key: "effort", label: `${effort} Min` });
  if (status) chips.push({ key: "status", label: STATUS_FILTER_LABEL[status] || status });
  if (overviewState.showDone) chips.push({ key: "showDone", label: "Erledigte sichtbar" });
  wrap.innerHTML = "";
  wrap.hidden = chips.length === 0;
  for (const c of chips) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "active-filter-chip";
    chip.innerHTML = `${escapeHtml(c.label)} <span aria-hidden="true">✕</span>`;
    chip.setAttribute("aria-label", `Filter entfernen: ${c.label}`);
    chip.addEventListener("click", () => clearOverviewFilter(c.key));
    wrap.appendChild(chip);
  }
}

function clearOverviewFilter(key) {
  if (key === "showDone") {
    overviewState.showDone = false;
    const cb = document.getElementById("filter-show-done");
    if (cb) cb.checked = false;
  } else {
    overviewState.filters[key] = "";
    const controlId = { search: "filter-search", effort: "filter-effort", status: "filter-status" }[key];
    const el = document.getElementById(controlId);
    if (el) el.value = "";
  }
  saveStoredFilters();
  updateFilterCountBadge();
  renderAreaTree();
  renderNoAreaSection();
}

// Filterleiste bleibt standardmäßig eingeklappt (Muster wie die Schnellerfassung) — waren beim
// letzten Besuch schon Filter aktiv, startet sie aber offen, damit die aktive Auswahl nicht
// versteckt hinter dem Zähler-Badge verschwindet.
function wireOverviewFilters() {
  const effortSelect = document.getElementById("filter-effort");
  const statusSelect = document.getElementById("filter-status");
  const searchInput = document.getElementById("filter-search");
  const showDoneCheckbox = document.getElementById("filter-show-done");
  const toggleBtn = document.getElementById("filter-toggle");
  const filterBar = document.getElementById("filter-bar");

  effortSelect.value = overviewState.filters.effort;
  statusSelect.value = overviewState.filters.status;
  searchInput.value = overviewState.filters.search;
  showDoneCheckbox.checked = overviewState.showDone;
  updateFilterCountBadge();

  const setExpanded = (expanded) => {
    filterBar.hidden = !expanded;
    toggleBtn.setAttribute("aria-expanded", String(expanded));
  };
  setExpanded(countActiveOverviewFilters() > 0);
  toggleBtn.addEventListener("click", () => setExpanded(filterBar.hidden));

  effortSelect.addEventListener("change", () => {
    overviewState.filters.effort = effortSelect.value;
    saveStoredFilters();
    updateFilterCountBadge();
    renderAreaTree();
    renderNoAreaSection();
  });
  statusSelect.addEventListener("change", () => {
    overviewState.filters.status = statusSelect.value;
    saveStoredFilters();
    updateFilterCountBadge();
    renderAreaTree();
    renderNoAreaSection();
  });
  searchInput.addEventListener("input", () => {
    overviewState.filters.search = searchInput.value.trim().toLowerCase();
    saveStoredFilters();
    updateFilterCountBadge();
    renderAreaTree();
    renderNoAreaSection();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && searchInput.value) {
      e.stopPropagation();
      searchInput.value = "";
      searchInput.dispatchEvent(new Event("input"));
    }
  });
  showDoneCheckbox.addEventListener("change", () => {
    overviewState.showDone = showDoneCheckbox.checked;
    saveStoredFilters();
    updateFilterCountBadge();
    renderAreaTree();
    renderNoAreaSection();
  });

  // Ein-Klick-Reset aller aktiven Filter — sonst muss man vier Controls einzeln zurückstellen, um zu
  // verstehen, warum Aufgaben fehlen. Button ist nur sichtbar, wenn überhaupt Filter aktiv sind.
  const resetBtn = document.getElementById("filter-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      overviewState.filters.effort = "";
      overviewState.filters.status = "";
      overviewState.filters.search = "";
      overviewState.showDone = false;
      effortSelect.value = "";
      statusSelect.value = "";
      searchInput.value = "";
      showDoneCheckbox.checked = false;
      saveStoredFilters();
      updateFilterCountBadge();
      renderAreaTree();
      renderNoAreaSection();
    });
  }
}

// ----- Angeheftete Aufgaben (schnell auffindbar) -----

function renderPinnedTasks() {
  const panel = document.getElementById("pinned-tasks-panel");
  const list = document.getElementById("pinned-task-list");
  const pinned = overviewState.tasks.filter((t) => t.is_pinned);
  if (pinned.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const areaName = Object.fromEntries(overviewState.areas.map((a) => [a.id, a.name]));
  list.innerHTML = "";

  for (const t of pinned) {
    const count = countDescendantsRecursive(t.id, overviewState.tasks);
    const li = document.createElement("li");
    li.className = "project-item project-item-clickable";

    const name = document.createElement("span");
    name.append(buildPinIcon(), " " + t.title);

    const meta = document.createElement("span");
    meta.className = "count";
    meta.textContent = `${areaName[t.area_id] || ""} · ${count}`;

    li.append(name, meta);
    li.addEventListener("click", () => {
      overviewState.collapsedAreas.delete(t.area_id);
      renderAreaTree();
      const el = document.getElementById("area-sec-" + t.area_id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    list.appendChild(li);
  }
}

// ----- Bereichs-Baum (Akkordeon) -----

function renderAreaTree() {
  const root = document.getElementById("area-tree");
  root.innerHTML = "";
  if (overviewState.areas.length === 0) {
    root.innerHTML = "";
    root.appendChild(buildEmptyState("Noch keine Bereiche", "Leg über das ⚙-Symbol oben die ersten Bereiche an."));
    return;
  }
  let rendered = 0;
  for (const area of overviewState.areas) {
    const section = buildAreaSection(area);
    if (section) {
      root.appendChild(section);
      rendered++;
    }
  }
  if (rendered === 0 && overviewState.filters.search) {
    root.innerHTML = "";
    root.appendChild(
      buildEmptyState(
        "Keine Treffer",
        `Nichts gefunden für „${overviewState.filters.search}".`,
        EMPTY_STATE_SEARCH_ICON
      )
    );
  }
}

// Segmentierter Umschalter Liste/Kanban — der aktive Modus ist als gefüllter Chip sichtbar (statt
// dass ein einzelner Button den jeweils anderen Modus als Label trägt). Auswahl bleibt über
// saveStoredFilters erhalten.
function wireViewModeToggle() {
  const switchEl = document.getElementById("view-mode-switch");
  if (!switchEl) return;
  updateViewModeLabel();
  switchEl.querySelectorAll(".view-mode-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode === "kanban" ? "kanban" : "list";
      if (overviewState.viewMode === mode) return;
      overviewState.viewMode = mode;
      saveStoredFilters();
      updateViewModeLabel();
      renderOverviewBody();
    });
  });
}

function updateViewModeLabel() {
  const switchEl = document.getElementById("view-mode-switch");
  if (!switchEl) return;
  switchEl.querySelectorAll(".view-mode-opt").forEach((btn) => {
    const active = btn.dataset.mode === overviewState.viewMode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

const KANBAN_COLUMNS = [
  { status: "open", title: "Offen" },
  { status: "planned", title: "Geplant" },
  { status: "done", title: "Erledigt" },
];

// Kanban-Darstellung: dieselben Top-Level-Aufgaben, nach Status in Spalten. Der Status-Filter greift
// hier bewusst nicht (die Spalten SIND die Status); Aufwand- und Suchfilter greifen weiter, die
// Erledigt-Spalte ist unabhängig von showDone immer sichtbar.
function renderKanbanBoard() {
  const board = document.getElementById("kanban-board");
  board.innerHTML = "";
  const { effort, search } = overviewState.filters;
  const topLevel = overviewState.tasks.filter((t) => {
    if (t.parent_task_id) return false;
    if (effort && String(t.effort) !== effort) return false;
    if (search && !t.title.toLowerCase().includes(search)) return false;
    return true;
  });

  for (const col of KANBAN_COLUMNS) {
    const column = document.createElement("div");
    column.className = "kanban-column";

    const header = document.createElement("div");
    header.className = "kanban-column-header";
    const heading = document.createElement("span");
    heading.className = "kanban-column-title";
    heading.textContent = col.title;
    const tasksInCol = topLevel.filter((t) => t.status === col.status).sort(compareByUrgency);
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(tasksInCol.length);
    header.append(heading, count);
    column.appendChild(header);

    const cards = document.createElement("div");
    cards.className = "kanban-cards";

    if (col.status === "done") {
      // Frische-Fenster (War Room 2026-07-26): die Erledigt-Spalte ist "was habe ich gerade
      // geschafft", kein Archiv. Nur diese Woche erledigte Karten stehen offen, Älteres klappt hinter
      // einer dezenten Zeile ein. Header-Count zeigt entsprechend die frische Anzahl.
      const weekStart = weekStartISO();
      const fresh = tasksInCol.filter((t) => (t.updated_at || "").slice(0, 10) >= weekStart);
      const older = tasksInCol.filter((t) => (t.updated_at || "").slice(0, 10) < weekStart);
      count.textContent = String(fresh.length);

      if (fresh.length === 0 && older.length === 0) {
        const empty = document.createElement("p");
        empty.className = "kanban-empty";
        empty.textContent = "—";
        cards.appendChild(empty);
      } else {
        fresh.forEach((task) => cards.appendChild(buildKanbanCard(task)));
        if (older.length > 0) {
          const olderWrap = document.createElement("div");
          olderWrap.className = "kanban-older";
          olderWrap.hidden = true;
          older.forEach((task) => olderWrap.appendChild(buildKanbanCard(task)));

          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "kanban-older-toggle";
          const setLabel = () => {
            toggle.textContent = olderWrap.hidden
              ? `… und ${older.length} früher erledigt`
              : "Früher erledigte ausblenden";
          };
          setLabel();
          toggle.addEventListener("click", () => {
            olderWrap.hidden = !olderWrap.hidden;
            setLabel();
          });
          cards.append(toggle, olderWrap);
        }
      }
    } else if (tasksInCol.length === 0) {
      const empty = document.createElement("p");
      empty.className = "kanban-empty";
      empty.textContent = "—";
      cards.appendChild(empty);
    } else {
      tasksInCol.forEach((task) => cards.appendChild(buildKanbanCard(task)));
    }

    column.appendChild(cards);
    board.appendChild(column);
  }
}

function buildKanbanCard(task) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "kanban-card";

  const area = overviewState.areas.find((a) => a.id === task.area_id);
  if (area) {
    const dot = document.createElement("span");
    dot.className = "task-area-dot";
    dot.style.background = area.color;
    card.appendChild(dot);
  }

  const title = document.createElement("span");
  title.className = "kanban-card-title";
  title.textContent = task.title;
  card.appendChild(title);

  if (task.effort != null) {
    const badge = document.createElement("span");
    badge.className = "count";
    badge.textContent = task.effort + "′";
    card.appendChild(badge);
  }

  if (overviewState.commentedTaskIds.has(task.id)) {
    const cdot = document.createElement("span");
    cdot.className = "comment-indicator";
    cdot.setAttribute("aria-label", "Hat Notizen");
    cdot.title = "Hat Notizen";
    card.appendChild(cdot);
  }

  card.addEventListener("click", () => openTaskDetail(task));
  return card;
}

// Baut die Bereichs-Section inkl. ihres Aufgabenbaums. Gibt null zurück, wenn eine aktive Suche
// in diesem Bereich keine Treffer hat — die Section wird dann komplett ausgeblendet statt leer
// angezeigt (außer es ist gerade das Inline-Add-Formular dort offen).
function buildAreaSection(area) {
  const isAddingHere =
    overviewState.addFormTarget &&
    overviewState.addFormTarget.areaId === area.id &&
    overviewState.addFormTarget.parentTaskId === null;
  const hasSearch = !!overviewState.filters.search;

  // Baum aus ALLEN Aufgaben des Bereichs (ungefiltert) bauen und erst danach auf sichtbare Knoten
  // zuschneiden — sonst würde buildTaskTree eine passende Unteraufgabe verwaisen lassen, wenn ihr
  // Elternteil selbst nicht durch den Filter kommt.
  const allAreaTasks = overviewState.tasks.filter((t) => t.area_id === area.id).sort(compareByUrgency);
  const tree = filterTreeNodes(buildTaskTree(allAreaTasks, null), taskPassesFilter);

  if (hasSearch && tree.length === 0 && !isAddingHere) return null;

  const section = document.createElement("section");
  section.className = "area-section";
  section.id = "area-sec-" + area.id;
  section.style.setProperty("--area-color", area.color);
  const collapsed = overviewState.collapsedAreas.has(area.id) && !isAddingHere && !hasSearch;

  const header = document.createElement("div");
  header.className = "area-section-header";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  toggle.textContent = collapsed ? "▸" : "▾";
  toggle.setAttribute("aria-label", collapsed ? "Aufklappen" : "Zuklappen");

  const dot = document.createElement("span");
  dot.className = "task-area-dot";
  dot.style.background = area.color;

  // Bereichs-Icon (falls gepflegt) vor dem Farbpunkt — schnellere Wiedererkennung beim Scrollen als
  // Farbe allein. Rein dekorativ, daher aria-hidden.
  let iconEl = null;
  if (area.icon) {
    iconEl = document.createElement("span");
    iconEl.className = "area-section-icon";
    iconEl.textContent = area.icon;
    iconEl.setAttribute("aria-hidden", "true");
  }

  const name = document.createElement("span");
  name.className = "area-section-name";
  name.textContent = area.name;

  const openCount = overviewState.tasks.filter((t) => t.area_id === area.id && t.status !== "done").length;

  // Ruhige Wochen-Aktivitätszahl statt Füllstand-Balken (War Room 2026-07-26): ein Lebensbereich
  // wird nie "fertig", ein erledigt/gesamt-Balken erzeugt darum ein Dauer-Defizit-Gefühl. Stattdessen
  // ein nach-oben-offener Ist-Snapshot "N diese Woche" — bewusst OHNE Soll-/Ziel-Vergleich. Bei 0
  // gar nicht anzeigen (kein "0 diese Woche", das brächte den Defizit-Effekt zurück).
  const weekStart = weekStartISO();
  const weekDone = allAreaTasks.filter(
    (t) => t.status === "done" && (t.updated_at || "").slice(0, 10) >= weekStart
  ).length;
  const weekActivity = document.createElement("span");
  weekActivity.className = "area-week-activity";
  weekActivity.hidden = weekDone === 0;
  weekActivity.textContent = `${weekDone} diese Woche`;
  weekActivity.title = `${weekDone} diese Woche erledigt`;
  weekActivity.setAttribute("aria-label", weekActivity.title);

  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(openCount);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "icon-btn";
  addBtn.textContent = "+";
  addBtn.setAttribute("aria-label", "Aufgabe hinzufuegen");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    overviewState.addFormTarget = isAddingHere ? null : { areaId: area.id, parentTaskId: null };
    // Nur beim tatsächlichen Öffnen automatisch fokussieren — renderAreaTree() läuft auch bei
    // jedem Suche-Tastenanschlag neu und würde sonst den Fokus aus der Suche ins (dabei komplett
    // neu gebaute) Formular reißen, obwohl es längst offen ist.
    overviewState.addFormJustOpened = !isAddingHere;
    renderAreaTree();
  });

  const toggleFn = () => {
    if (overviewState.collapsedAreas.has(area.id)) overviewState.collapsedAreas.delete(area.id);
    else overviewState.collapsedAreas.add(area.id);
    renderAreaTree();
  };
  toggle.addEventListener("click", toggleFn);
  name.addEventListener("click", toggleFn);

  header.append(toggle, ...(iconEl ? [iconEl] : []), dot, name, weekActivity, count, addBtn);
  section.appendChild(header);

  // Leere Bereiche (keine offenen Aufgaben) zurücknehmen, damit volle Bereiche hervortreten — nur
  // gedämpft, nicht zwangsweise eingeklappt (die manuelle Zuklapp-Entscheidung des Nutzers bleibt).
  section.classList.toggle("is-empty", openCount === 0 && !isAddingHere && !hasSearch);

  // Body steckt immer im DOM (in einem grid-rows-Wrapper) statt bei "collapsed" ganz zu
  // verschwinden — nur so lässt sich das Auf-/Zuklappen sanft animieren statt hart umzuschalten.
  const bodyWrap = document.createElement("div");
  bodyWrap.className = "accordion-wrap";
  bodyWrap.dataset.collapsed = String(collapsed);

  const body = document.createElement("div");
  body.className = "area-section-body";

  if (isAddingHere) body.appendChild(buildInlineAddForm(area.id, null));

  tree.forEach((node) => body.appendChild(buildTaskNodeEl(node, area, 0)));

  if (!isAddingHere && tree.length === 0) {
    body.appendChild(buildEmptyState("Noch leer hier", "Leg über das + oben die erste Aufgabe für diesen Bereich an."));
  }

  bodyWrap.appendChild(body);
  section.appendChild(bodyWrap);
  return section;
}

function buildTaskNodeEl(node, area, depth) {
  const wrap = document.createElement("div");
  wrap.className = "tree-node";
  const hasSearch = !!overviewState.filters.search;
  const collapsed = overviewState.collapsedNodes.has(node.id) && !hasSearch;

  const header = document.createElement("div");
  header.className =
    "tree-node-header" + (isTaskOverdue(node) ? " is-overdue" : isTaskDueSoon(node) ? " is-due-soon" : "");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  if (node.children.length > 0) {
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.addEventListener("click", () => {
      if (overviewState.collapsedNodes.has(node.id)) overviewState.collapsedNodes.delete(node.id);
      else overviewState.collapsedNodes.add(node.id);
      renderAreaTree();
    });
  } else {
    toggle.disabled = true;
    toggle.setAttribute("aria-hidden", "true");
  }

  const checkbox = document.createElement("button");
  checkbox.type = "button";
  checkbox.className = "task-checkbox";
  checkbox.dataset.checked = String(node.status === "done");
  checkbox.setAttribute("aria-pressed", String(node.status === "done"));
  checkbox.setAttribute("aria-label", node.title);
  checkbox.textContent = node.status === "done" ? "✓" : "";
  checkbox.addEventListener("click", async (e) => {
    e.stopPropagation();
    await withErrorToast(async () => {
      let unmutedFollowups = false;
      if (node.status === "done") {
        await reopenTaskCascade(node, overviewState.tasks);
      } else {
        unmutedFollowups = await completeTaskCascade(node, overviewState.tasks);
        showCompleteUndoToast(node, overviewState.tasks, reloadOverview);
        if (!isWatchlistTask(node) && !isHabitTask(node)) await openTaskFeedbackSheet(node);
      }
      reloadOverview();
      await triggerFollowupPopupAfterCompletion(unmutedFollowups);
    });
  });

  const descendantCount = countDescendantsRecursive(node.id, overviewState.tasks);
  const nodeCount = document.createElement("span");
  nodeCount.className = "count";
  if (descendantCount > 0) {
    nodeCount.textContent = `${descendantCount} Unteraufgabe${descendantCount === 1 ? "" : "n"}`;
  } else {
    nodeCount.hidden = true;
  }

  header.append(toggle, checkbox, buildTaskNameEl(node), nodeCount);
  if (isTaskOverdue(node)) {
    const overdueBadge = document.createElement("span");
    overdueBadge.className = "badge badge-overdue";
    overdueBadge.innerHTML = BADGE_ICON_OVERDUE + "Überfällig";
    header.appendChild(overdueBadge);
  }

  wrap.appendChild(header);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "accordion-wrap";
  bodyWrap.dataset.collapsed = String(collapsed);

  const body = document.createElement("div");
  body.className = "tree-node-body";

  node.children.forEach((child) => body.appendChild(buildTaskNodeEl(child, area, depth + 1)));

  bodyWrap.appendChild(body);
  wrap.appendChild(bodyWrap);
  return wrap;
}

// Zeigt den Aufgabentitel als Text an. Ein Klick öffnet die Aufgaben-Detailansicht — Umbenennen,
// Verschieben, Anheften und Löschen laufen seitdem über deren Bearbeiten-Modus statt über ein
// eigenes Zeilen-Menü.
function buildTaskNameEl(node) {
  const name = document.createElement("span");
  name.className = "tree-node-name task-title-btn";
  if (node.is_pinned) name.append(buildPinIcon(), " ");
  name.append(node.title);
  if (overviewState.commentedTaskIds.has(node.id)) {
    const dot = document.createElement("span");
    dot.className = "comment-indicator";
    dot.setAttribute("aria-label", "Hat Notizen");
    dot.title = "Hat Notizen";
    name.appendChild(dot);
  }
  name.addEventListener("click", () => openTaskDetail(node));
  return name;
}

// Inline-Formular zum Anlegen einer Aufgabe (optional als Unteraufgabe) — ersetzt den frueheren
// prompt()/confirm()-Flow.
function buildInlineAddForm(areaId, parentTaskId) {
  const form = document.createElement("form");
  form.className = "inline-add-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "input";
  nameInput.placeholder = "Titel";
  nameInput.autocomplete = "off";
  nameInput.required = true;

  const dateChips = createDateChipGroup();

  // Effort-Chips analog td-subtask-effort/brainstorm-effort — direkter Klick statt des früheren
  // Umwegs über das Detail-Modal-Dropdown. Toggle-Verhalten: erneuter Klick auf den aktiven Chip
  // deaktiviert ihn wieder, null bleibt ein gültiger Zustand ("kein Aufwand angegeben").
  const effortGroup = document.createElement("div");
  effortGroup.className = "effort-chips";
  effortGroup.setAttribute("role", "group");
  effortGroup.setAttribute("aria-label", "Aufwand");
  let selectedEffort = null;
  for (const value of [5, 10, 30, 60]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "effort-chip";
    chip.dataset.effort = String(value);
    chip.textContent = String(value);
    chip.addEventListener("click", () => {
      selectedEffort = selectedEffort === value ? null : value;
      effortGroup.querySelectorAll(".effort-chip").forEach((c) => {
        c.dataset.active = String(Number(c.dataset.effort) === selectedEffort);
      });
    });
    effortGroup.appendChild(chip);
  }

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn";
  submitBtn.textContent = "Anlegen";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Abbrechen";
  cancelBtn.addEventListener("click", () => {
    overviewState.addFormTarget = null;
    renderAreaTree();
  });

  form.append(nameInput, dateChips.el, effortGroup, submitBtn, cancelBtn);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Verhindert Doppel-Anlagen bei schnellem Doppelklick/Doppel-Enter, solange der vorherige
    // Request noch läuft.
    if (submitBtn.disabled) return;
    const title = nameInput.value.trim();
    if (!title) return;
    const plannedDate = dateChips.getPlannedDate();
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createTask({
          title,
          areaId,
          parentTaskId,
          plannedDate,
          effort: selectedEffort,
          status: plannedDate ? "planned" : "open",
        });
        overviewState.addFormTarget = null;
        overviewState.collapsedAreas.delete(areaId);
        if (parentTaskId) overviewState.collapsedNodes.delete(parentTaskId);
        reloadOverview();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Nur fokussieren, wenn das Formular gerade eben geöffnet wurde — nicht bei jedem Rebuild durch
  // z.B. Suche-Tastenanschläge, sonst würde der Fokus mitten beim Tippen woanders hinspringen.
  if (overviewState.addFormJustOpened) {
    overviewState.addFormJustOpened = false;
    requestAnimationFrame(() => nameInput.focus());
  }
  return form;
}

// ----- Ohne Bereich (Brainstorm / lose Aufgaben) -----

function renderNoAreaSection() {
  const panel = document.getElementById("no-area-panel");
  const list = document.getElementById("brainstorm-list");
  // Watchlist-Einträge haben ebenfalls keine area_id, gehören aber ins Fernsehprogramm statt in die
  // "Ohne Bereich"-Liste hier — sonst tauchen Serien/Filme fälschlich in der Übersicht auf.
  const noArea = overviewState.tasks
    .filter((t) => !t.area_id && !isWatchlistTask(t) && taskPassesFilter(t))
    .sort(compareByUrgency);

  // Auswahl auf noch sichtbare Aufgaben begrenzen (z.B. nach Filterwechsel oder Zuweisung).
  const visibleIds = new Set(noArea.map((t) => t.id));
  for (const id of overviewState.selectedBrainstormIds) {
    if (!visibleIds.has(id)) overviewState.selectedBrainstormIds.delete(id);
  }

  if (noArea.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  list.innerHTML = "";

  for (const task of noArea) {
    const li = document.createElement("li");
    li.className = "brainstorm-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "brainstorm-select";
    checkbox.setAttribute("aria-label", "Auswählen: " + task.title);
    checkbox.checked = overviewState.selectedBrainstormIds.has(task.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) overviewState.selectedBrainstormIds.add(task.id);
      else overviewState.selectedBrainstormIds.delete(task.id);
      renderBulkToolbar();
    });

    const title = document.createElement("button");
    title.type = "button";
    title.className = "task-title task-title-btn";
    title.textContent = task.title;
    title.addEventListener("click", () => openTaskDetail(task));

    const areaSelect = document.createElement("select");
    areaSelect.className = "select";
    areaSelect.innerHTML =
      `<option value="">Bereich zuweisen</option>` +
      overviewState.areas.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
    areaSelect.addEventListener("change", async () => {
      await withErrorToast(async () => {
        const newAreaId = areaSelect.value || null;
        await updateTask(task.id, { area_id: newAreaId, is_brainstorm: false });
        await cascadeAreaChange(task.id, newAreaId, overviewState.tasks);
        reloadOverview();
      });
    });

    li.append(checkbox, title, areaSelect);
    list.appendChild(li);
  }

  renderBulkToolbar();
}

// Sammel-Aktionen-Leiste über der "Ohne Bereich"-Liste — nur sichtbar, solange mindestens eine
// Aufgabe ausgewählt ist. Löschen nutzt denselben Snapshot/Wiederherstellen-Mechanismus wie
// deleteTaskWithUndo, nur für mehrere Aufgaben auf einmal.
function renderBulkToolbar() {
  const toolbar = document.getElementById("brainstorm-bulk-toolbar");
  if (!toolbar) return;
  const selectedIds = Array.from(overviewState.selectedBrainstormIds);
  toolbar.innerHTML = "";
  if (selectedIds.length === 0) {
    toolbar.hidden = true;
    return;
  }
  toolbar.hidden = false;

  const count = document.createElement("span");
  count.className = "bulk-toolbar-count";
  count.textContent = `${selectedIds.length} ausgewählt`;

  const areaSelect = document.createElement("select");
  areaSelect.className = "select";
  areaSelect.innerHTML =
    `<option value="">Bereich zuweisen…</option>` +
    overviewState.areas.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  areaSelect.addEventListener("change", async () => {
    const areaId = areaSelect.value;
    if (!areaId) return;
    await withErrorToast(async () => {
      await Promise.all(
        selectedIds.map(async (id) => {
          await updateTask(id, { area_id: areaId, is_brainstorm: false });
          await cascadeAreaChange(id, areaId, overviewState.tasks);
        })
      );
      overviewState.selectedBrainstormIds.clear();
      showToast(`${selectedIds.length} Aufgabe(n) zugewiesen.`);
      reloadOverview();
    });
  });

  const pinBtn = document.createElement("button");
  pinBtn.type = "button";
  pinBtn.className = "btn btn-secondary";
  pinBtn.textContent = "Anheften";
  pinBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await Promise.all(selectedIds.map((id) => updateTask(id, { is_pinned: true })));
      overviewState.selectedBrainstormIds.clear();
      showToast(`${selectedIds.length} Aufgabe(n) angeheftet.`);
      reloadOverview();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-secondary";
  deleteBtn.textContent = "Löschen";
  deleteBtn.addEventListener("click", async () => {
    // Kein Bestätigungs-Dialog nötig — der Toast unten bietet direkt "Rückgängig" an
    // (gleiches Muster wie deleteTaskWithUndo für Einzel-Löschungen).
    const byId = new Map(overviewState.tasks.map((t) => [t.id, t]));
    // Falls sowohl eine Aufgabe als auch eine ihrer eigenen (ebenfalls bereichslosen)
    // Unteraufgaben ausgewählt sind: nur vom obersten ausgewählten Vorfahren aus einen Snapshot
    // bauen, sonst würde die Unteraufgabe beim Rückgängig-Machen doppelt wiederhergestellt.
    const selectedIdSet = new Set(selectedIds);
    const isDescendantOfAnotherSelected = (id) => {
      let current = byId.get(id);
      while (current?.parent_task_id) {
        if (selectedIdSet.has(current.parent_task_id)) return true;
        current = byId.get(current.parent_task_id);
      }
      return false;
    };
    const snapshots = selectedIds
      .filter((id) => !isDescendantOfAnotherSelected(id))
      .map((id) => ({
        task: byId.get(id),
        descendants: Array.from(collectDescendantIds(overviewState.tasks, id))
          .map((cid) => byId.get(cid))
          .filter(Boolean),
      }))
      .filter((s) => s.task);
    await withErrorToast(async () => {
      await Promise.all(selectedIds.map((id) => deleteTask(id)));
      overviewState.selectedBrainstormIds.clear();
      reloadOverview();
      showToast(`${snapshots.length} Aufgabe(n) gelöscht.`, false, {
        label: "Rückgängig",
        onClick: () =>
          withErrorToast(async () => {
            for (const s of snapshots) await restoreTaskSnapshot(s.task, s.descendants);
            reloadOverview();
          }),
      });
    });
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "icon-btn";
  cancelBtn.textContent = "×";
  cancelBtn.setAttribute("aria-label", "Auswahl aufheben");
  cancelBtn.addEventListener("click", () => {
    overviewState.selectedBrainstormIds.clear();
    renderNoAreaSection();
  });

  toolbar.append(count, areaSelect, pinBtn, deleteBtn, cancelBtn);
}

/* ---------- Bereiche (Verwaltung, Teil der Übersicht) ---------- */

// Sperrt alle Auf/Ab/Löschen-Buttons der Bereichsliste während einer laufenden Aktion — verhindert,
// dass ein schneller Doppelklick (oder ein Klick auf eine andere Zeile, während eine erste
// Umsortierung noch läuft) zwei sich überschneidende Updates auslöst, die dieselbe sort_order
// doppelt vergeben könnten. reloadOverview() ersetzt bei Erfolg ohnehin die ganze Liste; bei einem
// Fehler (den withErrorToast abfängt, ohne erneut zu werfen) werden die Buttons wieder freigegeben.
async function withLockedAreaControls(action) {
  const buttons = document.querySelectorAll("#area-manage-list .area-manage-controls button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    await withErrorToast(action);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// Beide Aufrufer (renderOverviewView/reloadOverview) haben die Bereiche direkt davor per
// loadOverviewData() frisch geladen — kein zweiter listAreas()-Request nötig.
async function renderAreaManageList() {
  const list = document.getElementById("area-manage-list");
  const areas = overviewState.areas;
  list.innerHTML = "";

  if (areas.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Noch keine Bereiche.";
    list.appendChild(empty);
    return;
  }

  areas.forEach((area, index) => {
    list.appendChild(buildAreaManageItem(area, areas, index));
  });
}

function buildAreaManageItem(area, areas, index) {
  const li = document.createElement("li");
  li.className = "area-manage-item";
  li.dataset.areaId = area.id;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "icon-btn drag-handle";
  handle.appendChild(buildDragHandleIcon());
  handle.setAttribute("aria-hidden", "true");
  handle.tabIndex = -1;
  wireAreaDragHandle(li, handle);

  const color = document.createElement("input");
  color.type = "color";
  color.className = "color-input";
  color.value = area.color || "#888888";
  color.setAttribute("aria-label", "Farbe von " + area.name);
  color.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateArea(area.id, { color: color.value });
      reloadOverview();
    });
  });

  const colorWarning = document.createElement("span");
  colorWarning.className = "color-warning";
  colorWarning.textContent = "⚠";
  colorWarning.title = "Dieser Farbton ist auf hellem oder dunklem Hintergrund schwer erkennbar.";
  colorWarning.hidden = true;
  wireColorContrastWarning(color, colorWarning);

  const name = document.createElement("input");
  name.type = "text";
  name.className = "input area-name-input";
  name.value = area.name;
  name.setAttribute("aria-label", "Name des Bereichs");
  const commitName = async () => {
    const newName = name.value.trim();
    if (!newName || newName === area.name) {
      name.value = area.name;
      return;
    }
    try {
      await updateArea(area.id, { name: newName });
      reloadOverview();
    } catch (err) {
      name.value = area.name;
      showToast("Umbenennen fehlgeschlagen: " + friendlyErrorMessage(err), true);
    }
  };
  name.addEventListener("blur", commitName);
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") name.blur();
  });

  const controls = document.createElement("div");
  controls.className = "area-manage-controls";

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "icon-btn";
  upBtn.textContent = "↑";
  upBtn.setAttribute("aria-label", "Nach oben");
  upBtn.disabled = index === 0;
  upBtn.addEventListener("click", async () => {
    await withLockedAreaControls(async () => {
      await swapAreaOrder(area, areas[index - 1]);
      reloadOverview();
    });
  });

  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "icon-btn";
  downBtn.textContent = "↓";
  downBtn.setAttribute("aria-label", "Nach unten");
  downBtn.disabled = index === areas.length - 1;
  downBtn.addEventListener("click", async () => {
    await withLockedAreaControls(async () => {
      await swapAreaOrder(area, areas[index + 1]);
      reloadOverview();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Bereich löschen");
  deleteBtn.addEventListener("click", async () => {
    const proceed = await showConfirm(
      `Bereich „${area.name}" löschen? Zugeordnete Aufgaben bleiben erhalten, verlieren aber ihren Bereich.`,
      { confirmLabel: "Löschen", cancelLabel: "Abbrechen", danger: true }
    );
    if (!proceed) return;
    await withLockedAreaControls(async () => {
      await deleteArea(area.id);
      reloadOverview();
    });
  });

  controls.append(upBtn, downBtn, deleteBtn);
  li.append(handle, color, colorWarning, name, controls);
  return li;
}

// Touch-/Maus-Drag zum Umsortieren der Bereichsliste per Pointer Events (kein natives HTML5
// draggable — das ist auf Touch, v.a. iOS Safari, unzuverlässig bis nicht funktionsfähig). Die
// Auf/Ab-Pfeile bleiben zusätzlich bestehen, da Drag nicht tastaturzugänglich ist. Verschiebt das
// li während des Ziehens live per Transform, tauscht die DOM-Position bei Überschreiten der
// Nachbar-Mitte, und persistiert bei pointerup die dann sichtbare Reihenfolge als neue sort_order.
function wireAreaDragHandle(li, handle) {
  let pointerId = null;
  let originY = 0;
  let moved = false; // bleibt false bei einem reinen Tap ohne Bewegung — dann nichts persistieren/neu laden

  const onPointerMove = (e) => {
    if (e.pointerId !== pointerId) return;
    const dy = e.clientY - originY;
    li.style.transform = `translateY(${dy}px)`;

    const liRect = li.getBoundingClientRect();
    const liMid = liRect.top + liRect.height / 2;

    const prev = li.previousElementSibling;
    if (prev) {
      const prevRect = prev.getBoundingClientRect();
      if (liMid < prevRect.top + prevRect.height / 2) {
        li.parentElement.insertBefore(li, prev);
        originY = e.clientY;
        li.style.transform = "translateY(0px)";
        moved = true;
        return;
      }
    }
    const next = li.nextElementSibling;
    if (next) {
      const nextRect = next.getBoundingClientRect();
      if (liMid > nextRect.top + nextRect.height / 2) {
        li.parentElement.insertBefore(li, next.nextSibling);
        originY = e.clientY;
        li.style.transform = "translateY(0px)";
        moved = true;
      }
    }
  };

  const onPointerUp = (e) => {
    if (e.pointerId !== pointerId) return;
    handle.releasePointerCapture(pointerId);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", onPointerUp);
    handle.removeEventListener("pointercancel", onPointerUp);
    pointerId = null;
    li.style.transform = "";
    li.classList.remove("is-dragging");
    if (!moved) return;

    const list = li.parentElement;
    if (!list) return;
    const orderedIds = Array.from(list.querySelectorAll(".area-manage-item")).map((el) => el.dataset.areaId);
    withErrorToast(async () => {
      await Promise.all(orderedIds.map((id, i) => updateArea(id, { sort_order: i })));
      reloadOverview();
    });
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    pointerId = e.pointerId;
    originY = e.clientY;
    moved = false;
    handle.setPointerCapture(pointerId);
    li.classList.add("is-dragging");
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  });
}

function wireNewAreaForm() {
  const form = document.getElementById("new-area-form");
  const nameInput = document.getElementById("new-area-name");
  const colorInput = document.getElementById("new-area-color");
  wireColorContrastWarning(colorInput, document.getElementById("new-area-color-warning"));

  const submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      const areas = await listAreas();
      const maxSort = areas.reduce((m, a) => Math.max(m, a.sort_order ?? 0), -1);
      await createArea({ name, color: colorInput.value, sort_order: maxSort + 1 });
      nameInput.value = "";
      colorInput.value = "#378ADD";
      reloadOverview();
    } catch (err) {
      showToast("Anlegen fehlgeschlagen: " + friendlyErrorMessage(err), true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}
