// Einmalige Datenmigration: wandelt bestehende Zeilen aus der (bald wegfallenden) "projects"-
// Tabelle in Aufgaben mit parent_task_id um und haengt Aufgaben, die bisher auf project_id
// zeigten, auf ihre neue uebergeordnete Aufgabe um.
//
// Voraussetzung: migration-002.sql wurde bereits im Supabase SQL Editor ausgefuehrt
// (tasks.parent_task_id / tasks.is_pinned / tasks.migrated_from_project_id existieren).
//
// Anwendung: Diese Datei temporaer in app.js importieren (z.B. `import "./migrate-projects.js";`
// direkt unter den anderen Imports), die App im Browser oeffnen, einloggen, und in der
// Devtools-Konsole `await runProjectMigration()` aufrufen. Vorher unbedingt ein Backup der
// Tabellen "projects" und "tasks" ziehen (Supabase SQL Editor: select * from projects / tasks).
// Nach erfolgreicher, visuell geprueter Migration den Import wieder entfernen und diese Datei
// loeschen; migration-003.sql entfernt anschliessend project_id/migrated_from_project_id/projects.

import { supabase } from "./supabase.js";

function mapProjectStatus(status) {
  return status === "active" ? "open" : "done";
}

async function migrateProjectNode(project, newParentTaskId, childrenByParent, newIdByOldProjectId, insertedTasks) {
  const status = mapProjectStatus(project.status);
  const { data: inserted, error } = await supabase
    .from("tasks")
    .insert({
      user_id: project.user_id,
      area_id: project.area_id,
      parent_task_id: newParentTaskId,
      title: project.name,
      status,
      is_pinned: project.is_project,
      migrated_from_project_id: project.id,
      created_at: project.created_at,
    })
    .select()
    .single();
  if (error) throw error;

  newIdByOldProjectId.set(project.id, inserted.id);
  insertedTasks.push(inserted);
  console.log(`Migriert: "${project.name}" (${project.status}) -> Task ${inserted.id}`);

  for (const child of childrenByParent.get(project.id) || []) {
    await migrateProjectNode(child, inserted.id, childrenByParent, newIdByOldProjectId, insertedTasks);
  }
}

export async function runProjectMigration() {
  const { data: projects, error: projectsError } = await supabase.from("projects").select("*");
  if (projectsError) throw projectsError;
  const { data: tasks, error: tasksError } = await supabase.from("tasks").select("*");
  if (tasksError) throw tasksError;

  const childrenByParent = new Map();
  for (const p of projects) {
    const key = p.parent_project_id || "root";
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(p);
  }

  const newIdByOldProjectId = new Map();
  const insertedTasks = [];
  for (const root of childrenByParent.get("root") || []) {
    await migrateProjectNode(root, null, childrenByParent, newIdByOldProjectId, insertedTasks);
  }

  let reparentedCount = 0;
  for (const t of tasks) {
    if (!t.project_id) continue;
    const newParentId = newIdByOldProjectId.get(t.project_id);
    if (!newParentId) {
      console.warn(`Aufgabe ${t.id} ("${t.title}") verweist auf unbekanntes Projekt ${t.project_id} — uebersprungen.`);
      continue;
    }
    const { error } = await supabase.from("tasks").update({ parent_task_id: newParentId }).eq("id", t.id);
    if (error) throw error;
    reparentedCount += 1;
  }

  // Invariante "Eltern erledigt => alle Nachfahren erledigt" fuer migrierte done-Knoten herstellen,
  // damit die App-UI (die diese Invariante beim Filtern voraussetzt) von Anfang an konsistent ist.
  const { data: allTasksAfter, error: afterError } = await supabase.from("tasks").select("*");
  if (afterError) throw afterError;
  let cascadedCount = 0;
  for (const t of insertedTasks.filter((x) => x.status === "done")) {
    const descendantIds = [];
    const walk = (id) => {
      for (const other of allTasksAfter) {
        if (other.parent_task_id === id) {
          descendantIds.push(other.id);
          walk(other.id);
        }
      }
    };
    walk(t.id);
    if (descendantIds.length) {
      const { error } = await supabase.from("tasks").update({ status: "done" }).in("id", descendantIds);
      if (error) throw error;
      cascadedCount += descendantIds.length;
    }
  }

  console.log(
    `Migration abgeschlossen: ${insertedTasks.length} Projekte migriert, ${reparentedCount} Aufgaben umgehaengt, ${cascadedCount} Nachfahren kaskadiert auf "done".`
  );
  console.table(
    projects.map((p) => ({
      name: p.name,
      status: p.status,
      is_project: p.is_project,
      neue_task_id: newIdByOldProjectId.get(p.id) || "(uebersprungen)",
    }))
  );
  return { migratedCount: insertedTasks.length, reparentedCount, cascadedCount };
}

window.runProjectMigration = runProjectMigration;
