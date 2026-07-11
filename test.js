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
// Aktuelle Logik (planner.js): zufällig gemischt, dann stabil nach priority sortiert (high vor
// medium vor low), max. 2 pro Bereich, insgesamt max. 6 — und nur Top-Level-Aufgaben (Unteraufgaben
// laufen beim Einplanen automatisch mit, siehe planTaskCascade). Wegen des Zufalls-Shuffles testen
// wir Invarianten statt exakter Task-Listen.
{
  const base = { status: "open" };
  const tasks = [
    { ...base, id: "t1", area_id: "a1", priority: "medium", created_at: "2026-01-01" },
    { ...base, id: "t2", area_id: "a2", priority: "medium", created_at: "2026-01-02" },
    { ...base, id: "t3", area_id: "a3", priority: "medium", created_at: "2026-01-03" },
    { ...base, id: "done", area_id: "a4", priority: "medium", status: "done", created_at: "2026-01-01" },
    { ...base, id: "sub", area_id: "a5", priority: "medium", parent_task_id: "t1", created_at: "2026-01-01" },
  ];
  const selected = suggestTasksForPlan(tasks);
  assertEqual(selected.some((t) => t.id === "done"), false, "suggestTasksForPlan: erledigte Aufgaben werden ignoriert");
  assertEqual(selected.some((t) => t.id === "sub"), false, "suggestTasksForPlan: Unteraufgaben werden ignoriert (laufen kaskadiert mit)");

  const sameArea = [
    { ...base, id: "x1", area_id: "a1", priority: "medium", created_at: "2026-01-01" },
    { ...base, id: "x2", area_id: "a1", priority: "medium", created_at: "2026-01-02" },
    { ...base, id: "x3", area_id: "a1", priority: "medium", created_at: "2026-01-03" },
  ];
  const cappedSelection = suggestTasksForPlan(sameArea);
  assertEqual(cappedSelection.length, 2, "suggestTasksForPlan: max. 2 Aufgaben pro Bereich (Deckel greift)");

  const manyAreas = Array.from({ length: 10 }, (_, i) => ({
    ...base,
    id: "m" + i,
    area_id: "area" + i,
    priority: "medium",
    created_at: "2026-01-0" + (1 + (i % 9)),
  }));
  assertEqual(suggestTasksForPlan(manyAreas).length, 6, "suggestTasksForPlan: max. 6 Aufgaben insgesamt");

  // 3 "high" (je eigener Bereich) + 5 "low" (je eigener Bereich) = Pool von 8, Ziel 6 — die
  // Prioritätssortierung ist nicht zufällig, nur die Reihenfolge *innerhalb* gleicher Priorität.
  // Alle 3 "high" müssen deshalb deterministisch enthalten sein.
  const priorityPool = [
    ...Array.from({ length: 3 }, (_, i) => ({ ...base, id: "h" + i, area_id: "ha" + i, priority: "high", created_at: "2026-01-01" })),
    ...Array.from({ length: 5 }, (_, i) => ({ ...base, id: "l" + i, area_id: "la" + i, priority: "low", created_at: "2026-01-01" })),
  ];
  const prioritySelection = suggestTasksForPlan(priorityPool);
  assertEqual(prioritySelection.length, 6, "suggestTasksForPlan: Ziel von 6 wird bei ausreichend Kandidaten erreicht");
  assertEqual(
    ["h0", "h1", "h2"].every((id) => prioritySelection.some((t) => t.id === id)),
    true,
    "suggestTasksForPlan: alle 'high'-Prioritäten werden vor 'low' bevorzugt"
  );
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
