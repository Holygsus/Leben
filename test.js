import { buildTaskTree, collectDescendantIds, countDescendantsRecursive } from "./js/tasks.js";
import { suggestTasksForPlan, formatTasksForExport } from "./js/planner.js";
import {
  DEFAULT_DURATION_MIN,
  isWatchlistTask,
  getEffectiveDuration,
  computeAverageRating,
  filterWatchlistItems,
  currentWeekDates,
  planMissingSlots,
  buildSwapOperations,
} from "./js/watchlist.js";

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

// ---------- Watchlist: isWatchlistTask / getEffectiveDuration ----------
{
  assertEqual(isWatchlistTask({ watchlist_item_id: "w1" }), true, "isWatchlistTask: erkennt gesetzte FK");
  assertEqual(isWatchlistTask({ watchlist_item_id: null }), false, "isWatchlistTask: null ist keine Watchlist-Aufgabe");

  assertEqual(getEffectiveDuration({ type: "serie", duration_minutes: null }), DEFAULT_DURATION_MIN.serie, "getEffectiveDuration: Serie-Standard 45 Min.");
  assertEqual(getEffectiveDuration({ type: "anime", duration_minutes: null }), DEFAULT_DURATION_MIN.anime, "getEffectiveDuration: Anime-Standard 20 Min.");
  assertEqual(getEffectiveDuration({ type: "film", duration_minutes: null }), DEFAULT_DURATION_MIN.film, "getEffectiveDuration: Film-Standard 90 Min.");
  assertEqual(getEffectiveDuration({ type: "serie", duration_minutes: 25 }), 25, "getEffectiveDuration: manueller Override schlägt Typ-Standard");
}

// ---------- Watchlist: computeAverageRating ----------
{
  assertEqual(computeAverageRating([]), null, "computeAverageRating: keine Sichtungen ergibt null");
  assertEqual(computeAverageRating([{ rating: null }, { rating: null }]), null, "computeAverageRating: nur übersprungene Bewertungen ergibt null");
  assertEqual(computeAverageRating([{ rating: "up" }, { rating: "up" }, { rating: "down" }]), 2 / 3, "computeAverageRating: Anteil positiver Bewertungen");
  assertEqual(
    computeAverageRating([{ rating: "up" }, { rating: null }, { rating: "down" }]),
    0.5,
    "computeAverageRating: übersprungene Bewertung zählt nicht in den Schnitt mit rein"
  );
}

// ---------- Watchlist: filterWatchlistItems ----------
{
  const items = [
    { id: "a", type: "serie", genres: ["drama"] },
    { id: "b", type: "film", genres: ["comedy"] },
    { id: "c", type: "serie", genres: ["comedy", "drama"] },
  ];
  assertEqual(filterWatchlistItems(items, { type: "serie" }).map((i) => i.id), ["a", "c"], "filterWatchlistItems: nach Typ");
  assertEqual(filterWatchlistItems(items, { genre: "comedy" }).map((i) => i.id), ["b", "c"], "filterWatchlistItems: nach Genre");
  assertEqual(
    filterWatchlistItems(items, { minAvgRating: 0.5 }, { a: 0.8, b: 0.2 }).map((i) => i.id),
    ["a"],
    "filterWatchlistItems: nach Mindestbewertung, unbewertete Items (c) fallen raus"
  );
}

// ---------- Watchlist: currentWeekDates ----------
{
  const dates = currentWeekDates("2026-07-15");
  assertEqual(dates.length, 7, "currentWeekDates: sieben Tage");
  const first = new Date(dates[0] + "T00:00:00");
  assertEqual(first.getDay(), 1, "currentWeekDates: erster Tag ist ein Montag");
  assertEqual(dates.includes("2026-07-15"), true, "currentWeekDates: enthält das übergebene Datum selbst");
  const allConsecutive = dates.every((d, i) => i === 0 || new Date(d) - new Date(dates[i - 1]) === 86400000);
  assertEqual(allConsecutive, true, "currentWeekDates: Tage sind lückenlos aufeinanderfolgend");
}

// ---------- Watchlist: planMissingSlots ----------
{
  const items = [
    { id: "i1", status: "aktiv", sort_order: 0, created_at: "2026-01-01" },
    { id: "i2", status: "aktiv", sort_order: 1, created_at: "2026-01-02" },
    { id: "i3", status: "geplant", sort_order: 2, created_at: "2026-01-03" },
  ];
  const weekDates = ["2026-07-13", "2026-07-14", "2026-07-15"];

  const noneScheduledYet = planMissingSlots(items, [], weekDates);
  assertEqual(noneScheduledYet.length, 2, "planMissingSlots: nur 'aktive' Items werden zugeteilt (i3 ist nur 'geplant')");
  assertEqual(noneScheduledYet[0], { date: "2026-07-13", item: items[0] }, "planMissingSlots: erster freier Tag bekommt das Item mit kleinstem sort_order");

  const oneAlreadyScheduled = planMissingSlots(
    items,
    [{ watchlist_item_id: "i1", planned_date: "2026-07-13" }],
    weekDates
  );
  assertEqual(oneAlreadyScheduled.length, 1, "planMissingSlots: belegter Tag wird übersprungen");
  assertEqual(oneAlreadyScheduled[0], { date: "2026-07-14", item: items[1] }, "planMissingSlots: bereits verplantes Item (i1) wird nicht doppelt zugeteilt");
}

// ---------- Watchlist: buildSwapOperations ----------
{
  const scheduledA = { taskId: "t1", plannedDate: "2026-07-13", watchlistItemId: "i1" };
  const scheduledB = { taskId: "t2", plannedDate: "2026-07-14", watchlistItemId: "i2" };
  assertEqual(
    buildSwapOperations(scheduledA, scheduledB),
    [
      { taskId: "t1", updates: { planned_date: "2026-07-14" } },
      { taskId: "t2", updates: { planned_date: "2026-07-13" } },
    ],
    "buildSwapOperations: zwei verplante Slots tauschen ihr Datum"
  );

  const unscheduled = { watchlistItemId: "i3" };
  assertEqual(
    buildSwapOperations(scheduledA, unscheduled),
    [{ taskId: "t1", updates: { watchlist_item_id: "i3" } }],
    "buildSwapOperations: verplant gegen unverplant biegt watchlist_item_id der bestehenden Task um"
  );
  assertEqual(
    buildSwapOperations(unscheduled, scheduledA),
    [{ taskId: "t1", updates: { watchlist_item_id: "i3" } }],
    "buildSwapOperations: Reihenfolge der Slots spielt keine Rolle"
  );
}

const summary = document.getElementById("summary");
summary.textContent = `${passCount} bestanden, ${failCount} fehlgeschlagen.`;
summary.style.color = failCount > 0 ? "var(--color-danger)" : "var(--color-success)";
