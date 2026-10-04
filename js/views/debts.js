// Finanz-Unterseite "Schulden" (#/debts).
import { listDebts, createDebt, updateDebt, deleteDebt } from "../finance.js";
import { buildEmptyState } from "../ui/dom.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";
import { formatEuro } from "./finance.js";

/* ---------- Schulden (eigene Unterseite) ---------- */
// Gleiches Muster wie Fixkosten oben — eigener State, inline editierbare Restschuld. Die
// Vorrang-Logik (Tilgung vor Wachstums-/Freiheit-Zuteilung) läuft im Weekly Review, nicht hier.

const debtsState = { debts: [] };

export async function renderDebtsView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/debts.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadDebtsList();
  wireDebtsForm();
}

async function reloadDebtsList() {
  debtsState.debts = await listDebts();
  renderDebtsList();
}

function renderDebtsList() {
  const list = document.getElementById("debts-list");
  list.innerHTML = "";
  if (debtsState.debts.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Schulden erfasst", "Leg unten die erste Restschuld an."));
    return;
  }
  debtsState.debts.forEach((debt) => list.appendChild(buildDebtItem(debt)));
}

function buildDebtItem(debt) {
  const li = document.createElement("li");
  li.className = "task-item";

  // Name und Restschuld sind direkt editierbar (Blur committet) — die Restschuld sinkt über die
  // Zeit durch Tilgung, dafür braucht es keinen eigenen Bearbeiten-Dialog (analog Fixkosten).
  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = debt.name;
  title.setAttribute("aria-label", "Name");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === debt.name) {
      title.value = debt.name;
      return;
    }
    await withErrorToast(async () => {
      await updateDebt(debt.id, { name: value });
      await reloadDebtsList();
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
  amountInput.value = debt.remaining_amount;
  amountInput.setAttribute("aria-label", "Restschuld");
  amountInput.addEventListener("blur", async () => {
    const value = Number(amountInput.value);
    if (Number.isNaN(value) || value === Number(debt.remaining_amount)) {
      amountInput.value = debt.remaining_amount;
      return;
    }
    await withErrorToast(async () => {
      await updateDebt(debt.id, { remaining_amount: value });
      await reloadDebtsList();
    });
  });

  // Meta zeigt nur, was gesetzt ist: Zins und/oder Mindestrate, sonst der ursprüngliche Betrag.
  const metaParts = [];
  if (debt.interest_rate != null) metaParts.push(`${debt.interest_rate}% p.a.`);
  if (debt.min_payment != null) metaParts.push(`min. ${formatEuro(debt.min_payment)}/Mon.`);
  if (metaParts.length === 0 && debt.initial_amount != null) {
    metaParts.push(`ursprünglich ${formatEuro(debt.initial_amount)}`);
  }
  const meta = document.createElement("span");
  meta.className = "count";
  meta.textContent = metaParts.join(" · ");

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteDebt(debt.id);
      await reloadDebtsList();
    });
  });

  li.append(title, amountInput, meta, deleteBtn);

  // Tilgungs-Fortschritt (volle Breite unter der Zeile) — nur wenn ein Ursprungsbetrag bekannt ist,
  // sonst gibt es keinen Bezugspunkt für "wie viel schon getilgt". Style wie die Wunschlisten-Leiste.
  const initial = Number(debt.initial_amount);
  const remaining = Number(debt.remaining_amount) || 0;
  if (initial > 0) {
    const paidPct = Math.min(100, Math.max(0, Math.round(((initial - remaining) / initial) * 100)));
    li.classList.add("debt-item");
    const bar = document.createElement("div");
    bar.className = "wish-fund-bar debt-progress-bar";
    const fill = document.createElement("div");
    fill.className = "wish-fund-fill";
    fill.style.width = `${paidPct}%`;
    bar.appendChild(fill);
    const label = document.createElement("span");
    label.className = "wish-fund-label debt-progress-label";
    label.textContent = `${paidPct}% getilgt`;
    li.append(bar, label);
  }
  return li;
}

function wireDebtsForm() {
  const debtForm = document.getElementById("new-debt-form");
  const debtSubmitBtn = debtForm.querySelector('button[type="submit"]');
  debtForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-debt-name");
    const remainingInput = document.getElementById("new-debt-remaining");
    const initialInput = document.getElementById("new-debt-initial");
    const interestInput = document.getElementById("new-debt-interest");
    const minPaymentInput = document.getElementById("new-debt-min-payment");
    const name = nameInput.value.trim();
    const remainingAmount = Number(remainingInput.value);
    if (!name || !remainingInput.value || Number.isNaN(remainingAmount) || debtSubmitBtn.disabled) return;
    // Ursprungsbetrag optional — ohne Angabe die Restschuld übernehmen (frisch aufgenommen).
    const initialAmount = initialInput.value ? Number(initialInput.value) : remainingAmount;
    const interestRate = interestInput.value ? Number(interestInput.value) : null;
    const minPayment = minPaymentInput.value ? Number(minPaymentInput.value) : null;
    debtSubmitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createDebt({ name, initialAmount, remainingAmount, interestRate, minPayment });
        showToast(`„${name}" angelegt.`);
        nameInput.value = "";
        remainingInput.value = "";
        initialInput.value = "";
        interestInput.value = "";
        minPaymentInput.value = "";
        await reloadDebtsList();
      });
    } finally {
      debtSubmitBtn.disabled = false;
    }
  });
}
