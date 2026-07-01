// @vitest-environment jsdom
//
// Render-smoke for ScorecardTab (5-2 운영 대시보드 · 스코어카드 탭). No-data
// returns the "데이터 없음" pane; with-data builds KPI cards + (on metric
// select) a daily chart. Mounts here cover render + the base chart effect;
// mocks live in vitest.smoke.setup.js. ScorecardTab also mounts BudgetHealthCard.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import ScorecardTab from "@/components/dashboard/ScorecardTab";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

// Scorecard cards gate on mapped keys (installs/actions/clicks/impressions/
// revenue_d7), so seed all of them to exercise every card branch. mapping =
// { originalHeader: standardKey } (getMappedRows).
function seedWithData() {
  const headers = ["Date", "Country", "Platform", "Channel", "Spend", "Installs", "Actions", "Clicks", "Impr", "RevD7"];
  const mapping = {
    Date: "date", Country: "country", Platform: "platform", Channel: "channel",
    Spend: "cost", Installs: "installs", Actions: "actions", Clicks: "clicks", Impr: "impressions", RevD7: "revenue_d7",
  };
  const raw = [];
  // 20 days so the 7-day window has a full "prev 7" comparison slice.
  for (let d = 1; d <= 20; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of ["Google", "Meta"]) {
      // deterministic — NO Math.random (harness §8)
      const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
      const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
      raw.push({
        Date: date, Country: "KR", Platform: "iOS", Channel: ch,
        Spend: cost, Installs: installs, Actions: Math.round(installs * 0.3),
        Clicks: installs * 8, Impr: installs * 120, RevD7: installs * 900,
      });
    }
  }
  const slice = { raw, headers, mapping, fileName: "scorecard.csv" };
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

describe("ScorecardTab render smoke", () => {
  beforeEach(() => seedNoData());

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<ScorecardTab />)).not.toThrow();
    // No-data pane renders text, not the scorecard section.
    expect(document.body.textContent).toContain("데이터 없음");
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    expect(() => render(<ScorecardTab />)).not.toThrow();
    expect(document.getElementById("tab-scorecard")).toBeTruthy();
  });
});
