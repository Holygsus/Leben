import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

const MAX_TASKS_PER_AREA = 2;
const TARGET_TOTAL = 6;

const PRIORITY_RANK = { high: 2, medium: 1, low: 0 };

// Fisher-Yates — sorgt dafür, dass "Neu vorschlagen" bei ausreichend offenen Aufgaben
// tatsächlich ein anderes Ergebnis liefert statt (wie zuvor) immer dieselbe Reihenfolge.
function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Mutteraufgabe + Unteraufgaben zählen als eine Gruppe/ein Slot im Verteilungs-Algorithmus
// (Unteraufgaben werden beim Einplanen automatisch mitkaskadiert, siehe planTaskCascade),
// daher werden hier nur Top-Level-Aufgaben als Kandidaten betrachtet.
export function suggestTasksForPlan(openTasks) {
  const pool = openTasks.filter((t) => t.status === "open" && !t.parent_task_id);

  // Zufällig mischen und danach *stabil* nach Priorität sortieren, damit hohe Priorität
  // vorgezogen wird, aber die Zufallsreihenfolge innerhalb derselben Priorität erhalten bleibt.
  const ranked = shuffle(pool).sort(
    (a, b) => (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1)
  );

  const selected = [];
  const areaCounts = new Map();

  for (const task of ranked) {
    if (selected.length >= TARGET_TOTAL) break;
    const count = areaCounts.get(task.area_id) || 0;
    if (count >= MAX_TASKS_PER_AREA) continue;
    selected.push(task);
    areaCounts.set(task.area_id, count + 1);
  }

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
