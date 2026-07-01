// @vitest-environment jsdom
//
// Render-smoke for AhaMomentFinder (5-20, aha group). Regression net for the
// CampaignPvm-class crashes: a route component that throws during render or a
// mount effect. Golden tests (src/utils/*.test.js) cover the AHA_STATS engine;
// this asserts the component MOUNTS without throwing in the no-data and
// with-data states.
//
// AhaMomentFinder does NOT use csvData.mapping — it auto-detects column roles
// from csvData.headers/raw (ahaAutoMapColumns): an `id`/`user` column, a binary
// {0,1} `target`-named column, and feature columns named `<action>_d<window>`
// (ahaParseActionWindow) or plain single-window actions. So the seed needs:
//   • user_id            → role "id"
//   • retained           → role "target" (binary 0/1, name matches /retain/)
//   • share_d3, share_d7 → role "feature", action "share", windows 3 & 7
//   • invite_d7          → role "feature", action "invite", window 7
// Deterministic — NO Math.random (harness §3). mapping is a pass-through mirror
// of the real upload shape but is unused by this component's engine.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import AhaMomentFinder from "@/components/tools/AhaMomentFinder";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-20",
    csvGroups: { ...useAppStore.getState().csvGroups, aha: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

function seedWithData() {
  const headers = ["user_id", "retained", "share_d3", "share_d7", "invite_d7"];
  const mapping = {
    user_id: "user_id", retained: "retained",
    share_d3: "share_d3", share_d7: "share_d7", invite_d7: "invite_d7",
  };
  // 120 users. `retained` correlates deterministically with early sharing so the
  // grid search produces a real leading-action signal (F1/lift), exercising the
  // full results table + drilldown + chart render. NO Math.random.
  const raw = [];
  for (let u = 0; u < 120; u++) {
    const sharedEarly = u % 3 === 0 ? 1 : 0;        // ~1/3 share within d3
    const sharedLate = u % 3 === 0 || u % 5 === 0 ? 1 : 0; // superset by d7
    const invited = u % 4 === 0 ? 1 : 0;
    // retained if shared early OR (invited AND u even) — deterministic signal
    const retained = sharedEarly === 1 || (invited === 1 && u % 2 === 0) ? 1 : 0;
    raw.push({
      user_id: `u${u}`,
      retained,
      share_d3: sharedEarly,
      share_d7: sharedLate,
      invite_d7: invited,
    });
  }
  const slice = { raw, headers, mapping, fileName: "aha.csv" };
  useAppStore.setState({
    currentRouteId: "5-20",
    csvGroups: { ...useAppStore.getState().csvGroups, aha: slice },
    csvData: slice,
  });
}

describe("AhaMomentFinder render smoke", () => {
  beforeEach(() => {
    seedNoData();
  });

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<AhaMomentFinder />)).not.toThrow();
    expect(document.body.querySelector("*")).toBeTruthy();
  });

  it("mounts without throwing with a valid event CSV (target + actions)", () => {
    seedWithData();
    expect(() => render(<AhaMomentFinder />)).not.toThrow();
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });
});
