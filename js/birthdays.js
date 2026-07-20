import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listBirthdays() {
  const { data, error } = await supabase.from("birthdays").select("*");
  if (error) throw error;
  return data;
}

export async function createBirthday({ name, day, month, year = null, isImportant = false }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("birthdays")
    .insert({ user_id: userId, name, day, month, year, is_important: isImportant })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBirthday(id, updates) {
  const { data, error } = await supabase.from("birthdays").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBirthday(id) {
  const { error } = await supabase.from("birthdays").delete().eq("id", id);
  if (error) throw error;
}

// Datum der nächsten jährlichen Wiederkehr von day/month ab today — kann noch dieses oder schon
// nächstes Kalenderjahr liegen. Einzige Quelle für "wann als Nächstes", damit Sortierung und
// Altersanzeige nicht auseinanderlaufen (Alter = nextOccurrence().getFullYear() - birthYear).
export function nextOccurrence(day, month, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const next = new Date(today.getFullYear(), month - 1, day);
  if (next < start) next.setFullYear(today.getFullYear() + 1);
  return next;
}

export function daysUntilNextOccurrence(day, month, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((nextOccurrence(day, month, today) - start) / (1000 * 60 * 60 * 24));
}
