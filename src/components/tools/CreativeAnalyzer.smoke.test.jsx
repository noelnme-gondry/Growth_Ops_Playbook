// @vitest-environment jsdom
//
// Render-smoke for CreativeAnalyzer (5-6). Regression net for render/mount-effect
// crashes. Golden tests cover CREATIVE_STATS / CREATIVE_FATIGUE; this asserts the
// component MOUNTS without throwing in the no-data and with-data states,
// including the fatigue + forest-plot chart effects and the WLS decompose path
// (needs creative attributes + >=30 clean rows).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import CreativeAnalyzer from "@/components/tools/CreativeAnalyzer";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-6",
    csvGroups: { ...useAppStore.getState().csvGroups, creative: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// A minimal VALID creative CSV: creative_id + date + impressions + clicks (the
// deriveMetrics/fatigue inputs), plus installs (CVR) and two attribute columns
// (hook_type, format) with >=30 clean rows so the WLS decompose branch runs.
// mapping = { origHeader: standardKey }.
function seedWithData() {
  const headers = ["Date", "Channel", "CreativeID", "Hook", "Format", "Impr", "Clicks", "Installs"];
  const mapping = {
    Date: "date",
    Channel: "channel",
    CreativeID: "creative_id",
    Hook: "hook_type",
    Format: "format",
    Impr: "impressions",
    Clicks: "clicks",
    Installs: "installs",
  };
  const raw = [];
  const creatives = [
    { id: "cr_A", hook: "question", format: "video" },
    { id: "cr_B", hook: "stat", format: "static" },
    { id: "cr_C", hook: "question", format: "static" },
    { id: "cr_D", hook: "stat", format: "video" },
  ];
  // 10 days × 4 creatives = 40 rows. Deterministic decaying CTR (§8, no Math.random)
  // so at least one creative registers fatigue and the decompose has signal.
  for (let d = 1; d <= 10; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    creatives.forEach((c, ci) => {
      const impressions = 5000 + ci * 400 + d * 50;
      // CTR decays over time (fatigue) + varies by creative attributes.
      const baseCtr = 0.05 + ci * 0.004;
      const ctr = Math.max(0.005, baseCtr - d * 0.002);
      const clicks = Math.round(impressions * ctr);
      const installs = Math.round(clicks * (0.2 + ci * 0.01));
      raw.push({
        Date: date,
        Channel: ci % 2 === 0 ? "Google" : "Meta",
        CreativeID: c.id,
        Hook: c.hook,
        Format: c.format,
        Impr: impressions,
        Clicks: clicks,
        Installs: installs,
      });
    });
  }
  const slice = { raw, headers, mapping, fileName: "creative.csv" };
  useAppStore.setState({
    currentRouteId: "5-6",
    csvGroups: { ...useAppStore.getState().csvGroups, creative: slice },
    csvData: slice,
  });
}

// Full CSV incl. spend + actions + revenue_d7 so the CPA/ROAS decompose branches
// (metric='cpa': _metricVal=spend/actions,_w=actions; 'roas': rev/spend,_w=spend)
// are computed and their toggles enabled — lets us exercise the CPA/ROAS render
// paths (decomposeMetricMeta 원/배 fmtVal + sign-reversed color) via click.
function seedWithCpaRoasData() {
  const headers = [
    "Date", "Channel", "CreativeID", "Hook", "Format",
    "Impr", "Clicks", "Installs", "Actions", "Spend", "RevD7",
  ];
  const mapping = {
    Date: "date",
    Channel: "channel",
    CreativeID: "creative_id",
    Hook: "hook_type",
    Format: "format",
    Impr: "impressions",
    Clicks: "clicks",
    Installs: "installs",
    Actions: "actions",
    Spend: "spend",
    RevD7: "revenue_d7",
  };
  const raw = [];
  const creatives = [
    { id: "cr_A", hook: "question", format: "video" },
    { id: "cr_B", hook: "stat", format: "static" },
    { id: "cr_C", hook: "question", format: "static" },
    { id: "cr_D", hook: "stat", format: "video" },
  ];
  for (let d = 1; d <= 10; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    creatives.forEach((c, ci) => {
      const impressions = 5000 + ci * 400 + d * 50;
      const clicks = Math.round(impressions * 0.05);
      const installs = Math.round(clicks * 0.25);
      const isVideo = c.format === "video";
      const spend = 1000 + ci * 100 + d * 20;
      const actions = isVideo ? 20 + ci : 40 + ci; // video CPA↑
      raw.push({
        Date: date,
        Channel: ci % 2 === 0 ? "Google" : "Meta",
        CreativeID: c.id,
        Hook: c.hook,
        Format: c.format,
        Impr: impressions,
        Clicks: clicks,
        Installs: installs,
        Actions: actions,
        Spend: spend,
        RevD7: isVideo ? spend * 3 : spend * 1.5, // video ROAS↑
      });
    });
  }
  const slice = { raw, headers, mapping, fileName: "creative.csv" };
  useAppStore.setState({
    currentRouteId: "5-6",
    csvGroups: { ...useAppStore.getState().csvGroups, creative: slice },
    csvData: slice,
  });
}

describe("CreativeAnalyzer render smoke", () => {
  beforeEach(() => seedNoData());

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<CreativeAnalyzer />)).not.toThrow();
    // No-data branch shows the uploader-prep block.
    expect(screen.getByText("데이터 준비")).toBeTruthy();
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    expect(() => render(<CreativeAnalyzer />)).not.toThrow();
    // With-data branch renders the §3 per-creative metrics table heading
    // (faithful to index.html: "소재별 성과표").
    expect(screen.getByText(/소재별 성과표/)).toBeTruthy();
    // Ported sections mount: §2 운영 건강도, §7 교체 일정 추천, §9 다음 테스트 추천.
    // (some phrases repeat across headings + callouts → getAllByText)
    expect(screen.getByText(/운영 건강도/)).toBeTruthy();
    expect(screen.getAllByText(/교체 일정 추천/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/다음 테스트 추천/).length).toBeGreaterThan(0);
    // §8 Concept Matrix section is present (matrix falls back to "생성 불가"
    // here since message_angle isn't in the seed mapping — honest empty state).
    expect(screen.getAllByText(/조합별 성과표/).length).toBeGreaterThan(0);
  });

  it("exercises CPA/ROAS decompose render paths without throwing (toggle click)", () => {
    seedWithCpaRoasData();
    let container;
    expect(() => {
      ({ container } = render(<CreativeAnalyzer />));
    }).not.toThrow();
    // CPA/ROAS toggle buttons should be enabled (inputs mapped + decompose computed).
    const btns = [...container.querySelectorAll("button.ab-pill")];
    const cpaBtn = btns.find((b) => b.textContent.trim() === "CPA");
    const roasBtn = btns.find((b) => b.textContent.trim() === "ROAS");
    expect(cpaBtn && !cpaBtn.disabled).toBe(true);
    expect(roasBtn && !roasBtn.disabled).toBe(true);
    // Clicking CPA re-renders §4 with 원-unit fmtVal + reversed-sign color path.
    expect(() => fireEvent.click(cpaBtn)).not.toThrow();
    expect(() => fireEvent.click(roasBtn)).not.toThrow();
  });
});
