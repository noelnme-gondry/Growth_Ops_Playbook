// @vitest-environment jsdom
//
// Render-smoke for FunnelTab (5-2 운영 대시보드, 퍼널 탭). Regression net for
// render/mount-effect throws (CVR trend chart). Golden tests cover FUNNEL_MATH;
// this asserts the tab MOUNTS without throwing in no-data and with-data states.
// Copied from the BudgetAllocation smoke pattern.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import FunnelTab from "@/components/dashboard/FunnelTab";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// Minimal VALID funnel CSV: needs >=2 mapped funnel stages
// (impressions/clicks/installs/actions) or FunnelTab short-circuits to no-data.
// Seed all four so every stage + CVR step renders. Header names match standard
// keys. mapping = { origHeader: standardKey }.
function seedWithData() {
  const headers = ["date", "country", "platform", "channel", "cost", "impressions", "clicks", "installs", "actions"];
  const mapping = {
    date: "date",
    country: "country",
    platform: "platform",
    channel: "channel",
    cost: "cost",
    impressions: "impressions",
    clicks: "clicks",
    installs: "installs",
    actions: "actions",
  };
  const raw = [];
  for (let d = 1; d <= 10; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of ["Google", "Meta"]) {
      // deterministic funnel — NO Math.random (harness §8)
      const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
      const impressions = cost * 10;
      const clicks = Math.round(impressions * 0.02);
      const installs = Math.round(clicks * 0.3);
      const actions = Math.round(installs * 0.5);
      raw.push({ date, country: "KR", platform: "iOS", channel: ch, cost, impressions, clicks, installs, actions });
    }
  }
  const slice = { raw, headers, mapping, fileName: "funnel.csv" };
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice },
    csvData: slice,
  });
}

describe("FunnelTab render smoke", () => {
  beforeEach(() => {
    seedNoData();
  });

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<FunnelTab />)).not.toThrow();
    // No-data pane shows the placeholder.
    expect(document.body.textContent).toContain("데이터 없음");
  });

  it("mounts without throwing with a valid seeded funnel CSV", () => {
    seedWithData();
    let container;
    expect(() => {
      ({ container } = render(<FunnelTab />));
    }).not.toThrow();
    // Key node: the CVR trend chart canvas.
    expect(container.querySelector("#funnel-trend-chart")).toBeTruthy();
  });

  // Regression for the "rising trend flagged as 급락" report: the low-day
  // chip label must describe "average 대비", not "급락" (day-over-day crash),
  // since the flag is a period-mean threshold and can co-occur with a day
  // that's rising vs the previous day.
  it("labels below-average days as 'vs average', not '급락', and shows 전일比 direction", () => {
    const headers = ["date", "impressions", "clicks", "installs", "actions"];
    const mapping = {
      date: "date",
      impressions: "impressions",
      clicks: "clicks",
      installs: "installs",
      actions: "actions",
    };
    const raw = [];
    const start = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const clicks = 10000;
      const cvr = 0.02 + i * 0.0015; // strictly rising every day, no noise
      const installs = Math.round(clicks * cvr);
      raw.push({
        date,
        impressions: 100000,
        clicks,
        installs,
        actions: Math.round(installs * 0.3),
      });
    }
    const slice = { raw, headers, mapping, fileName: "rising.csv" };
    useAppStore.setState({
      currentRouteId: "5-2",
      csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice },
      csvData: slice,
    });

    const { container } = render(<FunnelTab />);
    const text = container.textContent;
    // Corrected wording present.
    expect(text).toContain("평균보다 유독 낮았던 날");
    // Old misleading "급락" label must be gone from the low-day callout.
    expect(text).not.toContain("급락한 날");
    // At least one flagged day should carry the "rising vs previous day"
    // indicator (↑전일比), proving the disambiguation renders.
    expect(text).toContain("↑전일比");
  });
});
