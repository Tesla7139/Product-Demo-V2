"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, BadgePercent, ClipboardPen, type LucideIcon } from "lucide-react";
import { Container } from "@/components/primitives/Container";
import { DemoUrlInput } from "./demo/DemoUrlInput";
import { hostOf, StorefrontViewer } from "@/components/storefront/StorefrontViewer";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { saveDemoMode, type DemoMode } from "@/lib/demoMode";

// what the demo shows after payment, picked once the store URL is in
const MODES: { mode: DemoMode; label: string; icons: LucideIcon[] }[] = [
  { mode: "edit", label: "Order editing", icons: [ClipboardPen] },
  { mode: "upsell", label: "Upsells", icons: [BadgePercent] },
  { mode: "both", label: "Order editing + Upsells", icons: [ClipboardPen, BadgePercent] },
];

/** The blue tile an option's icon sits on; two of them overlap for "both". */
function ModeIcon({ icons }: { icons: LucideIcon[] }) {
  const tile =
    "flex items-center justify-center rounded-2xl bg-gradient-to-br from-[#4d8aff] to-[#155FFF] text-white shadow-[0_10px_22px_-8px_rgba(21,95,255,0.6)] ring-1 ring-inset ring-white/25 transition-transform duration-300";
  if (icons.length === 1) {
    const Icon = icons[0];
    return (
      <span className={`${tile} size-12 group-hover:scale-105 lg:size-16`}>
        <Icon className="size-6 lg:size-8" strokeWidth={1.75} />
      </span>
    );
  }
  const [A, B] = icons;
  return (
    <span className="relative block h-12 w-16 lg:h-16 lg:w-[5.5rem]">
      <span className={`${tile} absolute left-0 top-0 size-10 -rotate-6 opacity-90 group-hover:-translate-x-0.5 group-hover:-rotate-12 lg:size-[3.25rem]`}>
        <A className="size-5 lg:size-6" strokeWidth={1.75} />
      </span>
      <span className={`${tile} absolute bottom-0 right-0 size-10 rotate-6 border-2 border-white group-hover:translate-x-0.5 group-hover:rotate-12 lg:size-[3.25rem]`}>
        <B className="size-5 lg:size-6" strokeWidth={1.75} />
      </span>
    </span>
  );
}

// store URL -> path slug (its domain), e.g. "https://www.gullylabs.com/x" -> "gullylabs.com"
function slugFor(url: string) {
  return url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] || url.trim();
}

export function Hero() {
  const [url, setUrl] = useState("");
  // the store currently open in the full-screen copy (null = closed)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  // the store URL is in: the three choices show under the field
  const [choosing, setChoosing] = useState(false);

  // the "Product Tour" nav link fires this to nudge the store-URL input
  useEffect(() => {
    const onShake = () => setShake((n) => n + 1);
    window.addEventListener("demo:shake", onShake);
    if (window.location.hash === "#demo") onShake();
    return () => window.removeEventListener("demo:shake", onShake);
  }, []);

  // Warm the preview while the URL is still being typed: once the field holds a
  // plausible domain (and typing pauses), the server starts picking the product
  // page and pre-fetching it, so the preview opens on work that's already done.
  useEffect(() => {
    if (previewUrl) return;
    const host = hostOf(url);
    const isBareDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) && !/^[^/?#]+[/?#]./.test(url.trim().replace(/^https?:\/\//i, ""));
    if (!isBareDomain) return;
    const t = window.setTimeout(() => {
      fetch(`/api/clone-start?host=${encodeURIComponent(host)}&warm=1`).catch(() => {});
    }, 600);
    return () => window.clearTimeout(t);
  }, [url, previewUrl]);

  // shareable deep link: /product-demo/gullylabs.com auto-opens that store
  // (also supports the legacy ?store= query param)
  useEffect(() => {
    const m = window.location.pathname.match(/^\/product-demo\/(.+)$/);
    const shared = m ? decodeURIComponent(m[1]) : new URLSearchParams(window.location.search).get("store");
    if (shared) {
      /* eslint-disable react-hooks/set-state-in-effect -- read once from the URL on mount */
      setUrl(shared);
      setPreviewUrl(shared);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = url.trim();
    if (!v) return;
    setChoosing(true);
  };

  const start = (mode: DemoMode) => {
    const v = url.trim();
    if (!v) return;
    saveDemoMode(mode);
    // reflect the store in the address bar so it can be copied/shared directly
    window.history.replaceState(null, "", `/product-demo/${slugFor(v)}`);
    setChoosing(false);
    setPreviewUrl(v);
  };

  const close = useCallback(() => {
    setPreviewUrl(null);
    setUrl("");
    window.history.replaceState(null, "", "/");
  }, []);

  return (
    <section
      id="demo"
      className="relative flex min-h-[100svh] flex-col overflow-hidden pb-8 pt-2 md:pt-3"
      style={{ background: "#ffffff" }}
    >
      <Container className="flex flex-1 items-center py-4 lg:items-start lg:pt-[8vh]">
        <motion.div
          variants={staggerContainer(0.1)}
          initial="hidden"
          animate="show"
          className="mx-auto flex w-full max-w-4xl flex-col items-center text-center animate-fade-in lg:max-w-5xl 2xl:max-w-6xl"
        >
          <motion.h1
            variants={fadeUp}
            className="text-balance font-semibold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-display), sans-serif", fontSize: "clamp(2rem, 5vw, 5.25rem)", lineHeight: 1.04, letterSpacing: "-0.022em" }}
          >
            Reduce Support Tickets and Add Thousands in{" "}
            <span className="text-[#155FFF]">Upsell Revenue</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mt-4 text-muted-foreground md:mt-6"
            style={{ fontSize: "clamp(1rem, 1.5vw, 1.4rem)" }}
          >
            Enter your store URL to have a personalized demo tailored to your store.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-5 w-full max-w-xl md:mt-7 lg:max-w-2xl">
            <DemoUrlInput
              url={url}
              setUrl={(v) => { setUrl(v); setChoosing(false); }}
              onSubmit={onSubmit}
              loading={false}
              align="center"
              shake={shake}
            />
          </motion.div>

          <AnimatePresence>
            {choosing && (
              <motion.div
                key="modes"
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
                variants={staggerContainer(0.07)}
                className="mt-6 w-full max-w-xl lg:max-w-2xl"
              >
                <p className="text-[0.9rem] text-muted-foreground lg:text-[1rem]">What should the demo show?</p>
                <div className="mt-3 grid grid-cols-3 gap-3 lg:gap-4">
                  {MODES.map(({ mode, label, icons }) => (
                    <motion.button
                      key={mode}
                      type="button"
                      variants={fadeUp}
                      onClick={() => start(mode)}
                      className="group relative flex aspect-square flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border border-[#155FFF]/10 bg-gradient-to-b from-white to-[#f3f7ff] p-3 text-center shadow-[0_1px_2px_rgba(15,15,25,0.04),0_12px_32px_-16px_rgba(21,95,255,0.28)] transition-all duration-300 hover:-translate-y-1 hover:border-[#155FFF]/60 hover:shadow-[0_1px_2px_rgba(15,15,25,0.04),0_22px_44px_-18px_rgba(21,95,255,0.5)] focus-visible:border-[#155FFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#155FFF]/20 active:translate-y-0 active:scale-[0.98] lg:gap-4 lg:p-5"
                    >
                      {/* a soft glow behind the icon on hover */}
                      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-2/3 bg-[radial-gradient(60%_60%_at_50%_35%,rgba(21,95,255,0.14),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                      <span aria-hidden className="absolute right-3 top-3 flex size-7 translate-y-1 items-center justify-center rounded-full bg-[#155FFF] text-white opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 lg:right-4 lg:top-4">
                        <ArrowUpRight className="size-4" strokeWidth={2.2} />
                      </span>
                      <span className="relative"><ModeIcon icons={icons} /></span>
                      <span className="relative text-[0.8rem] font-semibold leading-tight tracking-[-0.01em] text-foreground lg:text-[1.1rem]">{label}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </Container>

      {/* full-screen copy of the store's own website */}
      <StorefrontViewer url={previewUrl} onClose={close} />
    </section>
  );
}
