import { NextResponse, type NextRequest } from "next/server";
import { getUpstream, isBlockedHost, unlockStorefront, type Upstream } from "@/lib/clone/upstream";

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

function inject(html: string, opts: { finalUrl: string; hosts: string[]; origin: string }) {
  const config = { hosts: opts.hosts, base: opts.finalUrl };
  const tags =
    `<base href="${escapeAttr(opts.finalUrl)}">` +
    `<script>window.__CP=${JSON.stringify(config).replace(/</g, "\\u003c")}</script>` +
    `<script src="${opts.origin}/clone-runtime.js"></script>`;
  const out = html
    // the store's own CSP would block our runtime and the proxied requests
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    // and a <meta refresh> would navigate the frame out of the copy
    .replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "");
  const head = out.match(/<head(\s[^>]*)?>/i);
  if (!head || head.index === undefined) return tags + out;
  const at = head.index + head[0].length;
  return out.slice(0, at) + tags + out.slice(at);
}

function errorPage(host: string) {
  const h = escapeAttr(host);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;background:#fff}
main{max-width:360px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#666;margin:0 0 20px}
button{font:inherit;font-weight:600;padding:10px 22px;border-radius:8px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}</style></head>
<body><main><h1>${h} couldn't be loaded</h1><p>The store didn't respond. It may be offline or blocking automated requests.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
}

// Short-lived cache for the theme's data requests (product JSON, sections, search):
// the same few lookups repeat as a shopper browses and adds to cart.
const dataCache = new Map<string, { up: Upstream; at: number }>();
const DATA_TTL = 5 * 60 * 1000;

export async function GET(req: NextRequest, ctx: Ctx) {
  const r = await resolve(req, ctx);
  if (!r) return new NextResponse("Invalid store", { status: 400 });

  const page = isPageLoad(req);
  const digest = req.cookies.get(cookieName(bare(r.host)))?.value;
  const key = `${digest ?? ""}|${r.target}`;
  const hit = page ? undefined : dataCache.get(key);
  const up =
    hit && Date.now() - hit.at < DATA_TTL
      ? hit.up
      : await getUpstream(r.target, {
          accept: page ? "text/html,application/xhtml+xml" : req.headers.get("accept") || "*/*",
          cookie: digest ? `storefront_digest=${digest}` : undefined,
          page,
        });
  if (up && !page && up.status < 400 && up.body.byteLength < 2_000_000) {
    if (dataCache.size > 300) dataCache.delete(dataCache.keys().next().value!);
    dataCache.set(key, { up, at: Date.now() });
  }

  if (!up) {
    return page
      ? new NextResponse(errorPage(r.host), { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } })
      : new NextResponse(null, { status: 502 });
  }

  if (page && /text\/html/i.test(up.contentType)) {
    const finalHost = new URL(up.finalUrl).hostname;
    const hosts = [...new Set([bare(r.host), bare(finalHost)])];
    const html = inject(up.body.toString("utf8"), { finalUrl: up.finalUrl, hosts, origin: req.nextUrl.origin });
    return new NextResponse(html, {
      status: up.status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
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
