import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Technical endpoints and sign-in pages. Client links (/p/, /portal/, /book/) are NOT blocked here on purpose: they
        // carry a noindex tag, and a crawler can only obey a noindex it is allowed to read.
        disallow: ["/api/", "/invite/", "/login", "/auth/", "/welcome", "/offline", "/demo", "/styleguide"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
