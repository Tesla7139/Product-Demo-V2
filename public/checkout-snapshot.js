/*
 * Runs on a store's captured checkout (/preview/store-checkout, see
 * src/lib/clone/checkoutSnapshot.ts). The page is a static picture of the
 * store's real checkout; this script:
 *   1. leaves the cart and store details in sessionStorage for the order flow,
 *   2. fills the slots Shopify's secure frames left (express wallet buttons,
 *      card fields) with look-alikes — nothing here takes real card details,
 *   3. sends Pay now and the express buttons into the preview's processing
 *      screen, and keeps links and forms from going anywhere.
 * Plain ES2019, no dependencies.
 */
(function () {
  "use strict";
  var CFG = window.__CPCO || {};
  var ORIGIN = CFG.origin || location.origin;
  var NEXT = ORIGIN + "/preview/checkout?start=processing";

  function read(k) { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch { return null; } }
  function write(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } }

  /* ----------------------------- the order ----------------------------- */
  if (CFG.line) write("cp-cart", { items: [CFG.line] });
  var brand = read("cp-brand") || {};
  brand.host = CFG.host || brand.host;
  brand.currency = CFG.currency || brand.currency;
  if (CFG.name) brand.name = CFG.name;
  brand.home = brand.home || ORIGIN + "/clone/" + brand.host;
  write("cp-brand", brand);

  /* ------------------------------- styles ------------------------------- */
  var css = document.createElement("style");
  css.textContent =
    "@keyframes cp-spin{to{transform:rotate(360deg)}}" +
    ".cp-spin{display:inline-block;width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:cp-spin .7s linear infinite;vertical-align:middle}" +
    ".cp-wallet{width:100%;height:100%;border:0;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;font:600 20px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;transition:filter .15s}" +
    ".cp-wallet:hover{filter:brightness(1.07)}" +
    ".cp-card{width:100%;height:100%;display:flex;align-items:center;padding:0 11px;box-sizing:border-box;font:14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#707070;cursor:text}" +
    ".cp-busy{pointer-events:none}";
  document.head.appendChild(css);

  /* --------------------- secure-frame slots, filled --------------------- */
  var WALLETS = [
    { re: /paypal/i, bg: "#ffc439", html: "<i style='font-style:italic;font-weight:800;letter-spacing:-.02em'><span style='color:#003087'>Pay</span><span style='color:#009cde'>Pal</span></i>", spin: "#003087" },
    { re: /google ?pay/i, bg: "#000", html: "<span style='color:#fff;font-weight:500'><b style='background:conic-gradient(from -45deg,#ea4335 0 25%,#4285f4 0 50%,#34a853 0 75%,#fbbc05 0);-webkit-background-clip:text;color:transparent'>G</b> Pay</span>", spin: "#fff" },
    { re: /apple ?pay/i, bg: "#000", html: "<span style='color:#fff;font-weight:500'> Pay</span>", spin: "#fff" },
    { re: /venmo/i, bg: "#008cff", html: "<span style='color:#fff;font-weight:700;font-style:italic'>venmo</span>", spin: "#fff" },
    { re: /amazon/i, bg: "#ffd814", html: "<span style='color:#111;font-weight:700'>amazon pay</span>", spin: "#111" },
  ];
  document.querySelectorAll("[data-cp-slot]").forEach(function (slot) {
    var title = slot.getAttribute("data-cp-slot") || "";
    var wallet = WALLETS.find(function (w) { return w.re.test(title); });
    if (wallet) {
      slot.innerHTML = "<button type='button' class='cp-wallet' data-cp-pay='wallet' style='background:" + wallet.bg + ";color:" + wallet.spin + "' aria-label='" + title.replace(/'/g, "") + "'>" + wallet.html + "</button>";
    } else if (/card|expir|security|cvv|name on card|issue/i.test(title)) {
      // the field's border and box come from the page; its text came from the frame
      slot.innerHTML = "<div class='cp-card'>" + title.replace(/</g, "&lt;") + "</div>";
    }
  });

  /* ------------------------------ paying ------------------------------ */
  function payButton(el) {
    var btn = el.closest("button, [role=button], a");
    if (!btn) return null;
    if (btn.hasAttribute("data-cp-pay")) return btn;
    // Shopify draws Shop Pay as a link to ?payment=shop_pay with only a logo inside
    if (btn.matches("#shop-pay-button, a[href*='payment=']")) return btn;
    var logo = btn.querySelector("svg[aria-label], img[alt]");
    var text = ((btn.innerText || "") + " " + (btn.getAttribute("aria-label") || "") + " " +
      (logo ? logo.getAttribute("aria-label") || logo.getAttribute("alt") || "" : "")).replace(/\s+/g, " ").trim();
    if (/^(pay now|complete order|place order|review order|pay\b)/i.test(text)) return btn;
    if (/shop ?pay|^shop$|paypal|google ?pay|apple ?pay/i.test(text) && btn.closest("[class*=xpress i], [aria-label*=xpress i], section, div")) {
      // express wallets drawn by the page itself (Shop Pay usually is)
      var r = btn.getBoundingClientRect();
      if (r.height >= 36 && r.height <= 64) return btn;
    }
    return null;
  }

  var paying = false;
  function pay(btn) {
    if (paying) return;
    paying = true;
    var r = btn.getBoundingClientRect();
    btn.style.width = r.width + "px";
    btn.style.height = r.height + "px";
    btn.classList.add("cp-busy");
    btn.innerHTML = "<span class='cp-spin'></span>";
    var wallet = btn.hasAttribute("data-cp-pay");
    // as Shopify's own button: a spinner, then "Processing..." beside it
    if (!wallet) {
      window.setTimeout(function () {
        btn.innerHTML = "<span style='display:inline-flex;align-items:center;gap:8px'><span class='cp-spin'></span>Processing...</span>";
      }, 700);
    }
    window.setTimeout(function () { location.href = NEXT; }, wallet ? 1400 : 2000);
  }

  document.addEventListener("click", function (e) {
    var t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    var btn = payButton(t);
    if (btn) { e.preventDefault(); e.stopPropagation(); pay(btn); return; }
    // nothing else leaves the page: sign-in, policies, logo, "return to cart"
    if (t.closest("a[href]")) e.preventDefault();
  }, true);
  document.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.submitter || (e.target && e.target.querySelector && e.target.querySelector("button[type=submit]"));
    if (btn) pay(btn);
  }, true);

  /* ------------------------------ fields ------------------------------ */
  // The page's floating labels were frozen with the picture: once something is
  // typed, hide the field's label so it doesn't sit on top of the text.
  document.addEventListener("input", function (e) {
    var input = e.target;
    if (!input || !input.id) return;
    var label = document.querySelector("label[for='" + input.id + "']");
    if (label) label.style.visibility = input.value ? "hidden" : "";
  }, true);

  try { parent.postMessage({ type: "cp:ready", title: document.title, name: brand.name }, ORIGIN); } catch { /* top-level */ }
})();
