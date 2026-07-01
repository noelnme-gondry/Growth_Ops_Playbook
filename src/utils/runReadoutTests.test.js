import { describe, it, expect } from "vitest";
import { computeMetricVerdict, parseControl } from "./incrMath";
import { CREATIVE_STATS } from "./creativeMath";

// Golden test port of runReadoutTests (index.html ~19682-19770).
// Same inputs, same expected values, same tolerances — verbatim.
//
// index.html calls CREATIVE_STATS.twoPropZ(xA,nA,xB,nB) → {z,p,pA,pB,diff} and
// CREATIVE_STATS.betaProbGreater(xA,nA,xB,nB) with default gridN=2000, priorA=priorB=1.
// v2 CREATIVE_STATS keeps index's verbatim signatures → byte-identical.

describe("runReadoutTests (golden parity)", () => {
  it("T1 · 압도적 positive → promote", () => {
    const vPos = computeMetricVerdict(
      CREATIVE_STATS.twoPropZ(100, 10000, 250, 10000),
      CREATIVE_STATS.betaProbGreater(100, 10000, 250, 10000),
    );
    expect(vPos).toBe("promote");
  });

  it("T2 · 압도적 negative → kill", () => {
    const vNeg = computeMetricVerdict(
      CREATIVE_STATS.twoPropZ(250, 10000, 100, 10000),
      CREATIVE_STATS.betaProbGreater(250, 10000, 100, 10000),
    );
    expect(vNeg).toBe("kill");
  });

  it("T3 · 작은 차이 → inconclusive", () => {
    const vSmall = computeMetricVerdict(
      CREATIVE_STATS.twoPropZ(500, 10000, 510, 10000),
      CREATIVE_STATS.betaProbGreater(500, 10000, 510, 10000),
    );
    expect(vSmall).toBe("inconclusive");
  });

  it("T4 · 결정론 (byte-identical)", () => {
    const v1 = computeMetricVerdict(
      CREATIVE_STATS.twoPropZ(100, 1000, 150, 1000),
      CREATIVE_STATS.betaProbGreater(100, 1000, 150, 1000),
    );
    const v2 = computeMetricVerdict(
      CREATIVE_STATS.twoPropZ(100, 1000, 150, 1000),
      CREATIVE_STATS.betaProbGreater(100, 1000, 150, 1000),
    );
    expect(v1).toBe(v2);
  });

  it("T5 · parseControl 다양한 표기", () => {
    const ctlTests = [
      [parseControl("true"), true],
      [parseControl("1"), true],
      [parseControl("control"), true],
      [parseControl("false"), false],
      [parseControl("variant"), false],
      [parseControl(""), false],
      [parseControl(null), false],
    ];
    const allPass = ctlTests.every(
      ([actual, expected]) => actual === expected,
    );
    expect(allPass).toBe(true);
  });
});
