// Ansicht "Heute" (#/today) inkl. Begrüßung, Einstellungen, Geburtstage, Quick Win und Schnellerfassung.
import { updateUsername } from "../auth.js";
import { listTasks, updateTask, createTask, buildTaskTree, completeTaskCascade, reopenTaskCascade } from "../tasks.js";
import { listAreas } from "../areas.js";
import { createThought } from "../thoughts.js";
import { listWishlistItems, getSavingsPotBalance } from "../wishlist.js";
import { isHabitTask, autoplanDueHabits, logHabitSkip } from "../habits.js";
import { isWatchlistTask } from "../watchlist.js";
import {
  listBirthdays,
  createBirthday,
  updateBirthday,
  deleteBirthday,
  daysUntilNextOccurrence,
  nextOccurrence,
} from "../birthdays.js";
import {
  getStoredTheme,
  applyTheme,
  getBackgroundImageBlob,
  saveBackgroundImageBlob,
  clearBackgroundImage,
  resizeImageToBlob,
} from "../personalization.js";
import { todayISO, formatShortDate } from "../ui/dates.js";
import { BADGE_ICON_OVERDUE, escapeHtml } from "../ui/dom.js";
import { showToast, friendlyErrorMessage, showLoading, withErrorToast } from "../ui/modals.js";
import { updateNavBadge } from "../ui/nav.js";
import { openTaskFeedbackSheet, triggerFollowupPopupAfterCompletion } from "../ui/popups.js";
import { state, overviewState, todayViewState } from "../ui/state.js";
import { showCompleteUndoToast } from "../ui/task-actions.js";
import { isTaskOverdue, isTaskDueSoon, compareByPriority, filterTreeNodes } from "../ui/task-helpers.js";
import { promptWatchlistRating } from "./fernsehprogramm.js";
import { renderBuyReadyAlert } from "./finance.js";
import { openTaskDetail } from "./task-detail.js";

/* ---------- Today ---------- */

export async function renderTodayView() {
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
export function renderTodayTaskSection() {
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
export async function refreshTodayTaskList() {
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
