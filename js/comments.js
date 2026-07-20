import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listComments(taskId) {
  const { data, error } = await supabase
    .from("task_comments")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// Batch-Fetch für den dezenten Indikator in der Übersicht — ein Request statt N+1, analog
// listAllViewingLogEntries in watchlist.js.
export async function listAllCommentedTaskIds() {
  const { data, error } = await supabase.from("task_comments").select("task_id");
  if (error) throw error;
  return new Set(data.map((c) => c.task_id));
}

export async function createComment({ taskId, body }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("task_comments")
    .insert({ user_id: userId, task_id: taskId, body })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(id) {
  const { error } = await supabase.from("task_comments").delete().eq("id", id);
  if (error) throw error;
}
