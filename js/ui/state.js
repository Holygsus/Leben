// Geteilter UI-State (modulübergreifend gelesen/geschrieben) und Ansichts-Caches.
// Geteilter veränderlicher UI-State. ES-Module-Bindings (`export let`) sind von außen nicht
// zuweisbar — deshalb liegen alle modulübergreifend gelesenen UND geschriebenen Variablen als
// Properties auf diesem einen Objekt (Zugriff überall als state.<name>).
export const state = {
  // Räumt ein offenes Detail-Modal vollständig auf (DOM, Scroll-Sperre, Escape-Listener).
  // Wird von openTaskDetail() gesetzt und von renderShell() aufgerufen, falls beim
  // Ansichtswechsel noch ein Modal offen ist — sonst bliebe der Escape-Listener für immer hängen.
  closeActiveModal: null,
  // Aus session.user_metadata gecacht statt bei jedem renderGreeting()-Aufruf neu zu fetchen — kommt
  // bereits kostenlos mit jeder Session mit, siehe supabase.auth.getSession()/updateUser().
  currentUsername: null,
  // Merkt sich den zuletzt bekannten "Heute"-Zähler über renderShell()-Neuaufbauten hinweg (das
  // Nav-Markup wird bei jedem Routenwechsel neu erzeugt) — so bleibt die Zahl auch sichtbar,
  // während man z.B. in der Übersicht browst, statt nur direkt auf der Heute-Ansicht.
  todayRemainingCount: null,
  // Erhöht sich bei jedem renderShell()-Aufruf. Die render*View()-Funktionen lesen ihren Stand direkt
  // nach dem Start in eine lokale Variable und vergleichen kurz vor dem entscheidenden
  // innerHTML-Write erneut dagegen — wechselt der Nutzer währenddessen schnell die Route (z.B.
  // Heute → Finanzen → Heute), bricht der veraltete, inzwischen überholte Aufruf statt seine Ansicht
  // über die aktuell sichtbare zu schreiben.
  renderGeneration: 0,
  // In-Memory-Snooze: klickt der Nutzer das Popup weg, ohne zu entscheiden, poppt es nicht bei jedem
  // Re-Render erneut auf — bleibt aber über die Cockpit-Kachel und beim nächsten App-Start erreichbar.
  followupPopupSnoozed: false,
  // Dasselbe für das zweite Fenster "Neue Mutteraufgaben" (Erstaufgaben).
  erstaufgabenPopupSnoozed: false,
};

// renderShell() lebt in app.js (Router), wird aber auch aus ui/popups.js aufgerufen. Statt eines
// Import-Zyklus zum Einstiegsmodul registriert app.js die Funktion hier beim Laden.
let renderShellImpl = null;
export function setRenderShell(fn) {
  renderShellImpl = fn;
}
export function renderShell() {
  return renderShellImpl();
}

export const FILTER_STORAGE_KEY = "leben-os:overview-filters";

function loadStoredFilters() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const storedFilters = loadStoredFilters();

export const overviewState = {
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

// Cache der zuletzt geladenen Heute-Aufgaben. Auf-/Zuklappen und Statusänderungen sollen nur den
// Aufgaben-Teil neu rendern statt views/today.html komplett neu zu fetchen (das hätte #view-content
// per innerHTML ersetzt und damit den Scroll-Container zurückgesetzt) — siehe
// renderTodayTaskSection()/refreshTodayTaskList()/rerenderTodayTaskListFromCache().
export const todayViewState = {
  allTasks: [],
  areaColorById: {},
  areaNameById: {},
  birthdays: [],
};
