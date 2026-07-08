import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

const MAX_TASKS_PER_AREA = 2;

export function suggestTasksForPlan(openTasks) {
  const pool = openTasks.filter((t) => t.status === "open");
  const byAgeAsc = [...pool].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const selected = [];
  const usedIds = new Set();
  const areaCounts = new Map();

  function canTake(task) {
    if (usedIds.has(task.id)) return false;
    return (areaCounts.get(task.area_id) || 0) < MAX_TASKS_PER_AREA;
  }

  function take(task) {
    selected.push(task);
    usedIds.add(task.id);
    areaCounts.set(task.area_id, (areaCounts.get(task.area_id) || 0) + 1);
  }

  function takeFromBucket(efforts, count) {
    let taken = 0;
    for (const task of byAgeAsc) {
      if (taken >= count) break;
      if (!efforts.includes(task.effort)) continue;
      if (!canTake(task)) continue;
      take(task);
      taken++;
    }
  }

  takeFromBucket([5], 1);
  takeFromBucket([10], 2);
  takeFromBucket([30, 60], 1);

  return selected;
}

export function formatTasksForExport(tasks, areaNameById) {
  if (tasks.length === 0) return "Keine offenen Aufgaben.";
  return tasks
    .map((t) => {
      const effort = t.effort ? `${t.effort} min` : "?";
      const area = t.area_id && areaNameById[t.area_id] ? ` — ${areaNameById[t.area_id]}` : "";
      return `- [${effort}] ${t.title}${area}`;
    })
    .join("\n");
}

export async function savePlanForDate(planDate, taskIds) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("daily_plans")
    .upsert({ user_id: userId, plan_date: planDate, task_ids: taskIds }, { onConflict: "user_id,plan_date" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
