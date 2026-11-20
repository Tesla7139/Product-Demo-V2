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
    ".cp-busy{pointer-events:none}" +
    // Shop Pay's column
    "@keyframes cp-sp-in{from{opacity:0}to{opacity:1}}" +
    ".cp-sp-in{animation:cp-sp-in .35s ease-out}" +
    ".cp-sp-row{display:grid;grid-template-columns:150px 1fr 14px;align-items:center;gap:8px;padding:15px 18px;font-size:14px;line-height:1.45}" +
    ".cp-sp-pay{display:flex;align-items:center;justify-content:center;width:100%;height:50px;border:0;border-radius:10px;background:#5a31f4;color:#fff;font:600 16px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;cursor:pointer;transition:background .15s}" +
    ".cp-sp-pay:hover{background:#4314cb}" +
    ".cp-sp-pay.cp-sp-wait{background:#9d86f8;pointer-events:none}" +
    ".cp-sp-box{flex:none;width:18px;height:18px;border:1px solid #dedede;border-radius:5px;background:#fff;box-sizing:border-box;transition:background .15s,border-color .15s}" +
    "[aria-checked=true]>.cp-sp-box{border-color:#5a31f4;background:#5a31f4 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cpath d='M5 9.5l2.5 2.5L13 6.5' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") center/16px no-repeat}" +
    ".cp-sp-dim,aside{transition:opacity .3s}" +
    ".cp-sp-paying .cp-sp-dim{opacity:.45;pointer-events:none}" +
    ".cp-sp-paying aside input,.cp-sp-paying aside button{opacity:.45}";
  document.head.appendChild(css);

  /* ---------------------- the capture's own errors, out ---------------------- */
  // Shopify's alerts about the captured cart itself — the product can't ship to
  // where the capture ran, sold out since — say nothing about the shopper's
  // order in the demo: hidden ("The product in your cart is not available for
  // delivery to United Kingdom.")
  var CART_ERROR = /not available for delivery|can.?t be (shipped|delivered)|cannot be (shipped|delivered)|doesn.?t ship to|not (be )?available in your (country|region)|(sold out|out of stock|no longer available|isn.?t available|unavailable)/i;
  document.querySelectorAll("[role=alert]").forEach(function (a) {
    if (!a.closest("aside") && CART_ERROR.test(a.textContent || "")) a.style.display = "none";
  });

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

  // Express buttons share one shape, the store's own (Shopify draws them all with
  // the checkout's button rounding): take it from the Shop Pay button the page
  // drew itself, else from the page's main button
  (function walletShape() {
    var wallets = document.querySelectorAll(".cp-wallet");
    if (!wallets.length) return;
    var model = document.querySelector("#shop-pay-button, a[href*='shop_pay'], a[href*='payment=shop_pay']") ||
      Array.prototype.find.call(document.querySelectorAll("#checkout-main button[type=submit], main button[type=submit], form button[type=submit]"), function (b) {
        return b.getBoundingClientRect().height >= 36;
      });
    var radius = model && getComputedStyle(model).borderRadius;
    if (!radius) return; // square corners ("0px") are a shape too
    wallets.forEach(function (w) { w.style.borderRadius = radius; });
  })();

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

  /* ------------------------------ Shop Pay ------------------------------ */
  // As Shop Pay runs for a signed-in shopper: the button spins while shop.app
  // loads, then the checkout's left column becomes Shop Pay's — the "shop"
  // wordmark and email, one card with Ship to / Shipping / Payment already
  // filled, a newsletter tick and a purple Pay now. The header and the order
  // summary stay the store's. The shopper is the demo's (DemoMock.tsx).
  var SHOPPER = { name: "Tucker Briggs", email: "tucker.briggs01@gmail.com", address: "4563 Coronado Dr, Oceanside CA 92057, US", card: "4242" };
  var SP = "#5a31f4"; // Shop Pay purple (hover #4314cb, in the styles above)

  function isShopPay(btn) {
    if (btn.matches("#shop-pay-button, a[href*='shop_pay']")) return true;
    var logo = btn.querySelector("svg[aria-label], img[alt]");
    var text = (btn.innerText || "") + " " + (btn.getAttribute("aria-label") || "") + " " + (logo ? logo.getAttribute("aria-label") || logo.getAttribute("alt") || "" : "");
    return /shop ?pay|^\s*shop\s*$/i.test(text);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }

  var chevron = "<svg width='14' height='14' viewBox='0 0 14 14' fill='none' aria-hidden='true'><path d='M3.5 5.25 7 8.75l3.5-3.5' stroke='#707070' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>";
  function row(label, value, last) {
    return "<div class='cp-sp-row' style='" + (last ? "" : "border-bottom:1px solid #dedede;") + "'>" +
      "<span style='color:#707070'>" + label + "</span><span style='font-weight:600;color:#000'>" + value + "</span>" + chevron + "</div>";
  }

  var bar = function (w, h, mt) {
    return "<div style='height:" + (h || 8) + "px;width:" + w + ";margin-top:" + (mt || 0) + "px;border-radius:99px;background:rgba(0,0,0,.08)'></div>";
  };
  var shippingLoading = bar("55%", 10, 2) + bar("30%", 8, 7);
  var shippingValue = "Standard Shipping · Free<br><span style='font-weight:400'>Est. delivery: 3–6 business days</span>";

  function shopPayForm() {
    return document.querySelector("#checkout-main form") || document.querySelector("main form");
  }

  // a cover over the checkout's column while "shop.app" loads: blank, then the grey outline
  function shopPayLoading(form, skeleton) {
    var cover = form.querySelector(".cp-sp-loading");
    if (!cover) {
      cover = document.createElement("div");
      cover.className = "cp-sp-loading";
      Array.prototype.forEach.call(form.children, function (c) { c.style.display = "none"; });
      form.insertBefore(cover, form.firstChild);
      window.scrollTo(0, 0);
    }
    var group = bar("48px", 12) + bar("100%", 8, 16) + bar("100%", 8, 7);
    cover.innerHTML = skeleton
      ? "<div class='cp-sp-in' style='padding-top:6px'>" + [group, group, group].join("<div style='height:40px'></div>") + "</div>"
      : "";
    cover.style.minHeight = "420px";
  }

  function shopPayView() {
    var form = shopPayForm();
    if (!form) return false;
    var cover = form.querySelector(".cp-sp-loading");
    if (cover) cover.remove();
    var visa = "<span style='display:inline-flex;align-items:center;height:20px;padding:0 5px;margin-left:8px;border-radius:3px;background:#1434cb;color:#fff;font:italic 800 11px/1 Arial,sans-serif;letter-spacing:.02em;vertical-align:middle'>VISA</span>";
    var view = document.createElement("div");
    view.className = "cp-sp cp-sp-in";
    view.innerHTML =
      "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:14px'>" +
        "<span style='color:" + SP + ";font:800 25px/1 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;letter-spacing:-.04em'>shop</span>" +
        "<span style='display:inline-flex;align-items:center;gap:8px;font-size:14px;color:#000'>" + esc(SHOPPER.email) +
          "<svg width='4' height='14' viewBox='0 0 4 14' aria-hidden='true'><circle cx='2' cy='2' r='1.4' fill='#000'/><circle cx='2' cy='7' r='1.4' fill='#000'/><circle cx='2' cy='12' r='1.4' fill='#000'/></svg></span>" +
      "</div>" +
      "<div class='cp-sp-dim' style='border:1px solid #dedede;border-radius:14px;overflow:hidden'>" +
        row("Ship to", esc(SHOPPER.name) + "<br><span style='font-weight:400'>" + esc(SHOPPER.address) + "</span>") +
        row("Shipping", "<div data-cp-sp-ship>" + shippingLoading + "</div>") +
        row("Payment", esc(SHOPPER.name.split(" ")[0]) + " ···· " + SHOPPER.card + visa, true) +
      "</div>" +
      // drawn, not a native input: the store's CSS hides those
      "<div class='cp-sp-dim' role='checkbox' aria-checked='false' tabindex='0' data-cp-sp-tick style='display:flex;align-items:center;gap:10px;margin:26px 0 22px;font-size:14px;color:#000;cursor:pointer'>" +
        "<span class='cp-sp-box'></span>Sign me up for news and offers from this store</div>" +
      "<button type='button' class='cp-sp-pay cp-sp-wait' data-cp-sp-pay>Pay now</button>" +
      "<div class='cp-sp-dim' style='margin-top:20px;text-align:center;font-size:14px;color:var(--cp-sp-link,#707070)'>Check out as guest</div>";
    // the store's link colour, as Shop Pay borrows it (the policy links at the foot)
    var links = document.querySelectorAll("#checkout-main a[href]");
    var link = links[links.length - 1];
    if (link) view.style.setProperty("--cp-sp-link", getComputedStyle(link).color);
    var tick = view.querySelector("[data-cp-sp-tick]");
    tick.addEventListener("click", function () {
      tick.setAttribute("aria-checked", tick.getAttribute("aria-checked") === "true" ? "false" : "true");
    });
    Array.prototype.forEach.call(form.children, function (c) { c.style.display = "none"; });
    form.insertBefore(view, form.firstChild);
    window.scrollTo(0, 0);
    // the address and card come in with the page; the shipping rate a beat
    // later, and only then can the order be paid
    window.setTimeout(function () {
      var ship = view.querySelector("[data-cp-sp-ship]");
      ship.innerHTML = shippingValue;
      ship.classList.add("cp-sp-in");
        view.querySelector("[data-cp-sp-pay]").classList.remove("cp-sp-wait");
      // the summary's shipping line, now that there's an address
      document.querySelectorAll("aside *").forEach(function (el) {
        if (!el.children.length && /^(enter shipping address|calculated at next step)$/i.test((el.textContent || "").trim())) el.textContent = "Free";
      });
    }, 1300);
    return true;
  }

  // Shop: the column goes blank as shop.app loads, shows its grey outline, then
  // Shop Pay's own column (as the store's Shop button does for a signed-in shopper)
  function shopPay(btn) {
    if (paying) return;
    var form = shopPayForm();
    if (!form) { pay(btn); return; }
    paying = true;
    shopPayLoading(form, false);
    window.setTimeout(function () { shopPayLoading(form, true); }, 500);
    window.setTimeout(function () {
      paying = false;
      shopPayView();
    }, 2000);
  }

  // Shop Pay's Pay now: two seconds of spinner while the rest of the page
  // greys out, then "Processing..." until the order goes through
  function shopPayPay(btn) {
    if (paying) return;
    paying = true;
    btn.classList.add("cp-busy");
    btn.innerHTML = "<span class='cp-spin'></span>";
    document.body.classList.add("cp-sp-paying");
    window.setTimeout(function () {
      btn.innerHTML = "<span style='display:inline-flex;align-items:center;gap:8px'><span class='cp-spin' style='width:16px;height:16px'></span>Processing...</span>";
    }, 2000);
    window.setTimeout(function () { location.href = NEXT; }, 7000);
  }

  /* ------------------------- PayPal and Google Pay ------------------------- */
  // Both open a window over the checkout, as they do on a real store, with the
  // shopper's saved address and card already chosen — nothing to type, nothing
  // checked: one press and it's paid.
  //   PayPal: the checkout dims behind PayPal's "secure browser" note, PayPal's
  //   window loads, shows Ship to / Pay with, "Continue to Review Order" — back
  //   on the checkout, filled from PayPal, Pay now.
  //   Google Pay: Google's sheet with card, address, shipping and contact chosen;
  //   Continue pays, and the order goes straight through.
  function wordsOf(btn) {
    var logo = btn.querySelector("svg[aria-label], img[alt]");
    return ((btn.innerText || "") + " " + (btn.getAttribute("aria-label") || "") + " " +
      (logo ? logo.getAttribute("aria-label") || logo.getAttribute("alt") || "" : "")).replace(/\s+/g, " ");
  }
  var isPayPal = function (btn) { return /paypal/i.test(wordsOf(btn)); };
  var isGooglePay = function (btn) { return /google ?pay|\bg ?pay\b/i.test(wordsOf(btn)); };

  // the order's total, as the summary shows it
  function orderTotal() {
    var out = "";
    document.querySelectorAll("aside [role=row]").forEach(function (r) {
      var h = r.querySelector("[role=rowheader]");
      if (out || !h || !/^total$/i.test(h.textContent.trim())) return;
      var s = r.querySelector("[role=cell] strong") || r.querySelector("[role=cell]");
      out = (s.textContent || "").trim();
    });
    return out;
  }
  var store = function () { return brand.name || CFG.name || "the store"; };
  var first = function () { return SHOPPER.name.split(" ")[0]; };
  var addressLines = function () {
    var parts = SHOPPER.address.split(", ");
    return esc(parts[0]) + "<br>" + esc(parts.slice(1).join(", "));
  };

  css.textContent +=
    "@keyframes cp-win-in{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}" +
    "@keyframes cp-win-out{to{opacity:0;transform:translateY(10px) scale(.97)}}" +
    "@keyframes cp-fade-out{to{opacity:0}}" +
    ".cp-scrim{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;animation:cp-sp-in .25s ease-out}" +
    ".cp-scrim.cp-out{animation:cp-fade-out .3s ease-in forwards}" +
    ".cp-win{position:relative;width:min(440px,94vw);max-height:92vh;display:flex;flex-direction:column;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.55);animation:cp-win-in .35s cubic-bezier(.2,.8,.2,1);font:14px/1.45 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#2c2e2f;text-align:left}" +
    ".cp-win.cp-out{animation:cp-win-out .25s ease-in forwards}" +
    // the popup's window frame: title bar, address bar
    ".cp-win-bar{flex:none;display:flex;align-items:center;gap:8px;height:32px;padding:0 4px 0 12px;background:#dfe3e8;font:12px/1 'Segoe UI',system-ui,sans-serif;color:#202124}" +
    ".cp-win-bar b{flex:1;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".cp-win-ctl{display:flex}.cp-win-ctl span{width:34px;height:32px;display:flex;align-items:center;justify-content:center;color:#3c4043;font-size:13px;cursor:default}" +
    ".cp-win-ctl span[data-cp-close]{cursor:pointer}.cp-win-ctl span[data-cp-close]:hover{background:#e81123;color:#fff}" +
    ".cp-win-url{flex:none;display:flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-bottom:1px solid #dadce0;font:12px/1 'Segoe UI',system-ui,sans-serif;color:#5f6368;white-space:nowrap;overflow:hidden}" +
    // as tall as what it shows (a loading window keeps a window's height)
    ".cp-win-body{flex:1;min-height:440px;overflow:auto;position:relative}" +
    "@keyframes cp-ring{to{transform:rotate(360deg)}}" +
    ".cp-ring{width:34px;height:34px;border-radius:50%;border:3px solid rgba(0,112,186,.2);border-top-color:#0070ba;animation:cp-ring .8s linear infinite}" +
    // PayPal's window
    ".cp-pp{padding:22px 26px 26px}" +
    ".cp-pp-top{display:flex;align-items:center;justify-content:space-between;padding-bottom:18px;border-bottom:1px solid #eaeced}" +
    ".cp-pp-h{margin:22px 0 4px;font-size:22px;font-weight:700;color:#2c2e2f}" +
    ".cp-pp-l{margin:20px 0 8px;font-size:13px;font-weight:700;color:#6c7378;text-transform:uppercase;letter-spacing:.04em}" +
    ".cp-pp-card{display:flex;gap:12px;justify-content:space-between;padding:14px 16px;border:1px solid #cbd2d6;border-radius:10px}" +
    ".cp-pp-a{color:#0070ba;font-weight:700;cursor:default}" +
    ".cp-pp-opt{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid #cbd2d6;border-radius:10px;margin-top:8px}" +
    ".cp-pp-opt.on{border:2px solid #0070ba;padding:13px 15px}" +
    ".cp-pp-dot{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid #9da3a6;box-sizing:border-box}" +
    ".cp-pp-opt.on .cp-pp-dot{border:6px solid #0070ba}" +
    ".cp-pp-go{display:flex;align-items:center;justify-content:center;width:100%;height:48px;margin-top:26px;border:0;border-radius:24px;background:#0070ba;color:#fff;font:700 16px/1 'Helvetica Neue',Helvetica,Arial,sans-serif;cursor:pointer;transition:background .15s}" +
    ".cp-pp-go:hover{background:#005ea6}" +
    ".cp-pp-note{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#fff;text-align:center;font:15px/1.5 'Helvetica Neue',Helvetica,Arial,sans-serif}" +
    // Google Pay's window
    ".cp-gp{padding:18px 22px 22px;font-family:Roboto,'Segoe UI',Arial,sans-serif;color:#202124}" +
    ".cp-gp-top{display:flex;align-items:center;justify-content:space-between}" +
    ".cp-gp-av{width:30px;height:30px;border-radius:50%;background:#5f6368;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:500}" +
    ".cp-gp-m{display:flex;justify-content:space-between;align-items:baseline;margin:20px 0 6px;padding-bottom:16px;border-bottom:1px solid #e8eaed}" +
    ".cp-gp-row{display:flex;align-items:center;gap:14px;padding:13px 2px;border-bottom:1px solid #e8eaed}" +
    ".cp-gp-row>div{flex:1;min-width:0}.cp-gp-row small{display:block;color:#5f6368;font-size:12px}" +
    ".cp-gp-go{display:flex;align-items:center;justify-content:center;width:100%;height:44px;margin-top:22px;border:0;border-radius:22px;background:#1a73e8;color:#fff;font:500 15px/1 Roboto,'Segoe UI',Arial,sans-serif;cursor:pointer}" +
    ".cp-gp-go:hover{background:#1765cc}" +
    "@keyframes cp-gdot{0%,80%,100%{transform:scale(.6);opacity:.5}40%{transform:none;opacity:1}}" +
    ".cp-gdots{display:flex;gap:8px}.cp-gdots i{width:10px;height:10px;border-radius:50%;animation:cp-gdot 1s infinite}";

  var PP_MARK = "<i style='font-style:italic;font-weight:800;letter-spacing:-.02em;font-family:Verdana,Arial,sans-serif'><span style='color:#003087'>Pay</span><span style='color:#009cde'>Pal</span></i>";
  var G_MARK = "<span style='font:500 20px/1 Roboto,Arial,sans-serif;color:#5f6368'><b style='background:conic-gradient(from -45deg,#ea4335 0 25%,#4285f4 0 50%,#34a853 0 75%,#fbbc05 0);-webkit-background-clip:text;color:transparent'>G</b> Pay</span>";
  var VISA = "<span style='display:inline-flex;align-items:center;height:20px;padding:0 5px;border-radius:3px;background:#1434cb;color:#fff;font:italic 800 11px/1 Arial,sans-serif;letter-spacing:.02em'>VISA</span>";
  var CHEV = "<svg width='8' height='12' viewBox='0 0 8 12' aria-hidden='true'><path d='M2 1l5 5-5 5' fill='none' stroke='#5f6368' stroke-width='1.6'/></svg>";

  // a browser popup over the dimmed checkout
  function popup(title, url, scrimColor) {
    var scrim = document.createElement("div");
    scrim.className = "cp-scrim";
    scrim.style.background = scrimColor;
    document.body.appendChild(scrim);
    var win = document.createElement("div");
    win.className = "cp-win";
    win.innerHTML =
      "<div class='cp-win-bar'><b>" + title + "</b><div class='cp-win-ctl'><span>&#8212;</span><span>&#9633;</span><span data-cp-close>&#10005;</span></div></div>" +
      "<div class='cp-win-url'><svg width='11' height='12' viewBox='0 0 11 12' aria-hidden='true'><rect x='1' y='5' width='9' height='6.5' rx='1.2' fill='#5f6368'/><path d='M3 5V3.6a2.5 2.5 0 015 0V5' fill='none' stroke='#5f6368' stroke-width='1.3'/></svg>" + url + "</div>" +
      "<div class='cp-win-body'></div>";
    var body = win.querySelector(".cp-win-body");
    function close(after) {
      win.classList.add("cp-out");
      window.setTimeout(function () {
        win.remove();
        scrim.classList.add("cp-out");
        window.setTimeout(function () { scrim.remove(); if (after) after(); }, 300);
      }, 240);
    }
    win.querySelector("[data-cp-close]").addEventListener("click", function () { close(function () { paying = false; }); });
    return { scrim: scrim, win: win, body: body, close: close, open: function () { scrim.appendChild(win); } };
  }

  function busy(btn, light) {
    btn.style.pointerEvents = "none";
    btn.innerHTML = "<span class='cp-ring' style='width:20px;height:20px;border-width:2.5px;border-color:rgba(255,255,255,.35);border-top-color:" + (light || "#fff") + "'></span>";
  }

  function payPal() {
    if (paying) return;
    paying = true;
    var total = orderTotal();
    var w = popup("Log in to your PayPal account", "https://www.paypal.com/checkoutnow?token=EC-" + Math.random().toString(36).slice(2, 12).toUpperCase(), "rgba(0,0,0,.84)");
    // PayPal's note on the dimmed checkout, while its window opens over it
    var note = document.createElement("div");
    note.className = "cp-pp-note";
    note.innerHTML = "<div style='font-size:30px'><i style='font-style:italic;font-weight:800;letter-spacing:-.02em;font-family:Verdana,Arial,sans-serif;color:#fff'>PayPal</i></div>" +
      "<div style='max-width:340px'>Don't see the secure PayPal browser? We'll help you re-launch the window to complete your purchase.</div>" +
      "<div style='font-weight:700;text-decoration:underline'>Click to Continue</div>";
    w.scrim.appendChild(note);
    window.setTimeout(function () {
      w.open();
      w.body.innerHTML = "<div style='height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px'><div style='font-size:30px'>" + PP_MARK + "</div><div class='cp-ring'></div></div>";
    }, 650);
    window.setTimeout(function () {
      w.body.innerHTML =
        "<div class='cp-pp cp-sp-in'>" +
          "<div class='cp-pp-top'><span style='font-size:26px'>" + PP_MARK + "</span>" +
            "<span style='display:inline-flex;align-items:center;gap:7px;font-weight:700'><svg width='18' height='16' viewBox='0 0 18 16' aria-hidden='true'><path d='M1 1h2.5l2 9.5h9L17 4H5' fill='none' stroke='#2c2e2f' stroke-width='1.6' stroke-linejoin='round'/><circle cx='7' cy='14' r='1.3' fill='#2c2e2f'/><circle cx='14' cy='14' r='1.3' fill='#2c2e2f'/></svg>" + esc(total) + "</span></div>" +
          "<div class='cp-pp-h'>Hi, " + esc(first()) + "!</div>" +
          "<div style='color:#6c7378'>" + esc(SHOPPER.email) + " &middot; <span class='cp-pp-a' style='font-weight:400'>Not you?</span></div>" +
          "<div class='cp-pp-l'>Ship to</div>" +
          "<div class='cp-pp-card'><div><b>" + esc(SHOPPER.name) + "</b><br>" + addressLines() + "</div><span class='cp-pp-a'>Change</span></div>" +
          "<div class='cp-pp-l'>Pay with</div>" +
          "<div class='cp-pp-opt on'><span class='cp-pp-dot'></span>" + VISA + "<div style='flex:1'><b>Visa</b> &bull;&bull;&bull;&bull; " + SHOPPER.card + "<br><span style='color:#6c7378;font-size:13px'>Credit</span></div></div>" +
          "<div class='cp-pp-opt'><span class='cp-pp-dot'></span><span style='font-size:15px'>" + PP_MARK + "</span><div style='flex:1'>PayPal balance<br><span style='color:#6c7378;font-size:13px'>$0.00</span></div></div>" +
          "<button type='button' class='cp-pp-go' data-cp-pp-go>Continue to Review Order</button>" +
          "<div style='margin-top:18px;text-align:center'><span class='cp-pp-a' style='font-weight:400' data-cp-pp-cancel>Cancel and return to " + esc(store()) + "</span></div>" +
        "</div>";
      w.body.querySelector("[data-cp-pp-cancel]").style.cursor = "pointer";
      w.body.querySelector("[data-cp-pp-cancel]").addEventListener("click", function () { w.close(function () { paying = false; }); });
      w.body.querySelector("[data-cp-pp-go]").addEventListener("click", function () {
        busy(this);
        window.setTimeout(function () { w.close(function () { paying = false; payPalReview(); }); }, 1300);
      });
    }, 1900);
  }

  // back from PayPal: the checkout's column filled from it — Ship to, shipping,
  // "PayPal" as the payment — and the store's Pay now
  function payPalReview() {
    var form = shopPayForm();
    if (!form) { window.location.href = NEXT; return; }
    var main = Array.prototype.find.call(document.querySelectorAll("button"), function (b) {
      return !b.closest("aside") && !b.classList.contains("cp-wallet") && /^(pay now|review order|complete order)/i.test((b.innerText || "").trim());
    });
    var ink = main ? getComputedStyle(main).backgroundColor : "#000";
    var inkText = main ? getComputedStyle(main).color : "#fff";
    var radius = main ? getComputedStyle(main).borderRadius : "5px";
    var view = document.createElement("div");
    view.className = "cp-sp cp-sp-in";
    view.innerHTML =
      "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:14px'>" +
        "<span style='font-size:24px'>" + PP_MARK + "</span>" +
        "<span style='font-size:14px;color:#000'>" + esc(SHOPPER.email) + "</span>" +
      "</div>" +
      "<div class='cp-sp-dim' style='border:1px solid #dedede;border-radius:10px;overflow:hidden'>" +
        row("Contact", esc(SHOPPER.email)) +
        row("Ship to", esc(SHOPPER.name) + "<br><span style='font-weight:400'>" + esc(SHOPPER.address) + "</span>") +
        row("Shipping", "<div data-cp-sp-ship>" + shippingLoading + "</div>") +
        row("Payment", "<span style='font-size:15px'>" + PP_MARK + "</span> <span style='font-weight:400'>" + esc(SHOPPER.email) + "</span>", true) +
      "</div>" +
      "<button type='button' class='cp-sp-pay cp-sp-wait' data-cp-sp-pay style='margin-top:26px;background:" + ink + ";color:" + inkText + ";border-radius:" + radius + "'>Pay now</button>";
    Array.prototype.forEach.call(form.children, function (c) { c.style.display = "none"; });
    form.insertBefore(view, form.firstChild);
    window.scrollTo(0, 0);
    window.setTimeout(function () {
      var ship = view.querySelector("[data-cp-sp-ship]");
      ship.innerHTML = shippingValue;
      ship.classList.add("cp-sp-in");
      view.querySelector("[data-cp-sp-pay]").classList.remove("cp-sp-wait");
      document.querySelectorAll("aside *").forEach(function (el) {
        if (!el.children.length && /^(enter shipping address|calculated at next step)$/i.test((el.textContent || "").trim())) el.textContent = "Free";
      });
    }, 1100);
  }

  function googlePay(btn) {
    if (paying) return;
    paying = true;
    var total = orderTotal();
    var w = popup("Google Pay", "https://pay.google.com/gp/p/ui/pay", "rgba(32,33,36,.62)");
    w.open();
    w.body.innerHTML = "<div style='height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px'>" + G_MARK.replace("20px", "30px") +
      "<div class='cp-gdots'><i style='background:#4285f4'></i><i style='background:#ea4335;animation-delay:.15s'></i><i style='background:#fbbc05;animation-delay:.3s'></i><i style='background:#34a853;animation-delay:.45s'></i></div></div>";
    var gRow = function (icon, title, value) {
      return "<div class='cp-gp-row'>" + icon + "<div><small>" + title + "</small>" + value + "</div>" + CHEV + "</div>";
    };
    var pin = "<svg width='20' height='20' viewBox='0 0 24 24' aria-hidden='true'><path d='M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z' fill='#5f6368'/></svg>";
    var truck = "<svg width='20' height='20' viewBox='0 0 24 24' aria-hidden='true'><path d='M3 6h11v9H3zM14 9h4l3 3v3h-7z' fill='none' stroke='#5f6368' stroke-width='1.7' stroke-linejoin='round'/><circle cx='7' cy='17' r='1.8' fill='#5f6368'/><circle cx='17' cy='17' r='1.8' fill='#5f6368'/></svg>";
    var mail = "<svg width='20' height='20' viewBox='0 0 24 24' aria-hidden='true'><rect x='3' y='5' width='18' height='14' rx='2' fill='none' stroke='#5f6368' stroke-width='1.7'/><path d='M3.5 6.5l8.5 6 8.5-6' fill='none' stroke='#5f6368' stroke-width='1.7'/></svg>";
    window.setTimeout(function () {
      w.body.innerHTML =
        "<div class='cp-gp cp-sp-in'>" +
          "<div class='cp-gp-top'>" + G_MARK + "<span style='display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#5f6368'>" + esc(SHOPPER.email) + "<span class='cp-gp-av'>" + esc(first().charAt(0)) + "</span></span></div>" +
          "<div class='cp-gp-m'><span style='font-size:16px'>" + esc(store()) + "</span><span style='font-size:22px;font-weight:500'>" + esc(total) + "</span></div>" +
          gRow(VISA, "Payment method", "Visa &bull;&bull;&bull;&bull; " + SHOPPER.card) +
          gRow(pin, "Shipping address", esc(SHOPPER.name) + ", " + esc(SHOPPER.address)) +
          gRow(truck, "Shipping method", "Standard Shipping &middot; Free") +
          gRow(mail, "Contact info", esc(SHOPPER.email)) +
          "<button type='button' class='cp-gp-go' data-cp-gp-go>Continue</button>" +
          "<div style='margin-top:14px;font-size:11px;line-height:1.5;color:#5f6368;text-align:center'>By continuing, you agree to the Google Payments Terms of Service. The Privacy Notice describes how your data is handled.</div>" +
        "</div>";
      w.body.querySelector("[data-cp-gp-go]").addEventListener("click", function () {
        busy(this);
        // paid in the sheet: back on the checkout, the order goes straight through
        window.setTimeout(function () {
          w.close(function () {
            btn.innerHTML = "<span class='cp-spin'></span>";
            btn.classList.add("cp-busy");
            document.body.classList.add("cp-sp-paying");
            window.setTimeout(function () { window.location.href = NEXT; }, 1300);
          });
        }, 1200);
      });
    }, 1500);
  }

  /* ------------------------- the form, checked first ------------------------- */
  // As Shopify's own checkout does: its pay button ("Review order", "Pay now")
  // first checks the form — every required field left empty turns red with its
  // message under it, and the page goes to the first. Typing clears a field's error.
  var ERR = "#dd1d1d";
  var FIELD_MESSAGES = [
    [/apartment|suite|address ?2|optional|company|discount|gift card/i, null],
    [/e-?mail/i, "Enter an email"],
    [/first/i, "Enter a first name"],
    [/last|surname/i, "Enter a last name"],
    [/address/i, "Enter an address"],
    [/city|town|suburb/i, "Enter a city"],
    [/state|province|county|zone/i, "Select a state / province"],
    [/zip|postal|post ?code/i, "Enter a ZIP / postal code"],
    [/phone|mobile/i, "Enter a phone number"],
  ];
  // what the shopper reads on the field ("City"), else what its autofill name says
  // ("address-level2" is the city, not the address)
  var AUTOFILL = { "email": "email", "given-name": "first", "family-name": "last", "address-line1": "address", "address-line2": "apartment",
    "address-level2": "city", "address-level1": "state", "postal-code": "zip", "tel": "phone", "organization": "company" };
  function fieldName(el) {
    var label = el.labels && el.labels[0] ? el.labels[0].textContent : "";
    var shown = [label, el.getAttribute("placeholder"), el.getAttribute("aria-label")].filter(Boolean).join(" ").trim();
    if (shown) return shown;
    var auto = (el.getAttribute("autocomplete") || "").split(/\s+/).map(function (t) { return AUTOFILL[t]; }).filter(Boolean)[0];
    return auto || el.getAttribute("name") || "";
  }
  function messageFor(el) {
    var name = fieldName(el);
    for (var i = 0; i < FIELD_MESSAGES.length; i += 1) if (FIELD_MESSAGES[i][0].test(name)) return FIELD_MESSAGES[i][1];
    return null;
  }
  // the box that draws the field's border (the input itself, or a wrapper)
  function fieldBox(el) {
    for (var e = el, i = 0; e && i < 4; e = e.parentElement, i += 1) {
      var cs = getComputedStyle(e);
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none" && e.getBoundingClientRect().width >= el.getBoundingClientRect().width - 4) return e;
    }
    return el;
  }
  function clearError(el) {
    var box = fieldBox(el);
    box.style.borderColor = "";
    box.style.boxShadow = "";
    var m = box.nextElementSibling;
    if (m && m.classList.contains("cp-err")) m.remove();
  }
  function formIsComplete() {
    var main = document.querySelector("#checkout-main") || document.querySelector("main") || document.body;
    var fields = Array.prototype.filter.call(main.querySelectorAll("input, select"), function (el) {
      if (el.closest("aside, .cp-up, .cp-sp")) return false;
      if (/^(checkbox|radio|hidden|submit|button)$/i.test(el.type || "")) return false;
      return el.getBoundingClientRect().height > 0;
    });
    var marked = fields.some(function (el) { return el.required || el.getAttribute("aria-required") === "true"; });
    var first = null;
    fields.forEach(function (el) {
      clearError(el);
      var msg = messageFor(el);
      var required = marked ? el.required || el.getAttribute("aria-required") === "true" : !!msg;
      if (!required) return;
      var value = (el.value || "").trim();
      var bad = !value;
      if (!bad && /e-?mail/i.test(fieldName(el)) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) { bad = true; msg = "Enter a valid email"; }
      if (!bad) return;
      var box = fieldBox(el);
      box.style.borderColor = ERR;
      box.style.boxShadow = "0 0 0 1px " + ERR;
      var note = document.createElement("div");
      note.className = "cp-err";
      note.textContent = msg || "Enter a value";
      note.style.cssText = "margin-top:6px;color:" + ERR + ";font-size:14px;line-height:1.4";
      box.parentNode.insertBefore(note, box.nextSibling);
      if (!first) first = el;
    });
    if (first) {
      first.scrollIntoView({ block: "center", behavior: "smooth" });
      try { first.focus({ preventScroll: true }); } catch { first.focus(); }
    }
    return !first;
  }
  document.addEventListener("input", function (e) { if (e.target && e.target.matches && e.target.matches("input, select")) clearError(e.target); }, true);
  document.addEventListener("change", function (e) { if (e.target && e.target.matches && e.target.matches("select")) clearError(e.target); }, true);

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
    var sp = t.closest("[data-cp-sp-pay]");
    if (sp) { e.preventDefault(); e.stopPropagation(); shopPayPay(sp); return; }
    var btn = payButton(t);
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (isShopPay(btn)) shopPay(btn);
      else if (isPayPal(btn)) payPal(btn);
      else if (isGooglePay(btn)) googlePay(btn);
      else if (btn.hasAttribute("data-cp-pay") || formIsComplete()) pay(btn); // the store's own button checks the form first
      return;
    }
    // nothing else leaves the page: sign-in, policies, logo, "return to cart"
    if (t.closest("a[href]")) e.preventDefault();
  }, true);
  document.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.submitter || (e.target && e.target.querySelector && e.target.querySelector("button[type=submit]"));
    if (btn && (btn.hasAttribute("data-cp-pay") || formIsComplete())) pay(btn);
  }, true);

  /* ----------------------------- countdowns ----------------------------- */
  // A store's own urgency timer ("Hurry! … 9:56", "Cart reserved for 04:59")
  // was frozen with the picture: start it again, counting down to 0:00.
  // Times of day ("9:30 AM") are left alone.
  (function () {
    var CLOCK = /(^|[^\d:])(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?![\d:]|\s*[ap]\.?m\b)/i;
    var timers = [];
    var walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        if (!p || p.closest("script,style,noscript,textarea,[data-cp-slot]")) return NodeFilter.FILTER_REJECT;
        return CLOCK.test(n.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (var n = walk.nextNode(); n; n = walk.nextNode()) {
      var m = CLOCK.exec(n.nodeValue);
      var a = +m[2], b = +m[3], c = m[4] != null ? +m[4] : null;
      var secs = c == null ? a * 60 + b : a * 3600 + b * 60 + c; // m:ss or h:mm:ss
      if (secs > 0) timers.push({ node: n, at: m.index + m[1].length, len: m[0].length - m[1].length, secs: secs, hours: c != null, pad: m[2].length === 2 });
    }
    if (!timers.length) return;
    var two = function (x) { return (x < 10 ? "0" : "") + x; };
    window.setInterval(function () {
      timers.forEach(function (t) {
        if (t.secs <= 0) return;
        t.secs -= 1;
        var s = t.secs % 60, mns = Math.floor(t.secs / 60);
        var text = t.hours
          ? (t.pad ? two(Math.floor(mns / 60)) : Math.floor(mns / 60)) + ":" + two(mns % 60) + ":" + two(s)
          : (t.pad ? two(mns) : mns) + ":" + two(s);
        var v = t.node.nodeValue;
        t.node.nodeValue = v.slice(0, t.at) + text + v.slice(t.at + t.len);
        t.len = text.length;
      });
    }, 1000);
  })();

  /* ------------------------------ fields ------------------------------ */
  // The page's floating labels were frozen with the picture: once something is
  // typed, hide the field's label so it doesn't sit on top of the text.
  document.addEventListener("input", function (e) {
    var input = e.target;
    if (!input || !input.id) return;
    var label = document.querySelector("label[for='" + input.id + "']");
    if (label) label.style.visibility = input.value ? "hidden" : "";
  }, true);

  /* --------------------------- checkout upsell --------------------------- */
  // The store's checkout add-ons (src/lib/upsell/checkoutDeals.ts) in a box like
  // its own under the total: ticking one puts it in the order — a row in the
  // cart like the store's own, the subtotal and total updated, and the order
  // flow's cart with it.
  (function checkoutUpsell() {
    var deal = CFG.upsell;
    // the cart on screen (some checkouts carry a second, folded copy for small screens)
    var carts = Array.prototype.filter.call(document.querySelectorAll("aside [role=table]"), function (t) { return t.querySelector("img"); });
    var table = carts.find(function (t) { return t.getBoundingClientRect().height > 0; }) || carts[0];
    var cartSection = table && table.closest("section");
    if (!deal || !deal.items || !deal.items.length || !cartSection || !CFG.line) return;
    var base = CFG.line;
    var added = {};
    var fmt = function (n) {
      try { return new Intl.NumberFormat("en-US", { style: "currency", currency: brand.currency || "USD" }).format(n); } catch { return "$" + n.toFixed(2); }
    };
    var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); };
    var thumb = function (src, w) { return src ? src + (src.indexOf("?") < 0 ? "?" : "&") + "width=" + w : ""; };

    // the page's own measures: its border colour, muted text and button colour
    var field = document.querySelector("aside input");
    var lineColor = field ? getComputedStyle(field).borderTopColor : "#dedede";
    var radius = field ? getComputedStyle(field).borderTopLeftRadius : "8px";
    // a card like the checkout's own fields (their rounding and fill)
    var mainField = Array.prototype.find.call(document.querySelectorAll("main input, form input"), function (i) { return !i.closest("aside") && i.getBoundingClientRect().height > 30; });
    var mfs = mainField ? getComputedStyle(mainField) : null;
    var cardRadius = mfs && mfs.borderTopLeftRadius !== "0px" ? mfs.borderTopLeftRadius : radius;
    var cardBg = mfs && !/rgba\(0, 0, 0, 0\)|transparent/.test(mfs.backgroundColor) ? mfs.backgroundColor : "#fff";
    // the checkout's own main button ("Pay now", "Review order"), not a wallet's
    var mainBtn = Array.prototype.find.call(document.querySelectorAll("button"), function (b) {
      return !b.closest("aside") && !b.classList.contains("cp-wallet") && b.getBoundingClientRect().height >= 36 &&
        /^(pay now|review order|complete order|continue)/i.test((b.innerText || "").trim());
    });
    var ink = mainBtn ? getComputedStyle(mainBtn).backgroundColor : "#1a1a1a";
    var inkText = mainBtn ? getComputedStyle(mainBtn).color : "#fff";
    var mutedEl = Array.prototype.find.call(document.querySelectorAll("aside [role=cell] span"), function (s) { return /shipping address|calculated/i.test(s.textContent); });
    var muted = mutedEl ? getComputedStyle(mutedEl).color : "#707070";
    var tick = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'><path d='M4.5 9.5l3 3 6-6.5' fill='none' stroke='" + inkText + "' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>");

    css.textContent +=
      ".cp-up-pick{cursor:pointer;user-select:none}" +
      ".cp-up-box{flex:none;width:18px;height:18px;border:1px solid " + lineColor + ";border-radius:4px;background:#fff;box-sizing:border-box;transition:background .15s,border-color .15s}" +
      ".cp-up-pick:hover .cp-up-box{border-color:" + muted + "}" +
      "[aria-checked=true] .cp-up-box{border-color:" + ink + ";background:" + ink + " url(\"" + tick + "\") center/16px no-repeat}" +
      ".cp-up-badge{display:inline-block;margin-left:.5em;padding:.25em .55em;border-radius:5px;background:#1f1d2b;color:#fff;font-size:.66em;font-weight:700;letter-spacing:.06em;line-height:1.3;text-transform:uppercase;vertical-align:.2em;white-space:nowrap}" +
      ".cp-up-note{margin-top:.35em;color:" + muted + ";font-size:.86em;font-weight:400;line-height:1.4}" +
      ".cp-up-was{margin-left:.45em;color:" + muted + ";text-decoration:line-through}" +
      // the checkout add-on, as checkout apps draw it under the express buttons: a
      // bold heading and a line of text, then a card per product — checkbox, photo,
      // name, the old price struck beside the deal — in the checkout's own type,
      // borders and colours
      // an outer box around the heading and the cards
      ".cp-up-own{text-align:left;padding:16px;border:1px solid " + lineColor + ";border-radius:" + cardRadius + ";background:rgba(0,0,0,.018)}" +
      ".cp-up-own .cp-up-h{font-size:1.07em;font-weight:700;line-height:1.3}" +
      ".cp-up-own .cp-up-note{margin-top:2px;font-size:.86em}" +
      // a card per product inside it
      ".cp-up-own .cp-up-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}" +
      ".cp-up-own .cp-up-pick{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid " + lineColor + ";border-radius:" + cardRadius + ";background:" + cardBg + ";transition:border-color .15s}" +
      ".cp-up-own .cp-up-pick:hover{border-color:" + muted + "}" +
      ".cp-up-own .cp-up-pick[aria-checked=true]{border-color:" + ink + "}" +
      ".cp-up-own .cp-up-box{width:20px;height:20px;border-radius:5px}" +
      ".cp-up-own .cp-up-img{flex:none;width:52px;height:52px;border:1px solid " + lineColor + ";border-radius:8px;overflow:hidden;background:#fff}" +
      ".cp-up-own .cp-up-img img{width:100%;height:100%;object-fit:cover}" +
      ".cp-up-own .cp-up-t{font-size:.95em;font-weight:700;line-height:1.3}" +
      ".cp-up-own .cp-up-p{margin-top:3px;font-size:.95em;font-weight:700}" +
      ".cp-up-own .cp-up-p s{margin-right:.45em;color:" + muted + ";font-weight:400}" +
      ".cp-up-own .cp-up-p .cp-up-deal{color:#b5651d}";

    var isMoney = function (v) { return /\d[.,]\d\d/.test(v) && /[^\d\s.,]/.test(v); };
    var isAdd = function (b) { return /^(add|select|choose|add to (cart|order))$/i.test((b.textContent || "").trim()); };
    var checkbox = function () { var s = document.createElement("span"); s.className = "cp-up-box"; s.setAttribute("aria-hidden", "true"); return s; };
    var pickable = function (el, it) {
      el.classList.add("cp-up-pick");
      el.setAttribute("role", "checkbox");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-checked", "false");
      el.setAttribute("data-cp-up", it.id);
    };
    function heading(el) {
      if (deal.badge) { var b = document.createElement("span"); b.className = "cp-up-badge"; b.textContent = deal.badge; el.appendChild(b); }
    }
    function note(after, align) {
      if (!deal.note) return;
      var n = document.createElement("div");
      n.className = "cp-up-note";
      n.textContent = deal.note;
      if (align) n.style.textAlign = align;
      after.parentNode.insertBefore(n, after.nextSibling);
    }

    // the store's own add-on box ("Customers also bought", "Don't miss these
    // bestsellers"): its products' rows, each with an "Add" button
    function storeBox() {
      var aside = table.closest("aside");
      var adds = Array.prototype.filter.call(aside.querySelectorAll("button"), isAdd);
      if (!adds.length) return null;
      var box = adds[0];
      while (box && !adds.every(function (a) { return box.contains(a); })) box = box.parentElement;
      if (!box || box.contains(table) || (costTable && box.contains(costTable))) return null;
      // up to the bordered box that also holds the heading — or as far as it goes
      // without taking in the cart or the totals (some stores list them in the cart)
      for (var i = 0; i < 8; i++) {
        if (parseFloat(getComputedStyle(box).borderTopWidth) > 0) break;
        var up = box.parentElement;
        if (!up || up.tagName === "ASIDE" || up.contains(table) || (costTable && up.contains(costTable))) break;
        box = up;
      }
      return { box: box, adds: adds };
    }

    function ownBox() {
      var el = document.createElement("section");
      el.className = "cp-up-own";
      el.innerHTML = "<div class='cp-up-h'>" + esc(deal.title) + "</div><div class='cp-up-list'>" + deal.items.map(function (it) {
        var sale = it.compareAt > it.price;
        return "<div data-row='" + esc(it.id) + "'><span class='cp-up-img'>" + (it.image ? "<img data-cp-sharp='1' loading='lazy' alt='' src='" + esc(thumb(it.image, 200)) + "'>" : "") + "</span>" +
          "<div style='flex:1;min-width:0'><div class='cp-up-t'>" + esc(it.title) + "</div><div class='cp-up-p'>" +
          (sale ? "<s>" + fmt(it.compareAt) + "</s><span class='cp-up-deal'>" + fmt(it.price) + "</span>" : fmt(it.price)) + "</div></div></div>";
      }).join("") + "</div>";
      var h = el.querySelector(".cp-up-h");
      heading(h);
      note(h);
      deal.items.forEach(function (it) {
        var r = el.querySelector("[data-row='" + CSS.escape(it.id) + "']");
        r.removeAttribute("data-row");
        pickable(r, it);
        r.insertBefore(checkbox(), r.firstChild);
      });
      return el;
    }

    // Shopify's "Scroll for more items" hint is a gradient laid over the cart
    // list: with one line it covers nothing, over added lines it washes them out
    var hint = cartSection.nextElementSibling;
    if (hint && /scroll for more/i.test(hint.textContent || "")) hint.style.display = "none";
    var costTable = table && Array.prototype.find.call(table.closest("aside").querySelectorAll("[role=table]"), function (t) {
      return Array.prototype.some.call(t.querySelectorAll("[role=rowheader]"), function (h) { return /^total$/i.test(h.textContent.trim()); });
    });
    // ours, in the checkout's own style; the store's own add-on box (its "Add"
    // buttons) goes from the summary
    var found = storeBox();
    if (found) found.box.style.display = "none";
    var box = ownBox();
    // on the left, in the checkout itself: right under the express buttons (Shop
    // Pay, PayPal, Google Pay), above "OR"; without them, above the pay button
    var wallets = document.querySelector("#express-checkout-wallets-wrapper");
    if (!wallets) {
      var ws = Array.prototype.slice.call(document.querySelectorAll(".cp-wallet, #shop-pay-button")).filter(function (w) { return !w.closest("aside"); });
      wallets = ws[0] || null;
      while (wallets && !ws.every(function (w) { return wallets.contains(w); })) wallets = wallets.parentElement;
    }
    // the row's own box (the line the buttons sit on, not the heading above it)
    var row = wallets;
    while (row && row.parentElement && row.parentElement.getBoundingClientRect().height <= row.getBoundingClientRect().height + 2 &&
      row.parentElement.tagName !== "FORM" && row.parentElement.tagName !== "MAIN") row = row.parentElement;
    var payAt = mainBtn;
    while (payAt && payAt.parentElement && payAt.parentElement.tagName !== "FORM" && payAt.parentElement.tagName !== "MAIN" &&
      !payAt.parentElement.querySelector("input, select, textarea, [role=radio], [role=checkbox]")) payAt = payAt.parentElement;
    if (row && row.parentNode && !row.closest("aside")) {
      row.parentNode.insertBefore(box, row.nextSibling);
      box.style.margin = "18px 0 4px";
    } else if (payAt && payAt.parentNode) {
      payAt.parentNode.insertBefore(box, payAt);
      box.style.margin = "0 0 22px";
    } else {
      // no pay button to sit above: under the order summary's total
      var after = cartSection.parentElement && cartSection.parentElement.closest("aside") ? cartSection.parentElement : cartSection;
      if (costTable) {
        after = costTable;
        while (after.parentElement && !after.parentElement.contains(table) && after.parentElement.tagName !== "ASIDE") after = after.parentElement;
      }
      after.parentNode.insertBefore(box, after.nextSibling);
    }
    box.classList.add("cp-up");
    box.setAttribute("aria-label", deal.title);

    // a cart row for an add-on: the store's own row, re-dressed
    var model = table.querySelector("[role=rowgroup]:last-child [role=row]") || table.querySelector("[role=row]:last-child");
    function rowFor(it) {
      var row = model.cloneNode(true);
      row.setAttribute("data-cp-addon", it.id);
      row.querySelectorAll("img").forEach(function (img) {
        img.removeAttribute("srcset");
        img.setAttribute("data-cp-sharp", "1");
        img.setAttribute("src", thumb(it.image, 256));
      });
      // links and buttons under the title ("Modify", "Subscribe and save")
      row.querySelectorAll("a, button").forEach(function (el) { el.remove(); });
      var walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      var texts = [];
      for (var n; (n = walk.nextNode());) if (n.nodeValue.trim()) texts.push(n);
      var title = texts.find(function (t) { return t.nodeValue.trim() === base.title; });
      // the price: the line's last amount (a sale shows the old one first, struck)
      var moneys = texts.filter(function (t) { return isMoney(t.nodeValue.trim()) && !/off|save|discount/i.test(t.nodeValue); });
      var price = moneys[moneys.length - 1];
      if (title) title.nodeValue = it.title;
      if (price) {
        price.nodeValue = fmt(it.price);
        if (it.compareAt > it.price) {
          var was = document.createElement("s");
          was.textContent = fmt(it.compareAt);
          was.style.cssText = "margin-right:6px;color:#8a8a8a;font-weight:400";
          price.parentNode.insertBefore(was, price);
        }
      }
      // everything else on the line was the cart product's (its variant, its
      // discount code, an old price): out, up to what holds only it
      texts.forEach(function (t) {
        if (t === title || t === price) return;
        var el = t.parentElement;
        if (!el || !row.contains(el)) return;
        // the photo's cell keeps its own words (the quantity badge)
        var cell = el;
        while (cell.parentElement && cell.parentElement !== row) cell = cell.parentElement;
        if (cell.querySelector("img")) return;
        while (el.parentElement && el.parentElement !== row && !(title && el.parentElement.contains(title)) && !(price && el.parentElement.contains(price))) el = el.parentElement;
        if (el === row || (title && el.contains(title)) || (price && el.contains(price))) t.nodeValue = "";
        else el.remove();
      });
      return row;
    }

    // the subtotal and total, wherever the summary shows them
    var shown = fmt(base.price * base.qty);
    function totals() {
      var extra = Object.keys(added).reduce(function (s, k) { return s + added[k].price; }, 0);
      var sub = fmt(base.price * base.qty + extra);
      // the pay button carries the total too ("Review order $45.00")
      document.querySelectorAll("button, [role=button]").forEach(function (btn) {
        if (btn.closest("aside") || btn.closest(".cp-up")) return;
        // the amount may be one text, or one span per character ("$","4","5",…): the
        // innermost element that reads as the whole amount
        btn.querySelectorAll("*").forEach(function (el) {
          if (el.getAttribute("aria-label") === shown) el.setAttribute("aria-label", sub);
          if ((el.textContent || "").trim() !== shown) return;
          var inner = Array.prototype.some.call(el.children, function (c) { return (c.textContent || "").trim() === shown; });
          if (!inner) el.textContent = sub;
        });
      });
      shown = sub;
      document.querySelectorAll("aside [role=row]").forEach(function (r) {
        var head = r.querySelector("[role=rowheader]");
        var label = head && head.textContent.trim();
        if (!/^(subtotal|total)$/i.test(label || "")) return;
        var cell = r.querySelector("[role=cell]");
        if (!cell) return;
        // the total is drawn twice (a plain copy and an animated, digit-by-digit one)
        var strongs = cell.querySelectorAll("strong");
        if (strongs.length) strongs.forEach(function (s) { s.textContent = sub; });
        else { var sp = cell.querySelector("span") || cell; sp.textContent = sub; }
      });
      // the folded summary on small screens ("Order summary · $15.00"): the aside without the cart
      document.querySelectorAll("aside").forEach(function (a) {
        if (a.querySelector("[role=table]")) return;
        a.querySelectorAll("strong").forEach(function (s) {
          if (/^[^\d]*\d[\d,]*[.,]\d\d$/.test(s.textContent.trim())) s.textContent = sub;
        });
      });
      var items = [base].concat(Object.keys(added).map(function (k) {
        var it = added[k];
        return { id: "addon-" + it.id, title: it.title, variant: "", price: it.price, compareAt: it.compareAt, qty: 1, image: it.image || null };
      }));
      write("cp-cart", { items: items });
    }

    function onPick(e) {
      var more = e.target.closest(".cp-up-more");
      if (more) {
        e.preventDefault();
        e.stopPropagation();
        box.querySelector(".cp-up-list").classList.remove("cp-up-few");
        more.remove();
        return;
      }
      var b = e.target.closest("[data-cp-up]");
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      var id = b.getAttribute("data-cp-up");
      var it = deal.items.find(function (x) { return x.id === id; });
      if (!it) return;
      var rowgroup = model.parentNode;
      if (added[id]) {
        delete added[id];
        var old = rowgroup.querySelector("[data-cp-addon='" + CSS.escape(id) + "']");
        if (old) old.remove();
        b.setAttribute("aria-checked", "false");
      } else {
        added[id] = it;
        var row = rowFor(it);
        rowgroup.appendChild(row);
        // eased in by script: Shopify's row styles leave a CSS animation stuck at its first frame
        if (row.animate) row.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "ease-out" });
        b.setAttribute("aria-checked", "true");
      }
      totals();
    }
    box.addEventListener("click", onPick, true);
    box.addEventListener("keydown", function (e) {
      if ((e.key === " " || e.key === "Enter") && e.target.closest("[data-cp-up]")) onPick(e);
    }, true);
  })();

  /* ------------------------------ sharp images ------------------------------ */
  // The capture keeps each image's plain src, which Shopify sizes for 1x screens
  // ("…_64x64.png", "…?width=64"); the live checkout's srcset is what made them
  // sharp on retina. Ask Shopify's CDN for 4x instead (it resizes on request).
  var SHOPIFY_IMG = /(cdn\.shopify\.com|\/cdn\/shop\/)/;
  function sharper(url) {
    if (!url || !SHOPIFY_IMG.test(url)) return url;
    return url
      .replace(/_(\d+)?x(\d+)?(?=(@\dx)?\.(png|jpe?g|webp|gif|avif)\b)/i, function (m, w, h) {
        var up = function (n) { return n ? String(Math.max(+n * 4, 256)) : ""; };
        return "_" + up(w) + "x" + up(h);
      })
      .replace(/([?&](width|height)=)(\d+)/gi, function (m, k, _, n) { return k + Math.max(+n * 4, 256); });
  }
  function sharpen(img) {
    if (img.dataset.cpSharp) return;
    img.dataset.cpSharp = "1";
    var src = img.getAttribute("src");
    var next = sharper(src);
    if (next !== src) {
      // keep the small one if the big one won't load
      img.addEventListener("error", function back() { img.removeEventListener("error", back); img.setAttribute("src", src); });
      img.setAttribute("src", next);
    }
    if (img.getAttribute("srcset")) img.setAttribute("srcset", img.getAttribute("srcset").split(",").map(function (c) {
      var bits = c.trim().split(/\s+/);
      return [sharper(bits[0])].concat(bits.slice(1)).join(" ");
    }).join(", "));
  }
  Array.prototype.forEach.call(document.images, sharpen);
  new MutationObserver(function (list) {
    list.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.tagName === "IMG") sharpen(n);
        else if (n.querySelectorAll) Array.prototype.forEach.call(n.querySelectorAll("img"), sharpen);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });

  try { parent.postMessage({ type: "cp:ready", title: document.title, name: brand.name, icon: (document.querySelector("link[rel~='icon']") || document.querySelector("link[rel='apple-touch-icon']") || {}).href || null }, ORIGIN); } catch { /* top-level */ }
})();
