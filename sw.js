// Cached nur die statische App-Hülle (HTML/CSS/JS) für schnelleres Laden/Offline-Start.
// Supabase- und CDN-Requests (anderer Origin) werden bewusst NICHT abgefangen — Daten sollen
// immer frisch vom Netzwerk kommen, nur das Grundgerüst der App wird lokal vorgehalten.
const CACHE_NAME = "leben-os-shell-v13";

const SHELL_ASSETS = [
  "index.html",
  "manifest.json",
  "favicon.svg",
  "css/reset.css",
  "css/variables.css",
  "css/main.css",
  "js/app.js",
  "js/auth.js",
  "js/areas.js",
  "js/tasks.js",
  "js/planner.js",
  "js/habits.js",
  "js/finance.js",
  "js/wishlist.js",
  "js/watchlist.js",
  "js/birthdays.js",
  "js/reflections.js",
  "js/personalization.js",
  "js/recipes.js",
  "js/supabase.js",
  "views/today.html",
  "views/overview.html",
  "views/plan.html",
  "views/habits.html",
  "views/finance.html",
  "views/fernsehprogramm.html",
  "views/rezepte.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Stale-while-revalidate statt reinem Cache-first: liefert sofort die gecachte Version (schnell,
// offline-fähig), holt aber im Hintergrund immer die aktuelle Version nach und aktualisiert den
// Cache fürs nächste Mal. Ohne das würde jede spätere Code-Änderung an CSS/JS für wiederkehrende
// Nutzer unsichtbar bleiben, bis jemand manuell CACHE_NAME hochzählt — bei einer Static-Site ohne
// Build-Schritt ein leicht vergessener Stolperstein.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
