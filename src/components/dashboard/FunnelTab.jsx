"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { getMonFilteredRows } from "@/utils/dashboardAggregator";
import { chartCommonOpts, getCssVar } from "@/utils/chartUtils";
import { buildFunnelData, FUNNEL_FIELD_LABEL } from "@/utils/funnelMath";

const fmtPct = (v) => (v == null ? "—" : (v * 100).toFixed(2) + "%");
const fmtDelta = (d) => {
  if (d == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return (
    <span style={{ color: d >= 0 ? "#34d399" : "#f87171" }}>
      {d >= 0 ? "▲ +" : "▼ "}{(d * 100).toFixed(1)}%
    </span>
  );
};

export default function FunnelTab() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  const isDarkMode = useAppStore((state) => state.isDarkMode);

  const [unitField, setUnitField] = useState("_all");
  const [cvrStep, setCvrStep] = useState(2);
  const [weekdayAdj, setWeekdayAdj] = useState(false);

  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const { cache, hasData, mappedKeys } = useMemo(() => {
    if (!csvData || !csvData.raw || csvData.raw.length === 0)
      return { hasData: false, mappedKeys: new Set() };
    const rows = getMonFilteredRows(csvData, dashboardFilter);
    const mapping = csvData.mapping || {};
    const mk = new Set(Object.values(mapping));
    const c = buildFunnelData(rows, mk, { unitField, cvrStep, weekdayAdj });
    if (!c.rows.length) return { hasData: false, mappedKeys: mk };
    return { cache: c, hasData: true, mappedKeys: mk };
  }, [csvData, dashboardFilter, unitField, cvrStep, weekdayAdj]);

  const adjOn = weekdayAdj && cache && cache.weekdayAdjOk;

  useEffect(() => {
    if (!hasData || !cache) return;
    const daily = (cache.daily || []).filter((x) => x.cvr != null);
    if (daily.length < 3 || !chartRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const labels = daily.map((x) => x.date.slice(5));
    const cvrData = daily.map((x) =>
      +((adjOn && x.cvrAdj != null ? x.cvrAdj : x.cvr) * 100).toFixed(2)
    );
    const mean = cache.dailyMean != null ? +(cache.dailyMean * 100).toFixed(2) : null;
    const ptColors = daily.map((x) => ((adjOn ? x.lowAdj : x.low) ? "#f87171" : "#adc6ff"));
    const ptR = daily.map((x) => ((adjOn ? x.lowAdj : x.low) ? 4 : 2));
    const lbl = `${cache.selLabel || "선택 단계"} CVR(%)${adjOn ? " (요일보정)" : ""}`;

    const ds = [
      {
        label: lbl,
        data: cvrData,
        borderColor: "#adc6ff",
        backgroundColor: "#adc6ff20",
        fill: true,
        tension: 0.2,
        pointRadius: ptR,
        pointBackgroundColor: ptColors,
        pointBorderColor: ptColors,
      },
    ];
    if (mean != null)
      ds.push({
        label: "평균",
        data: daily.map(() => mean),
        borderColor: "#fbbf24",
        borderDash: [5, 4],
        borderWidth: 1.5,
        pointRadius: 0,
      });

    chartInstanceRef.current = new Chart(chartRef.current.getContext("2d"), {
      type: "line",
      data: { labels, datasets: ds },
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
          y: { ticks: { color: getCssVar("--text-muted"), callback: (v) => v + "%" }, grid: { color: getCssVar("--border") } },
        },
      },
    });

    return () => {
      if (chartInstanceRef.current) chartInstanceRef.current.destroy();
    };
  }, [hasData, cache, adjOn, isDarkMode]);

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-funnel">
        <section className="block" id="s-funnel-wow">
          <h2 className="section-title"><span className="ix">§1</span>퍼널 진단</h2>
          <p className="muted">데이터 없음</p>
        </section>
      </div>
    );
  }

  const c = cache;
  const bd = c.wowBiggestDrop;
  const rangeStr = c.wowRange ? `${c.wowRange.from} ~ ${c.wowRange.to}` : "최근 주";
  const lows = adjOn ? (c.daily || []).filter((x) => x.lowAdj) : (c.daily || []).filter((x) => x.low);
  const selLbl = c.selLabel || "선택 단계";

  const unitPills = [["_all", "전체"], ["channel", "채널"], ["country", "국가"], ["platform", "OS"]];

  return (
    <div className="tab-pane active" id="tab-funnel">
      {/* §1 주간 변화(WoW) */}
      <section className="block" id="s-funnel-wow">
        {!c.wow ? (
          <>
            <h2 className="section-title"><span className="ix">§1</span>주간 변화</h2>
            <p className="muted" style={{ fontSize: "12px" }}>
              날짜 컬럼을 매핑하면 <strong>최근 주 vs 지난 주</strong> 단계별 전환율 변화를 볼 수 있습니다.
            </p>
          </>
        ) : (
          <>
            <h2 className="section-title"><span className="ix">§1</span>주간 변화 — 지난 주 대비</h2>
            <p className="muted" style={{ fontSize: "12px", margin: "-4px 0 10px" }}>
              이번 주({rangeStr}) 단계별 전환율을 직전 주와 비교합니다. (최근 7개 영업일 vs 직전 7개)
            </p>
            {bd && bd.delta != null && bd.delta < 0 ? (
              <div className="callout warning">
                <div className="ico">!</div>
                <div className="body">
                  <p style={{ margin: 0, fontSize: "13px" }}>
                    <strong>{bd.label}</strong> 전환율이 지난 주 대비 가장 많이 떨어졌습니다 — {fmtDelta(bd.delta)}{" "}
                    <span style={{ color: "var(--text-muted)" }}>({fmtPct(bd.cvrLast)} → {fmtPct(bd.cvrThis)})</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="callout ok">
                <div className="ico">✓</div>
                <div className="body"><p style={{ margin: 0, fontSize: "13px" }}>지난 주 대비 전환율이 하락한 단계가 없습니다.</p></div>
              </div>
            )}
            <div className="table-wrap" style={{ marginTop: "10px" }}>
              <table className="data" style={{ fontSize: "11.5px" }}>
                <thead><tr><th>전환 단계</th><th>지난 주</th><th>이번 주</th><th>변화</th></tr></thead>
                <tbody>
                  {c.wow.map((w) => (
                    <tr key={w.i} style={bd && w.i === bd.i && w.delta != null && w.delta < 0 ? { background: "rgba(248,113,113,0.06)" } : {}}>
                      <td><strong>{w.label}</strong></td>
                      <td className="tnum">{fmtPct(w.cvrLast)}</td>
                      <td className="tnum">{fmtPct(w.cvrThis)}</td>
                      <td className="tnum">{fmtDelta(w.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* §2 컨트롤: 전환 단계 · 분리 단위 · 요일 보정 */}
      <section className="block" id="s-funnel-ctl" style={{ padding: "12px 16px" }}>
        <div className="ab-pillgroup" style={{ marginBottom: "8px" }}>
          <span className="ab-pillgroup-label">전환 단계</span>
          {(c.trans || []).map((t) => (
            <button key={t.i} className={`ab-pill ${c.selStep === t.i ? "active" : ""}`} onClick={() => setCvrStep(t.i)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ab-pillgroup" style={{ marginBottom: "8px" }}>
          <span className="ab-pillgroup-label">분리 단위</span>
          {unitPills.map(([k, l]) => {
            const av = k === "_all" || mappedKeys.has(k);
            return (
              <button key={k} className={`ab-pill ${unitField === k ? "active" : ""} ${!av ? "disabled" : ""}`} onClick={() => av && setUnitField(k)} disabled={!av}>
                {l}{!av && " 🔒"}
              </button>
            );
          })}
        </div>
        <div className="ab-pillgroup" style={{ margin: 0 }}>
          <span className="ab-pillgroup-label">§3 요일</span>
          {c.weekdayAdjOk ? (
            <button className={`ab-pill ${adjOn ? "active" : ""}`} onClick={() => setWeekdayAdj((v) => !v)}>
              요일 보정 {adjOn ? "ON" : "OFF"}
            </button>
          ) : (
            <button className="ab-pill disabled" disabled title="평일·주말 각 3일 이상 필요">요일 보정 🔒</button>
          )}
        </div>
        <p className="muted" style={{ fontSize: "11px", margin: "8px 0 0" }}>
          아래 추이·세그먼트·랭킹은 선택한 <strong>전환 단계({selLbl})</strong> 기준입니다.
        </p>
      </section>

      {/* §3 시계열 추이 + 평균 대비 저조일 */}
      {(c.daily || []).filter((x) => x.cvr != null).length >= 3 && (
        <section className="block" id="s-funnel-trend" style={{ marginTop: "24px" }}>
          <h2 className="section-title"><span className="ix">§3</span>{selLbl} CVR 추이{adjOn ? " (요일 보정)" : ""}</h2>
          {adjOn && c.weekdayProfile && (
            <div className="callout" style={{ margin: "0 0 8px", padding: "8px 12px" }}>
              <div className="ico">i</div>
              <div className="body">
                <p style={{ margin: 0, fontSize: "12px" }}>
                  💡 요일(평일/주말) 보정됨 — 같은 요일끼리 비교한 결과입니다. 평일 평균 {(c.weekdayProfile.weekday * 100).toFixed(1)}% / 주말 평균 {(c.weekdayProfile.weekend * 100).toFixed(1)}%.
                </p>
              </div>
            </div>
          )}
          <div className="chart-container" style={{ height: "240px" }}>
            <canvas id="funnel-trend-chart" ref={chartRef}></canvas>
          </div>
          {lows.length ? (
            <div className="callout" style={{ marginTop: "10px" }}>
              <div className="ico">!</div>
              <div className="body">
                <p style={{ margin: "0 0 4px", fontSize: "12px" }}>
                  <strong>평균보다 유독 낮았던 날 (−1σ 이하{adjOn ? ", 요일 보정 후" : ""})</strong>
                </p>
                <p className="muted" style={{ margin: "0 0 6px", fontSize: "11px" }}>
                  기간 전체 평균과 비교한 것으로, 전날보다는 올랐지만 여전히 평균보다 낮은 날도 포함됩니다.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {lows.map((x) => {
                    const cv = adjOn ? x.cvrAdj : x.cvr;
                    const dp = adjOn ? x.devPctAdj : x.devPct;
                    const idx = (c.daily || []).findIndex((d) => d.date === x.date);
                    const prevRow = idx > 0 ? c.daily[idx - 1] : null;
                    const prevCv = prevRow ? (adjOn ? prevRow.cvrAdj : prevRow.cvr) : null;
                    const vsPrevUp = cv != null && prevCv != null ? cv > prevCv : null;
                    return (
                      <span key={x.date} className="chip warning" style={{ fontSize: "11px" }}>
                        {x.date} · {cv != null ? (cv * 100).toFixed(1) : "—"}%{" "}
                        <span style={{ opacity: 0.7 }}>({dp != null && dp < 0 ? "" : "+"}{dp != null ? (dp * 100).toFixed(0) : "—"}%)</span>
                        {vsPrevUp != null && (
                          <span style={{ opacity: 0.7, marginLeft: "4px" }} title="전날 대비">
                            {vsPrevUp ? "↑전일比" : "↓전일比"}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: "8px", fontSize: "12px" }}>평균보다 −1σ 이상 낮았던 날은 없습니다. CVR이 안정적입니다.</p>
          )}
        </section>
      )}

      {/* §4 세그먼트 랭킹 */}
      {c.segRank && (
        <section className="block" id="s-funnel-seg" style={{ marginTop: "24px" }}>
          <h2 className="section-title"><span className="ix">§4</span>{FUNNEL_FIELD_LABEL[c.segRank.field] || c.segRank.field}별 {selLbl} CVR — 평균 대비</h2>
          <p className="muted" style={{ fontSize: "12px", margin: "-4px 0 10px" }}>
            평균({fmtPct(c.segRank.avg)}) 대비 높은/낮은 {FUNNEL_FIELD_LABEL[c.segRank.field] || c.segRank.field}. 분모 볼륨이 충분한 세그먼트만 표시합니다.
          </p>
          <div className="table-wrap">
            <table className="data" style={{ fontSize: "11.5px" }}>
              <thead><tr><th>{FUNNEL_FIELD_LABEL[c.segRank.field] || c.segRank.field}</th><th>{selLbl} CVR</th><th>평균 대비</th><th>분모 볼륨</th></tr></thead>
              <tbody>
                <tr><td colSpan="4" style={{ fontWeight: 700, color: "#34d399", fontSize: "11px", paddingTop: "8px" }}>▲ 잘 전환되는 {FUNNEL_FIELD_LABEL[c.segRank.field] || c.segRank.field}</td></tr>
                {c.segRank.best.map((x) => {
                  const dev = c.segRank.avg > 0 ? (x.cvr - c.segRank.avg) / c.segRank.avg : 0;
                  return (
                    <tr key={"b-" + x.seg}>
                      <td><strong>{String(x.seg).slice(0, 24)}</strong></td>
                      <td className="tnum pos">{fmtPct(x.cvr)}</td>
                      <td className="tnum" style={{ color: dev >= 0 ? "#34d399" : "#f87171" }}>{dev >= 0 ? "+" : ""}{(dev * 100).toFixed(0)}%</td>
                      <td className="tnum" style={{ color: "var(--text-muted)" }}>{(x.vol || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
                <tr><td colSpan="4" style={{ fontWeight: 700, color: "#f87171", fontSize: "11px", paddingTop: "8px" }}>▼ 전환이 낮은 {FUNNEL_FIELD_LABEL[c.segRank.field] || c.segRank.field}</td></tr>
                {c.segRank.worst.map((x) => {
                  const dev = c.segRank.avg > 0 ? (x.cvr - c.segRank.avg) / c.segRank.avg : 0;
                  return (
                    <tr key={"w-" + x.seg}>
                      <td><strong>{String(x.seg).slice(0, 24)}</strong></td>
                      <td className="tnum neg">{fmtPct(x.cvr)}</td>
                      <td className="tnum" style={{ color: dev >= 0 ? "#34d399" : "#f87171" }}>{dev >= 0 ? "+" : ""}{(dev * 100).toFixed(0)}%</td>
                      <td className="tnum" style={{ color: "var(--text-muted)" }}>{(x.vol || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* §5 전체 퍼널 단계 표 */}
      <section className="block" id="s-funnel" style={{ marginTop: "24px" }}>
        <h2 className="section-title"><span className="ix">§5</span>전체 퍼널 단계 표</h2>
        <div className="table-wrap">
          <table className="data" style={{ fontSize: "11.5px" }}>
            <thead>
              <tr>
                <th>단위</th>
                {c.stages.map((s) => <th key={s.key}>{s.label}</th>)}
                {c.stages.slice(1).map((s, i) => (
                  <th key={s.key + "-cvr"}>→{s.label} CVR{i + 1 === c.selStep ? " ◆" : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.rows.slice(0, 40).map((r, i) => (
                <tr key={i}>
                  <td><strong>{String(r.unit).slice(0, 24)}</strong></td>
                  {r.steps.map((s, si) => (
                    <td key={si} className="tnum">{(s.count || 0).toLocaleString()}</td>
                  ))}
                  {r.steps.slice(1).map((s, si) => {
                    const isSel = si + 1 === c.selStep;
                    return (
                      <td key={si + "-cvr"} className="tnum" style={isSel ? { background: "rgba(122,162,247,0.08)", fontWeight: 700 } : {}}>
                        {fmtPct(s.cvr)}
                        {s.drop != null && <span style={{ color: "var(--text-muted)", fontSize: "10px" }}> (이탈 {(s.drop * 100).toFixed(0)}%)</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="callout" style={{ marginTop: "10px" }}>
          <div className="ico">i</div>
          <div className="body">
            <p style={{ margin: 0, fontSize: "12px" }}>
              ◆ = 선택한 전환 단계. 노출→클릭(CTR)은 보통 97~99% 이탈이 정상이므로 병목 판단에서 제외하고, <strong>클릭→설치 / 설치→액션</strong> 같은 후속 단계로 진단하세요.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
