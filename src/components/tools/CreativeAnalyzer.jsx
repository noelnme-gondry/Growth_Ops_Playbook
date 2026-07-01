"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useAppStore } from "@/store/useDataStore";
import { CREATIVE_FATIGUE, CREATIVE_STATS } from "@/utils/creativeMath";
import { getMappedRows } from "@/utils/dashboardAggregator";
import { downloadChartAsPNG } from "@/utils/chartUtils";
import CsvUploader from "@/components/CsvUploader";
import Chart from "chart.js/auto";

// 소재 분석 설정 (index.html CREATIVE_CONFIG 이식 — 순수 config, 엔진에 파라미터로 주입)
const CREATIVE_CONFIG = {
  version: "1.0.0",
  seed: 42,
  decimalPlaces: 4,
  minImpressions: 1000,
  minNCell: 5,
  decompose: {
    // index.html: ctr/cpa/roas. v2는 B1이 추가한 cvr까지 계산(회귀 방지) — 토글은 결과 있는 것만 노출.
    metrics: ["ctr", "cvr", "cpa", "roas"],
    controls: ["channel", "iso_week"],
    method: "wls",
    vifThreshold: 5.0,
    vifDropPriority: ["duration_bucket", "has_text_overlay"],
    alpha: 0.05,
    multipleTesting: "bh",
  },
  fatigue: { decayWindow: 7, dropPct: 0.2 },
  fatigueAlert: {
    minDays: 7,
    trendWindow: 14,
    ctrWeight: 0.45,
    freqWeight: 0.35,
    cpmWeight: 0.2,
    alertScore: 0.5,
    horizonDays: 30,
  },
  autoPlanner: {
    defaultWeeklyVelocity: 3,
    urgentDays: 7,
    soonDays: 21,
  },
  matrix: { rows: "message_angle", cols: "format" },
  bayes: { priorA: 1, priorB: 1, gridN: 2000, promoteProb: 0.95, killProb: 0.05 },
  test: { exploreRatio: 0.3, batchSize: 6, power: 0.8, alpha: 0.05 },
};

// Concept Matrix 셀 status → 색·라벨 (index.html renderCreativeMatrix 이식)
const MATRIX_STATUS_COLOR = {
  validated: "rgba(34,197,94,0.20)",
  promising: "rgba(251,191,36,0.20)",
  insufficient: "rgba(248,113,113,0.12)",
  empty: "rgba(255,255,255,0.03)",
};
const MATRIX_STATUS_LABEL = {
  validated: "검증",
  promising: "유망",
  insufficient: "부족",
  empty: "미관측",
};

// Next-Test 유형 아이콘·라벨 (index.html renderCreativeNextTest 이식)
const NEXT_TEST_ICON = { explore: "🔍", exploit: "🎯", kill: "❌" };
const NEXT_TEST_LABEL = { explore: "탐색", exploit: "최적화", kill: "제거" };

// Auto-Planner 긴급도 색·라벨 (index.html renderCreativeAutoPlanner 이식)
const URGENCY_COLOR = { urgent: "#f87171", soon: "#fbbf24", planned: "#60a5fa" };
const URGENCY_LABEL = { urgent: "긴급", soon: "곧", planned: "예정" };

// Next-test 가설 생성 (index.html generateNextTestHypotheses page-level 이식)
function generateNextTestHypotheses(matrix, decompose) {
  const hyps = [];
  for (const row of matrix.grid) {
    for (const cell of row) {
      if (cell.status === "empty") {
        hyps.push({
          type: "explore",
          cell: `${cell.row} × ${cell.col}`,
          arms: 2,
          rationale: "관측 데이터 없음 — 신규 컨셉 탐색",
          sampleSize: CREATIVE_STATS.sampleSize({ p0: 0.02, mde: 0.005 }) || 5000,
          gates: ["impressions ≥ minImpressions × 3", "stage 1 CTR p < 0.05"],
        });
      } else if (cell.status === "promising" && cell.ctr) {
        hyps.push({
          type: "exploit",
          cell: `${cell.row} × ${cell.col}`,
          arms: 2,
          rationale: `n=${cell.n}, 추가 변형으로 효과 확정 필요`,
          sampleSize:
            CREATIVE_STATS.sampleSize({
              p0: cell.ctr || 0.02,
              mde: (cell.ctr || 0.02) * 0.2,
            }) || 5000,
          gates: ["BH-adjusted p < 0.05", "P(B>A) ≥ 0.95"],
        });
      }
    }
  }
  for (const [m, res] of Object.entries(decompose || {})) {
    for (const e of res.effects || []) {
      if (e.pAdj < 0.05 && e.coef < 0) {
        hyps.push({
          type: "kill",
          cell: `${e.factor}=${e.level}`,
          arms: 0,
          rationale: `${m} 음의 효과 (β=${e.coef.toFixed(4)}, p=${e.pAdj.toFixed(4)})`,
          gates: ["다음 라운드에서 해당 attribute 제외"],
        });
      }
    }
  }
  return hyps.slice(0, CREATIVE_CONFIG.test.batchSize);
}

// 운영 건강도 (Win-rate·Velocity·라이프사이클) 계산 — index.html renderCreativeVelocity 이식
function computeCreativeHealth(metrics, fatigue, rows) {
  if (!metrics || !metrics.length) return null;
  const minImp = CREATIVE_CONFIG.minImpressions;
  const median = (arr) => {
    const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const elig = metrics.filter((m) => (m.impressions || 0) >= minImp);
  const medCtr = median(elig.map((m) => m.ctr));
  const medCvr = median(elig.map((m) => m.cvr));
  const ctrWinners = elig.filter(
    (m) => m.ctr != null && medCtr != null && m.ctr > medCtr,
  );
  const cvrWinners = elig.filter(
    (m) => m.cvr != null && medCvr != null && m.cvr > medCvr,
  );
  const totalSpend = metrics.reduce((s, m) => s + (m.spend || 0), 0);
  const winnerSpend = ctrWinners.reduce((s, m) => s + (m.spend || 0), 0);

  const withLife = (fatigue || []).filter((f) => f.lifespanDays != null);
  const avgLife = withLife.length
    ? withLife.reduce((s, f) => s + f.lifespanDays, 0) / withLife.length
    : null;
  const fatiguedN = (fatigue || []).filter((f) => f.fatigued).length;

  // Velocity: creative_id별 첫 등장일 → ISO주별 신규 소재 수
  const firstDate = new Map();
  for (const r of rows) {
    if (!r.creative_id || !r.date) continue;
    const cur = firstDate.get(r.creative_id);
    if (!cur || r.date < cur) firstDate.set(r.creative_id, r.date);
  }
  const weekCount = new Map();
  for (const d of firstDate.values()) {
    const wk = CREATIVE_STATS.isoWeek(d);
    weekCount.set(wk, (weekCount.get(wk) || 0) + 1);
  }
  const weeks = [...weekCount.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const avgPerWeek = weeks.length
    ? [...weekCount.values()].reduce((a, b) => a + b, 0) / weeks.length
    : 0;

  return {
    minImp,
    medCvr,
    eligN: elig.length,
    ctrWinnersN: ctrWinners.length,
    cvrWinnersN: cvrWinners.length,
    winnerSpend,
    totalSpend,
    avgPerWeek,
    weeksN: weeks.length,
    avgLife,
    fatiguedN,
    fatigueN: (fatigue || []).length,
  };
}

// decompose 지표별 표시 메타 (index.html decomposeMetricMeta 이식 — ctr/cvr만)
const DECOMPOSE_META = {
  ctr: {
    label: "CTR",
    desc: "클릭률(CTR)",
    weightLabel: "노출수(impressions)",
    betterWhenHigher: true,
    axisUnit: "%p",
    chartScale: (v) => v * 100,
    axisTick: (v) => v.toFixed(2) + "%p",
    fmtVal: (v) =>
      v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%p",
  },
  cvr: {
    label: "CVR",
    desc: "전환율(CVR)",
    weightLabel: "클릭수(clicks)",
    betterWhenHigher: true,
    axisUnit: "%p",
    chartScale: (v) => v * 100,
    axisTick: (v) => v.toFixed(2) + "%p",
    fmtVal: (v) =>
      v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%p",
  },
  cpa: {
    label: "CPA",
    desc: "획득당 비용(CPA)",
    weightLabel: "액션수(actions)",
    betterWhenHigher: false,
    axisUnit: "원",
    chartScale: (v) => v,
    axisTick: (v) => Math.round(v).toLocaleString(),
    fmtVal: (v) =>
      v == null || !isFinite(v)
        ? "—"
        : (v >= 0 ? "+" : "−") + Math.round(Math.abs(v)).toLocaleString() + "원",
  },
  roas: {
    label: "ROAS",
    desc: "광고비 대비 매출(ROAS)",
    weightLabel: "지출액(spend)",
    betterWhenHigher: true,
    axisUnit: "배",
    chartScale: (v) => v,
    axisTick: (v) => v.toFixed(2),
    fmtVal: (v) =>
      v == null || !isFinite(v)
        ? "—"
        : (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(3) + "배",
  },
};

function decomposeEffectIsGood(coef, meta) {
  return meta.betterWhenHigher ? coef > 0 : coef < 0;
}

// 결정론 hash (FNV-1a 32-bit) — snapshotHash 생성용 (index.html creativeHashStr 이식).
function creativeHashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// §3 지표 CSV export (index.html exportCreativeMetricsCSV 이식 — BOM + q() 이스케이프).
function exportCreativeMetricsCSV(metrics, snapshotHash, version) {
  if (typeof document === "undefined" || !metrics || !metrics.length) return;
  const lines = [
    `# 소재 분석 · Metrics Export`,
    `# Generated,${new Date().toISOString()}`,
    `# Snapshot,${snapshotHash}`,
    `# Config version,${version}`,
    "",
    "creative_id,channel,campaign_id,days,impressions,clicks,installs,actions,spend,ctr,cvr,ipm,cpi,cpa,hook_rate,completion,roas,hook_type,message_angle,first_3s,format,has_text_overlay,cta_style,duration_bucket",
  ];
  for (const m of metrics) {
    lines.push(
      [
        m.creative_id,
        m.channel || "",
        m.campaign_id || "",
        m.days,
        m.impressions,
        m.clicks,
        m.installs,
        m.actions,
        m.spend,
        m.ctr != null ? m.ctr.toFixed(6) : "",
        m.cvr != null ? m.cvr.toFixed(6) : "",
        m.ipm != null ? m.ipm.toFixed(4) : "",
        m.cpi != null ? m.cpi.toFixed(2) : "",
        m.cpa != null ? m.cpa.toFixed(2) : "",
        m.hook_rate != null ? m.hook_rate.toFixed(6) : "",
        m.completion != null ? m.completion.toFixed(6) : "",
        m.roas != null ? m.roas.toFixed(4) : "",
        m.hook_type || "",
        m.message_angle || "",
        m.first_3s || "",
        m.format || "",
        m.has_text_overlay || "",
        m.cta_style || "",
        m.duration_bucket || "",
      ]
        .map((v) =>
          /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v,
        )
        .join(","),
    );
  }
  const blob = new Blob(["﻿" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `creative_metrics_${snapshotHash}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function fmtNum(v, d = 4) {
  return v == null || !isFinite(v) ? "—" : v.toFixed(d);
}
function fmtPct(v) {
  return v == null || !isFinite(v) ? "—" : (v * 100).toFixed(2) + "%";
}
function fmtPctDay(v) {
  return v == null || !isFinite(v)
    ? "—"
    : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%/일";
}

export default function CreativeAnalyzer() {
  const csvData = useAppStore((state) => state.csvData);
  const [metric, setMetric] = useState("ctr");
  // §8 Concept Matrix 셀 클릭 → §2 성과표 필터 (index CREATIVE_STATE.selectedCell)
  const [selectedCell, setSelectedCell] = useState(null); // {row, col} | null
  // §7 Auto-Planner: 주당 신규 소재 공급량 + Gantt 표시 주수
  const [weeklyVelocity, setWeeklyVelocity] = useState(
    CREATIVE_CONFIG.autoPlanner.defaultWeeklyVelocity,
  );
  const ganttWeeks = 8;

  const fatigueChartRef = useRef(null);
  const conceptChartRef = useRef(null);
  const chartInstances = useRef({});

  const hasData = csvData?.raw?.length > 0;

  // 매핑된 표준 필드 키 감지 (§8: 없는 컬럼은 하위 분석 숨김, crash X)
  const mappedKeys = useMemo(
    () =>
      new Set(
        Object.values(csvData?.mapping || {}).filter((v) => v && v !== "__ignore__"),
      ),
    [csvData],
  );
  const hasCvrInputs = mappedKeys.has("clicks") && mappedKeys.has("installs");
  // CPA=spend/actions, ROAS=revenue_d7/spend — 각자 분모 컬럼 매핑돼야 의미. spend는 cost 별칭.
  const hasSpend = mappedKeys.has("spend") || mappedKeys.has("cost");
  const hasCpaInputs = hasSpend && mappedKeys.has("actions");
  const hasRoasInputs = hasSpend && mappedKeys.has("revenue_d7");

  // === REAL 엔진 파이프라인 (index.html buildCreativeCache 이식) ===
  const analysis = useMemo(() => {
    if (!hasData) return null;
    const rows = getMappedRows(csvData);
    const validation = { errors: [], droppedRows: 0 };
    const cleanRows = [];
    for (const r of rows) {
      if (!r.creative_id || !r.date) {
        validation.droppedRows++;
        continue;
      }
      const imp = Number(r.impressions) || 0;
      const clk = Number(r.clicks) || 0;
      if (imp < 0 || clk < 0) {
        validation.errors.push(`음수 값: creative_id=${r.creative_id} date=${r.date}`);
        validation.droppedRows++;
        continue;
      }
      if (clk > imp) {
        validation.errors.push(
          `clicks > impressions: ${r.creative_id} ${r.date} (${clk}/${imp})`,
        );
      }
      cleanRows.push(r);
    }

    const metrics = CREATIVE_STATS.deriveMetrics(cleanRows);

    // 소재 속성 컬럼 자동 감지
    const activeAttrs = [
      "hook_type",
      "message_angle",
      "first_3s",
      "format",
      "has_text_overlay",
      "cta_style",
      "duration_bucket",
    ].filter((a) => cleanRows.some((r) => r[a] != null && r[a] !== ""));

    // WLS 속성별 효과 분해 (ctr/cvr, 데이터 있을 때만)
    const decompose = {};
    if (activeAttrs.length > 0 && cleanRows.length >= 30) {
      for (const m of CREATIVE_CONFIG.decompose.metrics) {
        decompose[m] = CREATIVE_STATS.decompose(
          cleanRows,
          { metric: m, attributes: activeAttrs },
          CREATIVE_CONFIG,
        );
      }
    }

    const fatigue = CREATIVE_STATS.fatigueDetect(cleanRows, "ctr", CREATIVE_CONFIG);
    const fatigueAlerts = CREATIVE_FATIGUE.buildAlerts(
      cleanRows,
      CREATIVE_CONFIG.fatigueAlert,
    );

    // §2 운영 건강도 (Win-rate · Velocity · 라이프사이클)
    const health = computeCreativeHealth(metrics, fatigue, cleanRows);

    // §8 Concept Matrix (기본 axes message_angle × format) — 양 축 매핑 시에만
    const axesCfg = CREATIVE_CONFIG.matrix;
    const hasRow = metrics.some((m) => m[axesCfg.rows]);
    const hasCol = metrics.some((m) => m[axesCfg.cols]);
    const matrix =
      hasRow && hasCol
        ? CREATIVE_STATS.conceptMatrix(metrics, axesCfg, CREATIVE_CONFIG)
        : null;

    // §9 다음 테스트 후보 (matrix 기반)
    const nextTest = matrix ? generateNextTestHypotheses(matrix, decompose) : null;

    // 결정론 snapshot hash (매핑 시그 + 행 수 + config version) — export/칩 표시용.
    const mapping = csvData?.mapping || {};
    const sig = Object.entries(mapping)
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join("|");
    const snapshotHash = creativeHashStr(
      `${sig}|${cleanRows.length}|cfg:${CREATIVE_CONFIG.version}`,
    );

    return {
      cleanRows,
      validation,
      metrics,
      activeAttrs,
      decompose,
      fatigue,
      fatigueAlerts,
      health,
      matrix,
      nextTest,
      snapshotHash,
    };
  }, [csvData, hasData]);

  // §7 Auto-Planner: weeklyVelocity(state)만 바뀌면 재계산 — 무거운 analysis는 재실행 X
  const autoPlan = useMemo(() => {
    if (!analysis) return null;
    return CREATIVE_FATIGUE.buildPlan(
      analysis.fatigueAlerts,
      weeklyVelocity,
      CREATIVE_CONFIG.autoPlanner,
    );
  }, [analysis, weeklyVelocity]);

  // decompose 결과가 없는 지표로 토글돼 있으면 ctr로 폴백
  const curMetricKey =
    analysis && analysis.decompose[metric] ? metric : "ctr";
  const curDecompose = analysis ? analysis.decompose[curMetricKey] : null;

  // === 차트 렌더 (REAL 데이터) ===
  useEffect(() => {
    if (!hasData || !analysis) return;

    if (chartInstances.current["fatigue"]) chartInstances.current["fatigue"].destroy();
    if (chartInstances.current["concept"]) chartInstances.current["concept"].destroy();

    // 1. Fatigue Decay Chart — 하락률 상위 5개 fatigued 소재의 일별 rolling CTR
    if (fatigueChartRef.current) {
      const fatigued = (analysis.fatigue || [])
        .filter((f) => f.fatigued)
        .sort((a, b) => b.dropPct - a.dropPct)
        .slice(0, 5);

      if (fatigued.length) {
        const byId = new Map();
        for (const r of analysis.cleanRows) {
          if (!r.creative_id || !r.date) continue;
          if (!byId.has(r.creative_id)) byId.set(r.creative_id, []);
          byId.get(r.creative_id).push(r);
        }
        const W = CREATIVE_CONFIG.fatigue.decayWindow;
        const palette = ["#adc6ff", "#22c55e", "#f87171", "#fbbf24", "#a78bfa"];
        const datasets = [];
        const allDateSet = new Set();
        fatigued.forEach((f, idx) => {
          const series = (byId.get(f.creative_id) || [])
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date));
          const vals = series.map((r) => CREATIVE_STATS.safeDiv(r.clicks, r.impressions));
          const rolling = vals.map((_, i) => {
            const start = Math.max(0, i - W + 1);
            const slice = vals
              .slice(start, i + 1)
              .filter((v) => v != null && isFinite(v));
            return slice.length
              ? (slice.reduce((a, b) => a + b, 0) / slice.length) * 100
              : null;
          });
          series.forEach((s) => allDateSet.add(s.date));
          const color = palette[idx % palette.length];
          datasets.push({
            label: `${String(f.creative_id).slice(0, 16)}`,
            data: series.map((s, i) => ({ x: s.date, y: rolling[i] })),
            borderColor: color,
            backgroundColor: color + "30",
            borderWidth: 1.8,
            pointRadius: 1.5,
            tension: 0.25,
          });
        });
        const labels = [...allDateSet].sort();
        chartInstances.current["fatigue"] = new Chart(fatigueChartRef.current, {
          type: "line",
          data: { labels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            plugins: {
              legend: { labels: { font: { size: 11 } } },
              tooltip: {
                callbacks: {
                  label: (c) =>
                    `${c.dataset.label}: ${c.parsed.y != null ? c.parsed.y.toFixed(2) + "%" : "—"}`,
                },
              },
            },
            scales: {
              x: { type: "category", ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
              y: { title: { display: true, text: "7d Rolling CTR (%)" } },
            },
          },
        });
      }
    }

    // 2. Forest Plot — decompose β + 95% CI (REAL)
    if (conceptChartRef.current && curDecompose && (curDecompose.effects || []).length) {
      const meta = DECOMPOSE_META[curMetricKey] || DECOMPOSE_META.ctr;
      const eff = [...curDecompose.effects].sort((a, b) => a.pAdj - b.pAdj);
      const sc = meta.chartScale;
      const labels = eff.map((e) => `${e.factor} = ${String(e.level).slice(0, 16)}`);
      const barData = eff.map((e) => [sc(e.ciLow), sc(e.ciHigh)]);
      const barColors = eff.map((e) => {
        if (e.pAdj < 0.05)
          return decomposeEffectIsGood(e.coef, meta) ? "#22c55eAA" : "#f87171AA";
        return "rgba(150,150,150,0.4)";
      });
      const pointData = eff.map((e, i) => ({ x: sc(e.coef), y: i }));

      chartInstances.current["concept"] = new Chart(conceptChartRef.current, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              type: "bar",
              label: "95% CI",
              data: barData,
              backgroundColor: barColors,
              borderWidth: 0,
              barThickness: 16,
            },
            {
              type: "scatter",
              label: "β (효과)",
              data: pointData,
              backgroundColor: "#ffffff",
              borderColor: "#000",
              pointRadius: 4,
              pointHoverRadius: 6,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (c) => {
                  const e = eff[c.dataIndex];
                  if (!e) return "";
                  return `β=${meta.fmtVal(e.coef)} · CI=[${meta.fmtVal(e.ciLow)}, ${meta.fmtVal(e.ciHigh)}] · BH-p=${e.pAdj.toFixed(4)} · n=${e.n}`;
                },
              },
            },
          },
          scales: {
            x: {
              title: {
                display: true,
                text: `${meta.label} 효과 (${meta.axisUnit}, 0 = 기준 level)`,
              },
              ticks: { callback: (v) => meta.axisTick(v) },
            },
          },
        },
      });
    }

    const currentCharts = chartInstances.current;
    return () => {
      if (currentCharts["fatigue"]) currentCharts["fatigue"].destroy();
      if (currentCharts["concept"]) currentCharts["concept"].destroy();
    };
  }, [analysis, hasData, curMetricKey, curDecompose]);

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-creative">
        <section className="block" id="s-prep">
          <h2 className="section-title">데이터 준비</h2>
          <div className="callout warning">
            <div className="ico">!</div>
            <div className="body">
              <strong>CSV 업로드 대기</strong>
              <p>소재 성과 데이터를 업로드하여 Fatigue와 Concept을 분석하세요.</p>
              <div style={{ marginTop: "1rem" }}>
                <CsvUploader toolId="5-6" />
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const { validation, metrics, decompose, fatigue, fatigueAlerts, health, matrix, nextTest, snapshotHash } =
    analysis;
  const hasValidationIssues = validation.errors.length > 0 || validation.droppedRows > 0;

  // §2 소재별 지표: Concept Matrix 필터 적용 후 노출수 내림차순 상위 50
  const rowAttr = CREATIVE_CONFIG.matrix.rows;
  const colAttr = CREATIVE_CONFIG.matrix.cols;
  const filteredMetrics = selectedCell
    ? metrics.filter(
        (m) => m[rowAttr] === selectedCell.row && m[colAttr] === selectedCell.col,
      )
    : metrics;
  const sortedMetrics = [...filteredMetrics]
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    .slice(0, 50);
  const pctOf = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(0) + "%" : "—");

  // §3 decompose effects (pAdj 오름차순)
  const decMeta = DECOMPOSE_META[curMetricKey] || DECOMPOSE_META.ctr;
  const effRows = curDecompose
    ? [...(curDecompose.effects || [])].sort((a, b) => a.pAdj - b.pAdj)
    : [];
  const hasDecompose = decompose && Object.keys(decompose).length > 0;

  // §4 fatigue (fatigued만, 하락률 내림차순 상위 30)
  const fatiguedRows = (fatigue || [])
    .filter((f) => f.fatigued)
    .sort((a, b) => b.dropPct - a.dropPct)
    .slice(0, 30);
  const fatiguedCount = (fatigue || []).filter((f) => f.fatigued).length;

  // §5 fatigue alert (score 내림차순 상위 30)
  const alertRows = (fatigueAlerts || [])
    .slice()
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, 30);
  const alertNowN = (fatigueAlerts || []).filter((a) => a.alert).length;

  return (
    <div className="tab-pane active" id="tab-creative">
      {/* 히어로 — index pageShell deck/chips/snapshot + 요약 불릿 + 방법론 fold 이식 */}
      <div className="hero" style={{ marginBottom: "16px" }}>
        <h1 className="hero-title">소재 분석 (Creative Analyzer)</h1>
        <p className="hero-subtitle">
          소재별 성과 한눈에 보기, 어떤 특징이 효과적인지 분석, 지치기 전에 교체 시점 알려주기
        </p>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "8px 0 4px" }}>
          <span className="chip"><span className="dot"></span>도구 · 소재 분석</span>
          <span className="chip ok"><span className="dot"></span>소재 {metrics.length}개</span>
          <span className="chip"><span className="dot"></span>config {CREATIVE_CONFIG.version} · snapshot {snapshotHash}</span>
        </div>
        <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", margin: "8px 0 0", lineHeight: 1.6 }}>
          소재(영상·이미지 등 광고 크리에이티브)별로 어떤 게 잘 되고 있는지, 왜 잘 되는지, 언제 새로 바꿔야 하는지를 한 곳에서 보여줍니다.
        </p>
        <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "12.5px", lineHeight: 1.7, color: "var(--text-secondary)" }}>
          <li><strong>어떤 소재가 이기고 있나</strong> — 승률·교체 속도·생존 기간 (Win-rate · Velocity)</li>
          <li><strong>어떤 특징이 효과적인가</strong> — 후킹 방식·포맷 등 속성별 효과 분석 (WLS 분해)</li>
          <li><strong>지금 지치고 있는 소재가 있나</strong> — 소재 피로도 진단과 교체 시점 추천 (Fatigue)</li>
          <li><strong>다음엔 뭘 테스트할까</strong> — 조합별 성과표 기반 다음 테스트 후보 추천</li>
        </ul>
        <details style={{ marginTop: "8px", fontSize: "11.5px", color: "var(--text-secondary)", cursor: "pointer" }}>
          <summary>⚠️ 통계 분석 및 해석 한계 펼치기</summary>
          <div style={{ marginTop: "6px", padding: "8px 10px", background: "var(--bg-1)", borderLeft: "3px solid var(--primary)", lineHeight: 1.6 }}>
            노출량 가중 최소제곱법(WLS)과 다중 검정 보정(BH)을 통해 크리에이티브 속성(Hook, Format 등)의 효과를 추정합니다. 본 분해 결과는 매체 알고리즘에 따른 노출 편향(Selection Bias)이 포함되어 있으므로 인과적 효과가 아닌 상관 관계로 해석해야 하며, 최종 확정은 실험 도구(5-4)를 통해 검증하시는 것을 권장합니다.
          </div>
        </details>
      </div>

      <details className="block" id="s-prep" style={{ padding: "13px 16px" }}>
        <summary style={{ cursor: "pointer", fontSize: "12.5px", fontWeight: 600, color: "var(--text-muted)", outline: "none" }}>🗂 데이터 매핑 설정 (펼쳐서 변경)</summary>
        <div style={{ marginTop: "10px" }}>
          <CsvUploader toolId="5-6" />
        </div>
      </details>

      <section className="block" id="s-validation">
        <h2 className="section-title"><span className="ix">§1</span>검증</h2>
        {hasValidationIssues ? (
          <div className="callout warning">
            <div className="ico">!</div>
            <div className="body">
              <strong>{validation.droppedRows}개 row 제외 / {validation.errors.length}개 이슈</strong>
              {validation.errors.length > 0 && (
                <details style={{ marginTop: "6px" }}>
                  <summary style={{ cursor: "pointer", fontSize: "12px" }}>상세</summary>
                  <ul style={{ margin: "6px 0 0 18px", fontSize: "11px", color: "var(--text-muted)" }}>
                    {validation.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {validation.errors.length > 20 && <li>... +{validation.errors.length - 20}개</li>}
                  </ul>
                </details>
              )}
            </div>
          </div>
        ) : (
          <div className="callout ok">
            <div className="ico">✓</div>
            <div className="body">
              <strong>모든 row 통과</strong>
              <p>음수·grain 위반 없음.</p>
            </div>
          </div>
        )}
      </section>

      {health && (
        <section className="block" id="s-velocity">
          <h2 className="section-title"><span className="ix">§2</span>운영 건강도 (Win-rate · Velocity · 라이프사이클)</h2>
          <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
            소재 운영이 잘 되고 있는지 보는 3가지 질문 — 새 소재가 얼마나 자주 <strong>이기는지(이긴 비율, Win-rate)</strong>, 얼마나 빠르게 <strong>갈아끼우는지(교체 속도, Velocity)</strong>, 하나가 얼마나 <strong>오래 버티는지(생존 기간, 라이프사이클)</strong>.
          </p>
          <div className="ab-stat-row" style={{ margin: "8px 0 12px" }}>
            <div className="ab-stat">
              <div className="ab-stat-label" title="다른 소재들의 클릭률 중간값보다 잘 나온 소재 비율">클릭이 잘 되는 소재 비율 (CTR Win-rate)</div>
              <div className="ab-stat-value tnum">{pctOf(health.ctrWinnersN, health.eligN)}</div>
              <div className="ab-stat-hint">중앙값 초과 {health.ctrWinnersN}/{health.eligN} (≥{health.minImp.toLocaleString()} impr)</div>
            </div>
            <div className="ab-stat">
              <div className="ab-stat-label" title="다른 소재들의 전환율 중간값보다 잘 나온 소재 비율">전환이 잘 되는 소재 비율 (CVR Win-rate)</div>
              <div className="ab-stat-value tnum">{pctOf(health.cvrWinnersN, health.eligN)}</div>
              <div className="ab-stat-hint">중앙값 {fmtPct(health.medCvr)} 초과</div>
            </div>
            <div className="ab-stat">
              <div className="ab-stat-label">잘 되는 소재에 쓴 비용 비중</div>
              <div className="ab-stat-value tnum">{pctOf(health.winnerSpend, health.totalSpend)}</div>
              <div className="ab-stat-hint">CTR 승자 소재에 쓴 비용 비중</div>
            </div>
            <div className="ab-stat">
              <div className="ab-stat-label" title="한 주에 새로 등장한 소재 개수의 평균">한 주에 새로 올리는 소재 수 (Velocity)</div>
              <div className="ab-stat-value tnum">{health.avgPerWeek.toFixed(1)}</div>
              <div className="ab-stat-hint">{health.weeksN}주 평균</div>
            </div>
            <div className="ab-stat">
              <div className="ab-stat-label">소재 하나가 버티는 평균 기간</div>
              <div className="ab-stat-value tnum">{health.avgLife != null ? health.avgLife.toFixed(0) + "일" : "—"}</div>
            </div>
            <div className="ab-stat">
              <div className="ab-stat-label" title="성과가 떨어지며 지친 것으로 진단된 소재 비율">피로해진 소재 비율 (Fatigue)</div>
              <div className={`ab-stat-value tnum ${health.fatiguedN > 0 ? "neg" : "pos"}`}>{pctOf(health.fatiguedN, health.fatigueN)}</div>
              <div className="ab-stat-hint">{health.fatiguedN}/{health.fatigueN}</div>
            </div>
          </div>
          <div className="callout"><div className="ico">i</div><div className="body"><p style={{ margin: 0, fontSize: "12px" }}>
            <strong>이긴 비율(Win-rate)</strong>이 50%를 크게 밑돌면 소재 기획 적중률이 낮은 것 — 컨셉 다양화(§9 다음 테스트 추천) 필요.
            {" "}<strong>한 주에 새로 올리는 소재 수</strong>가 너무 적으면 지치는 소재를 못 따라잡습니다 (벤치마크: 활성 소재의 20~30% / 주).
            {" "}<strong>잘 되는 소재에 쓴 비용 비중</strong>이 낮으면 좋은 소재에 예산이 안 실리고 있다는 신호입니다.
          </p></div></div>
        </section>
      )}

      <section className="block" id="s-metrics">
        <h2 className="section-title"><span className="ix">§3</span>소재별 성과표 {selectedCell ? "(필터됨)" : "(상위 50, 노출수 순)"}</h2>
        <p className="muted" style={{ marginBottom: "6px", color: "var(--text-muted)", fontSize: "12px" }}>노출·클릭·설치 같은 원자료와, 클릭률·전환율·설치당비용 같은 계산된 효율 지표를 함께 봅니다. 약어 위에 마우스를 올리면 설명이 나옵니다.</p>
        {selectedCell && (
          <div className="callout" style={{ marginBottom: "8px" }}>
            <div className="ico">i</div>
            <div className="body">
              <strong>조합별 성과표(Concept Matrix) 필터 적용 중:</strong> {rowAttr}=<code className="inline">{selectedCell.row}</code> × {colAttr}=<code className="inline">{selectedCell.col}</code> ({filteredMetrics.length}개 소재)
              <button className="ab-pill" style={{ marginLeft: "8px" }} onClick={() => setSelectedCell(null)}>필터 해제</button>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table className="data" style={{ fontSize: "11.5px" }}>
            <thead>
              <tr>
                <th>Creative ID</th><th>Channel</th><th title="데이터가 존재하는 일수">Days</th>
                <th title="노출수 (Impressions)">Impr</th><th title="클릭수 (Clicks)">Clicks</th><th title="설치수 (Installs)">Inst</th><th title="지출 비용 (Spend)">Spend</th>
                <th title="클릭률 — 노출 대비 클릭 비율 (CTR)">CTR</th><th title="전환율 — 클릭 대비 설치 비율 (CVR)">CVR</th><th title="노출 1,000회당 설치수 (Installs Per Mille)">IPM</th><th title="설치 1건당 비용 (Cost Per Install)">CPI</th>
                <th title="3초 이상 시청 비율 (Hook Rate)">Hook %</th><th title="영상 완주율 (Completion Rate)">Comp %</th>
              </tr>
            </thead>
            <tbody>
              {sortedMetrics.length ? (
                sortedMetrics.map((m) => (
                  <tr key={m.creative_id}>
                    <td><code className="inline" style={{ fontSize: "10px" }}>{String(m.creative_id).slice(0, 24)}</code></td>
                    <td>{String(m.channel || "")}</td>
                    <td className="tnum">{m.days}</td>
                    <td className="tnum">{(m.impressions || 0).toLocaleString()}</td>
                    <td className="tnum">{(m.clicks || 0).toLocaleString()}</td>
                    <td className="tnum">{(m.installs || 0).toLocaleString()}</td>
                    <td className="tnum">{fmtNum(m.spend, 0)}</td>
                    <td className="tnum">{fmtPct(m.ctr)}</td>
                    <td className="tnum">{fmtPct(m.cvr)}</td>
                    <td className="tnum">{fmtNum(m.ipm, 2)}</td>
                    <td className="tnum">{fmtNum(m.cpi, 0)}</td>
                    <td className="tnum">{fmtPct(m.hook_rate)}</td>
                    <td className="tnum">{fmtPct(m.completion)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="13" style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>데이터가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ textAlign: "right", marginTop: "8px" }}>
          <button
            className="ab-pill"
            id="creative-export-metrics"
            onClick={() => exportCreativeMetricsCSV(metrics, snapshotHash, CREATIVE_CONFIG.version)}
          >
            ⬇ 지표 CSV 다운로드
          </button>
        </div>
      </section>

      <section className="block" id="s-decompose">
        <h2 className="section-title"><span className="ix">§4</span>어떤 특징이 효과적인가 (속성별 효과 분석 · WLS 분해)</h2>
        {hasDecompose ? (
          <>
            <p className="muted" style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 6px" }}>
              후킹 방식·메시지 콘셉트·포맷 같은 소재 속성이 <strong>{decMeta.desc}</strong>에 실제로 영향을 주는지 통계적으로 분석합니다. 아래 버튼으로 분석 기준 지표(CTR·CVR·CPA·ROAS)를 바꿀 수 있습니다.
            </p>
            <details style={{ marginBottom: "8px", fontSize: "11.5px", color: "var(--text-muted)", cursor: "pointer" }}>
              <summary>어떻게 계산하나요? (분석 방법 펼치기)</summary>
              <div style={{ marginTop: "6px", padding: "8px 10px", background: "var(--bg-1)", borderLeft: "3px solid var(--primary)", lineHeight: 1.6 }}>
                {decMeta.weightLabel}로 가중한 선형회귀(weighted least squares)로 {decMeta.desc}를 추정하며, 캠페인별 차이는 자동으로 보정합니다(campaign_id within-transformation). 가중치를 {decMeta.weightLabel}로 두는 이유는 분모가 큰(=추정이 정밀한) 소재에 더 큰 비중을 주기 위함입니다. 여러 속성을 동시에 검정하므로 다중검정 보정(BH)을 적용합니다.
                {" "}⚠ 실제 운영 데이터를 관찰해서 분석한 결과라 매체 알고리즘의 노출 편향(selection bias)이 섞여 있을 수 있습니다 — 상관관계로만 참고하고, 확정은 실험 분석 도구(5-4)로 검증하는 것을 권장합니다.
              </div>
            </details>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
              <div className="ab-pillgroup">
                <span className="ab-pillgroup-label">분석 기준 지표</span>
                <button className={`ab-pill ${curMetricKey === "ctr" ? "active" : ""}`} onClick={() => setMetric("ctr")}>CTR</button>
                <button
                  className={`ab-pill ${curMetricKey === "cvr" ? "active" : ""}`}
                  disabled={!decompose.cvr || !hasCvrInputs}
                  title={!decompose.cvr || !hasCvrInputs ? "clicks·installs 컬럼 매핑 + 데이터 30행 이상 필요" : ""}
                  style={{ opacity: !decompose.cvr || !hasCvrInputs ? 0.4 : 1 }}
                  onClick={() => setMetric("cvr")}
                >
                  CVR
                </button>
                <button
                  className={`ab-pill ${curMetricKey === "cpa" ? "active" : ""}`}
                  disabled={!decompose.cpa || !hasCpaInputs}
                  title={!decompose.cpa || !hasCpaInputs ? "spend(또는 cost)·actions 컬럼 매핑 + 데이터 30행 이상 필요" : "획득당 비용(CPA)은 낮을수록 좋음 — 색 방향 반전"}
                  style={{ opacity: !decompose.cpa || !hasCpaInputs ? 0.4 : 1 }}
                  onClick={() => setMetric("cpa")}
                >
                  CPA
                </button>
                <button
                  className={`ab-pill ${curMetricKey === "roas" ? "active" : ""}`}
                  disabled={!decompose.roas || !hasRoasInputs}
                  title={!decompose.roas || !hasRoasInputs ? "spend(또는 cost)·revenue_d7 컬럼 매핑 + 데이터 30행 이상 필요" : ""}
                  style={{ opacity: !decompose.roas || !hasRoasInputs ? 0.4 : 1 }}
                  onClick={() => setMetric("roas")}
                >
                  ROAS
                </button>
              </div>
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "-6px" }}>
              분석에 쓰인 행 수(n)={curDecompose?.diag?.n || 0} · <span title="모델이 데이터를 얼마나 잘 설명하는지 (0~1, 높을수록 설명력 높음)">설명력(R²)</span>={fmtNum(curDecompose?.diag?.R2)}
              {(curDecompose?.dropped || []).length ? ` · 제외(다중공선성): ${curDecompose.dropped.join(", ")}` : ""}
              {curDecompose?.diag?.error ? ` · 추정 불가: ${curDecompose.diag.error}` : ""}
            </p>
            {effRows.length ? (
              <>
                <div className="alloc-card" style={{ margin: "12px 0" }}>
                  <div className="cann-card-header">
                    <div className="alloc-card-title">속성별 영향력 그림 (Forest plot — β + 95% 신뢰구간)</div>
                    <button
                      className="ab-pill"
                      title="PNG 다운로드"
                      onClick={() => downloadChartAsPNG(conceptChartRef.current, `creative_forest_${curMetricKey}`)}
                    >
                      ⬇ PNG
                    </button>
                  </div>
                  <p className="muted">막대 길이 = 영향력 크기(β), 양옆 점선 = 신뢰구간(95% CI). 막대가 0선에 안 걸치고 보정된 유의확률(BH-adj p){"<"}0.05면 통계적으로 의미있는 효과입니다.</p>
                  <div style={{ position: "relative", height: `${Math.max(280, Math.min(800, effRows.length * 26 + 80))}px` }}>
                    <canvas id="chart-creative-concept" ref={conceptChartRef}></canvas>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data" style={{ fontSize: "11.5px" }}>
                    <thead>
                      <tr>
                        <th title="비교 대상 속성">속성 (Factor)</th>
                        <th title="속성 안의 구체적인 값">값 (Level)</th>
                        <th title="기준값(가장 흔한 값)">기준값 (Ref)</th>
                        <th title={`기준값 대비 ${decMeta.desc} 변화량`}>영향력 (β, {decMeta.axisUnit})</th>
                        <th title="계수를 표준오차로 나눈 표준화 통계량">z-value</th>
                        <th title="여러 속성을 동시에 검정할 때 보정한 유의확률">보정된 유의확률 (BH-adj p)</th>
                        <th title="이 범위 안에 실제 효과가 있을 가능성이 95%">신뢰구간 (95% CI)</th>
                        <th title="표본 수">N</th>
                      </tr>
                    </thead>
                    <tbody>
                      {effRows.map((e, i) => {
                        const isGood = decomposeEffectIsGood(e.coef, decMeta);
                        const color = e.pAdj < 0.05 ? (isGood ? "#22c55e" : "#f87171") : "var(--text-1)";
                        return (
                          <tr key={i}>
                            <td>{e.factor}</td>
                            <td><strong>{e.level}</strong> <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>vs {e.ref}</span></td>
                            <td className="tnum">{e.ref}</td>
                            <td className="tnum"><strong style={{ color }}>{decMeta.fmtVal(e.coef)}</strong></td>
                            <td className="tnum">{fmtNum(e.z, 2)}</td>
                            <td className="tnum"><strong>{fmtNum(e.pAdj)}</strong></td>
                            <td className="tnum" style={{ fontSize: "11px", color: "var(--text-muted)" }}>[{decMeta.fmtVal(e.ciLow)}, {decMeta.fmtVal(e.ciHigh)}]</td>
                            <td className="tnum">{e.n}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="muted" style={{ color: "var(--text-muted)" }}>통계적으로 의미있는 효과가 발견되지 않았습니다.</p>
            )}
          </>
        ) : (
          <div className="callout warning">
            <div className="ico">!</div>
            <div className="body">
              <strong>분석 불가</strong>
              <p>소재 속성 컬럼(hook_type·format 등) 매핑 또는 데이터 행 수(30행 이상)가 부족합니다.</p>
            </div>
          </div>
        )}
      </section>

      <section className="block" id="s-fatigue">
        <h2 className="section-title"><span className="ix">§5</span>소재 피로도 진단 (Fatigue 검출)</h2>
        <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          분석 소재 {(fatigue || []).length}개 · 피로해진 소재 {fatiguedCount}개
        </p>
        {fatiguedRows.length > 0 && (
          <div className="alloc-card" style={{ marginBottom: "12px" }}>
            <div className="cann-card-header">
              <div className="alloc-card-title">클릭률 하락 추이 — 하락률 상위 {Math.min(5, fatiguedRows.length)}개 (Decay 라인)</div>
              <button
                className="ab-pill"
                title="PNG 다운로드"
                onClick={() => downloadChartAsPNG(fatigueChartRef.current, "creative_fatigue_decay")}
              >
                ⬇ PNG
              </button>
            </div>
            <p className="muted">최근 7일 평균 클릭률(rolling CTR). 가장 좋았던 시점(peak) 대비 하락 추세를 봅니다.</p>
            <div style={{ position: "relative", height: "300px" }}>
              <canvas id="chart-creative-fatigue" ref={fatigueChartRef}></canvas>
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table className="data" style={{ fontSize: "11.5px" }}>
            <thead>
              <tr>
                <th>상태</th>
                <th>Creative ID</th>
                <th>Peak 일자</th>
                <th>Peak 지표</th>
                <th>현재 지표</th>
                <th>하락률</th>
                <th>수명(일)</th>
              </tr>
            </thead>
            <tbody>
              {fatiguedRows.length ? (
                fatiguedRows.map((f, i) => (
                  <tr key={i}>
                    <td><span className="chip" style={{ fontSize: "11px", padding: "2px 8px", color: "#f87171" }}><span className="dot" style={{ background: "#f87171" }}></span>피로</span></td>
                    <td><code className="inline" style={{ fontSize: "10px" }}>{String(f.creative_id).slice(0, 24)}</code></td>
                    <td className="tnum" style={{ fontSize: "11px" }}>{f.peakDate || ""}</td>
                    <td className="tnum">{fmtPct(f.peakValue)}</td>
                    <td className="tnum">{fmtPct(f.currentValue)}</td>
                    <td className="tnum"><strong style={{ color: "#f87171" }}>−{(f.dropPct * 100).toFixed(1)}%</strong></td>
                    <td className="tnum">{f.lifespanDays}일</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="7" style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>지친 소재가 감지되지 않았습니다 (양호)</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block" id="s-fatigue-alert">
        <h2 className="section-title"><span className="ix">§6</span>피로도 임박 경고 (Ad Fatigue Alert)</h2>
        <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          분석 소재 {(fatigueAlerts || []).length}개 · 지금 바로 경고 {alertNowN}개
        </p>
        <div className="table-wrap">
          <table className="data" style={{ fontSize: "11.5px" }}>
            <thead>
              <tr>
                <th>상태</th>
                <th>Creative ID</th>
                <th>수명(일)</th>
                <th>Fatigue Score</th>
                <th>최근 CTR 추세</th>
                <th>최근 노출 추세</th>
                <th>최근 CPM 추세</th>
                <th>ETA</th>
              </tr>
            </thead>
            <tbody>
              {alertRows.length ? (
                alertRows.map((a, i) => {
                  const scoreColor =
                    a.score == null
                      ? "var(--text-muted)"
                      : a.alert
                        ? "#f87171"
                        : a.score >= 0.3
                          ? "#fbbf24"
                          : "#22c55e";
                  return (
                    <tr key={i}>
                      <td>{a.alert ? <span className="chip" style={{ fontSize: "11px", padding: "2px 8px", color: "#f87171" }}><span className="dot" style={{ background: "#f87171" }}></span>경고</span> : <span style={{ color: "var(--text-muted)", fontSize: "10.5px" }}>—</span>}</td>
                      <td><code className="inline" style={{ fontSize: "10px" }}>{String(a.creative_id).slice(0, 24)}</code></td>
                      <td className="tnum">{a.days}일</td>
                      <td className="tnum"><strong style={{ color: scoreColor }}>{a.score == null ? "—" : (a.score * 100).toFixed(0) + "%"}</strong></td>
                      <td className="tnum" style={{ color: (a.ctrTrendPctPerDay || 0) < 0 ? "#f87171" : "var(--text-muted)" }}>{fmtPctDay(a.ctrTrendPctPerDay)}</td>
                      <td className="tnum" style={{ color: (a.freqTrendPctPerDay || 0) > 0 ? "#f87171" : "var(--text-muted)" }}>{fmtPctDay(a.freqTrendPctPerDay)}</td>
                      <td className="tnum" style={{ color: (a.cpmTrendPctPerDay || 0) > 0 ? "#f87171" : "var(--text-muted)" }}>{fmtPctDay(a.cpmTrendPctPerDay)}</td>
                      <td className="tnum">
                        {a.etaDays == null ? (
                          <span style={{ color: "var(--text-muted)", fontSize: "10.5px" }}>{a.etaReason || "—"}</span>
                        ) : a.etaDays === 0 ? (
                          <strong style={{ color: "#f87171" }}>즉시</strong>
                        ) : (
                          <strong>{a.etaDays}일 후</strong>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan="8" style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>분석 가능한 소재가 없습니다 (운영 기간 {CREATIVE_CONFIG.fatigueAlert.minDays}일 미만)</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block" id="s-auto-planner">
        <h2 className="section-title"><span className="ix">§7</span>교체 일정 추천 (Auto-Planner)</h2>
        {autoPlan && autoPlan.plan.length ? (
          (() => {
            const buckets = CREATIVE_FATIGUE.ganttBuckets(autoPlan.plan, ganttWeeks);
            return (
              <>
                <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                  한 주에 새로 만들 수 있는 소재 개수를 입력하면, 피로도가 급한 소재부터 교체할 주차를 자동으로 배정해 드립니다.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "8px 0 12px", flexWrap: "wrap" }}>
                  <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>주당 신규 소재 공급량</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={weeklyVelocity}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setWeeklyVelocity(isFinite(v) && v > 0 ? v : CREATIVE_CONFIG.autoPlanner.defaultWeeklyVelocity);
                    }}
                    style={{ width: "70px", padding: "4px 8px", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-1)", fontSize: "12px" }}
                  />
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>개/주</span>
                </div>
                <div className="ab-stat-row" style={{ margin: "8px 0 12px" }}>
                  <div className="ab-stat">
                    <div className="ab-stat-label" title="즉시 경고 또는 임박 위험으로 분류된 소재 수">긴급 교체 필요</div>
                    <div className={`ab-stat-value tnum ${autoPlan.urgentCount > 0 ? "neg" : "pos"}`}>{autoPlan.urgentCount}</div>
                  </div>
                  <div className="ab-stat">
                    <div className="ab-stat-label" title="현재 공급 속도로 긴급 소재를 전부 교체하는 데 걸리는 기간">긴급 물량 처리 기간</div>
                    <div className="ab-stat-value tnum">{autoPlan.weeksNeededForUrgent == null ? "—" : autoPlan.weeksNeededForUrgent + "주"}</div>
                  </div>
                  <div className="ab-stat">
                    <div className="ab-stat-label" title="긴급 물량을 1주 내 소화하려면 필요한 주당 신규 소재 수">추천 주당 교체 속도</div>
                    <div className="ab-stat-value tnum">{autoPlan.recommendedWeeklyVelocity}개</div>
                  </div>
                </div>
                {autoPlan.isUndersupplied ? (
                  <div className="callout warning"><div className="ico">!</div><div className="body"><strong>공급 부족</strong><p>긴급 교체가 필요한 소재가 {autoPlan.urgentCount}개인데 현재 주당 공급량({autoPlan.weeklyVelocity})으로는 1주 내 전부 소화할 수 없습니다. 주당 {autoPlan.recommendedWeeklyVelocity}개 이상으로 늘리거나 긴급도가 낮은 소재의 교체를 늦추세요.</p></div></div>
                ) : (
                  <div className="callout"><div className="ico">i</div><div className="body"><p style={{ margin: 0, fontSize: "12px" }}>현재 공급량(주당 {autoPlan.weeklyVelocity}개)으로 긴급 교체 물량을 충분히 소화 가능합니다.</p></div></div>
                )}
                <div className="alloc-card" style={{ marginTop: "12px" }}>
                  <div className="cann-card-header"><div className="alloc-card-title">교체 타임라인 (Gantt) — 향후 {ganttWeeks}주</div></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
                    {buckets.map((b) => (
                      <div key={b.week} style={{ display: "flex", alignItems: "stretch", gap: "8px" }}>
                        <div style={{ width: "54px", flexShrink: 0, fontSize: "11px", color: "var(--text-muted)", paddingTop: "4px" }}>W+{b.week}</div>
                        <div style={{ flex: 1, display: "flex", gap: "3px", flexWrap: "wrap", minHeight: "26px", alignItems: "center", background: "var(--bg-2)", borderRadius: "6px", padding: "4px 6px" }}>
                          {b.items.length === 0 ? (
                            <span style={{ fontSize: "10.5px", color: "var(--text-muted)" }}>—</span>
                          ) : (
                            b.items.map((p) => (
                              <span
                                key={p.queueRank}
                                title={`${String(p.creative_id)} · ${URGENCY_LABEL[p.urgency]} · score=${p.score == null ? "—" : (p.score * 100).toFixed(0) + "%"}`}
                                style={{ display: "inline-block", padding: "2px 7px", borderRadius: "4px", fontSize: "10px", background: URGENCY_COLOR[p.urgency] + "33", border: `1px solid ${URGENCY_COLOR[p.urgency]}88`, color: "var(--text-1)" }}
                              >
                                #{p.queueRank} {String(p.creative_id).slice(0, 12)}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--text-muted)" }}>
                    <span style={{ display: "inline-block", width: "9px", height: "9px", borderRadius: "2px", background: URGENCY_COLOR.urgent, marginRight: "4px" }}></span>긴급(즉시 경고 또는 {CREATIVE_CONFIG.autoPlanner.urgentDays}일 내)
                    <span style={{ display: "inline-block", width: "9px", height: "9px", borderRadius: "2px", background: URGENCY_COLOR.soon, margin: "0 4px 0 12px" }}></span>곧({CREATIVE_CONFIG.autoPlanner.soonDays}일 내)
                    <span style={{ display: "inline-block", width: "9px", height: "9px", borderRadius: "2px", background: URGENCY_COLOR.planned, margin: "0 4px 0 12px" }}></span>예정
                  </div>
                </div>
                <p className="muted" style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "8px" }}>교체 순서는 [지금 바로 경고 우선 → 위험 도달 예상이 빠른 순 → 피로도 점수 높은 순]으로 정해지며, 입력한 주당 개수만큼씩 주차에 나눠 배치됩니다.</p>
              </>
            );
          })()
        ) : (
          <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px" }}>교체가 필요한 소재가 없습니다.</p>
        )}
      </section>

      <section className="block" id="s-matrix">
        <h2 className="section-title"><span className="ix">§8</span>조합별 성과표 (Concept Matrix){matrix ? ` — ${rowAttr} × ${colAttr}` : ""}</h2>
        {matrix && matrix.grid.length ? (
          <>
            <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px" }}>소재 속성 두 가지를 교차해서, 어떤 조합이 이미 검증됐고 어떤 조합을 더 시도해봐야 하는지 한눈에 봅니다. 셀을 클릭하면 §3 성과표가 그 조합으로 필터링됩니다.</p>
            <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              셀 상태: <span style={{ background: MATRIX_STATUS_COLOR.validated, padding: "2px 8px", borderRadius: "4px" }} title="충분한 데이터로 효과가 확인된 조합">검증</span> ·{" "}
              <span style={{ background: MATRIX_STATUS_COLOR.promising, padding: "2px 8px", borderRadius: "4px" }} title="좋아 보이지만 아직 데이터가 적어 확정하기 어려운 조합">유망</span> ·{" "}
              <span style={{ background: MATRIX_STATUS_COLOR.insufficient, padding: "2px 8px", borderRadius: "4px" }} title="시도는 했지만 판단하기엔 데이터가 너무 적은 조합">데이터 부족</span> ·{" "}
              <span style={{ background: MATRIX_STATUS_COLOR.empty, padding: "2px 8px", borderRadius: "4px" }} title="아직 한 번도 시도하지 않은 조합 — 다음 테스트 후보">미관측 (탐색 후보)</span>
            </p>
            <div className="table-wrap">
              <table className="data" style={{ fontSize: "11px" }}>
                <tbody>
                  <tr>
                    <th style={{ background: "var(--bg-2)" }}><strong>{rowAttr}</strong> ↓ \ <strong>{colAttr}</strong> →</th>
                    {matrix.cols.map((c) => (
                      <th key={c} style={{ background: "var(--bg-2)" }}>{c}</th>
                    ))}
                  </tr>
                  {matrix.grid.map((row, ri) => (
                    <tr key={matrix.rows[ri]}>
                      <th style={{ background: "var(--bg-2)", textAlign: "left" }}>{matrix.rows[ri]}</th>
                      {row.map((cell) => {
                        const isSel = selectedCell && selectedCell.row === cell.row && selectedCell.col === cell.col;
                        const clickable = cell.status !== "empty";
                        return (
                          <td
                            key={`${cell.row}|${cell.col}`}
                            onClick={
                              clickable
                                ? () =>
                                    setSelectedCell(
                                      isSel ? null : { row: cell.row, col: cell.col },
                                    )
                                : undefined
                            }
                            style={{
                              background: MATRIX_STATUS_COLOR[cell.status],
                              padding: "8px",
                              fontSize: "11px",
                              lineHeight: 1.5,
                              cursor: clickable ? "pointer" : "default",
                              outline: isSel ? "2px solid var(--primary, #adc6ff)" : "none",
                              outlineOffset: isSel ? "-2px" : undefined,
                            }}
                          >
                            <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                              {MATRIX_STATUS_LABEL[cell.status]}{cell.n ? ` · n=${cell.n}` : ""}{isSel ? " ★ 선택됨" : ""}
                            </div>
                            {cell.status !== "empty" ? (
                              <>
                                <div className="tnum">CTR {fmtPct(cell.ctr)}</div>
                                <div className="tnum" style={{ color: "var(--text-muted)" }}>CVR {fmtPct(cell.cvr)}</div>
                              </>
                            ) : (
                              <div style={{ color: "var(--text-muted)" }}>—</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="callout warning"><div className="ico">!</div><div className="body"><strong>성과표 생성 불가</strong><p>{rowAttr} 컬럼과 {colAttr} 컬럼이 모두 매핑되어야 합니다.</p></div></div>
        )}
      </section>

      <section className="block" id="s-next">
        <h2 className="section-title"><span className="ix">§9</span>다음 테스트 추천</h2>
        {nextTest && nextTest.length ? (
          <>
            <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "6px", lineHeight: 1.5 }}>
              지금까지의 분석을 바탕으로 다음에 무엇을 테스트하면 좋을지 제안합니다. 아직 집행한 적 없는 조합(🔍 탐색), 가능성이 보이지만 확증이 더 필요한 조합(🎯 최적화), 통계적으로 효과가 뚜렷하게 나빠서 배제를 권장하는 속성(❌ 제거)을 자동으로 골라줍니다. (한 번에 최대 {CREATIVE_CONFIG.test.batchSize}개)
            </p>
            <div className="table-wrap">
              <table className="data" style={{ fontSize: "11.5px" }}>
                <thead>
                  <tr>
                    <th>유형</th>
                    <th>대상</th>
                    <th title="비교해볼 변형 개수">테스트 그룹 수 (arms)</th>
                    <th>근거</th>
                    <th title="결론을 믿을 수 있으려면 필요한 데이터 양">필요 샘플 수</th>
                    <th title="이 추천이 유효하려면 만족해야 하는 조건">확인 조건 (게이트)</th>
                  </tr>
                </thead>
                <tbody>
                  {nextTest.map((h, i) => (
                    <tr key={i}>
                      <td>
                        <span
                          className={`chip ${h.type === "kill" ? "danger" : h.type === "exploit" ? "ok" : "warn"}`}
                          style={{ fontSize: "11px", padding: "2px 8px" }}
                        >
                          <span className="dot"></span>{NEXT_TEST_ICON[h.type]} {NEXT_TEST_LABEL[h.type]}
                        </span>
                      </td>
                      <td><strong>{h.cell}</strong></td>
                      <td className="tnum">{h.arms}</td>
                      <td style={{ fontSize: "11px", color: "var(--text-muted)" }}>{h.rationale}</td>
                      <td className="tnum">{h.sampleSize ? h.sampleSize.toLocaleString() : "—"}</td>
                      <td style={{ fontSize: "10.5px", color: "var(--text-muted)" }}>
                        {(h.gates || []).map((g, gi) => (
                          <div key={gi}>· {g}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "8px" }}>⚠ 이 추천은 실제 운영 데이터를 관찰해서 만든 가설입니다. 확정은 실험 분석 도구(5-4)에서 A/B 테스트로 검증하는 것을 권장합니다.</p>
          </>
        ) : (
          <p className="muted" style={{ color: "var(--text-muted)", fontSize: "12px" }}>추천할 다음 테스트가 없습니다 (모든 조합이 검증되었거나 데이터가 부족합니다).</p>
        )}
      </section>
    </div>
  );
}
