import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // allow the LAN IP to load dev/HMR resources (testing on a phone)
  allowedDevOrigins: ["192.168.29.248"],
  // headless Chrome for capturing stores' real checkouts (lib/clone/checkoutSnapshot):
  // native binaries, loaded with plain require rather than bundled
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // the compressed Chromium binary is read from disk at runtime, which file
  // tracing can't see: ship it with the routes that launch the browser
  outputFileTracingIncludes: {
    "/preview/store-checkout": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/clone-start": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
