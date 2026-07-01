// @vitest-environment jsdom
//
// Render-smoke for SegmentTab (5-2 운영 대시보드, 세그먼트 매트릭스 탭). Regression
// net for render throws (matrix build + heatmap coloring). Golden tests cover
// segmentMath; this asserts the tab MOUNTS without throwing in no-data and
// with-data states. Copied from the BudgetAllocation smoke pattern.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import SegmentTab from "@/components/dashboard/SegmentTab";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// Minimal VALID CSV for the segment matrix: two grouping axes (channel × country)
// + cost/installs so the default CPI metric has values. >1 distinct value per
// axis so the grid is non-trivial. Header names match standard keys.
// mapping = { origHeader: standardKey }.
function seedWithData() {
  const headers = ["date", "country", "platform", "channel", "cost", "installs", "actions", "clicks", "impressions", "revenue_d7"];
  const mapping = {
    date: "date",
    country: "country",
    platform: "platform",
    channel: "channel",
    cost: "cost",
    installs: "installs",
    actions: "actions",
    clicks: "clicks",
    impressions: "impressions",
    revenue_d7: "revenue_d7",
  };
  const raw = [];
  for (let d = 1; d <= 10; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of ["Google", "Meta"]) {
      for (const cc of ["KR", "US"]) {
        // deterministic — NO Math.random (harness §8)
        const cost = (ch === "Google" ? 100000 : 80000) + d * 2500 + (cc === "US" ? 5000 : 0);
        const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
        const clicks = installs * 4;
        const impressions = clicks * 50;
        raw.push({
          date,
          country: cc,
          platform: "iOS",
          channel: ch,
          cost,
          installs,
          actions: Math.round(installs * 0.6),
          clicks,
          impressions,
          revenue_d7: Math.round(cost * 0.4),
        });
      }
    }
  }
  const slice = { raw, headers, mapping, fileName: "segment.csv" };
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice },
    csvData: slice,
  });
}

describe("SegmentTab render smoke", () => {
  beforeEach(() => {
    seedNoData();
  });

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<SegmentTab />)).not.toThrow();
    // No-data pane shows the placeholder.
    expect(document.body.textContent).toContain("데이터 없음");
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    let container;
    expect(() => {
      ({ container } = render(<SegmentTab />));
    }).not.toThrow();
    // Key node: the matrix section renders its title.
    expect(container.querySelector("#s-matrix")).toBeTruthy();
  });
});
