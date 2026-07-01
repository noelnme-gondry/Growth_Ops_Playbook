import { describe, it, expect } from "vitest";
import { LTVCAC_MATH, buildLtvData } from "./ltvMath.js";
import { getMappedRows } from "./dashboardAggregator.js";

// Golden test port of index.html `runLtvCacTests` (near line 37235).
// Same inputs, expected values, tolerances — verbatim.
describe("runLtvCacTests (golden port)", () => {
  // T1: power fit 정확 (arpu = 1*(day+1)^0.5 → D0=1, D7≈2.83, D14≈3.87)
  const fit = LTVCAC_MATH.fitCumArpu([
    { day: 0, arpu: 1 },
    { day: 7, arpu: Math.sqrt(8) },
    { day: 14, arpu: Math.sqrt(15) },
  ]);

  it("T1 · cumARPU power fit ~5.57 @D30", () => {
    const pred30 = fit ? fit.predict(30) : null; // sqrt(31)=5.567
    expect(pred30).not.toBeNull();
    expect(Math.abs(pred30 - Math.sqrt(31))).toBeLessThan(1e-6);
  });

  it("T2 · payback day (CAC=3) === 8", () => {
    // CAC=3, fit sqrt(day+1) → 도달 day where sqrt(d+1)>=3 → d+1>=9 → d=8
    const pb = LTVCAC_MATH.paybackDay(fit, 3);
    expect(pb).toBe(8);
  });

  it("T3 · 미회수 → null", () => {
    const pb2 = LTVCAC_MATH.paybackDay(fit, 9999);
    expect(pb2).toBe(null);
  });

  it("T4 · safeDiv 분모0 → null", () => {
    expect(LTVCAC_MATH.safeDiv(5, 0)).toBe(null);
  });

  it("T5 · 결정론 identical", () => {
    const a5 = LTVCAC_MATH.fitCumArpu([
      { day: 0, arpu: 2 },
      { day: 7, arpu: 4 },
    ]).predict(30);
    const b5 = LTVCAC_MATH.fitCumArpu([
      { day: 0, arpu: 2 },
      { day: 7, arpu: 4 },
    ]).predict(30);
    expect(a5).toBe(b5);
  });

  // T6: 관측마감 판정 — arpuByDay에 D14까지만 있으면 D90 호출 시 predicted=true
  const unitObs = {
    arpu0: 10,
    arpu7: 20,
    arpu14: 28,
    arpuByDay: { 0: 10, 7: 20, 14: 28 },
    observedDays: [0, 7, 14],
    fit: LTVCAC_MATH.fitCumArpu([
      { day: 0, arpu: 10 },
      { day: 7, arpu: 20 },
      { day: 14, arpu: 28 },
    ]),
    ratioByDay: { 0: 10 / 28, 7: 20 / 28, 14: 1 },
    ratioBase: 28,
  };
  const r14 = LTVCAC_MATH.ltvPredict(unitObs, 14);
  const r90 = LTVCAC_MATH.ltvPredict(unitObs, 90);

  it("T6a · 관측마감=D14 → D14 predicted=false", () => {
    expect(r14.predicted).toBe(false);
  });

  it("T6b · 관측마감=D14 → D90 predicted=true", () => {
    expect(r90.predicted).toBe(true);
  });

  it("T6c · D90 value not null (비율법)", () => {
    expect(r90.value != null).toBe(true);
  });

  // T7: 표=차트 SSOT — ltvPredict로 동일 함수 경로
  const unitSimple = {
    arpu0: 5,
    arpu7: 8,
    arpu14: 10,
    arpuByDay: { 0: 5, 7: 8, 14: 10 },
    observedDays: [0, 7, 14],
    fit: LTVCAC_MATH.fitCumArpu([
      { day: 0, arpu: 5 },
      { day: 7, arpu: 8 },
      { day: 14, arpu: 10 },
    ]),
    ratioByDay: {},
    ratioBase: null,
  };

  it("T7 · 표=차트 SSOT byte-동일(D14)", () => {
    const tbl14 = LTVCAC_MATH.ltvPredict(unitSimple, 14);
    const chart14 = LTVCAC_MATH.ltvPredict(unitSimple, 14);
    expect(tbl14.value === chart14.value).toBe(true);
  });

  // T8: buildLtvData 실사용 시나리오 회귀 — CSV 원본 헤더가 표준키와 이름이 다른
  // 경우(실사용 케이스 100%). getMappedRows()로 표준키 매핑된 rows를 넘겼을 때
  // unitField/revenue_dN을 mapping[...]으로 재조회하면 항상 undefined가 되어
  // 전부 0/null이 나오던 버그(#6) 회귀 방지. mapping은 { origHeader: standardKey }.
  it("T8 · buildLtvData: 원본 헤더≠표준키 매핑에서도 CAC·LTV·ratio가 0이 아님", () => {
    const raw = [
      { Date: "2026-06-01", Channel: "Meta", Cost: "100", Installs: "50", "Rev D0": "10", "Rev D7": "40", "Rev D14": "70" },
      { Date: "2026-06-02", Channel: "Meta", Cost: "100", Installs: "50", "Rev D0": "12", "Rev D7": "42", "Rev D14": "72" },
    ];
    const mapping = {
      Date: "date",
      Channel: "channel",
      Cost: "cost",
      Installs: "installs",
      "Rev D0": "revenue_d0",
      "Rev D7": "revenue_d7",
      "Rev D14": "revenue_d14",
    };
    const mappedRows = getMappedRows({ raw, mapping });
    const out = buildLtvData(mappedRows, mapping, "channel", 14, "installs");

    expect(out.length).toBe(1);
    const unit = out[0];
    expect(unit.unit).toBe("Meta"); // grouping key resolved, not "(미지정)"
    expect(unit.cost).toBe(200);
    expect(unit.users).toBe(100);
    expect(unit.cac).toBe(2);
    expect(unit.arpu14).not.toBeNull();
    expect(unit.arpu14).toBeGreaterThan(0);
    expect(unit.ltvAtHorizon).not.toBeNull();
    expect(unit.ltvAtHorizon).toBeGreaterThan(0);
    expect(unit.ratio).not.toBeNull();
    expect(unit.ratio).toBeGreaterThan(0);
    expect(unit.payback).not.toBeNull();
  });
});
