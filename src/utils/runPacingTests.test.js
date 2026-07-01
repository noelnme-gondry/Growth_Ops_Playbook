import { describe, it, expect } from "vitest";
import { PACING_MATH } from "./pacingMath";

// Faithful reproduction of runPacingTests() from index.html (near line 37721).
// Same inputs, same expected values, same tolerances — do NOT loosen.

describe("runPacingTests (golden port)", () => {
  it("T1 · MTD 합산 = 1000", () => {
    // 10일 경과, 매일 100 → MTD 1000
    const daily = [];
    for (let d = 1; d <= 10; d++)
      daily.push({ date: `2026-01-${String(d).padStart(2, "0")}`, value: 100 });
    const p = PACING_MATH.pace(daily);
    expect(p.mtd).toBe(1000);
  });

  it("T2 · daysInMonth(1월) = 31", () => {
    const daily = [];
    for (let d = 1; d <= 10; d++)
      daily.push({ date: `2026-01-${String(d).padStart(2, "0")}`, value: 100 });
    const p = PACING_MATH.pace(daily);
    expect(p.daysInMonth).toBe(31);
  });

  it("T3 · 착지 예측 = 3100", () => {
    const daily = [];
    for (let d = 1; d <= 10; d++)
      daily.push({ date: `2026-01-${String(d).padStart(2, "0")}`, value: 100 });
    const p = PACING_MATH.pace(daily);
    expect(p.projected).toBe(3100);
  });

  it("T4 · 2024-02 윤년 29일", () => {
    const f = PACING_MATH.pace([{ date: "2024-02-05", value: 50 }]);
    expect(f.daysInMonth).toBe(29);
  });

  it("T5 · 요일 균등 → weekday = linear (항등식)", () => {
    // 2026-01-01(목)~2026-01-28(수): 4주 = 28일, 요일당 4개 → ok=true
    const daily28 = [];
    for (let d = 1; d <= 28; d++)
      daily28.push({ date: `2026-01-${String(d).padStart(2, "0")}`, value: 100 });
    const pw5 = PACING_MATH.paceWeekday(daily28);
    const lin5 = PACING_MATH.pace(daily28);
    expect(pw5 && !pw5.fallback).toBe(true);
    expect(Math.abs(pw5.weekdayProjected - lin5.projected) < 1).toBe(true);
  });

  it("T6 · 데이터 부족 → fallback true", () => {
    // 7일 → 요일당 1~2개 → fallback:true
    const daily7 = [];
    for (let d = 1; d <= 7; d++)
      daily7.push({ date: `2026-01-${String(d).padStart(2, "0")}`, value: 100 });
    const pw6 = PACING_MATH.paceWeekday(daily7);
    expect(pw6?.fallback).toBe(true);
  });

  it("T7 · 결정론 — weekdayProjected 2회 동일", () => {
    const daily28 = [];
    for (let d = 1; d <= 28; d++)
      daily28.push({ date: `2026-01-${String(d).padStart(2, "0")}`, value: 100 });
    const pw7a = PACING_MATH.paceWeekday(daily28);
    const pw7b = PACING_MATH.paceWeekday(daily28);
    expect(pw7a?.weekdayProjected === pw7b?.weekdayProjected).toBe(true);
  });
});
