import { supabase } from "./supabase.js";

const DEFAULT_AREAS = [
  { name: "Persönlich & Alltag", color: "#378ADD", sort_order: 0 },
  { name: "Arbeit & Weiterbildung", color: "#1D9E75", sort_order: 1 },
  { name: "Selfcare & Gesundheit", color: "#D85A30", sort_order: 2 },
  { name: "Freizeit", color: "#BA7517", sort_order: 3 },
  { name: "Medien & Kreativität", color: "#7F77DD", sort_order: 4 },
  { name: "Beziehung & Soziales", color: "#D4537E", sort_order: 5 },
];

export async function signInWithMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUserId() {
  const session = await getSession();
  return session ? session.user.id : null;
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(session, event));
  return data.subscription;
}

export async function ensureAreasSeeded(userId) {
  const { data: existing, error } = await supabase
    .from("areas")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw error;
  if (existing.length > 0) return;

  // Upsert mit ignoreDuplicates: zusammen mit dem UNIQUE(user_id, name)-Constraint
  // kann so auch bei parallelen Ladevorgängen kein Bereich doppelt entstehen.
  const { error: insertError } = await supabase
    .from("areas")
    .upsert(
      DEFAULT_AREAS.map((area) => ({ ...area, user_id: userId })),
      { onConflict: "user_id,name", ignoreDuplicates: true }
    );
  if (insertError) throw insertError;
}
