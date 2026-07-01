// @vitest-environment jsdom
//
// Render-smoke for BudgetAllocation (5-3). Regression net for the
// CampaignPvm-class crashes: a route component that throws during render or a
// mount effect. Golden tests (src/utils/*.test.js) cover the pure math; this
// asserts the component MOUNTS without throwing in both the no-data and
// with-data states. Copy this pattern verbatim for the other tool components.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import BudgetAllocation from "@/components/tools/BudgetAllocation";

// Empty CSV slice = the "no data yet, show uploader" state.
const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

// A minimal but VALID efficiency CSV for 5-3: original headers → standard keys.
// mapping is { originalHeader: standardKey } (see utils/dashboardAggregator getMappedRows).
// BudgetAllocation needs cost + a result metric (installs) grouped by channel/country
// across >=1 date, for >=2 channels so the allocator has something to split.
function seedWithData() {
  const headers = ["Date", "Country", "Platform", "Channel", "Spend", "Installs"];
  const mapping = {
    Date: "date",
    Country: "country",
    Platform: "platform",
    Channel: "channel",
    Spend: "cost",
    Installs: "installs",
  };
  const raw = [];
  const channels = ["Google", "Meta"];
  for (let d = 1; d <= 10; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of channels) {
      const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
      // deterministic diminishing-returns-ish result (NO Math.random — §8)
      const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
      raw.push({ Date: date, Country: "KR", Platform: "iOS", Channel: ch, Spend: cost, Installs: installs });
    }
  }
  useAppStore.setState({
    currentRouteId: "5-3",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: { raw, headers, mapping, fileName: "alloc.csv" } },
    csvData: { raw, headers, mapping, fileName: "alloc.csv" },
  });
}

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-3",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

describe("BudgetAllocation render smoke", () => {
  beforeEach(() => {
    // Reset the mirror + active group before each case so state can't leak.
    seedNoData();
  });

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<BudgetAllocation />)).not.toThrow();
    // Sanity: something rendered into the DOM.
    expect(document.body.querySelector("*")).toBeTruthy();
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    expect(() => render(<BudgetAllocation />)).not.toThrow();
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });
});
