// @vitest-environment jsdom
//
// Render-smoke for PacingTab (5-2 운영 대시보드 · 페이싱 탭). No-data returns
// the "데이터 부족" pane; with-data feeds the golden PACING_MATH engine and
// renders a cumulative MTD chart. Mounts cover render + the chart effect; mocks
// live in vitest.smoke.setup.js.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import PacingTab from "@/components/dashboard/PacingTab";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

// Pacing reads cost/installs/actions per date; the metric pills gate on those
// mapped keys, so seed all three. Dates land in a single month so MTD pacing
// has data. mapping = { originalHeader: standardKey } (getMappedRows).
function seedWithData() {
  const headers = ["Date", "Country", "Platform", "Channel", "Spend", "Installs", "Actions"];
  const mapping = {
    Date: "date", Country: "country", Platform: "platform", Channel: "channel",
    Spend: "cost", Installs: "installs", Actions: "actions",
  };
  const raw = [];
  for (let d = 1; d <= 20; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of ["Google", "Meta"]) {
      // deterministic — NO Math.random (harness §8)
      const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
      const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
      raw.push({
        Date: date, Country: "KR", Platform: "iOS", Channel: ch,
        Spend: cost, Installs: installs, Actions: Math.round(installs * 0.3),
      });
    }
  }
  const slice = { raw, headers, mapping, fileName: "pacing.csv" };
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

describe("PacingTab render smoke", () => {
  beforeEach(() => seedNoData());

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<PacingTab />)).not.toThrow();
    expect(document.getElementById("tab-pacing")).toBeTruthy();
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    expect(() => render(<PacingTab />)).not.toThrow();
    // With data, the pacing chart canvas is present.
    expect(document.getElementById("pacing-chart")).toBeTruthy();
  });
});
