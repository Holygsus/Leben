// Ansicht "Reise" (#/reise).
import {
  listTrips,
  createTrip,
  updateTrip,
  deleteTrip,
  listTripItems,
  createTripItem,
  updateTripItem,
  deleteTripItem,
} from "../trips.js";
import { escapeHtml, buildEmptyState } from "../ui/dom.js";
import { showToast, withErrorToast } from "../ui/modals.js";
import { state } from "../ui/state.js";

/* ---------- Reiseplanung ---------- */
// wissensdatenbank/features/reiseplanung.md — Pool→Tage-Modell, eigenes Datenmodell (trips/trip_items).
// Pool = trip_items ohne day_number; Tageszuweisung per Dropdown setzt day_number + status.

const reiseState = { trips: [], items: [], selectedTripId: null };
const TIME_SLOT_LABELS = { vormittag: "Vormittag", nachmittag: "Nachmittag", abend: "Abend" };
const TIME_SLOT_ORDER = { vormittag: 0, nachmittag: 1, abend: 2 };

export async function renderReiseView() {
  const myGeneration = state.renderGeneration;
  const container = document.getElementById("view-content");
  const res = await fetch("views/reise.html");
  if (myGeneration !== state.renderGeneration) return;
  container.innerHTML = await res.text();

  reiseState.trips = await listTrips();
  if (myGeneration !== state.renderGeneration) return;

  // Auswahl-Default: bestehende Auswahl behalten, sonst erste aktive, sonst erste Reise.
  if (!reiseState.trips.some((t) => t.id === reiseState.selectedTripId)) {
    const active = reiseState.trips.find((t) => t.status === "aktiv");
    reiseState.selectedTripId = active?.id ?? reiseState.trips[0]?.id ?? null;
  }

  renderReiseTripPicker();
  wireReiseNewTripForm();
  wireReisePoolAddForm();
  await reloadReiseItems();
}

function renderReiseTripPicker() {
  const select = document.getElementById("reise-trip-select");
  select.innerHTML = reiseState.trips
    .map(
      (t) =>
        `<option value="${t.id}"${t.id === reiseState.selectedTripId ? " selected" : ""}>${escapeHtml(t.title)}${t.destination ? " · " + escapeHtml(t.destination) : ""}</option>`
    )
    .join("");
  select.hidden = reiseState.trips.length === 0;
  select.onchange = async () => {
    reiseState.selectedTripId = select.value;
    await reloadReiseItems();
  };
}

async function reloadReiseItems() {
  const content = document.getElementById("reise-content");
  const empty = document.getElementById("reise-empty");
  if (!reiseState.selectedTripId) {
    content.hidden = true;
    empty.hidden = false;
    empty.innerHTML = "";
    empty.appendChild(buildEmptyState("Noch keine Reise", "Leg oben deine erste Reise an."));
    return;
  }
  empty.hidden = true;
  content.hidden = false;
  reiseState.items = await listTripItems(reiseState.selectedTripId);
  renderReiseBody();
}

// Anzahl der Tage: aus der Datumsspanne (falls gesetzt), sonst höchster genutzter day_number, min. 1.
function reiseDayCount() {
  const trip = reiseState.trips.find((t) => t.id === reiseState.selectedTripId);
  let rangeDays = 0;
  if (trip?.date_from && trip?.date_to) {
    const from = new Date(trip.date_from + "T00:00:00");
    const to = new Date(trip.date_to + "T00:00:00");
    rangeDays = Math.floor((to - from) / 86400000) + 1;
  }
  const maxUsed = reiseState.items.reduce((m, i) => Math.max(m, i.day_number || 0), 0);
  return Math.max(rangeDays, maxUsed, 1);
}

function renderReiseBody() {
  const dayCount = reiseDayCount();

  const poolList = document.getElementById("reise-pool-list");
  poolList.innerHTML = "";
  const pool = reiseState.items.filter((i) => i.day_number == null);
  if (pool.length === 0) {
    poolList.appendChild(buildEmptyState("Pool ist leer", "Erfasse oben Attraktionen für diese Reise."));
  } else {
    pool.forEach((item) => poolList.appendChild(buildTripItemRow(item, dayCount)));
  }

  const daysWrap = document.getElementById("reise-days");
  daysWrap.innerHTML = "";
  for (let day = 1; day <= dayCount; day++) {
    const dayItems = reiseState.items
      .filter((i) => i.day_number === day)
      .sort((a, b) => (TIME_SLOT_ORDER[a.time_slot] ?? 3) - (TIME_SLOT_ORDER[b.time_slot] ?? 3));
    const section = document.createElement("div");
    section.className = "reise-day";
    const head = document.createElement("h3");
    head.className = "reise-day-head";
    head.textContent = `Tag ${day}${dayItems.length ? ` · ${dayItems.length}` : ""}`;
    section.appendChild(head);
    const ul = document.createElement("ul");
    ul.className = "task-list";
    if (dayItems.length === 0) {
      const li = document.createElement("li");
      li.className = "reise-day-empty";
      li.textContent = "—";
      ul.appendChild(li);
    } else {
      dayItems.forEach((item) => ul.appendChild(buildTripItemRow(item, dayCount)));
    }
    section.appendChild(ul);
    daysWrap.appendChild(section);
  }
}

function buildTripItemRow(item, dayCount) {
  const li = document.createElement("li");
  li.className = "task-item tx-item reise-item" + (item.status === "erledigt" ? " reise-item-done" : "");

  const check = document.createElement("button");
  check.type = "button";
  check.className = "task-checkbox";
  check.dataset.checked = String(item.status === "erledigt");
  check.setAttribute("aria-pressed", String(item.status === "erledigt"));
  check.setAttribute("aria-label", "Erledigt");
  check.textContent = item.status === "erledigt" ? "✓" : "";
  check.addEventListener("click", async () => {
    const newStatus = item.status === "erledigt" ? (item.day_number ? "eingeplant" : "kandidat") : "erledigt";
    await withErrorToast(async () => {
      await updateTripItem(item.id, { status: newStatus });
      await reloadReiseItems();
    });
  });

  const title = document.createElement("input");
  title.type = "text";
  title.className = "input area-name-input";
  title.value = item.title;
  title.setAttribute("aria-label", "Titel");
  title.addEventListener("blur", async () => {
    const value = title.value.trim();
    if (!value || value === item.title) {
      title.value = item.title;
      return;
    }
    await withErrorToast(async () => {
      await updateTripItem(item.id, { title: value });
      await reloadReiseItems();
    });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  // Tag-Zuweisung: „—/Pool" (kandidat) oder Tag N (eingeplant). Eine Reserve (dayCount+1) erlaubt das
  // Verlängern der Reise ohne separates „Tag hinzufügen".
  const daySelect = document.createElement("select");
  daySelect.className = "select";
  daySelect.setAttribute("aria-label", "Tag");
  let dayOpts = `<option value="">Pool</option>`;
  for (let d = 1; d <= dayCount + 1; d++) {
    dayOpts += `<option value="${d}"${item.day_number === d ? " selected" : ""}>Tag ${d}</option>`;
  }
  daySelect.innerHTML = dayOpts;
  daySelect.addEventListener("change", async () => {
    const day = daySelect.value ? Number(daySelect.value) : null;
    const keepDone = item.status === "erledigt";
    const updates =
      day == null
        ? { day_number: null, status: keepDone ? "erledigt" : "kandidat" }
        : { day_number: day, status: keepDone ? "erledigt" : "eingeplant" };
    await withErrorToast(async () => {
      await updateTripItem(item.id, updates);
      await reloadReiseItems();
    });
  });

  const slotSelect = document.createElement("select");
  slotSelect.className = "select";
  slotSelect.setAttribute("aria-label", "Tageszeit");
  slotSelect.innerHTML =
    `<option value="">—</option>` +
    Object.entries(TIME_SLOT_LABELS)
      .map(([v, l]) => `<option value="${v}"${item.time_slot === v ? " selected" : ""}>${l}</option>`)
      .join("");
  slotSelect.addEventListener("change", async () => {
    await withErrorToast(async () => {
      await updateTripItem(item.id, { time_slot: slotSelect.value || null });
      await reloadReiseItems();
    });
  });

  const category = document.createElement("input");
  category.type = "text";
  category.className = "input";
  category.style.maxWidth = "120px";
  category.value = item.category ?? "";
  category.placeholder = "Kategorie";
  category.setAttribute("aria-label", "Kategorie");
  category.addEventListener("blur", async () => {
    const value = category.value.trim() || null;
    if (value === (item.category ?? null)) return;
    await withErrorToast(async () => {
      await updateTripItem(item.id, { category: value });
      await reloadReiseItems();
    });
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon-btn icon-btn-danger";
  del.textContent = "×";
  del.setAttribute("aria-label", "Entfernen");
  del.addEventListener("click", async () => {
    await withErrorToast(async () => {
      await deleteTripItem(item.id);
      await reloadReiseItems();
    });
  });

  li.append(check, title, daySelect, slotSelect, category, del);
  return li;
}

function wireReiseNewTripForm() {
  const toggle = document.getElementById("reise-new-trip-toggle");
  const form = document.getElementById("reise-new-trip-form");
  toggle.onclick = () => {
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById("reise-new-trip-title").focus();
  };
  const submitBtn = form.querySelector('button[type="submit"]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("reise-new-trip-title");
    const title = titleInput.value.trim();
    if (!title || submitBtn.disabled) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        const trip = await createTrip({
          title,
          destination: document.getElementById("reise-new-trip-destination").value.trim() || null,
          dateFrom: document.getElementById("reise-new-trip-from").value || null,
          dateTo: document.getElementById("reise-new-trip-to").value || null,
        });
        reiseState.trips.push(trip);
        reiseState.selectedTripId = trip.id;
        form.reset();
        form.hidden = true;
        showToast(`Reise „${title}" angelegt.`);
        renderReiseTripPicker();
        await reloadReiseItems();
      });
    } finally {
      submitBtn.disabled = false;
    }
  };
}

function wireReisePoolAddForm() {
  const form = document.getElementById("reise-pool-add-form");
  const input = document.getElementById("reise-pool-add-title");
  const submitBtn = form.querySelector('button[type="submit"]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title || submitBtn.disabled || !reiseState.selectedTripId) return;
    submitBtn.disabled = true;
    try {
      await withErrorToast(async () => {
        await createTripItem({ tripId: reiseState.selectedTripId, title, status: "kandidat" });
        input.value = "";
        input.focus();
        await reloadReiseItems();
      });
    } finally {
      submitBtn.disabled = false;
    }
  };
}
