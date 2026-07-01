// @vitest-environment jsdom
//
// Render-smoke for Dashboard (5-2). Regression net for a render/mount-effect
// throw. Dashboard reads csvData + dashboardTab: with no data it shows the
// uploader; with data it mounts the filter bar, tabs, and the ACTIVE tab child
// (VizTab/ScorecardTab/…). We mount each of the 8 tabs on a valid efficiency CSV
// so a throw in any tab surfaces here. mapping = { originalHeader: standardKey }.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import Dashboard from "@/components/Dashboard";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-2",
    dashboardTab: "viz",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// Valid efficiency CSV: date + funnel metrics + revenue/retention so LTV/cohort/
// funnel tabs have inputs. Deterministic (NO Math.random — harness §8).
function seedWithData() {
  const headers = [
    "Date", "Country", "Platform", "Channel", "Spend",
    "Impressions", "Clicks", "Installs", "Actions",
    "Revenue_d0", "Revenue_d7", "Cohort_size", "Ret_d0", "Ret_d7",
  ];
  const mapping = {
    Date: "date", Country: "country", Platform: "platform", Channel: "channel", Spend: "cost",
    Impressions: "impressions", Clicks: "clicks", Installs: "installs", Actions: "actions",
    Revenue_d0: "revenue_d0", Revenue_d7: "revenue_d7",
    Cohort_size: "cohort_size", Ret_d0: "ret_d0", Ret_d7: "ret_d7",
  };
  const raw = [];
  for (let d = 1; d <= 14; d++) for (const ch of ["Google", "Meta"]) {
    const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
    const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
    const actions = Math.round(installs * 0.6);
    raw.push({
      Date: `2026-01-${String(d).padStart(2, "0")}`,
      Country: "KR", Platform: "iOS", Channel: ch, Spend: cost,
      Impressions: installs * 200, Clicks: installs * 20, Installs: installs,
      Actions: actions,
      Revenue_d0: actions * 1200, Revenue_d7: actions * 2400,
      Cohort_size: installs, Ret_d0: installs, Ret_d7: Math.round(installs * 0.3),
    });
  }
  const slice = { raw, headers, mapping, fileName: "ops.csv" };
  useAppStore.setState({ currentRouteId: "5-2", csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice }, csvData: slice });
  // #4 analyze-gate: Dashboard now hides tabs until the group is analyzed.
  // Mark analyzed so smoke assertions reach the actual tab content.
  useAppStore.getState().setGroupAnalyzed("5-2");
}

const TABS = ["viz", "scorecard", "pacing", "anomaly", "ltv", "cohort", "funnel", "segment"];

describe("Dashboard render smoke", () => {
  beforeEach(() => seedNoData());

  it("no-data mounts (uploader shown)", () => {
    expect(() => render(<Dashboard />)).not.toThrow();
    expect(document.querySelector(".csv-dropzone")).toBeTruthy();
  });

  for (const tab of TABS) {
    it(`with-data mounts — ${tab} tab`, () => {
      seedWithData();
      useAppStore.setState({ dashboardTab: tab });
      expect(() => render(<Dashboard />)).not.toThrow();
      expect(document.querySelector(".dashboard-content")).toBeTruthy();
    });
  }
});
