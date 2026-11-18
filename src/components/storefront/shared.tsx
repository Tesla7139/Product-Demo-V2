"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DemoImg } from "@/components/sections/demo/DemoImg";
import { mockStore } from "@/lib/site";
import type { CheckoutBranding } from "@/lib/clone/checkoutBranding";

// Pieces shared by the pages that follow the storefront copy (checkout, upsell,
// thank-you). Everything reads the store's look from the session the copy wrote.

export type Brand = {
  host?: string;
  home?: string;
  name?: string;
  logo?: string | null;
  currency?: string;
  accent?: string | null;
  fonts?: { css: string; body: string; heading: string | null };
  /** the store's real checkout design, read from its own checkout (null: not available) */
  checkout?: CheckoutBranding | null;
};

/** A line in the order — cart items from the copy, plus accepted upsells. */
export type Line = { id: string; title: string; variant: string; price: number; compareAt?: number; qty: number; image: string | null };

/** A catalog product with what the upsell page needs (gallery, options, variants). */
export type CatalogProduct = {
  id: string;
  title: string;
  description: string;
  images: string[];
  options: { name: string; values: string[] }[];
  variants: { id: string; title: string; options: string[]; price: number; image: string | null }[];
  price: number;
};

export function readSession<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null") as T | null;
  } catch {
    return null;
  }
}

export function money(n: number, currency: string) {
  const d = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  } catch {
    return n.toFixed(d);
  }
}

/** Text colour that reads on a filled accent button. */
export function textOn(color: string) {
  // Shopify's checkout branding comes as hsl(h, s%, l%)
  const hsl = color.match(/hsl\(\s*[\d.]+,\s*[\d.]+%,\s*([\d.]+)%/i);
  if (hsl) return Number(hsl[1]) > 62 ? "#111" : "#fff";
  const short = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) color = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb =
    color.match(/(\d+),\s*(\d+),\s*(\d+)/)?.slice(1).map(Number) ??
    color.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)?.slice(1).map((h) => parseInt(h, 16));
  if (!rgb) return "#fff";
  const [r, g, b] = rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? "#111" : "#fff";
}

/** Flat shipping on the original order — free once anything is added after purchase. */
export const shippingFee = (subtotal: number) => Math.max(3, Math.round((subtotal * 0.04) / 5) * 5);

export const orderNumber = () =>
  Array.from({ length: 9 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 34)]).join("");

type ShopifyProduct = {
  id: number;
  title: string;
  body_html?: string;
  images?: { src: string; variant_ids?: number[] }[];
  options?: { name: string; values: string[] }[];
  variants?: { id: number; title: string; price: string; option1?: string | null; option2?: string | null; option3?: string | null; featured_image?: { src: string } | null }[];
};

const stripHtml = (html = "") =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function fromShopify(p: ShopifyProduct): CatalogProduct {
  const variants = (p.variants ?? []).map((v) => ({
    id: String(v.id),
    title: v.title,
    options: [v.option1, v.option2, v.option3].filter((o): o is string => !!o),
    price: Number(v.price) || 0,
    image: v.featured_image?.src ?? null,
  }));
  const options = (p.options ?? []).filter((o) => !(o.values.length === 1 && o.values[0] === "Default Title"));
  return {
    id: String(p.id),
    title: p.title,
    description: stripHtml(p.body_html).slice(0, 220),
    images: (p.images ?? []).map((i) => i.src),
    options,
    variants,
    price: variants[0]?.price ?? 0,
  };
}

function fromSimple(p: { id: string; title: string; price: number; image?: string | null }): CatalogProduct {
  return { id: p.id, title: p.title, description: "", images: p.image ? [p.image] : [], options: [], variants: [], price: p.price };
}

/** The store's catalog — products.json through the copy's proxy (carries the password cookie). */
export async function loadCatalog(host: string): Promise<CatalogProduct[]> {
  try {
    const res = await fetch(`/clone/${host}/products.json?limit=30`, { headers: { Accept: "application/json" } });
    const data = (await res.json()) as { products?: ShopifyProduct[] };
    const products = (data.products ?? []).map(fromShopify).filter((p) => p.price > 0);
    if (products.length) return products;
  } catch {
    /* not a Shopify store — try the schema.org scrape below */
  }
  try {
    const res = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: host }) });
    const data = (await res.json()) as { products?: { id: string; title: string; price: number; image?: string | null }[] };
    if (data.products?.length) return data.products.map(fromSimple);
  } catch {
    /* fall through to the sample catalog */
  }
  return mockStore.products.map(fromSimple);
}

/** Shopify checkout's default type stack — what a store gets when it hasn't picked a checkout font. */
const SHOPIFY_FONTS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * The order flow's look. With the store's real checkout design (brand.checkout)
 * the pages use its fonts, colours and corner radius — as CSS variables the
 * components read — like the store's own checkout; otherwise the storefront's
 * fonts and add-to-cart colour stand in.
 */
export function StoreFrame({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  const f = brand.fonts;
  const co = brand.checkout;
  const button = co?.button || brand.accent || "#111827";
  const body = co ? (co.font ? `"${co.font}", ${SHOPIFY_FONTS}` : SHOPIFY_FONTS) : f?.body;
  const heading = co ? (co.headingFont ? `"${co.headingFont}", ${SHOPIFY_FONTS}` : body) : f?.heading || f?.body;
  const vars: Record<string, string | number | undefined> = {
    "--cp-heading": heading || "inherit",
    "--co-button": button,
    "--co-button-text": textOn(button),
    "--co-accent": co?.accent || button,
    "--co-main-bg": co?.mainBg || "#ffffff",
    "--co-summary-bg": co?.summaryBg || "#f5f5f5",
    "--co-r-btn": `${co?.radius.button ?? 12}px`,
    "--co-r-ctl": `${co?.radius.control ?? 12}px`,
    "--co-bold": co?.boldWeight ?? 600,
  };
  return (
    <div className="cp-store min-h-screen text-black antialiased" style={{ fontFamily: body || undefined, background: "var(--co-main-bg)", ...vars }}>
      {!co && f?.css && <style dangerouslySetInnerHTML={{ __html: f.css }} />}
      {co?.fontFaces && <style dangerouslySetInnerHTML={{ __html: co.fontFaces }} />}
      <style>{`.cp-store .cp-heading{font-family:var(--cp-heading)}${FIELD_CSS}${MOTION_CSS}`}</style>
      {children}
    </div>
  );
}

// Shopify checkout fields: a 49px box whose label sits inside as a placeholder
// when empty and floats to the top-left once there's a value (or on focus).
const FIELD_CSS = `
.cp-store .cp-bold{font-weight:var(--co-bold)}
.cp-store .cp-field{position:relative;display:block;height:49px;border:1px solid #dedede;border-radius:var(--co-r-ctl);background:#fff;transition:border-color .15s,box-shadow .15s}
.cp-store .cp-field:focus-within{border-color:var(--co-accent);box-shadow:0 0 0 1px var(--co-accent)}
.cp-store .cp-field.cp-invalid{border-color:#dd1d1d;box-shadow:0 0 0 1px #dd1d1d}
.cp-store .cp-field input,.cp-store .cp-field select{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;padding:18px 11px 0;font-size:14px;line-height:1.35;outline:none;border-radius:inherit;appearance:none;color:#000}
.cp-store .cp-field>span{position:absolute;left:11px;top:7px;font-size:12px;line-height:1.2;color:#707070;pointer-events:none;transition:all .15s ease}
.cp-store .cp-field input:placeholder-shown:not(:focus){padding-top:0}
.cp-store .cp-field input:placeholder-shown:not(:focus)~span{top:50%;transform:translateY(-50%);font-size:14px}
`;

// Page motion for the order flow: sections rise in one after another (cp-rise with
// a per-section animationDelay), and confirmation checks draw themselves.
const MOTION_CSS = `
@keyframes cp-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes cp-fade{from{opacity:0}to{opacity:1}}
@keyframes cp-draw{to{stroke-dashoffset:0}}
@keyframes cp-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
.cp-store .cp-rise{animation:cp-rise .55s cubic-bezier(.2,.8,.2,1) both}
.cp-store .cp-fade{animation:cp-fade .4s ease both}
@keyframes cp-slide{from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:none}}
.cp-store .cp-slide{animation:cp-slide .45s cubic-bezier(.2,.8,.2,1) both}
.cp-store .cp-pop{animation:cp-pop .5s cubic-bezier(.2,.8,.2,1) both}
.cp-store .cp-draw{stroke-dasharray:var(--len);stroke-dashoffset:var(--len);animation:cp-draw .6s cubic-bezier(.65,0,.35,1) forwards}
@media (prefers-reduced-motion:reduce){.cp-store .cp-rise,.cp-store .cp-fade,.cp-store .cp-slide,.cp-store .cp-pop,.cp-store .cp-draw{animation:none;stroke-dashoffset:0}}
`;

/** A check mark in a ring that draws itself: ring first, then the tick. */
export function AnimatedCheck({ color, size = 60, delay = 0 }: { color: string; size?: number; delay?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 52 52" fill="none" className="cp-pop shrink-0" style={{ animationDelay: `${delay}ms` }} aria-hidden>
      <circle
        cx="26" cy="26" r="24" stroke={color} strokeWidth="2.5"
        className="cp-draw" style={{ ["--len" as string]: 151, animationDelay: `${delay + 100}ms` }}
      />
      <path
        d="M15 27l7 7 15-16" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        className="cp-draw" style={{ ["--len" as string]: 36, animationDelay: `${delay + 550}ms` }}
      />
    </svg>
  );
}

export function StoreLogo({ brand, className }: { brand: Brand; className?: string }) {
  const name = brand.name || brand.host || "";
  return (
    <a href={brand.home || "#"} className="inline-flex min-w-0 items-center">
      {brand.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- the store's own logo
        <img src={brand.logo} alt={name} className={className ?? "max-h-10 max-w-[180px] object-contain"} referrerPolicy="no-referrer" />
      ) : (
        <span className="cp-heading truncate text-xl font-bold tracking-tight">{name}</span>
      )}
    </a>
  );
}

/**
 * The checkout header as the store set it up: logo at its configured width, left
 * or centred, over a banner image or colour (measured: 92px tall, 120px with a
 * banner, spanning the same 980px as the columns below). `right` (the cart icon)
 * inherits the header's text colour.
 */
export function StoreHeader({ brand, right }: { brand: Brand; right?: React.ReactNode }) {
  const co = brand.checkout;
  const name = brand.name || brand.host || "";
  const logo = co?.logo?.url || brand.logo;
  const banner = co?.headerBanner;
  const bg = co?.headerBg || "#fff";
  const onDark = !!banner || textOn(bg) === "#fff";
  const center = co?.headerAlign === "center";
  return (
    <header
      className="border-b border-[#dedede]"
      style={{
        background: banner ? `#000 url("${banner}") center / cover no-repeat` : bg,
        color: co?.headerText || (onDark ? "#fff" : "var(--co-accent)"),
      }}
    >
      <div
        className={`relative mx-auto flex max-w-[980px] items-center px-5 lg:px-0 ${center ? "justify-center" : "justify-between"}`}
        style={{ minHeight: banner ? 120 : 92 }}
      >
        <a href={brand.home || "#"} className="inline-flex min-w-0 items-center">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the store's own logo
            <img
              src={logo}
              alt={name}
              style={{ width: co?.logo?.maxWidth ?? 160, maxWidth: "55vw", maxHeight: 72 }}
              className="h-auto object-contain"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="cp-heading cp-bold truncate text-xl">{name}</span>
          )}
        </a>
        {right && <div className={center ? "absolute right-5 lg:right-0" : ""}>{right}</div>}
      </div>
    </header>
  );
}

/**
 * Shopify's two-column checkout, to the measured proportions: a 500px form
 * column and a 400px summary column, 40px either side of the divide, which sits
 * 50px right of centre; the summary panel takes the store's summary colour.
 * (Stacked on mobile.)
 */
export function SplitLayout({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="lg:flex lg:min-h-[calc(100vh-93px)]">
      <div className="flex justify-end lg:w-[calc(50%+50px)] lg:shrink-0">
        <div className="w-full px-5 py-7 lg:max-w-[540px] lg:py-10 lg:pl-0 lg:pr-10">{main}</div>
      </div>
      <aside className="hidden flex-1 lg:block" style={{ background: "var(--co-summary-bg)" }}>
        <div className="sticky top-0 max-w-[440px] py-10 pl-10">{side}</div>
      </aside>
    </div>
  );
}

export function OrderSummary({
  lines, currency, shipping, discountBox = false,
}: { lines: Line[]; currency: string; shipping: number; discountBox?: boolean }) {
  const fmt = (n: number) => money(n, currency);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  // Shopify's summary column: 64px thumbnails with a quantity badge, 14px text,
  // a discount field with a muted Apply, and a 19px total with the currency code
  return (
    <div className="text-[14px]">
      <ul className="space-y-4">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-[14px]">
            <div className="relative shrink-0">
              <DemoImg src={l.image} alt={l.title} className="size-16 rounded-[8px] border border-[#dedede] bg-white object-cover" />
              <span className="absolute -right-2 -top-2 flex h-[21px] min-w-[21px] items-center justify-center rounded-full bg-black/85 px-1.5 text-[12px] font-semibold text-white">{l.qty}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="leading-[1.35]">{l.title}</div>
              {l.variant && <div className="mt-0.5 text-[12px] text-[#707070]">{l.variant}</div>}
            </div>
            <div className="text-right">
              {l.compareAt && l.compareAt > l.price && (
                <div className="text-[12px] text-[#707070] line-through">{fmt(l.compareAt * l.qty)}</div>
              )}
              {fmt(l.price * l.qty)}
            </div>
          </li>
        ))}
      </ul>
      {discountBox && (
        <div className="mt-6 flex gap-3">
          <label className="cp-field flex-1">
            <input placeholder=" " />
            <span>Discount code or gift card</span>
          </label>
          <button
            type="button"
            className="cp-bold h-[49px] border border-[#dedede] bg-[#f5f5f5] px-[18px] text-[14px] text-[#707070]"
            style={{ borderRadius: "var(--co-r-ctl)" }}
          >
            Apply
          </button>
        </div>
      )}
      <div className="mt-6 space-y-2">
        <div className="flex justify-between"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
        <div className="flex justify-between"><span>Shipping</span><span>{shipping ? fmt(shipping) : "Free"}</span></div>
        <div className="cp-bold flex items-baseline justify-between pt-2.5 text-[19px]">
          <span>Total</span>
          <span><span className="mr-2 text-[12px] font-normal text-[#707070]">{currency}</span>{fmt(subtotal + shipping)}</span>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label, value, defaultValue, onChange, type = "text", icon, error,
}: { label: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; type?: string; icon?: React.ReactNode; error?: string }) {
  // Shopify's floating-label field (see FIELD_CSS): the label is the placeholder
  // while empty and moves up once there's a value
  return (
    <div>
      <label className={`cp-field ${error ? "cp-invalid" : ""}`}>
        <input
          type={type}
          value={value}
          defaultValue={value === undefined ? defaultValue : undefined}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder=" "
          style={icon ? { paddingRight: 40 } : undefined}
        />
        <span>{label}</span>
        {icon && <i className="absolute right-[11px] top-1/2 -translate-y-1/2 not-italic text-[#707070]">{icon}</i>}
      </label>
      {error && <p className="mt-1.5 text-[13px] text-[#dd1d1d]">{error}</p>}
    </div>
  );
}

/** Shopify's checkbox: 18px, filled with the store's accent when ticked. */
export function Checkbox({ label, accent, checked, onChange }: { label: string; accent?: string; checked?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-[14px]">
      <input
        type="checkbox"
        checked={checked}
        defaultChecked={checked === undefined ? true : undefined}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="size-[18px] rounded-[4px]"
        style={{ accentColor: accent || "var(--co-accent)" }}
      />
      {label}
    </label>
  );
}

/** Mobile: the order summary collapses into a bar above the page (as on Shopify). */
export function MobileSummary({ accent, total, children }: { accent: string; total: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-neutral-200 bg-[#f5f5f5] lg:hidden">
      <button onClick={() => setOpen((v) => !v)} className="mx-auto flex w-full max-w-[600px] items-center justify-between px-5 py-4 text-sm">
        <span className="flex items-center gap-1.5" style={{ color: accent }}>
          Order summary <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
        <span className="text-base font-semibold">{total}</span>
      </button>
      {open && <div className="mx-auto max-w-[600px] px-5 pb-5">{children}</div>}
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div
      aria-live="polite"
      className={`fixed bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-neutral-900 px-5 py-2.5 text-[14px] font-medium text-white shadow-2xl transition-all duration-300 ${
        message ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      {message}
    </div>
  );
}

/** Toast state that clears itself. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 2400);
    return () => window.clearTimeout(t);
  }, [message]);
  return [message, setMessage] as const;
}

/** The store's real checkout design (see /api/clone-checkout); null when unavailable or slow. */
export async function loadCheckoutDesign(host: string): Promise<CheckoutBranding | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`/api/clone-checkout?host=${encodeURIComponent(host)}`, { signal: controller.signal });
    if (!res.ok) return null;
    return ((await res.json()) as { branding?: CheckoutBranding | null }).branding ?? null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
