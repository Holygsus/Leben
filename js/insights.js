import { supabase } from "./supabase.js";

// Rückblick: wertet die Daten aus, die die App ohnehin schon sammelt (daily_reflections.mood,
// task_feedback.rating, habit_completions), und zeigt sie im Cockpit zurück — bisher waren diese
// Tabellen write-only und nur über einen Claude-Skill auswertbar. Reine Funktionen unten sind
// in test.js abgedeckt.

export const INSIGHT_WINDOW_DAYS = 30;
export const MOOD_STRIP_DAYS = 14;
// Unter dieser Anzahl Datenpunkte pro Gruppe ist ein Durchschnitt eher Rauschen als Signal.
const MIN_SAMPLES = 3;

export async function listReflectionsSince(fromIso) {
  const { data, error } = await supabase
    .from("daily_reflections")
    .select("date, mood")
    .gte("date", fromIso)
    .order("date", { ascending: true });
  if (error) throw error;
  return data;
}

// Bereich kommt per Embed über den FK task_feedback.task_id -> tasks.
export async function listTaskFeedbackSince(fromIso) {
  const { data, error } = await supabase
    .from("task_feedback")
    .select("rating, created_at, tasks(area_id)")
    .gte("created_at", fromIso);
  if (error) throw error;
  return data.map((f) => ({ rating: f.rating, created_at: f.created_at, area_id: f.tasks?.area_id ?? null }));
}

export function shiftIsoDate(iso, deltaDays) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function average(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

// Ein Eintrag pro Kalendertag (ältester zuerst), mood null an Tagen ohne Reflexion.
export function buildMoodStrip(reflections, todayIso, days = MOOD_STRIP_DAYS) {
  const moodByDate = new Map(reflections.map((r) => [r.date, r.mood]));
  const strip = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftIsoDate(todayIso, -i);
    strip.push({ date, mood: moodByDate.get(date) ?? null });
  }
  return strip;
}

export function averageMood(strip) {
  return average(strip.filter((d) => d.mood != null).map((d) => d.mood));
}

// Ø Aufgaben-Rating je Bereich, nur Bereiche mit genug Bewertungen, bestes zuerst.
export function averageRatingByArea(feedback) {
  const byArea = new Map();
  for (const f of feedback) {
    if (!f.area_id) continue;
    if (!byArea.has(f.area_id)) byArea.set(f.area_id, []);
    byArea.get(f.area_id).push(f.rating);
  }
  return [...byArea.entries()]
    .filter(([, ratings]) => ratings.length >= MIN_SAMPLES)
    .map(([areaId, ratings]) => ({ areaId, avg: average(ratings), count: ratings.length }))
    .sort((a, b) => b.avg - a.avg);
}

// Stimmung an Tagen mit mindestens einem erledigten (nicht übersprungenen) Habit vs. ohne. null, wenn
// eine der beiden Gruppen zu dünn ist.
export function moodByHabitDays(reflections, completions) {
  const habitDays = new Set(completions.filter((c) => !c.skipped).map((c) => c.date));
  const withHabit = reflections.filter((r) => habitDays.has(r.date)).map((r) => r.mood);
  const withoutHabit = reflections.filter((r) => !habitDays.has(r.date)).map((r) => r.mood);
  if (withHabit.length < MIN_SAMPLES || withoutHabit.length < MIN_SAMPLES) return null;
  return {
    withAvg: average(withHabit),
    withCount: withHabit.length,
    withoutAvg: average(withoutHabit),
    withoutCount: withoutHabit.length,
  };
}
