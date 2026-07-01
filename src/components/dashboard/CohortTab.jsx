"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { getMonFilteredRows, effectiveDenomBasis, computeWeightedRetention } from "@/utils/dashboardAggregator";
import { CHART_THEME, chartCommonOpts, getCssVar } from "@/utils/chartUtils";
import { fitPowerCurve, filterMaturedCohorts, retentionDays } from "@/utils/cohortMath";

export default function CohortTab() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  // 전역 분모 기준(설치/가입) 구독 — index.html MON_DENOM_STATE 이식(§12.18).
  // 리텐션 기준 토글은 이 전역 상태를 바꿔 스코어카드·LTV 탭과 동기화된다.
  const denomBasis = useAppStore((state) => state.denomBasis);
  const setDenomBasis = useAppStore((state) => state.setDenomBasis);
  // 코호트 마감 필터(§7 미마감 부풀림 방지) — 오늘 기준 D일이 지난 코호트만 집계.
  const matureCohortOnly = useAppStore((state) => state.matureCohortOnly);
  const setMatureCohortOnly = useAppStore((state) => state.setMatureCohortOnly);

  // 다크모드 토글 시 차트 재렌더 트리거(테마색 refresh, §12.20 패턴).
  const isDarkMode = useAppStore((state) => state.isDarkMode);

  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const segmentChartRefs = useRef({});
  const segmentChartInstancesRef = useRef({});

  const { wrc, hasData, canActions, canInstalls } = useMemo(() => {
    if (!csvData || !csvData.raw || csvData.raw.length === 0) return { hasData: false };

    const rows = getMonFilteredRows(csvData, dashboardFilter);
    const mapping = csvData.mapping || {};
    const mapped = new Set(Object.values(mapping));

    const _canActions = mapped.has("actions");
    const _canInstalls = mapped.has("installs");

    // anchor = 전역 분모 기준(설치/가입). effectiveDenomBasis가 미매핑 자동 폴백.
    const anchor = effectiveDenomBasis(csvData, denomBasis);
    // D0은 항상 100% 앵커(설치/가입일=전원 잔존), D1 지원(브랜치 43e5950).
    // ret_dN(N≥1)이 하나라도 매핑됐을 때만 D0 prepend.
    const retDays = retentionDays(mapped);

    if (retDays.length === 0) return { hasData: false, canActions: _canActions, canInstalls: _canInstalls };

    // SSOT 가중 리텐션(computeWeightedRetention) — 비율/인원 자동 판별 + 모수 가중.
    // wholePct 여부는 각 점에 실어두고 렌더 후 파생(closure 재할당 금지 — react-hooks/immutability).
    const wgtCurve = (subset) =>
      retDays
        .map((day) => {
          // D0 = 항상 100%(설치/가입일 전원 잔존). 모수 = anchor 코호트 크기(마감 필터 무관).
          if (day === 0) {
            const n = subset.reduce((s, r) => s + (Number(r[anchor]) || 0), 0);
            if (!n) return null;
            return { day: 0, retentionRate: 1, n, survivors: n, wholePct: false };
          }
          // 마감 필터: 분자·분모 둘 다 동일 필터(분모만 필터하면 오히려 더 부풀려짐).
          const scoped = filterMaturedCohorts(subset, day, matureCohortOnly);
          const r = computeWeightedRetention(scoped, day, anchor);
          if (r.rate == null) return null;
          return { day, retentionRate: r.rate, n: r.denom, survivors: r.survivors, wholePct: !!r.hasWholePct };
        })
        .filter(Boolean);

    const retCurve = wgtCurve(rows);

    // 세그먼트별 곡선(채널/국가/플랫폼) — 각 그룹당 상위 12개, 정렬은 index와 동일(가나다).
    const bySeg = {};
    for (const sk of ["channel", "country", "platform"]) {
      if (!mapped.has(sk)) continue;
      const groups = [...new Set(rows.map((r) => String(r[sk] || "")).filter(Boolean))].sort();
      bySeg[sk] = {};
      for (const g of groups.slice(0, 12)) {
        bySeg[sk][g] = wgtCurve(rows.filter((r) => String(r[sk] || "") === g));
      }
    }

    // 전체 리텐션 곡선(scorecard 기준)에 정수 퍼센트 의심값이 있으면 경고.
    const anyWholePct = retCurve.some((p) => p.wholePct);

    // power-law 외삽 — day>0 & rate>0 관측점만(D0은 정의상 1, 외삽 왜곡 방지).
    const predPts = retCurve.filter((p) => p.day > 0 && p.retentionRate > 0);
    const pwr = predPts.length >= 2
      ? fitPowerCurve(predPts.map((p) => p.day), predPts.map((p) => p.retentionRate))
      : null;

    return {
      hasData: true,
      wrc: {
        anchor,
        retDays,
        retCurve,
        bySegment: bySeg,
        pwr,
        wholePctWarn: anyWholePct,
      },
      canActions: _canActions,
      canInstalls: _canInstalls
    };
  }, [csvData, dashboardFilter, denomBasis, matureCohortOnly]);

  useEffect(() => {
    if (!hasData || !wrc.retCurve.length || !chartRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const curve = wrc.retCurve;
    const labels = curve.map(p => `D${p.day}`);
    const data = curve.map(p => p.retentionRate * 100);

    chartInstanceRef.current = new Chart(chartRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "전체 리텐션 (%)",
          data,
          borderColor: CHART_THEME.primary,
          backgroundColor: "rgba(173,198,255,0.2)",
          fill: true,
          tension: 0.2,
          pointRadius: 3,
          pointBackgroundColor: CHART_THEME.primary,
        }]
      },
      options: {
        ...chartCommonOpts(),
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...chartCommonOpts().plugins,
          legend: { display: false }
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
  }, [hasData, wrc, isDarkMode]);

  // Segment Charts
  useEffect(() => {
    if (!hasData || !wrc.bySegment) return;
    const PALETTE = ["#7aa2f7", "#9ece6a", "#e0af68", "#f7768e", "#bb9af7", "#2ac3de", "#ff9e64", "#73daca", "#c0caf5", "#a9b1d6", "#db4b4b", "#41a6b5"];
    
    Object.keys(wrc.bySegment).forEach(sk => {
      const canvas = segmentChartRefs.current[sk];
      if (!canvas) return;
      if (segmentChartInstancesRef.current[sk]) segmentChartInstancesRef.current[sk].destroy();
      
      const groups = Object.keys(wrc.bySegment[sk]);
      const datasets = groups.map((g, gi) => {
        // wgtCurve는 [{day, retentionRate, ...}] 배열 → day→rate 조회 맵.
        const byDay = {};
        wrc.bySegment[sk][g].forEach((p) => { byDay[p.day] = p.retentionRate; });
        const data = wrc.retDays.map(d => (byDay[d] != null ? byDay[d] * 100 : null));
        return {
          label: g.slice(0, 20),
          data,
          borderColor: PALETTE[gi % PALETTE.length],
          backgroundColor: PALETTE[gi % PALETTE.length],
          fill: false,
          tension: 0.2,
          pointRadius: 2,
        };
      });

      segmentChartInstancesRef.current[sk] = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: { labels: wrc.retDays.map(d => `D${d}`), datasets },
        options: {
          ...chartCommonOpts(),
          responsive: true,
          maintainAspectRatio: false,
          plugins: { ...chartCommonOpts().plugins, legend: { labels: { color: getCssVar("--text-muted"), font: { size: 10 } } } },
          scales: {
            x: { ticks: { color: getCssVar("--text-muted") }, grid: { color: getCssVar("--border") } },
            y: { ticks: { color: getCssVar("--text-muted") }, grid: { color: getCssVar("--border") } }
          }
        }
      });
    });

    return () => {
      Object.values(segmentChartInstancesRef.current).forEach(c => c && c.destroy());
    };
  }, [hasData, wrc, isDarkMode]);

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-cohort">
        <section className="block" id="s-retention">
          <h2 className="section-title"><span className="ix">§1</span>리텐션 곡선</h2>
          <div className="callout warn">
            <div className="ico">!</div>
            <div className="body">
              <strong>리텐션 데이터 없음</strong>
              <p>효율 CSV에 <code>ret_d30</code>, <code>ret_d90</code> 등 Retention(Dn) 컬럼을 매핑하세요.</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const fmtPct = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
  const anchorLabel = wrc.anchor === "actions" ? "가입(액션)" : "설치";
  const survLabel = wrc.anchor === "actions" ? "잔존 가입자 수" : "잔존 유저 수";
  
  const renderSegmentChart = (sk, label) => {
    return (
      <div key={sk} style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: ".05em" }}>
          {label}
        </div>
        <div className="chart-container" style={{ height: "200px" }}>
          <canvas id={`wide-ret-seg-${sk}`} ref={el => segmentChartRefs.current[sk] = el}></canvas>
        </div>
      </div>
    );
  };

  const horizons = [90, 180, 360].filter(d => !wrc.retDays.includes(d));

  return (
    <div className="tab-pane active" id="tab-cohort">
      <section className="block" id="s-retention">
        <h2 className="section-title"><span className="ix">§1</span>전체 리텐션 곡선</h2>
        
        {canActions && canInstalls && (
          <div className="ab-pillgroup" style={{ marginBottom: "10px" }}>
            <span className="ab-pillgroup-label">리텐션 기준</span>
            <button className={`ab-pill ${wrc.anchor !== "actions" ? "active" : ""}`} onClick={() => setDenomBasis("installs")}>설치 기준</button>
            <button className={`ab-pill ${wrc.anchor === "actions" ? "active" : ""}`} onClick={() => setDenomBasis("actions")}>가입(액션) 기준</button>
          </div>
        )}

        <div className="ab-pillgroup" style={{ marginBottom: "10px" }}>
          <span className="ab-pillgroup-label" title="아직 D일이 지나지 않은(미마감) 최근 코호트는 잔존율을 왜곡시킵니다. '마감만'은 오늘 기준 D일이 지난 코호트만 분자·분모 양쪽에서 집계.">코호트 마감</span>
          <button className={`ab-pill ${!matureCohortOnly ? "active" : ""}`} onClick={() => setMatureCohortOnly(false)}>전체 포함</button>
          <button className={`ab-pill ${matureCohortOnly ? "active" : ""}`} onClick={() => setMatureCohortOnly(true)}>마감된 코호트만</button>
        </div>

        <div className="chart-container" style={{ height: "220px" }}>
          <canvas id="wide-ret-curve" ref={chartRef}></canvas>
        </div>
        
        <div className="table-wrap" style={{ marginTop: "14px" }}>
          <table className="data" style={{ fontSize: "12px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>구간</th>
                <th style={{ textAlign: "right" }}>잔존율</th>
                <th style={{ textAlign: "right" }}>{survLabel}</th>
              </tr>
            </thead>
            <tbody>
              {wrc.retCurve.map(p => (
                <tr key={p.day}>
                  <td className="tnum">D{p.day}</td>
                  <td className="tnum" style={{ textAlign: "right" }}>{fmtPct(p.retentionRate)}</td>
                  <td className="tnum" style={{ textAlign: "right" }}>{(p.survivors || 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: "11px", marginTop: "8px" }}>
          {survLabel} = Σ(잔존 인원) ÷ Σ({anchorLabel} 모수). <code>ret_dN</code>이 <strong>0~1 비율</strong>이면 ×모수로 인원 환산, <strong>자연수면 인원수</strong> 그대로 합산합니다(코호트 크기 가중 — 단순평균 아님). 기준 토글은 모수({anchorLabel})를 바꿉니다.
        </p>
        {wrc.wholePctWarn && (
          <div className="callout warn" style={{ marginTop: "8px" }}>
            <div className="ico">!</div>
            <div className="body">
              <strong>리텐션 값이 1을 넘습니다(예: 30, 50)</strong>
              <p style={{ margin: ".25rem 0 0", fontSize: "11.5px" }}>
                정수 퍼센트(30=30%)가 아니라 <strong>잔존 인원수</strong>로 해석했습니다. 비율로 넣으려면 0~1(0.3·0.5)로, 인원수면 그대로 두세요.
              </p>
            </div>
          </div>
        )}
      </section>

      {Object.keys(wrc.bySegment).length > 0 && (
        <section className="block" id="s-ret-segment">
          <h2 className="section-title"><span className="ix">§2</span>세그먼트별 리텐션</h2>
          {renderSegmentChart("channel", "채널")}
          {renderSegmentChart("country", "국가")}
          {renderSegmentChart("platform", "플랫폼")}
        </section>
      )}

      {wrc.pwr && horizons.length > 0 && (
        <section className="block" id="s-ret-predict">
          <h2 className="section-title"><span className="ix">§3</span>리텐션 예측</h2>
          <p className="muted" style={{ fontSize: "12px" }}>
            관측된 Dn 데이터로 power-law 커브를 적합해 미관측 구간을 외삽합니다. 참고값으로만 사용하세요.
          </p>
          <div className="table-wrap" style={{ marginTop: "8px" }}>
            <table className="data" style={{ fontSize: "12px" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>구간</th>
                  <th style={{ textAlign: "right" }}>예측 잔존율</th>
                  <th style={{ textAlign: "right" }}>방법</th>
                </tr>
              </thead>
              <tbody>
                {horizons.map(d => {
                  const pred = wrc.pwr.a * Math.pow(d, wrc.pwr.b);
                  return (
                    <tr key={d}>
                      <td className="tnum">D{d}</td>
                      <td className="tnum" style={{ color: "var(--accent)", textAlign: "right" }}>{fmtPct(Math.min(1, Math.max(0, pred)))}</td>
                      <td className="tnum" style={{ color: "var(--text-muted)", fontSize: "11px", textAlign: "right" }}>Power fit 외삽</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
