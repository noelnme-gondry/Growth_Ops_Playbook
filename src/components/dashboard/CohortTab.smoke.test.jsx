// @vitest-environment jsdom
//
// Render-smoke for CohortTab (5-2 운영 대시보드, 코호트/리텐션 탭). Regression net
// for render/mount-effect throws (retention curve + per-segment charts). Golden
// tests cover cohortMath.fitPowerCurve; this asserts the tab MOUNTS without
// throwing in no-data and with-data states. Copied from BudgetAllocation smoke.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import CohortTab from "@/components/dashboard/CohortTab";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// Minimal VALID retention CSV: installs + actions (so the 설치/가입 기준 toggle
// renders) + ret_dN columns. CohortTab needs >=1 ret_dN column mapped or it
// short-circuits to the "리텐션 데이터 없음" pane. Header names match standard
// keys so both mapping directions resolve. mapping = { origHeader: standardKey }.
function seedWithData() {
  const headers = ["date", "country", "platform", "channel", "cost", "installs", "actions", "ret_d1", "ret_d7", "ret_d30"];
  const mapping = {
    date: "date",
    country: "country",
    platform: "platform",
    channel: "channel",
    cost: "cost",
    installs: "installs",
    actions: "actions",
    ret_d1: "ret_d1",
    ret_d7: "ret_d7",
    ret_d30: "ret_d30",
  };
  const raw = [];
  for (let d = 1; d <= 10; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of ["Google", "Meta"]) {
      // deterministic — NO Math.random (harness §8). ret_dN as rates (max<=1).
      const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
      const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200));
      raw.push({
        date,
        country: "KR",
        platform: "iOS",
        channel: ch,
        cost,
        installs,
        actions: Math.round(installs * 0.6),
        ret_d1: 0.5,
        ret_d7: 0.3,
        ret_d30: 0.15,
      });
    }
  }
  const slice = { raw, headers, mapping, fileName: "cohort.csv" };
  useAppStore.setState({
    currentRouteId: "5-2",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice },
    csvData: slice,
  });
}

describe("CohortTab render smoke", () => {
  beforeEach(() => {
    seedNoData();
  });

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<CohortTab />)).not.toThrow();
    // No-data pane shows the "리텐션 데이터 없음" callout.
    expect(document.body.textContent).toContain("리텐션 데이터 없음");
  });

  it("mounts without throwing with a valid seeded retention CSV", () => {
    seedWithData();
    let container;
    expect(() => {
      ({ container } = render(<CohortTab />));
    }).not.toThrow();
    // Key node: the overall retention curve canvas.
    expect(container.querySelector("#wide-ret-curve")).toBeTruthy();
  });
});
