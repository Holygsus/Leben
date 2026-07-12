import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";
import { WEEKDAY_CODES, weekdayCodeFromIso } from "./habits.js";

export const DEFAULT_DURATION_MIN = { serie: 45, anime: 20, film: 90 };

// ---------- CRUD: Katalog ----------

export async function listWatchlistItems({ status, type } = {}) {
  let query = supabase.from("watchlist_items").select("*").order("sort_order", { ascending: true });
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("type", type);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createWatchlistItem({ title, type = "serie", genres = [], platform = null, durationMinutes = null }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("watchlist_items")
    .insert({ user_id: userId, title, type, genres, platform, duration_minutes: durationMinutes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWatchlistItem(id, updates) {
  const { data, error } = await supabase.from("watchlist_items").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteWatchlistItem(id) {
  const { error } = await supabase.from("watchlist_items").delete().eq("id", id);
  if (error) throw error;
}

// ---------- CRUD: Sichtungs-Log ----------

export async function listViewingLog(watchlistItemId) {
  const { data, error } = await supabase
    .from("watchlist_viewing_log")
    .select("*")
    .eq("watchlist_item_id", watchlistItemId)
    .order("watched_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Batch-Variante für die Fernsehprogramm-Übersicht: ein Request für alle Items statt N+1, da dort
// pro sichtbarem Item eine Durchschnittsbewertung gebraucht wird (siehe computeAverageRating).
export async function listAllViewingLogEntries() {
  const { data, error } = await supabase.from("watchlist_viewing_log").select("*");
  if (error) throw error;
  return data;
}

export async function logViewing({ watchlistItemId, rating = null, season = null, episode = null }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("watchlist_viewing_log")
    .insert({ user_id: userId, watchlist_item_id: watchlistItemId, rating, season, episode })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateViewingRating(logId, rating) {
  const { data, error } = await supabase.from("watchlist_viewing_log").update({ rating }).eq("id", logId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteViewingLogEntry(logId) {
  const { error } = await supabase.from("watchlist_viewing_log").delete().eq("id", logId);
  if (error) throw error;
}

// ---------- Reine Funktionen (kein DB-Zugriff, test.js-tauglich) ----------

export function isWatchlistTask(task) {
  return task.watchlist_item_id != null;
}

export function getEffectiveDuration(item) {
  return item.duration_minutes ?? DEFAULT_DURATION_MIN[item.type];
}

// Durchschnittsbewertung ist eine berechnete Kennzahl aus den Sichtungs-Log-Einträgen, kein
// gespeichertes Feld (Spec-Vorgabe: eine schlecht bewertete Folge soll die Serie nicht automatisch
// abwerten). Übersprungene Bewertungen (rating null) fließen nicht in den Schnitt ein. null =
// noch keine Bewertung vorhanden, nicht 0 — damit sich "unbewertet" von "immer negativ bewertet"
// unterscheiden lässt.
export function computeAverageRating(logEntries) {
  const rated = logEntries.filter((e) => e.rating != null);
  if (rated.length === 0) return null;
  const up = rated.filter((e) => e.rating === "up").length;
  return up / rated.length;
}

export function filterWatchlistItems(items, { type, genre, minAvgRating } = {}, avgRatingByItemId = {}) {
  return items.filter((item) => {
    if (type && item.type !== type) return false;
    if (genre && !item.genres?.includes(genre)) return false;
    if (minAvgRating != null) {
      const avg = avgRatingByItemId[item.id];
      if (avg == null || avg < minAvgRating) return false;
    }
    return true;
  });
}

// "T00:00:00" + lokale Getter statt toISOString(): toISOString() rechnet nach UTC zurück, was in
// Zeitzonen östlich von UTC (z.B. Europe/Berlin) den lokalen Mitternachts-Zeitpunkt auf den
// Vortag zurückwirft und alle Wochentage um einen Tag verschiebt — derselbe Stolperstein, den
// weekdayCodeFromIso in js/habits.js beim Parsen schon vermeidet, hier aber beim Formatieren.
function formatIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Montag..Sonntag-ISO-Daten der Woche, die todayIso enthält (Mo-first, analog WEEKDAY_CODES).
export function currentWeekDates(todayIso) {
  const today = new Date(todayIso + "T00:00:00");
  const todayIndex = WEEKDAY_CODES.indexOf(weekdayCodeFromIso(todayIso));
  const monday = new Date(today);
  monday.setDate(today.getDate() - todayIndex);
  return WEEKDAY_CODES.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return formatIsoDate(d);
  });
}

// Warteschlangen-Zuteilung: für jeden Wochentag ohne bestehende Watchlist-Aufgabe wird das nächste
// aktive, diese Woche noch nicht verplante Item zugeteilt (Reihenfolge: sort_order, dann
// created_at). Reine Berechnung — DB-Schreiben passiert erst in autoplanWatchlistForDates().
export function planMissingSlots(items, watchlistTasksThisWeek, weekDates) {
  const scheduledItemIds = new Set(watchlistTasksThisWeek.map((t) => t.watchlist_item_id));
  const scheduledDates = new Set(watchlistTasksThisWeek.map((t) => t.planned_date));
  const pool = items
    .filter((i) => i.status === "aktiv" && !scheduledItemIds.has(i.id))
    .sort((a, b) => a.sort_order - b.sort_order || (a.created_at < b.created_at ? -1 : 1));

  const missingDates = weekDates.filter((d) => !scheduledDates.has(d));
  const assignments = [];
  for (let i = 0; i < missingDates.length && i < pool.length; i++) {
    assignments.push({ date: missingDates[i], item: pool[i] });
  }
  return assignments;
}

// Swap-Logik: zwei "Slots" (je entweder {taskId, plannedDate, watchlistItemId} für einen bereits
// verplanten Eintrag, oder {watchlistItemId} ohne taskId für einen unverplanten Watchlist-Eintrag)
// → Liste nötiger Task-Updates. Ein echter Tausch, kein Verdrängen: beide Seiten landen auf der
// jeweils anderen Position.
export function buildSwapOperations(slotA, slotB) {
  if (slotA.taskId && slotB.taskId) {
    // Beide verplant: Datum tauschen, Tasks bleiben an ihren Items hängen.
    return [
      { taskId: slotA.taskId, updates: { planned_date: slotB.plannedDate } },
      { taskId: slotB.taskId, updates: { planned_date: slotA.plannedDate } },
    ];
  }
  const scheduled = slotA.taskId ? slotA : slotB;
  const unscheduled = slotA.taskId ? slotB : slotA;
  // Verplant gegen unverplant: die bestehende Task-Zeile bleibt an ihrem Datum, bekommt aber das
  // andere Item zugeordnet — das ursprünglich verplante Item ist damit wieder unverplant.
  return [{ taskId: scheduled.taskId, updates: { watchlist_item_id: unscheduled.watchlistItemId } }];
}

// ---------- Async-Wrapper ----------

// Idempotenz-Pattern von autoplanDueHabits übernommen: legt für jedes Datum ohne bestehende
// Watchlist-Aufgabe eine neue tasks-Zeile an (planned_date=Datum, status='planned',
// watchlist_item_id gesetzt). effort bleibt NULL, siehe Kommentar in supabase/schema.sql —
// tasks.effort erlaubt nur 5/10/30/60, die Watchlist-Dauer würde den Check verletzen. Erneuter
// Aufruf für dieselbe Woche findet nichts mehr zu tun, sobald alle Tage belegt sind.
export async function autoplanWatchlistForDates(items, allTasks, dates) {
  const watchlistTasksThisWeek = allTasks.filter((t) => t.watchlist_item_id != null && dates.includes(t.planned_date));
  const assignments = planMissingSlots(items, watchlistTasksThisWeek, dates);
  if (assignments.length === 0) return [];

  const userId = await getCurrentUserId();
  const rows = assignments.map(({ date, item }) => ({
    user_id: userId,
    title: item.title,
    status: "planned",
    planned_date: date,
    watchlist_item_id: item.id,
  }));
  const { data, error } = await supabase.from("tasks").insert(rows).select();
  if (error) throw error;
  return data;
}

// Wendet buildSwapOperations() tatsächlich an.
export async function applyWatchlistSwap(slotA, slotB) {
  const operations = buildSwapOperations(slotA, slotB);
  for (const op of operations) {
    const { error } = await supabase.from("tasks").update(op.updates).eq("id", op.taskId);
    if (error) throw error;
  }
}
