import { describe, it, expect } from "vitest";
import { MATURATION_MATH, buildMaturationRows } from "./cohortMath.js";

// Golden test port of index.html `runMaturationTests` (near line 39907).
// Same inputs, expected values, tolerances — verbatim.
// T6 (buildMaturationRows) ported via explicit raw rows + mapping (same as index CSV_STATE).
describe("runMaturationTests (golden port)", () => {
  // T1: power fit — y=0.1*(day+1)^0.5: D90 pred = 0.1*sqrt(91)
  it("T1 · power fit D90", () => {
    const fit = MATURATION_MATH.fit([
      { day: 0, roas: 0.1 },
      { day: 7, roas: 0.1 * Math.sqrt(8) },
      { day: 14, roas: 0.1 * Math.sqrt(15) },
    ]);
    const p90 = fit.predict(90);
    expect(Math.abs(p90 - 0.1 * Math.sqrt(91)) < 1e-6).toBe(true);
  });

  // T2: 1점 flat
  it("T2 · 1점 flat", () => {
    const f1 = MATURATION_MATH.fit([{ day: 7, roas: 0.3 }]);
    expect(f1.predict(90) === 0.3).toBe(true);
  });

  // T3: 0점 null
  it("T3 · 0점 null", () => {
    expect(MATURATION_MATH.fit([]) === null).toBe(true);
  });

  // T4: empiricalRatios — 2 units, ratio 5.0 cost-weighted
  it("T4 · empiricalRatios avg=5.0", () => {
    const us = [
      { cost: 1000, roas: { 7: 0.1, 90: 0.5 } },
      { cost: 1000, roas: { 7: 0.2, 90: 1.0 } },
    ];
    const er = MATURATION_MATH.empiricalRatios(us, 7, [90]);
    const pass = er[90] != null && Math.abs(er[90].avg - 5.0) < 1e-9;
    expect(pass).toBe(true);
  });

  // T5: sufficiency — 3 anchors [D0,D7,D14], detect convergence
  it("T5 · sufficiency 3-anchor → 2 steps (2-pt min)", () => {
    const us = [{ cost: 1000, roas: { 0: 0.05, 7: 0.1, 14: 0.14 } }];
    const suf = MATURATION_MATH.sufficiency(us, [0, 7, 14], 90);
    const pass =
      suf != null && Array.isArray(suf.steps) && suf.steps.length === 2;
    expect(pass).toBe(true);
  });

  // T6: buildMaturationRows — new object return structure with units/availDns
  it("T6 · buildMaturationRows obj+availDns", () => {
    const mapping = {
      cost: "cost",
      revenue_d7: "revenue_d7",
      revenue_d90: "revenue_d90",
    };
    const raw = [{ cost: "1000", revenue_d7: "100", revenue_d90: "500" }];
    const res = buildMaturationRows(raw, mapping);
    const pass =
      res != null &&
      Array.isArray(res.units) &&
      Array.isArray(res.availDns) &&
      res.availDns.includes(7) &&
      res.availDns.includes(90) &&
      res.units[0].roas[7] != null &&
      res.units[0].roas[90] != null;
    expect(pass).toBe(true);
  });
});
