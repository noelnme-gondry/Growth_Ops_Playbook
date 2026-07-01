import { describe, it, expect } from "vitest";
import { MMR_MATH, MMR_STATS } from "./mmmMath.js";
import { chi2Cdf } from "./statPrimitives.js";
import { _mmrLcg } from "./testFixtures.js";

// Golden port of index.html runMmrCoreTests (near line 20445).
// Reproduces same inputs / expected / tolerances verbatim.
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

describe("runMmrCoreTests golden", () => {
  it("T1 · adstock θ=0.5 → 1,0.5,0.25,0.125", () => {
    const a1 = MMR_MATH.adstock([1, 0, 0, 0], 0.5);
    expect(approx(a1[1], 0.5, 1e-9)).toBe(true);
    expect(approx(a1[3], 0.125, 1e-9)).toBe(true);
  });

  it("T2 · adstock θ=0 identity", () => {
    const a0 = MMR_MATH.adstock([3, 7, 2], 0);
    expect(a0.join(",")).toBe("3,7,2");
  });

  it("T3 · OLS β 복원 (2,3,-1)", () => {
    const X3 = [],
      y3 = [];
    for (let i = 0; i < 30; i++) {
      const x1 = i,
        x2 = (i * 7) % 11;
      X3.push([1, x1, x2]);
      y3.push(2 + 3 * x1 - 1 * x2);
    }
    const f3 = MMR_STATS.ols(X3, y3);
    expect(approx(f3.beta[0], 2, 1e-6)).toBe(true);
    expect(approx(f3.beta[1], 3, 1e-6)).toBe(true);
    expect(approx(f3.beta[2], -1, 1e-6)).toBe(true);
    expect(approx(f3.r2, 1, 1e-9)).toBe(true);
  });

  it("T4 · HAC SE > iid SE (양의 자기상관)", () => {
    const rng = _mmrLcg(42);
    const X4 = [],
      y4 = [];
    let e = 0;
    for (let i = 0; i < 120; i++) {
      e = 0.7 * e + rng();
      const x = i;
      X4.push([1, x]);
      y4.push(1 + 0.5 * x + e * 5);
    }
    const nw = MMR_STATS.neweyWest(X4, y4);
    const iid = MMR_STATS.ols(X4, y4);
    const sigma2 = iid.ssRes / (iid.n - iid.p);
    const iidSeSlope = Math.sqrt(sigma2 * iid.XtXinv[1][1]);
    expect(nw.se[1] > iidSeSlope).toBe(true);
  });

  it("T5 · DW < 1.5 (양의 자기상관)", () => {
    const rng = _mmrLcg(42);
    const X4 = [],
      y4 = [];
    let e = 0;
    for (let i = 0; i < 120; i++) {
      e = 0.7 * e + rng();
      const x = i;
      X4.push([1, x]);
      y4.push(1 + 0.5 * x + e * 5);
    }
    const nw = MMR_STATS.neweyWest(X4, y4);
    const dwAr = MMR_STATS.durbinWatson(nw.resid);
    expect(dwAr < 1.5).toBe(true);
  });

  it("T6 · chi2Cdf(3.841,1)≈0.95", () => {
    expect(approx(chi2Cdf(3.841, 1), 0.95, 5e-4)).toBe(true);
  });

  it("T7 · Hill 단조·포화", () => {
    const h = MMR_MATH.hill([0, 1, 10, 100, 1000], 50, 2);
    expect(h[0] < h[2] && h[2] < h[4] && h[4] < 1).toBe(true);
  });

  it("T8 · Fourier t=0 (sin0,cos1)", () => {
    const fr = MMR_MATH.fourier(10, 52, 1);
    expect(approx(fr[0].col[0], 0, 1e-9)).toBe(true);
    expect(approx(fr[1].col[0], 1, 1e-9)).toBe(true);
  });

  it("T9 · BG 자기상관 검출 (p<0.05)", () => {
    const rng = _mmrLcg(42);
    const X4 = [],
      y4 = [];
    let e = 0;
    for (let i = 0; i < 120; i++) {
      e = 0.7 * e + rng();
      const x = i;
      X4.push([1, x]);
      y4.push(1 + 0.5 * x + e * 5);
    }
    const nw = MMR_STATS.neweyWest(X4, y4);
    const bg = MMR_STATS.breuschGodfrey(nw.resid, X4, 1);
    expect(bg && bg.pValue < 0.05).toBe(true);
  });

  it("T10 · 결정론", () => {
    const rng = _mmrLcg(42);
    const X4 = [],
      y4 = [];
    let e = 0;
    for (let i = 0; i < 120; i++) {
      e = 0.7 * e + rng();
      const x = i;
      X4.push([1, x]);
      y4.push(1 + 0.5 * x + e * 5);
    }
    const d1 = MMR_STATS.neweyWest(X4, y4).se[1],
      d2 = MMR_STATS.neweyWest(X4, y4).se[1];
    expect(d1 === d2).toBe(true);
  });

  it("T11 · OOS RMSE≈0 (완전 선형)", () => {
    const X3 = [],
      y3 = [];
    for (let i = 0; i < 30; i++) {
      const x1 = i,
        x2 = (i * 7) % 11;
      X3.push([1, x1, x2]);
      y3.push(2 + 3 * x1 - 1 * x2);
    }
    const oos = MMR_STATS.rollingOriginRMSE(X3, y3, 10);
    expect(oos.rmse != null && oos.rmse < 1e-6).toBe(true);
  });
});
