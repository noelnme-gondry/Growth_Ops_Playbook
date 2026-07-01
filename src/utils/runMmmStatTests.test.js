/* ============================================================
 * runMmmStatTests — golden parity test for the ported v2 MMM math engine.
 * Faithful full port of index.html runMmmStatTests (lines 21159-21309):
 * SAME inputs, SAME expected values, SAME tolerances, SAME sequential RNG
 * consumption order. All 12 sub-tests.
 *
 * IMPORTANT: index.html shares a single seeded `rng = _mmrLcg(123)` whose
 * state advances across T1..T12 in a specific order. To preserve byte-exact
 * parity the whole sequence runs inside ONE it() block (splitting into
 * separate it blocks would be fine only if draw order/counts were identical;
 * a single block guarantees it).
 * ============================================================ */
import { describe, it, expect } from "vitest";

import { mmmOls } from "./regMath.js";
import { studentTp } from "./statPrimitives.js";
import {
  mkOriginal,
  mkHamedRao,
  adfCT,
  kpssCT,
  ljungBox,
  fitAR1,
  shapleyR2Exact,
  stlWeekly,
} from "./mmmMath.js";
import { _mmrLcg } from "./testFixtures.js";

const approx = (a, b, t) => Math.abs(a - b) <= t;

describe("runMmmStatTests golden parity (full)", () => {
  it("runs all 12 MMM methodology golden sub-tests", () => {
    const rng = _mmrLcg(123);

    // T1 OLS β 복원 + AIC 유한
    const Xo = [],
      yo = [];
    for (let i = 0; i < 40; i++) {
      const x1 = i,
        x2 = (i * 3) % 7;
      Xo.push([1, x1, x2]);
      yo.push(5 + 2 * x1 - 0.5 * x2);
    }
    const fo = mmmOls(Xo, yo);
    expect(
      approx(fo.beta[0], 5, 1e-6) &&
        approx(fo.beta[1], 2, 1e-6) &&
        isFinite(fo.aic),
    ).toBe(true); // T1

    // T2 MK 단조증가 → increasing p<0.05
    const inc = Array.from({ length: 60 }, (_, i) => i + rng() * 2);
    const mk = mkOriginal(inc);
    expect(mk.trend === "increasing" && mk.p < 0.05).toBe(true); // T2

    // T3 MK 백색잡음 → no trend
    const wn = Array.from({ length: 80 }, () => rng());
    const mk2 = mkOriginal(wn);
    expect(mk2.trend === "no trend").toBe(true); // T3

    // T4 Hamed-Rao(lag=3): 양의 자기상관에서 var↑. 전용 rng·n=200으로 안정.
    const rngAr = _mmrLcg(2024);
    let e = 0;
    const ar = [];
    for (let i = 0; i < 200; i++) {
      e = 0.7 * e + rngAr();
      ar.push(i * 0.05 + e);
    }
    const hr = mkHamedRao(ar, 0.05, 3),
      or = mkOriginal(ar);
    expect(hr.varS > or.varS).toBe(true); // T4

    // T5 ADF: 정상(백색잡음) → reject (p<0.05); 랜덤워크 → fail (p>0.1)
    const rw = [0];
    for (let i = 1; i < 120; i++) rw.push(rw[i - 1] + rng());
    const adfRW = adfCT(rw),
      adfWN = adfCT(Array.from({ length: 120 }, () => rng()));
    expect(adfWN.p < 0.05 && adfRW.p > 0.1).toBe(true); // T5

    // T6 KPSS: 정상 → p high (>0.05); 랜덤워크 → p low (<0.05)
    const kpWN = kpssCT(Array.from({ length: 120 }, () => rng())),
      kpRW = kpssCT(rw);
    expect(kpWN.p > 0.05 && kpRW.p < 0.05).toBe(true); // T6

    // T7 Ljung-Box: 백색잡음 p>0.05, AR(1) p<0.05
    const lbWN = ljungBox(
        Array.from({ length: 120 }, () => rng()),
        10,
      ),
      lbAR = ljungBox(ar, 10);
    expect(lbWN.p > 0.05 && lbAR.p < 0.05).toBe(true); // T7

    // T8 AR(1) fit: rho 회복 (~0.7), β slope 양수 (T4 AR 시리즈 재사용)
    const Xa = ar.map((_, i) => [1, i]);
    const fa = fitAR1(Xa, ar);
    expect(approx(fa.rho, 0.7, 0.2) && fa.beta[1] > 0).toBe(true); // T8

    // T9 Shapley: 직교 2그룹 → 합=전체R²
    const g1 = Array.from({ length: 100 }, (_, i) => Math.sin(i));
    const g2 = Array.from({ length: 100 }, (_, i) => ((i * 13) % 17) - 8);
    const ys2 = g1.map((v, i) => 3 * v + 1.5 * g2[i] + rng() * 0.1);
    const Xs = g1.map((v, i) => [v, g2[i]]);
    const sh = shapleyR2Exact(
      ys2,
      [
        { name: "A", cols: [0] },
        { name: "B", cols: [1] },
      ],
      Xs,
    );
    const sumSh = sh.rows.reduce((a, r) => a + r.r2_share, 0);
    expect(approx(sumSh, sh.total, 1e-6)).toBe(true); // T9

    // T10 Student-t: p(t=1.96, df=∞근사 1e6)≈0.05
    expect(approx(studentTp(1.96, 1e6), 0.05, 2e-3)).toBe(true); // T10

    // T11 결정론
    const d1 = adfCT(rw).stat,
      d2 = adfCT(rw).stat;
    expect(d1 === d2).toBe(true); // T11

    // T12 STL: 추세 시리즈 trend 단조 상승 회복
    const stlY = Array.from(
      { length: 104 },
      (_, i) =>
        100 + i * 0.5 + 10 * Math.sin((2 * Math.PI * i) / 52) + rng() * 2,
    );
    const stl = stlWeekly(stlY, 52);
    expect(stl.trend[103] - stl.trend[0] > 20).toBe(true); // T12
  });
});
