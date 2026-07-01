"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { getMonFilteredRows, effectiveDenomBasis, fmtCurrencyPrecise } from "@/utils/dashboardAggregator";
import { chartCommonOpts, getCssVar } from "@/utils/chartUtils";
import { buildLtvData, LTV_DNS, LTVCAC_MATH } from "@/utils/ltvMath";
import { buildMaturationRows, MATURATION_MATH } from "@/utils/cohortMath";

export default function LtvTab() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  const denomBasis = useAppStore((state) => state.denomBasis);
  const setDenomBasis = useAppStore((state) => state.setDenomBasis);
  const displayCurrency = useAppStore((state) => state.displayCurrency);
  const setDisplayCurrency = useAppStore((state) => state.setDisplayCurrency);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const [unitField, setUnitField] = useState("channel");
  const [ltvHorizon, setLtvHorizon] = useState(30);
  // ROAS 성숙 예측 상태(§4)
  const [matUnit, setMatUnit] = useState("_all");
  const [matAnchors, setMatAnchors] = useState(null); // null = 전체 사용 가능 Dn
  const [matShowCurve, setMatShowCurve] = useState(true);
  const [matShowEmpirical, setMatShowEmpirical] = useState(true);
  const [matHorizon, setMatHorizon] = useState(360);

  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const effBasis = effectiveDenomBasis(csvData, denomBasis);

  useEffect(() => {
    if (csvData && csvData.mapping) {
      const mapped = new Set(Object.values(csvData.mapping));
      const avail = [
        { k: "channel", l: "채널" },
        { k: "campaign_name", l: "캠페인" },
        { k: "country", l: "국가" },
        { k: "platform", l: "OS" }
      ];
      if (!mapped.has(unitField) && Array.from(mapped).length > 0) {
        const fallback = avail.find(a => mapped.has(a.k));
        // 무효 unitField를 유효 기본값으로 1회 보정 — 조건부라 무한루프 없음(의도된 패턴)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (fallback) setUnitField(fallback.k);
      }
    }
  }, [csvData, unitField]);

  const { rows, hasData, availFields, mappedFields, hasInstalls, hasActions } = useMemo(() => {
    if (!csvData || !csvData.raw || csvData.raw.length === 0) return { hasData: false, availFields: [], mappedFields: new Set() };
    const filtered = getMonFilteredRows(csvData, dashboardFilter);
    const mapping = csvData.mapping || {};

    const mapped = new Set(Object.values(mapping));
    const avail = [
      { k: "channel", l: "채널" },
      { k: "campaign_name", l: "캠페인" },
      { k: "country", l: "국가" },
      { k: "platform", l: "OS" }
    ];

    const _rows = buildLtvData(filtered, mapping, unitField, ltvHorizon, effBasis);
    return {
      hasData: true,
      rows: _rows,
      availFields: avail,
      mappedFields: mapped,
      hasInstalls: mapped.has("installs"),
      hasActions: mapped.has("actions"),
    };
  }, [csvData, dashboardFilter, unitField, ltvHorizon, effBasis]);

  // ── ROAS 성숙 예측(§4) — buildMaturationRows 엔진 배선 ─────────────────────
  // getMonFilteredRows는 이미 표준키로 매핑된 행을 반환하므로, 성숙 엔진(mapRows로
  // 재매핑)에는 identity 매핑을 넘겨 필터+매핑을 그대로 존중.
  const maturation = useMemo(() => {
    if (!hasData) return null;
    const mapping = csvData.mapping || {};
    const filtered = getMonFilteredRows(csvData, dashboardFilter);
    const mappedKeys = new Set(Object.values(mapping));
    const identity = {};
    for (const k of mappedKeys) identity[k] = k;
    const state = {
      unitField: matUnit,
      anchorDns: matAnchors,
      showCurve: matShowCurve,
      showEmpirical: matShowEmpirical,
      targetHorizon: matHorizon,
    };
    const res = buildMaturationRows(filtered, identity, state);
    const suffData =
      res.units.length > 0 && res.availDns.length >= 2
        ? MATURATION_MATH.sufficiency(res.units, res.availDns, matHorizon)
        : null;
    return { ...res, suffData, mappedKeys };
  }, [hasData, csvData, dashboardFilter, matUnit, matAnchors, matShowCurve, matShowEmpirical, matHorizon]);

  useEffect(() => {
    if (!hasData || !rows.length || !chartRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const topRows = rows.slice(0, 8);
    const PALETTE = ["#7aa2f7", "#9ece6a", "#e0af68", "#f7768e", "#bb9af7", "#2ac3de", "#ff9e64", "#73daca"];

    const labels = LTV_DNS.map(d => `D${d}`);
    const datasets = topRows.map((r, ri) => {
      const color = PALETTE[ri % PALETTE.length];
      const pts = LTV_DNS.map(d => {
        const { value, predicted } = LTVCAC_MATH.ltvPredict(r.unitRef, d);
        // §7: Math.round 금지 — 저객단가(USD·<1) 0-뭉개짐 방지. 소수 보존.
        return { y: value != null && isFinite(value) ? value : null, predicted };
      });

      return {
        label: r.unit.slice(0, 20),
        data: pts.map(p => p.y),
        borderColor: color,
        backgroundColor: color,
        fill: false,
        tension: 0.2,
        borderWidth: 2,
        pointRadius: pts.map(p => p.predicted ? 0 : 3),
        pointBackgroundColor: color,
        segment: {
          borderDash: ctx => {
            const p0 = pts[ctx.p0DataIndex];
            const p1 = pts[ctx.p1DataIndex];
            return (p0?.predicted || p1?.predicted) ? [4, 4] : undefined;
          }
        }
      };
    });

    chartInstanceRef.current = new Chart(chartRef.current.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: {
        ...chartCommonOpts(),
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...chartCommonOpts().plugins,
          legend: { labels: { color: getCssVar("--text-muted"), font: { size: 11 } } },
          tooltip: {
            ...chartCommonOpts().plugins.tooltip,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtCurrencyPrecise(ctx.parsed.y, displayCurrency)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: getCssVar("--text-muted"), maxTicksLimit: 14 }, grid: { color: getCssVar("--border") } },
          y: { ticks: { color: getCssVar("--text-muted"), callback: (v) => fmtCurrencyPrecise(v, displayCurrency) }, grid: { color: getCssVar("--border") } }
        }
      }
    });

    return () => {
      if (chartInstanceRef.current) chartInstanceRef.current.destroy();
    };
  }, [hasData, rows, displayCurrency, isDarkMode]);

  if (!hasData) {
    return <div className="tab-pane active" id="tab-ltv"><p className="muted">데이터 없음</p></div>;
  }

  const fmtPct = (v) => v == null || !isFinite(v) ? "—" : (v * 100).toFixed(0) + "%";
  const fmtX = (v) => v == null || !isFinite(v) ? "—" : v.toFixed(2) + "×";
  const fmtCur = (v) => fmtCurrencyPrecise(v, displayCurrency);
  const fmtPb = (v) => v == null ? <span style={{ color: "#f87171" }}>미회수</span> : `${v}일`;

  const HEALTHY_RATIO = 3;
  const WARN_RATIO = 1;
  const ratioCls = (r) => r == null ? "" : (r >= HEALTHY_RATIO ? "pos" : (r < WARN_RATIO ? "neg" : ""));
  const denomLabel = effBasis === "actions" ? "액션" : "설치";

  // ROAS 성숙 표 컬럼 = 관측 Dn ∪ 표준 예측 horizon(90/180/360)
  const matPctFmt = (v) => (v == null || !isFinite(v) ? null : (v * 100).toFixed(0) + "%");
  const showCols = maturation
    ? [...new Set([...maturation.availDns, ...[90, 180, 360].filter((d) => !maturation.availDns.includes(d))])].sort((a, b) => a - b)
    : [];
  const isDnMapped = (d) => maturation && maturation.mappedKeys.has(`revenue_d${d}`);

  const toggleAnchor = (d) => {
    if (!maturation) return;
    const base = matAnchors == null ? [...maturation.availDns] : [...matAnchors];
    const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d].sort((a, b) => a - b);
    setMatAnchors(next);
  };
  const anchorSelected = (d) => matAnchors == null || matAnchors.includes(d);

  return (
    <div className="tab-pane active" id="tab-ltv">
      <section className="block" id="s-ctl">
        <h2 className="section-title"><span className="ix">§1</span>분석 단위 · LTV Horizon</h2>
        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">단위</span>
          {availFields.map(f => {
            const avail = mappedFields.has(f.k);
            return (
              <button
                key={f.k}
                className={`ab-pill ${unitField === f.k ? "active" : ""} ${!avail ? "disabled" : ""}`}
                onClick={() => avail && setUnitField(f.k)}
                disabled={!avail}
              >
                {f.l}{!avail && " 🔒"}
              </button>
            );
          })}
        </div>
        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label">LTV Horizon</span>
          {[7, 14, 30, 90, 180, 360].map(d => (
            <button key={d} className={`ab-pill ${ltvHorizon === d ? "active" : ""}`} onClick={() => setLtvHorizon(d)}>
              D{d}
            </button>
          ))}
        </div>
        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label" title="CAC와 ARPU의 분모(유저수) 기준. 액션이 '가입'이면 가입자수 기준으로 보고 싶을 수 있습니다.">유저수 기준</span>
          {[["installs", "설치수 (installs)"], ["actions", "액션수 (actions)"]].map(([k, l]) => {
            const avail = k === "installs" ? hasInstalls : hasActions;
            return (
              <button
                key={k}
                className={`ab-pill ${effBasis === k ? "active" : ""} ${!avail ? "disabled" : ""}`}
                onClick={() => avail && setDenomBasis(k)}
                disabled={!avail}
              >
                {l}{!avail && " 🔒"}
              </button>
            );
          })}
        </div>
        <div className="ab-pillgroup">
          <span className="ab-pillgroup-label" title="표시 통화 단위만 전환합니다(값 변환 아님 — CSV 통화 그대로). 작은 값도 자릿수를 살려 표시합니다.">표시 통화</span>
          {[["KRW", "원 (₩)"], ["USD", "달러 ($)"]].map(([k, l]) => (
            <button key={k} className={`ab-pill ${displayCurrency === k ? "active" : ""}`} onClick={() => setDisplayCurrency(k)}>
              {l}
            </button>
          ))}
        </div>
      </section>

      <section className="block" id="s-table">
        <h2 className="section-title"><span className="ix">§2</span>LTV:CAC · 회수기간 (LTV horizon = D{ltvHorizon})</h2>
        <p className="muted">
          초록 = LTV:CAC ≥ {HEALTHY_RATIO}× (건강) · 빨강 = &lt; {WARN_RATIO}× (적자). payback = 누적 ARPU가 CAC에 도달하는 day (power 외삽). ⓘ = 미마감 구간 예측값.
        </p>
        <div className="table-wrap">
          <table className="data" style={{ fontSize: "11.5px" }}>
            <thead>
              <tr>
                <th>단위</th>
                <th>비용</th>
                <th title={`${denomLabel}수(${effBasis}) 기준`}>유저({denomLabel})</th>
                <th>CAC</th>
                <th>ROAS D7</th>
                <th>ROAS D14</th>
                <th>LTV(D{ltvHorizon})/user</th>
                <th>LTV:CAC</th>
                <th>Payback</th>
                <th>외삽</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 60).map((r, i) => (
                <tr key={i}>
                  <td><strong>{String(r.unit).slice(0, 28)}</strong></td>
                  <td className="tnum">{fmtCur(r.cost)}</td>
                  <td className="tnum">{(r.users || 0).toLocaleString()}</td>
                  <td className="tnum">{r.cac != null ? fmtCur(r.cac) : "—"}</td>
                  <td className="tnum">{fmtPct(r.roas7)}</td>
                  <td className="tnum">{fmtPct(r.roas14)}</td>
                  <td className="tnum">
                    {r.ltvAtHorizon != null ? (
                      <>
                        {fmtCur(r.ltvAtHorizon)}
                        {r.ltvPredicted && <span style={{ fontSize: "9px", color: "#adc6ff", cursor: "help", marginLeft: "4px" }} title={`이 단위는 D${r.maxObsDn}까지만 실측. D${ltvHorizon}는 미마감 구간으로 이전 Dn 추이를 기반으로 예측한 값입니다. 실측이 누적되면 재확인하세요.`}>ⓘ</span>}
                      </>
                    ) : "—"}
                  </td>
                  <td className={`tnum ${ratioCls(r.ratio)}`}>
                    <strong>{fmtX(r.ratio)}</strong>
                  </td>
                  <td className="tnum">{fmtPb(r.payback)}</td>
                  <td className="tnum" style={{ color: "var(--text-muted)", fontSize: "10px" }}>{r.fitKind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="callout" style={{ marginTop: "10px" }}>
          <div className="ico">i</div>
          <div className="body">
            <p style={{ margin: 0, fontSize: "12px" }}>
              LTV:CAC는 <strong>유닛 이코노믹스 건강도</strong>의 핵심 지표입니다. 3× 이상이면 공격적 확장 여지, 1× 미만이면 해당 단위는 적자이므로 입찰/예산 축소 또는 LTV 개선이 필요합니다. 회수기간이 목표(180일)보다 길면 현금흐름 부담을 검토하세요.
            </p>
          </div>
        </div>
      </section>

      <section className="block" id="s-ltv-curve">
        <h2 className="section-title"><span className="ix">§3</span>LTV D0~D360 곡선</h2>
        <p className="muted">실선 = 실측 ARPU · 점선 = 예측(ⓘ 미마감). 단위 필터 및 Horizon 토글과 연동됩니다.</p>
        <div className="chart-container" style={{ height: "260px" }}>
          <canvas id="ltvcac-curve" ref={chartRef}></canvas>
        </div>
      </section>

      <section className="block" id="s-mat">
        <h2 className="section-title"><span className="ix">§4</span>ROAS 성숙 예측</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "flex-start", marginBottom: "14px" }}>
          <div className="ab-pillgroup">
            <span className="ab-pillgroup-label">단위</span>
            {[["_all", "전체"], ["channel", "채널"], ["campaign_name", "캠페인"]].map(([k, l]) => {
              const av = k === "_all" || (maturation && maturation.mappedKeys.has(k));
              return (
                <button
                  key={k}
                  className={`ab-pill ${matUnit === k ? "active" : ""} ${!av ? "disabled" : ""}`}
                  onClick={() => av && setMatUnit(k)}
                  disabled={!av}
                >
                  {l}{!av && " 🔒"}
                </button>
              );
            })}
          </div>
          <div className="ab-pillgroup">
            <span className="ab-pillgroup-label">Anchor Dn <small style={{ opacity: 0.6, fontWeight: 400 }}>(곡선 fit 포함)</small></span>
            {MATURATION_MATH.ALL_DNS.filter((d) => isDnMapped(d)).map((d) => {
              const avail = maturation && maturation.availDns.includes(d);
              return (
                <button
                  key={d}
                  className={`ab-pill ${anchorSelected(d) && avail ? "active" : ""} ${!avail ? "disabled" : ""}`}
                  onClick={() => avail && toggleAnchor(d)}
                  disabled={!avail}
                >
                  D{d}
                </button>
              );
            })}
          </div>
          <div className="ab-pillgroup">
            <span className="ab-pillgroup-label">방법 표시</span>
            <button className={`ab-pill ${matShowCurve ? "active" : ""}`} style={{ color: "var(--accent)" }} onClick={() => setMatShowCurve((v) => !v)}>커브 fit</button>
            <button className={`ab-pill ${matShowEmpirical ? "active" : ""}`} style={{ color: "#9ece6a" }} onClick={() => setMatShowEmpirical((v) => !v)}>경험적 비율</button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data" style={{ fontSize: "11px" }}>
            <thead>
              <tr>
                <th>단위</th>
                <th>비용</th>
                {showCols.map((d) => <th key={d}>D{d}</th>)}
                <th>성숙배수</th>
                <th>외삽</th>
              </tr>
            </thead>
            <tbody>
              {maturation && maturation.units.length > 0 ? (
                maturation.units.slice(0, 60).map((u, ui) => {
                  const curvePred = (d) => (u.fit ? u.fit.predict(d) : null);
                  const empPred = (d) => {
                    if (
                      maturation.empiricalBase == null ||
                      maturation.empRatios[d] == null ||
                      u.roas[d] != null ||
                      u.roas[maturation.empiricalBase] == null
                    ) return null;
                    return u.roas[maturation.empiricalBase] * maturation.empRatios[d].avg;
                  };
                  const base = maturation.selAnchors.length
                    ? (u.roas[maturation.selAnchors[maturation.selAnchors.length - 1]] ?? u.roas[7] ?? u.roas[14])
                    : null;
                  const pred90 = u.roas[90] ?? curvePred(90);
                  const mat = base != null && pred90 != null && base > 0 ? pred90 / base : null;
                  const fmtCell = (d) => {
                    const actual = u.roas[d];
                    if (actual != null) return <strong>{matPctFmt(actual)}</strong>;
                    const parts = [];
                    const curve = matShowCurve ? curvePred(d) : null;
                    const emp = matShowEmpirical ? empPred(d) : null;
                    if (curve != null) parts.push(<span key="c" style={{ color: "var(--accent)" }}>{matPctFmt(curve)}</span>);
                    if (emp != null) parts.push(<em key="e" style={{ color: "#9ece6a" }}>{matPctFmt(emp)}</em>);
                    if (!parts.length) return <span style={{ color: "var(--text-muted)" }}>—</span>;
                    return parts.reduce((acc, el, i) => (i === 0 ? [el] : [...acc, <br key={"br" + i} />, el]), []);
                  };
                  return (
                    <tr key={ui}>
                      <td><strong>{String(u.unit).slice(0, 24)}</strong></td>
                      <td className="tnum">{fmtCur(u.cost)}</td>
                      {showCols.map((d) => <td key={d} className="tnum">{fmtCell(d)}</td>)}
                      <td className="tnum">{mat != null ? mat.toFixed(2) + "×" : "—"}</td>
                      <td className="tnum" style={{ color: "var(--text-muted)", fontSize: "10px" }}>{u.fit?.kind || "—"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={showCols.length + 4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>
                    revenue_dN 컬럼을 매핑하면 ROAS 성숙 예측이 표시됩니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {maturation && maturation.empiricalBase != null && Object.values(maturation.empRatios).some((v) => v != null) && (
          <div className="callout" style={{ marginTop: "8px" }}>
            <div className="ico">i</div>
            <div className="body">
              <p style={{ margin: 0, fontSize: "12px" }}>
                <strong style={{ color: "#9ece6a" }}>경험적 비율</strong>: D{maturation.empiricalBase} 실측 기반 완성비.
                D{maturation.empiricalBase}와 목표 Dn을 모두 보유한 단위들의 비율(비용 가중 평균)을 미완성 단위에 적용합니다. 커브 fit과 일치할수록 예측 신뢰도 ↑.
              </p>
            </div>
          </div>
        )}

        <h3 style={{ margin: "20px 0 10px", fontSize: "13px", fontWeight: 600 }}>
          🎯 Anchor 충분성 진단
          <small style={{ opacity: 0.6, fontWeight: 400, marginLeft: "8px" }}>— D{matHorizon} 예측이 안정화되는 최소 anchor 집합 자동 탐지</small>
          <span className="ab-pillgroup" style={{ display: "inline-flex", marginLeft: "14px", verticalAlign: "middle" }}>
            {[90, 180, 360].map((h) => (
              <button key={h} className={`ab-pill ${matHorizon === h ? "active" : ""}`} onClick={() => setMatHorizon(h)}>D{h}</button>
            ))}
          </span>
        </h3>
        <div className="table-wrap">
          <table className="data" style={{ fontSize: "12px" }}>
            <thead>
              <tr>
                <th>Anchor 집합</th>
                <th>D{matHorizon} 커브 예측</th>
                <th>이전 대비 변화율</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {maturation && maturation.suffData ? (
                maturation.suffData.steps.map((s, i) => (
                  <tr key={i} style={s.converged ? { background: "rgba(158,206,106,0.06)" } : {}}>
                    <td><code style={{ fontSize: "11px" }}>[{s.set.map((d) => "D" + d).join(", ")}]</code></td>
                    <td className="tnum"><strong>{s.pred != null ? (s.pred * 100).toFixed(1) + "%" : "—"}</strong></td>
                    <td className="tnum">{s.chg != null ? (s.chg * 100).toFixed(1) + "%" : "—"}</td>
                    <td>
                      {s.converged ? (
                        <span style={{ color: "#9ece6a", fontWeight: 600 }}>✓ 안정화 (&lt;2%)</span>
                      ) : i === maturation.suffData.steps.length - 1 && !maturation.suffData.convergedAt ? (
                        <span style={{ color: "var(--text-muted)" }}>추가 데이터 필요</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>
                    Anchor Dn을 2개 이상 관측하면 충분성 진단이 표시됩니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {maturation && maturation.suffData && (
          maturation.suffData.convergedAt ? (
            <div className="callout" style={{ marginTop: "8px", borderColor: "rgba(158,206,106,0.4)", background: "rgba(158,206,106,0.05)" }}>
              <div className="ico" style={{ color: "#9ece6a" }}>✓</div>
              <div className="body">
                <p style={{ margin: 0, fontSize: "12px" }}>
                  <strong>[{maturation.suffData.convergedAt.map((d) => "D" + d).join(", ")}] anchor 집합부터 D{matHorizon} 예측 안정화</strong> (변화율 &lt;2%). 이 Dn 이상의 데이터가 있으면 예측이 충분히 수렴합니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="callout warn" style={{ marginTop: "8px" }}>
              <div className="ico">⚠</div>
              <div className="body">
                <p style={{ margin: 0, fontSize: "12px" }}>
                  사용 가능한 anchor 조합으로 D{matHorizon} 예측이 아직 안정화되지 않았습니다. 더 장기 Dn 데이터(예: D30, D90)를 추가하면 신뢰도가 높아집니다.
                </p>
              </div>
            </div>
          )
        )}
        <div className="callout" style={{ marginTop: "12px" }}>
          <div className="ico">i</div>
          <div className="body">
            <p style={{ margin: 0, fontSize: "12px" }}>
              조기 ROAS가 낮아 보여도 <strong>성숙배수</strong>가 크면(예: 2×+) D90엔 손익분기를 넘길 수 있습니다. 조기 D7만 보고 끄지 말고 성숙 예측을 함께 보세요. ⚠ 관측 이후 Dn은 외삽이므로 실측 누적되면 재확인.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
