import { buildTaskTree, collectDescendantIds, countDescendantsRecursive } from "./js/tasks.js";
import { suggestTasksForPlan, formatTasksForExport } from "./js/planner.js";

const results = document.getElementById("results");
let passCount = 0;
let failCount = 0;

function assertEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  const pass = actualJson === expectedJson;
  const row = document.createElement("div");
  row.className = "result " + (pass ? "pass" : "fail");
  row.textContent = pass
    ? `✓ ${label}`
    : `✗ ${label} — erwartet ${expectedJson}, bekommen ${actualJson}`;
  results.appendChild(row);
  if (pass) passCount++;
  else failCount++;
}

// ---------- buildTaskTree ----------
{
  const tasks = [
    { id: "1", parent_task_id: null, title: "Root A" },
    { id: "2", parent_task_id: "1", title: "Child of A" },
    { id: "3", parent_task_id: null, title: "Root B" },
    { id: "4", parent_task_id: "2", title: "Grandchild" },
  ];
  const tree = buildTaskTree(tasks, null);
  assertEqual(tree.length, 2, "buildTaskTree: zwei Wurzelknoten");
  assertEqual(tree[0].children.length, 1, "buildTaskTree: Root A hat ein Kind");
  assertEqual(tree[0].children[0].children[0].title, "Grandchild", "buildTaskTree: Enkel korrekt verschachtelt");
  assertEqual(buildTaskTree([], null).length, 0, "buildTaskTree: leere Liste ergibt leeren Baum");
}

// ---------- collectDescendantIds ----------
{
  const tasks = [
    { id: "1", parent_task_id: null },
    { id: "2", parent_task_id: "1" },
    { id: "3", parent_task_id: "2" },
    { id: "4", parent_task_id: null },
  ];
  const ids = collectDescendantIds(tasks, "1");
  assertEqual([...ids].sort(), ["2", "3"], "collectDescendantIds: findet transitive Nachfahren");
  assertEqual([...collectDescendantIds(tasks, "4")], [], "collectDescendantIds: Blatt ohne Kinder ist leer");
  assertEqual(countDescendantsRecursive("1", tasks), 2, "countDescendantsRecursive: zählt transitive Nachfahren");
}

// ---------- suggestTasksForPlan ----------
{
  const base = { status: "open", area_id: "a1" };
  const tasks = [
    { ...base, id: "e5", effort: 5, created_at: "2026-01-01" },
    { ...base, id: "e10-1", effort: 10, created_at: "2026-01-02" },
    { ...base, id: "e10-2", effort: 10, created_at: "2026-01-03", area_id: "a2" },
    { ...base, id: "e10-3", effort: 10, created_at: "2026-01-04", area_id: "a3" },
    { ...base, id: "e30", effort: 30, created_at: "2026-01-05", area_id: "a4" },
    { ...base, id: "done", effort: 5, created_at: "2026-01-01", status: "done" },
  ];
  const selected = suggestTasksForPlan(tasks);
  assertEqual(selected.some((t) => t.id === "done"), false, "suggestTasksForPlan: erledigte Aufgaben werden ignoriert");
  assertEqual(selected.filter((t) => t.effort === 5).length, 1, "suggestTasksForPlan: genau ein 5-Min-Task");
  assertEqual(selected.filter((t) => t.effort === 10).length, 2, "suggestTasksForPlan: genau zwei 10-Min-Tasks");
  assertEqual(selected.filter((t) => t.effort === 30 || t.effort === 60).length, 1, "suggestTasksForPlan: genau ein 30/60-Min-Task");

  const sameArea = [
    { ...base, id: "x1", effort: 10, created_at: "2026-01-01" },
    { ...base, id: "x2", effort: 10, created_at: "2026-01-02" },
    { ...base, id: "x3", effort: 10, created_at: "2026-01-03" },
  ];
  const cappedSelection = suggestTasksForPlan(sameArea);
  assertEqual(cappedSelection.length, 2, "suggestTasksForPlan: max. 2 Aufgaben pro Bereich (Deckel greift)");
}

// ---------- formatTasksForExport ----------
{
  assertEqual(formatTasksForExport([], {}), "Keine offenen Aufgaben.", "formatTasksForExport: leere Liste");
  const text = formatTasksForExport(
    [{ title: "Steuererklärung", effort: 30, area_id: "a1" }],
    { a1: "Finanzen" }
  );
  assertEqual(text, "- [30 min] Steuererklärung — Finanzen", "formatTasksForExport: Bereich wird angehängt");
  const textNoArea = formatTasksForExport([{ title: "Lose Aufgabe", effort: null, area_id: null }], {});
  assertEqual(textNoArea, "- [?] Lose Aufgabe", "formatTasksForExport: ohne Aufwand/Bereich");
}

const summary = document.getElementById("summary");
summary.textContent = `${passCount} bestanden, ${failCount} fehlgeschlagen.`;
summary.style.color = failCount > 0 ? "var(--color-danger)" : "var(--color-success)";
