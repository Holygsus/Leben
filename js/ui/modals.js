// Toast, Bestätigungsdialog, Lade-Platzhalter und Fehlertexte.
import { escapeHtml } from "./dom.js";
import { state } from "./state.js";

let toastTimeout = null;
// action = { label, onClick } | null — zeigt einen Aktions-Button im Toast (z.B. "Rückgängig").
export function showToast(message, isError = false, action = null) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.className = "toast" + (isError ? " toast-error" : "");
  toast.innerHTML = "";

  const text = document.createElement("span");
  text.textContent = message;
  toast.appendChild(text);

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      clearTimeout(toastTimeout);
      toast.hidden = true;
      action.onClick();
    });
    toast.appendChild(btn);
  }

  toast.onclick = (e) => {
    if (e.target.closest(".toast-action")) return;
    clearTimeout(toastTimeout);
    toast.hidden = true;
  };

  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, action ? 6000 : 2000);
}

// Ersetzt window.confirm() durch ein Modal im App-eigenen Stil (nutzt dieselbe #modal-root/
// closeActiveModal-Infrastruktur wie das Aufgaben-Detail-Modal, siehe openTaskDetail()). Löst mit
// true bei Bestätigen, mit false bei Abbrechen/Escape/Backdrop-Klick auf. Nur für Fälle gedacht,
// die sich nicht sinnvoll per Undo-Toast lösen lassen (z.B. Seite verlassen, Bereich löschen) —
// für einfache, rückgängig machbare Löschaktionen lieber direkt löschen + showToast(...,{Rückgängig}).
export function showConfirm(message, { confirmLabel = "Bestätigen", cancelLabel = "Abbrechen", danger = false } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    document.body.style.overflow = "hidden";

    const close = (result) => {
      root.innerHTML = "";
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
      state.closeActiveModal = null;
      resolve(result);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") close(false);
    };
    document.addEventListener("keydown", onKeydown);
    state.closeActiveModal = () => close(false);

    root.innerHTML = `
      <div class="modal-backdrop" id="confirm-backdrop">
        <div class="modal-card" role="alertdialog" aria-modal="true">
          <p>${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="btn" type="button" id="confirm-ok" style="${danger ? "background:var(--color-danger)" : ""}">${escapeHtml(confirmLabel)}</button>
            <button class="btn btn-secondary" type="button" id="confirm-cancel">${escapeHtml(cancelLabel)}</button>
          </div>
        </div>
      </div>`;
    document.getElementById("confirm-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "confirm-backdrop") close(false);
    });
    document.getElementById("confirm-ok").addEventListener("click", () => close(true));
    document.getElementById("confirm-cancel").addEventListener("click", () => close(false));
  });
}

// Übersetzt rohe Supabase/Postgres-Fehler in verständliche deutsche Meldungen. Fehlercodes
// 23505/23503/23502 sind die Standard-Postgres-Codes für unique/foreign-key/not-null-violation.
export function friendlyErrorMessage(err) {
  const message = err?.message || "";
  if (err instanceof TypeError || /Failed to fetch|NetworkError/i.test(message)) {
    return "Keine Verbindung — bitte Internet prüfen und nochmal versuchen.";
  }
  if (err?.code === "23505") return "Das gibt es unter diesem Namen schon.";
  if (err?.code === "23503") return "Das referenzierte Element existiert nicht mehr.";
  if (err?.code === "23502") return "Ein Pflichtfeld fehlt.";
  if (/row-level security/i.test(message)) return "Du hast keine Berechtigung für diese Aktion.";
  if (/rate limit/i.test(message)) return "Zu viele Versuche — bitte kurz warten.";
  if (/JWT expired|invalid claim|invalid or expired|session.*not.*found/i.test(message)) {
    return "Deine Sitzung ist abgelaufen. Bitte die Seite neu laden und erneut anmelden.";
  }
  return message || "Etwas ist schiefgelaufen.";
}

// Zeigt einen Lade-Hinweis in einem Container, solange dessen eigentlicher Inhalt noch per
// Supabase-Request nachgeladen wird (das View-HTML selbst ist bereits da, aber leer).
export function showLoading(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = `<p class="loading-state">Lädt…</p>`;
}

// Führt eine mutierende Aktion aus und zeigt bei Fehlern einen Toast statt still zu scheitern.
export async function withErrorToast(action) {
  try {
    await action();
  } catch (err) {
    showToast(friendlyErrorMessage(err), true);
  }
}
