import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

// Task-Feedback (siehe wissensdatenbank/leben-os-betriebsmodell.md). Leichtes Rating (1–5) + optionale
// Notiz beim Abschluss einer Aufgabe. Die Deutung (Stammbaum-Vergleich) macht ein Skill, nicht die App.

export async function createTaskFeedback({ taskId, rating, note = null }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("task_feedback")
    .insert({ user_id: userId, task_id: taskId, rating, note })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTaskFeedback(taskId) {
  const { data, error } = await supabase
    .from("task_feedback")
    .select("*")
    .eq("task_id", taskId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
