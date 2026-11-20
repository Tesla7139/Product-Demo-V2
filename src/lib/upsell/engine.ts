/**
 * The demo's upsell engine: which product the demo cart opens with, and which
 * products are offered after payment. Pure functions, no I/O: they run on the
 * server (the start product, /api/clone-start) and in the browser (the offers,
 * the thank-you page's suggestions).
 *
 * ─── The cart product ("hero") ────────────────────────────────────────────
 * A store's core product: in stock, with a photo, not a bundle / gift card /
 * subscription, priced in the middle of the catalog (35th–85th percentile)
 * rather than a $4 sticker or a $600 set — and one that leaves room for at
 * least two upsells under it. Among those, the store's own order wins (its
 * catalog lists featured / best-selling products first).
 *
 * ─── The offers ───────────────────────────────────────────────────────────
 * A post-purchase offer is a one-tap buy: the shopper has just paid, and pays
 * again with one press. So:
 *
 *  1. Price. The offer (after the 20% off) is set against the cart's value:
 *       ≤ 15%          small add-on — fine, a little less compelling
 *       15% – 40%      the sweet spot
 *       40% – 60%      a stretch, scored down
 *       > 60%          not a one-tap upsell: left out
 *     If nothing fits under 60%, up to 100% is allowed, scored well down;
 *     past the cart's own value nothing is offered (the demo skips the
 *     offers rather than offer a $400 product on a $12 order).
 *
 *  2. Fit. It should go with what was bought, not replace it:
 *       + made for it: its title names the cart product ("Mesh Filter -
 *         Reencle Prime" after a Reencle Prime)
 *       + an add-on by nature: refills, filters, cases, care, accessories…
 *       + a different product type from the cart's (Shoes → Socks)
 *       + tags it shares with the cart (beyond the ones every product has)
 *       − the same product type (another pair of the same shoes), unless
 *         it's a consumable
 *       ✕ the same product family (first two words of its name, past the
 *         brand and "Men's"/"Women's": "Glazed Red Short …" after "Glazed
 *         Red Extra Short …"), anything already
 *         in the cart, gift cards, warranties, shipping protection,
 *         subscriptions, samples, products without a photo
 *
 *  3. The two pages. "One-time offer!" takes the best score. "Last offer:"
 *     is a downsell: the best of the rest that is cheaper than the first
 *     offer, from another family and, where the catalog allows, another kind
 *     of product (not socks after socks).
 *
 * Every pick carries its reasons (`reasons`), logged to the browser console
 * as "[upsell]" so a demo can be explained — or a store's odd pick traced.
 */

export type UpsellProduct = {
  id: string;
  title: string;
  /** price of the variant that would be offered */
  price: number;
  hasImage: boolean;
  available?: boolean;
  handle?: string;
  type?: string;
  tags?: string[];
  vendor?: string;
};

export type CartLine = { title: string; price: number; qty: number };

export type Ranked<T> = { product: T; score: number; ratio: number; reasons: string[] };

/** the post-purchase discount the offer pages show */
export const OFFER_PCT = 20;

const NEVER_OFFER =
  /\b(gift ?cards?|e-?gift|gift certificates?|warrant(y|ies)|insurance|protection|route|shipping|subscriptions?|subscribe|subscribers?|memberships?|club|samples?|tester|free gift|donations?|deposit|custom order|pre-?order)\b/i;
// products bought on top of something else
const ADD_ON =
  /\b(refills?|replacements?|filters?|cartridges?|pods?|accessor(y|ies)|add-?ons?|cases?|covers?|pouch(es)?|bags?|straps?|bands?|chargers?|cables?|cleaners?|cleaning|care|wipes?|spray|polish|protectors?|liners?|inserts?|insoles?|laces?|socks?|tools?|brush(es)?|stands?|mounts?|holders?|tips?|heads?|blades?|batter(y|ies)|travel)\b/i;
// things bought again and again: the same type is fine
const CONSUMABLE =
  /\b(refills?|pods?|patches|capsules?|tablets?|gumm(y|ies)|tea|coffee|snacks?|bars?|serum|cream|lotion|shampoo|conditioner|soap|wash|supplements?|vitamins?|protein|candles?|filters?|wipes?|food|treats?)\b/i;
const BUNDLE = /\b(bundles?|sets?|kits?|stacks?|packs?|builder|collection|mystery|outlet)\b/i;

const STOP = new Set([
  "the", "and", "for", "with", "of", "in", "on", "a", "an", "to", "by", "your", "our", "new", "pack", "packs", "set", "kit",
  "size", "one", "two", "three", "x", "pcs", "piece", "pieces", "edition", "limited", "classic", "original", "premium", "pro",
  "men", "mens", "women", "womens", "unisex", "kids", "black", "white", "red", "blue", "green", "pink", "grey", "gray",
]);

const norm = (s = "") => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s = "") => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
const NOT_A_NAME = new Set(["the", "men", "mens", "women", "womens", "unisex", "kids", "boys", "girls", "new"]);
/** a product's family: the first two words of its name, past brand and gender ("glazed red") */
export const family = (title: string, brand: Set<string> = new Set()) =>
  norm(title.split(/\s+[-–—|]\s+|\s*\(/)[0]).split(" ").filter((w) => w.length > 1 && !NOT_A_NAME.has(w) && !brand.has(w)).slice(0, 2).join(" ");
// a product's name without its colour / variant tail: "Wool Cruiser - Port (Port Sole)" → "Wool Cruiser"
const core = (title: string) => title.split(/\s+[-–—|]\s+|\s*\(/)[0];
// what the product is: the last word of its name ("cruiser", "top", "filter")
const COUNT = new Set(["single", "pair", "pairs", "multipack", "duo", "trio", "bundle", "variety", "mini", "max", "plus", "lite"]);
const kind = (title: string) => words(core(title)).filter((w) => !COUNT.has(w)).pop()?.replace(/s$/, "") ?? "";
const text = (p: UpsellProduct) => [p.title, p.type, ...(p.tags ?? [])].filter(Boolean).join(" ").replace(/[-_]/g, " ");

// "Womens>Apparel>LS Tops>crew_neck" and "…>turtleneck" are one category: compare
// a store's category paths three levels deep
const category = (type = "") => norm(type.split(/\s*>\s*/).slice(0, 3).join(" "));

const brandWords = (catalog: UpsellProduct[]) => new Set(catalog.map((p) => norm(p.vendor)).filter(Boolean).flatMap((v) => v.split(" ")));

const usable = (p: UpsellProduct) => p.hasImage && p.price > 0 && p.available !== false && !NEVER_OFFER.test(text(p));

/** how well a price sits as a one-tap upsell, 0–1 (ratio = offer price / cart value) */
function priceFit(ratio: number) {
  if (ratio <= 0.15) return 0.55 + 3 * ratio; // 0.55 → 1.0
  if (ratio <= 0.4) return 1;
  if (ratio <= 0.6) return 1 - ((ratio - 0.4) / 0.2) * 0.6; // 1 → 0.4
  return Math.max(0, 0.3 - (ratio - 0.6)); // the relaxed band, up to 1.0
}

/**
 * Every product that could follow this cart, best first, each with its score
 * and why. `relaxed` lets prices up to the cart's own value in.
 */
export function rankUpsells<T extends UpsellProduct>(cart: CartLine[], catalog: T[], relaxed = false): Ranked<T>[] {
  const value = cart.reduce((s, l) => s + l.price * l.qty, 0);
  if (!value) return [];
  const inCart = new Set(cart.map((l) => norm(l.title)));
  const kinds = cart.map((l) => kind(l.title));
  const vendors = brandWords(catalog);
  const cartFamilies = new Set(cart.map((l) => family(l.title, vendors)));
  // the cart's own catalog entries, for their type, tags and brand
  const bought = catalog.filter((p) => inCart.has(norm(p.title)));

  // words and tags most of the catalog shares say nothing about fit
  const df = new Map<string, number>();
  for (const p of catalog) for (const w of new Set([...words(p.title), ...(p.tags ?? []).map(norm)])) df.set(w, (df.get(w) ?? 0) + 1);
  const rare = (w: string) => (df.get(w) ?? 0) <= Math.max(2, catalog.length * 0.35) && !vendors.has(w);

  // the cart product's own name, without colour or variant
  const cartWords = new Set(cart.flatMap((l) => words(core(l.title))).filter(rare));
  const cartKinds = new Set(kinds.filter(Boolean));
  // a cart product without a category takes the one its kind has elsewhere in the
  // catalog (an untyped "Wool Cruiser" is in "Shoes" like the other cruisers)
  const cartTypes = new Set(
    [...bought.map((p) => p.type), ...catalog.filter((p) => p.type && kinds.includes(kind(p.title))).map((p) => p.type)]
      .map((t) => category(t))
      .filter(Boolean)
  );
  const cartTags = new Set(bought.flatMap((p) => (p.tags ?? []).map(norm)).filter(rare));
  const cap = relaxed ? 1 : 0.6;

  const out: Ranked<T>[] = [];
  for (const p of catalog) {
    if (!usable(p) || inCart.has(norm(p.title)) || cartFamilies.has(family(p.title, vendors))) continue;
    const deal = (p.price * (100 - OFFER_PCT)) / 100;
    const ratio = deal / value;
    if (ratio > cap) continue;

    const reasons: string[] = [];
    let fit = 0;
    // what it is, from its title and category (tags name too much: colours, campaigns)
    // what it is: its name (not the colour after the dash: "Dark Camel / Stony Cream") and category
    const is = [core(p.title), p.type].filter(Boolean).join(" ").replace(/[-_]/g, " ");
    // part names often come after the dash ("Reencle Gravity - Carbon Filter")
    const named = [p.title, p.type].filter(Boolean).join(" ").replace(/[-_]/g, " ");
    const type = category(p.type);
    // in the cart's own category it's another of the same, whatever its name says
    // ("Varsity Strap" is a shoe at a shoe store)
    const addOn = ADD_ON.test(named) && !(type && cartTypes.has(type));
    const consumable = CONSUMABLE.test(is);
    const names = words(p.title).filter((w) => cartWords.has(w));
    const same = words(core(p.title)).some((w) => cartKinds.has(w.replace(/s$/, ""))) && !consumable;
    // another of what was bought ("Canvas Cruiser" after a "Wool Cruiser")
    if (same) { fit -= 2; reasons.push(`the same kind of product (${kind(p.title)})`); }
    // an add-on that names the cart product is made for it ("Mesh Filter - Reencle
    // Prime" after a Reencle Prime); anything else that shares its name is more of the same
    else if (names.length && addOn) { fit += 3; reasons.push(`made for it ("${names.join(" ")}")`); }
    else if (names.length) { fit -= 1; reasons.push(`like what was bought ("${names.join(" ")}")`); }
    if (addOn) { fit += 2; reasons.push("an add-on"); }
    if (type && cartTypes.size) {
      if (!cartTypes.has(type)) { fit += 1.5; reasons.push(`another category (${p.type})`); }
      else if (consumable) reasons.push("same category, bought again");
      else { fit -= 1; reasons.push(`same category as the cart (${p.type})`); }
    }
    // tags that name something (not campaign codes like "11-3-26 drop")
    const shared = (p.tags ?? []).map(norm).filter((t) => cartTags.has(t) && !/\d/.test(t));
    if (shared.length) { fit += Math.min(1.5, shared.length * 0.5); reasons.push(`shares ${shared.slice(0, 3).join(", ")}`); }
    if (BUNDLE.test(p.title) && ratio > 0.4) { fit -= 0.5; reasons.push("a bundle — big for a one-tap buy"); }

    const pf = priceFit(ratio);
    reasons.push(`${Math.round(ratio * 100)}% of the order (${ratio <= 0.4 ? "easy yes" : ratio <= 0.6 ? "a stretch" : "pricey"})`);
    out.push({ product: p, score: fit + 3 * pf, ratio, reasons });
  }
  // the store's order breaks ties (featured / best sellers come first)
  return out.sort((a, b) => b.score - a.score);
}

/** The two offer pages: the best pick, then a cheaper downsell from another family. */
export function pickOffers<T extends UpsellProduct>(cart: CartLine[], catalog: T[]): { first: Ranked<T> | null; last: Ranked<T> | null; ranked: Ranked<T>[] } {
  let ranked = rankUpsells(cart, catalog);
  if (!ranked.length) ranked = rankUpsells(cart, catalog, true);
  const first = ranked[0] ?? null;
  const brand = brandWords(catalog);
  const fam = (r: Ranked<T>) => family(r.product.title, brand);
  const rest = first ? ranked.slice(1).filter((r) => fam(r) !== fam(first)) : [];
  const cheaper = (r: Ranked<T>) => r.product.price < first!.product.price;
  const otherKind = (r: Ranked<T>) => kind(r.product.title) !== kind(first!.product.title);
  // a cheaper product of another kind; then another kind; then cheaper; then anything left
  const last = first ? rest.find((r) => cheaper(r) && otherKind(r)) ?? rest.find(otherKind) ?? rest.find(cheaper) ?? rest[0] ?? null : null;
  return { first, last, ranked };
}

/**
 * The product the demo's cart opens with: a core product in the middle of the
 * catalog's prices that leaves room for two upsells. Null for an empty catalog.
 */
export function pickHero<T extends UpsellProduct>(catalog: T[]): T | null {
  const buyable = catalog.filter(usable);
  if (!buyable.length) return catalog[0] ?? null;
  const simple = buyable.filter((p) => !BUNDLE.test(text(p)));
  const pool = simple.length ? simple : buyable;
  const prices = pool.map((p) => p.price).sort((a, b) => a - b);
  const at = (q: number) => prices[Math.min(prices.length - 1, Math.floor(q * prices.length))];
  const [lo, hi] = [at(0.35), at(0.85)];
  const mid = pool.filter((p) => p.price >= lo && p.price <= hi);
  const roomy = (p: T) => rankUpsells([{ title: p.title, price: p.price, qty: 1 }], catalog).length >= 2;
  return mid.find(roomy) ?? pool.find(roomy) ?? mid[0] ?? pool[0];
}
