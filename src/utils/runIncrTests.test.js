import { describe, it, expect } from "vitest";
import { INCR_MATH, parseHoldoutGroup } from "./incrMath";

// Golden test port of runIncrTests (index.html ~20105-20161).
// Same inputs, same expected values, same tolerances — verbatim.

describe("runIncrTests (golden parity)", () => {
  // control 1000명 5% (50), test 1000명 8% (80) → 반사실 50, 증분 30, lift +60%
  const r = INCR_MATH.compute(
    { num: 80, den: 1000, spend: 0, rev: 0 },
    { num: 50, den: 1000 },
  );

  it("T1 · 증분 전환 30", () => {
    expect(Math.round(r.incrementalConv)).toBe(30);
  });

  it("T2 · 상대 lift +60%", () => {
    expect(Math.abs(r.liftRel - 0.6) < 1e-9).toBe(true);
  });

  it("T3 · iROAS=1.0", () => {
    // iROAS: spend 300, rev 800 (test), revPerConv=10 → incrementalRev=300 → iroas=1.0
    const r2 = INCR_MATH.compute(
      { num: 80, den: 1000, spend: 300, rev: 800 },
      { num: 50, den: 1000 },
    );
    expect(Math.abs(r2.iroas - 1) < 1e-9).toBe(true);
  });

  it("T4 · 그룹 파싱", () => {
    const pg = [
      "test",
      "control",
      "holdout",
      "노출",
      "대조군",
      "exposed",
    ].map(parseHoldoutGroup);
    expect(pg.join(",")).toBe("test,control,control,test,control,test");
  });
});
