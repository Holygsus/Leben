// Ansicht "Kühlschrank" (#/kuehlschrank).
import { listPantryItems, createPantryItem, updatePantryItem, deletePantryItem } from "../pantry.js";
import { todayISO, isoDayDiff } from "../ui/dates.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";

/* ---------- Kühlschrank ---------- */
// wissensdatenbank/features/kochen-rezepte-kuehlschrank.md, Punkt 2 — diese Runde deckt nur den
// manuellen Bestand-Teil ab (Zu-/Abgangs-Werkzeug), keine automatische OCR-Befüllung.

// Freies category-Feld auf pantry_items (kein CHECK-Constraint), aber eine feste, kleine Auswahl
// hält die Liste konsistent statt frei getippter Varianten (implementieren-jetzt.md, Triage
// 2026-07-21) — geteilt zwischen Quick-Add-Select (kuehlschrank.html) und Inline-Edit pro Zeile.
const PANTRY_CATEGORY_LABELS = {
  kuehlschrank: "Kühlschrank",
  tiefkuehl: "Tiefkühl",
  vorrat: "Vorrat",
  gewuerze: "Gewürze",
};

// Icon + Farbe je Kategorie für die Gruppen-Überschriften (spiegelt die mentale Ordnung einer
// Küche). Reihenfolge = Anzeigereihenfolge der Abschnitte; "" fängt unkategorisierte Items ab.
const PANTRY_CATEGORY_META = {
  kuehlschrank: { label: "Kühlschrank", icon: "❄️", color: "var(--color-accent)" },
  tiefkuehl: { label: "Tiefkühl", icon: "🧊", color: "var(--color-cat-gesundheit)" },
  vorrat: { label: "Vorrat", icon: "🥫", color: "var(--color-accent-warm)" },
  gewuerze: { label: "Gewürze", icon: "🌿", color: "var(--color-success)" },
};
const PANTRY_CATEGORY_ORDER = ["kuehlschrank", "tiefkuehl", "vorrat", "gewuerze", ""];

export async function renderKuehlschrankView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/kuehlschrank.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  await renderPantryList();
  wirePantryQuickAddForm();
}

async function renderPantryList() {
  const list = document.getElementById("pantry-list");
  const emptyState = document.getElementById("pantry-empty-state");
  const items = await listPantryItems();
  list.innerHTML = "";
  if (items.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  // Nach Kategorie gruppiert mit Icon-Überschrift statt einer flachen Liste.
  for (const cat of PANTRY_CATEGORY_ORDER) {
    const catItems = items.filter((i) => (i.category || "") === cat);
    if (catItems.length === 0) continue;
    const meta = PANTRY_CATEGORY_META[cat] || { label: "Ohne Kategorie", icon: "📦", color: "var(--color-text-subtle)" };

    const section = document.createElement("section");
    section.className = "pantry-group";

    const header = document.createElement("div");
    header.className = "pantry-group-header";
    header.style.setProperty("--c", meta.color);
    header.innerHTML =
      `<span class="pantry-group-icon" aria-hidden="true">${meta.icon}</span>` +
      `<span class="pantry-group-title">${meta.label}</span>` +
      `<span class="count">${catItems.length}</span>`;
    section.appendChild(header);

    const ul = document.createElement("ul");
    ul.className = "task-list";
    for (const item of catItems) ul.appendChild(buildPantryItem(item));
    section.appendChild(ul);

    list.appendChild(section);
  }
}

// Menge direkt editierbar (Blur committet) — gleiches Muster wie buildTransactionItem's Notiz-Feld.
// "Best effort"-Bestand (siehe kochen-rezepte-kuehlschrank.md): kein exaktes Inventar, daher reicht
// ein Freitext-Feld statt einer Zahl+Einheit-Erfassung.
// Ablauf-Status einer Zutat relativ zu heute: "expired" (MHD vorbei), "soon" (heute bis in 3 Tagen),
// sonst null. Reine Funktion — auch von der Cockpit-Kachel genutzt.
const PANTRY_EXPIRY_SOON_DAYS = 3;
export function pantryExpiryStatus(expiresAt, todayIso) {
  if (!expiresAt) return null;
  const days = isoDayDiff(todayIso, expiresAt);
  if (days == null) return null;
  if (days < 0) return { state: "expired", days };
  if (days <= PANTRY_EXPIRY_SOON_DAYS) return { state: "soon", days };
  return null;
}

function buildPantryItem(item) {
  const li = document.createElement("li");
  li.className = "task-item tx-item pantry-item";

  const nameSpan = document.createElement("span");
  nameSpan.className = "task-title pantry-name";
  nameSpan.textContent = item.name;

  const amountInput = document.createElement("input");
  amountInput.type = "text";
  amountInput.className = "input pantry-amount";
  amountInput.value = item.amount || "";
  amountInput.placeholder = "Menge";
  amountInput.setAttribute("aria-label", "Menge");
  amountInput.addEventListener("blur", async () => {
    const value = amountInput.value.trim();
    if (value === (item.amount || "")) return;
    await withErrorToast(async () => {
      await updatePantryItem(item.id, { amount: value || null });
      await renderPantryList();
    });
  });
  amountInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") amountInput.blur();
  });

  const categorySelect = document.createElement("select");
  categorySelect.className = "select";
  categorySelect.setAttribute("aria-label", "Kategorie");
  categorySelect.innerHTML = `<option value="">Kategorie</option>${Object.entries(PANTRY_CATEGORY_LABELS)
    .map(([value, label]) => `<option value="${value}"${item.category === value ? " selected" : ""}>${label}</option>`)
    .join("")}`;
  categorySelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updatePantryItem(item.id, { category: categorySelect.value || null });
      await renderPantryList();
    });
  });

  // Haltbar-bis, inline editierbar. Leeren des Feldes entfernt das MHD wieder.
  const expiresInput = document.createElement("input");
  expiresInput.type = "date";
  expiresInput.className = "input pantry-expires";
  expiresInput.value = item.expires_at || "";
  expiresInput.setAttribute("aria-label", "Haltbar bis");
  expiresInput.addEventListener("change", async () => {
    const value = expiresInput.value || null;
    if (value === (item.expires_at || null)) return;
    await withErrorToast(async () => {
      await updatePantryItem(item.id, { expires_at: value });
      await renderPantryList();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Aus dem Kühlschrank entfernen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deletePantryItem(item.id);
      await renderPantryList();
    });
    showToast(`„${item.name}" entfernt.`, false, {
      label: "Rückgängig",
      onClick: () =>
        withErrorToast(async () => {
          await createPantryItem({ name: item.name, amount: item.amount, category: item.category, expiresAt: item.expires_at });
          await renderPantryList();
        }),
    });
  });

  li.append(nameSpan, amountInput, expiresInput, categorySelect, deleteBtn);

  // Ablauf-Badge (volle Breite unter der Zeile): "abgelaufen" bzw. "läuft bald ab" macht kritische
  // Zutaten beim Scrollen sofort erkennbar, ohne jedes Datum einzeln zu lesen.
  const expiry = pantryExpiryStatus(item.expires_at, todayISO());
  if (expiry) {
    li.classList.add(expiry.state === "expired" ? "pantry-expired" : "pantry-soon");
    const badge = document.createElement("span");
    badge.className = "pantry-expiry-badge";
    badge.textContent =
      expiry.state === "expired"
        ? "abgelaufen"
        : expiry.days === 0
          ? "läuft heute ab"
          : expiry.days === 1
            ? "läuft morgen ab"
            : `läuft in ${expiry.days} Tagen ab`;
    li.append(badge);
  }
  return li;
}

function wirePantryQuickAddForm() {
  const toggleBtn = document.getElementById("pantry-quick-add-toggle");
  const form = document.getElementById("pantry-quick-form");
  const nameInput = document.getElementById("pantry-quick-name");
  const amountInput = document.getElementById("pantry-quick-amount");
  const expiresInput = document.getElementById("pantry-quick-expires");
  const categorySelect = document.getElementById("pantry-quick-category");
  const cancelBtn = document.getElementById("pantry-quick-cancel");

  const closeForm = () => {
    form.hidden = true;
    form.reset();
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      nameInput.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    await withErrorToast(async () => {
      await createPantryItem({
        name,
        amount: amountInput.value.trim() || null,
        category: categorySelect.value || null,
        expiresAt: expiresInput.value || null,
      });
      closeForm();
      await renderPantryList();
    });
  });
}
