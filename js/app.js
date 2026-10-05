// Einstieg: Bootstrap (Theme/Hintergrund), Auth-Init, Login, Router und Navigations-Shell.
// Die einzelnen Ansichten liegen unter js/views/, geteilte UI-Helfer unter js/ui/.
import { getSession, onAuthStateChange, signInWithMagicLink, ensureAreasSeeded } from "./auth.js";
import { getStoredTheme, getBackgroundImageBlob } from "./personalization.js";
import { showToast, showConfirm, friendlyErrorMessage } from "./ui/modals.js";
import { updateNavBadge } from "./ui/nav.js";
import { maybeShowThoughtNudge, maybeShowReflectionPopup, maybeShowFollowupPopup } from "./ui/popups.js";
import { state, setRenderShell } from "./ui/state.js";
import { renderBooksView } from "./views/books.js";
import { renderCockpitView } from "./views/cockpit.js";
import { renderDebtsView } from "./views/debts.js";
import { renderExpenseCategoriesView } from "./views/expense-categories.js";
import { renderFernsehprogrammView } from "./views/fernsehprogramm.js";
import { renderFinanceView } from "./views/finance.js";
import { renderFixkostenView } from "./views/fixkosten.js";
import { renderGamesView } from "./views/games.js";
import { renderHabitsView } from "./views/habits.js";
import { renderKuehlschrankView } from "./views/kuehlschrank.js";
import { renderOverviewView } from "./views/overview.js";
import { renderPlanView } from "./views/plan.js";
import { renderReiseView } from "./views/reise.js";
import { renderRezepteView } from "./views/rezepte.js";
import { renderTodayView } from "./views/today.js";
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

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  return routes[hash] ? hash : "today";
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

function renderShell() {
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

init();
