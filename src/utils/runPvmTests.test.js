import { describe, it, expect } from "vitest";
import { PVM_MATH } from "./pvmMath.js";

// Golden test port of index.html window.runPvmTests (near line 32079).
// Reproduces every sub-assertion with identical inputs, expected values, tolerances.
const approx = (a, b, eps) => Math.abs(a - b) < (eps ?? 1e-9);

// 합성 fixture: 2채널×2캠페인×2소재 (T4~T8 공용 구조)
const pvmFixtureTuples = () => [
  ["Ch1", "Cmp1A", "Cr1", 100, 10, 120, 10],
  ["Ch1", "Cmp1A", "Cr2", 80, 8, 90, 9],
  ["Ch1", "Cmp1B", "Cr1", 60, 6, 50, 5],
  ["Ch1", "Cmp1B", "Cr2", 40, 4, 45, 5],
  ["Ch2", "Cmp2A", "Cr1", 200, 20, 210, 19],
  ["Ch2", "Cmp2A", "Cr2", 150, 15, 140, 14],
  ["Ch2", "Cmp2B", "Cr1", 90, 9, 95, 10],
  ["Ch2", "Cmp2B", "Cr2", 70, 7, 75, 8],
];
const pvmFixtureRows = () => {
  const tuples = pvmFixtureTuples();
  const rowsP1 = tuples.map(([ch, cmp, cr, c1, r1]) => ({
    channel: ch,
    campaign_id: cmp,
    creative_id: cr,
    spend: c1,
    installs: r1,
  }));
  const rowsP2 = tuples.map(([ch, cmp, cr, , , c2, r2]) => ({
    channel: ch,
    campaign_id: cmp,
    creative_id: cr,
    spend: c2,
    installs: r2,
  }));
  return {
    rowsP1,
    rowsP2,
    keys: {
      ch: "channel",
      cmp: "campaign_id",
      cr: "creative_id",
      resultField: "installs",
    },
  };
};

describe("runPvmTests (golden port)", () => {
  it("T1 — 대칭 swap", () => {
    const agg1 = new Map([
      ["A", { cost: 1000, result: 100 }],
      ["B", { cost: 1000, result: 50 }],
    ]);
    const agg2 = new Map([
      ["A", { cost: 1000, result: 50 }],
      ["B", { cost: 1000, result: 100 }],
    ]);
    const r = PVM_MATH.decompose(agg1, agg2);
    const A = r.entities.find((e) => e.key === "A"),
      B = r.entities.find((e) => e.key === "B");
    expect(approx(r.CPA1, 2000 / 150, 1e-6)).toBe(true); // T1 CPA1=13.333
    expect(approx(r.CPA2, 2000 / 150, 1e-6)).toBe(true); // T1 CPA2=13.333
    // centered: Cbar=13.333, mix_A=(15-13.333)*(0.3333-0.6667)=-5/9
    expect(approx(A.mix, -5 / 9, 1e-6)).toBe(true); // T1 mix_A=-5/9
    expect(approx(A.rate, 5, 1e-6)).toBe(true); // T1 rate_A=+5
    expect(approx(A.contribution, 40 / 9, 1e-6)).toBe(true); // T1 contribution_A=40/9
    expect(approx(B.mix, 5 / 9, 1e-6)).toBe(true); // T1 mix_B=+5/9
    expect(approx(B.rate, -5, 1e-6)).toBe(true); // T1 rate_B=-5
    expect(approx(B.contribution, -40 / 9, 1e-6)).toBe(true); // T1 contribution_B=-40/9
    const sigma = r.entities.reduce((a, e) => a + e.contribution, 0);
    expect(approx(sigma, r.deltaCpa, 1e-9)).toBe(true); // T1 Σcontribution = ΔCPA_total
  });

  it("T2 — 신규 엔티티 진입", () => {
    const agg1 = new Map([["A", { cost: 900, result: 90 }]]);
    const agg2 = new Map([
      ["A", { cost: 900, result: 90 }],
      ["C", { cost: 300, result: 10 }],
    ]);
    const r = PVM_MATH.decompose(agg1, agg2);
    const A = r.entities.find((e) => e.key === "A"),
      C = r.entities.find((e) => e.key === "C");
    expect(approx(r.CPA1, 10, 1e-9)).toBe(true); // T2 CPA1=10
    expect(approx(r.CPA2, 12, 1e-9)).toBe(true); // T2 CPA2=12
    // centered: Cbar=11. mix_A=(10-11)*(0.9-1.0)=0.1, mix_C=(30-11)*(0.1-0)=1.9
    expect(approx(A.mix, 0.1, 1e-6)).toBe(true); // T2 mix_A=+0.1
    expect(approx(A.rate, 0, 1e-6)).toBe(true); // T2 rate_A=0
    expect(approx(A.contribution, 0.1, 1e-6)).toBe(true); // T2 contribution_A=+0.1
    expect(approx(C.mix, 0.4, 1e-6)).toBe(true); // T2 mix_C=+0.4
    expect(approx(C.rate, 1.5, 1e-6)).toBe(true); // T2 rate_C=+1.5
    expect(approx(C.contribution, 1.9, 1e-6)).toBe(true); // T2 contribution_C=+1.9
    const sigma = r.entities.reduce((a, e) => a + e.contribution, 0);
    expect(approx(sigma, r.deltaCpa, 1e-9) && approx(r.deltaCpa, 2, 1e-9)).toBe(
      true,
    ); // T2 Σcontribution = ΔCPA_total(=2)
  });

  it("T3 — 엔티티 소멸 (T2의 대칭)", () => {
    const agg1 = new Map([
      ["A", { cost: 900, result: 90 }],
      ["D", { cost: 300, result: 10 }],
    ]);
    const agg2 = new Map([["A", { cost: 900, result: 90 }]]);
    const r = PVM_MATH.decompose(agg1, agg2);
    const A = r.entities.find((e) => e.key === "A"),
      D = r.entities.find((e) => e.key === "D");
    expect(approx(r.CPA1, 12, 1e-9)).toBe(true); // T3 CPA1=12
    expect(approx(r.CPA2, 10, 1e-9)).toBe(true); // T3 CPA2=10
    // centered: Cbar=11. mix_A=(10-11)*(1.0-0.9)=-0.1, mix_D=(30-11)*(0-0.1)=-1.9
    expect(approx(A.mix, -0.1, 1e-6)).toBe(true); // T3 mix_A=-0.1
    expect(approx(A.rate, 0, 1e-6)).toBe(true); // T3 rate_A=0
    expect(approx(A.contribution, -0.1, 1e-6)).toBe(true); // T3 contribution_A=-0.1
    expect(approx(D.mix, -0.4, 1e-6)).toBe(true); // T3 mix_D=-0.4
    expect(approx(D.rate, -1.5, 1e-6)).toBe(true); // T3 rate_D=-1.5
    expect(approx(D.contribution, -1.9, 1e-6)).toBe(true); // T3 contribution_D=-1.9
    const sigma = r.entities.reduce((a, e) => a + e.contribution, 0);
    expect(
      approx(sigma, r.deltaCpa, 1e-9) && approx(r.deltaCpa, -2, 1e-9),
    ).toBe(true); // T3 Σcontribution = ΔCPA_total(=-2)
  });

  it("T4 — 중첩 항등식: 채널 기여 = Σ캠페인 기여 = Σ소재 기여, 전체 Σ = ΔCPA_total", () => {
    const { rowsP1, rowsP2, keys } = pvmFixtureRows();
    const fin = PVM_MATH.decomposeFinest(rowsP1, rowsP2, keys);
    const sigmaFinest = fin.finest.reduce((a, e) => a + e.contribution, 0);
    expect(approx(sigmaFinest, fin.deltaCpa, 1e-9)).toBe(true); // T4 Σfinest.contribution ≈ deltaCpa

    const byChannel = PVM_MATH.rollup(
      fin.finest,
      (f) => f.chKey,
      fin.Result1,
      fin.Result2,
    );
    const sigmaChannel = byChannel.reduce((a, g) => a + g.contribution, 0);
    expect(approx(sigmaChannel, fin.deltaCpa, 1e-9)).toBe(true); // T4 Σrollup(channel).contribution ≈ deltaCpa

    let nestOk = true;
    for (const chGroup of byChannel) {
      const chFinest = fin.finest.filter((f) => f.chKey === chGroup.key);
      const byCampaign = PVM_MATH.rollup(
        chFinest,
        (f) => f.cmpKey,
        fin.Result1,
        fin.Result2,
      );
      const sigmaCampaign = byCampaign.reduce((a, g) => a + g.contribution, 0);
      if (!approx(sigmaCampaign, chGroup.contribution, 1e-9)) nestOk = false;
      for (const cmpGroup of byCampaign) {
        const cmpFinest = chFinest.filter((f) => f.cmpKey === cmpGroup.key);
        const sigmaCreative = cmpFinest.reduce((a, f) => a + f.contribution, 0);
        if (!approx(sigmaCreative, cmpGroup.contribution, 1e-9)) nestOk = false;
      }
    }
    expect(nestOk).toBe(true); // T4 채널 기여 = Σ캠페인 기여 = Σ소재 기여 (완벽 중첩)
  });

  it("T5 — 롤업 합산 보존: rollup의 cost1/cost2/result1/result2 = Σchildren", () => {
    const { rowsP1, rowsP2, keys } = pvmFixtureRows();
    const fin = PVM_MATH.decomposeFinest(rowsP1, rowsP2, keys);
    const byChannel = PVM_MATH.rollup(
      fin.finest,
      (f) => f.chKey,
      fin.Result1,
      fin.Result2,
    );
    let sumOk = true;
    for (const g of byChannel) {
      const c1 = g.children.reduce((a, c) => a + c.cost1, 0);
      const c2 = g.children.reduce((a, c) => a + c.cost2, 0);
      const r1 = g.children.reduce((a, c) => a + c.result1, 0);
      const r2 = g.children.reduce((a, c) => a + c.result2, 0);
      if (
        !approx(g.cost1, c1, 1e-9) ||
        !approx(g.cost2, c2, 1e-9) ||
        !approx(g.result1, r1, 1e-9) ||
        !approx(g.result2, r2, 1e-9)
      )
        sumOk = false;
    }
    expect(sumOk).toBe(true); // T5 rollup cost/result = Σchildren (보존)
  });

  it("T6 — 결정론: 동일 입력 2회 실행 → byte-동일 JSON, Math.random 미사용", () => {
    const { rowsP1, rowsP2, keys } = pvmFixtureRows();
    const a = PVM_MATH.decomposeFinest(rowsP1, rowsP2, keys);
    const b = PVM_MATH.decomposeFinest(rowsP1, rowsP2, keys);
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(true); // T6 결정론 — 동일 입력 byte-동일 출력
    const srcBlob =
      PVM_MATH.decomposeFinest.toString() + PVM_MATH.rollup.toString();
    expect(!/Math\.random/.test(srcBlob)).toBe(true); // T6 Math.random 미사용
  });

  it("T7 — centering 의미 검증: 평균보다 싼 채널이 비중을 늘리면 mix는 음수여야 함", () => {
    // Cheap{cpa=10, 비중↑} / Pricey{cpa=30, 비중↓}, 전체 평균 사이.
    const agg1 = new Map([
      ["Cheap", { cost: 500, result: 50 }],
      ["Pricey", { cost: 1500, result: 50 }],
    ]);
    const agg2 = new Map([
      ["Cheap", { cost: 900, result: 90 }],
      ["Pricey", { cost: 300, result: 10 }],
    ]);
    const r = PVM_MATH.decompose(agg1, agg2);
    const cheap = r.entities.find((e) => e.key === "Cheap");
    const pricey = r.entities.find((e) => e.key === "Pricey");
    expect(cheap.s2 > cheap.s1 && cheap.mix < 0).toBe(true); // T7 싼 채널 비중↑ → mix<0
    expect(pricey.s2 < pricey.s1 && pricey.mix < 0).toBe(true); // T7 비싼 채널 비중↓ → mix<0
    const sigma = r.entities.reduce((a, e) => a + e.contribution, 0);
    expect(approx(sigma, r.deltaCpa, 1e-9)).toBe(true); // T7 Σcontribution = ΔCPA (centering 합 보존)
  });

  it("T8 — Decoupled Layers & Campaign Mix Split Invariants", () => {
    const { rowsP1, rowsP2, keys } = pvmFixtureRows();
    const fin = PVM_MATH.decomposeFinest(rowsP1, rowsP2, keys);
    const Cbar = (fin.CPA1 + fin.CPA2) / 2;
    const layer1 = PVM_MATH.decomposeLayer(
      rowsP1,
      rowsP2,
      keys,
      fin.Result1,
      fin.Result2,
      Cbar,
      "channel",
    );
    const layer2 = PVM_MATH.decomposeLayer(
      rowsP1,
      rowsP2,
      keys,
      fin.Result1,
      fin.Result2,
      Cbar,
      "campaign",
    );
    const layer3 = PVM_MATH.decomposeLayer(
      rowsP1,
      rowsP2,
      keys,
      fin.Result1,
      fin.Result2,
      Cbar,
      "creative",
    );

    const sigmaL1 = layer1.reduce((sum, ch) => sum + ch.contribution, 0);
    const sigmaL2 = layer2.reduce((sum, cmp) => sum + cmp.contribution, 0);
    const sigmaL3 = layer3.reduce((sum, cr) => sum + cr.contribution, 0);

    expect(approx(sigmaL1, fin.deltaCpa, 1e-9)).toBe(true); // T8 Layer 1 Σcontribution ≈ deltaCpa
    expect(approx(sigmaL2, fin.deltaCpa, 1e-9)).toBe(true); // T8 Layer 2 Σcontribution ≈ deltaCpa
    expect(approx(sigmaL3, fin.deltaCpa, 1e-9)).toBe(true); // T8 Layer 3 Σcontribution ≈ deltaCpa

    // Campaign mix split invariant properties
    for (const cmp of layer2) {
      const relatedCreatives = layer3.filter(
        (cr) => cr.chKey === cmp.chKey && cr.cmpKey === cmp.cmpKey,
      );
      const creativeSumMix = relatedCreatives.reduce(
        (sum, cr) => sum + cr.mix,
        0,
      );
      cmp.creativeSumMix = creativeSumMix;
      cmp.withinMix = creativeSumMix - cmp.mix;
    }

    let splitInvariantOk = true;
    for (const cmp of layer2) {
      if (!approx(cmp.mix + cmp.withinMix, cmp.creativeSumMix, 1e-9)) {
        splitInvariantOk = false;
      }
    }
    expect(splitInvariantOk).toBe(true); // T8 Campaign Mix Split Invariant

    // Channel campaign sum properties
    for (const ch of layer1) {
      const relatedCampaigns = layer2.filter((cmp) => cmp.chKey === ch.key);
      const cmpSumMix = relatedCampaigns.reduce((sum, cmp) => sum + cmp.mix, 0);
      const cmpSumRate = relatedCampaigns.reduce(
        (sum, cmp) => sum + cmp.rate,
        0,
      );
      const cmpSumContribution = relatedCampaigns.reduce(
        (sum, cmp) => sum + cmp.contribution,
        0,
      );
      ch.cmpSumMix = cmpSumMix;
      ch.cmpSumRate = cmpSumRate;
      ch.cmpSumContribution = cmpSumContribution;
    }

    let channelSumInvariantOk = true;
    for (const ch of layer1) {
      const relatedCampaigns = layer2.filter((cmp) => cmp.chKey === ch.key);
      const sumMix = relatedCampaigns.reduce((sum, cmp) => sum + cmp.mix, 0);
      const sumRate = relatedCampaigns.reduce((sum, cmp) => sum + cmp.rate, 0);
      const sumContribution = relatedCampaigns.reduce(
        (sum, cmp) => sum + cmp.contribution,
        0,
      );
      if (
        !approx(ch.cmpSumMix, sumMix, 1e-9) ||
        !approx(ch.cmpSumRate, sumRate, 1e-9) ||
        !approx(ch.cmpSumContribution, sumContribution, 1e-9)
      ) {
        channelSumInvariantOk = false;
      }
    }
    expect(channelSumInvariantOk).toBe(true); // T8 Channel Campaign Sum Invariant
  });
});
