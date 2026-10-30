import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // store copies and the preview checkout are per-visitor, never index them
    rules: { userAgent: "*", allow: "/", disallow: ["/clone/", "/preview/"] },
    sitemap: "https://clickpost.ai/sitemap.xml",
  };
}
