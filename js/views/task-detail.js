// Aufgaben-Detail-Modal (aus Heute/Übersicht geöffnet).
import {
  listTasks,
  listTaskWithFamily,
  updateTask,
  createTask,
  collectDescendantIds,
  completeTaskCascade,
  reopenTaskCascade,
  planTaskCascade,
  cascadeAreaChange,
} from "../tasks.js";
import { isHabitTask } from "../habits.js";
import { isWatchlistTask } from "../watchlist.js";
import { listComments, createComment, deleteComment } from "../comments.js";
import { wireDateChipGroup } from "../ui/date-chips.js";
import { formatShortDate } from "../ui/dates.js";
import {
  BADGE_ICON_HABIT,
  BADGE_ICON_OVERDUE,
  escapeHtml,
  buildPinIcon,
  buildEditIcon,
  buildTrashIcon,
  buildDuplicateIcon,
  taskOptionsHtml,
} from "../ui/dom.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { openTaskFeedbackSheet } from "../ui/popups.js";
import { state, overviewState, todayViewState } from "../ui/state.js";
import { deleteTaskWithUndo, showCompleteUndoToast, duplicateTaskTree } from "../ui/task-actions.js";
import { isTaskOverdue } from "../ui/task-helpers.js";
import { reloadOverview } from "./overview.js";
import { renderTodayTaskSection, refreshTodayTaskList } from "./today.js";

// Aktualisiert alle gerade sichtbaren Ansichten nach einer Aufgaben-Änderung im Detail-Modal — das
// Modal kann sowohl von der Übersicht als auch von Heute aus geöffnet worden sein (siehe
// appendTaskRowContent/buildTaskNameEl), daher hier anhand der vorhandenen DOM-Elemente erkennen,
// welche Ansicht gerade aktiv ist, statt fest auf reloadOverview() zu verdrahten (das würde
// crashen, wenn die Übersicht-Elemente gar nicht im DOM sind).
// allTasks (optional): falls der Aufrufer gerade schon die VOLLE Aufgabenliste per listTasks() neu
// geladen hat, wird dieser Stand für Heute direkt übernommen statt ihn erneut zu fetchen.
// renderTaskDetailCard liefert im Ansichtsmodus nur einen Teilbaum und gibt dann undefined zurück.
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

// ----- Aufgaben-Detail (Modal) -----

// Oeffnet das Detail-Modal fuer eine Aufgabe. Die aeussere Modal-Mechanik (Backdrop, Escape,
// Scroll-Sperre) wird hier genau einmal aufgesetzt; Navigation zwischen Aufgabe und ihren
// Unteraufgaben (Reinklicken, Zurueck-Link) rendert danach nur noch den Karteninhalt neu
// (renderTaskDetailCard), damit dabei keine Listener mehrfach registriert werden.
export async function openTaskDetail(task) {
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
  // Die Ansicht braucht nur Aufgabe, Elternteil und Teilbaum (listTaskWithFamily). Der
  // Bearbeiten-Modus bietet dagegen alle Aufgaben des (wählbaren) Bereichs als Elternteil an
  // (taskOptionsHtml) und lädt deshalb weiterhin die volle Liste.
  const [allTasks, comments] = await Promise.all([
    editMode ? listTasks() : listTaskWithFamily(taskId),
    listComments(taskId),
  ]);
  // Nur die volle Liste taugt als neuer Stand für Heute (refreshOpenViewsAfterTaskChange) — ein
  // Teilbaum würde dort alle übrigen Aufgaben verschwinden lassen, dann lädt Heute selbst neu.
  const fullTaskList = editMode ? allTasks : undefined;
  const task = allTasks.find((t) => t.id === taskId);
  const card = document.getElementById("modal-card");
  if (!task || !card) {
    close();
    return fullTaskList;
  }

  const parentTask = task.parent_task_id ? allTasks.find((t) => t.id === task.parent_task_id) : null;
  const children = allTasks.filter((t) => t.parent_task_id === task.id);
  const backButtonHtml = parentTask
    ? `<button type="button" class="task-title-btn" id="td-back">← Zurück zu „${escapeHtml(parentTask.title)}"</button>`
    : "";

  if (editMode) renderTaskDetailEdit(card, task, allTasks, parentTask, children, backButtonHtml, close);
  else renderTaskDetailView(card, task, allTasks, children, comments, backButtonHtml, close);
  // Rückgabe erlaubt refreshOpenViewsAfterTaskChange(), einen bereits geladenen vollen Stand für
  // Heute wiederzuverwenden statt ihn direkt danach nochmal zu holen (siehe fullTaskList).
  return fullTaskList;
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
