// SSOT for slug <-> internal route id mapping.
// Plain module (NO "use client") so both client components and the server
// sitemap.js can import it.
//
// Internal route ids (5-2, 5-3, ...) are IMMUTABLE (§4.1). This layer maps
// human-readable URL slugs to those ids bidirectionally without renaming ids.
//
// Legacy tool ids 5-7 & 5-15 are redirect-only aliases of the experiment tool
// (primary id 5-4). They share 5-4's slug and are NOT emitted in the sitemap.

export const SITE_URL = "https://growthopsplaybook-production.up.railway.app";

// component tag is documentation-only (the actual dispatch lives in the page).
export const ROUTES = [
  { id: "home", slug: "/", component: "LandingPage" },
  { id: "5-2", slug: "/dashboard", component: "Dashboard" },
  { id: "5-3", slug: "/tools/budget-allocation", component: "BudgetAllocation" },
  { id: "5-21", slug: "/tools/campaign-variance", component: "CampaignPvm" },
  { id: "5-22", slug: "/tools/campaign-saturation", component: "MarketingEfficiency" },
  { id: "5-6", slug: "/tools/creative-analysis", component: "CreativeAnalyzer" },
  { id: "5-4", slug: "/tools/experiment-analysis", component: "AbTestHoldout" },
  { id: "5-18", slug: "/tools/marketing-response", component: "MarketingResponse" },
  { id: "5-20", slug: "/tools/aha-moment", component: "AhaMomentFinder" },
  { id: "1-1", slug: "/guide/dev-collaboration", component: "SopContent" },
  { id: "1-2", slug: "/guide/event-taxonomy", component: "SopContent" },
  { id: "1-3", slug: "/guide/postback-integration", component: "SopContent" },
  { id: "1-4", slug: "/guide/ios-privacy-att-skan", component: "SopContent" },
  { id: "2-1", slug: "/guide/google-uac", component: "SopContent" },
  { id: "2-2", slug: "/guide/meta-advantage-plus", component: "SopContent" },
  { id: "2-3", slug: "/guide/apple-search-ads", component: "SopContent" },
  { id: "2-4", slug: "/guide/retargeting-reengagement", component: "SopContent" },
  { id: "3-1", slug: "/guide/aso-basics", component: "SopContent" },
  { id: "3-2", slug: "/guide/creative-specs", component: "SopContent" },
  { id: "3-3", slug: "/guide/hook-framework", component: "SopContent" },
  { id: "4-1", slug: "/guide/kpi-analysis", component: "SopContent" },
  { id: "4-2", slug: "/guide/cohort-retention", component: "SopContent" },
  { id: "4-3", slug: "/guide/cannibalization-analysis", component: "SopContent" },
  // ── Legacy id aliases (redirect-only; share 5-4's slug; excluded from sitemap) ──
  { id: "5-7", slug: "/tools/experiment-analysis", component: "AbTestHoldout", legacy: true },
  { id: "5-15", slug: "/tools/experiment-analysis", component: "AbTestHoldout", legacy: true },
];

// id -> slug (used by nav <Link> + router.push). Legacy ids resolve to the
// shared slug, which is fine for forward navigation.
export const idToSlug = Object.fromEntries(ROUTES.map((r) => [r.id, r.slug]));

// slug path (no leading slash) -> id. Built from PRIMARY entries only so a
// slug always resolves back to its canonical/primary id (5-4, never 5-7/5-15).
// "" (root) -> "home", "dashboard" -> "5-2", "tools/budget-allocation" -> "5-3".
export const slugToId = Object.fromEntries(
  ROUTES.filter((r) => !r.legacy).map((r) => [
    r.slug === "/" ? "" : r.slug.replace(/^\//, ""),
    r.id,
  ])
);

// slugArr (from optional catch-all params.slug) -> id, or null for unknown URLs.
export function resolveSlugToId(slugArr) {
  const key = (slugArr || []).join("/");
  return slugToId[key] ?? null;
}

// id -> path string (falls back to home).
export function idToPath(id) {
  return idToSlug[id] || "/";
}
