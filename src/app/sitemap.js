import { ROUTES, SITE_URL } from "@/lib/routeMap";

const BASE = SITE_URL; // matches layout.js canonical/openGraph

// Next 16 auto-serves this at /sitemap.xml. URLs derive from the routeMap SSOT
// so there is no drift when tools/SOP change. Emit PRIMARY routes only —
// dedupe by slug so legacy 5-7/5-15 (dup of /tools/experiment-analysis) appear once.
export default function sitemap() {
  const seen = new Set();
  return ROUTES.filter((r) => !seen.has(r.slug) && seen.add(r.slug)).map((r) => ({
    url: BASE + (r.slug === "/" ? "" : r.slug),
    lastModified: new Date(),
    changeFrequency:
      r.slug === "/"
        ? "weekly"
        : r.slug.startsWith("/guide/")
        ? "monthly"
        : "weekly",
    priority:
      r.slug === "/"
        ? 1
        : r.slug.startsWith("/tools/") || r.slug === "/dashboard"
        ? 0.8
        : 0.6,
  }));
}
