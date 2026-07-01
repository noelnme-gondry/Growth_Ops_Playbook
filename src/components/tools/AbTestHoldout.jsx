"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { STATS } from "@/utils/abTestMath";
import { CREATIVE_STATS } from "@/utils/creativeMath";
import { INCR_MATH, parseHoldoutGroup } from "@/utils/incrMath";
import CsvUploader from "@/components/CsvUploader";

const CURRENCY_SYMBOLS = { KRW: "₩", USD: "$" };

/* 통화 포맷 — index.html fmtCurrency 포팅 (통화 토글 반영) */
function fmtCurrency(value, currency) {
  if (value == null || !isFinite(value)) return "—";
  const sym = CURRENCY_SYMBOLS[currency] || "₩";
  const digits = currency === "USD" ? 2 : 0;
  return sym + value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const isTruthy = (v) =>
  v === true || v === 1 || /^(1|true|yes|y)$/i.test(String(v ?? "").trim());

/* p-value 배지 (index.html tier-1/2/3 → 색상 span으로) */
function PvBadge({ p }) {
  if (!isFinite(p)) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  if (p < 0.01)
    return <span className="pill tier-1" style={{ color: "#22c55e" }}>p &lt; 0.01</span>;
  if (p < 0.05)
    return <span className="pill tier-2" style={{ color: "#22c55e" }}>p &lt; 0.05</span>;
  return <span className="pill tier-3" style={{ color: "var(--text-muted)" }}>p ≥ 0.05 (비유의)</span>;
}

/* verdict 색: sig+ green / sig- red / non-sig gray */
function verdictColor(p, liftPositive) {
  if (!isFinite(p) || p >= 0.05) return "var(--text-muted)";
  return liftPositive ? "#22c55e" : "#ef4444";
}

export default function AbTestHoldout() {
  const [activeTab, setActiveTab] = useState("design");
  const [mode, setMode] = useState("plan");
  const [testType, setTestType] = useState("binary");
  const [currency, setCurrency] = useState("KRW");
  const { csvData } = useAppStore();

  const sym = CURRENCY_SYMBOLS[currency] || "₩";

  // ---- Plan mode inputs ----
  const [planBaseline, setPlanBaseline] = useState("5");
  const [planMde, setPlanMde] = useState("10");
  const [planMean, setPlanMean] = useState("3500");
  const [planSigma, setPlanSigma] = useState("1200");
  const [planAlpha, setPlanAlpha] = useState("0.05");
  const [planPower, setPlanPower] = useState("0.80");
  const [planCprA, setPlanCprA] = useState("2500");
  const [planCprB, setPlanCprB] = useState("");

  // ---- Analyze mode inputs ----
  const [anNa, setAnNa] = useState("10000");
  const [anXa, setAnXa] = useState("500");
  const [anNb, setAnNb] = useState("10000");
  const [anXb, setAnXb] = useState("560");
  const [ancNa, setAncNa] = useState("2000");
  const [ancMa, setAncMa] = useState("3500");
  const [ancSa, setAncSa] = useState("1200");
  const [ancNb, setAncNb] = useState("2000");
  const [ancMb, setAncMb] = useState("3850");
  const [ancSb, setAncSb] = useState("1250");

  // ---- Power curve inputs ----
  const [pcBaseline, setPcBaseline] = useState("5");
  const [pcAlpha, setPcAlpha] = useState("0.05");
  const [pcPower, setPcPower] = useState("0.80");

  const abChartRef = useRef(null);
  const holdoutChartRef = useRef(null);
  const powerChartRef = useRef(null);

  // ============================================================
  //  Plan mode compute (§2)
  // ============================================================
  const planResult = useMemo(() => {
    const alpha = num(planAlpha);
    const power = num(planPower);
    if (testType === "binary") {
      const baseline = num(planBaseline) / 100;
      const mde = num(planMde) / 100;
      if (!(baseline > 0) || !(mde > 0)) return null;
      const r = STATS.sampleSizePerArm({ baseline, mdeRelative: mde, alpha, power });
      if (!isFinite(r.n)) return { invalid: true };
      return { ...r, kind: "binary", totalN: r.n * 2 };
    }
    const mean = num(planMean);
    const mde = num(planMde) / 100;
    const sigma = num(planSigma);
    if (!(mean > 0) || !(mde > 0) || !(sigma > 0)) return null;
    const r = STATS.sampleSizeContinuous({
      baselineMean: mean,
      mdeRelative: mde,
      sigma,
      alpha,
      power,
    });
    if (!isFinite(r.n)) return { invalid: true };
    return { ...r, kind: "continuous", totalN: r.n * 2, mean, mde, cv: sigma / mean };
  }, [testType, planBaseline, planMde, planMean, planSigma, planAlpha, planPower]);

  const budgetResult = useMemo(() => {
    if (!planResult || planResult.invalid || !isFinite(planResult.n)) return null;
    const cprA = num(planCprA);
    if (!(cprA >= 0)) return null;
    const cprBraw = String(planCprB).trim();
    const cprB = cprBraw === "" ? null : num(cprBraw);
    return STATS.budgetForTest({ nPerArm: planResult.n, cprA, cprB });
  }, [planResult, planCprA, planCprB]);

  // ============================================================
  //  Analyze mode compute (§2)
  // ============================================================
  const analyzeBinary = useMemo(() => {
    if (mode !== "analyze" || testType !== "binary") return null;
    const nA = parseInt(anNa, 10);
    const xA = parseInt(anXa, 10);
    const nB = parseInt(anNb, 10);
    const xB = parseInt(anXb, 10);
    if (!nA || !nB || !(xA >= 0) || !(xB >= 0) || xA > nA || xB > nB)
      return { invalid: true };
    const freq = STATS.twoPropZTest(nA, xA, nB, xB);
    // bayesianAB uses Math.random internally (engine behavior — not touched here)
    const bayes = STATS.bayesianAB({ nA, xA, nB, xB, sims: 10000 });
    return { freq, bayes };
  }, [mode, testType, anNa, anXa, anNb, anXb]);

  const analyzeContinuous = useMemo(() => {
    if (mode !== "analyze" || testType !== "continuous") return null;
    const nA = parseInt(ancNa, 10);
    const mA = num(ancMa);
    const sA = num(ancSa);
    const nB = parseInt(ancNb, 10);
    const mB = num(ancMb);
    const sB = num(ancSb);
    if (!nA || !nB || !isFinite(mA) || !isFinite(mB) || sA < 0 || sB < 0)
      return { invalid: true };
    return { r: STATS.continuousTest(nA, mA, sA, nB, mB, sB), smallSample: nA < 30 || nB < 30 };
  }, [mode, testType, ancNa, ancMa, ancSa, ancNb, ancMb, ancSb]);

  // ============================================================
  //  Threshold mode matrix (§2 ③)
  // ============================================================
  const thresholdMatrix = useMemo(() => {
    if (testType === "binary") {
      const baselines = [0.01, 0.02, 0.05, 0.1, 0.2];
      const mdes = [0.05, 0.1, 0.15, 0.2, 0.3];
      const cells = baselines.map((b) =>
        mdes.map((m) => STATS.sampleSizePerArm({ baseline: b, mdeRelative: m }).n),
      );
      return { kind: "binary", baselines, mdes, cells };
    }
    const cvs = [0.1, 0.2, 0.3, 0.5, 0.8, 1.0];
    const mdes = [0.05, 0.1, 0.15, 0.2, 0.3];
    const cells = cvs.map((cv) =>
      mdes.map(
        (m) =>
          STATS.sampleSizeContinuous({ baselineMean: 1, mdeRelative: m, sigma: cv }).n,
      ),
    );
    return { kind: "continuous", cvs, mdes, cells };
  }, [testType]);

  // ============================================================
  //  Readout aggregation (CSV) — 2-arm significance + optional mass
  // ============================================================
  const readoutData = useMemo(() => {
    const rows = csvData?.raw;
    if (!rows || rows.length === 0) return null;

    // Detect an arm dimension for mass readout
    const hasArm = rows.some((r) => r?.arm_id != null && String(r.arm_id).trim() !== "");

    // 2-arm aggregation (control vs test) via is_control
    let cNum = 0, cDen = 0, tNum = 0, tDen = 0;
    rows.forEach((row) => {
      const isControl = isTruthy(row.is_control);
      const n = num(row.numerator) || 0;
      const d = num(row.denominator) || 0;
      if (isControl) { cNum += n; cDen += d; }
      else { tNum += n; tDen += d; }
    });

    const cRate = cDen > 0 ? (cNum / cDen) * 100 : 0;
    const tRate = tDen > 0 ? (tNum / tDen) * 100 : 0;

    let sig = null;
    if (cDen > 0 && tDen > 0) {
      sig = STATS.twoPropZTest(cDen, cNum, tDen, tNum);
    }

    // Mass readout: group by arm_id
    let mass = null;
    if (hasArm) {
      const armMap = new Map();
      rows.forEach((row) => {
        const name = String(row.arm_id).trim();
        if (!name) return;
        if (!armMap.has(name))
          armMap.set(name, { name, n: 0, x: 0, isControl: false });
        const a = armMap.get(name);
        a.x += num(row.numerator) || 0;
        a.n += num(row.denominator) || 0;
        if (isTruthy(row.is_control)) a.isControl = true;
      });
      const arms = [...armMap.values()].filter((a) => a.n > 0);
      if (arms.length >= 2) {
        if (!arms.some((a) => a.isControl)) arms[0].isControl = true;
        mass = STATS.massReadout(arms, CREATIVE_STATS);
      }
    }

    return {
      cNum, cDen, tNum, tDen, cRate, tRate, sig, mass,
    };
  }, [csvData]);

  // ============================================================
  //  Holdout incrementality (CSV) — control-transform + significance
  // ============================================================
  const holdoutData = useMemo(() => {
    const rows = csvData?.raw;
    if (!rows || rows.length === 0) return null;

    let cNum = 0, cDen = 0, tNum = 0, tDen = 0, spend = 0, revenue = 0;
    rows.forEach((row) => {
      const group = parseHoldoutGroup(row.holdout_group);
      const n = num(row.numerator) || 0;
      const d = num(row.denominator) || 0;
      if (group === "control") { cNum += n; cDen += d; }
      else if (group === "test") {
        tNum += n; tDen += d;
        spend += num(row.spend) || 0;
        revenue += num(row.revenue_d7 ?? row.revenue) || 0;
      }
    });

    if (cDen <= 0 || tDen <= 0) return { insufficient: true };

    // 반사실·lift·iROAS는 순수 유틸(INCR_MATH.compute)로 산출 — index.html verbatim
    const incr = INCR_MATH.compute(
      { num: tNum, den: tDen, spend, rev: revenue > 0 ? revenue : null },
      { num: cNum, den: cDen },
    );
    const { cRate, tRate, expected: counterfactual, incrementalConv, liftRel, liftAbs, iroas, cpia } = incr;

    const sig = STATS.twoPropZTest(cDen, cNum, tDen, tNum);

    return {
      cNum, cDen, tNum, tDen, cRate: cRate * 100, tRate: tRate * 100,
      counterfactual, incrementalConv, liftRel, liftAbs, iroas, cpia, sig, spend, revenue,
    };
  }, [csvData]);

  // ============================================================
  //  Readout bar chart
  // ============================================================
  useEffect(() => {
    if (abChartRef.current) { abChartRef.current.destroy(); abChartRef.current = null; }
    if (activeTab !== "readout" || !readoutData) return;
    const ctx = document.getElementById("ab-bar");
    if (!ctx) return;
    abChartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["Control", "Test"],
        datasets: [{
          label: "전환율 (%)",
          data: [readoutData.cRate, readoutData.tRate],
          backgroundColor: ["#fbbf24", "#22c55e"],
        }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
    return () => {
      if (abChartRef.current) { abChartRef.current.destroy(); abChartRef.current = null; }
    };
  }, [activeTab, readoutData]);

  // ============================================================
  //  Holdout bar chart
  // ============================================================
  useEffect(() => {
    if (holdoutChartRef.current) { holdoutChartRef.current.destroy(); holdoutChartRef.current = null; }
    if (activeTab !== "holdout" || !holdoutData || holdoutData.insufficient) return;
    const ctx = document.getElementById("holdout-bar");
    if (!ctx) return;
    holdoutChartRef.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["Control (Holdout)", "Test (Exposed)"],
        datasets: [{
          label: "전환율 (%)",
          data: [holdoutData.cRate, holdoutData.tRate],
          backgroundColor: ["#fbbf24", "#22c55e"],
        }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
    return () => {
      if (holdoutChartRef.current) { holdoutChartRef.current.destroy(); holdoutChartRef.current = null; }
    };
  }, [activeTab, holdoutData]);

  // ============================================================
  //  Power curve chart (§4)
  // ============================================================
  useEffect(() => {
    if (powerChartRef.current) { powerChartRef.current.destroy(); powerChartRef.current = null; }
    if (activeTab !== "design") return;
    const baseline = num(pcBaseline) / 100;
    if (!(baseline > 0) || baseline >= 1) return;
    const ctx = document.getElementById("ab-power-chart");
    if (!ctx) return;
    const curve = STATS.powerCurve({
      baseline,
      alpha: num(pcAlpha),
      power: num(pcPower),
    });
    const pts = curve.filter((p) => p.mdePct != null);
    powerChartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [{
          label: `MDE (%) · baseline ${pcBaseline}%`,
          data: pts.map((p) => ({ x: p.n, y: p.mdePct })),
          borderColor: "#7aa2f7",
          backgroundColor: "rgba(122,162,247,0.12)",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) =>
                `n=${Math.round(c.parsed.x).toLocaleString()} → MDE ${c.parsed.y.toFixed(2)}%`,
            },
          },
        },
        scales: {
          x: {
            type: "logarithmic",
            title: { display: true, text: "Sample Size (per arm)" },
          },
          y: { title: { display: true, text: "MDE (%)" } },
        },
      },
    });
    return () => {
      if (powerChartRef.current) { powerChartRef.current.destroy(); powerChartRef.current = null; }
    };
  }, [activeTab, mode, pcBaseline, pcAlpha, pcPower]);

  return (
    <div className="tab-pane active" id="tab-ab">
      <div className="ab-tabs" style={{ marginBottom: "20px" }}>
        <button className={`ab-tab ${activeTab === "design" ? "active" : ""}`} onClick={() => setActiveTab("design")}>
          실험 설계 및 수동 계산
        </button>
        <button className={`ab-tab ${activeTab === "readout" ? "active" : ""}`} onClick={() => setActiveTab("readout")}>
          실험 판독 (CSV)
        </button>
        <button className={`ab-tab ${activeTab === "holdout" ? "active" : ""}`} onClick={() => setActiveTab("holdout")}>
          홀드아웃 증분 (CSV)
        </button>
      </div>

      {activeTab === "design" && (
        <>
          <section className="block" id="s-mode">
            <h2 className="section-title"><span className="ix">§1</span>모드 선택</h2>
            <div className="ab-tabs">
              <button className={`ab-tab ${mode === "plan" ? "active" : ""}`} onClick={() => setMode("plan")}>① 모수 계산 (Plan)</button>
              <button className={`ab-tab ${mode === "analyze" ? "active" : ""}`} onClick={() => setMode("analyze")}>② 결과 분석 (Analyze)</button>
              <button className={`ab-tab ${mode === "threshold" ? "active" : ""}`} onClick={() => setMode("threshold")}>③ 신뢰수준 가이드</button>
            </div>

            <div className="ab-pillgroup" style={{ marginTop: "10px" }}>
              <span className="ab-pillgroup-label">테스트 유형</span>
              <button className={`ab-pill ${testType === "binary" ? "active" : ""}`} onClick={() => setTestType("binary")}>Binary · CVR (전환율)</button>
              <button className={`ab-pill ${testType === "continuous" ? "active" : ""}`} onClick={() => setTestType("continuous")}>Continuous · CPR / ARPPU / Revenue</button>
            </div>

            {mode === "plan" && (
              <div className="ab-pillgroup" style={{ marginTop: "10px" }}>
                <span className="ab-pillgroup-label">통화</span>
                <button className={`ab-pill ${currency === "KRW" ? "active" : ""}`} onClick={() => setCurrency("KRW")}>₩ KRW</button>
                <button className={`ab-pill ${currency === "USD" ? "active" : ""}`} onClick={() => setCurrency("USD")}>$ USD</button>
              </div>
            )}
          </section>

          <section className="block" id="s-body">
            {/* ===== Plan mode ===== */}
            {mode === "plan" && (
              <div>
                <h2 className="section-title"><span className="ix">§2</span>① 테스트 시작 전 모수 계산</h2>
                <p style={{ color: "var(--text-secondary)" }}>
                  {testType === "binary"
                    ? "현재 전환율과 탐지하고 싶은 최소 lift(MDE)를 입력하면, 그룹당 필요한 샘플 사이즈가 계산됩니다."
                    : "현재 평균값(μ), MDE, 과거 표준편차(σ)를 입력하면 연속 데이터(CPR, ARPPU, Revenue) 테스트에 필요한 샘플 사이즈가 계산됩니다."}
                </p>
                <div className="ab-form-grid">
                  {testType === "binary" ? (
                    <>
                      <div className="ab-field">
                        <label>현재 전환율 (%) · baseline</label>
                        <input type="number" step="0.01" min="0.01" max="99.99" value={planBaseline} onChange={(e) => setPlanBaseline(e.target.value)} />
                        <span className="ab-field-hint">예: 5% = 5</span>
                      </div>
                      <div className="ab-field">
                        <label>탐지할 최소 lift (%) · MDE (relative)</label>
                        <input type="number" step="0.1" min="0.1" max="500" value={planMde} onChange={(e) => setPlanMde(e.target.value)} />
                        <span className="ab-field-hint">예: baseline 대비 10% 상승 = 10</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="ab-field">
                        <label>현재 평균값 (μ) · baseline mean</label>
                        <input type="number" step="0.01" min="0" value={planMean} onChange={(e) => setPlanMean(e.target.value)} />
                        <span className="ab-field-hint">예: ARPPU {sym}3,500 / 평균 CPR {sym}2,800</span>
                      </div>
                      <div className="ab-field">
                        <label>탐지할 최소 lift (%) · MDE (relative)</label>
                        <input type="number" step="0.1" min="0.1" max="500" value={planMde} onChange={(e) => setPlanMde(e.target.value)} />
                        <span className="ab-field-hint">μ 대비 10% 변동 = 10</span>
                      </div>
                      <div className="ab-field">
                        <label>표준편차 (σ) · 과거 데이터</label>
                        <input type="number" step="0.01" min="0.01" value={planSigma} onChange={(e) => setPlanSigma(e.target.value)} />
                        <span className="ab-field-hint">σ가 클수록 더 많은 샘플 필요</span>
                      </div>
                    </>
                  )}
                  <div className="ab-field">
                    <label>유의수준 α</label>
                    <select value={planAlpha} onChange={(e) => setPlanAlpha(e.target.value)}>
                      <option value="0.10">0.10 (90% 신뢰)</option>
                      <option value="0.05">0.05 (95% 신뢰)</option>
                      <option value="0.01">0.01 (99% 신뢰)</option>
                    </select>
                  </div>
                  <div className="ab-field">
                    <label>검정력 (Power)</label>
                    <select value={planPower} onChange={(e) => setPlanPower(e.target.value)}>
                      <option value="0.70">0.70</option>
                      <option value="0.80">0.80</option>
                      <option value="0.90">0.90</option>
                    </select>
                  </div>
                </div>

                <div className="ab-result" id="ab-plan-result">
                  {!planResult ? (
                    <div className="ab-field-hint" style={{ color: "var(--text-muted)" }}>입력값을 채우면 샘플 사이즈가 계산됩니다.</div>
                  ) : planResult.invalid ? (
                    <div className="callout warn"><div className="ico">!</div><div className="body"><strong>입력값 확인 필요</strong><p>{testType === "binary" ? "baseline × (1 + MDE) 가 1을 초과하거나 음수입니다." : "mean·MDE·σ가 모두 양수여야 합니다."}</p></div></div>
                  ) : (
                    <>
                      <div className="ab-stats-grid">
                        <div className="ab-stat"><div className="ab-stat-label">그룹당 필요 샘플</div><div className="ab-stat-value tnum">{planResult.n.toLocaleString()}</div></div>
                        <div className="ab-stat"><div className="ab-stat-label">2그룹 합산</div><div className="ab-stat-value tnum">{planResult.totalN.toLocaleString()}</div></div>
                        {planResult.kind === "binary" ? (
                          <div className="ab-stat"><div className="ab-stat-label">기대 전환율 A → B</div><div className="ab-stat-value tnum">{(planResult.p1 * 100).toFixed(2)}% → {(planResult.p2 * 100).toFixed(2)}%</div></div>
                        ) : (
                          <>
                            <div className="ab-stat"><div className="ab-stat-label">기대 평균 A → B</div><div className="ab-stat-value tnum">{fmtCurrency(planResult.mean, currency)} → {fmtCurrency(planResult.mean * (1 + planResult.mde), currency)}</div></div>
                            <div className="ab-stat"><div className="ab-stat-label">변동계수 (CV = σ/μ)</div><div className="ab-stat-value tnum">{planResult.cv.toFixed(3)}</div></div>
                            <div className="ab-stat"><div className="ab-stat-label">절대 효과 (δ)</div><div className="ab-stat-value tnum">{fmtCurrency(planResult.delta, currency)}</div></div>
                          </>
                        )}
                        <div className="ab-stat"><div className="ab-stat-label">z_α/2 + z_β</div><div className="ab-stat-value tnum">{planResult.zA.toFixed(3)} + {planResult.zB.toFixed(3)}</div></div>
                      </div>
                      <p style={{ marginTop: "0.75rem", fontSize: "13px", color: "var(--text-secondary)" }}>
                        일평균 트래픽이 5,000명이면 약 <strong>{Math.ceil(planResult.totalN / 5000)}일</strong>, 10,000명이면 약 <strong>{Math.ceil(planResult.totalN / 10000)}일</strong>의 운영이 필요합니다.
                      </p>
                    </>
                  )}
                </div>

                <h3 className="sub-title" style={{ marginTop: "1.5rem" }}>예산 계산기</h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                  예상 CPR(Cost Per Result)을 입력하면, 위 샘플 사이즈 기준 필요한 총 예산이 계산됩니다. CPR_B를 비우면 A와 동일하다고 가정합니다.
                </p>
                <div className="ab-form-grid">
                  <div className="ab-field">
                    <label>예상 CPR · Arm A ({sym})</label>
                    <input type="number" step="1" min="0" value={planCprA} onChange={(e) => setPlanCprA(e.target.value)} />
                    <span className="ab-field-hint">전환 1건당 비용</span>
                  </div>
                  <div className="ab-field">
                    <label>예상 CPR · Arm B ({sym}, 선택)</label>
                    <input type="number" step="1" min="0" placeholder="비우면 A와 동일" value={planCprB} onChange={(e) => setPlanCprB(e.target.value)} />
                    <span className="ab-field-hint">CPR이 다른 변형 운영 시</span>
                  </div>
                </div>
                <div className="ab-result" id="ab-plan-budget-result">
                  {!budgetResult ? (
                    <div className="ab-field-hint" style={{ color: "var(--text-muted)" }}>CPR A 입력 시 예산이 계산됩니다.</div>
                  ) : (
                    <>
                      <div className="ab-stats-grid">
                        <div className="ab-stat"><div className="ab-stat-label">Arm A 예산</div><div className="ab-stat-value tnum">{fmtCurrency(budgetResult.costA, currency)}</div></div>
                        <div className="ab-stat"><div className="ab-stat-label">Arm B 예산</div><div className="ab-stat-value tnum">{fmtCurrency(budgetResult.costB, currency)}</div></div>
                        <div className="ab-stat" style={{ gridColumn: "1 / -1" }}><div className="ab-stat-label">총 필요 예산</div><div className="ab-stat-value tnum">{fmtCurrency(budgetResult.total, currency)}</div></div>
                      </div>
                      <p style={{ marginTop: "0.5rem", fontSize: "12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                        CPR A = {fmtCurrency(budgetResult.cprA, currency)} · CPR B = {fmtCurrency(budgetResult.cprB, currency)} · n_per_arm = {planResult.n.toLocaleString()}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ===== Analyze mode ===== */}
            {mode === "analyze" && testType === "binary" && (
              <div>
                <h2 className="section-title"><span className="ix">§2</span>② Binary (CVR) 결과 분석</h2>
                <p style={{ color: "var(--text-secondary)" }}>각 그룹의 노출 수와 전환 수를 입력하면 Frequentist(z-test)와 Bayesian 결과를 동시에 보여줍니다.</p>
                <div className="ab-form-grid ab-form-grid-2col">
                  <div>
                    <div className="ab-arm-title">Arm A · Control</div>
                    <div className="ab-field"><label>노출 수 (n_A)</label><input type="number" min="1" value={anNa} onChange={(e) => setAnNa(e.target.value)} /></div>
                    <div className="ab-field"><label>전환 수 (x_A)</label><input type="number" min="0" value={anXa} onChange={(e) => setAnXa(e.target.value)} /></div>
                  </div>
                  <div>
                    <div className="ab-arm-title">Arm B · Variant</div>
                    <div className="ab-field"><label>노출 수 (n_B)</label><input type="number" min="1" value={anNb} onChange={(e) => setAnNb(e.target.value)} /></div>
                    <div className="ab-field"><label>전환 수 (x_B)</label><input type="number" min="0" value={anXb} onChange={(e) => setAnXb(e.target.value)} /></div>
                  </div>
                </div>
                <div className="ab-result" id="ab-an-result">
                  {!analyzeBinary ? null : analyzeBinary.invalid ? (
                    <div className="callout warn"><div className="ico">!</div><div className="body"><strong>입력값 확인 필요</strong><p>각 그룹 노출 수는 1 이상, 전환 수는 0 ~ 노출 수 범위여야 합니다.</p></div></div>
                  ) : (() => {
                    const { freq, bayes } = analyzeBinary;
                    const liftPositive = freq.liftRel >= 0;
                    const winner = bayes.probBWins >= 0.95 ? "B 우세 (강한 증거)" : bayes.probBWins >= 0.8 ? "B 우세 (보통 증거)" : bayes.probBWins >= 0.5 ? "약한 B 우세" : bayes.probBWins >= 0.2 ? "약한 A 우세" : "A 우세 (강한 증거)";
                    return (
                      <div className="ab-result-split">
                        <div className="ab-result-block">
                          <div className="ab-result-block-title">Frequentist · z-test</div>
                          <div className="ab-stats-grid">
                            <div className="ab-stat"><div className="ab-stat-label">전환율 A / B</div><div className="ab-stat-value tnum">{(freq.pA * 100).toFixed(2)}% / {(freq.pB * 100).toFixed(2)}%</div></div>
                            <div className="ab-stat"><div className="ab-stat-label">상대 Lift</div><div className="ab-stat-value tnum" style={{ color: liftPositive ? undefined : "#ef4444" }}>{(freq.liftRel * 100).toFixed(2)}%</div></div>
                            <div className="ab-stat"><div className="ab-stat-label">z-score</div><div className="ab-stat-value tnum">{freq.z.toFixed(3)}</div></div>
                            <div className="ab-stat"><div className="ab-stat-label">p-value</div><div className="ab-stat-value tnum">{freq.pValue.toFixed(4)} <PvBadge p={freq.pValue} /></div></div>
                            <div className="ab-stat" style={{ gridColumn: "1 / -1" }}><div className="ab-stat-label">절대 차이 95% CI</div><div className="ab-stat-value tnum">[ {(freq.ciLow95 * 100).toFixed(2)}% , {(freq.ciHigh95 * 100).toFixed(2)}% ]</div></div>
                            <div className="ab-stat" style={{ gridColumn: "1 / -1" }}><div className="ab-stat-label">판정</div><div className="ab-stat-value" style={{ color: verdictColor(freq.pValue, liftPositive), fontWeight: 700 }}>{freq.pValue < 0.05 ? (liftPositive ? "유의미한 개선 (Ship)" : "유의미한 악화 (Kill)") : "비유의 (Inconclusive)"}</div></div>
                          </div>
                        </div>
                        <div className="ab-result-block">
                          <div className="ab-result-block-title">Bayesian · Beta-Binomial</div>
                          <div className="ab-stats-grid">
                            <div className="ab-stat"><div className="ab-stat-label">P(B &gt; A)</div><div className="ab-stat-value tnum">{(bayes.probBWins * 100).toFixed(2)}%</div></div>
                            <div className="ab-stat"><div className="ab-stat-label">기대 Lift</div><div className="ab-stat-value tnum">{(bayes.expectedLift * 100).toFixed(2)}%</div></div>
                            <div className="ab-stat"><div className="ab-stat-label">A 95% CI</div><div className="ab-stat-value tnum">[ {(bayes.ciA[0] * 100).toFixed(2)} , {(bayes.ciA[1] * 100).toFixed(2)} ]</div></div>
                            <div className="ab-stat"><div className="ab-stat-label">B 95% CI</div><div className="ab-stat-value tnum">[ {(bayes.ciB[0] * 100).toFixed(2)} , {(bayes.ciB[1] * 100).toFixed(2)} ]</div></div>
                            <div className="ab-stat" style={{ gridColumn: "1 / -1" }}><div className="ab-stat-label">의사결정 권고</div><div className="ab-stat-value">{winner}</div></div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {mode === "analyze" && testType === "continuous" && (
              <div>
                <h2 className="section-title"><span className="ix">§2</span>② Continuous (CPR/ARPPU/Revenue) 결과 분석</h2>
                <p style={{ color: "var(--text-secondary)" }}>각 그룹의 표본 수(n), 평균(mean), 표준편차(sd)를 입력하면 Welch 근사 기반으로 평균 차이의 유의성을 검정합니다.</p>
                <div className="ab-form-grid ab-form-grid-2col">
                  <div>
                    <div className="ab-arm-title">Arm A · Control</div>
                    <div className="ab-field"><label>표본 수 (n_A)</label><input type="number" min="1" value={ancNa} onChange={(e) => setAncNa(e.target.value)} /></div>
                    <div className="ab-field"><label>평균 (μ_A)</label><input type="number" step="0.01" value={ancMa} onChange={(e) => setAncMa(e.target.value)} /></div>
                    <div className="ab-field"><label>표준편차 (s_A)</label><input type="number" step="0.01" min="0" value={ancSa} onChange={(e) => setAncSa(e.target.value)} /></div>
                  </div>
                  <div>
                    <div className="ab-arm-title">Arm B · Variant</div>
                    <div className="ab-field"><label>표본 수 (n_B)</label><input type="number" min="1" value={ancNb} onChange={(e) => setAncNb(e.target.value)} /></div>
                    <div className="ab-field"><label>평균 (μ_B)</label><input type="number" step="0.01" value={ancMb} onChange={(e) => setAncMb(e.target.value)} /></div>
                    <div className="ab-field"><label>표준편차 (s_B)</label><input type="number" step="0.01" min="0" value={ancSb} onChange={(e) => setAncSb(e.target.value)} /></div>
                  </div>
                </div>
                <div className="ab-result" id="ab-anc-result">
                  {!analyzeContinuous ? null : analyzeContinuous.invalid ? (
                    <div className="callout warn"><div className="ico">!</div><div className="body"><strong>입력값 확인 필요</strong><p>n ≥ 1, mean / sd는 숫자, sd ≥ 0 이어야 합니다.</p></div></div>
                  ) : (() => {
                    const { r, smallSample } = analyzeContinuous;
                    const liftPositive = r.liftRel >= 0;
                    return (
                      <>
                        {smallSample && (
                          <div className="callout warn" style={{ marginBottom: "0.75rem" }}><div className="ico">!</div><div className="body"><strong>샘플 크기가 작습니다 (n &lt; 30)</strong><p>근사 신뢰성 낮음. 표본을 더 모으거나 t-분포 기반 검정을 권장합니다.</p></div></div>
                        )}
                        <div className="ab-result-split">
                          <div className="ab-result-block" style={{ gridColumn: "1 / -1" }}>
                            <div className="ab-result-block-title">Welch 근사 · 평균 비교</div>
                            <div className="ab-stats-grid">
                              <div className="ab-stat"><div className="ab-stat-label">평균 A / B</div><div className="ab-stat-value tnum">{fmtCurrency(r.meanA, currency)} / {fmtCurrency(r.meanB, currency)}</div></div>
                              <div className="ab-stat"><div className="ab-stat-label">표준편차 A / B</div><div className="ab-stat-value tnum">{fmtCurrency(r.sdA, currency)} / {fmtCurrency(r.sdB, currency)}</div></div>
                              <div className="ab-stat"><div className="ab-stat-label">절대 차이 (B - A)</div><div className="ab-stat-value tnum" style={{ color: liftPositive ? undefined : "#ef4444" }}>{fmtCurrency(r.liftAbs, currency)}</div></div>
                              <div className="ab-stat"><div className="ab-stat-label">상대 Lift</div><div className="ab-stat-value tnum" style={{ color: liftPositive ? undefined : "#ef4444" }}>{(r.liftRel * 100).toFixed(2)}%</div></div>
                              <div className="ab-stat"><div className="ab-stat-label">t-score</div><div className="ab-stat-value tnum">{r.z.toFixed(3)}</div></div>
                              <div className="ab-stat"><div className="ab-stat-label">p-value</div><div className="ab-stat-value tnum">{r.pValue.toFixed(4)} <PvBadge p={r.pValue} /></div></div>
                              <div className="ab-stat" style={{ gridColumn: "1 / -1" }}><div className="ab-stat-label">평균차 95% CI</div><div className="ab-stat-value tnum">[ {fmtCurrency(r.ciLow95, currency)} , {fmtCurrency(r.ciHigh95, currency)} ]</div></div>
                              <div className="ab-stat"><div className="ab-stat-label">Welch-Satterthwaite df</div><div className="ab-stat-value tnum">{r.df.toFixed(1)}</div></div>
                              <div className="ab-stat" style={{ gridColumn: "1 / -1" }}><div className="ab-stat-label">판정</div><div className="ab-stat-value" style={{ color: verdictColor(r.pValue, liftPositive), fontWeight: 700 }}>{r.pValue < 0.05 ? (liftPositive ? "유의미한 개선" : "유의미한 악화") : "비유의 (Inconclusive)"}</div></div>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ===== Threshold mode ===== */}
            {mode === "threshold" && (
              <div>
                <h2 className="section-title"><span className="ix">§2</span>③ 모수 크기별 추천 신뢰수준 가이드</h2>
                <p style={{ color: "var(--text-secondary)" }}>
                  α = 0.05, Power = 0.80 기준 그룹당 필요 샘플 사이즈 매트릭스 ({thresholdMatrix.kind === "binary" ? "Binary · CVR" : "Continuous · CV = σ/μ 사용, baseline 값에 무관"}). 일평균 트래픽으로 나누면 테스트 기간 산정 가능.
                </p>
                <div className="table-wrap" style={{ marginBottom: "1.5rem" }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{thresholdMatrix.kind === "binary" ? "Baseline CVR ↓ \\ MDE →" : "CV (σ/μ) ↓ \\ MDE →"}</th>
                        {thresholdMatrix.mdes.map((m) => <th key={m}>{(m * 100).toFixed(0)}%</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(thresholdMatrix.kind === "binary" ? thresholdMatrix.baselines : thresholdMatrix.cvs).map((rowKey, i) => (
                        <tr key={rowKey}>
                          <td><strong>{thresholdMatrix.kind === "binary" ? `${(rowKey * 100).toFixed(0)}%` : rowKey.toFixed(2)}</strong></td>
                          {thresholdMatrix.cells[i].map((n, j) => <td key={j} className="tnum">{isFinite(n) ? n.toLocaleString() : "—"}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {thresholdMatrix.kind === "continuous" && (
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                    예시: ARPPU 평균 {sym}3,500, σ {sym}1,200 → CV ≈ 0.34 → MDE 10% 탐지에 그룹당 약 {STATS.sampleSizeContinuous({ baselineMean: 1, mdeRelative: 0.1, sigma: 0.34 }).n.toLocaleString()}명 필요.
                  </p>
                )}
                <h3 className="sub-title">권장 사항</h3>
                <ul>
                  <li><strong>샘플 부족 (그룹당 1,000 미만)</strong> → 검정 신뢰성 낮음. MDE 상향 또는 기간 연장</li>
                  <li><strong>샘플 충분 (10,000+)</strong> → α=0.05, Power=0.80 표준. 엄격한 결정엔 α=0.01</li>
                  <li><strong>매우 큰 샘플 (100,000+)</strong> → 작은 차이도 유의. 실질적 의미(practical significance) 별도 판단</li>
                  <li><strong>멀티 변형 (A/B/C/D…)</strong> → Bonferroni 보정: α를 변형 수로 나눔</li>
                  <li><strong>조기 종료(peeking) 금지</strong> → 사전 계산 샘플 도달 전 중단 시 1종 오류율 폭증</li>
                  {thresholdMatrix.kind === "continuous" && <li><strong>연속 데이터 σ 추정</strong> → 과거 동일 지표의 표준편차 사용. 없으면 1주 파일럿으로 추정</li>}
                </ul>
              </div>
            )}
          </section>

          <section className="block" id="s-mass">
            <h2 className="section-title"><span className="ix">§3</span>대량 실험 검정 (Mass Test Readout)</h2>
            <div className="callout warning">
              <div className="ico">!</div>
              <div className="body">
                <strong>CSV 업로드</strong>
                <p>실험 결과 CSV(arm_id·is_control·numerator·denominator)를 업로드하면 &quot;실험 판독&quot; 탭에서 대조군 대비 모든 arm의 유의성을 한 번에 확인할 수 있습니다.</p>
                <div style={{ marginTop: "1rem" }}>
                  <CsvUploader toolId="5-4" />
                </div>
              </div>
            </div>
          </section>

          <section className="block" id="s-powercurve">
            <h2 className="section-title"><span className="ix">§4</span>MDE vs Sample Size 파워 커브</h2>
            <p style={{ color: "var(--text-secondary)" }}>표본 수(그룹당)가 커질수록 통계적으로 탐지 가능한 최소 효과 크기(MDE)가 줄어듭니다. baseline 전환율이 낮을수록 더 많은 표본이 필요합니다.</p>
            <div className="ab-form-grid">
              <div className="ab-field">
                <label>현재 전환율 (%) · baseline</label>
                <input type="number" step="0.01" min="0.01" max="99.99" value={pcBaseline} onChange={(e) => setPcBaseline(e.target.value)} />
              </div>
              <div className="ab-field">
                <label>유의수준 α</label>
                <select value={pcAlpha} onChange={(e) => setPcAlpha(e.target.value)}>
                  <option value="0.10">0.10 (90% 신뢰)</option>
                  <option value="0.05">0.05 (95% 신뢰)</option>
                  <option value="0.01">0.01 (99% 신뢰)</option>
                </select>
              </div>
              <div className="ab-field">
                <label>검정력 (Power)</label>
                <select value={pcPower} onChange={(e) => setPcPower(e.target.value)}>
                  <option value="0.70">0.70</option>
                  <option value="0.80">0.80</option>
                  <option value="0.90">0.90</option>
                </select>
              </div>
            </div>
            <div className="chart-container" style={{ height: "340px" }}>
              <canvas id="ab-power-chart"></canvas>
            </div>
          </section>

          <section className="block" id="s-notes">
            <h2 className="section-title"><span className="ix">§5</span>통계 노트</h2>
            <ul>
              <li><strong>Binary (CVR) · z-test</strong>: <code className="inline">z = (p̂_B - p̂_A) / √(p̄(1-p̄)(1/n_A + 1/n_B))</code>. p-value &lt; α 시 귀무가설 기각.</li>
              <li><strong>Binary · Sample Size</strong>: <code className="inline">n = 2 × (z_α/2 + z_β)² × p̄(1-p̄) / δ²</code></li>
              <li><strong>Continuous · Welch</strong>: <code className="inline">z = (μ̂_B - μ̂_A) / √(s_A²/n_A + s_B²/n_B)</code>. n &gt; 30 per arm일 때 정확.</li>
              <li><strong>Bayesian</strong>: Binary 전용. 사전 Beta(1,1). 사후 Beta(1+x, 1+n-x). Monte Carlo 10,000 sim.</li>
              <li><strong>예산 계산</strong>: <code className="inline">Total Budget = n_per_arm × (CPR_A + CPR_B)</code>.</li>
              <li><strong>파워 커브</strong>: sample size 기준으로 역산(이분 탐색)하여 탐지 가능한 최소 MDE 도출.</li>
            </ul>
          </section>
        </>
      )}

      {activeTab === "readout" && (
        <>
          <section className="block" id="s-prep">
            <h2 className="section-title">데이터 준비</h2>
            {!readoutData ? (
              <div className="callout warning">
                <div className="ico">!</div>
                <div className="body">
                  <strong>실험 결과 CSV 업로드 대기</strong>
                  <p>필수: is_control·numerator·denominator (옵션: arm_id로 다중 변형 대량 검정)</p>
                  <div style={{ marginTop: "1rem" }}><CsvUploader toolId="5-4" /></div>
                </div>
              </div>
            ) : (
              <div className="callout"><div className="ico">i</div><div className="body"><p style={{ margin: 0 }}>{csvData?.fileName ? <strong>{csvData.fileName}</strong> : "업로드된 데이터"} · {csvData?.raw?.length?.toLocaleString?.()}행. Control/Test 집계 후 two-proportion z-test로 유의성 검정.</p></div></div>
            )}
          </section>

          {readoutData && (
            <>
              <section className="block" id="s-readout-sig">
                <h2 className="section-title">유의성 검정 (Control vs Test)</h2>
                {readoutData.sig ? (() => {
                  const s = readoutData.sig;
                  const liftPositive = s.liftRel >= 0;
                  return (
                    <div className="alloc-card" style={{ borderLeft: `3px solid ${verdictColor(s.pValue, liftPositive)}` }}>
                      <div className="ab-stat-row" style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
                        <div className="ab-stat"><div className="ab-stat-label">Control 전환율</div><div className="ab-stat-value tnum">{readoutData.cRate.toFixed(2)}%</div><div className="ab-stat-hint">{readoutData.cNum.toLocaleString()}/{readoutData.cDen.toLocaleString()}</div></div>
                        <div className="ab-stat"><div className="ab-stat-label">Test 전환율</div><div className="ab-stat-value tnum">{readoutData.tRate.toFixed(2)}%</div><div className="ab-stat-hint">{readoutData.tNum.toLocaleString()}/{readoutData.tDen.toLocaleString()}</div></div>
                        <div className="ab-stat"><div className="ab-stat-label">상대 Lift</div><div className="ab-stat-value tnum" style={{ color: liftPositive ? undefined : "#ef4444" }}>{(s.liftRel * 100).toFixed(2)}%</div></div>
                        <div className="ab-stat"><div className="ab-stat-label">z-score</div><div className="ab-stat-value tnum">{s.z.toFixed(3)}</div></div>
                        <div className="ab-stat"><div className="ab-stat-label">p-value</div><div className="ab-stat-value tnum">{s.pValue.toFixed(4)} <PvBadge p={s.pValue} /></div></div>
                        <div className="ab-stat"><div className="ab-stat-label">절대차 95% CI</div><div className="ab-stat-value tnum">[ {(s.ciLow95 * 100).toFixed(2)}% , {(s.ciHigh95 * 100).toFixed(2)}% ]</div></div>
                      </div>
                      <div style={{ marginTop: "12px", fontWeight: 700, color: verdictColor(s.pValue, liftPositive) }}>
                        {s.pValue < 0.05 ? (liftPositive ? "✓ 유의미한 개선 (Ship 후보)" : "✗ 유의미한 악화 (Kill)") : "— 비유의 (Inconclusive — 더 많은 데이터 필요)"}
                      </div>
                    </div>
                  );
                })() : (
                  <div className="callout warn"><div className="ico">!</div><div className="body"><strong>Control/Test 양쪽 데이터가 필요합니다</strong><p>is_control 컬럼으로 대조군을 구분하고 numerator/denominator를 채우세요.</p></div></div>
                )}
              </section>

              {readoutData.mass && readoutData.mass.control && (
                <section className="block" id="s-readout-mass">
                  <h2 className="section-title">대량 검정 (arm_id별)</h2>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "6px 0 10px" }}>
                    대조군: <strong>{readoutData.mass.control.name}</strong> (n={readoutData.mass.control.n.toLocaleString()}, 전환율 {((readoutData.mass.control.x / readoutData.mass.control.n) * 100).toFixed(2)}%)
                  </p>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr><th>Arm</th><th>표본수</th><th>전환율</th><th>대조군 대비 Lift</th><th>z</th><th>p-value</th><th>95% CI (절대차)</th><th>P(B&gt;A)</th><th>유의성</th></tr>
                      </thead>
                      <tbody>
                        {readoutData.mass.rows.map((r, i) => (
                          <tr key={i}>
                            <td>{r.name}{r.isControl ? <span style={{ color: "var(--text-muted)", fontSize: "11px" }}> (control)</span> : ""}</td>
                            <td className="tnum">{r.n.toLocaleString()}</td>
                            <td className="tnum">{(r.rate * 100).toFixed(2)}%</td>
                            <td className="tnum" style={{ color: r.isControl || r.liftRel >= 0 ? undefined : "#ef4444" }}>{r.isControl ? "—" : (r.liftRel * 100).toFixed(2) + "%"}</td>
                            <td className="tnum">{r.isControl ? "—" : r.z.toFixed(3)}</td>
                            <td className="tnum">{r.isControl ? "—" : r.pValue.toFixed(4)}</td>
                            <td className="tnum">{r.isControl ? "—" : `[${(r.ciLow95 * 100).toFixed(2)}%, ${(r.ciHigh95 * 100).toFixed(2)}%]`}</td>
                            <td className="tnum">{r.isControl ? "—" : isNaN(r.probBWins) ? "—" : (r.probBWins * 100).toFixed(1) + "%"}</td>
                            <td>{r.isControl ? <span className="pill tier-3">대조군</span> : r.pValue < 0.01 ? <span className="pill tier-1">p &lt; 0.01</span> : r.pValue < 0.05 ? <span className="pill tier-2">p &lt; 0.05</span> : <span className="pill tier-3">비유의</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="block" id="s-readout-chart">
                <h2 className="section-title">판독 결과 차트</h2>
                <div className="chart-container" style={{ height: "300px", marginTop: "20px" }}>
                  <canvas id="ab-bar"></canvas>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {activeTab === "holdout" && (
        <>
          <section className="block" id="s-prep">
            <h2 className="section-title">데이터 준비</h2>
            {!holdoutData ? (
              <div className="callout warning">
                <div className="ico">!</div>
                <div className="body">
                  <strong>홀드아웃 CSV 업로드 대기</strong>
                  <p>필수: holdout_group(test/control)·numerator(전환수)·denominator(그룹 사용자수). 옵션: spend·revenue_d7</p>
                  <div style={{ marginTop: "1rem" }}><CsvUploader toolId="5-4" /></div>
                </div>
              </div>
            ) : holdoutData.insufficient ? (
              <div className="callout warn"><div className="ico">!</div><div className="body"><strong>test/control 양쪽 데이터가 필요합니다</strong><p>holdout_group이 test(exposed)와 control(holdout) 둘 다 있어야 증분을 계산합니다.</p></div></div>
            ) : (
              <div className="callout"><div className="ico">i</div><div className="body"><p style={{ margin: 0 }}>{csvData?.fileName ? <strong>{csvData.fileName}</strong> : "업로드된 데이터"}. 반사실 = test 인원 × control 전환율 기준 증분 산출.</p></div></div>
            )}
          </section>

          {holdoutData && !holdoutData.insufficient && (
            <section className="block" id="s-incr">
              <h2 className="section-title"><span className="ix">§1</span>증분 결과 (test vs control)</h2>
              {(() => {
                const h = holdoutData;
                const liftPositive = h.liftRel != null && h.liftRel > 0;
                const isSig = h.sig && h.sig.pValue < 0.05;
                // 절대 lift 95% CI (unpooled)
                const cR = h.cRate / 100, tR = h.tRate / 100;
                const se = Math.sqrt((cR * (1 - cR)) / h.cDen + (tR * (1 - tR)) / h.tDen);
                const lo = (h.liftAbs - 1.96 * se) * 100, hi = (h.liftAbs + 1.96 * se) * 100;
                const crossesZero = lo <= 0 && hi >= 0;
                return (
                  <div className="alloc-card" style={{ marginBottom: "14px", borderLeft: `3px solid ${liftPositive && isSig ? "#22c55e" : "#fbbf24"}` }}>
                    <div className="ab-stat-row" style={{ display: "flex", flexWrap: "wrap", gap: "16px", margin: "8px 0" }}>
                      <div className="ab-stat"><div className="ab-stat-label">Control 전환율</div><div className="ab-stat-value tnum">{h.cRate.toFixed(2)}%</div><div className="ab-stat-hint">{h.cNum.toLocaleString()}/{h.cDen.toLocaleString()}</div></div>
                      <div className="ab-stat"><div className="ab-stat-label">Test 전환율</div><div className="ab-stat-value tnum">{h.tRate.toFixed(2)}%</div><div className="ab-stat-hint">{h.tNum.toLocaleString()}/{h.tDen.toLocaleString()}</div></div>
                      <div className="ab-stat"><div className="ab-stat-label">상대 Lift</div><div className="ab-stat-value tnum" style={{ color: liftPositive ? "#22c55e" : "#ef4444" }}>{h.liftRel != null ? (h.liftRel > 0 ? "+" : "") + (h.liftRel * 100).toFixed(1) + "%" : "—"}</div><div className="ab-stat-hint" style={{ color: crossesZero ? "var(--text-muted)" : undefined }}>95%CI [{lo.toFixed(2)}, {hi.toFixed(2)}]%p{crossesZero ? " · 0 포함(불확실)" : ""}</div></div>
                      <div className="ab-stat"><div className="ab-stat-label">증분 전환</div><div className="ab-stat-value tnum">{Math.round(h.incrementalConv).toLocaleString()}</div><div className="ab-stat-hint">test − 반사실</div></div>
                      {h.cpia != null && <div className="ab-stat"><div className="ab-stat-label">증분 전환당 비용</div><div className="ab-stat-value tnum">{fmtCurrency(h.cpia, currency)}</div></div>}
                      {h.iroas != null && <div className="ab-stat"><div className="ab-stat-label">iROAS</div><div className="ab-stat-value tnum" style={{ color: h.iroas >= 1 ? "#22c55e" : "#ef4444" }}>{h.iroas.toFixed(2)}×</div><div className="ab-stat-hint">증분매출/비용</div></div>}
                      <div className="ab-stat"><div className="ab-stat-label">유의성</div><div className="ab-stat-value" style={{ fontSize: "13px" }}>{h.sig ? (h.sig.pValue < 0.05 ? <span style={{ color: "#22c55e" }}>유의 (p={h.sig.pValue.toFixed(4)})</span> : <span style={{ color: "var(--text-muted)" }}>무유의 (p={h.sig.pValue.toFixed(3)})</span>) : "—"}</div></div>
                    </div>
                    <div style={{ fontWeight: 700, color: verdictColor(h.sig?.pValue, liftPositive), marginTop: "8px" }}>
                      {isSig ? (liftPositive ? "✓ 유의미한 증분 효과 확인" : "✗ 유의미한 음의 효과") : "— 증분 신호 불확실 (더 많은 데이터 필요)"}
                    </div>
                  </div>
                );
              })()}
              <div className="callout" style={{ marginTop: "8px" }}><div className="ico">i</div><div className="body"><p style={{ margin: 0, fontSize: "12px" }}>
                <strong>증분 전환</strong> = test 전환 − (test 인원 × control 전환율). 어트리뷰션과 달리 holdout은 <strong>광고가 없었어도 일어났을 전환(control)</strong>을 빼서 진짜 기여만 봅니다. iROAS &lt; 1이면 증분 기준 적자, lift가 통계적으로 유의해야 신뢰 가능합니다.
              </p></div></div>
            </section>
          )}

          <section className="block" id="s-holdout-chart">
            <h2 className="section-title">홀드아웃 결과 차트</h2>
            <div className="chart-container" style={{ height: "300px", marginTop: "20px" }}>
              <canvas id="holdout-bar"></canvas>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
