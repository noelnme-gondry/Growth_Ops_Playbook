"use client";
import React, { useState, useMemo } from "react";
import { useAppStore } from "@/store/useDataStore";
import { getMonFilteredRows, fmtCurrencyPrecise } from "@/utils/dashboardAggregator";
import { segmentMetricValue, buildSegmentGrid } from "@/utils/segmentMath";

export default function SegmentTab() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  const displayCurrency = useAppStore((state) => state.displayCurrency);

  const [rowAxis, setRowAxis] = useState("channel");
  const [colAxis, setColAxis] = useState("country");
  const [metric, setMetric] = useState("cpi");

  const { grid, rowKeys, colKeys, hasData, availFields, mappedKeys } = useMemo(() => {
    if (!csvData || !csvData.raw || csvData.raw.length === 0) return { hasData: false, availFields: [] };
    
    const rows = getMonFilteredRows(csvData, dashboardFilter);
    const mapping = csvData.mapping || {};
    
    const _availFields = [
      { k: "country", l: "국가" },
      { k: "channel", l: "채널" },
      { k: "platform", l: "OS" },
      { k: "campaign_name", l: "캠페인" }
    ];
    
    const hasField = (k) => Object.values(mapping).includes(k);

    const _mappedKeys = {
      impressions: hasField("impressions") ? "impressions" : null,
      clicks: hasField("clicks") ? "clicks" : null,
      installs: hasField("installs") ? "installs" : null,
      actions: hasField("actions") ? "actions" : null,
      revenue_d7: hasField("revenue_d7") ? "revenue_d7" : null,
    };

    const { grid: _grid, rows: _rowKeys, cols: _colKeys } = buildSegmentGrid(rows, rowAxis, colAxis);

    return { hasData: true, grid: _grid, rowKeys: _rowKeys, colKeys: _colKeys, availFields: _availFields, mappedKeys: _mappedKeys, hasField };
  }, [csvData, dashboardFilter, rowAxis, colAxis]);

  const METRICS = {
    cpi: { label: "CPI", better: "low", val: c => segmentMetricValue(c, "cpi"), fmt: c => { const v = segmentMetricValue(c, "cpi"); return v != null ? fmtCurrencyPrecise(v, displayCurrency) : "—"; } },
    cpa: { label: "CPA", better: "low", val: c => segmentMetricValue(c, "cpa"), fmt: c => { const v = segmentMetricValue(c, "cpa"); return v != null ? fmtCurrencyPrecise(v, displayCurrency) : "—"; } },
    cvr: { label: "CVR", better: "high", val: c => segmentMetricValue(c, "cvr"), fmt: c => { const v = segmentMetricValue(c, "cvr"); return v != null ? (v * 100).toFixed(2) + "%" : "—"; } },
    ctr: { label: "CTR", better: "high", val: c => segmentMetricValue(c, "ctr"), fmt: c => { const v = segmentMetricValue(c, "ctr"); return v != null ? (v * 100).toFixed(2) + "%" : "—"; } },
    // ROAS: index.html은 cost>0 && rev>0일 때만 표시(분자 0이어도 0%가 아니라 "—" — 매출 데이터 자체가 없다는 뜻), 소수 없이 표시.
    roas: { label: "ROAS (D7)", better: "high", val: c => segmentMetricValue(c, "roas"), fmt: c => { const v = segmentMetricValue(c, "roas"); return (c.cost > 0 && c.rev > 0 && v != null) ? (v * 100).toFixed(0) + "%" : "—"; } },
    cost: { label: "Cost", better: "none", val: c => segmentMetricValue(c, "cost"), fmt: c => fmtCurrencyPrecise(c.cost, displayCurrency) }
  };

  const renderMatrix = (renderMetric) => {
    if (!grid || !rowKeys.length) return <p className="muted">데이터 없음</p>;
    
    const met = METRICS[renderMetric];
    const vals = [];
    grid.forEach(row => row.forEach(cell => {
      if (cell) {
        const v = met.val(cell);
        if (v != null && isFinite(v)) vals.push(v);
      }
    }));
    
    const vmin = Math.min(...vals) || 0;
    const vmax = Math.max(...vals) || 0;
    const span = (vmax - vmin) || 1;

    const getBg = (v) => {
      if (v == null || !isFinite(v) || met.better === "none") return "transparent";
      let t = (v - vmin) / span;
      if (met.better === "low") t = 1 - t;
      const g = Math.round(34 + t * (180 - 34));
      const r = Math.round(248 - t * (248 - 60));
      return `rgba(${r},${g},90,0.18)`;
    };

    return (
      <>
        <div className="table-wrap">
          <table className="data" style={{ fontSize: "11.5px" }}>
            <thead>
              <tr>
                <th>{availFields.find(f => f.k === rowAxis)?.l} ↓ \ {availFields.find(f => f.k === colAxis)?.l} →</th>
                {colKeys.map(ck => <th key={ck}>{ck.slice(0, 16)}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, i) => (
                <tr key={rowKeys[i]}>
                  <th>{rowKeys[i].slice(0, 20)}</th>
                  {row.map((cell, ci) => {
                    if (!cell) return <td key={ci} className="tnum">—</td>;
                    const v = met.val(cell);
                    return (
                      <td key={ci} className="tnum" style={{ background: getBg(v) }}>
                        {met.fmt(cell)}
                        <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                          {fmtCurrencyPrecise(cell.cost, displayCurrency)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: "8px", fontSize: "11px" }}>
          셀 하단 작은 숫자는 해당 조합의 비용(규모). 진한 초록=상대적으로 우수, 빨강=열위. {met.better === "none" ? "(Cost는 규모 지표라 색 없음)" : ""}
        </p>
      </>
    );
  };

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-segment">
        <section className="block" id="s-matrix">
          <h2 className="section-title"><span className="ix">§1</span>세그먼트 효율 매트릭스</h2>
          <p className="muted">데이터 없음</p>
        </section>
      </div>
    );
  }

  return (
    <div className="tab-pane active" id="tab-segment">
      <section className="block" id="s-matrix">
        <h2 className="section-title"><span className="ix">§1</span>세그먼트 효율 매트릭스</h2>
        
        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">행 축</span>
          {availFields.map(f => {
            const ok = !!csvData.mapping && Object.values(csvData.mapping).includes(f.k);
            return (
              <button key={f.k} className={`ab-pill ${rowAxis === f.k ? "active" : ""} ${!ok ? "disabled" : ""}`} disabled={!ok} onClick={() => ok && setRowAxis(f.k)}>
                {f.l}{!ok && " 🔒"}
              </button>
            );
          })}
        </div>

        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">열 축</span>
          {availFields.map(f => {
            const ok = !!csvData.mapping && Object.values(csvData.mapping).includes(f.k);
            return (
              <button key={f.k} className={`ab-pill ${colAxis === f.k ? "active" : ""} ${!ok ? "disabled" : ""}`} disabled={!ok} onClick={() => ok && setColAxis(f.k)}>
                {f.l}{!ok && " 🔒"}
              </button>
            );
          })}
        </div>

        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">지표</span>
          {Object.entries(METRICS).filter(([k]) => k !== "cost").map(([k, v]) => (
            <button key={k} className={`ab-pill ${metric === k ? "active" : ""}`} onClick={() => setMetric(k)}>
              {v.label}
            </button>
          ))}
        </div>

        {renderMatrix(metric)}

        <h3 style={{ fontSize: "13px", fontWeight: "600", margin: "20px 0 8px", color: "var(--text-muted)" }}>Cost 분배 (고정)</h3>
        {renderMatrix("cost")}

      </section>
    </div>
  );
}
