import { supabase } from "./supabase.js";

export const WEEKDAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Date.getDay(): 0=Sonntag..6=Samstag. WEEKDAY_CODES ist Mo-first, daher die Verschiebung:
// Sonntag (0) landet auf Index 6, alle anderen Tage auf getDay()-1.
export function weekdayCodeFromDate(date) {
  const day = date.getDay();
  return WEEKDAY_CODES[day === 0 ? 6 : day - 1];
}

// "T00:00:00" (ohne "Z") erzwingt lokale statt UTC-Interpretation, sonst würde der Wochentag in
// Zeitzonen westlich von UTC am Datumswechsel falsch berechnet.
export function weekdayCodeFromIso(isoDateString) {
  return weekdayCodeFromDate(new Date(isoDateString + "T00:00:00"));
}

export function isHabitTask(task) {
  return task.habit_weekdays != null;
}

const RECURRENCE_MIN_DAYS = { biweekly: 14, monthly: 30 };

export const RECURRENCE_LABEL = { weekly: "Wöchentlich", biweekly: "Alle 2 Wochen", monthly: "Monatlich" };

// Zusätzliches Fälligkeits-Gate für 'biweekly'/'monthly' oben auf den Wochentags-Treffer. 'weekly'
// braucht kein Gate — der Wochentags-Treffer allein genügt, wie in V1. null habit_last_due_date =
// noch nie fällig gewesen -> sofort fällig, das ist die einzig sinnvolle Bedeutung für ein frisch
// auf biweekly/monthly umgestelltes Habit.
function isRecurrenceDue(task, todayIso) {
  const recurrence = task.habit_recurrence || "weekly";
  if (recurrence === "weekly") return true;
  if (!task.habit_last_due_date) return true;
  const today = new Date(todayIso + "T00:00:00");
  const lastDue = new Date(task.habit_last_due_date + "T00:00:00");
  const daysSince = Math.round((today - lastDue) / 86400000);
  return daysSince >= RECURRENCE_MIN_DAYS[recurrence];
}

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

// Wählt aus offenen Pool-Kindern eines fälligen Habits eines nach Prioritätsregel: höchste
// priority gewinnt, bei Gleichstand zufällig.
function pickOpenChild(openChildren) {
  const maxRank = Math.max(...openChildren.map((t) => PRIORITY_RANK[t.priority || "medium"]));
  const topCandidates = openChildren.filter((t) => PRIORITY_RANK[t.priority || "medium"] === maxRank);
  return topCandidates[Math.floor(Math.random() * topCandidates.length)];
}

// Liefert für jede heute fällige Habit-Mutter { motherId, targetId }: targetId ist entweder die
// Mutter selbst (kein offenes Pool-Kind vorhanden -> V1-Verhalten unverändert) oder ein per
// Prioritätsregel ausgewähltes offenes Pool-Kind (Aufgaben-Pool-Modus — die Mutter selbst wird in
// diesem Fall nie eingeplant). Reine Berechnung ohne DB-Zugriff.
export function findHabitsDueToday(allTasks, todayIso) {
  const todayCode = weekdayCodeFromIso(todayIso);
  const dueMothers = allTasks.filter(
    (t) => isHabitTask(t) && t.habit_weekdays.includes(todayCode) && isRecurrenceDue(t, todayIso)
  );

  const results = [];
  for (const mother of dueMothers) {
    const openChildren = allTasks.filter((t) => t.parent_task_id === mother.id && t.status === "open");

    if (openChildren.length === 0) {
      if (mother.planned_date !== todayIso) results.push({ motherId: mother.id, targetId: mother.id });
      continue;
    }

    // Nicht erneut würfeln, wenn schon eines der Kinder heute geplant ist — sonst würde bei jedem
    // Render (z.B. jedes Öffnen der Heute-Ansicht) ein neues Kind gezogen.
    if (openChildren.some((c) => c.planned_date === todayIso)) continue;

    const picked = pickOpenChild(openChildren);
    results.push({ motherId: mother.id, targetId: picked.id });
  }
  return results;
}

// Setzt planned_date/status der heute fälligen Ziel-Aufgaben (Mutter oder ausgewähltes Pool-Kind,
// siehe findHabitsDueToday) auf heute/'planned', und stempelt habit_last_due_date der jeweiligen
// Mutter(n) auf heute — unabhängig davon, ob die Mutter selbst oder ein Kind eingeplant wurde.
// Zwei getrennte Updates, weil Ziel- und Mutter-ID im Pool-Modus auseinanderfallen können.
// Idempotent (erneuter Aufruf am selben Tag findet nichts mehr) — das ist zugleich der
// Reset-Mechanismus: ein an einem früheren fälligen Tag als 'done' markiertes Habit wird beim
// nächsten fälligen Zeitpunkt automatisch wieder auf 'planned' zurückgesetzt, weil planned_date
// dann nicht mehr auf heute zeigt. Rückgabe: geänderte Ziel-IDs, damit der Aufrufer den lokalen
// Task-Cache patchen kann statt neu zu fetchen.
export async function autoplanDueHabits(allTasks, todayIso) {
  const due = findHabitsDueToday(allTasks, todayIso);
  if (due.length === 0) return [];

  const targetIds = due.map((d) => d.targetId);
  const motherIds = [...new Set(due.map((d) => d.motherId))];

  const { error: planError } = await supabase
    .from("tasks")
    .update({ planned_date: todayIso, status: "planned" })
    .in("id", targetIds);
  if (planError) throw planError;

  const { error: stampError } = await supabase
    .from("tasks")
    .update({ habit_last_due_date: todayIso })
    .in("id", motherIds);
  if (stampError) throw stampError;

  return targetIds;
}
