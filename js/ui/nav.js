// Zähler-Badge am "Heute"-Link der Navigation.
import { state } from "./state.js";

export function updateNavBadge(count) {
  state.todayRemainingCount = count;
  const badge = document.getElementById("nav-today-count");
  if (!badge) return;
  badge.hidden = count <= 0;
  badge.textContent = String(count);
}
