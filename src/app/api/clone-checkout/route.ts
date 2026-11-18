import { NextResponse, type NextRequest } from "next/server";
import { isBlockedHost } from "@/lib/clone/upstream";
import { checkoutBranding } from "@/lib/clone/checkoutBranding";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET /api/clone-checkout?host=<domain> — the store's real checkout design (see
// lib/clone/checkoutBranding), or { branding: null } when it can't be read (not
// a Shopify store, password-protected, blocked); the preview then falls back to
// its generic checkout look.
export async function GET(req: NextRequest) {
  const host = (req.nextUrl.searchParams.get("host") || "").trim().toLowerCase();
  if (!host || isBlockedHost(host)) return NextResponse.json({ error: "Invalid store" }, { status: 400 });
  return NextResponse.json({ branding: await checkoutBranding(host) });
}
