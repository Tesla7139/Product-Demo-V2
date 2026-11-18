import { getUpstream, nodeFetch } from "./upstream";
import { cachedUpstream, cacheKey, DATA_TTL } from "./cache";

// Each store's real Shopify checkout design. Shopify ships a store's checkout
// branding with the checkout page itself (the same settings its Checkout Branding
// API exposes): header alignment, logo and banner, button / accent colours, panel
// backgrounds, fonts, corner radius, and which express wallets are switched on.
// To read them we put one product in a throwaway cart, open the store's real
// checkout page (nothing is bought) and parse that data out of the HTML, so the
// preview's checkout can be drawn the way the store's own one looks.

export type ExpressWallet = "shop_pay" | "paypal" | "google_pay";

export type CheckoutBranding = {
  logo: { url: string; maxWidth: number; ratio: number } | null;
  headerAlign: "start" | "center";
  /** header background image (Blunt Cases' black trust-badge banner), else a colour */
  headerBanner: string | null;
  headerBg: string | null;
  headerText: string | null;
  /** primary button background */
  button: string;
  /** links, checkboxes, focus rings, the cart icon */
  accent: string;
  mainBg: string;
  summaryBg: string;
  /** body / heading font names, plus @font-face rules when the store uploads its own */
  font: string | null;
  headingFont: string | null;
  fontFaces: string;
  /** weight of headings and buttons (the store's "bold"; Shopify's default is 600) */
  boldWeight: number;
  radius: { button: number; control: number };
  /** in Shopify's display order (Shop Pay first) */
  express: ExpressWallet[];
};

type Json = Record<string, unknown> | null | undefined;

const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The JSON object that starts at `"key":{` in text, parsed (braces balanced, strings respected). */
function objectAt(text: string, key: string): Json {
  const at = text.indexOf(`"${key}":{`);
  if (at < 0) return null;
  const start = at + key.length + 3;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const get = (o: Json, ...path: string[]): unknown => {
  let cur: unknown = o;
  for (const p of path) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
  return cur ?? undefined;
};
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Shopify's corner-radius tokens, in px (the checkout's own --x-skeleton-border-radius-* values). */
const RADIUS: Record<string, number> = { NONE: 0, SMALL: 8, BASE: 12, LARGE: 16 };

function cssVar(html: string, name: string): string | null {
  return html.match(new RegExp(`--x-skeleton-${name}\\s*:\\s*([^;}]+)`))?.[1]?.trim() ?? null;
}

function fontFaces(typography: Json): string {
  const rules: string[] = [];
  for (const group of ["primary", "secondary"]) {
    const name = str(get(typography, group, "name"));
    for (const weight of ["base", "bold"]) {
      const sources = str(get(typography, group, weight, "sources"));
      const w = get(typography, group, weight, "weight");
      if (name && sources) rules.push(`@font-face{font-family:"${name}";src:${sources};font-weight:${w ?? 400};font-display:swap}`);
    }
  }
  return rules.join("");
}

export function parseCheckoutBranding(rawHtml: string): CheckoutBranding {
  const html = unescapeHtml(rawHtml);
  const c = objectAt(html, "customizations");
  const ds = objectAt(html, "designSystem");
  const defaultAccent = cssVar(rawHtml, "color-global-accent") || "#005BD1";

  const logoUrl = str(get(c, "header", "logo", "image", "main"));
  const lw = Number(get(c, "header", "logo", "image", "width")) || 0;
  const lh = Number(get(c, "header", "logo", "image", "height")) || 0;

  const express: ExpressWallet[] = [];
  if (/ShopPayWalletConfig/.test(rawHtml)) express.push("shop_pay");
  if (/PaypalWalletConfig/.test(rawHtml)) express.push("paypal");
  if (/GooglePayWalletConfig/.test(rawHtml)) express.push("google_pay");

  const radiusToken = (v: unknown) => (typeof v === "string" && v in RADIUS ? RADIUS[v] : null);
  // measured on real checkouts: buttons and fields both use the base radius (12px) unless set
  const baseRadius = radiusToken(get(ds, "cornerRadius", "base")) ?? (parseFloat(cssVar(rawHtml, "border-radius-base") || "") || 12);

  return {
    logo: logoUrl
      ? { url: logoUrl, maxWidth: Number(get(c, "header", "logo", "maxWidth")) || 150, ratio: lw && lh ? lw / lh : 3 }
      : null,
    headerAlign: get(c, "header", "alignment") === "CENTER" ? "center" : "start",
    headerBanner: str(get(c, "header", "banner", "image", "main")),
    headerBg: str(get(c, "header", "colors", "base", "background")),
    headerText: str(get(c, "header", "colors", "base", "text")),
    button: str(get(c, "shared", "colors", "button")) || str(get(c, "primaryButton", "colors", "base", "background")) || defaultAccent,
    accent: str(get(c, "shared", "colors", "accent")) || defaultAccent,
    mainBg: str(get(c, "main", "colors", "base", "background")) || "#ffffff",
    summaryBg:
      str(get(c, "orderSummary", "colors", "base", "background")) ||
      cssVar(rawHtml, "color-schemes-scheme2-base-background") ||
      "#f5f5f5",
    font: str(get(ds, "typography", "primary", "name")),
    headingFont: str(get(ds, "typography", "secondary", "name")),
    fontFaces: fontFaces(get(ds, "typography") as Json),
    boldWeight: Number(get(ds, "typography", "secondary", "bold", "weight")) || Number(get(ds, "typography", "primary", "bold", "weight")) || 600,
    radius: {
      button: radiusToken(get(c, "primaryButton", "cornerRadius")) ?? baseRadius,
      control: radiusToken(get(c, "control", "cornerRadius")) ?? baseRadius,
    },
    express,
  };
}

type ShopifyProduct = { variants?: { id: number; available?: boolean; price?: string }[] };

/** Cookie header from Set-Cookie lines (name=value pairs only). */
const cookieHeader = (setCookies: string[]) => setCookies.map((c) => c.split(";")[0]).join("; ");

async function fetchCheckoutBranding(host: string): Promise<CheckoutBranding | null> {
  const catalogUrl = `https://${host}/products.json?limit=30`;
  const catalog = await cachedUpstream(cacheKey("data", catalogUrl), DATA_TTL, () =>
    getUpstream(catalogUrl, { accept: "application/json", page: false })
  );
  if (!catalog || catalog.status >= 400) return null;
  let variant: number | undefined;
  try {
    const { products } = JSON.parse(catalog.body.toString("utf8")) as { products?: ShopifyProduct[] };
    for (const p of products ?? []) {
      variant = p.variants?.find((v) => v.available !== false && Number(v.price) > 0)?.id;
      if (variant) break;
    }
  } catch {
    return null;
  }
  if (!variant) return null;

  // a throwaway cart, then the store's real checkout page for it
  const added = await nodeFetch(`https://${host}/cart/add.js`, {
    method: "POST",
    accept: "application/json",
    contentType: "application/json",
    body: JSON.stringify({ items: [{ id: variant, quantity: 1 }] }),
  });
  if (!added || added.status >= 400 || !added.setCookies.length) return null;
  // Shopify's checkout turns Node's fetch away (403) but lets curl through, which
  // getUpstream falls back to; no headless fallback, it can't carry the cart cookie
  const checkout = await getUpstream(`https://${host}/checkout`, {
    accept: "text/html,application/xhtml+xml",
    cookie: cookieHeader(added.setCookies),
    page: false,
  });
  if (!checkout || checkout.status >= 400 || !/\/checkouts?\//.test(checkout.finalUrl)) return null;
  return parseCheckoutBranding(checkout.body.toString("utf8"));
}

// per store, for a few hours: branding rarely changes, and each lookup opens a cart on the store
const brandings = new Map<string, { at: number; value: Promise<CheckoutBranding | null> }>();
const BRANDING_TTL = 6 * 60 * 60 * 1000;
const FAILED_TTL = 10 * 60 * 1000;

export function checkoutBranding(host: string): Promise<CheckoutBranding | null> {
  const hit = brandings.get(host);
  if (hit && Date.now() - hit.at < BRANDING_TTL) return hit.value;
  const value = fetchCheckoutBranding(host).catch(() => null);
  brandings.set(host, { at: Date.now(), value });
  // a failed read is retried sooner than a good one
  value.then((b) => {
    if (!b) brandings.set(host, { at: Date.now() - BRANDING_TTL + FAILED_TTL, value });
  });
  return value;
}
