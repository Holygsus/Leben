// Ansicht "Gaming" (#/games).
import { listGames, createGame, updateGame, deleteGame } from "../games.js";
import { buildEmptyState } from "../ui/dom.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";

/* ---------- Gaming-Backlog ---------- */
// wissensdatenbank/features/gaming-backlog.md — diese Runde nur der manuelle Bestand (kein Preis-/
// Budget-Teil, der läuft weiter über die Wunschliste). Muster wie Kühlschrank/Fixkosten.

const GAME_STATUS_LABELS = {
  wishlist: "Wunschliste",
  backlog: "Backlog",
  playing: "Spiele gerade",
  paused: "Pausiert",
  done: "Durch",
  abandoned: "Abgebrochen",
};

// Farbe + Sortierrang je Status — Sortierrang hebt "Spiele gerade" nach oben, Farbe codiert den
// Status als Punkt/Zeilenakzent statt nur als Dropdown-Text.
const GAME_STATUS_META = {
  playing: { color: "var(--color-success)", order: 0 },
  paused: { color: "var(--color-warning)", order: 1 },
  backlog: { color: "var(--color-text-subtle)", order: 2 },
  wishlist: { color: "var(--color-accent)", order: 3 },
  done: { color: "var(--color-accent-warm)", order: 4 },
  abandoned: { color: "var(--color-danger)", order: 5 },
};

// Priorität pro Titel (nullable) — Label + Sortierrang (hoch zuerst, "keine" zuletzt).
const GAME_PRIORITY_LABELS = { high: "Hoch", medium: "Mittel", low: "Niedrig" };
const GAME_PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const gamePriorityRank = (p) => GAME_PRIORITY_ORDER[p] ?? 3;

// Vergleicht zwei Spiele in der Anzeige-Reihenfolge innerhalb eines Status: Priorität, dann
// manuelle sort_order, dann Titel. Status-Rang (Spiele-gerade oben) sitzt in renderGamesList davor.
function compareGamesInStatus(a, b) {
  return (
    gamePriorityRank(a.priority) - gamePriorityRank(b.priority) ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    a.title.localeCompare(b.title)
  );
}

const gamesState = { games: [], showFinished: false };

export async function renderGamesView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/games.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  gamesState.showFinished = false;
  await reloadGamesList();
  wireGamesQuickAddForm();
  const finishedToggle = document.getElementById("games-show-finished");
  if (finishedToggle) {
    finishedToggle.addEventListener("change", () => {
      gamesState.showFinished = finishedToggle.checked;
      renderGamesList();
    });
  }
  // Zufallspicker: würfelt einen Titel aus Backlog/pausiert aus (analog zum Quick-Win-Würfel auf
  // "Heute") — nimmt die Qual der Wahl aus einem gewachsenen Backlog.
  const randomPick = document.getElementById("games-random-pick");
  if (randomPick) {
    randomPick.addEventListener("click", () => {
      const pool = gamesState.games.filter((g) => g.status === "backlog" || g.status === "paused");
      if (pool.length === 0) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const platform = pick.platform ? ` (${pick.platform})` : "";
      showToast(`🎲 Zock doch: „${pick.title}"${platform}`);
    });
  }
}

async function reloadGamesList() {
  gamesState.games = await listGames();
  renderGamesList();
}

function renderGamesList() {
  const list = document.getElementById("games-list");
  const stats = document.getElementById("games-stats");
  list.innerHTML = "";
  if (gamesState.games.length === 0) {
    if (stats) stats.hidden = true;
    list.appendChild(buildEmptyState("Noch keine Spiele erfasst", "Leg unten den ersten Titel an."));
    return;
  }

  // Stat-Leiste: Backlog / Am Spielen / Durch auf einen Blick.
  if (stats) {
    const by = (s) => gamesState.games.filter((g) => g.status === s).length;
    stats.hidden = false;
    stats.innerHTML =
      `<div class="games-stat"><b>${by("backlog")}</b><small>Backlog</small></div>` +
      `<div class="games-stat"><b style="color:var(--color-success)">${by("playing")}</b><small>Am Spielen</small></div>` +
      `<div class="games-stat"><b style="color:var(--color-accent-warm)">${by("done")}</b><small>Durch</small></div>`;
  }

  // Durchgespielte/abgebrochene Titel wachsen sonst unbegrenzt und drängen den aktiven Backlog nach
  // unten — standardmäßig ausblenden, per Checkbox einblendbar. Die Zeile nur zeigen, wenn es
  // überhaupt solche Einträge gibt.
  const finishedCount = gamesState.games.filter((g) => g.status === "done" || g.status === "abandoned").length;
  const finishedRow = document.getElementById("games-show-finished-row");
  const finishedToggle = document.getElementById("games-show-finished");
  const randomPick = document.getElementById("games-random-pick");
  if (randomPick) {
    const pickable = gamesState.games.some((g) => g.status === "backlog" || g.status === "paused");
    randomPick.hidden = !pickable;
  }
  if (finishedRow) finishedRow.hidden = finishedCount === 0;
  if (finishedToggle) finishedToggle.checked = gamesState.showFinished;
  const visible = gamesState.showFinished
    ? gamesState.games
    : gamesState.games.filter((g) => g.status !== "done" && g.status !== "abandoned");

  // "Spiele gerade" nach oben, danach nach Status-Rang, innerhalb eines Status nach Priorität →
  // manueller Reihenfolge (sort_order) → Titel.
  const sorted = [...visible].sort((a, b) => {
    const oa = GAME_STATUS_META[a.status]?.order ?? 9;
    const ob = GAME_STATUS_META[b.status]?.order ?? 9;
    return oa - ob || compareGamesInStatus(a, b);
  });
  sorted.forEach((game) => list.appendChild(buildGameItem(game)));
}

function buildGameItem(game) {
  const li = document.createElement("li");
  li.className = "task-item tx-item game-item" + (game.status === "playing" ? " is-playing" : "");
  const statusColor = GAME_STATUS_META[game.status]?.color || "var(--color-text-subtle)";
  li.style.borderLeftColor = statusColor;
  li.style.setProperty("--task-area-color", statusColor);

  // Titel inline editierbar (Blur committet) — gleiches Muster wie Fixkosten/Schulden.
  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = game.title;
  title.setAttribute("aria-label", "Titel");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === game.title) {
      title.value = game.title;
      return;
    }
    await withErrorToast(async () => {
      await updateGame(game.id, { title: value });
      await reloadGamesList();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  const statusSelect = document.createElement("select");
  statusSelect.className = "select";
  statusSelect.setAttribute("aria-label", "Status");
  statusSelect.innerHTML = Object.entries(GAME_STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}"${game.status === value ? " selected" : ""}>${label}</option>`)
    .join("");
  statusSelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateGame(game.id, { status: statusSelect.value });
      await reloadGamesList();
    });
  });

  const progressInput = document.createElement("input");
  progressInput.type = "number";
  progressInput.min = "0";
  progressInput.max = "100";
  progressInput.className = "input";
  progressInput.style.maxWidth = "70px";
  progressInput.value = game.progress_pct ?? "";
  progressInput.placeholder = "%";
  progressInput.setAttribute("aria-label", "Fortschritt in Prozent");
  progressInput.addEventListener("blur", async () => {
    const raw = progressInput.value.trim();
    const value = raw === "" ? null : Math.min(100, Math.max(0, Number(raw)));
    if (value === (game.progress_pct ?? null)) {
      progressInput.value = game.progress_pct ?? "";
      return;
    }
    await withErrorToast(async () => {
      await updateGame(game.id, { progress_pct: value });
      await reloadGamesList();
    });
  });
  progressInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") progressInput.blur();
  });

  const meta = document.createElement("span");
  if (game.platform) {
    meta.className = "game-platform";
    meta.textContent = game.platform;
  }

  // Priorität pro Titel (Weekly-Muster "Priorisierung zwischen aktiven Titeln"). Leerwert = keine.
  const prioritySelect = document.createElement("select");
  prioritySelect.className = "select";
  prioritySelect.setAttribute("aria-label", "Priorität");
  prioritySelect.innerHTML =
    `<option value="">Prio —</option>` +
    Object.entries(GAME_PRIORITY_LABELS)
      .map(([value, label]) => `<option value="${value}"${game.priority === value ? " selected" : ""}>${label}</option>`)
      .join("");
  prioritySelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateGame(game.id, { priority: prioritySelect.value || null });
      await reloadGamesList();
    });
  });

  // Manuelle Warteschlangen-Reihenfolge innerhalb desselben Status (Feinjustierung innerhalb einer
  // Prioritätsstufe) über sort_order-Tausch mit dem Nachbarn in der Anzeige-Reihenfolge.
  const sameStatusSorted = gamesState.games.filter((g) => g.status === game.status).sort(compareGamesInStatus);
  const idxInStatus = sameStatusSorted.findIndex((g) => g.id === game.id);
  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "icon-btn";
  upBtn.textContent = "↑";
  upBtn.setAttribute("aria-label", "Nach oben");
  upBtn.disabled = idxInStatus <= 0;
  upBtn.addEventListener("click", () => moveGameInStatus(game, -1));
  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "icon-btn";
  downBtn.textContent = "↓";
  downBtn.setAttribute("aria-label", "Nach unten");
  downBtn.disabled = idxInStatus === -1 || idxInStatus >= sameStatusSorted.length - 1;
  downBtn.addEventListener("click", () => moveGameInStatus(game, 1));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Aus dem Backlog entfernen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteGame(game.id);
      await reloadGamesList();
    });
    showToast(`„${game.title}" entfernt.`, false, {
      label: "Rückgängig",
      onClick: () =>
        withErrorToast(async () => {
          await createGame({
            title: game.title,
            status: game.status,
            platform: game.platform,
            releaseDate: game.release_date,
            priority: game.priority,
            sortOrder: game.sort_order,
          });
          await reloadGamesList();
        }),
    });
  });

  li.append(title, statusSelect, prioritySelect, progressInput, meta, upBtn, downBtn, deleteBtn);

  // Fortschrittsbalken (volle Breite unter der Zeile) aus progress_pct — macht den Durchspiel-Stand
  // sichtbar, statt ihn nur als Zahl im Eingabefeld zu führen. Nur ab >0 %.
  if (game.progress_pct != null && game.progress_pct > 0) {
    const bar = document.createElement("span");
    bar.className = "game-progress";
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML = `<span class="game-progress-fill" style="width:${Math.min(100, game.progress_pct)}%;background:${statusColor}"></span>`;
    li.append(bar);
  }
  return li;
}

// Tauscht sort_order des Spiels mit dem Nachbarn (dir -1 = hoch, +1 = runter) in der Anzeige-
// Reihenfolge desselben Status. Nutzt effektive sort_order-Werte (Fallback 0) und stellt sicher,
// dass sich die beiden Werte tatsächlich unterscheiden, sonst bleibt die Reihenfolge unverändert.
async function moveGameInStatus(game, dir) {
  const group = gamesState.games.filter((g) => g.status === game.status).sort(compareGamesInStatus);
  const idx = group.findIndex((g) => g.id === game.id);
  const neighbor = group[idx + dir];
  if (!neighbor) return;
  const a = game.sort_order ?? 0;
  const b = neighbor.sort_order ?? 0;
  // Bei gleichem sort_order (z.B. beide Default 0) einen Versatz erzeugen, damit der Tausch greift.
  const newGameOrder = a === b ? b + dir : b;
  const newNeighborOrder = a === b ? a : a;
  await withErrorToast(async () => {
    await updateGame(game.id, { sort_order: newGameOrder });
    if (a !== b) await updateGame(neighbor.id, { sort_order: newNeighborOrder });
    await reloadGamesList();
  });
}

function wireGamesQuickAddForm() {
  const form = document.getElementById("new-game-form");
  const submitBtn = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("new-game-title");
    const statusSelect = document.getElementById("new-game-status");
    const platformInput = document.getElementById("new-game-platform");
    const title = titleInput.value.trim();
    if (!title || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        // Neue Titel ans Ende der Warteschlange (max sort_order + 1), nicht auf den kollidierenden 0.
        const maxSort = gamesState.games.reduce((max, g) => Math.max(max, g.sort_order ?? 0), 0);
        await createGame({
          title,
          status: statusSelect.value,
          platform: platformInput.value.trim() || null,
          sortOrder: maxSort + 1,
        });
        showToast(`„${title}" angelegt.`);
        titleInput.value = "";
        platformInput.value = "";
        statusSelect.value = "backlog";
        await reloadGamesList();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}
