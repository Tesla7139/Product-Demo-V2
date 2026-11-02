import { NextResponse, type NextRequest } from "next/server";
import { getUpstream, isBlockedHost, unlockStorefront } from "@/lib/clone/upstream";
import { cachedUpstream, cacheKey, DATA_TTL, PAGE_TTL } from "@/lib/clone/cache";
import { BACKGROUND_SCRIPTS, stripBackgroundScripts } from "@/lib/clone/blocklist";
import { alternateHosts, englishAlternate } from "@/lib/clone/locale";

export const runtime = "nodejs";
export const maxDuration = 60;

// /clone/<host>/<path>?<query> — serves a copy of the store's page from our origin.
//
// Stores refuse to be framed (X-Frame-Options: DENY / frame-ancestors 'none'), so
// the page HTML is fetched server-side and served from here instead. A <base href>
// makes every stylesheet, script, image and font load straight from the store, and
// /clone-runtime.js keeps navigation inside the copy, proxies the theme's own AJAX
// back through this route, and swaps the real cart/checkout for the preview one.
//
// Page loads (Sec-Fetch-Dest document/iframe) get the injection; anything else
// (section HTML, /products/x.js, search suggestions…) is passed through untouched.

type Ctx = { params: Promise<{ path: string[] }> };

const cookieName = (host: string) => `cp_sf_${host.replace(/[^a-z0-9]/gi, "_")}`;
const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

async function resolve(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const host = decodeURIComponent(path[0] || "").toLowerCase();
  if (!host || isBlockedHost(host)) return null;
  // keep the original percent-encoding of the rest of the path
  const prefix = `/clone/${path[0]}`;
  const rest = req.nextUrl.pathname.slice(prefix.length) || "/";
  return { host, target: `https://${host}${rest}${req.nextUrl.search}` };
}

function isPageLoad(req: NextRequest) {
  const dest = req.headers.get("sec-fetch-dest");
  if (dest) return dest === "document" || dest === "iframe";
  return /text\/html/.test(req.headers.get("accept") || "");
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * A Jina snapshot is the page after the store's JavaScript already ran. Running
 * those scripts again on top of it (without the cookies and state they set up)
 * makes app-style storefronts crash and blank the page — so keep the rendered
 * HTML and drop the scripts; the runtime handles navigation, cart and pop-ups.
 */
function stripScripts(html: string) {
  return html
    .replace(/<script\b(?![^>]*type=["']application\/(?:ld\+)?json["'])[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link[^>]+rel=["'](?:modulepreload|preload)["'][^>]*as=["']script["'][^>]*>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
}

function inject(html: string, opts: { finalUrl: string; hosts: string[]; origin: string; snapshot: boolean }) {
  const config = { hosts: opts.hosts, base: opts.finalUrl, snapshot: opts.snapshot, blockSrc: BACKGROUND_SCRIPTS.source };
  const tags =
    `<base href="${escapeAttr(opts.finalUrl)}">` +
    `<script>window.__CP=${JSON.stringify(config).replace(/</g, "\\u003c")}</script>` +
    `<script src="${opts.origin}/clone-runtime.js"></script>`;
  const out = stripBackgroundScripts(html)
    // the store's own CSP would block our runtime and the proxied requests
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    // and a <meta refresh> would navigate the frame out of the copy
    .replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "");
  const head = out.match(/<head(\s[^>]*)?>/i);
  if (!head || head.index === undefined) return tags + out;
  const at = head.index + head[0].length;
  return out.slice(0, at) + tags + out.slice(at);
}

/**
 * Hand the store's cookies to the copy. Headless storefronts (e.g. Next.js ones)
 * set cookies like a country/market code server-side and crash when the page
 * can't read them back. Re-scoped to our origin: no Domain, Path=/, and no
 * Secure/SameSite=None so they also stick on plain-http dev hosts.
 */
function relayCookies(headers: Headers, setCookies: string[]) {
  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(";").map((a) => a.trim());
    if (!pair.includes("=")) continue;
    const kept = attrs.filter((a) => !/^(domain|path|secure|samesite|partitioned)\b/i.test(a));
    headers.append("Set-Cookie", [pair, "Path=/", "SameSite=Lax", ...kept].join("; "));
  }
}

function errorPage(host: string) {
  const h = escapeAttr(host);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;background:#fff}
main{max-width:360px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#666;margin:0 0 20px}
button{font:inherit;font-weight:600;padding:10px 22px;border-radius:8px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}</style></head>
<body><main><h1>${h} couldn't be loaded</h1><p>The store didn't respond. It may be offline or blocking automated requests.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if (!r) return new NextResponse("Invalid store", { status: 400 });

  const page = isPageLoad(req);
  const digest = req.cookies.get(cookieName(bare(r.host)))?.value;
  // Pages and the theme's data requests both go through the shared cache: data
  // lookups repeat as a shopper browses, and the page a preview opens on has
  // usually been pre-fetched by /api/clone-start already (or is still in flight).
  let up = await cachedUpstream(cacheKey(page ? "page" : "data", r.target, digest), page ? PAGE_TTL : DATA_TTL, () =>
    getUpstream(r.target, {
      accept: page ? "text/html,application/xhtml+xml" : req.headers.get("accept") || "*/*",
      cookie: digest ? `storefront_digest=${digest}` : undefined,
      page,
    })
  );

  if (!up) {
    return page
      ? new NextResponse(errorPage(r.host), { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } })
      : new NextResponse(null, { status: 502 });
  }

  if (page && /text\/html/i.test(up.contentType)) {
    let raw = up.body.toString("utf8");
    // Stores like doonails.com default to their home language and send everyone
    // else to an English site on another domain — a hop the copy would block.
    // Take that hop here instead, when the page lists an English version.
    const english = englishAlternate(raw, up.finalUrl);
    if (english) {
      const en = await cachedUpstream(cacheKey("page", english), PAGE_TTL, () =>
        getUpstream(english, { accept: "text/html,application/xhtml+xml", page: true })
      );
      if (en && en.status < 400 && /text\/html/i.test(en.contentType)) {
        up = en;
        raw = en.body.toString("utf8");
      }
    }
    const finalHost = new URL(up.finalUrl).hostname;
    // the store's other language/market domains count as the same store
    const hosts = [...new Set([bare(r.host), bare(finalHost), ...alternateHosts(raw)])];
    const snapshot = up.via === "jina";
    const html = inject(snapshot ? stripScripts(raw) : raw, { finalUrl: up.finalUrl, hosts, origin: req.nextUrl.origin, snapshot });
    const res = new NextResponse(html, {
      status: up.status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
    relayCookies(res.headers, up.setCookies);
    return res;
  }

  return new NextResponse(new Uint8Array(up.body), {
    status: up.status,
    headers: {
      "Content-Type": up.contentType || "application/octet-stream",
      "Cache-Control": "no-store",
      // where the store redirected to — the runtime reads it to resolve /variants/<id> to a product
      "X-CP-Final-Url": up.finalUrl,
    },
  });
}

// Only the storefront password form is ever posted to the store: on success its
// storefront_digest is kept in our own cookie and replayed on every proxied
// request. Everything else that would write to the store (cart, contact,
// newsletter) is handled by the runtime and never reaches here.
export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if (!r) return new NextResponse("Invalid store", { status: 400 });
  const { pathname, origin } = new URL(r.target);
  const home = `/clone/${r.host}/`;
  if (!/\/password\/?$/.test(pathname)) return new NextResponse(null, { status: 204 });

  const form = new URLSearchParams();
  for (const [k, v] of (await req.formData()).entries()) if (typeof v === "string") form.append(k, v);
  const digest = await unlockStorefront(origin, form.toString());
  if (!digest) return NextResponse.redirect(new URL(`/clone/${r.host}/password?cp_error=1`, req.url), 303);

  const res = NextResponse.redirect(new URL(home, req.url), 303);
  res.cookies.set(cookieName(bare(r.host)), digest, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
