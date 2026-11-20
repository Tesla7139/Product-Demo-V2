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
      document.dispatchEvent(new Event("cp:shoppay-ready")); // for the story tour
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
    if (btn) { e.preventDefault(); e.stopPropagation(); if (isShopPay(btn)) shopPay(btn); else pay(btn); return; }
    // nothing else leaves the page: sign-in, policies, logo, "return to cart"
    if (t.closest("a[href]")) e.preventDefault();
  }, true);
  document.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.submitter || (e.target && e.target.querySelector && e.target.querySelector("button[type=submit]"));
    if (btn) pay(btn);
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

  /* ---------------------------- story tour ---------------------------- */
  // The viewer's story tour (src/components/storefront/StoryTour.tsx) plays the
  // checkout from the parent page: it asks where things are ("rect") and has
  // the page act ("shoppay", "pay"); each answer goes back as cp:story-event.
  function storyShopButton() {
    return document.querySelector("#shop-pay-button, a[href*='shop_pay']") ||
      Array.prototype.find.call(document.querySelectorAll("button, a, [role=button]"), function (b) {
        return isShopPay(b) && b.getBoundingClientRect().height > 0;
      }) || null;
  }
  var STORY_TARGETS = {
    express: function () { var b = storyShopButton(); return b && (b.closest("section, [aria-labelledby*=xpress i], [class*=xpress i]") || b.parentElement); },
    shoppay: storyShopButton,
    address: function () { return document.querySelector(".cp-sp-row"); },
    paynow: function () { return document.querySelector("[data-cp-sp-pay]"); },
  };
  // brought into view only when it isn't, and at once (the store's smooth
  // scrolling would leave it mid-way when measured)
  function storyRect(what) {
    var el = STORY_TARGETS[what] && STORY_TARGETS[what]();
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight - 140) {
      el.scrollIntoView({ block: "center", behavior: "instant" });
      r = el.getBoundingClientRect();
    }
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.type !== "cp:story") return;
    var id = e.data.id;
    var reply = function (extra) {
      try { parent.postMessage(Object.assign({ type: "cp:story-event", id: id }, extra || {}), ORIGIN); } catch { /* top-level */ }
    };
    if (e.data.do === "rect") reply({ rect: storyRect(e.data.what) });
    else if (e.data.do === "persona") {
      // the story's shopper ("Priya Sharma"), on Shop Pay here and on the thank-you page
      var p0 = e.data.persona || {};
      SHOPPER.name = p0.first + " " + p0.last;
      SHOPPER.email = p0.email || SHOPPER.email;
      write("cp-persona", p0);
      reply({ ok: true });
    } else if (e.data.do === "shoppay") {
      var b = storyShopButton();
      if (!b) { reply({ ok: false }); return; }
      document.addEventListener("cp:shoppay-ready", function once() {
        document.removeEventListener("cp:shoppay-ready", once);
        reply({ ok: true });
      });
      shopPay(b);
    } else if (e.data.do === "pay") {
      var p = document.querySelector("[data-cp-sp-pay]");
      if (p) shopPayPay(p);
      reply({ ok: !!p });
    }
  });

  try { parent.postMessage({ type: "cp:ready", title: document.title, name: brand.name, shopPay: !!storyShopButton() }, ORIGIN); } catch { /* top-level */ }
})();
