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

// Liefert die IDs aller Habit-Aufgaben, die heute fällig sind (heutiger Wochentag in
// habit_weekdays) aber noch nicht auf heute eingeplant sind. Reine Berechnung ohne DB-Zugriff.
export function findHabitsDueToday(allTasks, todayIso) {
  const todayCode = weekdayCodeFromIso(todayIso);
  return allTasks
    .filter((t) => isHabitTask(t) && t.habit_weekdays.includes(todayCode) && t.planned_date !== todayIso)
    .map((t) => t.id);
}

// Setzt planned_date/status der heute fälligen Habits auf heute/'planned'. Idempotent (erneuter
// Aufruf am selben Tag findet nichts mehr) — das ist zugleich der Reset-Mechanismus: ein an einem
// früheren fälligen Tag als 'done' markiertes Habit wird beim nächsten fälligen Wochentag
// automatisch wieder auf 'planned' zurückgesetzt, weil planned_date dann nicht mehr auf heute zeigt.
// Rückgabe: geänderte IDs, damit der Aufrufer den lokalen Task-Cache patchen kann statt neu zu fetchen.
export async function autoplanDueHabits(allTasks, todayIso) {
  const dueIds = findHabitsDueToday(allTasks, todayIso);
  if (dueIds.length === 0) return [];
  const { error } = await supabase
    .from("tasks")
    .update({ planned_date: todayIso, status: "planned" })
    .in("id", dueIds);
  if (error) throw error;
  return dueIds;
}
