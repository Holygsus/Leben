import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listTransactions({ pot, from, to } = {}) {
  let query = supabase.from("transactions").select("*").order("occurred_at", { ascending: false });
  if (pot) query = query.eq("pot", pot);
  if (from) query = query.gte("occurred_at", from);
  if (to) query = query.lte("occurred_at", to);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createTransaction({
  direction = "expense",
  amount,
  pot = null,
  category = null,
  note = null,
  source = "manual",
  occurredAt = null,
}) {
  const userId = await getCurrentUserId();
  const payload = { user_id: userId, direction, amount, pot, category, note, source };
  // occurred_at ist NOT NULL mit DB-Default (current_date) — nur setzen, wenn explizit übergeben,
  // sonst würde ein expliziter null-Wert den Default überschreiben und die Constraint verletzen.
  if (occurredAt) payload.occurred_at = occurredAt;
  const { data, error } = await supabase.from("transactions").insert(payload).select().single();
  if (error) throw error;
  return data;
}

// Kategorie-Verteilung fürs Kreisdiagramm im Finanzen-Tab — reine Funktion, kein DB-Zugriff.
// "uncategorized" ist ein eigener, ehrlicher Eintrag statt eines versteckten Defaults (siehe
// wissensdatenbank/finanzen-erweiterungen/finanzplan-erweiterungen-v2.md, Punkt 2).
export function computeCategoryBreakdown(transactions) {
  const totals = {};
  for (const tx of transactions) {
    if (tx.direction !== "expense") continue;
    const key = tx.category || "uncategorized";
    totals[key] = (totals[key] || 0) + Number(tx.amount);
  }
  return totals;
}

export async function updateTransaction(id, updates) {
  const { data, error } = await supabase.from("transactions").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function listFixedCosts() {
  const { data, error } = await supabase.from("fixed_costs").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createFixedCost({ name, amount, interval, category = null }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("fixed_costs")
    .insert({ user_id: userId, name, amount, interval, category })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateFixedCost(id, updates) {
  const { data, error } = await supabase.from("fixed_costs").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFixedCost(id) {
  const { error } = await supabase.from("fixed_costs").delete().eq("id", id);
  if (error) throw error;
}

export async function listCommittedExpenses({ statusNot } = {}) {
  let query = supabase.from("committed_expenses").select("*").order("due_date", { ascending: true });
  if (statusNot) query = query.neq("status", statusNot);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createCommittedExpense({ name, amount, dueDate }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("committed_expenses")
    .insert({ user_id: userId, name, amount, due_date: dueDate })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCommittedExpense(id, updates) {
  const { data, error } = await supabase.from("committed_expenses").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCommittedExpense(id) {
  const { error } = await supabase.from("committed_expenses").delete().eq("id", id);
  if (error) throw error;
}

// Default-Konfiguration für den Finanzplan — Phase 1, alle Töpfe/Ziele noch unberechnet, bis genug
// Datenpunkte vorliegen (siehe wissensdatenbank/finanzplan-architektur.md, "Entschiedene Fragen").
const DEFAULT_FINANCE_SETTINGS = {
  phase: 1,
  pots: { fixkosten: null, sicherheit: null, wachstum: null, freiheit: null },
  notgroschen_target: null,
  notgroschen_basis: null,
  wachstum_monatsbetrag: null,
  broker: null,
};

// Liest die Finanzplan-Konfiguration aus `modules` (name = 'finanzplan') — legt die Zeile mit
// Default-Settings an, falls sie noch nicht existiert (Get-or-create, analog ensureAreasSeeded).
export async function getFinanceModuleSettings() {
  const userId = await getCurrentUserId();
  const { data: existing, error } = await supabase
    .from("modules")
    .select("*")
    .eq("user_id", userId)
    .eq("name", "finanzplan")
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from("modules")
    .insert({ user_id: userId, name: "finanzplan", is_active: true, settings: DEFAULT_FINANCE_SETTINGS })
    .select()
    .single();
  if (insertError) throw insertError;
  return created;
}

// Merged neue Werte in die bestehenden Settings, statt sie zu überschreiben — ein Update darf nie
// andere, bereits gesetzte Settings-Felder stillschweigend löschen.
export async function updateFinanceModuleSettings(patch) {
  const current = await getFinanceModuleSettings();
  const merged = { ...current.settings, ...patch };
  const { data, error } = await supabase
    .from("modules")
    .update({ settings: merged })
    .eq("id", current.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
