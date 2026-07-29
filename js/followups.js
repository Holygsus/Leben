import { supabase } from "./supabase.js";
import { createTask } from "./tasks.js";

// Folgeaufgaben-Vorschläge (wissensdatenbank/features/folgeaufgaben-vorschlaege.md).
// Der manuell ausgelöste Skill schreibt Vorschläge in task_followup_suggestions (status 'open');
// dieses Modul liest sie für das "Neue Vorschläge"-Popup und übernimmt bzw. verwirft die Auswahl.

// Lädt die aktuell offenen Vorschläge, gruppiert nach der erledigten Ursprungsaufgabe.
// Rückgabe: [{ sourceTask: {id, title}, suggestions: [row, ...] }], neueste Aufgabe zuerst.
export async function listOpenFollowupGroups() {
  const { data: suggestions, error } = await supabase
    .from("task_followup_suggestions")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!suggestions || suggestions.length === 0) return [];

  const sourceIds = [...new Set(suggestions.map((s) => s.source_task_id))];
  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id, title")
    .in("id", sourceIds);
  if (taskError) throw taskError;
  const titleById = new Map((tasks || []).map((t) => [t.id, t.title]));

  // Gruppen in der Reihenfolge des jeweils ersten Vorschlags aufbauen.
  const groups = new Map();
  for (const s of suggestions) {
    if (!groups.has(s.source_task_id)) {
      groups.set(s.source_task_id, {
        sourceTask: { id: s.source_task_id, title: titleById.get(s.source_task_id) || "Erledigte Aufgabe" },
        suggestions: [],
      });
    }
    groups.get(s.source_task_id).suggestions.push(s);
  }
  return [...groups.values()];
}

// Anzahl erledigter Aufgaben mit offenen Vorschlägen (für die Cockpit-Kachel + Auto-Popup-Gate).
export async function countOpenFollowups() {
  const { data, error } = await supabase
    .from("task_followup_suggestions")
    .select("source_task_id")
    .eq("status", "open");
  if (error) throw error;
  return new Set((data || []).map((s) => s.source_task_id)).size;
}

// Übernimmt die angehakten Vorschläge einer Gruppe als echte Aufgaben, verwirft den Rest und
// schließt die Ursprungsaufgabe endgültig ab (followup_status='closed' → nie wieder Vorschläge).
// acceptedIds = Menge der angehakten Vorschlags-IDs (kann leer sein → nichts übernommen).
export async function resolveFollowupGroup(group, acceptedIds) {
  const accepted = new Set(acceptedIds);
  for (const s of group.suggestions) {
    if (accepted.has(s.id)) {
      await createTask({
        title: s.title,
        areaId: s.area_id,
        effort: s.effort,
        followupSourceId: s.source_task_id,
      });
      await updateSuggestionStatus(s.id, "accepted");
    } else {
      await updateSuggestionStatus(s.id, "dismissed");
    }
  }
  const { error } = await supabase
    .from("tasks")
    .update({ followup_status: "closed" })
    .eq("id", group.sourceTask.id);
  if (error) throw error;
}

async function updateSuggestionStatus(id, status) {
  const { error } = await supabase
    .from("task_followup_suggestions")
    .update({ status })
    .eq("id", id);
  if (error) throw error;
}
