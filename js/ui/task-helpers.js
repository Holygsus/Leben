// Reine Aufgaben-Helfer: Fälligkeit, Sortierung, Baum-Filter.
import { todayISO, tomorrowISO } from "./dates.js";

// Ein Plandatum in der Vergangenheit, das noch nicht erledigt ist — unabhängig davon ob der
// Status noch "open" oder schon "planned" ist (beides ist über das Detail-Modal frei kombinierbar).
export function isTaskOverdue(task) {
  return task.status !== "done" && !!task.planned_date && task.planned_date < todayISO();
}

// Vorwarnstufe zwischen "normal" und "überfällig" — heute/morgen fällig, aber noch nicht in der
// Vergangenheit. Mit isTaskOverdue() zusammen deckt das lückenlos alle geplanten, offenen Aufgaben
// ab (kein Datum kann gleichzeitig beides sein).
export function isTaskDueSoon(task) {
  if (task.status === "done" || !task.planned_date) return false;
  const today = todayISO();
  return task.planned_date === today || task.planned_date === tomorrowISO();
}

// Sortiert nach Dringlichkeit: überfällige/nahe Plandaten zuerst (aufsteigend), undatierte
// Aufgaben zuletzt — unter sich wie bisher nach Erstellungsdatum (älteste zuerst).
export function compareByUrgency(a, b) {
  if (a.planned_date && b.planned_date) {
    return a.planned_date < b.planned_date ? -1 : a.planned_date > b.planned_date ? 1 : 0;
  }
  if (a.planned_date) return -1;
  if (b.planned_date) return 1;
  return new Date(a.created_at) - new Date(b.created_at);
}

// Priorität soll nur in Heute etwas bewirken — dort aber ohne eigenes Icon/Badge: die
// höchstpriorisierte Aufgabe steht einfach ganz oben. Innerhalb derselben Priorität bleibt die
// bisherige Dringlichkeits-Reihenfolge erhalten (compareByUrgency als Tiebreaker). Erledigte
// Aufgaben rutschen zuerst gebündelt ans Ende, statt an ihrer Prioritäts-Position stehen zu bleiben
// — sonst wirkt die Liste bei jedem erneuten Aufruf von Heute wie "durcheinandergewürfelt".
const PRIORITY_RANK = { high: 2, medium: 1, low: 0 };
export function compareByPriority(a, b) {
  const doneDiff = (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0);
  if (doneDiff !== 0) return doneDiff;
  const diff = (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1);
  return diff !== 0 ? diff : compareByUrgency(a, b);
}

// Baut aus einem Aufgabenbaum (siehe buildTaskTree) einen zugeschnittenen Baum: ein Knoten
// bleibt, wenn er selbst `predicate` erfüllt ODER mindestens ein Nachfahre es tut — sonst würde
// z.B. eine passende Unteraufgabe verschwinden, nur weil ihr Elternteil nicht matcht. Genutzt
// für die Übersicht-Filter (taskPassesFilter) und für die Heute-Gruppierung (todayIds-Mitgliedschaft).
export function filterTreeNodes(nodes, predicate) {
  const out = [];
  for (const node of nodes) {
    const children = filterTreeNodes(node.children, predicate);
    if (predicate(node) || children.length > 0) out.push({ ...node, children });
  }
  return out;
}
