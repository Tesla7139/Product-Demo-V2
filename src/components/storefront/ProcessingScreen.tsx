"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Lock } from "lucide-react";
import { AnimatedCheck, StoreLogo, type Brand } from "./shared";

// Full-screen "your order's being processed" moment between Pay now and the
// order confirmation, worded after Shopify's own checkout: each step spins,
// then ticks; once all are done a success check draws before handing on.

const STEP_MS = 950;
const SUCCESS_MS = 1700;

export function ProcessingScreen({
  brand, accent, title, steps, success, onDone,
}: {
  brand: Brand;
  accent: string;
  title: string;
  steps: string[];
  /** shown with a drawn check once every step is done; skipped when absent */
  success?: { title: string; subtitle?: string };
  onDone: () => void;
}) {
  const [done, setDone] = useState(0); // steps finished so far
  // the latest onDone, so a parent re-render mid-sequence doesn't restart the timers
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const hasSuccess = !!success;

  useEffect(() => {
    if (done < steps.length) {
      const t = window.setTimeout(() => setDone((d) => d + 1), STEP_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => onDoneRef.current(), hasSuccess ? SUCCESS_MS : 250);
    return () => window.clearTimeout(t);
  }, [done, steps.length, hasSuccess]);

  const finished = done >= steps.length;

  return (
    <div className="cp-fade fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
      <div className="absolute left-0 right-0 top-0 flex justify-center border-b border-neutral-200 py-5">
        <StoreLogo brand={brand} className="max-h-8 max-w-[150px] object-contain" />
      </div>

      {finished && success ? (
        <div key="success" className="flex flex-col items-center text-center">
          <AnimatedCheck color={accent} size={84} />
          <h2 className="cp-heading cp-rise mt-6 text-[26px]" style={{ animationDelay: "500ms" }}>{success.title}</h2>
          {success.subtitle && (
            <p className="cp-rise mt-1.5 text-[15px] text-neutral-500" style={{ animationDelay: "650ms" }}>{success.subtitle}</p>
          )}
        </div>
      ) : (
        <div key="steps" className="w-full max-w-sm">
          <div className="flex justify-center">
            <span
              className="size-11 animate-spin rounded-full border-[3px] border-neutral-200"
              style={{ borderTopColor: accent }}
              role="progressbar"
              aria-label={title}
            />
          </div>
          <h2 className="cp-heading mt-6 text-center text-[24px]">{title}</h2>
          <p className="mt-1.5 text-center text-[14px] text-neutral-500">Please don&apos;t close or refresh this page.</p>

          <ol className="mt-8 space-y-4">
            {steps.map((s, i) => {
              const state = i < done ? "done" : i === done ? "active" : "waiting";
              return (
                <li
                  key={s}
                  className={`cp-rise flex items-center gap-3 text-[15px] transition-colors duration-300 ${state === "waiting" ? "text-neutral-400" : "text-neutral-900"}`}
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300"
                    style={state === "done" ? { background: accent, borderColor: accent } : { borderColor: state === "active" ? accent : "#d4d4d4" }}
                  >
                    {state === "done" ? (
                      <Check className="cp-pop size-3.5 text-white" strokeWidth={3.5} />
                    ) : state === "active" ? (
                      <span className="size-2.5 animate-pulse rounded-full" style={{ background: accent }} />
                    ) : null}
                  </span>
                  {s}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="absolute bottom-8 flex items-center gap-1.5 text-[13px] text-neutral-500">
        <Lock className="size-3.5" /> Secure and encrypted
      </div>
    </div>
  );
}
