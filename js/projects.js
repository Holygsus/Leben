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

export async function createProject({
  areaId,
  name,
  color = null,
  parentProjectId = null,
  isProject = false,
  status = "active",
}) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      area_id: areaId,
      parent_project_id: parentProjectId,
      name,
      color,
      is_project: isProject,
      status,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Baut aus der flachen Projektliste einen Baum (children pro Knoten), wahlweise gefiltert nach Bereich.
export function buildProjectTree(projects, areaId = null) {
  const scoped = areaId ? projects.filter((p) => p.area_id === areaId) : projects;
  const byParent = new Map();
  for (const p of scoped) {
    const key = p.parent_project_id || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(p);
  }
  const attach = (parentKey) =>
    (byParent.get(parentKey) || []).map((node) => ({
      ...node,
      children: attach(node.id),
    }));
  return attach("root");
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
