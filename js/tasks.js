import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";
import { isHabitTask } from "./habits.js";

// "T00:00:00" + lokale Getter statt toISOString(): siehe js/watchlist.js formatIsoDate für die
// Begründung (toISOString() rechnet nach UTC zurück und kann in Zeitzonen östlich von UTC auf den
// falschen Tag rollen).
function localTodayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function listTasks({
  areaId,
  status,
  statusNot,
  effort,
  isBrainstorm,
  plannedDate,
  plannedBefore,
  plannedFrom,
  plannedTo,
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
  if (plannedFrom) query = query.gte("planned_date", plannedFrom);
  if (plannedTo) query = query.lte("planned_date", plannedTo);
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
  priority = "medium",
  isEvent = false,
  habitWeekdays = null,
  habitUnit = null,
  followupSourceId = null,
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
      priority,
      is_event: isEvent,
      habit_weekdays: habitWeekdays,
      habit_unit: habitUnit,
      followup_source_id: followupSourceId,
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
// visited-Guard analog zu collectDescendantIds: reine Absicherung gegen (eigentlich unmögliche)
// Zyklen in den Daten — ohne sie würde ein Zyklus in parent_task_id (Datenimport, manueller
// DB-Edit) hier in einer Endlosrekursion enden, während collectDescendantIds robust bliebe.
export function buildTaskTree(tasks, parentTaskId = null) {
  const byParent = new Map();
  for (const t of tasks) {
    const key = t.parent_task_id || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  const visited = new Set();
  const attach = (parentKey) => {
    const result = [];
    for (const node of byParent.get(parentKey) || []) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      result.push({ ...node, children: attach(node.id) });
    }
    return result;
  };
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

// Zieht alle Unteraufgaben in den neuen Bereich der Wurzel-Aufgabe mit (die Wurzel selbst muss der
// Aufrufer separat per updateTask setzen). Ohne das bleiben Unteraufgaben im alten Bereich hängen
// und werden unsichtbar, weil die Übersicht den Baum je Bereich nur aus dessen eigenen Aufgaben
// baut — ein Kind, dessen Elternteil nicht mehr im selben Bereich ist, hat dort keine Wurzel mehr.
export async function cascadeAreaChange(rootTaskId, newAreaId, allTasks) {
  const descendantIds = [...collectDescendantIds(allTasks, rootTaskId)];
  if (descendantIds.length === 0) return;
  const { error } = await supabase
    .from("tasks")
    .update({ area_id: newAreaId, is_brainstorm: !newAreaId })
    .in("id", descendantIds);
  if (error) throw error;
}

// Löst die Habit-Mutter auf, deren Streak-Log ein rootTask betrifft — entweder rootTask selbst
// (falls es ein Habit ist) oder dessen Elternteil (Pool-Kind-Modus, siehe js/habits.js). Geteilt
// zwischen completeTaskCascade und reopenTaskCascade, damit beide denselben Log-Eintrag treffen.
function resolveHabitTaskId(rootTask, allTasks) {
  if (isHabitTask(rootTask)) return rootTask.id;
  if (rootTask.parent_task_id) {
    const parent = allTasks.find((t) => t.id === rootTask.parent_task_id);
    if (parent && isHabitTask(parent)) return parent.id;
  }
  return null;
}

// Markiert eine Aufgabe und alle ihre Unteraufgaben als erledigt. Loggt zusätzlich einen
// Streak-Eintrag (habit_completions), falls rootTask selbst ein Habit ist, oder falls rootTask ein
// Pool-Kind einer Habit-Mutter ist (Aufgaben-Pool-Modus, siehe js/habits.js) — die Streak gehört
// dann der Mutter, nicht dem einzelnen Pool-Kind. Datum ist das geplante Fälligkeitsdatum der
// Aufgabe (nicht der Erledigungszeitpunkt) — ein überfällig nachgeholtes Habit zählt so für den
// eigentlich fälligen Tag, nicht für heute. Upsert mit ignoreDuplicates auf (task_id, date):
// mehrfaches Erledigen am selben Tag ist ein No-op statt eines Fehlers.
// Gibt true zurück, wenn beim Abschluss stumme Folgevorschläge sichtbar geschaltet wurden — der
// Aufrufer (js/app.js) nutzt das, um das "Neue Vorschläge"-Popup sofort im Abschluss-Moment zu
// öffnen, statt erst beim nächsten Seiten-Render.
export async function completeTaskCascade(rootTask, allTasks) {
  const ids = [rootTask.id, ...collectDescendantIds(allTasks, rootTask.id)];
  const { error } = await supabase.from("tasks").update({ status: "done" }).in("id", ids);
  if (error) throw error;
  let unmutedFollowups = false;

  // Folgeaufgaben-Flag: nur die vom Nutzer tatsächlich abgehakte Wurzel für den (manuell
  // ausgelösten) Folgeaufgaben-Skill markieren — nicht die mitkaskadierten Unteraufgaben. Habits
  // ausnehmen: ein täglich abgehaktes Habit soll keine Folgevorschläge erzeugen. Siehe
  // wissensdatenbank/features/folgeaufgaben-vorschlaege.md.
  if (!isHabitTask(rootTask)) {
    // Hat der Skill für diese (zuvor offene) Aufgabe bereits stumme Vorschläge vorbereitet
    // (status 'muted'), beim Abschluss sofort sichtbar schalten ('open') und die Aufgabe direkt
    // auf 'suggested' setzen — kein Warten auf den nächsten Skill-Lauf. Nur wenn es keine stummen
    // Vorschläge gibt, wie bisher auf 'pending' flaggen. Siehe
    // wissensdatenbank/features/folgeaufgaben-vorschlaege.md.
    const { data: muted, error: mutedError } = await supabase
      .from("task_followup_suggestions")
      .select("id")
      .eq("source_task_id", rootTask.id)
      .eq("status", "muted");
    if (mutedError) throw mutedError;

    if (muted && muted.length) {
      const { error: unmuteError } = await supabase
        .from("task_followup_suggestions")
        .update({ status: "open" })
        .eq("source_task_id", rootTask.id)
        .eq("status", "muted");
      if (unmuteError) throw unmuteError;
      unmutedFollowups = true;
      const { error: flagError } = await supabase
        .from("tasks")
        .update({ followup_status: "suggested" })
        .eq("id", rootTask.id);
      if (flagError) throw flagError;
    } else {
      const { error: flagError } = await supabase
        .from("tasks")
        .update({ followup_status: "pending" })
        .eq("id", rootTask.id);
      if (flagError) throw flagError;
    }
  }

  const habitTaskId = resolveHabitTaskId(rootTask, allTasks);
  if (habitTaskId) {
    const userId = await getCurrentUserId();
    const { error: logError } = await supabase
      .from("habit_completions")
      .upsert(
        { user_id: userId, task_id: habitTaskId, date: rootTask.planned_date || localTodayIso() },
        { onConflict: "task_id,date", ignoreDuplicates: true }
      );
    if (logError) throw logError;
  }

  return unmutedFollowups;
}

// Macht das Erledigen einer Aufgabe rückgängig: sie selbst und alle Unteraufgaben werden
// wieder geöffnet (auf "planned" falls ein Plandatum gesetzt ist, sonst "open"). Entfernt
// symmetrisch zu completeTaskCascade auch den zugehörigen Streak-Log-Eintrag, sonst bliebe eine
// versehentlich abgehakte und sofort rückgängig gemachte Habit-Erledigung fälschlich im Log stehen.
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

  // Beim Abschluss sichtbar geschaltete Vorschläge wieder stummschalten: die Aufgabe ist erneut
  // offen, ihre vorbereiteten Vorschläge gehören also zurück in den 'muted'-Zustand, damit sie beim
  // nächsten Abschluss wieder auftauchen (bereits übernommene/verworfene bleiben unberührt).
  const { error: remuteError } = await supabase
    .from("task_followup_suggestions")
    .update({ status: "muted" })
    .eq("source_task_id", rootTask.id)
    .eq("status", "open");
  if (remuteError) throw remuteError;

  // Folgeaufgaben-Flag zurücknehmen: eine wieder geöffnete Aufgabe ist nicht mehr abgeschlossen und
  // darf nicht als "pending"/"closed" beim Folgeaufgaben-Skill hängen bleiben.
  const { error: flagError } = await supabase
    .from("tasks")
    .update({ followup_status: null })
    .eq("id", rootTask.id);
  if (flagError) throw flagError;

  const habitTaskId = resolveHabitTaskId(rootTask, allTasks);
  if (habitTaskId) {
    const { error: logError } = await supabase
      .from("habit_completions")
      .delete()
      .eq("task_id", habitTaskId)
      .eq("date", rootTask.planned_date || localTodayIso());
    if (logError) throw logError;
  }
}

// Plant eine Aufgabe für ein Datum ein und zieht dabei alle noch offenen (nicht bereits
// erledigten) Unteraufgaben automatisch auf dasselbe Datum mit — Einkaufslisten-Modell:
// einmal die Mutteraufgabe einplanen genügt, die Unterpunkte laufen mit.
// Ausnahme (War Room 2026-07-25, siehe wissensdatenbank/features/tagesplan-algorithmus-v2.md):
// Unteraufgaben mit eigenem effort sind eigenständige Plan-Kandidaten und kaskadieren NICHT mit der
// Mutter mit — sie (und ihr ganzer Teilbaum) werden ausgeschlossen. rootTask selbst wird immer
// eingeplant (auch wenn er effort trägt — er ist die bewusst gewählte Aufgabe). Kinder ohne effort
// kaskadieren unverändert.
export async function planTaskCascade(rootTask, plannedDate, allTasks) {
  const descendantIds = collectDescendantIds(allTasks, rootTask.id);
  const excluded = new Set();
  for (const id of descendantIds) {
    const t = allTasks.find((x) => x.id === id);
    if (t && t.effort != null) {
      excluded.add(id);
      for (const sub of collectDescendantIds(allTasks, id)) excluded.add(sub);
    }
  }
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const cascadedIds = [...descendantIds].filter((id) => !excluded.has(id) && byId.get(id)?.status !== "done");
  const ids = [rootTask.id, ...cascadedIds];
  const { error } = await supabase
    .from("tasks")
    .update({ planned_date: plannedDate, status: plannedDate ? "planned" : "open" })
    .in("id", ids);
  if (error) throw error;
}
