import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { DOC_PAGES } from "@/lib/docs-nav";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages = ["", "/demo", "/cloud", "/privacy", "/docs", ...DOC_PAGES.map((d) => `/docs/${d.slug}`)];
  return pages.map((p) => ({ url: `${SITE_URL}${p}`, lastModified: now, changeFrequency: "weekly", priority: p === "" ? 1 : 0.7 }));
}
