import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

// Gaming-Backlog — manueller Bestand (siehe wissensdatenbank/features/gaming-backlog.md). CRUD-Muster
// exakt wie pantry.js/finance.js. Kaufentscheidung/Preis läuft weiter über wishlist_items.
export async function listGames() {
  const { data, error } = await supabase
    .from("game_backlog_items")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createGame({ title, status = "backlog", platform = null, releaseDate = null, priority = null, sortOrder = 0 }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("game_backlog_items")
    .insert({ user_id: userId, title, status, platform, release_date: releaseDate, priority, sort_order: sortOrder })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateGame(id, updates) {
  const { data, error } = await supabase.from("game_backlog_items").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteGame(id) {
  const { error } = await supabase.from("game_backlog_items").delete().eq("id", id);
  if (error) throw error;
}
