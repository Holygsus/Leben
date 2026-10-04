// Kleine DOM-/Markup-Helfer: escapeHtml, Icons, Empty-States, Aufgaben-Optionsliste.
import { buildTaskTree } from "../tasks.js";

export const WEEKDAY_LABEL = { mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So" };

// Kleine Icons vor Badge-Text — macht "Habit"/"Brainstorm"/"Überfällig" beim schnellen Scrollen
// schneller unterscheidbar als drei ähnlich lange Wörter in ähnlichen Farbtönen.
export const BADGE_ICON_HABIT = `<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>`;
export const BADGE_ICON_BRAINSTORM = `<svg viewBox="0 0 24 24"><path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-3 11.2c.6.4 1 1.1 1 1.8v.5h4v-.5c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 2Z"/></svg>`;
export const BADGE_ICON_OVERDUE = `<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>`;
// SVG statt Emoji für die Streak-Anzeige (Konvention der App: konsistente Strich-Icons statt
// Emoji, die je nach Betriebssystem unterschiedlich rendern).
export const STREAK_ICON_FLAME = `<svg viewBox="0 0 24 24"><path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c1.5 1 2 3 2 4.5A5.5 5.5 0 0 1 6 14.5C6 9 12 7 12 2z"/></svg>`;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// Kleine Inline-SVG-Icons statt Emoji (📌/💪 rendern je nach Betriebssystem unterschiedlich
// bunt/inkonsistent) — erben ihre Farbe über currentColor vom umgebenden Element.
function buildInlineIcon(pathMarkup) {
  const span = document.createElement("span");
  span.className = "inline-icon";
  span.innerHTML = `<svg viewBox="0 0 24 24">${pathMarkup}</svg>`;
  return span;
}

export function buildPinIcon() {
  return buildInlineIcon(`<path d="M12 2l2 6 6 2-5 4 1 7-6-4-6 4 1-7-5-4 6-2z"/>`);
}

export function buildEditIcon() {
  return buildInlineIcon(`<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>`);
}

export function buildTrashIcon() {
  return buildInlineIcon(
    `<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 6h12Z"/>`
  );
}

export function buildDuplicateIcon() {
  return buildInlineIcon(
    `<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`
  );
}

// Eigener Wrapper statt buildInlineIcon(), weil .inline-icon svg global auf stroke-only (fill:none)
// gesetzt ist — ein Punkte-Raster braucht dagegen gefüllte Kreise.
export function buildDragHandleIcon() {
  const span = document.createElement("span");
  span.className = "drag-handle-icon";
  span.innerHTML =
    `<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>` +
    `<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>` +
    `<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
  return span;
}

// Baut einen einladenderen Leerzustand (Icon + Titel + Untertext) statt eines reinen Textsatzes.
// iconPath ist austauschbar (Default: Plus, "leg das erste an") — z.B. für "Keine Treffer" bei der
// Suche ist "hinzufügen" nicht die passende Handlung, dort übergibt der Aufrufer ein Lupen-Icon.
const EMPTY_STATE_ADD_ICON = `<path d="M12 5v14M5 12h14"/>`;
export const EMPTY_STATE_SEARCH_ICON = `<circle cx="10" cy="10" r="6"/><path d="M21 21l-4.35-4.35"/>`;
export function buildEmptyState(title, subtitle, iconPath = EMPTY_STATE_ADD_ICON) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state-rich";
  wrap.innerHTML = `<svg viewBox="0 0 24 24">${iconPath}</svg><strong></strong><span></span>`;
  wrap.querySelector("strong").textContent = title;
  wrap.querySelector("span").textContent = subtitle;
  return wrap;
}

// Baut eingerückte <option>-Elemente für den Aufgabenbaum eines Bereichs (fuer "Uebergeordnete
// Aufgabe"-Auswahlen). excludeIds laesst sich nutzen, um beim Verschieben/Zuordnen eine Aufgabe
// und ihre eigenen Nachfahren aus der Zielauswahl auszuschliessen (Zyklus-Schutz).
export function taskOptionsHtml(tasks, areaId, selectedId, excludeIds = null) {
  if (!areaId) return "";
  const scoped = tasks.filter((t) => t.area_id === areaId && (!excludeIds || !excludeIds.has(t.id)));
  const tree = buildTaskTree(scoped, null);
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      const prefix = "  ".repeat(depth);
      const badge = n.is_pinned ? "📌 " : "";
      out.push(
        `<option value="${n.id}"${n.id === selectedId ? " selected" : ""}>${prefix}${badge}${escapeHtml(n.title)}</option>`
      );
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out.join("");
}
