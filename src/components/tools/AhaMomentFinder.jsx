"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { AHA_STATS, ahaParseActionWindow } from "@/utils/ahaMath";
import { downloadChartAsPNG } from "@/utils/chartUtils";
import { idToSlug } from "@/lib/routeMap";
import { showToast } from "@/utils/toast";

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ahaParseActionWindow는 @/utils/ahaMath에서 import (index.html verbatim 추출) */

/* target 후보 추정: 값이 전부 {0,1}인 숫자 컬럼. id 추정: 헤더명에 id/user 포함. (index.html ahaAutoMapColumns 이식) */
function ahaAutoMapColumns(headers, rows) {
  const out = {};
  for (const h of headers) {
    const name = String(h).toLowerCase();
    const vals = rows
      .map((r) => r[h])
      .filter((v) => v != null && String(v).trim() !== "");
    const nums = vals.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
    const isNum = vals.length > 0 && nums.length >= vals.length * 0.8;
    const uniq = isNum ? [...new Set(nums)] : [];
    const isBin01 =
      isNum && uniq.length > 0 && uniq.every((v) => v === 0 || v === 1);
    let role = "feature";
    if (/(^|_)(user|client|device)?_?id$|^id$|^uid$/.test(name)) role = "id";
    else if (
      isBin01 &&
      /target|conv|retain|churn|activ|타겟|전환|리텐션/.test(name)
    )
      role = "target";
    else if (!isNum) role = "ignore";
    const aw = ahaParseActionWindow(h);
    out[h] = { role, action: aw.action, window: aw.window };
  }
  // target 자동추정이 하나도 없으면, 가장 그럴듯한 bin01 컬럼 1개를 제안
  if (!Object.values(out).some((d) => d.role === "target")) {
    for (const h of headers) {
      const vals = rows
        .map((r) => r[h])
        .filter((v) => v != null && String(v).trim() !== "");
      const nums = vals.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
      const uniq = [...new Set(nums)];
      const isBin01 =
        nums.length >= vals.length * 0.8 &&
        vals.length > 0 &&
        uniq.length > 0 &&
        uniq.every((v) => v === 0 || v === 1) &&
        uniq.length <= 2;
      if (isBin01 && out[h].role !== "id") {
        out[h].role = "target";
        break;
      }
    }
  }
  return out;
}

/* colMap에서 role=feature인 컬럼들을 액션별로 그룹핑 → { action: [{header, window}] } */
function ahaGroupedActions(colMap) {
  const groups = {};
  for (const [h, def] of Object.entries(colMap || {})) {
    if (!def || def.role !== "feature") continue;
    const a = def.action || h;
    const w = def.window != null ? def.window : Infinity;
    if (!groups[a]) groups[a] = [];
    groups[a].push({ header: h, window: w });
  }
  for (const a in groups) groups[a].sort((x, y) => x.window - y.window);
  return groups;
}

function ahaTargetColumn(colMap) {
  for (const [h, def] of Object.entries(colMap || {}))
    if (def && def.role === "target") return h;
  return null;
}

function confidenceDots(f1Val) {
  const n =
    f1Val >= 0.7
      ? 5
      : f1Val >= 0.5
        ? 4
        : f1Val >= 0.3
          ? 3
          : f1Val >= 0.15
            ? 2
            : 1;
  return "●".repeat(n) + "○".repeat(5 - n);
}

/* 결과 표 CSV 다운로드 (index.html downloadAhaCsv 이식: BOM + CRLF + text/csv;charset=utf-8, §7) */
function downloadAhaCsv(sorted) {
  const q = (s) => {
    s = String(s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = [
    "action",
    "best_window",
    "best_k",
    "holdout_precision",
    "holdout_recall",
    "holdout_f1",
    "lift",
    "holdout_support",
    "train_precision",
    "train_recall",
    "train_f1",
    "support_gated",
  ];
  const lines = [header.join(",")];
  for (const r of sorted) {
    lines.push(
      [
        r.action,
        r.bestWindow === Infinity ? "all" : r.bestWindow,
        r.bestK,
        r.holdout.P.toFixed(4),
        r.holdout.R.toFixed(4),
        r.holdout.F1.toFixed(4),
        r.lift == null ? "" : r.lift.toFixed(4),
        r.holdout.support,
        r.train.P.toFixed(4),
        r.train.R.toFixed(4),
        r.train.F1.toFixed(4),
        r.gated ? "1" : "0",
      ]
        .map(q)
        .join(","),
    );
  }
  const fileName = `aha_moment_${new Date().toISOString().slice(0, 10)}.csv`;
  const content = "﻿" + lines.join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* 매핑 시그니처: colMap + fileName (index.html ahaAnalyzeSig 이식) */
function ahaAnalyzeSig(colMap, fileName) {
  return JSON.stringify(colMap || {}) + "|" + (fileName || "");
}

const AHA_ROLE_OPTIONS = [
  ["feature", "선행 행동(feature)"],
  ["target", "타겟(target, 0/1)"],
  ["id", "user_id(미사용)"],
  ["ignore", "사용 안 함"],
];

export default function AhaMomentFinder() {
  const router = useRouter();
  const csvData = useAppStore((state) => state.csvData);
  const setCsvData = useAppStore((state) => state.setCsvData);
  const ahaFileRef = useRef(null);
  const handleAhaFile = (file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        if (!res.data || !res.data.length) return;
        setCsvData({ raw: res.data, headers: res.meta.fields || [], mapping: {}, fileName: file.name });
      },
    });
  };
  const [minSupport, setMinSupport] = useState(30);
  const [holdoutOn, setHoldoutOn] = useState(true);
  const [sortBy, setSortBy] = useState("f1");
  const [drilldownAction, setDrilldownAction] = useState(null);
  // 편집 가능한 컬럼 역할 매핑 (index.html AHA_STATE.colMap — 자동추정 시드 후 사용자 편집)
  const [colMap, setColMap] = useState({});
  // 분석 게이트: 마지막으로 "분석하기"를 눌렀을 때의 매핑 시그니처
  const [analyzedSig, setAnalyzedSig] = useState(null);

  const hasData = csvData?.raw?.length > 0;

  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [seededKey, setSeededKey] = useState(null);

  const headers = useMemo(() => {
    if (!hasData) return [];
    return csvData?.headers?.length > 0
      ? csvData.headers
      : Object.keys(csvData?.raw?.[0] || {});
  }, [hasData, csvData]);

  // 데이터/파일이 바뀌면 자동추정으로 colMap 재시드 + 게이트 리셋 (render-time reseed
  // — setState-in-effect/ref 접근 회피, React "이전 렌더 정보로 상태 조정" 패턴).
  const fileName = csvData?.fileName || "data.csv";
  const seedKey = hasData ? `${fileName}|${headers.join(",")}|${csvData.raw.length}` : "";
  if (seededKey !== seedKey) {
    setSeededKey(seedKey);
    setColMap(hasData ? ahaAutoMapColumns(headers, csvData.raw) : {});
    setAnalyzedSig(null);
    setDrilldownAction(null);
  }

  // 현재 매핑 시그니처가 분석된 시그니처와 일치할 때만 결과 노출 (게이트)
  const analyzed = analyzedSig != null && analyzedSig === ahaAnalyzeSig(colMap, fileName);

  // --- 컬럼 역할 편집 핸들러 (index.html data-aha-role/action/window 이식) ---
  const setRole = (h, role) => {
    setColMap((prev) => {
      const def = prev[h] || { role: "ignore", action: h, window: Infinity };
      return { ...prev, [h]: { ...def, role } };
    });
  };
  const setAction = (h, value) => {
    setColMap((prev) => {
      if (!prev[h]) return prev;
      return { ...prev, [h]: { ...prev[h], action: value.trim() || h } };
    });
  };
  const setWindow = (h, value) => {
    setColMap((prev) => {
      if (!prev[h]) return prev;
      const raw = String(value).trim().replace(/^d/i, "");
      const v = parseInt(raw, 10);
      const window = raw === "" || !isFinite(v) ? Infinity : v;
      return { ...prev, [h]: { ...prev[h], window } };
    });
  };

  // --- 분석 캐시 (index.html buildAhaCache 이식, 순수엔진 AHA_STATS 사용) ---
  const cache = useMemo(() => {
    const empty = { n: 0, baseRate: 0, results: [], targetCol: null, groups: {} };
    if (!hasData) return empty;
    const rows = csvData.raw;
    const targetCol = ahaTargetColumn(colMap);
    const groups = ahaGroupedActions(colMap);
    const n = rows.length;
    if (!targetCol || !Object.keys(groups).length || !n)
      return { ...empty, n, targetCol, groups };

    const targets = rows.map((r) => {
      const v = parseFloat(r[targetCol]);
      return isFinite(v) && v >= 0.5 ? 1 : 0;
    });
    const baseRate = targets.reduce((s, t) => s + t, 0) / n;
    const ms = Math.max(1, minSupport || 1);

    let trainIdx, holdoutIdx;
    if (holdoutOn) {
      const sp = AHA_STATS.splitDeterministic(n, 20260620);
      trainIdx = sp.train;
      holdoutIdx = sp.holdout;
    } else {
      trainIdx = rows.map((_, i) => i);
      holdoutIdx = trainIdx;
    }

    const results = [];
    for (const [action, cols] of Object.entries(groups)) {
      const windowCols = cols.map((c) => ({
        header: c.header,
        window: c.window,
        valuesAll: rows.map((r) => {
          const v = parseFloat(r[c.header]);
          return isFinite(v) ? v : 0;
        }),
      }));
      const gs = AHA_STATS.gridSearch(
        windowCols,
        targets,
        trainIdx,
        holdoutIdx,
        ms,
      );
      if (!gs) continue;
      results.push({
        action,
        bestWindow: gs.bestWindow,
        bestHeader: gs.bestHeader,
        bestK: gs.bestK,
        train: gs.train,
        holdout: gs.holdout,
        gated: gs.gated,
        lift: AHA_STATS.lift(gs.holdout.P, baseRate),
        grid: gs.grid,
      });
    }
    return { n, baseRate, results, targetCol, groups };
  }, [hasData, csvData, colMap, minSupport, holdoutOn]);

  const sortedResults = useMemo(() => {
    const by = sortBy;
    const key = (r) =>
      by === "lift"
        ? r.lift == null
          ? -Infinity
          : r.lift
        : by === "precision"
          ? r.holdout.P
          : r.holdout.F1;
    return [...cache.results].sort((a, b) => {
      const ga = a.holdout.support >= minSupport;
      const gb = b.holdout.support >= minSupport;
      if (ga !== gb) return ga ? -1 : 1;
      return key(b) - key(a);
    });
  }, [cache, sortBy, minSupport]);

  const topAction = sortedResults.length ? sortedResults[0] : null;

  // §2 버블 차트 PNG 다운로드 (index.html data-pngdownload="aha-scatter" 이식)
  const handleScatterPng = () => {
    if (!chartRef.current) {
      showToast({ variant: "warn", title: "차트를 찾을 수 없음", body: "aha-scatter" });
      return;
    }
    downloadChartAsPNG(chartRef.current, "aha_scatter");
  };

  const actionCount = Object.keys(cache.groups || {}).length;
  const totalTargets = cache.results.length
    ? Math.round(cache.baseRate * cache.n)
    : 0;

  // 드릴다운 대상: 사용자가 고른 액션 or Top
  const drillTarget =
    drilldownAction && cache.results.some((r) => r.action === drilldownAction)
      ? drilldownAction
      : (topAction || {}).action || null;
  const drillResult = drillTarget
    ? cache.results.find((r) => r.action === drillTarget)
    : null;

  useEffect(() => {
    if (!hasData || !analyzed || !chartRef.current || !sortedResults.length) {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
      return;
    }

    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const byVal = (r) =>
      sortBy === "lift"
        ? r.lift == null
          ? 0
          : r.lift
        : sortBy === "precision"
          ? r.holdout.P
          : r.holdout.F1;
    const maxVal = Math.max(...sortedResults.map(byVal), 0.0001);
    const points = sortedResults.map((r) => {
      const lowSupport = r.holdout.support < minSupport;
      const intensity = Math.max(0.15, byVal(r) / maxVal);
      const color = lowSupport
        ? "rgba(148,163,184,0.35)"
        : `rgba(${Math.round(247 - intensity * 100)},${Math.round(113 + intensity * 100)},${Math.round(113 + intensity * 30)},0.85)`;
      return {
        x: r.holdout.R,
        y: r.holdout.P,
        r: Math.max(4, Math.min(22, Math.sqrt(r.holdout.support) * 1.4)),
        action: r.action,
        bestWindow: r.bestWindow,
        bestK: r.bestK,
        F1: r.holdout.F1,
        trainF1: r.train.F1,
        lift: r.lift,
        support: r.holdout.support,
        lowSupport,
        _color: color,
      };
    });

    chartInstance.current = new Chart(chartRef.current, {
      type: "bubble",
      data: {
        datasets: [
          {
            data: points,
            backgroundColor: points.map((p) => p._color),
            borderColor: "rgba(255,255,255,0.25)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: {
              display: true,
              text: "Recall",
              color: "var(--text-muted)",
            },
            min: 0,
            max: 1,
            ticks: { color: "var(--text-muted)" },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
          y: {
            title: {
              display: true,
              text: "Precision",
              color: "var(--text-muted)",
            },
            min: 0,
            max: 1,
            ticks: { color: "var(--text-muted)" },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const p = ctx.raw;
                if (!p) return [];
                const win = p.bestWindow === Infinity ? "전체" : "d" + p.bestWindow;
                return [
                  `${p.action} (Best Window ${win}, k≥${p.bestK})`,
                  `Precision ${p.y?.toFixed(3)} · Recall ${p.x?.toFixed(3)} · F1 ${p.F1?.toFixed(3)}`,
                  `Lift ${p.lift == null ? "—" : p.lift.toFixed(2) + "×"} · support ${p.support?.toLocaleString()}`,
                  `train F1 ${p.trainF1?.toFixed(3)}${p.lowSupport ? " · ⊘ 표본 부족" : ""}`,
                ];
              },
            },
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
  }, [hasData, analyzed, sortedResults, sortBy, minSupport, holdoutOn]);

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-aha">
        <section className="block" id="s-prep">
          <h2 className="section-title">데이터 준비</h2>
          <p className="muted" style={{ fontSize: "12px", marginBottom: "12px" }}>
            유저 1명당 1행. 각 후보 액션은 윈도우별 누적 count 컬럼 묶음(예: <code className="inline">invite_d0, invite_d3, invite_d7</code>) + 타겟 달성 여부 컬럼(0/1)이 필요합니다. 업로드 후 컬럼 역할(선행 행동·타겟)을 확인·수정합니다. 데이터는 브라우저 메모리에만 — 서버 전송 없음.
          </p>
          <div
            className="csv-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) handleAhaFile(e.dataTransfer.files[0]); }}
            onClick={() => ahaFileRef.current?.click()}
            style={{ cursor: "pointer" }}
          >
            <div className="csv-drop-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
            </div>
            <div className="csv-drop-text">CSV 파일 드래그 & 드롭</div>
            <div className="csv-drop-sub">또는 클릭하여 파일 선택</div>
            <input type="file" accept=".csv,text/csv" style={{ display: "none" }} ref={ahaFileRef}
              onChange={(e) => { if (e.target.files?.[0]) handleAhaFile(e.target.files[0]); e.target.value = null; }} />
          </div>
        </section>
      </div>
    );
  }

  const targetCol = cache.targetCol;
  const missing = [];
  if (!targetCol) missing.push("타겟(target, 0/1) 1개");
  if (!actionCount) missing.push("선행 행동(feature) 1개 이상");

  const showResults = missing.length === 0 && analyzed && cache.results.length > 0;

  return (
    <div className="tab-pane active" id="tab-aha">
      <section className="block" id="s-aha-map">
        <h2 className="section-title"><span className="ix">§0</span>컬럼 역할 매핑</h2>
        <div className="csv-loaded-bar">
          <div className="csv-loaded-info">
            <span className="dot" style={{ background: "#22c55e" }}></span>
            <strong>{csvData.fileName || "data.csv"}</strong>
            <span className="csv-loaded-stats tnum">
              {csvData.raw.length.toLocaleString()}행 · {headers.length}컬럼 · 후보 액션 {actionCount}개
            </span>
          </div>
        </div>
        <details open={!analyzed} style={{ marginTop: "10px" }}>
          <summary style={{ cursor: "pointer", fontSize: "12.5px", fontWeight: 600, color: analyzed ? "var(--text-muted)" : "#adc6ff" }}>🗂 컬럼 역할 매핑 {analyzed ? "(분석 완료 — 펼쳐서 수정)" : "(자동 추정 — 틀리면 수정)"}</summary>
          <p className="muted" style={{ fontSize: "12px", margin: "8px 0" }}>
            <strong>헤더가 <code className="inline">{"{action}_d{N}"}</code> 형태면 액션·윈도우가 자동 파싱</strong>됩니다(예: <code className="inline">invite_d7</code> → 액션 invite, 윈도우 d7). target 컬럼은 0/1 값으로 자동 추정 — 틀리면 직접 선택하세요. <code className="inline">revenue_d7</code> 같은 매출 컬럼이 잘못 후보로 잡혔으면 &quot;사용 안 함&quot;으로 제외하세요.
          </p>
          <div className="table-wrap" style={{ marginTop: "8px" }}>
            <table className="data" style={{ fontSize: "12px" }}>
              <thead><tr><th>CSV 컬럼</th><th>역할</th><th>액션명</th><th>윈도우</th></tr></thead>
              <tbody>
                {headers.map((h) => {
                  const def = colMap[h] || { role: "ignore", action: h, window: Infinity };
                  const isFeature = def.role === "feature";
                  const winLabel = def.window === Infinity ? "" : `d${def.window}`;
                  return (
                    <tr key={h}>
                      <td title={h}>{h}</td>
                      <td>
                        <select
                          className="map-select"
                          value={def.role}
                          onChange={(e) => setRole(h, e.target.value)}
                        >
                          {AHA_ROLE_OPTIONS.map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {isFeature ? (
                          <input
                            key={`${seedKey}|act|${h}`}
                            type="text"
                            className="map-select"
                            style={{ width: "120px" }}
                            defaultValue={def.action || ""}
                            placeholder="액션명"
                            onBlur={(e) => setAction(h, e.target.value)}
                          />
                        ) : "—"}
                      </td>
                      <td>
                        {isFeature ? (
                          <input
                            key={`${seedKey}|win|${h}`}
                            type="text"
                            className="map-select"
                            style={{ width: "70px" }}
                            defaultValue={winLabel}
                            placeholder="d7"
                            title="비우면 단일 윈도우(전체)"
                            onBlur={(e) => setWindow(h, e.target.value)}
                          />
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
        {missing.length > 0 ? (
          <div className="required-banner" style={{ marginTop: "12px" }}>
            <strong>⚠ 필수 역할이 비어 있습니다</strong>
            <p style={{ margin: ".25rem 0 0" }}>
              {missing.map((m) => (
                <code key={m} className="inline" style={{ marginRight: "6px" }}>{m}</code>
              ))}
            </p>
          </div>
        ) : analyzed ? (
          <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ color: "#22c55e", fontSize: "12px", fontWeight: 600 }}>✓ 분석 완료</span>
            <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>매핑을 바꾸면 결과가 숨겨지고 다시 &quot;분석하기&quot;를 눌러야 합니다.</span>
            <button className="ab-pill" style={{ marginLeft: "auto" }} onClick={() => setAnalyzedSig(ahaAnalyzeSig(colMap, fileName))}>↻ 다시 분석</button>
          </div>
        ) : (
          <div style={{ marginTop: "12px", background: "linear-gradient(135deg,rgba(122,162,247,0.12),rgba(122,162,247,0.03))", border: "1px solid rgba(122,162,247,0.3)", borderRadius: "10px", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ fontSize: "12.5px", color: "var(--text-1)" }}>✅ 필수 역할 매핑 완료. <strong>매핑이 맞는지 확인한 뒤 분석을 실행하세요.</strong></div>
            <button className="ab-pill" style={{ background: "#7aa2f7", color: "#0b0d12", fontWeight: 700, borderColor: "#7aa2f7", fontSize: "13px", padding: "8px 18px" }} onClick={() => setAnalyzedSig(ahaAnalyzeSig(colMap, fileName))}>▶ 분석하기</button>
          </div>
        )}
      </section>

      {showResults && (
        <>
          <section className="block" id="s-aha-hero" style={{ background: "linear-gradient(135deg, rgba(122,162,247,0.12), rgba(192,132,252,0.05))", border: "1px solid rgba(122,162,247,0.25)", borderRadius: "14px", padding: "18px 20px" }}>
            <h2 className="section-title" style={{ marginTop: 0 }}><span className="ix">§0</span>한눈에 보기</h2>
            <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "10px" }}>
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>전체 유저</div>
                <div className="tnum" style={{ fontSize: "20px", fontWeight: 700 }}>{cache.n.toLocaleString()}</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>타겟 달성 유저</div>
                <div className="tnum" style={{ fontSize: "20px", fontWeight: 700 }}>{totalTargets.toLocaleString()}</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Base Rate</div>
                <div className="tnum" style={{ fontSize: "20px", fontWeight: 700 }}>{(cache.baseRate * 100).toFixed(1)}%</div>
              </div>
            </div>
            <div style={{ fontSize: "13.5px", color: "var(--text-1)", marginBottom: "10px" }}>
              🏆 Top Aha:{" "}
              {topAction ? (
                <span
                  dangerouslySetInnerHTML={{
                    __html: `가입 <strong>${topAction.bestWindow === Infinity ? "전체" : topAction.bestWindow + "일"}</strong> 내 <strong>${escapeHtml(topAction.action)}</strong>를 <strong>${topAction.bestK}번</strong> 이상 → holdout F1 <strong>${topAction.holdout.F1.toFixed(2)}</strong>, lift <strong>${topAction.lift == null ? "—" : topAction.lift.toFixed(1) + "배"}</strong> ${confidenceDots(topAction.holdout.F1)}`,
                  }}
                />
              ) : (
                "분석 가능한 액션이 없습니다 — 매핑을 확인하세요."
              )}
            </div>
            <div className="callout warn" style={{ margin: 0 }}>
              <div className="ico">⚠</div>
              <div className="body">
                <strong>연관(association)이지 인과 아님</strong>
                <p style={{ margin: ".25rem 0 0" }}>engaged 유저는 모든 액션을 많이 하는 경향(공통원인)이 있어, 어떤 액션이 타겟 달성을 &quot;유발&quot;한다고 단정할 수 없습니다. 이 도구는 가설 생성용입니다 — 확정은{" "}
                  <a
                    href={idToSlug["5-4"] || "/tools/experiment-analysis"}
                    onClick={(e) => {
                      e.preventDefault();
                      router.push(idToSlug["5-4"] || "/tools/experiment-analysis");
                    }}
                    style={{ color: "#adc6ff", textDecoration: "underline", cursor: "pointer" }}
                  >
                    홀드아웃 실험(5-4)
                  </a>
                  으로 검증하세요.</p>
              </div>
            </div>
          </section>

          <section className="block" id="s-aha-controls">
            <h2 className="section-title"><span className="ix">§1</span>컨트롤</h2>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>정렬:</span>
                <button className={`ab-pill ${sortBy === "f1" ? "active" : ""}`} onClick={() => setSortBy("f1")}>F1</button>
                <button className={`ab-pill ${sortBy === "lift" ? "active" : ""}`} onClick={() => setSortBy("lift")}>Lift</button>
                <button className={`ab-pill ${sortBy === "precision" ? "active" : ""}`} onClick={() => setSortBy("precision")}>Precision</button>
              </div>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>최소 표본(support):</span>
                <input type="number" min="1" step="1" value={minSupport} onChange={(e) => setMinSupport(Number(e.target.value))} style={{ width: "70px" }} className="map-select" />
              </div>
              <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "12px", color: "var(--text-muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={holdoutOn} onChange={(e) => setHoldoutOn(e.target.checked)} /> Train/Holdout 50:50 split
              </label>
            </div>
            <p className="muted" style={{ fontSize: "11.5px", marginTop: "8px" }}>윈도우는 그리드에서 자동 선택됩니다. 기본적으로 train에서 k를 고르고 holdout에서 재평가해 낙관 편향(overfitting)을 줄입니다.</p>
          </section>

          <section className="block" id="s-aha-scatter">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <h2 className="section-title" style={{ margin: 0 }}><span className="ix">§2</span>Aha Scatter (Precision × Recall)</h2>
              <button className="ab-pill" onClick={handleScatterPng}>⬇ PNG</button>
            </div>
            <p className="muted">X=Recall, Y=Precision, 점 크기 = 표본(support), 색 = F1(또는 정렬기준). 표본 부족(&lt;{minSupport}) 액션은 회색·반투명입니다.</p>
            <div className="chart-container" style={{ height: "380px" }}>
              <canvas ref={chartRef}></canvas>
            </div>
          </section>

          <section className="block" id="s-aha-table">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <h2 className="section-title" style={{ margin: 0 }}><span className="ix">§3</span>결과 표</h2>
              <button className="ab-pill" onClick={() => downloadAhaCsv(sortedResults)} disabled={sortedResults.length === 0}>⬇ CSV</button>
            </div>
            <p className="muted" style={{ fontSize: "11.5px" }}>행을 클릭하면 §4 윈도우×k 히트맵에서 그 액션을 드릴다운합니다. 초록 lift = 강한 연관(≥1.5×). 빨강 F1 = train≫holdout(과적합 의심).</p>
            <div className="table-wrap">
              <table className="data" style={{ fontSize: "12.5px" }}>
                <thead><tr><th>액션</th><th title="가장 강한 연관을 보인 관측 기간">최적 윈도우</th><th title="그 기간 내 최소 실행 횟수 (≥k)">기준 횟수</th><th title="홀드아웃 F1 = 정밀도·재현율 조화평균">홀드아웃 F1</th><th title="Precision — 조건 충족 유저 중 실제 타겟 달성 비율">정밀도</th><th title="Recall — 타겟 달성 유저 중 조건 충족 비율">재현율</th><th title="Lift — base rate 대비 정밀도 배수">Lift</th><th title="조건 충족 유저 수">표본</th><th title="학습셋 F1 (홀드아웃과 큰 차이 = 과적합)">학습 F1</th></tr></thead>
                <tbody>
                  {sortedResults.length === 0 ? (
                    <tr><td colSpan="9" style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>분석 가능한 액션이 없습니다</td></tr>
                  ) : (
                    sortedResults.map((r) => {
                      const lowSupport = r.holdout.support < minSupport;
                      const overfit = r.train.F1 - r.holdout.F1 > 0.2;
                      const liftStrong = r.lift != null && r.lift >= 1.5;
                      return (
                        <tr
                          key={r.action}
                          onClick={() => setDrilldownAction(r.action)}
                          style={{ cursor: "pointer", color: lowSupport ? "var(--text-muted)" : undefined }}
                        >
                          <td>{r.action}{lowSupport ? " ⊘" : ""}</td>
                          <td className="tnum">{r.bestWindow === Infinity ? "전체" : "d" + r.bestWindow}</td>
                          <td className="tnum">≥{r.bestK}</td>
                          <td className="tnum" style={{ color: overfit ? "#f87171" : undefined }}>{r.holdout.F1.toFixed(3)}</td>
                          <td className="tnum">{r.holdout.P.toFixed(3)}</td>
                          <td className="tnum">{r.holdout.R.toFixed(3)}</td>
                          <td className="tnum" style={{ color: liftStrong ? "#22c55e" : undefined, fontWeight: liftStrong ? 600 : undefined }}>{r.lift == null ? "—" : r.lift.toFixed(2) + "×"}</td>
                          <td className="tnum">{r.holdout.support.toLocaleString()}{lowSupport ? " ⊘" : ""}</td>
                          <td className="tnum">{r.train.F1.toFixed(3)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="block" id="s-aha-drill">
            <h2 className="section-title"><span className="ix">§4</span>액션 드릴다운{drillTarget ? ` — ${drillTarget}` : ""}</h2>
            <p className="muted">윈도우 × k 그리드의 F1 히트맵. 진할수록 F1 높음, 굵은 테두리 = Best 조합. <strong>단일 셀만 튀고 주변이 흐리면 우연(과적합) 의심</strong> — support·holdout F1을 §3에서 같이 확인하세요.</p>
            {drillResult && cache.results.length > 0 && (
              <div style={{ marginBottom: "8px" }}>
                <select className="map-select" value={drillTarget} onChange={(e) => setDrilldownAction(e.target.value)}>
                  {cache.results.map((x) => (
                    <option key={x.action} value={x.action}>{x.action}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="table-wrap">
              {(() => {
                if (!drillResult || !drillResult.grid.length) {
                  return (
                    <table className="data" style={{ fontSize: "12px" }}>
                      <thead><tr><th>k \ window</th></tr></thead>
                      <tbody>
                        <tr><td colSpan="1" style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>선택된 액션이 없습니다</td></tr>
                      </tbody>
                    </table>
                  );
                }
                const grid = drillResult.grid;
                const windows = [...new Set(grid.map((g) => g.window))].sort((a, b) => a - b);
                const ks = [...new Set(grid.map((g) => g.k))].sort((a, b) => a - b);
                const cellFor = (w, k) => grid.find((g) => g.window === w && g.k === k);
                const maxF1 = Math.max(...grid.map((g) => g.F1), 0.0001);
                return (
                  <table className="data" style={{ fontSize: "12px" }}>
                    <thead>
                      <tr>
                        <th>k \ window</th>
                        {windows.map((w) => (
                          <th key={w} className="tnum">{w === Infinity ? "전체" : "d" + w}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ks.map((k) => (
                        <tr key={k}>
                          <td className="tnum">≥{k}</td>
                          {windows.map((w) => {
                            const cell = cellFor(w, k);
                            if (!cell) return <td key={w} className="tnum" style={{ color: "var(--text-muted)" }}>—</td>;
                            const isBest = cell.window === drillResult.bestWindow && cell.k === drillResult.bestK;
                            const intensity = Math.round((cell.F1 / maxF1) * 100);
                            return (
                              <td
                                key={w}
                                className="tnum"
                                style={{
                                  background: `rgba(122,162,247,${((intensity / 100) * 0.45).toFixed(2)})`,
                                  outline: isBest ? "2px solid #7aa2f7" : undefined,
                                  fontWeight: isBest ? 700 : undefined,
                                }}
                              >
                                {cell.F1.toFixed(2)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
