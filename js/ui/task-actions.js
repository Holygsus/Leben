// Aufgaben-Aktionen mit Rückgängig-Toast (Löschen, Abschließen) und Duplizieren.
import { createTask, deleteTask, collectDescendantIds, reopenTaskCascade } from "../tasks.js";
import { deleteViewingLogEntry } from "../watchlist.js";
import { showToast, withErrorToast } from "./modals.js";

// Löscht eine Aufgabe (inkl. serverseitig kaskadierter Unteraufgaben, siehe tasks.parent_task_id
// "on delete cascade") und bietet direkt im Toast ein "Rückgängig" an. Da Postgres das Kaskadieren
// übernimmt, sichern wir vorher eine vollständige Kopie aller betroffenen Aufgaben, um sie bei
// Bedarf per createTask wiederherzustellen (mit neuen IDs — die alte Eltern-Kind-Struktur bleibt
// über die Reihenfolge der Wiederherstellung erhalten).
export async function deleteTaskWithUndo(task, allTasks, afterChange) {
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
export async function restoreTaskSnapshot(task, descendants) {
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
export function showCompleteUndoToast(task, allTasks, afterChange, extraLogIdToUndo = null) {
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
export async function duplicateTaskTree(task, allTasks) {
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
