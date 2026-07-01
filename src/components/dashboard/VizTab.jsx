"use client";
import React, { useEffect, useRef, useMemo } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { getMonFilteredRows, aggregateByKey, calculateKPIs, effectiveDenomBasis } from "@/utils/dashboardAggregator";
import { CHART_THEME, chartCommonOpts } from "@/utils/chartUtils";
import { copyToClipboard } from "@/utils/toast";

// 차트에 이벤트 마커 세로선 + 라벨을 그리는 Chart.js 플러그인(§12.18 event marker draw).
// category x축(날짜 라벨)에서 marker.date에 매칭되는 x 픽셀에 점선을 그림.
function makeEventMarkerPlugin(markers) {
  return {
    id: "monEventMarkers",
    afterDatasetsDraw(chart) {
      if (!markers || !markers.length) return;
      const xScale = chart.scales.x;
      if (!xScale || !xScale.getLabels) return;
      const labels = xScale.getLabels();
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      ctx.save();
      for (const m of markers) {
        const idx = labels.indexOf(m.matchLabel);
        if (idx < 0) continue;
        const x = xScale.getPixelForValue(idx);
        if (x == null || !isFinite(x)) continue;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#f7b955";
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "10px Inter, sans-serif";
        ctx.fillStyle = "#f7b955";
        ctx.textAlign = "left";
        ctx.save();
        ctx.translate(x + 3, chartArea.top + 4);
        ctx.fillText(String(m.label).slice(0, 16), 0, 0);
        ctx.restore();
      }
      ctx.restore();
    },
  };
}

export default function VizTab() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  const selectedCohort = useAppStore((state) => state.selectedCohort);
  const setSelectedCohort = useAppStore((state) => state.setSelectedCohort);
  const denomBasis = useAppStore((state) => state.denomBasis);
  const eventMarkers = useAppStore((state) => state.eventMarkers);

  // Refs for Canvases
  const tsCanvasRef = useRef(null);
  const donutCanvasRef = useRef(null);
  const cpiCanvasRef = useRef(null);
  const funnelCanvasRef = useRef(null);
  const cohortCanvasRef = useRef(null);

  // Refs for Chart Instances
  const chartsRef = useRef({
    ts: null,
    donut: null,
    cpi: null,
    funnel: null,
    cohort: null,
  });

  const effBasis = effectiveDenomBasis(csvData, denomBasis);
  const acqLabel = effBasis === "actions" ? "CPA" : "CPI";
  // 전역 분모 기준(설치/가입)에 따른 결과량 라벨 — 시계열 트렌드 라인·축(#1).
  const trendOutcomeLabel = effBasis === "actions" ? "가입수" : "설치수";

  // 1. Data Aggregation (useMemo)
  const { filteredRows, dailyAgg, byChannel, totals, kpi, d7RoasNormalized, d7Display } = useMemo(() => {
    const fRows = getMonFilteredRows(csvData, dashboardFilter);
    const dAgg = aggregateByKey(fRows, "date", ["cost", "installs", "actions", "revenue_d7", "clicks"]).sort(
      (a, b) => (a._key > b._key ? 1 : -1)
    );
    const chAgg = aggregateByKey(fRows.filter((r) => r.channel), "channel", [
      "cost",
      "installs",
      "actions",
      "revenue_d0",
      "revenue_d7",
      "revenue_d14",
    ]);
    const t = ["impressions", "clicks", "installs", "actions", "pu_d7", "cost", "revenue_d7"].reduce(
      (acc, f) => {
        acc[f] = fRows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
        return acc;
      },
      {}
    );
    const k = calculateKPIs(fRows, selectedCohort, effBasis);
    const d7Kpi = t.cost ? t.revenue_d7 / t.cost : null;
    const d7Display = d7Kpi ? (d7Kpi * 100).toFixed(2) + "%" : "";
    const roasNorm = k.roas == null ? null : k.roas > 1 ? k.roas : k.roas * 100;

    return { filteredRows: fRows, dailyAgg: dAgg, byChannel: chAgg, totals: t, kpi: k, d7RoasNormalized: roasNorm, d7Display };
  }, [csvData, dashboardFilter, selectedCohort, effBasis]);

  // 이벤트 마커를 일별 차트 라벨(_key = YYYY-MM-DD)에 매칭할 형태로 준비.
  const preparedMarkers = useMemo(
    () => (eventMarkers || []).map((m) => ({ label: m.label, matchLabel: m.date })),
    [eventMarkers]
  );

  // 2. Formatters
  const formatNumber = (num, { decimals = 0 } = {}) => {
    if (num == null || isNaN(num)) return "-";
    return Number(num).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  const formatPercent = (num) => {
    if (num == null || isNaN(num)) return "-";
    return (num * 100).toFixed(2) + "%";
  };

  // 3. Chart Rendering Effect
  useEffect(() => {
    const instances = chartsRef.current;

    // Destroy existing charts
    Object.values(instances).forEach((chart) => {
      if (chart) chart.destroy();
    });

    // 1) Time Series Chart (이벤트 마커 세로선 오버레이 포함)
    if (tsCanvasRef.current) {
      instances.ts = new Chart(tsCanvasRef.current.getContext("2d"), {
        type: "line",
        plugins: [makeEventMarkerPlugin(preparedMarkers)],
        data: {
          labels: dailyAgg.map((d) => d._key),
          datasets: [
            {
              label: "비용",
              data: dailyAgg.map((d) => d.cost),
              yAxisID: "y",
              borderColor: CHART_THEME.primary,
              backgroundColor: "rgba(173,198,255,0.1)",
              tension: 0.3,
              fill: true,
              pointRadius: 0,
              borderWidth: 2,
            },
            {
              label: trendOutcomeLabel,
              data: dailyAgg.map((d) => (effBasis === "actions" ? d.actions : d.installs)),
              yAxisID: "y1",
              borderColor: CHART_THEME.secondary,
              backgroundColor: "rgba(76,215,246,0.05)",
              tension: 0.3,
              fill: false,
              pointRadius: 0,
              borderWidth: 2,
            },
          ],
        },
        options: {
          ...chartCommonOpts(),
          scales: {
            x: { ...chartCommonOpts().scales.x },
            y: {
              ...chartCommonOpts().scales.y,
              position: "left",
              title: { display: true, text: "비용", color: CHART_THEME.muted, font: { size: 10 } },
            },
            y1: {
              ...chartCommonOpts().scales.y,
              position: "right",
              title: { display: true, text: trendOutcomeLabel, color: CHART_THEME.muted, font: { size: 10 } },
              grid: { display: false },
            },
          },
        },
      });
    }

    // 2) Channel Donut Chart
    if (donutCanvasRef.current) {
      const sortedCh = [...byChannel].sort((a, b) => b.cost - a.cost);
      instances.donut = new Chart(donutCanvasRef.current.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: sortedCh.map((c) => c._key),
          datasets: [{
            data: sortedCh.map((c) => c.cost),
            backgroundColor: sortedCh.map((_, i) => CHART_THEME.series[i % CHART_THEME.series.length]),
            borderColor: "transparent",
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "62%",
          plugins: {
            legend: {
              position: "right",
              labels: { color: CHART_THEME.text, font: { family: "Inter", size: 11 }, usePointStyle: true, padding: 12 },
            },
            tooltip: chartCommonOpts().plugins.tooltip,
          },
        },
      });
    }

    // 3) CPI/CPA Bar Chart — 전역 분모 기준 따라 설치당/가입당 비용
    if (cpiCanvasRef.current) {
      const cpiData = byChannel
        .map((c) => {
          const denom = effBasis === "actions" ? c.actions : c.installs;
          return { key: c._key, cpi: denom ? c.cost / denom : 0 };
        })
        .filter((d) => d.cpi > 0)
        .sort((a, b) => a.cpi - b.cpi);

      instances.cpi = new Chart(cpiCanvasRef.current.getContext("2d"), {
        type: "bar",
        data: {
          labels: cpiData.map((d) => d.key),
          datasets: [{
            label: acqLabel,
            data: cpiData.map((d) => d.cpi),
            backgroundColor: cpiData.map((_, i) => CHART_THEME.series[i % CHART_THEME.series.length] + "cc"),
            borderRadius: 4,
            barThickness: 18,
          }],
        },
        options: {
          ...chartCommonOpts(),
          indexAxis: "y",
          plugins: { ...chartCommonOpts().plugins, legend: { display: false } },
        },
      });
    }

    // 4) Funnel Bar Chart — 기준이 '가입'이면 가입 단계 추가(설치 4단계 vs 가입 5단계)
    if (funnelCanvasRef.current) {
      const funnelLabels = effBasis === "actions"
        ? ["노출", "클릭", "설치", "가입", "결제 (D7)"]
        : ["노출", "클릭", "설치", "결제 (D7)"];
      const funnelData = effBasis === "actions"
        ? [totals.impressions, totals.clicks, totals.installs, totals.actions, totals.pu_d7]
        : [totals.impressions, totals.clicks, totals.installs, totals.pu_d7];
      const funnelColors = effBasis === "actions"
        ? ["#adc6ff", "#4cd7f6", "#5ad19a", "#bb9af7", "#f7b955"]
        : ["#adc6ff", "#4cd7f6", "#5ad19a", "#f7b955"];
      instances.funnel = new Chart(funnelCanvasRef.current.getContext("2d"), {
        type: "bar",
        data: {
          labels: funnelLabels,
          datasets: [{
            label: "건수",
            data: funnelData,
            backgroundColor: funnelColors,
            borderRadius: 4,
          }],
        },
        options: {
          ...chartCommonOpts(),
          // 절대 건수는 노출이 압도 → 로그 스케일(§12.18)
          scales: {
            ...chartCommonOpts().scales,
            y: { ...chartCommonOpts().scales.y, type: "logarithmic", beginAtZero: false },
          },
          plugins: { ...chartCommonOpts().plugins, legend: { display: false } },
        },
      });
    }

    // 5) Cohort Line Chart
    if (cohortCanvasRef.current) {
      const topCh = [...byChannel].sort((a, b) => (b.revenue_d7 || 0) - (a.revenue_d7 || 0)).slice(0, 6);
      const datasets = topCh.map((c, i) => {
        // 전역 분모 기준(설치/가입) — ARPU 분모도 다른 차트와 동일하게 전환(§12.18).
        const denom = effBasis === "actions" ? c.actions : c.installs;
        return {
          label: c._key,
          data: [
            denom ? c.revenue_d0 / denom : 0,
            denom ? c.revenue_d7 / denom : 0,
            denom ? c.revenue_d14 / denom : 0,
          ],
          borderColor: CHART_THEME.series[i % CHART_THEME.series.length],
          backgroundColor: CHART_THEME.series[i % CHART_THEME.series.length],
          tension: 0.1,
          borderWidth: 2,
          pointRadius: 4,
        };
      });

      instances.cohort = new Chart(cohortCanvasRef.current.getContext("2d"), {
        type: "line",
        data: {
          labels: ["D0", "D7", "D14"],
          datasets,
        },
        options: {
          ...chartCommonOpts(),
          scales: {
            x: { ...chartCommonOpts().scales.x },
            y: {
              ...chartCommonOpts().scales.y,
              title: { display: true, text: "누적 ARPU", color: CHART_THEME.muted, font: { size: 10 } },
            },
          },
        },
      });
    }

    // 마커 세로선(afterDatasetsDraw)은 Chart.js 애니메이션 완료 후에나 최초 페인트됨(§12.18) —
    // 마커 추가 시 매번 destroy+recreate라 400ms 페이드인 동안 "반영 안 됨"처럼 보일 수 있음.
    // 애니메이션/rAF 스케줄과 무관하게 즉시 1프레임 동기 draw로 마커가 바로 보이게 강제.
    Object.values(instances).forEach((chart) => {
      if (chart) chart.draw();
    });

    return () => {
      Object.values(instances).forEach((chart) => {
        if (chart) chart.destroy();
      });
    };
  }, [dailyAgg, byChannel, totals, preparedMarkers, effBasis, acqLabel, trendOutcomeLabel]);

  return (
    <div className="tab-pane active" id="tab-viz">
      {/* Alert Banner */}
      {kpi.cohort === 7 && d7RoasNormalized != null && d7RoasNormalized < 15 && (
        <aside className="alert-banner" role="alert">
          <div className="alert-icon">⚠</div>
          <div className="alert-body">
            <strong>D7 ROAS가 권장 벤치마크(15%) 미달입니다.</strong>
            현재 {d7RoasNormalized.toFixed(2)}% — UAC/AAP 캠페인의 입찰 단계·에셋 다양성·매체별 카니발 비중 진단이 필요합니다.
          </div>
        </aside>
      )}

      {/* Cohort Toggle */}
      <section className="block" id="s-cohort">
        <h2 className="section-title"><span className="ix">§1</span>코호트 시점</h2>
        <div className="cohort-toggle" id="cohort-toggle" style={{ marginBottom: "1rem" }}>
          <button data-cohort="0" className={selectedCohort === 0 ? "active" : ""} onClick={() => setSelectedCohort(0)}>D0</button>
          <button data-cohort="7" className={selectedCohort === 7 ? "active" : ""} onClick={() => setSelectedCohort(7)}>D7</button>
          <button data-cohort="14" className={selectedCohort === 14 ? "active" : ""} onClick={() => setSelectedCohort(14)}>D14</button>
        </div>
        <p>매출/결제/잔존율은 선택된 코호트(D{kpi.cohort}) 기준으로 계산됩니다. 단일 지표(CPI/CTR/CVR/비용/설치)는 코호트 무관.</p>
      </section>

      {/* KPI Summary */}
      <section className="block" id="s-kpi">
        <h2 className="section-title"><span className="ix">§2</span>KPI 요약</h2>
        <div className="kpi-grid">
          <div className="kpi-card"><div className="label">총 비용</div><div className="value tnum">{formatNumber(kpi.cost)}</div><div className="delta">합산 cost</div></div>
          <div className="kpi-card"><div className="label">{effBasis === "actions" ? "총 가입 수" : "총 설치 수"}</div><div className="value tnum">{formatNumber(effBasis === "actions" ? kpi.actions : kpi.installs)}</div><div className="delta">{effBasis === "actions" ? "합산 actions" : "합산 installs"}</div></div>
          <div className="kpi-card"><div className="label">{acqLabel}</div><div className="value tnum">{formatNumber(kpi.cpi, { decimals: 2 })}</div><div className="delta">cost / {effBasis === "actions" ? "actions(가입)" : "installs"}</div></div>
          <div className="kpi-card"><div className="label">CTR</div><div className="value tnum">{formatPercent(kpi.ctr)}</div><div className="delta">clicks / impressions</div></div>
          <div className="kpi-card"><div className="label">CVR (Click→{effBasis === "actions" ? "가입" : "Install"})</div><div className="value tnum">{formatPercent(kpi.cvr)}</div><div className="delta">{effBasis === "actions" ? "actions" : "installs"} / clicks</div></div>
          <div className="kpi-card"><div className="label">총 매출 (D{kpi.cohort})</div><div className="value tnum">{formatNumber(kpi.revenue)}</div><div className="delta">cohort revenue 합산</div></div>
          <div className="kpi-card" style={{ position: "relative" }}>
            <div className="label">ROAS (D{kpi.cohort})</div>
            <div className="value tnum">{formatPercent(kpi.roas)}</div>
            <div className="delta" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "0.25rem" }}>
              <span>revenue / cost</span>
              {d7Display && (
                <button 
                  className="share-btn" 
                  onClick={() => copyToClipboard(`현재 D${kpi.cohort} ROAS는 ${d7Display} 입니다.`)}
                  style={{ padding: "1px 5px", fontSize: "9.5px", height: "16px", lineHeight: "1", borderRadius: "3px", marginLeft: "auto", background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-subtle)", display: "inline-flex", alignItems: "center", gap: "3px", color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  공유 복사
                </button>
              )}
            </div>
          </div>
          <div className="kpi-card"><div className="label">ARPU (D{kpi.cohort})</div><div className="value tnum">{formatNumber(kpi.arpu, { decimals: 2 })}</div><div className="delta">revenue / {effBasis === "actions" ? "actions" : "installs"}</div></div>
          <div className="kpi-card"><div className="label">결제수 (D{kpi.cohort})</div><div className="value tnum">{formatNumber(kpi.purchases)}</div><div className="delta">pu_d{kpi.cohort} 합산</div></div>
          <div className="kpi-card"><div className="label">CPA (D{kpi.cohort})</div><div className="value tnum">{formatNumber(kpi.cpa, { decimals: 2 })}</div><div className="delta">cost / pu_d{kpi.cohort}</div></div>
          <div className="kpi-card"><div className="label">ARPPU (D{kpi.cohort})</div><div className="value tnum">{formatNumber(kpi.arppu, { decimals: 2 })}</div><div className="delta">revenue / 결제수</div></div>
          <div className="kpi-card"><div className="label">잔존율 평균 (D{kpi.cohort})</div><div className="value tnum">{formatPercent(kpi.retentionAvg)}</div><div className="delta">행별 평균</div></div>
        </div>
      </section>

      {/* Charts Grid */}
      <section className="block" id="s-charts">
        <h2 className="section-title"><span className="ix">§3</span>차트 시각화</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>업로드된 데이터를 기반으로 시계열·채널 비중·CPI 비교·퍼널·코호트 매출 5종 차트가 렌더링됩니다.</p>
        
        {/* 이벤트 마커 입력 UI는 여기가 아니라 Dashboard.jsx에서 탭 콘텐츠 위에
            <MonEventMarkerUI/>로 렌더됨(전 탭 공통 상단 1곳). 여기 시계열 차트는
            store.eventMarkers를 preparedMarkers로 구독해 세로선만 오버레이. */}

        <div className="chart-grid cols-2">
          <div className="chart-card">
            <div className="chart-title">일별 비용·{effBasis === "actions" ? "가입" : "설치"} 추이</div>
            <div className="chart-sub">시계열 라인 · 좌축 비용 / 우축 {effBasis === "actions" ? "가입" : "설치"}</div>
            <div className="chart-canvas-wrap" style={{ height: "300px" }}><canvas ref={tsCanvasRef}></canvas></div>
          </div>
          <div className="chart-card">
            <div className="chart-title">채널별 비용 비중</div>
            <div className="chart-sub">도넛 · 합산 cost 기준</div>
            <div className="chart-canvas-wrap" style={{ height: "300px" }}><canvas ref={donutCanvasRef}></canvas></div>
          </div>
          <div className="chart-card">
            <div className="chart-title">채널별 {acqLabel} 비교</div>
            <div className="chart-sub">가로 막대 · cost / {effBasis === "actions" ? "actions(가입)" : "installs"}</div>
            <div className="chart-canvas-wrap" style={{ height: "300px" }}><canvas ref={cpiCanvasRef}></canvas></div>
          </div>
          <div className="chart-card">
            <div className="chart-title">전환 퍼널</div>
            <div className="chart-sub">{effBasis === "actions" ? "노출 → 클릭 → 설치 → 가입 → 결제(D7)" : "노출 → 클릭 → 설치 → 결제(D7)"} 단계별 절대 건수 (로그 스케일)</div>
            <div className="chart-canvas-wrap" style={{ height: "300px" }}><canvas ref={funnelCanvasRef}></canvas></div>
          </div>
          <div className="chart-card" style={{ gridColumn: "1 / -1" }}>
            <div className="chart-title">채널별 코호트 매출 증가 (D0 → D7 → D14)</div>
            <div className="chart-sub">라인 · 채널별 누적 ARPU 증가 곡선</div>
            <div className="chart-canvas-wrap" style={{ height: "300px" }}><canvas ref={cohortCanvasRef}></canvas></div>
          </div>
        </div>
      </section>
    </div>
  );
}
