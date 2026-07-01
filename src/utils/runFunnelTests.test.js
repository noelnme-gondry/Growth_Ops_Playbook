import { describe, it, expect } from "vitest";
import { FUNNEL_MATH, buildFunnelData } from "./funnelMath.js";

// Golden test port of index.html `runFunnelTests` (near line 38377).
// Same inputs, expected values, tolerances (1e-9) — verbatim.
// CVR primitive routed through FUNNEL_MATH.cvr; weekday additive re-centering
// through FUNNEL_MATH.applyWeekdayAdj.
describe("runFunnelTests (golden port)", () => {
  const cvr = (cur, prev) => FUNNEL_MATH.cvr(cur, prev);

  it("T1 · CTR 10%", () => {
    // impr 1000, clk 100 → CTR 10%
    expect(cvr(100, 1000)).toBe(0.1);
  });

  it("T2 · 설치CVR 20%", () => {
    // clk 100, inst 20 → CVR 20%
    expect(cvr(20, 100)).toBe(0.2);
  });

  it("T3 · 분모0 → null", () => {
    expect(cvr(5, 0)).toBe(null);
  });

  // T4: 요일 보정 additive 수학 검증
  // 합성: 평일 CVR 0.10 × 15일, 주말 CVR 0.30 × 6일 (3주, 2025-01-06 월요일 시작)
  // 기대: weekdayAdjOk=true, cvrAdj = cvr - grpMean[bucket] + dailyMean → 평일/주말 모두 dailyMean으로 수렴
  function buildSynDaily() {
    const _synDaily = [];
    const _start = new Date("2025-01-06"); // 월요일
    for (let i = 0; i < 21; i++) {
      const d = new Date(_start.getTime() + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const wd = d.getDay();
      const cvrV = wd === 0 || wd === 6 ? 0.3 : 0.1;
      _synDaily.push({ date: iso, cvr: cvrV });
    }
    return _synDaily;
  }
  function meanSd(daily) {
    const _valid = daily.filter((x) => x.cvr != null);
    const _dm = _valid.reduce((s, x) => s + x.cvr, 0) / _valid.length;
    const _sd = Math.sqrt(
      _valid.reduce((s, x) => s + (x.cvr - _dm) ** 2, 0) / _valid.length,
    );
    return { _dm, _sd };
  }

  const _synDaily = buildSynDaily();
  const { _dm, _sd } = meanSd(_synDaily);
  const { weekdayProfile, weekdayAdjOk } = FUNNEL_MATH.applyWeekdayAdj(
    _synDaily,
    _dm,
    _sd,
  );

  it("T4 · weekdayAdjOk=true(각 그룹 ≥3)", () => {
    expect(weekdayAdjOk).toBe(true);
  });

  it("T4b · cvrAdj=dailyMean(additive 항등식)", () => {
    // 보정 후 cvrAdj는 모두 _dm으로 수렴해야 함 (additive 항등식)
    const _adjConverge =
      weekdayAdjOk &&
      _synDaily.every(
        (x) => x.cvrAdj != null && Math.abs(x.cvrAdj - _dm) < 1e-9,
      );
    expect(_adjConverge).toBe(true);
  });

  it("T4c · 그룹 표본 수 정확(평일15·주말6)", () => {
    expect(weekdayProfile.nWeekday).toBe(15);
    expect(weekdayProfile.nWeekend).toBe(6);
  });

  it("T4d · 결정론 — 2회 adjConverge 동일", () => {
    const run = () => {
      const s = buildSynDaily();
      const { _dm: dm } = meanSd(s);
      FUNNEL_MATH.applyWeekdayAdj(s, dm, meanSd(s)._sd);
      return s.every(
        (x) => x.cvrAdj != null && Math.abs(x.cvrAdj - dm) < 1e-9,
      )
        ? "same"
        : "diff";
    };
    expect(run()).toBe("same");
    expect(run()).toBe(run());
  });

  // T5: "low" 급락 플래그는 기간 전체 평균 대비 −1σ 임계 (일간 변화가 아님) —
  // 강하게 상승 중인 트렌드라도 아직 전체 평균보다 낮으면 low=true로 남는
  // 것이 SSOT(index.html buildFunnelCache) 정의상 정상 동작임을 명세.
  // (5-2 FunnelTab UX 버그 리포트: "상승 중인데 급락으로 표시" → 라벨을
  // "평균보다 유독 낮았던 날"로 수정 + 전일比 인디케이터 추가. 통계 자체는
  // legacy와 동일하게 유지.)
  it("T5 · 상승 트렌드라도 전체평균 미달이면 low=true (SSOT 정의)", () => {
    const rows = [];
    const start = new Date("2026-06-01T00:00:00Z");
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const clicks = 10000;
      const cvr = 0.02 + i * 0.0015; // 매일 엄격히 상승
      const installs = Math.round(clicks * cvr);
      rows.push({
        date,
        impressions: 100000,
        clicks,
        installs,
        actions: Math.round(installs * 0.3),
        revenue_d7: installs * 2,
      });
    }
    const mappedKeys = new Set([
      "date", "impressions", "clicks", "installs", "actions", "revenue_d7",
    ]);
    const c = buildFunnelData(rows, mappedKeys, {
      unitField: "_all",
      cvrStep: 2,
      weekdayAdj: false,
    });
    // Day 2, 3 (index 1,2) are strictly rising vs the previous day, yet still
    // below (mean - sd) because the whole series trends up from a low start.
    const risingButLow = c.daily.filter((x, i) => {
      const prev = i > 0 ? c.daily[i - 1] : null;
      return prev && x.cvr > prev.cvr && x.low;
    });
    expect(risingButLow.length).toBeGreaterThan(0);
    // Sanity: the very last (highest) day must never be flagged low.
    expect(c.daily[c.daily.length - 1].low).toBe(false);
  });

  // T6: 요일/주말 파티션 검증 — getDay() 기준 0(일)/6(토)=주말, 1~5=평일.
  // 실제 요일차가 있는 데이터에서 weekdayProfile.weekday !== weekend
  // (5-2 리포트: 스크린샷에서 평일/주말 평균이 동일하게 보인 것은 계산 버그가
  // 아니라 해당 데모/실데이터가 요일별 차이가 거의 없는 우연 — 아래처럼 실제
  // 차이가 있는 합성 데이터를 넣으면 정확히 분리됨을 명세).
  it("T6 · 실제 요일차 있으면 weekdayProfile이 정확히 분리됨", () => {
    const rows = [];
    const start = new Date("2026-06-01T00:00:00Z"); // Monday
    for (let i = 0; i < 21; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      const wd = d.getUTCDay();
      const isWeekend = wd === 0 || wd === 6;
      const clicks = 10000;
      const cvr = isWeekend ? 0.01 : 0.05;
      const installs = Math.round(clicks * cvr);
      rows.push({
        date,
        impressions: 100000,
        clicks,
        installs,
        actions: Math.round(installs * 0.3),
        revenue_d7: installs * 2,
      });
    }
    const mappedKeys = new Set([
      "date", "impressions", "clicks", "installs", "actions", "revenue_d7",
    ]);
    const c = buildFunnelData(rows, mappedKeys, {
      unitField: "_all",
      cvrStep: 2,
      weekdayAdj: true,
    });
    expect(c.weekdayAdjOk).toBe(true);
    expect(c.weekdayProfile.weekday).toBeCloseTo(0.05, 6);
    expect(c.weekdayProfile.weekend).toBeCloseTo(0.01, 6);
    expect(c.weekdayProfile.nWeekday).toBe(15);
    expect(c.weekdayProfile.nWeekend).toBe(6);
  });
});
