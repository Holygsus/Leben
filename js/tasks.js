import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listTasks({
  areaId,
  status,
  statusNot,
  effort,
  isBrainstorm,
  plannedDate,
  plannedBefore,
  isPinned,
} = {}) {
  let query = supabase.from("tasks").select("*").order("created_at", { ascending: true });
  if (areaId) query = query.eq("area_id", areaId);
  if (status) query = query.eq("status", status);
  if (statusNot) query = query.neq("status", statusNot);
  if (effort) query = query.eq("effort", effort);
  if (isBrainstorm !== undefined) query = query.eq("is_brainstorm", isBrainstorm);
  if (plannedDate) query = query.eq("planned_date", plannedDate);
  if (plannedBefore) query = query.lt("planned_date", plannedBefore);
  if (isPinned !== undefined) query = query.eq("is_pinned", isPinned);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createTask({
  title,
  areaId = null,
  parentTaskId = null,
  effort = null,
  status = "open",
  plannedDate = null,
  isBrainstorm = false,
  isPinned = false,
}) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      area_id: areaId,
      parent_task_id: parentTaskId,
      title,
      effort,
      status,
      planned_date: plannedDate,
      is_brainstorm: isBrainstorm,
      is_pinned: isPinned,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, updates) {
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

// Baut aus der flachen Task-Liste einen Baum (children pro Knoten) entlang parent_task_id.
export function buildTaskTree(tasks, parentTaskId = null) {
  const byParent = new Map();
  for (const t of tasks) {
    const key = t.parent_task_id || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  const attach = (parentKey) =>
    (byParent.get(parentKey) || []).map((node) => ({
      ...node,
      children: attach(node.id),
    }));
  return attach(parentTaskId || "root");
}

// Alle Nachfahren-IDs einer Aufgabe entlang parent_task_id (nicht die Aufgabe selbst).
// Grundlage für Zyklus-Schutz beim Verschieben/Zuordnen und für die rekursive Zählung.
// visited-Guard ist reine Absicherung gegen (eigentlich unmögliche) Zyklen in den Daten.
export function collectDescendantIds(tasks, rootId, visited = new Set()) {
  const ids = new Set();
  const walk = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const t of tasks) {
      if (t.parent_task_id === id) {
        ids.add(t.id);
        walk(t.id);
      }
    }
  };
  walk(rootId);
  return ids;
}

// Zählt alle Nachfahren einer Aufgabe (für das "(N Unteraufgaben)"-Badge).
export function countDescendantsRecursive(taskId, tasks) {
  return collectDescendantIds(tasks, taskId).size;
}

// Markiert eine Aufgabe und alle ihre Unteraufgaben als erledigt.
export async function completeTaskCascade(rootTask, allTasks) {
  const ids = [rootTask.id, ...collectDescendantIds(allTasks, rootTask.id)];
  const { error } = await supabase.from("tasks").update({ status: "done" }).in("id", ids);
  if (error) throw error;
}

// Macht das Erledigen einer Aufgabe rückgängig: sie selbst und alle Unteraufgaben werden
// wieder geöffnet (auf "planned" falls ein Plandatum gesetzt ist, sonst "open") — dieselbe
// Regel wie beim einzelnen Abhaken-Rückgängig (siehe toggleTaskDoneStatus in app.js).
export async function reopenTaskCascade(rootTask, allTasks) {
  const descendantIds = collectDescendantIds(allTasks, rootTask.id);
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const idsWithDate = [];
  const idsWithoutDate = [];
  for (const id of [rootTask.id, ...descendantIds]) {
    const task = id === rootTask.id ? rootTask : byId.get(id);
    (task?.planned_date ? idsWithDate : idsWithoutDate).push(id);
  }
  if (idsWithDate.length) {
    const { error } = await supabase.from("tasks").update({ status: "planned" }).in("id", idsWithDate);
    if (error) throw error;
  }
  if (idsWithoutDate.length) {
    const { error } = await supabase.from("tasks").update({ status: "open" }).in("id", idsWithoutDate);
    if (error) throw error;
  }
}
