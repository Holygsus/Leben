import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

// "Lesen als Bereich" — einfache Seiten-Variante (siehe wissensdatenbank/features/lesen-als-bereich.md).
// CRUD-Muster wie games.js/pantry.js; book_reading_log liefert die Monats-Übersicht.
export async function listBooks() {
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createBook({ title, author = null, totalPages = null, status = "geplant", genre = null }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("books")
    .insert({ user_id: userId, title, author, total_pages: totalPages, status, genre })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBook(id, updates) {
  const { data, error } = await supabase.from("books").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBook(id) {
  const { error } = await supabase.from("books").delete().eq("id", id);
  if (error) throw error;
}

export async function listReadingLog() {
  const { data, error } = await supabase.from("book_reading_log").select("*");
  if (error) throw error;
  return data;
}

// Loggt eine Lese-Session UND erhöht current_page des Buchs (nicht destruktiv — der Log bleibt die
// Quelle der Monats-Summe, current_page nur der aktuelle Stand). date optional (Default heute).
export async function logReadingSession({ bookId, pagesRead, date = null, currentPage }) {
  const userId = await getCurrentUserId();
  const payload = { user_id: userId, book_id: bookId, pages_read: pagesRead };
  if (date) payload.date = date;
  const { error: logError } = await supabase.from("book_reading_log").insert(payload);
  if (logError) throw logError;
  const { data, error } = await supabase
    .from("books")
    .update({ current_page: currentPage })
    .eq("id", bookId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Reine Aggregation: Summe pages_read aller Log-Einträge im angegebenen Kalendermonat ("YYYY-MM").
export function sumPagesInMonth(logEntries, monthIso) {
  return logEntries
    .filter((e) => typeof e.date === "string" && e.date.slice(0, 7) === monthIso)
    .reduce((sum, e) => sum + (Number(e.pages_read) || 0), 0);
}
