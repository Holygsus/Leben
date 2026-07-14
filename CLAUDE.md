# Leben OS

Persönliches Life-Dashboard. Vanilla JS/HTML/CSS, kein Framework. Supabase (Postgres + Auth) als
Backend, Deploy auf GitHub Pages (`https://holygsus.github.io/Leben/`). Repo:
github.com/Holygsus/Leben, eingebettet in den größeren Workspace — siehe
[../CLAUDE.md](../CLAUDE.md) für Wissensdatenbank-Konventionen und Skills.

## Architektur

- Ein JS-Modul pro Domäne: `js/tasks.js`, `js/finance.js`, `js/wishlist.js`, `js/planner.js`,
  `js/auth.js`, `js/areas.js`, `js/supabase.js`, `js/app.js` (Orchestrierung/Views). Neue Features
  folgen diesem Muster statt alles in `app.js` zu häufen.
- `config.js` enthält den `SUPABASE_URL` sowie den `anon`/`publishable` Key und ist **bewusst
  eingecheckt** (Commit `8971fc7`) — GitHub Pages ist reines Static Hosting, der Key muss also
  ohnehin im ausgelieferten JS landen. Der Schutz läuft über RLS-Policies in der DB, nicht über
  Geheimhaltung dieser Datei. **Update 2026-07-14, Bug-Scan:** ein service_role- oder sonstiger
  echter Secret-Key gehört trotzdem niemals hierhin oder ins Repo — nur anon/publishable sind für
  den Client bestimmt.
- Views liegen als eigene HTML-Dateien unter `views/` (`overview.html`, `today.html`, `plan.html`,
  `finance.html`), gerendert über `render*View()`-Funktionen in `js/app.js`.

## Datenbank-Workflow

- Schema-Änderungen ausschließlich als neue, nummerierte `supabase/migration-XXX.sql` — danach
  `supabase/schema.sql` (Referenz für Neuinstallationen) manuell nachziehen.
- DDL läuft nur über den Supabase SQL Editor / Service-Role, **nicht** mit dem anon key aus
  `config.js` möglich.
- Vor Weiterarbeit an einem Modul immer erst prüfen, ob die zugehörige Migration wirklich im
  Supabase-Dashboard ausgeführt wurde (nicht nur ob die `.sql`-Datei im Repo existiert) — Code-Stand
  und DB-Stand können auseinanderlaufen.

## Service Worker (`sw.js`)

Cached Views explizit über eine feste `SHELL_ASSETS`-Liste. Bei neuen oder gelöschten View-Dateien
**beides** anpassen: die Liste UND `CACHE_NAME` (Versionsbump) — sonst schlägt `cache.addAll()` fehl
oder Nutzer bekommen die Änderung nie zu sehen.

Für Preview-/Browser-Tests: ein bereits registrierter Service Worker aus einer früheren Session
liefert per stale-while-revalidate erst die ALTE gecachte Version aus, auch nach mehrfachem Reload.
Fix: `navigator.serviceWorker.getRegistrations()` unregistrieren + `caches.delete(...)` per
JS-Ausführung im Preview, oder mit Cache-Bust-Query (`?v=...`) navigieren und neu laden.

## Lokal testen

```
python -m http.server 8080 --directory Leben
```
(launch.json-Name `leben-static`, liegt in `../.claude/launch.json`)

## Magic-Link-Login im Preview testen

Die Preview-Sandbox blockt echte Cross-Origin-Navigation zur Supabase-verify-URL, und Mails sind
oft nur mobil abrufbar. Ablauf:

1. Link in der Mail **lang drücken → "Link kopieren"** (nicht antippen, sonst ist der
   Einmal-Token verbraucht).
2. Rohen Link im Chat einfügen, `token`-Wert extrahieren.
3. Im Preview per JS verifizieren (normale Netzwerkanfrage statt Navigation, umgeht die Sandbox):
   ```js
   const { supabase } = await import("./js/supabase.js");
   await supabase.auth.verifyOtp({ token_hash: "<TOKEN>", type: "signup" }); // oder "magiclink"
   ```

Supabase Standard-Mailer hat ein knappes Rate-Limit ("email rate limit exceeded" nach wenigen
Mails/Stunde) — im Dashboard unter Auth → Rate Limits hochsetzen oder 15–60 Min warten.

## Vor einem echten Deploy

Supabase Auth → URL Configuration: Redirect-URL von `localhost:8080` auf die finale Pages-URL
(`https://holygsus.github.io/Leben/`) umstellen, sonst funktioniert der Magic Link live nicht.
