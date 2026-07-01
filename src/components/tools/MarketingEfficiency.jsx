"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "@/store/useDataStore";
import Chart from "chart.js/auto";
import { ALLOC_MATH } from "@/utils/allocationMath";
import { getCssVar, downloadChartAsPNG } from "@/utils/chartUtils";
import CsvUploader from "@/components/CsvUploader";
import { showToast } from "@/utils/toast";
import {
  satActiveVerdict,
  satActiveIndex,
  satVerdictMeta,
  satAvailableFields,
  satBuildPoints,
  SAT_MATH,
  SAT_CONFIG,
} from "@/utils/satMath";
import { effectiveDenomBasis, getMappedRows } from "@/utils/dashboardAggregator";
import { TOOL_REQUIRED_FIELDS, TOOL_OPTIONAL_FIELDS } from "@/utils/csvConstants";
import BasisCurrencyToggleBar from "@/components/dashboard/BasisCurrencyToggleBar";
import ToolPageShell from "@/components/ToolPageShell";

// 우측 TOC — legacy page_5_22() 목차와 동일 (§0 요약/§1 순위/§2 응답곡선).
// 실제 렌더되는 section id(analyzed 분기 하위)만 포함 — 없는 앵커 추가 금지.
const SAT_TOC = [
  { id: "s-sat-summary", title: "요약" },
  { id: "s-sat", title: "포화도 순위" },
  { id: "s-sat-curve", title: "응답곡선" },
];

const CURRENCY_SYMBOLS = { KRW: "₩", USD: "$" };

/* index.html fmtCurrency 이식 — 통화 토글은 기호/소수 자리수만 바꿈(FX 변환 없음:
   USD metric=소수 1자리, KRW/절대값=정수). 통화는 render-time 인자로 주입. */
function fmtCurrency(value, currency, opts = {}) {
  if (value == null || !isFinite(value)) return "—";
  const sym = CURRENCY_SYMBOLS[currency] || "₩";
  const isUSD = currency === "USD";
  const decimals = isUSD && opts.metric ? 1 : 0;
  return `${sym}${Number(value).toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/* index.html buildToolTemplateCsv(toolId, "tool") 이식 (BOM+CRLF, canonical 헤더) —
   이 도구가 실제 쓰는 필드(필수+옵션)만 빈 헤더 CSV로. creative_id→creative_name 등
   canonical 규칙은 5-22엔 해당 없음. §7 CRLF+BOM 준수. */
function satToolTemplateFields(toolId) {
  const reqs = TOOL_REQUIRED_FIELDS[toolId] || [];
  const opts = TOOL_OPTIONAL_FIELDS[toolId] || [];
  const keys = [];
  reqs.forEach((r) => {
    if (typeof r === "string") keys.push(r);
    else if (r.oneOf) r.oneOf.forEach((k) => keys.push(k));
  });
  opts.forEach((o) => keys.push(o.key));
  // canonical header 순서: 디멘션 먼저 → 지표 (index dfmUnifiedFields 순서 근사)
  const order = ["date", "country", "platform", "channel", "campaign_name", "adgroup_name", "creative_name", "url", "cost", "spend", "impressions", "clicks", "installs", "actions"];
  const uniq = [...new Set(keys)];
  return uniq.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

function downloadSatTemplateCsv(toolId) {
  const fields = satToolTemplateFields(toolId);
  // revenue_d7 옵션도 헤더에 노출(ROAS 진단용) — 표준 필드에 존재하면 canonical 헤더 사용
  if ((TOOL_OPTIONAL_FIELDS[toolId] || []).some((o) => o.key === "revenue_d7") && !fields.includes("revenue_d7")) {
    fields.push("revenue_d7");
  }
  const headers = [...new Set(fields.map((k) => k))];
  const csv = "﻿" + headers.join(",") + "\r\n";
  if (typeof document === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `template_${toolId}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function MarketingEfficiency() {
  const csvData = useAppStore((state) => state.csvData);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  // 전역 분모 기준(설치/가입) 구독 — 포화도 metricField를 basis 따라 installs↔actions 전환(§12.18/#3).
  const denomBasis = useAppStore((state) => state.denomBasis);
  // 분석 게이트: 그룹 시그니처 SSOT (efficiency 패밀리 공유, §12.5/#5). CsvUploader의 단일 분석하기 버튼이 세팅.
  const analyzed = useAppStore((state) => state.isGroupAnalyzed("5-22"));
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const [satState, setSatState] = useState({
    grain: "channel", // channel | campaign
    metric: "cpa", // cpa | roas
    selected: null,
  });
  const [currency, setCurrency] = useState("KRW"); // KRW | USD (기호/소수만 — FX 변환 없음)

  const hasData = csvData && csvData.raw && csvData.raw.length > 0;

  // Extract fields mapping
  const mappedKeys = new Set(Object.values(csvData?.mapping || {}).filter((v) => v && v !== "__ignore__"));
  const hasCampaign = mappedKeys.has("campaign_name");
  const revCandidates = ["revenue_d7", "revenue_d0", "revenue_d14", "revenue_d30", "revenue_d90", "revenue_d180", "revenue_d360"];
  const revField = revCandidates.find((k) => mappedKeys.has(k)) || null;

  // Enforce valid states synchronously
  const effectiveMetric = satState.metric === "roas" && !revField ? "cpa" : satState.metric;
  const effectiveGrain = satState.grain === "campaign" && !hasCampaign ? "channel" : satState.grain;

  // #3 — 결과 field(분모)를 전역 basis 따라 installs↔actions 전환. satMath는 installs 고정 선호라
  // basis-aware metricField를 직접 산출해 satBuildPoints로 점 생성(satAvailableFields는 revField만 재사용).
  // effectiveDenomBasis가 요청 basis 미매핑 시 installs→actions 자동 폴백(효율 패밀리 공통 규칙).
  const effBasis = effectiveDenomBasis(csvData, denomBasis);
  const basisMetricField = mappedKeys.has(effBasis)
    ? effBasis
    : mappedKeys.has("installs")
      ? "installs"
      : mappedKeys.has("actions")
        ? "actions"
        : null;

  const rows = (() => {
    if (!hasData || !basisMetricField) return [];
    const { revField: rev } = satAvailableFields(csvData);
    const mapped = getMappedRows(csvData);
    const pointsMap = satBuildPoints(mapped, effectiveGrain, basisMetricField, rev);
    const out = [];
    for (const [name, pts] of pointsMap) {
      const a = SAT_MATH.analyzeEntity(pts, SAT_CONFIG);
      out.push({ name, raw: pts.length, ...a });
    }
    return out;
  })();
  const okRows = rows
    .filter((r) => r.ok && satActiveVerdict(r, effectiveMetric))
    .sort((a, b) => satActiveIndex(b, effectiveMetric) - satActiveIndex(a, effectiveMetric));
  const badRows = rows.filter((r) => !r.ok || !satActiveVerdict(r, effectiveMetric));

  useEffect(() => {
    if (typeof window === "undefined" || !chartRef.current || !hasData || !analyzed || !okRows.length) return;

    let sel = satState.selected ? okRows.find((r) => r.name === satState.selected) : null;
    if (!sel) sel = okRows[0];
    if (!sel) return;

    const A = ALLOC_MATH;
    const isRoas = effectiveMetric === "roas" && sel.roas;
    const revPerRes = isRoas ? sel.roas.revPerRes : null;
    const xs = sel.kept.map((p) => p.x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    // 관측 구간 밖으로 5% 외삽하던 여유분(margin)을 제거 — Log 모델은 x→0 근처에서
    // a*ln(x) 항이 발산해(a<0이면 +∞) xMin 쪽으로 살짝만 외삽해도 곡선이 비정상적으로
    // 치솟아 보였음(#4). 곡선은 실제 관측 구간[xMin,xMax] 안에서만 그림.
    const fitMin = xMin, fitMax = xMax;
    const chWrap = { model: sel.model, poly2Shape: sel.poly2Shape, xMax };

    const curve = [];
    const STEPS = 60;
    for (let s = 0; s <= STEPS; s++) {
      const x = fitMin + (fitMax - fitMin) * (s / STEPS);
      const cpr = A.predictSafeCpr(chWrap, x);
      if (cpr == null || !isFinite(cpr) || cpr <= 0) continue;
      const y = isRoas ? revPerRes / cpr : cpr;
      if (isFinite(y)) curve.push({ x, y });
    }

    const scatter = sel.kept
      .map((p) => ({
        x: p.x,
        y: isRoas ? (p.rev != null && p.x > 0 ? p.rev / p.x : null) : p.y,
      }))
      .filter((d) => d.y != null && isFinite(d.y));

    const allY = scatter.map((p) => p.y).concat(curve.map((p) => p.y));
    const yLo = Math.min(...allY), yHi = Math.max(...allY);
    const marker = [
      { x: sel.currentCost, y: yLo },
      { x: sel.currentCost, y: yHi },
    ];

    const primary = getCssVar("--primary") || "#7aa2f7";
    const text = getCssVar("--text-muted") || "#9ca3af";
    const grid = getCssVar("--border") || "#2a2a2a";
    const obsLabel = isRoas ? "일별 관측 (Cost vs ROAS)" : "일별 관측 (Cost vs CPA)";
    const yTitle = isRoas ? "ROAS (Revenue/Cost, 높을수록 좋음)" : "CPA (Cost/결과, 낮을수록 좋음)";

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext("2d");
    chartInstance.current = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: obsLabel,
            data: scatter,
            backgroundColor: primary + "55",
            borderColor: primary + "55",
            pointRadius: 3,
            pointStyle: "circle",
            showLine: false,
          },
          {
            label: `적합 ${sel.modelType} (R²=${sel.r2 != null ? sel.r2.toFixed(2) : "—"})`,
            data: curve,
            borderColor: primary,
            backgroundColor: "transparent",
            pointRadius: 0,
            pointStyle: "line",
            showLine: true,
            borderWidth: 2,
            tension: 0.35,
            cubicInterpolationMode: "monotone",
          },
          {
            label: "현 지출점",
            data: marker,
            borderColor: "#f59e0b",
            borderDash: [5, 4],
            pointRadius: 0,
            pointStyle: "line",
            showLine: true,
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          // 점(관측)은 원형, 선(적합곡선/지출점)은 선 모양으로 범례 아이콘이 실제
          // 렌더 형태와 일치하도록(usePointStyle + 각 dataset의 pointStyle 사용).
          legend: { labels: { color: text, font: { size: 11 }, usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
        },
        scales: {
          x: {
            title: { display: true, text: "일 Cost", color: text },
            ticks: { color: text },
            grid: { color: grid },
          },
          y: {
            title: { display: true, text: yTitle, color: text },
            ticks: { color: text },
            grid: { color: grid },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
    // isDarkMode dep: re-evaluate getCssVar theme colors on light/dark toggle
  }, [okRows, satState.selected, effectiveMetric, hasData, analyzed, isDarkMode]);

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-sat">
        <ToolPageShell
          title="마케팅 효율 진단 (Saturation)"
          summary={<p>효율 CSV(일별 채널·캠페인 비용/결과) 한 번 업로드로 채널별 한계 CPA/ROAS를 진단합니다 — 증액하면 효율이 꺾이는지 판정합니다. 5-3 예산 배분과 같은 효율 CSV를 공유합니다.</p>}
        >
          <section className="block" id="s-prep">
            <h2 className="section-title">데이터 준비</h2>
            <div className="callout warning">
              <div className="ico">!</div>
              <div className="body">
                <strong>CSV 업로드 대기</strong>
                <p>
                  효율 CSV(일별 채널·캠페인 비용/결과) 한 번 업로드로 채널별 포화도를 진단합니다.
                  5-3 예산 배분과 같은 효율 CSV를 공유합니다.
                </p>
                <div style={{ marginTop: "1rem" }}>
                  <CsvUploader toolId="5-22" />
                </div>
              </div>
            </div>
          </section>
        </ToolPageShell>
      </div>
    );
  }

  // --- Rendering Helpers ---
  const isRoas = effectiveMetric === "roas";
  const grainLabel = effectiveGrain === "campaign" ? "캠페인" : "채널";
  const metricLabel = isRoas ? "ROAS" : "CPA";
  const sat = okRows.filter((r) => satActiveVerdict(r, effectiveMetric) === "saturated");
  const scale = okRows.filter((r) => satActiveVerdict(r, effectiveMetric) === "scale");

  const fmtRoas = (v) => (v == null || !isFinite(v) ? "—" : `${v.toFixed(2)}x`);
  
  let advice = "";
  if (!okRows.length) {
    advice = `분석 가능한 ${grainLabel}이 없습니다. 각 ${grainLabel}에 최소 ${SAT_CONFIG.minPoints}개 이상의 일별 관측(비용·결과 >0)이 필요합니다.`;
  } else if (sat.length && scale.length) {
    advice = `${sat.slice(0, 2).map(r => r.name).join(", ")}는 이미 포화 — 추가 예산은 ${scale.slice(0, 2).map(r => r.name).join(", ")} 쪽으로 옮기면 같은 돈으로 ${isRoas ? "더 높은 매출" : "더 많은 결과"}를 기대할 수 있습니다.`;
  } else if (sat.length) {
    advice = `${sat.slice(0, 3).map(r => r.name).join(", ")}는 ${metricLabel} 기준 포화 상태 — 증액 시 효율이 빠르게 나빠집니다. 증액보다 소재·타겟 개선이 우선입니다.`;
  } else if (scale.length) {
    advice = `${scale.slice(0, 3).map(r => r.name).join(", ")}는 아직 여유 구간 — 증액하면 효율이 오히려 개선될 여지가 있습니다.`;
  } else {
    advice = `모든 ${grainLabel}이 선형(적정) 구간 — 현 배분을 크게 흔들 근거는 약합니다.`;
  }

  let head = "대부분 적정 구간";
  if (sat.length || scale.length) {
    const parts = [];
    if (sat.length) parts.push(`<span style="color:#f87171;">포화 ${sat.length}개</span> (증액 위험)`);
    if (scale.length) parts.push(`<span style="color:#22c55e;">여유 ${scale.length}개</span> (증액 기회)`);
    head = parts.join(" · ");
  }

  const activeStyle = { background: "var(--bg-2)", borderColor: "var(--text-1)", color: "var(--text-1)" };

  const selName = satState.selected || okRows[0]?.name || "curve";
  const handlePngDownload = () => {
    if (!chartRef.current) {
      showToast({ variant: "warn", title: "차트를 찾을 수 없음", body: "sat-curve-chart" });
      return;
    }
    const safeName = String(selName).replace(/[^a-zA-Z0-9가-힣_-]/g, "_");
    downloadChartAsPNG(chartRef.current, `sat_curve_${safeName}_${effectiveMetric}`);
  };

  return (
    <ToolPageShell
      title="마케팅 효율 진단 (Saturation)"
      chips={<span className="chip"><span className="dot"></span>{csvData?.fileName || ""}</span>}
      summary={
        <>
          <p>
            각 채널·캠페인의 비용↔효율 산점도를 곡선 적합해 <strong>현재 지출점의 한계 효율</strong>을 평균과 비교합니다. 한계가 평균보다 나쁘면 <strong style={{ color: "#f87171" }}>포화(증액 위험)</strong>, 좋으면 <strong style={{ color: "#22c55e" }}>여유(증액 기회)</strong>입니다.
          </p>
          <details style={{ marginTop: "6px", fontSize: "11.5px", color: "var(--text-secondary)", cursor: "pointer" }}>
            <summary>⚠️ 해석 참고</summary>
            <div style={{ marginTop: "6px", padding: "8px 10px", background: "var(--bg-1)", borderLeft: "3px solid var(--primary)", lineHeight: 1.6 }}>
              포화지수 = 한계 CPA ÷ 평균 CPA(ROAS는 평균 ÷ 한계). 1보다 크면 다음 1원이 평균보다 비싸다는 뜻. 관측 범위 밖 외삽은 불안정하므로, 지출 변동이 거의 없는 채널의 곡선은 신뢰도가 낮습니다.
            </div>
          </details>
        </>
      }
      toc={analyzed && okRows.length ? SAT_TOC : undefined}
    >
      {/* 🗂 데이터·매핑 (펼쳐서 변경) — index page_5_22 details 이식.
          미분석 상태면 자동으로 펼침 + 분석 게이트 버튼 노출. */}
      <details className="block" style={{ padding: "13px 16px" }} open={!analyzed}>
        <summary style={{ cursor: "pointer", fontSize: "12.5px", fontWeight: 600, color: analyzed ? "var(--text-muted)" : "var(--primary, #adc6ff)" }}>
          🗂 데이터·매핑 {analyzed ? "(분석 완료 — 펼쳐서 변경)" : "(매핑 확인 후 분석)"}
        </summary>
        <div style={{ marginTop: "10px" }}>
          <CsvUploader toolId="5-22" />
          <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button className="ab-pill" onClick={() => downloadSatTemplateCsv("5-22")} title="이 도구가 쓰는 컬럼만 빈 헤더 CSV로 내려받기 (BOM+CRLF)">
              ⬇ 템플릿 CSV (이 도구)
            </button>
            <span style={{ fontSize: "10.5px", color: "var(--text-muted)" }}>
              효율 CSV는 5-2·5-3와 공유합니다. 통합 템플릿은 5-3 예산 배분에서도 받을 수 있습니다.
            </span>
          </div>
          {/* 분석 게이트 버튼은 CsvUploader가 단독 소유(§12.5/#5) — 위 CsvUploader의 "데이터 분석하기"/"↻ 다시 분석"이 store 그룹 게이트를 세팅. 중복 버튼 제거. */}
        </div>
      </details>

      {/* 기준(설치/가입)·통화 토글 — 이전엔 5-2에만 있어 이 도구는 강제로 설치 기준이었음. */}
      <BasisCurrencyToggleBar />

      {!analyzed ? (
        <section className="block" id="s-sat-gate">
          <div className="callout" style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <div className="ico">▶</div>
            <div className="body">
              <strong>분석 대기 중</strong>
              <p style={{ margin: "4px 0 0" }}>위 &quot;데이터·매핑&quot;에서 컬럼 매핑을 확인한 뒤 <strong>▶ 분석하기</strong>를 누르면 포화도 진단 결과가 나타납니다.</p>
            </div>
          </div>
        </section>
      ) : (
      <>
      <section className="block" id="s-sat-summary">
        <h2 className="section-title"><span className="ix">§0</span>한눈에 보기</h2>
        {okRows.length ? (
          <>
            <div style={{ fontSize: "15px", fontWeight: "600", marginBottom: "6px" }} dangerouslySetInnerHTML={{ __html: head }} />
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.65 }}>{advice}</div>
          </>
        ) : (
          <div className="callout warn">
            <div className="ico">!</div>
            <div className="body">{advice}</div>
          </div>
        )}
      </section>

      <section className="block" id="s-sat">
        <h2 className="section-title"><span className="ix">§1</span>포화도 순위</h2>
        
        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }}>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>분석 단위</span>
            <button
              className="ab-pill"
              style={effectiveGrain === "channel" ? activeStyle : {}}
              onClick={() => setSatState(s => ({...s, grain: "channel", selected: null}))}
            >
              채널
            </button>
            <button
              className="ab-pill"
              disabled={!hasCampaign}
              title={!hasCampaign ? "캠페인명(campaign_name) 컬럼을 매핑하면 활성화" : ""}
              style={{ ...(effectiveGrain === "campaign" ? activeStyle : {}), opacity: !hasCampaign ? 0.4 : 1, cursor: !hasCampaign ? "not-allowed" : "pointer" }}
              onClick={() => setSatState(s => ({...s, grain: "campaign", selected: null}))}
            >
              캠페인
            </button>
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>효율 기준</span>
            <button
              className="ab-pill"
              style={effectiveMetric === "cpa" ? activeStyle : {}}
              onClick={() => setSatState(s => ({...s, metric: "cpa"}))}
            >
              CPA (낮을수록 좋음)
            </button>
            <button
              className="ab-pill"
              disabled={!revField}
              title={!revField ? "매출(revenue) 컬럼을 매핑하면 활성화" : ""}
              style={{ ...(effectiveMetric === "roas" ? activeStyle : {}), opacity: !revField ? 0.4 : 1, cursor: !revField ? "not-allowed" : "pointer" }}
              onClick={() => setSatState(s => ({...s, metric: "roas"}))}
            >
              ROAS (높을수록 좋음)
            </button>
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>표시 통화</span>
            <button
              className="ab-pill"
              style={currency === "KRW" ? activeStyle : {}}
              onClick={() => setCurrency("KRW")}
              title="원화 기호 표시 (환율 변환 없음 — 기호/소수 자리수만 변경)"
            >
              ₩ KRW
            </button>
            <button
              className="ab-pill"
              style={currency === "USD" ? activeStyle : {}}
              onClick={() => setCurrency("USD")}
              title="달러 기호 표시 (환율 변환 없음 — 기호/소수 자리수만 변경)"
            >
              $ USD
            </button>
          </div>
        </div>

        {okRows.length > 0 && (
          <div className="table-wrap">
            <table className="data" style={{ fontSize: "12.5px" }}>
              <thead>
                <tr>
                  <th className="tnum">#</th>
                  <th>{effectiveGrain === "campaign" ? "캠페인" : "채널"}</th>
                  <th>적합 모델</th>
                  <th className="tnum">최근 일예산</th>
                  {isRoas ? (
                    <><th className="tnum">평균 ROAS</th><th className="tnum">한계 ROAS</th></>
                  ) : (
                    <><th className="tnum">평균 CPA</th><th className="tnum">한계 CPA</th></>
                  )}
                  <th className="tnum" title="한계효율 ÷ 평균효율. 1보다 크면 다음 1원이 평균보다 비쌈">포화지수</th>
                  <th>판정</th>
                </tr>
              </thead>
              <tbody>
                {okRows.map((r, i) => {
                  const v = satActiveVerdict(r, effectiveMetric);
                  const vm = satVerdictMeta(v);
                  const idx = satActiveIndex(r, effectiveMetric);
                  const idxStr = idx == null || !isFinite(idx) || idx === 1e9 ? "∞" : `${idx.toFixed(2)}x`;
                  const sel = satState.selected === r.name || (!satState.selected && i === 0);
                  
                  return (
                    <tr 
                      key={r.name} 
                      onClick={() => setSatState(s => ({...s, selected: r.name}))}
                      style={{ cursor: "pointer", background: sel ? "rgba(122,162,247,0.08)" : "transparent" }}
                      title="클릭 → 응답곡선 보기"
                    >
                      <td className="tnum" style={{ color: "var(--text-muted)" }}>{i + 1}</td>
                      <td><strong>{r.name}</strong></td>
                      <td style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        {r.modelType} <span className="tnum">R²={r.r2 != null ? r.r2.toFixed(2) : "—"}</span>
                      </td>
                      <td className="tnum">{fmtCurrency(r.currentCost, currency)}</td>
                      {isRoas ? (
                        <>
                          <td className="tnum">{fmtRoas(r.roas?.avgRoas)}</td>
                          <td className="tnum">{fmtRoas(r.roas?.marginalRoas)}</td>
                        </>
                      ) : (
                        <>
                          <td className="tnum">{fmtCurrency(r.avgCpr, currency, { metric: true })}</td>
                          <td className="tnum">{isFinite(r.marginalCpr) ? fmtCurrency(r.marginalCpr, currency, { metric: true }) : "∞"}</td>
                        </>
                      )}
                      <td className="tnum" style={{ fontWeight: 700, color: vm.color }}>{idxStr}</td>
                      <td>
                        <span className="chip" style={{ fontSize: "11px", padding: "2px 8px", color: vm.color, borderColor: `${vm.color}55` }}>
                          <span className="dot" style={{ background: vm.color }}></span>{vm.label}
                        </span>{" "}
                        <span style={{ fontSize: "10.5px", color: "var(--text-muted)" }}>{vm.advice}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {badRows.length > 0 && (
          <details style={{ marginTop: "10px" }}>
            <summary style={{ cursor: "pointer", fontSize: "11.5px", color: "var(--text-muted)" }}>
              ⚠ 분석 제외 {badRows.length}개 — 보기
            </summary>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px", lineHeight: 1.7 }}>
              {badRows.map((r, i) => {
                const why =
                  r.reason === "insufficient"
                    ? `관측 ${r.raw || r.n || 0}개 (최소 ${SAT_CONFIG.minPoints} 필요)`
                    : r.reason === "out_of_range"
                      ? "곡선이 현 지출점에서 음수/비정상"
                      : r.reason === "nofit"
                        ? "곡선 적합 실패"
                        : effectiveMetric === "roas"
                          ? "매출 데이터 없음"
                          : "분석 불가";
                return <div key={i}>• <strong>{r.name}</strong> — {why}</div>;
              })}
            </div>
          </details>
        )}
      </section>

      {okRows.length > 0 && (
        <section className="block" id="s-sat-curve">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              <span className="ix">§2</span>응답곡선 — {selName}
            </h2>
            <button
              className="ab-pill"
              onClick={handlePngDownload}
              title="이 차트를 PNG로 다운로드 (테마 배경 합성)"
            >
              ⬇ PNG
            </button>
          </div>
          <p className="muted" style={{ fontSize: "12px", marginTop: "6px" }}>
            위 표에서 행을 클릭하면 해당 {grainLabel}의 곡선으로 바뀝니다. 점=일별 관측(비용 vs {metricLabel}), 선=적합 곡선, 주황 점선=현 지출점.
          </p>
          {isRoas && (
            <p className="muted" style={{ fontSize: "11.5px", marginTop: "2px", color: "var(--text-muted)" }}>
              ⚠ ROAS 곡선은 CPA 적합 곡선을 매출/결과 비율로 역변환한 값입니다(직접 적합 아님). 매출 데이터가 희소하거나 결과당 매출 변동이 크면 곡선 신뢰도가 낮아질 수 있습니다.
            </p>
          )}
          <div className="chart-container" style={{ height: "300px" }}>
            <canvas ref={chartRef}></canvas>
          </div>
        </section>
      )}
      </>
      )}
    </ToolPageShell>
  );
}
