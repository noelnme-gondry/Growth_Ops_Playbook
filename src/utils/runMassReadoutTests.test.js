import { describe, it, expect } from "vitest";
import { STATS } from "./abTestMath";
import { CREATIVE_STATS } from "./creativeMath";

// Golden test port of runMassReadoutTests (index.html ~19780-19915).
// Same inputs, same expected values, same tolerances — verbatim.
//
// index.html's massReadout(arms) closes over the global CREATIVE_STATS and
// calls CREATIVE_STATS.betaProbGreater(control.x, control.n, a.x, a.n) with the
// default gridN = CREATIVE_CONFIG.bayes.gridN (=2000) and priorA=priorB=1.
// In v2 massReadout(arms, CREATIVE_STATS) takes the stats object as a param;
// betaProbGreater keeps index's verbatim signature (xA,nA,xB,nB, gridN=2000)
// with priors from the module constant, so a 4-arg call is byte-identical to index.
const massReadout = (arms) => STATS.massReadout(arms, CREATIVE_STATS);

describe("runMassReadoutTests (golden parity)", () => {
  it("T1 · 명확한 positive → sig+lift+probBWins", () => {
    const r1 = massReadout([
      { name: "control", n: 10000, x: 500, isControl: true },
      { name: "variant_b", n: 10000, x: 650, isControl: false },
    ]);
    const row1 = r1.rows.find((r) => !r.isControl);
    expect(row1).toBeTruthy();
    expect(row1.sig).toBe(true);
    expect(row1.liftRel).toBeGreaterThan(0);
    expect(row1.probBWins).toBeGreaterThan(0.9);
  });

  it("T2 · 명확한 negative → sig+lift<0+probBWins낮음", () => {
    const r2 = massReadout([
      { name: "control", n: 10000, x: 650, isControl: true },
      { name: "variant_c", n: 10000, x: 500, isControl: false },
    ]);
    const row2 = r2.rows.find((r) => !r.isControl);
    expect(row2).toBeTruthy();
    expect(row2.sig).toBe(true);
    expect(row2.liftRel).toBeLessThan(0);
    expect(row2.probBWins).toBeLessThan(0.1);
  });

  it("T3 · is_control 없을 때 첫 행 fallback", () => {
    const r3 = massReadout([
      { name: "alpha", n: 5000, x: 300, isControl: false },
      { name: "beta", n: 5000, x: 320, isControl: false },
    ]);
    expect(r3.control).toBeTruthy();
    expect(r3.control.name).toBe("alpha");
    expect(r3.rows[0].isControl).toBe(true);
  });

  it("T4 · massReadout 결정론", () => {
    const arms = [
      { name: "control", n: 8000, x: 400, isControl: true },
      { name: "v1", n: 8000, x: 460, isControl: false },
    ];
    const m1 = JSON.stringify(massReadout(arms));
    const m2 = JSON.stringify(massReadout(arms));
    expect(m1).toBe(m2);
  });

  it("T5 · MDE↔SampleSize 라운드트립", () => {
    const baseline = 0.05;
    const mde0 = 0.2; // 20% relative
    const nFromMde = STATS.sampleSizePerArm({
      baseline,
      mdeRelative: mde0,
      alpha: 0.05,
      power: 0.8,
    }).n;
    const mdeFromN = STATS.mdeForSampleSize({
      baseline,
      n: nFromMde,
      alpha: 0.05,
      power: 0.8,
    });
    const roundtripErr = Math.abs(mdeFromN - mde0) / mde0;
    expect(roundtripErr).toBeLessThan(0.05);
  });

  it("T6 · powerCurve MDE 단조감소", () => {
    const curve = STATS.powerCurve({
      baseline: 0.05,
      alpha: 0.05,
      power: 0.8,
      points: 12,
    });
    const valid = curve.filter((p) => p.mdePct != null);
    const monotone = valid.every(
      (p, i) => i === 0 || p.mdePct <= valid[i - 1].mdePct + 1e-9,
    );
    expect(monotone).toBe(true);
  });

  it("T7 · powerCurve 결정론", () => {
    const c1 = JSON.stringify(
      STATS.powerCurve({ baseline: 0.05, alpha: 0.05, power: 0.8 }),
    );
    const c2 = JSON.stringify(
      STATS.powerCurve({ baseline: 0.05, alpha: 0.05, power: 0.8 }),
    );
    expect(c1).toBe(c2);
  });
});
