import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function getReflectionForDate(date) {
  const { data, error } = await supabase.from("daily_reflections").select("*").eq("date", date).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createReflection({ date, mood, note = null }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("daily_reflections")
    .insert({ user_id: userId, date, mood, note })
    .select()
    .single();
  if (error) throw error;
  return data;
}
