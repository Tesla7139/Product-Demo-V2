"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Lock, ShoppingBag } from "lucide-react";
import { DEFAULT_ADDR, DEFAULT_EMAIL, DEFAULT_PHONE } from "@/components/sections/demo/DemoMock";
import {
  Checkbox, Field, loadCatalog, MobileSummary, money, orderNumber, OrderSummary, readSession, shippingFee, SplitLayout,
  StoreFrame, StoreHeader, textOn, type Brand, type CatalogProduct, type Line,
} from "./shared";
import { UpsellPage } from "./UpsellPage";
import { ThankYouPage } from "./ThankYouPage";

// The order flow that follows the storefront copy: checkout → post-purchase
// offers → thank-you page with order editing. The cart and the store's look
// (name, logo, button colour, fonts, currency) are left in sessionStorage by
// /clone-runtime.js.

type Stage = "checkout" | "upsell" | "thankyou";

export function CheckoutFlow() {
  const [loaded, setLoaded] = useState(false);
  const [cart, setCart] = useState<Line[]>([]);
  const [brand, setBrand] = useState<Brand>({});
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [stage, setStage] = useState<Stage>("checkout");
  const [accepted, setAccepted] = useState<Line[]>([]);
  const [orderNo] = useState(orderNumber);

  useEffect(() => {
    const b = readSession<Brand>("cp-brand") ?? {};
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from the session the storefront copy wrote */
    setBrand(b);
    setCart(readSession<{ items: Line[] }>("cp-cart")?.items ?? []);
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (b.name) document.title = `Checkout - ${b.name}`;
    if (b.host) loadCatalog(b.host).then(setCatalog);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  if (!loaded) return <div className="min-h-screen bg-white" />;

  const currency = brand.currency || "USD";
  const accent = brand.accent || "#111827";
  const shipping = shippingFee(cart.reduce((s, l) => s + l.price * l.qty, 0));
  const bought = new Set(cart.map((l) => l.title.toLowerCase()));
  const offers = catalog.filter((p) => !bought.has(p.title.toLowerCase())).slice(0, 3);

  let page: React.ReactNode;
  if (!cart.length) {
    page = (
      <>
        <StoreHeader brand={brand} />
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
  } else if (stage === "upsell" && offers.length) {
    page = (
      <UpsellPage
        brand={brand}
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
        brand={brand}
        initialLines={[...cart, ...accepted]}
        catalog={catalog}
        orderNo={orderNo}
        accent={accent}
        currency={currency}
        shipping={shipping}
      />
    );
  } else {
    page = <Checkout brand={brand} lines={cart} currency={currency} accent={accent} shipping={shipping} onPaid={() => setStage("upsell")} />;
  }

  return <StoreFrame brand={brand}>{page}</StoreFrame>;
}

function Checkout({
  brand, lines, currency, accent, shipping, onPaid,
}: { brand: Brand; lines: Line[]; currency: string; accent: string; shipping: number; onPaid: () => void }) {
  const [paying, setPaying] = useState(false);
  const fmt = (n: number) => money(n, currency);
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0) + shipping;

  const pay = (e: React.FormEvent) => {
    e.preventDefault();
    if (paying) return;
    setPaying(true);
    window.setTimeout(onPaid, 1800);
  };

  const summary = <OrderSummary lines={lines} currency={currency} shipping={shipping} discountBox />;

  const form = (
    <form onSubmit={pay}>
      <Section title="Contact">
        <Field label="Email" defaultValue={DEFAULT_EMAIL} type="email" />
        <Checkbox label="Email me with news and offers" accent={accent} />
      </Section>

      <Section title="Delivery">
        <Field label="Country/Region" defaultValue="United States" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" defaultValue={DEFAULT_ADDR.first} />
          <Field label="Last name" defaultValue={DEFAULT_ADDR.last} />
        </div>
        <Field label="Address" defaultValue={DEFAULT_ADDR.line1} />
        <Field label="Apartment, suite, etc. (optional)" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="City" defaultValue={DEFAULT_ADDR.city} />
          <Field label="State" defaultValue={DEFAULT_ADDR.state} />
          <Field label="ZIP code" defaultValue={DEFAULT_ADDR.zip} />
        </div>
        <Field label="Phone" defaultValue={DEFAULT_PHONE} type="tel" />
      </Section>

      <Section title="Shipping method">
        <div className="flex items-center justify-between rounded-lg border px-4 py-4 text-[15px]" style={{ borderColor: accent, background: "#fafafa" }}>
          <span>Standard</span>
          <span className="font-semibold">{fmt(shipping)}</span>
        </div>
      </Section>

      <Section title="Pay with credit card" hint="All transactions are secure and encrypted." icon={<CreditCard className="size-7 text-neutral-400" strokeWidth={1.5} />}>
        <Field label="Card number" defaultValue="4242 4242 4242 4242" icon={<Lock className="size-4 text-neutral-400" />} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expiration date (MM / YY)" defaultValue="12 / 29" />
          <Field label="Security code" defaultValue="123" />
        </div>
        <Field label="Name on card" defaultValue={`${DEFAULT_ADDR.first} ${DEFAULT_ADDR.last}`} />
        <Checkbox label="Use shipping address as billing address" accent={accent} />
      </Section>

      <button
        type="submit"
        disabled={paying}
        className="mt-2 flex h-[60px] w-full items-center justify-center gap-2 rounded-xl text-[18px] font-bold transition-[filter] hover:brightness-110 disabled:opacity-90"
        style={{ background: accent, color: textOn(accent) }}
      >
        {paying ? <><Loader2 className="size-5 animate-spin" /> Processing…</> : "Pay now"}
      </button>

      <div className="mt-10 border-t border-neutral-200 pt-5 text-[14px] underline underline-offset-2" style={{ color: accent }}>
        Terms and policies
      </div>
    </form>
  );

  return (
    <>
      <StoreHeader
        brand={brand}
        right={
          <a href={brand.home || "#"} aria-label="Back to store" className="text-neutral-700 hover:text-neutral-900">
            <ShoppingBag className="size-5" />
          </a>
        }
      />
      <MobileSummary accent={accent} total={fmt(total)}>{summary}</MobileSummary>
      <SplitLayout main={form} side={summary} />
    </>
  );
}

function Section({ title, hint, icon, children }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="cp-heading text-[24px]">{title}</h2>
          {hint && <p className="mt-1 text-[15px] text-neutral-500">{hint}</p>}
        </div>
        {icon}
      </div>
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  );
}
