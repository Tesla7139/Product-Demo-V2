// What the demo shows after payment, picked on the start screen: order editing,
// post-purchase upsells, or both. Kept in sessionStorage so the store copy and
// its checkout (same origin, same tab) read the same choice.

export type DemoMode = "edit" | "upsell" | "both";

const KEY = "cp-mode";

export function readDemoMode(): DemoMode {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v === "edit" || v === "upsell" || v === "both") return v;
  } catch {
    /* storage blocked */
  }
  return "both";
}

export function saveDemoMode(mode: DemoMode) {
  try {
    sessionStorage.setItem(KEY, mode);
  } catch {
    /* storage blocked */
  }
}

export const showsEditing = (m: DemoMode) => m !== "upsell";
export const showsUpsells = (m: DemoMode) => m !== "edit";
