"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { getMonFilteredRows, aggregateByKey, fmtCurrencyPrecise } from "@/utils/dashboardAggregator";
import { chartCommonOpts, downloadChartAsPNG, getCssVar } from "@/utils/chartUtils";
import BudgetHealthCard from "./BudgetHealthCard";

export default function ScorecardTab() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const displayCurrency = useAppStore((state) => state.displayCurrency);
  const [windowDays, setWindowDays] = useState(7);
  const [selectedMetric, setSelectedMetric] = useState(null);

  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const { recent, prev, daily, hasData, mapping } = useMemo(() => {
    if (!csvData || !csvData.raw || csvData.raw.length === 0) {
      return { hasData: false, mapping: {} };
    }
    const rows = getMonFilteredRows(csvData, dashboardFilter);
    const _daily = aggregateByKey(rows, "date", ["cost", "impressions", "clicks", "installs", "actions", "revenue_d7"]).sort((a, b) => a._key > b._key ? 1 : -1);
    
    if (_daily.length === 0) return { hasData: false, mapping: csvData.mapping || {} };

    const w = windowDays;
    const _recent = _daily.slice(-w);
    const _prev = _daily.slice(-2 * w, -w);

    const sum = (arr, k) => arr.reduce((s, d) => s + (d[k] || 0), 0);
    const agg = (arr) => {
      const cost = sum(arr, "cost"), imp = sum(arr, "impressions"), clk = sum(arr, "clicks");
      const inst = sum(arr, "installs"), act = sum(arr, "actions"), rev = sum(arr, "revenue_d7");
      return {
        cost, imp, clk, inst, act, rev,
        cpi: inst > 0 ? cost / inst : null,
        cpa: act > 0 ? cost / act : null,
        cvr: clk > 0 ? inst / clk : null,
        ctr: imp > 0 ? clk / imp : null,
        roas: cost > 0 && rev > 0 ? rev / cost : null,
        cpm: imp > 0 ? (cost / imp) * 1000 : null,
      };
    };

    return { hasData: true, recent: agg(_recent), prev: agg(_prev), daily: _daily, mapping: csvData.mapping || {} };
  }, [csvData, dashboardFilter, windowDays]);

  const cards = useMemo(() => {
    if (!hasData) return [];
    const fmtCurrency = (v) => fmtCurrencyPrecise(v, displayCurrency);
    const mapped = new Set(Object.values(mapping));
    
    return [
      { k: "cost", label: "비용", val: recent.cost, prev: prev.cost, fmt: fmtCurrency, better: "none" },
      mapped.has("installs") && { k: "inst", label: "설치", val: recent.inst, prev: prev.inst, fmt: v => Math.round(v).toLocaleString(), better: "high" },
      mapped.has("installs") && { k: "cpi", label: "CPI", val: recent.cpi, prev: prev.cpi, fmt: v => v != null ? fmtCurrency(v) : "—", better: "low" },
      mapped.has("actions") && { k: "act", label: "액션", val: recent.act, prev: prev.act, fmt: v => Math.round(v).toLocaleString(), better: "high" },
      mapped.has("actions") && { k: "cpa", label: "CPA", val: recent.cpa, prev: prev.cpa, fmt: v => v != null ? fmtCurrency(v) : "—", better: "low" },
      mapped.has("clicks") && mapped.has("installs") && { k: "cvr", label: "CVR", val: recent.cvr, prev: prev.cvr, fmt: v => v != null ? (v * 100).toFixed(2) + "%" : "—", better: "high" },
      mapped.has("impressions") && mapped.has("clicks") && { k: "ctr", label: "CTR", val: recent.ctr, prev: prev.ctr, fmt: v => v != null ? (v * 100).toFixed(2) + "%" : "—", better: "high" },
      mapped.has("revenue_d7") && { k: "roas", label: "ROAS", val: recent.roas, prev: prev.roas, fmt: v => v != null ? (v * 100).toFixed(0) + "%" : "—", better: "high" },
    ].filter(Boolean);
  }, [hasData, recent, prev, mapping, displayCurrency]);

  // If selected metric is no longer valid, reset it quietly
  useEffect(() => {
    if (selectedMetric && !cards.find(c => c.k === selectedMetric)) {
      // 선택 지표가 더는 유효하지 않으면 1회 리셋 — 조건부라 무한루프 없음(의도된 패턴)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedMetric(null);
    }
  }, [cards, selectedMetric]);

  const seriesVal = (d, sel) => {
    switch (sel) {
      case "cost": return d.cost;
      case "inst": return d.installs;
      case "cpi": return d.installs > 0 ? d.cost / d.installs : null;
      case "act": return d.actions;
      case "cpa": return d.actions > 0 ? d.cost / d.actions : null;
      case "cvr": return d.clicks > 0 ? d.installs / d.clicks : null;
      case "ctr": return d.impressions > 0 ? d.clicks / d.impressions : null;
      case "roas": return d.cost > 0 ? d.revenue_d7 / d.cost : null;
      default: return null;
    }
  };

  useEffect(() => {
    if (!hasData || !selectedMetric || !chartRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const w = windowDays;
    const slice2W = daily.slice(-2 * w);
    if (slice2W.length < 2) return;

    const vals = slice2W.map(d => seriesVal(d, selectedMetric));
    const labels = slice2W.map(d => d._key.slice(5)); // MM-DD
    const n = slice2W.length;
    const pivotIdx = n - w;

    const ptBg = vals.map((_, i) => i < pivotIdx ? "#fbbf2460" : "#adc6ff60");
    const ptBorder = vals.map((_, i) => i < pivotIdx ? "#fbbf24" : "#adc6ff");
    const barColors = vals.map((_, i) => i < pivotIdx ? "#fbbf2480" : "#adc6ff80");
    
    const gridColor = getCssVar("--border") || "#2a2a2a";
    const tickColor = getCssVar("--text-muted") || "#9ca3af";

    const isContinuous = ["cvr", "ctr", "roas", "cpi", "cpa"].includes(selectedMetric);
    const ds = isContinuous ? [{
      label: "",
      data: vals,
      borderColor: ptBorder,
      backgroundColor: ptBg,
      pointBackgroundColor: ptBorder,
      pointBorderColor: ptBorder,
      pointRadius: 4,
      tension: 0.1,
      fill: false,
    }] : [{
      label: "",
      data: vals,
      backgroundColor: barColors,
      borderColor: barColors.map(c => c.replace("80", "cc")),
      borderWidth: 1,
    }];

    chartInstanceRef.current = new Chart(chartRef.current.getContext("2d"), {
      type: isContinuous ? "line" : "bar",
      data: { labels, datasets: ds },
      options: {
        ...chartCommonOpts(),
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (items) => items[0].label } }
        },
        scales: {
          x: {
            ticks: { color: tickColor, maxTicksLimit: 14 },
            grid: { color: gridColor },
            afterBuildTicks(ax) {
              if (ax.ticks.length > 0 && pivotIdx > 0 && pivotIdx < n) {
                ax.ticks[pivotIdx] = { ...ax.ticks[pivotIdx], major: true };
              }
            }
          },
          y: {
            ticks: { color: tickColor },
            grid: { color: gridColor },
          }
        }
      }
    });

    // 조건부 렌더(§0 카드 클릭 시 마운트)라 최초 생성 시 부모 폭이 0으로 측정될 수 있음
    // (§7 <details> 0px 함정과 동일 원인) — 레이아웃 안정 후 1회 resize로 강제 재측정.
    requestAnimationFrame(() => chartInstanceRef.current?.resize());

    return () => {
      if (chartInstanceRef.current) chartInstanceRef.current.destroy();
    };
  }, [hasData, daily, selectedMetric, windowDays, isDarkMode]);

  if (!hasData) {
    return <div className="tab-pane active"><p className="muted">데이터 없음</p></div>;
  }

  return (
    <div className="tab-pane active" id="tab-scorecard">
      <BudgetHealthCard />
      <section className="block" id="s-score">
        <h2 className="section-title"><span className="ix">§1</span>핵심 KPI (최근 {windowDays}일)</h2>
        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">기간</span>
          {[7, 14, 28].map(d => (
            <button key={d} className={`ab-pill ${windowDays === d ? "active" : ""}`} onClick={() => setWindowDays(d)}>
              {d}일
            </button>
          ))}
        </div>
        
        <div className="ab-stat-row" style={{ marginTop: "10px" }}>
          {cards.map(c => {
            const d = c.prev != null && c.prev !== 0 && c.val != null ? (c.val - c.prev) / c.prev : null;
            const good = c.better === "none" || d == null ? null : (c.better === "high" ? d > 0 : d < 0);
            const arrow = d == null ? "" : (d > 0 ? "▲" : (d < 0 ? "▼" : "—"));
            const cls = good == null ? "" : (good ? "pos" : "neg");
            const isActive = selectedMetric === c.k;

            return (
              <div 
                key={c.k} 
                className="ab-stat" 
                onClick={() => setSelectedMetric(isActive ? null : c.k)} 
                style={{ cursor: "pointer", ...(isActive ? { outline: "2px solid #adc6ff", borderRadius: "6px" } : {}) }}
              >
                <div className="ab-stat-label">{c.label}</div>
                <div className="ab-stat-value tnum">{c.fmt(c.val)}</div>
                <div className={`ab-stat-hint ${cls}`}>
                  {d == null ? "직전 데이터 없음" : `${arrow} ${Math.abs(d * 100).toFixed(1)}% WoW`}
                </div>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: "11px", marginTop: "8px" }}>
          WoW = 최근 {windowDays}일 vs 직전 {windowDays}일. 색은 지표 성격 반영(CPI/CPA↓·설치/ROAS↑ = 초록). 비용은 중립(규모). 카드 클릭 시 일별 상세.
        </p>
      </section>

      {selectedMetric && (
        <section className="block" id="s-score-daily" style={{ paddingTop: "8px" }}>
          <h3 style={{ fontSize: "13px", fontWeight: "600", margin: "0 0 8px", color: "var(--text-muted)" }}>
            일별 상세 — {cards.find(c => c.k === selectedMetric)?.label || selectedMetric} (최근 {Math.min(daily.length, 2 * windowDays)}일)
          </h3>
          <p className="muted" style={{ fontSize: "11px", margin: "0 0 8px" }}>
            🟠 비교주(직전 {windowDays}일) / 🔵 목표주(최근 {windowDays}일) · 카드 재클릭 시 닫힘
          </p>
          {daily.slice(-2 * windowDays).length < 2 * windowDays && (
            <p className="muted" style={{ fontSize: "11px", margin: "4px 0 0" }}>
              ⚠ 데이터가 충분하지 않습니다 ({daily.slice(-2 * windowDays).length}일). 있는 만큼 표시합니다.
            </p>
          )}
          {daily.slice(-2 * windowDays).length >= 2 && (
            <div className="chart-container" style={{ height: "220px" }}>
              <canvas id="scorecard-daily-chart" ref={chartRef}></canvas>
            </div>
          )}
          <button
            className="ab-pill"
            style={{ marginTop: "8px" }}
            onClick={() => downloadChartAsPNG(chartRef.current, "scorecard_daily")}
          >
            ⬇ PNG
          </button>
        </section>
      )}
    </div>
  );
}
