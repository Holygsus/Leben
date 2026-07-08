import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listAreas() {
  const { data, error } = await supabase
    .from("areas")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createArea({ name, color, icon = null, sort_order = 0 }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("areas")
    .insert({ user_id: userId, name, color, icon, sort_order })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateArea(id, updates) {
  const { data, error } = await supabase
    .from("areas")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteArea(id) {
  const { error } = await supabase.from("areas").delete().eq("id", id);
  if (error) throw error;
}

// Vertauscht die sort_order zweier Bereiche (für Hoch/Runter-Sortierung).
export async function swapAreaOrder(a, b) {
  await updateArea(a.id, { sort_order: b.sort_order });
  await updateArea(b.id, { sort_order: a.sort_order });
}
