// Ansicht "Lesen" (#/books).
import {
  listBooks,
  createBook,
  updateBook,
  deleteBook,
  listReadingLog,
  logReadingSession,
  sumPagesInMonth,
  sumChaptersInMonth,
} from "../books.js";
import { resizeImageToBlob, getBookCoverBlob, saveBookCoverBlob, clearBookCover } from "../personalization.js";
import { todayISO } from "../ui/dates.js";
import { buildEmptyState } from "../ui/dom.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";

/* ---------- Lesen (Bücher, einfache Seiten-Variante) ---------- */
// wissensdatenbank/features/lesen-als-bereich.md — diese Runde nur Seiten-Fortschritt + Monats-
// Übersicht (keine Kapitelstruktur, keine immersive Optik). Muster wie Gaming/Kühlschrank.

const BOOK_STATUS_LABELS = {
  geplant: "Geplant",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  beendet: "Beendet",
};

// Anzeigerang: was man gerade liest zuerst, Beendetes ganz nach unten — sonst versickert das
// aktive Buch zwischen längst durchgelesenen.
const BOOK_STATUS_ORDER = { aktiv: 0, pausiert: 1, geplant: 2, beendet: 3 };

// Statusfarbe für Kanten-/Aktiv-Hervorhebung der Buch-Zeile (der Status lag bisher nur im Dropdown).
const BOOK_STATUS_COLOR = {
  aktiv: "var(--color-success)",
  pausiert: "var(--color-accent-warm)",
  geplant: "var(--color-text-subtle)",
  beendet: "var(--color-accent)",
};

const booksState = { books: [], log: [] };

export async function renderBooksView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/books.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();
  await reloadBooks();
  wireBooksQuickAddForm();
}

async function reloadBooks() {
  const [books, log] = await Promise.all([listBooks(), listReadingLog()]);
  booksState.books = books;
  booksState.log = log;
  renderBooksMonthSummary();
  renderBooksList();
}

function renderBooksMonthSummary() {
  const el = document.getElementById("books-month-summary");
  if (!el) return;
  const monthIso = todayISO().slice(0, 7);
  const chapters = sumChaptersInMonth(booksState.log, monthIso);
  const pages = sumPagesInMonth(booksState.log, monthIso);
  const activeCount = booksState.books.filter((b) => b.status === "aktiv").length;
  const doneCount = booksState.books.filter((b) => b.status === "beendet").length;
  // Primäre Monatszahl: Seiten, sonst Kapitel (je nachdem, was geloggt wurde).
  const monthValue = pages > 0 ? pages : chapters;
  const monthUnit = pages > 0 ? "Seiten / Monat" : "Kapitel / Monat";
  // Stat-Kopf statt blasser Textzeile — gibt dem Screen einen Anker (analog Gaming-Stat-Leiste).
  el.classList.add("books-stat-head");
  el.innerHTML =
    `<span class="books-stat"><b style="color:var(--color-accent-warm)">${monthValue}</b><small>${monthUnit}</small></span>` +
    `<span class="books-stat"><b>${activeCount}</b><small>Aktiv</small></span>` +
    `<span class="books-stat"><b style="color:var(--color-success)">${doneCount}</b><small>Beendet</small></span>`;
}

function renderBooksList() {
  const list = document.getElementById("books-list");
  list.innerHTML = "";
  if (booksState.books.length === 0) {
    list.appendChild(buildEmptyState("Noch keine Bücher", "Leg unten das erste Buch an."));
    return;
  }
  const sorted = [...booksState.books].sort(
    (a, b) => (BOOK_STATUS_ORDER[a.status] ?? 9) - (BOOK_STATUS_ORDER[b.status] ?? 9)
  );
  sorted.forEach((book) => list.appendChild(buildBookItem(book)));
  loadActiveBookCovers();
}

// Lädt die lokal gespeicherten Cover-Blobs (IndexedDB) für die aktiven Bücher nach und füllt das
// jeweilige .book-cover-Element — asynchron/fire-and-forget, damit renderBooksList synchron bleibt.
async function loadActiveBookCovers() {
  const buttons = document.querySelectorAll(".book-cover[data-book-id]");
  for (const btn of buttons) {
    const blob = await getBookCoverBlob(btn.dataset.bookId).catch(() => null);
    if (!blob || !btn.isConnected) continue;
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.alt = "Cover";
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
    btn.innerHTML = "";
    btn.classList.remove("book-cover-empty");
    btn.appendChild(img);
    const removeBtn = btn.parentElement?.querySelector(".book-cover-remove");
    if (removeBtn) removeBtn.hidden = false;
  }
}

function buildBookItem(book) {
  const li = document.createElement("li");
  li.className = "task-item tx-item book-item";
  // Statusfarbe an die Kante; das aktuell gelesene Buch zusätzlich als Hero hervorgehoben (steht
  // durch BOOK_STATUS_ORDER ohnehin schon oben).
  const statusColor = BOOK_STATUS_COLOR[book.status] || "var(--color-text-subtle)";
  li.style.borderLeftColor = statusColor;
  li.style.setProperty("--task-area-color", statusColor);
  if (book.status === "aktiv") li.classList.add("is-active-book");

  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = book.title;
  title.setAttribute("aria-label", "Titel");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === book.title) {
      title.value = book.title;
      return;
    }
    await withErrorToast(async () => {
      await updateBook(book.id, { title: value });
      await reloadBooks();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  const statusSelect = document.createElement("select");
  statusSelect.className = "select";
  statusSelect.setAttribute("aria-label", "Status");
  statusSelect.innerHTML = Object.entries(BOOK_STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}"${book.status === value ? " selected" : ""}>${label}</option>`)
    .join("");
  statusSelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateBook(book.id, { status: statusSelect.value });
      await reloadBooks();
    });
  });

  // Fortschritt in der Einheit des Buchs (Kapitel als Default, sonst Seiten).
  const unit = book.progress_unit === "pages" ? "pages" : "chapters";
  const currentField = unit === "pages" ? "current_page" : "current_chapter";
  const totalField = unit === "pages" ? "total_pages" : "total_chapters";
  const unitShort = unit === "pages" ? "S." : "Kap.";
  const currentValue = book[currentField] ?? 0;
  const totalValue = book[totalField];

  // Aktueller Stand, inline editierbar (direkte Korrektur ohne Log-Eintrag).
  const progressInput = document.createElement("input");
  progressInput.type = "number";
  progressInput.min = "0";
  progressInput.className = "input";
  progressInput.style.maxWidth = "70px";
  progressInput.value = currentValue;
  progressInput.setAttribute("aria-label", unit === "pages" ? "Aktuelle Seite" : "Aktuelles Kapitel");
  progressInput.addEventListener("blur", async () => {
    const value = Number(progressInput.value);
    if (Number.isNaN(value) || value === Number(currentValue)) {
      progressInput.value = currentValue;
      return;
    }
    await withErrorToast(async () => {
      await updateBook(book.id, { [currentField]: value });
      await reloadBooks();
    });
  });

  const meta = document.createElement("span");
  meta.className = "count";
  const progressLabel = totalValue ? `${unitShort} ${currentValue} / ${totalValue}` : `${unitShort} ${currentValue}`;
  meta.textContent = [progressLabel, book.author].filter(Boolean).join(" · ");

  // "+heute": loggt eine Session (Monats-Summe) und bumpt den Stand in der Buch-Einheit.
  const addProgress = document.createElement("input");
  addProgress.type = "number";
  addProgress.min = "1";
  addProgress.className = "input";
  addProgress.style.maxWidth = "64px";
  addProgress.placeholder = `+${unitShort}`;
  addProgress.setAttribute("aria-label", unit === "pages" ? "Heute gelesene Seiten hinzufügen" : "Heute gelesene Kapitel hinzufügen");
  const commitProgress = async () => {
    const amount = Number(addProgress.value);
    if (Number.isNaN(amount) || amount <= 0) {
      addProgress.value = "";
      return;
    }
    await withErrorToast(async () => {
      await logReadingSession({ bookId: book.id, unit, amountRead: amount, currentValue: currentValue + amount });
      addProgress.value = "";
      await reloadBooks();
    });
  };
  addProgress.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitProgress();
    }
  });
  addProgress.addEventListener("blur", commitProgress);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn icon-btn-danger";
  deleteBtn.textContent = "×";
  deleteBtn.setAttribute("aria-label", "Buch entfernen");
  deleteBtn.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteBook(book.id);
      await reloadBooks();
    });
    showToast(`„${book.title}" entfernt.`, false, {
      label: "Rückgängig",
      onClick: () =>
        withErrorToast(async () => {
          await createBook({
            title: book.title,
            author: book.author,
            totalPages: book.total_pages,
            progressUnit: book.progress_unit,
            totalChapters: book.total_chapters,
            status: book.status,
            genre: book.genre,
          });
          await reloadBooks();
        }),
    });
  });

  li.append(title, statusSelect, progressInput, meta, addProgress, deleteBtn);

  // Cover-Upload/-Anzeige nur fürs aktive Buch (siehe wissensdatenbank/features/lesen-als-bereich.md).
  // Cover-Blob liegt rein lokal in IndexedDB (kein DB-Feld) — gleiches Muster wie das Hintergrundbild.
  // Das eigentliche Bild wird nach dem Listen-Aufbau asynchron nachgeladen (loadActiveBookCovers).
  if (book.status === "aktiv") {
    const coverWrap = document.createElement("div");
    coverWrap.className = "book-cover-wrap";

    const coverBtn = document.createElement("button");
    coverBtn.type = "button";
    coverBtn.className = "book-cover book-cover-empty";
    coverBtn.dataset.bookId = book.id;
    coverBtn.setAttribute("aria-label", "Cover hochladen");
    coverBtn.innerHTML = `<span class="book-cover-placeholder">＋ Cover</span>`;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;

    coverBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      await withErrorToast(async () => {
        const blob = await resizeImageToBlob(file, 600);
        await saveBookCoverBlob(book.id, blob);
        await reloadBooks();
      });
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "book-cover-remove";
    removeBtn.textContent = "×";
    removeBtn.hidden = true;
    removeBtn.setAttribute("aria-label", "Cover entfernen");
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await withErrorToast(async () => {
        await clearBookCover(book.id);
        await reloadBooks();
      });
    });

    coverWrap.append(coverBtn, removeBtn, fileInput);
    li.prepend(coverWrap);
  }

  // Visueller Fortschrittsbalken (volle Breite unter der Zeile) — nur wenn ein Gesamtwert bekannt
  // ist, sonst gäbe es keinen sinnvollen Bezug. Style wiederverwendet aus der Wunschlisten-Leiste.
  if (totalValue && totalValue > 0) {
    const pct = Math.min(100, Math.round((currentValue / totalValue) * 100));
    const bar = document.createElement("div");
    bar.className = "wish-fund-bar book-progress-bar";
    const fill = document.createElement("div");
    fill.className = "wish-fund-fill";
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    li.appendChild(bar);
  }
  return li;
}

function wireBooksQuickAddForm() {
  const form = document.getElementById("new-book-form");
  const submitBtn = form.querySelector('button[type="submit"]');
  const unitSelect = document.getElementById("new-book-unit");
  const totalInput = document.getElementById("new-book-total");
  // Placeholder des Gesamt-Felds folgt der gewählten Einheit.
  const syncTotalPlaceholder = () => {
    totalInput.placeholder = unitSelect.value === "pages" ? "Seiten gesamt (optional)" : "Kapitel gesamt (optional)";
  };
  syncTotalPlaceholder();
  unitSelect.addEventListener("change", syncTotalPlaceholder);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("new-book-title");
    const authorInput = document.getElementById("new-book-author");
    const statusSelect = document.getElementById("new-book-status");
    const title = titleInput.value.trim();
    if (!title || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        const unit = unitSelect.value === "pages" ? "pages" : "chapters";
        const total = totalInput.value ? Number(totalInput.value) : null;
        await createBook({
          title,
          author: authorInput.value.trim() || null,
          progressUnit: unit,
          totalPages: unit === "pages" ? total : null,
          totalChapters: unit === "chapters" ? total : null,
          status: statusSelect.value,
        });
        showToast(`„${title}" angelegt.`);
        titleInput.value = "";
        authorInput.value = "";
        totalInput.value = "";
        unitSelect.value = "chapters";
        syncTotalPlaceholder();
        statusSelect.value = "geplant";
        await reloadBooks();
      });
    } finally {
      submitBtn.disabled = false;
    }
  });
}
