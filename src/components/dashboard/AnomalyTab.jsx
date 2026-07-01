"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { getMonFilteredRows, aggregateByKey } from "@/utils/dashboardAggregator";
import { CHART_THEME, chartCommonOpts, getCssVar } from "@/utils/chartUtils";
import { ANOMALY_MATH } from "@/utils/anomalyMath";

export default function AnomalyTab() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  const isDarkMode = useAppStore((state) => state.isDarkMode);

  const [metric, setMetric] = useState("cost");
  const [win, setWin] = useState(14);
  const [zThresh, setZThresh] = useState(2.5);
  const [dowAdjust, setDowAdjust] = useState(false);

  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const { dailyData, anomalies, metricOpts, seriesVals, flags, hasData } = useMemo(() => {
    if (!csvData || !csvData.raw || csvData.raw.length === 0) return { hasData: false, metricOpts: [] };

    const rows = getMonFilteredRows(csvData, dashboardFilter);
    const daily = aggregateByKey(rows, "date", ["cost", "installs", "actions", "clicks", "impressions", "revenue_d7"]).sort((a, b) => (a._key > b._key ? 1 : -1));
    
    if (daily.length === 0) return { hasData: false, metricOpts: [] };

    const mapped = new Set(Object.values(csvData.mapping || {}));

    // 지표 순서: 비용,노출,클릭,설치,액션,CPM,CTR,CPI,CVR,CPA,ROAS(고정)
    const mOpts = [
      ["cost", "비용"],
      ["impressions", "노출"],
      ["clicks", "클릭"],
      ["installs", "설치"],
      ["actions", "액션"],
      ["cpm", "CPM"],
      ["ctr", "CTR"],
      ["cpi", "CPI"],
      ["cvr", "CVR"],
      ["cpa", "CPA"],
      ["roas", "ROAS"]
    ].filter(([k]) => {
      if (k === "cost") return mapped.has("cost");
      if (k === "installs" || k === "cpi") return mapped.has("installs");
      if (k === "actions" || k === "cpa") return mapped.has("actions");
      if (k === "clicks") return mapped.has("clicks");
      if (k === "impressions") return mapped.has("impressions");
      if (k === "cpm") return mapped.has("cost") && mapped.has("impressions");
      if (k === "cvr") return mapped.has("installs") && mapped.has("clicks");
      if (k === "ctr") return mapped.has("clicks") && mapped.has("impressions");
      if (k === "roas") return mapped.has("revenue_d7");
      return false;
    });

    const getSeriesVal = (d) => {
      switch (metric) {
        case "cost": return d.cost;
        case "installs": return d.installs;
        case "actions": return d.actions;
        case "clicks": return d.clicks;
        case "impressions": return d.impressions;
        case "cpm": return d.impressions > 0 ? (d.cost / d.impressions) * 1000 : null;
        case "cpi": return d.installs > 0 ? d.cost / d.installs : null;
        case "cpa": return d.actions > 0 ? d.cost / d.actions : null;
        case "cvr": return d.clicks > 0 ? d.installs / d.clicks : null;
        case "ctr": return d.impressions > 0 ? d.clicks / d.impressions : null;
        case "roas": return d.cost > 0 ? d.revenue_d7 / d.cost : null;
        default: return d.cost;
      }
    };

    const sVals = daily.map(getSeriesVal);
    const dates = daily.map((d) => d._key);
    const valsNum = sVals.map((v) => (v == null ? NaN : v));

    // ANOMALY_MATH — EMA baseline + (요일 보정 ON이면) 요일 효과를 기대값에 반영
    const dowEffects = dowAdjust
      ? ANOMALY_MATH.computeDowEffects(valsNum, dates)
      : null;
    const _flags = ANOMALY_MATH.detect(valsNum, win, zThresh, dates, dowEffects);

    const _anomalies = _flags.filter(f => f.flag).map(f => ({
      date: daily[f.i]._key,
      value: sVals[f.i],
      z: f.z,
      mean: f.mean
    })).reverse();

    return {
      hasData: true,
      dailyData: daily,
      anomalies: _anomalies,
      metricOpts: mOpts,
      seriesVals: sVals,
      flags: _flags
    };
  }, [csvData, dashboardFilter, metric, win, zThresh, dowAdjust]);

  const formatValue = (v) => {
    if (v == null) return "—";
    if (["cvr", "ctr", "roas"].includes(metric)) return (v * 100).toFixed(2) + "%";
    if (["cost", "cpi", "cpm", "cpa"].includes(metric)) return `₩${Math.round(v).toLocaleString()}`;
    return Math.round(v).toLocaleString();
  };

  useEffect(() => {
    if (!hasData || !metricOpts.length || !dailyData.length || !chartRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const labels = dailyData.map(d => d._key.slice(5)); // MM-DD
    
    chartInstanceRef.current = new Chart(chartRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: metricOpts.find(m => m[0] === metric)?.[1] || metric,
          data: seriesVals,
          borderColor: CHART_THEME.primary,
          backgroundColor: "rgba(173,198,255,0.2)",
          fill: true,
          tension: 0.2,
          pointRadius: flags.map(f => f.flag ? 6 : 1.5),
          pointBackgroundColor: flags.map(f => f.flag ? (f.z > 0 ? "#fbbf24" : "#f87171") : CHART_THEME.primary),
          pointBorderColor: flags.map(f => f.flag ? "#000" : "transparent"),
          borderWidth: 2
        }]
      },
      options: {
        ...chartCommonOpts(),
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...chartCommonOpts().plugins,
          tooltip: {
            ...chartCommonOpts().plugins.tooltip,
            callbacks: {
              label: (ctx) => {
                const idx = ctx.dataIndex;
                const f = flags[idx];
                let lbl = `${ctx.dataset.label}: ${formatValue(ctx.raw)}`;
                if (f && f.flag) {
                  lbl += ` (z: ${f.z > 0 ? "+" : ""}${f.z.toFixed(2)})`;
                }
                return lbl;
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: getCssVar("--text-muted"), maxTicksLimit: 14 }, grid: { color: getCssVar("--border") } },
          y: { ticks: { color: getCssVar("--text-muted") }, grid: { color: getCssVar("--border") } }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) chartInstanceRef.current.destroy();
    };
  }, [hasData, dailyData, seriesVals, flags, metric, metricOpts, isDarkMode]);

  if (!hasData || metricOpts.length === 0) {
    return (
      <div className="tab-pane active" id="tab-anomaly">
        <section className="block" id="s-anom">
          <h2 className="section-title"><span className="ix">§1</span>이상 감지</h2>
          <p className="muted">데이터가 없습니다.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="tab-pane active" id="tab-anomaly">
      <section className="block" id="s-anom">
        <h2 className="section-title"><span className="ix">§1</span>이상 감지</h2>
        
        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">지표</span>
          {metricOpts.map(([k, l]) => (
            <button key={k} className={`ab-pill ${metric === k ? "active" : ""}`} onClick={() => setMetric(k)}>
              {l}
            </button>
          ))}
        </div>

        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">민감도(z)</span>
          {[2, 2.5, 3].map(zz => (
            <button key={zz} className={`ab-pill ${zThresh === zz ? "active" : ""}`} onClick={() => setZThresh(zz)}>
              {zz}σ
            </button>
          ))}
          <span className="ab-pillgroup-label" style={{ marginLeft: "8px" }}>기준 윈도우</span>
          {[7, 14, 28].map(w => (
            <button key={w} className={`ab-pill ${win === w ? "active" : ""}`} onClick={() => setWin(w)}>
              {w}일
            </button>
          ))}
          <span
            className="ab-pillgroup-label"
            style={{ marginLeft: "8px" }}
            title="요일별 효과(주말 노출↑·평일 CTR↓ 등)를 기대값에 반영해, 요일 특성으로 인한 거짓 이상탐지를 줄입니다."
          >
            요일 보정
          </span>
          <button className={`ab-pill ${!dowAdjust ? "active" : ""}`} onClick={() => setDowAdjust(false)}>
            OFF
          </button>
          <button className={`ab-pill ${dowAdjust ? "active" : ""}`} onClick={() => setDowAdjust(true)}>
            ON
          </button>
        </div>

        <div className="alloc-card" style={{ margin: "10px 0" }}>
          <div className="cann-card-header">
            <div className="alloc-card-title">시계열 + 이상 표기</div>
            <button className="ab-pill" data-pngdownload="anomaly-chart" data-pngname="anomaly">⬇ PNG</button>
          </div>
          <div className="chart-container" style={{ height: "260px" }}>
            <canvas id="anomaly-chart" ref={chartRef}></canvas>
          </div>
        </div>

        {anomalies.length ? (
          <div className="table-wrap">
            <table className="data" style={{ fontSize: "11.5px" }}>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>값</th>
                  <th>기준 평균({win}일)</th>
                  <th>z-score</th>
                  <th>방향</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.slice(0, 40).map((a, i) => (
                  <tr key={i}>
                    <td className="tnum">{a.date}</td>
                    <td className="tnum"><strong>{formatValue(a.value)}</strong></td>
                    <td className="tnum">{formatValue(a.mean)}</td>
                    <td className={`tnum ${Math.abs(a.z) >= 3 ? "neg" : ""}`}>
                      {a.z > 0 ? "+" : ""}{a.z.toFixed(2)}
                    </td>
                    <td>
                      {a.z > 0 ? <span style={{ color: "#fbbf24" }}>▲ 급등</span> : <span style={{ color: "#f87171" }}>▼ 급락</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="callout ok">
            <div className="ico">✓</div>
            <div className="body">
              <strong>이상 없음</strong>
              <p>현재 지표·민감도 기준 |z|≥{zThresh} 이상치가 감지되지 않았습니다.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
