import { describe, it, expect } from "vitest";
import { CANNIBAL_STATS } from "./responseMath";
import { generateDates, seededNoise } from "./testFixtures";

// Golden test port of runCannibalTests (index.html 16380-16522).
// Same inputs, same expected values, same tolerances — verbatim.

describe("runCannibalTests (golden parity)", () => {
  const n = 365;
  const dates = generateDates(n);
  const paidWeekdayPattern = [10, 5, 8, 12, 15, 30, 25]; // 일~토
  const orgWeekdayPattern = [50, 80, 75, 60, 55, 20, 15];

  it("T1 · 독립 시리즈 (실제 인과 X, 추세만 공유)", () => {
    const rngP = seededNoise(42);
    const rngO = seededNoise(7);
    const paid = [],
      organic = [];
    for (let i = 0; i < n; i++) {
      const w = new Date(dates[i]).getDay();
      paid.push(100 + 0.5 * i + paidWeekdayPattern[w] + rngP() * 30);
      organic.push(800 - 0.3 * i + orgWeekdayPattern[w] + rngO() * 60);
    }
    const rawR = CANNIBAL_STATS.pearson(paid, organic);

    const linP = CANNIBAL_STATS.linearFit(paid);
    const linO = CANNIBAL_STATS.linearFit(organic);
    const residP = paid.map((v, i) => v - linP.fit[i]);
    const residO = organic.map((v, i) => v - linO.fit[i]);
    const wdP = CANNIBAL_STATS.weekdayDetrend(residP, dates);
    const wdO = CANNIBAL_STATS.weekdayDetrend(residO, dates);
    const detR = CANNIBAL_STATS.pearson(wdP.detrended, wdO.detrended);

    expect(rawR).toBeLessThan(-0.5);
    expect(Math.abs(detR)).toBeLessThan(0.15);
  });

  it("T2 · 진짜 동시점 잠식 존재", () => {
    const paid2 = [],
      organic2 = [];
    for (let i = 0; i < n; i++) {
      const w = new Date(dates[i]).getDay();
      const p = 100 + 0.5 * i + paidWeekdayPattern[w] + seededNoise(11)() * 20;
      paid2.push(p);
      organic2.push(
        800 - 0.3 * i + orgWeekdayPattern[w] - 0.6 * p + seededNoise(13)() * 30,
      );
    }
    const linP2 = CANNIBAL_STATS.linearFit(paid2);
    const linO2 = CANNIBAL_STATS.linearFit(organic2);
    const r2P = paid2.map((v, i) => v - linP2.fit[i]);
    const r2O = organic2.map((v, i) => v - linO2.fit[i]);
    const wd2P = CANNIBAL_STATS.weekdayDetrend(r2P, dates);
    const wd2O = CANNIBAL_STATS.weekdayDetrend(r2O, dates);
    const rawR2 = CANNIBAL_STATS.pearson(paid2, organic2);
    const detR2 = CANNIBAL_STATS.pearson(wd2P.detrended, wd2O.detrended);

    expect(rawR2).toBeLessThan(-0.3);
    expect(detR2).toBeLessThan(-0.2);
  });

  it("T3 · linearFit 정확도 (정확히 선형인 데이터)", () => {
    const exact = Array.from({ length: 100 }, (_, i) => 2 * i + 50);
    const fitExact = CANNIBAL_STATS.linearFit(exact);
    expect(Math.abs(fitExact.slope - 2)).toBeLessThan(1e-10);
    expect(Math.abs(fitExact.intercept - 50)).toBeLessThan(1e-10);
  });

  it("T4 · weekdayDetrend 항등식 (빼고 나면 요일 평균 ≈ 0)", () => {
    const r4 = Array.from({ length: 100 }, () => seededNoise(99)() * 50);
    const d4 = generateDates(100);
    const wd4 = CANNIBAL_STATS.weekdayDetrend(r4, d4);
    const wb = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    for (let i = 0; i < 100; i++) {
      const w = new Date(d4[i]).getDay();
      if (Number.isFinite(wd4.detrended[i])) {
        wb[w].sum += wd4.detrended[i];
        wb[w].n++;
      }
    }
    const wbMeans = wb.map((b) => (b.n > 0 ? b.sum / b.n : 0));
    const maxWbErr = Math.max(...wbMeans.map(Math.abs));
    expect(maxWbErr).toBeLessThan(1e-10);
  });

  it("T5 · Pearson r 정확도 (perfect linear)", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [2, 4, 6, 8, 10];
    const r5 = CANNIBAL_STATS.pearson(a, b);
    expect(Math.abs(r5 - 1)).toBeLessThan(1e-10);
  });
});
