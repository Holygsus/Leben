import { getSession, onAuthStateChange, signInWithMagicLink, ensureAreasSeeded } from "./auth.js";
import { listTasks, updateTask, createTask } from "./tasks.js";
import { listAreas } from "./areas.js";
import { listProjects } from "./projects.js";
import { suggestTasksForPlan, formatTasksForExport, savePlanForDate } from "./planner.js";

const app = document.getElementById("app");

const routes = {
  today: renderTodayView,
  overview: renderOverviewView,
  plan: renderPlanView,
};

const overviewState = {
  areas: [],
  projects: [],
  tasks: [],
  filters: { areaId: null, effort: "", status: "" },
};

const planState = {
  areas: [],
  pool: [],
  selected: [],
};

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
  app.innerHTML = `
    <nav class="app-nav">
      <a href="#/today" class="nav-link${route === "today" ? " is-active" : ""}">Heute</a>
      <a href="#/overview" class="nav-link${route === "overview" ? " is-active" : ""}">Übersicht</a>
      <a href="#/plan" class="nav-link${route === "plan" ? " is-active" : ""}">Plan</a>
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
  wireBrainstormForm("brainstorm-form", "brainstorm-input", renderTodayView);
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
    const nextStatus = task.status === "done" ? "planned" : "done";
    await updateTask(task.id, { status: nextStatus });
    onChange();
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

function wireBrainstormForm(formId, inputId, onAdded) {
  const form = document.getElementById(formId);
  const input = document.getElementById(inputId);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    input.value = "";
    await createTask({ title, isBrainstorm: true });
    onAdded();
  });
}

/* ---------- Overview ---------- */

async function renderOverviewView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/overview.html");
  container.innerHTML = await res.text();

  const [areas, projects, tasks] = await Promise.all([listAreas(), listProjects(), listTasks()]);
  overviewState.areas = areas;
  overviewState.projects = projects;
  overviewState.tasks = tasks;

  renderAreaChips();
  wireOverviewFilters();
  renderOverviewTasks();
  renderProjectsSummary();
  renderBrainstormSection();
  wireNewTaskForm();
  wireBrainstormForm("overview-brainstorm-form", "overview-brainstorm-input", reloadOverviewTasks);
}

async function reloadOverviewTasks() {
  overviewState.tasks = await listTasks();
  renderOverviewTasks();
  renderProjectsSummary();
  renderBrainstormSection();
}

function renderAreaChips() {
  const container = document.getElementById("area-chips");
  container.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "area-chip";
  allChip.dataset.active = String(overviewState.filters.areaId === null);
  allChip.textContent = "Alle";
  allChip.addEventListener("click", () => {
    overviewState.filters.areaId = null;
    renderAreaChips();
    renderOverviewTasks();
  });
  container.appendChild(allChip);

  for (const area of overviewState.areas) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "area-chip";
    chip.style.color = area.color;
    chip.dataset.active = String(overviewState.filters.areaId === area.id);

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = area.color;

    chip.append(dot, document.createTextNode(area.name));
    chip.addEventListener("click", () => {
      overviewState.filters.areaId = overviewState.filters.areaId === area.id ? null : area.id;
      renderAreaChips();
      renderOverviewTasks();
    });
    container.appendChild(chip);
  }
}

function wireOverviewFilters() {
  const effortSelect = document.getElementById("filter-effort");
  const statusSelect = document.getElementById("filter-status");
  effortSelect.addEventListener("change", () => {
    overviewState.filters.effort = effortSelect.value;
    renderOverviewTasks();
  });
  statusSelect.addEventListener("change", () => {
    overviewState.filters.status = statusSelect.value;
    renderOverviewTasks();
  });
}

function renderOverviewTasks() {
  const list = document.getElementById("overview-task-list");
  const emptyState = document.getElementById("overview-empty-state");
  const areaColorById = Object.fromEntries(overviewState.areas.map((a) => [a.id, a.color]));
  const { areaId, effort, status } = overviewState.filters;

  const filtered = overviewState.tasks.filter((task) => {
    if (task.is_brainstorm) return false;
    if (areaId && task.area_id !== areaId) return false;
    if (effort && String(task.effort) !== effort) return false;
    if (status && task.status !== status) return false;
    return true;
  });

  list.innerHTML = "";
  if (filtered.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  for (const task of filtered) {
    list.appendChild(buildTaskItem(task, areaColorById, reloadOverviewTasks));
  }
}

function renderProjectsSummary() {
  const list = document.getElementById("project-list");
  list.innerHTML = "";

  if (overviewState.projects.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Noch keine Projekte angelegt.";
    list.appendChild(empty);
    return;
  }

  for (const project of overviewState.projects) {
    const count = overviewState.tasks.filter((t) => t.project_id === project.id).length;
    const li = document.createElement("li");
    li.className = "project-item";

    const name = document.createElement("span");
    name.textContent = project.name;

    const countEl = document.createElement("span");
    countEl.className = "count";
    countEl.textContent = `${count} Aufgabe${count === 1 ? "" : "n"}`;

    li.append(name, countEl);
    list.appendChild(li);
  }
}

function renderBrainstormSection() {
  const list = document.getElementById("brainstorm-list");
  list.innerHTML = "";
  const brainstormTasks = overviewState.tasks.filter((t) => t.is_brainstorm);

  if (brainstormTasks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Keine Brainstorm-Ideen offen.";
    list.appendChild(empty);
    return;
  }

  for (const task of brainstormTasks) {
    const li = document.createElement("li");
    li.className = "brainstorm-item";

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const projectSelect = document.createElement("select");
    projectSelect.className = "select";
    projectSelect.innerHTML = `<option value="">Projekt zuweisen</option>` +
      overviewState.projects.map((p) => `<option value="${p.id}"${p.id === task.project_id ? " selected" : ""}>${p.name}</option>`).join("");
    projectSelect.addEventListener("change", async () => {
      await updateTask(task.id, { project_id: projectSelect.value || null });
      await reloadOverviewTasks();
    });

    li.append(title, projectSelect);
    list.appendChild(li);
  }
}

function wireNewTaskForm() {
  const form = document.getElementById("new-task-form");
  const titleInput = document.getElementById("new-task-title");
  const areaSelect = document.getElementById("new-task-area");
  const projectSelect = document.getElementById("new-task-project");
  const effortSelect = document.getElementById("new-task-effort");

  areaSelect.innerHTML =
    `<option value="">Bereich wählen</option>` +
    overviewState.areas.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  projectSelect.innerHTML =
    `<option value="">Projekt (optional)</option>` +
    overviewState.projects.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    await createTask({
      title,
      areaId: areaSelect.value || null,
      projectId: projectSelect.value || null,
      effort: effortSelect.value ? Number(effortSelect.value) : null,
    });
    titleInput.value = "";
    areaSelect.value = "";
    projectSelect.value = "";
    effortSelect.value = "";
    await reloadOverviewTasks();
  });
}

/* ---------- Plan ---------- */

async function renderPlanView() {
  const container = document.getElementById("view-content");
  const res = await fetch("views/plan.html");
  container.innerHTML = await res.text();

  const targetDate = tomorrowISO();
  document.getElementById("plan-date").textContent = new Date(targetDate).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
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
    available.map((t) => `<option value="${t.id}">${t.title}</option>`).join("");
}

init();
