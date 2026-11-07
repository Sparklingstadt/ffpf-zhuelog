import type { MetadataRoute } from "next";
import { siteUrl } from "@/infrastructure/config/environment";

// Pages behind the sign-in are not hidden by robots.txt (the proxy's gate
// does that); crawlers simply get sent to /signin. Only the API is kept
// out, so a crawler never spends requests on 401s. Keeping `/` allowed
// matters for X and other card fetchers, which honour robots.txt.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${base}/sitemap.xml`,
  };
}
