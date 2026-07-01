"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { getMonFilteredRows, aggregateByKey, fmtCurrencyPrecise } from "@/utils/dashboardAggregator";
import { CHART_THEME, chartCommonOpts, getCssVar } from "@/utils/chartUtils";
import { PACING_MATH } from "@/utils/pacingMath";

export default function PacingTab() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  const displayCurrency = useAppStore((state) => state.displayCurrency);
  const isDarkMode = useAppStore((state) => state.isDarkMode);

  const [metric, setMetric] = useState("cost");
  const [forecastMode, setForecastMode] = useState("linear");
  const [actionDef, setActionDef] = useState("registration");
  const [monthlyTarget, setMonthlyTarget] = useState("");

  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const { paceData, dailyData, hasData, mapping } = useMemo(() => {
    if (!csvData || !csvData.raw || csvData.raw.length === 0) return { hasData: false, mapping: {} };
    
    const rows = getMonFilteredRows(csvData, dashboardFilter);
    const daily = aggregateByKey(rows, "date", ["cost", "installs", "actions"]).sort((a, b) => (a._key > b._key ? 1 : -1));
    
    if (daily.length === 0) return { hasData: false, mapping: csvData.mapping || {} };

    // Feed the golden PACING_MATH engine (source of truth) with {date, value}.
    const series = daily.map(d => ({ date: d._key, value: d[metric] || 0 }));
    const p = PACING_MATH.pace(series);
    if (!p) return { hasData: false, mapping: csvData.mapping || {} };

    const useWeekday = metric !== "cost";
    const pw = useWeekday ? PACING_MATH.paceWeekday(series) : null;

    const mtdData = daily.filter(d => d._key.startsWith(p.ym));

    return {
      hasData: true,
      dailyData: daily,
      paceData: {
        ym: p.ym,
        mtdTotal: p.mtd,
        daysElapsed: p.daysElapsed,
        daysInMonth: p.daysInMonth,
        runRate: p.runRate,
        projected: p.projected,
        weekday: pw,
        mtdSeries: mtdData
      },
      mapping: csvData.mapping || {}
    };
  }, [csvData, dashboardFilter, metric]);

  const target = Number(monthlyTarget) || 0;
  const isCost = metric === "cost";
  const actionLabel = actionDef === "purchase" ? "구매" : "가입";
  const metricLabel = { cost: "비용", installs: "설치", actions: actionLabel }[metric] || metric;
  const fmtV = (v) => v != null ? (isCost ? fmtCurrencyPrecise(v, displayCurrency) : Math.round(v).toLocaleString()) : "—";

  const useWd = forecastMode === "weekday" && !isCost;
  // 요일 보정 예측: paceWeekday가 fallback 아니면(요일당 최소 3개 관측) 활성.
  const wdOk = !!(paceData && paceData.weekday && !paceData.weekday.fallback);
  const projectedVal = paceData
    ? (useWd && wdOk ? paceData.weekday.weekdayProjected : paceData.projected)
    : null;

  let pacePct = null, recDaily = null, statusTone = "info", statusMsg = "";

  if (paceData && target > 0 && projectedVal != null) {
    pacePct = (projectedVal / target) * 100;
    const remainingDays = paceData.daysInMonth - paceData.daysElapsed;
    recDaily = remainingDays > 0 ? (target - paceData.mtdTotal) / remainingDays : 0;
    
    if (isCost) {
      if (pacePct > 110) {
        statusTone = "danger";
        statusMsg = `예산 ${(pacePct - 100).toFixed(0)}% 초과 착지 예상 — 일일 소진 축소 필요`;
      } else if (pacePct < 90) {
        statusTone = "warn";
        statusMsg = `예산 ${(100 - pacePct).toFixed(0)}% 미달 착지 예상 — 소진 가속 여지`;
      } else {
        statusTone = "ok";
        statusMsg = "목표 페이스 정상 (±10% 이내)";
      }
    } else {
      if (pacePct >= 100) {
        statusTone = "ok";
        statusMsg = `목표 ${(pacePct - 100).toFixed(0)}% 초과 달성 예상`;
      } else {
        statusTone = "warn";
        statusMsg = `목표 ${(100 - pacePct).toFixed(0)}% 미달 예상 — 가속 필요`;
      }
    }
  }

  useEffect(() => {
    if (!chartRef.current || !hasData || !paceData) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const mtdSeries = paceData.mtdSeries;
    let cum = 0;
    const cumData = mtdSeries.map(d => ({ x: d._key, y: (cum += (d[metric] || 0)) }));
    
    const ds = [{
      label: "누적",
      data: cumData.map(d => d.y),
      borderColor: CHART_THEME.primary,
      backgroundColor: "rgba(173,198,255,0.3)",
      fill: true,
      tension: 0.2,
      pointRadius: 2,
    }];

    if (target > 0) {
      ds.push({
        label: "목표(선형)",
        data: mtdSeries.map((_, i) => target * (i + 1) / paceData.daysInMonth),
        borderColor: "#fbbf24",
        borderDash: [5, 4],
        borderWidth: 1.5,
        pointRadius: 0,
      });
    }

    chartInstanceRef.current = new Chart(chartRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: mtdSeries.map(d => d._key.slice(5)),
        datasets: ds
      },
      options: {
        ...chartCommonOpts(),
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...chartCommonOpts().plugins,
          legend: { labels: { color: getCssVar("--text-muted"), font: { size: 11 } } },
        },
        scales: {
          x: { ticks: { color: getCssVar("--text-muted"), maxTicksLimit: 12 }, grid: { color: getCssVar("--border") } },
          y: { ticks: { color: getCssVar("--text-muted") }, grid: { color: getCssVar("--border") } }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) chartInstanceRef.current.destroy();
    };
  }, [hasData, paceData, target, metric, isDarkMode]);

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-pacing">
        <section className="block" id="s-pace">
          <h2 className="section-title"><span className="ix">§1</span>페이싱 · 착지 예측</h2>
          <p className="muted">날짜·지표 데이터가 부족합니다.</p>
        </section>
      </div>
    );
  }

  const mapped = new Set(Object.values(mapping));
  const hasCost = mapped.has("cost");
  const hasInstalls = mapped.has("installs");
  const hasActions = mapped.has("actions");

  return (
    <div className="tab-pane active" id="tab-pacing">
      <section className="block" id="s-pace">
        <h2 className="section-title"><span className="ix">§1</span>페이싱 · 착지 예측</h2>
        
        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">지표</span>
          <button className={`ab-pill ${metric === "cost" ? "active" : ""} ${!hasCost ? "disabled" : ""}`} onClick={() => hasCost && setMetric("cost")} disabled={!hasCost}>
            비용{!hasCost && " 🔒"}
          </button>
          <button className={`ab-pill ${metric === "installs" ? "active" : ""} ${!hasInstalls ? "disabled" : ""}`} onClick={() => hasInstalls && setMetric("installs")} disabled={!hasInstalls}>
            설치{!hasInstalls && " 🔒"}
          </button>
          <button className={`ab-pill ${metric === "actions" ? "active" : ""} ${!hasActions ? "disabled" : ""}`} onClick={() => hasActions && setMetric("actions")} disabled={!hasActions}>
            {actionLabel}{!hasActions && " 🔒"}
          </button>
        </div>

        {!isCost && (
          <>
            <div className="ab-pillgroup" style={{ marginTop: "8px" }}>
              <span className="ab-pillgroup-label">예측 방식</span>
              <button className={`ab-pill ${!useWd ? "active" : ""}`} onClick={() => setForecastMode("linear")}>선형</button>
              <button className={`ab-pill ${useWd ? "active" : ""} ${!wdOk ? "disabled" : ""}`} disabled={!wdOk} onClick={() => setForecastMode("weekday")}>
                요일 보정{!wdOk && " 🔒"}
              </button>
            </div>
            {!wdOk && <p className="muted" style={{ fontSize: "11px", margin: "4px 0 0" }}>⊘ 요일당 최소 3개 관측(~3주) 필요. 데이터 더 쌓이면 활성화됩니다.</p>}
          </>
        )}

        {metric === "actions" && (
          <>
            <div className="ab-pillgroup" style={{ marginTop: "8px" }}>
              <span className="ab-pillgroup-label">액션 정의</span>
              <button className={`ab-pill ${actionDef === "registration" ? "active" : ""}`} onClick={() => setActionDef("registration")}>가입</button>
              <button className={`ab-pill ${actionDef === "purchase" ? "active" : ""}`} onClick={() => setActionDef("purchase")}>구매</button>
            </div>
            <p className="muted" style={{ fontSize: "11px", margin: "4px 0 0" }}>라벨/용어만 변경됩니다. 분석 데이터(actions 컬럼)는 동일합니다.</p>
          </>
        )}

        <div className="callout" style={{ margin: "8px 0", padding: "8px 12px" }}>
          <div className="ico">i</div>
          <div className="body">
            <p style={{ margin: 0, fontSize: "12px" }}>일별 매출 페이싱은 revenue_d7(코호트 윈도우)이 아닌 <strong>일별(캘린더) 매출 컬럼</strong>이 필요합니다 — 별도 업로드 예정.</p>
          </div>
        </div>

        <div className="ab-field" style={{ maxWidth: "280px", margin: "10px 0" }}>
          <label>{metricLabel} 월 목표 (선택)</label>
          <input 
            id="pacing-target" 
            type="number" 
            min="0" 
            step={isCost ? "10000" : "100"} 
            value={monthlyTarget}
            onChange={(e) => setMonthlyTarget(e.target.value)}
            placeholder="목표 입력 시 페이스 계산" 
          />
        </div>

        {paceData && (
          <div className="ab-stat-row" style={{ margin: "8px 0 12px" }}>
            <div className="ab-stat">
              <div className="ab-stat-label">MTD ({paceData.ym})</div>
              <div className="ab-stat-value tnum">{fmtV(paceData.mtdTotal)}</div>
              <div className="ab-stat-hint">D{paceData.daysElapsed} 경과</div>
            </div>
            <div className="ab-stat">
              <div className="ab-stat-label">일 run-rate</div>
              <div className="ab-stat-value tnum">{fmtV(paceData.runRate)}</div>
            </div>
            <div className="ab-stat">
              <div className="ab-stat-label">월말 착지 예측</div>
              <div className="ab-stat-value tnum">{fmtV(projectedVal)}</div>
              <div className="ab-stat-hint">{useWd && wdOk ? "요일 보정" : `run-rate × ${paceData.daysInMonth}일`}</div>
            </div>
            {target > 0 && (
              <>
                <div className="ab-stat">
                  <div className="ab-stat-label">목표 대비 페이스</div>
                  <div className={`ab-stat-value tnum ${pacePct > 110 && isCost ? "neg" : pacePct < 90 ? "" : "pos"}`}>
                    {pacePct.toFixed(0)}%
                  </div>
                </div>
                {recDaily != null && (
                  <div className="ab-stat">
                    <div className="ab-stat-label">잔여일 일일 권장</div>
                    <div className="ab-stat-value tnum">{fmtV(Math.max(0, recDaily))}</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {target > 0 ? (
          <div className={`callout ${statusTone === "danger" ? "warning" : statusTone}`}>
            <div className="ico">{statusTone === "ok" ? "✓" : statusTone === "danger" ? "!" : "i"}</div>
            <div className="body">
              <strong>{statusMsg}</strong>
            </div>
          </div>
        ) : (
          <p className="muted">월 목표를 입력하면 페이스·권장 소진액·경고가 표시됩니다.</p>
        )}

        <div className="alloc-card" style={{ marginTop: "12px" }}>
          <div className="cann-card-header">
            <div className="alloc-card-title">당월 일별 {metricLabel} 추이</div>
            <button className="ab-pill" data-pngdownload="pacing-chart" data-pngname="pacing">⬇ PNG</button>
          </div>
          <div className="chart-container" style={{ height: "260px" }}>
            <canvas id="pacing-chart" ref={chartRef}></canvas>
          </div>
        </div>

      </section>
    </div>
  );
}
