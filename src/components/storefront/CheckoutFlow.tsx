"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleHelp, CreditCard, Loader2, Lock, Search, ShoppingBag } from "lucide-react";
import { DEFAULT_ADDR, DEFAULT_EMAIL, DEFAULT_PHONE } from "@/components/sections/demo/DemoMock";
import {
  Checkbox, Field, loadCatalog, loadCheckoutDesign, MobileSummary, money, orderNumber, OrderSummary, readSession, shippingFee, SplitLayout,
  StoreFrame, StoreHeader, textOn, type Brand, type CatalogProduct, type Line,
} from "./shared";
import { UpsellPage } from "./UpsellPage";
import { readDemoMode, showsEditing, showsUpsells, type DemoMode } from "@/lib/demoMode";
import { ThankYouPage } from "./ThankYouPage";
import { pickOffers } from "@/lib/upsell/engine";
import type { CheckoutBranding, ExpressWallet } from "@/lib/clone/checkoutBranding";

// The order flow that follows the storefront copy: checkout → post-purchase
// offers → thank-you page with order editing. The cart and the store's look
// (name, logo, button colour, fonts, currency) are left in sessionStorage by
// /clone-runtime.js.

// processing: Shopify's blank checkout frame while the order goes through
type Stage = "checkout" | "processing" | "upsell" | "thankyou";

const PROCESSING_MS = { blank: 500, skeleton: 1000, clear: 500 };

export function CheckoutFlow() {
  const [loaded, setLoaded] = useState(false);
  const [cart, setCart] = useState<Line[]>([]);
  const [brand, setBrand] = useState<Brand>({});
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [stage, setStage] = useState<Stage>("checkout");
  const [accepted, setAccepted] = useState<Line[]>([]);
  // order editing, upsells or both: picked on the start screen
  const [mode, setMode] = useState<DemoMode>("both");
  const [orderNo] = useState(orderNumber);
  // the store's real checkout design (undefined while it's being read)
  const [design, setDesign] = useState<CheckoutBranding | null | undefined>(undefined);

  useEffect(() => {
    const b = readSession<Brand>("cp-brand") ?? {};
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from the session the storefront copy wrote */
    setBrand(b);
    setMode(readDemoMode());
    setCart(readSession<{ items: Line[] }>("cp-cart")?.items ?? []);
    setLoaded(true);
    // paid on the store's captured checkout (/preview/store-checkout): carry straight on
    if (new URLSearchParams(window.location.search).get("start") === "processing") setStage("processing");
    /* eslint-enable react-hooks/set-state-in-effect */
    if (b.name) document.title = `Checkout - ${b.name}`;
    if (b.host) {
      loadCatalog(b.host).then((c) => { setCatalog(c); setCatalogReady(true); });
      loadCheckoutDesign(b.host).then(setDesign);
    } else {
      setDesign(null);
      setCatalogReady(true);
    }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  // offers come from the catalog; without any, payment goes straight to the confirmation
  // the upsell engine's two picks for this cart (src/lib/upsell/engine.ts)
  const picks = useMemo(() => pickOffers(cart, catalog), [cart, catalog]);
  const offers = useMemo(() => [picks.first, picks.last].flatMap((r) => (r ? [r.product] : [])), [picks]);
  useEffect(() => {
    if (!catalogReady || !cart.length) return;
    const row = (r: (typeof picks.ranked)[number]) => ({ product: r.product.title, price: r.product.price, score: +r.score.toFixed(2), why: r.reasons.join("; ") });
    console.info("[upsell] cart:", cart.map((l) => `${l.title} × ${l.qty} @ ${l.price}`).join(", "));
    console.info("[upsell] one-time offer:", picks.first ? row(picks.first) : "none fits", "| last offer:", picks.last ? row(picks.last) : "none");
    console.table(picks.ranked.slice(0, 10).map(row));
  }, [picks, catalogReady, cart]);
  const hasOffers = showsUpsells(mode) && offers.length > 0;
  const processing = stage === "processing";
  // Shopify's processing page: the frame with its logo faded, then a grey
  // skeleton of the checkout, then the page clears for the post-purchase one
  const [phase, setPhase] = useState<"blank" | "skeleton" | "clear">("blank");
  const designIn = design !== undefined;
  useEffect(() => {
    // the phases are the store's frame: they start once its design is in
    if (!processing || !designIn) return;
    const a = window.setTimeout(() => setPhase("skeleton"), PROCESSING_MS.blank);
    const b = window.setTimeout(() => setPhase("clear"), PROCESSING_MS.blank + PROCESSING_MS.skeleton);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [processing, designIn]);
  useEffect(() => {
    // the offers are picked from the catalog: hold the frame until it's in
    if (!processing || phase !== "clear" || !catalogReady) return;
    const t = window.setTimeout(() => setStage(hasOffers ? "upsell" : "thankyou"), PROCESSING_MS.clear);
    return () => window.clearTimeout(t);
  }, [processing, phase, catalogReady, hasOffers]);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-white">
        <div className="h-16 border-b border-neutral-200 lg:h-20" />
        <SplitLayout main={<FormSkeleton />} side={<SummarySkeleton />} />
      </div>
    );
  }

  const currency = brand.currency || "USD";
  // with the store's checkout design, every page in the flow wears it (as Shopify's do)
  const styled: Brand = { ...brand, checkout: design ?? null };
  const accent = design?.button || brand.accent || "#111827";
  const shipping = shippingFee(cart.reduce((s, l) => s + l.price * l.qty, 0));

  let page: React.ReactNode;
  if (!cart.length) {
    page = (
      <>
        <StoreHeader brand={styled} />
        <div className="mx-auto max-w-md px-5 py-24 text-center">
          <h1 className="cp-heading text-2xl">Your cart is empty</h1>
          {brand.home && (
            <a href={brand.home} className="mt-6 inline-block rounded-md px-6 py-3 text-sm font-semibold" style={{ background: accent, color: textOn(accent) }}>
              Continue shopping
            </a>
          )}
        </div>
      </>
    );
  } else if (processing) {
    // the order going through: the checkout's frame, empty, as Shopify shows it
    page = design === undefined ? (
      <div className="min-h-screen bg-white" />
    ) : phase === "clear" ? (
      <div className="min-h-screen" style={{ background: "var(--co-main-bg)" }} aria-busy="true" aria-label="Processing your order" />
    ) : (
      <div aria-busy="true" aria-label="Processing your order">
        <div className={phase === "blank" ? "opacity-[0.08]" : "transition-opacity duration-200"}>
          <StoreHeader brand={styled} />
        </div>
        <SplitLayout
          main={phase === "skeleton" ? <ProcessingSkeleton /> : <div className="min-h-[60vh]" />}
          side={phase === "skeleton" ? <ProcessingSummarySkeleton /> : null}
        />
      </div>
    );
  } else if (stage === "upsell" && offers.length) {
    page = (
      <UpsellPage
        brand={styled}
        offers={offers}
        orderNo={orderNo}
        accent={accent}
        currency={currency}
        onDone={(lines) => { setAccepted(lines); setStage("thankyou"); }}
      />
    );
  } else if (stage !== "checkout") {
    page = (
      <ThankYouPage
        brand={styled}
        initialLines={[...cart, ...accepted]}
        catalog={catalog}
        orderNo={orderNo}
        accent={accent}
        currency={currency}
        shipping={shipping}
        editing={showsEditing(mode)}
        upsells={showsUpsells(mode)}
      />
    );
  } else {
    page = (
      <Checkout brand={styled} lines={cart} currency={currency} shipping={shipping} designPending={design === undefined} onPaid={() => setStage("processing")} />
    );
  }

  return <StoreFrame brand={styled}>{page}</StoreFrame>;
}

function Checkout({
  brand, lines, currency, shipping, designPending, onPaid,
}: { brand: Brand; lines: Line[]; currency: string; shipping: number; designPending: boolean; onPaid: () => void }) {
  const co = brand.checkout;
  const [paying, setPaying] = useState<"card" | ExpressWallet | null>(null);
  const [beat, setBeat] = useState(false); // a beat of skeleton, as a real checkout loads
  const ready = beat && !designPending;
  const fmt = (n: number) => money(n, currency);
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0) + shipping;

  useEffect(() => {
    const t = window.setTimeout(() => setBeat(true), 700);
    return () => window.clearTimeout(t);
  }, []);

  // card: the Pay now button spins, then the processing screen takes over;
  // express wallets: their own button spins a little longer, as the wallet "confirms"
  const startPay = (how: "card" | ExpressWallet) => {
    if (paying) return;
    setPaying(how);
    window.setTimeout(onPaid, how === "card" ? 1800 : 1500);
  };

  const summary = <OrderSummary lines={lines} currency={currency} shipping={shipping} discountBox />;
  const express = co?.express ?? [];

  const form = (
    <form onSubmit={(e) => { e.preventDefault(); startPay("card"); }}>
      {express.length > 0 && (
        <section className="mb-8">
          <p className="text-center text-[14px] text-[#707070]">Express checkout</p>
          <div
            className={`mt-3 gap-2.5 ${express.length === 1 ? "flex justify-center" : "grid"}`}
            style={express.length > 1 ? { gridTemplateColumns: `repeat(${express.length}, minmax(0, 1fr))` } : undefined}
          >
            {express.map((w) => (
              <WalletButton key={w} wallet={w} single={express.length === 1} busy={paying === w} onClick={() => startPay(w)} />
            ))}
          </div>
          <div className="mt-6 flex items-center gap-4 text-[14px] text-[#707070]">
            <span className="h-px flex-1 bg-[#dedede]" />
            OR
            <span className="h-px flex-1 bg-[#dedede]" />
          </div>
        </section>
      )}

      <Section title="Contact" aside={<span className="text-[14px] underline underline-offset-2" style={{ color: "var(--co-accent)" }}>Sign in</span>}>
        <Field label="Email" defaultValue={DEFAULT_EMAIL} type="email" />
        <Checkbox label="Email me with news and offers" />
      </Section>

      <Section title="Delivery">
        <Field label="Country/Region" defaultValue="United States" icon={<ChevronDown className="size-4" />} />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="First name" defaultValue={DEFAULT_ADDR.first} />
          <Field label="Last name" defaultValue={DEFAULT_ADDR.last} />
        </div>
        <Field label="Address" defaultValue={DEFAULT_ADDR.line1} icon={<Search className="size-4" />} />
        <Field label="Apartment, suite, etc. (optional)" />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Field label="City" defaultValue={DEFAULT_ADDR.city} />
          <Field label="State" defaultValue={DEFAULT_ADDR.state} icon={<ChevronDown className="size-4" />} />
          <Field label="ZIP code" defaultValue={DEFAULT_ADDR.zip} />
        </div>
        <Field label="Phone" defaultValue={DEFAULT_PHONE} type="tel" icon={<CircleHelp className="size-4" />} />
        <Checkbox label="Save this information for next time" checked={false} onChange={() => {}} />
      </Section>

      <Section title="Shipping method">
        <div
          className="flex items-center justify-between border px-[14px] py-4 text-[14px]"
          style={{ borderColor: "var(--co-accent)", borderRadius: "var(--co-r-ctl)", background: "color-mix(in srgb, var(--co-accent) 5%, white)" }}
        >
          <span>Standard</span>
          <span className="cp-bold">{fmt(shipping)}</span>
        </div>
      </Section>

      <Section title="Payment" hint="All transactions are secure and encrypted.">
        <div className="overflow-hidden border" style={{ borderColor: "var(--co-accent)", borderRadius: "var(--co-r-ctl)" }}>
          <div
            className="flex items-center gap-3 border-b px-[14px] py-[15px] text-[14px]"
            style={{ borderColor: "var(--co-accent)", background: "color-mix(in srgb, var(--co-accent) 5%, white)" }}
          >
            <span className="flex size-[18px] items-center justify-center rounded-full border-[5px]" style={{ borderColor: "var(--co-accent)" }} />
            Credit card
            <CreditCard className="ml-auto size-5 text-[#707070]" strokeWidth={1.5} />
          </div>
          <div className="grid gap-2.5 bg-[#f5f5f5] p-[14px]">
            <Field label="Card number" defaultValue="4242 4242 4242 4242" icon={<Lock className="size-4" />} />
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Expiration date (MM / YY)" defaultValue="12 / 29" />
              <Field label="Security code" defaultValue="123" icon={<CircleHelp className="size-4" />} />
            </div>
            <Field label="Name on card" defaultValue={`${DEFAULT_ADDR.first} ${DEFAULT_ADDR.last}`} />
            <Checkbox label="Use shipping address as billing address" />
          </div>
        </div>
      </Section>

      <button
        type="submit"
        disabled={!!paying}
        className="cp-bold flex h-[50px] w-full items-center justify-center gap-2 text-[15px] transition-[filter] hover:brightness-110 disabled:opacity-95"
        style={{ background: "var(--co-button)", color: "var(--co-button-text)", borderRadius: "var(--co-r-btn)" }}
      >
        {paying === "card" ? <><Loader2 className="size-[18px] animate-spin" /> Processing...</> : "Pay now"}
      </button>

      <div className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-[#dedede] pt-4 text-[12px] underline underline-offset-2" style={{ color: "var(--co-accent)" }}>
        <span>Refund policy</span>
        <span>Shipping</span>
        <span>Privacy policy</span>
        <span>Terms of service</span>
      </div>
    </form>
  );

  return (
    <>
      <StoreHeader brand={brand} right={<a href={brand.home || "#"} aria-label="Back to store"><ShoppingBag className="size-[22px]" /></a>} />
      {ready ? (
        <>
          <MobileSummary accent={co?.accent || "var(--co-accent)"} total={fmt(total)}>{summary}</MobileSummary>
          <SplitLayout main={<div className="cp-fade">{form}</div>} side={<div className="cp-fade">{summary}</div>} />
        </>
      ) : (
        <SplitLayout main={<FormSkeleton />} side={<SummarySkeleton />} />
      )}
    </>
  );
}

/**
 * Express wallet buttons as Shopify draws them: one alone is centred at 262px,
 * several share the row. Brand wordmarks are set in type, not the wallets' logos.
 */
function WalletButton({ wallet, single, busy, onClick }: { wallet: ExpressWallet; single: boolean; busy: boolean; onClick: () => void }) {
  const look = {
    shop_pay: { bg: "#5a31f4", label: <span className="text-[22px] font-extrabold lowercase tracking-[-0.03em] text-white">shop</span>, name: "Shop Pay" },
    paypal: {
      bg: "#ffc439",
      label: <span className="text-[20px] font-extrabold italic tracking-[-0.02em]"><span className="text-[#003087]">Pay</span><span className="text-[#009cde]">Pal</span></span>,
      name: "PayPal",
    },
    google_pay: {
      bg: "#000",
      label: (
        <span className="flex items-center gap-1 text-[20px] font-medium text-white">
          <span className="font-bold" style={{ background: "conic-gradient(from -45deg, #ea4335 0 25%, #4285f4 0 50%, #34a853 0 75%, #fbbc05 0)", WebkitBackgroundClip: "text", color: "transparent" }}>G</span>
          Pay
        </span>
      ),
      name: "Google Pay",
    },
  }[wallet];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Pay with ${look.name}`}
      className={`flex h-[48px] items-center justify-center rounded-[6px] transition-[filter] hover:brightness-110 ${single ? "w-[262px]" : "w-full"}`}
      style={{ background: look.bg }}
    >
      {busy ? <Loader2 className={`size-5 animate-spin ${wallet === "paypal" ? "text-[#003087]" : "text-white"}`} /> : look.label}
    </button>
  );
}

function Section({ title, hint, aside, children }: { title: string; hint?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-[34px]">
      <div className="flex items-baseline justify-between">
        <h2 className="cp-heading cp-bold text-[20px] leading-6">{title}</h2>
        {aside}
      </div>
      {hint && <p className="mt-1 text-[14px] text-[#707070]">{hint}</p>}
      <div className="mt-4 grid gap-2.5">{children}</div>
    </section>
  );
}

function FormSkeleton() {
  return (
    <div className="animate-pulse space-y-9" aria-busy="true" aria-label="Loading checkout">
      {[2, 6, 1, 4].map((rows, s) => (
        <div key={s}>
          <div className="h-6 w-40 rounded-md bg-neutral-200" />
          <div className="mt-4 grid gap-3">
            {Array.from({ length: rows }, (_, i) => <div key={i} className="h-[54px] rounded-lg bg-neutral-100" />)}
          </div>
        </div>
      ))}
      <div className="h-[60px] rounded-xl bg-neutral-200" />
    </div>
  );
}

/** The grey outline Shopify draws on its processing page, in the page's own colours. */
function ProcessingSkeleton() {
  const bar = "rounded-full bg-black/[0.08]";
  return (
    <div className="animate-pulse">
      <div className={`mx-auto h-2.5 w-24 ${bar}`} />
      <div className="mt-4 grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => <div key={i} className="h-[31px] rounded-lg bg-black/[0.08]" />)}
      </div>
      {[0, 1].map((s) => (
        <div key={s} className="mt-6 border-t border-black/10 pt-8">
          <div className={`h-3 w-14 ${bar}`} />
          <div className={`mt-5 h-2 ${bar}`} />
          <div className={`mt-2 h-2 ${bar}`} />
        </div>
      ))}
    </div>
  );
}

function ProcessingSummarySkeleton() {
  const bar = "rounded-full bg-black/[0.08]";
  return (
    <div className="animate-pulse">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-lg bg-black/[0.08]" />
        <div className="space-y-1.5 pt-1">
          <div className={`h-2 w-[100px] ${bar}`} />
          <div className={`h-2 w-10 ${bar}`} />
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        <div className={`h-2 w-10 ${bar}`} />
        <div className={`h-2 w-10 ${bar}`} />
        <div className={`h-2 w-10 ${bar}`} />
        <div className={`h-3 w-[60px] ${bar}`} />
      </div>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center gap-4">
        <div className="size-16 rounded-lg bg-neutral-200" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-3/4 rounded-full bg-neutral-200" />
          <div className="h-3 w-1/3 rounded-full bg-neutral-200" />
        </div>
      </div>
      <div className="h-12 rounded-md bg-neutral-200/70" />
      <div className="h-3.5 rounded-full bg-neutral-200/70" />
      <div className="h-3.5 rounded-full bg-neutral-200/70" />
      <div className="h-5 w-1/2 rounded-full bg-neutral-200" />
    </div>
  );
}
