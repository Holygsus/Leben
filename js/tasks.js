import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listTasks({ areaId, projectId, status, effort, isBrainstorm, plannedDate } = {}) {
  let query = supabase.from("tasks").select("*").order("created_at", { ascending: true });
  if (areaId) query = query.eq("area_id", areaId);
  if (projectId) query = query.eq("project_id", projectId);
  if (status) query = query.eq("status", status);
  if (effort) query = query.eq("effort", effort);
  if (isBrainstorm !== undefined) query = query.eq("is_brainstorm", isBrainstorm);
  if (plannedDate) query = query.eq("planned_date", plannedDate);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createTask({
  title,
  areaId = null,
  projectId = null,
  effort = null,
  status = "open",
  plannedDate = null,
  isBrainstorm = false,
}) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      area_id: areaId,
      project_id: projectId,
      title,
      effort,
      status,
      planned_date: plannedDate,
      is_brainstorm: isBrainstorm,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, updates) {
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}
