import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listWishlistItems({ status, category } = {}) {
  let query = supabase.from("wishlist_items").select("*").order("created_at", { ascending: true });
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Rohtext-Einstieg: nur der Titel ist Pflicht, alles andere (Preis/Link/Kategorie/Prio) bleibt
// null bis zur Anreicherung im Weekly Review.
export async function createWishlistItem({ title }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("wishlist_items")
    .insert({ user_id: userId, title })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWishlistItem(id, updates) {
  const { data, error } = await supabase.from("wishlist_items").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteWishlistItem(id) {
  const { error } = await supabase.from("wishlist_items").delete().eq("id", id);
  if (error) throw error;
}

// Spartopf-Stand ist ein Ledger (siehe wissensdatenbank/sparplan-architektur.md) — der aktuelle
// Stand ist immer die Summe aller Einträge, kein eigenes Saldo-Feld.
export async function getSavingsPotBalance() {
  const { data, error } = await supabase.from("savings_pot_entries").select("amount");
  if (error) throw error;
  return data.reduce((sum, entry) => sum + Number(entry.amount), 0);
}

export async function addSavingsPotEntry({ amount, note = null, entryDate = null }) {
  const userId = await getCurrentUserId();
  const payload = { user_id: userId, amount, note };
  if (entryDate) payload.entry_date = entryDate;
  const { data, error } = await supabase.from("savings_pot_entries").insert(payload).select().single();
  if (error) throw error;
  return data;
}

// Reine Funktion (kein DB-Zugriff) — genutzt sowohl von der Finanzen-Ansicht als auch vom
// Kaufbereit-Widget in Heute, damit beide dieselbe Logik teilen statt sie zu duplizieren.
// "ready" ist die manuell bestätigte Kaufbereitschaft (Status-Badge heißt selbst "Kaufbereit")
// und zeigt sich unabhängig vom aktuellen Spartopf-Stand — die Entscheidung hat der Nutzer schon
// getroffen. "active" ist die automatische Erkennung: sobald der Spartopf den Preis deckt, taucht
// der Wunsch hier ebenfalls auf, auch wenn er noch nicht manuell auf "ready" gesetzt wurde.
export function filterBuyReady(items, potBalance) {
  return items.filter(
    (item) =>
      item.status === "ready" ||
      (item.status === "active" && item.current_price != null && item.current_price <= potBalance)
  );
}
