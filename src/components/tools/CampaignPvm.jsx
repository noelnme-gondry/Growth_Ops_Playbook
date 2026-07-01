"use client";
import React, { useState, useRef, useEffect, useMemo } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { PVM_MATH } from "@/utils/pvmMath";
import { pvmGenerateDiagnosis, buildPvmResultCsv } from "@/utils/pvmExport";
import { getMonFilteredRows, effectiveDenomBasis } from "@/utils/dashboardAggregator";
import CsvUploader from "@/components/CsvUploader";
import DashboardFilterBar from "@/components/dashboard/DashboardFilterBar";
import ToolPageShell from "@/components/ToolPageShell";

// 우측 TOC — legacy page_5_21() 목차와 동일 (§0 한눈에 보기~§4 소재별 결과).
const PVM_TOC = [
  { id: "s-pvm-result", title: "§0 한눈에 보기" },
  { id: "s-pvm-scorecard", title: "§1 스코어카드" },
  { id: "s-pvm-channels", title: "§2 채널별 결과" },
  { id: "s-pvm-campaigns", title: "§3 채널·캠페인별 결과" },
  { id: "s-pvm-creatives", title: "§4 소재별 결과" },
];

const DAY = 86400000;

// 통화 표시 헬퍼 — index.html pvmFmtMoney 이식 (값 변환 없이 단위 기호만 전환)
// decimals: usd일 때 소수 자리 강제(CPA/CPI처럼 단가 지표는 1자리 — 예: $19.1).
// 미지정 시 기존 동작(최대 2자리) 유지.
function pvmFmtMoney(v, cur, decimals) {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (cur === "usd") {
    const opts = decimals != null
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : { maximumFractionDigits: 2 };
    return `${sign}$${abs.toLocaleString(undefined, opts)}`;
  }
  return `${sign}${Math.round(abs).toLocaleString()}원`;
}

// 월요일(UTC 고정) — 마감주(calendar weekBasis) 계산 기준
function getMonday(d) {
  const day = d.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return new Date(d.getTime() - offset * DAY);
}

// 유의성 판정 규칙(§6) — index.html PVM_SIG_RULES 이식
const PVM_SIG_RULES = {
  overallFlatPct: 0.02,
  entityShareMin: 0.15,
  entityAbsFloorPct: 0.01,
};

function pvmIsOverallFlat(deltaMetric, metric1) {
  if (!metric1) return Math.abs(deltaMetric) < 1e-9;
  return Math.abs(deltaMetric) < PVM_SIG_RULES.overallFlatPct * Math.abs(metric1);
}

function pvmIsEntitySignificant(contribution, deltaMetricTotal, metric2) {
  const passShare =
    Math.abs(contribution) >= PVM_SIG_RULES.entityShareMin * Math.abs(deltaMetricTotal);
  const passFloor =
    Math.abs(contribution) >= PVM_SIG_RULES.entityAbsFloorPct * Math.abs(metric2);
  return passShare && passFloor;
}

function pvmColor(v) {
  return v >= 0 ? "#f87171" : "#22c55e";
}

// index.html buildPvmCache 이식 — 순수 계산(사이드이펙트 없음), PVM_MATH 엔진 재사용
function buildPvmCache(csvData, state) {
  const rows = getMonFilteredRows(csvData, state.dashboardFilter);
  const mapped = new Set(
    Object.values(csvData?.mapping || {}).filter((v) => v && v !== "__ignore__"),
  );
  const hasInstalls = mapped.has("installs");
  const hasActions = mapped.has("actions");
  const bothMetricsMapped = hasInstalls && hasActions;
  // 전역 분모 기준(설치/가입) SSOT — 가입(actions)=CPA, 설치(installs)=CPI(§12.18).
  // 로컬 metric 토글은 둘 다 매핑됐을 때의 수동 오버라이드; 미매핑이면 매핑된 쪽으로 강제.
  const effBasis = effectiveDenomBasis(csvData, state.denomBasis);
  let metric = state.metric === "cpi" ? "cpi" : state.metric === "cpa" ? "cpa" : effBasis === "installs" ? "cpi" : "cpa";
  if (!bothMetricsMapped) metric = hasInstalls ? "cpi" : "cpa";
  const resultField = metric === "cpi" ? "installs" : "actions";
  const campaignMapped = mapped.has("campaign_id");
  const creativeMapped = mapped.has("creative_id");
  const ctrMapped = mapped.has("impressions") && mapped.has("clicks");
  const weekBasis = state.weekBasis === "rolling7" ? "rolling7" : "calendar";
  const baseFields = {
    metric,
    resultField,
    bothMetricsMapped,
    ctrMapped,
    campaignMapped,
    creativeMapped,
    weekBasis,
    currency: state.currency,
  };

  const withT = rows
    .map((r) => ({
      ...r,
      _t: new Date(String(r.date) + "T00:00:00Z").getTime(),
    }))
    .filter((r) => !isNaN(r._t));
  if (!withT.length)
    return { insufficientData: true, message: "날짜 데이터가 없습니다.", ...baseFields };

  const maxT = Math.max(...withT.map((r) => r._t));
  const minT = Math.min(...withT.map((r) => r._t));

  let thisMon = getMonday(new Date(maxT)).getTime();
  if (thisMon + 6 * DAY > maxT) thisMon -= 7 * DAY;
  const earliestMon = getMonday(new Date(minT)).getTime();

  function rangesFor(lb) {
    if (weekBasis === "calendar") {
      const p2 = [thisMon, thisMon + 6 * DAY];
      const p1start = thisMon - 7 * lb * DAY;
      return { p1: [p1start, p1start + 6 * DAY], p2 };
    }
    const p2 = [maxT - 6 * DAY, maxT];
    const p1 = [p2[0] - 7 * lb * DAY, p2[1] - 7 * lb * DAY];
    return { p1, p2 };
  }

  function isLocked(lb) {
    if (weekBasis === "calendar") {
      const p1start = thisMon - 7 * lb * DAY;
      return p1start < earliestMon;
    }
    const needed = maxT - 7 * (lb + 1) * DAY + DAY;
    return needed < minT;
  }

  const lockState = { 1: isLocked(1), 2: isLocked(2), 3: isLocked(3) };
  let lookback = state.lookback;
  if (lockState[lookback]) {
    const fallback = [3, 2, 1].find((lb) => !lockState[lb]);
    if (!fallback)
      return {
        insufficientData: true,
        message: "최소 2주치 데이터 필요",
        lockState,
        ...baseFields,
        lookback: state.lookback,
      };
    lookback = fallback;
  }

  const { p1, p2 } = rangesFor(lookback);
  const inRange = (t, r) => t >= r[0] && t <= r[1];
  const rowsP1 = withT.filter((r) => inRange(r._t, p1));
  const rowsP2 = withT.filter((r) => inRange(r._t, p2));
  if (!rowsP1.length || !rowsP2.length) {
    return {
      insufficientData: true,
      message: "선택한 기간에 데이터가 없습니다.",
      lockState,
      ...baseFields,
      lookback,
    };
  }

  const keys = {
    ch: "channel",
    cmp: campaignMapped ? "campaign_id" : null,
    cr: creativeMapped ? "creative_id" : null,
    resultField,
  };
  const fin = PVM_MATH.decomposeFinest(rowsP1, rowsP2, keys);
  if (!fin) {
    return {
      insufficientData: true,
      message: `해당 기간 전환(${resultField === "installs" ? "설치" : "액션"})이 0입니다.`,
      lockState,
      ...baseFields,
      lookback,
    };
  }

  const Cbar = (fin.CPA1 + fin.CPA2) / 2;
  const layer1 = PVM_MATH.decomposeLayer(
    rowsP1,
    rowsP2,
    keys,
    fin.Result1,
    fin.Result2,
    Cbar,
    "channel",
  );
  const layer2 = keys.cmp
    ? PVM_MATH.decomposeLayer(rowsP1, rowsP2, keys, fin.Result1, fin.Result2, Cbar, "campaign")
    : [];
  const layer3 = keys.cr
    ? PVM_MATH.decomposeLayer(rowsP1, rowsP2, keys, fin.Result1, fin.Result2, Cbar, "creative")
    : [];

  // Layer 2 하위합(withinMix) — 소재 합 대비 캠페인 계산 믹스
  if (keys.cmp && keys.cr) {
    for (const cmp of layer2) {
      const related = layer3.filter((cr) => cr.chKey === cmp.chKey && cr.cmpKey === cmp.cmpKey);
      const creativeSumMix = related.reduce((s, cr) => s + cr.mix, 0);
      const creativeSumRate = related.reduce((s, cr) => s + cr.rate, 0);
      cmp.creativeSumMix = creativeSumMix;
      cmp.creativeSumRate = creativeSumRate;
      cmp.withinMix = creativeSumMix - cmp.mix;
    }
  } else if (keys.cmp) {
    for (const cmp of layer2) {
      cmp.creativeSumMix = 0;
      cmp.creativeSumRate = 0;
      cmp.withinMix = 0;
    }
  }

  // Layer 1 하위합(캠페인 합)
  if (keys.cmp) {
    for (const ch of layer1) {
      const related = layer2.filter((cmp) => cmp.chKey === ch.key);
      ch.cmpSumMix = related.reduce((s, cmp) => s + cmp.mix, 0);
      ch.cmpSumRate = related.reduce((s, cmp) => s + cmp.rate, 0);
      ch.cmpSumContribution = related.reduce((s, cmp) => s + cmp.contribution, 0);
    }
  } else {
    for (const ch of layer1) {
      ch.cmpSumMix = 0;
      ch.cmpSumRate = 0;
      ch.cmpSumContribution = 0;
    }
  }

  // 소재 URL 맵 — 비용 최대 변형의 URL 채택
  const urlMapped = mapped.has("creative_url") && creativeMapped;
  let crUrlMap = null;
  if (urlMapped) {
    const acc = new Map();
    [...rowsP1, ...rowsP2].forEach((r) => {
      const cr = String(r.creative_id ?? "");
      const url = String(r.creative_url ?? "").trim();
      if (!cr || !url) return;
      if (!acc.has(cr)) acc.set(cr, new Map());
      const byUrl = acc.get(cr);
      byUrl.set(url, (byUrl.get(url) || 0) + (Number(r.spend) || 0));
    });
    crUrlMap = new Map();
    for (const [cr, byUrl] of acc) {
      let best = null,
        bestCost = -Infinity;
      for (const [url, cost] of byUrl) {
        if (cost > bestCost) {
          bestCost = cost;
          best = url;
        }
      }
      if (best) crUrlMap.set(cr, best);
    }
  }

  const ymd = (t) => new Date(t).toISOString().slice(0, 10);
  return {
    insufficientData: false,
    ...baseFields,
    urlMapped,
    lookback,
    requestedLookback: state.lookback,
    lockState,
    p1Range: [ymd(p1[0]), ymd(p1[1])],
    p2Range: [ymd(p2[0]), ymd(p2[1])],
    p2DaysCovered: rowsP2.length ? new Set(rowsP2.map((r) => r.date)).size : 0,
    finest: fin.finest,
    crUrlMap,
    rowsP1,
    rowsP2,
    CPA1: fin.CPA1,
    CPA2: fin.CPA2,
    deltaCpa: fin.deltaCpa,
    Cost1: fin.Cost1,
    Cost2: fin.Cost2,
    Result1: fin.Result1,
    Result2: fin.Result2,
    layer1,
    layer2,
    layer3,
  };
}

function pvmMetricLabel(c) {
  return c.resultField === "installs" ? "CPI" : "CPA";
}

// http/https만 허용(XSS 차단)
function pvmSafeUrl(u) {
  if (!u) return null;
  const s = String(u).trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

export default function CampaignPvm() {
  const csvData = useAppStore((state) => state.csvData);
  const denomBasis = useAppStore((state) => state.denomBasis);
  const dashboardFilter = useAppStore((state) => state.dashboardFilter);
  // 전역 통화(₩/$) SSOT 구독 — 예전엔 이 파일만 로컬 useState("krw")를 따로 갖고 있어서
  // 전역 토글(BasisCurrencyToggleBar)이 여기 숫자엔 전혀 반영 안 됐음. 이제 전역이 source,
  // 이 파일의 ₩/$ 버튼은 전역 setter를 호출(단일 소스, 두 UI 동기화).
  const displayCurrency = useAppStore((state) => state.displayCurrency);
  const setDisplayCurrency = useAppStore((state) => state.setDisplayCurrency);
  // 전역 분모 기준(설치/가입) → 지표(가입=CPA, 설치=CPI). §12.18 SSOT 구독.
  const effBasis = effectiveDenomBasis(csvData, denomBasis);
  const basisMetric = effBasis === "installs" ? "cpi" : "cpa";
  // 지표는 전역 기준을 기본값으로 파생 — 사용자 pill은 수동 오버라이드(null=전역 따름).
  // 전역 기준이 flip되면 오버라이드를 렌더 중 리셋(React sanctioned reset-on-change 패턴, 이펙트 불필요).
  const [metricOverride, setMetricOverride] = useState(null);
  const [lastBasisMetric, setLastBasisMetric] = useState(basisMetric);
  if (basisMetric !== lastBasisMetric) {
    setLastBasisMetric(basisMetric);
    setMetricOverride(null);
  }
  const metric = metricOverride ?? basisMetric;
  const setMetric = setMetricOverride;
  const [weekBasis, setWeekBasis] = useState("calendar");
  const [lookback, setLookback] = useState(1);
  const currency = displayCurrency === "USD" ? "usd" : "krw";
  const setCurrency = (c) => setDisplayCurrency(c === "usd" ? "USD" : "KRW");

  const [drillChannel, setDrillChannel] = useState("__all__");
  const [crChannel, setCrChannel] = useState("__all__");
  const [crCampaign, setCrCampaign] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [crPage, setCrPage] = useState(1);

  const hasData = csvData?.raw?.length > 0;

  const chartPvmWaterfall = useRef(null);
  const chartPvmTrend = useRef(null);

  // 실제 엔진 출력 계산 (캐시) — metric/weekBasis/lookback/denomBasis 변경 시 재계산
  const cache = useMemo(() => {
    if (!hasData) return null;
    try {
      return buildPvmCache(csvData, { metric, weekBasis, lookback, currency, denomBasis, dashboardFilter });
    } catch (e) {
      return { insufficientData: true, message: "분석 중 오류: " + e.message };
    }
  }, [hasData, csvData, metric, weekBasis, lookback, currency, denomBasis, dashboardFilter]);

  const ready = cache && !cache.insufficientData;

  // §2 차트용 채널 배열 (top7 + 기타 축약) — index.html renderPvmCharts 이식
  const byChannelChart = useMemo(() => {
    if (!ready) return [];
    let arr = [...cache.layer1].sort(
      (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
    );
    if (arr.length > 8) {
      const top = arr.slice(0, 7);
      const merged = { key: "기타", mix: 0, rate: 0, contribution: 0 };
      arr.slice(7).forEach((e) => {
        merged.mix += e.mix;
        merged.rate += e.rate;
        merged.contribution += e.contribution;
      });
      arr = [...top, merged];
    }
    return arr;
  }, [ready, cache]);

  useEffect(() => {
    if (!ready || !byChannelChart.length) return;

    const cur = currency;
    const ml = pvmMetricLabel(cache);
    const c = { CPA1: cache.CPA1, CPA2: cache.CPA2 };
    const byChannel = byChannelChart;

    const CHART_THEME = { text: "#334155", muted: "#64748b", grid: "#e2e8f0" };
    const chartCommonOpts = () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      scales: {
        x: {
          ticks: { color: CHART_THEME.muted, font: { family: "JetBrains Mono", size: 11 } },
          grid: { display: false },
        },
        y: {
          ticks: { color: CHART_THEME.muted, font: { family: "JetBrains Mono", size: 11 } },
          grid: { color: CHART_THEME.grid, drawBorder: false },
        },
      },
      plugins: {
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.9)",
          titleFont: { size: 12 },
          bodyFont: { size: 12, family: "JetBrains Mono" },
          padding: 10,
          cornerRadius: 6,
        },
      },
    });

    let waterfallChart = null;
    let trendChart = null;
    const base = chartCommonOpts();

    // 1. Waterfall Chart — 지난주 전체 CPA / 채널 기여(±) / 이번주 전체 CPA
    if (chartPvmWaterfall.current) {
      const NEUTRAL = "#64748b", RED = "#ff8a8a", GREEN = "#5ad19a";
      const labels = ["지난주 전체", ...byChannel.map((e) => e.key), "이번주 전체"];
      const values = [c.CPA1, ...byChannel.map((e) => e.contribution), c.CPA2];
      const isCpaIdx = (i) => i === 0 || i === values.length - 1;
      const colors = values.map((v, i) => (isCpaIdx(i) ? NEUTRAL : v >= 0 ? RED : GREEN));

      const lo = Math.min(0, ...values);
      const hi = Math.max(0, ...values);
      const niceStep = (raw) =>
        [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 25000, 50000].find(
          (s) => s >= raw,
        ) || raw;
      const step = niceStep((hi - lo) / 7) || 1;
      const yMin = Math.floor(lo / step) * step;
      const yMax = Math.ceil(hi / step) * step;

      const labelPlugin = {
        id: "pvmWfLabels",
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const meta = chart.getDatasetMeta(0);
          ctx.save();
          ctx.font = "10px JetBrains Mono";
          ctx.textAlign = "center";
          meta.data.forEach((bar, i) => {
            const v = values[i];
            const txt = isCpaIdx(i) ? pvmFmtMoney(v, cur, cur === "usd" ? 1 : undefined) : (v >= 0 ? "+" : "") + pvmFmtMoney(v, cur);
            ctx.fillStyle = isCpaIdx(i) ? CHART_THEME.text : v >= 0 ? RED : GREEN;
            ctx.fillText(txt, bar.x, v >= 0 ? bar.y - 4 : bar.y + 13);
          });
          ctx.restore();
        },
      };

      waterfallChart = new Chart(chartPvmWaterfall.current.getContext("2d"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            { data: values, backgroundColor: colors, borderRadius: 4, barPercentage: 0.7, categoryPercentage: 0.82 },
          ],
        },
        options: {
          ...base,
          scales: {
            x: { ...base.scales.x, grid: { display: false }, ticks: { ...base.scales.x.ticks, maxRotation: 0, autoSkip: false } },
            y: { ...base.scales.y, beginAtZero: false, min: yMin, max: yMax, ticks: { ...base.scales.y.ticks, stepSize: step, callback: (v) => pvmFmtMoney(v, cur) } },
          },
          plugins: {
            ...base.plugins,
            legend: { display: false },
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: {
                label: (ctx) => {
                  const i = ctx.dataIndex;
                  const v = values[i];
                  return isCpaIdx(i) ? `${ml} ${pvmFmtMoney(v, cur)}` : `${ctx.label}: ${v >= 0 ? "+" : ""}${pvmFmtMoney(v, cur)} (${v >= 0 ? "악화" : "개선"})`;
                },
              },
            },
          },
        },
        plugins: [labelPlugin],
      });
    }

    // 2. Channel Mix·Rate Stack Chart
    if (chartPvmTrend.current) {
      const arr = [...byChannel].sort((a, b) => Math.abs(a.contribution) - Math.abs(b.contribution));
      const labels = arr.map((e) => e.key);
      const MIX_POS = "#4d8eff", MIX_NEG = "#adc6ff", RATE_POS = "#d97706", RATE_NEG = "#ffd98a";
      const legendTextColor = CHART_THEME.text;

      trendChart = new Chart(chartPvmTrend.current.getContext("2d"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "Mix(비중)", data: arr.map((e) => e.mix), backgroundColor: arr.map((e) => (e.mix >= 0 ? MIX_POS : MIX_NEG)), borderRadius: 3, barThickness: 15 },
            { label: "Rate(효율)", data: arr.map((e) => e.rate), backgroundColor: arr.map((e) => (e.rate >= 0 ? RATE_POS : RATE_NEG)), borderRadius: 3, barThickness: 15 },
          ],
        },
        options: {
          ...base,
          indexAxis: "y",
          scales: {
            x: { ...base.scales.x, stacked: true, ticks: { ...base.scales.x.ticks, callback: (v) => pvmFmtMoney(v, cur) }, title: { display: true, text: `${ml} 영향(${cur === "usd" ? "$" : "원"})`, color: CHART_THEME.muted, font: { size: 10 } } },
            y: { ...base.scales.y, stacked: true, beginAtZero: true, grid: { display: false } },
          },
          plugins: {
            ...base.plugins,
            legend: {
              onClick: () => {},
              labels: {
                color: legendTextColor,
                generateLabels: () => [
                  { text: "Mix +(악화)", fillStyle: MIX_POS, strokeStyle: MIX_POS, fontColor: legendTextColor, pointStyle: "circle" },
                  { text: "Mix −(개선)", fillStyle: MIX_NEG, strokeStyle: MIX_NEG, fontColor: legendTextColor, pointStyle: "circle" },
                  { text: "Rate +(악화)", fillStyle: RATE_POS, strokeStyle: RATE_POS, fontColor: legendTextColor, pointStyle: "circle" },
                  { text: "Rate −(개선)", fillStyle: RATE_NEG, strokeStyle: RATE_NEG, fontColor: legendTextColor, pointStyle: "circle" },
                ],
              },
            },
            tooltip: {
              ...base.plugins.tooltip,
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x >= 0 ? "+" : ""}${pvmFmtMoney(ctx.parsed.x, cur)}`,
              },
            },
          },
        },
      });
    }

    return () => {
      if (waterfallChart) waterfallChart.destroy();
      if (trendChart) trendChart.destroy();
    };
  }, [ready, cache, byChannelChart, currency]);

  // 진단(💡) 플로팅 툴팁 — index.html #pvm-float-tip 이식(document 위임, 스크롤 시 숨김)
  useEffect(() => {
    let tip = document.getElementById("pvm-float-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "pvm-float-tip";
      document.body.appendChild(tip);
    }
    let hideTimer = null;
    const showTip = (icon) => {
      clearTimeout(hideTimer);
      const text = icon.getAttribute("data-tip");
      if (!text) return;
      tip.textContent = text;
      tip.classList.add("visible");
      const rect = icon.getBoundingClientRect();
      const tipW = 340;
      let left = rect.left + rect.width / 2 - tipW / 2;
      if (left < 8) left = 8;
      if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
      tip.style.left = left + "px";
      const tipH = tip.offsetHeight;
      const above = rect.top - tipH - 12;
      if (above > 4) tip.style.top = above + "px";
      else tip.style.top = rect.bottom + 10 + "px";
    };
    const hideTip = () => {
      hideTimer = setTimeout(() => tip.classList.remove("visible"), 80);
    };
    const onOver = (ev) => {
      const icon = ev.target.closest?.(".pvm-diag-icon");
      if (icon) showTip(icon);
    };
    const onOut = (ev) => {
      const icon = ev.target.closest?.(".pvm-diag-icon");
      if (icon) hideTip();
    };
    const onScroll = () => hideTip();
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("focusin", onOver);
    document.addEventListener("focusout", onOut);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(hideTimer);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("focusin", onOver);
      document.removeEventListener("focusout", onOut);
      document.removeEventListener("scroll", onScroll, true);
      tip.classList.remove("visible");
    };
  }, []);

  // 차트 PNG 다운로드 — 다크 배경 합성 후 export(§7). ref 기반(v2엔 전역 핸들러 없음)
  const downloadChartPng = (canvasRef, nameSuffix) => {
    const canvas = canvasRef?.current;
    if (!canvas) return;
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const ctx = tmp.getContext("2d");
    const rootStyle = getComputedStyle(document.documentElement);
    const bg =
      rootStyle.getPropertyValue("--bg-1").trim() ||
      rootStyle.getPropertyValue("--surface-base").trim() ||
      "#0f0f1e";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(canvas, 0, 0);
    const ts = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = tmp.toDataURL("image/png");
    a.download = `${nameSuffix}_${ts}.png`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 0);
  };

  // 결과 CSV 다운로드 — 살아있는 스프레드시트 수식(§7 CRLF+BOM). buildPvmResultCsv 재사용
  const downloadPvmCsv = () => {
    if (!ready) {
      alert("분석 데이터가 없습니다. 먼저 데이터를 매핑하세요.");
      return;
    }
    try {
      const ml2 = pvmMetricLabel(cache);
      const content = buildPvmResultCsv(cache, ml2);
      const fname = `pvm_result_${ml2}_${cache.p2Range[1]}.csv`;
      const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
    } catch (e) {
      console.warn("PVM CSV download failed:", e.message);
      alert("CSV 생성 중 오류가 발생했습니다.");
    }
  };

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-pvm">
        <ToolPageShell
          title="캠페인 성과 변동"
          chips={<span className="chip warning"><span className="dot"></span>CSV 업로드 대기</span>}
          summary={
            <p>5-6(소재 분석)과 동일한 소재 daily CSV를 사용합니다 — 이미 5-6에 업로드했다면 자동으로 이어받습니다.</p>
          }
          toc={[{ id: "s-prep", title: "데이터 준비" }]}
        >
          <section className="block" id="s-prep">
            <h2 className="section-title">데이터 준비</h2>
            <div className="callout warning">
              <div className="ico">!</div>
              <div className="body">
                <strong>CSV 업로드 대기</strong>
                <p>캠페인 효율 데이터(최소 2주치)를 업로드하여 변동 원인을 분석하세요.</p>
                <div style={{ marginTop: "1rem" }}>
                  <CsvUploader toolId="5-21" />
                </div>
              </div>
            </div>
          </section>
        </ToolPageShell>
      </div>
    );
  }

  const cur = currency;
  const ml = ready ? pvmMetricLabel(cache) : metric.toUpperCase();
  const bothMetricsMapped = cache?.bothMetricsMapped;

  // §0 헤드라인 chip 헬퍼 + pvmImpactChip 이식
  const chipCls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");
  const chipArr = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "—");
  const chipWord = (v) => (v > 0 ? "악화" : v < 0 ? "개선" : "변화 없음");
  const impactChip = (v, opts = {}) => (
    <span className={`pvm-chip ${chipCls(v)}`}>
      {chipArr(v)} {opts.prefix ? opts.prefix + " " : ""}
      {v >= 0 ? "+" : ""}
      {pvmFmtMoney(v, cur)}
      {opts.hideWord ? "" : " " + chipWord(v)}
    </span>
  );

  // §0 Top-mover 카드 + 헤드라인 라인 (실제 값) — index.html pvmComputeRollups + pvmHeadlineSection 이식
  const headlineLines = [];
  let upMover = null;
  let downMover = null;
  if (ready) {
    const flat = pvmIsOverallFlat(cache.deltaCpa, cache.CPA1);
    const sortedCh = [...cache.layer1].sort(
      (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
    );
    const topChannel = sortedCh[0] || null;

    // 드릴 체인 top 캠페인·소재 (top 채널 하위)
    let topCampaign = null;
    if (cache.campaignMapped && topChannel) {
      topCampaign = cache.layer2
        .filter((f) => f.chKey === topChannel.key)
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0] || null;
    }
    let topCreative = null;
    if (cache.creativeMapped && topChannel) {
      topCreative = cache.layer3
        .filter(
          (f) =>
            f.chKey === topChannel.key &&
            (topCampaign ? f.cmpKey === topCampaign.cmpKey : true),
        )
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0] || null;
    }

    // Top-mover — 가장 올린/내린 채널(있을 때만)
    upMover =
      [...sortedCh].filter((e) => e.contribution > 0).sort((a, b) => b.contribution - a.contribution)[0] || null;
    downMover =
      [...sortedCh].filter((e) => e.contribution < 0).sort((a, b) => a.contribution - b.contribution)[0] || null;

    headlineLines.push(
      flat ? (
        <li key="head" style={{ marginBottom: "7px", fontSize: "13px", lineHeight: 1.7 }}>
          전체 {ml}는 {pvmFmtMoney(cache.CPA1, cur, cur === "usd" ? 1 : undefined)} → {pvmFmtMoney(cache.CPA2, cur, cur === "usd" ? 1 : undefined)}로 큰 변화 없음(±
          {(PVM_SIG_RULES.overallFlatPct * 100).toFixed(0)}% 이내)
        </li>
      ) : (
        <li key="head" style={{ marginBottom: "7px", fontSize: "13px", lineHeight: 1.7 }}>
          전체 {ml} <strong>{pvmFmtMoney(cache.CPA1, cur, cur === "usd" ? 1 : undefined)} → {pvmFmtMoney(cache.CPA2, cur, cur === "usd" ? 1 : undefined)}</strong>{" "}
          {impactChip(cache.deltaCpa)}
        </li>
      ),
    );
    if (topChannel && pvmIsEntitySignificant(topChannel.contribution, cache.deltaCpa, cache.CPA2)) {
      headlineLines.push(
        <li key="ch" style={{ marginBottom: "7px", fontSize: "13px", lineHeight: 1.7 }}>
          <span style={{ color: "var(--text-muted)" }}>채널</span>{" "}
          <strong>{topChannel.key || "(미지정)"}</strong> {impactChip(topChannel.contribution, { prefix: ml })}
        </li>,
      );
    }
    if (topCampaign && pvmIsEntitySignificant(topCampaign.contribution, cache.deltaCpa, cache.CPA2)) {
      headlineLines.push(
        <li key="cmp" style={{ marginBottom: "7px", fontSize: "13px", lineHeight: 1.7 }}>
          <span style={{ color: "var(--text-muted)" }}>캠페인</span> {topChannel.key} ›{" "}
          <strong>{topCampaign.key || topCampaign.cmpKey || "(미지정)"}</strong>{" "}
          {impactChip(topCampaign.contribution, { prefix: ml })}
        </li>,
      );
    }
    if (topCreative && pvmIsEntitySignificant(topCreative.contribution, cache.deltaCpa, cache.CPA2)) {
      headlineLines.push(
        <li key="cr" style={{ marginBottom: "7px", fontSize: "13px", lineHeight: 1.7 }}>
          <span style={{ color: "var(--text-muted)" }}>소재</span>{" "}
          <strong>{topCreative.crKey || "(미지정)"}</strong>{" "}
          {impactChip(topCreative.contribution, { prefix: ml })}
        </li>,
      );
    }
  }

  // Top-mover 카드 노드
  const moverCard = (e, kind) => (
    <div className={`pvm-mover ${kind}`} key={kind}>
      <span className="ar">{kind === "up" ? "▲" : "▼"}</span>
      <div>
        <div className="mt">{kind === "up" ? `${ml} 가장 올린 요인` : `${ml} 가장 내린 요인`}</div>
        <div className="mn">{e.key || "(미지정)"}</div>
      </div>
      <span className="mv">
        {e.contribution >= 0 ? "+" : ""}
        {pvmFmtMoney(e.contribution, cur)}
      </span>
    </div>
  );

  // §2 표 행 렌더 (실제 layer1)
  const channelRows = ready
    ? [...cache.layer1].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    : [];
  const channelSigma = channelRows.reduce((a, e) => a + e.contribution, 0);

  // §3 캠페인 드릴 — 채널 선택
  const channelKeys = ready ? channelRows.map((e) => e.key) : [];
  const drillSel =
    drillChannel !== "__all__" && channelKeys.includes(drillChannel)
      ? drillChannel
      : channelKeys[0];
  const campaignRows =
    ready && cache.campaignMapped && drillSel != null
      ? cache.layer2
          .filter((f) => f.chKey === drillSel)
          .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      : [];
  // §3 Σ 검증 — 캠페인 기여합 = 선택 채널 기여
  const campaignSigma = campaignRows.reduce((a, e) => a + e.contribution, 0);
  const drillChContribution =
    ready && cache.campaignMapped && drillSel != null
      ? (channelRows.find((ch) => ch.key === drillSel)?.contribution ?? 0)
      : 0;

  // §4 소재 드릴 — index.html pvmCreativeDrilldownSection 이식
  const crIsAll = crChannel === "__all__";
  const crSelCh = crIsAll
    ? "__all__"
    : channelKeys.includes(crChannel)
      ? crChannel
      : channelKeys[0];

  // 캠페인 하위 셀렉터(cmpSelector) — 채널 선택 시에만 노출, layer3의 cmpKey 유니크로 목록 구성
  let campaignsInCh = [];
  let crSelCmp = null;
  if (ready && cache.creativeMapped && cache.campaignMapped && !crIsAll) {
    campaignsInCh = [
      ...new Set(cache.layer3.filter((f) => f.chKey === crSelCh).map((f) => f.cmpKey ?? "")),
    ];
    // crCampaign 이 현 채널의 캠페인 목록에 있을 때만 유효, 아니면 전체(null)
    crSelCmp = crCampaign != null && campaignsInCh.includes(crCampaign) ? crCampaign : null;
  }

  let creativeRows = [];
  if (ready && cache.creativeMapped) {
    if (crIsAll) {
      creativeRows = cache.layer3;
    } else if (crSelCmp == null && cache.campaignMapped) {
      creativeRows = cache.layer3.filter((f) => f.chKey === crSelCh);
    } else {
      creativeRows = cache.layer3.filter(
        (f) => f.chKey === crSelCh && (crSelCmp != null ? f.cmpKey === crSelCmp : true),
      );
    }
    creativeRows = [...creativeRows].sort(
      (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
    );
    if (showNew) {
      creativeRows = creativeRows.filter((e) => e.result1 === 0 && e.result2 > 0);
    }
  }

  // §4 Σ 검증 — 표시 소재 기여합 = 상위(전체/채널/캠페인) 기여
  const creativeSigma = creativeRows.reduce((a, e) => a + e.contribution, 0);
  const creativeParentContribution = !ready
    ? 0
    : crIsAll
      ? cache.deltaCpa
      : crSelCmp != null
        ? (cache.layer2.find((f) => f.chKey === crSelCh && f.cmpKey === crSelCmp)?.contribution ?? 0)
        : (cache.layer1.find((ch) => ch.key === crSelCh)?.contribution ?? 0);
  const creativeSigmaLabel = crIsAll
    ? "전체"
    : crSelCmp != null
      ? `${crSelCh} · ${crSelCmp || "(미지정)"}`
      : `${crSelCh} 채널`;

  // §4 페이지네이션 (20행/페이지) — index.html pvmPager 이식
  const CR_PER = 20;
  const crTotal = creativeRows.length;
  const crMaxPage = Math.max(1, Math.ceil(crTotal / CR_PER));
  const crCurPage = Math.min(Math.max(1, crPage), crMaxPage);
  const crStart = (crCurPage - 1) * CR_PER;
  const creativeRowsPage = creativeRows.slice(crStart, crStart + CR_PER);

  // 공유 표 행 렌더러 — index.html pvmTableRow 이식
  const renderRow = (e, level, keyId) => {
    const cost1 = e.cost1,
      cost2 = e.cost2;
    const result1 = e.result1,
      result2 = e.result2;
    const userCpa1 = result1 > 0 ? cost1 / result1 : null;
    const userCpa2 = result2 > 0 ? cost2 / result2 : null;
    const cpa1Str = userCpa1 !== null ? pvmFmtMoney(userCpa1, cur, cur === "usd" ? 1 : undefined) : "—";
    const cpa2Str = userCpa2 !== null ? pvmFmtMoney(userCpa2, cur, cur === "usd" ? 1 : undefined) : "—";
    const share1Str = (e.s1 * 100).toFixed(1) + "%";
    const share2Str = (e.s2 * 100).toFixed(1) + "%";
    const mixStr = (e.mix >= 0 ? "+" : "") + pvmFmtMoney(e.mix, cur);
    const rateStr = (e.rate >= 0 ? "+" : "") + pvmFmtMoney(e.rate, cur);

    let subMixVal = 0,
      subRateVal = 0;
    let subMixNode, subRateNode;
    if (level === "channel") {
      subMixVal = e.cmpSumMix || 0;
      subRateVal = e.cmpSumRate || 0;
    } else if (level === "campaign") {
      subMixVal = e.creativeSumMix || 0;
      subRateVal = e.creativeSumRate || 0;
    }
    if (level === "creative") {
      subMixNode = <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>— (최하위 레벨)</span>;
      subRateNode = <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>— (최하위 레벨)</span>;
    } else {
      subMixNode = (subMixVal >= 0 ? "+" : "") + pvmFmtMoney(subMixVal, cur);
      subRateNode = (subRateVal >= 0 ? "+" : "") + pvmFmtMoney(subRateVal, cur);
    }

    const impactStr = (e.contribution >= 0 ? "+" : "") + pvmFmtMoney(e.contribution, cur);
    const diagText = pvmGenerateDiagnosis(e, level, (v) => pvmFmtMoney(v, cur));

    let nameNode;
    let isNew = false;
    if (level === "creative") {
      const safeUrl = cache.crUrlMap ? pvmSafeUrl(cache.crUrlMap.get(String(e.crKey ?? ""))) : null;
      isNew = e.result1 === 0 && e.result2 > 0;
      const breadcrumb = cache.campaignMapped
        ? `${e.chKey} › ${e.cmpKey || "(미지정)"}`
        : `${e.chKey}`;
      // "New" 배지는 이름 옆이 아니라 테이블 맨 앞 전용 컬럼으로 분리(#3) — 이름 문자열
      // 자체(e.crKey)는 이모지 없이 그대로 유지되므로 정렬 시 항상 깨끗한 값 기준.
      nameNode = (
        <>
          <span style={{ fontSize: "10px", color: "var(--text-muted)", display: "block", marginBottom: "2px" }}>{breadcrumb}</span>
          <strong style={{ verticalAlign: "middle" }}>{e.crKey || "(미지정)"}</strong>
          {safeUrl && (
            <a href={safeUrl} target="_blank" rel="noopener noreferrer" title="소재 링크 열기" style={{ textDecoration: "none", fontSize: "11px", marginLeft: "4px", verticalAlign: "middle" }}>🔗</a>
          )}
        </>
      );
    } else if (level === "campaign") {
      nameNode = e.key || e.cmpKey || "(미지정)";
    } else {
      nameNode = e.key || "(미지정)";
    }

    return (
      <tr key={keyId}>
        {level === "creative" && (
          <td className="tnum" style={{ whiteSpace: "nowrap", textAlign: "center" }} title={isNew ? "신규 소재(이전 기간 0건 → 현재 1건 이상)" : ""}>
            {isNew ? "🆕" : ""}
          </td>
        )}
        <td style={{ whiteSpace: "nowrap" }}>{nameNode}</td>
        <td className="tnum" style={{ whiteSpace: "nowrap" }}>{pvmFmtMoney(cost1, cur)} → {pvmFmtMoney(cost2, cur)}</td>
        <td className="tnum" style={{ whiteSpace: "nowrap" }}>{cpa1Str} → {cpa2Str}</td>
        <td className="tnum" style={{ whiteSpace: "nowrap" }}>{share1Str} → {share2Str}</td>
        <td className="tnum" style={{ whiteSpace: "nowrap", color: pvmColor(e.mix) }}>{mixStr}</td>
        <td className="tnum" style={{ whiteSpace: "nowrap", color: pvmColor(e.rate) }}>{rateStr}</td>
        <td className="tnum" style={{ whiteSpace: "nowrap", color: pvmColor(subMixVal) }}>{subMixNode}</td>
        <td className="tnum" style={{ whiteSpace: "nowrap", color: pvmColor(subRateVal) }}>{subRateNode}</td>
        <td style={{ textAlign: "center", whiteSpace: "nowrap", position: "relative" }}>
          <span className="pvm-diag-icon" tabIndex={0} style={{ cursor: "help", fontSize: "14px", opacity: 0.7 }} data-tip={diagText}>💡</span>
        </td>
        <td className="tnum" style={{ whiteSpace: "nowrap" }}>
          <strong style={{ color: pvmColor(e.contribution) }}>{impactStr}</strong>
        </td>
      </tr>
    );
  };

  const headerWithName = (name, withNewCol) => (
    <tr>
      {withNewCol && <th className="tnum" title="신규 소재(이전 기간 0건 → 현재 1건 이상)">New</th>}
      <th>{name}</th>
      <th>COST (P1→P2)</th>
      <th>{ml} (P1→P2)</th>
      <th title="전체 결과(전환) 건수 중 이 항목이 차지하는 비중 — 비용 비중이 아닙니다.">결과 비중 (P1→P2)</th>
      <th title="순수 이동 효과 (Macro Mix)">MIX (순수 이동)</th>
      <th title="순수 단가 변동 (Rate)">RATE (순수 단가)</th>
      <th title="하위 세그먼트 합산 믹스 효과">MIX (하위합)</th>
      <th title="하위 세그먼트 합산 레이트 효과">RATE (하위합)</th>
      <th>진단</th>
      <th>{ml} 영향</th>
    </tr>
  );

  // 기간 캡션
  const periodCaption = ready
    ? `기준 ${cache.p1Range[0]}~${cache.p1Range[1]} (P1) vs 현재 ${cache.p2Range[0]}~${cache.p2Range[1]} (P2)${
        cache.p2DaysCovered < 7 ? ` · ⚠ 현재 기간 ${cache.p2DaysCovered}일만 집계됨(미완결 주)` : ""
      }`
    : "";

  // 스코어카드 브릿지 값
  const bridge = (v1, v2, colored) => {
    const d = v2 - v1;
    const pct = v1 ? (d / v1) * 100 : 0;
    const arr = d > 0 ? "▲" : d < 0 ? "▼" : "—";
    const sign = d >= 0 ? "+" : "";
    const cls = !colored ? "flat" : d > 0 ? "up" : d < 0 ? "down" : "flat";
    return { d, pct, arr, sign, cls };
  };

  return (
    <div className="tab-pane active" id="tab-pvm">
      <ToolPageShell
        title="캠페인 성과 변동"
        chips={<span className="chip"><span className="dot"></span>도구 · 캠페인 성과 변동 탐지</span>}
        summary={
          <>
            <p>
              Price-Volume-Mix(PVM) Bridge 분해로 전체 {ml} 변화를 채널·캠페인·소재 단위로 정확히 나눕니다(잔차 없음).
            </p>
            <details style={{ marginTop: "6px", fontSize: "11.5px", color: "var(--text-secondary)", cursor: "pointer" }}>
              <summary>⚠️ 해석 한계 펼치기</summary>
              <div style={{ marginTop: "6px", padding: "8px 10px", background: "var(--bg-1)", borderLeft: "3px solid var(--primary)", lineHeight: 1.6 }}>
                이 분해는 산술적으로 정확하지만 인과관계를 증명하지 않습니다(association). 채널×캠페인×소재 최소 단위에서 한 번 분해 후 합산하므로 §2(채널)·§3(캠페인)·§4(소재)는 항상 정확히 중첩됩니다(Σ 일치).
              </div>
            </details>
          </>
        }
        toc={PVM_TOC}
        stickyFilter={<DashboardFilterBar />}
      >
      {/* §0 한눈에 보기 */}
      <section
        className="block"
        id="s-pvm-result"
        style={{ background: "linear-gradient(135deg,rgba(122,162,247,0.12),rgba(192,132,252,0.05))", border: "1px solid rgba(122,162,247,0.25)", borderRadius: "14px", padding: "18px 20px" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}><span className="ix">§0</span>한눈에 보기</h2>
          <button className="ab-pill" title="이 분석의 모든 표·비교 데이터를 CSV로 내려받기" disabled={!ready} onClick={downloadPvmCsv}>⬇ 결과 다운받기</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "10px", marginTop: "1rem" }}>
          {bothMetricsMapped !== false && (
            <div className="ab-pillgroup">
              <span className="ab-pillgroup-label">지표</span>
              <button className={`ab-pill ${metric === "cpa" ? "active" : ""}`} onClick={() => setMetric("cpa")}>CPA</button>
              <button className={`ab-pill ${metric === "cpi" ? "active" : ""}`} onClick={() => setMetric("cpi")}>CPI</button>
            </div>
          )}
          <div className="ab-pillgroup">
            <span className="ab-pillgroup-label">기준 주</span>
            <button className={`ab-pill ${weekBasis === "calendar" ? "active" : ""}`} onClick={() => setWeekBasis("calendar")}>마감주(월~일)</button>
            <button className={`ab-pill ${weekBasis === "rolling7" ? "active" : ""}`} onClick={() => setWeekBasis("rolling7")}>최근 7일</button>
          </div>
          <div className="ab-pillgroup">
            <span className="ab-pillgroup-label">비교 기준</span>
            {[1, 2, 3].map((lb) => {
              const locked = cache?.lockState?.[lb];
              return (
                <button
                  key={lb}
                  className={`ab-pill ${lookback === lb && !locked ? "active" : ""}`}
                  disabled={!!locked}
                  title={locked ? "데이터가 더 필요합니다" : ""}
                  style={{ opacity: locked ? 0.5 : 1, cursor: locked ? "default" : "pointer" }}
                  onClick={() => !locked && setLookback(lb)}
                >
                  {locked ? "🔒 " : ""}{lb === 1 ? "직전주" : lb === 2 ? "2주전" : "3주전"}
                </button>
              );
            })}
          </div>
          <div className="ab-pillgroup">
            <span className="ab-pillgroup-label">표시 단위</span>
            <button className={`ab-pill ${currency === "krw" ? "active" : ""}`} onClick={() => setCurrency("krw")}>₩</button>
            <button className={`ab-pill ${currency === "usd" ? "active" : ""}`} onClick={() => setCurrency("usd")}>$</button>
          </div>
        </div>

        {periodCaption && (
          <p style={{ margin: "8px 0 0", fontSize: "11.5px", color: "var(--text-muted)" }}>{periodCaption}</p>
        )}

        {ready && (upMover || downMover) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", margin: "12px 0 4px" }}>
            {upMover && moverCard(upMover, "up")}
            {downMover && moverCard(downMover, "down")}
          </div>
        )}

        {ready ? (
          <ul style={{ margin: "12px 0 10px", padding: 0, listStyle: "none" }}>{headlineLines}</ul>
        ) : (
          <div className="callout warn" style={{ marginTop: "12px" }}>
            <div className="ico">!</div>
            <div className="body">
              <strong>데이터 부족</strong>
              <p>{cache?.message || "채널·비용·결과(설치/액션)·날짜 컬럼을 매핑하고 최소 2주치 데이터를 업로드하세요."}</p>
            </div>
          </div>
        )}
        <div className="callout warn" style={{ marginTop: "6px" }}>
          <div className="ico">!</div>
          <div className="body" style={{ fontSize: "11.5px" }}>association(연관)일 뿐 인과를 증명하지 않습니다. 채널·캠페인·소재 모두 최소 단위(채널×캠페인×소재)에서 한 번 분해 후 합산해 §2~§4(모드A)는 항상 정확히 중첩됩니다.</div>
        </div>
      </section>

      {/* §1 스코어카드 */}
      <section className="block" id="s-pvm-scorecard">
        <h2 className="section-title"><span className="ix">§1</span>스코어카드</h2>
        {ready ? (
          <>
            {(() => {
              const b = bridge(cache.Cost1, cache.Cost2, false);
              return (
                <div className="pvm-bridge">
                  <span className="bl">COST</span>
                  <div className="flow"><span className="p1">{pvmFmtMoney(cache.Cost1, cur)}</span><span className="arr">→</span><span>{pvmFmtMoney(cache.Cost2, cur)}</span></div>
                  <span className={`pvm-chip ${b.cls}`} style={{ marginLeft: "auto" }}>{b.arr} {b.sign}{pvmFmtMoney(b.d, cur)} ({b.sign}{Math.abs(b.pct) < 0.05 ? "0" : b.pct.toFixed(1)}%)</span>
                </div>
              );
            })()}
            {(() => {
              const b = bridge(cache.CPA1, cache.CPA2, true);
              return (
                <div className="pvm-bridge">
                  <span className="bl">{ml}</span>
                  <div className="flow"><span className="p1">{pvmFmtMoney(cache.CPA1, cur, cur === "usd" ? 1 : undefined)}</span><span className="arr">→</span><span>{pvmFmtMoney(cache.CPA2, cur, cur === "usd" ? 1 : undefined)}</span></div>
                  <span className={`pvm-chip ${b.cls}`} style={{ marginLeft: "auto" }}>{b.arr} {b.sign}{pvmFmtMoney(b.d, cur)} ({b.sign}{Math.abs(b.pct) < 0.05 ? "0" : b.pct.toFixed(1)}%)</span>
                </div>
              );
            })()}
            <p style={{ marginTop: "8px", fontSize: "11.5px", color: "var(--text-muted)" }}>{periodCaption}</p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: "12px" }}>분석 가능한 데이터가 없습니다.</p>
        )}
      </section>

      {/* §2 채널별 결과 */}
      <section className="block" id="s-pvm-channels">
        <h2 className="section-title"><span className="ix">§2</span>채널별 결과</h2>

        <details className="block" style={{ padding: "11px 14px", marginBottom: "10px", background: "var(--bg-2)", borderRadius: "10px" }}>
          <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "var(--text-2)", outline: "none" }}>❓ Mix · Rate · {ml} 영향이 뭔가요? (펼치기)</summary>
          <div style={{ marginTop: "10px", fontSize: "12px", lineHeight: 1.7, color: "var(--text-muted)" }}>
            전체 {ml} 변동을 잔차 없이 두 원인으로 쪼갠 값입니다.
            <ul style={{ margin: "8px 0 4px", paddingLeft: "18px" }}>
              <li><strong>Mix(비중 효과)</strong> — 예산 비중이 평균보다 비싼/싼 채널로 옮겨가며 생긴 변화.</li>
              <li><strong>Rate(효율 효과)</strong> — 채널 자체 {ml}가 변해서 생긴 변화.</li>
              <li><strong>{ml} 영향 = Mix + Rate</strong> — 그 항목이 전체 {ml}를 실제로 몇 원 움직였나.</li>
            </ul>
          </div>
        </details>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", marginBottom: "14px" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-2)" }}>{ml} 브릿지 — 지난주 전체 → 채널 기여(±) → 이번주 전체</span>
              <button className="ab-pill" title="PNG 다운로드" onClick={() => downloadChartPng(chartPvmWaterfall, "pvm_waterfall")}>⬇ PNG</button>
            </div>
            <div className="chart-container" style={{ height: "260px" }}><canvas id="pvm-waterfall" ref={chartPvmWaterfall}></canvas></div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-2)" }}>채널별 Mix·Rate 분해</span>
              <button className="ab-pill" title="PNG 다운로드" onClick={() => downloadChartPng(chartPvmTrend, "pvm_channel_stack")}>⬇ PNG</button>
            </div>
            <div className="chart-container" style={{ height: "260px" }}><canvas id="pvm-channel-stack" ref={chartPvmTrend}></canvas></div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data" style={{ fontSize: "11.5px" }}>
            <thead>{headerWithName("채널")}</thead>
            <tbody>
              {channelRows.length ? (
                channelRows.map((e) => renderRow(e, "channel", e.key))
              ) : (
                <tr><td colSpan="10" style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>데이터가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {ready && channelRows.length > 0 && (
          <div className="callout ok" style={{ marginTop: "10px" }}>
            <div className="ico">✓</div>
            <div className="body">
              <strong>Σ {ml} 영향 = 전체 Δ{ml}</strong>
              <p style={{ fontSize: "11.5px", color: "var(--text-muted)", marginTop: "2px" }}>{pvmFmtMoney(channelSigma, cur)} = {pvmFmtMoney(cache.deltaCpa, cur)} (잔차 없음)</p>
            </div>
          </div>
        )}
      </section>

      {/* §3 채널·캠페인별 결과 */}
      <section className="block" id="s-pvm-campaigns">
        <h2 className="section-title"><span className="ix">§3</span>채널·캠페인별 결과</h2>
        {!ready ? (
          <p className="muted" style={{ fontSize: "12px" }}>분석 가능한 데이터가 없습니다.</p>
        ) : !cache.campaignMapped ? (
          <div className="callout warn"><div className="ico">!</div><div className="body"><strong>🔒 campaign_id 컬럼을 매핑하면 캠페인 단계를 볼 수 있습니다</strong></div></div>
        ) : (
          <>
            <div className="ab-pillgroup" style={{ marginBottom: "10px" }}>
              <span className="ab-pillgroup-label">채널</span>
              {channelRows.map((ch) => (
                <button key={ch.key} className={`ab-pill ${ch.key === drillSel ? "active" : ""}`} onClick={() => setDrillChannel(ch.key)}>{ch.key || "(미지정)"}</button>
              ))}
            </div>
            <div className="table-wrap">
              <table className="data" style={{ fontSize: "11.5px" }}>
                <thead>{headerWithName("캠페인")}</thead>
                <tbody>
                  {campaignRows.length ? (
                    campaignRows.map((e) => renderRow(e, "campaign", `${e.chKey}|${e.key}`))
                  ) : (
                    <tr><td colSpan="10" style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>데이터가 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {campaignRows.length > 0 && (
              <div className="callout ok" style={{ marginTop: "10px" }}>
                <div className="ico">✓</div>
                <div className="body">
                  <strong>Σ = {drillSel || "(미지정)"} 채널 {ml} 영향</strong>
                  <p style={{ fontSize: "11.5px", color: "var(--text-muted)", marginTop: "2px" }}>{pvmFmtMoney(campaignSigma, cur)} = {pvmFmtMoney(drillChContribution, cur)}</p>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* §4 소재별 결과 */}
      <section className="block" id="s-pvm-creatives">
        <h2 className="section-title"><span className="ix">§4</span>소재별 결과</h2>
        {!ready ? (
          <p className="muted" style={{ fontSize: "12px" }}>분석 가능한 데이터가 없습니다.</p>
        ) : !cache.creativeMapped ? (
          <div className="callout warn"><div className="ico">!</div><div className="body"><strong>🔒 creative_id 컬럼을 매핑하면 소재 단계를 볼 수 있습니다</strong></div></div>
        ) : (
          <>
            <div className="ab-pillgroup" style={{ marginBottom: "8px" }}>
              <span className="ab-pillgroup-label">채널</span>
              <button className={`ab-pill ${crIsAll ? "active" : ""}`} onClick={() => { setCrChannel("__all__"); setCrCampaign(null); setCrPage(1); }}>전체</button>
              {channelRows.map((ch) => (
                <button key={ch.key} className={`ab-pill ${!crIsAll && ch.key === crSelCh ? "active" : ""}`} onClick={() => { setCrChannel(ch.key); setCrCampaign(null); setCrPage(1); }}>{ch.key || "(미지정)"}</button>
              ))}
            </div>
            {cache.campaignMapped && !crIsAll && (
              <div className="ab-pillgroup" style={{ marginBottom: "10px" }}>
                <span className="ab-pillgroup-label">캠페인</span>
                <button className={`ab-pill ${crSelCmp === null ? "active" : ""}`} onClick={() => { setCrCampaign(null); setCrPage(1); }}>전체</button>
                {campaignsInCh.map((cmp) => (
                  <button key={cmp} className={`ab-pill ${cmp === crSelCmp ? "active" : ""}`} onClick={() => { setCrCampaign(cmp || null); setCrPage(1); }}>{cmp || "(미지정)"}</button>
                ))}
              </div>
            )}
            <div className="table-wrap">
              <table className="data" style={{ fontSize: "11.5px" }}>
                <thead>{headerWithName("소재", true)}</thead>
                <tbody>
                  {creativeRowsPage.length ? (
                    creativeRowsPage.map((e, i) => renderRow(e, "creative", `${e.chKey}|${e.cmpKey}|${e.crKey}|${crStart + i}`))
                  ) : (
                    <tr><td colSpan="11" style={{ textAlign: "center", padding: "16px", color: "var(--text-muted)" }}>표시할 소재가 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {crTotal > CR_PER && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "flex-end", marginTop: "8px", fontSize: "11.5px", color: "var(--text-muted)" }}>
                <span>{crStart + 1}–{Math.min(crCurPage * CR_PER, crTotal)} / {crTotal.toLocaleString()}행</span>
                <button className="ab-pill" disabled={crCurPage <= 1} style={{ opacity: crCurPage <= 1 ? 0.4 : 1, cursor: crCurPage <= 1 ? "default" : "pointer" }} onClick={() => setCrPage((p) => Math.max(1, p - 1))}>← 이전</button>
                <button className="ab-pill" disabled={crCurPage >= crMaxPage} style={{ opacity: crCurPage >= crMaxPage ? 0.4 : 1, cursor: crCurPage >= crMaxPage ? "default" : "pointer" }} onClick={() => setCrPage((p) => Math.min(crMaxPage, p + 1))}>다음 →</button>
              </div>
            )}
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--text-muted)", marginBottom: "10px", cursor: "pointer", marginTop: "10px" }}>
              <input type="checkbox" checked={showNew} onChange={(e) => { setShowNew(e.target.checked); setCrPage(1); }} /> 🆕 신규 소재만 보기(이전 기간 0건 → 현재 1건 이상)
            </label>
            <div className="callout ok" style={{ marginTop: "6px" }}>
              <div className="ico">✓</div>
              <div className="body">
                <strong>Σ = {creativeSigmaLabel} {ml} 영향</strong>
                <p style={{ fontSize: "11.5px", color: "var(--text-muted)", marginTop: "2px" }}>{pvmFmtMoney(creativeSigma, cur)} = {pvmFmtMoney(creativeParentContribution, cur)}</p>
              </div>
            </div>
          </>
        )}
      </section>
      </ToolPageShell>
    </div>
  );
}
