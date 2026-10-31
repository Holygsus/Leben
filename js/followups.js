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
  // Gleiche topic_title innerhalb einer Gruppe → eine gemeinsame Kopfaufgabe statt Dubletten.
  const headCache = new Map();
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
      await acceptSuggestion(s, s.placement === "new_root" ? null : head, headCache);
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
// deepen/new_root die ID der neuen Kopfaufgabe zurück, bei sibling die des neuen Schritts (für
// created_task_id — so lässt sich auch bei normalen Schritten messen, ob Übernommenes erledigt wird).
// Unter einer Kopfaufgabe erbt alles deren Bereich: die Übersicht baut den Baum je Bereich, ein
// Kind mit abweichendem area_id wäre dort unsichtbar (vgl. cascadeAreaChange in js/tasks.js).
// headCache (optional): Map über einen Annahme-Vorgang hinweg. Mehrere Vorschläge mit gleicher
// topic_title am gleichen Ort (Zweige eines Themas, Spinnennetz-Regel) teilen sich so eine
// Kopfaufgabe, statt je eine eigene anzulegen.
async function createFromSuggestion(suggestion, parent, headCache = new Map()) {
  const s = parent ? { ...suggestion, area_id: parent.area_id } : suggestion;
  const parentId = parent ? parent.id : null;
  const followupSourceId = s.source_task_id || null;
  if (s.placement === "deepen" || s.placement === "new_root") {
    // effort nur auf dem Schritt — die Kopfaufgabe ist ein Container, kein Plan-Kandidat.
    const headKey = `${parentId || "root"}|${s.area_id || ""}|${s.topic_title}`;
    let head = headCache.get(headKey) || (await findExistingHead(s, parentId));
    if (!head) {
      head = await createTask({
        title: s.topic_title,
        areaId: s.area_id,
        isBrainstorm: !s.area_id,
        parentTaskId: parentId,
        followupSourceId,
      });
    }
    headCache.set(headKey, head);
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
  const step = await createTask({
    title: s.title,
    areaId: s.area_id,
    isBrainstorm: !s.area_id,
    effort: s.effort,
    parentTaskId: parentId,
    followupSourceId,
  });
  return step.id;
}

// Sucht eine schon angelegte Kopfaufgabe gleichen Themas am gleichen Ort, z. B. aus einer früheren,
// mittendrin abgebrochenen Annahme (headCache gilt nur für einen Vorgang, das Popup kommt danach mit
// den Resten wieder). Weg dorthin: angenommene deepen/new_root-Vorschläge mit gleicher topic_title,
// deren created_task_id die Kopfaufgabe ist. Gelöschte Aufgaben fallen von selbst heraus
// (created_task_id ist on delete set null), erledigte bewusst auch — dann beginnt ein neuer Stamm.
async function findExistingHead(s, parentId) {
  if (!s.topic_title) return null;
  const { data: rows, error } = await supabase
    .from("task_followup_suggestions")
    .select("created_task_id")
    .eq("status", "accepted")
    .eq("topic_title", s.topic_title)
    .in("placement", ["deepen", "new_root"])
    .not("created_task_id", "is", null);
  if (error) throw error;
  const ids = [...new Set((rows || []).map((r) => r.created_task_id))];
  if (ids.length === 0) return null;
  let query = supabase.from("tasks").select("id, area_id").in("id", ids).neq("status", "done");
  query = parentId ? query.eq("parent_task_id", parentId) : query.is("parent_task_id", null);
  query = s.area_id ? query.eq("area_id", s.area_id) : query.is("area_id", null);
  const { data: heads, error: headError } = await query.limit(1);
  if (headError) throw headError;
  return heads && heads.length ? heads[0] : null;
}

// Nimmt einen Vorschlag an: erst per bedingtem Update von 'open' auf 'accepted' beanspruchen, dann
// anlegen. Läuft dieselbe Annahme ein zweites Mal (Abbruch mittendrin + Popup erneut, Doppeltipp),
// ist der Vorschlag schon beansprucht und es entsteht nichts doppelt. Bricht es genau zwischen
// Beanspruchen und Anlegen ab, fehlt im schlimmsten Fall dieser eine Schritt — keine Dublette.
async function acceptSuggestion(s, parent, headCache) {
  const { data: claimed, error } = await supabase
    .from("task_followup_suggestions")
    .update({ status: "accepted" })
    .eq("id", s.id)
    .eq("status", "open")
    .select("id");
  if (error) throw error;
  if (!claimed || claimed.length === 0) return;
  const createdTaskId = await createFromSuggestion(s, parent, headCache);
  await updateSuggestion(s.id, { created_task_id: createdTaskId });
}

// ----- Erstaufgaben ("Neue Mutteraufgaben") -----
// kind='erstaufgabe', placement='new_root': Pulse schlägt ein ganz neues Thema vor. Übernehmen legt
// eine Top-Level-Kopfaufgabe topic_title mit dem ersten Schritt title darunter an. Mehrere Zeilen mit
// gleicher topic_title sind Zweige desselben Themas: eine Kopfaufgabe, jeder angehakte Zweig darunter.

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
  const headCache = new Map();
  for (const s of suggestions) {
    if (accepted.has(s.id)) {
      await acceptSuggestion(s, null, headCache);
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
