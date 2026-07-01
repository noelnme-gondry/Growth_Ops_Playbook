import { describe, it, expect } from "vitest";
import {
  fitPowerCurve,
  fitLogCurve,
  buildQualityData,
  buildMaturationResult,
  COHORT_MATURATION,
  COHORT_MAT_STATE,
  retentionHeatColor,
} from "./cohortMath.js";

// Golden test port of index.html `runQualityTests` (near line 36315).
// Same inputs, expected values, tolerances — verbatim.
// CSV_STATE-dependent index tests (T4/T11/T12) ported via buildQualityData /
// buildMaturationResult with the SAME raw rows + mapping passed explicitly.
describe("runQualityTests (golden port)", () => {
  // T1: power fit on y = 2*x^0.5
  it("T1 · Power fit (y=2·x^0.5)", () => {
    const xs = [1, 2, 4, 9, 16, 25];
    const ys = xs.map((x) => 2 * Math.pow(x, 0.5));
    const pwr = fitPowerCurve(xs, ys);
    const errA = pwr ? Math.abs(pwr.a - 2) : 1;
    const errB = pwr ? Math.abs(pwr.b - 0.5) : 1;
    expect(errA < 1e-9 && errB < 1e-9).toBe(true);
  });

  // T2: log fit on y = 500*ln(x) + 100 (누적 LTV 성장 패턴)
  it("T2 · Log fit (y=500·ln(x)+100)", () => {
    const xs2 = [1, 7, 14, 30, 60, 90];
    const ys2 = xs2.map((x) => 500 * Math.log(x) + 100);
    const lg = fitLogCurve(xs2, ys2);
    const errA2 = lg ? Math.abs(lg.a - 500) : 1;
    const errB2 = lg ? Math.abs(lg.b - 100) : 1;
    expect(errA2 < 1e-6 && errB2 < 1e-6).toBe(true);
  });

  // T3: 외삽 결정론
  it("T3 · Power fit 결정론", () => {
    const pwr1 = fitPowerCurve([1, 2, 4], [1, 1.4142, 2]);
    const pwr2 = fitPowerCurve([1, 2, 4], [1, 1.4142, 2]);
    const same = pwr1 && pwr2 && pwr1.a === pwr2.a && pwr1.b === pwr2.b;
    expect(same).toBe(true);
  });

  // T4: PUR — buildQualityCache가 purMean을 retentionCurve에 올바르게 계산하는지
  // 단일 코호트: size=1000, day=7, retained=300, payments=60 → pur=0.06
  it("T4 · PUR dayMap (60/1000=0.06)", () => {
    const mapping = {
      cohort_date: "cohort_date",
      day_offset: "day_offset",
      cohort_size: "cohort_size",
      retained_users: "retained_users",
      cohort_payments: "cohort_payments",
    };
    const raw = [
      {
        cohort_date: "2025-01-01",
        day_offset: "7",
        cohort_size: "1000",
        retained_users: "300",
        cohort_payments: "60",
      },
    ];
    const qc = buildQualityData(raw, mapping);
    const purPt = qc.retentionCurve.find((d) => d.day === 7);
    const purOk = purPt != null && Math.abs(purPt.purMean - 0.06) < 1e-9;
    expect(purOk).toBe(true);
  });

  // T5: COHORT_MATURATION — 경험적 비율 예측 (revenue)
  // 35개 성숙 코호트, 각 D7=10, D30=20 (비율=2.0)
  // 새 코호트 D7=15 → predict D30 = 15*2.0 = 30.0
  const makeT5Cohorts = (n) => {
    const cs = [];
    for (let i = 0; i < n; i++) {
      const dStr = `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
      cs.push({
        cohort_date: dStr,
        size: 1000,
        points: [
          { day: 7, retentionRate: 0.5, arpu: 10, pur: 0.02 },
          { day: 30, retentionRate: 0.3, arpu: 20, pur: 0.04 },
        ],
      });
    }
    return cs;
  };
  const matureCohorts = makeT5Cohorts(35);
  const asOf = "2025-06-01";

  it("T5 · COHORT_MATURATION 경험적 비율=2.0", () => {
    const res = COHORT_MATURATION.predict(matureCohorts, asOf, "revenue", {
      anchorDn: 7,
      horizons: [30],
    });
    const ent30 = res.avgCurve.find((e) => e.n === 30);
    const ratioOk =
      ent30 &&
      ent30.method === "empirical" &&
      Math.abs(ent30.avgRatio - 2.0) < 1e-6;
    expect(ratioOk).toBe(true);
  });

  it("T5b · COHORT_MATURATION 코호트별 예측(D7=15→D30=30)", () => {
    const newCohort = [
      {
        cohort_date: "2025-05-28",
        size: 500,
        points: [{ day: 7, retentionRate: 0.5, arpu: 15, pur: 0.03 }],
      },
    ];
    const allCs = [...matureCohorts, ...newCohort];
    const res2 = COHORT_MATURATION.predict(allCs, asOf, "revenue", {
      anchorDn: 7,
      horizons: [30],
    });
    const newEntry = res2.byCohort.find((c) => c.cohort_date === "2025-05-28");
    const pred30 = newEntry?.predicted.find((p) => p.n === 30);
    const pred30Ok = pred30 && Math.abs(pred30.v - 30) < 1e-4;
    expect(pred30Ok).toBe(true);
  });

  // T6: 성숙 코호트 부족 → 곡선 폴백 (5개 < maturedMinDaily=30)
  it("T6 · COHORT_MATURATION 부족→폴백", () => {
    const fewCohorts = [];
    for (let i = 0; i < 5; i++) {
      fewCohorts.push({
        cohort_date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        size: 1000,
        points: [
          { day: 1, retentionRate: 0.9, arpu: 2, pur: 0.01 },
          { day: 7, retentionRate: 0.5, arpu: 10, pur: 0.02 },
          { day: 14, retentionRate: 0.4, arpu: 14, pur: 0.03 },
          { day: 30, retentionRate: 0.3, arpu: 18, pur: 0.04 },
        ],
      });
    }
    const res = COHORT_MATURATION.predict(fewCohorts, "2025-06-01", "revenue", {
      anchorDn: 7,
      horizons: [90],
    });
    const ent90 = res.avgCurve.find((e) => e.n === 90);
    const isCurve =
      ent90 && (ent90.method === "curve" || ent90.method === "insufficient");
    expect(isCurve).toBe(true);
  });

  // T7: COHORT_MATURATION 결정론
  it("T7 · COHORT_MATURATION 결정론", () => {
    const dcs = [];
    for (let i = 0; i < 35; i++) {
      dcs.push({
        cohort_date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        size: 500,
        points: [
          { day: 7, retentionRate: 0.5, arpu: 8 + i * 0.1, pur: 0.02 },
          { day: 30, retentionRate: 0.3, arpu: 15 + i * 0.1, pur: 0.04 },
        ],
      });
    }
    const r1 = COHORT_MATURATION.predict(dcs, "2025-06-01", "revenue", {
      anchorDn: 7,
      horizons: [30],
    });
    const r2 = COHORT_MATURATION.predict(dcs, "2025-06-01", "revenue", {
      anchorDn: 7,
      horizons: [30],
    });
    const e1 = r1.avgCurve.find((e) => e.n === 30),
      e2 = r2.avgCurve.find((e) => e.n === 30);
    const det =
      e1 &&
      e2 &&
      e1.avgRatio === e2.avgRatio &&
      e1.maturedCount === e2.maturedCount;
    expect(det).toBe(true);
  });

  // T8: 단조 보정 — revenue 비감소
  it("T8 · 단조 보정 revenue(D30:8→10)", () => {
    const monoTest = [
      { n: 7, v: 10 },
      { n: 30, v: 8 }, // 의도적으로 감소 → 보정 후 10
      { n: 90, v: 12 },
    ];
    COHORT_MATURATION.monoCorrect(monoTest, "revenue");
    const mono8 = monoTest.find((p) => p.n === 30);
    expect(mono8 && mono8.v === 10).toBe(true);
  });

  // T9: 단조 보정 — retention 비증가
  it("T9 · 단조 보정 retention(D30:0.6→0.5)", () => {
    const retTest = [
      { n: 7, v: 0.5 },
      { n: 30, v: 0.6 }, // 의도적으로 증가 → 보정 후 0.5
      { n: 90, v: 0.2 },
    ];
    COHORT_MATURATION.monoCorrect(retTest, "retention");
    const ret30 = retTest.find((p) => p.n === 30);
    expect(ret30 && Math.abs(ret30.v - 0.5) < 1e-9).toBe(true);
  });

  // T10: COHORT_MAT_STATE 초기값
  it("T10 · COHORT_MAT_STATE 초기값", () => {
    expect(
      COHORT_MAT_STATE.metric === "revenue" && COHORT_MAT_STATE.anchorDn === 7,
    ).toBe(true);
  });

  // T11: buildMaturationCache — 코호트 없을 때 result=null
  it("T11 · buildMaturationCache 빈 코호트 → null", () => {
    const qc = buildQualityData([], {});
    const r = buildMaturationResult(qc.cohorts);
    expect(r === null).toBe(true);
  });

  // T12: renderQualityMaturation — §7 섹션 포함 + throw 없음
  // 렌더층(문자열 HTML)은 v2 컴포넌트로 이관 → 여기서는 엔진 계약(35 성숙 코호트 →
  // buildMaturationResult가 non-null·non-throw)으로 동등 검증.
  it("T12 · 성숙도 결과 non-null(35 코호트)", () => {
    const mapping = {
      cohort_date: "cohort_date",
      day_offset: "day_offset",
      cohort_size: "cohort_size",
      retained_users: "retained_users",
    };
    const raw = [];
    for (let i = 0; i < 35; i++) {
      const dStr = `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
      raw.push({
        cohort_date: dStr,
        day_offset: "7",
        cohort_size: "1000",
        retained_users: "500",
      });
      raw.push({
        cohort_date: dStr,
        day_offset: "30",
        cohort_size: "1000",
        retained_users: "300",
      });
    }
    let pass = false;
    try {
      const qc = buildQualityData(raw, mapping);
      const mc = buildMaturationResult(qc.cohorts);
      pass =
        qc.cohorts.length === 35 &&
        mc != null &&
        mc.retention != null &&
        Array.isArray(mc.retention.avgCurve);
    } catch {
      pass = false;
    }
    expect(pass).toBe(true);
  });

  // T13: retentionHeatColor — 순수함수 결정론 + 단조성 + null가드 + 실측/예측 구분
  it("T13 · retentionHeatColor 단조성/null가드/실측-예측 구분", () => {
    const c0 = retentionHeatColor(0, false);
    const c25 = retentionHeatColor(0.25, false);
    const c100 = retentionHeatColor(1, false);
    const c50 = retentionHeatColor(0.5, false);
    const cPred50 = retentionHeatColor(0.5, true);
    const cNull = retentionHeatColor(null, false);
    const alphaOf = (s) => {
      const m = /,([\d.]+)\)$/.exec(s);
      return m ? parseFloat(m[1]) : null;
    };
    const a25 = alphaOf(c25),
      a50 = alphaOf(c50),
      a100 = alphaOf(c100),
      aPred50 = alphaOf(cPred50);
    const pass13 =
      c0 === "transparent" &&
      cNull === "transparent" &&
      a25 != null &&
      a50 != null &&
      a100 != null &&
      a25 < a50 &&
      a50 < a100 && // 단조 증가
      aPred50 != null &&
      aPred50 < a50 && // 예측은 실측보다 옅음(같은 rate)
      retentionHeatColor(0.5, false) === c50; // 결정론(재호출 동일)
    expect(pass13).toBe(true);
  });
});
