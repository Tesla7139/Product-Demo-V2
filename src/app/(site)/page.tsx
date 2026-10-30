import { Hero } from "@/components/sections/Hero";
import { CustomerLogos } from "@/components/sections/CustomerLogos";

export default function Home() {
  return (
    <>
      {/* page 1 — fills the viewport */}
      <Hero />
      {/* page 2 — brand strip (scroll down) */}
      <div className="relative z-10 border-t border-border/60" style={{ background: "#ffffff" }}>
        <CustomerLogos />
      </div>
    </>
  );
}
