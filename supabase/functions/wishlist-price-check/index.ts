// Preisabfrage-Job für aktive Wunschlisten-Einträge (wissensdatenbank/wunschliste-sparplan.md,
// Abschnitt "Automatische Preisabfragen"). Wird per GitHub Actions Cron aufgerufen, nicht öffentlich
// nutzbar (Shared-Secret-Header statt Supabase-JWT, siehe supabase/config.toml: verify_jwt=false).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SHARED_SECRET");
const KEEPA_KEY = Deno.env.get("KEEPA_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

const HIGH_TIER_INTERVAL_DAYS = 10; // ~3x/Monat, ab 80% Spartopf-Deckung
const LOW_TIER_INTERVAL_DAYS = 30; // ~1x/Monat, sonst (Need/Invest und Enjoy gleich behandelt)
const HIGH_TIER_RATIO = 0.8;
// Burst-Schutz: verhindert, dass viele gleichzeitig neu aktivierte Items an einem Tag das
// SerpAPI-Monatsbudget (100/Monat, kostenloser Tier) verbrennen. Steady-State reißt das Budget bei
// einer "überschaubaren Wunschliste" nicht, das Risiko ist nur der Cold-Start.
const MAX_SERPAPI_CALLS_PER_RUN = 15;
const MAX_KEEPA_CALLS_PER_RUN = 30;

const KEEPA_DOMAIN_BY_HOST: Record<string, number> = {
  "amazon.de": 3,
  "amazon.com": 1,
  "amazon.co.uk": 2,
  "amazon.fr": 4,
};

interface WishlistItem {
  id: string;
  user_id: string;
  title: string;
  product_url: string;
  current_price: number | null;
  priority: number | null;
  category: string | null;
  last_price_check_at: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function amazonDomainFor(host: string): number | null {
  const match = Object.keys(KEEPA_DOMAIN_BY_HOST).find((h) => host.endsWith(h));
  return match ? KEEPA_DOMAIN_BY_HOST[match] : null;
}

function extractAsin(url: string): string | null {
  const pathMatch = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  if (pathMatch) return pathMatch[1].toUpperCase();
  try {
    const qp = new URL(url).searchParams.get("asin");
    return qp ? qp.toUpperCase() : null;
  } catch {
    return null;
  }
}

// Preistyp-Indizes in Prioritätsreihenfolge: Buy Box (18) > New (1) > Amazon (0). -1/leer = kein
// Preis verfügbar, wird übersprungen. Keepa liefert Preise in Cent.
async function fetchKeepaPrice(asin: string, domain: number): Promise<number | null> {
  const res = await fetch(
    `https://api.keepa.com/product?key=${KEEPA_KEY}&domain=${domain}&asin=${asin}&stats=1`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const csv = data?.products?.[0]?.csv;
  if (!csv) return null;
  for (const idx of [18, 1, 0]) {
    const series = csv[idx];
    if (!Array.isArray(series) || series.length < 2) continue;
    const cents = series[series.length - 1];
    if (typeof cents === "number" && cents > 0) return cents / 100;
  }
  return null;
}

// Günstigster Treffer statt erster Treffer — SerpAPI sortiert Google-Shopping-Ergebnisse nicht
// garantiert nach Preis.
async function fetchSerpApiPrice(title: string): Promise<number | null> {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(
    title
  )}&gl=de&hl=de&api_key=${SERPAPI_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const results = data?.shopping_results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const prices = results
    .map((r: { extracted_price?: number }) => r.extracted_price)
    .filter((p: unknown): p is number => typeof p === "number" && p > 0);
  return prices.length ? Math.min(...prices) : null;
}

type Tier = "bootstrap" | "high" | "low";

function classify(item: WishlistItem, potBalance: number, now: number): { isDue: boolean; tier: Tier } {
  if (item.current_price == null || item.last_price_check_at == null) {
    return { isDue: true, tier: "bootstrap" };
  }
  const ratio = potBalance / item.current_price;
  const tier: Tier = ratio >= HIGH_TIER_RATIO ? "high" : "low";
  const intervalDays = tier === "high" ? HIGH_TIER_INTERVAL_DAYS : LOW_TIER_INTERVAL_DAYS;
  const daysSince = (now - new Date(item.last_price_check_at).getTime()) / 86_400_000;
  return { isDue: daysSince >= intervalDays, tier };
}

const TIER_RANK: Record<Tier, number> = { bootstrap: 0, high: 1, low: 2 };

function sortByPriority(
  a: { item: WishlistItem; tier: Tier },
  b: { item: WishlistItem; tier: Tier }
): number {
  if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
  const prioA = a.item.priority ?? 3;
  const prioB = b.item.priority ?? 3;
  if (prioA !== prioB) return prioA - prioB;
  const timeA = a.item.last_price_check_at ? new Date(a.item.last_price_check_at).getTime() : 0;
  const timeB = b.item.last_price_check_at ? new Date(b.item.last_price_check_at).getTime() : 0;
  return timeA - timeB;
}

function groupSum(rows: { user_id: string; amount: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.user_id] = (out[row.user_id] ?? 0) + Number(row.amount);
  return out;
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!KEEPA_KEY && !SERPAPI_KEY) {
    return json({ skipped: "no api keys configured yet" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: items, error: itemsError } = await supabase
    .from("wishlist_items")
    .select("id, user_id, title, product_url, current_price, priority, category, last_price_check_at")
    .eq("status", "active")
    .not("product_url", "is", null);
  if (itemsError) return json({ error: itemsError.message }, 500);
  if (!items || items.length === 0) return json({ checked: 0, updated: 0 });

  const userIds = [...new Set(items.map((i: WishlistItem) => i.user_id))];
  const { data: potEntries, error: potError } = await supabase
    .from("savings_pot_entries")
    .select("user_id, amount")
    .in("user_id", userIds);
  if (potError) return json({ error: potError.message }, 500);
  const potBalanceByUser = groupSum(potEntries ?? []);

  const now = Date.now();
  const due = items
    .map((item: WishlistItem) => ({ item, ...classify(item, potBalanceByUser[item.user_id] ?? 0, now) }))
    .filter((x) => x.isDue)
    .sort(sortByPriority);

  let keepaCalls = 0;
  let serpapiCalls = 0;
  const updated: unknown[] = [];
  const skipped: unknown[] = [];
  const errors: unknown[] = [];

  for (const { item, tier } of due) {
    const host = safeHostname(item.product_url);
    const amazonDomain = host ? amazonDomainFor(host) : null;

    try {
      let newPrice: number | null = null;

      // Keepa ist optional: nur nutzen wenn Key vorhanden, Item eine Amazon-URL mit erkennbarer
      // ASIN hat und das Keepa-Run-Budget nicht ausgeschöpft ist. Sonst fällt JEDES Item — auch
      // Amazon-Artikel — auf die SerpAPI-Titelsuche zurück, statt übersprungen zu werden. Weniger
      // präzise als die exakte ASIN-Preishistorie von Keepa (Titel-Fuzzy-Match statt Artikel-genau),
      // aber ein alleiniger SerpAPI-Key reicht damit für volle Abdeckung.
      const asin = amazonDomain ? extractAsin(item.product_url) : null;
      const useKeepa = Boolean(amazonDomain && KEEPA_KEY && asin && keepaCalls < MAX_KEEPA_CALLS_PER_RUN);

      if (useKeepa) {
        keepaCalls++;
        newPrice = await fetchKeepaPrice(asin!, amazonDomain!);
      } else if (SERPAPI_KEY && serpapiCalls < MAX_SERPAPI_CALLS_PER_RUN) {
        serpapiCalls++;
        newPrice = await fetchSerpApiPrice(item.title);
      } else {
        skipped.push({
          id: item.id,
          reason: amazonDomain ? "keepa_and_serpapi_unavailable" : "serpapi_budget_or_key",
        });
        continue;
      }

      // last_price_check_at wird auch ohne Treffer aktualisiert, sonst würde ein unparsbares Item
      // (kaputter Link, kein Suchtreffer) bei jedem Lauf erneut Budget verbrennen.
      const patch: Record<string, unknown> = { last_price_check_at: new Date().toISOString() };
      if (newPrice != null && newPrice > 0) patch.current_price = newPrice;

      const { error: updateError } = await supabase.from("wishlist_items").update(patch).eq("id", item.id);
      if (updateError) {
        errors.push({ id: item.id, message: updateError.message });
      } else {
        updated.push({ id: item.id, tier, price: newPrice });
      }
    } catch (e) {
      errors.push({ id: item.id, message: String(e) });
    }
  }

  return json({
    checkedCandidates: due.length,
    updated: updated.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { updated, skipped, errors },
  });
});
