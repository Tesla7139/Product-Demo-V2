"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DemoImg } from "@/components/sections/demo/DemoImg";
import { mockStore } from "@/lib/site";

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

/** Store fonts + the heading face as a CSS variable, applied by <StoreFrame>. */
export function StoreFrame({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  const f = brand.fonts;
  return (
    <div
      className="cp-store min-h-screen bg-white text-[#1a1a1a] antialiased"
      style={{ fontFamily: f?.body || undefined, ["--cp-heading" as string]: f?.heading || f?.body || "inherit" }}
    >
      {f?.css && <style dangerouslySetInnerHTML={{ __html: f.css }} />}
      <style>{`.cp-store .cp-heading{font-family:var(--cp-heading)}${MOTION_CSS}`}</style>
      {children}
    </div>
  );
}

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

export function StoreHeader({ brand, right }: { brand: Brand; right?: React.ReactNode }) {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex h-16 max-w-[1100px] items-center justify-between px-5 lg:h-20">
        <StoreLogo brand={brand} />
        {right}
      </div>
    </header>
  );
}

/** Two-column Shopify layout: content on white, order summary on grey (stacked on mobile). */
export function SplitLayout({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="lg:flex lg:min-h-[calc(100vh-5rem)]">
      <div className="flex flex-1 justify-end">
        <div className="w-full max-w-[600px] px-5 py-7 lg:py-10 lg:pr-12">{main}</div>
      </div>
      <aside className="hidden flex-1 border-l border-neutral-200 bg-[#f5f5f5] lg:block">
        <div className="sticky top-0 max-w-[480px] px-10 py-10">{side}</div>
      </aside>
    </div>
  );
}

export function OrderSummary({
  lines, currency, shipping, discountBox = false,
}: { lines: Line[]; currency: string; shipping: number; discountBox?: boolean }) {
  const fmt = (n: number) => money(n, currency);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return (
    <div className="text-[15px]">
      <ul className="space-y-4">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-4">
            <div className="relative shrink-0">
              <DemoImg src={l.image} alt={l.title} className="size-16 rounded-lg border border-neutral-200 bg-white object-cover" />
              <span className="absolute -right-2 -top-2 flex size-[22px] items-center justify-center rounded-full bg-neutral-900 text-[12px] font-semibold text-white">{l.qty}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="leading-snug">{l.title}</div>
              {l.variant && <div className="text-[13px] text-neutral-500">{l.variant}</div>}
            </div>
            <div className="text-right">
              {l.compareAt && l.compareAt > l.price && (
                <div className="text-[13px] text-neutral-400 line-through">{fmt(l.compareAt * l.qty)}</div>
              )}
              {fmt(l.price * l.qty)}
            </div>
          </li>
        ))}
      </ul>
      {discountBox && (
        <div className="mt-6 flex gap-3">
          <input placeholder="Discount code or gift card" className="h-12 flex-1 rounded-md border border-neutral-300 bg-white px-3.5 text-sm outline-none focus:border-neutral-500" />
          <button type="button" className="h-12 rounded-md border border-neutral-300 bg-neutral-100 px-5 text-sm font-semibold text-neutral-500">Apply</button>
        </div>
      )}
      <div className="mt-6 space-y-2.5">
        <div className="flex justify-between"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
        <div className="flex justify-between"><span>Shipping</span><span>{shipping ? fmt(shipping) : "Free"}</span></div>
        <div className="flex items-baseline justify-between pt-2 text-[21px] font-bold">
          <span>Total</span>
          <span><span className="mr-2 text-xs font-normal text-neutral-500">{currency}</span>{fmt(subtotal + shipping)}</span>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label, value, defaultValue, onChange, type = "text", icon, error,
}: { label: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; type?: string; icon?: React.ReactNode; error?: string }) {
  return (
    <div>
      <label className={`relative block rounded-lg border bg-white px-3.5 pb-2 pt-6 ${error ? "border-red-600" : "border-neutral-300 focus-within:border-neutral-600"}`}>
        <span className="pointer-events-none absolute left-3.5 top-2 text-[12px] text-neutral-500">{label}</span>
        <input
          type={type}
          value={value}
          defaultValue={value === undefined ? defaultValue : undefined}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          className="w-full bg-transparent text-[15px] outline-none"
        />
        {icon && <span className="absolute right-3.5 top-1/2 -translate-y-1/2">{icon}</span>}
      </label>
      {error && <p className="mt-1.5 text-[14px] text-red-600">{error}</p>}
    </div>
  );
}

export function Checkbox({ label, accent, checked, onChange }: { label: string; accent: string; checked?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-[15px]">
      <input
        type="checkbox"
        checked={checked}
        defaultChecked={checked === undefined ? true : undefined}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        className="size-[18px]"
        style={{ accentColor: accent }}
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
