import { getSession, onAuthStateChange, signInWithMagicLink, ensureAreasSeeded } from "./auth.js";
import { listTasks, updateTask, createTask, deleteTask } from "./tasks.js";
import { listAreas, createArea, updateArea, deleteArea, swapAreaOrder } from "./areas.js";
import { listProjects, createProject, updateProject, deleteProject, buildProjectTree } from "./projects.js";
import { suggestTasksForPlan, formatTasksForExport, savePlanForDate } from "./planner.js";

const app = document.getElementById("app");

const routes = {
  today: renderTodayView,
  overview: renderOverviewView,
  plan: renderPlanView,
  areas: renderAreasView,
};

const overviewState = {
  areas: [],
  projects: [],
  tasks: [],
  filters: { effort: "", status: "" },
  showDone: false,
  collapsedAreas: new Set(),
  collapsedNodes: new Set(),
  addFormTarget: null, // { areaId, parentProjectId } | null — nur ein offenes Anlegen-Formular gleichzeitig
  renamingId: null, // Projekt-ID, die gerade inline umbenannt wird, oder null
};

const planState = {
  areas: [],
  pool: [],
  selected: [],
  targetDate: null,
};

let toastTimeout = null;
function showToast(message, isError = false) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.className = "toast" + (isError ? " toast-error" : "");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

// Führt eine mutierende Aktion aus und zeigt bei Fehlern einen Toast statt still zu scheitern.
async function withErrorToast(action) {
  try {
    await action();
  } catch (err) {
    showToast(err.message || "Etwas ist schiefgelaufen.", true);
  }
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

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  return routes[hash] ? hash : "today";
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

// Baut eingerückte <option>-Elemente für den Projektbaum eines Bereichs.
function projectOptionsHtml(projects, areaId, selectedId) {
  if (!areaId) return "";
  const tree = buildProjectTree(projects, areaId);
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const prefix = "  ".repeat(depth);
      const badge = n.is_project ? "📌 " : "";
      out.push(
        `<option value="${n.id}"${n.id === selectedId ? " selected" : ""}>${prefix}${badge}${escapeHtml(n.name)}</option>`
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
      status.textContent = `Fehler: ${err.message}`;
    }
  });
}

function renderShell() {
  const route = currentRoute();
  // Offenes Detail-Modal schließen — es liegt außerhalb von #app und würde sonst
  // beim Ansichtswechsel über der neuen Ansicht hängen bleiben.
  const modalRoot = document.getElementById("modal-root");
  if (modalRoot) modalRoot.innerHTML = "";
  app.innerHTML = `
    <nav class="app-nav">
      <a href="#/today" class="nav-link${route === "today" ? " is-active" : ""}">Heute</a>
      <a href="#/overview" class="nav-link${route === "overview" ? " is-active" : ""}">Übersicht</a>
      <a href="#/plan" class="nav-link${route === "plan" ? " is-active" : ""}">Plan</a>
      <a href="#/areas" class="nav-link${route === "areas" ? " is-active" : ""}">Bereiche</a>
    </nav>
    <div id="view-content"></div>
  `;
  routes[route]();
}

/* ---------- Today ---------- */

async function renderTodayView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/today.html");
  container.innerHTML = await res.text();

  const [areas, tasks] = await Promise.all([listAreas(), listTasks({ plannedDate: todayISO() })]);
  const areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));

  renderGreeting();
  renderGymIndicator();
  renderTodayTasks(tasks, areaColorById);
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
  if (isGymDay) el.textContent = "💪 Heute ist Gym-Tag";
}

function renderTodayTasks(tasks, areaColorById) {
  const list = document.getElementById("task-list");
  const emptyState = document.getElementById("empty-state");
  const doneCount = tasks.filter((t) => t.status === "done").length;

  document.getElementById("progress-text").textContent = `${doneCount} von ${tasks.length} Aufgaben erledigt`;
  document.getElementById("progress-bar-fill").style.width = tasks.length
    ? `${Math.round((doneCount / tasks.length) * 100)}%`
    : "0%";

  list.innerHTML = "";
  if (tasks.length === 0) {
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
  li.className = "task-item" + (task.status === "done" ? " is-done" : "") + (isStale ? " is-stale" : "");

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
  return li;
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

  // Frisch gerenderte Dropdowns/Checkbox stehen auf "Alle"/aus — Filterzustand dazu passend zurücksetzen.
  overviewState.filters = { effort: "", status: "" };
  overviewState.showDone = false;
  overviewState.addFormTarget = null;
  overviewState.renamingId = null;

  await loadOverviewData();
  renderMarkedProjects();
  renderAreaTree();
  renderNoAreaSection();
  wireOverviewFilters();
  wireNewTaskForm();
}

async function loadOverviewData() {
  const [areas, projects, tasks] = await Promise.all([listAreas(), listProjects(), listTasks()]);
  overviewState.areas = areas;
  overviewState.projects = projects;
  overviewState.tasks = tasks;
}

async function reloadOverview() {
  await loadOverviewData();
  renderMarkedProjects();
  renderAreaTree();
  renderNoAreaSection();
  populateNewTaskAreaOptions();
}

function taskPassesFilter(task) {
  const { effort, status } = overviewState.filters;
  // Erledigte standardmäßig ausblenden, außer die Checkbox ist an oder explizit nach "Erledigt" gefiltert wird.
  if (!status && !overviewState.showDone && task.status === "done") return false;
  if (effort && String(task.effort) !== effort) return false;
  if (status && task.status !== status) return false;
  return true;
}

function wireOverviewFilters() {
  const effortSelect = document.getElementById("filter-effort");
  const statusSelect = document.getElementById("filter-status");
  const showDoneCheckbox = document.getElementById("filter-show-done");
  effortSelect.addEventListener("change", () => {
    overviewState.filters.effort = effortSelect.value;
    renderAreaTree();
    renderNoAreaSection();
  });
  statusSelect.addEventListener("change", () => {
    overviewState.filters.status = statusSelect.value;
    renderAreaTree();
    renderNoAreaSection();
  });
  showDoneCheckbox.addEventListener("change", () => {
    overviewState.showDone = showDoneCheckbox.checked;
    renderAreaTree();
    renderNoAreaSection();
  });
}

// ----- Markierte Projekte (schnell auffindbar) -----

function renderMarkedProjects() {
  const panel = document.getElementById("marked-projects-panel");
  const list = document.getElementById("marked-project-list");
  const marked = overviewState.projects.filter((p) => p.is_project);
  if (marked.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const areaName = Object.fromEntries(overviewState.areas.map((a) => [a.id, a.name]));
  list.innerHTML = "";

  for (const p of marked) {
    const count = overviewState.tasks.filter((t) => t.project_id === p.id).length;
    const li = document.createElement("li");
    li.className = "project-item project-item-clickable";

    const name = document.createElement("span");
    name.textContent = "📌 " + p.name;

    const meta = document.createElement("span");
    meta.className = "count";
    meta.textContent = `${areaName[p.area_id] || ""} · ${count}`;

    li.append(name, meta);
    li.addEventListener("click", () => {
      overviewState.collapsedAreas.delete(p.area_id);
      renderAreaTree();
      const el = document.getElementById("area-sec-" + p.area_id);
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
    root.innerHTML = `<p class="empty-state">Noch keine Bereiche. Lege welche unter „Bereiche" an.</p>`;
    return;
  }
  for (const area of overviewState.areas) {
    root.appendChild(buildAreaSection(area));
  }
}

function buildAreaSection(area) {
  const section = document.createElement("section");
  section.className = "area-section";
  section.id = "area-sec-" + area.id;
  const isAddingHere =
    overviewState.addFormTarget &&
    overviewState.addFormTarget.areaId === area.id &&
    overviewState.addFormTarget.parentProjectId === null;
  const collapsed = overviewState.collapsedAreas.has(area.id) && !isAddingHere;

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
  addBtn.setAttribute("aria-label", "Ordner oder Projekt hinzufügen");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    overviewState.addFormTarget = isAddingHere ? null : { areaId: area.id, parentProjectId: null };
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

  if (!collapsed) {
    const body = document.createElement("div");
    body.className = "area-section-body";

    if (isAddingHere) body.appendChild(buildInlineAddForm(area.id, null));

    const loose = overviewState.tasks.filter((t) => t.area_id === area.id && !t.project_id && taskPassesFilter(t));
    if (loose.length) {
      const sub = document.createElement("div");
      sub.className = "tree-subheading";
      sub.textContent = "Kleine Aufgaben";
      body.appendChild(sub);
      const ul = document.createElement("ul");
      ul.className = "task-list tree-task-list";
      loose.forEach((t) => ul.appendChild(buildOverviewTaskRow(t)));
      body.appendChild(ul);
    }

    const tree = buildProjectTree(overviewState.projects, area.id);
    tree.forEach((node) => body.appendChild(buildProjectNodeEl(node, area)));

    if (!isAddingHere && !loose.length && tree.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Noch nichts in diesem Bereich.";
      body.appendChild(empty);
    }

    section.appendChild(body);
  }
  return section;
}

function buildProjectNodeEl(node, area) {
  const wrap = document.createElement("div");
  wrap.className = "tree-node";
  const isAddingHere =
    overviewState.addFormTarget && overviewState.addFormTarget.parentProjectId === node.id;
  const collapsed = overviewState.collapsedNodes.has(node.id) && !isAddingHere;

  const header = document.createElement("div");
  header.className = "tree-node-header";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  toggle.textContent = collapsed ? "▸" : "▾";
  toggle.addEventListener("click", () => {
    if (overviewState.collapsedNodes.has(node.id)) overviewState.collapsedNodes.delete(node.id);
    else overviewState.collapsedNodes.add(node.id);
    renderAreaTree();
  });

  header.append(toggle, buildNodeNameEl(node));

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
    actionButton("Unterordner", () => {
      overviewState.addFormTarget = { areaId: area.id, parentProjectId: node.id };
      overviewState.collapsedNodes.delete(node.id);
      renderAreaTree();
    }),
    actionButton(node.is_project ? "Projekt-Markierung entfernen" : "Als Projekt markieren", async () => {
      await withErrorToast(async () => {
        await updateProject(node.id, { is_project: !node.is_project });
        reloadOverview();
      });
    }),
    actionButton(
      "Löschen",
      async () => {
        if (!confirm(`„${node.name}" löschen? Unterordner werden mitgelöscht, Aufgaben bleiben als Kleine Aufgaben erhalten.`)) return;
        await withErrorToast(async () => {
          await deleteProject(node.id);
          reloadOverview();
        });
      },
      "danger"
    )
  );
  menuBtn.addEventListener("click", () => {
    actions.hidden = !actions.hidden;
  });
  wrap.appendChild(actions);

  if (!collapsed) {
    const body = document.createElement("div");
    body.className = "tree-node-body";

    if (isAddingHere) body.appendChild(buildInlineAddForm(area.id, node.id));

    const nodeTasks = overviewState.tasks.filter((t) => t.project_id === node.id && taskPassesFilter(t));
    if (nodeTasks.length) {
      const ul = document.createElement("ul");
      ul.className = "task-list tree-task-list";
      nodeTasks.forEach((t) => ul.appendChild(buildOverviewTaskRow(t)));
      body.appendChild(ul);
    }
    node.children.forEach((child) => body.appendChild(buildProjectNodeEl(child, area)));
    wrap.appendChild(body);
  }
  return wrap;
}

// Zeigt den Knotennamen als Text — oder, während overviewState.renamingId === node.id,
// als autofokussiertes Textfeld (Enter/Blur übernimmt, Escape bricht ab).
function buildNodeNameEl(node) {
  if (overviewState.renamingId === node.id) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "input tree-node-rename-input";
    input.value = node.name;
    let settled = false;
    const commit = async () => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      overviewState.renamingId = null;
      if (value && value !== node.name) {
        await withErrorToast(async () => {
          await updateProject(node.id, { name: value });
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
  name.className = "tree-node-name";
  name.textContent = (node.is_project ? "📌 " : "📁 ") + node.name;
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

// Inline-Formular zum Anlegen eines Ordners/Projekts — ersetzt den früheren prompt()/confirm()-Flow.
function buildInlineAddForm(areaId, parentProjectId) {
  const form = document.createElement("form");
  form.className = "inline-add-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "input";
  nameInput.placeholder = "Name";
  nameInput.autocomplete = "off";
  nameInput.required = true;

  const checkboxLabel = document.createElement("label");
  checkboxLabel.className = "checkbox-label";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkboxLabel.append(checkbox, document.createTextNode("Als Projekt markieren"));

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

  form.append(nameInput, checkboxLabel, submitBtn, cancelBtn);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    await withErrorToast(async () => {
      await createProject({ areaId, parentProjectId, name, isProject: checkbox.checked });
      overviewState.addFormTarget = null;
      overviewState.collapsedAreas.delete(areaId);
      if (parentProjectId) overviewState.collapsedNodes.delete(parentProjectId);
      reloadOverview();
    });
  });

  requestAnimationFrame(() => nameInput.focus());
  return form;
}

function buildOverviewTaskRow(task) {
  const li = document.createElement("li");
  const isStale = isTaskStale(task);
  li.className = "task-item" + (task.status === "done" ? " is-done" : "") + (isStale ? " is-stale" : "");

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
      await updateTask(task.id, { status: toggleTaskDoneStatus(task) });
      reloadOverview();
    });
  });

  const title = document.createElement("button");
  title.type = "button";
  title.className = "task-title task-title-btn";
  title.textContent = task.title + (task.effort ? ` · ${task.effort}m` : "");
  title.addEventListener("click", () => openTaskDetail(task));

  li.append(checkbox, title);
  return li;
}

// ----- Ohne Bereich (Brainstorm / lose Aufgaben) -----

function renderNoAreaSection() {
  const panel = document.getElementById("no-area-panel");
  const list = document.getElementById("brainstorm-list");
  const noArea = overviewState.tasks.filter((t) => !t.area_id && taskPassesFilter(t));
  if (noArea.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  list.innerHTML = "";

  for (const task of noArea) {
    const li = document.createElement("li");
    li.className = "brainstorm-item";

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

    li.append(title, areaSelect);
    list.appendChild(li);
  }
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
  refreshNewTaskProjectOptions();
}

function refreshNewTaskProjectOptions() {
  const areaSelect = document.getElementById("new-task-area");
  const projectSelect = document.getElementById("new-task-project");
  if (!areaSelect || !projectSelect) return;
  projectSelect.innerHTML =
    `<option value="">Kein Projekt</option>` + projectOptionsHtml(overviewState.projects, areaSelect.value || null, null);
}

function wireNewTaskForm() {
  const form = document.getElementById("new-task-form");
  const titleInput = document.getElementById("new-task-title");
  const areaSelect = document.getElementById("new-task-area");
  const projectSelect = document.getElementById("new-task-project");
  const effortSelect = document.getElementById("new-task-effort");

  populateNewTaskAreaOptions();
  areaSelect.addEventListener("change", refreshNewTaskProjectOptions);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    await withErrorToast(async () => {
      await createTask({
        title,
        areaId: areaSelect.value || null,
        projectId: projectSelect.value || null,
        effort: effortSelect.value ? Number(effortSelect.value) : null,
        isBrainstorm: !areaSelect.value,
      });
      showToast(`„${title}" angelegt.`);
      titleInput.value = "";
      areaSelect.value = "";
      effortSelect.value = "";
      refreshNewTaskProjectOptions();
      reloadOverview();
    });
  });
}

// ----- Aufgaben-Detail (Modal) -----

function openTaskDetail(task) {
  const root = document.getElementById("modal-root");
  const areaOpts =
    `<option value="">Kein Bereich</option>` +
    overviewState.areas
      .map((a) => `<option value="${a.id}"${a.id === task.area_id ? " selected" : ""}>${escapeHtml(a.name)}</option>`)
      .join("");
  const projOpts = `<option value="">Kein Projekt</option>` + projectOptionsHtml(overviewState.projects, task.area_id, task.project_id);
  const effortOpts = [["", "–"], ["5", "5"], ["10", "10"], ["30", "30"], ["60", "60"]]
    .map(([v, l]) => `<option value="${v}"${String(task.effort || "") === v ? " selected" : ""}>${l}</option>`)
    .join("");
  const statusOpts = [["open", "Offen"], ["planned", "Geplant"], ["done", "Erledigt"]]
    .map(([v, l]) => `<option value="${v}"${task.status === v ? " selected" : ""}>${l}</option>`)
    .join("");

  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Aufgabe bearbeiten">
        <h2>Aufgabe</h2>
        <label class="modal-label">Titel
          <input class="input" id="td-title" type="text" value="${escapeHtml(task.title)}" />
        </label>
        <label class="modal-label">Bereich
          <select class="select" id="td-area">${areaOpts}</select>
        </label>
        <label class="modal-label">Projekt / Ordner
          <select class="select" id="td-project">${projOpts}</select>
        </label>
        <div class="modal-row">
          <label class="modal-label">Aufwand
            <select class="select" id="td-effort">${effortOpts}</select>
          </label>
          <label class="modal-label">Status
            <select class="select" id="td-status">${statusOpts}</select>
          </label>
        </div>
        <label class="modal-label">Plandatum
          <input class="input" id="td-date" type="date" value="${task.planned_date || ""}" />
        </label>
        <div class="modal-actions">
          <button class="btn" id="td-save" type="button">Speichern</button>
          <button class="btn btn-secondary" id="td-cancel" type="button">Abbrechen</button>
          <button class="icon-btn icon-btn-danger" id="td-delete" type="button" aria-label="Aufgabe löschen">×</button>
        </div>
      </div>
    </div>`;

  const areaSel = document.getElementById("td-area");
  const projSel = document.getElementById("td-project");
  areaSel.addEventListener("change", () => {
    projSel.innerHTML =
      `<option value="">Kein Projekt</option>` + projectOptionsHtml(overviewState.projects, areaSel.value || null, null);
  });

  const close = () => {
    root.innerHTML = "";
  };
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") close();
  });
  document.getElementById("td-cancel").addEventListener("click", close);
  document.getElementById("td-save").addEventListener("click", async () => {
    const areaId = areaSel.value || null;
    const effortVal = document.getElementById("td-effort").value;
    await withErrorToast(async () => {
      await updateTask(task.id, {
        title: document.getElementById("td-title").value.trim() || task.title,
        area_id: areaId,
        project_id: projSel.value || null,
        effort: effortVal ? Number(effortVal) : null,
        status: document.getElementById("td-status").value,
        planned_date: document.getElementById("td-date").value || null,
        is_brainstorm: !areaId,
      });
      close();
      reloadOverview();
    });
  });
  document.getElementById("td-delete").addEventListener("click", async () => {
    if (!confirm("Aufgabe löschen?")) return;
    await withErrorToast(async () => {
      await deleteTask(task.id);
      close();
      reloadOverview();
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

async function renderPlanView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/plan.html");
  container.innerHTML = await res.text();

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
      status.textContent = `Fehler: ${err.message}`;
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

  const dot = document.createElement("span");
  dot.className = "task-area-dot";
  dot.style.background = areaColorById[task.area_id] || "var(--color-text-subtle)";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title + (task.effort ? ` · ${task.effort} min` : "");

  li.append(dot, title);

  if (task.is_brainstorm && !task.project_id) {
    const badge = document.createElement("span");
    badge.className = "badge badge-brainstorm";
    badge.textContent = "Kein Projekt";
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
      alert("Umbenennen fehlgeschlagen: " + err.message);
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
    if (!confirm(`Bereich „${area.name}" löschen? Zugeordnete Projekte werden mitgelöscht.`)) return;
    await withErrorToast(async () => {
      await deleteArea(area.id);
      renderAreaManageList();
    });
  });

  controls.append(upBtn, downBtn, deleteBtn);
  li.append(color, name, controls);
  return li;
}

function wireNewAreaForm() {
  const form = document.getElementById("new-area-form");
  const nameInput = document.getElementById("new-area-name");
  const colorInput = document.getElementById("new-area-color");

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
      alert("Anlegen fehlgeschlagen: " + err.message);
    }
  });
}

init();
