import { supabase } from "./supabase.js";
import { getCurrentUserId } from "./auth.js";

export async function listRecipes() {
  const { data, error } = await supabase.from("recipes").select("*").order("title", { ascending: true });
  if (error) throw error;
  return data;
}

export async function createRecipe({ title, ingredients = [], instructions = null }) {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("recipes")
    .insert({ user_id: userId, title, ingredients, instructions })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRecipe(id, updates) {
  const { data, error } = await supabase.from("recipes").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRecipe(id) {
  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw error;
}

// Zwischenablage-Export der Zutaten (analog formatTasksForExport in planner.js) — noch ohne
// Kühlschrank-Abgleich (Punkt 2 in wissensdatenbank/features/kochen-rezepte-kuehlschrank.md
// existiert noch nicht), zeigt schlicht alle Zutaten des Rezepts.
export function formatIngredientsForShoppingList(ingredients) {
  if (ingredients.length === 0) return "Keine Zutaten hinterlegt.";
  return ingredients.map((i) => (i.amount ? `- ${i.amount} ${i.name}` : `- ${i.name}`)).join("\n");
}
