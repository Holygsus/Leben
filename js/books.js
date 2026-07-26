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

export async function createBook({
  title,
  author = null,
  totalPages = null,
  progressUnit = "chapters",
  totalChapters = null,
  status = "geplant",
  genre = null,
}) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("books")
    .insert({
      user_id: userId,
      title,
      author,
      total_pages: totalPages,
      progress_unit: progressUnit,
      total_chapters: totalChapters,
      status,
      genre,
    })
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

// Loggt eine Lese-Session in der Einheit des Buchs (Seiten ODER Kapitel) UND aktualisiert den
// aktuellen Stand des Buchs (nicht destruktiv — der Log bleibt die Quelle der Monats-Summe,
// current_page/current_chapter nur der aktuelle Stand). date optional (Default heute).
// unit: 'chapters' | 'pages', amountRead: die heute gelesene Menge, currentValue: neuer Gesamtstand.
export async function logReadingSession({ bookId, unit = "chapters", amountRead, date = null, currentValue }) {
  const userId = await getCurrentUserId();
  const payload = { user_id: userId, book_id: bookId };
  if (unit === "chapters") payload.chapters_read = amountRead;
  else payload.pages_read = amountRead;
  if (date) payload.date = date;
  const { error: logError } = await supabase.from("book_reading_log").insert(payload);
  if (logError) throw logError;
  const bookUpdate = unit === "chapters" ? { current_chapter: currentValue } : { current_page: currentValue };
  const { data, error } = await supabase.from("books").update(bookUpdate).eq("id", bookId).select().single();
  if (error) throw error;
  return data;
}

// Reine Aggregation: Summe pages_read aller Log-Einträge im angegebenen Kalendermonat ("YYYY-MM").
export function sumPagesInMonth(logEntries, monthIso) {
  return logEntries
    .filter((e) => typeof e.date === "string" && e.date.slice(0, 7) === monthIso)
    .reduce((sum, e) => sum + (Number(e.pages_read) || 0), 0);
}

// Reine Aggregation: Summe chapters_read aller Log-Einträge im angegebenen Kalendermonat ("YYYY-MM").
export function sumChaptersInMonth(logEntries, monthIso) {
  return logEntries
    .filter((e) => typeof e.date === "string" && e.date.slice(0, 7) === monthIso)
    .reduce((sum, e) => sum + (Number(e.chapters_read) || 0), 0);
}
