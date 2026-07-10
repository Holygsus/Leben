// Cached nur die statische App-Hülle (HTML/CSS/JS) für schnelleres Laden/Offline-Start.
// Supabase- und CDN-Requests (anderer Origin) werden bewusst NICHT abgefangen — Daten sollen
// immer frisch vom Netzwerk kommen, nur das Grundgerüst der App wird lokal vorgehalten.
const CACHE_NAME = "leben-os-shell-v1";

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
  "js/supabase.js",
  "views/today.html",
  "views/overview.html",
  "views/plan.html",
  "views/areas.html",
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
