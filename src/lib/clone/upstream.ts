import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);

// Fetching layer for the storefront copy (/clone/<host>/…). Same strategy as
// /api/demo — Node fetch, then curl (gets past Cloudflare's Node fingerprinting),
// then Jina's headless reader — but reads whole pages and forwards the store's
// storefront-password cookie so password-protected stores can be previewed too.

const FETCH_TIMEOUT = 12000;
const JINA_TIMEOUT = 30000;
const MAX_BYTES = 12_000_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type Upstream = {
  status: number;
  contentType: string;
  body: Buffer;
  /** URL after redirects — becomes the page's <base href>. */
  finalUrl: string;
  setCookies: string[];
};

/** Reject obviously-internal / non-public hosts (basic SSRF guard). */
export function isBlockedHost(host: string) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (!h.includes(".")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split(".").map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    return false;
  }
  if (h.includes(":")) return true;
  return !/^[a-z0-9.-]+$/.test(h);
}

function isChallenge(text: string): boolean {
  return /Just a moment|challenge-platform|cf-browser-verification|Attention Required/i.test(text.slice(0, 2500));
}

const isHtml = (ct: string) => /text\/html/i.test(ct);

async function nodeFetch(
  url: string,
  init: { method: string; accept: string; cookie?: string; body?: string; contentType?: string; manual?: boolean }
): Promise<Upstream | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: init.accept,
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (init.cookie) headers.Cookie = init.cookie;
    if (init.contentType) headers["Content-Type"] = init.contentType;
    const res = await fetch(url, {
      method: init.method,
      body: init.body,
      headers,
      redirect: init.manual ? "manual" : "follow",
      signal: controller.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    const contentType = res.headers.get("content-type") || "";
    if (isHtml(contentType) && isChallenge(buf.toString("utf8", 0, 2500))) return null;
    return {
      status: res.status,
      contentType,
      body: buf,
      finalUrl: res.url || url,
      setCookies: res.headers.getSetCookie?.() ?? [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const CURL_MARK = "\n<<<CP-CURL ";

async function curlFetch(url: string, accept: string, cookie?: string): Promise<Upstream | null> {
  try {
    const args = [
      "-sL", "--compressed",
      "--max-redirs", "6",
      "--max-time", String(Math.ceil(FETCH_TIMEOUT / 1000)),
      "-A", UA,
      "-H", `Accept: ${accept}`,
      "-H", "Accept-Language: en-US,en;q=0.9",
      "-w", `${CURL_MARK}%{http_code}|%{content_type}|%{url_effective}>>>`,
    ];
    if (cookie) args.push("-H", `Cookie: ${cookie}`);
    args.push(url);
    const { stdout } = await execFileP("curl", args, {
      maxBuffer: MAX_BYTES + 10_000,
      timeout: FETCH_TIMEOUT + 3000,
      encoding: "buffer",
    });
    const text = stdout.toString("utf8");
    const at = text.lastIndexOf(CURL_MARK);
    if (at < 0) return null;
    const [code, contentType, finalUrl] = text.slice(at + CURL_MARK.length, -3).split("|");
    const body = text.slice(0, at);
    if (!body || isChallenge(body)) return null;
    return { status: Number(code) || 200, contentType, body: Buffer.from(body, "utf8"), finalUrl: finalUrl || url, setCookies: [] };
  } catch {
    return null;
  }
}

/** Jina's reader runs a real browser, so it gets past WAFs that block both of the above. */
async function jinaHtml(url: string): Promise<Upstream | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT);
  try {
    const headers: Record<string, string> = { "User-Agent": UA, "X-Return-Format": "html" };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || isChallenge(text)) return null;
    return { status: 200, contentType: "text/html; charset=utf-8", body: Buffer.from(text, "utf8"), finalUrl: url, setCookies: [] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** GET a store URL, falling back through curl and (for pages) Jina when blocked. */
export async function getUpstream(url: string, opts: { accept: string; cookie?: string; page: boolean }): Promise<Upstream | null> {
  const direct = await nodeFetch(url, { method: "GET", accept: opts.accept, cookie: opts.cookie });
  if (direct && direct.status < 400) return direct;
  const viaCurl = await curlFetch(url, opts.accept, opts.cookie);
  if (viaCurl && viaCurl.status < 400) return viaCurl;
  // Jina can't carry the password cookie, and only pages are worth its latency.
  if (opts.page && !opts.cookie) {
    const viaJina = await jinaHtml(url);
    if (viaJina) return viaJina;
  }
  return direct ?? viaCurl;
}

/** Submit a Shopify storefront password; returns the storefront_digest cookie value on success. */
export async function unlockStorefront(origin: string, form: string): Promise<string | null> {
  const res = await nodeFetch(`${origin}/password`, {
    method: "POST",
    accept: "text/html",
    body: form,
    contentType: "application/x-www-form-urlencoded",
    manual: true,
  });
  for (const c of res?.setCookies ?? []) {
    const m = c.match(/^storefront_digest=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}
