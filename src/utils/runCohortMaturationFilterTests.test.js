import { describe, it, expect } from "vitest";
import { filterMaturedCohorts, todayMidnightTs } from "./cohortMath.js";

// Golden test for filterMaturedCohorts (§7 코호트 마감 필터, index.html 이식).
// 검증: (a) maturedOnly=false → 원본 그대로 (b) day<=0 → 원본 그대로
// (c) mixed mature/immature rows produce a genuinely DIFFERENT (smaller) subset
// when maturedOnly=true, using an injected nowTs close to the data range
// (d) nowTs far in the future vs. old demo data → toggle has NO visible effect
// (this is the documented "data artifact" scenario, not a code bug — see
// CohortTab item #7 investigation: with real wall-clock now() far ahead of a
// fixed-date demo CSV, every cohort already reads as "mature" regardless of
// the toggle, so the filter degenerates to a no-op on THAT dataset only).
describe("filterMaturedCohorts (golden)", () => {
  const rows = [];
  for (let d = 1; d <= 20; d++) {
    rows.push({ date: `2026-01-${String(d).padStart(2, "0")}`, ret_d7: 0.3 });
  }

  it("T1 · maturedOnly=false → 원본 그대로 (no-op)", () => {
    const out = filterMaturedCohorts(rows, 7, false, Date.UTC(2026, 0, 20));
    expect(out).toBe(rows); // same reference, not just same length
    expect(out.length).toBe(20);
  });

  it("T2 · day<=0 → maturedOnly과 무관하게 원본 그대로", () => {
    const out0 = filterMaturedCohorts(rows, 0, true, Date.UTC(2026, 0, 20));
    const outNeg = filterMaturedCohorts(rows, -1, true, Date.UTC(2026, 0, 20));
    expect(out0).toBe(rows);
    expect(outNeg).toBe(rows);
  });

  it("T3 · mixed mature/immature rows + nowTs close to data → toggle produces a genuinely different (smaller) subset", () => {
    // nowTs = 2026-01-20 자정, day=7 → cutoff = 2026-01-13.
    // 2026-01-01~13(13개)은 마감(>=D7 지남), 2026-01-14~20(7개)은 미마감.
    const nowTs = Date.UTC(2026, 0, 20);
    const off = filterMaturedCohorts(rows, 7, false, nowTs);
    const on = filterMaturedCohorts(rows, 7, true, nowTs);
    expect(off.length).toBe(20);
    expect(on.length).toBe(13);
    expect(on.every((r) => Date.parse(r.date) <= nowTs - 7 * 86400000)).toBe(true);
    // Sanity: genuinely fewer rows, not identical output (this is the assertion
    // that would fail if the filter/day computation were broken).
    expect(on.length).not.toBe(off.length);
  });

  it("T4 · nowTs 훨씬 미래(실제 wall-clock 시뮬레이션) vs 과거 고정 데모 데이터 → 토글이 무변화(데이터 아티팩트, 버그 아님)", () => {
    // 데모 CSV가 2026-01월 고정 날짜인데 실제 '오늘'이 2026-07-01이면
    // 모든 코호트가 이미 D30조차 마감된 상태 → 토글 on/off 결과 동일(정상 동작).
    const farFutureNow = todayMidnightTs(new Date("2026-07-01"));
    for (const day of [1, 7, 30]) {
      const off = filterMaturedCohorts(rows, day, false, farFutureNow);
      const on = filterMaturedCohorts(rows, day, true, farFutureNow);
      expect(on.length).toBe(off.length);
      expect(on.length).toBe(20);
    }
  });

  it("T5 · nowTs 미주입 시 실제 오늘(todayMidnightTs()) 사용 — 인자 생략 경로도 실행됨 확인", () => {
    // 4번째 인자 생략 시 크래시 없이 기본값(실제 오늘) 경로를 타는지만 확인
    // (값 자체는 실행 시점의 실제 날짜에 의존하므로 여기서는 타입/무오류만 검증).
    expect(() => filterMaturedCohorts(rows, 7, true)).not.toThrow();
    const out = filterMaturedCohorts(rows, 7, true);
    expect(Array.isArray(out)).toBe(true);
  });
});
