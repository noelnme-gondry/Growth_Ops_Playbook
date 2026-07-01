// @vitest-environment jsdom
//
// Render-smoke for VizTab (5-2 운영 대시보드 · 시각화 탭). Golden tests
// (src/utils/*.test.js) cover the pure aggregation math; this asserts the tab
// MOUNTS + runs its Chart effect without throwing in the no-data and with-data
// states. Mocks (chart.js/auto, next/navigation) + ResizeObserver/matchMedia/
// canvas live in vitest.smoke.setup.js (auto-loaded by the smoke project).
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import VizTab from "@/components/dashboard/VizTab";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

// Minimal VALID efficiency CSV for the dashboard: date/country/platform/channel
// dims + the metric columns the viz charts read (cost/installs/clicks/impressions
// + cohort revenue). mapping = { originalHeader: standardKey } (getMappedRows).
function seedWithData() {
  const headers = ["Date", "Country", "Platform", "Channel", "Spend", "Installs", "Clicks", "Impr", "RevD7"];
  const mapping = {
    Date: "date", Country: "country", Platform: "platform", Channel: "channel",
    Spend: "cost", Installs: "installs", Clicks: "clicks", Impr: "impressions", RevD7: "revenue_d7",
  };
  const raw = [];
  for (let d = 1; d <= 10; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of ["Google", "Meta"]) {
      // deterministic — NO Math.random (harness §8)
      const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
      const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
      raw.push({
        Date: date, Country: "KR", Platform: "iOS", Channel: ch,
        Spend: cost, Installs: installs, Clicks: installs * 8, Impr: installs * 120, RevD7: installs * 900,
      });
    }
  }
  const slice = { raw, headers, mapping, fileName: "viz.csv" };
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

describe("VizTab render smoke", () => {
  beforeEach(() => seedNoData());

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<VizTab />)).not.toThrow();
    // Sanity: the tab shell rendered.
    expect(document.getElementById("tab-viz")).toBeTruthy();
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    expect(() => render(<VizTab />)).not.toThrow();
    expect(document.getElementById("tab-viz")).toBeTruthy();
  });

  // #11 이벤트 마커 — store.eventMarkers 시딩이 시계열 차트(makeEventMarkerPlugin)
  // 재생성 경로를 죽이지 않는지(destroy+recreate+draw 전부 무해) 확인.
  it("mounts without throwing when an event marker is seeded", () => {
    seedWithData();
    useAppStore.setState({
      eventMarkers: [{ id: "m1", date: "2026-01-05", label: "테스트 마커" }],
    });
    expect(() => render(<VizTab />)).not.toThrow();
    expect(document.getElementById("tab-viz")).toBeTruthy();
  });
});
