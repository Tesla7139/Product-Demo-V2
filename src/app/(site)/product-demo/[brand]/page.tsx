import { Hero } from "@/components/sections/Hero";
import { CustomerLogos } from "@/components/sections/CustomerLogos";

// /product-demo/<brand> — same layout as the home page (hero reads the brand from
// the path on mount and auto-opens that store's demo; see Hero.tsx). Mirrors the
// home page so the brand strip is present whether the URL is "/" or "/product-demo/…"
// (closing the demo only rewrites the URL, it doesn't re-navigate).
export default function ProductDemoPage() {
  return (
    <>
      <Hero />
      <div className="relative z-10 border-t border-border/60" style={{ background: "#ffffff" }}>
        <CustomerLogos />
      </div>
    </>
  );
}
