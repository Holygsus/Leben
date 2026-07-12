import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

// Minutenbudget statt fixer Aufgabenzahl (siehe wissensdatenbank/features/tagesplan-algorithmus-v2.md).
// Presets bewusst hart codiert, kein Konfigurations-UI in V1.
export const BUDGET_MINUTES = { weekday: 120, weekend: 240 };

const PRIORITY_RANK = { high: 2, medium: 1, low: 0 };

function rank(task) {
  return PRIORITY_RANK[task.priority] ?? 1;
}

// Priorität absteigend, bei Gleichstand ältere Aufgabe zuerst (Fairness-Tiebreaker gegen
// dauerhaft im Zufall untergehende liegen gebliebene Aufgaben).
function byPriorityThenAge(a, b) {
  return rank(b) - rank(a) || new Date(a.created_at) - new Date(b.created_at);
}

// "T00:00:00" (ohne "Z") erzwingt lokale statt UTC-Interpretation, wie in habits.js/app.js üblich.
function isWeekendIso(iso) {
  const day = new Date(iso + "T00:00:00").getDay();
  return day === 0 || day === 6;
}

export function budgetForDate(targetDateIso) {
  return isWeekendIso(targetDateIso) ? BUDGET_MINUTES.weekend : BUDGET_MINUTES.weekday;
}

function round5(minutes) {
  return Math.round(minutes / 5) * 5;
}

// Mutteraufgabe + Unteraufgaben zählen als eine Gruppe/ein Slot im Verteilungs-Algorithmus
// (Unteraufgaben werden beim Einplanen automatisch mitkaskadiert, siehe planTaskCascade),
// daher werden hier nur Top-Level-Aufgaben als Kandidaten betrachtet.
export function suggestTasksForPlan(openTasks, targetDateIso) {
  // Habit-Aufgaben (habit_weekdays gesetzt) werden bereits automatisch über den Habit-Tab
  // eingeplant. Aufgaben ohne effort-Wert werden von der automatischen Auswahl ausgeschlossen
  // (kein Default-Schätzwert, siehe Konzept-Dokument) und bleiben nur manuell wählbar.
  const pool = openTasks.filter(
    (t) => t.status === "open" && !t.parent_task_id && t.habit_weekdays == null && t.effort != null
  );

  const totalBudget = budgetForDate(targetDateIso);

  const byArea = new Map();
  for (const task of pool) {
    if (!byArea.has(task.area_id)) byArea.set(task.area_id, []);
    byArea.get(task.area_id).push(task);
  }
  for (const list of byArea.values()) {
    list.sort(byPriorityThenAge);
  }

  const areaCap = byArea.size > 0 ? round5(totalBudget / byArea.size) : 0;

  const selected = [];
  const areaMinutes = new Map();
  const consumed = new Set();
  let totalMinutes = 0;

  // Phase 1: pro Bereich das Minimum sichern — ignoriert bewusst Bereichs-Cap und Gesamtbudget,
  // sonst wäre die "garantiert"-Zusage nicht wasserdicht (z. B. Bereich mit nur einer teuren
  // 60-Minuten-Aufgabe). Budget ist dadurch ein weiches Ziel, kein hartes Limit.
  for (const list of byArea.values()) {
    const task = list[0];
    selected.push(task);
    consumed.add(task.id);
    areaMinutes.set(task.area_id, task.effort);
    totalMinutes += task.effort;
  }

  // Phase 2: global nach Priorität/Alter auffüllen, bis Bereichs-Cap oder Gesamtbudget erreicht ist.
  const remaining = pool.filter((t) => !consumed.has(t.id)).sort(byPriorityThenAge);

  for (const task of remaining) {
    const usedInArea = areaMinutes.get(task.area_id) || 0;
    if (usedInArea + task.effort > areaCap) continue;
    if (totalMinutes + task.effort > totalBudget) continue;
    selected.push(task);
    areaMinutes.set(task.area_id, usedInArea + task.effort);
    totalMinutes += task.effort;
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
