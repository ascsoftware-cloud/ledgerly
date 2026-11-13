import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Signed-in screens, client links and technical endpoints are never for search engines.
        disallow: ["/api/", "/portal/", "/p/", "/invite/", "/book/", "/login", "/auth/", "/welcome", "/offline", "/demo", "/styleguide"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
