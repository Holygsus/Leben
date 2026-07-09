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

// Alle Nachfahren-IDs eines Knotens entlang parent_project_id (nicht den Knoten selbst).
// Grundlage für den Zyklus-Schutz beim Verschieben und die rekursive Aufgaben-Zählung.
export function collectDescendantIds(projects, rootId) {
  const ids = new Set();
  const walk = (id) => {
    for (const p of projects) {
      if (p.parent_project_id === id) {
        ids.add(p.id);
        walk(p.id);
      }
    }
  };
  walk(rootId);
  return ids;
}

// Zählt Aufgaben eines Projekts inklusive aller Unterordner/Unterprojekte.
export function countTasksRecursive(projectId, tasks, projects) {
  const scope = collectDescendantIds(projects, projectId);
  scope.add(projectId);
  return tasks.filter((t) => t.project_id && scope.has(t.project_id)).length;
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
