import { getSession, onAuthStateChange, signInWithMagicLink, ensureAreasSeeded } from "./auth.js";
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
import { suggestTasksForPlan, formatTasksForExport, savePlanForDate, budgetForDate } from "./planner.js";
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
  getFinanceModuleSettings,
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
import { WEEKDAY_CODES, isHabitTask, autoplanDueHabits, weekdayCodeFromIso } from "./habits.js";
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
  autoplanWatchlistForDates,
  applyWatchlistSwap,
} from "./watchlist.js";

const app = document.getElementById("app");

const routes = {
  today: renderTodayView,
  overview: renderOverviewView,
  plan: renderPlanView,
  habits: renderHabitsView,
  finance: renderFinanceView,
  fernsehprogramm: renderFernsehprogrammView,
};

const WEEKDAY_LABEL = { mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So" };

// Kleine Icons vor Badge-Text — macht "Habit"/"Brainstorm"/"Überfällig" beim schnellen Scrollen
// schneller unterscheidbar als drei ähnlich lange Wörter in ähnlichen Farbtönen.
const BADGE_ICON_HABIT = `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>`;
const BADGE_ICON_BRAINSTORM = `<svg viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-3 11.2c.6.4 1 1.1 1 1.8v.5h4v-.5c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 2Z"/></svg>`;
const BADGE_ICON_OVERDUE = `<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>`;

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
      JSON.stringify({ effort, status, search, showDone: overviewState.showDone })
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
  collapsedAreas: new Set(),
  collapsedNodes: new Set(),
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

// [ersterIso, letzterIso] aller sichtbaren Grid-Zellen (inkl. Padding-Tage aus Nachbarmonaten) —
// so ist data-has-tasks auch für ausgegraute Tage korrekt.
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

function buildGymIcon() {
  return buildInlineIcon(`<path d="M6 8v8M18 8v8M2 12h4M18 12h4M9 12h6"/>`);
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
function buildEmptyState(title, subtitle) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state-rich";
  wrap.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><strong></strong><span></span>`;
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
  if (!seedPromise) seedPromise = ensureAreasSeeded(userId);
  return seedPromise;
}

async function init() {
  const session = await getSession();
  if (session) {
    await ensureAreasSeededOnce(session.user.id);
    renderShell();
  } else {
    renderLogin();
  }

  onAuthStateChange((newSession) => {
    if (newSession) {
      ensureAreasSeededOnce(newSession.user.id).then(renderShell);
    } else {
      seedPromise = null;
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

function renderShell() {
  const route = currentRoute();
  // Offenes Detail-Modal schließen — es liegt außerhalb von #app und würde sonst
  // beim Ansichtswechsel über der neuen Ansicht hängen bleiben.
  if (closeActiveModal) closeActiveModal();
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
      <a href="#/plan" class="nav-link${route === "plan" ? " is-active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/></svg>
        <span class="nav-label">Plan</span>
      </a>
      <a href="#/habits" class="nav-link${route === "habits" ? " is-active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4M2 12a10 10 0 1 0 10-10"/></svg>
        <span class="nav-label">Habits</span>
      </a>
      <a href="#/finance" class="nav-link${route === "finance" ? " is-active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24"><path d="M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h13M16 13h2"/></svg>
        <span class="nav-label">Finanzen</span>
      </a>
      <a href="#/fernsehprogramm" class="nav-link${route === "fernsehprogramm" ? " is-active" : ""}">
        <svg class="nav-icon" viewBox="0 0 24 24"><path d="M3 5h18v12H3z"/><path d="M8 21h8M12 17v4M8 2l3 3M16 2l-3 3"/></svg>
        <span class="nav-label">Fernsehprogramm</span>
      </a>
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
  routes[route]();
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

/* ---------- Today ---------- */

// Cache der zuletzt geladenen Heute-Aufgaben. Auf-/Zuklappen und Statusänderungen sollen nur den
// Aufgaben-Teil neu rendern statt views/today.html komplett neu zu fetchen (das hätte #view-content
// per innerHTML ersetzt und damit den Scroll-Container zurückgesetzt) — siehe
// renderTodayTaskSection()/refreshTodayTaskList()/rerenderTodayTaskListFromCache().
const todayViewState = {
  allTasks: [],
  areaColorById: {},
};

async function renderTodayView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/today.html");
  container.innerHTML = await res.text();
  showLoading("task-list");

  // Ein einzelner ungefilterter Fetch reicht: Heute, überfällig, Termine und Quick-Win-Kandidaten
  // werden alle clientseitig aus derselben Liste abgeleitet (spart Roundtrips und macht die
  // Mutteraufgaben-Gruppierung trivial, weil der volle Baum schon vorliegt).
  // Ungefiltert holen (nicht nur status:"active") — filterBuyReady() muss auch bereits manuell auf
  // "ready" gesetzte Wünsche sehen können, sonst fehlen die im Kaufbereit-Widget.
  const [areas, allTasks, wishlistItems, potBalance, watchlistItems] = await Promise.all([
    listAreas(),
    listTasks(),
    listWishlistItems(),
    getSavingsPotBalance(),
    listWatchlistItems(),
  ]);
  todayViewState.areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));
  const today = todayISO();

  // Fällige Habits vor dem Rendern automatisch einplanen (planned_date/status setzen) — sonst
  // würde ein heute fälliges Habit erst nach einem Reload in der Heute-Ansicht auftauchen. Bei
  // Treffern allTasks lokal patchen statt neu zu fetchen (spart einen Roundtrip).
  const duePlannedIds = new Set(await autoplanDueHabits(allTasks, today));
  const patchedTasks = duePlannedIds.size
    ? allTasks.map((t) => (duePlannedIds.has(t.id) ? { ...t, planned_date: today, status: "planned" } : t))
    : allTasks;

  // Analog zu Habits: fehlt für heute noch eine Watchlist-Aufgabe (aktives Item nicht bereits
  // diese Woche verplant), wird sie hier automatisch angelegt — sonst würde sie erst nach einem
  // Reload der Fernsehprogramm-Ansicht in Heute auftauchen. Nur für heute, nicht die ganze Woche
  // (das übernimmt renderFernsehprogrammView separat).
  const newWatchlistTasks = await autoplanWatchlistForDates(watchlistItems, patchedTasks, [today]);
  todayViewState.allTasks = newWatchlistTasks.length ? [...patchedTasks, ...newWatchlistTasks] : patchedTasks;
  const tasks = todayViewState.allTasks.filter((t) => t.planned_date === today);

  renderGreeting();
  renderGymIndicator();
  renderBuyReadyAlert(wishlistItems, potBalance);
  renderTodayTaskSection();
  renderQuickWin(todayViewState.allTasks, tasks, today);
  wireQuickCapture(areas, renderTodayView);
}

// Rendert nur den Aufgaben-Teil (Termine-Widget, Task-Liste inkl. Fortschrittsring) aus dem
// todayViewState-Cache neu — ohne views/today.html erneut zu fetchen oder Begrüßung/Gym-Indikator/
// Schnellerfassung neu zu verdrahten. Gemeinsame Basis für den reinen UI-Re-Render (Auf-/Zuklappen)
// und den daten-refreshenden Re-Render (nach Statusänderung/Unteraufgabe).
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

function renderGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  document.getElementById("greeting-text").textContent = greeting;
  document.getElementById("today-date").textContent = now.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function renderGymIndicator() {
  const day = new Date().getDay();
  const el = document.getElementById("gym-indicator");
  const isGymDay = [1, 3, 5].includes(day);
  el.hidden = !isGymDay;
  if (isGymDay) {
    el.innerHTML = "";
    el.append(buildGymIcon(), " Heute ist Gym-Tag");
  }
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
  el.classList.toggle("is-done", task.status === "done");
  el.classList.toggle("is-stale", isStale);
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
      if (task.status === "done") {
        await reopenTaskCascade(task, allTasks);
      } else {
        await completeTaskCascade(task, allTasks);
        // Nur in der Heute-Ansicht (dieser Checkbox-Pfad ist ihr einziger Aufrufer) — Bewertung
        // direkt beim Abhaken abfragen, nicht erst später im Fernsehprogramm-Tab (Spec-Vorgabe).
        const ratingLogId = isWatchlistTask(task) ? await promptWatchlistRating(task) : null;
        showCompleteUndoToast(task, allTasks, onChange, ratingLogId);
      }
      onChange();
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
// bisherige Dringlichkeits-Reihenfolge erhalten (compareByUrgency als Tiebreaker).
const PRIORITY_RANK = { high: 2, medium: 1, low: 0 };
function compareByPriority(a, b) {
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

  areaSelect.innerHTML =
    `<option value="">Bereich (optional)</option>` +
    areas.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");

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
    selectedEffort = null;
    effortGroup.querySelectorAll(".effort-chip").forEach((c) => (c.dataset.active = "false"));
    setPriority("medium");
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    const areaId = areaSelect.value || null;
    await withErrorToast(async () => {
      await createTask({
        title,
        areaId,
        effort: selectedEffort,
        priority: selectedPriority,
        isBrainstorm: !areaId,
        plannedDate: todayISO(),
        status: "planned",
      });
      const areaName = areaId ? areas.find((a) => a.id === areaId)?.name : null;
      showToast(areaName ? `„${title}" zu ${areaName} hinzugefügt.` : `„${title}" hinzugefügt.`);
      closeForm();
      onAdded();
    });
  });
}

/* ---------- Overview ---------- */

async function renderOverviewView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/overview.html");
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
  renderAreaTree();
  renderNoAreaSection();
  wireOverviewFilters();
  await renderAreaManageList();
  wireNewAreaForm();
  wireAreaManageToggle();
}

async function loadOverviewData() {
  const [areas, tasks] = await Promise.all([listAreas(), listTasks()]);
  overviewState.areas = areas;
  overviewState.tasks = tasks;
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
  renderAreaTree();
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

function wireOverviewFilters() {
  const effortSelect = document.getElementById("filter-effort");
  const statusSelect = document.getElementById("filter-status");
  const searchInput = document.getElementById("filter-search");
  const showDoneCheckbox = document.getElementById("filter-show-done");

  effortSelect.value = overviewState.filters.effort;
  statusSelect.value = overviewState.filters.status;
  searchInput.value = overviewState.filters.search;
  showDoneCheckbox.checked = overviewState.showDone;

  effortSelect.addEventListener("change", () => {
    overviewState.filters.effort = effortSelect.value;
    saveStoredFilters();
    renderAreaTree();
    renderNoAreaSection();
  });
  statusSelect.addEventListener("change", () => {
    overviewState.filters.status = statusSelect.value;
    saveStoredFilters();
    renderAreaTree();
    renderNoAreaSection();
  });
  searchInput.addEventListener("input", () => {
    overviewState.filters.search = searchInput.value.trim().toLowerCase();
    saveStoredFilters();
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
    renderAreaTree();
    renderNoAreaSection();
  });
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
    root.appendChild(buildEmptyState("Keine Treffer", `Nichts gefunden für „${overviewState.filters.search}".`));
  }
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

  header.append(toggle, dot, name, count, addBtn);
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
  header.className = "tree-node-header" + (isTaskOverdue(node) ? " is-overdue" : "");

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
      if (node.status === "done") {
        await reopenTaskCascade(node, overviewState.tasks);
      } else {
        await completeTaskCascade(node, overviewState.tasks);
        showCompleteUndoToast(node, overviewState.tasks, reloadOverview);
      }
      reloadOverview();
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

  form.append(nameInput, dateChips.el, submitBtn, cancelBtn);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = nameInput.value.trim();
    if (!title) return;
    const plannedDate = dateChips.getPlannedDate();
    await withErrorToast(async () => {
      await createTask({ title, areaId, parentTaskId, plannedDate, status: plannedDate ? "planned" : "open" });
      overviewState.addFormTarget = null;
      overviewState.collapsedAreas.delete(areaId);
      if (parentTaskId) overviewState.collapsedNodes.delete(parentTaskId);
      reloadOverview();
    });
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
  const noArea = overviewState.tasks.filter((t) => !t.area_id && taskPassesFilter(t)).sort(compareByUrgency);

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
  const allTasks = await listTasks();
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
  else renderTaskDetailView(card, task, allTasks, children, backButtonHtml, close);
  // Rückgabe erlaubt refreshOpenViewsAfterTaskChange(), den bereits geladenen Stand für Heute
  // wiederzuverwenden statt ihn direkt danach nochmal per listTasks() zu holen.
  return allTasks;
}

function renderTaskDetailView(card, task, allTasks, children, backButtonHtml, close) {
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

    <div class="modal-actions">
      <button class="btn btn-secondary" id="td-cancel" type="button">Schließen</button>
    </div>`;

  document.getElementById("td-pin").appendChild(buildPinIcon());
  document.getElementById("td-edit").appendChild(buildEditIcon());
  document.getElementById("td-cancel").addEventListener("click", close);

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
    await withErrorToast(async () => {
      if (!wasDone && willBeDone) await completeTaskCascade(task, allTasks);
      else if (wasDone && !willBeDone) await reopenTaskCascade(task, allTasks);
      else if (children.length > 0) await planTaskCascade(task, plannedDate, allTasks);
      await updateTask(task.id, {
        title: document.getElementById("td-title").value.trim() || task.title,
        area_id: areaId,
        parent_task_id: parentSel.value || null,
        effort: effortVal ? Number(effortVal) : null,
        status: newStatus,
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
    btn.dataset.hasTasks = String(count > 0);
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
    const [areas, pool] = await withTimeout(
      Promise.all([listAreas(), listTasks({ status: "open" })]),
      15000,
      "Zeitüberschreitung beim Laden."
    );
    planState.areas = areas;
    planState.areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));
    planState.pool = pool;
    planState.selected = suggestTasksForPlan(pool, planState.targetDate);

    await loadMonthTasksAndRender(dateInput);
    renderPlanTaskList();
    renderAddTaskSelect();
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
  const container = document.getElementById("view-content");
  const res = await fetch("views/plan.html");
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
  dateInput.addEventListener("change", async () => {
    if (!dateInput.value) return;
    planState.targetDate = dateInput.value;
    updatePlanDateLabel();
    await jumpCalendarToTargetDate(dateInput);
  });
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

  const usedMinutes = planState.selected.reduce((sum, t) => sum + (t.effort || 0), 0);
  document.getElementById("plan-budget").textContent =
    `${usedMinutes} / ${budgetForDate(planState.targetDate)} Min`;

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

function renderAddTaskSelect() {
  const select = document.getElementById("add-task-select");
  const selectedIds = new Set(planState.selected.map((t) => t.id));
  const available = planState.pool.filter((t) => !selectedIds.has(t.id));

  select.innerHTML =
    `<option value="">Aufgabe wählen…</option>` +
    available.map((t) => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join("");
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
  potBalance: 0,
  txFilterPot: "",
};

/* ---------- Habits ---------- */

const habitsViewState = { allTasks: [], areaColorById: {} };

async function renderHabitsView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/habits.html");
  container.innerHTML = await res.text();
  const [tasks, areas] = await Promise.all([listTasks(), listAreas()]);
  habitsViewState.allTasks = tasks;
  habitsViewState.areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));
  renderHabitList();
}

// Kompakte Punktreihe für den Default-Zustand einer Habit-Zeile: zeigt auf einen Blick, an
// welchen Wochentagen das Habit aktiv ist, ohne 7 antippbare 40px-Chips permanent vorzuhalten.
function buildHabitDotRow(task, todayCode) {
  return `<div class="habit-dotrow" aria-hidden="true">${WEEKDAY_CODES.map((code) => {
    const active = task.habit_weekdays.includes(code);
    const isToday = code === todayCode;
    return `<span class="habit-dot${active ? " active" : ""}${isToday ? " is-today" : ""}"></span>`;
  }).join("")}</div>`;
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

// Rendert die Liste der Habit-Aufgaben. Jede Zeile startet im Kompakt-Zustand (Punktreihe) und
// klappt per Tap auf die editierbaren Mo-So-Chips auf — analog td-subtask-list im Detail-Modal
// nutzt auch das hier nur einen delegierten Klick-Handler auf #habit-list statt pro Zeile.
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
      const areaColor = habitsViewState.areaColorById[t.area_id];
      const freqLabel = `${t.habit_weekdays.length}× pro Woche`;
      return `
      <li class="task-item habit-item" data-habit-id="${t.id}" data-expanded="false" style="${
        areaColor ? `border-left-color:${areaColor};--task-area-color:${areaColor};` : ""
      }">
        <span class="task-area-dot" style="background:${areaColor || "var(--color-text-subtle)"}"></span>
        <div class="habit-body">
          <button type="button" class="habit-toggle" aria-expanded="false">
            <span class="task-title">${escapeHtml(t.title)}<span class="habit-freq">${freqLabel}</span></span>
            ${buildHabitDotRow(t, todayCode)}
          </button>
          <div class="weekday-chips" role="group" aria-label="Wochentage" hidden>
            ${buildHabitChips(t, todayCode)}
          </div>
        </div>
      </li>`;
    })
    .join("");

  list.onclick = async (e) => {
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
        chip.dataset.active = String(nextDays.includes(day));
        li.querySelector(".habit-freq").textContent = `${nextDays.length}× pro Woche`;
        li.querySelector(".habit-dotrow").outerHTML = buildHabitDotRow(task, todayCode);
      });
      return;
    }

    const toggle = e.target.closest(".habit-toggle");
    if (toggle) {
      const li = toggle.closest("[data-habit-id]");
      const expanded = li.dataset.expanded === "true";
      li.dataset.expanded = String(!expanded);
      toggle.setAttribute("aria-expanded", String(!expanded));
      li.querySelector(".weekday-chips").hidden = expanded;
    }
  };
}

async function renderFinanceView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/finance.html");
  container.innerHTML = await res.text();
  showLoading("pot-grid");

  await loadFinanceData();
  renderPotGrid();
  renderBuyReadyAlert(financeState.wishlistItems, financeState.potBalance);
  renderCommittedPreview();
  renderTransactionList();
  renderFixedCostsList();
  renderCommittedManageList();
  renderWishlistCards();
  wireFinanceFilters();
  wireFixedCostsPanel();
  wireCommittedPanel();
  wireWishlistForm();
  wireTransactionQuickCapture();
}

async function loadFinanceData() {
  const [settings, transactions, fixedCosts, committedExpenses, wishlistItems, potBalance] = await Promise.all([
    getFinanceModuleSettings(),
    listTransactions(),
    listFixedCosts(),
    listCommittedExpenses({ statusNot: "settled" }),
    listWishlistItems(),
    getSavingsPotBalance(),
  ]);
  financeState.settings = settings;
  financeState.transactions = transactions;
  financeState.fixedCosts = fixedCosts;
  financeState.committedExpenses = committedExpenses;
  financeState.wishlistItems = wishlistItems;
  financeState.potBalance = potBalance;
}

async function reloadFinance() {
  await loadFinanceData();
  renderPotGrid();
  renderBuyReadyAlert(financeState.wishlistItems, financeState.potBalance);
  renderCommittedPreview();
  renderTransactionList();
  renderFixedCostsList();
  renderCommittedManageList();
  renderWishlistCards();
}

function buildPotCard(label, color, amountText, pct) {
  const card = document.createElement("div");
  card.className = "pot-card";

  const ring = document.createElement("div");
  ring.className = "pot-ring";
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
      .reduce((sum, t) => sum + Number(t.amount), 0);
    const notgroschenTarget = settings.notgroschen_target || 0;
    const notgroschenPct = notgroschenTarget ? Math.round((notgroschenProgress / notgroschenTarget) * 100) : 0;
    cards.push(
      buildPotCard(
        POT_LABELS.sicherheit,
        POT_COLOR_VAR.sicherheit,
        `${formatEuro(notgroschenProgress)} / ${formatEuro(notgroschenTarget)}`,
        notgroschenPct
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
  sign.className = "count";
  sign.textContent = tx.direction === "income" ? "+" : "−";

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.step = "0.01";
  amountInput.min = "0";
  amountInput.className = "input";
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
      await reloadFinance();
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
      await reloadFinance();
    });
  });

  const meta = document.createElement("span");
  meta.className = "count";
  meta.textContent = INTERVAL_LABELS[cost.interval];

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteFixedCost(cost.id);
      await reloadFinance();
    });
  });

  li.append(title, amountInput, meta, deleteBtn);
  return li;
}

function renderFixedCostsList() {
  const list = document.getElementById("fixed-costs-list");
  list.innerHTML = "";
  if (financeState.fixedCosts.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Fixkosten", "Leg unten die erste feste Ausgabe an."));
    return;
  }
  financeState.fixedCosts.forEach((cost) => list.appendChild(buildFixedCostItem(cost)));
}

function wireFixedCostsPanel() {
  const panel = document.getElementById("fixed-costs-panel");
  document.getElementById("fixed-costs-toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  document.getElementById("new-fixed-cost-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-fixed-cost-name");
    const amountInput = document.getElementById("new-fixed-cost-amount");
    const intervalSelect = document.getElementById("new-fixed-cost-interval");
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);
    if (!name || !amount) return;
    await withErrorToast(async () => {
      await createFixedCost({ name, amount, interval: intervalSelect.value });
      showToast(`„${name}" angelegt.`);
      nameInput.value = "";
      amountInput.value = "";
      intervalSelect.value = "monthly";
      await reloadFinance();
    });
  });
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
      await deleteCommittedExpense(exp.id);
      await reloadFinance();
    });
  });

  li.append(title, meta, settleBtn, deleteBtn);
  return li;
}

function renderCommittedManageList() {
  const list = document.getElementById("committed-manage-list");
  list.innerHTML = "";
  if (financeState.committedExpenses.length === 0) {
    list.appendChild(buildEmptyState("Noch keine verpflichtenden Ausgaben", "Leg unten die erste an."));
    return;
  }
  financeState.committedExpenses.forEach((exp) => list.appendChild(buildCommittedItem(exp)));
}

function wireCommittedPanel() {
  const panel = document.getElementById("committed-manage-panel");
  document.getElementById("committed-manage-toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  const dateChips = wireDateChipGroup(document.getElementById("new-committed-date-chips"));
  document.getElementById("new-committed-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-committed-name");
    const amountInput = document.getElementById("new-committed-amount");
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);
    const dueDate = dateChips.getPlannedDate();
    if (!name || !amount || !dueDate) {
      // due_date ist NOT NULL in der DB — ohne diesen Hinweis würde "Anlegen" bei "Kein Datum"
      // (dem Chip-Default) einfach stumm gar nichts tun.
      showToast(!dueDate ? "Bitte ein Fälligkeitsdatum wählen." : "Bitte Name und Betrag ausfüllen.", true);
      return;
    }
    await withErrorToast(async () => {
      await createCommittedExpense({ name, amount, dueDate });
      showToast(`„${name}" angelegt.`);
      nameInput.value = "";
      amountInput.value = "";
      dateChips.reset();
      await reloadFinance();
    });
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
  const potGroup = document.getElementById("tx-quick-pot");
  const noteInput = document.getElementById("tx-quick-note");

  let selectedPot = "freiheit";
  potGroup.querySelectorAll(".pot-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedPot = chip.dataset.pot;
      potGroup.querySelectorAll(".pot-chip").forEach((c) => (c.dataset.active = String(c.dataset.pot === selectedPot)));
    });
  });

  const closeForm = () => {
    form.hidden = true;
    form.reset();
    selectedPot = "freiheit";
    potGroup.querySelectorAll(".pot-chip").forEach((c) => (c.dataset.active = String(c.dataset.pot === "freiheit")));
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      amountInput.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = Number(amountInput.value);
    if (!amount) return;
    await withErrorToast(async () => {
      await createTransaction({ amount, pot: selectedPot, note: noteInput.value.trim() || null });
      showToast(`${formatEuro(amount)} erfasst.`);
      closeForm();
      await reloadFinance();
    });
  });
}

/* ---------- Fernsehprogramm ---------- */

const watchlistViewState = { items: [], allTasks: [], logEntries: [] };

const WATCHLIST_TYPE_LABEL = { serie: "Serie", anime: "Anime", film: "Film" };
const WATCHLIST_STATUS_LABEL = {
  aktiv: "Aktiv",
  geplant: "Geplant",
  irgendwann: "Irgendwann",
  beendet: "Beendet",
  wartet_auf_neue_staffel: "Wartet auf neue Staffel",
};

async function renderFernsehprogrammView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/fernsehprogramm.html");
  container.innerHTML = await res.text();
  showLoading("watchlist-week-list");

  const [items, allTasks, logEntries] = await Promise.all([listWatchlistItems(), listTasks(), listAllViewingLogEntries()]);
  const weekDates = currentWeekDates(todayISO());
  // Anders als in renderTodayView (nur heute) wird hier gleich die ganze Woche aufgefüllt, damit
  // der Wochenüberblick nicht erst nach 7 Tagen Heute-Besuchen vollständig wird.
  const newTasks = await autoplanWatchlistForDates(items, allTasks, weekDates);
  watchlistViewState.items = items;
  watchlistViewState.allTasks = newTasks.length ? [...allTasks, ...newTasks] : allTasks;
  watchlistViewState.logEntries = logEntries;

  renderWatchlistWeek();
  renderWatchlistOverview();
  wireWatchlistFilters();
  wireWatchlistQuickAddForm();
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
      return `
        <li class="task-item">
          <span class="task-title">${label} — ${escapeHtml(item ? item.title : task.title)}</span>
          <button type="button" class="icon-btn watchlist-swap-btn" data-task-id="${task.id}" aria-label="Tauschen">⇄</button>
        </li>`;
    })
    .join("");
  empty.hidden = tasksByDate.size > 0;

  list.querySelectorAll(".watchlist-swap-btn").forEach((btn) => {
    btn.addEventListener("click", () => openWatchlistSwapPicker(btn.dataset.taskId));
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

function computeAvgRatingByItemId() {
  const avgByItemId = {};
  for (const item of watchlistViewState.items) {
    const entries = watchlistViewState.logEntries.filter((e) => e.watchlist_item_id === item.id);
    avgByItemId[item.id] = computeAverageRating(entries);
  }
  return avgByItemId;
}

function renderWatchlistOverview() {
  const list = document.getElementById("watchlist-overview-list");
  const moreBtn = document.getElementById("watchlist-overview-more");
  const emptyState = document.getElementById("watchlist-overview-empty-state");

  if (watchlistViewState.items.length === 0) {
    emptyState.hidden = false;
    list.innerHTML = "";
    moreBtn.hidden = true;
    return;
  }
  emptyState.hidden = true;

  const typeFilter = document.getElementById("watchlist-filter-type").value;
  const genreFilter = document.getElementById("watchlist-filter-genre").value.trim().toLowerCase();
  const minRatingFilter = document.getElementById("watchlist-filter-rating").value;
  const avgByItemId = computeAvgRatingByItemId();

  const filtered = filterWatchlistItems(
    watchlistViewState.items,
    { type: typeFilter || undefined, minAvgRating: minRatingFilter ? Number(minRatingFilter) : undefined },
    avgByItemId
  );
  // Genre-Filter hier bewusst nicht über filterWatchlistItems (dort exakter Tag-Match), sondern
  // als Teilstring-Suche — Genres sind frei eingegebene Tags, kein fester Enum wie Typ/Status.
  const genreFiltered = genreFilter ? filtered.filter((i) => i.genres?.some((g) => g.toLowerCase().includes(genreFilter))) : filtered;

  const renderItems = (items) => {
    list.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      const avg = avgByItemId[item.id];
      li.textContent = `${WATCHLIST_TYPE_LABEL[item.type]} · ${item.title}${avg == null ? "" : ` · Ø ${Math.round(avg * 100)}%`}`;
      li.addEventListener("click", () => openWatchlistDetail(item.id));
      list.appendChild(li);
    }
  };
  renderItems(genreFiltered.slice(0, 5));

  if (genreFiltered.length > 5) {
    moreBtn.hidden = false;
    moreBtn.textContent = `+${genreFiltered.length - 5} weitere`;
    moreBtn.onclick = () => {
      renderItems(genreFiltered);
      moreBtn.hidden = true;
    };
  } else {
    moreBtn.hidden = true;
  }
}

function wireWatchlistFilters() {
  document.getElementById("watchlist-filter-type").addEventListener("change", renderWatchlistOverview);
  document.getElementById("watchlist-filter-genre").addEventListener("input", renderWatchlistOverview);
  document.getElementById("watchlist-filter-rating").addEventListener("change", renderWatchlistOverview);
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
  const avgLabel = avg == null ? "—" : `${Math.round(avg * 100)} % positiv`;
  const logHtml = log.length
    ? log
        .map((entry) => {
          const ratingIcon = entry.rating === "up" ? "👍" : entry.rating === "down" ? "👎" : "übersprungen";
          const epLabel = entry.season != null || entry.episode != null ? `S${entry.season ?? "?"}E${entry.episode ?? "?"} · ` : "";
          return `
          <li class="task-item">
            <span class="task-title">${epLabel}${ratingIcon} · ${formatShortDate(entry.watched_at.slice(0, 10))}</span>
            <button type="button" class="icon-btn icon-btn-danger watchlist-log-delete" data-log-id="${entry.id}" aria-label="Sichtung löschen">×</button>
          </li>`;
        })
        .join("")
    : `<p class="empty-state">Noch keine Sichtung geloggt.</p>`;

  card.innerHTML = `
    <h2 class="modal-view-title">${escapeHtml(item.title)}</h2>
    <p class="status-message">Ø Bewertung: ${avgLabel}</p>

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

// Öffnet direkt beim Abhaken einer Watchlist-Aufgabe ein kleines 👍/👎-Popup (plus "Überspringen").
// Loggt die Sichtung immer (auch bei Überspringen, rating bleibt dann null) und rückt bei
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
      if (item.type !== "film" && item.current_episode != null) {
        await updateWatchlistItem(item.id, { current_episode: item.current_episode + 1 });
      }
      close(logRow.id);
    };

    root.innerHTML = `
      <div class="modal-backdrop" id="rating-backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Bewertung">
          <h2 class="modal-view-title">„${escapeHtml(item.title)}" geschaut — wie war's?</h2>
          <div class="modal-actions">
            <button class="btn" type="button" id="rating-up">👍</button>
            <button class="btn" type="button" id="rating-down">👎</button>
          </div>
          <button class="btn btn-secondary" type="button" id="rating-skip">Überspringen</button>
        </div>
      </div>`;
    document.getElementById("rating-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "rating-backdrop") submit(null);
    });
    document.getElementById("rating-up").addEventListener("click", () => submit("up"));
    document.getElementById("rating-down").addEventListener("click", () => submit("down"));
    document.getElementById("rating-skip").addEventListener("click", () => submit(null));
  });
}

/* ---------- Bereiche (Verwaltung, Teil der Übersicht) ---------- */

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
    await withErrorToast(async () => {
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
    await withErrorToast(async () => {
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
    await withErrorToast(async () => {
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    const areas = await listAreas();
    const maxSort = areas.reduce((m, a) => Math.max(m, a.sort_order ?? 0), -1);
    try {
      await createArea({ name, color: colorInput.value, sort_order: maxSort + 1 });
      nameInput.value = "";
      colorInput.value = "#378ADD";
      reloadOverview();
    } catch (err) {
      showToast("Anlegen fehlgeschlagen: " + friendlyErrorMessage(err), true);
    }
  });
}

init();
