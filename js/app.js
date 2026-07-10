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
} from "./tasks.js";
import { listAreas, createArea, updateArea, deleteArea, swapAreaOrder } from "./areas.js";
import { suggestTasksForPlan, formatTasksForExport, savePlanForDate } from "./planner.js";

const app = document.getElementById("app");

const routes = {
  today: renderTodayView,
  overview: renderOverviewView,
  plan: renderPlanView,
  areas: renderAreasView,
};

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
  addFormTarget: null, // { areaId, parentTaskId } | null — nur ein offenes Anlegen-Formular gleichzeitig
  renamingId: null, // Aufgaben-ID, die gerade inline umbenannt wird, oder null
  movingNodeId: null, // Aufgaben-ID, für die gerade das Verschieben-Panel offen ist, oder null
  selectedBrainstormIds: new Set(), // Mehrfachauswahl in der "Ohne Bereich"-Liste für Sammel-Aktionen
};

// Räumt ein offenes Detail-Modal vollständig auf (DOM, Scroll-Sperre, Escape-Listener).
// Wird von openTaskDetail() gesetzt und von renderShell() aufgerufen, falls beim
// Ansichtswechsel noch ein Modal offen ist — sonst bliebe der Escape-Listener für immer hängen.
let closeActiveModal = null;

const planState = {
  areas: [],
  pool: [],
  selected: [],
  targetDate: null,
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

  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, action ? 6000 : 3000);
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
      });
      oldToNewId.set(t.id, created.id);
      await insertChildren(t.id);
    }
  };
  await insertChildren(task.id);
}

// Ein "erledigt"-Häkchen wird rückgängig gemacht: zurück zu "geplant" wenn ein Plandatum
// gesetzt ist, sonst zurück zu "offen". So verliert eine geplante Aufgabe nicht still ihren
// Planungsstatus, egal ob man sie in Heute oder in der Übersicht abhakt.
function toggleTaskDoneStatus(task) {
  if (task.status === "done") return task.planned_date ? "planned" : "open";
  return "done";
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
      <a href="#/today" class="nav-link${route === "today" ? " is-active" : ""}">Heute <span class="nav-count" id="nav-today-count" hidden></span></a>
      <a href="#/overview" class="nav-link${route === "overview" ? " is-active" : ""}">Übersicht</a>
      <a href="#/plan" class="nav-link${route === "plan" ? " is-active" : ""}">Plan</a>
      <a href="#/areas" class="nav-link${route === "areas" ? " is-active" : ""}">Bereiche</a>
    </nav>
    <div id="view-content"></div>
  `;
  if (todayRemainingCount !== null) updateNavBadge(todayRemainingCount);
  app.querySelector(".app-nav").addEventListener("click", (e) => {
    const link = e.target.closest("a.nav-link");
    if (!link) return;
    if (hasUnsavedOverviewInput() && !confirm("Es gibt eine ungespeicherte Eingabe. Trotzdem wechseln?")) {
      e.preventDefault();
    }
  });
  routes[route]();
}

// Prüft auf offene, unbestätigte Eingaben in der Übersicht (Inline-Anlegen-Formulare, laufende
// Umbenennung) — Grundlage für die Nachfrage vorm Verlassen der Ansicht per Nav-Klick.
function hasUnsavedOverviewInput() {
  const addInputs = document.querySelectorAll(".inline-add-form input[type='text'], #new-task-title");
  for (const input of addInputs) {
    if (input.value.trim()) return true;
  }
  const renameInput = document.querySelector(".tree-node-rename-input");
  if (renameInput && renameInput.value.trim() !== renameInput.dataset.original) return true;
  return false;
}

/* ---------- Today ---------- */

async function renderTodayView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/today.html");
  container.innerHTML = await res.text();
  showLoading("task-list");

  const [areas, tasks, overdueTasks] = await Promise.all([
    listAreas(),
    listTasks({ plannedDate: todayISO() }),
    listTasks({ plannedBefore: todayISO(), statusNot: "done" }),
  ]);
  const areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));

  renderGreeting();
  renderGymIndicator();
  renderTodayTasks(tasks, overdueTasks, areaColorById);
  wireQuickCapture(areas, renderTodayView);
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
function renderTodayTasks(tasks, overdueTasks, areaColorById) {
  const list = document.getElementById("task-list");
  const emptyState = document.getElementById("empty-state");
  const doneCount = tasks.filter((t) => t.status === "done").length;
  updateNavBadge(tasks.length - doneCount + overdueTasks.length);

  document.getElementById("progress-text").textContent = `${doneCount} von ${tasks.length} Aufgaben erledigt`;
  const progressFill = document.getElementById("progress-bar-fill");
  progressFill.style.width = tasks.length ? `${Math.round((doneCount / tasks.length) * 100)}%` : "0%";
  progressFill.classList.toggle("is-complete", tasks.length > 0 && doneCount === tasks.length);

  list.innerHTML = "";
  for (const task of overdueTasks) {
    list.appendChild(buildTaskItem(task, areaColorById, renderTodayView));
  }

  if (tasks.length === 0 && overdueTasks.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  for (const task of tasks) {
    list.appendChild(buildTaskItem(task, areaColorById, renderTodayView));
  }
}

function buildTaskItem(task, areaColorById, onChange) {
  const li = document.createElement("li");
  const isStale = isTaskStale(task);
  const isOverdue = isTaskOverdue(task);
  li.className =
    "task-item" +
    (task.status === "done" ? " is-done" : "") +
    (isStale ? " is-stale" : "") +
    (isOverdue ? " is-overdue" : "");
  // Bereichsfarbe als Akzent am linken Rand — außer bei "überfällig", das hat Vorrang (rot).
  if (!isOverdue && areaColorById[task.area_id]) li.style.borderLeftColor = areaColorById[task.area_id];

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
  checkbox.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await updateTask(task.id, { status: toggleTaskDoneStatus(task) });
      onChange();
    });
  });

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;

  li.append(dot, checkbox, title);

  if (isOverdue) {
    const badge = document.createElement("span");
    badge.className = "badge badge-overdue";
    badge.textContent = "Überfällig";
    li.appendChild(badge);
  }

  return li;
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

function isTaskStale(task) {
  if (task.status === "done") return false;
  const ageMs = Date.now() - new Date(task.created_at).getTime();
  return ageMs > 14 * 24 * 60 * 60 * 1000;
}

// Heute-Schnellerfassung: Titel + optional Bereich + optional Aufwand, aufklappbar bei Fokus.
function wireQuickCapture(areas, onAdded) {
  const form = document.getElementById("brainstorm-form");
  const input = document.getElementById("brainstorm-input");
  const options = document.getElementById("brainstorm-options");
  const areaSelect = document.getElementById("brainstorm-area");
  const effortGroup = document.getElementById("brainstorm-effort");

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

  input.addEventListener("focus", () => {
    options.hidden = false;
  });

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
        isBrainstorm: !areaId,
        plannedDate: todayISO(),
        status: "planned",
      });
      const areaName = areaId ? areas.find((a) => a.id === areaId)?.name : null;
      showToast(areaName ? `„${title}" zu ${areaName} hinzugefügt.` : `„${title}" hinzugefügt.`);
      input.value = "";
      areaSelect.value = "";
      selectedEffort = null;
      effortGroup.querySelectorAll(".effort-chip").forEach((c) => (c.dataset.active = "false"));
      options.hidden = true;
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
  overviewState.renamingId = null;
  overviewState.movingNodeId = null;
  overviewState.selectedBrainstormIds.clear();

  await loadOverviewData();
  renderPinnedTasks();
  renderAreaTree();
  renderNoAreaSection();
  wireOverviewFilters();
  wireNewTaskForm();
}

async function loadOverviewData() {
  const [areas, tasks] = await Promise.all([listAreas(), listTasks()]);
  overviewState.areas = areas;
  overviewState.tasks = tasks;
}

async function reloadOverview() {
  await loadOverviewData();
  renderPinnedTasks();
  renderAreaTree();
  renderNoAreaSection();
  populateNewTaskAreaOptions();
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

// Baut aus einem Aufgabenbaum (siehe buildTaskTree) einen auf sichtbare Knoten zugeschnittenen
// Baum: ein Knoten bleibt, wenn er selbst die Filter besteht ODER mindestens ein Nachfahre es tut —
// sonst würde z.B. eine passende Unteraufgabe verschwinden, nur weil ihr Elternteil nicht matcht.
function filterVisibleNodes(nodes) {
  const out = [];
  for (const node of nodes) {
    const children = filterVisibleNodes(node.children);
    if (taskPassesFilter(node) || children.length > 0) out.push({ ...node, children });
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
    root.appendChild(buildEmptyState("Noch keine Bereiche", `Leg welche unter „Bereiche" an.`));
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
  const tree = filterVisibleNodes(buildTaskTree(allAreaTasks, null));

  if (hasSearch && tree.length === 0 && !isAddingHere) return null;

  const section = document.createElement("section");
  section.className = "area-section";
  section.id = "area-sec-" + area.id;
  section.style.borderLeftColor = area.color;
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
  const isAddingHere = overviewState.addFormTarget && overviewState.addFormTarget.parentTaskId === node.id;
  const isMovingHere = overviewState.movingNodeId === node.id;
  const hasSearch = !!overviewState.filters.search;
  const collapsed = overviewState.collapsedNodes.has(node.id) && !isAddingHere && !isMovingHere && !hasSearch;

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
      if (node.status === "done") await reopenTaskCascade(node, overviewState.tasks);
      else await completeTaskCascade(node, overviewState.tasks);
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
    overdueBadge.textContent = "Überfällig";
    header.appendChild(overdueBadge);
  }

  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "icon-btn tree-node-menu";
  menuBtn.textContent = "⋯";
  menuBtn.setAttribute("aria-label", "Aktionen");
  header.appendChild(menuBtn);
  wrap.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "tree-node-actions";
  actions.hidden = true;
  actions.append(
    actionButton("Umbenennen", () => {
      overviewState.renamingId = node.id;
      renderAreaTree();
    }),
    actionButton("Unteraufgabe hinzufügen", () => {
      overviewState.addFormTarget = { areaId: area.id, parentTaskId: node.id };
      overviewState.collapsedNodes.delete(node.id);
      renderAreaTree();
    }),
    actionButton("Verschieben", () => {
      overviewState.movingNodeId = node.id;
      overviewState.collapsedNodes.delete(node.id);
      renderAreaTree();
    }),
    actionButton(node.is_pinned ? "Anheften entfernen" : "Anheften", async () => {
      await withErrorToast(async () => {
        await updateTask(node.id, { is_pinned: !node.is_pinned });
        reloadOverview();
      });
    }),
    actionButton(
      "Löschen",
      async () => {
        await withErrorToast(async () => {
          await deleteTaskWithUndo(node, overviewState.tasks, reloadOverview);
        });
      },
      "danger"
    )
  );
  menuBtn.addEventListener("click", () => {
    actions.hidden = !actions.hidden;
  });
  wrap.appendChild(actions);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "accordion-wrap";
  bodyWrap.dataset.collapsed = String(collapsed);

  const body = document.createElement("div");
  body.className = "tree-node-body";

  if (isAddingHere) body.appendChild(buildInlineAddForm(area.id, node.id));
  if (isMovingHere) body.appendChild(buildMovePanel(node));

  node.children.forEach((child) => body.appendChild(buildTaskNodeEl(child, area, depth + 1)));

  bodyWrap.appendChild(body);
  wrap.appendChild(bodyWrap);
  return wrap;
}

// Zeigt den Aufgabentitel als Text an. Ein Klick auf den Titel (ausserhalb des
// Umbenennen-Modus) oeffnet die Aufgaben-Detailansicht.
function buildTaskNameEl(node) {
  if (overviewState.renamingId === node.id) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "input tree-node-rename-input";
    input.value = node.title;
    input.dataset.original = node.title;
    let settled = false;
    const commit = async () => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      overviewState.renamingId = null;
      if (value && value !== node.title) {
        await withErrorToast(async () => {
          await updateTask(node.id, { title: value });
          reloadOverview();
        });
      } else {
        renderAreaTree();
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        settled = true;
        overviewState.renamingId = null;
        renderAreaTree();
      }
    });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return input;
  }
  const name = document.createElement("span");
  name.className = "tree-node-name task-title-btn";
  if (node.is_pinned) name.append(buildPinIcon(), " ");
  name.append(node.title);
  name.addEventListener("click", () => openTaskDetail(node));
  return name;
}

function actionButton(label, onClick, variant) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "action-btn" + (variant === "danger" ? " action-btn-danger" : "");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
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

  requestAnimationFrame(() => nameInput.focus());
  return form;
}

// Inline-Panel zum Verschieben einer Aufgabe in einen anderen Bereich/unter eine andere
// uebergeordnete Aufgabe. Schliesst die Aufgabe selbst und alle ihre Nachfahren aus der
// Zielauswahl aus, damit kein Zyklus entstehen kann (eine Aufgabe kann nicht unter sich
// selbst verschoben werden).
function buildMovePanel(node) {
  const excludeIds = collectDescendantIds(overviewState.tasks, node.id);
  excludeIds.add(node.id);

  const form = document.createElement("form");
  form.className = "inline-add-form";

  const areaSelect = document.createElement("select");
  areaSelect.className = "select";
  areaSelect.setAttribute("aria-label", "Ziel-Bereich");
  areaSelect.innerHTML = overviewState.areas
    .map((a) => `<option value="${a.id}"${a.id === node.area_id ? " selected" : ""}>${escapeHtml(a.name)}</option>`)
    .join("");

  const parentSelect = document.createElement("select");
  parentSelect.className = "select";
  parentSelect.setAttribute("aria-label", "Ziel-Aufgabe");

  const refreshParentOptions = () => {
    parentSelect.innerHTML =
      `<option value="">Keine uebergeordnete Aufgabe</option>` +
      taskOptionsHtml(overviewState.tasks, areaSelect.value, null, excludeIds);
  };
  refreshParentOptions();
  areaSelect.addEventListener("change", refreshParentOptions);

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn";
  submitBtn.textContent = "Verschieben";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Abbrechen";
  cancelBtn.addEventListener("click", () => {
    overviewState.movingNodeId = null;
    renderAreaTree();
  });

  form.append(areaSelect, parentSelect, submitBtn, cancelBtn);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newAreaId = areaSelect.value;
    const newParentId = parentSelect.value || null;
    await withErrorToast(async () => {
      await updateTask(node.id, { area_id: newAreaId, parent_task_id: newParentId });
      overviewState.movingNodeId = null;
      overviewState.collapsedAreas.delete(newAreaId);
      if (newParentId) overviewState.collapsedNodes.delete(newParentId);
      reloadOverview();
    });
  });

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
        await updateTask(task.id, { area_id: areaSelect.value || null, is_brainstorm: false });
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
      await Promise.all(selectedIds.map((id) => updateTask(id, { area_id: areaId, is_brainstorm: false })));
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
    if (!confirm(`${selectedIds.length} Aufgabe(n) löschen?`)) return;
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

// ----- Neue Aufgabe -----

function populateNewTaskAreaOptions() {
  const areaSelect = document.getElementById("new-task-area");
  if (!areaSelect) return;
  const previous = areaSelect.value;
  areaSelect.innerHTML =
    `<option value="">Bereich wählen</option>` +
    overviewState.areas.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  if (previous && overviewState.areas.some((a) => a.id === previous)) areaSelect.value = previous;
  refreshNewTaskParentOptions();
}

function refreshNewTaskParentOptions() {
  const areaSelect = document.getElementById("new-task-area");
  const parentSelect = document.getElementById("new-task-parent");
  if (!areaSelect || !parentSelect) return;
  parentSelect.innerHTML =
    `<option value="">Keine uebergeordnete Aufgabe</option>` +
    taskOptionsHtml(overviewState.tasks, areaSelect.value || null, null);
}

function wireNewTaskForm() {
  const form = document.getElementById("new-task-form");
  const titleInput = document.getElementById("new-task-title");
  const areaSelect = document.getElementById("new-task-area");
  const parentSelect = document.getElementById("new-task-parent");
  const effortSelect = document.getElementById("new-task-effort");
  const dateChips = wireDateChipGroup(document.getElementById("new-task-date-chips"));

  populateNewTaskAreaOptions();
  areaSelect.addEventListener("change", refreshNewTaskParentOptions);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    const plannedDate = dateChips.getPlannedDate();
    await withErrorToast(async () => {
      await createTask({
        title,
        areaId: areaSelect.value || null,
        parentTaskId: parentSelect.value || null,
        effort: effortSelect.value ? Number(effortSelect.value) : null,
        isBrainstorm: !areaSelect.value,
        plannedDate,
        status: plannedDate ? "planned" : "open",
      });
      showToast(`„${title}" angelegt.`);
      titleInput.value = "";
      areaSelect.value = "";
      effortSelect.value = "";
      dateChips.reset();
      refreshNewTaskParentOptions();
      reloadOverview();
    });
  });
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

async function renderTaskDetailCard(taskId, close) {
  const allTasks = await listTasks();
  const task = allTasks.find((t) => t.id === taskId);
  const card = document.getElementById("modal-card");
  if (!task || !card) {
    close();
    return;
  }

  const excludeIds = collectDescendantIds(allTasks, task.id);
  excludeIds.add(task.id);
  const parentTask = task.parent_task_id ? allTasks.find((t) => t.id === task.parent_task_id) : null;
  const children = allTasks.filter((t) => t.parent_task_id === task.id);
  const doneChildren = children.filter((t) => t.status === "done").length;

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
  const childrenHtml = children
    .map(
      (c) => `
        <li class="task-item${c.status === "done" ? " is-done" : ""}" data-child-id="${c.id}">
          <button type="button" class="task-checkbox" data-checked="${c.status === "done"}" data-action="toggle" aria-pressed="${c.status === "done"}" aria-label="${escapeHtml(c.title)}">${c.status === "done" ? "✓" : ""}</button>
          <button type="button" class="task-title task-title-btn" data-action="open">${escapeHtml(c.title)}</button>
        </li>`
    )
    .join("");

  card.innerHTML = `
    ${parentTask ? `<button type="button" class="task-title-btn" id="td-back">← Zurück zu „${escapeHtml(parentTask.title)}"</button>` : ""}
    <h2>Aufgabe</h2>
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
      <label class="modal-label">Status
        <select class="select" id="td-status">${statusOpts}</select>
      </label>
    </div>
    <label class="modal-label">Plandatum${isTaskOverdue(task) ? ` <span class="badge badge-overdue">Überfällig</span>` : ""}
      <div class="date-chips" id="td-date-chips" role="group" aria-label="Plandatum">
        <button type="button" class="date-chip" data-date="today">Heute</button>
        <button type="button" class="date-chip" data-date="tomorrow">Morgen</button>
        <button type="button" class="date-chip" data-date="" data-active="true">Kein Datum</button>
        <button type="button" class="date-chip" data-date="custom">Datum…</button>
        <input type="date" class="input date-chip-custom-input" aria-label="Eigenes Datum" hidden />
      </div>
    </label>

    <div class="modal-subtasks">
      <div class="tree-subheading">Unteraufgaben${children.length ? ` (${doneChildren}/${children.length} erledigt)` : ""}</div>
      <ul class="task-list" id="td-subtask-list">${childrenHtml}</ul>
      <form class="inline-add-form" id="td-subtask-form">
        <input class="input" id="td-subtask-title" placeholder="Unteraufgabe hinzufuegen" autocomplete="off" required />
        <div class="date-chips" id="td-subtask-date-chips" role="group" aria-label="Datum">
          <button type="button" class="date-chip" data-date="today">Heute</button>
          <button type="button" class="date-chip" data-date="tomorrow">Morgen</button>
          <button type="button" class="date-chip" data-date="" data-active="true">Kein Datum</button>
          <button type="button" class="date-chip" data-date="custom">Datum…</button>
          <input type="date" class="input date-chip-custom-input" aria-label="Eigenes Datum" hidden />
        </div>
        <button class="btn" type="submit">Hinzufügen</button>
      </form>
    </div>

    <div class="modal-actions">
      <button class="btn" id="td-save" type="button">Speichern</button>
      <button class="btn btn-secondary" id="td-cancel" type="button">Abbrechen</button>
      <button class="icon-btn icon-btn-danger" id="td-delete" type="button" aria-label="Aufgabe löschen">×</button>
    </div>`;

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
  document.getElementById("td-cancel").addEventListener("click", close);

  const dateChips = wireDateChipGroup(document.getElementById("td-date-chips"));
  dateChips.setValue(task.planned_date);

  if (parentTask) {
    document.getElementById("td-back").addEventListener("click", () => renderTaskDetailCard(parentTask.id, close));
  }

  document.getElementById("td-save").addEventListener("click", async () => {
    const areaId = areaSel.value || null;
    const effortVal = document.getElementById("td-effort").value;
    const newStatus = document.getElementById("td-status").value;
    const wasDone = task.status === "done";
    const willBeDone = newStatus === "done";
    await withErrorToast(async () => {
      if (!wasDone && willBeDone) await completeTaskCascade(task, allTasks);
      else if (wasDone && !willBeDone) await reopenTaskCascade(task, allTasks);
      await updateTask(task.id, {
        title: document.getElementById("td-title").value.trim() || task.title,
        area_id: areaId,
        parent_task_id: parentSel.value || null,
        effort: effortVal ? Number(effortVal) : null,
        status: newStatus,
        planned_date: dateChips.getPlannedDate(),
        is_brainstorm: !areaId,
      });
      close();
      reloadOverview();
    });
  });
  document.getElementById("td-delete").addEventListener("click", async () => {
    await withErrorToast(async () => {
      close();
      await deleteTaskWithUndo(task, allTasks, reloadOverview);
    });
  });

  const subtaskDateChips = wireDateChipGroup(document.getElementById("td-subtask-date-chips"));
  document.getElementById("td-subtask-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const subtaskTitleInput = document.getElementById("td-subtask-title");
    const title = subtaskTitleInput.value.trim();
    if (!title) return;
    const plannedDate = subtaskDateChips.getPlannedDate();
    await withErrorToast(async () => {
      await createTask({
        title,
        areaId: task.area_id,
        parentTaskId: task.id,
        plannedDate,
        status: plannedDate ? "planned" : "open",
      });
      await renderTaskDetailCard(task.id, close);
    });
  });

  document.getElementById("td-subtask-list").addEventListener("click", async (e) => {
    const li = e.target.closest("[data-child-id]");
    if (!li) return;
    const child = allTasks.find((t) => t.id === li.dataset.childId);
    if (!child) return;
    if (e.target.dataset.action === "toggle") {
      await withErrorToast(async () => {
        if (child.status === "done") await reopenTaskCascade(child, allTasks);
        else await completeTaskCascade(child, allTasks);
        await renderTaskDetailCard(task.id, close);
      });
    } else if (e.target.dataset.action === "open") {
      await renderTaskDetailCard(child.id, close);
    }
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

async function renderPlanView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/plan.html");
  container.innerHTML = await res.text();
  showLoading("suggested-task-list");

  planState.targetDate = tomorrowISO();
  const dateInput = document.getElementById("plan-date-input");
  dateInput.value = planState.targetDate;
  updatePlanDateLabel();

  document.getElementById("plan-date-today").addEventListener("click", () => {
    planState.targetDate = todayISO();
    dateInput.value = planState.targetDate;
    updatePlanDateLabel();
  });
  document.getElementById("plan-date-tomorrow").addEventListener("click", () => {
    planState.targetDate = tomorrowISO();
    dateInput.value = planState.targetDate;
    updatePlanDateLabel();
  });
  dateInput.addEventListener("change", () => {
    if (!dateInput.value) return;
    planState.targetDate = dateInput.value;
    updatePlanDateLabel();
  });

  const [areas, pool] = await Promise.all([listAreas(), listTasks({ status: "open" })]);
  planState.areas = areas;
  planState.pool = pool;
  planState.selected = suggestTasksForPlan(pool);

  renderPlanTaskList();
  renderAddTaskSelect();

  document.getElementById("refresh-suggestion").addEventListener("click", () => {
    planState.selected = suggestTasksForPlan(planState.pool);
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
      await Promise.all(ids.map((id) => updateTask(id, { status: "planned", planned_date: targetDate })));
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
}

function renderPlanTaskList() {
  const list = document.getElementById("suggested-task-list");
  const emptyState = document.getElementById("suggested-empty-state");
  const areaColorById = Object.fromEntries(planState.areas.map((a) => [a.id, a.color]));

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
  const li = document.createElement("li");
  li.className = "task-item";
  if (areaColorById[task.area_id]) li.style.borderLeftColor = areaColorById[task.area_id];

  const dot = document.createElement("span");
  dot.className = "task-area-dot";
  dot.style.background = areaColorById[task.area_id] || "var(--color-text-subtle)";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title + (task.effort ? ` · ${task.effort} min` : "");

  li.append(dot, title);

  if (task.is_brainstorm) {
    const badge = document.createElement("span");
    badge.className = "badge badge-brainstorm";
    badge.textContent = "Ohne Bereich";
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

/* ---------- Bereiche (Verwaltung) ---------- */

async function renderAreasView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/areas.html");
  container.innerHTML = await res.text();
  showLoading("area-manage-list");

  await renderAreaManageList();
  wireNewAreaForm();
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

  const color = document.createElement("input");
  color.type = "color";
  color.className = "color-input";
  color.value = area.color || "#888888";
  color.setAttribute("aria-label", "Farbe von " + area.name);
  color.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateArea(area.id, { color: color.value });
      renderAreaManageList();
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
      renderAreaManageList();
    } catch (err) {
      name.value = area.name;
      alert("Umbenennen fehlgeschlagen: " + friendlyErrorMessage(err));
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
      renderAreaManageList();
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
      renderAreaManageList();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Bereich löschen");
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Bereich „${area.name}" löschen? Zugeordnete Aufgaben bleiben erhalten, verlieren aber ihren Bereich.`)) return;
    await withErrorToast(async () => {
      await deleteArea(area.id);
      renderAreaManageList();
    });
  });

  controls.append(upBtn, downBtn, deleteBtn);
  li.append(color, colorWarning, name, controls);
  return li;
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
      renderAreaManageList();
    } catch (err) {
      alert("Anlegen fehlgeschlagen: " + friendlyErrorMessage(err));
    }
  });
}

init();
