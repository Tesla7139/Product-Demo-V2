// Background scripts the storefront copy doesn't load. None of them draws
// anything a shopper sees — they're analytics, ad pixels and Shopify's web-pixel
// sandbox (which, under the copy, opens a dozen iframes that each load a full
// 404 page from our app) plus the express-checkout bundle Shopify preloads in the
// background (~150 files on some stores). Together they hold up the page's
// "ready" and compete with the preview's own animations.
//
// The /clone route strips matching <script>/<link rel=preload> tags from the
// HTML, and passes this pattern to /clone-runtime.js, which drops matching
// scripts and iframes the page tries to add later.
export const BACKGROUND_SCRIPTS = new RegExp(
  [
    "googletagmanager\\.com",
    "google-analytics\\.com",
    "googleadservices\\.com",
    "doubleclick\\.net",
    "connect\\.facebook\\.net",
    "analytics\\.tiktok\\.com",
    "(?:static|script)\\.hotjar\\.com",
    "clarity\\.ms",
    "bat\\.bing\\.com",
    "sc-static\\.net",
    "s\\.pinimg\\.com",
    "ct\\.pinterest\\.com",
    "snap\\.licdn\\.com",
    "cdn\\.attn\\.tv",
    "monorail-edge\\.shopifysvc\\.com",
    "/cdn/wpm/",
    "/wpm@",
    "/web-pixels",
    "/shopifycloud/checkout-web/",
  ].join("|"),
  "i"
);

/** Remove the background scripts' tags (and their preload hints) from a page. */
export function stripBackgroundScripts(html: string): string {
  const test = (url: string) => BACKGROUND_SCRIPTS.test(url.replace(/&amp;/g, "&"));
  return html
    .replace(/<script\b[^>]*\ssrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src: string) => (test(src) ? "" : tag))
    .replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/rel=["']?(?:preload|modulepreload|prefetch)/i.test(tag)) return tag;
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      return href && test(href) ? "" : tag;
    });
}
