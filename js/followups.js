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
    .eq("kind", "folge")
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!suggestions || suggestions.length === 0) return [];

  const sourceIds = [...new Set(suggestions.map((s) => s.source_task_id))];
  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, parent_task_id")
    .in("id", sourceIds);
  if (taskError) throw taskError;
  const titleById = new Map((tasks || []).map((t) => [t.id, t.title]));
  const parentById = new Map((tasks || []).map((t) => [t.id, t.parent_task_id]));

  // Gruppen in der Reihenfolge des jeweils ersten Vorschlags aufbauen.
  const groups = new Map();
  for (const s of suggestions) {
    if (!groups.has(s.source_task_id)) {
      groups.set(s.source_task_id, {
        sourceTask: {
          id: s.source_task_id,
          title: titleById.get(s.source_task_id) || "Erledigte Aufgabe",
          parentTaskId: parentById.get(s.source_task_id) || null,
        },
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
    .eq("kind", "folge")
    .eq("status", "open");
  if (error) throw error;
  return new Set((data || []).map((s) => s.source_task_id)).size;
}

// Übernimmt die angehakten Vorschläge einer Gruppe als echte Aufgaben, verwirft den Rest und
// schließt die Ursprungsaufgabe endgültig ab (followup_status='closed' → nie wieder Vorschläge).
// acceptedIds = Menge der angehakten Vorschlags-IDs (kann leer sein → nichts übernommen).
export async function resolveFollowupGroup(group, acceptedIds) {
  const accepted = new Set(acceptedIds);
  // Themenbaum (wissensdatenbank/features/folgeaufgaben-vorschlaege.md): die Kopfaufgabe des
  // erledigten Schritts ist dessen Mutter; Altbestand ohne Mutter → die Ursprungsaufgabe selbst.
  // sibling hängt den neuen Schritt direkt darunter, deepen legt darunter eine neue Kopfaufgabe
  // topic_title an und den Schritt in diese. new_root (Abzweigung) löst sich vom Stamm: neue
  // Top-Level-Kopfaufgabe im Bereich des Vorschlags, Herkunft nur noch über followup_source_id.
  const headId = group.sourceTask.parentTaskId || group.sourceTask.id;
  let head = null;
  if (group.suggestions.some((s) => accepted.has(s.id))) {
    const { data, error: headError } = await supabase
      .from("tasks")
      .select("id, area_id")
      .eq("id", headId)
      .maybeSingle();
    if (headError) throw headError;
    head = data || { id: headId, area_id: null };
  }
  for (const s of group.suggestions) {
    if (accepted.has(s.id)) {
      const createdTaskId = await createFromSuggestion(s, s.placement === "new_root" ? null : head);
      await updateSuggestion(s.id, { status: "accepted", created_task_id: createdTaskId });
    } else {
      await updateSuggestion(s.id, { status: "dismissed" });
    }
  }
  const { error } = await supabase
    .from("tasks")
    .update({ followup_status: "closed" })
    .eq("id", group.sourceTask.id);
  if (error) throw error;
}

// Legt die Aufgabe(n) zu einem Vorschlag an. Rollen: parent_task_id = Struktur innerhalb eines
// Stamms, followup_source_id = Herkunft (auch über Stammgrenzen hinweg, z. B. bei Abzweigungen). parent = Kopfaufgabe {id, area_id}, unter die der
// Vorschlag gehört (null bei new_root → Top-Level im Bereich area_id des Vorschlags). Gibt bei
// deepen/new_root die ID der neuen Kopfaufgabe zurück (für created_task_id), bei sibling null.
// Unter einer Kopfaufgabe erbt alles deren Bereich: die Übersicht baut den Baum je Bereich, ein
// Kind mit abweichendem area_id wäre dort unsichtbar (vgl. cascadeAreaChange in js/tasks.js).
async function createFromSuggestion(suggestion, parent) {
  const s = parent ? { ...suggestion, area_id: parent.area_id } : suggestion;
  const parentId = parent ? parent.id : null;
  const followupSourceId = s.source_task_id || null;
  if (s.placement === "deepen" || s.placement === "new_root") {
    // effort nur auf dem Schritt — die Kopfaufgabe ist ein Container, kein Plan-Kandidat.
    const head = await createTask({
      title: s.topic_title,
      areaId: s.area_id,
      isBrainstorm: !s.area_id,
      parentTaskId: parentId,
      followupSourceId,
    });
    await createTask({
      title: s.title,
      areaId: s.area_id,
      isBrainstorm: !s.area_id,
      effort: s.effort,
      parentTaskId: head.id,
      followupSourceId,
    });
    return head.id;
  }
  await createTask({
    title: s.title,
    areaId: s.area_id,
    isBrainstorm: !s.area_id,
    effort: s.effort,
    parentTaskId: parentId,
    followupSourceId,
  });
  return null;
}

// ----- Erstaufgaben ("Neue Mutteraufgaben") -----
// kind='erstaufgabe', placement='new_root': Pulse schlägt ein ganz neues Thema vor. Übernehmen legt
// eine Top-Level-Kopfaufgabe topic_title mit dem ersten Schritt title darunter an.

export async function listOpenErstaufgaben() {
  const { data, error } = await supabase
    .from("task_followup_suggestions")
    .select("*")
    .eq("kind", "erstaufgabe")
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function countOpenErstaufgaben() {
  const { count, error } = await supabase
    .from("task_followup_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("kind", "erstaufgabe")
    .eq("status", "open");
  if (error) throw error;
  return count || 0;
}

// Übernimmt die angehakten Erstaufgaben, verwirft alle übrigen angezeigten.
export async function resolveErstaufgaben(suggestions, acceptedIds) {
  const accepted = new Set(acceptedIds);
  for (const s of suggestions) {
    if (accepted.has(s.id)) {
      const createdTaskId = await createFromSuggestion(s, null);
      await updateSuggestion(s.id, { status: "accepted", created_task_id: createdTaskId });
    } else {
      await updateSuggestion(s.id, { status: "dismissed" });
    }
  }
}

async function updateSuggestion(id, updates) {
  const { error } = await supabase
    .from("task_followup_suggestions")
    .update(updates)
    .eq("id", id);
  if (error) throw error;
}
