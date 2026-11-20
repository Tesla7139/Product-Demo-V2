"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DemoImg } from "@/components/sections/demo/DemoImg";
import { AnimatedCheck, money, type Brand, type CatalogProduct, type Line } from "./shared";

// Post-purchase offers, as Shopify stores run them after payment: a
// confirmation strip ("You've paid for your order."), then a "One-time offer!"
// page — one featured product and a row of more — with a five-minute countdown,
// and after a decline a "Last offer:" page. Every product has its own quantity
// and Pay now; declining asks once more before moving on.

const PCT = 20;
const OFFER_SECONDS = 5 * 60;
const SWITCH_MS = 900; // the spinner between pages
const PAY_MS = 1300;
const FIRST_BEAT_MS = 500; // the confirmation strip alone, before anything loads
const FIRST_LOAD_MS = 1600; // the first offer page's spinner

type OfferPage = { kind: "first" | "last"; featured: CatalogProduct | null; grid: CatalogProduct[] };

// offers come picked and ordered by the upsell engine (src/lib/upsell/engine.ts):
// the one-time offer, then the last offer (a downsell)
function buildPages(offers: CatalogProduct[]): OfferPage[] {
  if (!offers.length) return [];
  // one product per page, as Shopify's post-purchase page shows it
  const [featured, last] = offers;
  const pages: OfferPage[] = [{ kind: "first", featured, grid: [] }];
  if (last) pages.push({ kind: "last", featured: last, grid: [] });
  return pages;
}

export function UpsellPage({
  offers, orderNo, accent, currency, onDone,
}: {
  brand: Brand;
  offers: CatalogProduct[];
  orderNo: string;
  accent: string;
  currency: string;
  /** called after the last offer page, with the offers the shopper paid for */
  onDone: (accepted: Line[]) => void;
}) {
  const pages = useMemo(() => buildPages(offers), [offers]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(true); // the page "loads" first, as the real one does
  // on arrival the strip stands alone for a beat before the offers' spinner shows
  const [arrived, setArrived] = useState(false);
  const accepted = useRef<Line[]>([]);

  useEffect(() => {
    const t = window.setTimeout(() => setArrived(true), FIRST_BEAT_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!busy || !arrived) return;
    const t = window.setTimeout(() => setBusy(false), idx === 0 ? FIRST_LOAD_MS : SWITCH_MS);
    return () => window.clearTimeout(t);
  }, [busy, arrived, idx]);

  const next = (added?: Line) => {
    if (added) accepted.current = [...accepted.current, added];
    if (idx + 1 >= pages.length) {
      setBusy(true);
      window.setTimeout(() => onDone(accepted.current), SWITCH_MS);
      return;
    }
    window.scrollTo({ top: 0 });
    setBusy(true);
    setIdx(idx + 1);
  };

  const page = pages[idx];
  const link = "var(--co-accent)";

  return (
    <div className="min-h-screen" style={{ background: "var(--co-main-bg)" }}>
      <div className="border-b border-black/10">
        <div className="mx-auto flex max-w-[980px] items-start gap-3 px-5 py-5 lg:px-0">
          <span className="mt-0.5"><AnimatedCheck color={accent} size={26} /></span>
          <div className="leading-snug">
            <div className="text-[14px]">Confirmation #{orderNo}</div>
            <div className="cp-heading cp-bold text-[17px]">You&apos;ve paid for your order.</div>
            <button onClick={() => onDone(accepted.current)} className="text-[14px] underline underline-offset-2" style={{ color: link }}>
              View order confirmation ›
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[950px] px-5 pb-16 pt-6">
        {busy || !page ? (
          <div className="flex justify-center border-b border-black/10 py-8">
            {arrived ? <Spinner size={34} /> : <span className="h-[34px]" />}
          </div>
        ) : (
          <OfferPageView key={idx} page={page} currency={currency} onAccept={(l) => next(l)} onDecline={() => next()} />
        )}
      </div>
    </div>
  );
}

function OfferPageView({
  page, currency, onAccept, onDecline,
}: {
  page: OfferPage;
  currency: string;
  onAccept: (line: Line) => void;
  onDecline: () => void;
}) {
  const [secs, setSecs] = useState(OFFER_SECONDS);
  const [paying, setPaying] = useState<string | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const timer = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  const pay = (key: string, line: Line) => {
    if (paying) return;
    setPaying(key);
    window.setTimeout(() => onAccept(line), PAY_MS);
  };
  const cardProps = { currency, paying, onPay: pay };

  return (
    <div className="cp-fade">
      <div className="border-b border-black/10 pb-6 text-center">
        {page.kind === "first" ? (
          <>
            <div className="cp-bold text-[17px]">One-time offer!</div>
            <div className="mt-1 text-[17px]">Get this recommended item now at <b className="cp-bold">&nbsp;{PCT}% OFF!</b></div>
          </>
        ) : (
          <>
            <div className="cp-bold text-[22px]">Last offer:</div>
            <div className="mt-1 text-[17px]">Get this item at <b className="cp-bold">{PCT}% OFF!</b></div>
          </>
        )}
      </div>

      <div className="mt-8 rounded-[3px] border border-[#d5e9f3] bg-[#eaf6fc] py-3.5 text-center text-[17px]">
        Offer expires in: <span className="tabular-nums text-[#d0021b]">{timer}</span>
      </div>

      {page.featured && <Featured product={page.featured} onDecline={onDecline} {...cardProps} />}

      {page.grid.length > 0 && (
        <div className={`mt-8 grid gap-4 ${page.kind === "first" ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2"}`}>
          {page.grid.map((p) => <Card key={p.id} product={p} large={page.kind === "last"} {...cardProps} />)}
        </div>
      )}

      {/* the featured product has its own Decline; a second one only goes under a grid */}
      {page.grid.length > 0 && <DeclineButton disabled={!!paying} onDecline={onDecline} className="mt-4 w-full" />}
    </div>
  );
}

/* ------------------------------ one product ------------------------------ */

type Pick = ReturnType<typeof usePick>;

/** A product's chosen options and quantity, and the prices that follow. */
function usePick(product: CatalogProduct) {
  const [picked, setPicked] = useState<string[]>(() => product.variants[0]?.options ?? []);
  const [qty, setQty] = useState(1);
  const variant = product.variants.find((v) => v.options.every((o, i) => o === picked[i])) ?? product.variants[0];
  const full = variant?.price ?? product.price;
  const deal = Math.round(full * (100 - PCT)) / 100;
  const line: Line = {
    id: `upsell-${variant?.id ?? product.id}`,
    title: product.title,
    variant: variant && variant.title !== "Default Title" ? variant.title : "",
    price: deal,
    compareAt: full,
    qty,
    image: variant?.image ?? product.images[0] ?? null,
  };
  return { picked, setPicked, qty, setQty, variant, full, deal, line };
}

function Featured({
  product, currency, paying, onPay, onDecline,
}: { product: CatalogProduct; currency: string; paying: string | null; onPay: (key: string, line: Line) => void; onDecline: () => void }) {
  const pick = usePick(product);
  const fmt = (n: number) => money(n, currency);
  const images = [...new Set([pick.variant?.image, ...product.images].filter((s): s is string => !!s))].slice(0, 6);
  const [shown, setShown] = useState(0);
  const current = images[Math.min(shown, images.length - 1)] ?? null;
  const key = `f-${product.id}`;

  return (
    <div className="mt-8 grid gap-8 md:grid-cols-2">
      <div>
        <div className="mx-auto aspect-square max-w-[340px] overflow-hidden rounded-[4px] border border-black/10 bg-white">
          <DemoImg src={current} alt={product.title} className="size-full object-contain" />
        </div>
        {images.length > 1 && (
          <div className="mx-auto mt-4 flex max-w-[340px] items-center gap-2">
            <button aria-label="Previous image" onClick={() => setShown((shown - 1 + images.length) % images.length)} className="text-neutral-500">
              <ChevronLeft className="size-4" />
            </button>
            <div className="grid flex-1 grid-cols-3 gap-2">
              {[0, 1, 2].map((o) => {
                const i = (shown - 1 + o + images.length) % images.length;
                return (
                  <button key={o} onClick={() => setShown(i)} className={`aspect-square overflow-hidden rounded-[3px] ${i === shown ? "border border-black/15 bg-white p-1" : ""}`}>
                    <DemoImg src={images[i]} alt="" className="size-full object-cover" />
                  </button>
                );
              })}
            </div>
            <button aria-label="Next image" onClick={() => setShown((shown + 1) % images.length)} className="text-neutral-500">
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>

      <div className="text-[15px]">
        <h2 className="text-[17px]">{product.title}</h2>
        <Price full={pick.full} deal={pick.deal} fmt={fmt} />
        <Options product={product} pick={pick} />
        <QtyField pick={pick} />
        <div className="mt-4 space-y-1.5">
          <Row label="Subtotal" value={fmt(pick.full * pick.qty)} />
          <Row label="Discount" value={`-${fmt((pick.full - pick.deal) * pick.qty)}`} valueClass="text-[#1f8a4c]" />
          <Row label="Shipping" value="Free" />
        </div>
        <div className="mt-3 border-t border-black/10 pt-3">
          <Row label="Total" value={fmt(pick.deal * pick.qty)} big />
        </div>
        <Description text={product.description} />
        <PayButton busy={paying === key} disabled={!!paying} label={`Pay now • ${fmt(pick.deal * pick.qty)}`} onClick={() => onPay(key, pick.line)} className="mt-4 h-[52px] w-full" />
        <DeclineButton disabled={!!paying} onDecline={onDecline} className="mt-2 w-full" />
      </div>
    </div>
  );
}

function Card({
  product, large, currency, paying, onPay,
}: { product: CatalogProduct; large?: boolean; currency: string; paying: string | null; onPay: (key: string, line: Line) => void }) {
  const pick = usePick(product);
  const fmt = (n: number) => money(n, currency);
  const key = `c-${product.id}`;
  return (
    <div className="flex flex-col text-[14px]">
      <div className={`overflow-hidden bg-white ${large ? "aspect-[1/0.85]" : "aspect-square"}`}>
        <DemoImg src={pick.variant?.image ?? product.images[0] ?? null} alt={product.title} className="size-full object-cover" />
      </div>
      <div className="mt-3 line-clamp-2 min-h-[2.6em] text-[15px] leading-[1.3]">{product.title}</div>
      {large && <Description text={product.description} small />}
      <Price full={pick.full} deal={pick.deal} fmt={fmt} small />
      <div className="mt-auto">
        <Options product={product} pick={pick} small />
        <QtyField pick={pick} small />
        <PayButton busy={paying === key} disabled={!!paying} label={`Pay now • ${fmt(pick.deal * pick.qty)}`} onClick={() => onPay(key, pick.line)} className="mt-2 h-[48px] w-full text-[13px]" />
      </div>
    </div>
  );
}

/* -------------------------------- pieces -------------------------------- */

function Price({ full, deal, fmt, small }: { full: number; deal: number; fmt: (n: number) => string; small?: boolean }) {
  return (
    <div className={`mt-2 flex gap-1.5 ${small ? "text-[13px]" : "text-[14px]"}`}>
      <span className="text-[#d0021b] line-through">{fmt(full)}</span>
      <span className="text-neutral-700">{fmt(deal)}</span>
    </div>
  );
}

function Options({ product, pick, small }: { product: CatalogProduct; pick: Pick; small?: boolean }) {
  const real = product.options.filter((o) => o.values.length > 1); // a single value is nothing to choose
  if (!real.length) return null;
  return (
    <>
      {product.options.map((opt, oi) =>
        real.includes(opt) ? (
          <label key={opt.name} className={`cp-field mt-3 ${small ? "!h-[44px]" : ""}`}>
            <select value={pick.picked[oi]} onChange={(e) => pick.setPicked((p) => p.map((x, i) => (i === oi ? e.target.value : x)))} className="!pr-8">
              {opt.values.map((v) => <option key={v}>{v}</option>)}
            </select>
            <span>{opt.name}</span>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
          </label>
        ) : null
      )}
    </>
  );
}

function QtyField({ pick, small }: { pick: Pick; small?: boolean }) {
  return (
    <label className={`cp-field mt-3 ${small ? "!h-[44px]" : ""}`}>
      <input
        type="number"
        min={1}
        max={99}
        value={pick.qty}
        placeholder=" "
        onChange={(e) => pick.setQty(Math.min(99, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
      />
      <span>Quantity</span>
    </label>
  );
}

function Row({ label, value, valueClass = "", big }: { label: string; value: string; valueClass?: string; big?: boolean }) {
  return (
    <div className={`flex justify-between ${big ? "cp-bold text-[17px]" : ""}`}>
      <span>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function Description({ text, small }: { text: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className={small ? "mt-1.5" : "mt-4 border-t border-black/10 pt-3"}>
      <button onClick={() => setOpen(!open)} className={`flex items-center gap-1 text-neutral-600 ${small ? "text-[12px]" : "text-[14px]"}`}>
        Description <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className={`cp-fade mt-2 leading-relaxed text-neutral-600 ${small ? "text-[12px]" : "text-[14px]"}`}>{text}</p>}
    </div>
  );
}

function PayButton({
  label, busy, disabled, onClick, className = "",
}: { label: string; busy: boolean; disabled: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center rounded-[var(--co-r-btn)] px-2 font-medium transition-[filter,opacity] hover:brightness-110 disabled:cursor-default ${disabled && !busy ? "opacity-60" : ""} ${className}`}
      style={{ background: "var(--co-button)", color: "var(--co-button-text)" }}
    >
      {busy ? <Spinner size={18} /> : label}
    </button>
  );
}

/** Decline asks once more ("Are you sure…?") before it moves on. */
function DeclineButton({ onDecline, disabled, className = "" }: { onDecline: () => void; disabled: boolean; className?: string }) {
  const [sure, setSure] = useState(false);
  return (
    <button
      onClick={() => (sure ? onDecline() : setSure(true))}
      disabled={disabled}
      className={`h-[52px] rounded-[var(--co-r-btn)] border border-black/10 text-[14px] transition-colors hover:bg-black/[.03] ${className}`}
      style={{ color: "var(--co-button)" }}
    >
      {sure ? "Are you sure you want to decline this offer?" : "Decline this offer"}
    </button>
  );
}

function Spinner({ size }: { size: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-r-transparent"
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}
