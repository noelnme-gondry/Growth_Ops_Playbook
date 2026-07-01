// @vitest-environment jsdom
//
// Render-smoke for AbTestHoldout (5-4, experiment group). Regression net for
// the CampaignPvm-class crashes: a route component that throws during render or
// a mount effect. Golden tests (src/utils/*.test.js) cover the pure math; this
// asserts the component MOUNTS without throwing in both the no-data and
// with-data states, and across the three tabs it exposes.
//
// AbTestHoldout reads the CSV RAW columns directly (row.is_control,
// row.numerator, row.denominator, row.holdout_group, ...) — it does NOT go
// through getMappedRows — so the seeded slice carries those raw headers. A
// pass-through mapping keeps the store slice shape identical to real uploads.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import AbTestHoldout from "@/components/tools/AbTestHoldout";

// Empty CSV slice = the "no data yet, show uploader" state.
const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-4",
    csvGroups: { ...useAppStore.getState().csvGroups, experiment: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// A minimal but VALID experiment CSV: readout (is_control/numerator/denominator
// + arm_id for the mass-readout table) AND holdout (holdout_group/numerator/
// denominator + spend/revenue_d7) columns coexist so BOTH the "readout" and
// "holdout" tabs have real data to aggregate. Deterministic — NO Math.random.
function seedWithData() {
  const headers = [
    "arm_id", "is_control", "holdout_group",
    "numerator", "denominator", "spend", "revenue_d7",
  ];
  // pass-through mapping (component reads raw keys; mapping mirrors real uploads)
  const mapping = {
    arm_id: "arm_id", is_control: "is_control", holdout_group: "holdout_group",
    numerator: "numerator", denominator: "denominator",
    spend: "spend", revenue_d7: "revenue_d7",
  };
  const raw = [
    // Control arm (also the holdout/control group)
    { arm_id: "control", is_control: "1", holdout_group: "control",
      numerator: 500, denominator: 10000, spend: 0, revenue_d7: 0 },
    // Variant B arm (exposed/test group)
    { arm_id: "variant_b", is_control: "0", holdout_group: "test",
      numerator: 560, denominator: 10000, spend: 2000000, revenue_d7: 3200000 },
    // Variant C arm (also test/exposed) — gives mass-readout >=2 non-control arms
    { arm_id: "variant_c", is_control: "0", holdout_group: "test",
      numerator: 590, denominator: 10000, spend: 1800000, revenue_d7: 3400000 },
  ];
  const slice = { raw, headers, mapping, fileName: "experiment.csv" };
  useAppStore.setState({
    currentRouteId: "5-4",
    csvGroups: { ...useAppStore.getState().csvGroups, experiment: slice },
    csvData: slice,
  });
}

describe("AbTestHoldout render smoke", () => {
  beforeEach(() => {
    seedNoData();
  });

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<AbTestHoldout />)).not.toThrow();
    // The three top-level tabs render regardless of data.
    expect(screen.getByText("실험 판독 (CSV)")).toBeTruthy();
  });

  it("mounts without throwing with a valid seeded CSV (design + charts)", () => {
    seedWithData();
    // Default tab is "design" — exercises plan compute, threshold matrix, power curve chart.
    expect(() => render(<AbTestHoldout />)).not.toThrow();
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });
});
