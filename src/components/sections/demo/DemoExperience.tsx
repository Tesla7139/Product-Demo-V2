"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, Globe, X } from "lucide-react";
import type { DemoStore } from "@/lib/site";
import { GuidedEditor } from "./GuidedEditor";
import { CustomerLogos } from "@/components/sections/CustomerLogos";
import { StaggerTestimonials } from "@/components/ui/stagger-testimonials";
import { Footer } from "@/components/layout/Footer";

type Status = "idle" | "loading" | "ready";
type Step = "welcome" | "editing";

const ACCENT = "#155FFF";

export function DemoExperience({
  open,
  status,
  store,
  submittedUrl = "",
  onClose,
}: {
  open: boolean;
  status: Status;
  store: DemoStore | null;
  submittedUrl?: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("welcome");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset step when a new preview opens
    if (open) setStep("welcome");
  }, [open, store]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const brand = store?.brandColor || ACCENT;
  const name  = store?.brandName  || "Your store";
  const domain = cleanDomain(submittedUrl);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] overflow-y-auto"
          style={{ background: "#ffffff" }}
        >
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="fixed right-4 top-3 z-[120] flex size-9 items-center justify-center rounded-full border border-border bg-white text-foreground shadow-soft-md transition-colors hover:bg-neutral-50"
          >
            <X className="size-5" />
          </button>


          {status === "loading" && <LoadingView label={domain || name} />}

          {status === "ready" && store && (
            <AnimatePresence mode="wait">
              {step === "welcome" && (
                <WelcomeView key="welcome" store={store} brand={brand} name={name} domain={domain} onContinue={() => setStep("editing")} />
              )}
              {step === "editing" && (
                <EditingView key="editing" store={store} />
              )}
            </AnimatePresence>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ----------------------------- Loading ----------------------------- */
const WARM = "#f0502e"; // warm "building" accent

function cleanDomain(url: string): string {
  if (!url) return "";
  try {
    const host = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return host || url;
  } catch {
    return url;
  }
}

const READY = "#10b981"; // green "ready" accent

/**
 * "Building <brand>" loading screen. Pass `ready` to flip it to the green ready
 * state when the content has actually loaded (the storefront preview does);
 * without it, it flips on a timer just before the welcome splash.
 */
export function LoadingView({ label, ready, className = "h-screen" }: { label: string; ready?: boolean; className?: string }) {
  const [timedDone, setTimedDone] = useState(false);
  const done = ready ?? timedDone;
  const accent = done ? READY : WARM;

  useEffect(() => {
    if (ready !== undefined) return;
    // flip to the green "ready" state just before the parent opens the welcome splash
    const t = setTimeout(() => setTimedDone(true), 3500);
    return () => clearTimeout(t);
  }, [ready]);

  return (
    <div className={`relative flex overflow-hidden bg-background ${className}`}>
      {/* soft glow top-left */}
      <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full blur-3xl transition-colors duration-500" style={{ background: `${accent}22` }} />

      {/* ---- left sidebar skeleton ---- */}
      <aside className="hidden w-[300px] shrink-0 flex-col gap-3 bg-background-muted/60 p-5 md:flex">
        {/* active item card */}
        <div className="rounded-2xl bg-white p-4 shadow-soft-md">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: done ? READY : "#8a8fb3" }}>
            {done ? "Ready" : "Brand details loading"}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`size-2.5 shrink-0 rounded-full ${done ? "" : "animate-pulse"}`} style={{ background: accent }} />
            <span className="truncate text-[15px] font-bold text-foreground">
              {done ? `${label} is ready` : `Building ${label}`}
            </span>
          </div>
        </div>

        {/* two faint lines */}
        <div className="space-y-2 px-1">
          <div className="h-3 w-3/4 animate-pulse rounded-full bg-black/[0.06]" />
          <div className="h-3 w-1/2 animate-pulse rounded-full bg-black/[0.06]" />
        </div>

        <div className="my-1 h-px bg-black/[0.06]" />

        {/* skeleton nav blocks */}
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-2xl bg-black/[0.04]" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </aside>

      {/* ---- right main panel ---- */}
      <main className="flex-1 p-4 md:p-6">
        <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-white p-7 shadow-soft-md md:p-10">
          {/* top row */}
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors duration-300" style={{ background: `${accent}1a`, color: accent }}>
              {done ? (
                <Check className="size-3.5" strokeWidth={3} />
              ) : (
                <span className="size-2 animate-pulse rounded-full" style={{ background: accent }} />
              )}
              {done ? "Your store is ready" : "Finalizing brand details"}
            </span>
            <span className="hidden text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground sm:block">
              {done ? "All set" : "Styling key moments"}
            </span>
          </div>

          {/* heading + copy */}
          <h2 className="mt-7 font-serif text-4xl text-foreground md:text-5xl">
            {done ? `${label} is ready` : `Preparing your ${label} demo`}
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground md:text-base">
            {done
              ? "All set. Opening your branded preview now."
              : "We can open the experience now and continue settling in the remaining brand details in the background."}
          </p>

          {/* progress bar */}
          <div className="mt-7 h-3 w-full shrink-0 overflow-hidden rounded-full bg-neutral-200 ring-1 ring-black/5">
            <motion.div
              initial={{ width: "8%" }}
              animate={{ width: done ? "100%" : "82%" }}
              transition={{ duration: done ? 0.4 : 2.4, ease: "easeInOut" }}
              className="h-full rounded-full"
              style={{ background: accent, boxShadow: `0 0 12px ${accent}80` }}
            />
          </div>

          {/* support tickets — scroll downward; the ones shoppers won't need to open */}
          <div className="mt-8 flex-1">
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Tickets your shoppers won&apos;t need to open
            </p>
            <div
              className="marquee-group relative h-[calc(100%-2rem)] min-h-[180px] overflow-hidden"
              style={{
                maskImage: "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
                WebkitMaskImage: "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
              }}
            >
              <motion.div
                className="flex w-full shrink-0 flex-col gap-2.5"
                animate={{ y: ["0%", "-50%"] }}
                transition={{ duration: 8, ease: "linear", repeat: Infinity }}
              >
                {[...TICKETS, ...TICKETS].map((t, i) => (
                  <div
                    key={i}
                    aria-hidden={i >= TICKETS.length}
                    className="rounded-xl bg-background-muted/70 px-4 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: t.hot ? "#f59e0b" : "#c2c7d2" }} />
                        <span className="truncate text-[13px] font-semibold text-foreground">{t.subject}</span>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{t.time}</span>
                    </div>
                    <div className="mt-0.5 pl-4 text-[12px] text-muted-foreground">{t.email}</div>
                  </div>
                ))}
              </motion.div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const TICKETS = [
  { subject: "Can I change delivery date?",        email: "anna.ko@hotmail.com", time: "22m ago", hot: false },
  { subject: "Ordered wrong, too late to switch?", email: "tom.baker@gmail.com", time: "25m ago", hot: true },
  { subject: "Typed my email wrong on checkout",   email: "nina.s@yahoo.com",    time: "31m ago", hot: false },
  { subject: "Need to add an item to my order",    email: "raj.m@gmail.com",     time: "34m ago", hot: true },
  { subject: "Wrong size, can I swap it?",         email: "lea.f@outlook.com",   time: "39m ago", hot: false },
  { subject: "Forgot to apply my discount code",   email: "mike.d@gmail.com",    time: "42m ago", hot: false },
  { subject: "Want to cancel my order",            email: "sara.p@yahoo.com",    time: "47m ago", hot: true },
];

/* ----------------------------- Welcome ----------------------------- */
function WelcomeView({ store, brand, name, domain, onContinue }: { store: DemoStore; brand: string; name: string; domain: string; onContinue: () => void }) {
  // full-res image: a product photo if we have one, else the store's hero/logo
  // prefer the store's logo (cleaner than a random product photo); fall back to a product image
  const storeLogo = store.logo || null;
  const productImg = store.products.find((p) => p.image)?.image || null;
  const dom = domain || `${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;
  // "dive into the laptop": on click, the laptop screen zooms up to fill the
  // viewport, then we hand off to the editing scene.
  const [entering, setEntering] = useState(false);
  const enter = () => {
    if (entering) return;
    setEntering(true);
    window.setTimeout(onContinue, 700);
  };
  const fraunces = "var(--font-fraunces), Georgia, serif";
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="relative min-h-screen overflow-hidden"
    >
      <button onClick={enter} className="relative flex min-h-screen w-full cursor-pointer flex-col items-center justify-center gap-10 px-6 py-14 lg:flex-row lg:gap-16 lg:px-16">
        {/* text — on the side (left) */}
        <motion.div
          animate={entering ? { opacity: 0, y: -14 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="w-full max-w-md text-center lg:text-left"
        >
          <span className="text-2xl italic tracking-wide text-muted-foreground sm:text-3xl" style={{ fontFamily: fraunces, fontWeight: 400 }}>Welcome to</span>
          <div className="mt-1 text-6xl leading-[0.92] tracking-tight text-foreground md:text-7xl" style={{ fontFamily: fraunces, fontWeight: 900, fontStyle: "italic", letterSpacing: "-0.02em" }}>
            {name}
          </div>
          <p className="mt-3 text-base font-light tracking-wide text-muted-foreground sm:text-lg">your branded preview</p>
          <span
            className="mt-7 inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5"
            style={{ background: ACCENT }}
          >
            Click anywhere to explore
            <ArrowRight className="size-4" />
          </span>
        </motion.div>

        {/* laptop mockup — the store previewed in a browser */}
        <motion.div
          animate={entering ? { scale: 9 } : { scale: 1 }}
          transition={{ duration: 0.7, ease: [0.6, 0, 0.75, 0] }}
          style={{ transformOrigin: "50% 42%" }}
          className="w-full max-w-2xl">
          {/* screen */}
          <div className="rounded-t-2xl border border-b-0 border-neutral-800 bg-neutral-900 p-2.5 shadow-2xl sm:p-3">
            <div className="overflow-hidden rounded-lg bg-white">
              {/* browser bar — store logo (in place of the traffic dots) + domain */}
              <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                {store.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={store.logo} alt="" className="size-[30px] shrink-0 rounded object-contain" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
                ) : (
                  <Globe className="size-[30px] shrink-0 text-neutral-400" />
                )}
                <span className="mx-auto flex max-w-[70%] items-center truncate rounded-md bg-white px-3 py-1 text-[12.5px] font-medium text-neutral-700 ring-1 ring-neutral-200">
                  <span className="truncate">{dom}</span>
                </span>
              </div>
              {/* the brand mark, inside the laptop screen (logo preferred, centered) */}
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-white">
                {storeLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- center + cap size so small favicons stay crisp instead of being blown up full-bleed
                  <img src={storeLogo} alt={name} className="absolute inset-0 m-auto max-h-[62%] max-w-[72%] object-contain" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
                ) : productImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={productImg} alt={name} className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
                ) : (
                  <div aria-hidden className="absolute inset-0 flex items-center justify-center text-white" style={{ background: `linear-gradient(135deg, ${brand}, #0f172a)` }}>
                    <span className="text-6xl font-extrabold opacity-90">{name.charAt(0).toUpperCase()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* laptop base / deck (wider than the screen) */}
          <div className="relative left-1/2 h-3 w-[112%] -translate-x-1/2 rounded-b-xl bg-gradient-to-b from-neutral-300 to-neutral-400 shadow-lg" />
          <div className="relative left-1/2 mx-auto h-1 w-[46%] -translate-x-1/2 rounded-b-md bg-neutral-400/70" />
        </motion.div>
      </button>
    </motion.div>
  );
}

/* ----------------------------- Editing ----------------------------- */
function EditingView({ store }: { store: DemoStore }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
      style={{ background: "#ffffff" }}
    >
      {/* page 1 — reserved left panel + full-bleed blue demo stage (right) */}
      <div className="flex min-h-[100svh] w-full flex-col justify-center px-3 py-6 sm:px-6 sm:py-8 lg:py-0 lg:pl-5 lg:pr-0 xl:pl-6">
        <GuidedEditor store={store} />
      </div>

      {/* page 2 — moving brand strip + stagger review carousel + footer (one bg) */}
      <div style={{ background: "#ffffff" }}>
        <CustomerLogos />
        <section className="border-t border-border/60 pt-14 pb-4">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
            Loved by fast-growing brands
          </h2>
          <p className="mt-2 text-[15px] text-muted-foreground">What Shopify merchants say about Clickpost.</p>
        </div>
        <div className="mt-6">
          <StaggerTestimonials />
        </div>
        <div className="mt-6 flex justify-center">
          <a
            href="/reviews"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-6 py-3 text-sm font-semibold text-foreground shadow-soft-md transition-colors hover:bg-neutral-50"
          >
            Show all 52 reviews
            <ArrowRight className="size-4" />
          </a>
        </div>
        </section>
      </div>
      <Footer />
    </motion.div>
  );
}
