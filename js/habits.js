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
    const children = allTasks.filter((t) => t.parent_task_id === mother.id);
    const openChildren = children.filter((t) => t.status === "open");

    if (openChildren.length === 0) {
      if (mother.planned_date !== todayIso) results.push({ motherId: mother.id, targetId: mother.id });
      continue;
    }

    // Nicht erneut würfeln, wenn schon eines der Kinder heute geplant ist — sonst würde bei jedem
    // Render (z.B. jedes Öffnen der Heute-Ansicht) ein neues Kind gezogen. Muss über ALLE Kinder
    // prüfen, nicht nur die offenen: ein bereits gezogenes Kind wechselt sofort auf status
    // "planned" und würde sonst aus openChildren rausfallen, wodurch der Guard nie greift.
    if (children.some((c) => c.planned_date === todayIso)) continue;

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

// ---------- Streak-Anzeige ----------

// Batch-Variante für die Habits-Übersicht: ein Request für alle Habits statt N+1 (analog
// listAllViewingLogEntries in js/watchlist.js).
export async function listAllHabitCompletions() {
  const { data, error } = await supabase.from("habit_completions").select("*");
  if (error) throw error;
  return data;
}

// "Tage in Folge" ist nur für 'weekly' sauber aus habit_weekdays + habit_completions ableitbar:
// pro Kalendertag rückwärts ab heute prüfen, ob der Tag laut habit_weekdays fällig war, und falls
// ja, ob eine Completion existiert — die erste fällige Lücke beendet die Serie. Für
// 'biweekly'/'monthly' würde dieselbe Tages-Logik falsche Lücken zwischen den Fällig-Terminen
// sehen (der einzige Fälligkeits-Anker, habit_last_due_date, kennt nur den letzten Termin, keine
// Historie) — dort zeigen wir stattdessen nur die Gesamtzahl an Erledigungen.
const STREAK_MAX_LOOKBACK_DAYS = 366;

export function computeHabitStreak(task, completions, todayIso = localTodayIso()) {
  const taskCompletions = completions.filter((c) => c.task_id === task.id);
  if ((task.habit_recurrence || "weekly") !== "weekly") {
    return { type: "total", count: taskCompletions.length };
  }
  if (task.habit_weekdays.length === 0) return { type: "days", count: 0 };

  const completedDates = new Set(taskCompletions.map((c) => c.date));
  let count = 0;
  const cursor = new Date(todayIso + "T00:00:00");
  for (let i = 0; i < STREAK_MAX_LOOKBACK_DAYS; i++) {
    const iso = toLocalIso(cursor);
    if (task.habit_weekdays.includes(weekdayCodeFromDate(cursor))) {
      if (!completedDates.has(iso)) {
        // Heute selbst noch offen zählt nicht als gerissene Serie — der Tag ist ja noch nicht
        // vorbei. Jeder frühere fällige, nicht erledigte Tag beendet die Serie wie erwartet.
        if (i === 0) {
          cursor.setDate(cursor.getDate() - 1);
          continue;
        }
        break;
      }
      count++;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return { type: "days", count };
}

function toLocalIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTodayIso() {
  return toLocalIso(new Date());
}
