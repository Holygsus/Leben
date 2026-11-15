// EXPERIMENT Questmarker (Meyerdinger, Erfindung 00ff3093, Start 15.11.2026, Ablauf 29.11.2026).
// Jede aus dem Vorschlags-Popup übernommene Aufgabe bekommt ein „!“ wie ein Questgeber im
// Rollenspiel. Ein Tipp öffnet den Questzettel: der Grund aus task_followup_suggestions.reason und
// eine Tür (echter Link aus dem Grund, sonst eine als Notlösung markierte Suche). Kein Schema.
// Rückbau: diese Datei löschen, die drei attachQuestMarker-/refreshQuestReasons-Aufrufe in
// js/views/overview.js, today.js, plan.js entfernen, Eintrag in sw.js und CSS-Block „Questmarker“.
import { supabase } from "./supabase.js";
import { escapeHtml } from "./ui/dom.js";
import { state } from "./ui/state.js";

// Map Aufgaben-ID → Grund. Wird beim Laden der Ansicht aufgefrischt, die Zeilen lesen sie synchron.
let questReasons = new Map();

// Lädt die Gründe aller übernommenen Vorschläge. created_step_id ist immer die angelegte Aufgabe
// selbst (bei deepen/new_root ist created_task_id die Kopfaufgabe, die bekommt keinen Marker).
// Scheitert das Laden, bleibt die alte Map stehen: der Marker ist ein Extra, nie ein Grund für
// eine kaputte Ansicht.
export async function refreshQuestReasons() {
  try {
    const { data, error } = await supabase
      .from("task_followup_suggestions")
      .select("created_step_id, reason")
      .eq("status", "accepted")
      .not("created_step_id", "is", null)
      .not("reason", "is", null);
    if (error) throw error;
    questReasons = new Map((data || []).filter((r) => r.reason.trim()).map((r) => [r.created_step_id, r.reason]));
  } catch (err) {
    console.warn("Questmarker: Gründe nicht geladen", err);
  }
}

// Erster http(s)-Link im Text, ohne angehängte Satzzeichen.
export function extractLink(text) {
  const m = (text || "").match(/https?:\/\/[^\s<>"„“]+/i);
  return m ? m[0].replace(/[.,;:!?)\]»“]+$/, "") : null;
}

const VIDEO_HINT = /\b(video|youtube|kanal|folge|episode|trailer|clip|stream|twitch)\b|schau/i;

// Macht aus einem Aufgabentitel einen Suchbegriff: Rahmen wie „Die ersten 5 Minuten von“ und das
// Tätigkeitsverb am Ende fallen weg, der Name des Werks bleibt.
export function searchTermFromTitle(title) {
  return (title || "")
    .replace(/^die ersten \d+ minuten (von|aus|des|der)\s+/i, "")
    .replace(/^(das|den|die|ein|eine|einen)\s+/i, "")
    .replace(/\s+(ganz\s+)?(an)?(schauen|lesen|ansehen|anhören|hören|spielen)$/i, "")
    .trim();
}

// Die Tür auf dem Zettel: { kind: "link" | "search", href, label }.
// Stellschraube 1 (sein Ok 15.11.2026): Suchlink als Notlösung erlaubt, sichtbar als 🔍 markiert.
export function buildQuestDoor(title, reason) {
  const link = extractLink(reason);
  if (link) {
    let host = link;
    try {
      host = new URL(link).hostname.replace(/^www\./, "");
    } catch {
      /* Text bleibt der Link selbst */
    }
    return { kind: "link", href: link, label: `▶ Link öffnen: ${host}` };
  }
  const term = searchTermFromTitle(title);
  if (VIDEO_HINT.test(`${title} ${reason}`)) {
    return {
      kind: "search",
      href: `https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`,
      label: `🔍 Auf YouTube suchen: ${term}`,
    };
  }
  return {
    kind: "search",
    href: `https://www.google.com/search?q=${encodeURIComponent(term)}`,
    label: `🔍 Suchen: ${term}`,
  };
}

// Hängt das „!“ an eine Aufgabenzeile, falls die Aufgabe aus einem Vorschlag stammt.
// Stellschraube 2 (sein Ok 15.11.2026): an jeder übernommenen Aufgabe, nicht nur Video/Artikel.
export function attachQuestMarker(rowEl, task) {
  const reason = questReasons.get(task.id);
  if (!reason) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "quest-marker";
  btn.textContent = "!";
  btn.setAttribute("aria-label", "Questzettel öffnen");
  btn.title = "Warum diese Aufgabe?";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openQuestNote(task, reason);
  });
  rowEl.appendChild(btn);
}

function openQuestNote(task, reason) {
  const root = document.getElementById("modal-root");
  if (!root) return;
  const door = buildQuestDoor(task.title, reason);
  document.body.style.overflow = "hidden";
  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
    state.closeActiveModal = null;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  state.closeActiveModal = close;

  root.innerHTML = `
    <div class="modal-backdrop" id="quest-backdrop">
      <div class="modal-card quest-note" role="dialog" aria-modal="true" aria-labelledby="quest-title">
        <p class="quest-note-label">Questzettel</p>
        <h3 id="quest-title" class="quest-note-title">${escapeHtml(task.title)}</h3>
        <p class="quest-note-reason"><strong>Warum:</strong> ${escapeHtml(reason)}</p>
        <a class="quest-door" href="${escapeHtml(door.href)}" target="_blank" rel="noopener">${escapeHtml(door.label)}${
          door.kind === "search" ? ' <span class="quest-door-hint">Notlösung</span>' : ""
        }</a>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="quest-close">Schließen</button>
        </div>
      </div>
    </div>`;
  document.getElementById("quest-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "quest-backdrop") close();
  });
  document.getElementById("quest-close").addEventListener("click", close);
}
