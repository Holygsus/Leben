// Datums-Chip-Gruppe (Heute/Morgen/… + freies Datum) für Formulare.
import { todayISO, tomorrowISO } from "./dates.js";

// Baut eine neue Datum-Chip-Gruppe (Heute/Morgen/Kein Datum/eigenes Datum) für dynamisch erzeugte
// Formulare.
export function createDateChipGroup() {
  const el = document.createElement("div");
  el.className = "date-chips";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Datum");
  el.innerHTML = `
    <button type="button" class="date-chip" data-date="today">Heute</button>
    <button type="button" class="date-chip" data-date="tomorrow">Morgen</button>
    <button type="button" class="date-chip" data-date="" data-active="true">Kein Datum</button>
    <button type="button" class="date-chip" data-date="custom">Datum…</button>
    <input type="date" class="input date-chip-custom-input" aria-label="Eigenes Datum" hidden />`;
  return wireDateChipGroup(el);
}

// Verdrahtet eine (bereits im DOM vorhandene oder von createDateChipGroup gebaute) .date-chips-
// Gruppe: Klick auf einen Chip macht ihn zum einzigen aktiven. Der "Datum…"-Chip blendet stattdessen
// ein natives Datums-Input ein. getPlannedDate() liest den aktiven Chip (bzw. das Datums-Input) aus,
// reset() setzt auf "Kein Datum" zurück.
export function wireDateChipGroup(container) {
  const chips = Array.from(container.querySelectorAll(".date-chip"));
  const noDateChip = chips.find((c) => c.dataset.date === "") || chips[chips.length - 1];
  const customChip = chips.find((c) => c.dataset.date === "custom");
  const customInput = container.querySelector(".date-chip-custom-input");

  const setActive = (chip) => {
    for (const c of chips) c.removeAttribute("data-active");
    chip.setAttribute("data-active", "true");
  };

  for (const chip of chips) {
    chip.addEventListener("click", () => {
      if (chip === customChip) {
        setActive(chip);
        if (customInput) {
          customInput.hidden = false;
          customInput.focus();
          if (customInput.showPicker) customInput.showPicker();
        }
        return;
      }
      if (customInput) customInput.hidden = true;
      setActive(chip);
    });
  }

  if (customInput) {
    customInput.addEventListener("change", () => {
      if (customInput.value) setActive(customChip);
    });
  }

  return {
    el: container,
    getPlannedDate() {
      const activeChip = chips.find((c) => c.dataset.active === "true") || noDateChip;
      if (activeChip.dataset.date === "today") return todayISO();
      if (activeChip.dataset.date === "tomorrow") return tomorrowISO();
      if (activeChip === customChip) return customInput?.value || null;
      return null;
    },
    reset() {
      setActive(noDateChip);
      if (customInput) {
        customInput.hidden = true;
        customInput.value = "";
      }
    },
    // Stellt eine bereits vorhandene Aufgabe im Chip-System dar (z.B. beim Öffnen des
    // Detail-Modals) — bildet ein bestehendes planned_date auf Heute/Morgen/eigenes Datum ab.
    setValue(isoDate) {
      if (!isoDate) {
        this.reset();
        return;
      }
      if (isoDate === todayISO()) {
        if (customInput) customInput.hidden = true;
        setActive(chips.find((c) => c.dataset.date === "today"));
        return;
      }
      if (isoDate === tomorrowISO()) {
        if (customInput) customInput.hidden = true;
        setActive(chips.find((c) => c.dataset.date === "tomorrow"));
        return;
      }
      setActive(customChip);
      if (customInput) {
        customInput.hidden = false;
        customInput.value = isoDate;
      }
    },
  };
}
