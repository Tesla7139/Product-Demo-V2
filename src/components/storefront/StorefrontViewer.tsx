"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, Monitor, Smartphone, X } from "lucide-react";
import { LoadingView } from "@/components/sections/demo/DemoExperience";

type Device = "desktop" | "mobile";
/**
 * loading: the "Building <store>" screen while the store loads · intro: the
 * laptop welcome · entering: zooming into its screen · site: the store
 */
type Phase = "loading" | "intro" | "entering" | "site";

/** The loading screen stays at least this long so it reads (as in v1). */
const MIN_LOADING_MS = 1400;
/** Then holds its green "ready" state for a beat before the welcome. */
const READY_HOLD_MS = 550;
/** How long the laptop welcome shows before zooming in. */
const INTRO_MS = 1100;
const ZOOM_MS = 600;

/** "https://www.Store.com/x" -> "www.store.com" (what /clone/<host>/ expects). */
export function hostOf(url: string): string {
  return url.trim().replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
}

/** "https://store.com/products/x?y" -> "/products/x?y" ("" for a bare domain). */
function pathOf(url: string): string {
  const rest = url.trim().replace(/^https?:\/\//i, "").match(/^[^/?#]+(.*)$/)?.[1] ?? "";
  return rest === "/" ? "" : rest;
}

const START_LOOKUP_MS = 8000;

/**
 * Where to open the store: one of its product pages (on its English site when it
 * has one), so the demo goes straight to add-to-cart and checkout — see
 * /api/clone-start. Path is null when there's no readable catalog.
 */
async function startPage(host: string): Promise<{ host: string; path: string | null }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), START_LOOKUP_MS);
  try {
    const res = await fetch(`/api/clone-start?host=${encodeURIComponent(host)}`, { signal: controller.signal });
    if (!res.ok) return { host, path: null };
    const data = (await res.json()) as { host?: string; path?: string | null };
    return { host: data.host || host, path: data.path ?? null };
  } catch {
    return { host, path: null }; // too slow — open the homepage
  } finally {
    window.clearTimeout(timer);
  }
}

/** "www.gullylabs.com" -> "Gullylabs" until the store's real name arrives. */
function nameFromHost(host: string) {
  const base = host.replace(/^www\./, "").split(".")[0] || host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// Full-screen copy of the store: the store's own site in a frame, with only a
// close button and a desktop / mobile switch around it. The frame is the same
// element in both modes, so switching keeps the page, scroll position and cart.
// While the first page loads, a laptop shows the store; once the page is ready
// the laptop's screen zooms up to fill the view and hands over to the site.
export function StorefrontViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  const [device, setDevice] = useState<Device>("desktop");
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingDone, setLoadingDone] = useState(false); // loading screen shows its green "ready" state
  const [ready, setReady] = useState(false); // first page of the store has loaded
  const [navigating, setNavigating] = useState(false); // later pages, inside the copy
  const [brand, setBrand] = useState<{ name?: string; logo?: string | null }>({});
  const openedAt = useRef(0);
  const host = url ? hostOf(url) : "";
  const startPath = url ? pathOf(url) : "";

  // A new store starts with an empty cart; clear the session before the frame mounts.
  // A pasted page URL opens as-is; a bare domain opens on one of its products
  // (looked up while the laptop intro plays), or the homepage if there's no catalog.
  useEffect(() => {
    if (!host) return;
    try {
      sessionStorage.removeItem("cp-cart");
      sessionStorage.removeItem("cp-brand");
      sessionStorage.removeItem("cp-open-product");
    } catch {
      /* storage blocked — the copy still works, the cart just won't persist */
    }
    openedAt.current = Date.now();
    /* eslint-disable react-hooks/set-state-in-effect -- frame src + intro follow the session reset above */
    setPhase("loading");
    setLoadingDone(false);
    setReady(false);
    setBrand({});
    setSrc(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    (startPath ? Promise.resolve({ host, path: startPath }) : startPage(host)).then((start) => {
      if (cancelled) return;
      // no catalog to pick from: open the homepage and let the runtime follow its first product link
      if (start.path === null) {
        try { sessionStorage.setItem("cp-open-product", "1"); } catch { /* stays on the homepage */ }
      }
      setSrc(`/clone/${start.host}${start.path ?? ""}`);
    });
    return () => { cancelled = true; };
  }, [host, startPath]);

  // once the store has loaded (and the loading screen has had its moment), flip it
  // to "ready", then hand over to the laptop welcome
  useEffect(() => {
    if (phase !== "loading" || !ready) return;
    const wait = Math.max(0, MIN_LOADING_MS - (Date.now() - openedAt.current));
    const t1 = window.setTimeout(() => setLoadingDone(true), wait);
    const t2 = window.setTimeout(() => setPhase("intro"), wait + READY_HOLD_MS);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [phase, ready]);

  // the laptop welcome has had its moment — zoom into it
  useEffect(() => {
    if (phase !== "intro") return;
    const t = window.setTimeout(() => setPhase("entering"), INTRO_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  // the zoom has filled the view with the laptop's screen — hand over to the site
  useEffect(() => {
    if (phase !== "entering") return;
    const t = window.setTimeout(() => setPhase("site"), ZOOM_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (!url) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "cp:ready") {
        setReady(true);
        setNavigating(false);
        if (e.data.name) setBrand((b) => (b.name ? b : { name: e.data.name, logo: e.data.logo }));
      }
      if (e.data?.type === "cp:leaving") setNavigating(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMsg);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMsg);
    };
  }, [url, onClose]);

  const mobile = device === "mobile";

  return (
    <AnimatePresence>
      {url && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex flex-col bg-white"
        >
          <div className="relative flex h-12 shrink-0 items-center justify-center border-b border-neutral-200 bg-white px-3">
            <div className="hidden items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 sm:flex" role="group" aria-label="Preview size">
              <DeviceButton active={!mobile} onClick={() => setDevice("desktop")} label="Desktop">
                <Monitor className="size-4" />
              </DeviceButton>
              {/* mobile preview is switched off for now */}
              <DeviceButton active={mobile} onClick={() => setDevice("mobile")} label="Mobile" disabled>
                <Smartphone className="size-4" />
              </DeviceButton>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className={`relative min-h-0 flex-1 ${mobile ? "flex items-center justify-center bg-neutral-100 p-5" : ""}`}>
            <div
              className={`relative ${mobile ? "overflow-hidden rounded-[44px] border-[10px] bg-white shadow-2xl" : "h-full w-full"}`}
              style={mobile ? { width: 410, height: "min(864px, 100%)", borderColor: "#111" } : undefined}
            >
              {src && (
                <iframe
                  key={src}
                  src={src}
                  title={host}
                  onLoad={() => { setReady(true); setNavigating(false); }}
                  // no allow-top-navigation: the store's frame-busting can't take over the page
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
                  className="block h-full w-full border-0 bg-white"
                />
              )}
              <ProgressBar active={phase === "site" && navigating} />
            </div>

            <AnimatePresence>
              {phase === "loading" && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35 }}
                  className="absolute inset-0 z-30 bg-white"
                >
                  <LoadingView label={host.replace(/^www\./, "")} ready={loadingDone} className="h-full" />
                </motion.div>
              )}
              {(phase === "intro" || phase === "entering") && (
                <LaptopIntro
                  key="intro"
                  domain={host.replace(/^www\./, "")}
                  name={brand.name || nameFromHost(host)}
                  logo={brand.logo || null}
                  ready={ready}
                  entering={phase === "entering"}
                />
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DeviceButton({ active, onClick, label, disabled, children }: { active: boolean; onClick: () => void; label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      title={disabled ? `${label} view coming soon` : undefined}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 enabled:hover:text-neutral-800"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

const LOADER_CSS = `
@keyframes cp-spoke { from { opacity: 1 } to { opacity: .15 } }
@keyframes cp-bar-a { 0% { left: -35%; right: 100% } 60%, 100% { left: 100%; right: -90% } }
@keyframes cp-bar-b { 0% { left: -200%; right: 100% } 60%, 100% { left: 107%; right: -8% } }
@media (prefers-reduced-motion: reduce) { .cp-motion, .cp-motion * { animation-duration: 0s !important; animation-iteration-count: 1 !important } }
`;

/** Apple-style activity indicator: twelve spokes fading in sequence. */
function ActivityIndicator() {
  return (
    <div className="cp-motion relative size-5" role="progressbar" aria-label="Loading">
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="absolute left-[46%] top-0 h-[28%] w-[8%] rounded-full bg-neutral-500"
          style={{
            transform: `rotate(${i * 30}deg)`,
            transformOrigin: "50% 178%",
            animation: "cp-spoke 1s linear infinite",
            animationDelay: `${(i - 12) / 12}s`,
          }}
        />
      ))}
    </div>
  );
}

/** Material-style indeterminate bar along the top while a page inside the store loads. */
function ProgressBar({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={`cp-motion pointer-events-none absolute inset-x-0 top-0 z-20 h-[3px] overflow-hidden transition-opacity duration-300 ${active ? "opacity-100" : "opacity-0"}`}
      style={{ background: "rgba(26,115,232,.18)" }}
    >
      <style>{LOADER_CSS}</style>
      {active && (
        <>
          <span className="absolute inset-y-0 bg-[#1a73e8]" style={{ animation: "cp-bar-a 2.1s cubic-bezier(.65,.815,.735,.395) infinite" }} />
          <span className="absolute inset-y-0 bg-[#1a73e8]" style={{ animation: "cp-bar-b 2.1s cubic-bezier(.165,.84,.44,1) 1.15s infinite" }} />
        </>
      )}
    </div>
  );
}

/** "Welcome to <store>" beside a laptop showing the store; on enter, the laptop's
 *  screen zooms up to fill the view and the intro fades onto the live site. */
function LaptopIntro({ domain, name, logo, ready, entering }: { domain: string; name: string; logo: string | null; ready: boolean; entering: boolean }) {
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=256`;
  const fraunces = "var(--font-fraunces), Georgia, serif";
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="absolute inset-0 z-30 overflow-hidden bg-white"
    >
      <style>{LOADER_CSS}</style>
      <div className="flex h-full w-full flex-col items-center justify-center gap-10 px-6 py-10 lg:flex-row lg:gap-16 lg:px-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={entering ? { opacity: 0, y: -14 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-md text-center lg:text-left"
        >
          <span className="text-2xl italic tracking-wide text-neutral-500 sm:text-3xl" style={{ fontFamily: fraunces, fontWeight: 400 }}>
            Welcome to
          </span>
          <div
            className="mt-1 break-words text-6xl leading-[0.92] tracking-tight text-neutral-900 md:text-7xl"
            style={{ fontFamily: fraunces, fontWeight: 900, fontStyle: "italic", letterSpacing: "-0.02em" }}
          >
            {name}
          </div>
          <div className="mt-7 inline-flex items-center gap-2.5 rounded-full bg-neutral-100 px-5 py-2.5 text-[15px] font-medium text-neutral-700">
            {ready ? (
              <span className="size-2 rounded-full bg-emerald-500" />
            ) : (
              <ActivityIndicator />
            )}
            {ready ? `Opening ${domain}` : `Loading ${domain}…`}
          </div>
        </motion.div>

        {/* laptop — the store previewed in a browser; its screen is what we zoom into */}
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={entering ? { opacity: 1, y: 0, scale: 9 } : { opacity: 1, y: 0, scale: 1 }}
          transition={entering ? { duration: ZOOM_MS / 1000, ease: [0.6, 0, 0.75, 0] } : { duration: 0.5, ease: "easeOut" }}
          style={{ transformOrigin: "50% 42%" }}
          className="w-full max-w-2xl"
        >
          <div className="rounded-t-2xl border border-b-0 border-neutral-800 bg-neutral-900 p-2.5 shadow-2xl sm:p-3">
            <div className="overflow-hidden rounded-lg bg-white">
              <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- the store's favicon */}
                <img src={favicon} alt="" className="size-[22px] shrink-0 rounded object-contain" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
                <span className="mx-auto flex max-w-[70%] items-center gap-1.5 truncate rounded-md bg-white px-3 py-1 text-[12.5px] font-medium text-neutral-700 ring-1 ring-neutral-200">
                  <Globe className="size-3 shrink-0 text-neutral-400" />
                  <span className="truncate">{domain}</span>
                </span>
              </div>
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-white">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={logo || favicon}
                    src={logo || favicon}
                    alt={name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className={`absolute inset-0 m-auto object-contain ${logo ? "max-h-[45%] max-w-[62%]" : "size-24 rounded-2xl"}`}
                    referrerPolicy="no-referrer"
                    onError={(e) => (e.currentTarget.style.display = "none")}
                  />
                </AnimatePresence>
              </div>
            </div>
          </div>
          {/* laptop base / deck (wider than the screen) */}
          <div className="relative left-1/2 h-3 w-[112%] -translate-x-1/2 rounded-b-xl bg-gradient-to-b from-neutral-300 to-neutral-400 shadow-lg" />
          <div className="relative left-1/2 mx-auto h-1 w-[46%] -translate-x-1/2 rounded-b-md bg-neutral-400/70" />
        </motion.div>
      </div>
    </motion.div>
  );
}
