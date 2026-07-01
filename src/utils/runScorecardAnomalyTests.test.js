import { describe, it, expect } from "vitest";
import { ANOMALY_MATH } from "./anomalyMath";

// Golden test port of runScorecardAnomalyTests (index.html near line 39432).
// Same inputs, same expected values — verbatim. NEVER loosen.

describe("runScorecardAnomalyTests (golden parity)", () => {
  it("T1 · 급등 감지 (50 vs ~10) → flag true, z>2.5", () => {
    // z-score: baseline [10,10,10,10,10,10,10] then 20 → z=inf? sd=0 → z=0. Use varied baseline.
    const vals = [10, 12, 8, 11, 9, 10, 13, 50]; // win=7, point at i=7 value 50
    const f = ANOMALY_MATH.detect(vals, 7, 2.5);
    const last = f[7];
    expect(last.flag && last.z > 2.5).toBe(true);
  });

  it("T2 · 정상 → flag false", () => {
    // 정상 범위 → flag false
    const vals2 = [10, 12, 8, 11, 9, 10, 13, 11];
    const f2 = ANOMALY_MATH.detect(vals2, 7, 2.5);
    expect(f2[7].flag === false).toBe(true);
  });

  it("T3 · baseline 부족 skip → z=null", () => {
    // baseline 부족 → null
    const vals = [10, 12, 8, 11, 9, 10, 13, 50];
    const f = ANOMALY_MATH.detect(vals, 7, 2.5);
    expect(f[3].z === null).toBe(true);
  });

  it("T4 · 급락(0) 감지 → flag, z<0", () => {
    // 급락 (0으로) → z 음수 flag
    const vals3 = [100, 110, 95, 105, 98, 102, 108, 0];
    const f3 = ANOMALY_MATH.detect(vals3, 7, 2.5);
    expect(f3[7].flag && f3[7].z < 0).toBe(true);
  });

  it("T5 · 요일 효과 계수 — 첫 요일 2배, 나머지 절반", () => {
    // 월(2024-01-07=일) 100, 나머지 6일 50, 다음 일요일 100 →
    // 일요일 평균 100, 총평균 = (100*2+50*6)/8=62.5 → eff[일]=100/62.5=1.6, eff[평일]=50/62.5=0.8
    const dates = [
      "2024-01-07", // Sun
      "2024-01-08", // Mon
      "2024-01-09",
      "2024-01-10",
      "2024-01-11",
      "2024-01-12",
      "2024-01-13", // Sat
      "2024-01-14", // Sun
    ];
    const vals = [100, 50, 50, 50, 50, 50, 50, 100];
    const de = ANOMALY_MATH.computeDowEffects(vals, dates);
    expect(de.totAvg).toBeCloseTo(62.5, 6);
    expect(de.eff[0]).toBeCloseTo(1.6, 6); // 일요일
    expect(de.eff[1]).toBeCloseTo(0.8, 6); // 월요일
  });

  it("T6 · DOW 보정 → 요일 계절성으로 인한 거짓 이상 억제", () => {
    // 규칙적 주말 급등(월별 100, 주말 저) 시계열: DOW 보정 OFF면 반복 스파이크가 이상으로,
    // ON이면 기대값이 요일승수로 올라가 정상 스파이크를 덜 잡음.
    const dates = [];
    const vals = [];
    // 2024-01-01(월)부터 21일: 매주 토/일(급등) 200, 평일 100
    for (let d = 1; d <= 21; d++) {
      const iso = `2024-01-${String(d).padStart(2, "0")}`;
      const dow = new Date(iso).getUTCDay();
      dates.push(iso);
      vals.push(dow === 0 || dow === 6 ? 200 : 100);
    }
    const off = ANOMALY_MATH.detect(vals, 7, 2.5, dates, null);
    const de = ANOMALY_MATH.computeDowEffects(vals, dates);
    const on = ANOMALY_MATH.detect(vals, 7, 2.5, dates, de);
    const cnt = (arr) => arr.filter((f) => f.flag).length;
    // 보정 ON 이상 개수 ≤ OFF (요일 계절성 흡수)
    expect(cnt(on)).toBeLessThanOrEqual(cnt(off));
  });
});
