import { NextResponse, type NextRequest } from "next/server";
import { isBlockedHost } from "@/lib/clone/upstream";
import { checkoutSnapshot, snapshotFailures } from "@/lib/clone/checkoutSnapshot";
import { checkoutUpsell } from "@/lib/upsell/checkoutDeals";

export const runtime = "nodejs";
export const maxDuration = 60; // a cold capture renders the store's checkout in a headless browser

// GET /preview/store-checkout?host=<domain>&handle=<product> — the store's own
// checkout as it really looks (lib/clone/checkoutSnapshot), with
// /checkout-snapshot.js on top to fill the secure-frame slots and lead every
// "pay" into the preview's order flow. When the store can't be captured, the
// preview's rebuilt checkout (/preview/checkout) takes over.
export async function GET(req: NextRequest) {
  const host = (req.nextUrl.searchParams.get("host") || "").trim().toLowerCase();
  if (!host || isBlockedHost(host)) return new NextResponse("Invalid store", { status: 400 });
  const handle = req.nextUrl.searchParams.get("handle");

  const snap = await checkoutSnapshot(host, handle);
  if (!snap) {
    const res = NextResponse.redirect(new URL("/preview/checkout", req.url), 307);
    res.headers.set("X-CP-Snapshot", (snapshotFailures.get(host) || "unknown").replace(/[^\x20-\x7e]/g, " ").slice(0, 300));
    return res;
  }

  const origin = req.nextUrl.origin;
  const name = snap.html.match(/<title>\s*Checkout\s*[-–—]\s*([^<]+?)\s*<\/title>/i)?.[1] ?? null;
  // the store's checkout add-ons ("Your $3.00 patches"), when it has a deal set up
  const upsell = await checkoutUpsell(host, [{ title: snap.line.title, price: snap.line.price, qty: snap.line.qty }]);
  const config = { host, origin, name, currency: snap.currency, line: snap.line, upsell };
  const tags =
    `<script>window.__CPCO=${JSON.stringify(config).replace(/</g, "\\u003c")}</script>` +
    `<script src="${origin}/checkout-snapshot.js" defer></script>`;
  const html = snap.html.includes("</body>") ? snap.html.replace("</body>", `${tags}</body>`) : snap.html + tags;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // a picture of a checkout, not a checkout: keep it out of search and other sites' frames
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
