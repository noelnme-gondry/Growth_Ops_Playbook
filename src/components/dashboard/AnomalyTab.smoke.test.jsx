// @vitest-environment jsdom
//
// Render-smoke for AnomalyTab (5-2 운영 대시보드 · 이상 감지 탭). No-data (and
// data with no mappable metric) returns the "데이터 없음" pane; with-data runs
// the golden ANOMALY_MATH detector and renders a flagged time-series chart.
// Mounts cover render + the chart effect; mocks live in vitest.smoke.setup.js.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import AnomalyTab from "@/components/dashboard/AnomalyTab";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

// metricOpts gate on mapped keys (cost/installs/actions/clicks/impressions/
// revenue_d7); seed all so every metric branch is selectable and the detector
// has enough points (>win=14) to flag. An injected spike exercises the flag
// path deterministically. mapping = { originalHeader: standardKey }.
function seedWithData() {
  const headers = ["Date", "Country", "Platform", "Channel", "Spend", "Installs", "Actions", "Clicks", "Impr", "RevD7"];
  const mapping = {
    Date: "date", Country: "country", Platform: "platform", Channel: "channel",
    Spend: "cost", Installs: "installs", Actions: "actions", Clicks: "clicks", Impr: "impressions", RevD7: "revenue_d7",
  };
  const raw = [];
  for (let d = 1; d <= 25; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of ["Google", "Meta"]) {
      // deterministic — NO Math.random (harness §8). Day 22 = injected spike.
      const spike = d === 22 ? 5 : 1;
      const cost = (ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500) * spike;
      const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
      raw.push({
        Date: date, Country: "KR", Platform: "iOS", Channel: ch,
        Spend: cost, Installs: installs, Actions: Math.round(installs * 0.3),
        Clicks: installs * 8, Impr: installs * 120, RevD7: installs * 900,
      });
    }
  }
  const slice = { raw, headers, mapping, fileName: "anomaly.csv" };
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice },
    csvData: slice,
  });
}

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

describe("AnomalyTab render smoke", () => {
  beforeEach(() => seedNoData());

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<AnomalyTab />)).not.toThrow();
    expect(document.getElementById("tab-anomaly")).toBeTruthy();
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    expect(() => render(<AnomalyTab />)).not.toThrow();
    // With mappable metrics, the anomaly chart canvas is present.
    expect(document.getElementById("anomaly-chart")).toBeTruthy();
  });
});
