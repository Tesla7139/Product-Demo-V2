"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Star, ArrowLeft } from "lucide-react";
import { Container } from "@/components/primitives/Container";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { reviews, type Review } from "@/lib/reviews";
import { customerLogos, brandInfo } from "@/lib/site";
import { Button } from "@/components/ui/button";

// Brands featured in the home brand strip — the popular ones. Their reviews are
// pushed to the very top of the wall.
const STRIP_BRANDS = new Set(customerLogos.map((c) => c.name.toLowerCase().trim()));

const INITIAL_COUNT = 12;
const INCREMENT_COUNT = 12;
const MAX_REVIEWS_COUNT = 52;

// ---- Review ranking --------------------------------------------------------
// Rank by (1) store size / notability, (2) quantified impact, (3) detail.
// Then a diversity pass surfaces a review for each *different reason* the app
// helped, so the top rows aren't all the same story.

// Notable / larger brands in the export (bumped to the top tier).
const BIG_STORES = new Set([
  "V-Guard Industries Limited",
  "Mars By GHC",
  "MyBorosil",
  "Westside",
  "Westside Global",
  "Samoh by TATA",
  "Samoh International",
  "Starquik",
  "Bacca Bucci",
  "Wellbeing Nutrition",
  "Doonails",
  "Renue By Science",
  "World of Asaya",
  "HoneyVeda",
  "GHAR SOAPS",
  "Paradyes",
]);

// Does the review cite a measurable / quantified outcome?
function isQuantified(text: string) {
  return (
    /\b\d+\s*(%|percent|hours?|hrs?|tickets?|orders?|days?|weeks?|months?|x)\b/i.test(text) ||
    /\$\s?\d/.test(text) ||
    /\b(reduc|cut|sav(e|ed|ing)|fewer|drastically|increas|boost|extra revenue|less\s|streamlin)/i.test(
      text
    )
  );
}

// Which "reason it helped" does this review primarily speak to?
function reasonOf(text: string) {
  const t = text.toLowerCase();
  if (/(ticket|support inbox|queries|customer service|cs team|support request)/.test(t))
    return "tickets";
  if (/(upsell|aov|average order|revenue|cross[- ]?sell|incremental)/.test(t)) return "revenue";
  if (/address/.test(t)) return "address";
  if (/(cancel|refund)/.test(t)) return "cancellations";
  if (/(time|hours|manual|streamlin|efficien)/.test(t)) return "time";
  if (/(support team|helpful|responsive|onboard|set ?up|easy|integrat|smooth|quick to)/.test(t))
    return "support";
  if (/(customer experience|customers love|flexibilit|self[- ]?serv|post[- ]?purchase|empower)/.test(t))
    return "experience";
  return "general";
}

function scoreReview(r: Review) {
  let s = 0;
  if (BIG_STORES.has(r.name)) s += 100;
  if (isQuantified(r.content)) s += 40;
  s += Math.min(r.content.length, 320) / 30; // reward a bit of detail
  return s;
}

const rankedReviews: Review[] = (() => {
  const sorted = [...reviews].sort((a, b) => scoreReview(b) - scoreReview(a));
  // Diversity pass: pull the best review for each distinct reason to the front.
  const seen = new Set<string>();
  const top: Review[] = [];
  const rest: Review[] = [];
  for (const r of sorted) {
    const reason = reasonOf(r.content);
    if (!seen.has(reason)) {
      seen.add(reason);
      top.push(r);
    } else {
      rest.push(r);
    }
  }
  const ordered = [...top, ...rest];
  // Push the brand-strip (popular) brands to the very top, keeping their
  // relative order; everything else follows.
  const strip = ordered.filter((r) => STRIP_BRANDS.has(r.name.toLowerCase().trim()));
  const others = ordered.filter((r) => !STRIP_BRANDS.has(r.name.toLowerCase().trim()));
  const byStrip = [...strip, ...others];
  // Finally, surface reviews that carry a country tag (brandInfo.country) to the
  // very top — keeping their existing relative order.
  const withCountry = byStrip.filter((r) => !!brandInfo[r.name]?.country);
  const withoutCountry = byStrip.filter((r) => !brandInfo[r.name]?.country);
  return [...withCountry, ...withoutCountry];
})();

const displayedReviews: Review[] = rankedReviews.slice(0, MAX_REVIEWS_COUNT);

// How many top rows stay pinned in ranked order (the popular brand-strip names).
const PINNED_ROWS = 3;
const GAP = 24; // matches the flex `gap-6` between cards

export default function ReviewsPage() {
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);
  const [cols, setCols] = useState(3);
  // Real, measured card heights (id -> px). Estimate is only a first-paint fallback.
  const [heights, setHeights] = useState<Record<string, number>>({});
  const cardEls = useRef<Map<string, HTMLDivElement>>(new Map());

  const visible = displayedReviews.slice(0, visibleCount);

  // responsive column count
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setCols(w < 640 ? 1 : w < 1024 ? 2 : 3);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  // After render, measure the real height of every card so balancing is accurate
  // (the content-length estimate misjudged some cards, leaving ragged columns).
  // Card width only depends on `cols`, so heights are valid across arrangements.
  useLayoutEffect(() => {
    setHeights((prev) => {
      let changed = false;
      const next = { ...prev };
      cardEls.current.forEach((el, id) => {
        const h = el.offsetHeight;
        if (h && next[id] !== h) {
          next[id] = h;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [visible, cols]);

  // Masonry layout:
  //  1. keep the top PINNED_ROWS in ranked order, row-major (popular brands on top);
  //  2. balance everything below with a tallest-first fill into the shortest column
  //     (LPT scheduling), using MEASURED heights so columns end nearly even.
  const columns = useMemo(() => {
    const buckets = Array.from({ length: cols }, () => ({ items: [] as Review[], h: 0 }));
    const h = (r: Review) => heights[r.id] ?? 150 + Math.ceil(r.content.length / 38) * 26;
    const place = (r: Review, b: (typeof buckets)[number]) => {
      b.items.push(r);
      b.h += h(r) + GAP;
    };

    const pinned = Math.min(PINNED_ROWS * cols, visible.length);
    // 1) pinned top rows — one card per column per row, in ranked order
    for (let i = 0; i < pinned; i++) place(visible[i], buckets[i % cols]);
    // 2) remainder — tallest first, always into the currently-shortest column
    const rest = visible.slice(pinned).sort((a, b) => h(b) - h(a));
    for (const r of rest) {
      const shortest = buckets.reduce((a, b) => (b.h < a.h ? b : a));
      place(r, shortest);
    }
    return buckets.map((b) => b.items);
  }, [visible, cols, heights]);

  const handleShowMore = () => {
    setVisibleCount((prev) => Math.min(prev + INCREMENT_COUNT, displayedReviews.length));
  };

  const hasMore = visibleCount < displayedReviews.length;

  return (
    <div className="bg-[#FAF9F6] text-black min-h-screen pt-2 pb-16">
      {/* 1. Header Section */}
      <section className="relative overflow-hidden pb-2 pt-6 md:pt-8">
        <Container>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-black/60 transition-colors hover:text-black"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>
          <div className="mx-auto max-w-3xl text-center">
            <h1
              className="font-serif font-normal tracking-tight text-black"
              style={{ fontSize: "clamp(2.25rem,5vw,3.25rem)", lineHeight: 1.05 }}
            >
              Trusted by Shopify Merchants
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-base md:text-lg text-black/70 leading-relaxed font-medium">
              See what real store owners are saying about using Clickpost Order Editing to
              streamline their post-purchase experience. 52 reviews from the
              Shopify App Store.
            </p>

            {/* Star Rating Badge */}
            <div className="mt-7 flex items-center justify-center gap-2.5">
              <div className="flex items-center gap-1 text-yellow-500">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-6 fill-current stroke-current" />
                ))}
              </div>
              <span className="text-base md:text-lg font-bold text-black/80">
                5.0 on Shopify App Store
              </span>
            </div>
          </div>
        </Container>
      </section>

      {/* 2. Wall of Love Section */}
      <section className="mt-10 md:mt-16 pt-10 md:pt-14 pb-6 border-t border-black/5">
        <Container>
          {/* Section Subheading */}
          <div className="mb-4">
            <h2
              className="font-sans font-extrabold tracking-tight text-black"
              style={{ fontSize: "clamp(2.25rem,5vw,3.25rem)", lineHeight: 1.05 }}
            >
              Customer Reviews
            </h2>
            <p className="mt-2 text-sm text-black/50 font-medium">
              52 five-star merchant reviews — synced from our public App Store listing.
            </p>
          </div>

          {/* Balanced masonry: each card placed in the shortest column, no big gaps */}
          <div className="flex items-start gap-6">
            {columns.map((col, i) => (
              <div key={i} className="flex flex-1 flex-col gap-6">
                {col.map((review) => (
                  <div
                    key={review.id}
                    ref={(el) => {
                      if (el) cardEls.current.set(review.id, el);
                      else cardEls.current.delete(review.id);
                    }}
                  >
                    <ReviewCard review={review} />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Load More Button */}
          {hasMore && (
            <div className="mt-16 flex justify-center">
              <Button
                onClick={handleShowMore}
                size="lg"
                className="rounded-full bg-black text-white hover:bg-black/90 px-8 py-6 text-sm font-semibold shadow-md active:scale-95 transition-all cursor-pointer"
              >
                Show more reviews
              </Button>
            </div>
          )}
        </Container>
      </section>
    </div>
  );
}
