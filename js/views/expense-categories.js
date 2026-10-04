// Finanz-Unterseite "Ausgaben-Kategorien" (#/expense-categories).
import {
  listTransactions,
  listExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  clearTransactionCategory,
  slugifyCategoryKey,
  computeCategoryBreakdown,
} from "../finance.js";
import { todayISO } from "../ui/dates.js";
import { buildEmptyState } from "../ui/dom.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";
import { formatEuro, financeState } from "./finance.js";

// ---- Frei editierbare Ausgaben-Kategorien (Verwaltungs-Unterseite) ----
export async function renderExpenseCategoriesView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/expense-categories.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadExpenseCategories();
  wireExpenseCategoryForm();
}

async function reloadExpenseCategories() {
  const monthIso = todayISO().slice(0, 7);
  const [categories, monthTx] = await Promise.all([
    listExpenseCategories(),
    listTransactions({ from: `${monthIso}-01`, to: todayISO() }),
  ]);
  financeState.expenseCategories = categories;
  // Ausgaben je Kategorie-Key im laufenden Monat — Basis für die Budget-Ampel.
  financeState.categorySpendThisMonth = computeCategoryBreakdown(monthTx);
  renderExpenseCategoriesList();
}

function renderExpenseCategoriesList() {
  const list = document.getElementById("expense-categories-list");
  if (!list) return;
  list.innerHTML = "";
  if (financeState.expenseCategories.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Kategorien", "Leg unten die erste Kategorie an."));
    return;
  }
  const sorted = [...financeState.expenseCategories].sort((a, b) => a.sort_order - b.sort_order);
  sorted.forEach((cat) => list.appendChild(buildExpenseCategoryItem(cat)));
}

function buildExpenseCategoryItem(cat) {
  const li = document.createElement("li");
  li.className = "task-item";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "input";
  colorInput.style.maxWidth = "48px";
  colorInput.value = cat.color;
  colorInput.setAttribute("aria-label", "Farbe");
  colorInput.addEventListener("change", async () => {
    if (colorInput.value === cat.color) return;
    await withErrorToast(async () => {
      await updateExpenseCategory(cat.id, { color: colorInput.value });
      await reloadExpenseCategories();
    });
  });

  const name = document.createElement("input");
  name.type = "text";
  name.className = "input area-name-input";
  name.value = cat.name;
  name.setAttribute("aria-label", "Name");
  name.addEventListener("blur", async () => {
    const value = name.value.trim();
    if (!value || value === cat.name) {
      name.value = cat.name;
      return;
    }
    await withErrorToast(async () => {
      await updateExpenseCategory(cat.id, { name: value });
      await reloadExpenseCategories();
    });
  });
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") name.blur();
  });

  // Monatsbudget (€/Monat), inline editierbar. Leeren entfernt das Budget (und damit die Ampel).
  const budgetInput = document.createElement("input");
  budgetInput.type = "number";
  budgetInput.min = "0";
  budgetInput.step = "1";
  budgetInput.className = "input";
  budgetInput.style.maxWidth = "90px";
  budgetInput.placeholder = "€/Mon.";
  budgetInput.value = cat.monthly_budget ?? "";
  budgetInput.setAttribute("aria-label", "Monatsbudget");
  budgetInput.addEventListener("blur", async () => {
    const raw = budgetInput.value.trim();
    const value = raw === "" ? null : Math.max(0, Number(raw));
    if (value === (cat.monthly_budget ?? null)) {
      budgetInput.value = cat.monthly_budget ?? "";
      return;
    }
    await withErrorToast(async () => {
      await updateExpenseCategory(cat.id, { monthly_budget: value });
      await reloadExpenseCategories();
    });
  });
  budgetInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") budgetInput.blur();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      // Transaktionen mit diesem Key werden "Nicht kategorisiert", dann die Kategorie löschen.
      await clearTransactionCategory(cat.key);
      await deleteExpenseCategory(cat.id);
      await reloadExpenseCategories();
    });
    showToast(`„${cat.name}" entfernt.`, false, {
      label: "Rückgängig",
      onClick: () =>
        withErrorToast(async () => {
          await createExpenseCategory({
            key: cat.key,
            name: cat.name,
            color: cat.color,
            sortOrder: cat.sort_order,
            monthlyBudget: cat.monthly_budget,
          });
          await reloadExpenseCategories();
        }),
    });
  });

  li.append(colorInput, name, budgetInput, deleteBtn);

  // Ampel + "X / Y €"-Label (volle Breite unter der Zeile), nur bei gesetztem Budget: grün < 80 %,
  // gelb 80–100 %, rot darüber. Macht Budget-Überschreitungen beim Scrollen sofort sichtbar.
  const budget = Number(cat.monthly_budget);
  if (budget > 0) {
    const spent = Number(financeState.categorySpendThisMonth?.[cat.key] || 0);
    const ratio = spent / budget;
    const state = ratio > 1 ? "over" : ratio >= 0.8 ? "warn" : "ok";
    li.classList.add("category-item");
    const label = document.createElement("span");
    label.className = `category-budget-label category-budget-${state}`;
    label.textContent = `${formatEuro(spent)} / ${formatEuro(budget)} diesen Monat`;
    li.append(label);
  }
  return li;
}

function wireExpenseCategoryForm() {
  const form = document.getElementById("new-expense-category-form");
  const submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-expense-category-name");
    const colorInput = document.getElementById("new-expense-category-color");
    const name = nameInput.value.trim();
    if (!name || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        const existingKeys = financeState.expenseCategories.map((c) => c.key);
        const key = slugifyCategoryKey(name, existingKeys);
        const sortOrder = financeState.expenseCategories.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1;
        await createExpenseCategory({ key, name, color: colorInput.value, sortOrder });
        showToast(`„${name}" angelegt.`);
        nameInput.value = "";
        colorInput.value = "#2a78d6";
        await reloadExpenseCategories();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}
