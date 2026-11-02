"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CreditCard, Loader2, MapPin, Pencil, Plus, Trash2, UserRound, X } from "lucide-react";
import { DemoImg } from "@/components/sections/demo/DemoImg";
import { DEFAULT_ADDR, DEFAULT_EMAIL } from "@/components/sections/demo/DemoMock";
import {
  AnimatedCheck, Checkbox, Field, MobileSummary, money, OrderSummary, SplitLayout, StoreHeader, textOn, Toast, useToast,
  type Brand, type CatalogProduct, type Line,
} from "./shared";

// The order status / thank-you page with self-serve order editing: a live edit
// window, contact + address changes (with an address check), quantity edits,
// cancellation, adding items, and discounted "you may also like" add-ons.

type Section = "contact" | "shipping" | "order" | "cancel" | "add";
type AddOptions = { off?: number; variant?: number; qty?: number };
type Addr = typeof DEFAULT_ADDR & { line2: string; country: string };
const EDIT_WINDOW = 60 * 60;
const SUGGEST_OFF = 25;

/** Sections rise in one after another, after the check has drawn. */
const rise = (i: number): React.CSSProperties => ({ animationDelay: `${300 + i * 110}ms` });

export function ThankYouPage({
  brand, initialLines, catalog, orderNo, accent, currency, shipping,
}: {
  brand: Brand;
  /** what was paid for: the cart plus any accepted post-purchase offers */
  initialLines: Line[];
  catalog: CatalogProduct[];
  orderNo: string;
  accent: string;
  currency: string;
  shipping: number;
}) {
  const fmt = (n: number) => money(n, currency);
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [draft, setDraft] = useState<Line[]>(initialLines); // "Update your order" edits before they're applied
  const [paid, setPaid] = useState(() => initialLines.reduce((s, l) => s + l.price * l.qty, 0) + shipping);
  const [open, setOpen] = useState<Section | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [toast, setToast] = useToast();

  const [secs, setSecs] = useState(EDIT_WINDOW - 1);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [phone, setPhone] = useState("");
  const [addr, setAddr] = useState({ ...DEFAULT_ADDR, line2: "", country: "United States" });
  const [verified, setVerified] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [newsOptIn, setNewsOptIn] = useState(false);

  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const total = cancelled ? 0 : subtotal + shipping;
  const balance = cancelled ? 0 : Math.max(0, Math.round((total - paid) * 100) / 100);

  const suggestions = useMemo(() => {
    const inOrder = new Set(lines.map((l) => l.title.toLowerCase()));
    return catalog.filter((p) => !inOrder.has(p.title.toLowerCase())).slice(0, 8);
  }, [catalog, lines]);

  const toggle = (s: Section) => {
    setOpen((cur) => (cur === s ? null : s));
    if (s === "order") setDraft(lines);
  };

  const addProduct = (p: CatalogProduct, { off = 0, variant = 0, qty = 1 }: AddOptions = {}) => {
    const v = p.variants[variant] ?? p.variants[0];
    const full = v?.price ?? p.price;
    const price = off ? Math.round(full * (100 - off)) / 100 : full;
    setLines((ls) => [
      ...ls,
      { id: `add-${p.id}-${ls.length}`, title: p.title, variant: v && v.title !== "Default Title" ? v.title : "", price, compareAt: off ? full : undefined, qty, image: v?.image ?? p.images[0] ?? null },
    ]);
    setToast(`${p.title} added to your order`);
  };

  const applyOrder = () => {
    const sig = (ls: Line[]) => ls.map((l) => `${l.id}:${l.qty}`).join("|");
    if (sig(draft) === sig(lines)) { setToast("No changes to your order yet"); return; }
    const newTotal = draft.reduce((s, l) => s + l.price * l.qty, 0) + shipping;
    setLines(draft);
    if (newTotal < paid) {
      setToast(`Order updated — ${fmt(paid - newTotal)} refunded`);
      setPaid(newTotal);
    } else setToast("Order updated");
    setOpen(null);
  };

  const payBalance = () => {
    setCollecting(true);
    window.setTimeout(() => {
      setCollecting(false);
      setPaid(total);
      setToast(`${fmt(balance)} charged to your card`);
    }, 1400);
  };

  const mins = Math.floor(secs / 60);
  const summary = <OrderSummary lines={cancelled ? [] : lines} currency={currency} shipping={cancelled ? 0 : shipping} />;

  const main = (
    <>
      <div className="flex items-center gap-4">
        <AnimatedCheck color={accent} size={60} />
        <div className="cp-rise" style={rise(0)}>
          <div className="text-[15px] text-neutral-500">Confirmation #{orderNo}</div>
          <h1 className="cp-heading text-[28px] leading-tight">{cancelled ? "Your order is cancelled" : `Thank you, ${addr.first}!`}</h1>
        </div>
      </div>

      {cancelled ? (
        <div className="cp-rise mt-8 rounded-xl border border-neutral-200 p-6">
          <h2 className="cp-heading text-xl">Order cancelled</h2>
          <p className="mt-1.5 text-[15px] text-neutral-600">A refund of {fmt(paid)} has been issued to your original payment method.</p>
        </div>
      ) : (
        <div className="cp-rise mt-8 rounded-2xl border border-neutral-200 p-4 sm:p-5" style={rise(1)}>
          <p className="text-[16px] font-bold">
            You can make changes to your order for another{" "}
            <span className="text-[#e01b1b]">{mins} mins and {String(secs % 60).padStart(2, "0")} secs</span>
          </p>

          {balance > 0 && (
            <div className="mt-4 rounded-xl bg-[#fff6e5] p-4">
              <div className="flex items-baseline justify-between text-[15px]">
                <span className="font-semibold">Balance due</span>
                <span className="font-bold">{fmt(balance)}</span>
              </div>
              <p className="mt-1 text-[13px] text-neutral-600">You added to your order. Pay the difference to confirm the changes.</p>
              <button
                onClick={payBalance}
                disabled={collecting}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold"
                style={{ background: accent, color: textOn(accent) }}
              >
                {collecting ? <><Loader2 className="size-4 animate-spin" /> Processing…</> : `Pay ${fmt(balance)}`}
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3">
            <Accordion icon={UserRound} label="Change Contact Information" open={open === "contact"} onToggle={() => toggle("contact")}>
              <Field label="Email" value={email} onChange={setEmail} type="email" />
              <Field label="Phone" value={phone} onChange={setPhone} type="tel" />
              <Checkbox label="Update Profile" accent={accent} />
              <SolidButton accent={accent} onClick={() => { setOpen(null); setToast("Contact information updated"); }}>Change Contact Information</SolidButton>
            </Accordion>

            <Accordion
              icon={MapPin}
              label="Edit Shipping Address"
              open={open === "shipping"}
              onToggle={() => toggle("shipping")}
              badge={
                verified ? (
                  <span className="rounded-full bg-[#1f8a4c] px-2.5 py-1 text-[12px] font-bold text-white">Address verified</span>
                ) : (
                  <span className="rounded-full bg-neutral-500 px-2.5 py-1 text-[12px] font-bold text-white">Address check required</span>
                )
              }
            >
              <label className="relative block rounded-lg border border-neutral-300 bg-white px-3.5 pb-2 pt-6">
                <span className="pointer-events-none absolute left-3.5 top-2 text-[12px] text-neutral-500">Country</span>
                <select value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value })} className="w-full appearance-none bg-transparent text-[15px] outline-none">
                  {["United States", "Canada", "United Kingdom", "Australia", "India"].map((c) => <option key={c}>{c}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name" value={addr.first} onChange={(v) => setAddr({ ...addr, first: v })} />
                <Field label="Last Name" value={addr.last} onChange={(v) => setAddr({ ...addr, last: v })} />
              </div>
              <Field
                label="Address 1"
                value={addr.line1}
                onChange={(v) => { setAddr({ ...addr, line1: v }); setVerified(false); }}
                error={verified ? undefined : "Street address could not be fully validated. Please review."}
              />
              <Field label="Address 2" value={addr.line2} onChange={(v) => setAddr({ ...addr, line2: v })} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="City" value={addr.city} onChange={(v) => setAddr({ ...addr, city: v })} />
                <Field label="State" value={addr.state} onChange={(v) => setAddr({ ...addr, state: v })} />
                <Field label="ZIP Code" value={addr.zip} onChange={(v) => setAddr({ ...addr, zip: v })} />
              </div>
              <SolidButton accent={accent} onClick={() => setConfirming(true)}>Update Shipping Address</SolidButton>
            </Accordion>

            <Accordion icon={Pencil} label="Update your order" open={open === "order"} onToggle={() => toggle("order")}>
              <ul className="divide-y divide-neutral-200">
                {draft.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-3">
                    <DemoImg src={l.image} alt={l.title} className="size-14 shrink-0 rounded-lg border border-neutral-200 object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px]">{l.title}</div>
                      <div className="text-[13px] text-neutral-500">{[l.variant, fmt(l.price)].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div className="flex h-9 items-center rounded-lg border border-neutral-300">
                      <button aria-label="Decrease" onClick={() => setDraft((d) => d.map((x) => (x.id === l.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} className="w-8">−</button>
                      <span className="w-6 text-center text-sm">{l.qty}</span>
                      <button aria-label="Increase" onClick={() => setDraft((d) => d.map((x) => (x.id === l.id ? { ...x, qty: x.qty + 1 } : x)))} className="w-8">+</button>
                    </div>
                    <button
                      aria-label={`Remove ${l.title}`}
                      disabled={draft.length <= 1}
                      onClick={() => setDraft((d) => d.filter((x) => x.id !== l.id))}
                      className="flex size-9 items-center justify-center rounded-lg border border-neutral-300 text-neutral-500 disabled:opacity-30"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <SolidButton accent={accent} onClick={applyOrder}>Update your order</SolidButton>
            </Accordion>

            <Accordion icon={X} label="Cancel Your Order" open={open === "cancel"} onToggle={() => toggle("cancel")}>
              <p className="text-[15px] text-neutral-600">Cancel your order for {fmt(total)} and choose how you&apos;d like to be refunded.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { setCancelled(true); setOpen(null); setToast(`Refund of ${fmt(paid)} issued`); }} className="h-12 rounded-xl border border-red-200 text-[14px] font-bold text-red-600 hover:bg-red-50">
                  Refund to original payment
                </button>
                <button onClick={() => { setCancelled(true); setOpen(null); setToast(`${fmt(paid)} store credit issued`); }} className="h-12 rounded-xl border border-neutral-300 text-[14px] font-bold hover:bg-neutral-50">
                  Store credit
                </button>
              </div>
            </Accordion>

            <Accordion icon={Plus} label="Add More Items" open={open === "add"} onToggle={() => toggle("add")}>
              <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
                {suggestions.map((p) => (
                  <AddCard key={p.id} product={p} accent={accent} fmt={fmt} onAdd={(qty) => addProduct(p, { qty })} />
                ))}
              </div>
              <button
                onClick={() => setExploring(true)}
                className="h-14 w-full rounded-xl border-2 bg-[#f2f2ee] text-[16px] font-bold"
                style={{ borderColor: accent, color: accent }}
              >
                Explore all products
              </button>
            </Accordion>
          </div>
        </div>
      )}

      {!cancelled && suggestions.length > 0 && (
        <div className="cp-rise mt-6 rounded-2xl border border-neutral-200 p-4 sm:p-5" style={rise(2)}>
          <h2 className="cp-heading text-[22px]">You may also like these products</h2>
          <div className="-mx-1 mt-4 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
            {suggestions.map((p) => (
              <SuggestCard key={p.id} product={p} accent={accent} fmt={fmt} onBuy={(variant, qty) => addProduct(p, { off: SUGGEST_OFF, variant, qty })} />
            ))}
          </div>
        </div>
      )}

      {!cancelled && (
        <div className="cp-rise mt-6 overflow-hidden rounded-2xl border border-neutral-200" style={rise(3)}>
          <div className="p-5">
            <h2 className="cp-heading text-[22px]">Your order is confirmed</h2>
            <p className="mt-2 text-[16px]">You&apos;ll receive a confirmation email soon</p>
            <button onClick={() => setToast("Tracking link sent to your email")} className="mt-4 h-14 rounded-lg bg-[#5a31f4] px-7 text-[17px] font-medium text-white">
              Track order with <span className="font-bold">shop</span>
            </button>
          </div>
          <div className="border-t border-neutral-200 bg-[#f5f5f5] px-5 py-4">
            <Checkbox label="Email me with news and offers" accent={accent} checked={newsOptIn} onChange={setNewsOptIn} />
          </div>
        </div>
      )}

      <div className="cp-rise mt-6 rounded-2xl border border-neutral-200 p-5" style={rise(4)}>
        <h2 className="cp-heading text-[22px]">Order details</h2>
        <div className="mt-4 grid gap-6 text-[15px] sm:grid-cols-2">
          <div className="space-y-6">
            <Detail title="Contact information">{email}{phone && <><br />{phone}</>}</Detail>
            <Detail title="Shipping address"><Address addr={addr} /></Detail>
            <Detail title="Shipping method">Standard</Detail>
          </div>
          <div className="space-y-6">
            <Detail title="Payment method">
              <span className="flex items-center gap-2">
                <CreditCard className="size-7 text-neutral-400" strokeWidth={1.5} /> •••• 4242 · {fmt(paid)} {currency}
              </span>
            </Detail>
            <Detail title="Billing address"><Address addr={addr} /></Detail>
          </div>
        </div>
      </div>

      <div className="cp-rise mt-8 flex flex-wrap items-center justify-between gap-4" style={rise(5)}>
        <p className="text-[15px]">
          Need help? <span className="cursor-pointer underline underline-offset-2" style={{ color: accent }}>Contact us</span>
        </p>
        <a href={brand.home || "#"} className="inline-flex h-14 items-center rounded-xl px-8 text-[16px] font-bold" style={{ background: accent, color: textOn(accent) }}>
          Continue shopping
        </a>
      </div>
      <div className="mt-10 border-t border-neutral-200 pt-5 text-[14px] underline underline-offset-2" style={{ color: accent }}>Terms and policies</div>
    </>
  );

  return (
    <>
      <StoreHeader brand={brand} />
      <MobileSummary accent={accent} total={fmt(total)}>{summary}</MobileSummary>
      <SplitLayout main={main} side={<div className="cp-fade" style={{ animationDelay: "200ms" }}>{summary}</div>} />

      {confirming && (
        <AddressModal
          accent={accent}
          lines={[`${addr.first} ${addr.last}`, [addr.line1, addr.line2].filter(Boolean).join(", "), `${addr.city}, ${addr.state} ${addr.zip} ${addr.country === "United States" ? "US" : addr.country}`]}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            setVerified(true);
            setOpen(null);
            setToast("Shipping address updated");
          }}
        />
      )}
      {exploring && (
        <ExploreModal catalog={catalog} accent={accent} fmt={fmt} onClose={() => setExploring(false)} onBuy={(p) => addProduct(p)} />
      )}
      <Toast message={toast} />
    </>
  );
}

function Accordion({
  icon: Icon, label, open, onToggle, badge, children,
}: { icon: React.ComponentType<{ className?: string }>; label: string; open: boolean; onToggle: () => void; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5">
        <Icon className="size-5 shrink-0 text-neutral-600" />
        <span className="flex flex-wrap items-center gap-2 text-[16px] font-bold">{label}{badge}</span>
        <ChevronDown className={`ml-auto size-5 shrink-0 text-neutral-600 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="grid gap-3 px-4 pb-5 sm:px-5">{children}</div>}
    </div>
  );
}

function SolidButton({ accent, onClick, children }: { accent: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="mt-1 h-14 w-full rounded-xl text-[16px] font-bold transition-[filter] hover:brightness-110" style={{ background: accent, color: textOn(accent) }}>
      {children}
    </button>
  );
}

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-bold">{title}</div>
      <div className="mt-1 leading-relaxed text-neutral-600">{children}</div>
    </div>
  );
}

function AddressModal({ accent, lines, onCancel, onConfirm }: { accent: string; lines: string[]; onCancel: () => void; onConfirm: () => void }) {
  const [option, setOption] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-label="Select Shipping Option" className="w-full max-w-[720px] rounded-2xl bg-white p-6 shadow-2xl sm:p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="cp-heading text-[24px]">Select Shipping Option</h2>
          <button aria-label="Close" onClick={onCancel} className="text-neutral-600"><X className="size-6" /></button>
        </div>
        <div className="mt-5 rounded-xl border border-neutral-200 p-5 text-[16px] leading-relaxed">
          <div className="font-bold">Updated Shipping Address:</div>
          {lines.map((l) => <div key={l}>{l}</div>)}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border px-5 py-4 text-[15px]" style={{ borderColor: option ? accent : "#e5e5e5" }}>
          <input type="radio" checked={option} onChange={() => setOption(true)} className="size-[18px]" style={{ accentColor: accent }} />
          <span className="flex-1">Standard Shipping</span>
          <span className="font-bold">Free</span>
        </label>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <button onClick={onCancel} className="h-14 rounded-xl border border-neutral-200 text-[16px] font-bold text-neutral-600 hover:bg-neutral-50">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!option}
            className="h-14 rounded-xl text-[16px] font-bold transition-colors disabled:bg-neutral-100 disabled:text-neutral-400"
            style={option ? { background: accent, color: textOn(accent) } : undefined}
          >
            Confirm Address Update
          </button>
        </div>
      </div>
    </div>
  );
}

function Address({ addr }: { addr: Addr }) {
  return (
    <>
      {addr.first} {addr.last}<br />{addr.line1}{addr.line2 && <>, {addr.line2}</>}<br />{addr.city} {addr.state} {addr.zip}<br />{addr.country}
    </>
  );
}

function Qty({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex h-14 items-center justify-between rounded-xl border border-neutral-300 px-2 text-[17px] font-bold">
      <button aria-label="Decrease quantity" onClick={() => onChange(Math.max(1, value - 1))} className="w-10">-</button>
      <span className="tabular-nums">{value}</span>
      <button aria-label="Increase quantity" onClick={() => onChange(value + 1)} className="w-10">+</button>
    </div>
  );
}

type CardProps = { product: CatalogProduct; accent: string; fmt: (n: number) => string };

/** "Add More Items" card: full price, quantity, Add. */
function AddCard({ product: p, accent, fmt, onAdd }: CardProps & { onAdd: (qty: number) => void }) {
  const [qty, setQty] = useState(1);
  return (
    <div className="flex w-[240px] shrink-0 snap-start flex-col rounded-xl border border-neutral-200 p-5">
      <DemoImg src={p.images[0]} alt={p.title} className="aspect-square w-full rounded-lg object-contain" />
      <div className="mt-4 line-clamp-2 h-[2.8em] text-[16px] leading-snug">{p.title}</div>
      <div className="mt-3 whitespace-nowrap text-[17px] font-bold">{fmt(p.price)}</div>
      <div className="mt-auto pt-3"><Qty value={qty} onChange={setQty} /></div>
      <button onClick={() => { onAdd(qty); setQty(1); }} className="mt-4 h-14 shrink-0 rounded-xl text-[17px] font-bold" style={{ background: accent, color: textOn(accent) }}>
        Add
      </button>
    </div>
  );
}

/** "You may also like" card: discounted, variant + quantity, Buy now. */
function SuggestCard({ product: p, accent, fmt, onBuy }: CardProps & { onBuy: (variant: number, qty: number) => void }) {
  const [variant, setVariant] = useState(0);
  const [qty, setQty] = useState(1);
  const v = p.variants[variant];
  const full = v?.price ?? p.price;
  const deal = Math.round(full * (100 - SUGGEST_OFF)) / 100;
  const hasVariants = p.variants.some((x) => x.title !== "Default Title");
  return (
    <div className="flex w-[250px] shrink-0 snap-start flex-col rounded-xl border border-neutral-200 p-5">
      <span className="self-start rounded-full bg-[#fde2e4] px-2.5 py-1 text-[14px] font-bold text-[#b42318]">{SUGGEST_OFF}% OFF</span>
      <DemoImg src={v?.image ?? p.images[0]} alt={p.title} className="mt-3 aspect-square w-full rounded-lg object-contain" />
      <div className="mt-4 line-clamp-3 h-[4.2em] text-[16px] font-bold leading-snug">{p.title}</div>
      <div className="mt-2 flex items-baseline gap-2.5 whitespace-nowrap text-[18px]">
        <span className="text-neutral-400 line-through">{fmt(full)}</span>
        <span className="font-bold text-[#1f8a4c]">{fmt(deal)}</span>
      </div>
      {/* every card keeps the variant row, so prices, steppers and buttons line up across cards */}
      <label
        className={`relative mt-3 block rounded-xl border border-neutral-300 px-4 pb-2 pt-6 ${hasVariants ? "" : "invisible"}`}
        aria-hidden={!hasVariants}
      >
        <span className="pointer-events-none absolute left-4 top-2 text-[13px] text-neutral-500">Variant</span>
        <select
          value={variant}
          onChange={(e) => setVariant(Number(e.target.value))}
          disabled={!hasVariants}
          tabIndex={hasVariants ? undefined : -1}
          className="w-full appearance-none truncate bg-transparent pr-6 text-[16px] outline-none"
        >
          {p.variants.length ? p.variants.map((x, i) => <option key={x.id} value={i}>{x.title}</option>) : <option>Default</option>}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
      </label>
      <div className="mt-auto pt-3"><Qty value={qty} onChange={setQty} /></div>
      <button onClick={() => { onBuy(variant, qty); setQty(1); }} className="mt-4 h-14 shrink-0 rounded-xl text-[17px] font-bold" style={{ background: accent, color: textOn(accent) }}>
        Buy now
      </button>
    </div>
  );
}

function ExploreModal({
  catalog, accent, fmt, onClose, onBuy,
}: { catalog: CatalogProduct[]; accent: string; fmt: (n: number) => string; onClose: () => void; onBuy: (p: CatalogProduct) => void }) {
  const [q, setQ] = useState("");
  const shown = catalog.filter((p) => p.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add More Items"
        className="flex max-h-full w-full max-w-[1400px] flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 sm:px-9">
          <h2 className="cp-heading text-[26px]">Add More Items</h2>
          <button aria-label="Close" onClick={onClose} className="text-neutral-600"><X className="size-7" /></button>
        </div>
        <div className="px-6 pt-5 sm:px-9">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Products"
            className="h-14 w-full rounded-xl border border-neutral-300 px-4 text-[16px] outline-none focus:border-neutral-500"
          />
        </div>
        <div className="grid grid-cols-2 gap-4 overflow-y-auto px-6 py-5 sm:px-9 lg:grid-cols-4">
          {shown.map((p) => (
            <div key={p.id} className="flex flex-col rounded-xl border border-neutral-200 p-5">
              <DemoImg src={p.images[0]} alt={p.title} className="mx-auto aspect-square w-full max-w-[180px] rounded-xl object-contain" />
              <div className="mt-4 line-clamp-2 h-[2.8em] text-[16px] leading-snug">{p.title}</div>
              <div className="mb-4 mt-3 whitespace-nowrap text-[17px] font-bold">{fmt(p.price)}</div>
              <button onClick={() => onBuy(p)} className="mt-auto h-14 shrink-0 rounded-xl text-[17px] font-bold" style={{ background: accent, color: textOn(accent) }}>
                Buy Now
              </button>
            </div>
          ))}
          {!shown.length && <p className="col-span-full py-10 text-center text-neutral-500">No products match “{q}”.</p>}
        </div>
      </div>
    </div>
  );
}
