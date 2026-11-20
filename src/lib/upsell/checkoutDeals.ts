import { getUpstream } from "@/lib/clone/upstream";
import { cachedUpstream, cacheKey, DATA_TTL } from "@/lib/clone/cache";
import { pickAddOns, type CartLine } from "@/lib/upsell/engine";

/**
 * Checkout upsells: a box of add-ons on the store's own checkout, under the
 * total, each ticked on before paying. Every store gets one ("Add these to your
 * order", at the products' own prices); a store with a deal set up here gets its
 * wording and price instead ("Your $3.00 patches · Black Month Sale"). The
 * products come from the upsell engine (pickAddOns).
 */
export type CheckoutDeal = {
  title: string;
  badge?: string;
  note?: string;
  /** what each add-on costs at checkout (unset: its own price) */
  price?: number;
  /** the products the deal covers: the ones at this price */
  fullPrice?: number;
  limit: number;
};

const DEFAULT_DEAL: CheckoutDeal = { title: "Add these to your order", limit: 3 };

const DEALS: Record<string, CheckoutDeal> = {
  // the store's own cart-drawer offer, brought to its checkout
  "kindpatches.com": {
    title: "Your $3.00 patches",
    badge: "Black Month Sale",
    note: "Any patch for $3.00 instead of $15.00. One-time add-on, ships in this box.",
    price: 3,
    fullPrice: 15,
    limit: 3,
  },
};

export type AddOn = { id: string; title: string; image: string; price: number; compareAt?: number };
export type CheckoutUpsell = Omit<CheckoutDeal, "fullPrice" | "limit"> & { items: AddOn[] };

type RawProduct = {
  id?: number;
  handle: string;
  title?: string;
  product_type?: string;
  tags?: string[] | string;
  vendor?: string;
  body_html?: string;
  images?: { src?: string }[];
  variants?: { id?: number; available?: boolean; price?: string }[];
};

const catalogUrl = (site: string) => `https://${site}/products.json?limit=100`;

/** The store's checkout add-ons for this cart, or null without a readable catalog (or anything to offer). */
export async function checkoutUpsell(host: string, cart: CartLine[]): Promise<CheckoutUpsell | null> {
  const site = host.replace(/^www\./, "");
  const deal = DEALS[site] ?? DEFAULT_DEAL;
  try {
    const up = await cachedUpstream(cacheKey("data", catalogUrl(site)), DATA_TTL, () =>
      getUpstream(catalogUrl(site), { accept: "application/json", page: false })
    );
    if (!up || up.status >= 400) return null;
    const { products = [] } = JSON.parse(up.body.toString("utf8")) as { products?: RawProduct[] };
    const catalog = products.map((p) => {
      const v = p.variants?.find((x) => x.available !== false && Number(x.price) > 0);
      return {
        id: String(v?.id ?? p.id ?? p.handle),
        title: p.title ?? p.handle,
        price: Number(v?.price) || 0,
        hasImage: !!p.images?.[0]?.src,
        available: !!v,
        type: p.product_type,
        tags: Array.isArray(p.tags) ? p.tags : (p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        vendor: p.vendor,
        details: (p.body_html ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").slice(0, 1500),
        image: p.images?.[0]?.src ?? "",
      };
    });
    const picks = pickAddOns(cart, catalog, { fullPrice: deal.fullPrice, limit: deal.limit });
    if (!picks.length) return null;
    const { fullPrice, limit, ...shown } = deal;
    void limit;
    return {
      ...shown,
      items: picks.map((p) => ({
        id: p.id,
        title: p.title,
        image: p.image,
        price: deal.price ?? p.price,
        ...(deal.price != null && fullPrice != null ? { compareAt: fullPrice } : {}),
      })),
    };
  } catch {
    return null;
  }
}
