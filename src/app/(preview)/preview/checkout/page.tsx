import type { Metadata } from "next";
import { CheckoutFlow } from "@/components/storefront/CheckoutFlow";

export const metadata: Metadata = { title: { absolute: "Checkout" }, robots: { index: false, follow: false } };

// Checkout → upsell → thank-you, reached from the storefront copy's cart.
export default function PreviewCheckoutPage() {
  return <CheckoutFlow />;
}
