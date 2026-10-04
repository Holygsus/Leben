// Globale Popups: Tagesreflexion, Gedanken-Nudge, Aufgaben-Feedback, Folgeaufgaben.
import { createThought } from "../thoughts.js";
import { createTaskFeedback } from "../feedback.js";
import { getReflectionForDate, createReflection } from "../reflections.js";
import { listOpenFollowupGroups, resolveFollowupGroup } from "../followups.js";
import { todayISO } from "./dates.js";
import { escapeHtml } from "./dom.js";
import { showToast, withErrorToast } from "./modals.js";
import { state, renderShell } from "./state.js";

// ----- Tagesreflexion-Popup (22–24 Uhr) -----
// Client-seitige Zeitprüfung bei jedem renderShell()-Aufruf (App-Start/View-Wechsel), kein Cron
// nötig — siehe wissensdatenbank/features/tagesreflexion.md. Snooze/Dismiss-Zustand liegt bewusst
// in localStorage statt in der DB (reines UI-Verhalten für den aktuellen Abend, analog
// QUICK_WIN_STORAGE_PREFIX), ob der Tag selbst schon beantwortet wurde, entscheidet dagegen immer
// die DB (daily_reflections), nicht localStorage.
const REFLECTION_DISMISSED_PREFIX = "leben-os:reflection-dismissed:";
const REFLECTION_SNOOZE_PREFIX = "leben-os:reflection-snooze-until:";
const REFLECTION_SNOOZED_ONCE_PREFIX = "leben-os:reflection-snoozed-once:";
const REFLECTION_SNOOZE_MINUTES = 30;

let reflectionPopupOpen = false;

// ----- Snapshot-Nudge (Gedanken-Impuls) -----
// Sanfter, einmal-täglicher Impuls, der rohes Material in `thoughts` erzeugt (siehe
// wissensdatenbank/leben-os-betriebsmodell.md, "Der Gedanken-Eingang"). Muster wie die Reflexion,
// aber: erscheint nur EINMAL pro Tag (Flag beim Öffnen) statt bis zur Antwort wiederzukommen, und
// nur vor 22 Uhr (das Abendfenster gehört der Reflexion).
const THOUGHT_NUDGE_SHOWN_PREFIX = "leben-os:thought-nudge-shown:";
let thoughtNudgeOpen = false;

export function maybeShowThoughtNudge() {
  // Nie zwei Popups gleichzeitig — modal-root wird von Reflexion/Folgeaufgaben/Feedback geteilt.
  if (thoughtNudgeOpen || reflectionPopupOpen || followupPopupOpen) return;
  if (document.getElementById("modal-root").innerHTML.trim()) return;
  if (new Date().getHours() >= 22) return;
  const today = todayISO();
  if (localStorage.getItem(THOUGHT_NUDGE_SHOWN_PREFIX + today)) return;
  openThoughtNudge(today);
}

function openThoughtNudge(date) {
  thoughtNudgeOpen = true;
  // Einmal/Tag: Flag direkt beim Öffnen setzen — der Nudge soll nicht nerven.
  localStorage.setItem(THOUGHT_NUDGE_SHOWN_PREFIX + date, "1");
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    state.closeActiveModal = null;
    thoughtNudgeOpen = false;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = close;

  root.innerHTML = `
    <div class="modal-backdrop" id="thought-nudge-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Gedanke festhalten">
        <h2>Was geht dir durch den Kopf?</h2>
        <textarea class="input" id="thought-nudge-input" rows="3" placeholder="Ein Gedanke, eine Idee, irgendwas …"></textarea>
        <div class="modal-actions">
          <button class="btn" type="button" id="thought-nudge-submit">Festhalten</button>
          <button class="btn btn-secondary" type="button" id="thought-nudge-later">Später</button>
        </div>
      </div>
    </div>`;

  document.getElementById("thought-nudge-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "thought-nudge-backdrop") close();
  });

  document.getElementById("thought-nudge-submit").addEventListener("click", async () => {
    const body = document.getElementById("thought-nudge-input").value.trim();
    if (!body) {
      close();
      return;
    }
    await withErrorToast(async () => {
      await createThought({ body });
      showToast("Gedanke festgehalten.");
      close();
    });
  });

  document.getElementById("thought-nudge-later").addEventListener("click", close);
}

export async function maybeShowReflectionPopup() {
  const hour = new Date().getHours();
  if (hour < 22 || hour >= 24) return;
  if (reflectionPopupOpen) return;

  const today = todayISO();
  if (localStorage.getItem(REFLECTION_DISMISSED_PREFIX + today)) return;
  const snoozeUntil = localStorage.getItem(REFLECTION_SNOOZE_PREFIX + today);
  if (snoozeUntil && Date.now() < Number(snoozeUntil)) return;

  const existing = await getReflectionForDate(today).catch(() => undefined);
  if (existing) return;

  openReflectionPopup(today);
}

function openReflectionPopup(date) {
  reflectionPopupOpen = true;
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";
  const alreadySnoozed = Boolean(localStorage.getItem(REFLECTION_SNOOZED_ONCE_PREFIX + date));

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    state.closeActiveModal = null;
    reflectionPopupOpen = false;
  };
  const dismiss = () => {
    localStorage.setItem(REFLECTION_DISMISSED_PREFIX + date, "1");
    close();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") dismiss();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = dismiss;

  root.innerHTML = `
    <div class="modal-backdrop" id="reflection-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Tagesreflexion">
        <h2>Wie war dein Tag?</h2>
        <div class="priority-chips" id="reflection-mood-chips" role="group" aria-label="Stimmung">
          ${[1, 2, 3, 4, 5].map((m) => `<button type="button" class="priority-chip" data-mood="${m}">${m}</button>`).join("")}
        </div>
        <label class="modal-label">
          Notiz (optional)
          <textarea class="input" id="reflection-note" rows="2"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" id="reflection-submit">Absenden</button>
          ${alreadySnoozed ? "" : `<button class="btn btn-secondary" type="button" id="reflection-snooze">In 30 Min. nochmal</button>`}
          <button class="btn btn-secondary" type="button" id="reflection-dismiss">Nicht heute</button>
        </div>
      </div>
    </div>`;

  document.getElementById("reflection-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "reflection-backdrop") dismiss();
  });

  let selectedMood = null;
  const moodChips = document.getElementById("reflection-mood-chips");
  moodChips.querySelectorAll(".priority-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedMood = Number(chip.dataset.mood);
      moodChips.querySelectorAll(".priority-chip").forEach((c) => (c.dataset.active = String(c.dataset.mood === String(selectedMood))));
    });
  });

  document.getElementById("reflection-submit").addEventListener("click", async () => {
    if (!selectedMood) {
      showToast("Bitte eine Stimmung auswählen.", true);
      return;
    }
    const note = document.getElementById("reflection-note").value.trim();
    await withErrorToast(async () => {
      await createReflection({ date, mood: selectedMood, note: note || null });
      close();
    });
  });

  const snoozeBtn = document.getElementById("reflection-snooze");
  if (snoozeBtn) {
    snoozeBtn.addEventListener("click", () => {
      localStorage.setItem(REFLECTION_SNOOZE_PREFIX + date, String(Date.now() + REFLECTION_SNOOZE_MINUTES * 60000));
      localStorage.setItem(REFLECTION_SNOOZED_ONCE_PREFIX + date, "1");
      close();
    });
  }

  document.getElementById("reflection-dismiss").addEventListener("click", dismiss);
}

// Task-Feedback beim Abschließen einer Aufgabe (siehe wissensdatenbank/leben-os-betriebsmodell.md).
// Leichtes, wegklickbares Sheet: Rating 1–5 (Pflicht zum Absenden) + optionale Notiz, die das Ergebnis
// weiterträgt ("September 2026"). Überspringen/Escape/Backdrop schließen ohne zu speichern (kein
// Blocker). Gibt ein Promise zurück, das beim Schließen resolvet — der Aufrufer wartet, bevor er das
// Folgeaufgaben-Popup öffnet (beide teilen sich modal-root).
export function openTaskFeedbackSheet(task) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    document.body.style.overflow = "hidden";

    const close = () => {
      root.innerHTML = "";
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
      state.closeActiveModal = null;
      resolve();
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeydown);
    state.closeActiveModal = close;

    root.innerHTML = `
      <div class="modal-backdrop" id="feedback-backdrop">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Aufgaben-Feedback">
          <h2>Wie lief das?</h2>
          <p style="margin:-4px 0 4px;color:var(--color-text-subtle);font-size:.9rem;">${escapeHtml(task.title)}</p>
          <div class="priority-chips" id="feedback-rating-chips" role="group" aria-label="Bewertung">
            ${[1, 2, 3, 4, 5].map((r) => `<button type="button" class="priority-chip" data-rating="${r}">${r}</button>`).join("")}
          </div>
          <label class="modal-label">
            Notiz (optional)
            <textarea class="input" id="feedback-note" rows="2"></textarea>
          </label>
          <div class="modal-actions">
            <button class="btn" type="button" id="feedback-submit">Absenden</button>
            <button class="btn btn-secondary" type="button" id="feedback-skip">Überspringen</button>
          </div>
        </div>
      </div>`;

    document.getElementById("feedback-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "feedback-backdrop") close();
    });

    let selectedRating = null;
    const ratingChips = document.getElementById("feedback-rating-chips");
    ratingChips.querySelectorAll(".priority-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        selectedRating = Number(chip.dataset.rating);
        ratingChips.querySelectorAll(".priority-chip").forEach((c) => (c.dataset.active = String(c.dataset.rating === String(selectedRating))));
      });
    });

    document.getElementById("feedback-submit").addEventListener("click", async () => {
      if (!selectedRating) {
        showToast("Bitte eine Bewertung wählen.", true);
        return;
      }
      const note = document.getElementById("feedback-note").value.trim();
      await withErrorToast(async () => {
        await createTaskFeedback({ taskId: task.id, rating: selectedRating, note: note || null });
        close();
      });
    });

    document.getElementById("feedback-skip").addEventListener("click", close);
  });
}

// wissensdatenbank/features/folgeaufgaben-vorschlaege.md. Der manuell ausgelöste Skill schreibt
// Vorschläge in die DB; die App zeigt sie hier im "Neue Vorschläge"-Popup (Auswahl 0–5 + Bestätigen).

let followupPopupOpen = false;

export async function maybeShowFollowupPopup() {
  if (followupPopupOpen || state.followupPopupSnoozed) return;
  // Kein zweites Modal über ein bereits offenes (z. B. die Tagesreflexion) legen.
  if (state.closeActiveModal) return;
  const groups = await listOpenFollowupGroups().catch(() => []);
  if (!groups.length) return;
  openFollowupPopup(groups);
}

// Öffnet das "Neue Vorschläge"-Popup direkt im Abschluss-Moment, wenn completeTaskCascade beim
// Abhaken stumme Vorschläge sichtbar geschaltet hat (Phase B, siehe js/tasks.js). Setzt ein evtl.
// gesetztes Snooze zurück, damit ein frischer Abschluss trotzdem sofort auftaucht.
export async function triggerFollowupPopupAfterCompletion(unmuted) {
  if (!unmuted) return;
  state.followupPopupSnoozed = false;
  await maybeShowFollowupPopup();
}

export function openFollowupPopup(groups) {
  followupPopupOpen = true;
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    state.closeActiveModal = null;
    followupPopupOpen = false;
  };
  const snooze = () => {
    state.followupPopupSnoozed = true;
    close();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") snooze();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = snooze;

  root.innerHTML = `
    <div class="modal-backdrop" id="followup-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Neue Folgeaufgaben-Vorschläge">
        <h2>Neue Vorschläge</h2>
        <p class="followup-intro">Welche nächsten Schritte willst du übernehmen?</p>
        ${groups
          .map(
            (group) => `
          <div class="followup-group" data-source-id="${escapeHtml(group.sourceTask.id)}">
            <h3 class="followup-source-title">${escapeHtml(group.sourceTask.title)}</h3>
            ${group.suggestions
              .map(
                (s) => `
              <label class="checkbox-label followup-option">
                <input type="checkbox" data-suggestion-id="${escapeHtml(s.id)}" />
                ${s.frame ? `<span class="followup-frame">${escapeHtml(s.frame)}</span>` : ""}
                <span class="followup-title">${escapeHtml(s.title)}</span>
              </label>`
              )
              .join("")}
          </div>`
          )
          .join("")}
        <div class="modal-actions">
          <button class="btn" type="button" id="followup-confirm">Bestätigen</button>
          <button class="btn btn-secondary" type="button" id="followup-later">Später</button>
        </div>
      </div>
    </div>`;

  document.getElementById("followup-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "followup-backdrop") snooze();
  });
  document.getElementById("followup-later").addEventListener("click", snooze);

  document.getElementById("followup-confirm").addEventListener("click", async () => {
    await withErrorToast(async () => {
      let created = 0;
      for (const group of groups) {
        const groupEl = document.querySelector(`.followup-group[data-source-id="${cssEscapeAttr(group.sourceTask.id)}"]`);
        const acceptedIds = groupEl
          ? [...groupEl.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.dataset.suggestionId)
          : [];
        created += acceptedIds.length;
        // Jede angezeigte Aufgabe wird bewusst geschlossen (auch bei 0 Auswahl → nie wieder Vorschläge).
        await resolveFollowupGroup(group, acceptedIds);
      }
      close();
      showToast(created ? `${created} Folgeaufgabe(n) übernommen.` : "Vorschläge geschlossen.");
      renderShell();
    });
  });
}

// Attribut-sichere Variante der Ursprungs-ID für den Selektor oben (UUIDs sind unkritisch, aber so
// bleibt der Selektor auch bei künftigen ID-Formen robust).
function cssEscapeAttr(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}
