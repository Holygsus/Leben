import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";
import { WEEKDAY_CODES, weekdayCodeFromIso } from "./habits.js";
import { budgetForDate } from "./planner.js";

export const DEFAULT_DURATION_MIN = { serie: 45, anime: 20, film: 90, doku: 45, youtube: 15 };

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

export async function logViewing({ watchlistItemId, rating = null, season = null, episode = null, kind = "watched" }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("watchlist_viewing_log")
    .insert({ user_id: userId, watchlist_item_id: watchlistItemId, rating, season, episode, kind })
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
// unterscheiden lässt. Skala 1-10 (siehe migration-010.sql), arithmetisches Mittel statt des
// früheren Anteils positiver Bewertungen.
export function computeAverageRating(logEntries) {
  const rated = logEntries.filter((e) => e.rating != null);
  if (rated.length === 0) return null;
  return rated.reduce((sum, e) => sum + e.rating, 0) / rated.length;
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
//
// Zweistufig, analog zum "Bereichs-Minimum ignoriert Cap"-Prinzip aus
// wissensdatenbank/features/tagesplan-algorithmus-v2.md: der erste Eintrag pro Tag ist garantiert,
// unabhängig vom Budget. Ein zweiter Eintrag für denselben Tag wird nur zugeteilt, wenn nach Abzug
// der normalen Tagesaufgaben (committedMinutesByDate, vom Aufrufer geliefert) und der Dauer des
// ersten Eintrags noch Kapazität im Tagesbudget übrig ist.
export function planMissingSlots(items, watchlistTasksThisWeek, weekDates, committedMinutesByDate = {}) {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const scheduledItemIds = new Set(watchlistTasksThisWeek.map((t) => t.watchlist_item_id));
  const scheduledByDate = new Map();
  for (const t of watchlistTasksThisWeek) {
    if (!scheduledByDate.has(t.planned_date)) scheduledByDate.set(t.planned_date, []);
    scheduledByDate.get(t.planned_date).push(t);
  }

  const pool = items
    .filter((i) => i.status === "aktiv" && !scheduledItemIds.has(i.id))
    .sort((a, b) => a.sort_order - b.sort_order || (a.created_at < b.created_at ? -1 : 1));

  const assignments = [];
  const firstEntryThisRunByDate = new Map();

  const missingDates = weekDates.filter((d) => !scheduledByDate.has(d));
  for (const date of missingDates) {
    if (pool.length === 0) break;
    const item = pool.shift();
    assignments.push({ date, item });
    firstEntryThisRunByDate.set(date, item);
  }

  for (const date of weekDates) {
    if (pool.length === 0) break;
    const existing = scheduledByDate.get(date) ?? [];
    const firstEntryThisRun = firstEntryThisRunByDate.get(date);
    // Zweiter Slot ist nur für Tage mit genau einem (garantierten) ersten Eintrag definiert — Tage
    // ohne jeden Eintrag können hier nicht vorkommen (oben immer zuerst befüllt, solange Pool
    // reicht), Tage mit bereits 2+ Einträgen sind voll.
    if (existing.length + (firstEntryThisRun ? 1 : 0) !== 1) continue;

    const firstItem = firstEntryThisRun ?? itemsById.get(existing[0]?.watchlist_item_id);
    if (!firstItem) continue;
    const usedSoFar = (committedMinutesByDate[date] ?? 0) + getEffectiveDuration(firstItem);
    const candidate = pool[0];
    if (usedSoFar + getEffectiveDuration(candidate) > budgetForDate(date)) continue;

    pool.shift();
    assignments.push({ date, item: candidate });
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

// HINWEIS (Governance-Entscheidung 2026-07-25, siehe
// wissensdatenbank/features/watchlist-fernsehprogramm.md, Abschnitt "Zugang & Grundmechanik"):
// Diese Funktion wird aktuell NICHT mehr aufgerufen — die automatische Tagesplan-Einplanung von
// Watchlist-Einträgen ist in app.js deaktiviert (renderTodayView / renderFernsehprogrammView).
// Bewusst erhalten und getestet (test.js), damit die Tagesplan-Präsenz später ohne Neuaufbau
// zurückgeholt werden kann.
//
// Idempotenz-Pattern von autoplanDueHabits übernommen: legt für jedes Datum ohne bestehende
// Watchlist-Aufgabe eine neue tasks-Zeile an (planned_date=Datum, status='planned',
// watchlist_item_id gesetzt). effort bleibt NULL, siehe Kommentar in supabase/schema.sql —
// tasks.effort erlaubt nur 5/10/30/60, die Watchlist-Dauer würde den Check verletzen. Erneuter
// Aufruf für dieselbe Woche findet nichts mehr zu tun, sobald alle Tage belegt sind.
//
// Heute-Ansicht (nur [heute]) und Fernsehprogramm-Ansicht (ganze Woche) rufen das unabhängig
// voneinander auf und können fast gleichzeitig laufen. inFlight serialisiert überlappende Aufrufe
// in diesem Tab; der erneute DB-Read direkt vor dem Insert (statt dem ggf. veralteten
// allTasks-Parameter zu vertrauen) verhindert, dass der zweite Aufruf denselben Tag doppelt belegt.
let inFlight = null;
export async function autoplanWatchlistForDates(items, dates) {
  if (inFlight) await inFlight.catch(() => {});

  const run = (async () => {
    // Ein Query für alle Aufgaben dieser Tage statt nur Watchlist-Zeilen: dieselben Zeilen liefern
    // sowohl die bereits belegten Watchlist-Slots als auch, für die Kapazitätsprüfung im zweiten
    // Slot pro Tag (siehe planMissingSlots), die normalen Tagesaufgaben-Minuten.
    const { data: dayTasks, error: fetchError } = await supabase
      .from("tasks")
      .select("watchlist_item_id, planned_date, effort")
      .in("planned_date", dates);
    if (fetchError) throw fetchError;

    const freshTasks = dayTasks.filter((t) => t.watchlist_item_id != null);
    const committedMinutesByDate = {};
    for (const t of dayTasks) {
      if (t.watchlist_item_id != null || t.effort == null) continue;
      committedMinutesByDate[t.planned_date] = (committedMinutesByDate[t.planned_date] ?? 0) + t.effort;
    }

    const assignments = planMissingSlots(items, freshTasks, dates, committedMinutesByDate);
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
  })();

  inFlight = run;
  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

// Wendet buildSwapOperations() tatsächlich an.
export async function applyWatchlistSwap(slotA, slotB) {
  const operations = buildSwapOperations(slotA, slotB);
  for (const op of operations) {
    const { error } = await supabase.from("tasks").update(op.updates).eq("id", op.taskId);
    if (error) throw error;
  }
}

// ---------- Sender-Autopilot (broadcast_program & Co.) ----------
// Seit 2026-10-04 (migration-036.sql): das Fernsehprogramm kommt nicht mehr aus tasks-Zeilen
// (autoplanWatchlistForDates oben), sondern aus broadcast_program, das build_broadcast_week()
// serverseitig aus broadcast_slots + watch_candidate_scores + watch_events baut (Sonntag per pg_cron
// für die Folgewoche). Signale gehen als watchlist_viewing_log-Zeile mit program_entry_id zurück —
// der Trigger watch_learn_from_log hakt den Programmeintrag ab, zählt skip_streak, setzt bei
// Schnupper-Entscheidungen den Status und pflegt watch_interest_profile.

export async function listBroadcastProgram(fromIso, toIso) {
  const { data, error } = await supabase
    .from("broadcast_program")
    .select("*, event:watch_events(*)")
    .gte("air_date", fromIso)
    .lte("air_date", toIso)
    .order("air_date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listBroadcastSlots() {
  const { data, error } = await supabase
    .from("broadcast_slots")
    .select("*")
    .eq("active", true)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listUpcomingWatchEvents(limit = 8) {
  const { data, error } = await supabase
    .from("watch_events")
    .select("*")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function listInterestProfile() {
  const { data, error } = await supabase.from("watch_interest_profile").select("dimension, value, weight, signals");
  if (error) throw error;
  return data;
}

// Baut das Programm einer Woche (Mo-Start) neu. Löscht dabei nur 'geplant'-Einträge dieser Woche,
// bereits Gesehenes/Übersprungenes bleibt stehen.
export async function buildBroadcastWeek(weekStartIso) {
  const { data, error } = await supabase.rpc("build_broadcast_week", { p_week_start: weekStartIso });
  if (error) throw error;
  return data;
}

// Ein Signal zu einem Programmeintrag. Mit Watchlist-Item: Log-Zeile (Trigger erledigt Status,
// Skip-Zähler, Profil). Reine Termine (Live/Trailer ohne Item) haben nichts zu lernen — dort wird
// nur der Programmeintrag selbst abgehakt.
export async function logProgramSignal({ entry, item, kind, rating = null }) {
  if (!item) {
    const status = kind === "skipped" ? "uebersprungen" : "gesehen";
    const { error } = await supabase.from("broadcast_program").update({ status }).eq("id", entry.id);
    if (error) throw error;
    return null;
  }
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("watchlist_viewing_log")
    .insert({
      user_id: userId,
      watchlist_item_id: item.id,
      program_entry_id: entry.id,
      kind,
      rating,
      season: item.current_season,
      episode: item.current_episode,
    })
    .select()
    .single();
  if (error) throw error;
  if (advancesEpisode(item, kind)) {
    await updateWatchlistItem(item.id, { current_episode: (item.current_episode ?? 0) + 1 });
  }
  return data;
}

// Gleiche Regel wie promptWatchlistRating in app.js: nur Serien/Anime haben Folgen. sample_keep
// zählt mit, die Schnupperfolge wurde ja geschaut.
export function advancesEpisode(item, kind) {
  if (!item || ["film", "doku", "youtube"].includes(item.type)) return false;
  return ["watched", "binged", "sample_keep", "sample_drop"].includes(kind);
}

// "20:15:00" -> 1215 Minuten seit Mitternacht.
export function timeToMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + (m || 0);
}

// broadcast_slots.weekday: 1=Mo … 7=So.
export function isoWeekdayFromIso(iso) {
  return ((new Date(iso + "T00:00:00").getDay() + 6) % 7) + 1;
}

// Rollendes 7-Tage-Fenster ab heute statt Kalenderwoche: sonntags ist die neue Woche schon gebaut
// (pg_cron Sonntag 17 Uhr UTC), die Kalenderwoche wäre dann bis auf heute leer.
export function rollingDates(todayIso, days = 7) {
  const start = new Date(todayIso + "T00:00:00");
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return formatIsoDate(d);
  });
}

// Montage aller Wochen, die die Daten berühren — für build_broadcast_week, das wochenweise baut.
export function weekStartsFor(dates) {
  return [...new Set(dates.map((d) => currentWeekDates(d)[0]))];
}

// Laufende Sendung: Eintrag des heutigen Tages, dessen Start ≤ jetzt < Start + Dauer. Dauer aus
// dem Item (bzw. Typ-Standard), bei Terminen ohne Item 120 Min. (wie das Verdrängungsfenster in
// build_broadcast_week). -1 wenn nichts läuft.
export function findOnAirIndex(entries, itemsById, nowMinutes) {
  return entries.findIndex((e) => {
    if (e.status !== "geplant") return false;
    const start = timeToMinutes(e.start_time);
    const item = e.watchlist_item_id ? itemsById.get(e.watchlist_item_id) : null;
    const duration = item ? getEffectiveDuration(item) : 120;
    return nowMinutes >= start && nowMinutes < start + duration;
  });
}

// Welcher Eintrag ist beim Öffnen aufgeklappt: heute die laufende, sonst die nächste offene
// Sendung; an anderen Tagen keiner.
export function defaultOpenIndex(entries, itemsById, isToday, nowMinutes) {
  if (!isToday) return -1;
  const onAir = findOnAirIndex(entries, itemsById, nowMinutes);
  if (onAir !== -1) return onAir;
  return entries.findIndex((e) => e.status === "geplant" && timeToMinutes(e.start_time) >= nowMinutes);
}

// Slots eines Tages, die build_broadcast_week wegen eines Live-/Premieren-Termins übersprungen hat
// (gleiches Fenster: Termin-Start −30 Min. bis Ende bzw. +2 h). Nur für die Anzeige, damit ein
// fehlender Slot erklärt ist statt einfach zu verschwinden. 'frei'/'live'-Slots bleiben außen vor —
// die füllt der Autopilot ohnehin nie, dort fehlt also nichts.
export function findDisplacedSlots(slots, entries, dateIso) {
  const weekday = isoWeekdayFromIso(dateIso);
  const usedSlotIds = new Set(entries.map((e) => e.slot_id).filter(Boolean));
  const events = entries.filter((e) => e.event_id && ["live", "premiere"].includes(e.slot_kind));
  const result = [];
  for (const slot of slots) {
    if (slot.weekday !== weekday || usedSlotIds.has(slot.id) || ["frei", "live"].includes(slot.slot_kind)) continue;
    const slotMin = timeToMinutes(slot.start_time);
    const blocker = events.find((e) => {
      const start = timeToMinutes(e.start_time);
      const end = e.event?.ends_at ? minutesOfTimestamp(e.event.ends_at) : start + 120;
      return slotMin >= start - 30 && slotMin <= end;
    });
    if (blocker) result.push({ slot, blocker });
  }
  return result;
}

function minutesOfTimestamp(ts) {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

// Interessenprofil auf eine Zeile verdichten: über alle Dimensionen (Genre, Typ, Tag …) hinweg die
// zwei stärksten positiven und das schwächste negative Gewicht.
export function summarizeInterestProfile(rows, { up = 2, down = 1 } = {}) {
  const sorted = [...rows].filter((r) => Number(r.weight) !== 0).sort((a, b) => Number(b.weight) - Number(a.weight));
  return {
    up: sorted.filter((r) => Number(r.weight) > 0).slice(0, up),
    down: sorted.filter((r) => Number(r.weight) < 0).reverse().slice(0, down),
    all: sorted,
  };
}
