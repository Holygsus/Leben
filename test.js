import { buildTaskTree, collectDescendantIds, countDescendantsRecursive } from "./js/tasks.js";
import { suggestTasksForPlan, formatTasksForExport, buildEffortClassSlots, buildAreaRotationQueue, isPlannableCandidate } from "./js/planner.js";
import {
  DEFAULT_DURATION_MIN,
  isWatchlistTask,
  getEffectiveDuration,
  computeAverageRating,
  filterWatchlistItems,
  currentWeekDates,
  planMissingSlots,
  buildSwapOperations,
  advancesEpisode,
  timeToMinutes,
  isoWeekdayFromIso,
  rollingDates,
  weekStartsFor,
  findOnAirIndex,
  defaultOpenIndex,
  findDisplacedSlots,
  summarizeInterestProfile,
} from "./js/watchlist.js";
import { findHabitsDueToday, listHabitsForToday, sumCounterForDate, weekAverageCounter } from "./js/habits.js";
import { buildMoodStrip, averageMood, averageRatingByArea, moodByHabitDays, shiftIsoDate } from "./js/insights.js";
import { computeBudgetTrend, computeCategoryBreakdown, slugifyCategoryKey } from "./js/finance.js";
import { formatIngredientsForShoppingList } from "./js/recipes.js";
import { sumPagesInMonth, sumChaptersInMonth } from "./js/books.js";

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
    { ...base, id: "sub", area_id: "a1", priority: "medium", parent_task_id: "t1", created_at: "2026-01-01" },
  ];
  const selected = suggestTasksForPlan(tasks, WEEKDAY);
  assertEqual(selected.some((t) => t.id === "done"), false, "suggestTasksForPlan: erledigte Aufgaben werden ignoriert");
  // War Room 2026-07-25: effort ist das alleinige Planbarkeits-Signal, auch für Unteraufgaben.
  // "sub" trägt eigenen effort → eigenständiger Kandidat; "t1" ist Mutter mit effort-Kind → nur noch
  // Gruppierungs-Label, kein Slot (Doppelzählung vermeiden).
  assertEqual(selected.some((t) => t.id === "sub"), true, "suggestTasksForPlan: Unteraufgabe mit eigenem effort ist Kandidat");
  assertEqual(selected.some((t) => t.id === "t1"), false, "suggestTasksForPlan: Mutter mit effort-tragendem Kind ist kein eigener Slot");

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

// ---------- isPlannableCandidate (effort = Planbarkeits-Signal, auch für Unteraufgaben) ----------
// War Room 2026-07-25, siehe wissensdatenbank/features/tagesplan-algorithmus-v2.md.
{
  const projektMutter = { id: "pm", status: "open", effort: null, parent_task_id: null };
  const projektKind = { id: "pk", status: "open", effort: 30, parent_task_id: "pm" };
  const containerMutter = { id: "cm", status: "open", effort: 30, parent_task_id: null };
  const containerKind = { id: "ck", status: "open", effort: null, parent_task_id: "cm" };
  const habitMutter = { id: "hm", status: "open", effort: null, parent_task_id: null, habit_weekdays: ["mon"] };
  const habitKind = { id: "hk", status: "open", effort: 10, parent_task_id: "hm" };
  const mutterMitEffortUndEffortKind = { id: "me", status: "open", effort: 30, parent_task_id: null };
  const effortKindVonMe = { id: "mek", status: "open", effort: 10, parent_task_id: "me" };
  const all = [projektMutter, projektKind, containerMutter, containerKind, habitMutter, habitKind, mutterMitEffortUndEffortKind, effortKindVonMe];

  assertEqual(isPlannableCandidate(projektKind, all), true, "isPlannableCandidate: Unteraufgabe mit eigenem effort ist Kandidat");
  assertEqual(isPlannableCandidate(projektMutter, all), false, "isPlannableCandidate: effortlose Projekt-Mutter ist kein Kandidat");
  assertEqual(isPlannableCandidate(containerMutter, all), true, "isPlannableCandidate: Container-Mutter (effort, Kinder ohne effort) ist Kandidat");
  assertEqual(isPlannableCandidate(containerKind, all), false, "isPlannableCandidate: Container-Kind ohne effort ist kein Kandidat (kaskadiert mit)");
  assertEqual(isPlannableCandidate(habitKind, all), false, "isPlannableCandidate: Habit-Pool-Kind ist kein Kandidat (läuft über Habit-Tab)");
  assertEqual(isPlannableCandidate(mutterMitEffortUndEffortKind, all), false, "isPlannableCandidate: Mutter mit effort-tragendem Kind ist nur Label, kein Kandidat");
  assertEqual(isPlannableCandidate(effortKindVonMe, all), true, "isPlannableCandidate: das effort-tragende Kind einer solchen Mutter ist der Kandidat");
}

// ---------- sumPagesInMonth (Lesen — Monats-Übersicht) ----------
{
  const log = [
    { date: "2026-07-03", pages_read: 20 },
    { date: "2026-07-28", pages_read: 15 },
    { date: "2026-06-30", pages_read: 100 }, // anderer Monat
    { date: "2026-08-01", pages_read: 50 }, // anderer Monat
  ];
  assertEqual(sumPagesInMonth(log, "2026-07"), 35, "sumPagesInMonth: summiert nur Einträge des Zielmonats");
  assertEqual(sumPagesInMonth(log, "2026-05"), 0, "sumPagesInMonth: Monat ohne Einträge ergibt 0");
}

// ---------- sumChaptersInMonth (Lesen — Kapitel-Monats-Übersicht) ----------
{
  const log = [
    { date: "2026-07-03", chapters_read: 2 },
    { date: "2026-07-28", chapters_read: 3 },
    { date: "2026-07-10", pages_read: 40 }, // Seiten-Session zählt hier nicht mit
    { date: "2026-06-30", chapters_read: 9 }, // anderer Monat
  ];
  assertEqual(sumChaptersInMonth(log, "2026-07"), 5, "sumChaptersInMonth: summiert nur Kapitel des Zielmonats");
  assertEqual(sumChaptersInMonth(log, "2026-05"), 0, "sumChaptersInMonth: Monat ohne Einträge ergibt 0");
}

// ---------- sumCounterForDate / weekAverageCounter (Zähl-Habits) ----------
{
  const log = [
    { task_id: "w", date: "2026-07-27", amount: 2 }, // Montag (Wochenstart)
    { task_id: "w", date: "2026-07-29", amount: 4 }, // heute (Mittwoch)
    { task_id: "w", date: "2026-07-29", amount: 3 }, // zweiter Tap heute
    { task_id: "w", date: "2026-07-26", amount: 100 }, // Sonntag = Vorwoche, zählt nicht mit
    { task_id: "x", date: "2026-07-29", amount: 9 }, // anderes Habit
  ];
  assertEqual(sumCounterForDate(log, "w", "2026-07-29"), 7, "sumCounterForDate: summiert alle Taps des Tages für dieses Habit");
  assertEqual(sumCounterForDate(log, "w", "2026-07-28"), 0, "sumCounterForDate: Tag ohne Taps ergibt 0");
  // Wochensumme Mo–Mi = 2 + 4 + 3 = 9, verstrichene Tage = 3 -> Ø 3.0 (Vorwochen-/Fremd-Taps raus)
  assertEqual(weekAverageCounter(log, "w", "2026-07-29"), 3, "weekAverageCounter: Wochensumme seit Montag ÷ verstrichene Tage");
  assertEqual(weekAverageCounter(log, "leer", "2026-07-29"), 0, "weekAverageCounter: Habit ohne Taps ergibt 0");
}

// ---------- computeCategoryBreakdown (frei editierbare Kategorien) ----------
{
  const txs = [
    { direction: "expense", amount: 10, category: "haustier" }, // frei benannter Key
    { direction: "expense", amount: 5, category: "haustier" },
    { direction: "expense", amount: 7, category: null }, // uncategorized
    { direction: "income", amount: 100, category: "essen" }, // Einnahme zählt nicht
  ];
  assertEqual(
    computeCategoryBreakdown(txs),
    { haustier: 15, uncategorized: 7 },
    "computeCategoryBreakdown: aggregiert freien Key + uncategorized-Fallback, ignoriert Einnahmen"
  );
}

// ---------- slugifyCategoryKey (Key-Generierung für neue Kategorien) ----------
{
  assertEqual(slugifyCategoryKey("Essen gehen / Ausgehen"), "essen_gehen_ausgehen", "slugifyCategoryKey: Leerzeichen/Sonderzeichen werden zu _");
  assertEqual(slugifyCategoryKey("Bücher & Hörbücher"), "buecher_hoerbuecher", "slugifyCategoryKey: Umlaute werden transliteriert");
  assertEqual(slugifyCategoryKey("Haustier", ["haustier"]), "haustier_2", "slugifyCategoryKey: Kollision hängt _2 an");
  assertEqual(slugifyCategoryKey("Haustier", ["haustier", "haustier_2"]), "haustier_3", "slugifyCategoryKey: zweite Kollision hängt _3 an");
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

// ---------- Watchlist: Sender-Autopilot (broadcast_program) ----------
{
  assertEqual(timeToMinutes("20:15:00"), 1215, "timeToMinutes: HH:MM:SS -> Minuten");
  assertEqual(isoWeekdayFromIso("2026-10-05"), 1, "isoWeekdayFromIso: Montag = 1");
  assertEqual(isoWeekdayFromIso("2026-10-04"), 7, "isoWeekdayFromIso: Sonntag = 7");
  assertEqual(
    rollingDates("2026-10-04", 3),
    ["2026-10-04", "2026-10-05", "2026-10-06"],
    "rollingDates: Fenster ab heute, über Monats-/Wochengrenzen"
  );
  assertEqual(
    weekStartsFor(rollingDates("2026-10-04")),
    ["2026-09-28", "2026-10-05"],
    "weekStartsFor: Sonntags-Fenster berührt zwei Wochen"
  );

  assertEqual(advancesEpisode({ type: "serie" }, "watched"), true, "advancesEpisode: Serie + watched");
  assertEqual(advancesEpisode({ type: "film" }, "watched"), false, "advancesEpisode: Film hat keine Folgen");
  assertEqual(advancesEpisode({ type: "anime" }, "skipped"), false, "advancesEpisode: Skip lässt Folge stehen");

  const items = new Map([
    ["a", { id: "a", type: "anime", duration_minutes: 24 }],
    ["s", { id: "s", type: "serie", duration_minutes: null }],
  ]);
  const day = [
    { start_time: "18:30:00", status: "geplant", watchlist_item_id: "a" },
    { start_time: "20:15:00", status: "geplant", watchlist_item_id: "s" },
    { start_time: "22:15:00", status: "geplant", watchlist_item_id: null },
  ];
  assertEqual(findOnAirIndex(day, items, 18 * 60 + 40), 0, "findOnAirIndex: innerhalb der Item-Dauer");
  assertEqual(findOnAirIndex(day, items, 18 * 60 + 55), -1, "findOnAirIndex: nach Ende (24 Min) läuft nichts");
  assertEqual(findOnAirIndex(day, items, 20 * 60 + 59), 1, "findOnAirIndex: Typ-Standard 45 Min greift ohne duration");
  assertEqual(findOnAirIndex(day, items, 23 * 60 + 30), 2, "findOnAirIndex: Termin ohne Item läuft 120 Min");
  assertEqual(defaultOpenIndex(day, items, true, 19 * 60), 1, "defaultOpenIndex: sonst nächste offene Sendung");
  assertEqual(defaultOpenIndex(day, items, false, 19 * 60), -1, "defaultOpenIndex: andere Tage zugeklappt");
  assertEqual(
    findOnAirIndex([{ ...day[0], status: "gesehen" }], items, 18 * 60 + 40),
    -1,
    "findOnAirIndex: Abgehaktes läuft nicht mehr"
  );

  const slots = [
    { id: "x1", weekday: 6, start_time: "15:30:00", slot_kind: "live" },
    { id: "x4", weekday: 6, start_time: "16:15:00", slot_kind: "stamm" },
    { id: "x2", weekday: 6, start_time: "22:15:00", slot_kind: "wiederholung" },
    { id: "x3", weekday: 5, start_time: "20:15:00", slot_kind: "film" },
  ];
  const sat = [
    { slot_id: null, event_id: "e1", slot_kind: "live", start_time: "15:30:00", event: { ends_at: null } },
  ];
  assertEqual(
    findDisplacedSlots(slots, sat, "2026-10-10").map((d) => d.slot.id),
    ["x4"],
    "findDisplacedSlots: nur Slots im Termin-Fenster, am passenden Wochentag, ohne live/frei"
  );

  const summary = summarizeInterestProfile([
    { value: "Anime", weight: 4 },
    { value: "Horror", weight: -2 },
    { value: "Doku", weight: 3 },
    { value: "Sitcom", weight: -1 },
    { value: "Neutral", weight: 0 },
  ]);
  assertEqual(
    [summary.up.map((r) => r.value), summary.down.map((r) => r.value), summary.all.length],
    [["Anime", "Doku"], ["Horror"], 4],
    "summarizeInterestProfile: Top 2 hoch, stärkstes Negativ, Nullen raus"
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

// ---------- listHabitsForToday ----------
{
  // 2026-10-05 ist ein Montag.
  const tasks = [
    { id: "h1", title: "Laufen", habit_weekdays: ["mon"], habit_recurrence: "weekly" },
    { id: "h2", title: "Lesen", habit_weekdays: ["tue"], habit_recurrence: "weekly" },
    { id: "h3", title: "Wasser", habit_weekdays: ["mon"], habit_unit: "Gläser" },
    { id: "h4", title: "Putzen", habit_weekdays: ["mon"], habit_recurrence: "biweekly", habit_last_due_date: "2026-10-05" },
    { id: "t1", title: "Normale Aufgabe", habit_weekdays: null },
  ];
  const completions = [
    { task_id: "h1", date: "2026-10-05", skipped: false },
    { task_id: "h4", date: "2026-10-05", skipped: true },
  ];
  assertEqual(
    listHabitsForToday(tasks, completions, "2026-10-05"),
    [
      { id: "h1", title: "Laufen", done: true },
      { id: "h4", title: "Putzen", done: false },
    ],
    "listHabitsForToday: nur heute fällige Abhak-Habits, schon gestempelte biweekly zählen, Skip ist nicht erledigt"
  );
}

// ---------- insights ----------
{
  assertEqual(shiftIsoDate("2026-10-01", -1), "2026-09-30", "shiftIsoDate: über Monatsgrenze");
  const strip = buildMoodStrip([{ date: "2026-10-04", mood: 4 }, { date: "2026-10-02", mood: 2 }], "2026-10-04", 3);
  assertEqual(
    strip,
    [
      { date: "2026-10-02", mood: 2 },
      { date: "2026-10-03", mood: null },
      { date: "2026-10-04", mood: 4 },
    ],
    "buildMoodStrip: ältester Tag zuerst, Lücken als null"
  );
  assertEqual(averageMood(strip), 3, "averageMood: ignoriert Tage ohne Eintrag");
  assertEqual(averageMood([{ date: "x", mood: null }]), null, "averageMood: null ohne Daten");

  const feedback = [
    { area_id: "a", rating: 5 }, { area_id: "a", rating: 4 }, { area_id: "a", rating: 3 },
    { area_id: "b", rating: 2 }, { area_id: "b", rating: 2 }, { area_id: "b", rating: 2 },
    { area_id: "c", rating: 5 },
    { area_id: null, rating: 1 },
  ];
  assertEqual(
    averageRatingByArea(feedback),
    [
      { areaId: "a", avg: 4, count: 3 },
      { areaId: "b", avg: 2, count: 3 },
    ],
    "averageRatingByArea: bestes zuerst, Bereiche mit <3 Bewertungen und ohne Bereich raus"
  );

  const reflections = [
    { date: "d1", mood: 5 }, { date: "d2", mood: 4 }, { date: "d3", mood: 3 },
    { date: "d4", mood: 2 }, { date: "d5", mood: 2 }, { date: "d6", mood: 2 },
  ];
  const completions = [
    { date: "d1", skipped: false }, { date: "d2", skipped: false }, { date: "d3", skipped: false },
    { date: "d4", skipped: true },
  ];
  assertEqual(
    moodByHabitDays(reflections, completions),
    { withAvg: 4, withCount: 3, withoutAvg: 2, withoutCount: 3 },
    "moodByHabitDays: Skip zählt nicht als Habit-Tag"
  );
  assertEqual(moodByHabitDays(reflections.slice(0, 4), completions), null, "moodByHabitDays: null bei zu wenig Daten");
}

const summary = document.getElementById("summary");
summary.textContent = `${passCount} bestanden, ${failCount} fehlgeschlagen.`;
summary.style.color = failCount > 0 ? "var(--color-danger)" : "var(--color-success)";
