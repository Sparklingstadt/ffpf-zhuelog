import type { MetadataRoute } from "next";
import { siteUrl } from "@/infrastructure/config/environment";

// Only the pages a crawler can read. Everything else redirects to /signin,
// and a sitemap entry that redirects is reported as an error.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    {
      url: `${base}/signin`,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
