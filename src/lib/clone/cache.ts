import type { Upstream } from "./upstream";

// One short-lived cache for everything the storefront preview fetches from a
// store, shared by /api/clone-start (which pre-fetches the page a preview will
// open on) and the /clone proxy (which serves it). Entries hold the in-flight
// promise, so a request that arrives while the same fetch is running joins it
// instead of starting another. Per server instance — a cold instance just misses.

type Entry = { at: number; ttl: number; value: Promise<Upstream | null> };

const entries = new Map<string, Entry>();
const MAX_ENTRIES = 300;

export const PAGE_TTL = 2 * 60 * 1000;
export const DATA_TTL = 5 * 60 * 1000;

/** Fetch through the cache: a fresh (or in-flight) entry is reused; failures aren't kept. */
export function cachedUpstream(key: string, ttl: number, load: () => Promise<Upstream | null>): Promise<Upstream | null> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;

  const value = load().then((up) => {
    // only worth keeping: real answers small enough to hold in memory
    if (!up || up.status >= 400 || up.body.byteLength > 3_000_000) entries.delete(key);
    return up;
  });
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(key, { at: Date.now(), ttl, value });
  return value;
}

/** Cache key for a page or data request (the storefront password cookie is part of it). */
export const cacheKey = (kind: "page" | "data", target: string, digest?: string) => `${kind}|${digest ?? ""}|${target}`;
