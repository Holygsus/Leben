// Datums-Helfer (lokale ISO-Daten, Monatsraster, Kurzformat).
export function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

// Montag der laufenden Woche als YYYY-MM-DD (lokal). Basis für "diese Woche"-Vergleiche gegen den
// Datumsanteil von updated_at (der tasks_updated_at-Trigger hält updated_at bei jeder Änderung
// aktuell, für erledigte Aufgaben also ~ Erledigungszeitpunkt).
export function weekStartISO() {
  const d = new Date();
  const mondayOffset = (d.getDay() + 6) % 7; // Sonntag(0) -> 6, Montag(1) -> 0, ...
  d.setDate(d.getDate() - mondayOffset);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function isoDatePlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function isoFromLocalDate(d) {
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

// Baut das Zellenraster für einen Kalendermonat (Montag als erster Wochentag), inkl. Padding-Tagen
// aus dem Vor-/Folgemonat, damit das Grid immer aus vollen 7er-Reihen besteht (5 oder 6 Wochen).
export function buildMonthGrid(monthIso) {
  const [y, m] = monthIso.split("-").map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Montag = 0 ... Sonntag = 6
  const daysInMonth = new Date(y, m, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(y, m - 1, 1 - firstWeekday + i);
    cells.push({ iso: isoFromLocalDate(date), inMonth: date.getMonth() === m - 1 });
  }
  return cells;
}

export function shiftMonth(monthIso, delta) {
  const [y, m] = monthIso.split("-").map(Number);
  return isoFromLocalDate(new Date(y, m - 1 + delta, 1));
}

// Verschiebt ein konkretes ISO-Datum (YYYY-MM-DD) um delta Tage — anders als isoDatePlusDays,
// das immer von heute aus rechnet.
export function shiftIsoDay(dateIso, delta) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return isoFromLocalDate(new Date(y, m - 1, d + delta));
}

// Ganze Tage von fromIso bis toIso (toIso - fromIso); negativ, wenn toIso in der Vergangenheit liegt.
// Über lokale Mitternacht gerechnet, damit Sommerzeit-Sprünge das Ergebnis nicht verschieben.
export function isoDayDiff(fromIso, toIso) {
  if (typeof fromIso !== "string" || typeof toIso !== "string") return null;
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  if ([fy, fm, fd, ty, tm, td].some(Number.isNaN)) return null;
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

// [ersterIso, letzterIso] aller sichtbaren Grid-Zellen (inkl. Padding-Tage aus Nachbarmonaten) —
// so ist die Auslastungs-Färbung (data-load) auch für ausgegraute Tage korrekt.
export function monthRange(monthIso) {
  const cells = buildMonthGrid(monthIso);
  return [cells[0].iso, cells[cells.length - 1].iso];
}

export function formatShortDate(isoDate) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d}.${m}`;
}
