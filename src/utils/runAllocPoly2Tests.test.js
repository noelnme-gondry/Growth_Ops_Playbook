import { describe, it, expect } from "vitest";
import { ALLOC_MATH } from "./allocationMath";

// Faithful reproduction of runAllocPoly2Tests() from index.html (lines 12904-13003).
// Same inputs, same expected values, same tolerances — do NOT loosen.
const A = ALLOC_MATH;
const approx = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);
const poly2 = (a, b, c) => ({
  type: "Poly2",
  predict: (x) => a * x * x + b * x + c,
  params: { a, b, c },
});

describe("runAllocPoly2Tests (golden port)", () => {
  // T1 bell(a<0): vertex=-b/2a, 위로 볼록 → 정점이 최대
  const mBell = poly2(-1, 10, 0),
    sBell = A.detectPoly2Shape(mBell);
  const mU = poly2(1, -10, 30),
    sU = A.detectPoly2Shape(mU);

  it("T1 bell 감지·vertex=5", () => {
    expect(sBell && sBell.shape === "bell" && approx(sBell.vertex, 5)).toBe(
      true,
    );
  });

  it("T2 u 감지·vertex=5", () => {
    expect(sU && sU.shape === "u" && approx(sU.vertex, 5)).toBe(true);
  });

  it("T3 비-Poly2 → null", () => {
    expect(
      A.detectPoly2Shape({ type: "Linear", params: { a: 1, b: 0 } }) === null,
    ).toBe(true);
  });

  it("T3 a=0 → null", () => {
    expect(A.detectPoly2Shape(poly2(0, 5, 1)) === null).toBe(true);
  });

  // T4 bell: cost>vertex 클램프(하강 착시 차단), cost<vertex 비클램프
  const chBell = { model: mBell, poly2Shape: sBell, xMax: 20 };
  it("T4 bell cost>vertex 클램프 → predict(5)=25", () => {
    expect(approx(A.predictSafeCpr(chBell, 8), 25)).toBe(true);
  });

  it("T4 bell cost<vertex 비클램프 → predict(3)=21", () => {
    expect(approx(A.predictSafeCpr(chBell, 3), 21)).toBe(true);
  });

  // T5 u: cost<vertex 클램프, cost>vertex 비클램프
  const chU = { model: mU, poly2Shape: sU, xMax: 20 };
  it("T5 u cost<vertex 클램프 → predict(5)=5", () => {
    expect(approx(A.predictSafeCpr(chU, 2), 5)).toBe(true);
  });

  it("T5 u cost>vertex 비클램프 → predict(8)=14", () => {
    expect(approx(A.predictSafeCpr(chU, 8), 14)).toBe(true);
  });

  // T6 xMax 하드 클램프(관측 범위 밖 외삽 차단)
  it("T6 cost>xMax 클램프 → predict(20)=230", () => {
    expect(approx(A.predictSafeCpr(chU, 25), 230)).toBe(true);
  });

  // T7 결정론
  it("T7 결정론(동일입력=동일출력)", () => {
    expect(A.predictSafeCpr(chBell, 8) === A.predictSafeCpr(chBell, 8)).toBe(
      true,
    );
  });

  // T8 sortChannelsByRecentCost: 최근 윈도우 Cost 우선, 동률 시 전체 Cost desc 폴백
  it("T8 최근윈도우 우선 정렬 + 동률 전체Cost desc 폴백", () => {
    const byChannelSort = new Map([
      ["chRecent", [{ x: 100, y: 1, date: "2024-03-01" }]],
      ["chOldHigh", [{ x: 500, y: 1, date: "2024-01-01" }]],
      ["chOldMid", [{ x: 300, y: 1, date: "2024-01-02" }]],
      ["chOldLow", [{ x: 200, y: 1, date: "2024-01-03" }]],
    ]);
    expect(
      JSON.stringify(A.sortChannelsByRecentCost(byChannelSort, 20)) ===
        JSON.stringify(["chRecent", "chOldHigh", "chOldMid", "chOldLow"]),
    ).toBe(true);
  });

  it("T8 빈 맵 → []", () => {
    expect(A.sortChannelsByRecentCost(new Map(), 20).length === 0).toBe(true);
  });
});
