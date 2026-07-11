import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

// Zählt laufende Supabase-Requests global mit und speist damit den systemweiten Ladebalken
// (#global-loading-bar in index.html) — so muss keine einzelne Aufrufstelle in tasks.js/areas.js/
// finance.js/wishlist.js/planner.js angefasst werden, jeder Request läuft ohnehin über diesen
// fetch.
let inFlightCount = 0;
let showTimeout = null;
let hideTimeout = null;

function setLoadingBarVisible(visible) {
  document.getElementById("global-loading-bar")?.classList.toggle("is-visible", visible);
}

function trackedFetch(...args) {
  inFlightCount++;
  clearTimeout(hideTimeout);
  // Erst nach kurzer Verzögerung einblenden — vermeidet Flackern bei sehr schnellen Requests.
  if (inFlightCount === 1 && !showTimeout) {
    showTimeout = setTimeout(() => {
      showTimeout = null;
      if (inFlightCount > 0) setLoadingBarVisible(true);
    }, 150);
  }
  return fetch(...args).finally(() => {
    inFlightCount--;
    if (inFlightCount === 0) {
      clearTimeout(showTimeout);
      showTimeout = null;
      // Mindest-Anzeigezeit, bevor er wieder verschwindet — sonst würde er bei kurz aufeinander
      // folgenden Requests unruhig auf-/abblenden.
      hideTimeout = setTimeout(() => setLoadingBarVisible(false), 300);
    }
  });
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: trackedFetch },
});
