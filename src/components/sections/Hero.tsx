"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Container } from "@/components/primitives/Container";
import { DemoUrlInput } from "./demo/DemoUrlInput";
import { hostOf, StorefrontViewer } from "@/components/storefront/StorefrontViewer";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { saveDemoMode, type DemoMode } from "@/lib/demoMode";

// what the demo shows after payment, chosen under the field before pressing the CTA
const MODES: { mode: DemoMode; label: string }[] = [
  { mode: "edit", label: "Order editing" },
  { mode: "upsell", label: "Upsells" },
  { mode: "both", label: "Both" },
];

// store URL -> path slug (its domain), e.g. "https://www.gullylabs.com/x" -> "gullylabs.com"
function slugFor(url: string) {
  return url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] || url.trim();
}

export function Hero() {
  const [url, setUrl] = useState("");
  // the store currently open in the full-screen copy (null = closed)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  // what the demo shows after payment; both by default
  const [mode, setMode] = useState<DemoMode>("both");

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
    saveDemoMode(mode);
    // reflect the store in the address bar so it can be copied/shared directly
    window.history.replaceState(null, "", `/product-demo/${slugFor(v)}`);
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
              setUrl={setUrl}
              onSubmit={onSubmit}
              loading={false}
              align="center"
              shake={shake}
            />
          </motion.div>

          {/* a segmented switch: the chosen option sits on a blue pill that slides between them */}
          <motion.div variants={fadeUp} className="mt-5">
            <div
              role="radiogroup"
              aria-label="What the demo shows"
              className="relative inline-flex items-center gap-1 rounded-full bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(21,95,255,0.18)] ring-1 ring-[#0f172a]/[0.08]"
            >
              {MODES.map(({ mode: m, label }) => {
                const on = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMode(m)}
                    className={`relative rounded-full px-4 py-2 text-[0.85rem] font-semibold tracking-[-0.01em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#155FFF]/20 sm:px-5 lg:text-[0.92rem] ${
                      on ? "text-white" : "text-neutral-500 hover:text-neutral-900"
                    }`}
                  >
                    {on && (
                      <motion.span
                        layoutId="demo-mode-pill"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        className="absolute inset-0 rounded-full bg-gradient-to-b from-[#3d7bff] to-[#155FFF] shadow-[0_6px_16px_-6px_rgba(21,95,255,0.65),inset_0_1px_0_rgba(255,255,255,0.25)]"
                      />
                    )}
                    <span className="relative">{label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      </Container>

      {/* full-screen copy of the store's own website */}
      <StorefrontViewer url={previewUrl} onClose={close} />
    </section>
  );
}
