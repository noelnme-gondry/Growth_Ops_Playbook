// Golden test port of index.html `runMmmMethTests` (index.html 24525-24860).
// Verifies the v2 MMM math engine against the same inputs/expected values/tolerances.
//
// STATUS: the MMM methodology engine (mmmMath) has NOT been ported to v2 yet.
// This file imports the required symbols so the missing-module failure is explicit.
import { describe, it, expect } from "vitest";
import { _mmrLcg } from "./testFixtures.js";
import {
  MMM_METH_CONFIG,
  mmmValidate,
  mmmSelectAdstock,
  mmmRunMmm,
  mmmTrendExistence,
  mmmCannibalization,
  mmmGranger,
  mmmChangePoints,
  mmmChangePointDrivers,
  mmmIRF,
  mmmDeseasonHoliday,
  mmmAudit,
  mmmMacroFacts,
  mmmDetectCollinear,
  mmmResolveAbsorb,
} from "./mmmMath.js";

describe("runMmmMethTests (golden port)", () => {
  it("T1-T8 MMM methodology pipeline matches index.html", () => {
    const rng = _mmrLcg(77);
    const n = 104;
    const week = Array.from({ length: n }, (_, i) => i + 1);
    const spend = week.map((t) => 5000 + t * 80 + (t > 50 ? 4000 : 0));
    const meta = week.map((t) => (t > 30 ? 2000 : 0));
    const ad = (x, l) => {
      const o = [];
      for (let i = 0; i < x.length; i++) o.push(x[i] + (i > 0 ? l * o[i - 1] : 0));
      return o;
    };
    const sat = ad(spend, 0.3).map((v) => Math.log1p(v));
    const target = week.map(
      (t, i) =>
        8000 +
        600 * sat[i] -
        5 * t +
        400 * Math.sin((2 * Math.PI * t) / 52.18) +
        rng() * 80,
    );
    const seolW = new Set([5, 6, 56, 57]),
      chuW = new Set([38, 39, 92, 93]);
    const dummy = {
      PreLNY: week.map((t) => (t === 4 || t === 55 ? 1 : 0)),
      Seollal: week.map((t) => (seolW.has(t) ? 1 : 0)),
      ChuseokOnly: week.map((t) => (chuW.has(t) ? 1 : 0)),
      PostChuWk: week.map((t) => (t === 40 || t === 94 ? 1 : 0)),
      OtherHol: week.map((t) => (t === 1 || t === 53 ? 1 : 0)),
    };
    const panel = {
      week,
      ch: { google_roi: spend, meta },
      dummy,
      targets: { Regs: target },
    };
    const cfg = MMM_METH_CONFIG;

    // T1 validate 통과
    const v = mmmValidate(panel);
    expect(v.issues.length).toBe(0);

    // T2 select_adstock best in grid
    const sa = mmmSelectAdstock(panel, cfg, "Regs");
    expect(cfg.adstockGrid.includes(sa.best_lambda)).toBe(true);

    // T3 spend 채널 elasticity 양수
    const mm = mmmRunMmm(panel, cfg, "Regs");
    const g = mm.elasticities.find((e) => e.var === "ln_google_roi");
    expect(g && g.coef > 0).toBe(true);

    // T4 Shapley 합=전체R²
    const sumSh = mm.shapley.rows.reduce((a, r) => a + r.r2_share, 0);
    expect(Math.abs(sumSh - mm.shapley.total) < 1e-6).toBe(true);

    // T5 trend existence verdict 문자열
    const tr = mmmTrendExistence(panel, cfg, "Regs");
    expect(typeof tr.verdict === "string" && tr.adf_ct_p != null).toBe(true);

    // T6 cannibalization 3-state verdict
    const cn = mmmCannibalization(panel, cfg, "Regs", {
      coef: g.coef,
      ci_lo: g.ci_lo,
      ci_hi: g.ci_hi,
      p: g.p,
    });
    const vt = cn.votes,
      vsum = vt.FOR + vt.AGAINST + vt.ABSTAIN;
    expect(
      ["ok", "cannibal", "inconclusive"].includes(cn.verdict_class) && vsum === 3,
    ).toBe(true);

    // T6b 검정력 게이트 OK 차단
    const colPanel = {
      week: panel.week,
      ch: { x: panel.week.map((w) => 1000 + w * 50) },
      dummy: {},
      targets: { Regs: panel.targets.Regs },
      channels: [{ key: "x", label: "x", kind: "perf" }],
    };
    const cnGate = mmmCannibalization(
      colPanel,
      cfg,
      "Regs",
      { coef: -0.01, ci_lo: -0.5, ci_hi: 0.48, p: 0.9, vif: 9 },
      "x",
    );
    expect(
      cnGate.power_gate.blocked &&
        cnGate.verdict_class !== "ok" &&
        cnGate.net_incrementality.vote === "ABSTAIN",
    ).toBe(true);

    const oscPanel = {
      week: panel.week,
      ch: { x: panel.week.map((w) => 5000 + 2000 * Math.sin(w / 3)) },
      dummy: {},
      targets: { Regs: panel.targets.Regs },
      channels: [{ key: "x", label: "x", kind: "perf" }],
    };

    // T6c 유의 음순효과→cannibal
    const cnNeg = mmmCannibalization(
      oscPanel,
      cfg,
      "Regs",
      { coef: -0.3, ci_lo: -0.5, ci_hi: -0.1, p: 0.001 },
      "x",
    );
    expect(
      cnNeg.net_incrementality.vote === "AGAINST" &&
        cnNeg.verdict_class === "cannibal",
    ).toBe(true);

    // T6d non-sig는 FOR 아님(ABSTAIN)
    const cnNS = mmmCannibalization(
      oscPanel,
      cfg,
      "Regs",
      { coef: 0.0027, ci_lo: -0.4, ci_hi: 0.41, p: 0.6668 },
      "x",
    );
    expect(cnNS.net_incrementality.vote).toBe("ABSTAIN");

    // T6e granger(prewhiten) null가드·시차탐지·결정론
    const gNull = mmmGranger(target.slice(0, 20), spend.slice(0, 20), 6);
    const gx = week.map((w) => 6000 + 2500 * Math.sin(w / 4));
    const lgx = gx.map((v) => Math.log1p(v));
    const gy = lgx.map((_, i) => 20000 + 5000 * lgx[Math.max(0, i - 2)] + 0.5 * rng());
    const gG = mmmGranger(gy, gx, 6);
    const gG2 = mmmGranger(gy, gx, 6);
    expect(
      gNull === null &&
        gG &&
        gG.spend_to_organic &&
        gG.organic_to_spend &&
        gG.spend_to_organic.coefSum > 0 &&
        gG.spend_to_organic.p < 0.05 &&
        JSON.stringify(gG) === JSON.stringify(gG2),
    ).toBe(true);

    // T6f changepoint null가드·반전(shift)탐지·결정론
    const cpShort = mmmChangePoints([1, 2, 3, 4, 5]);
    const up = Array.from({ length: 26 }, (_, i) => 100 + 10 * i);
    const down = Array.from({ length: 26 }, (_, i) => 350 - 10 * (i + 1));
    const vshape = up.concat(down);
    const cpV = mmmChangePoints(vshape, { minSeg: 4, penaltyMult: 2 });
    const cpV2 = mmmChangePoints(vshape, { minSeg: 4, penaltyMult: 2 });
    const nearPeak = cpV.points.some(
      (idx, i) => Math.abs(idx - 26) <= 3 && cpV.pointTypes[i] === "shift",
    );
    expect(
      cpShort.points.length === 0 &&
        cpV.points.length >= 1 &&
        nearPeak &&
        JSON.stringify(cpV) === JSON.stringify(cpV2),
    ).toBe(true);

    // T6g spike 분류 + 드라이버 카드
    const flat = Array.from({ length: 40 }, (_, i) => 1000 + (i % 2 === 0 ? 5 : -5));
    flat[20] = 5000;
    const cpSp = mmmChangePoints(flat, { minSeg: 4, penaltyMult: 2 });
    const hasSpike =
      cpSp.pointTypes.includes("spike") && cpSp.outliers.some((o) => o.idx === 20);
    const drvSp = mmmChangePointDrivers(
      { week: flat.map((_, i) => i + 1), targets: { Regs: flat }, ch: {}, dummy: {} },
      "Regs",
      cpSp,
    );
    const drvOk =
      drvSp.length === cpSp.points.length &&
      drvSp.every((d) => d.targetBefore != null && Array.isArray(d.channels));
    expect(hasSpike && drvOk).toBe(true);

    // T6h IRF null가드·구조·결정론
    const irfNull = mmmIRF(target.slice(0, 20), spend.slice(0, 20), { horizon: 12 });
    const irfA = mmmIRF(target, spend, { horizon: 12 }),
      irfB = mmmIRF(target, spend, { horizon: 12 });
    expect(
      irfNull === null &&
        irfA &&
        irfA.irf.length === 13 &&
        irfA.cum.length === 13 &&
        irfA.lag >= 1 &&
        JSON.stringify(irfA) === JSON.stringify(irfB),
    ).toBe(true);

    // T6i 계절·휴일 제거(대칭·base보존·분산↓·결정론)
    const seasY = week.map(
      (_, i) =>
        1000 +
        250 * Math.sin((2 * Math.PI * i) / 52.18) +
        (i === 5 || i === 57 ? 600 : 0) +
        rng() * 10,
    );
    const seasPanel = {
      week,
      targets: { Regs: seasY },
      dummy: { Spike: week.map((_, i) => (i === 5 || i === 57 ? 1 : 0)) },
      steps: {},
    };
    const adj = mmmDeseasonHoliday(seasPanel, "Regs");
    const adj2 = mmmDeseasonHoliday(seasPanel, "Regs");
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const sd = (a) => {
      const m = mean(a);
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
    };
    const baseKept = Math.abs(mean(adj) - mean(seasY)) < 0.5;
    const flatter = sd(adj) < sd(seasY) * 0.6;
    expect(
      adj.length === n &&
        baseKept &&
        flatter &&
        JSON.stringify(adj) === JSON.stringify(adj2),
    ).toBe(true);

    // T6j 산발집행→선행성 ABSTAIN·flighted 플래그
    const flightSp = week.map((_, i) => (i % 20 < 6 ? 8000 + rng() * 400 : 0));
    const flightPanel = {
      week,
      ch: { fl: flightSp },
      dummy: {},
      targets: { Regs: panel.targets.Regs },
      channels: [{ key: "fl", label: "fl", kind: "perf" }],
    };
    const cnFl = mmmCannibalization(
      flightPanel,
      cfg,
      "Regs",
      { coef: -0.2, ci_lo: -0.4, ci_hi: 0.02, p: 0.2 },
      "fl",
    );
    expect(
      cnFl.flighted === true &&
        cnFl.precedence.vote === "ABSTAIN" &&
        cnFl.flight_transitions >= 4,
    ).toBe(true);

    // T7 audit r2 유효
    const au = mmmAudit(panel, cfg);
    expect(au.r2 > 0 && au.r2 < 1).toBe(true);

    // T8 결정론
    const d1 = mmmRunMmm(panel, cfg, "Regs").elasticities[0].coef,
      d2 = mmmRunMmm(panel, cfg, "Regs").elasticities[0].coef;
    expect(d1 === d2).toBe(true);
  });

  // ── macro facts / collinear-absorb (deterministic, no RNG) ──
  it("mmmMacroFacts: YoY 2024→2025 for spend & target", () => {
    const cfg = MMM_METH_CONFIG;
    // 2 years, 4 weeks each; ch spend 2024=100/wk → 2025=200/wk (+100%), target 10→15 (+50%)
    const week = Array.from({ length: 8 }, (_, i) => i + 1);
    const dates = week.map((_, i) =>
      i < 4
        ? new Date(Date.UTC(2024, 0, 1 + i * 7))
        : new Date(Date.UTC(2025, 0, 1 + (i - 4) * 7)),
    );
    const panel = {
      week,
      ch: { g: week.map((_, i) => (i < 4 ? 100 : 200)) },
      dummy: {},
      targets: { Regs: week.map((_, i) => (i < 4 ? 10 : 15)) },
      channels: [{ key: "g", label: "Google", kind: "perf" }],
    };
    const mf = mmmMacroFacts(panel, cfg, dates);
    expect(mf["전체유료 spend YoY %"]).toBe(100);
    expect(mf["Google spend YoY %"]).toBe(100);
    expect(mf["Regs YoY %"]).toBe(50);
    // 단일 연도면 빈 객체
    const oneYr = dates.slice(0, 4);
    expect(
      Object.keys(mmmMacroFacts(panel, cfg, oneYr)).length,
    ).toBe(0);
  });

  it("mmmDetectCollinear + mmmResolveAbsorb: perfectly correlated ch~step", () => {
    const cfg = MMM_METH_CONFIG;
    const n = 30;
    const week = Array.from({ length: n }, (_, i) => i + 1);
    // step "LineOff" turns on at week 15 → ln(1+spend) that mirrors it perfectly
    const spend = week.map((_, i) => (i >= 14 ? 5000 : 0));
    const panel = {
      week,
      ch: { s: spend },
      dummy: {},
      steps: { LineOff: week.map((_, i) => (i >= 14 ? 1 : 0)) },
      stepDefs: [{ key: "LineOff", label: "LineOff", kind: "step" }],
      targets: { Regs: week.map((_, i) => 100 + i) },
      channels: [{ key: "s", label: "Spend", kind: "perf" }],
    };
    const pairs = mmmDetectCollinear(panel, cfg);
    expect(pairs.length).toBe(1);
    expect(pairs[0].channel).toBe("s");
    expect(pairs[0].step).toBe("LineOff");
    expect(Math.abs(pairs[0].corr)).toBeGreaterThanOrEqual(0.9);
    // 기본 흡수 = step
    const r1 = mmmResolveAbsorb(panel, cfg);
    expect(r1.absorbed.has("LineOff")).toBe(true);
    expect(r1.notices[0].side).toBe("step");
    // choice=channel → 채널 흡수
    const r2 = mmmResolveAbsorb(panel, cfg, { "s__LineOff": "channel" });
    expect(r2.absorbed.has("s")).toBe(true);
    expect(r2.notices[0].side).toBe("channel");
  });
});
