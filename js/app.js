// Einstieg: Bootstrap (Theme/Hintergrund), Auth-Init, Login, Router und Navigations-Shell.
// Die einzelnen Ansichten liegen unter js/views/, geteilte UI-Helfer unter js/ui/.
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
import { createThought, listThoughts, updateThought } from "./thoughts.js";
import {
  suggestTasksForPlan,
  formatTasksForExport,
  savePlanForDate,
  budgetForDate,
  buildEffortClassSlots,
  buildAreaRotationQueue,
  isPlannableCandidate,
} from "./planner.js";
import { listTransactions, listFixedCosts, listCommittedExpenses, getFinanceModuleSettings } from "./finance.js";
import { listWishlistItems, getSavingsPotBalance, listSavingsPotEntries } from "./wishlist.js";
import {
  WEEKDAY_CODES,
  isHabitTask,
  isCounterHabit,
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
  logHabitSkip,
  listHabitsForToday,
  listHabitCompletionsSince,
} from "./habits.js";
import {
  INSIGHT_WINDOW_DAYS,
  listReflectionsSince,
  listTaskFeedbackSince,
  shiftIsoDate,
  buildMoodStrip,
  averageMood,
  averageRatingByArea,
  moodByHabitDays,
} from "./insights.js";
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
} from "./watchlist.js";
import {
  listBirthdays,
  createBirthday,
  updateBirthday,
  deleteBirthday,
  daysUntilNextOccurrence,
  nextOccurrence,
} from "./birthdays.js";
import { listRecipes, createRecipe, updateRecipe, deleteRecipe, formatIngredientsForShoppingList } from "./recipes.js";
import { listPantryItems, createPantryItem, updatePantryItem, deletePantryItem } from "./pantry.js";
import { listGames, createGame, updateGame, deleteGame } from "./games.js";
import {
  listTrips,
  createTrip,
  updateTrip,
  deleteTrip,
  listTripItems,
  createTripItem,
  updateTripItem,
  deleteTripItem,
} from "./trips.js";
import {
  listBooks,
  createBook,
  updateBook,
  deleteBook,
  listReadingLog,
  logReadingSession,
  sumPagesInMonth,
  sumChaptersInMonth,
} from "./books.js";
import { listComments, listAllCommentedTaskIds, createComment, deleteComment } from "./comments.js";
import { listOpenFollowupGroups, countOpenFollowups } from "./followups.js";
import {
  getStoredTheme,
  applyTheme,
  getBackgroundImageBlob,
  saveBackgroundImageBlob,
  clearBackgroundImage,
  resizeImageToBlob,
  getBookCoverBlob,
  saveBookCoverBlob,
  clearBookCover,
} from "./personalization.js";
import { createDateChipGroup, wireDateChipGroup } from "./ui/date-chips.js";
import {
  todayISO,
  tomorrowISO,
  weekStartISO,
  buildMonthGrid,
  shiftMonth,
  shiftIsoDay,
  isoDayDiff,
  monthRange,
  formatShortDate,
} from "./ui/dates.js";
import {
  WEEKDAY_LABEL,
  BADGE_ICON_HABIT,
  BADGE_ICON_BRAINSTORM,
  BADGE_ICON_OVERDUE,
  STREAK_ICON_FLAME,
  escapeHtml,
  buildPinIcon,
  buildEditIcon,
  buildTrashIcon,
  buildDuplicateIcon,
  buildDragHandleIcon,
  EMPTY_STATE_SEARCH_ICON,
  buildEmptyState,
  taskOptionsHtml,
} from "./ui/dom.js";
import { showToast, showConfirm, friendlyErrorMessage, showLoading, withErrorToast } from "./ui/modals.js";
import { updateNavBadge } from "./ui/nav.js";
import {
  maybeShowThoughtNudge,
  maybeShowReflectionPopup,
  openTaskFeedbackSheet,
  maybeShowFollowupPopup,
  triggerFollowupPopupAfterCompletion,
  openFollowupPopup,
} from "./ui/popups.js";
import { state, FILTER_STORAGE_KEY, overviewState, todayViewState, setRenderShell } from "./ui/state.js";
import {
  deleteTaskWithUndo,
  restoreTaskSnapshot,
  showCompleteUndoToast,
  duplicateTaskTree,
} from "./ui/task-actions.js";
import {
  isTaskOverdue,
  isTaskDueSoon,
  compareByUrgency,
  compareByPriority,
  filterTreeNodes,
} from "./ui/task-helpers.js";
import { renderDebtsView } from "./views/debts.js";
import { renderExpenseCategoriesView } from "./views/expense-categories.js";
import { renderBuyReadyAlert, renderFinanceView } from "./views/finance.js";
import { renderFixkostenView } from "./views/fixkosten.js";
import { renderVerpflichtendeAusgabenView } from "./views/verpflichtende-ausgaben.js";

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
  reise: renderReiseView,
  fixkosten: renderFixkostenView,
  "verpflichtende-ausgaben": renderVerpflichtendeAusgabenView,
  debts: renderDebtsView,
  "expense-categories": renderExpenseCategoriesView,
};

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
    state.currentUsername = session.user.user_metadata?.username || null;
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
      state.currentUsername = newSession.user.user_metadata?.username || null;
      ensureAreasSeededOnce(newSession.user.id)
        .then(renderShell)
        .catch((err) => showToast(friendlyErrorMessage(err), true));
    } else {
      seedPromise = null;
      state.currentUsername = null;
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
  {
    route: "reise",
    label: "Reise",
    icon: `<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>`,
  },
];
let closeNavMoreMenu = null;

export function renderShell() {
  state.renderGeneration++;
  const route = currentRoute();
  const isMoreRoute = MORE_ROUTES.some((r) => r.route === route);
  // Offenes Detail-Modal schließen — es liegt außerhalb von #app und würde sonst
  // beim Ansichtswechsel über der neuen Ansicht hängen bleiben.
  if (state.closeActiveModal) state.closeActiveModal();
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
  if (state.todayRemainingCount !== null) updateNavBadge(state.todayRemainingCount);
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
  maybeShowThoughtNudge();
}
setRenderShell(renderShell);

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

/* ---------- Today ---------- */

async function renderTodayView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/today.html");
  if (myGeneration !== state.renderGeneration) return;
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
  wireThoughtCapture();
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
  const text = state.currentUsername ? `${greeting}, ${state.currentUsername}` : greeting;
  const icon = hour < 18 ? GREETING_SUN_ICON : GREETING_MOON_ICON;
  // Tageszeit-Verlauf hinter dem Gruß (morgens warm, tagsüber kühl, abends dämmrig) — macht den
  // Kopf lebendig und verankert die Uhrzeit, ergänzend zum bereits vorhandenen Sonne/Mond-Icon.
  const phase = hour < 11 ? "morning" : hour < 18 ? "day" : "evening";
  const greetingEl = document.querySelector(".today-greeting");
  if (greetingEl) greetingEl.dataset.daytime = phase;
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
    state.closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = close;

  root.innerHTML = `
    <div class="modal-backdrop" id="settings-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Einstellungen">
        <h2>Einstellungen</h2>
        <label class="modal-label">
          Name
          <input class="input" type="text" id="settings-username" value="${escapeHtml(state.currentUsername || "")}" placeholder="Dein Name" />
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
      state.currentUsername = username || null;
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

// tasks = für heute geplante Aufgaben, overdueTasks = nicht erledigte Aufgaben mit Plandatum in der
// Vergangenheit. Beide zusammen bestimmen den Tagesfortschritt: überfällige, noch offene Top-Level-
// Aufgaben zählen in den Nenner (und "offen") des Rings mit hinein — analog zur Nav-Badge-Logik
// unten —, damit das Bild dem echten Pensum entspricht (sie stehen oben in der Liste ohnehin als
// "Überfällig"). Erledigt können überfällige nie sein, also erhöhen sie nur den Nenner, nie den Zähler.
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
  // Überfällige, noch offene Top-Level-Aufgaben zählen mit in den Nenner (nie in den Zähler, da nie
  // erledigt) — sonst zeigt der Ring "alles erledigt", obwohl oben noch Überfälliges in der Liste steht.
  const overdueTopLevelOpen = overdueTasks.filter((t) => !t.parent_task_id && t.status !== "done").length;
  const totalCount = topLevelTasks.length + overdueTopLevelOpen;
  const pct = totalCount ? Math.round((topLevelDoneCount / totalCount) * 100) : 0;
  const remaining = totalCount - topLevelDoneCount;
  document.getElementById("progress-text").textContent = `${topLevelDoneCount} von ${totalCount} Aufgaben erledigt`;
  document.getElementById("progress-subtext").textContent =
    totalCount === 0 ? "" : remaining > 0 ? `Noch ${remaining} offen für heute.` : "Alles erledigt für heute.";
  document.getElementById("progress-ring-pct").textContent = `${pct}%`;
  const ring = document.getElementById("progress-ring");
  ring.style.setProperty("--pct", pct);
  ring.classList.toggle("is-complete", totalCount > 0 && topLevelDoneCount === totalCount);

  // Aufwand-Leiste: aufsummierte Minuten der heute geplanten Top-Level-Aufgaben, Füllstand =
  // bereits erledigte Minuten. Ohne Aufwandsangaben (Summe 0) bleibt die Leiste ausgeblendet.
  const effortEl = document.getElementById("today-effort");
  if (effortEl) {
    const sumEffort = (arr) => arr.reduce((s, t) => s + (Number(t.effort) || 0), 0);
    const totalMin = sumEffort(topLevelTasks);
    if (totalMin > 0) {
      const doneMin = sumEffort(topLevelTasks.filter((t) => t.status === "done"));
      const openMin = totalMin - doneMin;
      effortEl.hidden = false;
      document.getElementById("today-effort-sum").textContent = openMin > 0 ? `noch ~${openMin} min` : "geschafft";
      document.getElementById("today-effort-fill").style.width = `${Math.round((doneMin / totalMin) * 100)}%`;
    } else {
      effortEl.hidden = true;
    }
  }

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
      else list.appendChild(buildTodayGroupEl(node, allTasks, areaColorById, onChange, onToggle, todayIds));
    }
  };
  appendGroups(tree);
}

// Merkt sich zu-/aufgeklappte Mutteraufgaben in Heute über Re-Renders hinweg (nicht über
// View-Wechsel hinaus — das ist in Ordnung, entspricht dem Verhalten der Übersicht).
const todayCollapsedNodes = new Set();

// Klappt eine kleine Skip-Notiz-Form in einer Habit-Zeile auf oder wieder zu. Zweiter Klick auf
// "Nicht gemacht" schließt das Formular wieder (toggle). Bestätigen loggt den Skip-Eintrag
// (mit optionaler Notiz) und löst einen Re-Render der Heute-Ansicht aus.
function toggleSkipNoteForm(row, task, onChange) {
  const existing = row.querySelector(".habit-skip-form");
  if (existing) { existing.remove(); return; }
  const form = document.createElement("div");
  form.className = "habit-skip-form";
  form.innerHTML = `
    <input type="text" class="input habit-skip-note" placeholder="Kurze Notiz (optional)…" maxlength="200" autocomplete="off" />
    <button type="button" class="chip-btn habit-skip-confirm">Bestätigen</button>
    <button type="button" class="chip-btn habit-skip-cancel">×</button>`;
  form.querySelector(".habit-skip-cancel").addEventListener("click", () => form.remove());
  form.querySelector(".habit-skip-confirm").addEventListener("click", async () => {
    const note = form.querySelector(".habit-skip-note").value.trim() || null;
    const date = task.planned_date || todayISO();
    form.querySelector(".habit-skip-confirm").disabled = true;
    await withErrorToast(async () => {
      await logHabitSkip(task.id, { date, note });
      onChange();
    });
  });
  row.appendChild(form);
  form.querySelector(".habit-skip-note").focus();
}

function buildTodayGroupEl(node, allTasks, areaColorById, onChange, onToggle, todayIds) {
  const hasChildren = node.children.length > 0;
  const collapsed = hasChildren && todayCollapsedNodes.has(node.id);
  // Kontext-Label-Mutter: hat selbst kein planned_date für heute, ist nur wegen eines Kindes im
  // Baum. Checkbox wird deaktiviert (einzelne Kinder separat abhaken statt Kaskade auf alle).
  const isContextLabel = hasChildren && todayIds != null && !todayIds.has(node.id);

  const li = document.createElement("li");
  li.className = "task-group";

  const row = document.createElement("div");
  row.className = "task-item";
  appendTaskRowContent(row, node, areaColorById, allTasks, onChange, isContextLabel);

  // Habit-Zeilen in Heute bekommen einen leisen "Nicht gemacht"-Button (Skip-Eintrag, migration-026).
  // Nur für isHabitTask-Knoten selbst (Ja/Nein-Habits) — Pool-Kinder folgen in einer späteren Runde.
  // isContextLabel-Mütter werden ausgenommen: sie haben kein eigenes planned_date für heute.
  if (isHabitTask(node) && !isContextLabel) {
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "chip-btn habit-skip-btn";
    skipBtn.textContent = "Nicht gemacht";
    skipBtn.addEventListener("click", () => toggleSkipNoteForm(row, node, onChange));
    row.appendChild(skipBtn);
  }

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
    // Erledigte Kinder ans Ende bündeln (offene zuerst) — dieselbe doneDiff-Logik wie auf Top-Level
    // (compareByPriority). Ohne das klemmt eine offene Unteraufgabe zwischen durchgestrichenen. Stabil:
    // innerhalb offen/erledigt bleibt die natürliche Reihenfolge erhalten.
    const orderedChildren = [...node.children].sort(
      (a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0)
    );
    for (const child of orderedChildren) {
      childList.appendChild(buildTodayGroupEl(child, allTasks, areaColorById, onChange, onToggle, todayIds));
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
// isContextLabel: true wenn der Task in der Heute-Ansicht nur als Kontext-Label erscheint (kein
// eigenes planned_date für heute, nur wegen geplanter Kinder im Baum) — Checkbox dann deaktiviert.
function appendTaskRowContent(el, task, areaColorById, allTasks, onChange, isContextLabel = false) {
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
  if (isContextLabel) {
    // Kontext-Label-Mutter: erscheint in Heute nur wegen geplanter Kinder, hat kein eigenes
    // planned_date für heute. Checkbox deaktivieren — einzelne Unteraufgaben separat abhaken.
    checkbox.disabled = true;
    checkbox.setAttribute("aria-disabled", "true");
    checkbox.setAttribute("title", "Nur als Kontext — einzelne Unteraufgaben abhaken");
  } else {
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
          // Task-Feedback beim Abhaken (Betriebsmodell): leichtes Rating + Notiz. Habits ausgenommen
          // (schließen wiederholt ab), Watchlist hat ihre eigene Bewertung oben. Sequenziell vor dem
          // Folgeaufgaben-Popup, damit sich die beiden Modals im modal-root nicht überschreiben.
          if (!isWatchlistTask(task) && !isHabitTask(task)) await openTaskFeedbackSheet(task);
        }
        onChange();
        await triggerFollowupPopupAfterCompletion(unmutedFollowups);
      });
    });
  }

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
    state.closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = close;

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

  // „+"-Menü V1 (siehe wissensdatenbank/features/schnellerfassungs-menue.md): Aufgabe ist der
  // Default-Typ (Titelfeld oben), Geburtstag der zweite Eintrag — öffnet den bestehenden
  // Geburtstags-Dialog statt eines zweiten Inline-Formulars. Weitere Typen folgen, sobald ihr
  // Quick-Add aus dem jeweiligen Widget gelöst ist.
  const typeTaskBtn = document.getElementById("quick-add-type-task");
  const typeBirthdayBtn = document.getElementById("quick-add-type-birthday");
  if (typeTaskBtn) typeTaskBtn.addEventListener("click", () => input.focus());
  if (typeBirthdayBtn)
    typeBirthdayBtn.addEventListener("click", () => {
      closeForm();
      openBirthdaysDetail();
    });

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

// Gedanken-Eingang (siehe wissensdatenbank/leben-os-betriebsmodell.md): bewusst schlanker als
// wireQuickCapture — ein `thought` ist rohes, unklassifiziertes Material (kein Bereich/Aufwand),
// den der Daily Pulse erst später deutet. Erzeugt KEINE Aufgabe, nur eine thoughts-Zeile.
function wireThoughtCapture() {
  const form = document.getElementById("thought-form");
  const toggleBtn = document.getElementById("thought-open");
  const cancelBtn = document.getElementById("thought-cancel");
  const input = document.getElementById("thought-input");
  if (!form || !toggleBtn || !input) return;

  const closeForm = () => {
    form.hidden = true;
    form.reset();
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
    // Double-Submit-Guard wie bei wireQuickCapture: bis der Insert durch ist, kein zweites Abschicken.
    if (submitBtn.disabled) return;
    const body = input.value.trim();
    if (!body) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createThought({ body });
        showToast("Gedanke festgehalten.");
        // Panel offen lassen fürs schnelle Mehrfacherfassen, nur das Feld leeren.
        input.value = "";
        input.focus();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- Overview ---------- */

async function renderOverviewView() {
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
    state.closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = close;

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
        if (!isWatchlistTask(task) && !isHabitTask(task)) await openTaskFeedbackSheet(task);
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
          if (!isWatchlistTask(child) && !isHabitTask(child)) await openTaskFeedbackSheet(child);
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

async function renderPlanView() {
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

/* ---------- Habits ---------- */

const habitsViewState = { allTasks: [], areaColorById: {}, completions: [], counterLog: [] };

async function renderHabitsView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/habits.html");
  if (myGeneration !== state.renderGeneration) return;
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

// Kurzer Monatsname für das Konstanz-Balken-Label (z.B. "August"). Einmal berechnet — die
// Habits-Ansicht wird ohnehin bei jedem Öffnen frisch gerendert.
const HABIT_MONTH_LABEL = new Date().toLocaleDateString("de-DE", { month: "long" });

// Erledigte vs. fällige Habit-Tage im laufenden Monat bis einschließlich heute. "Fällig" = der
// Wochentag steht in habit_weekdays (gleiche Logik wie die Heatmap). Basis für den Konstanz-Balken.
function habitMonthProgress(task, completions, todayIso) {
  const [y, m] = todayIso.split("-").map(Number);
  const todayDay = Number(todayIso.slice(8, 10));
  const done = new Set(completions.filter((c) => c.task_id === task.id).map((c) => c.date));
  let due = 0;
  let hit = 0;
  for (let d = 1; d <= todayDay; d++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (task.habit_weekdays.includes(weekdayCodeFromIso(iso))) {
      due++;
      if (done.has(iso)) hit++;
    }
  }
  return { due, hit, pct: due ? Math.round((hit / due) * 100) : 0 };
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
      // Wochen-Ziel-Ring: bei wöchentlichen Habits ist die Zahl der gewählten Tage das Wochensoll.
      // Zeigt "erledigt diese Woche / Soll" als kleiner Ring, ergänzend zu Streak (langfristig) und
      // Heatmap (letzte 7 Tage).
      const weekGoal = recurrence === "weekly" ? t.habit_weekdays.length : 0;
      let weekRing = "";
      if (weekGoal > 0) {
        const weekStart = weekStartISO();
        const weekDone = habitsViewState.completions.filter(
          (c) => c.task_id === t.id && c.date >= weekStart && c.date <= todayISO()
        ).length;
        const pct = Math.min(100, Math.round((weekDone / weekGoal) * 100));
        weekRing = `<span class="habit-week-ring${weekDone >= weekGoal ? " is-complete" : ""}" style="--ring-pct:${pct}" title="${weekDone} von ${weekGoal} diese Woche" aria-label="${weekDone} von ${weekGoal} diese Woche"><span>${weekDone}/${weekGoal}</span></span>`;
      }
      // Monats-Konstanz-Balken: erledigte vs. fällige Tage im laufenden Monat bis heute.
      const month = habitMonthProgress(t, habitsViewState.completions, todayISO());
      const monthBar =
        month.due > 0
          ? `<div class="habit-month"><span class="habit-month-label">${HABIT_MONTH_LABEL} ${month.pct}%</span><span class="habit-month-bar"><i style="width:${month.pct}%"></i></span></div>`
          : "";
      // Aufgaben-Pool: die Unteraufgaben (parent_task_id), aus denen findHabitsDueToday an einem
      // fälligen Tag rotierend eine auswählt. Bisher nur beim Anlegen / im Detail-Modal ergänzbar —
      // hier ein Inline-Add direkt in der Zeile (implementieren-jetzt.md, Tab-Feedback 2026-08-02).
      const poolChildren = habitsViewState.allTasks.filter((c) => c.parent_task_id === t.id);
      const poolList = poolChildren.length
        ? `<ul class="habit-pool-list">${poolChildren.map((c) => `<li>${escapeHtml(c.title)}</li>`).join("")}</ul>`
        : "";
      return `
      <li class="task-item habit-item" data-habit-id="${t.id}" data-expanded="false" style="${
        areaColor ? `border-left-color:${areaColor};--task-area-color:${areaColor};` : ""
      }">
        <span class="task-area-dot" style="background:${areaColor || "var(--color-text-subtle)"}"></span>
        <div class="habit-body">
          <button type="button" class="habit-toggle" aria-expanded="false">
            <span class="task-title">${escapeHtml(t.title)}<span class="habit-freq">${freqLabel}</span></span>
            <span class="habit-metrics">${weekRing}${heatmap}${streakBadge}</span>
          </button>
          ${monthBar}
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
            <div class="habit-pool">
              <span class="habit-pool-label">Aufgaben-Pool</span>
              ${poolList}
              <div class="habit-pool-add">
                <input type="text" class="input habit-pool-input" placeholder="Aufgabe hinzufügen…" autocomplete="off" data-habit-pool-input />
                <button type="button" class="chip-btn habit-pool-add-btn" data-habit-pool-add aria-label="Aufgabe zum Pool hinzufügen">+</button>
              </div>
            </div>
            <button type="button" class="habit-delete-btn" data-habit-delete>Habit löschen</button>
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

    const poolAddBtn = e.target.closest("[data-habit-pool-add]");
    if (poolAddBtn) {
      await addHabitPoolChild(poolAddBtn.closest("[data-habit-id]"));
      return;
    }

    const deleteBtn = e.target.closest("[data-habit-delete]");
    if (deleteBtn) {
      const li = deleteBtn.closest("[data-habit-id]");
      const task = habitsViewState.allTasks.find((t) => t.id === li.dataset.habitId);
      // Kein Undo-Toast wie bei normalen Aufgaben: restoreTaskSnapshot stellt die Habit-Felder
      // (is_habit/habit_weekdays/habit_recurrence …) nicht wieder her, ein Undo würde den Habit
      // still zu einer normalen Aufgabe degradieren. Darum bewusst das Rezept/Geburtstag-Muster
      // (Bestätigung statt Undo). Pool-Kinder entfernt die DB per Cascade mit.
      const ok = await showConfirm(`„${task.title}" wirklich löschen?`, { confirmLabel: "Löschen", danger: true });
      if (!ok) return;
      await withErrorToast(async () => {
        await deleteTask(task.id);
        await renderHabitsView();
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

  list.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest("[data-habit-pool-input]");
    if (!input) return;
    e.preventDefault();
    addHabitPoolChild(input.closest("[data-habit-id]"));
  };
}

// Legt ein neues Pool-Kind (parent_task_id = Habit) aus dem Inline-Feld einer Habit-Zeile an.
// Statt renderHabitsView() (voller Refetch, der die Zeile zuklappen würde) wird die neue Aufgabe
// lokal in habitsViewState.allTasks eingehängt und die Liste neu gerendert — danach die betroffene
// Zeile wieder aufklappen und das Feld fokussieren, damit mehrere Aufgaben zügig nacheinander
// eingegeben werden können. Das Kind ist selbst kein Habit (habit_weekdays: null) und taucht daher
// nur im Pool auf, nicht als eigene Habit-Zeile.
async function addHabitPoolChild(li) {
  if (!li) return;
  const habitId = li.dataset.habitId;
  const input = li.querySelector("[data-habit-pool-input]");
  const title = input.value.trim();
  if (!title) {
    input.focus();
    return;
  }
  await withErrorToast(async () => {
    const created = await createTask({ title, parentTaskId: habitId });
    habitsViewState.allTasks.push(created);
    renderHabitList();
    const freshLi = document.querySelector(`#habit-list [data-habit-id="${habitId}"]`);
    if (freshLi) {
      freshLi.dataset.expanded = "true";
      const toggle = freshLi.querySelector(".habit-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
      const expanded = freshLi.querySelector(".habit-expanded");
      if (expanded) expanded.hidden = false;
      const freshInput = freshLi.querySelector("[data-habit-pool-input]");
      if (freshInput) freshInput.focus();
    }
  });
}

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

async function renderFernsehprogrammView() {
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

/* ---------- Rezepte ---------- */
// wissensdatenbank/features/kochen-rezepte-kuehlschrank.md, Punkt 1 — Grundlage für den später
// geplanten digitalen Kühlschrank/Kochen-fördern.

async function renderRezepteView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/rezepte.html");
  if (myGeneration !== state.renderGeneration) return;
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
    if (missing === 0) {
      badge = `<span class="recipe-badge is-ready">✓ kochbar</span>`;
    } else {
      // Verfügbarkeits-Ring statt reiner Fehlzahl: zeigt, WIE NAH ein fast-kochbares Rezept ist
      // (vorhandene / gesamte Zutaten), nicht nur dass etwas fehlt.
      const have = ingredients.length - missing;
      const pct = Math.round((have / ingredients.length) * 100);
      badge = `<span class="recipe-avail-ring" style="--ring-pct:${pct}" title="${have} von ${ingredients.length} Zutaten da" aria-label="${have} von ${ingredients.length} Zutaten vorhanden"><span>${have}/${ingredients.length}</span></span>`;
    }
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
    state.closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = close;

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

// Fehlende Zutaten eines Rezepts relativ zum Vorrat — gleiche Fuzzy-Teilstring-Logik wie der
// "kochbar"-Badge in buildRecipeCard. Reine Funktion, von der "Fehlende einkaufen"-Aktion genutzt.
function computeMissingIngredients(ingredients, pantryNames) {
  return ingredients.filter((ing) => {
    const n = (ing.name || "").toLowerCase().trim();
    if (!n) return false;
    return !pantryNames.some((p) => p.includes(n) || n.includes(p));
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
      <button class="btn btn-secondary" type="button" id="rd-shopping-tasks">🛒 Fehlende einkaufen</button>
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
  // Fehlende Zutaten (Abgleich mit Kühlschrank) als echte Einkaufs-Aufgaben anlegen — verbindet
  // Rezepte-, Kühlschrank- und Aufgaben-Tab. Bewusst als bereichslose Backlog-Aufgaben (is_brainstorm),
  // landen so in "Ohne Bereich" der Übersicht. Rückgängig entfernt die gerade angelegten wieder.
  document.getElementById("rd-shopping-tasks").addEventListener("click", async () => {
    const status = document.getElementById("rd-status");
    const btn = document.getElementById("rd-shopping-tasks");
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const pantryItems = await listPantryItems();
      const pantryNames = pantryItems.map((p) => (p.name || "").toLowerCase()).filter(Boolean);
      const missing = computeMissingIngredients(ingredients, pantryNames);
      if (missing.length === 0) {
        status.textContent = "Alles da — nichts einzukaufen.";
        return;
      }
      await withErrorToast(async () => {
        const created = [];
        for (const ing of missing) {
          const label = `Einkaufen: ${ing.amount ? `${ing.amount} ` : ""}${ing.name}`.trim();
          created.push(await createTask({ title: label, effort: 5, isBrainstorm: true }));
        }
        status.textContent = `${created.length} Einkaufs-Aufgabe${created.length === 1 ? "" : "n"} angelegt.`;
        showToast(`${created.length} Einkaufs-Aufgabe${created.length === 1 ? "" : "n"} angelegt.`, false, {
          label: "Rückgängig",
          onClick: () =>
            withErrorToast(async () => {
              for (const t of created) await deleteTask(t.id);
              showToast("Rückgängig gemacht.");
            }),
        });
      });
    } finally {
      btn.disabled = false;
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
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/kuehlschrank.html");
  if (myGeneration !== state.renderGeneration) return;
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
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/games.html");
  if (myGeneration !== state.renderGeneration) return;
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

  // Fortschrittsbalken (volle Breite unter der Zeile) aus progress_pct — macht den Durchspiel-Stand
  // sichtbar, statt ihn nur als Zahl im Eingabefeld zu führen. Nur ab >0 %.
  if (game.progress_pct != null && game.progress_pct > 0) {
    const bar = document.createElement("span");
    bar.className = "game-progress";
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML = `<span class="game-progress-fill" style="width:${Math.min(100, game.progress_pct)}%;background:${statusColor}"></span>`;
    li.append(bar);
  }
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

// Statusfarbe für Kanten-/Aktiv-Hervorhebung der Buch-Zeile (der Status lag bisher nur im Dropdown).
const BOOK_STATUS_COLOR = {
  aktiv: "var(--color-success)",
  pausiert: "var(--color-accent-warm)",
  geplant: "var(--color-text-subtle)",
  beendet: "var(--color-accent)",
};

const booksState = { books: [], log: [] };

async function renderBooksView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/books.html");
  if (myGeneration !== state.renderGeneration) return;
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
  const activeCount = booksState.books.filter((b) => b.status === "aktiv").length;
  const doneCount = booksState.books.filter((b) => b.status === "beendet").length;
  // Primäre Monatszahl: Seiten, sonst Kapitel (je nachdem, was geloggt wurde).
  const monthValue = pages > 0 ? pages : chapters;
  const monthUnit = pages > 0 ? "Seiten / Monat" : "Kapitel / Monat";
  // Stat-Kopf statt blasser Textzeile — gibt dem Screen einen Anker (analog Gaming-Stat-Leiste).
  el.classList.add("books-stat-head");
  el.innerHTML =
    `<span class="books-stat"><b style="color:var(--color-accent-warm)">${monthValue}</b><small>${monthUnit}</small></span>` +
    `<span class="books-stat"><b>${activeCount}</b><small>Aktiv</small></span>` +
    `<span class="books-stat"><b style="color:var(--color-success)">${doneCount}</b><small>Beendet</small></span>`;
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
  loadActiveBookCovers();
}

// Lädt die lokal gespeicherten Cover-Blobs (IndexedDB) für die aktiven Bücher nach und füllt das
// jeweilige .book-cover-Element — asynchron/fire-and-forget, damit renderBooksList synchron bleibt.
async function loadActiveBookCovers() {
  const buttons = document.querySelectorAll(".book-cover[data-book-id]");
  for (const btn of buttons) {
    const blob = await getBookCoverBlob(btn.dataset.bookId).catch(() => null);
    if (!blob || !btn.isConnected) continue;
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.alt = "Cover";
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
    btn.innerHTML = "";
    btn.classList.remove("book-cover-empty");
    btn.appendChild(img);
    const removeBtn = btn.parentElement?.querySelector(".book-cover-remove");
    if (removeBtn) removeBtn.hidden = false;
  }
}

function buildBookItem(book) {
  const li = document.createElement("li");
  li.className = "task-item tx-item book-item";
  // Statusfarbe an die Kante; das aktuell gelesene Buch zusätzlich als Hero hervorgehoben (steht
  // durch BOOK_STATUS_ORDER ohnehin schon oben).
  const statusColor = BOOK_STATUS_COLOR[book.status] || "var(--color-text-subtle)";
  li.style.borderLeftColor = statusColor;
  li.style.setProperty("--task-area-color", statusColor);
  if (book.status === "aktiv") li.classList.add("is-active-book");

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

  // Cover-Upload/-Anzeige nur fürs aktive Buch (siehe wissensdatenbank/features/lesen-als-bereich.md).
  // Cover-Blob liegt rein lokal in IndexedDB (kein DB-Feld) — gleiches Muster wie das Hintergrundbild.
  // Das eigentliche Bild wird nach dem Listen-Aufbau asynchron nachgeladen (loadActiveBookCovers).
  if (book.status === "aktiv") {
    const coverWrap = document.createElement("div");
    coverWrap.className = "book-cover-wrap";

    const coverBtn = document.createElement("button");
    coverBtn.type = "button";
    coverBtn.className = "book-cover book-cover-empty";
    coverBtn.dataset.bookId = book.id;
    coverBtn.setAttribute("aria-label", "Cover hochladen");
    coverBtn.innerHTML = `<span class="book-cover-placeholder">＋ Cover</span>`;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;

    coverBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      await withErrorToast(async () => {
        const blob = await resizeImageToBlob(file, 600);
        await saveBookCoverBlob(book.id, blob);
        await reloadBooks();
      });
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "book-cover-remove";
    removeBtn.textContent = "×";
    removeBtn.hidden = true;
    removeBtn.setAttribute("aria-label", "Cover entfernen");
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await withErrorToast(async () => {
        await clearBookCover(book.id);
        await reloadBooks();
      });
    });

    coverWrap.append(coverBtn, removeBtn, fileInput);
    li.prepend(coverWrap);
  }

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

/* ---------- Reiseplanung ---------- */
// wissensdatenbank/features/reiseplanung.md — Pool→Tage-Modell, eigenes Datenmodell (trips/trip_items).
// Pool = trip_items ohne day_number; Tageszuweisung per Dropdown setzt day_number + status.

const reiseState = { trips: [], items: [], selectedTripId: null };
const TIME_SLOT_LABELS = { vormittag: "Vormittag", nachmittag: "Nachmittag", abend: "Abend" };
const TIME_SLOT_ORDER = { vormittag: 0, nachmittag: 1, abend: 2 };

async function renderReiseView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/reise.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();

  reiseState.trips = await listTrips();
  if (myGeneration !== state.renderGeneration) return;

  // Auswahl-Default: bestehende Auswahl behalten, sonst erste aktive, sonst erste Reise.
  if (!reiseState.trips.some((t) => t.id === reiseState.selectedTripId)) {
    const active = reiseState.trips.find((t) => t.status === "aktiv");
    reiseState.selectedTripId = active?.id ?? reiseState.trips[0]?.id ?? null;
  }

  renderReiseTripPicker();
  wireReiseNewTripForm();
  wireReisePoolAddForm();
  await reloadReiseItems();
}

function renderReiseTripPicker() {
  const select = document.getElementById("reise-trip-select");
  select.innerHTML = reiseState.trips
    .map(
      (t) =>
        `<option value="${t.id}"${t.id === reiseState.selectedTripId ? " selected" : ""}>${escapeHtml(t.title)}${t.destination ? " · " + escapeHtml(t.destination) : ""}</option>`
    )
    .join("");
  select.hidden = reiseState.trips.length === 0;
  select.onchange = async () => {
    reiseState.selectedTripId = select.value;
    await reloadReiseItems();
  };
}

async function reloadReiseItems() {
  const content = document.getElementById("reise-content");
  const empty = document.getElementById("reise-empty");
  if (!reiseState.selectedTripId) {
    content.hidden = true;
    empty.hidden = false;
    empty.innerHTML = "";
    empty.appendChild(buildEmptyState("Noch keine Reise", "Leg oben deine erste Reise an."));
    return;
  }
  empty.hidden = true;
  content.hidden = false;
  reiseState.items = await listTripItems(reiseState.selectedTripId);
  renderReiseBody();
}

// Anzahl der Tage: aus der Datumsspanne (falls gesetzt), sonst höchster genutzter day_number, min. 1.
function reiseDayCount() {
  const trip = reiseState.trips.find((t) => t.id === reiseState.selectedTripId);
  let rangeDays = 0;
  if (trip?.date_from && trip?.date_to) {
    const from = new Date(trip.date_from + "T00:00:00");
    const to = new Date(trip.date_to + "T00:00:00");
    rangeDays = Math.floor((to - from) / 86400000) + 1;
  }
  const maxUsed = reiseState.items.reduce((m, i) => Math.max(m, i.day_number || 0), 0);
  return Math.max(rangeDays, maxUsed, 1);
}

function renderReiseBody() {
  const dayCount = reiseDayCount();

  const poolList = document.getElementById("reise-pool-list");
  poolList.innerHTML = "";
  const pool = reiseState.items.filter((i) => i.day_number == null);
  if (pool.length === 0) {
    poolList.appendChild(buildEmptyState("Pool ist leer", "Erfasse oben Attraktionen für diese Reise."));
  } else {
    pool.forEach((item) => poolList.appendChild(buildTripItemRow(item, dayCount)));
  }

  const daysWrap = document.getElementById("reise-days");
  daysWrap.innerHTML = "";
  for (let day = 1; day <= dayCount; day++) {
    const dayItems = reiseState.items
      .filter((i) => i.day_number === day)
      .sort((a, b) => (TIME_SLOT_ORDER[a.time_slot] ?? 3) - (TIME_SLOT_ORDER[b.time_slot] ?? 3));
    const section = document.createElement("div");
    section.className = "reise-day";
    const head = document.createElement("h3");
    head.className = "reise-day-head";
    head.textContent = `Tag ${day}${dayItems.length ? ` · ${dayItems.length}` : ""}`;
    section.appendChild(head);
    const ul = document.createElement("ul");
    ul.className = "task-list";
    if (dayItems.length === 0) {
      const li = document.createElement("li");
      li.className = "reise-day-empty";
      li.textContent = "—";
      ul.appendChild(li);
    } else {
      dayItems.forEach((item) => ul.appendChild(buildTripItemRow(item, dayCount)));
    }
    section.appendChild(ul);
    daysWrap.appendChild(section);
  }
}

function buildTripItemRow(item, dayCount) {
  const li = document.createElement("li");
  li.className = "task-item tx-item reise-item" + (item.status === "erledigt" ? " reise-item-done" : "");

  const check = document.createElement("button");
  check.type = "button";
  check.className = "task-checkbox";
  check.dataset.checked = String(item.status === "erledigt");
  check.setAttribute("aria-pressed", String(item.status === "erledigt"));
  check.setAttribute("aria-label", "Erledigt");
  check.textContent = item.status === "erledigt" ? "✓" : "";
  check.addEventListener("click", async () => {
    const newStatus = item.status === "erledigt" ? (item.day_number ? "eingeplant" : "kandidat") : "erledigt";
    await withErrorToast(async () => {
      await updateTripItem(item.id, { status: newStatus });
      await reloadReiseItems();
    });
  });

  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = item.title;
  title.setAttribute("aria-label", "Titel");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === item.title) {
      title.value = item.title;
      return;
    }
    await withErrorToast(async () => {
      await updateTripItem(item.id, { title: value });
      await reloadReiseItems();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  // Tag-Zuweisung: „—/Pool" (kandidat) oder Tag N (eingeplant). Eine Reserve (dayCount+1) erlaubt das
  // Verlängern der Reise ohne separates „Tag hinzufügen".
  const daySelect = document.createElement("select");
  daySelect.className = "select";
  daySelect.setAttribute("aria-label", "Tag");
  let dayOpts = `<option value="">Pool</option>`;
  for (let d = 1; d <= dayCount + 1; d++) {
    dayOpts += `<option value="${d}"${item.day_number === d ? " selected" : ""}>Tag ${d}</option>`;
  }
  daySelect.innerHTML = dayOpts;
  daySelect.addEventListener("change", async () => {
    const day = daySelect.value ? Number(daySelect.value) : null;
    const keepDone = item.status === "erledigt";
    const updates =
      day == null
        ? { day_number: null, status: keepDone ? "erledigt" : "kandidat" }
        : { day_number: day, status: keepDone ? "erledigt" : "eingeplant" };
    await withErrorToast(async () => {
      await updateTripItem(item.id, updates);
      await reloadReiseItems();
    });
  });

  const slotSelect = document.createElement("select");
  slotSelect.className = "select";
  slotSelect.setAttribute("aria-label", "Tageszeit");
  slotSelect.innerHTML =
    `<option value="">—</option>` +
    Object.entries(TIME_SLOT_LABELS)
      .map(([v, l]) => `<option value="${v}"${item.time_slot === v ? " selected" : ""}>${l}</option>`)
      .join("");
  slotSelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateTripItem(item.id, { time_slot: slotSelect.value || null });
      await reloadReiseItems();
    });
  });

  const category = document.createElement("input");
  category.type = "text";
  category.className = "input";
  category.style.maxWidth = "120px";
  category.value = item.category ?? "";
  category.placeholder = "Kategorie";
  category.setAttribute("aria-label", "Kategorie");
  category.addEventListener("blur", async () => {
    const value = category.value.trim() || null;
    if (value === (item.category ?? null)) return;
    await withErrorToast(async () => {
      await updateTripItem(item.id, { category: value });
      await reloadReiseItems();
    });
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon-btn icon-btn-danger";
  del.textContent = "×";
  del.setAttribute("aria-label", "Entfernen");
  del.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteTripItem(item.id);
      await reloadReiseItems();
    });
  });

  li.append(check, title, daySelect, slotSelect, category, del);
  return li;
}

function wireReiseNewTripForm() {
  const toggle = document.getElementById("reise-new-trip-toggle");
  const form = document.getElementById("reise-new-trip-form");
  toggle.onclick = () => {
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById("reise-new-trip-title").focus();
  };
  const submitBtn = form.querySelector('button[type="submit"]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("reise-new-trip-title");
    const title = titleInput.value.trim();
    if (!title || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        const trip = await createTrip({
          title,
          destination: document.getElementById("reise-new-trip-destination").value.trim() || null,
          dateFrom: document.getElementById("reise-new-trip-from").value || null,
          dateTo: document.getElementById("reise-new-trip-to").value || null,
        });
        reiseState.trips.push(trip);
        reiseState.selectedTripId = trip.id;
        form.reset();
        form.hidden = true;
        showToast(`Reise „${title}" angelegt.`);
        renderReiseTripPicker();
        await reloadReiseItems();
      });
    } finally {
      submitBtn.disabled = false;
    }
  };
}

function wireReisePoolAddForm() {
  const form = document.getElementById("reise-pool-add-form");
  const input = document.getElementById("reise-pool-add-title");
  const submitBtn = form.querySelector('button[type="submit"]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title || submitBtn.disabled || !reiseState.selectedTripId) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createTripItem({ tripId: reiseState.selectedTripId, title, status: "kandidat" });
        input.value = "";
        input.focus();
        await reloadReiseItems();
      });
    } finally {
      submitBtn.disabled = false;
    }
  };
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
