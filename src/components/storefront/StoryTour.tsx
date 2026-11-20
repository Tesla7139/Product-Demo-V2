"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * "The address nobody checks" — the order-editing story, played as a short
 * film over the store's own checkout (letterbox, a character, one-line
 * subtitles, an optional voiceover from the browser's own speech). It follows
 * the Loom script scene by scene:
 *
 *   1–2  Priya, a gift for her sister: express checkout, address auto-filled, paid
 *   3    five minutes later she notices
 *   3b   "it's not just gifts": four fast cuts, a wrong address in each
 *   4    the store's problem: a ticket, a follow-up, picked-packed-labelled,
 *        cancel / re-ship / RTO
 *   5    rewind, with ClickPost
 *   6    "Edit your order" with a timer; the order is vaulted; Priya fixes it
 *   7    the vault opens, the order ships right the first time
 *   8    end card
 *
 * It drives the pages in the viewer's frame by message:
 *   checkout (public/checkout-snapshot.js)  persona · rect · shoppay · pay
 *   thank-you (ThankYouPage.tsx)            rect · fix-address, and "thankyou-ready"
 */

const APP_URL = "https://apps.shopify.com/clickpost-order-edit-cancel";
const BLUE = "#155FFF";
const OUTFIT = "#7c5cff";
/** the store's header (logo, name) stays clear of the spotlight's shadow the whole film */
const HEADER_CLEAR = "linear-gradient(to bottom, transparent 0, transparent var(--cp-head), #000 calc(var(--cp-head) + 36px))";
const PRIYA = { first: "Priya", last: "Sharma", email: "priya.sharma@gmail.com" };

type Rect = { top: number; left: number; width: number; height: number };
type Mood = "happy" | "breezy" | "worried" | "relieved" | "crying";
type Pose = "wave" | "phone" | "point" | "show";
type Reply = { id?: number; ev?: string; ok?: boolean; rect?: Rect | null };

class Cancelled extends Error {}

/* --------------------------------- voice --------------------------------- */

// one warm female narrator: neural voices first (Edge's "Natural", macOS Premium/Enhanced),
// then Chrome's Google voice; the robotic Windows desktop voices (David, Mark, Zira) never
const NATURAL = /\b(Ava|Emma|Jenny|Aria|Michelle|Sonia|Libby|Natasha)\b.*(Natural|Online)|(Ava|Zoe|Samantha|Allison|Serena)\b.*(Premium|Enhanced)/i;
const PREFERRED = ["Google US English", "Google UK English Female", "Samantha", "Karen", "Moira", "Tessa"];
const ROBOTIC = /\b(David|Mark|Zira|Hazel|George|Fred|Albert|Bad News|Bells|Boing|Bubbles|Cellos|Wobble|Whisper|Zarvox|Trinoids|Junior|Ralph)\b/i;

function pickVoice(all: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = all.filter((v) => /^en[-_]/i.test(v.lang));
  return (
    en.find((v) => NATURAL.test(v.name)) ??
    PREFERRED.map((n) => en.find((v) => v.name.includes(n))).find(Boolean) ??
    en.find((v) => /^en[-_]US/i.test(v.lang) && !ROBOTIC.test(v.name)) ??
    en.find((v) => !ROBOTIC.test(v.name)) ??
    null
  );
}

/** the browser fills its voice list late (Chrome: after the first getVoices call) */
function loadVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve(null);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(pickVoice(now));
  return new Promise((resolve) => {
    const done = () => { synth.removeEventListener("voiceschanged", done); window.clearTimeout(t); resolve(pickVoice(synth.getVoices())); };
    const t = window.setTimeout(done, 1500);
    synth.addEventListener("voiceschanged", done);
  });
}

/** about how long a line takes to say (and to read, when the voice is off) */
const lineMs = (text: string) => Math.max(1700, text.split(/\s+/).length * 340 + 600);

/* --------------------------------- Priya --------------------------------- */

const SKIN = "#d39a74";
const SKIN_SHADE = "#c98d68";
const HAIR = "#22140f";
const EASE = "cubic-bezier(.34,1.3,.5,1)";

/** [upper arm, forearm] angles in degrees: 0 hangs straight down, the forearm turns at the elbow */
const ARMS: Record<Pose, { r: [number, number]; l: [number, number] }> = {
  wave: { r: [-125, -35], l: [38, -95] },
  phone: { r: [16, 110], l: [-16, -110] },
  point: { r: [-98, -4], l: [38, -95] },
  // holds her phone up beside her, screen to the camera
  show: { r: [-40, -60], l: [38, -95] },
};

const turn = (deg: number, x: number, y: number, ms = 520): React.CSSProperties => ({
  transform: `rotate(${deg}deg)`,
  transformOrigin: `${x}px ${y}px`,
  transition: `transform ${ms}ms ${EASE}`,
});

/** a jointed arm: sleeve to the elbow, forearm, hand (with a finger out when pointing) */
function Arm({ x, y, angles, wave, finger }: { x: number; y: number; angles: [number, number]; wave?: boolean; finger?: boolean }) {
  const ex = x;
  const ey = y + 30;
  return (
    <g style={turn(angles[0], x, y)}>
      <g style={turn(angles[1], ex, ey, 600)}>
        <g className={wave ? "cp-priya-wave" : undefined} style={{ transformOrigin: `${ex}px ${ey}px` }}>
          <line x1={ex} y1={ey} x2={ex} y2={ey + 25} stroke={SKIN} strokeWidth="11" strokeLinecap="round" />
          <circle cx={ex} cy={ey + 29} r="7.5" fill={SKIN} />
          <line x1={ex} y1={ey + 32} x2={ex} y2={ey + 41} stroke={SKIN} strokeWidth="4.5" strokeLinecap="round" style={{ opacity: finger ? 1 : 0, transition: "opacity .3s" }} />
        </g>
      </g>
      <line x1={x} y1={y} x2={ex} y2={ey} stroke={OUTFIT} strokeWidth="16" strokeLinecap="round" />
      <circle cx={ex} cy={ey} r="6" fill={OUTFIT} />
    </g>
  );
}

/** Priya: a flat illustrated shopper whose face and body follow the story. */
function Shopper({ mood, pose }: { mood: Mood; pose: Pose }) {
  const brows: Record<Mood, string> = {
    happy: "M68 91 q8 -6 16 0 M104 91 q8 -6 16 0",
    breezy: "M68 92 q8 -4 16 0 M104 92 q8 -4 16 0",
    worried: "M68 89 q8 4 16 -2 M104 87 q8 -6 16 2",
    relieved: "M68 89 q8 -8 16 0 M104 89 q8 -8 16 0",
    crying: "M68 87 q8 6 16 -1 M104 86 q8 -7 16 1",
  };
  const mouth: Record<Mood, string> = {
    happy: "M84 126 q10 10 20 0",
    breezy: "M86 126 q8 5 16 0",
    worried: "M85 131 q9 -9 18 0",
    relieved: "M80 123 q14 16 28 0 z",
    crying: "M83 133 q5 -9 11 -4 q5 -5 11 4 q-11 5 -22 0z",
  };
  const look = mood === "crying" ? { x: 0, y: 3 } : pose === "show" ? { x: 3, y: 0 } : pose === "phone" ? { x: 0, y: 5 } : pose === "point" ? { x: 4, y: 0 } : mood === "worried" ? { x: 3, y: -1 } : { x: 0, y: 0 };
  const tilt = mood === "crying" ? -7 : pose === "show" ? -4 : pose === "phone" ? 6 : mood === "worried" ? -5 : pose === "point" ? 4 : mood === "relieved" ? -3 : 0;
  const lean = pose === "point" ? 2.5 : 0;
  const arms = ARMS[pose];
  const head = turn(tilt, 95, 142, 700);
  const eye: React.CSSProperties = { transition: "all .4s" };
  return (
    <svg viewBox="0 0 190 300" className="h-full w-full overflow-visible" aria-hidden>
      <style>{`
        @keyframes cp-priya-wave { 0%,100% { transform: rotate(-16deg) } 50% { transform: rotate(22deg) } }
        .cp-priya-wave { animation: cp-priya-wave .55s ease-in-out infinite; }
        @keyframes cp-priya-breathe { 0%,100% { transform: scaleY(1) } 50% { transform: scaleY(1.015) } }
        .cp-priya-breathe { animation: cp-priya-breathe 3.2s ease-in-out infinite; transform-origin: 95px 290px; }
      `}</style>
      <ellipse cx="95" cy="292" rx="58" ry="7" fill="rgba(0,0,0,.25)" />
      <g style={turn(lean, 95, 290, 700)}>
        <g className="cp-priya-breathe">
          {/* long hair, behind */}
          <g style={head}>
            <path d="M50 104 q-4 -52 45 -52 q49 0 45 52 v66 q-10 10 -20 0 v-52 h-50 v52 q-10 10 -20 0z" fill={HAIR} />
          </g>
          {/* legs + shoes */}
          <rect x="70" y="214" width="21" height="70" rx="9" fill="#1d2741" />
          <rect x="99" y="214" width="21" height="70" rx="9" fill="#1d2741" />
          <path d="M64 284 h29 v8 h-33 q0 -8 4 -8z" fill="#fff" />
          <path d="M97 284 h29 q4 0 4 8 h-33z" fill="#fff" />
          {/* top */}
          <path d="M54 170 q0 -28 41 -28 q41 0 41 28 v52 q0 8 -8 8 h-66 q-8 0 -8 -8z" fill={OUTFIT} />
          <path d="M78 143 q17 14 34 0" fill="none" stroke="#5b3fe0" strokeWidth="5" strokeLinecap="round" />
          <rect x="72" y="196" width="46" height="6" rx="3" fill="#5b3fe0" opacity=".6" />
          {/* neck + head */}
          <g style={head}>
            <rect x="86" y="126" width="18" height="20" rx="6" fill="#b97f5c" />
            <circle cx="95" cy="104" r="40" fill={SKIN} />
            <circle cx="56" cy="110" r="6" fill={SKIN_SHADE} />
            <circle cx="134" cy="110" r="6" fill={SKIN_SHADE} />
            <circle cx="56" cy="120" r="3" fill="#facc15" />
            <circle cx="134" cy="120" r="3" fill="#facc15" />
            <path d="M55 98 q4 -40 40 -42 q36 2 40 42 q-12 -20 -40 -24 q-28 4 -40 24z" fill={HAIR} />
            <circle cx="95" cy="88" r="2.4" fill="#e11d48" opacity=".85" />
            {/* eyes blink every few seconds */}
            <motion.g animate={{ scaleY: [1, 1, 0.1, 1, 1] }} transition={{ duration: 4, repeat: Infinity, times: [0, 0.9, 0.93, 0.96, 1] }} style={{ originY: "104px" }}>
              <ellipse cx={76 + look.x} cy={105 + look.y} rx="5" ry="6" fill="#1b1b1b" style={eye} />
              <ellipse cx={112 + look.x} cy={105 + look.y} rx="5" ry="6" fill="#1b1b1b" style={eye} />
              <circle cx={78 + look.x} cy={102 + look.y} r="1.6" fill="#fff" style={eye} />
              <circle cx={114 + look.x} cy={102 + look.y} r="1.6" fill="#fff" style={eye} />
            </motion.g>
            <motion.path d={brows[mood]} fill="none" stroke={HAIR} strokeWidth="3.5" strokeLinecap="round" animate={{ d: brows[mood] }} />
            <circle cx="66" cy="120" r="6" fill="#f472b6" opacity=".35" />
            <circle cx="124" cy="120" r="6" fill="#f472b6" opacity=".35" />
            <motion.path d={mouth[mood]} animate={{ d: mouth[mood] }} fill={mood === "relieved" || mood === "crying" ? "#7f1d1d" : "none"} stroke="#7f1d1d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            {/* tears: streaks down both cheeks, drops falling */}
            {mood === "crying" &&
              [76, 112].map((x, i) => (
                <g key={x}>
                  <motion.path d={`M${x} 112 q${i ? 3 : -3} 12 ${i ? 1 : -1} 26`} fill="none" stroke="#7cc4ff" strokeWidth="4" strokeLinecap="round" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.9 }} transition={{ duration: 0.7, delay: i * 0.15 }} />
                  <motion.circle cx={x + (i ? 1 : -1)} cy="140" r="3.2" fill="#7cc4ff" animate={{ cy: [138, 170], opacity: [1, 0] }} transition={{ duration: 0.9, repeat: Infinity, delay: 0.6 + i * 0.4 }} />
                </g>
              ))}
            {(mood === "worried" || mood === "crying") && (
              <motion.path d="M136 78 q6 10 0 14 q-6 -4 0 -14z" fill="#7cc4ff" initial={{ opacity: 0, y: -6 }} animate={{ opacity: [0, 1, 1, 0], y: [-6, 0, 10, 16] }} transition={{ duration: 1.6, repeat: Infinity }} />
            )}
          </g>
          {/* the phone, held in both hands in front of her */}
          <g style={{ opacity: pose === "phone" ? 1 : 0, transform: pose === "phone" ? "translateY(0px)" : "translateY(14px)", transition: `opacity .35s, transform .45s ${EASE}` }}>
            <rect x="82" y="150" width="26" height="42" rx="5" fill="#111827" />
            <rect x="85" y="154" width="20" height="32" rx="3" fill={mood === "worried" ? "#fecaca" : "#d9d2ff"} style={{ transition: "fill .4s" }} />
          </g>
          {/* arms */}
          <Arm x={60} y={164} angles={arms.l} />
          <Arm x={130} y={164} angles={arms.r} wave={pose === "wave"} finger={pose === "point"} />
          {mood === "relieved" &&
            [[40, 62], [150, 58], [158, 96]].map(([x, y], i) => (
              <motion.path
                key={i}
                d={`M${x} ${y - 7} l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z`}
                fill="#facc15"
                animate={{ scale: [0.6, 1.15, 0.6], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.25 }}
                style={{ originX: `${x}px`, originY: `${y}px` }}
              />
            ))}
        </g>
      </g>
    </svg>
  );
}

function GiftIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect x="6" y="18" width="36" height="26" rx="4" fill="#f43f5e" />
      <rect x="4" y="13" width="40" height="9" rx="3" fill="#fb7185" />
      <rect x="21" y="13" width="6" height="31" fill="#fde68a" />
      <path d="M24 13 q-12 -12 -14 -3 q0 5 14 3 q12 -12 14 -3 q0 5 -14 3z" fill="none" stroke="#fde68a" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------ scene pieces ------------------------------ */

const CUTS = [
  { who: "Marcus", initial: "M", color: "#0ea5e9", label: "Moved last month. The old address is still saved.", addr: "22 Elm Street, Apt 3, Austin TX 78701" },
  { who: "Sofia", initial: "S", color: "#f59e0b", label: "Ordered from her desk. It's going to the office.", addr: "Floor 9, 500 Market St, San Francisco CA 94105" },
  { who: "Dev", initial: "D", color: "#10b981", label: "Typed it in a hurry: wrong flat number.", addr: "Flat 4O2, Lake View Road, 560071" },
  { who: "Hannah", initial: "H", color: "#ec4899", label: "Tapped the first saved address, out of habit.", addr: "Mom's house, 18 Birch Lane, Dayton OH 45402" },
];

/** One fast cut: a different shopper's one-tap checkout, the address flashing red. */
function MontageCut({ i }: { i: number }) {
  const c = CUTS[i];
  return (
    <motion.div
      key={i}
      className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6"
      initial={{ opacity: 0, scale: 1.06 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div className="pointer-events-none absolute inset-0 bg-white" initial={{ opacity: 0.85 }} animate={{ opacity: 0 }} transition={{ duration: 0.35 }} />
      <p className="max-w-xl text-center text-[clamp(20px,2.6vw,32px)] font-extrabold leading-tight text-white" style={{ fontFamily: "var(--font-fraunces), Georgia, serif" }}>
        {c.label}
      </p>
      <div className="w-[min(460px,90vw)] rounded-2xl bg-white p-5 text-left shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[24px] font-extrabold tracking-[-0.04em] text-[#5a31f4]">shop</span>
          <span className="flex items-center gap-2 text-[13px] font-semibold text-neutral-600">
            <span className="flex size-7 items-center justify-center rounded-full text-[13px] font-bold text-white" style={{ background: c.color }}>{c.initial}</span>
            {c.who}
          </span>
        </div>
        <motion.div
          className="mt-4 rounded-xl border-2 px-4 py-3"
          animate={{ borderColor: ["#e5e7eb", "#e11d48", "#e11d48", "#fda4af", "#e11d48"], backgroundColor: ["#fff", "#fff1f2", "#ffe4e6", "#fff1f2", "#ffe4e6"] }}
          transition={{ duration: 1.1, delay: 0.3 }}
        >
          <div className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">Ship to</div>
          <div className="mt-1 text-[15px] font-semibold text-neutral-900">{c.addr}</div>
        </motion.div>
        <div className="mt-4 flex h-11 items-center justify-center rounded-lg bg-[#5a31f4] text-[15px] font-bold text-white">Pay now</div>
      </div>
    </motion.div>
  );
}

/** The store's side: a ticket and a follow-up, the warehouse already moving, three bad outcomes. */
function ProblemDesk({ step }: { step: number }) {
  const stages = ["Picked", "Packed", "Labelled"];
  const outcomes = ["Cancel & refund", "Re-ship at your cost", "Failed delivery → RTO"];
  return (
    <motion.div className="absolute inset-0 flex items-center justify-center bg-[rgba(4,8,22,.9)] px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="grid w-[min(900px,92vw)] gap-5 md:grid-cols-2">
        {/* inbox */}
        <div className="rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/15">
          <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/50">Support inbox</div>
          <div className="mt-4 space-y-3">
            {[
              { t: "Wrong address on my order!!", s: "Priya · 2 min ago", show: step >= 1 },
              { t: "Hello?? Can someone change it before it ships?", s: "Priya · follow-up", show: step >= 2 },
            ].map((m) =>
              m.show ? (
                <motion.div key={m.t} className="rounded-xl bg-white p-3.5 shadow-xl" initial={{ x: -40, opacity: 0, rotate: -3 }} animate={{ x: 0, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 170, damping: 16 }}>
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-rose-600">
                    <span className="size-2 rounded-full bg-rose-500" /> New ticket
                  </div>
                  <div className="mt-1 text-[15px] font-semibold text-neutral-900">{m.t}</div>
                  <div className="text-[12px] text-neutral-500">{m.s}</div>
                </motion.div>
              ) : null
            )}
          </div>
        </div>
        {/* warehouse */}
        <div className="rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/15">
          <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/50">Warehouse</div>
          <div className="mt-4 flex items-center gap-2">
            {stages.map((s, i) => (
              <motion.div
                key={s}
                className="flex flex-1 flex-col items-center gap-2 rounded-xl px-2 py-3 text-[13px] font-bold"
                animate={step >= 3 ? { backgroundColor: "rgba(250,204,21,.16)", color: "#fde68a" } : { backgroundColor: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.35)" }}
                transition={{ delay: step >= 3 ? i * 0.45 : 0 }}
              >
                <motion.span
                  className="flex size-8 items-center justify-center rounded-full text-[15px]"
                  animate={step >= 3 ? { backgroundColor: "#facc15", color: "#1c1917", scale: [1, 1.2, 1] } : { backgroundColor: "rgba(255,255,255,.08)", color: "rgba(255,255,255,.4)" }}
                  transition={{ delay: step >= 3 ? i * 0.45 : 0 }}
                >
                  ✓
                </motion.span>
                {s}
              </motion.div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {outcomes.map((o, i) =>
              step >= 4 ? (
                <motion.div key={o} className="rounded-lg bg-rose-500/15 px-3.5 py-2.5 text-[15px] font-semibold text-rose-200 ring-1 ring-rose-400/30" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.5 }}>
                  {o}
                </motion.div>
              ) : null
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** VHS rewind: scanlines, a shaky ⏪ and the picture running backwards. */
function Rewind() {
  return (
    <motion.div className="absolute inset-0 overflow-hidden bg-[rgba(4,8,22,.55)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div
        className="absolute inset-0"
        style={{ background: "repeating-linear-gradient(0deg, rgba(255,255,255,.07) 0 2px, transparent 2px 5px)" }}
        animate={{ y: [0, -40] }}
        transition={{ duration: 0.25, repeat: Infinity, ease: "linear" }}
      />
      <motion.div className="absolute inset-x-0 h-24 bg-white/10 blur-md" animate={{ top: ["110%", "-20%"] }} transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }} />
      <motion.div className="absolute left-8 top-[11vh] flex items-center gap-3 font-mono text-[clamp(24px,3vw,40px)] font-bold tracking-widest text-white" animate={{ x: [0, -3, 2, 0], opacity: [1, 0.8, 1] }} transition={{ duration: 0.18, repeat: Infinity }}>
        <svg width="44" height="30" viewBox="0 0 44 30" fill="#fff" aria-hidden><path d="M22 2 L2 15 L22 28z M42 2 L22 15 L42 28z" /></svg>
        REWIND
      </motion.div>
    </motion.div>
  );
}

/** The order in the vault during the edit window; it opens and the parcel ships. */
function Vault({ open }: { open: boolean }) {
  const [secs, setSecs] = useState(59 * 60 + 41);
  useEffect(() => {
    if (open) return;
    const id = window.setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [open]);
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <motion.div
      className="absolute right-[3vw] top-[12vh] w-[min(320px,80vw)] overflow-hidden rounded-2xl bg-[#0b1020] text-white shadow-[0_30px_70px_-20px_rgba(0,0,0,.7)] ring-1 ring-white/10"
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
    >
      <div className="flex items-center gap-4 p-5">
        <motion.div className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl" animate={{ backgroundColor: open ? "#16a34a" : "#1e293b" }}>
          <svg width="34" height="38" viewBox="0 0 34 38" fill="none" aria-hidden>
            <motion.path
              d="M9 17 V11 a8 8 0 0 1 16 0 V17"
              stroke="#fff"
              strokeWidth="3.5"
              strokeLinecap="round"
              animate={open ? { rotate: -35, x: -6, y: -3 } : { rotate: 0, x: 0, y: 0 }}
              style={{ originX: "25px", originY: "17px" }}
              transition={{ type: "spring", stiffness: 200, damping: 12 }}
            />
            <rect x="4" y="16" width="26" height="19" rx="4" fill="#fff" />
            <circle cx="17" cy="25" r="2.6" fill={open ? "#16a34a" : "#1e293b"} />
          </svg>
        </motion.div>
        <div className="min-w-0">
          <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-white/50">{open ? "Released" : "Order in the vault"}</div>
          <div className="mt-1 text-[17px] font-bold leading-snug">{open ? "Sent to the warehouse with the right address" : "Not sent for picking. Nobody touches it."}</div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-[14px]">
        <span className="text-white/60">{open ? "Address verified" : "Edit window"}</span>
        <span className={`font-mono font-bold tabular-nums ${open ? "text-emerald-400" : "text-amber-300"}`}>{open ? "✓" : clock}</span>
      </div>
    </motion.div>
  );
}

/** The parcel, on its way — first time right. */
function Truck() {
  return (
    <motion.div className="pointer-events-none absolute bottom-[16vh] left-0" initial={{ x: "-30vw" }} animate={{ x: "110vw" }} transition={{ duration: 4.2, ease: [0.4, 0, 0.6, 1] }}>
      <svg width="170" height="86" viewBox="0 0 170 86" aria-hidden>
        <rect x="4" y="10" width="100" height="56" rx="6" fill="#fff" />
        <rect x="18" y="26" width="34" height="24" rx="3" fill="#d6a46b" />
        <path d="M18 34 h34 M35 26 v24" stroke="#a87741" strokeWidth="2" />
        <path d="M104 28 h34 l22 22 v16 h-56z" fill={BLUE} />
        <rect x="112" y="34" width="22" height="14" rx="2" fill="#bfdbfe" />
        <circle cx="34" cy="70" r="11" fill="#111827" /><circle cx="34" cy="70" r="4" fill="#9ca3af" />
        <circle cx="132" cy="70" r="11" fill="#111827" /><circle cx="132" cy="70" r="4" fill="#9ca3af" />
      </svg>
    </motion.div>
  );
}

/* -------------------------------- the film -------------------------------- */

/** the store, as Priya sees it on her phone */
function StorePhone({ store, logo, product }: { store: string; logo: string | null; product: { title: string; image: string | null } | null }) {
  return (
    <div className="relative h-full w-full rounded-[16%/7.6%] bg-[#0b0d12] p-[4.5%] shadow-[0_30px_80px_rgba(0,0,0,.55)] ring-1 ring-white/15">
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[12%/5.6%] bg-white text-neutral-900">
        <span className="absolute left-1/2 top-[1.6%] z-10 h-[3.2%] w-[32%] -translate-x-1/2 rounded-full bg-black" />
        <div className="flex h-[17%] shrink-0 items-end justify-center border-b border-neutral-200 px-[8%] pb-[4%]">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="max-h-[52%] max-w-full object-contain" />
          ) : (
            <span className="truncate text-[11px] font-extrabold uppercase tracking-[0.14em]">{store}</span>
          )}
        </div>
        <div className="relative aspect-square w-full shrink-0 bg-neutral-100">
          {product?.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[6%] px-[7%] pt-[6%]">
          <div className="line-clamp-2 text-[10px] font-semibold leading-tight">{product?.title || store}</div>
          <div className="flex h-[22%] min-h-[18px] items-center justify-center rounded-md border border-neutral-900 text-[9px] font-semibold">Add to cart</div>
          <div className="flex h-[22%] min-h-[18px] items-center justify-center gap-1 rounded-md bg-[#5a31f4] text-[9px] font-semibold text-white">
            Buy with <span className="text-[11px] font-black tracking-tight">shop</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 1 · Priya alone at center, showing the store on her phone; then the phone zooms into the real site */
function Intro({ zoom, gift, store, logo, product }: { zoom: boolean; gift: boolean; store: string; logo: string | null; product: { title: string; image: string | null } | null }) {
  // --ph: Priya's height; she and the phone share one box, centered
  const box = { "--ph": "min(54vh, 480px)", height: "var(--ph)", width: "calc(var(--ph) * 0.83)" } as React.CSSProperties;
  return (
    <motion.div className="absolute inset-0" exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      <motion.div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 55%, #1c2547 0%, #070a16 72%)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: zoom ? 0 : 1 }}
        transition={{ duration: zoom ? 0.9 : 0.5, delay: zoom ? 0.25 : 0 }}
      />
      <div className="absolute bottom-[calc(15vh+3vh)] left-1/2 -translate-x-1/2" style={box}>
        {/* Priya */}
        <motion.div
          className="absolute bottom-0 left-0 h-full"
          style={{ width: "calc(var(--ph) * 0.633)" }}
          initial={{ y: 50, opacity: 0 }}
          animate={zoom ? { y: 40, opacity: 0 } : { y: 0, opacity: 1 }}
          transition={zoom ? { duration: 0.45 } : { type: "spring", stiffness: 90, damping: 15 }}
        >
          <Shopper mood="happy" pose="show" />
          <AnimatePresence>
            {gift && (
              <motion.div
                key="gift"
                className="absolute -left-[46%] top-[0%] flex size-24 items-center justify-center rounded-full bg-white shadow-2xl"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 16 }}
              >
                <GiftIcon className="size-14" />
                <span className="absolute -bottom-3 right-3 size-5 rounded-full bg-white" />
                <span className="absolute -bottom-7 right-0 size-3 rounded-full bg-white" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        {/* her phone, held up beside her: it becomes the site */}
        <motion.div
          className="absolute"
          style={{ left: "calc(var(--ph) * 0.55)", top: "calc(var(--ph) * 0.12)", width: "calc(var(--ph) * 0.275)", height: "calc(var(--ph) * 0.58)" }}
          initial={{ opacity: 0, scale: 0.5, rotate: 8 }}
          animate={zoom ? { opacity: [1, 1, 0], scale: 7, rotate: 0 } : { opacity: 1, scale: 1, rotate: 3 }}
          transition={zoom ? { duration: 1.1, ease: [0.7, 0, 0.3, 1], opacity: { duration: 1.1, times: [0, 0.6, 1] } } : { delay: 0.35, type: "spring", stiffness: 180, damping: 16 }}
        >
          <StorePhone store={store} logo={logo} product={product} />
          {/* her fingers round the edge */}
          <span className="absolute -left-[9%] top-[74%] h-[9%] w-[24%] rounded-full" style={{ background: SKIN }} />
        </motion.div>
      </div>
    </motion.div>
  );
}

export function StoryTour({
  frame, store, logo, onEnd, onReplay,
}: {
  frame: React.RefObject<HTMLIFrameElement | null>;
  store: string;
  /** the store's logo, for the site on Priya's phone */
  logo?: string | null;
  /** the story is over (or skipped): back to the live demo */
  onEnd: () => void;
  /** reload the store's checkout and play again */
  onReplay: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [mood, setMood] = useState<Mood>("happy");
  const [pose, setPose] = useState<Pose>("wave");
  const [onStage, setOnStage] = useState(false);
  const [gift, setGift] = useState(false);
  /** the opening: Priya alone at center with the store on her phone, then the phone zooms into the site */
  const [intro, setIntro] = useState<"off" | "on" | "zoom">("off");
  const [product] = useState<{ title: string; image: string | null } | null>(() => {
    try {
      const it = JSON.parse(sessionStorage.getItem("cp-cart") || "null")?.items?.[0];
      return it ? { title: String(it.title || ""), image: it.image || null } : null;
    } catch { return null; }
  });
  const [spot, setSpot] = useState<Rect | null>(null);
  const [stamp, setStamp] = useState<Rect | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; tap: number } | null>(null);
  const [cut, setCut] = useState<number | null>(null);
  const [desk, setDesk] = useState(0);
  const [rewind, setRewind] = useState(false);
  const [vault, setVault] = useState<"off" | "locked" | "open">("off");
  const [truck, setTruck] = useState(false);
  const [finale, setFinale] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const seq = useRef(0);

  // where the store's header ends in the frame: nothing in the film ever covers it
  const [head, setHead] = useState(84);
  useEffect(() => {
    const measure = () => {
      try {
        const h = frame.current?.contentDocument?.querySelector<HTMLElement>("header, [role=banner]");
        // pinned, so the store's name stays on screen even when the page scrolls
        if (h && !h.dataset.cpPinned) {
          h.dataset.cpPinned = "1";
          Object.assign(h.style, { position: "sticky", top: "0px", zIndex: "60" });
        }
        if (h) setHead(Math.max(0, Math.round(h.getBoundingClientRect().bottom)));
      } catch { /* not ready */ }
    };
    measure();
    const t = window.setInterval(measure, 400);
    return () => window.clearInterval(t);
  }, [frame]);

  useEffect(() => { mutedRef.current = muted; if (muted) window.speechSynthesis?.cancel(); }, [muted]);

  /* ---- talking to the page in the frame ---- */
  const send = useCallback((msg: Record<string, unknown> & { do: string }, timeout = 20000) => {
    const id = ++seq.current;
    return new Promise<Reply>((resolve) => {
      const done = (r: Reply) => { window.removeEventListener("message", onMsg); window.clearTimeout(t); resolve(r); };
      const onMsg = (e: MessageEvent) => {
        if (e.origin === window.location.origin && e.data?.type === "cp:story-event" && e.data.id === id) done(e.data);
      };
      const t = window.setTimeout(() => done({ ok: false }), timeout);
      window.addEventListener("message", onMsg);
      frame.current?.contentWindow?.postMessage({ type: "cp:story", id, ...msg }, window.location.origin);
    });
  }, [frame]);

  const waitFor = useCallback((ev: string, timeout = 30000) => new Promise<Reply>((resolve) => {
    const done = (r: Reply) => { window.removeEventListener("message", onMsg); window.clearTimeout(t); resolve(r); };
    const onMsg = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.type === "cp:story-event" && e.data.ev === ev) done(e.data);
    };
    const t = window.setTimeout(() => done({ ok: false }), timeout);
    window.addEventListener("message", onMsg);
  }), []);

  useEffect(() => {
    const token = { cancelled: false };
    const check = () => { if (token.cancelled) throw new Cancelled(); };
    const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms)).then(check);

    const voiceReady = loadVoice();

    /** one sentence, spoken; resolves when it has finished (never cut short mid-word) */
    const speak = (synth: SpeechSynthesis, voice: SpeechSynthesisVoice | null, text: string) =>
      new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        u.rate = 0.98;
        let settled = false;
        const end = () => { if (!settled) { settled = true; window.clearTimeout(guard); resolve(); } };
        // if speech never starts (no voices, a background tab), fall back to reading time;
        // once it has started, give it plenty of room to finish
        let guard = window.setTimeout(end, 2500);
        u.onstart = () => { window.clearTimeout(guard); guard = window.setTimeout(end, lineMs(text) * 2 + 4000); };
        u.onend = end;
        u.onerror = end;
        synth.speak(u);
      });

    /** a subtitle, said aloud: resolves once it has been said (or read) */
    const say = async (text: string) => {
      check();
      setCaption(text);
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      const voice = synth ? await voiceReady : null;
      check();
      if (!synth || !voice || mutedRef.current) return wait(lineMs(text));
      const started = Date.now();
      synth.cancel();
      // sentence by sentence: natural pauses, and Chrome stops utterances longer than ~15s
      for (const part of text.match(/[^.!?:]+[.!?:]*/g) ?? [text]) {
        if (mutedRef.current) break;
        await speak(synth, voice, part.trim().replace(/\bRTOs\b/g, "R T Os").replace(/\bRTO\b/g, "R T O"));
        check();
      }
      // muted mid-line: still leave the caption up long enough to read
      const left = lineMs(text) - (Date.now() - started);
      await wait(mutedRef.current && left > 0 ? left : 240);
    };

    const rect = async (what: string) => { const r = await send({ do: "rect", what }, 4000); check(); return r.rect ?? null; };
    const tap = async (r: Rect | null) => {
      if (!r) return;
      setPointer({ x: r.left + r.width / 2, y: r.top + r.height / 2, tap: 0 });
      await wait(950);
      setPointer((p) => (p ? { ...p, tap: p.tap + 1 } : p));
      await wait(320);
    };

    (async () => {
      try {
        await send({ do: "persona", persona: PRIYA }, 3000);
        check();
        await wait(250);

        /* 1–2 · Priya, the store on her phone; the phone becomes the site */
        setIntro("on");
        await wait(1100);
        await say(`This is Priya. She's shopping at ${store}.`);
        setGift(true);
        await say("She's buying a gift for her sister's birthday.");
        setGift(false);
        setIntro("zoom");
        await wait(1200);
        setIntro("off");

        setSpot(await rect("express"));
        await say("She hits express checkout. One tap.");
        const sp = await rect("shoppay");
        setSpot(sp);
        setPose("point");
        await tap(sp);
        setPointer(null);
        setSpot(null);
        setPose("phone");
        await send({ do: "shoppay" });
        check();

        setMood("breezy");
        const addr = await rect("address");
        setSpot(addr);
        await say("Address auto-filled. Her checkout is so smooth, she doesn't even look at it.");
        setStamp(addr);
        await wait(900);

        setMood("happy");
        const pay = await rect("paynow");
        setSpot(pay);
        setPose("point");
        await tap(pay);
        setPointer(null);
        setPose("phone");
        const thanks = waitFor("thankyou-ready", 40000);
        await send({ do: "pay" }, 3000);
        check();
        await say("Payment done.");
        setSpot(null);
        setStamp(null);
        await say("That gift is now going to her house. Not her sister's.");

        /* 3 · she notices */
        await thanks;
        check();
        await wait(600);
        // she's back: the order went wrong
        setMood("crying");
        setPose("phone");
        setOnStage(true);
        await wait(800);
        await say("Five minutes later, she notices. And she panics.");
        await wait(500);
        setOnStage(false);
        await wait(500);

        /* 3b · it's not just gifts */
        for (let i = 0; i < CUTS.length; i += 1) {
          setCut(i);
          if (i === 0) void say("It's not just gifts. It's an every-order problem.").catch(() => {});
          await wait(2700);
        }
        setCut(null);
        await say("Checkout on autopilot means a wrong address, every day.");

        /* 4 · it becomes the store's problem */
        setDesk(1);
        await say("And the moment they realise, it becomes your problem.");
        setDesk(2);
        await say("A ticket. Then a follow-up, because nobody replied fast enough.");
        setDesk(3);
        await say("By the time your agent pings the warehouse, it's picked, packed and labelled.");
        setDesk(4);
        await say("So it's cancel and refund, re-ship at your cost, or a failed delivery and an RTO.");
        await say("Every day. Every sale. Every festive rush.");

        /* 5 · rewind */
        setDesk(0);
        setRewind(true);
        setMood("happy");
        await say("Now let's rewind, with ClickPost.");
        setRewind(false);

        /* 6 · the edit window, the vault, the fix */
        setPose("point");
        setSpot(await rect("editing"));
        await say("Same order, same checkout. But now, right on the confirmation page: edit your order, with a timer.");
        await say("You choose the window. Thirty minutes, an hour, whatever fits your ops.");
        setVault("locked");
        await say("And during that window, the order is vaulted. It's not pushed for picking. It just waits.");
        const ship = await rect("address");
        setSpot(ship);
        await tap(ship);
        setPointer(null);
        setPose("phone");
        const fixing = send({ do: "fix-address" }, 20000);
        // the form opens under the button: follow it
        window.setTimeout(() => { rect("address").then(setSpot).catch(() => {}); }, 1300);
        await say("Priya taps edit, fixes the address, and it gets verified.");
        await fixing;
        check();
        setSpot(null);
        setMood("relieved");
        setPose("wave");
        await say("Twenty seconds. Zero tickets. Zero agents.");

        /* 7 · the vault opens, it ships right */
        setVault("open");
        await wait(700);
        setTruck(true);
        await say("When the window closes, the order goes to your warehouse with the right details, the first time.");
        await say("No re-shipping. No RTO. No where's-my-order chase.");

        /* 8 · end card */
        setVault("off");
        setFinale(true);
        await say(`For ${store}: fewer tickets, fewer RTOs, and a post-purchase experience as good as your checkout.`);
      } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
      }
    })();

    return () => {
      token.cancelled = true;
      window.speechSynthesis?.cancel();
    };
  }, [store, send, waitFor]);

  // soft cinematic spotlight: everything outside the subject sinks into shadow
  const vignette = spot
    ? `radial-gradient(ellipse ${Math.max(spot.width * 0.85, 140)}px ${Math.max(spot.height * 1.6, 90)}px at ${spot.left + spot.width / 2}px ${spot.top + spot.height / 2}px, rgba(4,8,22,0) 55%, rgba(4,8,22,.62) 100%)`
    : "rgba(4,8,22,0.18)";

  return (
    <div className="absolute inset-0 z-40 overflow-hidden" style={{ "--cp-head": `${head}px` } as React.CSSProperties}>
      <motion.div className="pointer-events-none absolute inset-0" style={{ maskImage: HEADER_CLEAR, WebkitMaskImage: HEADER_CLEAR }} animate={{ background: vignette }} transition={{ duration: 0.6, ease: "easeInOut" }} />

      {/* "not her sister's" stamp on the auto-filled address */}
      <AnimatePresence>
        {stamp && (
          <motion.div
            key="stamp"
            className="pointer-events-none absolute whitespace-nowrap rounded-md border-[3px] border-[#e11d48] px-3 py-1 text-[14px] font-black uppercase tracking-[0.12em] text-[#e11d48]"
            style={{ top: stamp.top - 24, left: stamp.left + stamp.width - 230, background: "rgba(255,255,255,.94)" }}
            initial={{ scale: 2.4, opacity: 0, rotate: -14 }}
            animate={{ scale: 1, opacity: 1, rotate: -6 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 18 }}
          >
            Her home, not her sister&apos;s
          </motion.div>
        )}
      </AnimatePresence>

      {/* the pointer: glides to a button and presses it */}
      <AnimatePresence>
        {pointer && (
          <motion.div
            key="pointer"
            className="pointer-events-none absolute left-0 top-0"
            initial={{ x: pointer.x + 220, y: pointer.y + 160, opacity: 0 }}
            animate={{ x: pointer.x, y: pointer.y, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: [0.45, 0, 0.2, 1] }}
          >
            {pointer.tap > 0 && (
              <motion.span key={pointer.tap} className="absolute -left-5 -top-5 size-10 rounded-full border-[3px] border-white" initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 1.8, opacity: 0 }} transition={{ duration: 0.6 }} />
            )}
            <motion.svg width="34" height="40" viewBox="0 0 24 28" key={`p${pointer.tap}`} animate={pointer.tap ? { scale: [1, 0.82, 1] } : {}} transition={{ duration: 0.3 }} style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,.45))" }}>
              <path d="M3 2 L3 22 L8.5 17 L12 25 L15.5 23.5 L12 15.8 L19.5 15.8 Z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
            </motion.svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* the full-screen scenes play below the store's header */}
      <div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ top: head }}>
      {/* 1 · the opening: Priya and her phone */}
      <AnimatePresence>
        {intro !== "off" && <Intro key="intro" zoom={intro === "zoom"} gift={gift} store={store} logo={logo ?? null} product={product} />}
      </AnimatePresence>
      {/* 3b · the montage */}
      <AnimatePresence>
        {cut !== null && (
          <motion.div key="montage" className="absolute inset-0 bg-[rgba(4,8,22,.92)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AnimatePresence mode="wait">
              <MontageCut key={cut} i={cut} />
            </AnimatePresence>
            <div className="absolute left-1/2 top-[10vh] flex -translate-x-1/2 gap-1.5">
              {CUTS.map((_, i) => <span key={i} className="h-1 w-8 rounded-full" style={{ background: i <= cut ? "#fff" : "rgba(255,255,255,.2)" }} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4 · the store's problem */}
      <AnimatePresence>{desk > 0 && <ProblemDesk key="desk" step={desk} />}</AnimatePresence>

      {/* 5 · rewind */}
      <AnimatePresence>{rewind && <Rewind key="rewind" />}</AnimatePresence>

      {/* 6–7 · the vault, the truck */}
      <AnimatePresence>{vault !== "off" && <Vault key="vault" open={vault === "open"} />}</AnimatePresence>
      {truck && !finale && <Truck />}
      </div>

      {/* letterbox */}
      <motion.div className="absolute inset-x-0 bottom-0 h-[15vh] min-h-[96px] bg-black" initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />

      {/* Priya */}
      <motion.div
        className="pointer-events-none absolute bottom-[3vh] left-[2vw] h-[min(350px,46vh)] w-[min(222px,29vh)]"
        initial={{ x: "-140%" }}
        animate={onStage && !finale ? { x: 0 } : { x: "-140%" }}
        transition={{ type: "spring", stiffness: 70, damping: 14 }}
      >
        <motion.div className="h-full w-full" animate={{ y: [0, -5, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
          <Shopper mood={mood} pose={pose} />
        </motion.div>
      </motion.div>

      {/* subtitles */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[15vh] min-h-[96px] items-center justify-center pl-[min(240px,30vh)] pr-[210px]">
        <AnimatePresence mode="wait">
          {caption && !finale && (
            <motion.p
              key={caption}
              className="max-w-3xl text-center text-[clamp(17px,2.1vw,26px)] font-semibold leading-snug text-white"
              style={{ textShadow: "0 2px 12px rgba(0,0,0,.6)" }}
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
              transition={{ duration: 0.35 }}
            >
              {caption}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* controls */}
      <div className="absolute bottom-[max(16px,calc(7.5vh-18px))] right-4 z-10 flex gap-2">
        <button
          onClick={() => setMuted((m) => !m)}
          className="flex h-9 items-center gap-1.5 rounded-full bg-black/70 px-3.5 text-[13px] font-semibold text-white ring-1 ring-white/20 backdrop-blur hover:bg-black/85"
          aria-label={muted ? "Turn voice on" : "Turn voice off"}
        >
          {muted ? "🔇 Voice off" : "🔊 Voice on"}
        </button>
        <button onClick={onEnd} className="flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-bold text-neutral-800 shadow-lg hover:bg-neutral-100">
          Skip
        </button>
      </div>

      {/* 8 · end card */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden" style={{ top: head }}>
      <AnimatePresence>
        {finale && (
          <motion.div key="finale" className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-[rgba(4,8,22,.94)] p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
            <motion.div className="w-full max-w-2xl text-center" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
              <div className="text-[13px] font-bold uppercase tracking-[0.24em] text-[#7da6ff]">For {store}</div>
              <h2 className="mx-auto mt-3 max-w-xl text-[clamp(28px,4vw,48px)] font-extrabold leading-[1.08] tracking-tight text-white" style={{ fontFamily: "var(--font-fraunces), Georgia, serif" }}>
                A post-purchase experience as good as your checkout.
              </h2>
              <div className="mx-auto mt-7 grid max-w-xl gap-3 text-left sm:grid-cols-3">
                {[
                  ["Fewer support tickets", "Customers fix address mistakes themselves."],
                  ["Fewer RTOs", "Nothing ships until the details are right."],
                  ["Zero manual work", "No agents, no warehouse back-and-forth."],
                ].map(([h, d], i) => (
                  <motion.div key={h} className="rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/10" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 + i * 0.15 }}>
                    <div className="text-[15px] font-bold text-white">{h}</div>
                    <div className="mt-1 text-[13px] leading-snug text-white/60">{d}</div>
                  </motion.div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <a href={APP_URL} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center rounded-full px-7 text-[15px] font-bold text-white shadow-[0_12px_30px_-10px_rgba(21,95,255,.8)] hover:brightness-110" style={{ background: BLUE }}>
                  Get it on the Shopify App Store
                </a>
                <button onClick={onReplay} className="inline-flex h-12 items-center rounded-full bg-white/10 px-6 text-[15px] font-semibold text-white ring-1 ring-white/25 hover:bg-white/20">
                  ↺ Watch again
                </button>
                <button onClick={onEnd} className="inline-flex h-12 items-center rounded-full px-5 text-[15px] font-semibold text-white/70 hover:text-white">
                  Back to the store
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
