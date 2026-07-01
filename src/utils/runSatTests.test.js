import { describe, it, expect } from "vitest";
import { SAT_MATH, SAT_CONFIG, satBuildPoints } from "./satMath";

// Golden test port of runSatTests (index.html 11939-12079).
// Same inputs, same expected values, same tolerances — verbatim.

// 테스트용 순수 포화지수 (활성 metric 무관, CPA 기준) — index.html satActiveIndexPure
function satActiveIndexPure(r) {
  if (!r.ok) return -1;
  return isFinite(r.satIndex) ? r.satIndex : 1e9;
}

describe("runSatTests (golden parity)", () => {
  // 합성: 포화 채널(증액할수록 CPA 급등) vs 여유 채널(증액해도 CPA 거의 평탄/하락)
  const mkDates = (n) => {
    const out = [];
    const base = Date.parse("2024-01-01");
    for (let i = 0; i < n; i++)
      out.push(new Date(base + i * 86400000).toISOString().slice(0, 10));
    return out;
  };
  const ds = mkDates(30);

  // 포화: cost 1000→3000, CPA가 cost에 비례 급등 (y = cost/100)
  const satPts = ds.map((d, i) => {
    const cost = 1000 + i * 70;
    const cpa = cost / 100; // 비용↑ → CPA↑ (한계 ≫ 평균)
    return { x: cost, y: cpa, date: d, rev: null };
  });
  const satRes = SAT_MATH.analyzeEntity(satPts, SAT_CONFIG);

  it("포화 채널 적합 성공", () => {
    expect(satRes.ok).toBe(true);
  });

  it("포화 채널 판정 = saturated", () => {
    expect(satRes.ok && satRes.verdict === "saturated").toBe(true);
  });

  it("포화 채널 포화지수 > 1", () => {
    expect(satRes.ok && satRes.satIndex > 1).toBe(true);
  });

  // 여유: CPA가 cost와 무관하게 평탄 후 하락 (규모의 경제) → 한계 < 평균
  const scalePts = ds.map((d, i) => {
    const cost = 1000 + i * 70;
    const cpa = 50 - i * 0.5; // 비용↑ → CPA↓ (한계 < 평균)
    return { x: cost, y: Math.max(cpa, 5), date: d, rev: null };
  });
  const scaleRes = SAT_MATH.analyzeEntity(scalePts, SAT_CONFIG);

  it("여유 채널 적합 성공", () => {
    expect(scaleRes.ok).toBe(true);
  });

  it("여유 채널 포화지수 < 포화 채널", () => {
    expect(
      scaleRes.ok && satRes.ok && satActiveIndexPure(scaleRes) < satRes.satIndex,
    ).toBe(true);
  });

  it("관측 부족 → ok=false", () => {
    // 관측 부족 → 분석 제외
    const few = SAT_MATH.analyzeEntity(
      [
        { x: 100, y: 10, date: ds[0] },
        { x: 200, y: 12, date: ds[1] },
      ],
      SAT_CONFIG,
    );
    expect(few.ok === false).toBe(true);
  });

  it("결정론 (동일 입력 동일 출력)", () => {
    // 결정론 (동일 입력 = 동일 포화지수)
    const again = SAT_MATH.analyzeEntity(satPts, SAT_CONFIG);
    expect(again.satIndex === satRes.satIndex).toBe(true);
  });

  it("ROAS 분석 생성 (rev 있을 때)", () => {
    // ROAS 분석 (rev 포함)
    const revPts = ds.map((d, i) => {
      const cost = 1000 + i * 70;
      const cpa = cost / 100;
      return { x: cost, y: cpa, date: d, rev: (cost / cpa) * 80 };
    });
    const revRes = SAT_MATH.analyzeEntity(revPts, SAT_CONFIG);
    expect(revRes.ok && revRes.roas != null).toBe(true);
  });

  // grouping
  const gm = satBuildPoints(
    [
      { channel: "A", campaign_name: "c1", cost: 100, installs: 10, date: ds[0] },
      { channel: "A", campaign_name: "c2", cost: 200, installs: 10, date: ds[1] },
      { channel: "B", campaign_name: "c3", cost: 300, installs: 10, date: ds[2] },
    ],
    "channel",
    "installs",
    null,
  );

  it("채널 그룹핑 → 2개 (A,B)", () => {
    expect(gm.size === 2).toBe(true);
  });

  it("채널 A 포인트 2개", () => {
    expect((gm.get("A") || []).length === 2).toBe(true);
  });

  it("캠페인 그룹핑 → 복합키 2개", () => {
    const gmc = satBuildPoints(
      [
        { channel: "A", campaign_name: "c1", cost: 100, installs: 10, date: ds[0] },
        { channel: "A", campaign_name: "c2", cost: 200, installs: 10, date: ds[1] },
      ],
      "campaign",
      "installs",
      null,
    );
    expect(gmc.size === 2).toBe(true);
  });
});
