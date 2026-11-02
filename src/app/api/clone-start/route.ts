import { NextResponse, type NextRequest } from "next/server";
import { getUpstream, isBlockedHost } from "@/lib/clone/upstream";
import { englishAlternate } from "@/lib/clone/locale";
import { cachedUpstream, cacheKey, DATA_TTL, PAGE_TTL } from "@/lib/clone/cache";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET /api/clone-start?host=<domain> — where the storefront preview should open:
// one of the store's product pages, so the demo goes straight to add-to-cart and
// checkout. Multi-market stores keep a different catalog per site (doonails.com's
// German outlet items aren't sold on us.doonails.com), so the product is picked
// from the store's English site when it has one.

type ShopifyProduct = {
  handle: string;
  title?: string;
  product_type?: string;
  tags?: string[];
  images?: unknown[];
  variants?: { available?: boolean; price?: string }[];
};

// Products whose page isn't a plain "Add to cart": bundle builders ("choose your
// 6 designs"), gift cards, subscriptions, members-only drops.
const NOT_A_SIMPLE_PRODUCT =
  /\b(bundles?|sets?|kits?|builder|outlet|samples?|gift ?cards?|e-?gift|subscriptions?|memberships?|club|members? only|exclusive|mystery|free gift|warranty|insurance|shipping protection)\b/i;

const isSimple = (p: ShopifyProduct) =>
  ![p.handle, p.title, p.product_type, ...(p.tags ?? [])].some((s) => s && NOT_A_SIMPLE_PRODUCT.test(s.replace(/[-_]/g, " ")));

const isBuyable = (p: ShopifyProduct) =>
  !!p.images?.length && !!p.variants?.some((v) => v.available !== false && Number(v.price) > 0);
type Start = { host: string; path: string | null };

// lookups by host, held as promises so a warm-up and the real request share one
const starts = new Map<string, { at: number; data: Promise<Start> }>();
const TTL = 10 * 60 * 1000;

/**
 * A product to open on, as a path: the first simple one that's in stock with a
 * photo, else any in stock with a photo, else the first. Null without a readable
 * Shopify catalog.
 */
async function productPath(site: string): Promise<string | null> {
  const up = await catalog(site);
  if (!up || up.status >= 400) return null;
  try {
    const { products } = JSON.parse(up.body.toString("utf8")) as { products?: ShopifyProduct[] };
    const pick =
      products?.find((p) => isBuyable(p) && isSimple(p)) ?? products?.find(isBuyable) ?? products?.[0];
    return pick ? `/products/${encodeURIComponent(pick.handle)}` : null;
  } catch {
    return null; // a password page or a non-Shopify site
  }
}

const catalogUrl = (site: string) => `https://${site}/products.json?limit=30`;
const catalog = (site: string) =>
  cachedUpstream(cacheKey("data", catalogUrl(site)), DATA_TTL, () =>
    getUpstream(catalogUrl(site), { accept: "application/json", page: false })
  );

async function findStart(host: string): Promise<Start> {
  // The homepage (for an English site) and this host's catalog are fetched side by
  // side; the catalog is the right one unless the homepage points to another site.
  // page: false — no slow headless fallback here; blocked stores just open as they are.
  const homeUrl = `https://${host}/`;
  const [home] = await Promise.all([
    cachedUpstream(cacheKey("page", homeUrl), PAGE_TTL, () =>
      getUpstream(homeUrl, { accept: "text/html,application/xhtml+xml", page: false })
    ),
    catalog(host),
  ]);
  let site = host;
  if (home && home.status < 400 && /text\/html/i.test(home.contentType)) {
    site = new URL(englishAlternate(home.body.toString("utf8"), home.finalUrl) ?? home.finalUrl).hostname;
  }
  const path = await productPath(site);

  // Fetch the page the preview is about to open now, without waiting: by the
  // time the frame asks the proxy for it, it's cached or already on its way.
  if (path) {
    const pageUrl = `https://${site}${path}`;
    void cachedUpstream(cacheKey("page", pageUrl), PAGE_TTL, () =>
      getUpstream(pageUrl, { accept: "text/html,application/xhtml+xml", page: true })
    );
  }
  return { host: site, path };
}

// GET ?host=…&warm=1 is the same lookup, fired by the URL field while it's being
// typed, so most of this work is done by the time the preview opens.
export async function GET(req: NextRequest) {
  const host = (req.nextUrl.searchParams.get("host") || "").trim().toLowerCase();
  if (!host || isBlockedHost(host)) return NextResponse.json({ error: "Invalid store" }, { status: 400 });

  let hit = starts.get(host);
  if (!hit || Date.now() - hit.at >= TTL) {
    hit = { at: Date.now(), data: findStart(host) };
    if (starts.size >= 200) starts.delete(starts.keys().next().value!);
    starts.set(host, hit);
  }
  return NextResponse.json(await hit.data);
}
