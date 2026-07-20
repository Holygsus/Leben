import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listPantryItems() {
  const { data, error } = await supabase.from("pantry_items").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createPantryItem({ name, amount = null, category = null }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("pantry_items")
    .insert({ user_id: userId, name, amount, category })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePantryItem(id, updates) {
  const { data, error } = await supabase.from("pantry_items").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deletePantryItem(id) {
  const { error } = await supabase.from("pantry_items").delete().eq("id", id);
  if (error) throw error;
}
