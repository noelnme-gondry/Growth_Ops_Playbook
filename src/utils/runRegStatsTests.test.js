import { describe, it, expect } from "vitest";
import { REG_STATS, REG_TRANSFORMS } from "./regMath";

// Faithful reproduction of runRegStatsTests() from index.html (lines 21527-21635).
// Same inputs, same expected values, same tolerances — do NOT loosen.
const approx = (a, b, t) => Math.abs(a - b) <= t;

describe("runRegStatsTests (golden port)", () => {
  it("T1 · OLS β(2,3,-1.5)·R²1", () => {
    const X1 = [],
      y1 = [];
    for (let i = 0; i < 30; i++) {
      const x1 = i,
        x2 = (i * 7) % 11;
      X1.push([1, x1, x2]);
      y1.push(2 + 3 * x1 - 1.5 * x2);
    }
    const f1 = REG_STATS.ols(X1, y1);
    expect(approx(f1.beta[0], 2, 1e-6)).toBe(true);
    expect(approx(f1.beta[1], 3, 1e-6)).toBe(true);
    expect(approx(f1.beta[2], -1.5, 1e-6)).toBe(true);
    expect(approx(f1.R2, 1, 1e-9)).toBe(true);
  });

  it("T2 · tSF(2.776,4)≈.05·(1.96,∞)≈.05", () => {
    expect(approx(REG_STATS.tSF(2.776, 4), 0.05, 5e-4)).toBe(true);
    expect(approx(REG_STATS.tSF(1.96, 1e6), 0.05, 2e-3)).toBe(true);
  });

  it("T3 · transforms(z·minmax·adstock_log)", () => {
    const z = REG_TRANSFORMS.zscore([1, 2, 3, 4, 5]);
    const zm = z.reduce((a, b) => a + b, 0) / 5;
    const mm = REG_TRANSFORMS.minmax([10, 20, 30]);
    const ad = REG_TRANSFORMS.adstock_log([1, 0, 0], 0.5); // adstock [1,.5,.25] → log1p
    expect(approx(zm, 0, 1e-9)).toBe(true);
    expect(mm[0]).toBe(0);
    expect(mm[2]).toBe(1);
    expect(approx(ad[1], Math.log1p(0.5), 1e-9)).toBe(true);
  });

  it("T4 · r2of(VIF용) 유한", () => {
    const X1 = [];
    for (let i = 0; i < 30; i++) {
      const x1 = i,
        x2 = (i * 7) % 11;
      X1.push([1, x1, x2]);
    }
    const Xo = X1.map((r) => [1, r[1]]);
    const r2o = REG_STATS.r2of(
      Xo,
      X1.map((r) => r[2]),
    );
    expect(isFinite(r2o) && r2o >= 0 && r2o < 1).toBe(true);
  });

  it("T5 · 완전공선 ridge fallback", () => {
    let ridgeOk = true;
    try {
      REG_STATS.ols(
        [
          [1, 2, 4],
          [1, 3, 6],
          [1, 4, 8],
          [1, 5, 10],
        ],
        [1, 2, 3, 4],
      );
    } catch (e) {
      ridgeOk = false;
    }
    expect(ridgeOk).toBe(true);
  });

  it("T6 · 결정론", () => {
    const X1 = [],
      y1 = [];
    for (let i = 0; i < 30; i++) {
      const x1 = i,
        x2 = (i * 7) % 11;
      X1.push([1, x1, x2]);
      y1.push(2 + 3 * x1 - 1.5 * x2);
    }
    const d1 = REG_STATS.ols(X1, y1).beta[1],
      d2 = REG_STATS.ols(X1, y1).beta[1];
    expect(d1 === d2).toBe(true);
  });
});
