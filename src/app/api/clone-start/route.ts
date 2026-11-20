import { NextResponse, type NextRequest } from "next/server";
import { getUpstream, isBlockedHost } from "@/lib/clone/upstream";
import { englishAlternate } from "@/lib/clone/locale";
import { cachedUpstream, cacheKey, DATA_TTL, PAGE_TTL } from "@/lib/clone/cache";
import { checkoutSnapshot } from "@/lib/clone/checkoutSnapshot";
import { pickHero } from "@/lib/upsell/engine";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET /api/clone-start?host=<domain> — where the storefront preview should open:
// one of the store's product pages, so the demo goes straight to add-to-cart and
// checkout. Multi-market stores keep a different catalog per site (doonails.com's
// German outlet items aren't sold on us.doonails.com), so the product is picked
// from the store's English site when it has one.

type ShopifyProduct = {
  id?: number;
  handle: string;
  title?: string;
  product_type?: string;
  tags?: string[] | string;
  vendor?: string;
  images?: { src?: string }[];
  variants?: { id?: number; title?: string; available?: boolean; price?: string }[];
};

// Products whose page isn't a plain "Add to cart": bundle builders ("choose your
// 6 designs"), gift cards, subscriptions, members-only drops.
const NOT_A_SIMPLE_PRODUCT =
  /\b(bundles?|sets?|kits?|builder|outlet|samples?|gift ?cards?|e-?gift|subscriptions?|memberships?|club|members? only|exclusive|mystery|free gift|warranty|insurance|shipping protection)\b/i;

const tagsOf = (p: ShopifyProduct) => (Array.isArray(p.tags) ? p.tags : (p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean));

const isSimple = (p: ShopifyProduct) =>
  ![p.handle, p.title, p.product_type, ...tagsOf(p)].some((s) => s && NOT_A_SIMPLE_PRODUCT.test(s.replace(/[-_]/g, " ")));

const isBuyable = (p: ShopifyProduct) =>
  !!p.images?.length && !!p.variants?.some((v) => v.available !== false && Number(v.price) > 0);
/** The product the preview opens checkout with, for the session cart. */
type StartLine = { id: string; title: string; variant: string; price: number; qty: number; image: string | null };
type Start = { host: string; path: string | null; line: StartLine | null };

// lookups by host, held as promises so a warm-up and the real request share one
const starts = new Map<string, { at: number; data: Promise<Start> }>();
const TTL = 10 * 60 * 1000;

/**
 * A product to open on, as a path: the upsell engine's pick (src/lib/upsell/engine.ts)
 * — a simple, in-stock product with a photo, priced mid-catalog, with room for
 * upsells under it — else the first simple one in stock, else the first. Null
 * without a readable Shopify catalog.
 */
async function productPick(site: string): Promise<{ path: string; line: StartLine } | null> {
  const up = await catalog(site);
  if (!up || up.status >= 400) return null;
  try {
    const { products } = JSON.parse(up.body.toString("utf8")) as { products?: ShopifyProduct[] };
    const all = products ?? [];
    const firstPrice = (p: ShopifyProduct) => Number(p.variants?.find((v) => v.available !== false && Number(v.price) > 0)?.price) || 0;
    const hero = pickHero(
      all.map((p, i) => ({
        id: String(i),
        title: p.title ?? p.handle,
        handle: p.handle,
        price: firstPrice(p),
        hasImage: !!p.images?.length,
        available: isBuyable(p),
        type: p.product_type,
        tags: tagsOf(p),
        vendor: p.vendor,
      }))
    );
    const pick =
      (hero && isBuyable(all[+hero.id]) && isSimple(all[+hero.id]) ? all[+hero.id] : null) ??
      all.find((p) => isBuyable(p) && isSimple(p)) ?? all.find(isBuyable) ?? all[0];
    if (!pick) return null;
    const v = pick.variants?.find((x) => x.available !== false && Number(x.price) > 0) ?? pick.variants?.[0];
    return {
      path: `/products/${encodeURIComponent(pick.handle)}`,
      line: {
        id: String(v?.id ?? pick.id ?? pick.handle),
        title: pick.title ?? pick.handle,
        variant: v?.title && v.title !== "Default Title" ? v.title : "",
        price: Number(v?.price) || 0,
        qty: 1,
        image: pick.images?.[0]?.src ?? null,
      },
    };
  } catch {
    return null; // a password page or a non-Shopify site
  }
}

const catalogUrl = (site: string) => `https://${site}/products.json?limit=100`;
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
  const pick = await productPick(site);

  // Start capturing the store's real checkout with that product now, without
  // waiting: by the time the preview asks for it, it's cached or on its way.
  void checkoutSnapshot(site, pick ? decodeURIComponent(pick.path.slice("/products/".length)) : null);
  return { host: site, path: pick?.path ?? null, line: pick?.line ?? null };
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
