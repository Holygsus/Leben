// Ansicht "Finanzen" (#/finance) inkl. Wunschliste; teilt Konstanten/Helfer mit den Finanz-Unterseiten.
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  listFixedCosts,
  listCommittedExpenses,
  listDebts,
  updateDebt,
  listExpenseCategories,
  createExpenseCategory,
  getFinanceModuleSettings,
  updateFinanceModuleSettings,
  computeCategoryBreakdown,
  computeBudgetTrend,
  computeSalaryWaterfall,
} from "../finance.js";
import {
  listWishlistItems,
  createWishlistItem,
  updateWishlistItem,
  deleteWishlistItem,
  getSavingsPotBalance,
  filterBuyReady,
} from "../wishlist.js";
import { todayISO, formatShortDate } from "../ui/dates.js";
import { buildEmptyState } from "../ui/dom.js";
import { showToast, showLoading, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";

/* ---------- Finanzen ---------- */

const POT_LABELS = { fixkosten: "Fixkosten", sicherheit: "Sicherheit", wachstum: "Wachstum", freiheit: "Freiheit" };
const POT_COLOR_VAR = {
  fixkosten: "var(--color-text-subtle)",
  sicherheit: "var(--color-accent)",
  wachstum: "var(--color-success)",
  freiheit: "var(--color-accent-warm)",
};
export const INTERVAL_LABELS = { monthly: "monatlich", quarterly: "quartalsweise", yearly: "jährlich" };

// Ausgaben-Kategorien sind seit 2026-07-25 (War Room, finanzplan-erweiterungen-v2.md Punkt 9) frei
// editierbar und liegen in expense_categories (financeState.expenseCategories). Der 9er-Default-Satz
// wird beim ersten Laden lazy geseedet (seedExpenseCategoriesIfEmpty). Die bestehenden Slugs bleiben
// als stabile Keys erhalten → keine Datenmigration. Farben sind CVD-sicher aus dem dataviz-Skill.
const DEFAULT_EXPENSE_CATEGORIES = [
  { key: "essen", name: "Essen", color: "#2a78d6" },
  { key: "wohnen", name: "Wohnen/Fixkosten", color: "#1baf7a" },
  { key: "transport", name: "Transport", color: "#eda100" },
  { key: "gesundheit", name: "Gesundheit", color: "#4a3aa7" },
  { key: "sonstiges", name: "Sonstiges", color: "#e34948" },
  { key: "freizeit", name: "Hobbys & Freizeit", color: "#008300" },
  { key: "ausgehen", name: "Essen gehen / Ausgehen", color: "#00a3a3" },
  { key: "abos", name: "Abos & Streaming", color: "#b5179e" },
  { key: "anschaffungen", name: "Anschaffungen & Geschenke", color: "#7d5a2a" },
];

// Lookup-Helfer über den aktuellen expense_categories-Stand. "uncategorized" ist ein Sonderfall
// (kein echter DB-Eintrag), der im Donut/Dropdown als "Nicht kategorisiert" auftaucht.
function categoryLabel(key) {
  if (key === "uncategorized" || !key) return "Nicht kategorisiert";
  const cat = financeState.expenseCategories.find((c) => c.key === key);
  return cat ? cat.name : key;
}
function categoryColor(key) {
  if (key === "uncategorized" || !key) return "var(--color-border)";
  const cat = financeState.expenseCategories.find((c) => c.key === key);
  return cat ? cat.color : "var(--color-border)";
}
const WISHLIST_STATUS_LABELS = { inactive: "Inaktiv", active: "Aktiv", ready: "Kaufbereit", bought: "Gekauft" };
const WISHLIST_STATUS_CYCLE = ["inactive", "active", "ready", "bought"];
const WISHLIST_CATEGORY_LABELS = { need: "Need", invest: "Invest", enjoy: "Enjoy" };

export function formatEuro(value) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value || 0);
}

export function monthlyAmount(cost) {
  if (cost.interval === "quarterly") return cost.amount / 3;
  if (cost.interval === "yearly") return cost.amount / 12;
  return cost.amount;
}

function monthsUntil(dueDate) {
  const days = (new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.round(days / 30));
}

function weeksSinceFirstTransaction(transactions) {
  if (transactions.length === 0) return 0;
  const earliest = transactions.reduce((min, t) => (t.occurred_at < min ? t.occurred_at : min), transactions[0].occurred_at);
  const days = (Date.now() - new Date(earliest).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.floor(days / 7));
}

// Kaufbereit-Widget — identisch in Heute und Finanzen genutzt (gleiche Element-IDs in beiden
// Views, immer nur eine davon gleichzeitig im DOM). Zeigt bis zu 2 Einträge direkt, "+N weitere"
// bei mehr — gleiches Muster wie renderUpcomingEvents().
export function renderBuyReadyAlert(wishlistItems, potBalance) {
  const card = document.getElementById("buyready-card");
  if (!card) return;
  const list = document.getElementById("buyready-list");
  const moreBtn = document.getElementById("buyready-more");
  const ready = filterBuyReady(wishlistItems, potBalance);

  if (ready.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const renderItems = (items) => {
    list.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = `${item.title} — ${formatEuro(item.current_price)}`;
      list.appendChild(li);
    }
  };
  renderItems(ready.slice(0, 2));
  if (ready.length > 2) {
    moreBtn.hidden = false;
    moreBtn.textContent = `+${ready.length - 2} weitere`;
    moreBtn.onclick = () => {
      renderItems(ready);
      moreBtn.hidden = true;
    };
  } else {
    moreBtn.hidden = true;
  }
}

export const financeState = {
  settings: null,
  transactions: [],
  fixedCosts: [],
  committedExpenses: [],
  wishlistItems: [],
  expenseCategories: [],
  potBalance: 0,
  txFilterPot: "",
};

export async function renderFinanceView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/finance.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  showLoading("pot-grid");

  await loadFinanceData();
  renderPotGrid();
  renderBudgetTrend();
  renderCategoryDonut();
  renderBuyReadyAlert(financeState.wishlistItems, financeState.potBalance);
  renderCommittedPreview();
  renderFinanceManageSummary();
  renderTransactionList();
  renderWishlistCards();
  wireFinanceFilters();
  wireWishlistForm();
  wireTransactionQuickCapture();
  document.getElementById("salary-distribute-open").addEventListener("click", openSalaryDistributionModal);
}

// Geführter Gehalts-Einspiel-Workflow (wissensdatenbank/features/gehalt-einspielen.md): eine Eingabe
// (Netto) → live berechnete Wasserfall-Vorschau (Beträge überschreibbar) → Bestätigen aktiviert
// Phase 2, setzt die Töpfe-Settings und bucht Sicherheit/Schulden. Fixkosten laufen unabhängig über
// fixed_costs, Freiheit ist reines Monatsbudget (settings.pots.freiheit) — beide ohne eigene
// Transaktion. Modal-Muster wie openSettingsPanel().
function openSalaryDistributionModal() {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

  const fixSum = financeState.fixedCosts.reduce((sum, c) => sum + monthlyAmount(c), 0);
  const openDebts = (financeState.debts || []).filter((d) => Number(d.remaining_amount || 0) > 0);
  const debtTotal = openDebts.reduce((sum, d) => sum + Number(d.remaining_amount || 0), 0);
  const hasDebts = openDebts.length > 0;

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
    <div class="modal-backdrop" id="salary-backdrop">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Gehalt einspielen">
        <h2>Gehalt einspielen</h2>
        <label class="modal-label">
          Netto-Gehalt (€)
          <input class="input" type="number" id="salary-netto" step="0.01" min="0" inputmode="decimal" placeholder="z. B. 2400" />
        </label>
        <div class="salary-waterfall">
          <div class="salary-row">
            <span class="salary-row-label"><span class="task-area-dot" style="background: var(--color-text-subtle)"></span>Fixkosten</span>
            <output class="salary-row-amount" id="salary-out-fix">${formatEuro(fixSum)}</output>
          </div>
          <label class="salary-row">
            <span class="salary-row-label"><span class="task-area-dot" style="background: var(--color-accent)"></span>Sicherheit</span>
            <input class="input salary-row-input" type="number" id="salary-in-sicherheit" step="1" min="0" inputmode="decimal" value="50" />
          </label>
          ${
            hasDebts
              ? `<label class="salary-row">
            <span class="salary-row-label"><span class="task-area-dot" style="background: var(--color-danger)"></span>Schulden tilgen</span>
            <input class="input salary-row-input" type="number" id="salary-in-schulden" step="1" min="0" max="${debtTotal}" inputmode="decimal" value="0" />
          </label>`
              : ""
          }
          <div class="salary-row salary-row-freiheit">
            <span class="salary-row-label"><span class="task-area-dot" style="background: var(--color-accent-warm)"></span>Freiheit (Rest)</span>
            <output class="salary-row-amount" id="salary-out-freiheit">${formatEuro(0)}</output>
          </div>
        </div>
        <div class="salary-preview-bar" id="salary-preview-bar" hidden aria-hidden="true"></div>
        <p class="salary-warning" id="salary-warning" hidden>Die Verteilung übersteigt das Gehalt.</p>
        <p class="salary-hint">Bestätigen aktiviert Phase 2 und setzt die Topf-Ziele. Fixkosten laufen über deine erfassten Fixkosten, Freiheit ist dein Monatsbudget.</p>
        <div class="modal-actions">
          <button class="btn" type="button" id="salary-confirm" disabled>Bestätigen</button>
          <button class="btn btn-secondary" type="button" id="salary-close">Abbrechen</button>
        </div>
      </div>
    </div>`;

  const nettoInput = document.getElementById("salary-netto");
  const sicherheitInput = document.getElementById("salary-in-sicherheit");
  const schuldenInput = document.getElementById("salary-in-schulden");
  const freiheitOut = document.getElementById("salary-out-freiheit");
  const warning = document.getElementById("salary-warning");
  const confirmBtn = document.getElementById("salary-confirm");

  const previewBar = document.getElementById("salary-preview-bar");
  const recompute = () => {
    const netto = Number(nettoInput.value) || 0;
    const sicherheitRate = Number(sicherheitInput.value) || 0;
    const debtPayment = schuldenInput ? Number(schuldenInput.value) || 0 : 0;
    const { sicherheit, schulden, freiheit } = computeSalaryWaterfall({ netto, fixSum, sicherheitRate, debtPayment });
    freiheitOut.textContent = formatEuro(freiheit);
    const invalid = netto <= 0 || freiheit < 0;
    warning.hidden = !(netto > 0 && freiheit < 0);
    confirmBtn.disabled = invalid;

    // Visuelle Vorschau: gestapelter Balken zeigt live, wie sich das Netto auf die Töpfe aufteilt —
    // greifbarer als vier Einzelzahlen. Nur bei gültigem, aufgehendem Gehalt sichtbar.
    if (netto > 0 && freiheit >= 0) {
      const segments = [
        { label: "Fixkosten", value: fixSum, color: "var(--color-text-subtle)" },
        { label: "Sicherheit", value: sicherheit, color: "var(--color-accent)" },
        { label: "Schulden", value: schulden, color: "var(--color-danger)" },
        { label: "Freiheit", value: freiheit, color: "var(--color-accent-warm)" },
      ].filter((s) => s.value > 0);
      previewBar.innerHTML = segments
        .map((s) => {
          const pct = Math.round((s.value / netto) * 100);
          return `<span class="salary-preview-seg" style="flex-grow:${s.value};background:${s.color}" title="${s.label}: ${formatEuro(s.value)} (${pct}%)">${pct >= 8 ? `${pct}%` : ""}</span>`;
        })
        .join("");
      previewBar.hidden = false;
    } else {
      previewBar.hidden = true;
    }
  };

  nettoInput.addEventListener("input", recompute);
  sicherheitInput.addEventListener("input", recompute);
  if (schuldenInput) schuldenInput.addEventListener("input", recompute);
  recompute();

  document.getElementById("salary-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "salary-backdrop") close();
  });
  document.getElementById("salary-close").addEventListener("click", close);

  confirmBtn.addEventListener("click", async () => {
    const netto = Number(nettoInput.value) || 0;
    const sicherheitRate = Number(sicherheitInput.value) || 0;
    const debtPayment = schuldenInput ? Number(schuldenInput.value) || 0 : 0;
    const { sicherheit, schulden, freiheit } = computeSalaryWaterfall({ netto, fixSum, sicherheitRate, debtPayment });
    if (netto <= 0 || freiheit < 0) return;
    confirmBtn.disabled = true;
    await withErrorToast(async () => {
      // 1. Phase 2 aktivieren + Töpfe/Notgroschen-Ziel setzen (Wachstum erst Phase 3).
      await updateFinanceModuleSettings({
        phase: 2,
        pots: { fixkosten: fixSum, sicherheit, wachstum: null, freiheit },
        notgroschen_target: 4 * fixSum,
        notgroschen_basis: fixSum,
      });
      // 2. Sicherheits-Rate als Einzahlung buchen (Pot-Grid liest Notgroschen aus expense pot=sicherheit).
      if (sicherheit > 0) {
        await createTransaction({
          direction: "expense",
          pot: "sicherheit",
          amount: sicherheit,
          note: "Gehalts-Einspiel — Sicherheit",
          occurredAt: todayISO(),
        });
      }
      // 3. Schuldentilgung: älteste offene Schuld(en) der Reihe nach auffüllen.
      let remainingPayment = schulden;
      for (const debt of openDebts) {
        if (remainingPayment <= 0) break;
        const rest = Number(debt.remaining_amount || 0);
        const pay = Math.min(rest, remainingPayment);
        if (pay <= 0) continue;
        await updateDebt(debt.id, { remaining_amount: Math.max(0, rest - pay) });
        await createTransaction({
          direction: "expense",
          pot: null,
          amount: pay,
          note: `Gehalts-Einspiel — Schuldentilgung ${debt.name}`,
          occurredAt: todayISO(),
        });
        remainingPayment -= pay;
      }
      // 4. Gehalt als Einnahme fürs Kassenbuch.
      await createTransaction({ direction: "income", pot: null, amount: netto, note: "Gehalt", occurredAt: todayISO() });
      close();
      await reloadFinance();
      showToast("Gehalt eingespielt — Phase 2 aktiv.");
    });
    confirmBtn.disabled = false;
  });
}

async function loadFinanceData() {
  const [settings, transactions, fixedCosts, committedExpenses, debts, wishlistItems, potBalance, expenseCategories] =
    await Promise.all([
      getFinanceModuleSettings(),
      listTransactions(),
      listFixedCosts(),
      listCommittedExpenses({ statusNot: "settled" }),
      listDebts(),
      listWishlistItems(),
      getSavingsPotBalance(),
      listExpenseCategories(),
    ]);
  financeState.settings = settings;
  financeState.transactions = transactions;
  financeState.fixedCosts = fixedCosts;
  financeState.committedExpenses = committedExpenses;
  financeState.debts = debts;
  financeState.wishlistItems = wishlistItems;
  financeState.potBalance = potBalance;
  financeState.expenseCategories = await seedExpenseCategoriesIfEmpty(expenseCategories);
}

// Lazy-Seed des 9er-Default-Satzes beim ersten Laden (per-User-Seed lässt sich nicht sauber in einer
// statischen Migration abbilden). Deckt Fresh-Install UND Bestand ab — bei Bestand tragen die alten
// Transaktionen bereits die Stock-Keys (essen/wohnen/…), die hier identisch angelegt werden.
async function seedExpenseCategoriesIfEmpty(existing) {
  if (existing.length > 0) return existing;
  const created = [];
  for (let i = 0; i < DEFAULT_EXPENSE_CATEGORIES.length; i++) {
    const def = DEFAULT_EXPENSE_CATEGORIES[i];
    created.push(await createExpenseCategory({ key: def.key, name: def.name, color: def.color, sortOrder: i }));
  }
  return created;
}

async function reloadFinance() {
  await loadFinanceData();
  renderCategoryQuickOptions();
  renderMonthSaldo();
  renderPotGrid();
  renderBudgetTrend();
  renderCategoryDonut();
  renderBuyReadyAlert(financeState.wishlistItems, financeState.potBalance);
  renderCommittedPreview();
  renderFinanceManageSummary();
  renderTransactionList();
  renderWishlistCards();
}

// Ersetzt die früheren drei fast leeren Fixkosten/Verpflichtende/Schulden-Panels durch kompakte
// Verwalten-Zeilen mit Monats-/Gesamtsumme rechts. "—" wenn nichts erfasst ist.
function renderFinanceManageSummary() {
  const fixEl = document.getElementById("fm-fixkosten");
  if (!fixEl) return;
  const fixSum = financeState.fixedCosts.reduce((sum, c) => sum + monthlyAmount(c), 0);
  fixEl.textContent = fixSum > 0 ? `${formatEuro(fixSum)}/Mon.` : "—";

  const committedSum = (financeState.committedExpenses || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  document.getElementById("fm-committed").textContent = committedSum > 0 ? formatEuro(committedSum) : "—";

  const debtSum = (financeState.debts || []).reduce((sum, d) => sum + Number(d.remaining_amount || 0), 0);
  const debtEl = document.getElementById("fm-debts");
  debtEl.textContent = debtSum > 0 ? formatEuro(debtSum) : "—";
  debtEl.classList.toggle("is-danger", debtSum > 0);
}

// Monats-Saldo-Kopf: Einnahmen/Ausgaben/Saldo des laufenden Kalendermonats plus ein Zwei-Ton-Balken
// (Anteil Einnahmen vs. Ausgaben). Gibt dem Screen einen Anker "wie lief der Monat", ergänzend zu den
// stichtagsbezogenen Topf-Ständen. Ohne Bewegung im Monat ausgeblendet.
function renderMonthSaldo() {
  const el = document.getElementById("month-saldo");
  if (!el) return;
  const monthIso = todayISO().slice(0, 7);
  let income = 0;
  let expense = 0;
  for (const t of financeState.transactions) {
    if (typeof t.occurred_at !== "string" || t.occurred_at.slice(0, 7) !== monthIso) continue;
    if (t.direction === "income") income += Number(t.amount) || 0;
    else if (t.direction === "expense") expense += Number(t.amount) || 0;
  }
  if (income === 0 && expense === 0) {
    el.hidden = true;
    return;
  }
  const saldo = income - expense;
  const total = income + expense;
  const incPct = total ? Math.round((income / total) * 100) : 0;
  el.hidden = false;
  el.innerHTML = `
    <div class="month-saldo-head">
      <h2>Dieser Monat</h2>
      <span class="month-saldo-total ${saldo >= 0 ? "is-income" : "is-expense"}">${saldo >= 0 ? "+" : ""}${formatEuro(saldo)}</span>
    </div>
    <div class="month-saldo-stats">
      <div><b class="is-income">${formatEuro(income)}</b><small>Einnahmen</small></div>
      <div><b class="is-expense">${formatEuro(expense)}</b><small>Ausgaben</small></div>
    </div>
    <div class="month-saldo-bar"><i class="is-income" style="width:${incPct}%"></i><i class="is-expense" style="width:${100 - incPct}%"></i></div>`;
}

function buildPotCard(label, color, amountText, pct, celebrateAtFull = false) {
  const card = document.createElement("div");
  card.className = "pot-card";

  const ring = document.createElement("div");
  ring.className = "pot-ring";
  ring.classList.toggle("is-full", celebrateAtFull && pct >= 100);
  ring.style.setProperty("--pct", Math.max(0, Math.min(100, pct)));
  ring.style.setProperty("--ring-color", color);

  const info = document.createElement("div");
  const labelEl = document.createElement("div");
  labelEl.className = "p-label";
  labelEl.textContent = label;
  const amountEl = document.createElement("div");
  amountEl.className = "p-amount";
  amountEl.textContent = amountText;
  info.append(labelEl, amountEl);

  card.append(ring, info);
  return card;
}

// SVG-Mehrsegment-Ring statt CSS-conic-gradient (wie .pot-ring), weil die Segmentzahl hier variabel
// ist (0–7 je nach genutzten Kategorien) — stroke-dasharray/-dashoffset pro <circle>, kleine feste
// Lücke zwischen Segmenten. Legende darunter ist zugleich die Tabellen-Ansicht (dataviz-Skill:
// Pflicht ab ≥2 Segmenten) und die Textlabel-Absicherung für Farben mit Kontrast-Caveat.
function buildCategoryDonut(breakdown) {
  const panel = document.getElementById("category-donut-panel");
  const wrap = document.getElementById("category-donut-row");
  if (!panel || !wrap) return;

  const orderedKeys = [...financeState.expenseCategories].sort((a, b) => a.sort_order - b.sort_order).map((c) => c.key);
  const keys = [...orderedKeys, "uncategorized"].filter((k) => (breakdown[k] || 0) > 0);
  const total = keys.reduce((sum, k) => sum + breakdown[k], 0);
  wrap.innerHTML = "";
  if (total <= 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const size = 120;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = 3;
  const svgNS = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.classList.add("category-donut-svg");

  const legend = document.createElement("ul");
  legend.className = "category-donut-legend";

  let offset = 0;
  for (const key of keys) {
    const value = breakdown[key];
    const fraction = value / total;
    const pct = Math.round(fraction * 100);
    const segmentLength = Math.max(0, fraction * circumference - gap);

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", String(size / 2));
    circle.setAttribute("cy", String(size / 2));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke-width", String(strokeWidth));
    circle.setAttribute("stroke-linecap", "butt");
    circle.setAttribute("stroke-dasharray", `${segmentLength} ${circumference - segmentLength}`);
    circle.setAttribute("stroke-dashoffset", String(-offset));
    circle.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
    circle.style.stroke = categoryColor(key);

    const title = document.createElementNS(svgNS, "title");
    title.textContent = `${categoryLabel(key)}: ${formatEuro(value)} (${pct}%)`;
    circle.appendChild(title);
    svg.appendChild(circle);
    offset += fraction * circumference;

    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "category-donut-dot";
    dot.style.background = categoryColor(key);
    li.append(dot, document.createTextNode(`${categoryLabel(key)} — ${formatEuro(value)} (${pct}%)`));
    legend.appendChild(li);
  }

  const chart = document.createElement("div");
  chart.className = "category-donut-chart";
  const center = document.createElement("div");
  center.className = "category-donut-center";
  center.textContent = formatEuro(total);
  chart.append(svg, center);

  wrap.append(chart, legend);
}

// Befüllt das Quick-Add-Kategorie-Dropdown dynamisch aus den frei editierbaren Kategorien; die
// leere Platzhalter-Option ("Kategorie (optional)") bleibt als Abwähl-Wert erhalten. Der aktuell
// gewählte Wert bleibt nach Möglichkeit erhalten.
function renderCategoryQuickOptions() {
  const select = document.getElementById("tx-quick-category");
  if (!select) return;
  const prev = select.value;
  select.innerHTML =
    `<option value="">Kategorie (optional)</option>` +
    financeState.expenseCategories.map((c) => `<option value="${c.key}">${c.name}</option>`).join("");
  if (prev && financeState.expenseCategories.some((c) => c.key === prev)) select.value = prev;
}

// Aktueller Kalendermonat, konsistent mit dem bestehenden spentThisMonth-Fenster weiter unten in
// renderPotGrid() — nur Ausgaben zählen (computeCategoryBreakdown filtert direction bereits).
function renderCategoryDonut() {
  const monthStart = todayISO().slice(0, 7) + "-01";
  const monthTransactions = financeState.transactions.filter((t) => t.occurred_at >= monthStart);
  buildCategoryDonut(computeCategoryBreakdown(monthTransactions));
}

// Fixkosten zeigt immer die echte Summe — läuft unabhängig von der Finanzplan-Phase. Sicherheit/
// Wachstum/Freiheit zeigen in Phase 1 einen Sammel-Platzhalter statt eines geratenen Betrags (siehe
// wissensdatenbank/finanzplan-ui-plan.md).
function renderPotGrid() {
  const grid = document.getElementById("pot-grid");
  const settings = financeState.settings.settings || {};
  const phase = settings.phase || 1;

  const fixkostenSum = financeState.fixedCosts.reduce((sum, c) => sum + monthlyAmount(c), 0);
  const cards = [buildPotCard(POT_LABELS.fixkosten, POT_COLOR_VAR.fixkosten, formatEuro(fixkostenSum), 100)];

  if (phase < 2) {
    const weeks = weeksSinceFirstTransaction(financeState.transactions);
    const placeholder = `Sammle Daten — Woche ${Math.min(weeks, 4)} von 4`;
    cards.push(buildPotCard(POT_LABELS.sicherheit, POT_COLOR_VAR.sicherheit, placeholder, 0));
    cards.push(buildPotCard(POT_LABELS.wachstum, POT_COLOR_VAR.wachstum, placeholder, 0));
    cards.push(buildPotCard(POT_LABELS.freiheit, POT_COLOR_VAR.freiheit, placeholder, 0));
  } else {
    const notgroschenProgress = financeState.transactions
      .filter((t) => t.pot === "sicherheit")
      .reduce((sum, t) => sum + (t.direction === "expense" ? Number(t.amount) : -Number(t.amount)), 0);
    const notgroschenTarget = settings.notgroschen_target || 0;
    const notgroschenPct = notgroschenTarget ? Math.round((notgroschenProgress / notgroschenTarget) * 100) : 0;
    cards.push(
      buildPotCard(
        POT_LABELS.sicherheit,
        POT_COLOR_VAR.sicherheit,
        `${formatEuro(notgroschenProgress)} / ${formatEuro(notgroschenTarget)}`,
        notgroschenPct,
        true
      )
    );

    const wachstumBetrag = settings.wachstum_monatsbetrag;
    cards.push(
      buildPotCard(
        POT_LABELS.wachstum,
        POT_COLOR_VAR.wachstum,
        wachstumBetrag ? `${formatEuro(wachstumBetrag)}/Monat` : "Noch nicht festgelegt",
        wachstumBetrag ? 100 : 0
      )
    );

    const freiheitBudget = settings.pots?.freiheit || 0;
    const monthStart = todayISO().slice(0, 7) + "-01";
    // Freiheit bleibt konzeptionell ein Monatsbudget (kein Kontostand), aber Ausgaben UND Einnahmen
    // dieses Monats wirken symmetrisch auf den Rest: eine als pot='freiheit' erfasste Einnahme ist
    // eine Budget-Aufstockung und erhöht "übrig" (spiegelt die Sicherheit-Netto-Logik oben). Vorher
    // wurden Einnahmen ignoriert (nur direction==='expense' gezählt) — Rest bewegte sich nicht.
    const netSpentThisMonth = financeState.transactions
      .filter((t) => t.pot === "freiheit" && t.occurred_at >= monthStart)
      .reduce((sum, t) => sum + (t.direction === "expense" ? Number(t.amount) : -Number(t.amount)), 0);
    const remaining = freiheitBudget - netSpentThisMonth;
    const freiheitPct = freiheitBudget ? Math.round((remaining / freiheitBudget) * 100) : 0;
    cards.push(
      buildPotCard(
        POT_LABELS.freiheit,
        POT_COLOR_VAR.freiheit,
        freiheitBudget ? `${formatEuro(remaining)} übrig` : "Noch nicht festgelegt",
        freiheitPct
      )
    );
  }

  grid.innerHTML = "";
  cards.forEach((c) => grid.appendChild(c));
}

// Ruhige Trend-Anzeige für den Freiheit-Topf (wissensdatenbank/finanzen-erweiterungen/
// finanzplan-erweiterungen-v2.md, Punkt 3) — bewusst kein Ampel-/Rot-Grün-Ton, nur Text + Pfeil.
// Gleiches Phase-1-Gate wie renderPotGrid(): ohne pots.freiheit gibt es keinen sinnvollen
// Tagesrichtwert, statt eines leeren Widgets erscheint derselbe "Sammle Daten"-Platzhaltertext.
function renderBudgetTrend() {
  const textEl = document.getElementById("budget-trend-text");
  if (!textEl) return;
  const settings = financeState.settings.settings || {};
  const phase = settings.phase || 1;
  const freiheitBudget = settings.pots?.freiheit;

  if (phase < 2 || !freiheitBudget) {
    const weeks = weeksSinceFirstTransaction(financeState.transactions);
    textEl.textContent = `Sammle Daten — Woche ${Math.min(weeks, 4)} von 4`;
    return;
  }

  const openReservationsMonthly = financeState.committedExpenses.reduce(
    (sum, exp) => sum + exp.amount / monthsUntil(exp.due_date),
    0
  );

  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysRemainingInMonth = daysInMonth - today.getDate() + 1;

  // windowDays orientiert sich an der Historie der freiheit-Ausgaben selbst (nicht an allen
  // Transaktionen) — "avg() über weniger Tage" statt eines Sonderfalls, siehe Vault-Notiz.
  const freiheitExpenses = financeState.transactions.filter((t) => t.pot === "freiheit" && t.direction === "expense");
  const earliestFreiheitIso = freiheitExpenses.reduce((min, t) => (t.occurred_at < min ? t.occurred_at : min), todayISO());
  const daysSinceEarliest = Math.floor((new Date(todayISO()) - new Date(earliestFreiheitIso)) / 86400000) + 1;
  const windowDays = Math.min(7, Math.max(1, daysSinceEarliest));

  const windowStart = new Date(today);
  windowStart.setDate(today.getDate() - (windowDays - 1));
  const windowStartOffset = windowStart.getTimezoneOffset();
  const windowStartIso = new Date(windowStart.getTime() - windowStartOffset * 60000).toISOString().slice(0, 10);

  const recentSpend = freiheitExpenses
    .filter((t) => t.occurred_at >= windowStartIso)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const { dailyBudget, avgRecent } = computeBudgetTrend({
    freiheitBudget,
    openReservationsMonthly,
    daysRemainingInMonth,
    recentSpend,
    windowDays,
  });

  const arrow = avgRecent <= dailyBudget ? "↓" : "↑";
  textEl.textContent = `Tagesbudget: ${formatEuro(dailyBudget)} · Schnitt letzte 7 Tage: ${formatEuro(avgRecent)} ${arrow}`;
}

// Kurze Vorschau der nächsten fälligen verpflichtenden Ausgaben, direkt unter dem Kaufbereit-Widget
// — die volle Verwaltung (anlegen/beglichen/löschen) sitzt weiter unten im eigenen Panel.
function renderCommittedPreview() {
  const list = document.getElementById("committed-preview-list");
  const upcoming = [...financeState.committedExpenses].sort((a, b) => (a.due_date < b.due_date ? -1 : 1)).slice(0, 3);
  list.innerHTML = "";
  for (const exp of upcoming) {
    const li = document.createElement("li");
    li.className = "task-item";

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = exp.name;

    const badge = document.createElement("span");
    badge.className = "badge badge-reserve";
    badge.textContent = `${formatEuro(exp.amount / monthsUntil(exp.due_date))}/Mon.`;

    const dateSpan = document.createElement("span");
    dateSpan.className = "count";
    dateSpan.textContent = `fällig ${formatShortDate(exp.due_date)}.`;

    li.append(title, badge, dateSpan);
    list.appendChild(li);
  }
}

// Notiz und Betrag sind direkt editierbar (Blur committet) — gleiches Muster wie
// buildFixedCostItem. Löschen läuft ohne Bestätigungs-Dialog: die Transaktion lässt sich per
// Undo-Toast (createTransaction mit denselben Werten) trivial wiederherstellen.
function buildTransactionItem(tx) {
  const li = document.createElement("li");
  li.className = "task-item tx-item";
  li.style.borderLeftColor = POT_COLOR_VAR[tx.pot] || "var(--color-text-subtle)";
  li.style.setProperty("--task-area-color", POT_COLOR_VAR[tx.pot] || "var(--color-surface)");

  const dot = document.createElement("span");
  dot.className = "task-area-dot";
  dot.style.background = POT_COLOR_VAR[tx.pot] || "var(--color-text-subtle)";

  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.className = "input area-name-input";
  noteInput.value = tx.note || "";
  noteInput.placeholder = POT_LABELS[tx.pot] || "Notiz";
  noteInput.setAttribute("aria-label", "Notiz");
  noteInput.addEventListener("blur", async () => {
    const value = noteInput.value.trim();
    if (value === (tx.note || "")) return;
    await withErrorToast(async () => {
      await updateTransaction(tx.id, { note: value || null });
      await reloadFinance();
    });
  });
  noteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") noteInput.blur();
  });

  const sign = document.createElement("span");
  sign.className = "count" + (tx.direction === "income" ? " tx-amount-income" : "");
  sign.textContent = tx.direction === "income" ? "+" : "−";

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.step = "0.01";
  amountInput.min = "0";
  amountInput.className = "input" + (tx.direction === "income" ? " tx-amount-income" : "");
  amountInput.style.maxWidth = "90px";
  amountInput.value = tx.amount;
  amountInput.setAttribute("aria-label", "Betrag");
  amountInput.addEventListener("blur", async () => {
    const value = Number(amountInput.value);
    if (!value || value === Number(tx.amount)) {
      amountInput.value = tx.amount;
      return;
    }
    await withErrorToast(async () => {
      await updateTransaction(tx.id, { amount: value });
      await reloadFinance();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteTransaction(tx.id);
      await reloadFinance();
      showToast(`${formatEuro(tx.amount)} gelöscht.`, false, {
        label: "Rückgängig",
        onClick: () =>
          withErrorToast(async () => {
            await createTransaction({
              direction: tx.direction,
              amount: tx.amount,
              pot: tx.pot,
              category: tx.category,
              note: tx.note,
              source: tx.source,
              occurredAt: tx.occurred_at,
            });
            await reloadFinance();
          }),
      });
    });
  });

  const line1 = document.createElement("div");
  line1.className = "tx-line";
  line1.append(dot, noteInput);

  const line2 = document.createElement("div");
  line2.className = "tx-line tx-line-amount";
  line2.append(sign, amountInput, deleteBtn);

  li.append(line1, line2);

  // Kategorie nachträglich änderbar (implementieren-jetzt.md, Triage 2026-07-20) — als Dropdown
  // statt Chip-Reihe (Triage 2026-07-21, dieselben TRANSACTION_CATEGORY_*-Konstanten wie im
  // Kategorie-Donut). Ausgeblendet bei Einnahmen, die haben keine Kategorie (analog zur
  // Topf-Auswahl im Neuanlage-Formular).
  if (tx.direction === "expense") {
    const categorySelect = document.createElement("select");
    categorySelect.className = "select tx-line";
    categorySelect.setAttribute("aria-label", "Kategorie");
    categorySelect.innerHTML =
      `<option value="">Nicht kategorisiert</option>` +
      financeState.expenseCategories
        .map((c) => `<option value="${c.key}"${tx.category === c.key ? " selected" : ""}>${c.name}</option>`)
        .join("");
    categorySelect.addEventListener("change", async () => {
      await withErrorToast(async () => {
        await updateTransaction(tx.id, { category: categorySelect.value || null });
        await reloadFinance();
      });
    });
    li.appendChild(categorySelect);
  }

  return li;
}

function renderTransactionList() {
  const list = document.getElementById("transaction-list");
  const emptyState = document.getElementById("transaction-empty-state");
  const filtered = financeState.txFilterPot
    ? financeState.transactions.filter((t) => t.pot === financeState.txFilterPot)
    : financeState.transactions;

  list.innerHTML = "";
  if (filtered.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;
  filtered.slice(0, 20).forEach((tx) => list.appendChild(buildTransactionItem(tx)));
}

function wireFinanceFilters() {
  const select = document.getElementById("tx-filter-pot");
  select.addEventListener("change", () => {
    financeState.txFilterPot = select.value;
    renderTransactionList();
  });
}

function buildWishlistCard(item) {
  const card = document.createElement("div");
  card.className = "wish-card";

  const top = document.createElement("div");
  top.className = "wish-top";
  const title = document.createElement("span");
  title.className = "wish-title";
  title.textContent = item.title;
  const price = document.createElement("span");
  price.className = "wish-price";
  price.textContent = item.current_price != null ? formatEuro(item.current_price) : "—";
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Löschen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteWishlistItem(item.id);
      await reloadFinance();
    });
  });
  top.append(title, price, deleteBtn);

  const tags = document.createElement("div");
  tags.className = "wish-tags";
  if (item.category) {
    const catTag = document.createElement("span");
    catTag.className = "wtag";
    catTag.textContent = WISHLIST_CATEGORY_LABELS[item.category];
    tags.appendChild(catTag);
  }
  const statusTag = document.createElement("button");
  statusTag.type = "button";
  statusTag.className = `wtag status-${item.status}`;
  statusTag.textContent = WISHLIST_STATUS_LABELS[item.status];
  statusTag.setAttribute("aria-label", "Status ändern");
  statusTag.addEventListener("click", async () => {
    const next = WISHLIST_STATUS_CYCLE[(WISHLIST_STATUS_CYCLE.indexOf(item.status) + 1) % WISHLIST_STATUS_CYCLE.length];
    await withErrorToast(async () => {
      await updateWishlistItem(item.id, { status: next });
      await reloadFinance();
    });
  });
  tags.appendChild(statusTag);

  card.append(top, tags);

  // Fortschritt bis zur Kaufbereitschaft direkt auf der Karte, statt erst sichtbar zu werden,
  // sobald der Spartopf den Preis schon vollständig deckt (siehe filterBuyReady/renderBuyReadyAlert)
  // — nur für Wünsche mit Preis, die noch nicht manuell auf "ready" gesetzt oder gekauft sind.
  if (item.current_price > 0 && (item.status === "active" || item.status === "inactive")) {
    const pct = Math.max(0, Math.min(100, Math.round((financeState.potBalance / item.current_price) * 100)));
    const fundBar = document.createElement("div");
    fundBar.className = "wish-fund-bar";
    const fill = document.createElement("div");
    fill.className = "wish-fund-fill";
    fill.style.width = `${pct}%`;
    fundBar.appendChild(fill);
    const fundLabel = document.createElement("div");
    fundLabel.className = "wish-fund-label";
    fundLabel.textContent = `${pct} % aus dem Spartopf finanzierbar`;
    card.append(fundBar, fundLabel);
  }

  return card;
}

function renderWishlistCards() {
  const list = document.getElementById("wishlist-cards");
  list.innerHTML = "";
  if (financeState.wishlistItems.length === 0) {
    list.appendChild(buildEmptyState("Wunschliste ist leer", "Leg unten deinen ersten Wunsch an — Rohtext reicht."));
    return;
  }
  financeState.wishlistItems.forEach((item) => list.appendChild(buildWishlistCard(item)));
}

function wireWishlistForm() {
  document.getElementById("new-wishlist-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("new-wishlist-title");
    const title = input.value.trim();
    if (!title) return;
    await withErrorToast(async () => {
      await createWishlistItem({ title });
      showToast(`„${title}" zur Wunschliste hinzugefügt.`);
      input.value = "";
      await reloadFinance();
    });
  });
}

// Per "+"-Button oben aufklappbares Formular, kein fixierter Balken — soll die Transaktionsliste
// nicht dauerhaft verdecken (gleiches Prinzip wie die Heute-Schnellerfassung).
function wireTransactionQuickCapture() {
  const form = document.getElementById("tx-quick-form");
  const toggleBtn = document.getElementById("tx-quick-toggle");
  const cancelBtn = document.getElementById("tx-quick-cancel");
  const amountInput = document.getElementById("tx-quick-amount");
  const directionGroup = document.getElementById("tx-quick-direction");
  const potGroup = document.getElementById("tx-quick-pot");
  const categoryGroup = document.getElementById("tx-quick-category");
  const notgroschenToggle = document.getElementById("tx-quick-notgroschen-toggle");
  const notgroschenCheckbox = document.getElementById("tx-quick-notgroschen-checkbox");
  const noteInput = document.getElementById("tx-quick-note");
  const submitBtn = form.querySelector('button[type="submit"]');

  let selectedPot = "freiheit";
  // Sobald der Nutzer den Topf einmal selbst antippt, hört das Kategorie-Automapping auf, seine
  // Wahl zu überschreiben (er weiß dann besser, wohin die Ausgabe gehört).
  let potTouchedManually = false;
  const setPot = (pot) => {
    selectedPot = pot;
    potGroup.querySelectorAll(".pot-chip").forEach((c) => (c.dataset.active = String(c.dataset.pot === selectedPot)));
  };
  potGroup.querySelectorAll(".pot-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      potTouchedManually = true;
      setPot(chip.dataset.pot);
    });
  });

  // Kategorie als Dropdown statt Chip-Reihe (implementieren-jetzt.md, Triage 2026-07-21) — der
  // leere Wert ("Kategorie (optional)") übernimmt die frühere Abwähl-Funktion des erneuten
  // Chip-Klicks, kein selectedCategory-State mehr nötig, categoryGroup.value ist die Quelle.
  // Kategorie schlägt automatisch den passenden Topf vor (solange nicht manuell gewählt): Wohnen
  // sind Fixkosten, Gesundheit fällt in Sicherheit, der Rest bleibt beim Default-Topf Freiheit.
  const CATEGORY_POT_MAP = { wohnen: "fixkosten", gesundheit: "sicherheit" };
  categoryGroup.addEventListener("change", () => {
    if (potTouchedManually) return;
    setPot(CATEGORY_POT_MAP[categoryGroup.value] || "freiheit");
  });

  // Töpfe ordnen Ausgaben einem Verwendungszweck zu — bei einer Einnahme ergibt das fachlich
  // keinen Sinn, daher wird die Topf-Auswahl dafür ausgeblendet statt nur deaktiviert. Die sechs
  // Kategorien sind ebenfalls ausgabenspezifisch, gleiches Verstecken bei Einnahme.
  let selectedDirection = "expense";
  directionGroup.querySelectorAll(".priority-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedDirection = chip.dataset.direction;
      directionGroup
        .querySelectorAll(".priority-chip")
        .forEach((c) => (c.dataset.active = String(c.dataset.direction === selectedDirection)));
      potGroup.hidden = selectedDirection === "income";
      categoryGroup.hidden = selectedDirection === "income";
      notgroschenToggle.hidden = selectedDirection !== "income";
    });
  });

  const closeForm = () => {
    form.hidden = true;
    form.reset();
    potTouchedManually = false;
    setPot("freiheit");
    categoryGroup.value = "";
    selectedDirection = "expense";
    directionGroup
      .querySelectorAll(".priority-chip")
      .forEach((c) => (c.dataset.active = String(c.dataset.direction === "expense")));
    potGroup.hidden = false;
    categoryGroup.hidden = false;
    notgroschenCheckbox.checked = false;
    notgroschenToggle.hidden = true;
  };

  // Letzte Ausgaben-Wahl (Topf + Kategorie) merken und beim nächsten Öffnen vorbelegen — spart bei
  // wiederkehrenden Ausgaben Klicks. Die Kategorie→Topf-Automatik bleibt aktiv, sobald der Nutzer die
  // Kategorie wechselt (potTouchedManually bleibt false).
  const TX_DEFAULT_KEY = "leben-os:tx-quick-default";
  const restoreLastTxDefault = () => {
    try {
      const raw = localStorage.getItem(TX_DEFAULT_KEY);
      if (!raw) return;
      const { pot, category } = JSON.parse(raw);
      if (category) categoryGroup.value = category;
      if (pot) setPot(pot);
    } catch {
      /* defekter/leerer Eintrag ignorieren, Standard-Default (Freiheit) greift */
    }
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      restoreLastTxDefault();
      amountInput.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    const amount = Number(amountInput.value);
    if (!amount) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createTransaction({
          amount,
          direction: selectedDirection,
          pot: selectedDirection === "income" ? (notgroschenCheckbox.checked ? "sicherheit" : null) : selectedPot,
          category: selectedDirection === "income" ? null : categoryGroup.value || null,
          note: noteInput.value.trim() || null,
        });
        showToast(`${formatEuro(amount)} erfasst.`);
        // Nur bei Ausgaben merken (Einnahmen haben weder Topf noch Kategorie).
        if (selectedDirection === "expense") {
          try {
            localStorage.setItem(TX_DEFAULT_KEY, JSON.stringify({ pot: selectedPot, category: categoryGroup.value || null }));
          } catch {
            /* localStorage nicht verfügbar — Merkfunktion still überspringen */
          }
        }
        closeForm();
        await reloadFinance();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}
