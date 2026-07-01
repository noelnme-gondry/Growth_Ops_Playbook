// @vitest-environment jsdom
//
// Render-smoke for LtvTab (5-2 운영 대시보드, LTV 탭). Regression net for the
// CampaignPvm-class crashes: a route/tab component that throws during render or
// a mount effect (chart build). Golden tests cover the pure math (ltvMath);
// this asserts the tab MOUNTS without throwing in both no-data and with-data
// states. Copied from the BudgetAllocation smoke pattern.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import LtvTab from "@/components/dashboard/LtvTab";

// Empty efficiency slice = "no data yet" state.
const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// Minimal VALID efficiency CSV for the LTV tab: channel + cost + installs (CAC
// denominator) + revenue_dN so buildLtvData produces LTV/ROAS curves. rows
// passed into buildLtvData are ALREADY standard-keyed (getMappedRows output);
// buildLtvData reads `revenue_dN`/unitField directly off rows, not via
// mapping[...] lookup (mapping is only { origHeader: standardKey }, used here
// just to mark which standard keys are "mapped" at all).
function seedWithData() {
  const headers = ["date", "country", "platform", "channel", "cost", "installs", "revenue_d7", "revenue_d14", "revenue_d30"];
  const mapping = {
    date: "date",
    country: "country",
    platform: "platform",
    channel: "channel",
    cost: "cost",
    installs: "installs",
    revenue_d7: "revenue_d7",
    revenue_d14: "revenue_d14",
    revenue_d30: "revenue_d30",
  };
  const raw = [];
  for (let d = 1; d <= 10; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of ["Google", "Meta"]) {
      // deterministic — NO Math.random (harness §8)
      const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
      const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
      raw.push({
        date,
        country: "KR",
        platform: "iOS",
        channel: ch,
        cost,
        installs,
        revenue_d7: Math.round(cost * 0.4),
        revenue_d14: Math.round(cost * 0.7),
        revenue_d30: Math.round(cost * 1.1),
      });
    }
  }
  const slice = { raw, headers, mapping, fileName: "ltv.csv" };
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice },
    csvData: slice,
  });
}

describe("LtvTab render smoke", () => {
  beforeEach(() => {
    seedNoData();
  });

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<LtvTab />)).not.toThrow();
    // No-data pane renders its placeholder.
    expect(document.body.textContent).toContain("데이터 없음");
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    let container;
    expect(() => {
      ({ container } = render(<LtvTab />));
    }).not.toThrow();
    // Key node: the LTV curve canvas is present in the with-data render.
    expect(container.querySelector("#ltvcac-curve")).toBeTruthy();
  });
});
