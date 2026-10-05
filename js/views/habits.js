// Ansicht "Habits" (#/habits).
import { listHabitTasksWithPool, updateTask, createTask, deleteTask } from "../tasks.js";
import { listAreas } from "../areas.js";
import {
  WEEKDAY_CODES,
  isHabitTask,
  isCounterHabit,
  weekdayCodeFromIso,
  RECURRENCE_LABEL,
  STREAK_MAX_LOOKBACK_DAYS,
  listHabitCompletionsSince,
  listHabitCompletionsForTasks,
  computeHabitStreak,
  logCounterTap,
  deleteCounterEntry,
  listCounterLogSince,
  sumCounterForDate,
  weekAverageCounter,
} from "../habits.js";
import { shiftIsoDate } from "../insights.js";
import { todayISO, weekStartISO } from "../ui/dates.js";
import { WEEKDAY_LABEL, STREAK_ICON_FLAME, escapeHtml, buildEmptyState } from "../ui/dom.js";
import { showToast, showConfirm, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";

/* ---------- Habits ---------- */

const habitsViewState = { allTasks: [], areaColorById: {}, completions: [], counterLog: [] };

export async function renderHabitsView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/habits.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  // Nur Habits + Pool-Kinder statt aller Aufgaben, und Erledigungen nur so weit zurück, wie
  // Streak (STREAK_MAX_LOOKBACK_DAYS), Monatsbalken, Wochenring und 7-Tage-Heatmap reichen. Ausnahme:
  // biweekly/monthly zeigen die Gesamtzahl aller Erledigungen — für die die komplette Historie.
  // Zähl-Log nur ab Wochenbeginn (heute + Ø diese Woche).
  const [tasks, areas, recentCompletions, counterLog] = await Promise.all([
    listHabitTasksWithPool(),
    listAreas(),
    listHabitCompletionsSince(shiftIsoDate(todayISO(), -STREAK_MAX_LOOKBACK_DAYS)),
    listCounterLogSince(weekStartISO()),
  ]);
  const totalCountHabitIds = tasks
    .filter((t) => isHabitTask(t) && (t.habit_recurrence || "weekly") !== "weekly")
    .map((t) => t.id);
  const completions = totalCountHabitIds.length
    ? mergeCompletions(recentCompletions, await listHabitCompletionsForTasks(totalCountHabitIds))
    : recentCompletions;
  habitsViewState.allTasks = tasks;
  habitsViewState.areaColorById = Object.fromEntries(areas.map((a) => [a.id, a.color]));
  habitsViewState.completions = completions;
  habitsViewState.counterLog = counterLog;
  renderHabitList();
  wireHabitQuickAddForm();
}

// Vereinigt zwei Erledigungs-Listen ohne Doppelte (gleiche Zeile kann in beiden Abfragen stecken) —
// Duplikate würden z.B. den Wochenring doppelt zählen.
function mergeCompletions(base, extra) {
  const seen = new Set(base.map((c) => c.id));
  return [...base, ...extra.filter((c) => !seen.has(c.id))];
}

// Direkter Habit-Einstieg im Habit-Tab selbst (implementieren-jetzt.md, Triage 2026-07-21) — bisher
// musste man zwingend erst eine normale Aufgabe anlegen/öffnen und dort td-is-habit aktivieren.
// Bewusst kein Bereichsfeld: ein Habit muss laut Nutzer keinem Bereich zugeordnet sein, area_id ist
// bereits nullable. Legt die Mutter mit habit_weekdays: [] an (noch keine Tage gewählt) — Wochentage
// konfiguriert der Nutzer danach über die bereits bestehenden Chips/Presets in der Liste, exakt wie
// bei einem über das Task-Detail-Modal erstellten Habit. Optionales erstes Pool-Kind nutzt dasselbe
// parent_task_id-Muster wie der bestehende Aufgaben-Pool (siehe js/habits.js, findHabitsDueToday).
function wireHabitQuickAddForm() {
  const toggleBtn = document.getElementById("habit-quick-add-toggle");
  const form = document.getElementById("habit-quick-form");
  const titleInput = document.getElementById("habit-quick-title");
  const subtaskInput = document.getElementById("habit-quick-subtask");
  const counterCheckbox = document.getElementById("habit-quick-counter");
  const unitInput = document.getElementById("habit-quick-unit");
  const goalInput = document.getElementById("habit-quick-goal");
  const cancelBtn = document.getElementById("habit-quick-cancel");
  const submitBtn = form.querySelector('button[type="submit"]');

  // Zähl-Habit-Toggle blendet Einheit- und (optionales) Tagesziel-Feld ein und das (dann sinnlose)
  // Pool-Kind-Feld aus — ein Zähl-Habit hat keinen Aufgaben-Pool.
  const syncCounterFields = () => {
    const on = counterCheckbox.checked;
    unitInput.hidden = !on;
    goalInput.hidden = !on;
    subtaskInput.hidden = on;
  };
  counterCheckbox.addEventListener("change", syncCounterFields);

  const closeForm = () => {
    form.hidden = true;
    form.reset();
    syncCounterFields();
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      titleInput.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    const title = titleInput.value.trim();
    if (!title) return;
    const isCounter = counterCheckbox.checked;
    const unit = unitInput.value.trim();
    if (isCounter && !unit) {
      unitInput.focus();
      return;
    }
    const subtaskTitle = subtaskInput.value.trim();
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        if (isCounter) {
          // Zähl-Habit: habit_weekdays: [] (bleibt isHabitTask, aber nie im Tagesplan), kein Pool-Kind.
          const goalRaw = goalInput.value.trim();
          const goal = goalRaw === "" ? null : Math.max(1, Number(goalRaw));
          await createTask({ title, habitWeekdays: [], habitUnit: unit, habitDailyGoal: goal });
        } else {
          const mother = await createTask({ title, habitWeekdays: [] });
          if (subtaskTitle) await createTask({ title: subtaskTitle, parentTaskId: mother.id });
        }
        closeForm();
        await renderHabitsView();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// Kompakte Punktreihe für den Default-Zustand einer Habit-Zeile: zeigt auf einen Blick, an
// welchen Wochentagen das Habit aktiv ist, ohne 7 antippbare 40px-Chips permanent vorzuhalten.
// Kompakte 7-Tage-Completion-Heatmap (ältester Tag links, heute rechts): erledigt = gefüllt,
// fällig-aber-offen = umrandet, nicht fällig = blass. Gibt auf einen Blick ein Gefühl für Konstanz
// ("don't break the chain"), ergänzend zum Streak-Badge. Zeitplan-Details bleiben in den
// aufklappbaren Wochentags-Chips.
function buildHabitHeatmap(task, completions, todayIso) {
  const done = new Set(completions.filter((c) => c.task_id === task.id).map((c) => c.date));
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const cells = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(ty, tm - 1, td - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const due = task.habit_weekdays.includes(weekdayCodeFromIso(iso));
    const state = done.has(iso) ? "done" : due ? "due" : "off";
    cells.push(`<span class="habit-heat-cell ${state}" title="${iso}"></span>`);
  }
  return `<span class="habit-heatmap" aria-hidden="true">${cells.join("")}</span>`;
}

// Kurzer Monatsname für das Konstanz-Balken-Label (z.B. "August"). Einmal berechnet — die
// Habits-Ansicht wird ohnehin bei jedem Öffnen frisch gerendert.
const HABIT_MONTH_LABEL = new Date().toLocaleDateString("de-DE", { month: "long" });

// Erledigte vs. fällige Habit-Tage im laufenden Monat bis einschließlich heute. "Fällig" = der
// Wochentag steht in habit_weekdays (gleiche Logik wie die Heatmap). Basis für den Konstanz-Balken.
function habitMonthProgress(task, completions, todayIso) {
  const [y, m] = todayIso.split("-").map(Number);
  const todayDay = Number(todayIso.slice(8, 10));
  const done = new Set(completions.filter((c) => c.task_id === task.id).map((c) => c.date));
  let due = 0;
  let hit = 0;
  for (let d = 1; d <= todayDay; d++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (task.habit_weekdays.includes(weekdayCodeFromIso(iso))) {
      due++;
      if (done.has(iso)) hit++;
    }
  }
  return { due, hit, pct: due ? Math.round((hit / due) * 100) : 0 };
}

function buildHabitChips(task, todayCode) {
  return WEEKDAY_CODES.map((code) => {
    const active = task.habit_weekdays.includes(code);
    const isToday = code === todayCode;
    const doneToday = isToday && task.planned_date === todayISO() && task.status === "done";
    const classes = ["weekday-chip"];
    if (isToday && active) classes.push(doneToday ? "today-done" : "today-due");
    return `<button type="button" class="${classes.join(" ")}" data-day="${code}" data-active="${active}">${WEEKDAY_LABEL[code]}</button>`;
  }).join("");
}

function buildRecurrenceOptions(task) {
  const current = task.habit_recurrence || "weekly";
  return Object.entries(RECURRENCE_LABEL)
    .map(([value, label]) => `<option value="${value}"${current === value ? " selected" : ""}>${label}</option>`)
    .join("");
}

// Konsolidierte DOM-Aktualisierung nach einer habit_weekdays-Änderung (Einzel-Chip-Toggle oder
// Mo-Fr/Wochenende/Täglich-Preset) — rendert die Chip-Gruppe komplett neu statt nur ein Dataset zu
// togglen, damit ein Preset alle sieben Chips auf einmal aktualisieren kann.
function updateHabitWeekdayChips(li, task, todayCode) {
  li.querySelector(".weekday-chips").innerHTML = buildHabitChips(task, todayCode);
  const recurrence = task.habit_recurrence || "weekly";
  li.querySelector(".habit-freq").textContent =
    recurrence === "weekly"
      ? `${task.habit_weekdays.length}× pro Woche`
      : `${task.habit_weekdays.length}× · ${RECURRENCE_LABEL[recurrence]}`;
}

// Rendert die Liste der Habit-Aufgaben. Jede Zeile startet im Kompakt-Zustand (Punktreihe) und
// klappt per Tap auf die editierbaren Mo-So-Chips auf — analog td-subtask-list im Detail-Modal
// nutzt auch das hier nur einen delegierten Klick-Handler auf #habit-list statt pro Zeile.
// Zähl-Habit-Zeile (mengen-basiert): ruhig, kein Tagesurteil — großer +-Button plus
// "heute: N · Ø diese Woche M". Keine Wochentags-/Streak-/Heatmap-Elemente (die gelten nur für
// geplante binäre Habits).
function buildCounterHabitRow(t) {
  const areaColor = habitsViewState.areaColorById[t.area_id];
  const today = sumCounterForDate(habitsViewState.counterLog, t.id, todayISO());
  const avg = weekAverageCounter(habitsViewState.counterLog, t.id, todayISO());
  const unit = escapeHtml(t.habit_unit);
  // Tagesziel (optional): "heute X / Ziel" plus ein Fortschrittsbalken. Ohne Ziel bleibt es beim
  // offenen Zähler wie bisher.
  const goal = Number(t.habit_daily_goal);
  const hasGoal = goal > 0;
  const todayLabel = hasGoal ? `<b>${today}</b> / ${goal}` : `<b>${today}</b>`;
  const goalBar = hasGoal
    ? `<span class="wish-fund-bar counter-goal-bar"><span class="wish-fund-fill${today >= goal ? " is-reached" : ""}" style="width:${Math.min(100, Math.round((today / goal) * 100))}%"></span></span>`
    : "";
  return `
    <li class="task-item habit-item counter-habit-row${hasGoal ? " has-goal" : ""}" data-habit-id="${t.id}" style="${
      areaColor ? `border-left-color:${areaColor};--task-area-color:${areaColor};` : ""
    }">
      <span class="task-area-dot" style="background:${areaColor || "var(--color-text-subtle)"}"></span>
      <div class="counter-body">
        <span class="task-title">${escapeHtml(t.title)}<span class="habit-freq">${unit}</span></span>
        <span class="counter-metric">heute: ${todayLabel} · Ø diese Woche ${avg}</span>
        ${goalBar}
      </div>
      <button type="button" class="counter-add-btn" data-counter-id="${t.id}" aria-label="Eine Einheit hinzufügen">+</button>
    </li>`;
}

function renderHabitList() {
  const habitTasks = habitsViewState.allTasks.filter(isHabitTask);
  const list = document.getElementById("habit-list");
  const todayCode = weekdayCodeFromIso(todayISO());
  list.innerHTML = "";

  if (habitTasks.length === 0) {
    list.appendChild(
      buildEmptyState("Noch keine Habits", "Markiere eine Aufgabe im Bearbeiten-Modal als Habit — sie taucht dann hier auf.")
    );
    return;
  }

  list.innerHTML = habitTasks
    .map((t) => {
      if (isCounterHabit(t)) return buildCounterHabitRow(t);
      const areaColor = habitsViewState.areaColorById[t.area_id];
      const recurrence = t.habit_recurrence || "weekly";
      const freqLabel =
        recurrence === "weekly" ? `${t.habit_weekdays.length}× pro Woche` : `${t.habit_weekdays.length}× · ${RECURRENCE_LABEL[recurrence]}`;
      const streak = computeHabitStreak(t, habitsViewState.completions, todayISO());
      const streakBadge =
        streak.count === 0
          ? ""
          : streak.type === "days"
            ? `<span class="habit-streak-badge" title="${streak.count} Tage in Folge">${STREAK_ICON_FLAME}${streak.count}</span>`
            : `<span class="habit-streak-badge is-total" title="${streak.count}× erledigt">${streak.count}×</span>`;
      const heatmap = buildHabitHeatmap(t, habitsViewState.completions, todayISO());
      // Wochen-Ziel-Ring: bei wöchentlichen Habits ist die Zahl der gewählten Tage das Wochensoll.
      // Zeigt "erledigt diese Woche / Soll" als kleiner Ring, ergänzend zu Streak (langfristig) und
      // Heatmap (letzte 7 Tage).
      const weekGoal = recurrence === "weekly" ? t.habit_weekdays.length : 0;
      let weekRing = "";
      if (weekGoal > 0) {
        const weekStart = weekStartISO();
        const weekDone = habitsViewState.completions.filter(
          (c) => c.task_id === t.id && c.date >= weekStart && c.date <= todayISO()
        ).length;
        const pct = Math.min(100, Math.round((weekDone / weekGoal) * 100));
        weekRing = `<span class="habit-week-ring${weekDone >= weekGoal ? " is-complete" : ""}" style="--ring-pct:${pct}" title="${weekDone} von ${weekGoal} diese Woche" aria-label="${weekDone} von ${weekGoal} diese Woche"><span>${weekDone}/${weekGoal}</span></span>`;
      }
      // Monats-Konstanz-Balken: erledigte vs. fällige Tage im laufenden Monat bis heute.
      const month = habitMonthProgress(t, habitsViewState.completions, todayISO());
      const monthBar =
        month.due > 0
          ? `<div class="habit-month"><span class="habit-month-label">${HABIT_MONTH_LABEL} ${month.pct}%</span><span class="habit-month-bar"><i style="width:${month.pct}%"></i></span></div>`
          : "";
      // Aufgaben-Pool: die Unteraufgaben (parent_task_id), aus denen findHabitsDueToday an einem
      // fälligen Tag rotierend eine auswählt. Bisher nur beim Anlegen / im Detail-Modal ergänzbar —
      // hier ein Inline-Add direkt in der Zeile (implementieren-jetzt.md, Tab-Feedback 2026-08-02).
      const poolChildren = habitsViewState.allTasks.filter((c) => c.parent_task_id === t.id);
      const poolList = poolChildren.length
        ? `<ul class="habit-pool-list">${poolChildren.map((c) => `<li>${escapeHtml(c.title)}</li>`).join("")}</ul>`
        : "";
      return `
      <li class="task-item habit-item" data-habit-id="${t.id}" data-expanded="false" style="${
        areaColor ? `border-left-color:${areaColor};--task-area-color:${areaColor};` : ""
      }">
        <span class="task-area-dot" style="background:${areaColor || "var(--color-text-subtle)"}"></span>
        <div class="habit-body">
          <button type="button" class="habit-toggle" aria-expanded="false">
            <span class="task-title">${escapeHtml(t.title)}<span class="habit-freq">${freqLabel}</span></span>
            <span class="habit-metrics">${weekRing}${heatmap}${streakBadge}</span>
          </button>
          ${monthBar}
          <div class="habit-expanded" hidden>
            <div class="habit-weekday-presets" role="group" aria-label="Wochentage-Voreinstellungen">
              <button type="button" class="chip-btn habit-preset-btn" data-preset="workdays">Mo–Fr</button>
              <button type="button" class="chip-btn habit-preset-btn" data-preset="weekend">Wochenende</button>
              <button type="button" class="chip-btn habit-preset-btn" data-preset="daily">Täglich</button>
            </div>
            <div class="weekday-chips" role="group" aria-label="Wochentage">
              ${buildHabitChips(t, todayCode)}
            </div>
            <label class="modal-label habit-recurrence-row">
              Wiederholung
              <select class="select habit-recurrence-select" data-habit-recurrence>${buildRecurrenceOptions(t)}</select>
            </label>
            <div class="habit-pool">
              <span class="habit-pool-label">Aufgaben-Pool</span>
              ${poolList}
              <div class="habit-pool-add">
                <input type="text" class="input habit-pool-input" placeholder="Aufgabe hinzufügen…" autocomplete="off" data-habit-pool-input />
                <button type="button" class="chip-btn habit-pool-add-btn" data-habit-pool-add aria-label="Aufgabe zum Pool hinzufügen">+</button>
              </div>
            </div>
            <button type="button" class="habit-delete-btn" data-habit-delete>Habit löschen</button>
          </div>
        </div>
      </li>`;
    })
    .join("");

  list.onclick = async (e) => {
    const counterBtn = e.target.closest(".counter-add-btn");
    if (counterBtn) {
      const taskId = counterBtn.dataset.counterId;
      const task = habitsViewState.allTasks.find((t) => t.id === taskId);
      await withErrorToast(async () => {
        const entry = await logCounterTap({ taskId });
        habitsViewState.counterLog.push(entry);
        renderHabitList();
        showToast(`+1 ${task ? task.habit_unit : ""}`.trim(), false, {
          label: "Rückgängig",
          onClick: () =>
            withErrorToast(async () => {
              await deleteCounterEntry(entry.id);
              habitsViewState.counterLog = habitsViewState.counterLog.filter((c) => c.id !== entry.id);
              renderHabitList();
            }),
        });
      });
      return;
    }

    const chip = e.target.closest(".weekday-chip");
    if (chip) {
      const li = chip.closest("[data-habit-id]");
      const task = habitsViewState.allTasks.find((t) => t.id === li.dataset.habitId);
      const day = chip.dataset.day;
      const nextDays = task.habit_weekdays.includes(day)
        ? task.habit_weekdays.filter((d) => d !== day)
        : [...task.habit_weekdays, day];
      await withErrorToast(async () => {
        await updateTask(task.id, { habit_weekdays: nextDays });
        task.habit_weekdays = nextDays;
        updateHabitWeekdayChips(li, task, todayCode);
      });
      return;
    }

    const presetBtn = e.target.closest(".habit-preset-btn");
    if (presetBtn) {
      const li = presetBtn.closest("[data-habit-id]");
      const task = habitsViewState.allTasks.find((t) => t.id === li.dataset.habitId);
      const PRESET_WEEKDAYS = {
        workdays: ["mon", "tue", "wed", "thu", "fri"],
        weekend: ["sat", "sun"],
        daily: WEEKDAY_CODES,
      };
      const nextDays = PRESET_WEEKDAYS[presetBtn.dataset.preset];
      await withErrorToast(async () => {
        await updateTask(task.id, { habit_weekdays: nextDays });
        task.habit_weekdays = nextDays;
        updateHabitWeekdayChips(li, task, todayCode);
      });
      return;
    }

    const poolAddBtn = e.target.closest("[data-habit-pool-add]");
    if (poolAddBtn) {
      await addHabitPoolChild(poolAddBtn.closest("[data-habit-id]"));
      return;
    }

    const deleteBtn = e.target.closest("[data-habit-delete]");
    if (deleteBtn) {
      const li = deleteBtn.closest("[data-habit-id]");
      const task = habitsViewState.allTasks.find((t) => t.id === li.dataset.habitId);
      // Kein Undo-Toast wie bei normalen Aufgaben: restoreTaskSnapshot stellt die Habit-Felder
      // (is_habit/habit_weekdays/habit_recurrence …) nicht wieder her, ein Undo würde den Habit
      // still zu einer normalen Aufgabe degradieren. Darum bewusst das Rezept/Geburtstag-Muster
      // (Bestätigung statt Undo). Pool-Kinder entfernt die DB per Cascade mit.
      const ok = await showConfirm(`„${task.title}" wirklich löschen?`, { confirmLabel: "Löschen", danger: true });
      if (!ok) return;
      await withErrorToast(async () => {
        await deleteTask(task.id);
        await renderHabitsView();
      });
      return;
    }

    const toggle = e.target.closest(".habit-toggle");
    if (toggle) {
      const li = toggle.closest("[data-habit-id]");
      const expanded = li.dataset.expanded === "true";
      li.dataset.expanded = String(!expanded);
      toggle.setAttribute("aria-expanded", String(!expanded));
      li.querySelector(".habit-expanded").hidden = expanded;
    }
  };

  list.onchange = async (e) => {
    const select = e.target.closest("[data-habit-recurrence]");
    if (!select) return;
    const li = select.closest("[data-habit-id]");
    const task = habitsViewState.allTasks.find((t) => t.id === li.dataset.habitId);
    const nextRecurrence = select.value;
    await withErrorToast(async () => {
      // habit_last_due_date bewusst NICHT mitschicken — ein Intervall-Wechsel allein darf den
      // Anker nicht zurücksetzen (siehe isRecurrenceDue in habits.js).
      await updateTask(task.id, { habit_recurrence: nextRecurrence });
      // Beim Wechsel auf biweekly/monthly zeigt das Badge ab dem nächsten Re-Render die Gesamtzahl
      // aller Erledigungen — geladen ist aber für wöchentliche Habits nur das Streak-Fenster.
      if (nextRecurrence !== "weekly") {
        habitsViewState.completions = mergeCompletions(
          habitsViewState.completions,
          await listHabitCompletionsForTasks([task.id])
        );
      }
      task.habit_recurrence = nextRecurrence;
    });
  };

  list.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest("[data-habit-pool-input]");
    if (!input) return;
    e.preventDefault();
    addHabitPoolChild(input.closest("[data-habit-id]"));
  };
}

// Legt ein neues Pool-Kind (parent_task_id = Habit) aus dem Inline-Feld einer Habit-Zeile an.
// Statt renderHabitsView() (voller Refetch, der die Zeile zuklappen würde) wird die neue Aufgabe
// lokal in habitsViewState.allTasks eingehängt und die Liste neu gerendert — danach die betroffene
// Zeile wieder aufklappen und das Feld fokussieren, damit mehrere Aufgaben zügig nacheinander
// eingegeben werden können. Das Kind ist selbst kein Habit (habit_weekdays: null) und taucht daher
// nur im Pool auf, nicht als eigene Habit-Zeile.
async function addHabitPoolChild(li) {
  if (!li) return;
  const habitId = li.dataset.habitId;
  const input = li.querySelector("[data-habit-pool-input]");
  const title = input.value.trim();
  if (!title) {
    input.focus();
    return;
  }
  await withErrorToast(async () => {
    const created = await createTask({ title, parentTaskId: habitId });
    habitsViewState.allTasks.push(created);
    renderHabitList();
    const freshLi = document.querySelector(`#habit-list [data-habit-id="${habitId}"]`);
    if (freshLi) {
      freshLi.dataset.expanded = "true";
      const toggle = freshLi.querySelector(".habit-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
      const expanded = freshLi.querySelector(".habit-expanded");
      if (expanded) expanded.hidden = false;
      const freshInput = freshLi.querySelector("[data-habit-pool-input]");
      if (freshInput) freshInput.focus();
    }
  });
}
