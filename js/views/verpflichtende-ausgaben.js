// Finanz-Unterseite "Verpflichtende Ausgaben" (#/verpflichtende-ausgaben).
import {
  listCommittedExpenses,
  createCommittedExpense,
  updateCommittedExpense,
  deleteCommittedExpense,
} from "../finance.js";
import { wireDateChipGroup } from "../ui/date-chips.js";
import { formatShortDate } from "../ui/dates.js";
import { buildEmptyState } from "../ui/dom.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";
import { formatEuro } from "./finance.js";

/* ---------- Verpflichtende Ausgaben (eigene Unterseite) ---------- */
// Gleiche Umstellung wie Fixkosten oben — eigener State statt financeState (das bleibt für
// renderBudgetTrend()/renderCommittedPreview() im Finanzen-Tab zuständig).

const committedManageState = { expenses: [] };

export async function renderVerpflichtendeAusgabenView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/verpflichtende-ausgaben.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadCommittedManageList();
  wireCommittedManageForm();
}

async function reloadCommittedManageList() {
  committedManageState.expenses = await listCommittedExpenses({ statusNot: "settled" });
  renderCommittedManageList();
}

function renderCommittedManageList() {
  const list = document.getElementById("committed-manage-list");
  list.innerHTML = "";
  if (committedManageState.expenses.length === 0) {
    list.appendChild(buildEmptyState("Noch keine verpflichtenden Ausgaben", "Leg unten die erste an."));
    return;
  }
  committedManageState.expenses.forEach((exp) => list.appendChild(buildCommittedItem(exp)));
}

function buildCommittedItem(exp) {
  const li = document.createElement("li");
  li.className = "task-item";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = exp.name;

  const meta = document.createElement("span");
  meta.className = "count";
  meta.textContent = `${formatEuro(exp.amount)} · fällig ${formatShortDate(exp.due_date)}.`;

  const settleBtn = document.createElement("button");
  settleBtn.type = "button";
  settleBtn.className = "icon-btn";
  settleBtn.textContent = "✓";
  settleBtn.setAttribute("aria-label", "Als beglichen markieren");
  settleBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await updateCommittedExpense(exp.id, { status: "settled" });
      await reloadCommittedManageList();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteCommittedExpense(exp.id);
      await reloadCommittedManageList();
    });
  });

  li.append(title, meta, settleBtn, deleteBtn);
  return li;
}

function wireCommittedManageForm() {
  const dateChips = wireDateChipGroup(document.getElementById("new-committed-date-chips"));
  const committedForm = document.getElementById("new-committed-form");
  const committedSubmitBtn = committedForm.querySelector('button[type="submit"]');
  committedForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-committed-name");
    const amountInput = document.getElementById("new-committed-amount");
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);
    const dueDate = dateChips.getPlannedDate();
    if (committedSubmitBtn.disabled) return;
    if (!name || !amount || !dueDate) {
      // due_date ist NOT NULL in der DB — ohne diesen Hinweis würde "Anlegen" bei "Kein Datum"
      // (dem Chip-Default) einfach stumm gar nichts tun.
      showToast(!dueDate ? "Bitte ein Fälligkeitsdatum wählen." : "Bitte Name und Betrag ausfüllen.", true);
      return;
    }
    committedSubmitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createCommittedExpense({ name, amount, dueDate });
        showToast(`„${name}" angelegt.`);
        nameInput.value = "";
        amountInput.value = "";
        dateChips.reset();
        await reloadCommittedManageList();
      });
    } finally {
      committedSubmitBtn.disabled = false;
    }
  });
}
