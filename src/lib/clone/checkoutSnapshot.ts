import fs from "fs";
import type { Browser, Page } from "puppeteer-core";
import { rankHeroes, type UpsellProduct } from "@/lib/upsell/engine";

// A store's real checkout, captured. A headless Chrome puts one product in a
// cart on the store — its best-seller that the checkout will deliver (see
// capture) — opens the store's own checkout (nothing is bought), lets it
// render — the store's branding, apps, banners, badges, add-on offers, payment
// options — and saves the result as a static page: styles inlined, Shopify's
// scripts removed. Its secure frames (card fields, PayPal / Google Pay buttons)
// can't come along and are left as sized slots that public/checkout-snapshot.js
// fills with look-alikes. Served by /preview/store-checkout.

export type SnapshotLine = { id: string; title: string; variant: string; price: number; qty: number; image: string | null };
export type CheckoutSnapshot = { html: string; url: string; currency: string; line: SnapshotLine };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// analytics and ad pixels: not needed to render the checkout, and they slow it down
const TRACKERS =
  /googletagmanager\.com|google-analytics\.com|doubleclick\.net|connect\.facebook\.net|analytics\.tiktok\.com|hotjar\.com|clarity\.ms|bat\.bing\.com|pinimg\.com|ct\.pinterest\.com|sc-static\.net|\/web-pixels|\/wpm@/i;

/** A local Chrome for development (CHROME_PATH wins). */
function localChrome(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

let browser: Promise<Browser> | null = null;

/** One browser per server instance, relaunched if it dies. Serverless: @sparticuz/chromium. */
async function getBrowser(): Promise<Browser> {
  if (browser) {
    const b = await browser.catch(() => null);
    if (b && b.connected) return b;
  }
  browser = (async () => {
    const puppeteer = (await import("puppeteer-core")).default;
    const serverless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    if (serverless) {
      // @sparticuz/chromium only unpacks its bundled system libraries (libnss3…)
      // when it recognises a Node 20/22 Lambda; Vercel's newer Node runtimes run on
      // the same Amazon Linux 2023, so present them as one. Must precede the import.
      if (!/(20|22)\.x/.test(process.env.AWS_EXECUTION_ENV || "")) {
        process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs22.x";
        process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs22.x";
      }
      const chromium = (await import("@sparticuz/chromium")).default;
      return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    }
    const executablePath = localChrome();
    if (!executablePath) throw new Error("No Chrome found — set CHROME_PATH");
    return puppeteer.launch({ executablePath, headless: true });
  })();
  return browser;
}

// Runs in the rendered checkout: one self-contained HTML document of it. `enabled` is
// the express wallets the store has switched on (for any that didn't render).
const SERIALIZE = `(async (enabled) => {
  const abs = (u, base) => { try { return new URL(u, base).href; } catch { return u; } };
  // relative url()s in a stylesheet point next to the stylesheet, not the page
  const rebase = (css, base) => css.replace(/url\\((['"]?)(?!data:|https?:|\\/\\/)([^'")]+)\\1\\)/g, (m, q, u) => "url(" + q + abs(u, base) + q + ")");
  // Each sheet's original source text: re-serialising rules (cssRules) drops values
  // Chrome expanded from a shorthand with var() — padding-block: var(--x) comes out
  // as "padding-top: ;". Only adopted (constructed) sheets, which have no source,
  // fall back to their rules.
  let css = "";
  for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
    const base = sheet.href || location.href;
    let text = null;
    if (sheet.href) { try { text = await (await fetch(sheet.href)).text(); } catch {} }
    else if (sheet.ownerNode && sheet.ownerNode.textContent) text = sheet.ownerNode.textContent;
    if (text === null) { try { text = [...sheet.cssRules].map((r) => r.cssText).join("\\n"); } catch { text = ""; } }
    css += rebase(text, base) + "\\n";
  }
  // icons are <use href=".../sprite.svg#id"> into a sprite on the store's domain,
  // which browsers won't follow from another site: embed the sprites, point at them
  const spriteUrls = [...new Set([...document.querySelectorAll("use")]
    .map((u) => (u.getAttribute("href") || u.getAttribute("xlink:href") || "").split("#")[0])
    .filter(Boolean))];
  let sprites = "";
  for (const u of spriteUrls) {
    try { const m = (await (await fetch(u)).text()).match(/<svg[^>]*>([\\s\\S]*)<\\/svg>/i); if (m) sprites += m[1]; } catch {}
  }
  const live = [...document.querySelectorAll("iframe")];
  const liveImgs = [...document.images];
  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll("use").forEach((u) => {
    const ref = u.getAttribute("href") || u.getAttribute("xlink:href") || "";
    const id = ref.split("#")[1];
    if (id) { u.setAttribute("href", "#" + id); u.removeAttribute("xlink:href"); }
  });
  root.querySelectorAll("script, link[rel=stylesheet], link[rel=preload], link[rel=modulepreload], link[rel=prefetch], style, noscript, base").forEach((n) => n.remove());
  root.querySelectorAll("iframe").forEach((f, i) => {
    const r = live[i] && live[i].getBoundingClientRect();
    if (!r || !r.width || !r.height) { f.remove(); return; }
    const slot = document.createElement("div");
    const title = f.getAttribute("title") || f.getAttribute("name") || "";
    slot.setAttribute("data-cp-slot", title);
    // wallet buttons fill their list item, so the row can be re-laid out below
    slot.style.cssText = (/^pay with/i.test(title) ? "width:100%" : "width:" + r.width + "px") + ";height:" + r.height + "px";
    f.replaceWith(slot);
  });
  // Wallets the store has on but that never rendered (PayPal / Google Pay load
  // late, and not at all in some headless runs): add their slots, and tell the
  // row how many buttons it holds — its CSS lays out 1, 2 or 3 by data-count.
  const row = root.querySelector("#express-checkout-wallets-wrapper");
  if (row && enabled && enabled.length) {
    const has = {
      shop_pay: !!row.querySelector("#shop-pay-button, a[href*='payment=shop_pay']"),
      paypal: !!row.querySelector("[data-cp-slot*='PayPal' i]"),
      google_pay: !!row.querySelector("[data-cp-slot*='Google' i]"),
    };
    const titles = { paypal: "Pay with PayPal", google_pay: "Pay with Google Pay" };
    const first = row.querySelector(":scope > li");
    const height = (first && first.getBoundingClientRect && first.getBoundingClientRect().height) || 48;
    for (const w of enabled) {
      if (has[w] || !titles[w]) continue;
      const li = document.createElement("li");
      if (first) li.className = first.className;
      li.innerHTML = '<div data-cp-slot="' + titles[w] + '" style="width:100%;height:' + height + 'px"></div>';
      row.appendChild(li);
    }
    const counted = row.closest("[data-count]");
    if (counted) counted.setAttribute("data-count", String(row.querySelectorAll(":scope > li").length));
  }
  root.querySelectorAll("img").forEach((im, i) => {
    const src = liveImgs[i] && liveImgs[i].currentSrc;
    if (src) { im.setAttribute("src", src); im.removeAttribute("srcset"); im.removeAttribute("sizes"); im.removeAttribute("loading"); }
  });
  const head = root.querySelector("head");
  const base = document.createElement("base"); base.href = location.href; head.prepend(base);
  const style = document.createElement("style"); style.textContent = css; head.append(style);
  const body = root.querySelector("body");
  if (sprites && body) body.insertAdjacentHTML("afterbegin", '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">' + sprites + "</svg>");
  return "<!doctype html>" + root.outerHTML;
})`;

// Runs on the store, in the browser (a store's collection pages turn away plain
// requests): its best-selling order, as product handles, and its catalog.
const STORE_PICKS = `(async () => {
  const out = { popular: [], products: [] };
  try {
    const res = await fetch("/collections/all?sort_by=best-selling", { credentials: "include" });
    if (res.ok) {
      const html = await res.text();
      for (const m of html.matchAll(/\\/products\\/([a-z0-9][a-z0-9-]*)/g)) if (!out.popular.includes(m[1])) out.popular.push(m[1]);
    }
  } catch {}
  try { out.products = (await (await fetch("/products.json?limit=250")).json()).products || []; } catch {}
  // the top best-sellers the catalog page left out (a big store's 250 are its newest)
  const have = new Set(out.products.map((p) => p.handle));
  for (const h of out.popular.filter((x) => !have.has(x)).slice(0, 12)) {
    try {
      const p = await (await fetch("/products/" + encodeURIComponent(h) + ".js")).json();
      out.products.push({
        handle: p.handle, title: p.title, product_type: p.type, tags: p.tags, vendor: p.vendor, body_html: p.description,
        images: (p.images || []).map((src) => ({ src })),
        variants: (p.variants || []).map((v) => ({ available: v.available, price: String((v.price || 0) / 100) })),
      });
    } catch {}
  }
  return out;
})()`;

type RawProduct = {
  handle: string;
  title?: string;
  product_type?: string;
  tags?: string[] | string;
  vendor?: string;
  body_html?: string;
  images?: { src?: string }[];
  variants?: { available?: boolean; price?: string }[];
};

/** The store's products in the order to try them in the cart: best-sellers in stock across their sizes first. */
async function candidates(page: Page): Promise<string[]> {
  const { popular, products } = (await page.evaluate(STORE_PICKS).catch(() => ({ popular: [], products: [] }))) as {
    popular: string[];
    products: RawProduct[];
  };
  const catalog: (UpsellProduct & { handle: string })[] = products.map((p) => {
    const vs = p.variants ?? [];
    const v = vs.find((x) => x.available !== false && Number(x.price) > 0);
    return {
      id: p.handle,
      handle: p.handle,
      title: p.title ?? p.handle,
      price: Number(v?.price) || 0,
      hasImage: !!p.images?.length,
      available: !!v,
      stock: vs.length ? vs.filter((x) => x.available !== false).length / vs.length : undefined,
      type: p.product_type,
      tags: Array.isArray(p.tags) ? p.tags : (p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      vendor: p.vendor,
      details: (p.body_html ?? "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").slice(0, 1500),
    };
  });
  return rankHeroes(catalog, popular).map((p) => p.handle);
}

// What a checkout says when it won't take the cart's product as it stands
const UNDELIVERABLE =
  /not available for delivery|can.?t be (shipped|delivered)|cannot be (shipped|delivered)|doesn.?t ship to|not (be )?available in your (country|region)|sold out|out of stock|no longer available|isn.?t available/i;

// Runs on the store (same origin, so its cart API answers): empty the cart, add one product, report the cart.
const ADD_TO_CART = `(async (handle) => {
  // an empty cart first: the browser keeps its cart between captures
  const json = { "Content-Type": "application/json", Accept: "application/json" };
  try { await fetch("/cart/clear.js", { method: "POST", headers: json, body: "{}" }); } catch {}
  try {
    const left = await (await fetch("/cart.js")).json();
    if (left.items && left.items.length) {
      await fetch("/cart/update.js", { method: "POST", headers: json, body: JSON.stringify({ updates: Object.fromEntries(left.items.map((i) => [i.key, 0])) }) });
    }
  } catch {}
  let variant = null;
  if (handle) {
    try {
      const p = await (await fetch("/products/" + encodeURIComponent(handle) + ".js")).json();
      variant = (p.variants || []).find((v) => v.available) || null;
    } catch {}
  }
  if (!variant) {
    const { products } = await (await fetch("/products.json?limit=30")).json();
    for (const p of products || []) { variant = (p.variants || []).find((v) => v.available && +v.price > 0); if (variant) break; }
  }
  if (!variant) return null;
  await fetch("/cart/add.js", { method: "POST", headers: json, body: JSON.stringify({ items: [{ id: variant.id, quantity: 1 }] }) });
  const cart = await (await fetch("/cart.js")).json();
  // only what was just added, whatever the cart kept
  cart.items = (cart.items || []).filter((i) => i.variant_id === variant.id);
  return cart;
})`;

// express wallets Shopify renders in Chrome, and how the checkout page names them
const WALLETS: [string, RegExp][] = [
  ["shop_pay", /ShopPayWalletConfig/],
  ["paypal", /PaypalWalletConfig/],
  ["google_pay", /GooglePayWalletConfig/],
];

type CartJs = {
  currency?: string;
  items?: { variant_id: number; product_title: string; variant_title: string | null; final_price: number; quantity: number; image: string | null }[];
};

/** Why the last capture for a store came back empty — sent as a response header for debugging. */
export const snapshotFailures = new Map<string, string>();
function fail(host: string, why: string): null {
  snapshotFailures.set(host, why);
  console.error(`[checkoutSnapshot] ${host}: ${why}`);
  return null;
}

async function capture(host: string, handle: string | null): Promise<CheckoutSnapshot | null> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (r) => (TRACKERS.test(r.url()) ? r.abort() : r.continue()).catch(() => {}));

    // a light same-origin page, so the cart calls run on the store itself
    await page.goto(`https://${host}/cart.js`, { waitUntil: "domcontentloaded", timeout: 20000 });
    // the product to open on: a pasted one first, then the store's best-sellers;
    // a checkout that won't deliver it (or finds it sold out) gets the next
    const ranked = await candidates(page).catch(() => [] as string[]);
    const order = [...new Set([...(handle ? [handle] : []), ...ranked])].slice(0, 4);
    if (!order.length) order.push("");

    let cart: CartJs | null = null;
    let item: NonNullable<CartJs["items"]>[number] | undefined;
    let url = "";
    for (let i = 0; i < order.length; i += 1) {
      if (i) await page.goto(`https://${host}/cart.js`, { waitUntil: "domcontentloaded", timeout: 20000 });
      cart = (await page.evaluate(`${ADD_TO_CART}(${JSON.stringify(order[i] || null)})`)) as CartJs | null;
      item = cart?.items?.[0];
      if (!item) continue;
      await page.goto(`https://${host}/checkout?skip_shop_pay=true`, { waitUntil: "networkidle2", timeout: 40000 }).catch(() => {});
      url = page.url();
      if (!/\/checkouts?\//.test(url) || /shop\.app/.test(url)) return fail(host, `checkout landed on ${url.slice(0, 120)}`);
      const refused = await page
        .waitForFunction(
          (src: string) => {
            const re = new RegExp(src, "i");
            return [...document.querySelectorAll("[role=alert]")].some((a) => re.test(a.textContent || ""));
          },
          { timeout: 2500, polling: 250 },
          UNDELIVERABLE.source
        )
        .then(() => true)
        .catch(() => false);
      if (!refused) break;
      console.warn(`[checkoutSnapshot] ${host}: the checkout won't deliver ${order[i] || "the first product"}, trying the next`);
      if (i === order.length - 1) break; // none would: the last one stands (its alert is hidden in the page)
    }
    if (!item) return fail(host, "add to cart failed");
    // Wait for the page to finish arriving: every express wallet the store has on
    // (they load late) and no loading placeholders left — capturing earlier froze
    // grey skeleton blocks into the picture.
    const raw = await page.content();
    const enabled = WALLETS.filter(([, re]) => re.test(raw)).map(([w]) => w);
    await page
      .waitForFunction(
        (n: number) => {
          if (document.querySelector('[aria-busy="true"]')) return false;
          const row = document.querySelector("#express-checkout-wallets-wrapper");
          if (!row) return true;
          const shown = [...row.querySelectorAll(":scope > li")].filter((li) => li.getBoundingClientRect().height > 0);
          return shown.length >= n;
        },
        { timeout: 8000, polling: 250 },
        enabled.length
      )
      .catch(() => {});
    // the checkout itself drawn: its form's fields (a slow store's page is still a
    // blank shell when the network goes quiet)
    const drawn = await page
      .waitForFunction(() => document.querySelectorAll("main input, form input").length >= 3, { timeout: 20000, polling: 300 })
      .then(() => true)
      .catch(() => false);
    if (!drawn) return fail(host, "the checkout never drew its form");
    await new Promise((r) => setTimeout(r, 800)); // late extensions (banners, add-ons) settle
    const html = (await page.evaluate(`${SERIALIZE}(${JSON.stringify(enabled)})`)) as string;
    if (!html || html.length < 20_000) return fail(host, `page too small (${html ? html.length : 0} bytes)`);

    return {
      html,
      url,
      currency: cart?.currency || "USD",
      line: {
        id: String(item.variant_id),
        title: item.product_title,
        variant: item.variant_title && item.variant_title !== "Default Title" ? item.variant_title : "",
        price: item.final_price / 100,
        qty: item.quantity,
        image: item.image ? new URL(item.image, `https://${host}`).href : null,
      },
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// per store for a few hours: checkouts rarely change, and each capture opens a cart on the store
const snapshots = new Map<string, { at: number; value: Promise<CheckoutSnapshot | null> }>();
const TTL = 6 * 60 * 60 * 1000;
const FAILED_TTL = 10 * 60 * 1000;

/** The store's captured checkout (shared with any capture already running for it). */
export function checkoutSnapshot(host: string, handle: string | null = null): Promise<CheckoutSnapshot | null> {
  const hit = snapshots.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = capture(host, handle).catch((err: unknown) => {
    return fail(host, err instanceof Error ? err.message : String(err));
  });
  snapshots.set(host, { at: Date.now(), value });
  value.then((s) => {
    if (!s) snapshots.set(host, { at: Date.now() - TTL + FAILED_TTL, value });
  });
  return value;
}
