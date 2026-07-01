// Golden test ported VERBATIM from index.html runCreativeTests (near line 18741).
// Locks 5-6 Creative Analyzer pure-math regressions (Phase 8 deploy gate).
// Inputs / expected / tolerances reproduce the index test exactly — no loosening.
import { describe, it, expect } from "vitest";
import { CREATIVE_MATH, CREATIVE_STATS, CREATIVE_FATIGUE } from "./creativeMath";

// index.html CREATIVE_CONFIG의 하위 객체(테스트에 쓰이는 부분만 verbatim 복제).
const CREATIVE_CONFIG = {
  minImpressions: 1000,
  decompose: {
    metrics: ["ctr", "cvr"],
    vifThreshold: 5.0,
    vifDropPriority: ["duration_bucket", "has_text_overlay"],
  },
  fatigueAlert: {
    minDays: 7,
    trendWindow: 14,
    ctrWeight: 0.45,
    freqWeight: 0.35,
    cpmWeight: 0.2,
    alertScore: 0.5,
    horizonDays: 30,
  },
  autoPlanner: {
    defaultWeeklyVelocity: 3,
    urgentDays: 7,
    soonDays: 21,
  },
};

describe("runCreativeTests (golden, ported from index.html)", () => {
  // T1: WLS 항등식 — 정확히 선형 데이터 (y = 2 + 3*x)
  it("T1 · WLS 정확도 (y = 2 + 3x)", () => {
    const X1 = [
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
    ];
    const y1 = [5, 8, 11, 14, 17];
    const w1 = [1, 1, 1, 1, 1];
    const fit1 = CREATIVE_MATH.wlsSolve(X1, y1, w1);
    const errSlope = fit1 ? Math.abs(fit1.beta[1] - 3) : 1;
    const errInt = fit1 ? Math.abs(fit1.beta[0] - 2) : 1;
    expect(errSlope < 1e-9 && errInt < 1e-9).toBe(true);
  });

  // T2: BH 보정 항등식 — 단조 비감소
  it("T2 · BH adjustment 단조 비감소", () => {
    const pvals = [0.01, 0.04, 0.03, 0.005, 0.5];
    const bh = CREATIVE_STATS.bhAdjust(pvals);
    const sortedAdj = pvals
      .map((p, i) => ({ p, adj: bh[i] }))
      .sort((a, b) => a.p - b.p)
      .map((x) => x.adj);
    let monotone = true;
    for (let i = 1; i < sortedAdj.length; i++)
      if (sortedAdj[i] < sortedAdj[i - 1] - 1e-9) monotone = false;
    expect(monotone).toBe(true);
  });

  // T3: Pearson Bayesian P(B>A) 한쪽 극단
  it("T3 · Bayes P(B>A) 강한 차이 (B 압승)", () => {
    const probBig = CREATIVE_STATS.betaProbGreater(10, 1000, 100, 1000, 500);
    expect(probBig > 0.999).toBe(true);
  });

  // T4: deriveMetrics — 분모 0 → null
  it("T4 · safeDiv 분모 0 → null", () => {
    const m4 = CREATIVE_STATS.deriveMetrics([
      { creative_id: "A", impressions: 0, clicks: 5, installs: 0, spend: 100 },
      { creative_id: "A", impressions: 0, clicks: 5, installs: 0, spend: 100 },
    ]);
    expect(m4[0].ctr === null && m4[0].cpi === null).toBe(true);
  });

  // T5: VIF — 동일 컬럼 2개 → 매우 큰 VIF
  it("T5 · VIF 완전 collinear → ∞", () => {
    const Xvif = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ];
    const vifs = CREATIVE_MATH.vif(Xvif);
    expect(Math.max(...vifs) > 100).toBe(true);
  });

  // T6: 결정론 — 같은 입력 두 번 → 동일 결과
  it("T6 · Bayesian 결정론 (Math.random 없음)", () => {
    const r1 = CREATIVE_STATS.betaProbGreater(50, 100, 60, 100, 500);
    const r2 = CREATIVE_STATS.betaProbGreater(50, 100, 60, 100, 500);
    expect(r1 === r2).toBe(true);
  });

  // T7: CREATIVE_FATIGUE.olsSlope — 정확한 선형 시리즈 (y = 1 + 2*x)
  it("T7 · CREATIVE_FATIGUE.olsSlope 정확도 (y=1+2x)", () => {
    const olsFit = CREATIVE_FATIGUE.olsSlope([1, 3, 5, 7, 9]);
    expect(
      olsFit &&
        Math.abs(olsFit.slope - 2) < 1e-9 &&
        Math.abs(olsFit.intercept - 1) < 1e-9,
    ).toBe(true);
  });

  // T8: compositeIndex — 악화 시나리오 → 높은 score(위험)
  it("T8 · compositeIndex 악화 시나리오 → 높은 score", () => {
    const declineDays = Array.from({ length: 14 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      ctr: 0.05 - i * 0.003,
      impressions: 1000 + i * 200,
      cpm: 5 + i * 0.5,
    }));
    const idxBad = CREATIVE_FATIGUE.compositeIndex(
      declineDays,
      CREATIVE_CONFIG.fatigueAlert,
    );
    expect(
      idxBad &&
        idxBad.score > 0.5 &&
        idxBad.ctrTrendPctPerDay < 0 &&
        idxBad.freqTrendPctPerDay > 0 &&
        idxBad.cpmTrendPctPerDay > 0,
    ).toBe(true);
  });

  // T9: compositeIndex — 완전 평탄 → score ≈ 0
  it("T9 · compositeIndex 평탄 시나리오 → score≈0", () => {
    const flatDays = Array.from({ length: 14 }, (_, i) => ({
      date: `2024-02-${String(i + 1).padStart(2, "0")}`,
      ctr: 0.05,
      impressions: 1000,
      cpm: 5,
    }));
    const idxFlat = CREATIVE_FATIGUE.compositeIndex(
      flatDays,
      CREATIVE_CONFIG.fatigueAlert,
    );
    expect(idxFlat && idxFlat.score < 0.01).toBe(true);
  });

  // T10: projectThreshold — 악화→eta 산출, 평탄→null
  it("T10 · projectThreshold (악화→eta 산출, 평탄→null)", () => {
    const declineDays = Array.from({ length: 14 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      ctr: 0.05 - i * 0.003,
      impressions: 1000 + i * 200,
      cpm: 5 + i * 0.5,
    }));
    const flatDays = Array.from({ length: 14 }, (_, i) => ({
      date: `2024-02-${String(i + 1).padStart(2, "0")}`,
      ctr: 0.05,
      impressions: 1000,
      cpm: 5,
    }));
    const projBad = CREATIVE_FATIGUE.projectThreshold(
      declineDays,
      CREATIVE_CONFIG.fatigueAlert,
    );
    const projFlat = CREATIVE_FATIGUE.projectThreshold(
      flatDays,
      CREATIVE_CONFIG.fatigueAlert,
    );
    expect(
      (projBad.etaDays !== null || projBad.reason === "이미 임계 도달") &&
        projFlat.etaDays === null,
    ).toBe(true);
  });

  // T11: buildPlan 우선순위(alert 우선) + ganttBuckets 합 보존
  it("T11 · buildPlan 우선순위(alert 우선) + ganttBuckets 합 보존", () => {
    const synthAlerts = [
      {
        creative_id: "low",
        channel: "fb",
        days: 20,
        score: 0.2,
        alert: false,
        etaDays: 25,
        etaReason: "추세 외삽",
      },
      {
        creative_id: "urgent",
        channel: "fb",
        days: 20,
        score: 0.8,
        alert: true,
        etaDays: 0,
        etaReason: "이미 임계 도달",
      },
      {
        creative_id: "mid",
        channel: "ig",
        days: 20,
        score: 0.4,
        alert: false,
        etaDays: 10,
        etaReason: "추세 외삽",
      },
    ];
    const planT11 = CREATIVE_FATIGUE.buildPlan(
      synthAlerts,
      1,
      CREATIVE_CONFIG.autoPlanner,
    );
    const firstId = planT11.plan[0]?.creative_id;
    const bucketsT11 = CREATIVE_FATIGUE.ganttBuckets(planT11.plan, 8);
    const totalBucketed = bucketsT11.reduce((s, b) => s + b.items.length, 0);
    expect(
      firstId === "urgent" &&
        totalBucketed === 3 &&
        planT11.urgentCount === 1,
    ).toBe(true);
  });

  // T12: decompose CPA — format=video가 image보다 CPA 높음(나쁨) → 양의 coef.
  // cpa 경로의 valid 필터·_metricVal(spend/actions)·_w(actions) 가중을 함께 검증.
  it("T12 · decompose CPA (video format이 CPA↑ → 양의 coef)", () => {
    const rows = [];
    // 결정론 데이터: 40 소재, format 2종(image/video), channel 2종, 날짜 분산(iso_week).
    for (let i = 0; i < 40; i++) {
      const isVideo = i % 2 === 0;
      const format = isVideo ? "video" : "image";
      const channel = i % 4 < 2 ? "fb" : "ig";
      const day = String((i % 27) + 1).padStart(2, "0");
      const spend = 1000 + (i % 5) * 50;
      // video는 액션당 비용 높음(CPA=spend/actions↑): actions를 적게.
      const actions = isVideo ? 20 + (i % 3) : 40 + (i % 3);
      rows.push({
        creative_id: `c${i}`,
        date: `2024-03-${day}`,
        channel,
        format,
        impressions: 5000 + (i % 7) * 100,
        clicks: 200,
        installs: 60,
        actions,
        spend,
        revenue_d7: 1500 + (i % 5) * 40,
      });
    }
    const res = CREATIVE_STATS.decompose(
      rows,
      { metric: "cpa", attributes: ["format"] },
      CREATIVE_CONFIG,
    );
    const fx = (res.effects || []).find(
      (e) => e.factor === "format" && e.level === "video",
    );
    // video ref(image)=흔한 level이 아닐 수도 있으니 부호는 방향만 확인: CPA 높은 쪽 계수가 양.
    // ref가 image면 video coef>0, ref가 video면 image coef<0.
    const okCpa = fx
      ? fx.ref === "image"
        ? fx.coef > 0
        : fx.coef < 0
      : false;
    expect(res.diag.n >= 30 && (res.effects || []).length > 0 && okCpa).toBe(
      true,
    );
  });

  // T13: decompose ROAS — 결정론 재현성 + roas 경로(_metricVal=rev/spend, _w=spend) 동작.
  it("T13 · decompose ROAS 경로 동작 + 결정론", () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const isVideo = i % 2 === 0;
      const format = isVideo ? "video" : "image";
      const channel = i % 4 < 2 ? "fb" : "ig";
      const day = String((i % 27) + 1).padStart(2, "0");
      const spend = 1000 + (i % 5) * 50;
      rows.push({
        creative_id: `c${i}`,
        date: `2024-03-${day}`,
        channel,
        format,
        impressions: 5000 + (i % 7) * 100,
        clicks: 200,
        installs: 60,
        actions: 30,
        spend,
        // video ROAS 높게(rev/spend↑)
        revenue_d7: isVideo ? spend * 3 : spend * 1.5,
      });
    }
    const opts = { metric: "roas", attributes: ["format"] };
    const r1 = CREATIVE_STATS.decompose(rows, opts, CREATIVE_CONFIG);
    const r2 = CREATIVE_STATS.decompose(rows, opts, CREATIVE_CONFIG);
    expect(
      r1.diag.n >= 30 &&
        (r1.effects || []).length > 0 &&
        JSON.stringify(r1.effects) === JSON.stringify(r2.effects),
    ).toBe(true);
  });
});
