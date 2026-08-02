import { getSession, onAuthStateChange, signInWithMagicLink, ensureAreasSeeded, updateUsername } from "./auth.js";
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
  planTaskCascade,
  cascadeAreaChange,
} from "./tasks.js";
import { listAreas, createArea, updateArea, deleteArea, swapAreaOrder } from "./areas.js";
import {
  suggestTasksForPlan,
  formatTasksForExport,
  savePlanForDate,
  budgetForDate,
  buildEffortClassSlots,
  buildAreaRotationQueue,
  isPlannableCandidate,
} from "./planner.js";
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  listFixedCosts,
  createFixedCost,
  updateFixedCost,
  deleteFixedCost,
  listCommittedExpenses,
  createCommittedExpense,
  updateCommittedExpense,
  deleteCommittedExpense,
  listDebts,
  createDebt,
  updateDebt,
  deleteDebt,
  listExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  clearTransactionCategory,
  slugifyCategoryKey,
  getFinanceModuleSettings,
  updateFinanceModuleSettings,
  computeCategoryBreakdown,
  computeBudgetTrend,
  computeSalaryWaterfall,
} from "./finance.js";
import {
  listWishlistItems,
  createWishlistItem,
  updateWishlistItem,
  deleteWishlistItem,
  getSavingsPotBalance,
  listSavingsPotEntries,
  filterBuyReady,
} from "./wishlist.js";
import {
  WEEKDAY_CODES,
  isHabitTask,
  isCounterHabit,
  findHabitsDueToday,
  autoplanDueHabits,
  weekdayCodeFromIso,
  RECURRENCE_LABEL,
  listAllHabitCompletions,
  computeHabitStreak,
  logCounterTap,
  deleteCounterEntry,
  listAllCounterLog,
  sumCounterForDate,
  weekAverageCounter,
} from "./habits.js";
import {
  listWatchlistItems,
  createWatchlistItem,
  updateWatchlistItem,
  deleteWatchlistItem,
  listViewingLog,
  listAllViewingLogEntries,
  logViewing,
  deleteViewingLogEntry,
  isWatchlistTask,
  getEffectiveDuration,
  computeAverageRating,
  filterWatchlistItems,
  currentWeekDates,
  // autoplanWatchlistForDates: seit 2026-07-29 wieder aktiv, aber NUR im Fernsehprogramm-Tab
  // (renderFernsehprogrammView), nicht in der Heute-Ansicht. Aktive Watchlist-Einträge füllen die
  // Woche automatisch; renderTodayView filtert die entstehenden Watchlist-tasks-Zeilen weiterhin aus
  // (siehe dortiger Filter), damit sie nur im TV-Tab und nicht in Heute/Tagesplan auftauchen. Details:
  // wissensdatenbank/features/watchlist-fernsehprogramm.md, Abschnitt "Zugang & Grundmechanik".
  autoplanWatchlistForDates,
  applyWatchlistSwap,
} from "./watchlist.js";
import { listBirthdays, createBirthday, updateBirthday, deleteBirthday, daysUntilNextOccurrence, nextOccurrence } from "./birthdays.js";
import { listRecipes, createRecipe, updateRecipe, deleteRecipe, formatIngredientsForShoppingList } from "./recipes.js";
import { listPantryItems, createPantryItem, updatePantryItem, deletePantryItem } from "./pantry.js";
import { listGames, createGame, updateGame, deleteGame } from "./games.js";
import { listBooks, createBook, updateBook, deleteBook, listReadingLog, logReadingSession, sumPagesInMonth, sumChaptersInMonth } from "./books.js";
import { listComments, listAllCommentedTaskIds, createComment, deleteComment } from "./comments.js";
import { getReflectionForDate, createReflection } from "./reflections.js";
import { listOpenFollowupGroups, countOpenFollowups, resolveFollowupGroup } from "./followups.js";
import {
  getStoredTheme,
  applyTheme,
  getBackgroundImageBlob,
  saveBackgroundImageBlob,
  clearBackgroundImage,
  resizeImageToBlob,
} from "./personalization.js";

// Muss vor dem ersten Render laufen, sonst blitzt beim Start kurz das System-Theme auf, bevor die
// gespeicherte Wahl greift (siehe wissensdatenbank/features/personalisierung.md).
const storedTheme = getStoredTheme();
if (storedTheme) document.documentElement.dataset.theme = storedTheme;

// Hintergrundbild ist rein lokal (IndexedDB) und unabhängig vom Login-Status gültig — direkt beim
// Skriptstart anwenden, nicht erst nach erfolgreicher Anmeldung.
getBackgroundImageBlob().then((blob) => {
  if (blob) {
    document.getElementById("app-bg").style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
    document.body.classList.add("has-bg-image");
  }
});

const app = document.getElementById("app");

const routes = {
  today: renderTodayView,
  cockpit: renderCockpitView,
  overview: renderOverviewView,
  plan: renderPlanView,
  habits: renderHabitsView,
  finance: renderFinanceView,
  fernsehprogramm: renderFernsehprogrammView,
  rezepte: renderRezepteView,
  kuehlschrank: renderKuehlschrankView,
  games: renderGamesView,
  books: renderBooksView,
  fixkosten: renderFixkostenView,
  "verpflichtende-ausgaben": renderVerpflichtendeAusgabenView,
  debts: renderDebtsView,
  "expense-categories": renderExpenseCategoriesView,
};

const WEEKDAY_LABEL = { mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So" };

// Kleine Icons vor Badge-Text — macht "Habit"/"Brainstorm"/"Überfällig" beim schnellen Scrollen
// schneller unterscheidbar als drei ähnlich lange Wörter in ähnlichen Farbtönen.
const BADGE_ICON_HABIT = `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>`;
const BADGE_ICON_BRAINSTORM = `<svg viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-3 11.2c.6.4 1 1.1 1 1.8v.5h4v-.5c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 2Z"/></svg>`;
const BADGE_ICON_OVERDUE = `<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>`;
// SVG statt Emoji für die Streak-Anzeige (Konvention der App: konsistente Strich-Icons statt
// Emoji, die je nach Betriebssystem unterschiedlich rendern).
const STREAK_ICON_FLAME = `<svg viewBox="0 0 24 24"><path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c1.5 1 2 3 2 4.5A5.5 5.5 0 0 1 6 14.5C6 9 12 7 12 2z"/></svg>`;

const FILTER_STORAGE_KEY = "leben-os:overview-filters";

function loadStoredFilters() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

const storedFilters = loadStoredFilters();

const overviewState = {
  areas: [],
  tasks: [],
  filters: {
    effort: storedFilters?.effort || "",
    status: storedFilters?.status || "",
    search: storedFilters?.search || "",
  },
  showDone: storedFilters?.showDone || false,
  viewMode: storedFilters?.viewMode === "kanban" ? "kanban" : "list",
  collapsedAreas: new Set(),
  collapsedNodes: new Set(),
  commentedTaskIds: new Set(), // siehe loadOverviewData() — für den dezenten Notizen-Indikator in buildTaskNameEl
  addFormTarget: null, // { areaId, parentTaskId: null } | null — offenes "Aufgabe anlegen"-Formular auf Bereichs-Ebene
  addFormJustOpened: false, // true nur für den einen Render direkt nach dem Öffnen — steuert das Autofokus
  selectedBrainstormIds: new Set(), // Mehrfachauswahl in der "Ohne Bereich"-Liste für Sammel-Aktionen
};

// Räumt ein offenes Detail-Modal vollständig auf (DOM, Scroll-Sperre, Escape-Listener).
// Wird von openTaskDetail() gesetzt und von renderShell() aufgerufen, falls beim
// Ansichtswechsel noch ein Modal offen ist — sonst bliebe der Escape-Listener für immer hängen.
let closeActiveModal = null;

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

let toastTimeout = null;
// action = { label, onClick } | null — zeigt einen Aktions-Button im Toast (z.B. "Rückgängig").
function showToast(message, isError = false, action = null) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.className = "toast" + (isError ? " toast-error" : "");
  toast.innerHTML = "";

  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      clearTimeout(toastTimeout);
      toast.hidden = true;
      action.onClick();
    });
    toast.appendChild(btn);
  }

  toast.onclick = (e) => {
    if (e.target.closest(".toast-action")) return;
    clearTimeout(toastTimeout);
    toast.hidden = true;
  };

  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, action ? 6000 : 2000);
}

// Ersetzt window.confirm() durch ein Modal im App-eigenen Stil (nutzt dieselbe #modal-root/
// closeActiveModal-Infrastruktur wie das Aufgaben-Detail-Modal, siehe openTaskDetail()). Löst mit
// true bei Bestätigen, mit false bei Abbrechen/Escape/Backdrop-Klick auf. Nur für Fälle gedacht,
// die sich nicht sinnvoll per Undo-Toast lösen lassen (z.B. Seite verlassen, Bereich löschen) —
// für einfache, rückgängig machbare Löschaktionen lieber direkt löschen + showToast(...,{Rückgängig}).
function showConfirm(message, { confirmLabel = "Bestätigen", cancelLabel = "Abbrechen", danger = false } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    document.body.style.overflow = "hidden";

    const close = (result) => {
      root.innerHTML = "";
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
      closeActiveModal = null;
      resolve(result);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") close(false);
    };
    document.addEventListener("keydown", onKeydown);
    closeActiveModal = () => close(false);

    root.innerHTML = `
      <div class="modal-backdrop" id="confirm-backdrop">
        <div class="modal-card" role="alertdialog" aria-modal="true">
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="btn" type="button" id="confirm-ok" style="${danger ? "background:var(--color-danger)" : ""}">${escapeHtml(confirmLabel)}</button>
            <button class="btn btn-secondary" type="button" id="confirm-cancel">${escapeHtml(cancelLabel)}</button>
          </div>
        </div>
      </div>`;
    document.getElementById("confirm-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "confirm-backdrop") close(false);
    });
    document.getElementById("confirm-ok").addEventListener("click", () => close(true));
    document.getElementById("confirm-cancel").addEventListener("click", () => close(false));
  });
}

// Übersetzt rohe Supabase/Postgres-Fehler in verständliche deutsche Meldungen. Fehlercodes
// 23505/23503/23502 sind die Standard-Postgres-Codes für unique/foreign-key/not-null-violation.
function friendlyErrorMessage(err) {
  const message = err?.message || "";
  if (err instanceof TypeError || /Failed to fetch|NetworkError/i.test(message)) {
    return "Keine Verbindung — bitte Internet prüfen und nochmal versuchen.";
  }
  if (err?.code === "23505") return "Das gibt es unter diesem Namen schon.";
  if (err?.code === "23503") return "Das referenzierte Element existiert nicht mehr.";
  if (err?.code === "23502") return "Ein Pflichtfeld fehlt.";
  if (/row-level security/i.test(message)) return "Du hast keine Berechtigung für diese Aktion.";
  if (/rate limit/i.test(message)) return "Zu viele Versuche — bitte kurz warten.";
  if (/JWT expired|invalid claim|invalid or expired|session.*not.*found/i.test(message)) {
    return "Deine Sitzung ist abgelaufen. Bitte die Seite neu laden und erneut anmelden.";
  }
  return message || "Etwas ist schiefgelaufen.";
}

// Zeigt einen Lade-Hinweis in einem Container, solange dessen eigentlicher Inhalt noch per
// Supabase-Request nachgeladen wird (das View-HTML selbst ist bereits da, aber leer).
function showLoading(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = `<p class="loading-state">Lädt…</p>`;
}

// Führt eine mutierende Aktion aus und zeigt bei Fehlern einen Toast statt still zu scheitern.
async function withErrorToast(action) {
  try {
    await action();
  } catch (err) {
    showToast(friendlyErrorMessage(err), true);
  }
}

// Löscht eine Aufgabe (inkl. serverseitig kaskadierter Unteraufgaben, siehe tasks.parent_task_id
// "on delete cascade") und bietet direkt im Toast ein "Rückgängig" an. Da Postgres das Kaskadieren
// übernimmt, sichern wir vorher eine vollständige Kopie aller betroffenen Aufgaben, um sie bei
// Bedarf per createTask wiederherzustellen (mit neuen IDs — die alte Eltern-Kind-Struktur bleibt
// über die Reihenfolge der Wiederherstellung erhalten).
async function deleteTaskWithUndo(task, allTasks, afterChange) {
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const descendants = Array.from(collectDescendantIds(allTasks, task.id))
    .map((id) => byId.get(id))
    .filter(Boolean);

  await deleteTask(task.id);
  afterChange();

  const message =
    descendants.length > 0
      ? `„${task.title}" und ${descendants.length} Unteraufgabe(n) gelöscht.`
      : `„${task.title}" gelöscht.`;
  showToast(message, false, {
    label: "Rückgängig",
    onClick: () =>
      withErrorToast(async () => {
        await restoreTaskSnapshot(task, descendants);
        afterChange();
      }),
  });
}

// Baut eine per deleteTaskWithUndo gesicherte Aufgabe (+ Nachfahren) wieder auf. Der Elternteil
// des gelöschten Wurzelknotens bleibt unverändert (existiert ja noch), Nachfahren werden entlang
// ihrer ursprünglichen Baumstruktur neu verknüpft.
async function restoreTaskSnapshot(task, descendants) {
  const oldToNewId = new Map();
  const createdRoot = await createTask({
    title: task.title,
    areaId: task.area_id,
    parentTaskId: task.parent_task_id,
    effort: task.effort,
    status: task.status,
    plannedDate: task.planned_date,
    isBrainstorm: task.is_brainstorm,
    isPinned: task.is_pinned,
    priority: task.priority,
    isEvent: task.is_event,
  });
  oldToNewId.set(task.id, createdRoot.id);

  const byOldParent = new Map();
  for (const t of descendants) {
    if (!byOldParent.has(t.parent_task_id)) byOldParent.set(t.parent_task_id, []);
    byOldParent.get(t.parent_task_id).push(t);
  }
  const insertChildren = async (oldParentId) => {
    for (const t of byOldParent.get(oldParentId) || []) {
      const created = await createTask({
        title: t.title,
        areaId: t.area_id,
        parentTaskId: oldToNewId.get(t.parent_task_id),
        effort: t.effort,
        status: t.status,
        plannedDate: t.planned_date,
        isBrainstorm: t.is_brainstorm,
        isPinned: t.is_pinned,
        priority: t.priority,
        isEvent: t.is_event,
      });
      oldToNewId.set(t.id, created.id);
      await insertChildren(t.id);
    }
  };
  await insertChildren(task.id);
}

// Kurzer Undo-Toast nach dem Erledigen einer Aufgabe (nicht beim Wieder-Öffnen — das ist ja
// bereits die Undo-Aktion). reopenTaskCascade leitet den korrekten Status (offen/geplant) selbst
// wieder aus planned_date her und ist damit ein korrektes Gegenstück zu completeTaskCascade, ohne
// dass hier ein eigener Vorher-Snapshot nötig wäre.
// extraLogIdToUndo: optional, nur von Watchlist-Aufgaben gesetzt (siehe promptWatchlistRating) —
// macht Rückgängig auch den zugehörigen Sichtungs-Log-Eintrag rückgängig, sonst bliebe nach einem
// Undo eine verwaiste Bewertung stehen, die zu keiner (wieder offenen) Sichtung mehr gehört.
function showCompleteUndoToast(task, allTasks, afterChange, extraLogIdToUndo = null) {
  showToast(`„${task.title}" erledigt.`, false, {
    label: "Rückgängig",
    onClick: () =>
      withErrorToast(async () => {
        await reopenTaskCascade(task, allTasks);
        if (extraLogIdToUndo) await deleteViewingLogEntry(extraLogIdToUndo);
        afterChange();
      }),
  });
}

// Dupliziert eine Aufgabe samt aller Unteraufgaben für "nächstes Mal" (z.B. wiederkehrende
// Einkaufslisten) — anders als restoreTaskSnapshot (das den exakten Vorher-Zustand wiederherstellt)
// wird hier bei JEDEM kopierten Knoten Status auf "open" und Plandatum auf null zurückgesetzt: die
// Kopie ist eine frische, ungeplante Vorlage, kein Klon des aktuellen (evtl. teilweise erledigten)
// Zustands.
async function duplicateTaskTree(task, allTasks) {
  const descendants = Array.from(collectDescendantIds(allTasks, task.id))
    .map((id) => allTasks.find((t) => t.id === id))
    .filter(Boolean);

  const oldToNewId = new Map();
  const createdRoot = await createTask({
    title: task.title,
    areaId: task.area_id,
    // Duplizieren einer Unteraufgabe soll sie als Geschwister unter demselben Elternteil anlegen,
    // nicht sie zu einer eigenständigen Top-Level-Aufgabe "befördern".
    parentTaskId: task.parent_task_id,
    effort: task.effort,
    priority: task.priority,
    isEvent: task.is_event,
    isBrainstorm: task.is_brainstorm,
  });
  oldToNewId.set(task.id, createdRoot.id);

  const byOldParent = new Map();
  for (const t of descendants) {
    if (!byOldParent.has(t.parent_task_id)) byOldParent.set(t.parent_task_id, []);
    byOldParent.get(t.parent_task_id).push(t);
  }
  const insertChildren = async (oldParentId) => {
    for (const t of byOldParent.get(oldParentId) || []) {
      const created = await createTask({
        title: t.title,
        areaId: t.area_id,
        parentTaskId: oldToNewId.get(t.parent_task_id),
        effort: t.effort,
        priority: t.priority,
        isEvent: t.is_event,
        isBrainstorm: t.is_brainstorm,
      });
      oldToNewId.set(t.id, created.id);
      await insertChildren(t.id);
    }
  };
  await insertChildren(task.id);
  return createdRoot;
}

function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

// Montag der laufenden Woche als YYYY-MM-DD (lokal). Basis für "diese Woche"-Vergleiche gegen den
// Datumsanteil von updated_at (der tasks_updated_at-Trigger hält updated_at bei jeder Änderung
// aktuell, für erledigte Aufgaben also ~ Erledigungszeitpunkt).
function weekStartISO() {
  const d = new Date();
  const mondayOffset = (d.getDay() + 6) % 7; // Sonntag(0) -> 6, Montag(1) -> 0, ...
  d.setDate(d.getDate() - mondayOffset);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function isoDatePlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function isoFromLocalDate(d) {
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

// Baut das Zellenraster für einen Kalendermonat (Montag als erster Wochentag), inkl. Padding-Tagen
// aus dem Vor-/Folgemonat, damit das Grid immer aus vollen 7er-Reihen besteht (5 oder 6 Wochen).
function buildMonthGrid(monthIso) {
  const [y, m] = monthIso.split("-").map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Montag = 0 ... Sonntag = 6
  const daysInMonth = new Date(y, m, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(y, m - 1, 1 - firstWeekday + i);
    cells.push({ iso: isoFromLocalDate(date), inMonth: date.getMonth() === m - 1 });
  }
  return cells;
}

function shiftMonth(monthIso, delta) {
  const [y, m] = monthIso.split("-").map(Number);
  return isoFromLocalDate(new Date(y, m - 1 + delta, 1));
}

// Verschiebt ein konkretes ISO-Datum (YYYY-MM-DD) um delta Tage — anders als isoDatePlusDays,
// das immer von heute aus rechnet.
function shiftIsoDay(dateIso, delta) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return isoFromLocalDate(new Date(y, m - 1, d + delta));
}

// Ganze Tage von fromIso bis toIso (toIso - fromIso); negativ, wenn toIso in der Vergangenheit liegt.
// Über lokale Mitternacht gerechnet, damit Sommerzeit-Sprünge das Ergebnis nicht verschieben.
function isoDayDiff(fromIso, toIso) {
  if (typeof fromIso !== "string" || typeof toIso !== "string") return null;
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  if ([fy, fm, fd, ty, tm, td].some(Number.isNaN)) return null;
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

// [ersterIso, letzterIso] aller sichtbaren Grid-Zellen (inkl. Padding-Tage aus Nachbarmonaten) —
// so ist die Auslastungs-Färbung (data-load) auch für ausgegraute Tage korrekt.
function monthRange(monthIso) {
  const cells = buildMonthGrid(monthIso);
  return [cells[0].iso, cells[cells.length - 1].iso];
}

// Baut eine neue Datum-Chip-Gruppe (Heute/Morgen/Kein Datum/eigenes Datum) für dynamisch erzeugte
// Formulare.
function createDateChipGroup() {
  const el = document.createElement("div");
  el.className = "date-chips";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Datum");
  el.innerHTML = `
    <button type="button" class="date-chip" data-date="today">Heute</button>
    <button type="button" class="date-chip" data-date="tomorrow">Morgen</button>
    <button type="button" class="date-chip" data-date="" data-active="true">Kein Datum</button>
    <button type="button" class="date-chip" data-date="custom">Datum…</button>
    <input type="date" class="input date-chip-custom-input" aria-label="Eigenes Datum" hidden />`;
  return wireDateChipGroup(el);
}

// Verdrahtet eine (bereits im DOM vorhandene oder von createDateChipGroup gebaute) .date-chips-
// Gruppe: Klick auf einen Chip macht ihn zum einzigen aktiven. Der "Datum…"-Chip blendet stattdessen
// ein natives Datums-Input ein. getPlannedDate() liest den aktiven Chip (bzw. das Datums-Input) aus,
// reset() setzt auf "Kein Datum" zurück.
function wireDateChipGroup(container) {
  const chips = Array.from(container.querySelectorAll(".date-chip"));
  const noDateChip = chips.find((c) => c.dataset.date === "") || chips[chips.length - 1];
  const customChip = chips.find((c) => c.dataset.date === "custom");
  const customInput = container.querySelector(".date-chip-custom-input");

  const setActive = (chip) => {
    for (const c of chips) c.removeAttribute("data-active");
    chip.setAttribute("data-active", "true");
  };

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      if (chip === customChip) {
        setActive(chip);
        if (customInput) {
          customInput.hidden = false;
          customInput.focus();
          if (customInput.showPicker) customInput.showPicker();
        }
        return;
      }
      if (customInput) customInput.hidden = true;
      setActive(chip);
    });
  }

  if (customInput) {
    customInput.addEventListener("change", () => {
      if (customInput.value) setActive(customChip);
    });
  }

  return {
    el: container,
    getPlannedDate() {
      const activeChip = chips.find((c) => c.dataset.active === "true") || noDateChip;
      if (activeChip.dataset.date === "today") return todayISO();
      if (activeChip.dataset.date === "tomorrow") return tomorrowISO();
      if (activeChip === customChip) return customInput?.value || null;
      return null;
    },
    reset() {
      setActive(noDateChip);
      if (customInput) {
        customInput.hidden = true;
        customInput.value = "";
      }
    },
    // Stellt eine bereits vorhandene Aufgabe im Chip-System dar (z.B. beim Öffnen des
    // Detail-Modals) — bildet ein bestehendes planned_date auf Heute/Morgen/eigenes Datum ab.
    setValue(isoDate) {
      if (!isoDate) {
        this.reset();
        return;
      }
      if (isoDate === todayISO()) {
        if (customInput) customInput.hidden = true;
        setActive(chips.find((c) => c.dataset.date === "today"));
        return;
      }
      if (isoDate === tomorrowISO()) {
        if (customInput) customInput.hidden = true;
        setActive(chips.find((c) => c.dataset.date === "tomorrow"));
        return;
      }
      setActive(customChip);
      if (customInput) {
        customInput.hidden = false;
        customInput.value = isoDate;
      }
    },
  };
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  return routes[hash] ? hash : "today";
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// Kleine Inline-SVG-Icons statt Emoji (📌/💪 rendern je nach Betriebssystem unterschiedlich
// bunt/inkonsistent) — erben ihre Farbe über currentColor vom umgebenden Element.
function buildInlineIcon(pathMarkup) {
  const span = document.createElement("span");
  span.className = "inline-icon";
  span.innerHTML = `<svg viewBox="0 0 24 24">${pathMarkup}</svg>`;
  return span;
}

function buildPinIcon() {
  return buildInlineIcon(`<path d="M12 2l2 6 6 2-5 4 1 7-6-4-6 4 1-7-5-4 6-2z"/>`);
}

function buildEditIcon() {
  return buildInlineIcon(`<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>`);
}

function buildTrashIcon() {
  return buildInlineIcon(
    `<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 6h12Z"/>`
  );
}

function buildDuplicateIcon() {
  return buildInlineIcon(
    `<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`
  );
}

// Eigener Wrapper statt buildInlineIcon(), weil .inline-icon svg global auf stroke-only (fill:none)
// gesetzt ist — ein Punkte-Raster braucht dagegen gefüllte Kreise.
function buildDragHandleIcon() {
  const span = document.createElement("span");
  span.className = "drag-handle-icon";
  span.innerHTML =
    `<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>` +
    `<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>` +
    `<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
  return span;
}

// Baut einen einladenderen Leerzustand (Icon + Titel + Untertext) statt eines reinen Textsatzes.
// iconPath ist austauschbar (Default: Plus, "leg das erste an") — z.B. für "Keine Treffer" bei der
// Suche ist "hinzufügen" nicht die passende Handlung, dort übergibt der Aufrufer ein Lupen-Icon.
const EMPTY_STATE_ADD_ICON = `<path d="M12 5v14M5 12h14"/>`;
const EMPTY_STATE_SEARCH_ICON = `<circle cx="10" cy="10" r="6"/><path d="M21 21l-4.35-4.35"/>`;
function buildEmptyState(title, subtitle, iconPath = EMPTY_STATE_ADD_ICON) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state-rich";
  wrap.innerHTML = `<svg viewBox="0 0 24 24">${iconPath}</svg><strong></strong><span></span>`;
  wrap.querySelector("strong").textContent = title;
  wrap.querySelector("span").textContent = subtitle;
  return wrap;
}

// Baut eingerückte <option>-Elemente für den Aufgabenbaum eines Bereichs (fuer "Uebergeordnete
// Aufgabe"-Auswahlen). excludeIds laesst sich nutzen, um beim Verschieben/Zuordnen eine Aufgabe
// und ihre eigenen Nachfahren aus der Zielauswahl auszuschliessen (Zyklus-Schutz).
function taskOptionsHtml(tasks, areaId, selectedId, excludeIds = null) {
  if (!areaId) return "";
  const scoped = tasks.filter((t) => t.area_id === areaId && (!excludeIds || !excludeIds.has(t.id)));
  const tree = buildTaskTree(scoped, null);
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const prefix = "  ".repeat(depth);
      const badge = n.is_pinned ? "📌 " : "";
      out.push(
        `<option value="${n.id}"${n.id === selectedId ? " selected" : ""}>${prefix}${badge}${escapeHtml(n.title)}</option>`
      );
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out.join("");
}

let seedPromise = null;
function ensureAreasSeededOnce(userId) {
  // init() and onAuthStateChange can both fire around the same first login;
  // without memoizing, both could see "no areas yet" and insert the defaults twice.
  // Ein fehlgeschlagener Versuch (Netzwerkfehler) darf nicht dauerhaft gecacht bleiben, sonst
  // hängt der Nutzer nach einem einzigen Hänger für immer fest, ohne dass ein Reload/erneuter
  // Login-Trigger einen neuen Versuch auslöst.
  if (!seedPromise) {
    seedPromise = ensureAreasSeeded(userId).catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

// Aus session.user_metadata gecacht statt bei jedem renderGreeting()-Aufruf neu zu fetchen — kommt
// bereits kostenlos mit jeder Session mit, siehe supabase.auth.getSession()/updateUser().
let currentUsername = null;

async function init() {
  let session;
  try {
    session = await getSession();
  } catch (err) {
    renderLogin();
    showToast(friendlyErrorMessage(err), true);
    return;
  }

  if (session) {
    currentUsername = session.user.user_metadata?.username || null;
    try {
      await ensureAreasSeededOnce(session.user.id);
      renderShell();
    } catch (err) {
      showToast(friendlyErrorMessage(err), true);
    }
  } else {
    renderLogin();
  }

  // Nur auf echte An-/Abmeldungen reagieren, nicht auf INITIAL_SESSION (redundant zum getSession()
  // oben) oder TOKEN_REFRESHED (feuert automatisch ~stündlich im Hintergrund) — sonst rendert die
  // komplette Shell neu, während der Nutzer z.B. gerade in ein Formular tippt.
  onAuthStateChange((newSession, event) => {
    if (event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
    if (newSession) {
      currentUsername = newSession.user.user_metadata?.username || null;
      ensureAreasSeededOnce(newSession.user.id)
        .then(renderShell)
        .catch((err) => showToast(friendlyErrorMessage(err), true));
    } else {
      seedPromise = null;
      currentUsername = null;
      renderLogin();
    }
  });
}

window.addEventListener("hashchange", () => {
  if (document.getElementById("view-content")) renderShell();
});

// "/" fokussiert die Suche in der Übersicht — einmalig global registriert (nicht pro View-Render,
// sonst würde bei jedem Besuch der Übersicht ein weiterer Listener dazukommen).
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || currentRoute() !== "overview") return;
  const target = e.target;
  const isTyping =
    target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
  if (isTyping) return;
  const searchInput = document.getElementById("filter-search");
  if (!searchInput) return;
  e.preventDefault();
  const filterBar = document.getElementById("filter-bar");
  if (filterBar?.hidden) {
    filterBar.hidden = false;
    document.getElementById("filter-toggle")?.setAttribute("aria-expanded", "true");
  }
  searchInput.focus();
});

function renderLogin() {
  app.innerHTML = `
    <div class="login-screen">
      <h1>Leben OS</h1>
      <p>Melde dich mit deiner E-Mail an — du bekommst einen Magic Link.</p>
      <form id="login-form" class="field-row">
        <input class="input" type="email" id="login-email" placeholder="du@example.com" required autocomplete="email" />
        <button class="btn" type="submit">Senden</button>
      </form>
      <p class="status-message" id="login-status"></p>
    </div>
  `;

  const form = document.getElementById("login-form");
  const status = document.getElementById("login-status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    if (!email) return;
    status.textContent = "Sende Magic Link…";
    try {
      await signInWithMagicLink(email);
      status.textContent = `Link verschickt an ${email}. E-Mail-Postfach checken.`;
    } catch (err) {
      status.textContent = friendlyErrorMessage(err);
    }
  });
}

// Merkt sich den zuletzt bekannten "Heute"-Zähler über renderShell()-Neuaufbauten hinweg (das
// Nav-Markup wird bei jedem Routenwechsel neu erzeugt) — so bleibt die Zahl auch sichtbar,
// während man z.B. in der Übersicht browst, statt nur direkt auf der Heute-Ansicht.
let todayRemainingCount = null;

function updateNavBadge(count) {
  todayRemainingCount = count;
  const badge = document.getElementById("nav-today-count");
  if (!badge) return;
  badge.hidden = count <= 0;
  badge.textContent = String(count);
}

// Nur Heute/Übersicht bleiben direkt in der Nav-Leiste sichtbar — die übrigen Routen wandern ins
// "Mehr"-Menü (siehe wireNavMoreMenu), sonst wirkt die Leiste mit sechs Einträgen nebeneinander
// überladen. MORE_ROUTES bestimmt sowohl den Menüinhalt als auch, wann der "Mehr"-Button selbst
// als aktiv markiert wird (aktuelle Route liegt hinter dem Menü statt direkt in der Leiste).
const MORE_ROUTES = [
  {
    route: "cockpit",
    label: "Cockpit",
    icon: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`,
  },
  {
    route: "plan",
    label: "Plan",
    icon: `<path d="M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/>`,
  },
  {
    route: "habits",
    label: "Habits",
    icon: `<path d="M9 11l3 3L22 4M2 12a10 10 0 1 0 10-10"/>`,
  },
  {
    route: "finance",
    label: "Finanzen",
    icon: `<path d="M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h13M16 13h2"/>`,
  },
  {
    route: "fernsehprogramm",
    label: "Fernsehprogramm",
    icon: `<path d="M3 5h18v12H3z"/><path d="M8 21h8M12 17v4M8 2l3 3M16 2l-3 3"/>`,
  },
  {
    route: "rezepte",
    label: "Rezepte",
    icon: `<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>`,
  },
  {
    route: "kuehlschrank",
    label: "Kühlschrank",
    icon: `<path d="M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M4 9h16M8 2v4M8 13v4"/>`,
  },
  {
    route: "games",
    label: "Gaming",
    icon: `<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 12h2M8 11v2M15 11h.01M18 13h.01"/>`,
  },
  {
    route: "books",
    label: "Lesen",
    icon: `<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>`,
  },
];

// Erhöht sich bei jedem renderShell()-Aufruf. Die render*View()-Funktionen lesen ihren Stand direkt
// nach dem Start in eine lokale Variable und vergleichen kurz vor dem entscheidenden
// innerHTML-Write erneut dagegen — wechselt der Nutzer währenddessen schnell die Route (z.B.
// Heute → Finanzen → Heute), bricht der veraltete, inzwischen überholte Aufruf statt seine Ansicht
// über die aktuell sichtbare zu schreiben.
let renderGeneration = 0;
let closeNavMoreMenu = null;

function renderShell() {
  renderGeneration++;
  const route = currentRoute();
  const isMoreRoute = MORE_ROUTES.some((r) => r.route === route);
  // Offenes Detail-Modal schließen — es liegt außerhalb von #app und würde sonst
  // beim Ansichtswechsel über der neuen Ansicht hängen bleiben.
  if (closeActiveModal) closeActiveModal();
  if (closeNavMoreMenu) closeNavMoreMenu();
  app.innerHTML = `
    <nav class="app-nav">
      <a href="#/today" class="nav-link${route === "today" ? " is-active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
        <span class="nav-label">Heute <span class="nav-count" id="nav-today-count" hidden></span></span>
      </a>
      <a href="#/overview" class="nav-link${route === "overview" ? " is-active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
        <span class="nav-label">Übersicht</span>
      </a>
      <div class="nav-more">
        <button type="button" class="nav-link nav-more-toggle${isMoreRoute ? " is-active" : ""}" id="nav-more-toggle" aria-haspopup="true" aria-expanded="false">
          <svg class="nav-icon" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
          <span class="nav-label">Mehr</span>
        </button>
        <div class="nav-more-menu" id="nav-more-menu" hidden>
          ${MORE_ROUTES.map(
            (r) => `
            <a href="#/${r.route}" class="nav-link${route === r.route ? " is-active" : ""}">
              <svg class="nav-icon" viewBox="0 0 24 24">${r.icon}</svg>
              <span class="nav-label">${r.label}</span>
            </a>`
          ).join("")}
        </div>
      </div>
    </nav>
    <div id="view-content"></div>
  `;
  if (todayRemainingCount !== null) updateNavBadge(todayRemainingCount);
  app.querySelector(".app-nav").addEventListener("click", async (e) => {
    const link = e.target.closest("a.nav-link");
    if (!link || !hasUnsavedOverviewInput()) return;
    e.preventDefault();
    const proceed = await showConfirm("Es gibt eine ungespeicherte Eingabe. Trotzdem wechseln?", {
      confirmLabel: "Wechseln",
      cancelLabel: "Bleiben",
    });
    if (proceed) location.hash = link.getAttribute("href");
  });
  wireNavMoreMenu();
  routes[route]();
  maybeShowReflectionPopup();
  maybeShowFollowupPopup();
}

// "Mehr"-Menü: Klick auf den Button öffnet/schließt ein Dropdown mit den restlichen Routen, Klick
// außerhalb oder auf einen der Menü-Links schließt es wieder. Der Outside-Click-Listener wird nur
// registriert, solange das Menü tatsächlich offen ist (statt dauerhaft mitzulaufen) — sonst würde
// irgendein beliebiger erster Klick nach dem Rendern (z.B. auf eine Aufgabe) den Mechanismus schon
// verbrauchen, bevor das Menü je geöffnet wurde.
function wireNavMoreMenu() {
  const toggle = document.getElementById("nav-more-toggle");
  const menu = document.getElementById("nav-more-menu");

  const closeMenu = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", closeMenu);
    closeNavMoreMenu = null;
  };
  // Registriert bei renderShell() zum Aufräumen — verlässt der Nutzer die Route per Browser-
  // Zurück/Vorwärts statt per Klick, während das Menü offen ist, bliebe sonst ein Listener auf
  // document hängen, der auf die gleich entfernten toggle/menu-Elemente verweist.
  closeNavMoreMenu = closeMenu;

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) {
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      document.addEventListener("click", closeMenu, { once: true });
    } else {
      closeMenu();
    }
  });
  menu.addEventListener("click", closeMenu);
}

// ----- Tagesreflexion-Popup (22–24 Uhr) -----
// Client-seitige Zeitprüfung bei jedem renderShell()-Aufruf (App-Start/View-Wechsel), kein Cron
// nötig — siehe wissensdatenbank/features/tagesreflexion.md. Snooze/Dismiss-Zustand liegt bewusst
// in localStorage statt in der DB (reines UI-Verhalten für den aktuellen Abend, analog
// QUICK_WIN_STORAGE_PREFIX), ob der Tag selbst schon beantwortet wurde, entscheidet dagegen immer
// die DB (daily_reflections), nicht localStorage.
const REFLECTION_DISMISSED_PREFIX = "leben-os:reflection-dismissed:";
const REFLECTION_SNOOZE_PREFIX = "leben-os:reflection-snooze-until:";
const REFLECTION_SNOOZED_ONCE_PREFIX = "leben-os:reflection-snoozed-once:";
const REFLECTION_SNOOZE_MINUTES = 30;

let reflectionPopupOpen = false;

async function maybeShowReflectionPopup() {
  const hour = new Date().getHours();
  if (hour < 22 || hour >= 24) return;
  if (reflectionPopupOpen) return;

  const today = todayISO();
  if (localStorage.getItem(REFLECTION_DISMISSED_PREFIX + today)) return;
  const snoozeUntil = localStorage.getItem(REFLECTION_SNOOZE_PREFIX + today);
  if (snoozeUntil && Date.now() < Number(snoozeUntil)) return;

  const existing = await getReflectionForDate(today).catch(() => undefined);
  if (existing) return;

  openReflectionPopup(today);
}

function openReflectionPopup(date) {
  reflectionPopupOpen = true;
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";
  const alreadySnoozed = Boolean(localStorage.getItem(REFLECTION_SNOOZED_ONCE_PREFIX + date));

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    closeActiveModal = null;
    reflectionPopupOpen = false;
  };
  const dismiss = () => {
    localStorage.setItem(REFLECTION_DISMISSED_PREFIX + date, "1");
    close();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") dismiss();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = dismiss;

  root.innerHTML = `
    <div class="modal-backdrop" id="reflection-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Tagesreflexion">
        <h2>Wie war dein Tag?</h2>
        <div class="priority-chips" id="reflection-mood-chips" role="group" aria-label="Stimmung">
          ${[1, 2, 3, 4, 5].map((m) => `<button type="button" class="priority-chip" data-mood="${m}">${m}</button>`).join("")}
        </div>
        <label class="modal-label">
          Notiz (optional)
          <textarea class="input" id="reflection-note" rows="2"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" id="reflection-submit">Absenden</button>
          ${alreadySnoozed ? "" : `<button class="btn btn-secondary" type="button" id="reflection-snooze">In 30 Min. nochmal</button>`}
          <button class="btn btn-secondary" type="button" id="reflection-dismiss">Nicht heute</button>
        </div>
      </div>
    </div>`;

  document.getElementById("reflection-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "reflection-backdrop") dismiss();
  });

  let selectedMood = null;
  const moodChips = document.getElementById("reflection-mood-chips");
  moodChips.querySelectorAll(".priority-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedMood = Number(chip.dataset.mood);
      moodChips.querySelectorAll(".priority-chip").forEach((c) => (c.dataset.active = String(c.dataset.mood === String(selectedMood))));
    });
  });

  document.getElementById("reflection-submit").addEventListener("click", async () => {
    if (!selectedMood) {
      showToast("Bitte eine Stimmung auswählen.", true);
      return;
    }
    const note = document.getElementById("reflection-note").value.trim();
    await withErrorToast(async () => {
      await createReflection({ date, mood: selectedMood, note: note || null });
      close();
    });
  });

  const snoozeBtn = document.getElementById("reflection-snooze");
  if (snoozeBtn) {
    snoozeBtn.addEventListener("click", () => {
      localStorage.setItem(REFLECTION_SNOOZE_PREFIX + date, String(Date.now() + REFLECTION_SNOOZE_MINUTES * 60000));
      localStorage.setItem(REFLECTION_SNOOZED_ONCE_PREFIX + date, "1");
      close();
    });
  }

  document.getElementById("reflection-dismiss").addEventListener("click", dismiss);
}

/* ---------- Folgeaufgaben-Vorschläge ---------- */
// wissensdatenbank/features/folgeaufgaben-vorschlaege.md. Der manuell ausgelöste Skill schreibt
// Vorschläge in die DB; die App zeigt sie hier im "Neue Vorschläge"-Popup (Auswahl 0–5 + Bestätigen).

let followupPopupOpen = false;
// In-Memory-Snooze: klickt der Nutzer das Popup weg, ohne zu entscheiden, poppt es nicht bei jedem
// Re-Render erneut auf — bleibt aber über die Cockpit-Kachel und beim nächsten App-Start erreichbar.
let followupPopupSnoozed = false;

async function maybeShowFollowupPopup() {
  if (followupPopupOpen || followupPopupSnoozed) return;
  // Kein zweites Modal über ein bereits offenes (z. B. die Tagesreflexion) legen.
  if (closeActiveModal) return;
  const groups = await listOpenFollowupGroups().catch(() => []);
  if (!groups.length) return;
  openFollowupPopup(groups);
}

// Öffnet das "Neue Vorschläge"-Popup direkt im Abschluss-Moment, wenn completeTaskCascade beim
// Abhaken stumme Vorschläge sichtbar geschaltet hat (Phase B, siehe js/tasks.js). Setzt ein evtl.
// gesetztes Snooze zurück, damit ein frischer Abschluss trotzdem sofort auftaucht.
async function triggerFollowupPopupAfterCompletion(unmuted) {
  if (!unmuted) return;
  followupPopupSnoozed = false;
  await maybeShowFollowupPopup();
}

function openFollowupPopup(groups) {
  followupPopupOpen = true;
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    closeActiveModal = null;
    followupPopupOpen = false;
  };
  const snooze = () => {
    followupPopupSnoozed = true;
    close();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") snooze();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = snooze;

  root.innerHTML = `
    <div class="modal-backdrop" id="followup-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Neue Folgeaufgaben-Vorschläge">
        <h2>Neue Vorschläge</h2>
        <p class="followup-intro">Welche nächsten Schritte willst du übernehmen?</p>
        ${groups
          .map(
            (group) => `
          <div class="followup-group" data-source-id="${escapeHtml(group.sourceTask.id)}">
            <h3 class="followup-source-title">${escapeHtml(group.sourceTask.title)}</h3>
            ${group.suggestions
              .map(
                (s) => `
              <label class="checkbox-label followup-option">
                <input type="checkbox" data-suggestion-id="${escapeHtml(s.id)}" />
                ${s.frame ? `<span class="followup-frame">${escapeHtml(s.frame)}</span>` : ""}
                <span class="followup-title">${escapeHtml(s.title)}</span>
              </label>`
              )
              .join("")}
          </div>`
          )
          .join("")}
        <div class="modal-actions">
          <button class="btn" type="button" id="followup-confirm">Bestätigen</button>
          <button class="btn btn-secondary" type="button" id="followup-later">Später</button>
        </div>
      </div>
    </div>`;

  document.getElementById("followup-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "followup-backdrop") snooze();
  });
  document.getElementById("followup-later").addEventListener("click", snooze);

  document.getElementById("followup-confirm").addEventListener("click", async () => {
    await withErrorToast(async () => {
      let created = 0;
      for (const group of groups) {
        const groupEl = document.querySelector(`.followup-group[data-source-id="${cssEscapeAttr(group.sourceTask.id)}"]`);
        const acceptedIds = groupEl
          ? [...groupEl.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.dataset.suggestionId)
          : [];
        created += acceptedIds.length;
        // Jede angezeigte Aufgabe wird bewusst geschlossen (auch bei 0 Auswahl → nie wieder Vorschläge).
        await resolveFollowupGroup(group, acceptedIds);
      }
      close();
      showToast(created ? `${created} Folgeaufgabe(n) übernommen.` : "Vorschläge geschlossen.");
      renderShell();
    });
  });
}

// Attribut-sichere Variante der Ursprungs-ID für den Selektor oben (UUIDs sind unkritisch, aber so
// bleibt der Selektor auch bei künftigen ID-Formen robust).
function cssEscapeAttr(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

// Prüft auf offene, unbestätigte Eingaben in der Übersicht (Inline-Anlegen-Formulare) —
// Grundlage für die Nachfrage vorm Verlassen der Ansicht per Nav-Klick.
function hasUnsavedOverviewInput() {
  const addInputs = document.querySelectorAll(".inline-add-form input[type='text'], #new-task-title");
  for (const input of addInputs) {
    if (input.value.trim()) return true;
  }
  return false;
}

/* ---------- Cockpit ---------- */

// Ruhige Kachel-Eingangs-Ebene (wissensdatenbank/features/bento-os-vision.md, Bau-Schritt 2). V1:
// read-only, EIN Blick pro Kachel, Klick springt in den jeweiligen Tab. Nur auf heute vorhandenen
// Daten (Habits/Tasks/Watchlist/Gaming). Bewusst kein Default-Landing — hängt vorerst im "Mehr"-
// Menü, kann später via MORE_ROUTES/currentRoute nach vorne gezogen werden.
async function renderCockpitView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/cockpit.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();

  const today = todayISO();
  const [allTasks, games, watchlistItems, transactions, pantryItems] = await Promise.all([
    listTasks(),
    listGames(),
    listWatchlistItems(),
    listTransactions(),
    listPantryItems(),
  ]);
  if (myGeneration !== renderGeneration) return;

  // Habits: heute fällig + wie viele davon schon erledigt.
  const dueHabits = findHabitsDueToday(allTasks, today);
  const doneHabits = dueHabits.filter((t) => t.status === "done").length;
  const habitsGlance = dueHabits.length ? `${doneHabits} / ${dueHabits.length} heute` : "nichts fällig";

  // Aufgaben: offen heute (Top-Level, ohne Watchlist-Zeilen).
  const openToday = allTasks.filter(
    (t) => t.planned_date === today && t.status !== "done" && !t.parent_task_id && !isWatchlistTask(t)
  ).length;
  const tasksGlance = openToday ? `${openToday} offen` : "alles erledigt";

  // Watchlist: heutiges Fernsehprogramm (verplanter Eintrag von heute), sonst "—".
  const itemsById = new Map(watchlistItems.map((i) => [i.id, i]));
  const todayWatch = allTasks.find((t) => isWatchlistTask(t) && t.planned_date === today);
  const watchItem = todayWatch ? itemsById.get(todayWatch.watchlist_item_id) : null;
  const watchGlance = todayWatch ? `${watchItem ? watchItem.title : todayWatch.title}${buildCurrentEpisodeLabel(watchItem)}` : "—";

  // Gaming: aktuell gespieltes Spiel, sonst "—".
  const playing = games.find((g) => g.status === "playing");
  const gamingGlance = playing ? playing.title : "—";

  // Finanzen: Summe der Ausgaben im laufenden Kalendermonat — leichtgewichtiger Glance ohne die
  // volle Topf-/Budget-Logik des Finanzen-Tabs (die bleibt Quelle der Wahrheit dort).
  const monthIso = today.slice(0, 7);
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
  if (myGeneration !== renderGeneration) return;

  const grid = document.getElementById("cockpit-grid");
  grid.append(
    buildCockpitTile("Habits", habitsGlance, "habits"),
    buildCockpitTile("Aufgaben", tasksGlance, "today"),
    buildCockpitTile("Watchlist", watchGlance, "fernsehprogramm"),
    buildCockpitTile("Gaming", gamingGlance, "games"),
    buildCockpitTile("Finanzen", financeGlance, "finance"),
    buildCockpitTile("Kühlschrank", pantryGlance, "kuehlschrank")
  );
  if (openFollowups > 0) {
    const tile = buildCockpitTile("Folgevorschläge", `${openFollowups} offen`, null);
    tile.addEventListener("click", async () => {
      followupPopupSnoozed = false;
      openFollowupPopup(await listOpenFollowupGroups());
    });
    grid.append(tile);
  }
}

function buildCockpitTile(label, glance, targetRoute) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "cockpit-tile";
  const labelEl = document.createElement("span");
  labelEl.className = "cockpit-tile-label";
  labelEl.textContent = label;
  const glanceEl = document.createElement("span");
  glanceEl.className = "cockpit-tile-glance";
  glanceEl.textContent = glance;
  tile.append(labelEl, glanceEl);
  // targetRoute null = Kachel ohne Tab-Ziel (der Aufrufer hängt einen eigenen Click-Handler an,
  // z. B. die Folgevorschläge-Kachel, die stattdessen das Popup öffnet).
  if (targetRoute) {
    tile.addEventListener("click", () => {
      location.hash = `#/${targetRoute}`;
    });
  }
  return tile;
}

/* ---------- Today ---------- */

// Cache der zuletzt geladenen Heute-Aufgaben. Auf-/Zuklappen und Statusänderungen sollen nur den
// Aufgaben-Teil neu rendern statt views/today.html komplett neu zu fetchen (das hätte #view-content
// per innerHTML ersetzt und damit den Scroll-Container zurückgesetzt) — siehe
// renderTodayTaskSection()/refreshTodayTaskList()/rerenderTodayTaskListFromCache().
const todayViewState = {
  allTasks: [],
  areaColorById: {},
  areaNameById: {},
  birthdays: [],
};

async function renderTodayView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/today.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  showLoading("task-list");

  // Ein einzelner ungefilterter Fetch reicht: Heute, überfällig, Termine und Quick-Win-Kandidaten
  // werden alle clientseitig aus derselben Liste abgeleitet (spart Roundtrips und macht die
  // Mutteraufgaben-Gruppierung trivial, weil der volle Baum schon vorliegt).
  // Ungefiltert holen (nicht nur status:"active") — filterBuyReady() muss auch bereits manuell auf
  // "ready" gesetzte Wünsche sehen können, sonst fehlen die im Kaufbereit-Widget.
  // listWatchlistItems() wurde hier früher nur für die Watchlist-Auto-Einplanung geladen — die ist
  // per Governance-Entscheidung 2026-07-25 deaktiviert (siehe unten), daher entfällt der Fetch.
  const [areas, allTasks, wishlistItems, potBalance, birthdays] = await Promise.all([
    listAreas(),
    listTasks(),
    listWishlistItems(),
    getSavingsPotBalance(),
    listBirthdays(),
  ]);
  todayViewState.areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));
  todayViewState.areaNameById = Object.fromEntries(areas.map((a) => [a.id, a.name]));
  todayViewState.birthdays = birthdays;
  const today = todayISO();

  // Fällige Habits vor dem Rendern automatisch einplanen (planned_date/status setzen) — sonst
  // würde ein heute fälliges Habit erst nach einem Reload in der Heute-Ansicht auftauchen. Bei
  // Treffern allTasks lokal patchen statt neu zu fetchen (spart einen Roundtrip).
  const duePlannedIds = new Set(await autoplanDueHabits(allTasks, today));
  const patchedTasks = duePlannedIds.size
    ? allTasks.map((t) => (duePlannedIds.has(t.id) ? { ...t, planned_date: today, status: "planned" } : t))
    : allTasks;

  // Governance-Entscheidung 2026-07-25 (wissensdatenbank/features/watchlist-fernsehprogramm.md,
  // Abschnitt "Zugang & Grundmechanik"): Watchlist-Einträge tauchen NICHT mehr automatisch als
  // Aufgaben in Heute/Tagesplan auf — die Watchlist läuft ausschließlich über den
  // Fernsehprogramm-Tab. Früher wurde hier für heute eine Watchlist-Aufgabe auto-eingeplant
  // (autoplanWatchlistForDates); das ist deaktiviert. Zusätzlich werden evtl. noch aus früheren
  // Auto-Planungs-Läufen in der DB liegende Watchlist-tasks-Zeilen hier herausgefiltert, damit sie
  // weder in der Aufgabenliste noch als "überfällig" in Heute erscheinen. Die Zeilen bleiben in der
  // DB und im Fernsehprogramm-Tab sichtbar (reversibel — Filter entfernen + Aufruf reaktivieren).
  todayViewState.allTasks = patchedTasks.filter((t) => !isWatchlistTask(t));
  const tasks = todayViewState.allTasks.filter((t) => t.planned_date === today);

  renderGreeting();
  renderBuyReadyAlert(wishlistItems, potBalance);
  renderTodayTaskSection();
  renderBirthdaysWidget(todayViewState.birthdays);
  renderQuickWin(todayViewState.allTasks, tasks, today);
  wireQuickCapture(areas, renderTodayView);
  wireBirthdaysManageButton();
  wireSettingsPanel();
}

// Rendert nur den Aufgaben-Teil (Termine-Widget, Task-Liste inkl. Fortschrittsring) aus dem
// todayViewState-Cache neu — ohne views/today.html erneut zu fetchen oder Begrüßung/Schnellerfassung
// neu zu verdrahten. Gemeinsame Basis für den reinen UI-Re-Render (Auf-/Zuklappen) und den
// daten-refreshenden Re-Render (nach Statusänderung/Unteraufgabe).
function renderTodayTaskSection() {
  // Kann auch aus einem verzögerten Callback feuern (z.B. Klick auf "Rückgängig" in einem
  // Undo-Toast, bis zu 6s nach dem Auslösen) — falls der Nutzer inzwischen die Ansicht gewechselt
  // hat, ist #task-list weg und es gibt nichts mehr neu zu rendern.
  if (!document.getElementById("task-list")) return;
  const { allTasks, areaColorById } = todayViewState;
  const today = todayISO();
  const tasks = allTasks.filter((t) => t.planned_date === today);
  const overdueTasks = allTasks.filter((t) => t.planned_date && t.planned_date < today && t.status !== "done");
  renderUpcomingEvents(allTasks, today);
  renderTodayTasks(tasks, overdueTasks, allTasks, areaColorById, refreshTodayTaskList, rerenderTodayTaskListFromCache);
  renderQuickWin(allTasks, tasks, today);
}

// Für reine UI-Zustandsänderungen ohne Datenänderung (Auf-/Zuklappen einer Mutteraufgabe) —
// synchroner Re-Render aus dem Cache, kein Netzwerk-Request.
function rerenderTodayTaskListFromCache() {
  renderTodayTaskSection();
}

// Für Aktionen, die die Aufgaben tatsächlich verändert haben (Checkbox-Toggle, Unteraufgabe über
// das Detail-Modal angelegt/geändert) — lädt die Aufgaben neu und rendert danach nur den
// Aufgaben-Teil neu, ohne die komplette Ansicht neu zu fetchen.
async function refreshTodayTaskList() {
  if (!document.getElementById("task-list")) return;
  todayViewState.allTasks = await listTasks();
  renderTodayTaskSection();
}

const GREETING_SUN_ICON = `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`;
const GREETING_MOON_ICON = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;

function renderGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  const text = currentUsername ? `${greeting}, ${currentUsername}` : greeting;
  const icon = hour < 18 ? GREETING_SUN_ICON : GREETING_MOON_ICON;
  document.getElementById("greeting-text").innerHTML =
    `<span class="inline-icon greeting-icon"><svg viewBox="0 0 24 24">${icon}</svg></span>${escapeHtml(text)}`;
  document.getElementById("today-date").textContent = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// ----- Einstellungen (Zahnrad in der Heute-Ansicht) -----
// Modal statt eigener Nav-Route — für Name + Darstellung + Hintergrundbild lohnt sich keine
// eigenständige Ansicht, siehe wissensdatenbank/features/personalisierung.md.

function wireSettingsPanel() {
  document.getElementById("settings-open").addEventListener("click", openSettingsPanel);
}

async function openSettingsPanel() {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";
  const currentBlob = await getBackgroundImageBlob();
  let hasBg = Boolean(currentBlob);
  const storedThemeChoice = getStoredTheme() || "";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = close;

  root.innerHTML = `
    <div class="modal-backdrop" id="settings-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Einstellungen">
        <h2>Einstellungen</h2>
        <label class="modal-label">
          Name
          <input class="input" type="text" id="settings-username" value="${escapeHtml(currentUsername || "")}" placeholder="Dein Name" />
        </label>
        <label class="modal-label">
          Darstellung
          <div class="priority-chips" id="settings-theme-chips" role="group" aria-label="Darstellung">
            <button type="button" class="priority-chip" data-theme-choice="" data-active="${storedThemeChoice === ""}">System</button>
            <button type="button" class="priority-chip" data-theme-choice="light" data-active="${storedThemeChoice === "light"}">Hell</button>
            <button type="button" class="priority-chip" data-theme-choice="dark" data-active="${storedThemeChoice === "dark"}">Dunkel</button>
          </div>
        </label>
        <label class="modal-label">
          Hintergrundbild
          <input type="file" class="input" accept="image/*" id="settings-bg-file" />
        </label>
        <div class="modal-actions" id="settings-bg-remove-row" ${hasBg ? "" : "hidden"}>
          <button class="btn btn-secondary" type="button" id="settings-bg-remove">Hintergrundbild entfernen</button>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" id="settings-save">Speichern</button>
          <button class="btn btn-secondary" type="button" id="settings-close">Schließen</button>
        </div>
      </div>
    </div>`;

  document.getElementById("settings-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "settings-backdrop") close();
  });
  document.getElementById("settings-close").addEventListener("click", close);

  const themeChips = document.getElementById("settings-theme-chips");
  themeChips.querySelectorAll(".priority-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      applyTheme(chip.dataset.themeChoice || null);
      themeChips.querySelectorAll(".priority-chip").forEach((c) => (c.dataset.active = String(c === chip)));
    });
  });

  document.getElementById("settings-save").addEventListener("click", async () => {
    const username = document.getElementById("settings-username").value.trim();
    await withErrorToast(async () => {
      await updateUsername(username || null);
      currentUsername = username || null;
      renderGreeting();
      close();
    });
  });

  document.getElementById("settings-bg-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await withErrorToast(async () => {
      const blob = await resizeImageToBlob(file);
      await saveBackgroundImageBlob(blob);
      document.getElementById("app-bg").style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
      document.body.classList.add("has-bg-image");
      hasBg = true;
      document.getElementById("settings-bg-remove-row").hidden = false;
    });
  });

  document.getElementById("settings-bg-remove").addEventListener("click", async () => {
    await withErrorToast(async () => {
      await clearBackgroundImage();
      document.getElementById("app-bg").style.backgroundImage = "";
      document.body.classList.remove("has-bg-image");
      hasBg = false;
      document.getElementById("settings-bg-remove-row").hidden = true;
    });
  });
}

// tasks = für heute geplante Aufgaben (bestimmen die Fortschrittsanzeige), overdueTasks = nicht
// erledigte Aufgaben mit Plandatum in der Vergangenheit (zählen bewusst NICHT in den
// Tagesfortschritt hinein, werden aber oben in der Liste als "Überfällig" hervorgehoben).
// allTasks wird für die Mutteraufgaben-Gruppierung gebraucht: Kinder erben beim Einplanen
// automatisch das Datum ihrer Mutter (siehe planTaskCascade), liegen also normalerweise mit im
// today-Set — falls trotzdem nur eine Unteraufgabe einzeln eingeplant wurde, wird ihre Mutter aus
// allTasks als reiner Gruppen-Header mitgerendert (zählt aber nicht in den Fortschritt hinein).
function renderTodayTasks(tasks, overdueTasks, allTasks, areaColorById, onChange, onToggle) {
  const list = document.getElementById("task-list");
  const emptyState = document.getElementById("empty-state");
  const doneCount = tasks.filter((t) => t.status === "done").length;
  updateNavBadge(tasks.length - doneCount + overdueTasks.length);

  // Unteraufgaben zählen nicht in den Tagesfortschritt hinein (verfälscht sonst das Bild, wenn
  // eine Mutteraufgabe viele Kinder hat) — nur für den Ring/Text, die Liste selbst zeigt weiterhin
  // alle Aufgaben inkl. Unteraufgaben.
  const topLevelTasks = tasks.filter((t) => !t.parent_task_id);
  const topLevelDoneCount = topLevelTasks.filter((t) => t.status === "done").length;
  const pct = topLevelTasks.length ? Math.round((topLevelDoneCount / topLevelTasks.length) * 100) : 0;
  const remaining = topLevelTasks.length - topLevelDoneCount;
  document.getElementById("progress-text").textContent = `${topLevelDoneCount} von ${topLevelTasks.length} Aufgaben erledigt`;
  document.getElementById("progress-subtext").textContent =
    topLevelTasks.length === 0 ? "" : remaining > 0 ? `Noch ${remaining} offen für heute.` : "Alles erledigt für heute.";
  document.getElementById("progress-ring-pct").textContent = `${pct}%`;
  const ring = document.getElementById("progress-ring");
  ring.style.setProperty("--pct", pct);
  ring.classList.toggle("is-complete", topLevelTasks.length > 0 && topLevelDoneCount === topLevelTasks.length);

  list.innerHTML = "";
  for (const task of [...overdueTasks].sort(compareByPriority)) {
    list.appendChild(buildTaskItem(task, areaColorById, allTasks, onChange));
  }

  if (tasks.length === 0 && overdueTasks.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  const todayIds = new Set(tasks.map((t) => t.id));
  const tree = filterTreeNodes(buildTaskTree(allTasks, null), (node) => todayIds.has(node.id));

  // Ein überfälliger Elternteil steht schon oben in der flachen Überfällig-Liste — als
  // Gruppenkopf hier nochmal würde er doppelt erscheinen. Stattdessen werden seine heute-
  // geplanten Kinder direkt als eigene Gruppen aufgelistet (rekursiv, falls mehrere überfällige
  // Ebenen verschachtelt sind).
  const overdueIds = new Set(overdueTasks.map((t) => t.id));
  // Höchste Priorität zuerst, auf jeder Baumebene einzeln sortiert — so behalten auch die
  // Kinder eines übersprungenen überfälligen Elternteils (die als eigene Gruppen auftauchen)
  // ihre eigene Prioritäts-Reihenfolge.
  const appendGroups = (nodes) => {
    for (const node of [...nodes].sort(compareByPriority)) {
      if (overdueIds.has(node.id)) appendGroups(node.children);
      else list.appendChild(buildTodayGroupEl(node, allTasks, areaColorById, onChange, onToggle));
    }
  };
  appendGroups(tree);
}

// Merkt sich zu-/aufgeklappte Mutteraufgaben in Heute über Re-Renders hinweg (nicht über
// View-Wechsel hinaus — das ist in Ordnung, entspricht dem Verhalten der Übersicht).
const todayCollapsedNodes = new Set();

function buildTodayGroupEl(node, allTasks, areaColorById, onChange, onToggle) {
  const hasChildren = node.children.length > 0;
  const collapsed = hasChildren && todayCollapsedNodes.has(node.id);

  const li = document.createElement("li");
  li.className = "task-group";

  const row = document.createElement("div");
  row.className = "task-item";
  appendTaskRowContent(row, node, areaColorById, allTasks, onChange);

  if (hasChildren) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tree-toggle";
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.setAttribute("aria-label", collapsed ? "Aufklappen" : "Zuklappen");
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (todayCollapsedNodes.has(node.id)) todayCollapsedNodes.delete(node.id);
      else todayCollapsedNodes.add(node.id);
      onToggle();
    });
    row.prepend(toggle);

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${node.children.length} Unteraufgabe${node.children.length === 1 ? "" : "n"}`;
    row.appendChild(count);
  }

  li.appendChild(row);

  if (hasChildren && !collapsed) {
    const childList = document.createElement("ul");
    childList.className = "task-list task-group-children";
    for (const child of node.children) {
      childList.appendChild(buildTodayGroupEl(child, allTasks, areaColorById, onChange, onToggle));
    }
    li.appendChild(childList);
  }

  return li;
}

function buildTaskItem(task, areaColorById, allTasks, onChange) {
  const li = document.createElement("li");
  li.className = "task-item";
  appendTaskRowContent(li, task, areaColorById, allTasks, onChange);
  return li;
}

// Baut Punkt/Checkbox/Titel/Badges einer Aufgaben-Zeile in ein vorhandenes Element (li oder div) —
// gemeinsame Basis für flache Zeilen (buildTaskItem) und Gruppen-Header (buildTodayGroupEl). Die
// Checkbox nutzt immer completeTaskCascade/reopenTaskCascade mit dem vollen allTasks-Kontext, auch
// für Aufgaben ohne Kinder (dort ist das Ergebnis identisch zum einfachen Statuswechsel).
function appendTaskRowContent(el, task, areaColorById, allTasks, onChange) {
  const isStale = isTaskStale(task);
  const isOverdue = isTaskOverdue(task);
  const isDueSoon = isTaskDueSoon(task);
  el.classList.toggle("is-done", task.status === "done");
  el.classList.toggle("is-stale", isStale);
  el.classList.toggle("is-due-soon", isDueSoon);
  el.classList.toggle("is-overdue", isOverdue);
  // Bereichsfarbe als Akzent am linken Rand + leichter Hintergrund-Tint (main.css .task-item) —
  // außer bei "überfällig", das hat Vorrang (rot).
  if (!isOverdue && areaColorById[task.area_id]) {
    el.style.borderLeftColor = areaColorById[task.area_id];
    el.style.setProperty("--task-area-color", areaColorById[task.area_id]);
  }

  const dot = document.createElement("span");
  dot.className = "task-area-dot";
  dot.style.background = areaColorById[task.area_id] || "var(--color-text-subtle)";

  const checkbox = document.createElement("button");
  checkbox.className = "task-checkbox";
  checkbox.type = "button";
  checkbox.dataset.checked = String(task.status === "done");
  checkbox.setAttribute("aria-pressed", String(task.status === "done"));
  checkbox.setAttribute("aria-label", task.title);
  checkbox.textContent = task.status === "done" ? "✓" : "";
  checkbox.addEventListener("click", async (e) => {
    e.stopPropagation();
    await withErrorToast(async () => {
      let unmutedFollowups = false;
      if (task.status === "done") {
        await reopenTaskCascade(task, allTasks);
      } else {
        unmutedFollowups = await completeTaskCascade(task, allTasks);
        // Nur in der Heute-Ansicht (dieser Checkbox-Pfad ist ihr einziger Aufrufer) — Bewertung
        // direkt beim Abhaken abfragen, nicht erst später im Fernsehprogramm-Tab (Spec-Vorgabe).
        const ratingLogId = isWatchlistTask(task) ? await promptWatchlistRating(task) : null;
        showCompleteUndoToast(task, allTasks, onChange, ratingLogId);
      }
      onChange();
      await triggerFollowupPopupAfterCompletion(unmutedFollowups);
    });
  });

  const title = document.createElement("span");
  title.className = "task-title task-title-btn";
  title.textContent = task.title;
  title.addEventListener("click", async (e) => {
    e.stopPropagation();
    // overviewState.areas ist leer, wenn Übersicht diese Session noch nicht besucht wurde — ohne
    // sie fehlt im Detail-Modal das Bereichs-Badge (siehe renderTaskDetailView).
    if (overviewState.areas.length === 0) {
      try {
        overviewState.areas = await listAreas();
      } catch (err) {
        showToast(friendlyErrorMessage(err), true);
        return;
      }
    }
    openTaskDetail(task);
  });

  el.append(dot, checkbox, title);

  if (isOverdue) {
    const badge = document.createElement("span");
    badge.className = "badge badge-overdue";
    badge.innerHTML = BADGE_ICON_OVERDUE + "Überfällig";
    el.appendChild(badge);
  }
}

// ----- Anstehende Termine -----

function formatShortDate(isoDate) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d}.${m}`;
}

function renderUpcomingEvents(allTasks, today) {
  const widget = document.getElementById("events-widget");
  const list = document.getElementById("events-widget-list");
  const moreBtn = document.getElementById("events-widget-more");
  const events = allTasks
    .filter((t) => t.is_event && t.status !== "done" && t.planned_date && t.planned_date >= today)
    .sort((a, b) => (a.planned_date < b.planned_date ? -1 : a.planned_date > b.planned_date ? 1 : 0));

  if (events.length === 0) {
    widget.hidden = true;
    return;
  }
  widget.hidden = false;

  const renderItems = (items) => {
    list.innerHTML = "";
    for (const ev of items) {
      const li = document.createElement("li");
      li.textContent = `${formatShortDate(ev.planned_date)} ${ev.title}`;
      list.appendChild(li);
    }
  };
  renderItems(events.slice(0, 2));

  if (events.length > 2) {
    moreBtn.hidden = false;
    moreBtn.textContent = `+${events.length - 2} weitere`;
    moreBtn.onclick = () => {
      renderItems(events);
      moreBtn.hidden = true;
    };
  } else {
    moreBtn.hidden = true;
  }
}

// ----- Geburtstage -----
// Reine Erfassung + Anzeige (nächste zuerst). Die eigentliche "Arbeit" (Event/Geschenk-Aufgabe pro
// anstehendem Geburtstag anlegen) übernimmt das Weekly/MSGA, nicht diese Ansicht — siehe
// wissensdatenbank/features/geburtstage-kalender.md.
function renderBirthdaysWidget(birthdays) {
  const list = document.getElementById("birthdays-widget-list");
  const moreBtn = document.getElementById("birthdays-widget-more");
  if (!list || !moreBtn) return;

  const sorted = [...birthdays].sort((a, b) => daysUntilNextOccurrence(a.day, a.month) - daysUntilNextOccurrence(b.day, b.month));
  // Nur Geburtstage innerhalb der nächsten 30 Tage direkt zeigen, statt immer die 3 nächsten
  // unabhängig von ihrer Entfernung — sonst steht die Heute-Ansicht dauerhaft mit weit entfernten
  // Geburtstagen voll (Nutzer-Feedback: Widget war "viel zu präsent"). Weiter entfernte bleiben
  // über "X weitere" erreichbar, nicht komplett versteckt.
  const BIRTHDAY_WINDOW_DAYS = 30;
  const withinWindow = sorted.filter((b) => daysUntilNextOccurrence(b.day, b.month) <= BIRTHDAY_WINDOW_DAYS);

  // Kurzzeile "TT.MM. Name (Alter)" (implementieren-jetzt.md, Triage 2026-07-21 — Datum war seit
  // dem 2026-07-20-Umbau ganz raus, fehlte dem Nutzer). Bearbeiten/Löschen sitzt weiterhin nicht
  // hier, sondern im Verwalten-Modal (openBirthdaysDetail), daher kein Löschen-Button pro Zeile.
  const renderItems = (items) => {
    list.innerHTML = "";
    for (const b of items) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "task-title-btn";
      const dateLabel = `${String(b.day).padStart(2, "0")}.${String(b.month).padStart(2, "0")}.`;
      const ageLabel = b.year ? ` (${nextOccurrence(b.day, b.month).getFullYear() - b.year})` : "";
      btn.textContent = `${dateLabel} ${b.name}${ageLabel}`;
      btn.addEventListener("click", () => openBirthdaysDetail());
      li.appendChild(btn);
      list.appendChild(li);
    }
  };
  renderItems(withinWindow);

  const remaining = sorted.length - withinWindow.length;
  if (remaining > 0) {
    moreBtn.hidden = false;
    moreBtn.textContent = `+${remaining} weitere`;
    moreBtn.onclick = () => {
      renderItems(sorted);
      moreBtn.hidden = true;
    };
  } else {
    moreBtn.hidden = true;
  }
}

function wireBirthdaysManageButton() {
  document.getElementById("birthdays-manage-open").addEventListener("click", () => openBirthdaysDetail());
}

const BIRTHDAY_MONTH_OPTIONS = [
  [1, "Januar"], [2, "Februar"], [3, "März"], [4, "April"], [5, "Mai"], [6, "Juni"],
  [7, "Juli"], [8, "August"], [9, "September"], [10, "Oktober"], [11, "November"], [12, "Dezember"],
];

// Verwalten-Modal (implementieren-jetzt.md, Triage 2026-07-20) — bündelt Bearbeiten/Löschen aller
// Geburtstage sowie das Neuanlegen, das vorher ein eigener Toggle direkt im Widget war. JS-templated
// Modal analog openRecipeDetail/promptWatchlistRating, kein statisches Formular mehr in today.html.
function openBirthdaysDetail() {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = close;

  const monthOptionsHtml = (selected) =>
    BIRTHDAY_MONTH_OPTIONS.map(([v, label]) => `<option value="${v}"${v === selected ? " selected" : ""}>${label}</option>`).join("");

  const render = () => {
    const sorted = [...todayViewState.birthdays].sort(
      (a, b) => daysUntilNextOccurrence(a.day, a.month) - daysUntilNextOccurrence(b.day, b.month)
    );
    const rowsHtml = sorted
      .map(
        (b) => `
      <li class="task-item birthday-row" data-birthday-id="${b.id}">
        <input type="text" class="input" data-field="name" value="${escapeHtml(b.name)}" aria-label="Name" />
        <input type="number" class="input" data-field="day" value="${b.day}" min="1" max="31" style="max-width: 60px" aria-label="Tag" />
        <select class="select" data-field="month" aria-label="Monat">${monthOptionsHtml(b.month)}</select>
        <input type="number" class="input" data-field="year" value="${b.year ?? ""}" placeholder="Jahr" min="1900" max="2100" style="max-width: 90px" aria-label="Jahr" />
        <label class="checkbox-label"><input type="checkbox" data-field="is_important" ${b.is_important ? "checked" : ""} /> Wichtig</label>
        <button type="button" class="icon-btn icon-btn-danger" data-action="delete" aria-label="Geburtstag löschen">×</button>
      </li>`
      )
      .join("");

    root.innerHTML = `
      <div class="modal-backdrop" id="birthdays-detail-backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Geburtstage verwalten">
          <h2 class="modal-view-title">Geburtstage</h2>
          <ul class="task-list" id="birthdays-detail-list">${rowsHtml}</ul>
          <p class="empty-state" id="birthdays-detail-empty" ${sorted.length ? "hidden" : ""}>Noch keine Geburtstage erfasst.</p>
          <form class="quick-capture-panel" id="birthday-add-form">
            <input type="text" class="input" id="birthday-add-name" placeholder="Name" autocomplete="off" required />
            <input type="number" class="input" id="birthday-add-day" placeholder="Tag" min="1" max="31" required />
            <select class="select" id="birthday-add-month" aria-label="Monat">${monthOptionsHtml(1)}</select>
            <input type="number" class="input" id="birthday-add-year" placeholder="Jahr (optional)" min="1900" max="2100" />
            <label class="checkbox-label"><input type="checkbox" id="birthday-add-important" /> Wichtig</label>
            <button class="btn" type="submit">Hinzufügen</button>
          </form>
          <button class="btn btn-secondary" type="button" id="birthdays-detail-close">Schließen</button>
        </div>
      </div>`;

    document.getElementById("birthdays-detail-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "birthdays-detail-backdrop") close();
    });
    document.getElementById("birthdays-detail-close").addEventListener("click", close);

    document.getElementById("birthdays-detail-list").querySelectorAll("li[data-birthday-id]").forEach((li) => {
      const id = li.dataset.birthdayId;
      const commit = async (updates) => {
        await withErrorToast(async () => {
          const updated = await updateBirthday(id, updates);
          todayViewState.birthdays = todayViewState.birthdays.map((b) => (b.id === id ? updated : b));
          renderBirthdaysWidget(todayViewState.birthdays);
        });
      };
      li.querySelector('[data-field="name"]').addEventListener("blur", (e) => {
        const value = e.target.value.trim();
        if (value) commit({ name: value });
      });
      li.querySelector('[data-field="day"]').addEventListener("change", (e) => commit({ day: Number(e.target.value) }));
      li.querySelector('[data-field="month"]').addEventListener("change", (e) => commit({ month: Number(e.target.value) }));
      li.querySelector('[data-field="year"]').addEventListener("change", (e) => commit({ year: e.target.value ? Number(e.target.value) : null }));
      li.querySelector('[data-field="is_important"]').addEventListener("change", (e) => commit({ is_important: e.target.checked }));
      li.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        await withErrorToast(async () => {
          await deleteBirthday(id);
          todayViewState.birthdays = todayViewState.birthdays.filter((b) => b.id !== id);
          renderBirthdaysWidget(todayViewState.birthdays);
          render();
        });
      });
    });

    document.getElementById("birthday-add-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("birthday-add-name");
      const dayInput = document.getElementById("birthday-add-day");
      const monthSelect = document.getElementById("birthday-add-month");
      const yearInput = document.getElementById("birthday-add-year");
      const importantInput = document.getElementById("birthday-add-important");
      const name = nameInput.value.trim();
      const day = Number(dayInput.value);
      const month = Number(monthSelect.value);
      if (!name || !day || !month) return;
      await withErrorToast(async () => {
        const year = yearInput.value ? Number(yearInput.value) : null;
        const created = await createBirthday({ name, day, month, year, isImportant: importantInput.checked });
        todayViewState.birthdays = [...todayViewState.birthdays, created];
        renderBirthdaysWidget(todayViewState.birthdays);
        showToast("Geburtstag gespeichert.");
        render();
      });
    });
  };

  render();
}

// ----- Quick Win des Tages -----
// Ein zufällig gewählter 5-Minuten-Aufgaben-Vorschlag, der nicht Teil des Tagesplans war —
// taucht erst auf, sobald 75% der heute geplanten Aufgaben erledigt sind. Wird nur lokal
// gemerkt (kein Server-Zustand nötig), damit Reroll/Reload denselben Vorschlag zeigen.
const QUICK_WIN_STORAGE_PREFIX = "leben-os:quick-win:";

function loadQuickWinState(today) {
  try {
    const raw = localStorage.getItem(QUICK_WIN_STORAGE_PREFIX + today);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveQuickWinState(today, state) {
  try {
    localStorage.setItem(QUICK_WIN_STORAGE_PREFIX + today, JSON.stringify(state));
  } catch {
    // z.B. Private-Browsing ohne Storage-Zugriff — Quick Win ist ein Nice-to-have, kein Problem
    // wenn er nicht über Reloads hinweg persistiert.
  }
}

function renderQuickWin(allTasks, tasks, today) {
  const card = document.getElementById("quick-win-card");
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const ratio = tasks.length ? doneCount / tasks.length : 0;
  if (ratio < 0.75) {
    card.hidden = true;
    return;
  }

  const plannedIds = new Set(tasks.map((t) => t.id));
  // Überfällige Aufgaben stehen schon oben mit eigenem Badge — als "neuer" Quick Win nochmal
  // vorgeschlagen würden sie doppelt auftauchen und dem "nicht Teil des Tagesplans"-Gedanken
  // widersprechen.
  const candidates = allTasks.filter(
    (t) => t.status === "open" && t.effort === 5 && !plannedIds.has(t.id) && !(t.planned_date && t.planned_date < today)
  );
  if (candidates.length === 0) {
    card.hidden = true;
    return;
  }

  const state = loadQuickWinState(today);
  let task = state ? candidates.find((t) => t.id === state.taskId) : null;
  if (!task) {
    task = candidates[Math.floor(Math.random() * candidates.length)];
    saveQuickWinState(today, { taskId: task.id });
  }

  card.hidden = false;
  document.getElementById("quick-win-title").textContent = task.title;

  // Bereichs-Zuordnung (Dot + Name) wie in den normalen Task-Zeilen, plus — falls die Aufgabe eine
  // Unteraufgabe ist — ein dezenter Hinweis auf die Mutteraufgabe zur Einordnung. Ohne beides stand
  // der Quick Win kontextlos da (z.B. „Groben Reisezeitraum 2027 festlegen" ohne erkennbaren Bereich).
  const metaEl = document.getElementById("quick-win-meta");
  metaEl.innerHTML = "";
  const areaColor = todayViewState.areaColorById[task.area_id];
  const areaName = todayViewState.areaNameById[task.area_id];
  const parent = task.parent_task_id ? allTasks.find((t) => t.id === task.parent_task_id) : null;
  if (areaName || parent) {
    if (areaName) {
      const dot = document.createElement("span");
      dot.className = "task-area-dot";
      dot.style.background = areaColor || "var(--color-text-subtle)";
      metaEl.appendChild(dot);
      const nameEl = document.createElement("span");
      nameEl.textContent = areaName;
      metaEl.appendChild(nameEl);
    }
    if (parent) {
      const parentEl = document.createElement("span");
      parentEl.className = "quick-win-parent";
      parentEl.textContent = `↳ ${parent.title}`;
      metaEl.appendChild(parentEl);
    }
    metaEl.hidden = false;
  } else {
    metaEl.hidden = true;
  }

  const checkbox = document.getElementById("quick-win-checkbox");
  checkbox.dataset.checked = "false";
  checkbox.onclick = async () => {
    await withErrorToast(async () => {
      await updateTask(task.id, { status: "done" });
      renderTodayView();
      showToast(`„${task.title}" erledigt — Quick Win!`, false, {
        label: "Rückgängig",
        onClick: () =>
          withErrorToast(async () => {
            await updateTask(task.id, { status: "open" });
            renderTodayView();
          }),
      });
    });
  };

  document.getElementById("quick-win-reroll").onclick = () => {
    const others = candidates.filter((t) => t.id !== task.id);
    const next = others.length > 0 ? others[Math.floor(Math.random() * others.length)] : task;
    saveQuickWinState(today, { taskId: next.id });
    renderQuickWin(allTasks, tasks, today);
  };
}

// Ein Plandatum in der Vergangenheit, das noch nicht erledigt ist — unabhängig davon ob der
// Status noch "open" oder schon "planned" ist (beides ist über das Detail-Modal frei kombinierbar).
function isTaskOverdue(task) {
  return task.status !== "done" && !!task.planned_date && task.planned_date < todayISO();
}

// Vorwarnstufe zwischen "normal" und "überfällig" — heute/morgen fällig, aber noch nicht in der
// Vergangenheit. Mit isTaskOverdue() zusammen deckt das lückenlos alle geplanten, offenen Aufgaben
// ab (kein Datum kann gleichzeitig beides sein).
function isTaskDueSoon(task) {
  if (task.status === "done" || !task.planned_date) return false;
  const today = todayISO();
  return task.planned_date === today || task.planned_date === tomorrowISO();
}

// Sortiert nach Dringlichkeit: überfällige/nahe Plandaten zuerst (aufsteigend), undatierte
// Aufgaben zuletzt — unter sich wie bisher nach Erstellungsdatum (älteste zuerst).
function compareByUrgency(a, b) {
  if (a.planned_date && b.planned_date) {
    return a.planned_date < b.planned_date ? -1 : a.planned_date > b.planned_date ? 1 : 0;
  }
  if (a.planned_date) return -1;
  if (b.planned_date) return 1;
  return new Date(a.created_at) - new Date(b.created_at);
}

// Priorität soll nur in Heute etwas bewirken — dort aber ohne eigenes Icon/Badge: die
// höchstpriorisierte Aufgabe steht einfach ganz oben. Innerhalb derselben Priorität bleibt die
// bisherige Dringlichkeits-Reihenfolge erhalten (compareByUrgency als Tiebreaker). Erledigte
// Aufgaben rutschen zuerst gebündelt ans Ende, statt an ihrer Prioritäts-Position stehen zu bleiben
// — sonst wirkt die Liste bei jedem erneuten Aufruf von Heute wie "durcheinandergewürfelt".
const PRIORITY_RANK = { high: 2, medium: 1, low: 0 };
function compareByPriority(a, b) {
  const doneDiff = (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0);
  if (doneDiff !== 0) return doneDiff;
  const diff = (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1);
  return diff !== 0 ? diff : compareByUrgency(a, b);
}

function isTaskStale(task) {
  if (task.status === "done") return false;
  const ageMs = Date.now() - new Date(task.created_at).getTime();
  return ageMs > 14 * 24 * 60 * 60 * 1000;
}

// Heute-Schnellerfassung: Titel + optional Bereich/Aufwand/Priorität, aufklappbar bei Fokus.
// Heute-Schnellerfassung: per "+"-Button oben aufklappbares Formular statt eines dauerhaft
// sichtbaren fixierten Balkens — der soll die Aufgabenliste nicht mehr verdecken.
function wireQuickCapture(areas, onAdded) {
  const form = document.getElementById("brainstorm-form");
  const toggleBtn = document.getElementById("quick-add-toggle");
  const cancelBtn = document.getElementById("quick-add-cancel");
  const input = document.getElementById("brainstorm-input");
  const areaSelect = document.getElementById("brainstorm-area");
  const effortGroup = document.getElementById("brainstorm-effort");
  const priorityGroup = document.getElementById("brainstorm-priority");
  const isEventCheckbox = document.getElementById("brainstorm-is-event");

  areaSelect.innerHTML =
    `<option value="">Bereich (optional)</option>` +
    areas.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");

  const DEFAULT_EFFORT = 10;
  let selectedEffort = DEFAULT_EFFORT;
  const syncEffortChips = () =>
    effortGroup.querySelectorAll(".effort-chip").forEach((c) => {
      c.dataset.active = String(Number(c.dataset.effort) === selectedEffort);
    });
  effortGroup.querySelectorAll(".effort-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const value = Number(chip.dataset.effort);
      selectedEffort = selectedEffort === value ? null : value;
      syncEffortChips();
    });
  });
  syncEffortChips();

  let selectedPriority = "medium";
  const setPriority = (value) => {
    selectedPriority = value;
    priorityGroup.querySelectorAll(".priority-chip").forEach((c) => {
      c.dataset.active = String(c.dataset.priority === value);
    });
  };
  priorityGroup.querySelectorAll(".priority-chip").forEach((chip) => {
    chip.addEventListener("click", () => setPriority(chip.dataset.priority));
  });

  const closeForm = () => {
    form.hidden = true;
    form.reset();
    selectedEffort = DEFAULT_EFFORT;
    syncEffortChips();
    setPriority("medium");
    isEventCheckbox.checked = false;
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      input.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  const submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Verhindert Doppel-Anlagen bei schnellem Doppelklick/Doppel-Enter, solange der vorherige
    // Request noch läuft (der Titel bliebe sonst bis zum Response im Feld stehen und würde ein
    // zweites Mal abgeschickt).
    if (submitBtn.disabled) return;
    const title = input.value.trim();
    if (!title) return;
    const areaId = areaSelect.value || null;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createTask({
          title,
          areaId,
          effort: selectedEffort,
          priority: selectedPriority,
          isBrainstorm: !areaId,
          isEvent: isEventCheckbox.checked,
          plannedDate: todayISO(),
          status: "planned",
        });
        const areaName = areaId ? areas.find((a) => a.id === areaId)?.name : null;
        showToast(areaName ? `„${title}" zu ${areaName} hinzugefügt.` : `„${title}" hinzugefügt.`);
        // Panel offen lassen für schnelles Mehrfacherfassen: nur Titel/Termin-Flag leeren,
        // Bereich/Aufwand/Priorität bleiben als bequemer Default für den nächsten Eintrag stehen.
        input.value = "";
        isEventCheckbox.checked = false;
        input.focus();
        onAdded();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- Overview ---------- */

async function renderOverviewView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/overview.html");
  if (myGeneration !== renderGeneration) return;
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
  wireViewModeToggle();
  await renderAreaManageList();
  wireNewAreaForm();
  wireAreaManageToggle();
}

// Entscheidet zwischen Listen- (Bereichsbaum) und Kanban-Darstellung derselben Aufgaben. Nur die
// zwei Haupt-Render-Pfade (renderOverviewView/reloadOverview) laufen hierüber — die vielen direkten
// renderAreaTree()-Aufrufe (Collapse-Toggles, Inline-Add) stammen aus Interaktionen, die es nur in
// der Listenansicht gibt.
function renderOverviewBody() {
  const tree = document.getElementById("area-tree");
  const board = document.getElementById("kanban-board");
  if (overviewState.viewMode === "kanban") {
    tree.hidden = true;
    board.hidden = false;
    renderKanbanBoard();
  } else {
    board.hidden = true;
    tree.hidden = false;
    renderAreaTree();
  }
}

async function loadOverviewData() {
  const [areas, tasks, commentedTaskIds] = await Promise.all([listAreas(), listTasks(), listAllCommentedTaskIds()]);
  overviewState.areas = areas;
  overviewState.tasks = tasks;
  overviewState.commentedTaskIds = commentedTaskIds;
}

// Aktualisiert alle gerade sichtbaren Ansichten nach einer Aufgaben-Änderung im Detail-Modal — das
// Modal kann sowohl von der Übersicht als auch von Heute aus geöffnet worden sein (siehe
// appendTaskRowContent/buildTaskNameEl), daher hier anhand der vorhandenen DOM-Elemente erkennen,
// welche Ansicht gerade aktiv ist, statt fest auf reloadOverview() zu verdrahten (das würde
// crashen, wenn die Übersicht-Elemente gar nicht im DOM sind).
// allTasks (optional): falls der Aufrufer die Aufgaben gerade schon selbst per listTasks() neu
// geladen hat (z.B. renderTaskDetailCard fürs Modal), wird dieser Stand für Heute direkt
// übernommen statt ihn eine zweite Runde erneut zu fetchen.
function refreshOpenViewsAfterTaskChange(allTasks) {
  if (document.getElementById("area-tree")) reloadOverview();
  if (document.getElementById("task-list")) {
    if (allTasks) {
      todayViewState.allTasks = allTasks;
      renderTodayTaskSection();
    } else {
      refreshTodayTaskList();
    }
  }
}

async function reloadOverview() {
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

// Baut aus einem Aufgabenbaum (siehe buildTaskTree) einen zugeschnittenen Baum: ein Knoten
// bleibt, wenn er selbst `predicate` erfüllt ODER mindestens ein Nachfahre es tut — sonst würde
// z.B. eine passende Unteraufgabe verschwinden, nur weil ihr Elternteil nicht matcht. Genutzt
// für die Übersicht-Filter (taskPassesFilter) und für die Heute-Gruppierung (todayIds-Mitgliedschaft).
function filterTreeNodes(nodes, predicate) {
  const out = [];
  for (const node of nodes) {
    const children = filterTreeNodes(node.children, predicate);
    if (predicate(node) || children.length > 0) out.push({ ...node, children });
  }
  return out;
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

  header.append(toggle, dot, name, weekActivity, count, addBtn);
  section.appendChild(header);

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

// ----- Aufgaben-Detail (Modal) -----

// Oeffnet das Detail-Modal fuer eine Aufgabe. Die aeussere Modal-Mechanik (Backdrop, Escape,
// Scroll-Sperre) wird hier genau einmal aufgesetzt; Navigation zwischen Aufgabe und ihren
// Unteraufgaben (Reinklicken, Zurueck-Link) rendert danach nur noch den Karteninhalt neu
// (renderTaskDetailCard), damit dabei keine Listener mehrfach registriert werden.
async function openTaskDetail(task) {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = close;

  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-card" id="modal-card" role="dialog" aria-modal="true" aria-label="Aufgabe bearbeiten"></div>
    </div>`;
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") close();
  });

  await renderTaskDetailCard(task.id, close);
}

const PRIORITY_LABEL = { low: "Niedrig", medium: "Mittel", high: "Hoch" };

// Baut die Unteraufgaben-Liste (gemeinsam für Ansicht) — Checkbox kaskadiert wie überall,
// Klick auf den Titel navigiert ins Detail der Unteraufgabe.
function subtaskListHtml(children) {
  return children
    .map(
      (c) => `
        <li class="task-item${c.status === "done" ? " is-done" : ""}" data-child-id="${c.id}">
          <button type="button" class="task-checkbox" data-checked="${c.status === "done"}" data-action="toggle" aria-pressed="${c.status === "done"}" aria-label="${escapeHtml(c.title)}">${c.status === "done" ? "✓" : ""}</button>
          <button type="button" class="task-title task-title-btn" data-action="open">${escapeHtml(c.title)}</button>
        </li>`
    )
    .join("");
}

async function renderTaskDetailCard(taskId, close, editMode = false) {
  // Kommentare nur für den View-Modus relevant (siehe renderTaskDetailView) — trotzdem hier schon
  // parallel mitgeladen, damit ein Wechsel zwischen Ansicht/Bearbeiten keinen zusätzlichen Request
  // braucht.
  const [allTasks, comments] = await Promise.all([listTasks(), listComments(taskId)]);
  const task = allTasks.find((t) => t.id === taskId);
  const card = document.getElementById("modal-card");
  if (!task || !card) {
    close();
    return allTasks;
  }

  const parentTask = task.parent_task_id ? allTasks.find((t) => t.id === task.parent_task_id) : null;
  const children = allTasks.filter((t) => t.parent_task_id === task.id);
  const backButtonHtml = parentTask
    ? `<button type="button" class="task-title-btn" id="td-back">← Zurück zu „${escapeHtml(parentTask.title)}"</button>`
    : "";

  if (editMode) renderTaskDetailEdit(card, task, allTasks, parentTask, children, backButtonHtml, close);
  else renderTaskDetailView(card, task, allTasks, children, comments, backButtonHtml, close);
  // Rückgabe erlaubt refreshOpenViewsAfterTaskChange(), den bereits geladenen Stand für Heute
  // wiederzuverwenden statt ihn direkt danach nochmal per listTasks() zu holen.
  return allTasks;
}

// Baut die Notizen/Kommentare-Liste (wissensdatenbank/features/task-comments.md, Variante B) —
// direktes Löschen ohne Bestätigungsdialog, gleiche Konvention wie der Sichtungs-Log im
// Watchlist-Detail (watchlist-log-delete).
function commentListHtml(comments) {
  if (comments.length === 0) {
    return `<p class="empty-state">Noch keine Notizen.</p>`;
  }
  return `<ul class="task-list" id="td-comments-list">${comments
    .map(
      (c) => `
        <li class="task-item">
          <span class="task-title">${escapeHtml(c.body)}</span>
          <span class="count">${formatShortDate(c.created_at.slice(0, 10))}</span>
          <button type="button" class="icon-btn icon-btn-danger td-comment-delete" data-comment-id="${c.id}" aria-label="Notiz löschen">×</button>
        </li>`
    )
    .join("")}</ul>`;
}

function renderTaskDetailView(card, task, allTasks, children, comments, backButtonHtml, close) {
  const areaName = task.area_id ? overviewState.areas.find((a) => a.id === task.area_id)?.name : null;
  const doneChildren = children.filter((t) => t.status === "done").length;

  const badges = [];
  if (areaName) badges.push(`<span class="badge badge-area">${escapeHtml(areaName)}</span>`);
  badges.push(`<span class="badge badge-priority-${task.priority || "medium"}">${PRIORITY_LABEL[task.priority] || "Mittel"}</span>`);
  if (task.effort) badges.push(`<span class="badge badge-effort">${task.effort} min</span>`);
  if (task.is_event && task.planned_date) badges.push(`<span class="badge badge-event">${formatShortDate(task.planned_date)}</span>`);
  else if (task.planned_date) badges.push(`<span class="badge badge-date">${formatShortDate(task.planned_date)}</span>`);
  if (isTaskOverdue(task)) badges.push(`<span class="badge badge-overdue">${BADGE_ICON_OVERDUE}Überfällig</span>`);
  if (isHabitTask(task)) badges.push(`<span class="badge badge-habit">${BADGE_ICON_HABIT}Habit</span>`);

  card.innerHTML = `
    ${backButtonHtml}
    <div class="modal-view-header">
      <button type="button" class="task-checkbox" id="td-done-toggle" data-checked="${task.status === "done"}" aria-pressed="${task.status === "done"}" aria-label="Erledigt">${task.status === "done" ? "✓" : ""}</button>
      <h2 class="modal-view-title">${escapeHtml(task.title)}</h2>
      <button type="button" class="icon-btn" id="td-pin" aria-label="${task.is_pinned ? "Anheften entfernen" : "Anheften"}"></button>
      <button type="button" class="icon-btn" id="td-edit" aria-label="Bearbeiten"></button>
    </div>
    <div class="modal-badges">${badges.join("")}</div>

    <div class="modal-subtasks">
      <div class="tree-subheading">Unteraufgaben${children.length ? ` (${doneChildren}/${children.length} erledigt)` : ""}</div>
      <ul class="task-list" id="td-subtask-list">${subtaskListHtml(children)}</ul>
      <form class="inline-add-form" id="td-subtask-form">
        <input class="input" id="td-subtask-title" placeholder="Unteraufgabe hinzufügen" autocomplete="off" required />
        <div class="effort-chips" id="td-subtask-effort" role="group" aria-label="Aufwand">
          <button type="button" class="effort-chip" data-effort="5">5</button>
          <button type="button" class="effort-chip" data-effort="10">10</button>
          <button type="button" class="effort-chip" data-effort="30">30</button>
          <button type="button" class="effort-chip" data-effort="60">60</button>
        </div>
        <button class="icon-btn" type="submit" aria-label="Hinzufügen">+</button>
      </form>
    </div>

    <div class="modal-comments">
      <div class="tree-subheading">Notizen</div>
      ${commentListHtml(comments)}
      <form class="inline-add-form" id="td-comment-form">
        <input class="input" id="td-comment-text" placeholder="Notiz hinzufügen" autocomplete="off" required />
        <button class="icon-btn" type="submit" aria-label="Hinzufügen">+</button>
      </form>
    </div>

    <div class="modal-actions">
      <button class="btn btn-secondary" id="td-cancel" type="button">Schließen</button>
    </div>`;

  document.getElementById("td-pin").appendChild(buildPinIcon());
  document.getElementById("td-edit").appendChild(buildEditIcon());
  document.getElementById("td-cancel").addEventListener("click", close);

  document.getElementById("td-comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("td-comment-text");
    const body = input.value.trim();
    if (!body) return;
    await withErrorToast(async () => {
      await createComment({ taskId: task.id, body });
      const refreshedTasks = await renderTaskDetailCard(task.id, close, false);
      refreshOpenViewsAfterTaskChange(refreshedTasks);
    });
  });

  card.querySelectorAll(".td-comment-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await withErrorToast(async () => {
        await deleteComment(btn.dataset.commentId);
        const refreshedTasks = await renderTaskDetailCard(task.id, close, false);
        refreshOpenViewsAfterTaskChange(refreshedTasks);
      });
    });
  });

  if (backButtonHtml) {
    document
      .getElementById("td-back")
      .addEventListener("click", () => renderTaskDetailCard(task.parent_task_id, close, false));
  }

  document.getElementById("td-edit").addEventListener("click", () => renderTaskDetailCard(task.id, close, true));

  document.getElementById("td-pin").addEventListener("click", async () => {
    await withErrorToast(async () => {
      await updateTask(task.id, { is_pinned: !task.is_pinned });
      const refreshedTasks = await renderTaskDetailCard(task.id, close, false);
      refreshOpenViewsAfterTaskChange(refreshedTasks);
    });
  });

  document.getElementById("td-done-toggle").addEventListener("click", async () => {
    await withErrorToast(async () => {
      if (task.status === "done") {
        await reopenTaskCascade(task, allTasks);
      } else {
        await completeTaskCascade(task, allTasks);
        showCompleteUndoToast(task, allTasks, async () => {
          const refreshedTasks = await renderTaskDetailCard(task.id, close, false);
          refreshOpenViewsAfterTaskChange(refreshedTasks);
        });
      }
      const refreshedTasks = await renderTaskDetailCard(task.id, close, false);
      refreshOpenViewsAfterTaskChange(refreshedTasks);
    });
  });

  let selectedSubtaskEffort = null;
  const subtaskEffortGroup = document.getElementById("td-subtask-effort");
  subtaskEffortGroup.querySelectorAll(".effort-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const value = Number(chip.dataset.effort);
      selectedSubtaskEffort = selectedSubtaskEffort === value ? null : value;
      subtaskEffortGroup.querySelectorAll(".effort-chip").forEach((c) => {
        c.dataset.active = String(Number(c.dataset.effort) === selectedSubtaskEffort);
      });
    });
  });

  document.getElementById("td-subtask-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const subtaskTitleInput = document.getElementById("td-subtask-title");
    const title = subtaskTitleInput.value.trim();
    if (!title) return;
    // Eine neue Unteraufgabe übernimmt automatisch das Plandatum der Mutter, falls vorhanden —
    // sie gehört ja jetzt zur selben Gruppe (siehe planTaskCascade).
    await withErrorToast(async () => {
      await createTask({
        title,
        areaId: task.area_id,
        parentTaskId: task.id,
        effort: selectedSubtaskEffort,
        plannedDate: task.planned_date,
        status: task.planned_date ? "planned" : "open",
      });
      const refreshedTasks = await renderTaskDetailCard(task.id, close, false);
      refreshOpenViewsAfterTaskChange(refreshedTasks);
    });
  });

  document.getElementById("td-subtask-list").addEventListener("click", async (e) => {
    const li = e.target.closest("[data-child-id]");
    if (!li) return;
    const child = allTasks.find((t) => t.id === li.dataset.childId);
    if (!child) return;
    if (e.target.dataset.action === "toggle") {
      await withErrorToast(async () => {
        if (child.status === "done") {
          await reopenTaskCascade(child, allTasks);
        } else {
          await completeTaskCascade(child, allTasks);
          showCompleteUndoToast(child, allTasks, async () => {
            const refreshedTasks = await renderTaskDetailCard(task.id, close, false);
            refreshOpenViewsAfterTaskChange(refreshedTasks);
          });
        }
        const refreshedTasks = await renderTaskDetailCard(task.id, close, false);
        refreshOpenViewsAfterTaskChange(refreshedTasks);
      });
    } else if (e.target.dataset.action === "open") {
      await renderTaskDetailCard(child.id, close, false);
    }
  });
}

function renderTaskDetailEdit(card, task, allTasks, parentTask, children, backButtonHtml, close) {
  const excludeIds = collectDescendantIds(allTasks, task.id);
  excludeIds.add(task.id);

  const areaOpts =
    `<option value="">Kein Bereich</option>` +
    overviewState.areas
      .map((a) => `<option value="${a.id}"${a.id === task.area_id ? " selected" : ""}>${escapeHtml(a.name)}</option>`)
      .join("");
  const parentOpts =
    `<option value="">Keine uebergeordnete Aufgabe</option>` +
    taskOptionsHtml(allTasks, task.area_id, task.parent_task_id, excludeIds);
  const effortOpts = [["", "–"], ["5", "5"], ["10", "10"], ["30", "30"], ["60", "60"]]
    .map(([v, l]) => `<option value="${v}"${String(task.effort || "") === v ? " selected" : ""}>${l}</option>`)
    .join("");
  const statusOpts = [["open", "Offen"], ["planned", "Geplant"], ["done", "Erledigt"]]
    .map(([v, l]) => `<option value="${v}"${task.status === v ? " selected" : ""}>${l}</option>`)
    .join("");
  const priorityOpts = [["low", "Niedrig"], ["medium", "Mittel"], ["high", "Hoch"]]
    .map(([v, l]) => `<option value="${v}"${(task.priority || "medium") === v ? " selected" : ""}>${l}</option>`)
    .join("");

  card.innerHTML = `
    ${backButtonHtml}
    <h2>Aufgabe bearbeiten</h2>
    <label class="modal-label">Titel
      <input class="input" id="td-title" type="text" value="${escapeHtml(task.title)}" />
    </label>
    <label class="modal-label">Bereich
      <select class="select" id="td-area">${areaOpts}</select>
    </label>
    <label class="modal-label">Übergeordnete Aufgabe
      <select class="select" id="td-parent">${parentOpts}</select>
    </label>
    <div class="modal-row">
      <label class="modal-label">Aufwand
        <select class="select" id="td-effort">${effortOpts}</select>
      </label>
      <label class="modal-label">Priorität
        <select class="select" id="td-priority">${priorityOpts}</select>
      </label>
    </div>
    <div class="modal-row">
      <label class="modal-label">Status
        <select class="select" id="td-status">${statusOpts}</select>
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="td-is-event" ${task.is_event ? "checked" : ""} />
        Ist ein Termin
      </label>
      <label class="checkbox-label">
        <input type="checkbox" id="td-is-habit" ${isHabitTask(task) ? "checked" : ""} />
        Ist ein Habit
      </label>
    </div>
    <label class="modal-label">Plandatum${isTaskOverdue(task) ? ` <span class="badge badge-overdue">${BADGE_ICON_OVERDUE}Überfällig</span>` : ""}
      <div class="date-chips" id="td-date-chips" role="group" aria-label="Plandatum">
        <button type="button" class="date-chip" data-date="today">Heute</button>
        <button type="button" class="date-chip" data-date="tomorrow">Morgen</button>
        <button type="button" class="date-chip" data-date="" data-active="true">Kein Datum</button>
        <button type="button" class="date-chip" data-date="custom">Datum…</button>
        <input type="date" class="input date-chip-custom-input" aria-label="Eigenes Datum" hidden />
      </div>
    </label>

    <div class="modal-actions">
      <button class="btn" id="td-save" type="button">Speichern</button>
      <button class="btn btn-secondary" id="td-cancel-edit" type="button">Zurück</button>
      <button class="icon-btn" id="td-duplicate" type="button" aria-label="Aufgabe duplizieren"></button>
      <button class="icon-btn icon-btn-danger" id="td-delete" type="button" aria-label="Aufgabe löschen"></button>
    </div>`;

  document.getElementById("td-duplicate").appendChild(buildDuplicateIcon());
  document.getElementById("td-delete").appendChild(buildTrashIcon());

  const areaSel = document.getElementById("td-area");
  const parentSel = document.getElementById("td-parent");
  areaSel.addEventListener("change", () => {
    parentSel.innerHTML =
      `<option value="">Keine uebergeordnete Aufgabe</option>` +
      taskOptionsHtml(allTasks, areaSel.value || null, null, excludeIds);
  });

  const titleInput = document.getElementById("td-title");
  titleInput.focus();
  titleInput.select();
  document
    .getElementById("td-cancel-edit")
    .addEventListener("click", () => renderTaskDetailCard(task.id, close, false));

  const dateChips = wireDateChipGroup(document.getElementById("td-date-chips"));
  dateChips.setValue(task.planned_date);

  if (parentTask) {
    document
      .getElementById("td-back")
      .addEventListener("click", () => renderTaskDetailCard(parentTask.id, close, false));
  }

  document.getElementById("td-save").addEventListener("click", async () => {
    const areaId = areaSel.value || null;
    const effortVal = document.getElementById("td-effort").value;
    const newStatus = document.getElementById("td-status").value;
    const wasDone = task.status === "done";
    const willBeDone = newStatus === "done";
    const plannedDate = dateChips.getPlannedDate();
    // Status wird aus dem gesetzten Datum abgeleitet statt roh aus dem Dropdown übernommen — sonst
    // bleibt eine Aufgabe mit frisch gesetztem Datum "offen", solange das Dropdown nicht zusätzlich
    // manuell umgestellt wird, und taucht trotz Eigendatum erneut im Tagesplan-Vorschlag auf
    // (suggestTasksForPlan filtert nur nach status, nicht nach planned_date). "Erledigt" bleibt ein
    // expliziter Entscheid über das Dropdown, alles andere folgt demselben Muster wie
    // buildInlineAddForm/planTaskCascade.
    const derivedStatus = willBeDone ? "done" : plannedDate ? "planned" : "open";
    await withErrorToast(async () => {
      if (!wasDone && willBeDone) await completeTaskCascade(task, allTasks);
      else if (wasDone && !willBeDone) await reopenTaskCascade(task, allTasks);
      else if (children.length > 0) await planTaskCascade(task, plannedDate, allTasks);
      await updateTask(task.id, {
        title: document.getElementById("td-title").value.trim() || task.title,
        area_id: areaId,
        parent_task_id: parentSel.value || null,
        effort: effortVal ? Number(effortVal) : null,
        status: derivedStatus,
        planned_date: plannedDate,
        is_brainstorm: !areaId,
        priority: document.getElementById("td-priority").value,
        is_event: document.getElementById("td-is-event").checked,
        habit_weekdays: document.getElementById("td-is-habit").checked ? task.habit_weekdays ?? [] : null,
      });
      if (areaId !== task.area_id) await cascadeAreaChange(task.id, areaId, allTasks);
      close();
      refreshOpenViewsAfterTaskChange();
    });
  });
  document.getElementById("td-duplicate").addEventListener("click", async () => {
    await withErrorToast(async () => {
      await duplicateTaskTree(task, allTasks);
      close();
      showToast(`„${task.title}" dupliziert.`);
      refreshOpenViewsAfterTaskChange();
    });
  });
  document.getElementById("td-delete").addEventListener("click", async () => {
    await withErrorToast(async () => {
      close();
      await deleteTaskWithUndo(task, allTasks, refreshOpenViewsAfterTaskChange);
    });
  });
}

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
    btn.setAttribute("aria-label", localDate.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }));
    btn.textContent = String(cd);
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

async function renderPlanView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/plan.html");
  if (myGeneration !== renderGeneration) return;
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

/* ---------- Finanzen ---------- */

const POT_LABELS = { fixkosten: "Fixkosten", sicherheit: "Sicherheit", wachstum: "Wachstum", freiheit: "Freiheit" };
const POT_COLOR_VAR = {
  fixkosten: "var(--color-text-subtle)",
  sicherheit: "var(--color-accent)",
  wachstum: "var(--color-success)",
  freiheit: "var(--color-accent-warm)",
};
const INTERVAL_LABELS = { monthly: "monatlich", quarterly: "quartalsweise", yearly: "jährlich" };

// Ausgaben-Kategorien sind seit 2026-07-25 (War Room, finanzplan-erweiterungen-v2.md Punkt 9) frei
// editierbar und liegen in expense_categories (financeState.expenseCategories). Der 9er-Default-Satz
// wird beim ersten Laden lazy geseedet (seedExpenseCategoriesIfEmpty). Die bestehenden Slugs bleiben
// als stabile Keys erhalten → keine Datenmigration. Farben sind CVD-sicher aus dem dataviz-Skill.
const DEFAULT_EXPENSE_CATEGORIES = [
  { key: "essen", name: "Essen", color: "#2a78d6" },
  { key: "wohnen", name: "Wohnen/Fixkosten", color: "#1baf7a" },
  { key: "transport", name: "Transport", color: "#eda100" },
  { key: "gesundheit", name: "Gesundheit", color: "#4a3aa7" },
  { key: "sonstiges", name: "Sonstiges", color: "#e34948" },
  { key: "freizeit", name: "Hobbys & Freizeit", color: "#008300" },
  { key: "ausgehen", name: "Essen gehen / Ausgehen", color: "#00a3a3" },
  { key: "abos", name: "Abos & Streaming", color: "#b5179e" },
  { key: "anschaffungen", name: "Anschaffungen & Geschenke", color: "#7d5a2a" },
];

// Lookup-Helfer über den aktuellen expense_categories-Stand. "uncategorized" ist ein Sonderfall
// (kein echter DB-Eintrag), der im Donut/Dropdown als "Nicht kategorisiert" auftaucht.
function categoryLabel(key) {
  if (key === "uncategorized" || !key) return "Nicht kategorisiert";
  const cat = financeState.expenseCategories.find((c) => c.key === key);
  return cat ? cat.name : key;
}
function categoryColor(key) {
  if (key === "uncategorized" || !key) return "var(--color-border)";
  const cat = financeState.expenseCategories.find((c) => c.key === key);
  return cat ? cat.color : "var(--color-border)";
}
const WISHLIST_STATUS_LABELS = { inactive: "Inaktiv", active: "Aktiv", ready: "Kaufbereit", bought: "Gekauft" };
const WISHLIST_STATUS_CYCLE = ["inactive", "active", "ready", "bought"];
const WISHLIST_CATEGORY_LABELS = { need: "Need", invest: "Invest", enjoy: "Enjoy" };

function formatEuro(value) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value || 0);
}

function monthlyAmount(cost) {
  if (cost.interval === "quarterly") return cost.amount / 3;
  if (cost.interval === "yearly") return cost.amount / 12;
  return cost.amount;
}

function monthsUntil(dueDate) {
  const days = (new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.round(days / 30));
}

function weeksSinceFirstTransaction(transactions) {
  if (transactions.length === 0) return 0;
  const earliest = transactions.reduce((min, t) => (t.occurred_at < min ? t.occurred_at : min), transactions[0].occurred_at);
  const days = (Date.now() - new Date(earliest).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.floor(days / 7));
}

// Kaufbereit-Widget — identisch in Heute und Finanzen genutzt (gleiche Element-IDs in beiden
// Views, immer nur eine davon gleichzeitig im DOM). Zeigt bis zu 2 Einträge direkt, "+N weitere"
// bei mehr — gleiches Muster wie renderUpcomingEvents().
function renderBuyReadyAlert(wishlistItems, potBalance) {
  const card = document.getElementById("buyready-card");
  if (!card) return;
  const list = document.getElementById("buyready-list");
  const moreBtn = document.getElementById("buyready-more");
  const ready = filterBuyReady(wishlistItems, potBalance);

  if (ready.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const renderItems = (items) => {
    list.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = `${item.title} — ${formatEuro(item.current_price)}`;
      list.appendChild(li);
    }
  };
  renderItems(ready.slice(0, 2));
  if (ready.length > 2) {
    moreBtn.hidden = false;
    moreBtn.textContent = `+${ready.length - 2} weitere`;
    moreBtn.onclick = () => {
      renderItems(ready);
      moreBtn.hidden = true;
    };
  } else {
    moreBtn.hidden = true;
  }
}

const financeState = {
  settings: null,
  transactions: [],
  fixedCosts: [],
  committedExpenses: [],
  wishlistItems: [],
  expenseCategories: [],
  potBalance: 0,
  txFilterPot: "",
};

/* ---------- Habits ---------- */

const habitsViewState = { allTasks: [], areaColorById: {}, completions: [], counterLog: [] };

async function renderHabitsView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/habits.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  const [tasks, areas, completions, counterLog] = await Promise.all([
    listTasks(),
    listAreas(),
    listAllHabitCompletions(),
    listAllCounterLog(),
  ]);
  habitsViewState.allTasks = tasks;
  habitsViewState.areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));
  habitsViewState.completions = completions;
  habitsViewState.counterLog = counterLog;
  renderHabitList();
  wireHabitQuickAddForm();
}

// Direkter Habit-Einstieg im Habit-Tab selbst (implementieren-jetzt.md, Triage 2026-07-21) — bisher
// musste man zwingend erst eine normale Aufgabe anlegen/öffnen und dort td-is-habit aktivieren.
// Bewusst kein Bereichsfeld: ein Habit muss laut Nutzer keinem Bereich zugeordnet sein, area_id ist
// bereits nullable. Legt die Mutter mit habit_weekdays: [] an (noch keine Tage gewählt) — Wochentage
// konfiguriert der Nutzer danach über die bereits bestehenden Chips/Presets in der Liste, exakt wie
// bei einem über das Task-Detail-Modal erstellten Habit. Optionales erstes Pool-Kind nutzt dasselbe
// parent_task_id-Muster wie der bestehende Aufgaben-Pool (siehe js/habits.js, findHabitsDueToday).
function wireHabitQuickAddForm() {
  const toggleBtn = document.getElementById("habit-quick-add-toggle");
  const form = document.getElementById("habit-quick-form");
  const titleInput = document.getElementById("habit-quick-title");
  const subtaskInput = document.getElementById("habit-quick-subtask");
  const counterCheckbox = document.getElementById("habit-quick-counter");
  const unitInput = document.getElementById("habit-quick-unit");
  const goalInput = document.getElementById("habit-quick-goal");
  const cancelBtn = document.getElementById("habit-quick-cancel");
  const submitBtn = form.querySelector('button[type="submit"]');

  // Zähl-Habit-Toggle blendet Einheit- und (optionales) Tagesziel-Feld ein und das (dann sinnlose)
  // Pool-Kind-Feld aus — ein Zähl-Habit hat keinen Aufgaben-Pool.
  const syncCounterFields = () => {
    const on = counterCheckbox.checked;
    unitInput.hidden = !on;
    goalInput.hidden = !on;
    subtaskInput.hidden = on;
  };
  counterCheckbox.addEventListener("change", syncCounterFields);

  const closeForm = () => {
    form.hidden = true;
    form.reset();
    syncCounterFields();
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
    if (submitBtn.disabled) return;
    const title = titleInput.value.trim();
    if (!title) return;
    const isCounter = counterCheckbox.checked;
    const unit = unitInput.value.trim();
    if (isCounter && !unit) {
      unitInput.focus();
      return;
    }
    const subtaskTitle = subtaskInput.value.trim();
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        if (isCounter) {
          // Zähl-Habit: habit_weekdays: [] (bleibt isHabitTask, aber nie im Tagesplan), kein Pool-Kind.
          const goalRaw = goalInput.value.trim();
          const goal = goalRaw === "" ? null : Math.max(1, Number(goalRaw));
          await createTask({ title, habitWeekdays: [], habitUnit: unit, habitDailyGoal: goal });
        } else {
          const mother = await createTask({ title, habitWeekdays: [] });
          if (subtaskTitle) await createTask({ title: subtaskTitle, parentTaskId: mother.id });
        }
        closeForm();
        await renderHabitsView();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// Kompakte Punktreihe für den Default-Zustand einer Habit-Zeile: zeigt auf einen Blick, an
// welchen Wochentagen das Habit aktiv ist, ohne 7 antippbare 40px-Chips permanent vorzuhalten.
// Kompakte 7-Tage-Completion-Heatmap (ältester Tag links, heute rechts): erledigt = gefüllt,
// fällig-aber-offen = umrandet, nicht fällig = blass. Gibt auf einen Blick ein Gefühl für Konstanz
// ("don't break the chain"), ergänzend zum Streak-Badge. Zeitplan-Details bleiben in den
// aufklappbaren Wochentags-Chips.
function buildHabitHeatmap(task, completions, todayIso) {
  const done = new Set(completions.filter((c) => c.task_id === task.id).map((c) => c.date));
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const cells = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(ty, tm - 1, td - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const due = task.habit_weekdays.includes(weekdayCodeFromIso(iso));
    const state = done.has(iso) ? "done" : due ? "due" : "off";
    cells.push(`<span class="habit-heat-cell ${state}" title="${iso}"></span>`);
  }
  return `<span class="habit-heatmap" aria-hidden="true">${cells.join("")}</span>`;
}

function buildHabitChips(task, todayCode) {
  return WEEKDAY_CODES.map((code) => {
    const active = task.habit_weekdays.includes(code);
    const isToday = code === todayCode;
    const doneToday = isToday && task.planned_date === todayISO() && task.status === "done";
    const classes = ["weekday-chip"];
    if (isToday && active) classes.push(doneToday ? "today-done" : "today-due");
    return `<button type="button" class="${classes.join(" ")}" data-day="${code}" data-active="${active}">${WEEKDAY_LABEL[code]}</button>`;
  }).join("");
}

function buildRecurrenceOptions(task) {
  const current = task.habit_recurrence || "weekly";
  return Object.entries(RECURRENCE_LABEL)
    .map(([value, label]) => `<option value="${value}"${current === value ? " selected" : ""}>${label}</option>`)
    .join("");
}

// Konsolidierte DOM-Aktualisierung nach einer habit_weekdays-Änderung (Einzel-Chip-Toggle oder
// Mo-Fr/Wochenende/Täglich-Preset) — rendert die Chip-Gruppe komplett neu statt nur ein Dataset zu
// togglen, damit ein Preset alle sieben Chips auf einmal aktualisieren kann.
function updateHabitWeekdayChips(li, task, todayCode) {
  li.querySelector(".weekday-chips").innerHTML = buildHabitChips(task, todayCode);
  const recurrence = task.habit_recurrence || "weekly";
  li.querySelector(".habit-freq").textContent =
    recurrence === "weekly"
      ? `${task.habit_weekdays.length}× pro Woche`
      : `${task.habit_weekdays.length}× · ${RECURRENCE_LABEL[recurrence]}`;
}

// Rendert die Liste der Habit-Aufgaben. Jede Zeile startet im Kompakt-Zustand (Punktreihe) und
// klappt per Tap auf die editierbaren Mo-So-Chips auf — analog td-subtask-list im Detail-Modal
// nutzt auch das hier nur einen delegierten Klick-Handler auf #habit-list statt pro Zeile.
// Zähl-Habit-Zeile (mengen-basiert): ruhig, kein Tagesurteil — großer +-Button plus
// "heute: N · Ø diese Woche M". Keine Wochentags-/Streak-/Heatmap-Elemente (die gelten nur für
// geplante binäre Habits).
function buildCounterHabitRow(t) {
  const areaColor = habitsViewState.areaColorById[t.area_id];
  const today = sumCounterForDate(habitsViewState.counterLog, t.id, todayISO());
  const avg = weekAverageCounter(habitsViewState.counterLog, t.id, todayISO());
  const unit = escapeHtml(t.habit_unit);
  // Tagesziel (optional): "heute X / Ziel" plus ein Fortschrittsbalken. Ohne Ziel bleibt es beim
  // offenen Zähler wie bisher.
  const goal = Number(t.habit_daily_goal);
  const hasGoal = goal > 0;
  const todayLabel = hasGoal ? `<b>${today}</b> / ${goal}` : `<b>${today}</b>`;
  const goalBar = hasGoal
    ? `<span class="wish-fund-bar counter-goal-bar"><span class="wish-fund-fill${today >= goal ? " is-reached" : ""}" style="width:${Math.min(100, Math.round((today / goal) * 100))}%"></span></span>`
    : "";
  return `
    <li class="task-item habit-item counter-habit-row${hasGoal ? " has-goal" : ""}" data-habit-id="${t.id}" style="${
      areaColor ? `border-left-color:${areaColor};--task-area-color:${areaColor};` : ""
    }">
      <span class="task-area-dot" style="background:${areaColor || "var(--color-text-subtle)"}"></span>
      <div class="counter-body">
        <span class="task-title">${escapeHtml(t.title)}<span class="habit-freq">${unit}</span></span>
        <span class="counter-metric">heute: ${todayLabel} · Ø diese Woche ${avg}</span>
        ${goalBar}
      </div>
      <button type="button" class="counter-add-btn" data-counter-id="${t.id}" aria-label="Eine Einheit hinzufügen">+</button>
    </li>`;
}

function renderHabitList() {
  const habitTasks = habitsViewState.allTasks.filter(isHabitTask);
  const list = document.getElementById("habit-list");
  const todayCode = weekdayCodeFromIso(todayISO());
  list.innerHTML = "";

  if (habitTasks.length === 0) {
    list.appendChild(
      buildEmptyState("Noch keine Habits", "Markiere eine Aufgabe im Bearbeiten-Modal als Habit — sie taucht dann hier auf.")
    );
    return;
  }

  list.innerHTML = habitTasks
    .map((t) => {
      if (isCounterHabit(t)) return buildCounterHabitRow(t);
      const areaColor = habitsViewState.areaColorById[t.area_id];
      const recurrence = t.habit_recurrence || "weekly";
      const freqLabel =
        recurrence === "weekly" ? `${t.habit_weekdays.length}× pro Woche` : `${t.habit_weekdays.length}× · ${RECURRENCE_LABEL[recurrence]}`;
      const streak = computeHabitStreak(t, habitsViewState.completions, todayISO());
      const streakBadge =
        streak.count === 0
          ? ""
          : streak.type === "days"
            ? `<span class="habit-streak-badge" title="${streak.count} Tage in Folge">${STREAK_ICON_FLAME}${streak.count}</span>`
            : `<span class="habit-streak-badge is-total" title="${streak.count}× erledigt">${streak.count}×</span>`;
      const heatmap = buildHabitHeatmap(t, habitsViewState.completions, todayISO());
      return `
      <li class="task-item habit-item" data-habit-id="${t.id}" data-expanded="false" style="${
        areaColor ? `border-left-color:${areaColor};--task-area-color:${areaColor};` : ""
      }">
        <span class="task-area-dot" style="background:${areaColor || "var(--color-text-subtle)"}"></span>
        <div class="habit-body">
          <button type="button" class="habit-toggle" aria-expanded="false">
            <span class="task-title">${escapeHtml(t.title)}<span class="habit-freq">${freqLabel}</span></span>
            <span class="habit-metrics">${heatmap}${streakBadge}</span>
          </button>
          <div class="habit-expanded" hidden>
            <div class="habit-weekday-presets" role="group" aria-label="Wochentage-Voreinstellungen">
              <button type="button" class="chip-btn habit-preset-btn" data-preset="workdays">Mo–Fr</button>
              <button type="button" class="chip-btn habit-preset-btn" data-preset="weekend">Wochenende</button>
              <button type="button" class="chip-btn habit-preset-btn" data-preset="daily">Täglich</button>
            </div>
            <div class="weekday-chips" role="group" aria-label="Wochentage">
              ${buildHabitChips(t, todayCode)}
            </div>
            <label class="modal-label habit-recurrence-row">
              Wiederholung
              <select class="select habit-recurrence-select" data-habit-recurrence>${buildRecurrenceOptions(t)}</select>
            </label>
          </div>
        </div>
      </li>`;
    })
    .join("");

  list.onclick = async (e) => {
    const counterBtn = e.target.closest(".counter-add-btn");
    if (counterBtn) {
      const taskId = counterBtn.dataset.counterId;
      const task = habitsViewState.allTasks.find((t) => t.id === taskId);
      await withErrorToast(async () => {
        const entry = await logCounterTap({ taskId });
        habitsViewState.counterLog.push(entry);
        renderHabitList();
        showToast(`+1 ${task ? task.habit_unit : ""}`.trim(), false, {
          label: "Rückgängig",
          onClick: () =>
            withErrorToast(async () => {
              await deleteCounterEntry(entry.id);
              habitsViewState.counterLog = habitsViewState.counterLog.filter((c) => c.id !== entry.id);
              renderHabitList();
            }),
        });
      });
      return;
    }

    const chip = e.target.closest(".weekday-chip");
    if (chip) {
      const li = chip.closest("[data-habit-id]");
      const task = habitsViewState.allTasks.find((t) => t.id === li.dataset.habitId);
      const day = chip.dataset.day;
      const nextDays = task.habit_weekdays.includes(day)
        ? task.habit_weekdays.filter((d) => d !== day)
        : [...task.habit_weekdays, day];
      await withErrorToast(async () => {
        await updateTask(task.id, { habit_weekdays: nextDays });
        task.habit_weekdays = nextDays;
        updateHabitWeekdayChips(li, task, todayCode);
      });
      return;
    }

    const presetBtn = e.target.closest(".habit-preset-btn");
    if (presetBtn) {
      const li = presetBtn.closest("[data-habit-id]");
      const task = habitsViewState.allTasks.find((t) => t.id === li.dataset.habitId);
      const PRESET_WEEKDAYS = {
        workdays: ["mon", "tue", "wed", "thu", "fri"],
        weekend: ["sat", "sun"],
        daily: WEEKDAY_CODES,
      };
      const nextDays = PRESET_WEEKDAYS[presetBtn.dataset.preset];
      await withErrorToast(async () => {
        await updateTask(task.id, { habit_weekdays: nextDays });
        task.habit_weekdays = nextDays;
        updateHabitWeekdayChips(li, task, todayCode);
      });
      return;
    }

    const toggle = e.target.closest(".habit-toggle");
    if (toggle) {
      const li = toggle.closest("[data-habit-id]");
      const expanded = li.dataset.expanded === "true";
      li.dataset.expanded = String(!expanded);
      toggle.setAttribute("aria-expanded", String(!expanded));
      li.querySelector(".habit-expanded").hidden = expanded;
    }
  };

  list.onchange = async (e) => {
    const select = e.target.closest("[data-habit-recurrence]");
    if (!select) return;
    const li = select.closest("[data-habit-id]");
    const task = habitsViewState.allTasks.find((t) => t.id === li.dataset.habitId);
    const nextRecurrence = select.value;
    await withErrorToast(async () => {
      // habit_last_due_date bewusst NICHT mitschicken — ein Intervall-Wechsel allein darf den
      // Anker nicht zurücksetzen (siehe isRecurrenceDue in habits.js).
      await updateTask(task.id, { habit_recurrence: nextRecurrence });
      task.habit_recurrence = nextRecurrence;
    });
  };
}

async function renderFinanceView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/finance.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  showLoading("pot-grid");

  await loadFinanceData();
  renderPotGrid();
  renderBudgetTrend();
  renderCategoryDonut();
  renderBuyReadyAlert(financeState.wishlistItems, financeState.potBalance);
  renderCommittedPreview();
  renderFinanceManageSummary();
  renderTransactionList();
  renderWishlistCards();
  wireFinanceFilters();
  wireWishlistForm();
  wireTransactionQuickCapture();
  document.getElementById("salary-distribute-open").addEventListener("click", openSalaryDistributionModal);
}

// Geführter Gehalts-Einspiel-Workflow (wissensdatenbank/features/gehalt-einspielen.md): eine Eingabe
// (Netto) → live berechnete Wasserfall-Vorschau (Beträge überschreibbar) → Bestätigen aktiviert
// Phase 2, setzt die Töpfe-Settings und bucht Sicherheit/Schulden. Fixkosten laufen unabhängig über
// fixed_costs, Freiheit ist reines Monatsbudget (settings.pots.freiheit) — beide ohne eigene
// Transaktion. Modal-Muster wie openSettingsPanel().
function openSalaryDistributionModal() {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const fixSum = financeState.fixedCosts.reduce((sum, c) => sum + monthlyAmount(c), 0);
  const openDebts = (financeState.debts || []).filter((d) => Number(d.remaining_amount || 0) > 0);
  const debtTotal = openDebts.reduce((sum, d) => sum + Number(d.remaining_amount || 0), 0);
  const hasDebts = openDebts.length > 0;

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = close;

  root.innerHTML = `
    <div class="modal-backdrop" id="salary-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Gehalt einspielen">
        <h2>Gehalt einspielen</h2>
        <label class="modal-label">
          Netto-Gehalt (€)
          <input class="input" type="number" id="salary-netto" step="0.01" min="0" inputmode="decimal" placeholder="z. B. 2400" />
        </label>
        <div class="salary-waterfall">
          <div class="salary-row">
            <span class="salary-row-label"><span class="task-area-dot" style="background: var(--color-text-subtle)"></span>Fixkosten</span>
            <output class="salary-row-amount" id="salary-out-fix">${formatEuro(fixSum)}</output>
          </div>
          <label class="salary-row">
            <span class="salary-row-label"><span class="task-area-dot" style="background: var(--color-accent)"></span>Sicherheit</span>
            <input class="input salary-row-input" type="number" id="salary-in-sicherheit" step="1" min="0" inputmode="decimal" value="50" />
          </label>
          ${
            hasDebts
              ? `<label class="salary-row">
            <span class="salary-row-label"><span class="task-area-dot" style="background: var(--color-danger)"></span>Schulden tilgen</span>
            <input class="input salary-row-input" type="number" id="salary-in-schulden" step="1" min="0" max="${debtTotal}" inputmode="decimal" value="0" />
          </label>`
              : ""
          }
          <div class="salary-row salary-row-freiheit">
            <span class="salary-row-label"><span class="task-area-dot" style="background: var(--color-accent-warm)"></span>Freiheit (Rest)</span>
            <output class="salary-row-amount" id="salary-out-freiheit">${formatEuro(0)}</output>
          </div>
        </div>
        <p class="salary-warning" id="salary-warning" hidden>Die Verteilung übersteigt das Gehalt.</p>
        <p class="salary-hint">Bestätigen aktiviert Phase 2 und setzt die Topf-Ziele. Fixkosten laufen über deine erfassten Fixkosten, Freiheit ist dein Monatsbudget.</p>
        <div class="modal-actions">
          <button class="btn" type="button" id="salary-confirm" disabled>Bestätigen</button>
          <button class="btn btn-secondary" type="button" id="salary-close">Abbrechen</button>
        </div>
      </div>
    </div>`;

  const nettoInput = document.getElementById("salary-netto");
  const sicherheitInput = document.getElementById("salary-in-sicherheit");
  const schuldenInput = document.getElementById("salary-in-schulden");
  const freiheitOut = document.getElementById("salary-out-freiheit");
  const warning = document.getElementById("salary-warning");
  const confirmBtn = document.getElementById("salary-confirm");

  const recompute = () => {
    const netto = Number(nettoInput.value) || 0;
    const sicherheitRate = Number(sicherheitInput.value) || 0;
    const debtPayment = schuldenInput ? Number(schuldenInput.value) || 0 : 0;
    const { freiheit } = computeSalaryWaterfall({ netto, fixSum, sicherheitRate, debtPayment });
    freiheitOut.textContent = formatEuro(freiheit);
    const invalid = netto <= 0 || freiheit < 0;
    warning.hidden = !(netto > 0 && freiheit < 0);
    confirmBtn.disabled = invalid;
  };

  nettoInput.addEventListener("input", recompute);
  sicherheitInput.addEventListener("input", recompute);
  if (schuldenInput) schuldenInput.addEventListener("input", recompute);
  recompute();

  document.getElementById("salary-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "salary-backdrop") close();
  });
  document.getElementById("salary-close").addEventListener("click", close);

  confirmBtn.addEventListener("click", async () => {
    const netto = Number(nettoInput.value) || 0;
    const sicherheitRate = Number(sicherheitInput.value) || 0;
    const debtPayment = schuldenInput ? Number(schuldenInput.value) || 0 : 0;
    const { sicherheit, schulden, freiheit } = computeSalaryWaterfall({ netto, fixSum, sicherheitRate, debtPayment });
    if (netto <= 0 || freiheit < 0) return;
    confirmBtn.disabled = true;
    await withErrorToast(async () => {
      // 1. Phase 2 aktivieren + Töpfe/Notgroschen-Ziel setzen (Wachstum erst Phase 3).
      await updateFinanceModuleSettings({
        phase: 2,
        pots: { fixkosten: fixSum, sicherheit, wachstum: null, freiheit },
        notgroschen_target: 4 * fixSum,
        notgroschen_basis: fixSum,
      });
      // 2. Sicherheits-Rate als Einzahlung buchen (Pot-Grid liest Notgroschen aus expense pot=sicherheit).
      if (sicherheit > 0) {
        await createTransaction({
          direction: "expense",
          pot: "sicherheit",
          amount: sicherheit,
          note: "Gehalts-Einspiel — Sicherheit",
          occurredAt: todayISO(),
        });
      }
      // 3. Schuldentilgung: älteste offene Schuld(en) der Reihe nach auffüllen.
      let remainingPayment = schulden;
      for (const debt of openDebts) {
        if (remainingPayment <= 0) break;
        const rest = Number(debt.remaining_amount || 0);
        const pay = Math.min(rest, remainingPayment);
        if (pay <= 0) continue;
        await updateDebt(debt.id, { remaining_amount: Math.max(0, rest - pay) });
        await createTransaction({
          direction: "expense",
          pot: null,
          amount: pay,
          note: `Gehalts-Einspiel — Schuldentilgung ${debt.name}`,
          occurredAt: todayISO(),
        });
        remainingPayment -= pay;
      }
      // 4. Gehalt als Einnahme fürs Kassenbuch.
      await createTransaction({ direction: "income", pot: null, amount: netto, note: "Gehalt", occurredAt: todayISO() });
      close();
      await reloadFinance();
      showToast("Gehalt eingespielt — Phase 2 aktiv.");
    });
    confirmBtn.disabled = false;
  });
}

async function loadFinanceData() {
  const [settings, transactions, fixedCosts, committedExpenses, debts, wishlistItems, potBalance, expenseCategories] =
    await Promise.all([
      getFinanceModuleSettings(),
      listTransactions(),
      listFixedCosts(),
      listCommittedExpenses({ statusNot: "settled" }),
      listDebts(),
      listWishlistItems(),
      getSavingsPotBalance(),
      listExpenseCategories(),
    ]);
  financeState.settings = settings;
  financeState.transactions = transactions;
  financeState.fixedCosts = fixedCosts;
  financeState.committedExpenses = committedExpenses;
  financeState.debts = debts;
  financeState.wishlistItems = wishlistItems;
  financeState.potBalance = potBalance;
  financeState.expenseCategories = await seedExpenseCategoriesIfEmpty(expenseCategories);
}

// Lazy-Seed des 9er-Default-Satzes beim ersten Laden (per-User-Seed lässt sich nicht sauber in einer
// statischen Migration abbilden). Deckt Fresh-Install UND Bestand ab — bei Bestand tragen die alten
// Transaktionen bereits die Stock-Keys (essen/wohnen/…), die hier identisch angelegt werden.
async function seedExpenseCategoriesIfEmpty(existing) {
  if (existing.length > 0) return existing;
  const created = [];
  for (let i = 0; i < DEFAULT_EXPENSE_CATEGORIES.length; i++) {
    const def = DEFAULT_EXPENSE_CATEGORIES[i];
    created.push(await createExpenseCategory({ key: def.key, name: def.name, color: def.color, sortOrder: i }));
  }
  return created;
}

async function reloadFinance() {
  await loadFinanceData();
  renderCategoryQuickOptions();
  renderPotGrid();
  renderBudgetTrend();
  renderCategoryDonut();
  renderBuyReadyAlert(financeState.wishlistItems, financeState.potBalance);
  renderCommittedPreview();
  renderFinanceManageSummary();
  renderTransactionList();
  renderWishlistCards();
}

// Ersetzt die früheren drei fast leeren Fixkosten/Verpflichtende/Schulden-Panels durch kompakte
// Verwalten-Zeilen mit Monats-/Gesamtsumme rechts. "—" wenn nichts erfasst ist.
function renderFinanceManageSummary() {
  const fixEl = document.getElementById("fm-fixkosten");
  if (!fixEl) return;
  const fixSum = financeState.fixedCosts.reduce((sum, c) => sum + monthlyAmount(c), 0);
  fixEl.textContent = fixSum > 0 ? `${formatEuro(fixSum)}/Mon.` : "—";

  const committedSum = (financeState.committedExpenses || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  document.getElementById("fm-committed").textContent = committedSum > 0 ? formatEuro(committedSum) : "—";

  const debtSum = (financeState.debts || []).reduce((sum, d) => sum + Number(d.remaining_amount || 0), 0);
  const debtEl = document.getElementById("fm-debts");
  debtEl.textContent = debtSum > 0 ? formatEuro(debtSum) : "—";
  debtEl.classList.toggle("is-danger", debtSum > 0);
}

function buildPotCard(label, color, amountText, pct, celebrateAtFull = false) {
  const card = document.createElement("div");
  card.className = "pot-card";

  const ring = document.createElement("div");
  ring.className = "pot-ring";
  ring.classList.toggle("is-full", celebrateAtFull && pct >= 100);
  ring.style.setProperty("--pct", Math.max(0, Math.min(100, pct)));
  ring.style.setProperty("--ring-color", color);

  const info = document.createElement("div");
  const labelEl = document.createElement("div");
  labelEl.className = "p-label";
  labelEl.textContent = label;
  const amountEl = document.createElement("div");
  amountEl.className = "p-amount";
  amountEl.textContent = amountText;
  info.append(labelEl, amountEl);

  card.append(ring, info);
  return card;
}

// SVG-Mehrsegment-Ring statt CSS-conic-gradient (wie .pot-ring), weil die Segmentzahl hier variabel
// ist (0–7 je nach genutzten Kategorien) — stroke-dasharray/-dashoffset pro <circle>, kleine feste
// Lücke zwischen Segmenten. Legende darunter ist zugleich die Tabellen-Ansicht (dataviz-Skill:
// Pflicht ab ≥2 Segmenten) und die Textlabel-Absicherung für Farben mit Kontrast-Caveat.
function buildCategoryDonut(breakdown) {
  const panel = document.getElementById("category-donut-panel");
  const wrap = document.getElementById("category-donut-row");
  if (!panel || !wrap) return;

  const orderedKeys = [...financeState.expenseCategories].sort((a, b) => a.sort_order - b.sort_order).map((c) => c.key);
  const keys = [...orderedKeys, "uncategorized"].filter((k) => (breakdown[k] || 0) > 0);
  const total = keys.reduce((sum, k) => sum + breakdown[k], 0);
  wrap.innerHTML = "";
  if (total <= 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const size = 120;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = 3;
  const svgNS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.classList.add("category-donut-svg");

  const legend = document.createElement("ul");
  legend.className = "category-donut-legend";

  let offset = 0;
  for (const key of keys) {
    const value = breakdown[key];
    const fraction = value / total;
    const pct = Math.round(fraction * 100);
    const segmentLength = Math.max(0, fraction * circumference - gap);

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", String(size / 2));
    circle.setAttribute("cy", String(size / 2));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke-width", String(strokeWidth));
    circle.setAttribute("stroke-linecap", "butt");
    circle.setAttribute("stroke-dasharray", `${segmentLength} ${circumference - segmentLength}`);
    circle.setAttribute("stroke-dashoffset", String(-offset));
    circle.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
    circle.style.stroke = categoryColor(key);

    const title = document.createElementNS(svgNS, "title");
    title.textContent = `${categoryLabel(key)}: ${formatEuro(value)} (${pct}%)`;
    circle.appendChild(title);
    svg.appendChild(circle);
    offset += fraction * circumference;

    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "category-donut-dot";
    dot.style.background = categoryColor(key);
    li.append(dot, document.createTextNode(`${categoryLabel(key)} — ${formatEuro(value)} (${pct}%)`));
    legend.appendChild(li);
  }

  const chart = document.createElement("div");
  chart.className = "category-donut-chart";
  const center = document.createElement("div");
  center.className = "category-donut-center";
  center.textContent = formatEuro(total);
  chart.append(svg, center);

  wrap.append(chart, legend);
}

// Befüllt das Quick-Add-Kategorie-Dropdown dynamisch aus den frei editierbaren Kategorien; die
// leere Platzhalter-Option ("Kategorie (optional)") bleibt als Abwähl-Wert erhalten. Der aktuell
// gewählte Wert bleibt nach Möglichkeit erhalten.
function renderCategoryQuickOptions() {
  const select = document.getElementById("tx-quick-category");
  if (!select) return;
  const prev = select.value;
  select.innerHTML =
    `<option value="">Kategorie (optional)</option>` +
    financeState.expenseCategories.map((c) => `<option value="${c.key}">${c.name}</option>`).join("");
  if (prev && financeState.expenseCategories.some((c) => c.key === prev)) select.value = prev;
}

// Aktueller Kalendermonat, konsistent mit dem bestehenden spentThisMonth-Fenster weiter unten in
// renderPotGrid() — nur Ausgaben zählen (computeCategoryBreakdown filtert direction bereits).
function renderCategoryDonut() {
  const monthStart = todayISO().slice(0, 7) + "-01";
  const monthTransactions = financeState.transactions.filter((t) => t.occurred_at >= monthStart);
  buildCategoryDonut(computeCategoryBreakdown(monthTransactions));
}

// Fixkosten zeigt immer die echte Summe — läuft unabhängig von der Finanzplan-Phase. Sicherheit/
// Wachstum/Freiheit zeigen in Phase 1 einen Sammel-Platzhalter statt eines geratenen Betrags (siehe
// wissensdatenbank/finanzplan-ui-plan.md).
function renderPotGrid() {
  const grid = document.getElementById("pot-grid");
  const settings = financeState.settings.settings || {};
  const phase = settings.phase || 1;

  const fixkostenSum = financeState.fixedCosts.reduce((sum, c) => sum + monthlyAmount(c), 0);
  const cards = [buildPotCard(POT_LABELS.fixkosten, POT_COLOR_VAR.fixkosten, formatEuro(fixkostenSum), 100)];

  if (phase < 2) {
    const weeks = weeksSinceFirstTransaction(financeState.transactions);
    const placeholder = `Sammle Daten — Woche ${Math.min(weeks, 4)} von 4`;
    cards.push(buildPotCard(POT_LABELS.sicherheit, POT_COLOR_VAR.sicherheit, placeholder, 0));
    cards.push(buildPotCard(POT_LABELS.wachstum, POT_COLOR_VAR.wachstum, placeholder, 0));
    cards.push(buildPotCard(POT_LABELS.freiheit, POT_COLOR_VAR.freiheit, placeholder, 0));
  } else {
    const notgroschenProgress = financeState.transactions
      .filter((t) => t.pot === "sicherheit")
      .reduce((sum, t) => sum + (t.direction === "expense" ? Number(t.amount) : -Number(t.amount)), 0);
    const notgroschenTarget = settings.notgroschen_target || 0;
    const notgroschenPct = notgroschenTarget ? Math.round((notgroschenProgress / notgroschenTarget) * 100) : 0;
    cards.push(
      buildPotCard(
        POT_LABELS.sicherheit,
        POT_COLOR_VAR.sicherheit,
        `${formatEuro(notgroschenProgress)} / ${formatEuro(notgroschenTarget)}`,
        notgroschenPct,
        true
      )
    );

    const wachstumBetrag = settings.wachstum_monatsbetrag;
    cards.push(
      buildPotCard(
        POT_LABELS.wachstum,
        POT_COLOR_VAR.wachstum,
        wachstumBetrag ? `${formatEuro(wachstumBetrag)}/Monat` : "Noch nicht festgelegt",
        wachstumBetrag ? 100 : 0
      )
    );

    const freiheitBudget = settings.pots?.freiheit || 0;
    const monthStart = todayISO().slice(0, 7) + "-01";
    const spentThisMonth = financeState.transactions
      .filter((t) => t.pot === "freiheit" && t.direction === "expense" && t.occurred_at >= monthStart)
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const remaining = freiheitBudget - spentThisMonth;
    const freiheitPct = freiheitBudget ? Math.round((remaining / freiheitBudget) * 100) : 0;
    cards.push(
      buildPotCard(
        POT_LABELS.freiheit,
        POT_COLOR_VAR.freiheit,
        freiheitBudget ? `${formatEuro(remaining)} übrig` : "Noch nicht festgelegt",
        freiheitPct
      )
    );
  }

  grid.innerHTML = "";
  cards.forEach((c) => grid.appendChild(c));
}

// Ruhige Trend-Anzeige für den Freiheit-Topf (wissensdatenbank/finanzen-erweiterungen/
// finanzplan-erweiterungen-v2.md, Punkt 3) — bewusst kein Ampel-/Rot-Grün-Ton, nur Text + Pfeil.
// Gleiches Phase-1-Gate wie renderPotGrid(): ohne pots.freiheit gibt es keinen sinnvollen
// Tagesrichtwert, statt eines leeren Widgets erscheint derselbe "Sammle Daten"-Platzhaltertext.
function renderBudgetTrend() {
  const textEl = document.getElementById("budget-trend-text");
  if (!textEl) return;
  const settings = financeState.settings.settings || {};
  const phase = settings.phase || 1;
  const freiheitBudget = settings.pots?.freiheit;

  if (phase < 2 || !freiheitBudget) {
    const weeks = weeksSinceFirstTransaction(financeState.transactions);
    textEl.textContent = `Sammle Daten — Woche ${Math.min(weeks, 4)} von 4`;
    return;
  }

  const openReservationsMonthly = financeState.committedExpenses.reduce(
    (sum, exp) => sum + exp.amount / monthsUntil(exp.due_date),
    0
  );

  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysRemainingInMonth = daysInMonth - today.getDate() + 1;

  // windowDays orientiert sich an der Historie der freiheit-Ausgaben selbst (nicht an allen
  // Transaktionen) — "avg() über weniger Tage" statt eines Sonderfalls, siehe Vault-Notiz.
  const freiheitExpenses = financeState.transactions.filter((t) => t.pot === "freiheit" && t.direction === "expense");
  const earliestFreiheitIso = freiheitExpenses.reduce((min, t) => (t.occurred_at < min ? t.occurred_at : min), todayISO());
  const daysSinceEarliest = Math.floor((new Date(todayISO()) - new Date(earliestFreiheitIso)) / 86400000) + 1;
  const windowDays = Math.min(7, Math.max(1, daysSinceEarliest));

  const windowStart = new Date(today);
  windowStart.setDate(today.getDate() - (windowDays - 1));
  const windowStartOffset = windowStart.getTimezoneOffset();
  const windowStartIso = new Date(windowStart.getTime() - windowStartOffset * 60000).toISOString().slice(0, 10);

  const recentSpend = freiheitExpenses
    .filter((t) => t.occurred_at >= windowStartIso)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const { dailyBudget, avgRecent } = computeBudgetTrend({
    freiheitBudget,
    openReservationsMonthly,
    daysRemainingInMonth,
    recentSpend,
    windowDays,
  });

  const arrow = avgRecent <= dailyBudget ? "↓" : "↑";
  textEl.textContent = `Tagesbudget: ${formatEuro(dailyBudget)} · Schnitt letzte 7 Tage: ${formatEuro(avgRecent)} ${arrow}`;
}

// Kurze Vorschau der nächsten fälligen verpflichtenden Ausgaben, direkt unter dem Kaufbereit-Widget
// — die volle Verwaltung (anlegen/beglichen/löschen) sitzt weiter unten im eigenen Panel.
function renderCommittedPreview() {
  const list = document.getElementById("committed-preview-list");
  const upcoming = [...financeState.committedExpenses].sort((a, b) => (a.due_date < b.due_date ? -1 : 1)).slice(0, 3);
  list.innerHTML = "";
  for (const exp of upcoming) {
    const li = document.createElement("li");
    li.className = "task-item";

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = exp.name;

    const badge = document.createElement("span");
    badge.className = "badge badge-reserve";
    badge.textContent = `${formatEuro(exp.amount / monthsUntil(exp.due_date))}/Mon.`;

    const dateSpan = document.createElement("span");
    dateSpan.className = "count";
    dateSpan.textContent = `fällig ${formatShortDate(exp.due_date)}.`;

    li.append(title, badge, dateSpan);
    list.appendChild(li);
  }
}

// Notiz und Betrag sind direkt editierbar (Blur committet) — gleiches Muster wie
// buildFixedCostItem. Löschen läuft ohne Bestätigungs-Dialog: die Transaktion lässt sich per
// Undo-Toast (createTransaction mit denselben Werten) trivial wiederherstellen.
function buildTransactionItem(tx) {
  const li = document.createElement("li");
  li.className = "task-item tx-item";
  li.style.borderLeftColor = POT_COLOR_VAR[tx.pot] || "var(--color-text-subtle)";
  li.style.setProperty("--task-area-color", POT_COLOR_VAR[tx.pot] || "var(--color-surface)");

  const dot = document.createElement("span");
  dot.className = "task-area-dot";
  dot.style.background = POT_COLOR_VAR[tx.pot] || "var(--color-text-subtle)";

  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.className = "input area-name-input";
  noteInput.value = tx.note || "";
  noteInput.placeholder = POT_LABELS[tx.pot] || "Notiz";
  noteInput.setAttribute("aria-label", "Notiz");
  noteInput.addEventListener("blur", async () => {
    const value = noteInput.value.trim();
    if (value === (tx.note || "")) return;
    await withErrorToast(async () => {
      await updateTransaction(tx.id, { note: value || null });
      await reloadFinance();
    });
  });
  noteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") noteInput.blur();
  });

  const sign = document.createElement("span");
  sign.className = "count" + (tx.direction === "income" ? " tx-amount-income" : "");
  sign.textContent = tx.direction === "income" ? "+" : "−";

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.step = "0.01";
  amountInput.min = "0";
  amountInput.className = "input" + (tx.direction === "income" ? " tx-amount-income" : "");
  amountInput.style.maxWidth = "90px";
  amountInput.value = tx.amount;
  amountInput.setAttribute("aria-label", "Betrag");
  amountInput.addEventListener("blur", async () => {
    const value = Number(amountInput.value);
    if (!value || value === Number(tx.amount)) {
      amountInput.value = tx.amount;
      return;
    }
    await withErrorToast(async () => {
      await updateTransaction(tx.id, { amount: value });
      await reloadFinance();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteTransaction(tx.id);
      await reloadFinance();
      showToast(`${formatEuro(tx.amount)} gelöscht.`, false, {
        label: "Rückgängig",
        onClick: () =>
          withErrorToast(async () => {
            await createTransaction({
              direction: tx.direction,
              amount: tx.amount,
              pot: tx.pot,
              category: tx.category,
              note: tx.note,
              source: tx.source,
              occurredAt: tx.occurred_at,
            });
            await reloadFinance();
          }),
      });
    });
  });

  const line1 = document.createElement("div");
  line1.className = "tx-line";
  line1.append(dot, noteInput);

  const line2 = document.createElement("div");
  line2.className = "tx-line tx-line-amount";
  line2.append(sign, amountInput, deleteBtn);

  li.append(line1, line2);

  // Kategorie nachträglich änderbar (implementieren-jetzt.md, Triage 2026-07-20) — als Dropdown
  // statt Chip-Reihe (Triage 2026-07-21, dieselben TRANSACTION_CATEGORY_*-Konstanten wie im
  // Kategorie-Donut). Ausgeblendet bei Einnahmen, die haben keine Kategorie (analog zur
  // Topf-Auswahl im Neuanlage-Formular).
  if (tx.direction === "expense") {
    const categorySelect = document.createElement("select");
    categorySelect.className = "select tx-line";
    categorySelect.setAttribute("aria-label", "Kategorie");
    categorySelect.innerHTML =
      `<option value="">Nicht kategorisiert</option>` +
      financeState.expenseCategories
        .map((c) => `<option value="${c.key}"${tx.category === c.key ? " selected" : ""}>${c.name}</option>`)
        .join("");
    categorySelect.addEventListener("change", async () => {
      await withErrorToast(async () => {
        await updateTransaction(tx.id, { category: categorySelect.value || null });
        await reloadFinance();
      });
    });
    li.appendChild(categorySelect);
  }

  return li;
}

function renderTransactionList() {
  const list = document.getElementById("transaction-list");
  const emptyState = document.getElementById("transaction-empty-state");
  const filtered = financeState.txFilterPot
    ? financeState.transactions.filter((t) => t.pot === financeState.txFilterPot)
    : financeState.transactions;

  list.innerHTML = "";
  if (filtered.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  filtered.slice(0, 20).forEach((tx) => list.appendChild(buildTransactionItem(tx)));
}

function wireFinanceFilters() {
  const select = document.getElementById("tx-filter-pot");
  select.addEventListener("change", () => {
    financeState.txFilterPot = select.value;
    renderTransactionList();
  });
}

/* ---------- Fixkosten (eigene Unterseite) ---------- */
// wissensdatenbank/finanzen-erweiterungen/finanzplan-erweiterungen-v2.md, Punkt 1 — vorher
// Ausklapp-Panel in finance.html, jetzt eigene Seite mit mehr Platz. Eigener kleiner State statt
// financeState, da financeState.fixedCosts weiterhin für renderPotGrid() im Finanzen-Tab gebraucht
// wird (siehe dortiger Kommentar) und hier unabhängig neu geladen werden muss.

const fixkostenState = { costs: [] };

async function renderFixkostenView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/fixkosten.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadFixkostenList();
  wireFixkostenForm();
}

async function reloadFixkostenList() {
  fixkostenState.costs = await listFixedCosts();
  renderFixkostenList();
}

function renderFixkostenList() {
  const list = document.getElementById("fixed-costs-list");
  list.innerHTML = "";
  if (fixkostenState.costs.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Fixkosten", "Leg unten die erste feste Ausgabe an."));
    return;
  }
  fixkostenState.costs.forEach((cost) => list.appendChild(buildFixedCostItem(cost)));
}

function buildFixedCostItem(cost) {
  const li = document.createElement("li");
  li.className = "task-item";

  // Name und Betrag sind direkt editierbar (Blur committet) — Fixkosten ändern sich über die Zeit
  // (z.B. Mieterhöhung), dafür braucht es keinen eigenen Bearbeiten-Dialog.
  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = cost.name;
  title.setAttribute("aria-label", "Name");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === cost.name) {
      title.value = cost.name;
      return;
    }
    await withErrorToast(async () => {
      await updateFixedCost(cost.id, { name: value });
      await reloadFixkostenList();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.step = "0.01";
  amountInput.min = "0";
  amountInput.className = "input";
  amountInput.style.maxWidth = "100px";
  amountInput.value = cost.amount;
  amountInput.setAttribute("aria-label", "Betrag");
  amountInput.addEventListener("blur", async () => {
    const value = Number(amountInput.value);
    if (!value || value === Number(cost.amount)) {
      amountInput.value = cost.amount;
      return;
    }
    await withErrorToast(async () => {
      await updateFixedCost(cost.id, { amount: value });
      await reloadFixkostenList();
    });
  });

  const meta = document.createElement("span");
  meta.className = "count";
  // Jahressumme ergänzen — macht unterschiedliche Intervalle (monatlich/quartalsweise/jährlich) auf
  // einer gemeinsamen Skala vergleichbar (monatlicher Anteil × 12).
  meta.textContent = `${INTERVAL_LABELS[cost.interval]} · ${formatEuro(monthlyAmount(cost) * 12)}/Jahr`;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteFixedCost(cost.id);
      await reloadFixkostenList();
    });
  });

  li.append(title, amountInput, meta, deleteBtn);
  return li;
}

function wireFixkostenForm() {
  const fixedCostForm = document.getElementById("new-fixed-cost-form");
  const fixedCostSubmitBtn = fixedCostForm.querySelector('button[type="submit"]');
  fixedCostForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-fixed-cost-name");
    const amountInput = document.getElementById("new-fixed-cost-amount");
    const intervalSelect = document.getElementById("new-fixed-cost-interval");
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);
    if (!name || !amount || fixedCostSubmitBtn.disabled) return;
    fixedCostSubmitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createFixedCost({ name, amount, interval: intervalSelect.value });
        showToast(`„${name}" angelegt.`);
        nameInput.value = "";
        amountInput.value = "";
        intervalSelect.value = "monthly";
        await reloadFixkostenList();
      });
    } finally {
      fixedCostSubmitBtn.disabled = false;
    }
  });
}

/* ---------- Verpflichtende Ausgaben (eigene Unterseite) ---------- */
// Gleiche Umstellung wie Fixkosten oben — eigener State statt financeState (das bleibt für
// renderBudgetTrend()/renderCommittedPreview() im Finanzen-Tab zuständig).

const committedManageState = { expenses: [] };

async function renderVerpflichtendeAusgabenView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/verpflichtende-ausgaben.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadCommittedManageList();
  wireCommittedManageForm();
}

async function reloadCommittedManageList() {
  committedManageState.expenses = await listCommittedExpenses({ statusNot: "settled" });
  renderCommittedManageList();
}

function renderCommittedManageList() {
  const list = document.getElementById("committed-manage-list");
  list.innerHTML = "";
  if (committedManageState.expenses.length === 0) {
    list.appendChild(buildEmptyState("Noch keine verpflichtenden Ausgaben", "Leg unten die erste an."));
    return;
  }
  committedManageState.expenses.forEach((exp) => list.appendChild(buildCommittedItem(exp)));
}

function buildCommittedItem(exp) {
  const li = document.createElement("li");
  li.className = "task-item";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = exp.name;

  const meta = document.createElement("span");
  meta.className = "count";
  meta.textContent = `${formatEuro(exp.amount)} · fällig ${formatShortDate(exp.due_date)}.`;

  const settleBtn = document.createElement("button");
  settleBtn.type = "button";
  settleBtn.className = "icon-btn";
  settleBtn.textContent = "✓";
  settleBtn.setAttribute("aria-label", "Als beglichen markieren");
  settleBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await updateCommittedExpense(exp.id, { status: "settled" });
      await reloadCommittedManageList();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteCommittedExpense(exp.id);
      await reloadCommittedManageList();
    });
  });

  li.append(title, meta, settleBtn, deleteBtn);
  return li;
}

function wireCommittedManageForm() {
  const dateChips = wireDateChipGroup(document.getElementById("new-committed-date-chips"));
  const committedForm = document.getElementById("new-committed-form");
  const committedSubmitBtn = committedForm.querySelector('button[type="submit"]');
  committedForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-committed-name");
    const amountInput = document.getElementById("new-committed-amount");
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);
    const dueDate = dateChips.getPlannedDate();
    if (committedSubmitBtn.disabled) return;
    if (!name || !amount || !dueDate) {
      // due_date ist NOT NULL in der DB — ohne diesen Hinweis würde "Anlegen" bei "Kein Datum"
      // (dem Chip-Default) einfach stumm gar nichts tun.
      showToast(!dueDate ? "Bitte ein Fälligkeitsdatum wählen." : "Bitte Name und Betrag ausfüllen.", true);
      return;
    }
    committedSubmitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createCommittedExpense({ name, amount, dueDate });
        showToast(`„${name}" angelegt.`);
        nameInput.value = "";
        amountInput.value = "";
        dateChips.reset();
        await reloadCommittedManageList();
      });
    } finally {
      committedSubmitBtn.disabled = false;
    }
  });
}

/* ---------- Schulden (eigene Unterseite) ---------- */
// Gleiches Muster wie Fixkosten oben — eigener State, inline editierbare Restschuld. Die
// Vorrang-Logik (Tilgung vor Wachstums-/Freiheit-Zuteilung) läuft im Weekly Review, nicht hier.

const debtsState = { debts: [] };

async function renderDebtsView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/debts.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadDebtsList();
  wireDebtsForm();
}

async function reloadDebtsList() {
  debtsState.debts = await listDebts();
  renderDebtsList();
}

function renderDebtsList() {
  const list = document.getElementById("debts-list");
  list.innerHTML = "";
  if (debtsState.debts.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Schulden erfasst", "Leg unten die erste Restschuld an."));
    return;
  }
  debtsState.debts.forEach((debt) => list.appendChild(buildDebtItem(debt)));
}

function buildDebtItem(debt) {
  const li = document.createElement("li");
  li.className = "task-item";

  // Name und Restschuld sind direkt editierbar (Blur committet) — die Restschuld sinkt über die
  // Zeit durch Tilgung, dafür braucht es keinen eigenen Bearbeiten-Dialog (analog Fixkosten).
  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = debt.name;
  title.setAttribute("aria-label", "Name");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === debt.name) {
      title.value = debt.name;
      return;
    }
    await withErrorToast(async () => {
      await updateDebt(debt.id, { name: value });
      await reloadDebtsList();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.step = "0.01";
  amountInput.min = "0";
  amountInput.className = "input";
  amountInput.style.maxWidth = "100px";
  amountInput.value = debt.remaining_amount;
  amountInput.setAttribute("aria-label", "Restschuld");
  amountInput.addEventListener("blur", async () => {
    const value = Number(amountInput.value);
    if (Number.isNaN(value) || value === Number(debt.remaining_amount)) {
      amountInput.value = debt.remaining_amount;
      return;
    }
    await withErrorToast(async () => {
      await updateDebt(debt.id, { remaining_amount: value });
      await reloadDebtsList();
    });
  });

  // Meta zeigt nur, was gesetzt ist: Zins und/oder Mindestrate, sonst der ursprüngliche Betrag.
  const metaParts = [];
  if (debt.interest_rate != null) metaParts.push(`${debt.interest_rate}% p.a.`);
  if (debt.min_payment != null) metaParts.push(`min. ${formatEuro(debt.min_payment)}/Mon.`);
  if (metaParts.length === 0 && debt.initial_amount != null) {
    metaParts.push(`ursprünglich ${formatEuro(debt.initial_amount)}`);
  }
  const meta = document.createElement("span");
  meta.className = "count";
  meta.textContent = metaParts.join(" · ");

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteDebt(debt.id);
      await reloadDebtsList();
    });
  });

  li.append(title, amountInput, meta, deleteBtn);

  // Tilgungs-Fortschritt (volle Breite unter der Zeile) — nur wenn ein Ursprungsbetrag bekannt ist,
  // sonst gibt es keinen Bezugspunkt für "wie viel schon getilgt". Style wie die Wunschlisten-Leiste.
  const initial = Number(debt.initial_amount);
  const remaining = Number(debt.remaining_amount) || 0;
  if (initial > 0) {
    const paidPct = Math.min(100, Math.max(0, Math.round(((initial - remaining) / initial) * 100)));
    li.classList.add("debt-item");
    const bar = document.createElement("div");
    bar.className = "wish-fund-bar debt-progress-bar";
    const fill = document.createElement("div");
    fill.className = "wish-fund-fill";
    fill.style.width = `${paidPct}%`;
    bar.appendChild(fill);
    const label = document.createElement("span");
    label.className = "wish-fund-label debt-progress-label";
    label.textContent = `${paidPct}% getilgt`;
    li.append(bar, label);
  }
  return li;
}

function wireDebtsForm() {
  const debtForm = document.getElementById("new-debt-form");
  const debtSubmitBtn = debtForm.querySelector('button[type="submit"]');
  debtForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-debt-name");
    const remainingInput = document.getElementById("new-debt-remaining");
    const initialInput = document.getElementById("new-debt-initial");
    const interestInput = document.getElementById("new-debt-interest");
    const minPaymentInput = document.getElementById("new-debt-min-payment");
    const name = nameInput.value.trim();
    const remainingAmount = Number(remainingInput.value);
    if (!name || !remainingInput.value || Number.isNaN(remainingAmount) || debtSubmitBtn.disabled) return;
    // Ursprungsbetrag optional — ohne Angabe die Restschuld übernehmen (frisch aufgenommen).
    const initialAmount = initialInput.value ? Number(initialInput.value) : remainingAmount;
    const interestRate = interestInput.value ? Number(interestInput.value) : null;
    const minPayment = minPaymentInput.value ? Number(minPaymentInput.value) : null;
    debtSubmitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createDebt({ name, initialAmount, remainingAmount, interestRate, minPayment });
        showToast(`„${name}" angelegt.`);
        nameInput.value = "";
        remainingInput.value = "";
        initialInput.value = "";
        interestInput.value = "";
        minPaymentInput.value = "";
        await reloadDebtsList();
      });
    } finally {
      debtSubmitBtn.disabled = false;
    }
  });
}

// ---- Frei editierbare Ausgaben-Kategorien (Verwaltungs-Unterseite) ----
async function renderExpenseCategoriesView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/expense-categories.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadExpenseCategories();
  wireExpenseCategoryForm();
}

async function reloadExpenseCategories() {
  const monthIso = todayISO().slice(0, 7);
  const [categories, monthTx] = await Promise.all([
    listExpenseCategories(),
    listTransactions({ from: `${monthIso}-01`, to: todayISO() }),
  ]);
  financeState.expenseCategories = categories;
  // Ausgaben je Kategorie-Key im laufenden Monat — Basis für die Budget-Ampel.
  financeState.categorySpendThisMonth = computeCategoryBreakdown(monthTx);
  renderExpenseCategoriesList();
}

function renderExpenseCategoriesList() {
  const list = document.getElementById("expense-categories-list");
  if (!list) return;
  list.innerHTML = "";
  if (financeState.expenseCategories.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Kategorien", "Leg unten die erste Kategorie an."));
    return;
  }
  const sorted = [...financeState.expenseCategories].sort((a, b) => a.sort_order - b.sort_order);
  sorted.forEach((cat) => list.appendChild(buildExpenseCategoryItem(cat)));
}

function buildExpenseCategoryItem(cat) {
  const li = document.createElement("li");
  li.className = "task-item";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "input";
  colorInput.style.maxWidth = "48px";
  colorInput.value = cat.color;
  colorInput.setAttribute("aria-label", "Farbe");
  colorInput.addEventListener("change", async () => {
    if (colorInput.value === cat.color) return;
    await withErrorToast(async () => {
      await updateExpenseCategory(cat.id, { color: colorInput.value });
      await reloadExpenseCategories();
    });
  });

  const name = document.createElement("input");
  name.type = "text";
  name.className = "input area-name-input";
  name.value = cat.name;
  name.setAttribute("aria-label", "Name");
  name.addEventListener("blur", async () => {
    const value = name.value.trim();
    if (!value || value === cat.name) {
      name.value = cat.name;
      return;
    }
    await withErrorToast(async () => {
      await updateExpenseCategory(cat.id, { name: value });
      await reloadExpenseCategories();
    });
  });
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") name.blur();
  });

  // Monatsbudget (€/Monat), inline editierbar. Leeren entfernt das Budget (und damit die Ampel).
  const budgetInput = document.createElement("input");
  budgetInput.type = "number";
  budgetInput.min = "0";
  budgetInput.step = "1";
  budgetInput.className = "input";
  budgetInput.style.maxWidth = "90px";
  budgetInput.placeholder = "€/Mon.";
  budgetInput.value = cat.monthly_budget ?? "";
  budgetInput.setAttribute("aria-label", "Monatsbudget");
  budgetInput.addEventListener("blur", async () => {
    const raw = budgetInput.value.trim();
    const value = raw === "" ? null : Math.max(0, Number(raw));
    if (value === (cat.monthly_budget ?? null)) {
      budgetInput.value = cat.monthly_budget ?? "";
      return;
    }
    await withErrorToast(async () => {
      await updateExpenseCategory(cat.id, { monthly_budget: value });
      await reloadExpenseCategories();
    });
  });
  budgetInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") budgetInput.blur();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      // Transaktionen mit diesem Key werden "Nicht kategorisiert", dann die Kategorie löschen.
      await clearTransactionCategory(cat.key);
      await deleteExpenseCategory(cat.id);
      await reloadExpenseCategories();
    });
    showToast(`„${cat.name}" entfernt.`, false, {
      label: "Rückgängig",
      onClick: () =>
        withErrorToast(async () => {
          await createExpenseCategory({
            key: cat.key,
            name: cat.name,
            color: cat.color,
            sortOrder: cat.sort_order,
            monthlyBudget: cat.monthly_budget,
          });
          await reloadExpenseCategories();
        }),
    });
  });

  li.append(colorInput, name, budgetInput, deleteBtn);

  // Ampel + "X / Y €"-Label (volle Breite unter der Zeile), nur bei gesetztem Budget: grün < 80 %,
  // gelb 80–100 %, rot darüber. Macht Budget-Überschreitungen beim Scrollen sofort sichtbar.
  const budget = Number(cat.monthly_budget);
  if (budget > 0) {
    const spent = Number(financeState.categorySpendThisMonth?.[cat.key] || 0);
    const ratio = spent / budget;
    const state = ratio > 1 ? "over" : ratio >= 0.8 ? "warn" : "ok";
    li.classList.add("category-item");
    const label = document.createElement("span");
    label.className = `category-budget-label category-budget-${state}`;
    label.textContent = `${formatEuro(spent)} / ${formatEuro(budget)} diesen Monat`;
    li.append(label);
  }
  return li;
}

function wireExpenseCategoryForm() {
  const form = document.getElementById("new-expense-category-form");
  const submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-expense-category-name");
    const colorInput = document.getElementById("new-expense-category-color");
    const name = nameInput.value.trim();
    if (!name || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        const existingKeys = financeState.expenseCategories.map((c) => c.key);
        const key = slugifyCategoryKey(name, existingKeys);
        const sortOrder = financeState.expenseCategories.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1;
        await createExpenseCategory({ key, name, color: colorInput.value, sortOrder });
        showToast(`„${name}" angelegt.`);
        nameInput.value = "";
        colorInput.value = "#2a78d6";
        await reloadExpenseCategories();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function buildWishlistCard(item) {
  const card = document.createElement("div");
  card.className = "wish-card";

  const top = document.createElement("div");
  top.className = "wish-top";
  const title = document.createElement("span");
  title.className = "wish-title";
  title.textContent = item.title;
  const price = document.createElement("span");
  price.className = "wish-price";
  price.textContent = item.current_price != null ? formatEuro(item.current_price) : "—";
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteWishlistItem(item.id);
      await reloadFinance();
    });
  });
  top.append(title, price, deleteBtn);

  const tags = document.createElement("div");
  tags.className = "wish-tags";
  if (item.category) {
    const catTag = document.createElement("span");
    catTag.className = "wtag";
    catTag.textContent = WISHLIST_CATEGORY_LABELS[item.category];
    tags.appendChild(catTag);
  }
  const statusTag = document.createElement("button");
  statusTag.type = "button";
  statusTag.className = `wtag status-${item.status}`;
  statusTag.textContent = WISHLIST_STATUS_LABELS[item.status];
  statusTag.setAttribute("aria-label", "Status ändern");
  statusTag.addEventListener("click", async () => {
    const next = WISHLIST_STATUS_CYCLE[(WISHLIST_STATUS_CYCLE.indexOf(item.status) + 1) % WISHLIST_STATUS_CYCLE.length];
    await withErrorToast(async () => {
      await updateWishlistItem(item.id, { status: next });
      await reloadFinance();
    });
  });
  tags.appendChild(statusTag);

  card.append(top, tags);

  // Fortschritt bis zur Kaufbereitschaft direkt auf der Karte, statt erst sichtbar zu werden,
  // sobald der Spartopf den Preis schon vollständig deckt (siehe filterBuyReady/renderBuyReadyAlert)
  // — nur für Wünsche mit Preis, die noch nicht manuell auf "ready" gesetzt oder gekauft sind.
  if (item.current_price > 0 && (item.status === "active" || item.status === "inactive")) {
    const pct = Math.max(0, Math.min(100, Math.round((financeState.potBalance / item.current_price) * 100)));
    const fundBar = document.createElement("div");
    fundBar.className = "wish-fund-bar";
    const fill = document.createElement("div");
    fill.className = "wish-fund-fill";
    fill.style.width = `${pct}%`;
    fundBar.appendChild(fill);
    const fundLabel = document.createElement("div");
    fundLabel.className = "wish-fund-label";
    fundLabel.textContent = `${pct} % aus dem Spartopf finanzierbar`;
    card.append(fundBar, fundLabel);
  }

  return card;
}

function renderWishlistCards() {
  const list = document.getElementById("wishlist-cards");
  list.innerHTML = "";
  if (financeState.wishlistItems.length === 0) {
    list.appendChild(buildEmptyState("Wunschliste ist leer", "Leg unten deinen ersten Wunsch an — Rohtext reicht."));
    return;
  }
  financeState.wishlistItems.forEach((item) => list.appendChild(buildWishlistCard(item)));
}

function wireWishlistForm() {
  document.getElementById("new-wishlist-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("new-wishlist-title");
    const title = input.value.trim();
    if (!title) return;
    await withErrorToast(async () => {
      await createWishlistItem({ title });
      showToast(`„${title}" zur Wunschliste hinzugefügt.`);
      input.value = "";
      await reloadFinance();
    });
  });
}

// Per "+"-Button oben aufklappbares Formular, kein fixierter Balken — soll die Transaktionsliste
// nicht dauerhaft verdecken (gleiches Prinzip wie die Heute-Schnellerfassung).
function wireTransactionQuickCapture() {
  const form = document.getElementById("tx-quick-form");
  const toggleBtn = document.getElementById("tx-quick-toggle");
  const cancelBtn = document.getElementById("tx-quick-cancel");
  const amountInput = document.getElementById("tx-quick-amount");
  const directionGroup = document.getElementById("tx-quick-direction");
  const potGroup = document.getElementById("tx-quick-pot");
  const categoryGroup = document.getElementById("tx-quick-category");
  const notgroschenToggle = document.getElementById("tx-quick-notgroschen-toggle");
  const notgroschenCheckbox = document.getElementById("tx-quick-notgroschen-checkbox");
  const noteInput = document.getElementById("tx-quick-note");
  const submitBtn = form.querySelector('button[type="submit"]');

  let selectedPot = "freiheit";
  // Sobald der Nutzer den Topf einmal selbst antippt, hört das Kategorie-Automapping auf, seine
  // Wahl zu überschreiben (er weiß dann besser, wohin die Ausgabe gehört).
  let potTouchedManually = false;
  const setPot = (pot) => {
    selectedPot = pot;
    potGroup.querySelectorAll(".pot-chip").forEach((c) => (c.dataset.active = String(c.dataset.pot === selectedPot)));
  };
  potGroup.querySelectorAll(".pot-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      potTouchedManually = true;
      setPot(chip.dataset.pot);
    });
  });

  // Kategorie als Dropdown statt Chip-Reihe (implementieren-jetzt.md, Triage 2026-07-21) — der
  // leere Wert ("Kategorie (optional)") übernimmt die frühere Abwähl-Funktion des erneuten
  // Chip-Klicks, kein selectedCategory-State mehr nötig, categoryGroup.value ist die Quelle.
  // Kategorie schlägt automatisch den passenden Topf vor (solange nicht manuell gewählt): Wohnen
  // sind Fixkosten, Gesundheit fällt in Sicherheit, der Rest bleibt beim Default-Topf Freiheit.
  const CATEGORY_POT_MAP = { wohnen: "fixkosten", gesundheit: "sicherheit" };
  categoryGroup.addEventListener("change", () => {
    if (potTouchedManually) return;
    setPot(CATEGORY_POT_MAP[categoryGroup.value] || "freiheit");
  });

  // Töpfe ordnen Ausgaben einem Verwendungszweck zu — bei einer Einnahme ergibt das fachlich
  // keinen Sinn, daher wird die Topf-Auswahl dafür ausgeblendet statt nur deaktiviert. Die sechs
  // Kategorien sind ebenfalls ausgabenspezifisch, gleiches Verstecken bei Einnahme.
  let selectedDirection = "expense";
  directionGroup.querySelectorAll(".priority-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedDirection = chip.dataset.direction;
      directionGroup
        .querySelectorAll(".priority-chip")
        .forEach((c) => (c.dataset.active = String(c.dataset.direction === selectedDirection)));
      potGroup.hidden = selectedDirection === "income";
      categoryGroup.hidden = selectedDirection === "income";
      notgroschenToggle.hidden = selectedDirection !== "income";
    });
  });

  const closeForm = () => {
    form.hidden = true;
    form.reset();
    potTouchedManually = false;
    setPot("freiheit");
    categoryGroup.value = "";
    selectedDirection = "expense";
    directionGroup
      .querySelectorAll(".priority-chip")
      .forEach((c) => (c.dataset.active = String(c.dataset.direction === "expense")));
    potGroup.hidden = false;
    categoryGroup.hidden = false;
    notgroschenCheckbox.checked = false;
    notgroschenToggle.hidden = true;
  };

  // Letzte Ausgaben-Wahl (Topf + Kategorie) merken und beim nächsten Öffnen vorbelegen — spart bei
  // wiederkehrenden Ausgaben Klicks. Die Kategorie→Topf-Automatik bleibt aktiv, sobald der Nutzer die
  // Kategorie wechselt (potTouchedManually bleibt false).
  const TX_DEFAULT_KEY = "leben-os:tx-quick-default";
  const restoreLastTxDefault = () => {
    try {
      const raw = localStorage.getItem(TX_DEFAULT_KEY);
      if (!raw) return;
      const { pot, category } = JSON.parse(raw);
      if (category) categoryGroup.value = category;
      if (pot) setPot(pot);
    } catch {
      /* defekter/leerer Eintrag ignorieren, Standard-Default (Freiheit) greift */
    }
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      restoreLastTxDefault();
      amountInput.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    const amount = Number(amountInput.value);
    if (!amount) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createTransaction({
          amount,
          direction: selectedDirection,
          pot: selectedDirection === "income" ? (notgroschenCheckbox.checked ? "sicherheit" : null) : selectedPot,
          category: selectedDirection === "income" ? null : categoryGroup.value || null,
          note: noteInput.value.trim() || null,
        });
        showToast(`${formatEuro(amount)} erfasst.`);
        // Nur bei Ausgaben merken (Einnahmen haben weder Topf noch Kategorie).
        if (selectedDirection === "expense") {
          try {
            localStorage.setItem(TX_DEFAULT_KEY, JSON.stringify({ pot: selectedPot, category: categoryGroup.value || null }));
          } catch {
            /* localStorage nicht verfügbar — Merkfunktion still überspringen */
          }
        }
        closeForm();
        await reloadFinance();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- Fernsehprogramm ---------- */

const watchlistViewState = { items: [], allTasks: [], logEntries: [] };

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
function buildCurrentEpisodeLabel(item) {
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

async function renderFernsehprogrammView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/fernsehprogramm.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  showLoading("watchlist-week-list");

  const [items, allTasks, logEntries] = await Promise.all([listWatchlistItems(), listTasks(), listAllViewingLogEntries()]);
  // Update 2026-07-29, Nutzer-Entscheidung (kippt die Governance-Entscheidung 2026-07-25, siehe
  // wissensdatenbank/features/watchlist-fernsehprogramm.md, Abschnitt "Zugang & Grundmechanik"):
  // aktive Watchlist-Einträge sollen wieder automatisch die Woche füllen — aber NUR hier im
  // Fernsehprogramm-Tab, nicht in Heute (renderTodayView filtert Watchlist-tasks-Zeilen weiterhin
  // aus). autoplanWatchlistForDates legt für jeden Wochentag ohne bestehende Watchlist-Zeile eine an
  // (garantierter erster Slot pro Tag + zweiter Slot bei Budget-Kapazität, siehe planMissingSlots)
  // und liest die tatsächlichen tasks direkt aus der DB — die neu entstandenen Zeilen mergen wir in
  // allTasks, damit renderWatchlistWeek sie ohne zweiten Round-Trip sieht.
  const newSlots = await autoplanWatchlistForDates(items, currentWeekDates(todayISO()));
  watchlistViewState.items = items;
  watchlistViewState.allTasks = [...allTasks, ...newSlots];
  watchlistViewState.logEntries = logEntries;

  renderWatchlistWeek();
  renderWatchlistOverview();
  wireWatchlistFilters();
  wireWatchlistQuickAddForm();
  wireWatchlistPanelToggle();
}

// Watchlist-Übersicht ist standardmäßig eingeklappt — beim Öffnen des Tabs soll nur "Diese Woche"
// (das eigentliche Fernsehprogramm) direkt sichtbar sein, die volle Watchlist bleibt über den
// Toggle erreichbar.
function wireWatchlistPanelToggle() {
  const panel = document.getElementById("watchlist-panel");
  document.getElementById("watchlist-toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
}

function renderWatchlistWeek() {
  const list = document.getElementById("watchlist-week-list");
  const empty = document.getElementById("watchlist-week-empty-state");
  const weekDates = currentWeekDates(todayISO());
  const itemsById = new Map(watchlistViewState.items.map((i) => [i.id, i]));
  const tasksByDate = new Map(
    watchlistViewState.allTasks.filter((t) => isWatchlistTask(t) && weekDates.includes(t.planned_date)).map((t) => [t.planned_date, t])
  );

  list.innerHTML = weekDates
    .map((date) => {
      const label = WEEKDAY_LABEL[weekdayCodeFromIso(date)];
      const task = tasksByDate.get(date);
      if (!task) {
        return `<li class="task-item"><span class="task-title">${label} — <span class="status-message">frei</span></span></li>`;
      }
      const item = itemsById.get(task.watchlist_item_id);
      const titleText = `${label} — ${escapeHtml(item ? item.title : task.title)}${buildCurrentEpisodeLabel(item)}`;
      // Bereits abgeschlossene Slots: als erledigt zeigen, keine Aktionen mehr. Watchlist-Tasks
      // erscheinen seit der Governance-Entscheidung 2026-07-25 nicht mehr in Heute, daher wird die
      // Folge hier im Tab abgeschlossen (siehe wissensdatenbank/features/watchlist-fernsehprogramm.md).
      if (task.status === "done") {
        return `<li class="task-item watchlist-slot-done"><span class="task-title">✓ ${titleText}</span></li>`;
      }
      // Klick auf den Eintrag selbst löst Sichtung + Bewertung aus (wie früher der Aufgaben-Abschluss
      // in Heute) — der Titel ist der Button, kein separates ✓ mehr. Tausch-Button bleibt daneben.
      return `
        <li class="task-item">
          <button type="button" class="task-title task-title-btn watchlist-watched-btn" data-task-id="${task.id}" aria-label="Als geschaut abschließen und bewerten">${titleText}</button>
          <button type="button" class="icon-btn watchlist-swap-btn" data-task-id="${task.id}" aria-label="Tauschen">⇄</button>
        </li>`;
    })
    .join("");
  empty.hidden = tasksByDate.size > 0;

  list.querySelectorAll(".watchlist-swap-btn").forEach((btn) => {
    btn.addEventListener("click", () => openWatchlistSwapPicker(btn.dataset.taskId));
  });
  list.querySelectorAll(".watchlist-watched-btn").forEach((btn) => {
    btn.addEventListener("click", () => completeWatchlistSlot(btn.dataset.taskId));
  });
}

// Schließt einen verplanten Watchlist-Slot direkt im Fernsehprogramm-Tab ab: Sichtung + Bewertung
// über den bestehenden Rating-Dialog loggen (schiebt current_episode weiter), Task auf done setzen.
// Ersatz für den früheren Heute-Checkbox-Pfad, seit Watchlist-Tasks nicht mehr in Heute auftauchen.
async function completeWatchlistSlot(taskId) {
  const task = watchlistViewState.allTasks.find((t) => t.id === taskId);
  if (!task) return;
  await withErrorToast(async () => {
    await promptWatchlistRating(task);
    await completeTaskCascade(task, watchlistViewState.allTasks);
    await renderFernsehprogrammView();
  });
}

// Zeigt Tauschpartner für einen bereits verplanten Slot: andere verplante Tage dieser Woche
// (Datum↔Datum-Tausch) sowie unverplante 'aktive' Items (verplant↔unverplant-Tausch) — siehe
// buildSwapOperations() in js/watchlist.js für die eigentliche Tausch-Logik.
function openWatchlistSwapPicker(taskId) {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = close;

  const weekDates = currentWeekDates(todayISO());
  const currentTask = watchlistViewState.allTasks.find((t) => t.id === taskId);
  const itemsById = new Map(watchlistViewState.items.map((i) => [i.id, i]));
  const scheduledThisWeek = watchlistViewState.allTasks.filter(
    (t) => isWatchlistTask(t) && weekDates.includes(t.planned_date)
  );
  const otherScheduled = scheduledThisWeek.filter((t) => t.id !== taskId);
  const scheduledItemIds = new Set(scheduledThisWeek.map((t) => t.watchlist_item_id));
  const unscheduledItems = watchlistViewState.items.filter((i) => i.status === "aktiv" && !scheduledItemIds.has(i.id));

  const optionButtonsHtml =
    [
      ...otherScheduled.map((t) => {
        const item = itemsById.get(t.watchlist_item_id);
        const label = WEEKDAY_LABEL[weekdayCodeFromIso(t.planned_date)];
        return `<button type="button" class="btn btn-secondary watchlist-swap-option" data-kind="scheduled" data-task-id="${t.id}" data-date="${t.planned_date}" data-item-id="${t.watchlist_item_id}">${label} — ${escapeHtml(item ? item.title : t.title)}</button>`;
      }),
      ...unscheduledItems.map(
        (i) =>
          `<button type="button" class="btn btn-secondary watchlist-swap-option" data-kind="unscheduled" data-item-id="${i.id}">${escapeHtml(i.title)} (unverplant)</button>`
      ),
    ].join("") || `<p class="empty-state">Keine Tauschpartner verfügbar.</p>`;

  root.innerHTML = `
    <div class="modal-backdrop" id="swap-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Tauschen">
        <h2 class="modal-view-title">Womit tauschen?</h2>
        ${optionButtonsHtml}
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="swap-cancel">Abbrechen</button>
        </div>
      </div>
    </div>`;
  document.getElementById("swap-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "swap-backdrop") close();
  });
  document.getElementById("swap-cancel").addEventListener("click", close);
  root.querySelectorAll(".watchlist-swap-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const slotA = { taskId: currentTask.id, plannedDate: currentTask.planned_date, watchlistItemId: currentTask.watchlist_item_id };
      const slotB =
        btn.dataset.kind === "scheduled"
          ? { taskId: btn.dataset.taskId, plannedDate: btn.dataset.date, watchlistItemId: btn.dataset.itemId }
          : { watchlistItemId: btn.dataset.itemId };
      await withErrorToast(async () => {
        await applyWatchlistSwap(slotA, slotB);
        close();
        await renderFernsehprogrammView();
      });
    });
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
    `<div class="watchlist-active-meta">${buildWatchlistTypeBadge(item.type)}${meta.length ? `<span>${meta.join(" · ")}</span>` : ""}</div>` +
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
    closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = close;

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
  const [items, log] = await Promise.all([listWatchlistItems(), listViewingLog(itemId)]);
  const item = items.find((i) => i.id === itemId);
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

// ----- Bewertungs-Popup beim Erledigen in der Heute-Ansicht -----

// Öffnet direkt beim Abhaken einer Watchlist-Aufgabe ein kleines 1-10-Bewertungs-Popup (plus
// "Überspringen"). Loggt die Sichtung immer (auch bei Überspringen, rating bleibt dann null) und rückt bei
// Serien/Anime current_episode automatisch eine Folge weiter — einfache v1-Warteschlangenlogik
// ohne Staffel-Rollover, der bleibt manuell über next_season_release_date (siehe Plan). Gibt die
// neue Log-Zeilen-ID zurück, damit showCompleteUndoToast sie bei Rückgängig mit entfernen kann.
async function promptWatchlistRating(task) {
  const items = await listWatchlistItems();
  const item = items.find((i) => i.id === task.watchlist_item_id);
  if (!item) return null;

  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    document.body.style.overflow = "hidden";

    const close = (logId) => {
      root.innerHTML = "";
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
      closeActiveModal = null;
      resolve(logId);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") submit(null);
    };
    document.addEventListener("keydown", onKeydown);
    closeActiveModal = () => close(null);

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

/* ---------- Rezepte ---------- */
// wissensdatenbank/features/kochen-rezepte-kuehlschrank.md, Punkt 1 — Grundlage für den später
// geplanten digitalen Kühlschrank/Kochen-fördern.

async function renderRezepteView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/rezepte.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  recipesViewState.search = "";
  await renderRecipeList();
  wireRecipeQuickAddForm();
  const searchInput = document.getElementById("recipe-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      recipesViewState.search = searchInput.value;
      paintRecipeList();
    });
  }
}

// Cache der zuletzt geladenen Rezepte + Vorratsnamen, damit die Titelsuche nur neu filtert statt
// bei jedem Tastendruck erneut aus Supabase zu laden.
const recipesViewState = { recipes: [], pantryNames: [], search: "" };

async function renderRecipeList() {
  // Vorrat mitladen für den "kochbar jetzt"-Abgleich (verbindet Rezepte- und Kühlschrank-Tab).
  const [recipes, pantryItems] = await Promise.all([listRecipes(), listPantryItems()]);
  recipesViewState.recipes = recipes;
  recipesViewState.pantryNames = pantryItems.map((p) => (p.name || "").toLowerCase()).filter(Boolean);
  paintRecipeList();
}

function paintRecipeList() {
  const list = document.getElementById("recipe-list");
  const emptyState = document.getElementById("recipe-empty-state");
  const searchInput = document.getElementById("recipe-search");
  const { recipes, pantryNames } = recipesViewState;
  list.innerHTML = "";
  if (recipes.length === 0) {
    list.className = "task-list";
    emptyState.hidden = false;
    if (searchInput) searchInput.hidden = true;
    return;
  }
  emptyState.hidden = true;
  // Suchfeld erst ab einer Handvoll Rezepte einblenden — darunter ist es reiner Ballast.
  if (searchInput) searchInput.hidden = recipes.length < 5;
  const query = recipesViewState.search.trim().toLowerCase();
  const shown = query ? recipes.filter((r) => (r.title || "").toLowerCase().includes(query)) : recipes;
  list.className = "recipe-grid";
  if (shown.length === 0) {
    const note = document.createElement("p");
    note.className = "kanban-empty";
    note.textContent = "Keine Treffer.";
    list.className = "task-list";
    list.appendChild(note);
    return;
  }
  for (const recipe of shown) {
    list.appendChild(buildRecipeCard(recipe, pantryNames));
  }
}

function buildRecipeCard(recipe, pantryNames) {
  const li = document.createElement("li");
  li.className = "recipe-card";

  const ingredients = (recipe.ingredients || []).filter((i) => i && i.name);
  // Kochbar-Abgleich: Zutat gilt als vorhanden, wenn ein Vorratsname sie als Teilstring enthält
  // oder umgekehrt (frei eingegebene Namen, gleiche Fuzzy-Logik wie der Watchlist-Genre-Filter).
  let badge = "";
  if (ingredients.length > 0) {
    const missing = ingredients.filter((ing) => {
      const n = ing.name.toLowerCase().trim();
      return !pantryNames.some((p) => p.includes(n) || n.includes(p));
    }).length;
    badge =
      missing === 0
        ? `<span class="recipe-badge is-ready">✓ kochbar</span>`
        : `<span class="recipe-badge is-missing">${missing} fehlt${missing === 1 ? "" : "en"}</span>`;
  }

  const chips = [`<span class="recipe-chip">${ingredients.length} Zutat${ingredients.length === 1 ? "" : "en"}</span>`];
  if (recipe.instructions && recipe.instructions.trim()) chips.push(`<span class="recipe-chip">Zubereitung</span>`);

  li.innerHTML =
    `<div class="recipe-cover" aria-hidden="true">🍳</div>` +
    `<div class="recipe-card-body">` +
    `<span class="recipe-card-title">${escapeHtml(recipe.title)}</span>` +
    `<div class="recipe-chips">${chips.join("")}</div>` +
    `</div>` +
    badge;
  li.addEventListener("click", () => openRecipeDetail(recipe.id));
  return li;
}

function wireRecipeQuickAddForm() {
  const toggleBtn = document.getElementById("recipe-quick-add-toggle");
  const form = document.getElementById("recipe-quick-form");
  const titleInput = document.getElementById("recipe-quick-title");
  const cancelBtn = document.getElementById("recipe-quick-cancel");

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
      const recipe = await createRecipe({ title });
      closeForm();
      await renderRecipeList();
      // Ein frisch angelegtes Rezept ohne Zutaten ist wenig nützlich — direkt ins Detail-Modal
      // zum Ausfüllen, statt einen zusätzlichen Klick auf den Listeneintrag zu verlangen.
      await openRecipeDetail(recipe.id);
    });
  });
}

// ----- Rezept-Detail (Modal) -----

async function openRecipeDetail(recipeId, mode) {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  closeActiveModal = close;

  root.innerHTML = `
    <div class="modal-backdrop" id="recipe-detail-backdrop">
      <div class="modal-card" id="recipe-detail-card" role="dialog" aria-modal="true" aria-label="Rezept"></div>
    </div>`;
  document.getElementById("recipe-detail-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "recipe-detail-backdrop") close();
  });

  await renderRecipeDetailCard(recipeId, close, mode);
}

function buildIngredientRow(ingredient = { name: "", amount: "" }) {
  const row = document.createElement("div");
  row.className = "new-task-form";
  row.innerHTML = `
    <input type="text" class="input ingredient-name" placeholder="Zutat" value="${escapeHtml(ingredient.name || "")}" />
    <input type="text" class="input ingredient-amount" placeholder="Menge (optional)" value="${escapeHtml(ingredient.amount || "")}" />
    <button type="button" class="icon-btn icon-btn-danger" aria-label="Zutat entfernen">×</button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  return row;
}

// Startet standardmäßig im Lese-Modus (Einkaufslisten-Optik) für ein bereits ausgefülltes Rezept,
// im Edit-Modus für ein frisch angelegtes leeres (implementieren-jetzt.md, Triage 2026-07-21 —
// vorher war die Ansicht immer im Editier-Modus, kein Lese-/Bearbeiten-Unterschied). Ein explizit
// übergebener mode gewinnt immer (z.B. "Bearbeiten"-Button oder Rücksprung nach dem Speichern).
async function renderRecipeDetailCard(recipeId, close, mode) {
  const recipes = await listRecipes();
  const recipe = recipes.find((r) => r.id === recipeId);
  const card = document.getElementById("recipe-detail-card");
  if (!recipe || !card) {
    close();
    return;
  }

  const hasContent = recipe.ingredients?.some((i) => i.name) || recipe.instructions;
  const currentMode = mode || (hasContent ? "view" : "edit");

  if (currentMode === "view") {
    renderRecipeViewCard(recipe, card, close);
  } else {
    renderRecipeEditCard(recipe, card, close);
  }

  document.getElementById("rd-delete").addEventListener("click", async () => {
    const ok = await showConfirm(`„${recipe.title}" wirklich löschen?`, { confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await withErrorToast(async () => {
      await deleteRecipe(recipe.id);
      close();
      await renderRecipeList();
    });
  });
}

function renderRecipeViewCard(recipe, card, close) {
  const ingredients = recipe.ingredients?.filter((i) => i.name) || [];
  const ingredientsHtml = ingredients.length
    ? ingredients
        .map((i) => `<li class="task-item"><span class="task-title">${i.amount ? `${escapeHtml(i.amount)} ` : ""}${escapeHtml(i.name)}</span></li>`)
        .join("")
    : `<li class="empty-state">Keine Zutaten hinterlegt.</li>`;

  card.innerHTML = `
    <h2 class="modal-view-title">${escapeHtml(recipe.title)}</h2>

    <h3>Zutaten</h3>
    <ul class="task-list" id="rd-ingredients-view">${ingredientsHtml}</ul>

    <h3>Zubereitung</h3>
    <p class="status-message" style="white-space:pre-wrap">${recipe.instructions ? escapeHtml(recipe.instructions) : "Keine Zubereitung hinterlegt."}</p>

    <div class="modal-actions">
      <button class="btn" type="button" id="rd-edit">Bearbeiten</button>
      <button class="btn btn-secondary" type="button" id="rd-shopping-list">Einkaufsliste kopieren</button>
      <button class="btn btn-secondary" type="button" id="rd-close">Schließen</button>
    </div>
    <p class="status-message" id="rd-status"></p>

    <button class="btn" type="button" id="rd-delete" style="background:var(--color-danger)">Rezept löschen</button>
  `;

  document.getElementById("rd-close").addEventListener("click", close);
  document.getElementById("rd-edit").addEventListener("click", () => {
    renderRecipeDetailCard(recipe.id, close, "edit");
  });
  document.getElementById("rd-shopping-list").addEventListener("click", async () => {
    const status = document.getElementById("rd-status");
    const text = formatIngredientsForShoppingList(ingredients);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "In die Zwischenablage kopiert.";
    } catch {
      status.textContent = text;
    }
  });
}

function renderRecipeEditCard(recipe, card, close) {
  card.innerHTML = `
    <h2 class="modal-view-title">${escapeHtml(recipe.title)}</h2>

    <label class="modal-label">Titel
      <input type="text" class="input" id="rd-title" value="${escapeHtml(recipe.title)}" />
    </label>

    <h3>Zutaten</h3>
    <div id="rd-ingredients-list"></div>
    <button class="btn btn-secondary" type="button" id="rd-add-ingredient">+ Zutat</button>

    <label class="modal-label">Zubereitung
      <textarea class="input" id="rd-instructions" rows="6">${escapeHtml(recipe.instructions || "")}</textarea>
    </label>

    <div class="modal-actions">
      <button class="btn" type="button" id="rd-save">Speichern</button>
      <button class="btn btn-secondary" type="button" id="rd-shopping-list">Einkaufsliste kopieren</button>
      <button class="btn btn-secondary" type="button" id="rd-close">Schließen</button>
    </div>
    <p class="status-message" id="rd-status"></p>

    <button class="btn" type="button" id="rd-delete" style="background:var(--color-danger)">Rezept löschen</button>
  `;

  const ingredientsList = document.getElementById("rd-ingredients-list");
  const ingredients = recipe.ingredients?.length ? recipe.ingredients : [{ name: "", amount: "" }];
  for (const ingredient of ingredients) {
    ingredientsList.appendChild(buildIngredientRow(ingredient));
  }

  document.getElementById("rd-add-ingredient").addEventListener("click", () => {
    ingredientsList.appendChild(buildIngredientRow());
  });

  document.getElementById("rd-close").addEventListener("click", close);

  document.getElementById("rd-save").addEventListener("click", async () => {
    const status = document.getElementById("rd-status");
    const title = document.getElementById("rd-title").value.trim();
    if (!title) {
      status.textContent = "Titel darf nicht leer sein.";
      return;
    }
    const collectedIngredients = [...ingredientsList.querySelectorAll(".new-task-form")]
      .map((row) => ({
        name: row.querySelector(".ingredient-name").value.trim(),
        amount: row.querySelector(".ingredient-amount").value.trim() || null,
      }))
      .filter((i) => i.name);
    const instructions = document.getElementById("rd-instructions").value.trim() || null;

    status.textContent = "Speichere…";
    try {
      await updateRecipe(recipe.id, { title, ingredients: collectedIngredients, instructions });
      await renderRecipeList();
      // Zurück zur Leseansicht nach dem Speichern (implementieren-jetzt.md, Triage 2026-07-21) —
      // vorher blieb die Ansicht nach dem Speichern im selben Editier-Modus stehen.
      await renderRecipeDetailCard(recipe.id, close, "view");
    } catch (err) {
      status.textContent = friendlyErrorMessage(err);
    }
  });

  document.getElementById("rd-shopping-list").addEventListener("click", async () => {
    const status = document.getElementById("rd-status");
    const collectedIngredients = [...ingredientsList.querySelectorAll(".new-task-form")]
      .map((row) => ({
        name: row.querySelector(".ingredient-name").value.trim(),
        amount: row.querySelector(".ingredient-amount").value.trim() || null,
      }))
      .filter((i) => i.name);
    const text = formatIngredientsForShoppingList(collectedIngredients);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "In die Zwischenablage kopiert.";
    } catch {
      status.textContent = text;
    }
  });
}

/* ---------- Kühlschrank ---------- */
// wissensdatenbank/features/kochen-rezepte-kuehlschrank.md, Punkt 2 — diese Runde deckt nur den
// manuellen Bestand-Teil ab (Zu-/Abgangs-Werkzeug), keine automatische OCR-Befüllung.

// Freies category-Feld auf pantry_items (kein CHECK-Constraint), aber eine feste, kleine Auswahl
// hält die Liste konsistent statt frei getippter Varianten (implementieren-jetzt.md, Triage
// 2026-07-21) — geteilt zwischen Quick-Add-Select (kuehlschrank.html) und Inline-Edit pro Zeile.
const PANTRY_CATEGORY_LABELS = {
  kuehlschrank: "Kühlschrank",
  tiefkuehl: "Tiefkühl",
  vorrat: "Vorrat",
  gewuerze: "Gewürze",
};

// Icon + Farbe je Kategorie für die Gruppen-Überschriften (spiegelt die mentale Ordnung einer
// Küche). Reihenfolge = Anzeigereihenfolge der Abschnitte; "" fängt unkategorisierte Items ab.
const PANTRY_CATEGORY_META = {
  kuehlschrank: { label: "Kühlschrank", icon: "❄️", color: "var(--color-accent)" },
  tiefkuehl: { label: "Tiefkühl", icon: "🧊", color: "var(--color-cat-gesundheit)" },
  vorrat: { label: "Vorrat", icon: "🥫", color: "var(--color-accent-warm)" },
  gewuerze: { label: "Gewürze", icon: "🌿", color: "var(--color-success)" },
};
const PANTRY_CATEGORY_ORDER = ["kuehlschrank", "tiefkuehl", "vorrat", "gewuerze", ""];

async function renderKuehlschrankView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/kuehlschrank.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  await renderPantryList();
  wirePantryQuickAddForm();
}

async function renderPantryList() {
  const list = document.getElementById("pantry-list");
  const emptyState = document.getElementById("pantry-empty-state");
  const items = await listPantryItems();
  list.innerHTML = "";
  if (items.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  // Nach Kategorie gruppiert mit Icon-Überschrift statt einer flachen Liste.
  for (const cat of PANTRY_CATEGORY_ORDER) {
    const catItems = items.filter((i) => (i.category || "") === cat);
    if (catItems.length === 0) continue;
    const meta = PANTRY_CATEGORY_META[cat] || { label: "Ohne Kategorie", icon: "📦", color: "var(--color-text-subtle)" };

    const section = document.createElement("section");
    section.className = "pantry-group";

    const header = document.createElement("div");
    header.className = "pantry-group-header";
    header.style.setProperty("--c", meta.color);
    header.innerHTML =
      `<span class="pantry-group-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="pantry-group-title">${meta.label}</span>` +
      `<span class="count">${catItems.length}</span>`;
    section.appendChild(header);

    const ul = document.createElement("ul");
    ul.className = "task-list";
    for (const item of catItems) ul.appendChild(buildPantryItem(item));
    section.appendChild(ul);

    list.appendChild(section);
  }
}

// Menge direkt editierbar (Blur committet) — gleiches Muster wie buildTransactionItem's Notiz-Feld.
// "Best effort"-Bestand (siehe kochen-rezepte-kuehlschrank.md): kein exaktes Inventar, daher reicht
// ein Freitext-Feld statt einer Zahl+Einheit-Erfassung.
// Ablauf-Status einer Zutat relativ zu heute: "expired" (MHD vorbei), "soon" (heute bis in 3 Tagen),
// sonst null. Reine Funktion — auch von der Cockpit-Kachel genutzt.
const PANTRY_EXPIRY_SOON_DAYS = 3;
function pantryExpiryStatus(expiresAt, todayIso) {
  if (!expiresAt) return null;
  const days = isoDayDiff(todayIso, expiresAt);
  if (days == null) return null;
  if (days < 0) return { state: "expired", days };
  if (days <= PANTRY_EXPIRY_SOON_DAYS) return { state: "soon", days };
  return null;
}

function buildPantryItem(item) {
  const li = document.createElement("li");
  li.className = "task-item tx-item pantry-item";

  const nameSpan = document.createElement("span");
  nameSpan.className = "task-title pantry-name";
  nameSpan.textContent = item.name;

  const amountInput = document.createElement("input");
  amountInput.type = "text";
  amountInput.className = "input pantry-amount";
  amountInput.value = item.amount || "";
  amountInput.placeholder = "Menge";
  amountInput.setAttribute("aria-label", "Menge");
  amountInput.addEventListener("blur", async () => {
    const value = amountInput.value.trim();
    if (value === (item.amount || "")) return;
    await withErrorToast(async () => {
      await updatePantryItem(item.id, { amount: value || null });
      await renderPantryList();
    });
  });
  amountInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") amountInput.blur();
  });

  const categorySelect = document.createElement("select");
  categorySelect.className = "select";
  categorySelect.setAttribute("aria-label", "Kategorie");
  categorySelect.innerHTML = `<option value="">Kategorie</option>${Object.entries(PANTRY_CATEGORY_LABELS)
    .map(([value, label]) => `<option value="${value}"${item.category === value ? " selected" : ""}>${label}</option>`)
    .join("")}`;
  categorySelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updatePantryItem(item.id, { category: categorySelect.value || null });
      await renderPantryList();
    });
  });

  // Haltbar-bis, inline editierbar. Leeren des Feldes entfernt das MHD wieder.
  const expiresInput = document.createElement("input");
  expiresInput.type = "date";
  expiresInput.className = "input pantry-expires";
  expiresInput.value = item.expires_at || "";
  expiresInput.setAttribute("aria-label", "Haltbar bis");
  expiresInput.addEventListener("change", async () => {
    const value = expiresInput.value || null;
    if (value === (item.expires_at || null)) return;
    await withErrorToast(async () => {
      await updatePantryItem(item.id, { expires_at: value });
      await renderPantryList();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Aus dem Kühlschrank entfernen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deletePantryItem(item.id);
      await renderPantryList();
    });
    showToast(`„${item.name}" entfernt.`, false, {
      label: "Rückgängig",
      onClick: () =>
        withErrorToast(async () => {
          await createPantryItem({ name: item.name, amount: item.amount, category: item.category, expiresAt: item.expires_at });
          await renderPantryList();
        }),
    });
  });

  li.append(nameSpan, amountInput, expiresInput, categorySelect, deleteBtn);

  // Ablauf-Badge (volle Breite unter der Zeile): "abgelaufen" bzw. "läuft bald ab" macht kritische
  // Zutaten beim Scrollen sofort erkennbar, ohne jedes Datum einzeln zu lesen.
  const expiry = pantryExpiryStatus(item.expires_at, todayISO());
  if (expiry) {
    li.classList.add(expiry.state === "expired" ? "pantry-expired" : "pantry-soon");
    const badge = document.createElement("span");
    badge.className = "pantry-expiry-badge";
    badge.textContent =
      expiry.state === "expired"
        ? "abgelaufen"
        : expiry.days === 0
          ? "läuft heute ab"
          : expiry.days === 1
            ? "läuft morgen ab"
            : `läuft in ${expiry.days} Tagen ab`;
    li.append(badge);
  }
  return li;
}

function wirePantryQuickAddForm() {
  const toggleBtn = document.getElementById("pantry-quick-add-toggle");
  const form = document.getElementById("pantry-quick-form");
  const nameInput = document.getElementById("pantry-quick-name");
  const amountInput = document.getElementById("pantry-quick-amount");
  const expiresInput = document.getElementById("pantry-quick-expires");
  const categorySelect = document.getElementById("pantry-quick-category");
  const cancelBtn = document.getElementById("pantry-quick-cancel");

  const closeForm = () => {
    form.hidden = true;
    form.reset();
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      nameInput.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    await withErrorToast(async () => {
      await createPantryItem({
        name,
        amount: amountInput.value.trim() || null,
        category: categorySelect.value || null,
        expiresAt: expiresInput.value || null,
      });
      closeForm();
      await renderPantryList();
    });
  });
}

/* ---------- Gaming-Backlog ---------- */
// wissensdatenbank/features/gaming-backlog.md — diese Runde nur der manuelle Bestand (kein Preis-/
// Budget-Teil, der läuft weiter über die Wunschliste). Muster wie Kühlschrank/Fixkosten.

const GAME_STATUS_LABELS = {
  wishlist: "Wunschliste",
  backlog: "Backlog",
  playing: "Spiele gerade",
  paused: "Pausiert",
  done: "Durch",
  abandoned: "Abgebrochen",
};

// Farbe + Sortierrang je Status — Sortierrang hebt "Spiele gerade" nach oben, Farbe codiert den
// Status als Punkt/Zeilenakzent statt nur als Dropdown-Text.
const GAME_STATUS_META = {
  playing: { color: "var(--color-success)", order: 0 },
  paused: { color: "var(--color-warning)", order: 1 },
  backlog: { color: "var(--color-text-subtle)", order: 2 },
  wishlist: { color: "var(--color-accent)", order: 3 },
  done: { color: "var(--color-accent-warm)", order: 4 },
  abandoned: { color: "var(--color-danger)", order: 5 },
};

// Priorität pro Titel (nullable) — Label + Sortierrang (hoch zuerst, "keine" zuletzt).
const GAME_PRIORITY_LABELS = { high: "Hoch", medium: "Mittel", low: "Niedrig" };
const GAME_PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const gamePriorityRank = (p) => GAME_PRIORITY_ORDER[p] ?? 3;

// Vergleicht zwei Spiele in der Anzeige-Reihenfolge innerhalb eines Status: Priorität, dann
// manuelle sort_order, dann Titel. Status-Rang (Spiele-gerade oben) sitzt in renderGamesList davor.
function compareGamesInStatus(a, b) {
  return (
    gamePriorityRank(a.priority) - gamePriorityRank(b.priority) ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    a.title.localeCompare(b.title)
  );
}

const gamesState = { games: [], showFinished: false };

async function renderGamesView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/games.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  gamesState.showFinished = false;
  await reloadGamesList();
  wireGamesQuickAddForm();
  const finishedToggle = document.getElementById("games-show-finished");
  if (finishedToggle) {
    finishedToggle.addEventListener("change", () => {
      gamesState.showFinished = finishedToggle.checked;
      renderGamesList();
    });
  }
  // Zufallspicker: würfelt einen Titel aus Backlog/pausiert aus (analog zum Quick-Win-Würfel auf
  // "Heute") — nimmt die Qual der Wahl aus einem gewachsenen Backlog.
  const randomPick = document.getElementById("games-random-pick");
  if (randomPick) {
    randomPick.addEventListener("click", () => {
      const pool = gamesState.games.filter((g) => g.status === "backlog" || g.status === "paused");
      if (pool.length === 0) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const platform = pick.platform ? ` (${pick.platform})` : "";
      showToast(`🎲 Zock doch: „${pick.title}"${platform}`);
    });
  }
}

async function reloadGamesList() {
  gamesState.games = await listGames();
  renderGamesList();
}

function renderGamesList() {
  const list = document.getElementById("games-list");
  const stats = document.getElementById("games-stats");
  list.innerHTML = "";
  if (gamesState.games.length === 0) {
    if (stats) stats.hidden = true;
    list.appendChild(buildEmptyState("Noch keine Spiele erfasst", "Leg unten den ersten Titel an."));
    return;
  }

  // Stat-Leiste: Backlog / Am Spielen / Durch auf einen Blick.
  if (stats) {
    const by = (s) => gamesState.games.filter((g) => g.status === s).length;
    stats.hidden = false;
    stats.innerHTML =
      `<div class="games-stat"><b>${by("backlog")}</b><small>Backlog</small></div>` +
      `<div class="games-stat"><b style="color:var(--color-success)">${by("playing")}</b><small>Am Spielen</small></div>` +
      `<div class="games-stat"><b style="color:var(--color-accent-warm)">${by("done")}</b><small>Durch</small></div>`;
  }

  // Durchgespielte/abgebrochene Titel wachsen sonst unbegrenzt und drängen den aktiven Backlog nach
  // unten — standardmäßig ausblenden, per Checkbox einblendbar. Die Zeile nur zeigen, wenn es
  // überhaupt solche Einträge gibt.
  const finishedCount = gamesState.games.filter((g) => g.status === "done" || g.status === "abandoned").length;
  const finishedRow = document.getElementById("games-show-finished-row");
  const finishedToggle = document.getElementById("games-show-finished");
  const randomPick = document.getElementById("games-random-pick");
  if (randomPick) {
    const pickable = gamesState.games.some((g) => g.status === "backlog" || g.status === "paused");
    randomPick.hidden = !pickable;
  }
  if (finishedRow) finishedRow.hidden = finishedCount === 0;
  if (finishedToggle) finishedToggle.checked = gamesState.showFinished;
  const visible = gamesState.showFinished
    ? gamesState.games
    : gamesState.games.filter((g) => g.status !== "done" && g.status !== "abandoned");

  // "Spiele gerade" nach oben, danach nach Status-Rang, innerhalb eines Status nach Priorität →
  // manueller Reihenfolge (sort_order) → Titel.
  const sorted = [...visible].sort((a, b) => {
    const oa = GAME_STATUS_META[a.status]?.order ?? 9;
    const ob = GAME_STATUS_META[b.status]?.order ?? 9;
    return oa - ob || compareGamesInStatus(a, b);
  });
  sorted.forEach((game) => list.appendChild(buildGameItem(game)));
}

function buildGameItem(game) {
  const li = document.createElement("li");
  li.className = "task-item tx-item game-item" + (game.status === "playing" ? " is-playing" : "");
  const statusColor = GAME_STATUS_META[game.status]?.color || "var(--color-text-subtle)";
  li.style.borderLeftColor = statusColor;
  li.style.setProperty("--task-area-color", statusColor);

  // Titel inline editierbar (Blur committet) — gleiches Muster wie Fixkosten/Schulden.
  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = game.title;
  title.setAttribute("aria-label", "Titel");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === game.title) {
      title.value = game.title;
      return;
    }
    await withErrorToast(async () => {
      await updateGame(game.id, { title: value });
      await reloadGamesList();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  const statusSelect = document.createElement("select");
  statusSelect.className = "select";
  statusSelect.setAttribute("aria-label", "Status");
  statusSelect.innerHTML = Object.entries(GAME_STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}"${game.status === value ? " selected" : ""}>${label}</option>`)
    .join("");
  statusSelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateGame(game.id, { status: statusSelect.value });
      await reloadGamesList();
    });
  });

  const progressInput = document.createElement("input");
  progressInput.type = "number";
  progressInput.min = "0";
  progressInput.max = "100";
  progressInput.className = "input";
  progressInput.style.maxWidth = "70px";
  progressInput.value = game.progress_pct ?? "";
  progressInput.placeholder = "%";
  progressInput.setAttribute("aria-label", "Fortschritt in Prozent");
  progressInput.addEventListener("blur", async () => {
    const raw = progressInput.value.trim();
    const value = raw === "" ? null : Math.min(100, Math.max(0, Number(raw)));
    if (value === (game.progress_pct ?? null)) {
      progressInput.value = game.progress_pct ?? "";
      return;
    }
    await withErrorToast(async () => {
      await updateGame(game.id, { progress_pct: value });
      await reloadGamesList();
    });
  });
  progressInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") progressInput.blur();
  });

  const meta = document.createElement("span");
  if (game.platform) {
    meta.className = "game-platform";
    meta.textContent = game.platform;
  }

  // Priorität pro Titel (Weekly-Muster "Priorisierung zwischen aktiven Titeln"). Leerwert = keine.
  const prioritySelect = document.createElement("select");
  prioritySelect.className = "select";
  prioritySelect.setAttribute("aria-label", "Priorität");
  prioritySelect.innerHTML =
    `<option value="">Prio —</option>` +
    Object.entries(GAME_PRIORITY_LABELS)
      .map(([value, label]) => `<option value="${value}"${game.priority === value ? " selected" : ""}>${label}</option>`)
      .join("");
  prioritySelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateGame(game.id, { priority: prioritySelect.value || null });
      await reloadGamesList();
    });
  });

  // Manuelle Warteschlangen-Reihenfolge innerhalb desselben Status (Feinjustierung innerhalb einer
  // Prioritätsstufe) über sort_order-Tausch mit dem Nachbarn in der Anzeige-Reihenfolge.
  const sameStatusSorted = gamesState.games.filter((g) => g.status === game.status).sort(compareGamesInStatus);
  const idxInStatus = sameStatusSorted.findIndex((g) => g.id === game.id);
  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "icon-btn";
  upBtn.textContent = "↑";
  upBtn.setAttribute("aria-label", "Nach oben");
  upBtn.disabled = idxInStatus <= 0;
  upBtn.addEventListener("click", () => moveGameInStatus(game, -1));
  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "icon-btn";
  downBtn.textContent = "↓";
  downBtn.setAttribute("aria-label", "Nach unten");
  downBtn.disabled = idxInStatus === -1 || idxInStatus >= sameStatusSorted.length - 1;
  downBtn.addEventListener("click", () => moveGameInStatus(game, 1));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Aus dem Backlog entfernen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteGame(game.id);
      await reloadGamesList();
    });
    showToast(`„${game.title}" entfernt.`, false, {
      label: "Rückgängig",
      onClick: () =>
        withErrorToast(async () => {
          await createGame({
            title: game.title,
            status: game.status,
            platform: game.platform,
            releaseDate: game.release_date,
            priority: game.priority,
            sortOrder: game.sort_order,
          });
          await reloadGamesList();
        }),
    });
  });

  li.append(title, statusSelect, prioritySelect, progressInput, meta, upBtn, downBtn, deleteBtn);
  return li;
}

// Tauscht sort_order des Spiels mit dem Nachbarn (dir -1 = hoch, +1 = runter) in der Anzeige-
// Reihenfolge desselben Status. Nutzt effektive sort_order-Werte (Fallback 0) und stellt sicher,
// dass sich die beiden Werte tatsächlich unterscheiden, sonst bleibt die Reihenfolge unverändert.
async function moveGameInStatus(game, dir) {
  const group = gamesState.games.filter((g) => g.status === game.status).sort(compareGamesInStatus);
  const idx = group.findIndex((g) => g.id === game.id);
  const neighbor = group[idx + dir];
  if (!neighbor) return;
  const a = game.sort_order ?? 0;
  const b = neighbor.sort_order ?? 0;
  // Bei gleichem sort_order (z.B. beide Default 0) einen Versatz erzeugen, damit der Tausch greift.
  const newGameOrder = a === b ? b + dir : b;
  const newNeighborOrder = a === b ? a : a;
  await withErrorToast(async () => {
    await updateGame(game.id, { sort_order: newGameOrder });
    if (a !== b) await updateGame(neighbor.id, { sort_order: newNeighborOrder });
    await reloadGamesList();
  });
}

function wireGamesQuickAddForm() {
  const form = document.getElementById("new-game-form");
  const submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("new-game-title");
    const statusSelect = document.getElementById("new-game-status");
    const platformInput = document.getElementById("new-game-platform");
    const title = titleInput.value.trim();
    if (!title || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        // Neue Titel ans Ende der Warteschlange (max sort_order + 1), nicht auf den kollidierenden 0.
        const maxSort = gamesState.games.reduce((max, g) => Math.max(max, g.sort_order ?? 0), 0);
        await createGame({
          title,
          status: statusSelect.value,
          platform: platformInput.value.trim() || null,
          sortOrder: maxSort + 1,
        });
        showToast(`„${title}" angelegt.`);
        titleInput.value = "";
        platformInput.value = "";
        statusSelect.value = "backlog";
        await reloadGamesList();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- Lesen (Bücher, einfache Seiten-Variante) ---------- */
// wissensdatenbank/features/lesen-als-bereich.md — diese Runde nur Seiten-Fortschritt + Monats-
// Übersicht (keine Kapitelstruktur, keine immersive Optik). Muster wie Gaming/Kühlschrank.

const BOOK_STATUS_LABELS = {
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  beendet: "Beendet",
};

// Anzeigerang: was man gerade liest zuerst, Beendetes ganz nach unten — sonst versickert das
// aktive Buch zwischen längst durchgelesenen.
const BOOK_STATUS_ORDER = { aktiv: 0, pausiert: 1, geplant: 2, beendet: 3 };

const booksState = { books: [], log: [] };

async function renderBooksView() {
  const myGeneration = renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/books.html");
  if (myGeneration !== renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadBooks();
  wireBooksQuickAddForm();
}

async function reloadBooks() {
  const [books, log] = await Promise.all([listBooks(), listReadingLog()]);
  booksState.books = books;
  booksState.log = log;
  renderBooksMonthSummary();
  renderBooksList();
}

function renderBooksMonthSummary() {
  const el = document.getElementById("books-month-summary");
  if (!el) return;
  const monthIso = todayISO().slice(0, 7);
  const chapters = sumChaptersInMonth(booksState.log, monthIso);
  const pages = sumPagesInMonth(booksState.log, monthIso);
  const parts = [];
  if (chapters > 0) parts.push(`${chapters} Kapitel`);
  if (pages > 0) parts.push(`${pages} Seiten`);
  if (parts.length === 0) parts.push("0 Kapitel");
  el.textContent = `Diesen Monat gelesen: ${parts.join(" · ")}`;
}

function renderBooksList() {
  const list = document.getElementById("books-list");
  list.innerHTML = "";
  if (booksState.books.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Bücher", "Leg unten das erste Buch an."));
    return;
  }
  const sorted = [...booksState.books].sort(
    (a, b) => (BOOK_STATUS_ORDER[a.status] ?? 9) - (BOOK_STATUS_ORDER[b.status] ?? 9)
  );
  sorted.forEach((book) => list.appendChild(buildBookItem(book)));
}

function buildBookItem(book) {
  const li = document.createElement("li");
  li.className = "task-item tx-item book-item";

  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = book.title;
  title.setAttribute("aria-label", "Titel");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === book.title) {
      title.value = book.title;
      return;
    }
    await withErrorToast(async () => {
      await updateBook(book.id, { title: value });
      await reloadBooks();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  const statusSelect = document.createElement("select");
  statusSelect.className = "select";
  statusSelect.setAttribute("aria-label", "Status");
  statusSelect.innerHTML = Object.entries(BOOK_STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}"${book.status === value ? " selected" : ""}>${label}</option>`)
    .join("");
  statusSelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateBook(book.id, { status: statusSelect.value });
      await reloadBooks();
    });
  });

  // Fortschritt in der Einheit des Buchs (Kapitel als Default, sonst Seiten).
  const unit = book.progress_unit === "pages" ? "pages" : "chapters";
  const currentField = unit === "pages" ? "current_page" : "current_chapter";
  const totalField = unit === "pages" ? "total_pages" : "total_chapters";
  const unitShort = unit === "pages" ? "S." : "Kap.";
  const currentValue = book[currentField] ?? 0;
  const totalValue = book[totalField];

  // Aktueller Stand, inline editierbar (direkte Korrektur ohne Log-Eintrag).
  const progressInput = document.createElement("input");
  progressInput.type = "number";
  progressInput.min = "0";
  progressInput.className = "input";
  progressInput.style.maxWidth = "70px";
  progressInput.value = currentValue;
  progressInput.setAttribute("aria-label", unit === "pages" ? "Aktuelle Seite" : "Aktuelles Kapitel");
  progressInput.addEventListener("blur", async () => {
    const value = Number(progressInput.value);
    if (Number.isNaN(value) || value === Number(currentValue)) {
      progressInput.value = currentValue;
      return;
    }
    await withErrorToast(async () => {
      await updateBook(book.id, { [currentField]: value });
      await reloadBooks();
    });
  });

  const meta = document.createElement("span");
  meta.className = "count";
  const progressLabel = totalValue ? `${unitShort} ${currentValue} / ${totalValue}` : `${unitShort} ${currentValue}`;
  meta.textContent = [progressLabel, book.author].filter(Boolean).join(" · ");

  // "+heute": loggt eine Session (Monats-Summe) und bumpt den Stand in der Buch-Einheit.
  const addProgress = document.createElement("input");
  addProgress.type = "number";
  addProgress.min = "1";
  addProgress.className = "input";
  addProgress.style.maxWidth = "64px";
  addProgress.placeholder = `+${unitShort}`;
  addProgress.setAttribute("aria-label", unit === "pages" ? "Heute gelesene Seiten hinzufügen" : "Heute gelesene Kapitel hinzufügen");
  const commitProgress = async () => {
    const amount = Number(addProgress.value);
    if (Number.isNaN(amount) || amount <= 0) {
      addProgress.value = "";
      return;
    }
    await withErrorToast(async () => {
      await logReadingSession({ bookId: book.id, unit, amountRead: amount, currentValue: currentValue + amount });
      addProgress.value = "";
      await reloadBooks();
    });
  };
  addProgress.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitProgress();
    }
  });
  addProgress.addEventListener("blur", commitProgress);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Buch entfernen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteBook(book.id);
      await reloadBooks();
    });
    showToast(`„${book.title}" entfernt.`, false, {
      label: "Rückgängig",
      onClick: () =>
        withErrorToast(async () => {
          await createBook({
            title: book.title,
            author: book.author,
            totalPages: book.total_pages,
            progressUnit: book.progress_unit,
            totalChapters: book.total_chapters,
            status: book.status,
            genre: book.genre,
          });
          await reloadBooks();
        }),
    });
  });

  li.append(title, statusSelect, progressInput, meta, addProgress, deleteBtn);

  // Visueller Fortschrittsbalken (volle Breite unter der Zeile) — nur wenn ein Gesamtwert bekannt
  // ist, sonst gäbe es keinen sinnvollen Bezug. Style wiederverwendet aus der Wunschlisten-Leiste.
  if (totalValue && totalValue > 0) {
    const pct = Math.min(100, Math.round((currentValue / totalValue) * 100));
    const bar = document.createElement("div");
    bar.className = "wish-fund-bar book-progress-bar";
    const fill = document.createElement("div");
    fill.className = "wish-fund-fill";
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    li.appendChild(bar);
  }
  return li;
}

function wireBooksQuickAddForm() {
  const form = document.getElementById("new-book-form");
  const submitBtn = form.querySelector('button[type="submit"]');
  const unitSelect = document.getElementById("new-book-unit");
  const totalInput = document.getElementById("new-book-total");
  // Placeholder des Gesamt-Felds folgt der gewählten Einheit.
  const syncTotalPlaceholder = () => {
    totalInput.placeholder = unitSelect.value === "pages" ? "Seiten gesamt (optional)" : "Kapitel gesamt (optional)";
  };
  syncTotalPlaceholder();
  unitSelect.addEventListener("change", syncTotalPlaceholder);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("new-book-title");
    const authorInput = document.getElementById("new-book-author");
    const statusSelect = document.getElementById("new-book-status");
    const title = titleInput.value.trim();
    if (!title || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        const unit = unitSelect.value === "pages" ? "pages" : "chapters";
        const total = totalInput.value ? Number(totalInput.value) : null;
        await createBook({
          title,
          author: authorInput.value.trim() || null,
          progressUnit: unit,
          totalPages: unit === "pages" ? total : null,
          totalChapters: unit === "chapters" ? total : null,
          status: statusSelect.value,
        });
        showToast(`„${title}" angelegt.`);
        titleInput.value = "";
        authorInput.value = "";
        totalInput.value = "";
        unitSelect.value = "chapters";
        syncTotalPlaceholder();
        statusSelect.value = "geplant";
        await reloadBooks();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
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

async function renderAreaManageList() {
  const list = document.getElementById("area-manage-list");
  const areas = await listAreas();
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

init();
