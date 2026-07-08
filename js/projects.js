import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listProjects({ areaId, status } = {}) {
  let query = supabase.from("projects").select("*").order("created_at", { ascending: true });
  if (areaId) query = query.eq("area_id", areaId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createProject({ areaId, name, color = null, status = "active" }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, area_id: areaId, name, color, status })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(id, updates) {
  const { data, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}
