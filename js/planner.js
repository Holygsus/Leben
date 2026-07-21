import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

// Minutenbudget statt fixer Aufgabenzahl (siehe wissensdatenbank/features/tagesplan-algorithmus-v2.md).
// Presets bewusst hart codiert, kein Konfigurations-UI in V1. 180/360 (statt früher 120/240) seit dem
// War Room vom 2026-07-21 — deckt sich exakt mit einer EFFORT_CLASS_PASS-Runde (60+30+30+10+10+10+
// 5+5+5+5+5+5=180), das Tagesbudget ist seitdem nur noch ein weicher Hintergrund-Hinweis, kein
// hartes Gate mehr.
export const BUDGET_MINUTES = { weekday: 180, weekend: 360 };

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

  // Kein round5 mehr: eine gerundete Bereichs-Cap-Schwelle verschenkt Budget systematisch (z. B. 10
  // Bereiche à 120 Min → round5(12)=10, macht 20 Min garantiert ungenutzt), unabhängig von der
  // Aufgabenlage. Die exakte Division genügt, da areaCap nur als Vergleichsschwelle dient.
  const areaCap = byArea.size > 0 ? totalBudget / byArea.size : 0;

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

// Aufwandsklassen-geführter Durchgang (wissensdatenbank/features/tagesplan-algorithmus-v2.md,
// "Entschiedenes Zielbild (V2)", War Room 2026-07-21) — ersetzt das frühere Bereichs-first-Modell
// (buildAreaCandidatePools). Eine "Runde" ist eine feste Sequenz von Aufwandsklassen-Slots,
// hergeleitet aus der Zielvorgabe "ca. 1×60/2×30/3×10/6×5 Min. pro Tag"
// (60+30+30+10+10+10+5+5+5+5+5+5 = 180 Min., identisch zum Werktags-Budget-Preset).
const EFFORT_CLASS_PASS = [60, 30, 30, 10, 10, 10, 5, 5, 5, 5, 5, 5];

// Am Wochenende läuft die komplette Runde laut Zielbild "faktisch zweimal hintereinander"
// (180×2=360, deckt sich mit dem Wochenend-Budget-Preset) — Wochenend-Erkennung über den bereits
// bestehenden budgetForDate-Vergleich statt die dateiinterne isWeekendIso zu exportieren.
export function buildEffortClassSlots(targetDateIso) {
  const isWeekend = budgetForDate(targetDateIso) > BUDGET_MINUTES.weekday;
  return isWeekend ? [...EFFORT_CLASS_PASS, ...EFFORT_CLASS_PASS] : [...EFFORT_CLASS_PASS];
}

// Bereichs-Rotation innerhalb einer Aufwandsklasse: least-recently-served zuerst
// (areas.last_served_at aufsteigend, null/"nie bedient" zuerst), außer ein Bereich hat eine
// hochpriorisierte Aufgabe als Top-Kandidat dieser Klasse — der zieht ganz nach vorne, vor die reine
// Recency-Reihenfolge (Nutzer-Entscheidung, siehe Plan-Datei). "Ohne Bereich" (area_id null) hat kein
// last_served_at-Konzept und wird wie "nie bedient" behandelt (immer vorne in seiner Gruppe).
export function buildAreaRotationQueue(openTasks, areas, effortValue, excludeTaskIds = new Set()) {
  const pool = openTasks.filter(
    (t) =>
      t.status === "open" &&
      !t.parent_task_id &&
      t.habit_weekdays == null &&
      t.effort === effortValue &&
      !excludeTaskIds.has(t.id)
  );

  const byArea = new Map();
  for (const task of pool) {
    if (!byArea.has(task.area_id)) byArea.set(task.area_id, []);
    byArea.get(task.area_id).push(task);
  }

  const lastServedByAreaId = new Map(areas.map((a) => [a.id, a.last_served_at]));
  const recencyRank = (areaId) => {
    const value = areaId === null ? null : lastServedByAreaId.get(areaId);
    return value ? new Date(value).getTime() : -Infinity;
  };

  const entries = [...byArea.entries()].map(([areaId, list]) => {
    const candidate = [...list].sort(byPriorityThenAge)[0];
    return { areaId, candidate };
  });

  const pulledForward = entries.filter((e) => e.candidate.priority === "high");
  const rest = entries.filter((e) => e.candidate.priority !== "high");
  const byRecencyAsc = (a, b) => recencyRank(a.areaId) - recencyRank(b.areaId);
  pulledForward.sort(byRecencyAsc);
  rest.sort(byRecencyAsc);

  return [...pulledForward, ...rest];
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
