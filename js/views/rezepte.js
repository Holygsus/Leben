// Ansicht "Rezepte" (#/rezepte).
import { createTask, deleteTask } from "../tasks.js";
import { listRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe, formatIngredientsForShoppingList } from "../recipes.js";
import { listPantryItems } from "../pantry.js";
import { escapeHtml } from "../ui/dom.js";
import { showToast, showConfirm, friendlyErrorMessage, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";

// ----- Bewertungs-Popup beim Erledigen in der Heute-Ansicht -----

/* ---------- Rezepte ---------- */
// wissensdatenbank/features/kochen-rezepte-kuehlschrank.md, Punkt 1 — Grundlage für den später
// geplanten digitalen Kühlschrank/Kochen-fördern.

export async function renderRezepteView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/rezepte.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  recipesViewState.search = "";
  await renderRecipeList();
  wireRecipeQuickAddForm();
  const searchInput = document.getElementById("recipe-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      recipesViewState.search = searchInput.value;
      paintRecipeList();
    });
  }
}

// Cache der zuletzt geladenen Rezepte + Vorratsnamen, damit die Titelsuche nur neu filtert statt
// bei jedem Tastendruck erneut aus Supabase zu laden.
const recipesViewState = { recipes: [], pantryNames: [], search: "" };

async function renderRecipeList() {
  // Vorrat mitladen für den "kochbar jetzt"-Abgleich (verbindet Rezepte- und Kühlschrank-Tab).
  const [recipes, pantryItems] = await Promise.all([listRecipes(), listPantryItems()]);
  recipesViewState.recipes = recipes;
  recipesViewState.pantryNames = pantryItems.map((p) => (p.name || "").toLowerCase()).filter(Boolean);
  paintRecipeList();
}

function paintRecipeList() {
  const list = document.getElementById("recipe-list");
  const emptyState = document.getElementById("recipe-empty-state");
  const searchInput = document.getElementById("recipe-search");
  const { recipes, pantryNames } = recipesViewState;
  list.innerHTML = "";
  if (recipes.length === 0) {
    list.className = "task-list";
    emptyState.hidden = false;
    if (searchInput) searchInput.hidden = true;
    return;
  }
  emptyState.hidden = true;
  // Suchfeld erst ab einer Handvoll Rezepte einblenden — darunter ist es reiner Ballast.
  if (searchInput) searchInput.hidden = recipes.length < 5;
  const query = recipesViewState.search.trim().toLowerCase();
  const shown = query ? recipes.filter((r) => (r.title || "").toLowerCase().includes(query)) : recipes;
  list.className = "recipe-grid";
  if (shown.length === 0) {
    const note = document.createElement("p");
    note.className = "kanban-empty";
    note.textContent = "Keine Treffer.";
    list.className = "task-list";
    list.appendChild(note);
    return;
  }
  for (const recipe of shown) {
    list.appendChild(buildRecipeCard(recipe, pantryNames));
  }
}

function buildRecipeCard(recipe, pantryNames) {
  const li = document.createElement("li");
  li.className = "recipe-card";

  const ingredients = (recipe.ingredients || []).filter((i) => i && i.name);
  // Kochbar-Abgleich: Zutat gilt als vorhanden, wenn ein Vorratsname sie als Teilstring enthält
  // oder umgekehrt (frei eingegebene Namen, gleiche Fuzzy-Logik wie der Watchlist-Genre-Filter).
  let badge = "";
  if (ingredients.length > 0) {
    const missing = ingredients.filter((ing) => {
      const n = ing.name.toLowerCase().trim();
      return !pantryNames.some((p) => p.includes(n) || n.includes(p));
    }).length;
    if (missing === 0) {
      badge = `<span class="recipe-badge is-ready">✓ kochbar</span>`;
    } else {
      // Verfügbarkeits-Ring statt reiner Fehlzahl: zeigt, WIE NAH ein fast-kochbares Rezept ist
      // (vorhandene / gesamte Zutaten), nicht nur dass etwas fehlt.
      const have = ingredients.length - missing;
      const pct = Math.round((have / ingredients.length) * 100);
      badge = `<span class="recipe-avail-ring" style="--ring-pct:${pct}" title="${have} von ${ingredients.length} Zutaten da" aria-label="${have} von ${ingredients.length} Zutaten vorhanden"><span>${have}/${ingredients.length}</span></span>`;
    }
  }

  const chips = [`<span class="recipe-chip">${ingredients.length} Zutat${ingredients.length === 1 ? "" : "en"}</span>`];
  if (recipe.instructions && recipe.instructions.trim()) chips.push(`<span class="recipe-chip">Zubereitung</span>`);

  li.innerHTML =
    `<div class="recipe-cover" aria-hidden="true">🍳</div>` +
    `<div class="recipe-card-body">` +
    `<span class="recipe-card-title">${escapeHtml(recipe.title)}</span>` +
    `<div class="recipe-chips">${chips.join("")}</div>` +
    `</div>` +
    badge;
  li.addEventListener("click", () => openRecipeDetail(recipe.id));
  return li;
}

function wireRecipeQuickAddForm() {
  const toggleBtn = document.getElementById("recipe-quick-add-toggle");
  const form = document.getElementById("recipe-quick-form");
  const titleInput = document.getElementById("recipe-quick-title");
  const cancelBtn = document.getElementById("recipe-quick-cancel");

  const closeForm = () => {
    form.hidden = true;
    form.reset();
  };

  toggleBtn.addEventListener("click", () => {
    if (form.hidden) {
      form.hidden = false;
      titleInput.focus();
    } else {
      closeForm();
    }
  });
  cancelBtn.addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    await withErrorToast(async () => {
      const recipe = await createRecipe({ title });
      closeForm();
      await renderRecipeList();
      // Ein frisch angelegtes Rezept ohne Zutaten ist wenig nützlich — direkt ins Detail-Modal
      // zum Ausfüllen, statt einen zusätzlichen Klick auf den Listeneintrag zu verlangen.
      await openRecipeDetail(recipe.id);
    });
  });
}

// ----- Rezept-Detail (Modal) -----

async function openRecipeDetail(recipeId, mode) {
  const root = document.getElementById("modal-root");
  document.body.style.overflow = "hidden";

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
    <div class="modal-backdrop" id="recipe-detail-backdrop">
      <div class="modal-card" id="recipe-detail-card" role="dialog" aria-modal="true" aria-label="Rezept"></div>
    </div>`;
  document.getElementById("recipe-detail-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "recipe-detail-backdrop") close();
  });

  await renderRecipeDetailCard(recipeId, close, mode);
}

function buildIngredientRow(ingredient = { name: "", amount: "" }) {
  const row = document.createElement("div");
  row.className = "new-task-form";
  row.innerHTML = `
    <input type="text" class="input ingredient-name" placeholder="Zutat" value="${escapeHtml(ingredient.name || "")}" />
    <input type="text" class="input ingredient-amount" placeholder="Menge (optional)" value="${escapeHtml(ingredient.amount || "")}" />
    <button type="button" class="icon-btn icon-btn-danger" aria-label="Zutat entfernen">×</button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  return row;
}

// Startet standardmäßig im Lese-Modus (Einkaufslisten-Optik) für ein bereits ausgefülltes Rezept,
// im Edit-Modus für ein frisch angelegtes leeres (implementieren-jetzt.md, Triage 2026-07-21 —
// vorher war die Ansicht immer im Editier-Modus, kein Lese-/Bearbeiten-Unterschied). Ein explizit
// übergebener mode gewinnt immer (z.B. "Bearbeiten"-Button oder Rücksprung nach dem Speichern).
async function renderRecipeDetailCard(recipeId, close, mode) {
  const recipe = await getRecipe(recipeId);
  const card = document.getElementById("recipe-detail-card");
  if (!recipe || !card) {
    close();
    return;
  }

  const hasContent = recipe.ingredients?.some((i) => i.name) || recipe.instructions;
  const currentMode = mode || (hasContent ? "view" : "edit");

  if (currentMode === "view") {
    renderRecipeViewCard(recipe, card, close);
  } else {
    renderRecipeEditCard(recipe, card, close);
  }

  document.getElementById("rd-delete").addEventListener("click", async () => {
    const ok = await showConfirm(`„${recipe.title}" wirklich löschen?`, { confirmLabel: "Löschen", danger: true });
    if (!ok) return;
    await withErrorToast(async () => {
      await deleteRecipe(recipe.id);
      close();
      await renderRecipeList();
    });
  });
}

// Fehlende Zutaten eines Rezepts relativ zum Vorrat — gleiche Fuzzy-Teilstring-Logik wie der
// "kochbar"-Badge in buildRecipeCard. Reine Funktion, von der "Fehlende einkaufen"-Aktion genutzt.
function computeMissingIngredients(ingredients, pantryNames) {
  return ingredients.filter((ing) => {
    const n = (ing.name || "").toLowerCase().trim();
    if (!n) return false;
    return !pantryNames.some((p) => p.includes(n) || n.includes(p));
  });
}

function renderRecipeViewCard(recipe, card, close) {
  const ingredients = recipe.ingredients?.filter((i) => i.name) || [];
  const ingredientsHtml = ingredients.length
    ? ingredients
        .map((i) => `<li class="task-item"><span class="task-title">${i.amount ? `${escapeHtml(i.amount)} ` : ""}${escapeHtml(i.name)}</span></li>`)
        .join("")
    : `<li class="empty-state">Keine Zutaten hinterlegt.</li>`;

  card.innerHTML = `
    <h2 class="modal-view-title">${escapeHtml(recipe.title)}</h2>

    <h3>Zutaten</h3>
    <ul class="task-list" id="rd-ingredients-view">${ingredientsHtml}</ul>

    <h3>Zubereitung</h3>
    <p class="status-message" style="white-space:pre-wrap">${recipe.instructions ? escapeHtml(recipe.instructions) : "Keine Zubereitung hinterlegt."}</p>

    <div class="modal-actions">
      <button class="btn" type="button" id="rd-edit">Bearbeiten</button>
      <button class="btn btn-secondary" type="button" id="rd-shopping-tasks">🛒 Fehlende einkaufen</button>
      <button class="btn btn-secondary" type="button" id="rd-shopping-list">Einkaufsliste kopieren</button>
      <button class="btn btn-secondary" type="button" id="rd-close">Schließen</button>
    </div>
    <p class="status-message" id="rd-status"></p>

    <button class="btn" type="button" id="rd-delete" style="background:var(--color-danger)">Rezept löschen</button>
  `;

  document.getElementById("rd-close").addEventListener("click", close);
  document.getElementById("rd-edit").addEventListener("click", () => {
    renderRecipeDetailCard(recipe.id, close, "edit");
  });
  document.getElementById("rd-shopping-list").addEventListener("click", async () => {
    const status = document.getElementById("rd-status");
    const text = formatIngredientsForShoppingList(ingredients);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "In die Zwischenablage kopiert.";
    } catch {
      status.textContent = text;
    }
  });
  // Fehlende Zutaten (Abgleich mit Kühlschrank) als echte Einkaufs-Aufgaben anlegen — verbindet
  // Rezepte-, Kühlschrank- und Aufgaben-Tab. Bewusst als bereichslose Backlog-Aufgaben (is_brainstorm),
  // landen so in "Ohne Bereich" der Übersicht. Rückgängig entfernt die gerade angelegten wieder.
  document.getElementById("rd-shopping-tasks").addEventListener("click", async () => {
    const status = document.getElementById("rd-status");
    const btn = document.getElementById("rd-shopping-tasks");
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const pantryItems = await listPantryItems();
      const pantryNames = pantryItems.map((p) => (p.name || "").toLowerCase()).filter(Boolean);
      const missing = computeMissingIngredients(ingredients, pantryNames);
      if (missing.length === 0) {
        status.textContent = "Alles da — nichts einzukaufen.";
        return;
      }
      await withErrorToast(async () => {
        const created = [];
        for (const ing of missing) {
          const label = `Einkaufen: ${ing.amount ? `${ing.amount} ` : ""}${ing.name}`.trim();
          created.push(await createTask({ title: label, effort: 5, isBrainstorm: true }));
        }
        status.textContent = `${created.length} Einkaufs-Aufgabe${created.length === 1 ? "" : "n"} angelegt.`;
        showToast(`${created.length} Einkaufs-Aufgabe${created.length === 1 ? "" : "n"} angelegt.`, false, {
          label: "Rückgängig",
          onClick: () =>
            withErrorToast(async () => {
              for (const t of created) await deleteTask(t.id);
              showToast("Rückgängig gemacht.");
            }),
        });
      });
    } finally {
      btn.disabled = false;
    }
  });
}

function renderRecipeEditCard(recipe, card, close) {
  card.innerHTML = `
    <h2 class="modal-view-title">${escapeHtml(recipe.title)}</h2>

    <label class="modal-label">Titel
      <input type="text" class="input" id="rd-title" value="${escapeHtml(recipe.title)}" />
    </label>

    <h3>Zutaten</h3>
    <div id="rd-ingredients-list"></div>
    <button class="btn btn-secondary" type="button" id="rd-add-ingredient">+ Zutat</button>

    <label class="modal-label">Zubereitung
      <textarea class="input" id="rd-instructions" rows="6">${escapeHtml(recipe.instructions || "")}</textarea>
    </label>

    <div class="modal-actions">
      <button class="btn" type="button" id="rd-save">Speichern</button>
      <button class="btn btn-secondary" type="button" id="rd-shopping-list">Einkaufsliste kopieren</button>
      <button class="btn btn-secondary" type="button" id="rd-close">Schließen</button>
    </div>
    <p class="status-message" id="rd-status"></p>

    <button class="btn" type="button" id="rd-delete" style="background:var(--color-danger)">Rezept löschen</button>
  `;

  const ingredientsList = document.getElementById("rd-ingredients-list");
  const ingredients = recipe.ingredients?.length ? recipe.ingredients : [{ name: "", amount: "" }];
  for (const ingredient of ingredients) {
    ingredientsList.appendChild(buildIngredientRow(ingredient));
  }

  document.getElementById("rd-add-ingredient").addEventListener("click", () => {
    ingredientsList.appendChild(buildIngredientRow());
  });

  document.getElementById("rd-close").addEventListener("click", close);

  document.getElementById("rd-save").addEventListener("click", async () => {
    const status = document.getElementById("rd-status");
    const title = document.getElementById("rd-title").value.trim();
    if (!title) {
      status.textContent = "Titel darf nicht leer sein.";
      return;
    }
    const collectedIngredients = [...ingredientsList.querySelectorAll(".new-task-form")]
      .map((row) => ({
        name: row.querySelector(".ingredient-name").value.trim(),
        amount: row.querySelector(".ingredient-amount").value.trim() || null,
      }))
      .filter((i) => i.name);
    const instructions = document.getElementById("rd-instructions").value.trim() || null;

    status.textContent = "Speichere…";
    try {
      await updateRecipe(recipe.id, { title, ingredients: collectedIngredients, instructions });
      await renderRecipeList();
      // Zurück zur Leseansicht nach dem Speichern (implementieren-jetzt.md, Triage 2026-07-21) —
      // vorher blieb die Ansicht nach dem Speichern im selben Editier-Modus stehen.
      await renderRecipeDetailCard(recipe.id, close, "view");
    } catch (err) {
      status.textContent = friendlyErrorMessage(err);
    }
  });

  document.getElementById("rd-shopping-list").addEventListener("click", async () => {
    const status = document.getElementById("rd-status");
    const collectedIngredients = [...ingredientsList.querySelectorAll(".new-task-form")]
      .map((row) => ({
        name: row.querySelector(".ingredient-name").value.trim(),
        amount: row.querySelector(".ingredient-amount").value.trim() || null,
      }))
      .filter((i) => i.name);
    const text = formatIngredientsForShoppingList(collectedIngredients);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "In die Zwischenablage kopiert.";
    } catch {
      status.textContent = text;
    }
  });
}
