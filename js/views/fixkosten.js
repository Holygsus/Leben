// Finanz-Unterseite "Fixkosten" (#/fixkosten).
import { listFixedCosts, createFixedCost, updateFixedCost, deleteFixedCost } from "../finance.js";
import { buildEmptyState } from "../ui/dom.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";
import { INTERVAL_LABELS, formatEuro, monthlyAmount } from "./finance.js";

/* ---------- Fixkosten (eigene Unterseite) ---------- */
// wissensdatenbank/finanzen-erweiterungen/finanzplan-erweiterungen-v2.md, Punkt 1 — vorher
// Ausklapp-Panel in finance.html, jetzt eigene Seite mit mehr Platz. Eigener kleiner State statt
// financeState, da financeState.fixedCosts weiterhin für renderPotGrid() im Finanzen-Tab gebraucht
// wird (siehe dortiger Kommentar) und hier unabhängig neu geladen werden muss.

const fixkostenState = { costs: [] };

export async function renderFixkostenView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/fixkosten.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadFixkostenList();
  wireFixkostenForm();
}

async function reloadFixkostenList() {
  fixkostenState.costs = await listFixedCosts();
  renderFixkostenList();
}

function renderFixkostenList() {
  const list = document.getElementById("fixed-costs-list");
  list.innerHTML = "";
  if (fixkostenState.costs.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Fixkosten", "Leg unten die erste feste Ausgabe an."));
    return;
  }
  fixkostenState.costs.forEach((cost) => list.appendChild(buildFixedCostItem(cost)));
}

function buildFixedCostItem(cost) {
  const li = document.createElement("li");
  li.className = "task-item";

  // Name und Betrag sind direkt editierbar (Blur committet) — Fixkosten ändern sich über die Zeit
  // (z.B. Mieterhöhung), dafür braucht es keinen eigenen Bearbeiten-Dialog.
  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = cost.name;
  title.setAttribute("aria-label", "Name");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === cost.name) {
      title.value = cost.name;
      return;
    }
    await withErrorToast(async () => {
      await updateFixedCost(cost.id, { name: value });
      await reloadFixkostenList();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.step = "0.01";
  amountInput.min = "0";
  amountInput.className = "input";
  amountInput.style.maxWidth = "100px";
  amountInput.value = cost.amount;
  amountInput.setAttribute("aria-label", "Betrag");
  amountInput.addEventListener("blur", async () => {
    const value = Number(amountInput.value);
    if (!value || value === Number(cost.amount)) {
      amountInput.value = cost.amount;
      return;
    }
    await withErrorToast(async () => {
      await updateFixedCost(cost.id, { amount: value });
      await reloadFixkostenList();
    });
  });

  const meta = document.createElement("span");
  meta.className = "count";
  // Jahressumme ergänzen — macht unterschiedliche Intervalle (monatlich/quartalsweise/jährlich) auf
  // einer gemeinsamen Skala vergleichbar (monatlicher Anteil × 12).
  meta.textContent = `${INTERVAL_LABELS[cost.interval]} · ${formatEuro(monthlyAmount(cost) * 12)}/Jahr`;

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteFixedCost(cost.id);
      await reloadFixkostenList();
    });
  });

  li.append(title, amountInput, meta, deleteBtn);
  return li;
}

function wireFixkostenForm() {
  const fixedCostForm = document.getElementById("new-fixed-cost-form");
  const fixedCostSubmitBtn = fixedCostForm.querySelector('button[type="submit"]');
  fixedCostForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-fixed-cost-name");
    const amountInput = document.getElementById("new-fixed-cost-amount");
    const intervalSelect = document.getElementById("new-fixed-cost-interval");
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);
    if (!name || !amount || fixedCostSubmitBtn.disabled) return;
    fixedCostSubmitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createFixedCost({ name, amount, interval: intervalSelect.value });
        showToast(`„${name}" angelegt.`);
        nameInput.value = "";
        amountInput.value = "";
        intervalSelect.value = "monthly";
        await reloadFixkostenList();
      });
    } finally {
      fixedCostSubmitBtn.disabled = false;
    }
  });
}
