import { isBlockedHost } from "./upstream";

// Stores that sell in several languages often default to their home language
// (doonails.com is German) and keep English on another domain (us.doonails.com),
// listed on every page as <link rel="alternate" hreflang="en-us">. The preview
// follows those links so demos open in English.

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** The page's <link rel="alternate" hreflang> versions, as [language, absolute URL]. */
export function alternates(html: string, base: string): [string, string][] {
  const out: [string, string][] = [];
  for (const [tag] of html.matchAll(/<link[^>]+rel=["']alternate["'][^>]*>/gi)) {
    const lang = tag.match(/hreflang=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!lang || !href) continue;
    try {
      out.push([lang, new URL(href.replace(/&amp;/g, "&"), base).toString()]);
    } catch {
      /* malformed href */
    }
  }
  return out;
}

/** URL of the page's English version when the page itself isn't English (else null). */
export function englishAlternate(html: string, pageUrl: string): string | null {
  const lang = html.match(/<html[^>]*\slang=["']?([a-z]{2})/i)?.[1]?.toLowerCase();
  if (!lang || lang === "en") return null;
  const alts = alternates(html, pageUrl);
  // a US English site first: the checkout that follows uses a US address
  for (const want of ["en-us", "en", "en-gb"]) {
    const hit = alts.find(([l]) => l === want);
    if (hit && hit[1] !== pageUrl) return hit[1];
  }
  const any = alts.find(([l]) => l.startsWith("en"));
  return any && any[1] !== pageUrl ? any[1] : null;
}

/** Hosts of the store's other language/market sites. */
export function alternateHosts(html: string): string[] {
  return alternates(html, "https://invalid.local/")
    .map(([, href]) => new URL(href).hostname)
    .filter((h) => h !== "invalid.local" && !isBlockedHost(h))
    .map(bare);
}
