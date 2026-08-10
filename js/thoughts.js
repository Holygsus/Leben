import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

// Gedanken-Eingang (siehe wissensdatenbank/leben-os-betriebsmodell.md). Ein `thought` ist rohes,
// noch unklassifiziertes Material — der Daily Pulse deutet/routet es später. Hier nur Erfassen +
// Auslesen; die Verarbeitung (status 'raw' -> 'processed') macht der Pulse-Skill.

export async function createThought({ body }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("thoughts")
    .insert({ user_id: userId, body })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listThoughts(status = null) {
  let query = supabase.from("thoughts").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
