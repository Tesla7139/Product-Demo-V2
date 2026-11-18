import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // allow the LAN IP to load dev/HMR resources (testing on a phone)
  allowedDevOrigins: ["192.168.29.248"],
  // headless Chrome for capturing stores' real checkouts (lib/clone/checkoutSnapshot):
  // native binaries, loaded with plain require rather than bundled
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
};

export default nextConfig;
