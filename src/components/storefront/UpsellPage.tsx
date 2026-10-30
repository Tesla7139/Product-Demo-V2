"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { DemoImg } from "@/components/sections/demo/DemoImg";
import { money, StoreLogo, textOn, type Brand, type CatalogProduct, type Line } from "./shared";

// Post-purchase offers shown right after payment: one product at a time, a
// limited-time discount, the product's real options, Pay now / Decline.

const DISCOUNTS = [20, 25, 25];
const OFFER_SECONDS = 5 * 60;

export function UpsellPage({
  brand, offers, orderNo, accent, currency, onDone,
}: {
  brand: Brand;
  offers: CatalogProduct[];
  orderNo: string;
  accent: string;
  currency: string;
  /** called after the last offer, with the offers the shopper paid for */
  onDone: (accepted: Line[]) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [accepted, setAccepted] = useState<Line[]>([]);
  const [secs, setSecs] = useState(OFFER_SECONDS);

  useEffect(() => {
    const id = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const offer = offers[idx];
  const pct = DISCOUNTS[idx] ?? 25;
  const timer = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  const next = (added?: Line) => {
    const all = added ? [...accepted, added] : accepted;
    setAccepted(all);
    if (idx + 1 >= offers.length) onDone(all);
    else {
      setIdx(idx + 1);
      window.scrollTo(0, 0);
    }
  };

  return (
    <div>
      <div className="border-b border-neutral-200">
        <div className="mx-auto max-w-[1100px] px-5 py-5 lg:px-10">
          <StoreLogo brand={brand} className="max-h-7 max-w-[150px] object-contain" />
          <div className="mt-2 flex items-start gap-3">
            <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: accent, color: accent }}>
              <Check className="size-4" strokeWidth={2.5} />
            </span>
            <div>
              <div className="text-[15px]">Confirmation #{orderNo}</div>
              <div className="cp-heading text-[22px] leading-tight">You&apos;ve paid for your order.</div>
              <button onClick={() => onDone(accepted)} className="mt-0.5 text-[15px] underline underline-offset-2" style={{ color: accent }}>
                View order confirmation ›
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-neutral-200 bg-[#f7f7f7] px-5 py-5 text-center">
        <div className="text-[17px] font-bold">Just for you · {pct}% off · Ends in {timer}</div>
        <div className="cp-heading mt-2 text-[16px] text-neutral-700">Add it to your current order. Same box, no extra shipping.</div>
      </div>

      {offer && (
        <Offer
          key={offer.id}
          offer={offer}
          pct={pct}
          position={`Offer ${idx + 1} of ${offers.length}`}
          accent={accent}
          currency={currency}
          onAccept={(line) => next(line)}
          onDecline={() => next()}
        />
      )}
    </div>
  );
}

function Offer({
  offer, pct, position, accent, currency, onAccept, onDecline,
}: {
  offer: CatalogProduct;
  pct: number;
  position: string;
  accent: string;
  currency: string;
  onAccept: (line: Line) => void;
  onDecline: () => void;
}) {
  const fmt = (n: number) => money(n, currency);
  const [picked, setPicked] = useState<string[]>(() => offer.variants[0]?.options ?? []);
  const [paying, setPaying] = useState<"idle" | "paying" | "done">("idle");

  const variant = useMemo(
    () => offer.variants.find((v) => v.options.every((o, i) => o === picked[i])) ?? offer.variants[0],
    [offer.variants, picked]
  );
  const full = variant?.price ?? offer.price;
  const deal = Math.round(full * (100 - pct)) / 100;

  // gallery: the selected variant's image first, then the rest
  const images = [...new Set([variant?.image, ...offer.images].filter((src): src is string => !!src))].slice(0, 6);
  const [shown, setShown] = useState(0);
  const current = images[Math.min(shown, images.length - 1)] ?? null;

  const pay = () => {
    if (paying !== "idle") return;
    setPaying("paying");
    window.setTimeout(() => setPaying("done"), 1400);
    window.setTimeout(
      () =>
        onAccept({
          id: `upsell-${variant?.id ?? offer.id}`,
          title: offer.title,
          variant: variant && variant.title !== "Default Title" ? variant.title : "",
          price: deal,
          compareAt: full,
          qty: 1,
          image: variant?.image ?? offer.images[0] ?? null,
        }),
      2100
    );
  };

  return (
    <div className="mx-auto grid max-w-[1100px] gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-14 lg:px-10">
      <div>
        <div className="flex aspect-square items-center justify-center overflow-hidden bg-[#f2f2f0]">
          <DemoImg src={current} alt={offer.title} className="size-full object-contain" />
        </div>
        {images.length > 1 && (
          <>
            <div className="mt-4 flex items-center justify-end gap-5 text-[17px] font-bold">
              <button aria-label="Previous image" onClick={() => setShown((shown - 1 + images.length) % images.length)}><ArrowLeft className="size-5" /></button>
              <span className="tabular-nums">{shown + 1} / {images.length}</span>
              <button aria-label="Next image" onClick={() => setShown((shown + 1) % images.length)}><ArrowRight className="size-5" /></button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {images.map((src, i) => (
                <button key={src} onClick={() => setShown(i)} className="pb-2" style={{ borderBottom: `4px solid ${i === shown ? accent : "transparent"}` }}>
                  <DemoImg src={src} alt="" className="aspect-square w-full bg-[#f2f2f0] object-cover" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div>
        <div className="text-[15px] text-neutral-500">{position}</div>
        <h1 className="cp-heading mt-2 text-[32px] leading-[1.15] lg:text-[40px]">{offer.title}</h1>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[22px] font-bold lg:text-[26px]">
          <span>{fmt(deal)}</span>
          <span className="text-[20px] font-normal text-neutral-400 line-through">{fmt(full)}</span>
          <span className="text-[20px] text-[#1f8a4c]">· Save {pct}%</span>
        </div>
        {offer.description && <p className="mt-4 text-[15px] leading-relaxed text-neutral-500">{offer.description}</p>}

        {offer.options.map((opt, oi) => (
          <OptionPicker
            key={opt.name}
            name={opt.name}
            values={opt.values}
            value={picked[oi]}
            accent={accent}
            onPick={(v) => { setPicked((p) => p.map((x, i) => (i === oi ? v : x))); setShown(0); }}
          />
        ))}

        <div className="mt-6 space-y-3 border-t border-neutral-200 pt-5 text-[15px]">
          <div className="flex justify-between"><span>Subtotal</span><span className="font-bold">{fmt(deal)}</span></div>
          <div className="flex justify-between"><span>Shipping</span><span className="font-bold">Free</span></div>
          <div className="flex justify-between"><span>Taxes</span><span className="font-bold">Free</span></div>
          <div className="flex justify-between border-t border-neutral-200 pt-4"><span>Total</span><span className="font-bold">{fmt(deal)}</span></div>
        </div>

        <button
          onClick={pay}
          disabled={paying !== "idle"}
          className="mt-6 flex h-[60px] w-full items-center justify-center gap-2 rounded-lg text-[18px] font-bold transition-[filter] hover:brightness-110"
          style={{ background: accent, color: textOn(accent) }}
        >
          {paying === "paying" ? (
            <><Loader2 className="size-5 animate-spin" /> Processing…</>
          ) : paying === "done" ? (
            <><Check className="size-5" strokeWidth={3} /> Added to your order</>
          ) : (
            <>Pay now · {fmt(deal)} {currency}</>
          )}
        </button>
        <button
          onClick={onDecline}
          disabled={paying !== "idle"}
          className="mt-2 h-[60px] w-full rounded-lg border border-neutral-200 text-[18px] font-bold transition-colors hover:bg-neutral-50"
        >
          Decline this offer
        </button>
      </div>
    </div>
  );
}

function OptionPicker({ name, values, value, accent, onPick }: { name: string; values: string[]; value?: string; accent: string; onPick: (v: string) => void }) {
  const segmented = values.length <= 3 && !/size/i.test(name);
  return (
    <div className="mt-6">
      <div className="text-[15px]">{name}: <span className="font-bold">{value}</span></div>
      {segmented ? (
        <div className="mt-2.5 flex rounded-lg bg-neutral-100 p-1">
          {values.map((v) => (
            <button
              key={v}
              onClick={() => onPick(v)}
              className={`h-12 flex-1 rounded-md text-[16px] transition-colors ${v === value ? "bg-white font-bold shadow-sm" : "text-neutral-700"}`}
              style={v === value ? { color: accent } : undefined}
            >
              {v}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {values.map((v) => {
            const on = v === value;
            return (
              <button
                key={v}
                onClick={() => onPick(v)}
                className="h-12 min-w-[64px] rounded-lg border px-4 text-[15px] font-bold transition-colors"
                style={on ? { background: accent, borderColor: accent, color: textOn(accent) } : { borderColor: "#d4d4d4", color: accent }}
              >
                {v}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
