import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

// Reiseplanung — Trips + Trip-Items (siehe wissensdatenbank/features/reiseplanung.md). CRUD-Muster
// exakt wie games.js/pantry.js. Pool = trip_items ohne day_number (status 'kandidat'); Tageszuweisung
// setzt day_number + status 'eingeplant'.

// ---------- Trips ----------

export async function listTrips() {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createTrip({ title, destination = null, dateFrom = null, dateTo = null, status = "geplant", sortOrder = 0 }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("trips")
    .insert({ user_id: userId, title, destination, date_from: dateFrom, date_to: dateTo, status, sort_order: sortOrder })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTrip(id, updates) {
  const { data, error } = await supabase.from("trips").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTrip(id) {
  const { error } = await supabase.from("trips").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Trip-Items ----------

export async function listTripItems(tripId) {
  const { data, error } = await supabase
    .from("trip_items")
    .select("*")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createTripItem({ tripId, title, status = "kandidat", dayNumber = null, timeSlot = null, category = null, notes = null, link = null, sortOrder = 0 }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("trip_items")
    .insert({
      user_id: userId,
      trip_id: tripId,
      title,
      status,
      day_number: dayNumber,
      time_slot: timeSlot,
      category,
      notes,
      link,
      sort_order: sortOrder,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTripItem(id, updates) {
  const { data, error } = await supabase.from("trip_items").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTripItem(id) {
  const { error } = await supabase.from("trip_items").delete().eq("id", id);
  if (error) throw error;
}
