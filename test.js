import { buildTaskTree, collectDescendantIds, countDescendantsRecursive } from "./js/tasks.js";
import { suggestTasksForPlan, formatTasksForExport, buildEffortClassSlots, buildAreaRotationQueue } from "./js/planner.js";
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
import { computeBudgetTrend } from "./js/finance.js";
import { formatIngredientsForShoppingList } from "./js/recipes.js";

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
// 2026-07-14 ist ein Dienstag (Werktag, Budget 180 Min seit dem War Room vom 2026-07-21, siehe
// BUDGET_MINUTES/isWeekendIso).
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

  // Regressionstest für die round5-Rundung des Bereichs-Caps: 10 Bereiche à 2 Aufgaben (9+9 Min).
  // Bug-Variante: eine gerundete Cap-Schwelle verschenkt Budget systematisch. Fix: areaCap =
  // 180/10 = 18 (ungerundet) → 9+9=18 passt exakt, alle 20 Aufgaben werden gewählt, das Budget wird
  // vollständig ausgeschöpft.
  const evenAreas = Array.from({ length: 10 }, (_, i) => [
    { ...base, id: `e${i}a`, area_id: `area${i}`, priority: "medium", effort: 9, created_at: "2026-01-01" },
    { ...base, id: `e${i}b`, area_id: `area${i}`, priority: "medium", effort: 9, created_at: "2026-01-02" },
  ]).flat();
  const evenSelection = suggestTasksForPlan(evenAreas, WEEKDAY);
  assertEqual(evenSelection.length, 20, "suggestTasksForPlan: areaCap-Rundung verschenkt kein Budget mehr (alle 20 Aufgaben passen)");
  assertEqual(
    evenSelection.reduce((sum, t) => sum + t.effort, 0),
    180,
    "suggestTasksForPlan: Tagesbudget wird bei exakt passenden Aufgaben voll ausgeschöpft"
  );

  // Bereichs-Fairness bleibt erhalten: ein einzelner gieriger Bereich darf sich nicht mehr als
  // seinen fairen Anteil (hier 180/2=90 Min) nehmen, auch wenn er genug eigene Aufgaben hätte —
  // von den drei 40-Min.-Aufgaben passen noch 2 (40+40=80≤90), die dritte (120>90) nicht mehr.
  const twoAreasHungry = [
    { ...base, id: "g1", area_id: "hungry", priority: "medium", effort: 40, created_at: "2026-01-01" },
    { ...base, id: "g2", area_id: "hungry", priority: "medium", effort: 40, created_at: "2026-01-02" },
    { ...base, id: "g3", area_id: "hungry", priority: "medium", effort: 40, created_at: "2026-01-03" },
    { ...base, id: "o1", area_id: "other", priority: "medium", effort: 40, created_at: "2026-01-01" },
  ];
  const fairSelection = suggestTasksForPlan(twoAreasHungry, WEEKDAY);
  assertEqual(
    fairSelection.filter((t) => t.area_id === "hungry").length,
    2,
    "suggestTasksForPlan: Bereichs-Cap begrenzt einen gierigen Bereich auf seinen fairen Anteil"
  );
}

// ---------- buildEffortClassSlots (Aufwandsklassen-geführter Durchgang) ----------
// 2026-07-14 ist ein Dienstag, 2026-07-18 ein Samstag (beide Tage in derselben Woche).
{
  const WEEKDAY = "2026-07-14";
  const WEEKEND = "2026-07-18";
  assertEqual(
    buildEffortClassSlots(WEEKDAY),
    [60, 30, 30, 10, 10, 10, 5, 5, 5, 5, 5, 5],
    "buildEffortClassSlots: Werktag liefert eine 12-Slot-Runde (1×60/2×30/3×10/6×5)"
  );
  assertEqual(
    buildEffortClassSlots(WEEKEND).length,
    24,
    "buildEffortClassSlots: Wochenende verdoppelt die Runde auf 24 Slots (180×2=360 Min. Budget)"
  );
}

// ---------- buildAreaRotationQueue (Bereichs-Rotation innerhalb einer Aufwandsklasse) ----------
{
  const areas = [
    { id: "a1", last_served_at: "2026-01-05T00:00:00Z" },
    { id: "a2", last_served_at: "2026-01-01T00:00:00Z" }, // am längsten bedient, aber nicht "nie"
    { id: "a3", last_served_at: null }, // nie bedient
  ];
  const base = { status: "open", effort: 30 };
  const tasks = [
    { ...base, id: "t-a1", area_id: "a1", priority: "medium", created_at: "2026-01-01" },
    { ...base, id: "t-a2", area_id: "a2", priority: "medium", created_at: "2026-01-01" },
    { ...base, id: "t-a3", area_id: "a3", priority: "medium", created_at: "2026-01-01" },
  ];

  const queue = buildAreaRotationQueue(tasks, areas, 30);
  assertEqual(
    queue.map((e) => e.areaId),
    ["a3", "a2", "a1"],
    "buildAreaRotationQueue: least-recently-served zuerst, nie bedient (null) vor allen anderen"
  );

  // a1 wurde zuletzt bedient (stünde eigentlich hinten), springt aber vor, weil sein Top-Kandidat
  // dieser Klasse hohe Priorität hat.
  const tasksWithPriority = tasks.map((t) => (t.id === "t-a1" ? { ...t, priority: "high" } : t));
  const queuePriority = buildAreaRotationQueue(tasksWithPriority, areas, 30);
  assertEqual(
    queuePriority.map((e) => e.areaId),
    ["a1", "a3", "a2"],
    "buildAreaRotationQueue: Bereich mit hochpriorisiertem Top-Kandidat springt vor die Recency-Reihenfolge"
  );

  // excludeTaskIds: bereits gewählte Aufgabe fällt raus — war es die einzige Aufgabe ihres Bereichs
  // in dieser Klasse, fällt der ganze Bereich aus der Queue.
  const queueExcluded = buildAreaRotationQueue(tasks, areas, 30, new Set(["t-a2"]));
  assertEqual(
    queueExcluded.map((e) => e.areaId),
    ["a3", "a1"],
    "buildAreaRotationQueue: excludeTaskIds schließt bereits gewählte Aufgaben aus, Bereich ohne verbleibenden Kandidaten fällt komplett raus"
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
  const capacityDate = ["2026-07-20"]; // Montag -> budgetForDate = 180 Min (seit War Room 2026-07-21)
  const alreadyScheduled = [{ watchlist_item_id: "c1", planned_date: "2026-07-20" }];

  const tooTight = planMissingSlots(capacityItems, alreadyScheduled, capacityDate, { "2026-07-20": 120 });
  assertEqual(tooTight.length, 0, "planMissingSlots: zweiter Eintrag wird bei zu wenig Kapazität nicht zugeteilt (120+45+20 > 180)");

  const roomy = planMissingSlots(capacityItems, alreadyScheduled, capacityDate, { "2026-07-20": 0 });
  assertEqual(roomy.length, 1, "planMissingSlots: zweiter Eintrag wird bei ausreichender Kapazität zugeteilt (0+45+20 <= 180)");
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

// ---------- Finanzen: computeBudgetTrend ----------
{
  const normal = computeBudgetTrend({
    freiheitBudget: 300,
    openReservationsMonthly: 50,
    daysRemainingInMonth: 25,
    recentSpend: 140,
    windowDays: 7,
  });
  assertEqual(normal.dailyBudget, 10, "computeBudgetTrend: (300-50)/25 = 10€ Tagesbudget");
  assertEqual(normal.avgRecent, 20, "computeBudgetTrend: 140/7 = 20€ Schnitt letzte 7 Tage");

  const noReservations = computeBudgetTrend({
    freiheitBudget: 300,
    openReservationsMonthly: 0,
    daysRemainingInMonth: 30,
    recentSpend: 0,
    windowDays: 7,
  });
  assertEqual(noReservations.dailyBudget, 10, "computeBudgetTrend: ohne offene Reservierungen bleibt das volle Budget");

  const shortWindow = computeBudgetTrend({
    freiheitBudget: 300,
    openReservationsMonthly: 0,
    daysRemainingInMonth: 30,
    recentSpend: 30,
    windowDays: 3,
  });
  assertEqual(shortWindow.avgRecent, 10, "computeBudgetTrend: kürzeres Fenster (noch keine 7 Tage Historie) rechnet über windowDays statt fix 7");
}

// ---------- Rezepte: formatIngredientsForShoppingList ----------
{
  assertEqual(formatIngredientsForShoppingList([]), "Keine Zutaten hinterlegt.", "formatIngredientsForShoppingList: leere Liste");
  assertEqual(
    formatIngredientsForShoppingList([{ name: "Mehl", amount: "200g" }, { name: "Salz", amount: "1 Prise" }]),
    "- 200g Mehl\n- 1 Prise Salz",
    "formatIngredientsForShoppingList: Menge vor Namen, eine Zeile pro Zutat"
  );
  assertEqual(
    formatIngredientsForShoppingList([{ name: "Salz", amount: null }]),
    "- Salz",
    "formatIngredientsForShoppingList: ohne Menge nur der Name"
  );
}

const summary = document.getElementById("summary");
summary.textContent = `${passCount} bestanden, ${failCount} fehlgeschlagen.`;
summary.style.color = failCount > 0 ? "var(--color-danger)" : "var(--color-success)";
