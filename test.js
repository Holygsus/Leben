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
import { findHabitsDueToday } from "./js/habits.js";

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

// ---------- suggestTasksForPlan (V2: Minutenbudget mit Bereichs-Fairness) ----------
// 2026-07-14 ist ein Dienstag (Werktag, Budget 120 Min, siehe BUDGET_MINUTES/isWeekendIso).
{
  const WEEKDAY = "2026-07-14";
  const base = { status: "open", effort: 10 };
  const tasks = [
    { ...base, id: "t1", area_id: "a1", priority: "medium", created_at: "2026-01-01" },
    { ...base, id: "t2", area_id: "a2", priority: "medium", created_at: "2026-01-02" },
    { ...base, id: "t3", area_id: "a3", priority: "medium", created_at: "2026-01-03" },
    { ...base, id: "done", area_id: "a4", priority: "medium", status: "done", created_at: "2026-01-01" },
    { ...base, id: "sub", area_id: "a5", priority: "medium", parent_task_id: "t1", created_at: "2026-01-01" },
  ];
  const selected = suggestTasksForPlan(tasks, WEEKDAY);
  assertEqual(selected.some((t) => t.id === "done"), false, "suggestTasksForPlan: erledigte Aufgaben werden ignoriert");
  assertEqual(selected.some((t) => t.id === "sub"), false, "suggestTasksForPlan: Unteraufgaben werden ignoriert (laufen kaskadiert mit)");

  // Regressionstest für die round5-Rundung des Bereichs-Caps: 10 Bereiche à 2 Aufgaben (6+6 Min).
  // Bug-Variante: areaCap = round5(120/10) = round5(12) = 10 → die zweite 6-Min-Aufgabe passt in
  // keinem Bereich mehr rein (6+6=12 > 10), nur die 10 ersten (Phase 1) werden gewählt, 60 von 120
  // Minuten bleiben ungenutzt. Fix: areaCap = 120/10 = 12 (ungerundet) → 6+6=12 passt exakt, alle
  // 20 Aufgaben werden gewählt, das Budget wird vollständig ausgeschöpft.
  const evenAreas = Array.from({ length: 10 }, (_, i) => [
    { ...base, id: `e${i}a`, area_id: `area${i}`, priority: "medium", effort: 6, created_at: "2026-01-01" },
    { ...base, id: `e${i}b`, area_id: `area${i}`, priority: "medium", effort: 6, created_at: "2026-01-02" },
  ]).flat();
  const evenSelection = suggestTasksForPlan(evenAreas, WEEKDAY);
  assertEqual(evenSelection.length, 20, "suggestTasksForPlan: areaCap-Rundung verschenkt kein Budget mehr (alle 20 Aufgaben passen)");
  assertEqual(
    evenSelection.reduce((sum, t) => sum + t.effort, 0),
    120,
    "suggestTasksForPlan: Tagesbudget wird bei exakt passenden Aufgaben voll ausgeschöpft"
  );

  // Bereichs-Fairness bleibt erhalten: ein einzelner gieriger Bereich darf sich nicht mehr als
  // seinen fairen Anteil (hier 120/2=60 Min) nehmen, auch wenn er genug eigene Aufgaben hätte.
  const twoAreasHungry = [
    { ...base, id: "g1", area_id: "hungry", priority: "medium", effort: 40, created_at: "2026-01-01" },
    { ...base, id: "g2", area_id: "hungry", priority: "medium", effort: 40, created_at: "2026-01-02" },
    { ...base, id: "g3", area_id: "hungry", priority: "medium", effort: 40, created_at: "2026-01-03" },
    { ...base, id: "o1", area_id: "other", priority: "medium", effort: 40, created_at: "2026-01-01" },
  ];
  const fairSelection = suggestTasksForPlan(twoAreasHungry, WEEKDAY);
  assertEqual(
    fairSelection.filter((t) => t.area_id === "hungry").length,
    1,
    "suggestTasksForPlan: Bereichs-Cap begrenzt einen gierigen Bereich auf seinen fairen Anteil"
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
  assertEqual(getEffectiveDuration({ type: "doku", duration_minutes: null }), DEFAULT_DURATION_MIN.doku, "getEffectiveDuration: Doku-Standard 45 Min.");
  assertEqual(getEffectiveDuration({ type: "youtube", duration_minutes: null }), DEFAULT_DURATION_MIN.youtube, "getEffectiveDuration: YouTube-Standard 15 Min.");
  assertEqual(getEffectiveDuration({ type: "serie", duration_minutes: 25 }), 25, "getEffectiveDuration: manueller Override schlägt Typ-Standard");
}

// ---------- Watchlist: computeAverageRating ----------
{
  assertEqual(computeAverageRating([]), null, "computeAverageRating: keine Sichtungen ergibt null");
  assertEqual(computeAverageRating([{ rating: null }, { rating: null }]), null, "computeAverageRating: nur übersprungene Bewertungen ergibt null");
  assertEqual(computeAverageRating([{ rating: 8 }, { rating: 10 }, { rating: 3 }]), 7, "computeAverageRating: arithmetisches Mittel (1-10-Skala)");
  assertEqual(
    computeAverageRating([{ rating: 6 }, { rating: null }, { rating: 4 }]),
    5,
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
    filterWatchlistItems(items, { minAvgRating: 7 }, { a: 8, b: 4 }).map((i) => i.id),
    ["a"],
    "filterWatchlistItems: nach Mindestbewertung (1-10-Skala), unbewertete Items (c) fallen raus"
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

// ---------- Watchlist: planMissingSlots — zweiter Eintrag pro Tag (Kapazitätsprüfung) ----------
{
  const capacityItems = [
    { id: "c1", status: "aktiv", sort_order: 0, created_at: "2026-01-01", type: "serie", duration_minutes: null }, // 45 Min Default
    { id: "c2", status: "aktiv", sort_order: 1, created_at: "2026-01-02", type: "anime", duration_minutes: null }, // 20 Min Default
  ];
  const capacityDate = ["2026-07-20"]; // Montag -> budgetForDate = 120 Min
  const alreadyScheduled = [{ watchlist_item_id: "c1", planned_date: "2026-07-20" }];

  const tooTight = planMissingSlots(capacityItems, alreadyScheduled, capacityDate, { "2026-07-20": 60 });
  assertEqual(tooTight.length, 0, "planMissingSlots: zweiter Eintrag wird bei zu wenig Kapazität nicht zugeteilt (60+45+20 > 120)");

  const roomy = planMissingSlots(capacityItems, alreadyScheduled, capacityDate, { "2026-07-20": 0 });
  assertEqual(roomy.length, 1, "planMissingSlots: zweiter Eintrag wird bei ausreichender Kapazität zugeteilt (0+45+20 <= 120)");
  assertEqual(roomy[0], { date: "2026-07-20", item: capacityItems[1] }, "planMissingSlots: zweiter Eintrag ist der nächste Pool-Kandidat (c2)");
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

// ---------- Habits: findHabitsDueToday (Pool-Modus) ----------
{
  const today = "2026-07-14"; // Dienstag
  const mother = { id: "m1", parent_task_id: null, habit_weekdays: ["tue"], planned_date: null };
  const childA = { id: "cA", parent_task_id: "m1", status: "open", priority: "medium" };
  const childB = { id: "cB", parent_task_id: "m1", status: "open", priority: "medium" };
  const childC = { id: "cC", parent_task_id: "m1", status: "open", priority: "medium" };

  const firstPick = findHabitsDueToday([mother, childA, childB, childC], today);
  assertEqual(firstPick.length, 1, "findHabitsDueToday: erster Aufruf zieht genau ein Pool-Kind");

  // Simuliert autoplanDueHabits: das gezogene Kind wechselt auf status "planned" mit planned_date=heute.
  const pickedId = firstPick[0].targetId;
  const afterPlanning = [mother, childA, childB, childC].map((c) =>
    c.id === pickedId ? { ...c, status: "planned", planned_date: today } : c
  );
  const secondPick = findHabitsDueToday(afterPlanning, today);
  assertEqual(
    secondPick.length,
    0,
    "findHabitsDueToday: erneuter Aufruf am selben Tag zieht KEIN weiteres Kind nach (Reload-Guard)"
  );
}

const summary = document.getElementById("summary");
summary.textContent = `${passCount} bestanden, ${failCount} fehlgeschlagen.`;
summary.style.color = failCount > 0 ? "var(--color-danger)" : "var(--color-success)";
