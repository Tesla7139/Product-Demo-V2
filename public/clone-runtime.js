/*
 * Storefront-copy runtime — injected at the top of <head> on every /clone/<host>/… page
 * (see src/app/clone/[...path]/route.ts). The page itself is the store's real HTML;
 * a <base href> points every asset at the store. This script:
 *   1. keeps navigation inside the copy (links, forms, script redirects, history),
 *   2. sends the theme's own GET requests (sections, search, product JSON) through
 *      the proxy, since the store doesn't allow cross-origin reads,
 *   3. replaces the store's cart with a local one (sessionStorage "cp-cart") and
 *      shows a cart drawer, and
 *   4. sends checkout to /preview/checkout, the order flow that follows the store.
 * Plain ES2019, no dependencies.
 */
(function () {
  "use strict";
  if (window.__cpRuntime) return;
  window.__cpRuntime = true;

  var CFG = window.__CP || { hosts: [], base: document.baseURI };
  var ORIGIN = location.origin;
  var CART_KEY = "cp-cart";
  var BRAND_KEY = "cp-brand";
  var CHECKOUT_URL = ORIGIN + "/preview/checkout";
  var nativeFetch = window.fetch.bind(window);

  // Background scripts (analytics, ad pixels, Shopify's web-pixel sandboxes, the
  // express-checkout bundle) that the page adds while it runs: dropped before
  // they load. The pattern comes from the route (src/lib/clone/blocklist.ts),
  // which strips the same ones from the HTML itself.
  var BLOCK_SRC = null;
  try { BLOCK_SRC = CFG.blockSrc ? new RegExp(CFG.blockSrc, "i") : null; } catch { BLOCK_SRC = null; }
  function isBackground(node) {
    if (!BLOCK_SRC || !node || node.nodeType !== 1) return false;
    var tag = node.tagName;
    if (tag === "SCRIPT" || tag === "IFRAME") return BLOCK_SRC.test(node.getAttribute("src") || node.src || "");
    if (tag === "LINK") return /preload|prefetch/i.test(node.rel) && BLOCK_SRC.test(node.href || "");
    return false;
  }
  if (BLOCK_SRC) {
    ["appendChild", "insertBefore"].forEach(function (name) {
      var orig = Node.prototype[name];
      Node.prototype[name] = function (node) {
        return isBackground(node) ? node : orig.apply(this, arguments);
      };
    });
    ["append", "prepend"].forEach(function (name) {
      var orig = Element.prototype[name];
      Element.prototype[name] = function () {
        var keep = Array.prototype.filter.call(arguments, function (n) { return !isBackground(n); });
        return orig.apply(this, keep);
      };
    });
  }

  // SMS sign-up tools (Attentive, Postscript) put a full-screen transparent iframe
  // over the page. Their creatives refuse to render off the store's own domain, so
  // in the copy that iframe stays blank yet swallows every click — hide it.
  var blockers = document.createElement("style");
  blockers.textContent =
    '#attentive_overlay,#attentive_creative,iframe[src*="attn.tv"],iframe[src*="attentivemobile.com"],' +
    'iframe[src*="postscript.io"],iframe[id^="postscript"]{display:none!important;pointer-events:none!important}' +
    // add-to-cart feedback on the store's own button and cart icon (see buttonState / flyToCart)
    "@keyframes cp-spin{to{transform:rotate(360deg)}}" +
    "@keyframes cp-pop{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}" +
    "@keyframes cp-bump{0%{transform:scale(1)}35%{transform:scale(1.28)}65%{transform:scale(.92)}100%{transform:scale(1)}}" +
    ".cp-btn-spin{display:inline-block;width:1em;height:1em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:cp-spin .7s linear infinite;vertical-align:-.15em;margin-right:.55em}" +
    ".cp-btn-tick{display:inline-block;margin-right:.45em;animation:cp-pop .4s ease both}" +
    ".cp-bump{animation:cp-bump .5s ease}" +
    "@media (prefers-reduced-motion:reduce){.cp-btn-spin,.cp-btn-tick,.cp-bump{animation:none}}";
  document.documentElement.appendChild(blockers);

  /* ------------------------------ helpers ------------------------------ */
  function read(k) {
    try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch { return null; }
  }
  function write(k, v) {
    try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ }
  }
  function abs(x) {
    try { return new URL(x, document.baseURI); } catch { return null; }
  }
  function bare(h) { return String(h).toLowerCase().replace(/^www\./, ""); }
  function isHttp(u) { return !!u && (u.protocol === "https:" || u.protocol === "http:"); }
  function isStore(u) { return isHttp(u) && CFG.hosts.indexOf(bare(u.hostname)) >= 0; }
  function proxied(u) { return ORIGIN + "/clone/" + u.hostname + u.pathname + u.search + u.hash; }
  function storeUrl() { return abs(CFG.base) || abs(document.baseURI); }
  function shopRoot() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  }
  function meta(prop) {
    var el = document.querySelector('meta[property="' + prop + '"], meta[name="' + prop + '"]');
    return el ? (el.getAttribute("content") || "").trim() : "";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Static assets are served with CORS by the store's CDN — load those directly.
  function isStatic(u) {
    if (/\/products\/[^/]+\.js$/.test(u.pathname)) return false;
    return /^\/(cdn|s\/files)\//.test(u.pathname) ||
      /\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|ico|mp4|webm)$/i.test(u.pathname);
  }
  function cartKind(u) {
    var p = u.pathname.replace(/\/+$/, "");
    if (/\/cart\/add(\.js|\.json)?$/.test(p)) return "add";
    if (/\/cart\/(change|update)(\.js|\.json)?$/.test(p)) return "change";
    if (/\/cart\/clear(\.js|\.json)?$/.test(p)) return "clear";
    if (/\/cart\.(js|json)$/.test(p)) return "get";
    if (/\/cart$/.test(p)) return "cart";
    if (/\/(checkout|checkouts(\/[^.]*)?|cart\/checkout)$/.test(p)) return "checkout";
    return null;
  }
  function samePage(u) {
    var cur = storeUrl();
    return !!cur && u.origin === cur.origin && u.pathname === cur.pathname && u.search === cur.search;
  }
  function scrollToHash(hash) {
    var id = decodeURIComponent(hash.slice(1));
    var el = id && (document.getElementById(id) || document.querySelector('[name="' + CSS.escape(id) + '"]'));
    if (el) el.scrollIntoView({ behavior: "smooth" });
    else if (!id) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ------------------------------ cart model ------------------------------ */
  function getCart() { return read(CART_KEY) || { items: [] }; }
  function saveCart(c) { write(CART_KEY, c); updateBadges(c); }
  function count(c) { return c.items.reduce(function (n, i) { return n + i.qty; }, 0); }
  function subtotal(c) { return c.items.reduce(function (n, i) { return n + i.price * i.qty; }, 0); }
  function addItems(list) {
    var c = getCart();
    list.forEach(function (it) {
      var ex = c.items.find(function (i) { return String(i.id) === String(it.id); });
      if (ex) ex.qty += it.qty; else c.items.push(it);
    });
    saveCart(c);
  }
  function currency() {
    var s = window.Shopify && window.Shopify.currency && window.Shopify.currency.active;
    return s || (read(BRAND_KEY) || {}).currency || "USD";
  }
  function money(n) {
    var d = Number.isInteger(n) ? 0 : 2;
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: currency(), minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    } catch { return n.toFixed(d); }
  }

  // Shopify AJAX-API shaped responses, so theme code reading cart.js keeps working.
  function cents(n) { return Math.round(n * 100); }
  function shopifyItem(i) {
    var c = cents(i.price);
    return {
      id: Number(i.id) || i.id, variant_id: Number(i.id) || i.id, key: i.id + ":cp", quantity: i.qty,
      title: i.title + (i.variant ? " - " + i.variant : ""), product_title: i.title, variant_title: i.variant || null,
      price: c, original_price: c, discounted_price: c, final_price: c,
      line_price: c * i.qty, original_line_price: c * i.qty, final_line_price: c * i.qty,
      image: i.image, featured_image: { url: i.image, alt: i.title }, handle: i.handle || "",
      url: i.handle ? shopRoot() + "products/" + i.handle : shopRoot(),
      requires_shipping: true, properties: {}, discounts: [], options_with_values: [],
    };
  }
  function shopifyCart() {
    var c = getCart(), total = cents(subtotal(c));
    return {
      token: "cp-preview", note: "", attributes: {}, currency: currency(),
      item_count: count(c), items: c.items.map(shopifyItem),
      total_price: total, original_total_price: total, items_subtotal_price: total,
      total_discount: 0, total_weight: 0, requires_shipping: true, cart_level_discount_applications: [],
    };
  }

  /* --------------------------- product lookup --------------------------- */
  var productCache = {};
  function handleFrom(href) {
    var m = String(href || "").match(/\/products\/([^/?#.]+)/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  function productJs(handle) {
    if (!productCache[handle]) {
      var url = ORIGIN + "/clone/" + storeUrl().hostname + shopRoot() + "products/" + encodeURIComponent(handle) + ".js";
      productCache[handle] = nativeFetch(url, { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return productCache[handle];
  }
  // Handle of the product card an element sits in: the nearest ancestor that links
  // to products, provided all of those links point at the same one.
  function cardHandle(el) {
    for (var n = el, d = 0; n && n !== document.body && d < 8; n = n.parentElement, d++) {
      var links = n.querySelectorAll('a[href*="/products/"]');
      if (!links.length) continue;
      var seen = {};
      links.forEach(function (a) { var h = handleFrom(a.getAttribute("href")); if (h) seen[h] = 1; });
      var keys = Object.keys(seen);
      return keys.length === 1 ? keys[0] : null;
    }
    return null;
  }
  function imgUrl(src) { var u = src && abs(src); return u ? u.href : null; }
  function fromProductJs(p, v, handle, qty) {
    var img = (v.featured_image && v.featured_image.src) || p.featured_image || (p.images && p.images[0]);
    return {
      id: String(v.id), handle: handle, title: p.title,
      variant: v.title && v.title !== "Default Title" ? v.title : "",
      price: (Number(v.price) || 0) / 100, qty: qty, image: imgUrl(img),
    };
  }
  function jsonLdPrice() {
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) {
      var m = nodes[i].textContent.match(/"price"\s*:\s*"?([\d.]+)/);
      if (m) return parseFloat(m[1]);
    }
    return 0;
  }
  // Last resort for non-Shopify stores: read the product off the page itself.
  function domProduct(el, qty, id) {
    var scope = (el && el.closest('[class*="product" i], [class*="card" i], li, article')) || document;
    var titleEl = scope.querySelector('h1, h2, h3, [class*="title" i], [class*="name" i]') || document.querySelector("h1");
    var title = ((titleEl && titleEl.textContent) || meta("og:title") || document.title).replace(/\s+/g, " ").trim().slice(0, 120);
    var price = parseFloat(meta("product:price:amount") || meta("og:price:amount")) || 0;
    if (!price) {
      var pe = scope.querySelector('[class*="price" i]');
      var pm = pe && pe.textContent.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
      price = pm ? parseFloat(pm[1]) : jsonLdPrice();
    }
    var img = scope !== document && scope.querySelector("img");
    return {
      id: String(id || "p-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
      handle: handleFrom(storeUrl().pathname) || "", title: title, variant: "", price: price, qty: qty,
      image: imgUrl((img && (img.currentSrc || img.src)) || meta("og:image")),
    };
  }
  // Shopify redirects /variants/<id> to its product page — authoritative when the
  // button sits outside any product card (quick-add modals, sticky bars)
  function variantHandle(variantId) {
    return nativeFetch(ORIGIN + "/clone/" + storeUrl().hostname + shopRoot() + "variants/" + variantId)
      .then(function (res) { return handleFrom(res.headers.get("X-CP-Final-Url")); })
      .catch(function () { return null; });
  }
  function matchVariant(p, variantId) {
    if (!p || !p.variants || !p.variants.length) return null;
    return variantId ? p.variants.find(function (x) { return String(x.id) === String(variantId); }) : p.variants[0];
  }
  async function resolveProduct(variantId, qty, el) {
    var candidates = [];
    var ch = el ? cardHandle(el) : null;
    var ph = handleFrom(storeUrl().pathname);
    if (ch) candidates.push(ch);
    if (ph && ph !== ch) candidates.push(ph);
    // every lookup starts at once; the first that knows this variant wins
    var lookups = candidates.map(productJs);
    var byVariant = variantId && /^\d+$/.test(String(variantId)) ? variantHandle(variantId) : null;
    for (var i = 0; i < candidates.length; i++) {
      var v = matchVariant(await lookups[i], variantId);
      if (v) return fromProductJs(await lookups[i], v, candidates[i], qty);
    }
    var vh = byVariant && (await byVariant);
    if (vh) {
      var vp = await productJs(vh);
      var vv = matchVariant(vp, variantId);
      if (vv) return fromProductJs(vp, vv, vh, qty);
    }
    var mp = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product;
    if (mp && mp.variants && mp.variants.length) {
      var mv = mp.variants.find(function (x) { return String(x.id) === String(variantId); }) || (!variantId && mp.variants[0]);
      if (mv) {
        return {
          id: String(mv.id), handle: ph || "", title: (mv.name || "").split(" - ")[0] || meta("og:title"),
          variant: mv.public_title || "", price: (Number(mv.price) || 0) / 100, qty: qty, image: imgUrl(meta("og:image")),
        };
      }
    }
    return domProduct(el, qty, variantId);
  }
  function mainVariantId() {
    var f = document.querySelector('form[action*="/cart/add"]');
    var input = f && f.querySelector('[name="id"]');
    return input ? input.value : null;
  }

  /* ----------------------------- brand capture ----------------------------- */
  function colorOf(el) {
    if (!el) return null;
    var cs = getComputedStyle(el);
    var pick = function (c) {
      var m = c && c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
      var lum = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
      return lum > 0.92 ? null : "rgb(" + m[1] + "," + m[2] + "," + m[3] + ")";
    };
    return pick(cs.backgroundColor) || pick(cs.color);
  }
  function findLogo() {
    var imgs = document.querySelectorAll('header img, .header img, [class*="logo" i] img, img[class*="logo" i], a[href="/"] img');
    for (var i = 0; i < imgs.length; i++) {
      var r = imgs[i].getBoundingClientRect();
      if (r.width >= 24 && r.height >= 10) return imgUrl(imgs[i].currentSrc || imgs[i].src);
    }
    return null;
  }
  // The store's typefaces, so the checkout pages that follow can match them:
  // inline @font-face rules (Shopify themes inline them) with absolute URLs.
  function captureFonts() {
    var faces = [];
    document.querySelectorAll("style").forEach(function (st) {
      var m = st.textContent.match(/@font-face\s*\{[^}]*\}/g);
      if (m) faces.push.apply(faces, m);
    });
    var css = faces.join("\n").replace(/url\((['"]?)(?!data:)([^'")]+)\1\)/g, function (all, q, href) {
      var u = abs(href);
      return u ? "url(" + q + u.href + q + ")" : all;
    });
    var heading = document.querySelector("h1, h2, .h1, .h2");
    return {
      css: css.length < 80000 ? css : "",
      body: getComputedStyle(document.body).fontFamily,
      heading: heading ? getComputedStyle(heading).fontFamily : null,
    };
  }
  function captureBrand(accentEl) {
    var b = read(BRAND_KEY) || {};
    var u = storeUrl();
    b.host = u.hostname;
    b.home = ORIGIN + "/clone/" + u.hostname + shopRoot();
    b.name = meta("og:site_name") || b.name || document.title.split(/\s[|–—-]\s/)[0].trim();
    b.logo = findLogo() || b.logo || null;
    b.currency = currency();
    b.fonts = captureFonts();
    b.accent = colorOf(accentEl) || colorOf(document.querySelector('form[action*="/cart/add"] [type="submit"], form[action*="/cart/add"] [name="add"]')) || b.accent || null;
    write(BRAND_KEY, b);
    return b;
  }

  /* ------------------------------ cart drawer ------------------------------ */
  var CSS_TEXT = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:var(--cp-font,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif)}",
    ".scrim{position:fixed;inset:0;background:rgba(0,0,0,.4);opacity:0;transition:opacity .25s;pointer-events:none}",
    ".open .scrim{opacity:1;pointer-events:auto}",
    ".panel{position:fixed;top:0;right:0;bottom:0;width:min(420px,100vw);background:#fff;color:#121212;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .3s cubic-bezier(.2,.8,.2,1);box-shadow:-10px 0 30px rgba(0,0,0,.12);pointer-events:auto}",
    ".open .panel{transform:none}",
    "header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid #eee}",
    "h2{margin:0;font-size:20px;font-weight:600;letter-spacing:.01em}",
    "h2 span{font-weight:400;color:#777;font-size:16px}",
    "button{font:inherit;cursor:pointer;border:0;background:none;color:inherit}",
    ".x{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%}",
    ".x:hover{background:#f3f3f3}",
    ".added{margin:16px 24px 0;padding:10px 14px;border-radius:8px;background:#f1f8f4;color:#1c6b3c;font-size:14px;font-weight:500}",
    ".pending{background:#f5f5f5;color:#555}",
    "ul{list-style:none;margin:0;padding:8px 24px;overflow-y:auto;flex:1}",
    "li{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid #f0f0f0}",
    "li img,.ph{width:76px;height:76px;object-fit:cover;border-radius:6px;background:#f5f5f5;flex-shrink:0}",
    ".info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}",
    ".t{font-size:14px;font-weight:500;line-height:1.35}",
    ".v{font-size:13px;color:#777}",
    ".p{font-size:14px}",
    ".row{display:flex;align-items:center;gap:12px;margin-top:6px}",
    ".qty{display:flex;align-items:center;border:1px solid #ddd;border-radius:6px;height:34px}",
    ".qty button{width:32px;height:32px;font-size:16px}",
    ".qty span{min-width:22px;text-align:center;font-size:14px}",
    ".rm{font-size:12px;color:#777;text-decoration:underline}",
    ".empty{flex:1;display:flex;align-items:center;justify-content:center;color:#777;font-size:15px}",
    "footer{padding:18px 24px 24px;border-top:1px solid #eee;display:flex;flex-direction:column;gap:10px}",
    ".sub{display:flex;justify-content:space-between;font-size:16px}",
    ".note{margin:0;font-size:12.5px;color:#777}",
    ".checkout{height:50px;border-radius:6px;background:var(--cp-accent,#121212);color:var(--cp-on-accent,#fff);font-size:15px;font-weight:600;letter-spacing:.02em}",
    ".checkout:hover{filter:brightness(1.1)}",
    ".cont{font-size:14px;text-decoration:underline;color:#444;padding:6px}",
    ".err{margin:12px 0 0;color:#c62828;font-size:14px}",
    // motion: the banner + the line just added slide in; checkout hands off through a fade
    "@keyframes cp-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
    "@keyframes cp-glow{from{background:#f4f8f5}to{background:transparent}}",
    "@keyframes cp-spin{to{transform:rotate(360deg)}}",
    ".added{animation:cp-in .35s ease both}",
    "li.new{animation:cp-in .45s .08s cubic-bezier(.2,.8,.2,1) both,cp-glow 1.6s .5s ease both;border-radius:8px}",
    ".spin{display:inline-block;width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:cp-spin .7s linear infinite;vertical-align:-3px;margin-right:10px}",
    ".checkout[disabled]{cursor:default;filter:none;opacity:.92}",
    ".leave{position:fixed;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;opacity:0;transition:opacity .35s ease;pointer-events:auto;color:#333;font-size:15px}",
    ".leave.on{opacity:1}",
    ".leave .ring{width:34px;height:34px;border:3px solid #e6e6e6;border-top-color:var(--cp-accent,#121212);border-radius:50%;animation:cp-spin .8s linear infinite}",
    ".leave .lock{display:flex;align-items:center;gap:6px;font-size:13px;color:#777}",
    "@media (prefers-reduced-motion:reduce){*{animation-duration:0s!important;transition-duration:0s!important}}",
  ].join("");

  var shadow = null, host = null;
  function ui() {
    if (shadow) return shadow;
    host = document.createElement("div");
    host.id = "cp-root";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<style>" + CSS_TEXT + "</style><div class='wrap'><div class='scrim'></div><aside class='panel' role='dialog' aria-modal='true' aria-label='Cart'></aside></div>";
    shadow.querySelector(".scrim").addEventListener("click", closeDrawer);
    shadow.querySelector(".panel").addEventListener("click", onPanelClick);
    return shadow;
  }
  function onAccent(color) {
    var m = color && color.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return "#fff";
    return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 > 0.6 ? "#121212" : "#fff";
  }
  function renderDrawer(added, pending) {
    var s = ui(), c = getCart(), b = read(BRAND_KEY) || {}, n = count(c);
    host.style.setProperty("--cp-font", getComputedStyle(document.body).fontFamily);
    if (b.accent) {
      host.style.setProperty("--cp-accent", b.accent);
      host.style.setProperty("--cp-on-accent", onAccent(b.accent));
    }
    var lines = c.items.map(function (i, idx) {
      var isNew = added && String(added.id) === String(i.id);
      return "<li" + (isNew ? " class='new'" : "") + ">" + (i.image ? "<img src='" + esc(i.image) + "' alt=''>" : "<div class='ph'></div>") +
        "<div class='info'><div class='t'>" + esc(i.title) + "</div>" +
        (i.variant ? "<div class='v'>" + esc(i.variant) + "</div>" : "") +
        "<div class='p'>" + money(i.price) + "</div>" +
        "<div class='row'><div class='qty'><button data-act='dec' data-i='" + idx + "' aria-label='Decrease quantity'>−</button><span>" + i.qty +
        "</span><button data-act='inc' data-i='" + idx + "' aria-label='Increase quantity'>+</button></div>" +
        "<button class='rm' data-act='rm' data-i='" + idx + "'>Remove</button></div></div></li>";
    }).join("");
    s.querySelector(".panel").innerHTML =
      "<header><h2>Your cart" + (n ? " <span>(" + n + ")</span>" : "") + "</h2>" +
      "<button class='x' data-act='close' aria-label='Close cart'><svg width='18' height='18' viewBox='0 0 18 18' fill='none' stroke='currentColor' stroke-width='1.6'><path d='M3 3l12 12M15 3L3 15'/></svg></button></header>" +
      (pending ? "<div class='added pending'>Adding to your cart…</div>" : added ? "<div class='added'>✓ " + esc(added.title) + " added to your cart</div>" : "") +
      (c.items.length ? "<ul>" + lines + "</ul>" : "<div class='empty'>Your cart is empty</div>") +
      "<footer>" + (c.items.length
        ? "<div class='sub'><span>Subtotal</span><strong>" + money(subtotal(c)) + "</strong></div>" +
          "<p class='note'>Taxes and shipping calculated at checkout</p>" +
          "<button class='checkout' data-act='checkout'>Check out</button>"
        : "") +
      "<button class='cont' data-act='close'>Continue shopping</button></footer>";
  }
  function openDrawer(added, pending) {
    renderDrawer(added, pending);
    host.style.pointerEvents = "auto";
    requestAnimationFrame(function () { shadow.querySelector(".wrap").classList.add("open"); });
  }
  function closeDrawer() {
    if (!shadow) return;
    shadow.querySelector(".wrap").classList.remove("open");
    host.style.pointerEvents = "none";
  }
  function onPanelClick(e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act"), c = getCart(), i = Number(btn.getAttribute("data-i"));
    if (act === "close") return closeDrawer();
    if (act === "checkout") {
      btn.disabled = true;
      btn.innerHTML = "<span class='spin'></span>Redirecting to checkout…";
      return window.setTimeout(goCheckout, 650);
    }
    if (act === "inc") c.items[i].qty += 1;
    if (act === "dec") c.items[i].qty = Math.max(1, c.items[i].qty - 1);
    if (act === "rm") c.items.splice(i, 1);
    saveCart(c);
    renderDrawer();
  }

  // Keep the theme's header cart counter in step with the local cart.
  function updateBadges(c) {
    var n = count(c);
    document.querySelectorAll(
      '.cart-count-bubble span[aria-hidden="true"], [data-cart-count], .cart-count, #CartCount, .cart-item-count, [data-header-cart-count], .js-cart-count, .cart-count-number'
    ).forEach(function (el) { if (!el.children.length) el.textContent = String(n); });
    var dawn = document.getElementById("cart-icon-bubble");
    if (dawn && n && !dawn.querySelector(".cart-count-bubble")) {
      var bubble = document.createElement("div");
      bubble.className = "cart-count-bubble";
      bubble.innerHTML = '<span aria-hidden="true">' + n + "</span>";
      dawn.appendChild(bubble);
    }
  }

  /* ------------------------------ actions ------------------------------ */
  // The store's own Add to cart button narrates the add: "Adding…" with a
  // spinner, then "Added", then back to its original label.
  function buttonState(el, state) {
    var btn = el && el.closest && el.closest('button, input[type="submit"], [role="button"], a');
    if (!btn) return;
    var isInput = btn.tagName === "INPUT";
    if (btn.__cpOriginal === undefined) btn.__cpOriginal = isInput ? btn.value : btn.innerHTML;
    window.clearTimeout(btn.__cpRestore);
    if (state === "adding") {
      var r = btn.getBoundingClientRect();
      btn.style.minWidth = r.width + "px"; // label changes shouldn't resize the button
      btn.style.minHeight = r.height + "px";
      btn.style.pointerEvents = "none";
      if (isInput) btn.value = "Adding…";
      else btn.innerHTML = "<span class='cp-btn-spin'></span>Adding…";
      return;
    }
    if (state === "added") {
      if (isInput) btn.value = "✓ Added to cart";
      else btn.innerHTML = "<span class='cp-btn-tick'>✓</span>Added to cart";
    }
    btn.__cpRestore = window.setTimeout(function () {
      if (isInput) btn.value = btn.__cpOriginal; else btn.innerHTML = btn.__cpOriginal;
      btn.__cpOriginal = undefined;
      btn.style.minWidth = btn.style.minHeight = btn.style.pointerEvents = "";
    }, state === "added" ? 1500 : 0);
  }

  // The header cart icon the product flies into.
  function cartIcon() {
    var els = document.querySelectorAll(CART_TOGGLE + ', a[href$="/cart"], a[href*="/cart?"], a[href*="/cart#"]');
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width && r.height && r.top >= 0 && r.top < 260) return els[i];
    }
    return null;
  }

  // A thumbnail of the product arcs from the button into the cart icon, which
  // then bounces. Resolves when it lands (at once when there's nowhere to fly).
  function flyToCart(item, fromEl) {
    var target = cartIcon();
    var from = fromEl && fromEl.getBoundingClientRect && fromEl.getBoundingClientRect();
    if (!target || !from || !from.width || !item.image || !document.body.animate ||
        matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return Promise.resolve(target);
    }
    var to = target.getBoundingClientRect();
    var size = 72;
    var x0 = from.left + from.width / 2 - size / 2, y0 = from.top + from.height / 2 - size / 2;
    var dx = to.left + to.width / 2 - size / 2 - x0, dy = to.top + to.height / 2 - size / 2 - y0;
    var img = document.createElement("img");
    img.src = item.image;
    img.alt = "";
    img.style.cssText = "position:fixed;left:" + x0 + "px;top:" + y0 + "px;width:" + size + "px;height:" + size +
      "px;object-fit:cover;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,.25);z-index:2147483646;pointer-events:none;background:#fff";
    document.documentElement.appendChild(img);
    var anim = img.animate([
      { transform: "translate(0,0) scale(.6)", opacity: 0 },
      { transform: "translate(0,-24px) scale(1)", opacity: 1, offset: 0.18 },
      { transform: "translate(" + dx * 0.55 + "px," + (dy * 0.55 - 140) + "px) scale(.75)", opacity: 1, offset: 0.6 },
      { transform: "translate(" + dx + "px," + dy + "px) scale(.18)", opacity: 0.4 },
    ], { duration: 850, easing: "cubic-bezier(.45,0,.25,1)" });
    return new Promise(function (resolve) {
      anim.onfinish = function () {
        img.remove();
        target.classList.remove("cp-bump");
        void target.offsetWidth; // restart the bounce on repeat adds
        target.classList.add("cp-bump");
        resolve(target);
      };
    });
  }

  async function addProduct(variantId, qty, el, opts) {
    captureBrand(el);
    buttonState(el, "adding");
    var item;
    try {
      item = await resolveProduct(variantId, qty, el);
    } catch (err) {
      buttonState(el, "reset");
      throw err;
    }
    addItems([item]);
    buttonState(el, "added");
    if (opts && opts.checkout) return goCheckout();
    await flyToCart(item, el);
    window.setTimeout(function () { openDrawer(item); }, 120);
    return item;
  }
  function addFromForm(form, el, opts) {
    var fd = null;
    try { fd = new FormData(form); } catch { /* not a real form */ }
    var id = fd && (fd.get("id") || fd.get("items[0][id]") || fd.get("variant_id"));
    var qty = parseInt((fd && (fd.get("quantity") || fd.get("items[0][quantity]"))) || "1", 10) || 1;
    return addProduct(id, qty, el || form, opts);
  }
  // Fade the store out behind a "secure checkout" hand-off, then go.
  function goCheckout() {
    captureBrand();
    var s = ui();
    var leave = s.querySelector(".leave");
    if (!leave) {
      leave = document.createElement("div");
      leave.className = "leave";
      leave.innerHTML = "<div class='ring'></div><div>Redirecting to secure checkout…</div>" +
        "<div class='lock'><svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><rect x='5' y='11' width='14' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/></svg>Secure and encrypted</div>";
      s.appendChild(leave);
    }
    host.style.pointerEvents = "auto";
    requestAnimationFrame(function () { leave.classList.add("on"); });
    window.setTimeout(function () { location.href = CHECKOUT_URL; }, 700);
  }

  /* ------------------------- cart API (fetch / XHR) ------------------------- */
  function entries(fd) {
    var o = {};
    fd.forEach(function (v, k) {
      var m = k.match(/^items\[(\d+)\]\[(\w+)\]$/);
      var u = k.match(/^updates\[(.+)\]$/);
      if (m) { o.items = o.items || []; (o.items[m[1]] = o.items[m[1]] || {})[m[2]] = v; }
      else if (u) { o.updates = o.updates || {}; o.updates[u[1]] = v; }
      else o[k] = v;
    });
    if (o.items) o.items = o.items.filter(Boolean);
    return o;
  }
  async function readBody(req, init) {
    var b = init && init.body;
    if (b == null && req) { try { b = await req.text(); } catch { b = null; } }
    if (b == null) return {};
    if (b instanceof FormData || b instanceof URLSearchParams) return entries(b);
    if (typeof b === "string") {
      try { return JSON.parse(b); } catch { return entries(new URLSearchParams(b)); }
    }
    return {};
  }
  var lastPressed = null;
  document.addEventListener("pointerdown", function (e) { lastPressed = e.target; }, true);

  async function cartApi(kind, req, init) {
    if (kind === "get") return shopifyCart();
    if (kind === "clear") { saveCart({ items: [] }); return shopifyCart(); }
    var body = await readBody(req, init);
    if (kind === "add") {
      var lines = body.items && body.items.length ? body.items : [{ id: body.id, quantity: body.quantity }];
      var added = [];
      for (var i = 0; i < lines.length; i++) {
        added.push(await resolveProduct(lines[i].id, parseInt(lines[i].quantity, 10) || 1, lastPressed));
      }
      addItems(added);
      captureBrand(lastPressed);
      flyToCart(added[0], lastPressed).then(function () { openDrawer(added[0]); });
      var out = added.map(shopifyItem);
      return body.items ? { items: out } : out[0];
    }
    // change.js / update.js
    var c = getCart();
    var find = function (key) {
      return c.items.findIndex(function (it) { return String(it.id) === String(key) || it.id + ":cp" === String(key); });
    };
    var setQty = function (idx, q) {
      if (idx < 0 || idx >= c.items.length) return;
      if (q <= 0) c.items.splice(idx, 1); else c.items[idx].qty = q;
    };
    if (body.updates) {
      if (Array.isArray(body.updates)) body.updates.forEach(function (q, idx) { setQty(idx, Number(q)); });
      else Object.keys(body.updates).forEach(function (k) { setQty(find(k), Number(body.updates[k])); });
    } else if (body.quantity !== undefined) {
      setQty(body.line ? Number(body.line) - 1 : find(body.id), Number(body.quantity));
    }
    saveCart(c);
    if (shadow) renderDrawer();
    return shopifyCart();
  }
  function json(obj) {
    return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  function apiKind(u) {
    var k = cartKind(u);
    return k && k !== "cart" && k !== "checkout" ? k : null;
  }

  window.fetch = function (input, init) {
    try {
      var isReq = typeof Request !== "undefined" && input instanceof Request;
      var u = abs(isReq ? input.url : input instanceof URL ? input.href : String(input));
      var method = String((init && init.method) || (isReq && input.method) || "GET").toUpperCase();
      if (u && isStore(u)) {
        var k = apiKind(u);
        if (k) return cartApi(k, isReq ? input.clone() : null, init).then(json);
        if (method === "GET" && !isStatic(u)) {
          return isReq ? nativeFetch(new Request(proxied(u), input), init) : nativeFetch(proxied(u), init);
        }
      }
    } catch { /* fall through to the real fetch */ }
    return nativeFetch(input, init);
  };

  var xOpen = XMLHttpRequest.prototype.open;
  var xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cp = null;
    var u = abs(url);
    if (u && isStore(u)) {
      var k = apiKind(u);
      if (k) this.__cp = k;
      else if (String(method).toUpperCase() === "GET" && !isStatic(u)) arguments[1] = proxied(u);
    }
    return xOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var k = this.__cp;
    if (!k) return xSend.apply(this, arguments);
    cartApi(k, null, { body: body }).then((obj) => {
      var def = (prop, v) => { Object.defineProperty(this, prop, { value: v, configurable: true }); };
      var text = JSON.stringify(obj);
      def("readyState", 4); def("status", 200); def("statusText", "OK");
      def("responseText", text); def("response", this.responseType === "json" ? obj : text);
      this.getResponseHeader = function (h) { return /content-type/i.test(h) ? "application/json" : null; };
      this.getAllResponseHeaders = function () { return "content-type: application/json\r\n"; };
      ["readystatechange", "load", "loadend"].forEach((t) => { this.dispatchEvent(new Event(t)); });
    });
  };

  /* ------------------------- history / navigation ------------------------- */
  // Theme code pushes store paths (e.g. ?variant= on a product page); against the
  // <base> those would be cross-origin and throw, so map them into the copy.
  ["pushState", "replaceState"].forEach(function (name) {
    var orig = history[name];
    history[name] = function (state, title, url) {
      if (url != null) {
        var u = abs(url);
        if (u && isStore(u)) url = proxied(u);
        else if (u && u.origin !== ORIGIN) return; // can't leave the copy
      }
      return orig.call(this, state, title, url);
    };
  });

  // Route a navigation to a store URL. Returns false when it should proceed as-is.
  function routeStoreNav(u) {
    var k = cartKind(u);
    if (k === "cart") { openDrawer(); return true; }
    if (k === "checkout") { goCheckout(); return true; }
    if (u.hash && samePage(u)) { scrollToHash(u.hash); return true; }
    location.href = proxied(u);
    return true;
  }

  if (window.navigation && window.navigation.addEventListener) {
    // Catches every way the page can navigate: links, forms, and script redirects
    // (location.href = …, geo-redirect snippets), which a click handler can't see.
    window.navigation.addEventListener("navigate", function (e) {
      var u;
      try { u = new URL(e.destination.url); } catch { return; }
      if (!isHttp(u) || u.origin === ORIGIN || !e.cancelable) return;
      e.preventDefault();
      if (!isStore(u)) {
        // a real link to another site opens in a new tab; script redirects are dropped
        if (e.userInitiated) window.open(u.href, "_blank", "noopener");
        return;
      }
      if (e.formData) return; // POSTs that slipped past the submit handler stay put
      // start the replacement navigation after this one has finished cancelling,
      // otherwise Chrome aborts it along with the cancelled one
      setTimeout(function () { routeStoreNav(u); }, 0);
    });
  } else {
    // Fallback without the Navigation API: plain link clicks (bubble phase, so
    // links the theme already handles in JS are left alone).
    window.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var a = e.target instanceof Element && e.target.closest("a[href]");
      if (!a || a.target === "_blank") return;
      var u = abs(a.getAttribute("href"));
      if (!isHttp(u) || u.origin === ORIGIN) return;
      e.preventDefault();
      if (isStore(u)) routeStoreNav(u);
      else window.open(u.href, "_blank", "noopener");
    });
  }

  /* --------------------- commerce clicks (capture phase) --------------------- */
  var CART_TOGGLE =
    '#cart-icon-bubble, .header__icon--cart, [data-cart-toggle], .js-drawer-open-cart, .site-header__cart, ' +
    '[aria-controls="CartDrawer"], [aria-controls*="cart-drawer" i], [href="#cart"], [data-drawer-toggle*="cart" i]';
  var PAY_BUTTON =
    '.shopify-payment-button, shopify-accelerated-checkout, shopify-buy-it-now-button, [data-shopify="payment-button"]';

  function label(el) {
    return String(el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function productFormNear(el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var f = n.querySelector && n.querySelector('form[action*="/cart/add"]');
      if (f) return f;
    }
    return null;
  }
  // Decide what a click means for the cart; returns the action to run, or null.
  function commerceAction(t) {
    if (t.closest(PAY_BUTTON)) {
      var pf = productFormNear(t);
      return function () { return pf ? addFromForm(pf, t, { checkout: true }) : addProduct(mainVariantId(), 1, t, { checkout: true }); };
    }
    var el = t.closest('button, a, input[type="submit"], input[type="button"], [role="button"]');
    if (!el) return t.closest(CART_TOGGLE) ? function () { openDrawer(); } : null;
    var text = label(el);
    var form = el.form || el.closest("form");
    var action = form && abs(form.getAttribute("action") || "");
    var href = el.tagName === "A" ? abs(el.getAttribute("href") || "") : null;
    var hrefKind = href && isStore(href) ? cartKind(href) : null;

    if (form && action && isStore(action) && cartKind(action) === "add" &&
        (el.type === "submit" || el.name === "add" || /add|cart|bag|basket|buy/.test(text))) {
      if (/^buy (it )?now/.test(text)) return function () { return addFromForm(form, el, { checkout: true }); };
      return function () { return addFromForm(form, el); };
    }
    if (el.name === "checkout" || hrefKind === "checkout" || /^(check ?out|proceed to checkout|secure checkout)\b/.test(text)) {
      return goCheckout;
    }
    if (hrefKind === "cart" || el.closest(CART_TOGGLE)) return function () { openDrawer(); };
    if (!href || !handleFrom(href.pathname)) {
      if (/^buy (it )?now/.test(text)) return function () { return addProduct(mainVariantId(), 1, el, { checkout: true }); };
      if (/\badd to (cart|bag|basket)\b/.test(text)) {
        var vid = el.getAttribute("data-variant-id") || el.getAttribute("data-id") || mainVariantId();
        return function () { return addProduct(vid, 1, el); };
      }
    }
    return null;
  }

  window.addEventListener("click", function (e) {
    var t = e.target instanceof Element ? e.target : null;
    if (!t || t === host) return;
    var run = commerceAction(t);
    if (!run) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    run();
  }, true);

  /* --------------------------- snapshot pages --------------------------- */
  // Pages served from a rendered snapshot run without the store's scripts (see
  // stripScripts in the route), so pop-ups baked into the snapshot can't close
  // themselves and lazy images never get their source. Stand in for both.
  var DISMISS = /^(×|✕|✖|x|close|dismiss|no,? thanks?|no thank you|maybe later|not now|i agree|agree|accept( all)?( cookies)?|allow( all)?( cookies)?|i decline|decline( all)?|reject( all)?|got it|ok(ay)?)$/i;
  function overlayOf(el) {
    var outer = null;
    for (var n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      var pos = getComputedStyle(n).position;
      if (pos === "fixed" || n.tagName === "DIALOG" || n.getAttribute("aria-modal") === "true") outer = n;
    }
    return outer || el.closest('[class*="announcement" i], [class*="teaser" i], [class*="popup" i], [role="alert"]');
  }
  function hideOverlay(box) {
    box.style.setProperty("display", "none", "important");
    // full-screen backdrops that sit beside the dialog go with it
    if (box.parentElement) {
      Array.prototype.forEach.call(box.parentElement.children, function (sib) {
        var r = sib.getBoundingClientRect();
        if (sib !== box && getComputedStyle(sib).position === "fixed" && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) {
          sib.style.setProperty("display", "none", "important");
        }
      });
    }
  }
  function fillLazyImages() {
    document.querySelectorAll("img[data-src], img[data-srcset], source[data-srcset]").forEach(function (el) {
      if (el.getAttribute("data-srcset")) el.setAttribute("srcset", el.getAttribute("data-srcset"));
      if (el.getAttribute("data-src") && (!el.getAttribute("src") || /^data:|placeholder|blank|spacer/i.test(el.getAttribute("src")))) {
        el.setAttribute("src", el.getAttribute("data-src"));
      }
    });
  }
  if (CFG.snapshot) {
    window.addEventListener("click", function (e) {
      var t = e.target instanceof Element ? e.target : null;
      var btn = t && t.closest('button, a, [role="button"], [aria-label]');
      if (!btn || btn === host) return;
      var text = (btn.innerText || btn.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      var aria = btn.getAttribute("aria-label") || "";
      if (!DISMISS.test(text) && !/close|dismiss/i.test(aria)) return;
      var box = overlayOf(btn);
      if (!box) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      hideOverlay(box);
    }, true);
  }

  window.addEventListener("submit", function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    var raw = form.getAttribute("action");
    var u = raw ? abs(raw) : null;
    if (!u || !isStore(u)) return; // no action → posts to this /clone/ URL already
    var k = cartKind(u);
    var stop = function () { e.preventDefault(); e.stopImmediatePropagation(); };
    if (k === "add") { stop(); addFromForm(form, e.submitter || form); return; }
    if (k === "cart" || k === "checkout") {
      stop();
      if (k === "checkout" || (e.submitter && e.submitter.name === "checkout")) goCheckout(); else openDrawer();
      return;
    }
    var method = (form.getAttribute("method") || "get").toLowerCase();
    // search/filter (GET) and the storefront password go through the copy;
    // anything else that would write to the store (contact, newsletter) is dropped
    if (/\/password\/?$/.test(u.pathname)) {
      // Shopify's password form is data-remote (AJAX); post it natively through
      // the copy so the proxy can keep the storefront cookie and redirect home
      stop();
      form.action = proxied(u);
      HTMLFormElement.prototype.submit.call(form);
    } else if (method === "get") form.action = proxied(u);
    else stop();
  }, true);

  /* ------------------------------ page ready ------------------------------ */
  // The viewer opens stores on a product page. When it couldn't find one from the
  // catalog (headless storefronts), it asks us to follow the first product link here.
  function openFirstProduct() {
    var want = false;
    try {
      want = sessionStorage.getItem("cp-open-product") === "1";
      sessionStorage.removeItem("cp-open-product");
    } catch { /* storage blocked — stay on this page */ }
    if (!want) return false;
    var links = document.querySelectorAll('a[href*="/products/"]');
    for (var i = 0; i < links.length; i++) {
      var u = abs(links[i].getAttribute("href"));
      if (u && isStore(u)) { location.href = proxied(u); return true; }
    }
    return false;
  }

  function ready() {
    if (CFG.snapshot) fillLazyImages();
    if (openFirstProduct()) return; // the product page reports ready instead
    var brand = captureBrand();
    updateBadges(getCart());
    // warm the product lookup so Add to cart responds instantly
    var ph = handleFrom(storeUrl().pathname);
    if (ph) productJs(ph);
    if (/[?&]cp_error=1/.test(location.search)) {
      var pw = document.querySelector('input[type="password"]');
      if (pw && pw.form && !pw.form.querySelector(".cp-pw-error")) {
        var msg = document.createElement("p");
        msg.className = "cp-pw-error";
        msg.textContent = "Incorrect password, please try again.";
        msg.style.cssText = "color:#c62828;margin:8px 0;font-size:14px";
        pw.form.insertBefore(msg, pw.form.firstChild);
      }
    }
    try { parent.postMessage({ type: "cp:ready", title: document.title, name: brand.name, logo: brand.logo }, ORIGIN); } catch { /* top-level */ }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  window.addEventListener("load", function () { captureBrand(); });
  // tell the viewer a new page is on its way, so it can show the progress bar
  window.addEventListener("beforeunload", function () {
    try { parent.postMessage({ type: "cp:leaving" }, ORIGIN); } catch { /* top-level */ }
  });
})();
