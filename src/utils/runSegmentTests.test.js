// Golden test ported VERBATIM from index.html runSegmentTests (near line 38776).
// Locks 5-12 Segment matrix pure-math regressions (v2 migration deploy gate).
// Inputs / expected reproduce the index test exactly — no loosening.
import { describe, it, expect } from "vitest";
import { segmentMetricValue } from "./segmentMath";

describe("runSegmentTests (golden, ported from index.html)", () => {
  const cell = {
    cost: 1000,
    impr: 100000,
    clk: 2000,
    installs: 500,
    actions: 100,
    rev: 3000,
  };

  it("T1 · CPI=2", () => {
    expect(segmentMetricValue(cell, "cpi")).toBe(2);
  });

  it("T2 · CPA=10", () => {
    expect(segmentMetricValue(cell, "cpa")).toBe(10);
  });

  it("T3 · ROAS=3", () => {
    expect(segmentMetricValue(cell, "roas")).toBe(3);
  });

  it("T4 · CVR=0.25", () => {
    expect(segmentMetricValue(cell, "cvr")).toBe(0.25);
  });

  it("T5 · 분모0 CPI null", () => {
    expect(segmentMetricValue({ cost: 10, installs: 0 }, "cpi")).toBe(null);
  });
});
