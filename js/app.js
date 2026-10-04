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
import { createThought } from "./thoughts.js";
import { listWishlistItems, getSavingsPotBalance } from "./wishlist.js";
import { isHabitTask, autoplanDueHabits, logHabitSkip } from "./habits.js";
import { isWatchlistTask } from "./watchlist.js";
import {
  listBirthdays,
  createBirthday,
  updateBirthday,
  deleteBirthday,
  daysUntilNextOccurrence,
  nextOccurrence,
} from "./birthdays.js";
import { listComments, listAllCommentedTaskIds, createComment, deleteComment } from "./comments.js";
import {
  getStoredTheme,
  applyTheme,
  getBackgroundImageBlob,
  saveBackgroundImageBlob,
  clearBackgroundImage,
  resizeImageToBlob,
} from "./personalization.js";
import { createDateChipGroup, wireDateChipGroup } from "./ui/date-chips.js";
import { todayISO, weekStartISO, formatShortDate } from "./ui/dates.js";
import {
  BADGE_ICON_HABIT,
  BADGE_ICON_OVERDUE,
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
import { renderBooksView } from "./views/books.js";
import { renderCockpitView } from "./views/cockpit.js";
import { renderDebtsView } from "./views/debts.js";
import { renderExpenseCategoriesView } from "./views/expense-categories.js";
import { renderFernsehprogrammView, promptWatchlistRating } from "./views/fernsehprogramm.js";
import { renderBuyReadyAlert, renderFinanceView } from "./views/finance.js";
import { renderFixkostenView } from "./views/fixkosten.js";
import { renderGamesView } from "./views/games.js";
import { renderHabitsView } from "./views/habits.js";
import { renderKuehlschrankView } from "./views/kuehlschrank.js";
import { renderPlanView } from "./views/plan.js";
import { renderReiseView } from "./views/reise.js";
import { renderRezepteView } from "./views/rezepte.js";
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
