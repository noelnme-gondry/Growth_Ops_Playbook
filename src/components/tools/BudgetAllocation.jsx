"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { ALLOC_MATH } from "@/utils/allocationMath";
import { getMappedRows, effectiveDenomBasis } from "@/utils/dashboardAggregator";
import CsvUploader from "@/components/CsvUploader";
import BasisCurrencyToggleBar from "@/components/dashboard/BasisCurrencyToggleBar";
import ToolPageShell from "@/components/ToolPageShell";
import { chartCommonOpts, getCssVar } from "@/utils/chartUtils";
import { showToast } from "@/utils/toast";
import {
  getRowGroupKey,
  allocParseNum,
  allocFmtNum,
  calcChannelHistorySummary,
  calculateAllocationModeC,
  calculateAllocationModeB,
  computeAllocSummary,
  computeAllocScenarios,
} from "@/utils/budgetAllocTool";

const CHART_THEME = {
  text: "#9CA3AF",
  textPrimary: "#F9FAFB",
  muted: "#6B7280",
  grid: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.08)",
  primary: "#adc6ff",
  primaryContainer: "#4d8eff",
  secondary: "#4cd7f6",
  series: [
    "#adc6ff",
    "#4cd7f6",
    "#f7b955",
    "#5ad19a",
    "#c792ea",
    "#ff8a8a",
    "#7fcfff",
    "#ffcb6b",
  ],
  surface: "#0d0e0f",
};

const CURRENCY_SYMBOLS = { KRW: "₩", USD: "$" };

/* objective → 내부 metric 매핑 + 라벨/방향 (index.html ALLOC_OBJECTIVES 이식) */
const ALLOC_OBJECTIVES = {
  install: { metric: "installs", label: "Install · CPI 최적화", short: "CPI", arrow: "↓", desc: "낮을수록 긍정 (싸게 설치 1개)" },
  action: { metric: "actions", label: "Action · CPA 최적화", short: "CPA", arrow: "↓", desc: "낮을수록 긍정 (싸게 액션 1개)" },
  roas: { metric: "revenue_d7", label: "Revenue · ROAS 최적화", short: "ROAS", arrow: "↑", desc: "높을수록 긍정 (Revenue/Cost)" },
};

/* 이상치 제거 강도 → numeric 임계값 (index.html OUTLIER_STRENGTH 이식) */
const OUTLIER_STRENGTH = {
  iqr: { standard: 1.5, strong: 1.0, very_strong: 0.5 },
  modz: { standard: 3.5, strong: 2.5, very_strong: 2.0 },
};
function getOutlierOpts(method, strength) {
  if (method === "iqr") return { iqrMult: OUTLIER_STRENGTH.iqr[strength] ?? 1.5 };
  if (method === "modz") return { modzThreshold: OUTLIER_STRENGTH.modz[strength] ?? 3.5 };
  return {};
}

/* index.html fmtCurrency 이식 — 통화 토글은 기호/소수 자리수만 바꿈(FX 변환 없음:
   CSV 값은 이미 특정 통화 기준이라 relabel만이 정직). metric=true면 USD 소수 1자리. */
function fmtCurrency(value, currency, opts = {}) {
  if (value == null || isNaN(value) || !isFinite(value)) return "—";
  const sym = CURRENCY_SYMBOLS[currency] || "₩";
  const isUSD = currency === "USD";
  const decimals = isUSD && opts.metric ? 1 : 0;
  return `${sym}${Number(value).toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function isRoasMetric(metric) {
  return metric === "revenue_d7";
}
/* 내부 CPR(cost/result)을 표시용 값으로: ROAS면 1/CPR(=매출/비용), 아니면 CPR 그대로. */
function fmtCostMetric(cprValue, metric, currency) {
  if (cprValue == null || !isFinite(cprValue)) return "—";
  if (isRoasMetric(metric)) {
    const roas = cprValue > 0 ? 1 / cprValue : null;
    return roas == null ? "—" : (roas * 100).toFixed(1) + "%";
  }
  return fmtCurrency(cprValue, currency, { metric: true });
}

function getMetricUnitLabel(metric) {
  if (metric === "installs") return "설치";
  if (metric === "actions") return "액션";
  if (metric === "pu_d7") return "결제";
  if (metric === "revenue_d7") return "매출";
  return "결과";
}

function getCostMetricLabel(metric) {
  if (metric === "installs") return "CPI";
  if (metric === "actions") return "CPA";
  if (metric === "pu_d7") return "CPA";
  if (metric === "revenue_d7") return "ROAS";
  return "CPR";
}

/* 내부 CPR → 표시용 metric 값. ROAS면 1/CPR(배수), 아니면 CPR 그대로. */
function displayMetricValue(cprValue, metric) {
  if (cprValue == null || !isFinite(cprValue)) return null;
  if (isRoasMetric(metric)) return cprValue > 0 ? 1 / cprValue : null;
  return cprValue;
}

function formatNumberK(n, decimals = 0) {
  if (n == null || isNaN(n) || !isFinite(n)) return "—";
  return Number(n).toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/* 채널별 (cost, CPR=cost/result) 포인트 맵. cost>0 & result>0만.
   이 도구는 creative/adgroup 분해를 하지 않으므로, CSV가 하위 grain이면 사용 grain(unit)×날짜로
   먼저 sum 후 점 1개 생성 (per-row 점 = creative 단위로 찍히는 버그 방지). */
function buildByChannel(rows, unit, metric) {
  const agg = new Map(); // ch -> Map(dateKey -> {cost, res, date})
  for (const r of rows) {
    const ch = getRowGroupKey(r, unit);
    if (!ch) continue;
    const cost = Number(r.cost) || 0;
    const res = Number(r[metric]) || 0;
    const dateKey = r.date != null && r.date !== "" ? String(r.date) : "__nodate__";
    if (!agg.has(ch)) agg.set(ch, new Map());
    const byDate = agg.get(ch);
    if (!byDate.has(dateKey)) byDate.set(dateKey, { cost: 0, res: 0, date: r.date });
    const e = byDate.get(dateKey);
    e.cost += cost;
    e.res += res;
  }
  const m = new Map();
  for (const [ch, byDate] of agg) {
    const pts = [];
    for (const e of byDate.values()) {
      if (e.cost <= 0 || e.res <= 0) continue; // 합산 후 필터
      pts.push({ x: e.cost, y: e.cost / e.res, date: e.date });
    }
    if (pts.length) m.set(ch, pts);
  }
  return m;
}

/* 채널 포인트 → outlier 제거 + (최근 가중치) → fitBest → wrapper.
   index.html getCachedModels 이식. adv = {trendType, outlierMethod, outlierStrength, weightMode, halfLifeDays}.
   trendType="auto"면 R² 최적, 아니면 지정 타입 강제 적합. */
const TREND_TYPE_LABEL = { linear: "Linear", log: "Log", poly2: "Poly2", power: "Power" };
function fitChannel(pts, adv) {
  const method = adv?.outlierMethod ?? "iqr";
  const outOpts = getOutlierOpts(method, adv?.outlierStrength ?? "standard");
  const { kept } = ALLOC_MATH.removeOutliers(pts, method, outOpts);
  if (!kept || kept.length < 2) return null;
  const trainData = kept.map((p) => [p.x, p.y]);
  const dates = kept.map((p) => p.date);
  const datesParsed = dates.map((d) => (d ? Date.parse(d) : NaN)).filter((t) => !isNaN(t));
  const maxDate = datesParsed.length ? Math.max(...datesParsed) : null;
  const weights =
    adv && adv.weightMode && adv.weightMode !== "none" && maxDate
      ? ALLOC_MATH.calcDateWeights(dates, adv.weightMode, maxDate, adv.halfLifeDays ?? 30)
      : null;
  const wt = adv?.trendType && adv.trendType !== "auto" ? adv.trendType : "auto";
  let model = null;
  if (wt === "auto") {
    model = ALLOC_MATH.fitBest(trainData, weights);
  } else {
    // 지정 타입 강제: fitBest는 auto라 개별 fit 후 wrapper 필요 → fitBest로 뽑고 type 검사
    const best = ALLOC_MATH.fitBest(trainData, weights);
    model = best && best.type === TREND_TYPE_LABEL[wt] ? best : (ALLOC_MATH[`fit${TREND_TYPE_LABEL[wt]}`] ? ALLOC_MATH[`fit${TREND_TYPE_LABEL[wt]}`](trainData, weights) : best);
  }
  if (!model) return null;
  const xs = kept.map((p) => p.x);
  return {
    model,
    kept,
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    poly2Shape: ALLOC_MATH.detectPoly2Shape(model),
  };
}
function buildModels(byChannel, adv) {
  const models = new Map();
  for (const [ch, pts] of byChannel) {
    models.set(ch, fitChannel(pts, adv));
  }
  return models;
}

/* 산점도(점+추세선) Chart.js datasets 빌더 — Step2(단일 단위) · Step3(다중 채널) 공유.
   index.html renderAllocatorScatter 이식(§7 render-throw는 주입식 harness 대신 두 호출부 모두 이 함수를 거치므로
   여기서 한 번만 검증하면 됨). perAdv(ch)로 채널/단위별 trendType override를 줄 수 있음(Step2 개별 모델 선택). */
function buildScatterDatasets(channels, byCh, adv, { hidePoints, normalizeMode: nmode, perAdv, colorOf } = {}) {
  const datasets = [];
  const trendInfo = [];
  channels.forEach((ch, i) => {
    const pts = byCh.get(ch) || [];
    if (pts.length < 2) return;

    const color = colorOf ? colorOf(ch, i) : CHART_THEME.series[i % CHART_THEME.series.length];
    const chAdv = perAdv ? perAdv(ch) : adv;

    const fit = fitChannel(pts, chAdv);
    const kept = fit ? fit.kept : pts;
    if (kept.length < 2) return;

    const nctx = ALLOC_MATH.calcNormContext(kept, nmode);
    const norm = (x, y) => ALLOC_MATH.normalizeXY(x, y, nmode, nctx);

    if (!hidePoints) {
      const ptData = kept
        .map((p) => norm(p.x, p.y))
        .filter((v) => v && isFinite(v.x) && isFinite(v.y));
      datasets.push({
        label: `${ch} (Points)`,
        data: ptData,
        backgroundColor: color,
        borderColor: "#0d0e0f",
        borderWidth: 1.5,
        pointRadius: 5,
        pointStyle: "circle",
        showLine: false,
      });
    }

    if (fit && fit.model) {
      const { model, xMin, xMax } = fit;
      const trendPts = [];
      const steps = 50;
      const stepSize = (xMax - xMin) / steps;
      for (let j = 0; j <= steps; j++) {
        const x = xMin + j * stepSize;
        const y = model.predict(x);
        if (isFinite(y) && y > 0) {
          const nv = norm(x, y);
          if (nv && isFinite(nv.x) && isFinite(nv.y)) trendPts.push(nv);
        }
      }
      datasets.push({
        label: `${ch} · ${model.type}`,
        data: trendPts,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 2,
        pointRadius: 0,
        type: "line",
        fill: false,
        tension: 0,
        showLine: true,
      });
      trendInfo.push({ ch, model, fit });
    } else {
      trendInfo.push({ ch, model: null, fit: null });
    }
  });
  return { datasets, trendInfo };
}

/* multi-select Set 토글 (전체=null). value 클릭 시 add/remove, 전부 선택되면 null(=전체)로 정규화. */
function toggleInSet(prev, value, allValues) {
  const cur = prev ? new Set(prev) : new Set(allValues);
  if (cur.has(value)) cur.delete(value);
  else cur.add(value);
  if (cur.size === 0) return new Set(); // 명시 0개 (전체와 구분)
  if (cur.size === allValues.length) return null; // 전체 → null
  return cur;
}


export default function BudgetAllocation() {
  const csvData = useAppStore((state) => state.csvData);
  // 전역 분모 기준(설치/가입) — 효율 계열 도구(5-2/5-21/5-22/5-3)가 공유(§12.18).
  const denomBasis = useAppStore((state) => state.denomBasis);
  const [step, setStep] = useState(1);
  const [unitField, setUnitField] = useState("channel");

  const [simMode, setSimMode] = useState("auto"); // auto | manual
  const [budgetPeriod, setBudgetPeriod] = useState("daily"); // daily | monthly
  const [budget, setBudget] = useState("");
  const [budgetAutoDefaulted, setBudgetAutoDefaulted] = useState(false); // 최초 진입 시 최근 일예산 합계로 1회 채움
  const [recentDays, setRecentDays] = useState(7);
  const [allocMode, setAllocMode] = useState("c"); // c | b
  // 표시 통화(₩/$) — 전역 store가 SSOT(상단 sticky 토글바와 공유). 로컬 useState 분리가
  // 전역 토글 클릭을 무시하던 버그(PVM/MarketingEfficiency에서도 있었던 §12.18류 재발) 수정.
  const currency = useAppStore((state) => state.displayCurrency);
  const setCurrency = useAppStore((state) => state.setDisplayCurrency);
  const [extrapolateMode, setExtrapolateMode] = useState("1.3"); // 그리디 외삽 한도 "1.0"|"1.3"|"1.5"|"fallback"
  const [recalcTick, setRecalcTick] = useState(0); // 재계산 버튼 트리거

  // 최적화 목표 (필수) — metric을 파생. install|action|roas
  const [objective, setObjective] = useState(null);
  // 국가/채널/OS 필터 (Step 1 위저드)
  const [selectedCountries, setSelectedCountries] = useState(null); // null=전체, Set
  const [selectedChannelsFilter, setSelectedChannelsFilter] = useState(null); // null=전체, Set
  const [platformFilter, setPlatformFilter] = useState("all"); // all|android|ios

  // 고급 추세선 컨트롤 (Step 2/3 상세 설정)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [trendType, setTrendType] = useState("auto"); // auto|linear|log|poly2|power
  const [weightMode, setWeightMode] = useState("none"); // none|linear|exponential
  const [outlierMethod, setOutlierMethod] = useState("iqr"); // none|iqr|modz
  const [outlierStrength, setOutlierStrength] = useState("standard"); // standard|strong|very_strong
  const [normalizeMode, setNormalizeMode] = useState("raw"); // raw|log|minmax|robust (차트 표시 전용)
  const [hidePoints, setHidePoints] = useState(false); // 추세선만 표시
  // 차트 표시 대상 채널 (예산 분배와 무관, 차트에만). null=자동 상위6, Set=명시
  const [chartChannels, setChartChannels] = useState(null);

  // 수동 override(잠금)·Min/Max 제약 (channel → number). index.html ALLOC_STATE 이식.
  const [allocOverrides, setAllocOverrides] = useState({}); // 잠긴 채널 { ch: cost }
  const [allocMinSpend, setAllocMinSpend] = useState({}); // { ch: minSpend }
  const [allocMaxSpend, setAllocMaxSpend] = useState({}); // { ch: maxSpend }
  // 라이브 콤마 입력 편집용 draft (blur/change 전까지 표시값)
  const [costDrafts, setCostDrafts] = useState({}); // { ch: "1,234" }

  // Step 2 검증(추세선 검증) 상태 — index.html ALLOC_STATE.verifySelectedGroup/groupModels/groupVerification 이식.
  const [verifySelectedGroup, setVerifySelectedGroup] = useState(null); // 좌측 목록에서 선택된 단위
  const [groupModels, setGroupModels] = useState({}); // { unit: "linear"|"log"|"poly2"|"power" } — 단위별 모델 override
  const [groupVerification, setGroupVerification] = useState({}); // { unit: "verified" }

  const hasData = csvData?.raw?.length > 0;

  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const verifyChartRef = useRef(null);
  const verifyChartInstance = useRef(null);
  const scenarioChartRef = useRef(null);
  const scenarioChartInstance = useRef(null);
  const barChartRef = useRef(null);
  const barChartInstance = useRef(null);

  // 매핑된 표준 필드 감지
  const mappedKeys = useMemo(
    () =>
      new Set(
        Object.values(csvData?.mapping || {}).filter(
          (v) => v && v !== "__ignore__",
        ),
      ),
    [csvData?.mapping],
  );

  // 전역 분모 기준(설치/가입) → 해석된 basis(미매핑 자동 폴백) + 매칭 objective 키.
  // 가입(actions) 기준이면 기본 목표=Action(CPA), 설치면 Install(CPI). ROAS는 명시 선택 전용.
  const effBasis = useMemo(
    () => effectiveDenomBasis(csvData, denomBasis),
    [csvData, denomBasis],
  );
  const basisObjective = effBasis === "actions" ? "action" : "install";
  // install/action류 명시 목표는 기준과 같은 축이라 전역 토글을 그대로 따라감(렌더 중 파생 —
  // effect로 objective를 되써서 리렌더 유발하는 대신 표시/계산 양쪽에 이 값을 사용).
  // ROAS 등 기준과 무관한 목표만 그대로 유지.
  const effectiveObjective =
    objective === "install" || objective === "action" ? basisObjective : objective;

  // objective → metric. 미선택 시 전역 기준(설치/가입)에 맞춘 목표 metric으로 폴백.
  const metric = useMemo(() => {
    const obj = effectiveObjective && ALLOC_OBJECTIVES[effectiveObjective];
    if (obj && mappedKeys.has(obj.metric)) return obj.metric;
    // 목표 미선택 → 전역 basis 우선(가입=actions / 설치=installs)
    const basisMetric = basisObjective === "action" ? "actions" : "installs";
    if (mappedKeys.has(basisMetric)) return basisMetric;
    if (mappedKeys.has("installs")) return "installs";
    if (mappedKeys.has("actions")) return "actions";
    return "installs";
  }, [effectiveObjective, mappedKeys, basisObjective]);

  // 선택 metric이 매핑 안 됐으면 폴백 (전역 basis → installs → actions)
  const effectiveMetric = useMemo(() => {
    if (mappedKeys.has(metric)) return metric;
    const basisMetric = basisObjective === "action" ? "actions" : "installs";
    if (mappedKeys.has(basisMetric)) return basisMetric;
    if (mappedKeys.has("installs")) return "installs";
    if (mappedKeys.has("actions")) return "actions";
    return metric;
  }, [metric, mappedKeys, basisObjective]);

  const allRows = useMemo(
    () => (hasData ? getMappedRows(csvData) : []),
    [hasData, csvData],
  );

  // 필터 옵션 자동 감지 (국가/채널/OS + cascading). index.html detectAllocFilterOptions 이식.
  const filterOptions = useMemo(() => {
    const countries = new Set();
    const channels = new Set();
    const channelByCountry = new Map();
    const platforms = new Set();
    let hasCountry = false, hasChannel = false, hasPlatform = false;
    for (const r of allRows) {
      const ctry = String(r.country || "").trim();
      const ch = String(r.channel || "").trim();
      const pl = String(r.platform || "").trim().toLowerCase();
      if (ctry) { countries.add(ctry); hasCountry = true; }
      if (ch) { channels.add(ch); hasChannel = true; }
      if (pl) {
        hasPlatform = true;
        if (pl.includes("android")) platforms.add("android");
        else if (pl.includes("ios") || pl === "iphone") platforms.add("ios");
      }
      if (ctry && ch) {
        if (!channelByCountry.has(ctry)) channelByCountry.set(ctry, new Set());
        channelByCountry.get(ctry).add(ch);
      }
    }
    return {
      hasCountry, hasChannel, hasPlatform,
      countries: [...countries].sort(),
      channels: [...channels].sort(),
      channelByCountry, platforms,
    };
  }, [allRows]);

  // 채널/캠페인별은 Country×Channel grain → 국가 단일 강제(타국가 혼입 방지). index.html allocIsSingleCountryUnit.
  const isSingleCountryUnit = unitField === "channel" || unitField === "campaign_name";

  // 필터 적용된 rows. index.html getMappedRowsForAlloc 이식.
  const rows = useMemo(() => {
    let out = allRows;
    if (selectedCountries && selectedCountries.size > 0)
      out = out.filter((r) => selectedCountries.has(String(r.country || "").trim()));
    if (selectedChannelsFilter && selectedChannelsFilter.size > 0)
      out = out.filter((r) => selectedChannelsFilter.has(String(r.channel || "").trim()));
    if (platformFilter !== "all")
      out = out.filter((r) => {
        const p = String(r.platform || "").toLowerCase();
        if (platformFilter === "android") return p.includes("android");
        if (platformFilter === "ios") return p.includes("ios") || p === "iphone";
        return true;
      });
    return out;
  }, [allRows, selectedCountries, selectedChannelsFilter, platformFilter]);

  // 고급 컨트롤 묶음 (모델 재적합 트리거)
  const adv = useMemo(
    () => ({ trendType, outlierMethod, outlierStrength, weightMode, halfLifeDays: 30 }),
    [trendType, outlierMethod, outlierStrength, weightMode],
  );

  // 채널별 포인트 → 모델 → 히스토리(avgCPR) — 매핑/단위/지표/윈도우/고급 변화 시 재계산
  const byChannel = useMemo(
    () => buildByChannel(rows, unitField, effectiveMetric),
    [rows, unitField, effectiveMetric],
  );
  const modelsMap = useMemo(() => buildModels(byChannel, adv), [byChannel, adv]);
  // 최근 N일 채널별 히스토리 요약 (모든 metric 동시 산출) — 진단/결론/총합계/이전평균 공유
  const historyByCh = useMemo(() => {
    const out = {};
    for (const ch of byChannel.keys()) {
      out[ch] = calcChannelHistorySummary(rows, unitField, ch, effectiveMetric, {
        recentDays,
      });
    }
    return out;
  }, [byChannel, rows, unitField, effectiveMetric, recentDays]);

  // 채널/캠페인별이면 국가를 단일로 강제(0·복수·무효 → 최고지출 국가). index.html normalizeAllocCountryFilter 이식.
  // 이벤트 기반: 단위 변경 시 호출(effect 내 setState 회피).
  const normalizeCountryForUnit = (unit, curSel) => {
    const single = unit === "channel" || unit === "campaign_name";
    if (!single || !filterOptions.hasCountry || filterOptions.countries.length <= 1) return curSel;
    const valid = curSel ? [...curSel].filter((c) => filterOptions.countries.includes(c)) : [];
    if (valid.length === 1) return new Set(valid);
    const candidates = valid.length ? valid : filterOptions.countries;
    const byC = new Map();
    for (const r of allRows) {
      const c = String(r.country || "").trim();
      if (!c || !candidates.includes(c)) continue;
      byC.set(c, (byC.get(c) || 0) + (Number(r.cost) || 0));
    }
    let best = null, bestV = -Infinity;
    for (const c of [...byC.keys()].sort()) {
      if (byC.get(c) > bestV) { bestV = byC.get(c); best = c; }
    }
    return best ? new Set([best]) : null;
  };
  // 단위 변경 핸들러 — 국가 단일 강제 반영
  const changeUnit = (u) => {
    setUnitField(u);
    setSelectedCountries((prev) => normalizeCountryForUnit(u, prev));
  };

  // 일예산 환산 (월예산이면 ÷30)
  const dailyBudget = useMemo(() => {
    const raw = allocParseNum(budget) || 0;
    return budgetPeriod === "monthly" ? raw / 30 : raw;
  }, [budget, budgetPeriod]);

  // 최근 일예산 합계로 총예산 기본값 산출(사용자 미입력 시). Step 전환 이벤트에서 호출(effect 회피).
  const applyBudgetDefault = () => {
    if (budgetAutoDefaulted || (allocParseNum(budget) || 0) > 0) return;
    let sumDaily = 0;
    for (const ch of byChannel.keys()) {
      const h = calcChannelHistorySummary(rows, unitField, ch, effectiveMetric, { recentDays });
      if (h && isFinite(h.windowCost)) sumDaily += h.windowCost / recentDays;
    }
    if (sumDaily > 0) {
      setBudget(allocFmtNum(budgetPeriod === "monthly" ? sumDaily * 30 : sumDaily));
      setBudgetAutoDefaulted(true);
    }
  };

  // 배분 결과 (mode C / B) — 제약(overrides/min/max) + recalcTick 포함
  const allocation = useMemo(() => {
    if (!(dailyBudget > 0))
      return { items: [], unallocated: 0, totalAllocated: 0, lockedTotal: 0, overspent: false };
    const common = {
      modelsMap,
      totalBudget: dailyBudget,
      overrides: allocOverrides,
      minSpends: allocMinSpend,
      maxSpends: allocMaxSpend,
    };
    if (allocMode === "b")
      return calculateAllocationModeB({ ...common, extrapolateMode, currency });
    // #6a: 모드 C 호출엔 currency가 안 넘어가고 있었음 — 모드 B와 동일하게 전달.
    return calculateAllocationModeC({ ...common, metric: effectiveMetric, historyByCh, currency });
    // recalcTick: 재계산 버튼 강제 재실행 (입력 동일해도)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modelsMap,
    dailyBudget,
    allocMode,
    currency,
    extrapolateMode,
    effectiveMetric,
    historyByCh,
    allocOverrides,
    allocMinSpend,
    allocMaxSpend,
    recalcTick,
  ]);

  // 배분 요약(이전 N일 vs 예상) — 총합계·결론 카드가 공유
  const summary = useMemo(() => {
    if (!allocation.items.length) return null;
    return computeAllocSummary({
      items: allocation.items,
      metric: effectiveMetric,
      historyByCh,
      recentDays,
    });
  }, [allocation.items, effectiveMetric, historyByCh, recentDays]);

  // §0 진단 — "지금 어디가 문제인가" (관측 최근 N일 효율 기준). index.html renderAllocDiagnosis 이식.
  const diagnosis = useMemo(() => {
    const items = allocation.items;
    if (!items.length) return null;
    const metric = effectiveMetric;
    const roas = isRoasMetric(metric);
    const metricLabel = getCostMetricLabel(metric);
    const chans = [];
    let totCost = 0,
      totResults = 0;
    for (const it of items) {
      const h = historyByCh[it.channel];
      if (!h || h.windowCost <= 0) continue;
      let eff;
      if (roas) eff = h.avgROAS != null && h.avgROAS > 0 ? 1 / h.avgROAS : Infinity;
      else eff = h.avgCPR != null && h.windowResults > 0 ? h.avgCPR : Infinity;
      chans.push({
        ch: it.channel,
        cost: h.windowCost,
        results: h.windowResults,
        cpr: h.avgCPR,
        roasV: h.avgROAS,
        eff,
      });
      totCost += h.windowCost;
      totResults += h.windowResults;
    }
    if (!chans.length || totCost <= 0) {
      return { insufficient: true, lines: [] };
    }
    const portEff = totResults > 0 ? totCost / totResults : null;
    const fin = chans.filter((c) => isFinite(c.eff));
    const worst = [...chans].sort((a, b) => b.eff - a.eff || (a.ch < b.ch ? -1 : 1))[0];
    const best = [...fin].sort((a, b) => a.eff - b.eff || (a.ch < b.ch ? -1 : 1))[0] || null;
    const topCh = chans.reduce((a, b) => (b.cost > a.cost ? b : a));
    const topShare = totCost > 0 ? topCh.cost / totCost : 0;
    const rnd = (v) => Math.round(v);
    const costSh = (c) => (totCost > 0 ? (c.cost / totCost) * 100 : 0);
    const resSh = (c) => (totResults > 0 ? (c.results / totResults) * 100 : 0);
    const resLbl = (c) =>
      roas ? fmtCurrency(c.results, currency) : `${formatNumberK(c.results, 0)}건`;
    const effLbl = (c) =>
      !isFinite(c.eff)
        ? "—"
        : roas
          ? `${(c.roasV * 100).toFixed(0)}%`
          : fmtCostMetric(c.cpr, metric, currency);
    const ratioBad = isFinite(worst.eff) && portEff > 0 ? worst.eff / portEff : Infinity;
    const ratioGood =
      best && isFinite(best.eff) && best.eff > 0 && portEff > 0 ? portEff / best.eff : 1;
    const lines = [];
    if (chans.length < 2) {
      lines.push({
        cls: "muted",
        text: `채널을 2개 이상 선택하면 채널 간 효율 비교 진단이 표시됩니다 (현재 ${chans.length}개).`,
      });
    } else {
      if (!isFinite(worst.eff)) {
        lines.push({
          cls: "bad",
          text: `💸 ${worst.ch} — 최근 ${recentDays}일 예산의 ${rnd(costSh(worst))}%(${fmtCurrency(worst.cost, currency)})를 쓰는데 ${roas ? "매출" : "결과"}가 거의 없습니다. 가장 시급한 점검 대상입니다.`,
        });
      } else if (ratioBad >= 1.2) {
        lines.push({
          cls: "bad",
          text: `💸 ${worst.ch} — 최근 ${recentDays}일 예산의 ${rnd(costSh(worst))}%(${fmtCurrency(worst.cost, currency)})를 쓰는데 ${roas ? "매출 비중" : "결과 비중"}은 ${rnd(resSh(worst))}%(${resLbl(worst)})뿐입니다. ${metricLabel} ${effLbl(worst)} — 평균보다 ${ratioBad.toFixed(1)}배 비효율.`,
        });
      } else {
        lines.push({
          cls: "neutral",
          text: `📊 채널 간 효율 차이가 작습니다 (최고↔최저 ${best && best.eff > 0 ? (worst.eff / best.eff).toFixed(1) : "—"}배). 재배분으로 얻을 효율은 제한적 — 채널 자체 효율(소재·타겟) 개선이 우선입니다.`,
        });
      }
      if (best && best.ch !== worst.ch && isFinite(best.eff) && ratioGood >= 1.2) {
        lines.push({
          cls: "good",
          text: `💎 ${best.ch} — ${metricLabel} ${effLbl(best)}로 가장 효율적(평균보다 ${ratioGood.toFixed(1)}배)인데 예산은 ${rnd(costSh(best))}%뿐입니다. 증액 여지가 있습니다.`,
        });
      }
      if (topShare >= 0.5 && topShare >= 1.5 / chans.length) {
        lines.push({
          cls: "neutral",
          text: `📊 예산이 ${topCh.ch}에 ${rnd(topShare * 100)}% 집중 — 단일 채널 의존도가 높습니다. 리스크 분산을 점검하세요.`,
        });
      }
    }
    return { insufficient: false, lines };
  }, [allocation.items, effectiveMetric, historyByCh, recentDays, currency]);

  // What-if 시나리오 데이터
  const scenarios = useMemo(() => {
    if (simMode === "manual" || !(dailyBudget > 0)) return [];
    return computeAllocScenarios({
      modelsMap,
      dailyBudget,
      metric: effectiveMetric,
      mode: allocMode,
      overrides: allocOverrides,
      minSpends: allocMinSpend,
      maxSpends: allocMaxSpend,
      extrapolateMode,
      currency,
      historyByCh,
    });
  }, [
    simMode,
    modelsMap,
    dailyBudget,
    effectiveMetric,
    allocMode,
    allocOverrides,
    allocMinSpend,
    allocMaxSpend,
    extrapolateMode,
    currency,
    historyByCh,
  ]);

  // Step 2 검증 단위 목록 정렬(데이터 수 desc) + 유효하지 않으면 첫 항목으로 폴백(render-derived, setState 없음).
  const verifyGroups = useMemo(
    () => [...byChannel.keys()].sort((a, b) => (byChannel.get(b)?.length || 0) - (byChannel.get(a)?.length || 0) || (a < b ? -1 : 1)),
    [byChannel],
  );
  const effectiveVerifyGroup =
    verifySelectedGroup && verifyGroups.includes(verifySelectedGroup) ? verifySelectedGroup : (verifyGroups[0] ?? null);

  // Step 2 산점도(단일 검증 단위) — index.html renderAllocatorScatter의 step===2 분기(§순수함수 buildScatterDatasets 공유) 이식.
  // 단위별 모델 override(groupModels[unit])가 있으면 adv.trendType을 그 단위에만 적용.
  useEffect(() => {
    if (step !== 2 || !hasData || !verifyChartRef.current || !effectiveVerifyGroup) return;

    const ov = groupModels[effectiveVerifyGroup];
    const chAdv = ov ? { ...adv, trendType: ov } : adv;
    const isRoas = effectiveMetric === "revenue_d7";
    // ROAS 뷰는 항상 raw (Step3 효과와 동일 규칙).
    const nmode = isRoas ? "raw" : normalizeMode;

    const { datasets } = buildScatterDatasets([effectiveVerifyGroup], byChannel, adv, {
      hidePoints,
      normalizeMode: nmode,
      perAdv: () => chAdv,
      colorOf: () => CHART_THEME.series[0],
    });

    const ctx = verifyChartRef.current.getContext("2d");
    if (verifyChartInstance.current) verifyChartInstance.current.destroy();

    const axisLabels = ALLOC_MATH.getAxisLabels(nmode, getCostMetricLabel(effectiveMetric), isRoas);
    const rawTooltip = nmode === "raw";

    verifyChartInstance.current = new Chart(ctx, {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            position: "top",
            labels: { color: CHART_THEME.text, font: { family: "Inter", size: 10 }, usePointStyle: true, boxWidth: 8 },
          },
          tooltip: {
            backgroundColor: "#1f2021",
            titleColor: CHART_THEME.textPrimary,
            bodyColor: CHART_THEME.text,
            borderColor: CHART_THEME.border,
            borderWidth: 1,
            callbacks: {
              label: (c) =>
                rawTooltip
                  ? `(${c.parsed.x.toFixed(0)}, ${(c.parsed.y * (isRoas ? 100 : 1)).toFixed(2)}${isRoas ? "%" : ""})`
                  : `(${c.parsed.x.toFixed(2)}, ${c.parsed.y.toFixed(2)})`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: axisLabels.x, color: CHART_THEME.muted },
            ticks: { color: CHART_THEME.muted },
            grid: { color: CHART_THEME.grid },
          },
          y: {
            type: "linear",
            title: { display: true, text: axisLabels.y, color: CHART_THEME.muted },
            ticks: { color: CHART_THEME.muted },
            grid: { color: CHART_THEME.grid },
            beginAtZero: false,
          },
        },
      },
    });

    // Step 전환 시 새로 마운트되는 캔버스는 최초 폭이 0으로 측정될 수 있음(§7 0px 함정) —
    // 레이아웃 안정 후 1회 resize로 강제 재측정.
    requestAnimationFrame(() => verifyChartInstance.current?.resize());

    return () => {
      if (verifyChartInstance.current) {
        verifyChartInstance.current.destroy();
        verifyChartInstance.current = null;
      }
    };
  }, [step, hasData, byChannel, effectiveVerifyGroup, adv, groupModels, hidePoints, normalizeMode, effectiveMetric]);

  useEffect(() => {
    if (step !== 3 || !hasData || !chartRef.current) return;

    const byCh = buildByChannel(rows, unitField, effectiveMetric);
    // 차트 표시 대상: 명시 선택(chartChannels) 우선, 없으면 최근 지출 상위 6.
    const ranked = ALLOC_MATH.sortChannelsByRecentCost(byCh, recentDays);
    const topChannels =
      chartChannels && chartChannels.size > 0
        ? ranked.filter((ch) => chartChannels.has(ch))
        : ranked.slice(0, 6);

    const isRoasView = effectiveMetric === "revenue_d7";
    // ROAS 뷰는 항상 raw (getAxisLabels와 동일 규칙). 그 외엔 사용자 정규화 모드.
    const nmode = isRoasView ? "raw" : normalizeMode;

    const { datasets } = buildScatterDatasets(topChannels, byCh, adv, {
      hidePoints,
      normalizeMode: nmode,
    });

    const ctx = chartRef.current.getContext("2d");
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const isRoas = effectiveMetric === "revenue_d7";
    const axisLabels = ALLOC_MATH.getAxisLabels(nmode, getCostMetricLabel(effectiveMetric), isRoas);
    const yLabel = axisLabels.y;
    const xLabel = axisLabels.x;
    // 정규화 뷰(minmax/robust/log)면 tooltip은 정규화 값 그대로 표시(스케일 왜곡 방지).
    const rawTooltip = nmode === "raw";

    chartInstance.current = new Chart(ctx, {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            position: "right",
            labels: {
              color: CHART_THEME.text,
              font: { family: "Inter", size: 10 },
              usePointStyle: true,
              boxWidth: 8,
            },
          },
          tooltip: {
            backgroundColor: "#1f2021",
            titleColor: CHART_THEME.textPrimary,
            bodyColor: CHART_THEME.text,
            borderColor: CHART_THEME.border,
            borderWidth: 1,
            callbacks: {
              label: (ctx) =>
                rawTooltip
                  ? `(${ctx.parsed.x.toFixed(0)}, ${(ctx.parsed.y * (isRoas ? 100 : 1)).toFixed(2)}${isRoas ? "%" : ""})`
                  : `(${ctx.parsed.x.toFixed(2)}, ${ctx.parsed.y.toFixed(2)})`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: xLabel, color: CHART_THEME.muted },
            ticks: { color: CHART_THEME.muted },
            grid: { color: CHART_THEME.grid },
          },
          y: {
            type: "linear",
            title: { display: true, text: yLabel, color: CHART_THEME.muted },
            ticks: { color: CHART_THEME.muted },
            grid: { color: CHART_THEME.grid },
            beginAtZero: false,
          },
        },
      },
    });

    // Step 전환 시 새로 마운트되는 캔버스는 최초 폭이 0으로 측정될 수 있음(§7 0px 함정) —
    // 레이아웃 안정 후 1회 resize로 강제 재측정.
    requestAnimationFrame(() => chartInstance.current?.resize());

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [step, hasData, rows, unitField, effectiveMetric, recentDays, adv, hidePoints, chartChannels, normalizeMode]);

  // What-if 시나리오 차트 (예산 배수 → 예상 결과수 곡선). index.html renderAllocScenarioChart 이식.
  useEffect(() => {
    if (step !== 3 || simMode === "manual" || !scenarioChartRef.current) {
      if (scenarioChartInstance.current) {
        scenarioChartInstance.current.destroy();
        scenarioChartInstance.current = null;
      }
      return;
    }
    if (!scenarios.length) {
      if (scenarioChartInstance.current) {
        scenarioChartInstance.current.destroy();
        scenarioChartInstance.current = null;
      }
      return;
    }
    const ctx = scenarioChartRef.current.getContext("2d");
    if (scenarioChartInstance.current) scenarioChartInstance.current.destroy();
    const unitLabel = getMetricUnitLabel(effectiveMetric);
    // 다크/라이트 자동 — index.html getCssVar 이식(§7 var()-literal 함정: 로컬 하드코딩 CHART_THEME 대신 실제 CSS 변수 읽기).
    const axisText = getCssVar("--text-muted") || "#6B7280";
    const axisGrid = getCssVar("--border") || "rgba(255,255,255,0.08)";
    scenarioChartInstance.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: scenarios.map((s) => `${s.m}×`),
        datasets: [
          {
            label: `예상 ${unitLabel}수`,
            data: scenarios.map((s) => Math.round(s.totResults)),
            borderColor: "#adc6ff",
            backgroundColor: "#adc6ff30",
            fill: true,
            tension: 0.3,
            pointRadius: scenarios.map((s) => (s.m === 1.0 ? 6 : 3)),
            pointBackgroundColor: scenarios.map((s) =>
              s.m === 1.0 ? "#fbbf24" : "#adc6ff",
            ),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) =>
                `예산 ${fmtCurrency(scenarios[c.dataIndex].budget, currency)} → ${Math.round(scenarios[c.dataIndex].totResults).toLocaleString()} ${unitLabel}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "예산 배수 (현재 대비)", color: axisText },
            ticks: { color: axisText },
            grid: { color: axisGrid },
          },
          y: {
            title: { display: true, text: `예상 ${unitLabel}수`, color: axisText },
            ticks: { color: axisText },
            grid: { color: axisGrid },
          },
        },
      },
    });

    // Step 전환 시 새로 마운트되는 캔버스는 최초 폭이 0으로 측정될 수 있음(§7 0px 함정) —
    // 레이아웃 안정 후 1회 resize로 강제 재측정.
    requestAnimationFrame(() => scenarioChartInstance.current?.resize());

    return () => {
      if (scenarioChartInstance.current) {
        scenarioChartInstance.current.destroy();
        scenarioChartInstance.current = null;
      }
    };
  }, [step, simMode, scenarios, effectiveMetric, currency]);

  // §4 추천 배분 비중 — 단일 가로 스택 바 Chart.js(indexAxis:'y') 차트. index.html §4 alloc-bar 이식(CSS flexbox → canvas).
  // 채널별 weight(%) 세그먼트를 하나의 category("배분")에 쌓아 legacy와 동일한 "한 줄 막대 + 범례" 모양 유지.
  useEffect(() => {
    if (step !== 3 || !hasData || !barChartRef.current) return;
    const barItems = allocation.items || [];
    if (!(dailyBudget > 0) || barItems.length === 0) {
      if (barChartInstance.current) {
        barChartInstance.current.destroy();
        barChartInstance.current = null;
      }
      return;
    }

    const common = chartCommonOpts();
    const gridColor = getCssVar("--border") || common.scales.y.grid.color;
    const tickColor = getCssVar("--text-muted") || common.scales.x.ticks.color;

    const ctx = barChartRef.current.getContext("2d");
    if (barChartInstance.current) barChartInstance.current.destroy();

    barChartInstance.current = new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["배분"],
        datasets: barItems.map((it, i) => ({
          label: it.channel,
          data: [it.weight * 100],
          backgroundColor: CHART_THEME.series[i % CHART_THEME.series.length],
          borderWidth: 0,
          stack: "alloc",
        })),
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: tickColor, font: { family: "Inter", size: 11 }, usePointStyle: true, boxWidth: 8, padding: 12 },
          },
          tooltip: {
            backgroundColor: "#1f2021",
            titleColor: CHART_THEME.textPrimary,
            bodyColor: CHART_THEME.text,
            borderColor: CHART_THEME.border,
            borderWidth: 1,
            callbacks: { label: (c) => `${c.dataset.label} ${c.parsed.x.toFixed(1)}%` },
          },
        },
        scales: {
          x: {
            stacked: true,
            min: 0,
            max: 100,
            ticks: { color: tickColor, callback: (v) => `${v}%` },
            grid: { color: gridColor },
          },
          y: {
            stacked: true,
            ticks: { display: false },
            grid: { display: false },
          },
        },
      },
    });

    // Step 전환 시 새로 마운트되는 캔버스는 최초 폭이 0으로 측정될 수 있음(§7 0px 함정) —
    // 레이아웃 안정 후 1회 resize로 강제 재측정.
    requestAnimationFrame(() => barChartInstance.current?.resize());

    return () => {
      if (barChartInstance.current) {
        barChartInstance.current.destroy();
        barChartInstance.current = null;
      }
    };
  }, [step, hasData, allocation.items, dailyBudget]);

  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-alloc">
        <ToolPageShell
          title="예산 배분 시뮬레이터"
          chips={
            <span className="chip warning">
              <span className="dot"></span>CSV 업로드 대기
            </span>
          }
          summary={
            <p>
              필수: 날짜·비용·(채널 또는 캠페인)·(설치 또는 액션). 퍼널·세그먼트 진단은 무료 운영 대시보드(5-2)에서 확인하세요.
            </p>
          }
          toc={[{ id: "s-prep", title: "데이터 준비" }]}
        >
          <section className="block" id="s-prep">
            <h2 className="section-title">데이터 준비</h2>
            <div className="callout warning">
              <div className="ico">!</div>
              <div className="body">
                <strong>CSV 업로드 대기</strong>
                <p>효율 CSV 한 번 업로드로 채널별 예산 배분을 분석합니다. 그리디(Greedy) 방식은 &apos;가장 효율이 좋은 곳에 예산을 1순위로&apos; 배분합니다.</p>
                <div style={{ marginTop: "1rem" }}>
                  <CsvUploader toolId="5-3" />
                </div>
              </div>
            </div>
          </section>
        </ToolPageShell>
      </div>
    );
  }

  // --- Step 1: Filter Panel (최적화 목표 + 분석 단위 + 국가/채널/OS 필터) ---
  if (step === 1) {
    const objAvailable = {
      install: mappedKeys.has("installs"),
      action: mappedKeys.has("actions"),
      roas: mappedKeys.has("revenue_d7"),
    };
    // 국가 선택 기반 채널 옵션 cascading
    let availableChannels = filterOptions.channels;
    if (selectedCountries && selectedCountries.size > 0) {
      const set = new Set();
      for (const c of selectedCountries) {
        const chs = filterOptions.channelByCountry.get(c);
        if (chs) chs.forEach((x) => set.add(x));
      }
      availableChannels = [...set].sort();
    }
    const singleCountry = isSingleCountryUnit && filterOptions.countries.length > 1;
    const curCountry =
      selectedCountries && selectedCountries.size ? [...selectedCountries][0] : null;
    const unitOpts = [
      { v: "country", label: "국가별 (Country)", desc: "국가 grain. 채널·캠페인은 상세에서 breakdown" },
      { v: "channel", label: "채널별 (Country × Channel)", desc: "국가 + 채널 grain. 일반적 분석 단위" },
      { v: "campaign_name", label: "캠페인별 (Country × Channel × Campaign)", desc: "가장 세분화. 캠페인 수 많을 때 국가 필터 필수" },
    ];
    return (
      <div className="tab-pane active" id="tab-alloc">
        <ToolPageShell
          title="예산 배분 시뮬레이터"
          chips={
            <span className="chip">
              <span className="dot"></span>{csvData?.fileName || ""}
            </span>
          }
          summary={
            <p>
              채널/캠페인 단위의 예산 배분 및 한계효용(Greedy Optimization) 시뮬레이션
            </p>
          }
          toc={[{ id: "s-filter", title: "분석 단위" }]}
          stickyFilter={<BasisCurrencyToggleBar />}
        >
        <section className="block" id="s-filter">
          <h2 className="section-title"><span className="ix">§1</span>최적화 목표 + 분석 단위 + 필터</h2>
          <p className="muted" style={{ fontSize: "12px" }}>
            최적화 목표를 먼저 선택하고, 분석 단위와 국가/채널/OS 필터를 정한 뒤 &apos;적용&apos;을 누르면 산점도·추세선·예산 분배가 계산됩니다.
          </p>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px", marginTop: "12px" }}>
            {/* 1) 최적화 목표 */}
            <div style={{ marginBottom: "14px" }}>
              <span className="ab-pillgroup-label">1️⃣ 최적화 목표 (필수)</span>
              <p className="muted" style={{ fontSize: "11px", margin: "2px 0 0" }}>
                전역 기준이 <strong>{effBasis === "actions" ? "가입(Action · CPA)" : "설치(Install · CPI)"}</strong>{" "}
                이므로 미선택 시 {effBasis === "actions" ? "CPA" : "CPI"} 기준으로 분석됩니다. 목표를 직접 바꾸려면 아래에서 선택하세요.
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "4px" }}>
                {Object.entries(ALLOC_OBJECTIVES).map(([k, o]) => {
                  const ok = objAvailable[k];
                  // 목표 미선택 상태에서 전역 기준과 일치하는 목표는 "기본값" 배지로 표시.
                  const isBasisDefault = !objective && ok && k === basisObjective;
                  return (
                    <button
                      key={k}
                      className={`ab-pill ${objective === k ? "active" : ""}`}
                      disabled={!ok}
                      title={ok ? o.desc : `필요 컬럼 매핑 안 됨 (${o.metric})`}
                      onClick={() => ok && setObjective(k)}
                      style={{ flexDirection: "column", alignItems: "flex-start", opacity: ok ? 1 : 0.4, cursor: ok ? "pointer" : "not-allowed", textAlign: "left" }}
                    >
                      <span style={{ fontSize: "13px", fontWeight: 700 }}>{o.short} {o.arrow}{isBasisDefault ? " ·기본" : ""}</span>
                      <span style={{ fontSize: "10px", fontWeight: 400, opacity: 0.85 }}>{o.label}{!ok ? " 🔒" : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 2) 분석 단위 */}
            <div style={{ marginBottom: "14px" }}>
              <span className="ab-pillgroup-label">2️⃣ 분석 단위 (Scatter Point)</span>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "4px" }}>
                {unitOpts.map((o) => (
                  <button key={o.v} className={`ab-pill ${unitField === o.v ? "active" : ""}`} title={o.desc} onClick={() => changeUnit(o.v)}>{o.label}</button>
                ))}
              </div>
            </div>
            {/* 3) 국가 / 채널 / OS 필터 */}
            <div style={{ marginBottom: "10px" }}>
              <span className="ab-pillgroup-label">3️⃣ 국가 · 채널 · OS 필터</span>
            </div>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "12px" }}>
              {filterOptions.hasCountry && (
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    국가 {singleCountry ? "(채널·캠페인별은 1개만)" : "(다중, 미선택=전체)"}
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px", maxWidth: "340px" }}>
                    {filterOptions.countries.map((c) => {
                      const active = singleCountry ? c === curCountry : (!selectedCountries || selectedCountries.has(c));
                      return (
                        <button
                          key={c}
                          className={`ab-pill ${active ? "active" : ""}`}
                          style={{ fontSize: "11px" }}
                          onClick={() =>
                            singleCountry
                              ? setSelectedCountries(new Set([c]))
                              : setSelectedCountries((prev) => toggleInSet(prev, c, filterOptions.countries))
                          }
                        >{c}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              {filterOptions.hasChannel && (
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)" }}>채널 (다중, 미선택=전체)</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px", maxWidth: "340px" }}>
                    {availableChannels.map((c) => {
                      const active = !selectedChannelsFilter || selectedChannelsFilter.has(c);
                      return (
                        <button
                          key={c}
                          className={`ab-pill ${active ? "active" : ""}`}
                          style={{ fontSize: "11px" }}
                          onClick={() => setSelectedChannelsFilter((prev) => toggleInSet(prev, c, availableChannels))}
                        >{c}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              {filterOptions.hasPlatform && (
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)" }}>OS 플랫폼</label>
                  <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    {["all", "android", "ios"].map((p) => {
                      const enabled = p === "all" || filterOptions.platforms.has(p);
                      return (
                        <button
                          key={p}
                          className={`ab-pill ${platformFilter === p ? "active" : ""}`}
                          disabled={!enabled}
                          style={{ opacity: enabled ? 1 : 0.4 }}
                          onClick={() => enabled && setPlatformFilter(p)}
                        >{p === "all" ? "전체" : p === "android" ? "Android" : "iOS"}</button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn primary"
                disabled={!objective}
                style={{ opacity: objective ? 1 : 0.4, cursor: objective ? "pointer" : "not-allowed" }}
                onClick={() => {
                  if (!objective) return;
                  // 필터 적용 시 단위별 검증 상태 초기화. index.html 적용 버튼 핸들러 이식(§2 재검증 강제).
                  setGroupModels({});
                  setGroupVerification({});
                  setVerifySelectedGroup(null);
                  setStep(2);
                }}
              >
                {objective ? "✓ 적용 (검증 진행)" : "⚠ 최적화 목표를 먼저 선택하세요"}
              </button>
            </div>
          </div>
        </section>
        </ToolPageShell>
      </div>
    );
  }

  // 고급 추세선 컨트롤 패널 (가중치·이상치 방법/강도·정규화·외삽 Cap·포인트 토글). Step 2/3 공유.
  const advancedPanel = (
    <div style={{ marginBottom: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
      <button className="ab-pill" onClick={() => setAdvancedOpen((v) => !v)}>
        {advancedOpen ? "▲ 상세 설정 닫기" : "▼ 상세 설정 (가중치·이상치·정규화·외삽·표시)"}
      </button>
      {advancedOpen && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "10px", fontSize: "12px" }}>
          <div>
            <span className="ab-pillgroup-label" title="채널의 Cost↔CPR 관계를 어떤 곡선으로 적합할지. Auto는 R² 최고 모델 자동 선택.">추세선 모델</span>
            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
              {[["auto", "Auto"], ["linear", "Linear"], ["log", "Log"], ["poly2", "Poly2"], ["power", "Power"]].map(([v, l]) => (
                <button key={v} className={`ab-pill ${trendType === v ? "active" : ""}`} onClick={() => setTrendType(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="ab-pillgroup-label" title="추세선 적합 시 최근 데이터에 더 큰 비중. 시장이 최근 바뀌었다면 선형/지수.">최근 가중치</span>
            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
              {[["none", "없음"], ["linear", "선형"], ["exponential", "지수(30일)"]].map(([v, l]) => (
                <button key={v} className={`ab-pill ${weightMode === v ? "active" : ""}`} onClick={() => setWeightMode(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="ab-pillgroup-label" title="비정상적으로 튀는 (Cost,CPR) 포인트를 추세선 계산에서 제외.">이상치 제거</span>
            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
              {[["none", "없음"], ["iqr", "IQR"], ["modz", "Modified Z"]].map(([v, l]) => (
                <button key={v} className={`ab-pill ${outlierMethod === v ? "active" : ""}`} onClick={() => setOutlierMethod(v)}>{l}</button>
              ))}
            </div>
          </div>
          {outlierMethod !== "none" && (
            <div>
              <span className="ab-pillgroup-label" title="이상치 제거 기준 엄격도. 강할수록 더 많이 제거.">강도</span>
              <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                {[["standard", "표준"], ["strong", "강함"], ["very_strong", "매우 강함"]].map(([v, l]) => (
                  <button key={v} className={`ab-pill ${outlierStrength === v ? "active" : ""}`} onClick={() => setOutlierStrength(v)}>{l}</button>
                ))}
              </div>
            </div>
          )}
          <div>
            <span className="ab-pillgroup-label" title="차트 표시 축 스케일만 변경(추세선 계산엔 영향 없음).">정규화 (표시)</span>
            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
              {[["raw", "절대값"], ["log", "로그"], ["minmax", "0~1"], ["robust", "Robust z"]].map(([v, l]) => (
                <button key={v} className={`ab-pill ${normalizeMode === v ? "active" : ""}`} onClick={() => setNormalizeMode(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="ab-pillgroup-label" title="추세선을 관측 범위 밖(미집행 Cost)까지 예측에 쓸 때의 한도. 그리디(모드 B)에만 적용.">외삽 한도 (Cap)</span>
            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
              {[["1.0", "1.0x 엄격"], ["1.3", "1.3x 보통"], ["1.5", "1.5x 공격적"], ["fallback", "비례배분"]].map(([v, l]) => (
                <button key={v} className={`ab-pill ${extrapolateMode === v ? "active" : ""}`} onClick={() => setExtrapolateMode(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="ab-pillgroup-label" title="차트에 원본 데이터 점을 같이 표시할지 추세선만 볼지.">표시</span>
            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
              <button className={`ab-pill ${!hidePoints ? "active" : ""}`} onClick={() => setHidePoints(false)}>점 + 추세선</button>
              <button className={`ab-pill ${hidePoints ? "active" : ""}`} onClick={() => setHidePoints(true)}>추세선만</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // --- Step 2: 추세선 검증 (Trendline Verification) — index.html renderAllocVerificationStep 이식.
  // 좌측 사이드바(단위 목록) + 우측 산점도/추세선 + 단위별 모델 선택 + 상세 설정 + 검증 요약 + 일괄/개별 승인.
  if (step === 2) {
    const outOpts = getOutlierOpts(outlierMethod, outlierStrength);
    // 단위별 상태 판정 — index.html bindAllocVerificationHandlers의 problemReason 이식.
    // 데이터 부족(<3) → 낮은 R²(<0.2) → Poly2 꼭짓점(Vertex)이 관측 구간 내부(±10%)에 있으면 주의.
    const verifyRows = verifyGroups.map((ch) => {
      const pts = byChannel.get(ch) || [];
      const { kept, removed } = ALLOC_MATH.removeOutliers(pts, outlierMethod, outOpts);
      const ov = groupModels[ch];
      const model = ov ? fitChannel(pts, { ...adv, trendType: ov })?.model : modelsMap.get(ch)?.model;
      const isVerified = groupVerification[ch] === "verified";
      let problemReason = null;
      if (kept.length < 3) {
        problemReason = "데이터 부족";
      } else if (model) {
        const shape = ALLOC_MATH.detectPoly2Shape(model);
        if (shape && shape.shape === "bell") {
          const xs = kept.map((p) => p.x);
          const xMin = Math.min(...xs);
          const xMax = Math.max(...xs);
          const range = xMax - xMin;
          if (shape.vertex >= xMin + 0.1 * range && shape.vertex <= xMax - 0.1 * range) problemReason = "꼭짓점(Vertex) 주의";
        } else if (model.r2 != null && model.r2 < 0.2) {
          problemReason = "낮은 적합도 (R² < 0.2)";
        }
      } else {
        problemReason = "적합 실패";
      }
      const isHealthy = !problemReason;
      return {
        ch,
        n: pts.length,
        kept: kept.length,
        removed: removed.length,
        model,
        modelLabel: ov ? TREND_TYPE_LABEL[ov] || ov : model ? model.type : "—",
        r2: model?.r2 ?? null,
        problemReason,
        isHealthy,
        isVerified,
      };
    });
    const healthyGroups = verifyRows.filter((r) => r.isHealthy && !r.isVerified).map((r) => r.ch);
    const unverifiedCount = verifyRows.filter((r) => r.isVerified !== true).length;
    const selectedRow = verifyRows.find((r) => r.ch === effectiveVerifyGroup) || null;

    const finishVerification = () => {
      // 네이티브 confirm()은 JS 스레드를 블로킹하고 앱 디자인과 안 맞음(§7 안티패턴) —
      // 비차단 토스트 경고 후 그대로 진행(미검증 그룹은 자동 적합 모델을 그대로 사용).
      if (unverifiedCount > 0) {
        showToast({
          title: "미검증 그룹 포함",
          body: `아직 검증되지 않은 그룹이 ${unverifiedCount}개 있습니다. 자동 적합 모델로 진행합니다.`,
          variant: "warning",
        });
      }
      applyBudgetDefault();
      setStep(3);
    };

    return (
      <div className="tab-pane active" id="tab-alloc">
        <ToolPageShell
          title="예산 배분 시뮬레이터"
          chips={
            <span className="chip">
              <span className="dot"></span>{csvData?.fileName || ""}
            </span>
          }
          summary={
            <p>
              각 분석 단위의 산점도와 추세선을 확인하고, 가장 적합한 회귀 모델을 확정해 주세요. 이상치나 꼭짓점(Vertex) 문제가 있는 경우 수동 변경을 권장합니다.
            </p>
          }
          toc={[{ id: "s-verify", title: "검증" }]}
          stickyFilter={<BasisCurrencyToggleBar />}
        >
        <section className="block" id="s-verify">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "8px" }}>
            <h2 className="section-title" style={{ margin: 0 }}><span className="ix">§2</span>추세선 검증 (Trendline Verification)</h2>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="btn secondary"
                disabled={healthyGroups.length === 0}
                style={{ opacity: healthyGroups.length === 0 ? 0.5 : 1, cursor: healthyGroups.length === 0 ? "not-allowed" : "pointer" }}
                onClick={() => {
                  setGroupVerification((prev) => {
                    const next = { ...prev };
                    healthyGroups.forEach((g) => { next[g] = "verified"; });
                    return next;
                  });
                }}
              >
                건강한 그룹 일괄 승인 ({healthyGroups.length}건)
              </button>
              <button className="btn primary" onClick={finishVerification}>검증 완료 및 예산 배분 →</button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "1rem", alignItems: "start", marginTop: "0.75rem" }}>
            {/* 좌측: 분석 단위 목록 (클릭하면 우측 산점도 갱신) */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ background: "var(--bg-2)", padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
                분석 단위 목록 <span>({verifyRows.length}개)</span>
              </div>
              <div style={{ maxHeight: "500px", overflowY: "auto", background: "var(--bg-1)" }}>
                {verifyRows.length === 0 ? (
                  <div style={{ padding: "16px", color: "var(--text-muted)", fontSize: "13px" }}>
                    선택한 단위에서 유효한 데이터(비용&gt;0 · 결과&gt;0)를 찾지 못했습니다. §1에서 다른 단위를 선택하거나 지표 매핑을 확인하세요.
                  </div>
                ) : (
                  verifyRows.map((r) => {
                    const isSelected = r.ch === effectiveVerifyGroup;
                    return (
                      <div
                        key={r.ch}
                        onClick={() => setVerifySelectedGroup(r.ch)}
                        style={{
                          padding: "10px 14px",
                          borderBottom: "1px solid var(--border)",
                          borderLeft: isSelected ? "3px solid var(--primary, #adc6ff)" : "3px solid transparent",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          background: isSelected ? "rgba(122,162,247,0.12)" : "transparent",
                          fontWeight: isSelected ? 700 : 400,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <span
                            title={r.ch}
                            style={{ fontSize: "13px", fontWeight: 600, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "180px", paddingRight: "8px" }}
                          >
                            {r.ch}
                          </span>
                          <span style={{ whiteSpace: "nowrap", fontSize: "12px", fontWeight: r.isVerified ? 600 : 400, color: r.isVerified ? "#5ad19a" : "var(--text-secondary)" }}>
                            {r.isVerified ? "✓ 확인됨" : "대기중"}
                          </span>
                        </div>
                        <div>
                          {r.problemReason && (
                            <div style={{ color: "#f0917e", fontSize: "11.5px", fontWeight: 600, marginBottom: "2px" }}>⚠ {r.problemReason}</div>
                          )}
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            선택된 모델: <strong>{r.modelLabel}</strong>{r.r2 != null ? ` · R² ${r.r2.toFixed(2)}` : ""} · n={r.n}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 우측: 선택된 단위 상세 (산점도 + 모델 선택 + 상세 설정 + 검증 요약) */}
            <div className="card" style={{ padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", minHeight: "32px" }}>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>{effectiveVerifyGroup || "그룹을 선택하세요"}</h3>
                {effectiveVerifyGroup && (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <select
                      value={groupModels[effectiveVerifyGroup] || "auto"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGroupModels((prev) => {
                          const next = { ...prev };
                          if (v === "auto") delete next[effectiveVerifyGroup];
                          else next[effectiveVerifyGroup] = v;
                          return next;
                        });
                      }}
                      style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--bg-1)", fontSize: "12px" }}
                    >
                      <option value="auto">Auto (Best R²)</option>
                      <option value="linear">Linear</option>
                      <option value="log">Log</option>
                      <option value="poly2">Poly2</option>
                      <option value="power">Power</option>
                    </select>
                    <button
                      className="btn primary"
                      style={{ padding: "4px 12px", fontSize: "12px" }}
                      onClick={() => setGroupVerification((prev) => ({ ...prev, [effectiveVerifyGroup]: "verified" }))}
                    >
                      확정
                    </button>
                  </div>
                )}
              </div>

              {advancedPanel}

              <div className="chart-canvas-wrap" style={{ height: "350px", marginTop: "0.5rem" }}>
                <canvas id="chart-alloc-scatter-verify" ref={verifyChartRef}></canvas>
              </div>

              {/* 추세 요약 — 단위별 R²/데이터 수/이상치 */}
              {selectedRow && (
                <div style={{ marginTop: "0.75rem", fontSize: "12.5px", color: "var(--text-secondary)", background: "var(--bg-1)", padding: "10px 12px", borderRadius: "6px" }}>
                  <strong>{selectedRow.ch}</strong> — 모델 <strong>{selectedRow.modelLabel}</strong>
                  {selectedRow.r2 != null ? <> · R² <strong className="tnum">{selectedRow.r2.toFixed(3)}</strong></> : null}
                  {" "}· 데이터 {selectedRow.n}개{selectedRow.removed > 0 ? ` (이상치 ${selectedRow.removed}개 제외)` : ""}
                  {selectedRow.problemReason ? (
                    <span style={{ color: "#f0917e" }}> · ⚠ {selectedRow.problemReason}</span>
                  ) : (
                    <span style={{ color: "#5ad19a" }}> · 통과</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button className="btn secondary" style={{ marginRight: "8px" }} onClick={() => setStep(1)}>뒤로</button>
            <button className="btn primary" onClick={finishVerification}>검증 완료 및 예산 배분 →</button>
          </div>
        </section>
        </ToolPageShell>
      </div>
    );
  }

  // --- Step 3: Simulation ---
  const items = allocation.items;
  const rankedChannels = ALLOC_MATH.sortChannelsByRecentCost(byChannel, recentDays);
  const unitLabel = getMetricUnitLabel(effectiveMetric);
  const metricLabel = getCostMetricLabel(effectiveMetric);
  const roas = isRoasMetric(effectiveMetric);
  const totalCost = allocation.totalAllocated || 0;
  const totalResults = items.reduce((s, it) => s + it.results, 0);
  const avgCpr = totalResults > 0 ? totalCost / totalResults : 0;
  const showTable = dailyBudget > 0 || simMode === "manual";

  // ── 잠금/되돌리기 + Min/Max 핸들러 (라이브 콤마·§7 parseFloat 콤마 함정) ──
  const setNumMap = (setter, ch, raw) => {
    const v = allocParseNum(raw);
    setter((prev) => {
      const next = { ...prev };
      if (v == null || v < 0) delete next[ch];
      else next[ch] = v;
      return next;
    });
  };
  // Cost 셀 편집 확정(blur/Enter): override(잠금)로 저장. draft는 클리어.
  const commitCost = (ch) => {
    const draft = costDrafts[ch];
    if (draft == null) return;
    const v = allocParseNum(draft);
    setAllocOverrides((prev) => {
      const next = { ...prev };
      if (v == null || v < 0) delete next[ch];
      else next[ch] = v;
      return next;
    });
    setCostDrafts((prev) => {
      const next = { ...prev };
      delete next[ch];
      return next;
    });
  };
  const unlockCost = (ch) => {
    setAllocOverrides((prev) => {
      const next = { ...prev };
      delete next[ch];
      return next;
    });
    setCostDrafts((prev) => {
      const next = { ...prev };
      delete next[ch];
      return next;
    });
  };

  // §5 배분 점검 스트립 데이터 (index.html renderAllocVerifyStrip 이식)
  const verify = (() => {
    if (items.length < 2) return null;
    const mode = allocMode;
    const rowsV = items.map((it) => {
      const h = historyByCh[it.channel];
      let eff = null;
      if (h) {
        if (roas) eff = h.avgROAS != null && h.avgROAS > 0 ? 1 / h.avgROAS : null;
        else eff = h.avgCPR != null && h.avgCPR > 0 ? h.avgCPR : null;
      }
      return {
        ch: it.channel,
        alloc: it.cost || 0,
        eff,
        cpr: h ? h.avgCPR : null,
        roasV: h ? h.avgROAS : null,
        locked: !!it.locked,
        hasMin: Number(allocMinSpend[it.channel]) > 0,
        hasMax: allocMaxSpend[it.channel] != null && Number(allocMaxSpend[it.channel]) >= 0,
        zero: (it.cost || 0) === 0,
      };
    });
    const effLbl = (r) =>
      r.eff == null
        ? "—"
        : roas
          ? `${(r.roasV * 100).toFixed(0)}%`
          : fmtCostMetric(r.cpr, effectiveMetric, currency);
    const constrainedN = rowsV.filter((r) => r.locked || r.hasMin || r.hasMax).length;
    let head = "",
      body = "",
      tone = "good";
    if (mode === "b") {
      tone = "neutral";
      head = "한계효용 기준 배분";
      const zeros = rowsV.filter((r) => r.zero && !r.locked).map((r) => r.ch);
      body =
        `그리디(고급)는 평균 효율이 아니라 '추가 1원이 만드는 효과(한계효율)' 기준으로 배분합니다 — 평균 ${metricLabel} 순서와 달라도 정상입니다.` +
        (zeros.length ? ` 추가 투입 효과가 없어 0 배분된 채널: ${zeros.join(", ")}.` : "");
    } else {
      const free = rowsV.filter(
        (r) => r.eff != null && !r.locked && !r.hasMin && !r.hasMax && !r.zero,
      );
      const sorted = [...free].sort((a, b) => a.eff - b.eff || (a.ch < b.ch ? -1 : 1));
      const inv = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i + 1].alloc > sorted[i].alloc * 1.001) inv.push([sorted[i], sorted[i + 1]]);
      }
      if (free.length < 2) {
        tone = "neutral";
        head = "점검 생략";
        body = `제약 없는 비교 가능 채널이 부족합니다(잠금·제약 ${constrainedN}개). 표에서 직접 확인하세요.`;
      } else if (inv.length === 0) {
        tone = "good";
        head = "✓ 효율 순서대로 배분됨";
        body = `제약 없는 채널은 효율(${metricLabel})이 좋을수록 예산이 더 갔습니다 — 절대 CPR 가중이 정상 작동 중.`;
      } else {
        tone = "bad";
        head = "⚠ 효율↔배분 역전";
        body =
          inv
            .slice(0, 2)
            .map(
              ([b, w]) =>
                `${w.ch}(${effLbl(w)})가 ${b.ch}(${effLbl(b)})보다 효율이 낮은데 예산이 더 많습니다`,
            )
            .join(" · ") + `. 잠금/최소·최대 제약 때문일 수 있으니 표에서 확인하세요.`;
      }
    }
    const note =
      constrainedN > 0
        ? `🔒 ${constrainedN}개 채널은 수동 고정·최소/최대 제약으로 효율 순서와 무관하게 우선 배분됩니다.`
        : "";
    return { head, body, tone, note };
  })();

  // 결론·액션 카드 데이터 (index.html renderAllocVerdict 이식)
  const verdict = (() => {
    if (!summary || !items.length) return null;
    const S = summary;
    const dPrev = displayMetricValue(S.prevAvgCPR, effectiveMetric);
    const dNext = displayMetricValue(S.nextAvgCPR, effectiveMetric);
    let tone = "neutral",
      text = "",
      pct = null;
    if (dPrev != null && dNext != null && dPrev !== 0) {
      const d = dNext - dPrev;
      pct = Math.abs(d / dPrev) * 100;
      const good = roas ? d > 0 : d < 0;
      if (pct < 2) {
        tone = "neutral";
        text = `추천 배분은 현재와 거의 같습니다 (${metricLabel} 변화 ${pct.toFixed(1)}%). 재배분만으로 얻을 효율 개선은 미미하니, 채널 자체 효율(소재·타겟·랜딩)을 손보는 편이 낫습니다.`;
      } else if (good) {
        tone = "good";
        text = `추천대로 재배분하면 ${metricLabel}가 약 ${pct.toFixed(1)}% ${roas ? "상승" : "개선"}할 것으로 보입니다. 아래 액션부터 적용해 보세요.`;
      } else {
        tone = "bad";
        text = `현재 입력·제약으로는 ${metricLabel}가 약 ${pct.toFixed(1)}% 악화됩니다. Min/Max·잠금 제약이나 선택한 채널을 점검하세요.`;
      }
    } else {
      text = `예상 ${unitLabel} ${formatNumberK(S.next.results, 0)}건 기준으로 배분했습니다. 효율을 비교할 과거 데이터가 부족해 개선폭은 추정하지 않았습니다.`;
    }
    const moves = items.map((it) => {
      const h = historyByCh[it.channel];
      const prevDaily = h ? h.totalCost : 0;
      return {
        ch: it.channel,
        cost: it.cost,
        prevDaily,
        delta: it.cost - prevDaily,
        zero: it.cost === 0,
      };
    });
    const incr = moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta);
    const decr = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta);
    const acts = [];
    if (incr[0])
      acts.push(
        `${incr[0].ch} 증액 — 일 ${fmtCurrency(Math.round(incr[0].delta), currency)} 더 (${fmtCurrency(Math.round(incr[0].prevDaily), currency)} → ${fmtCurrency(Math.round(incr[0].cost), currency)})`,
      );
    if (decr[0])
      acts.push(
        `${decr[0].ch} ${decr[0].zero ? "중단·0 배분" : "감액"} — 일 ${fmtCurrency(Math.round(Math.abs(decr[0].delta)), currency)} 줄임${decr[0].zero ? " (추가 예산 대비 효율 없음 → 현 수준 유지/재검토)" : ""}`,
      );
    if ((allocation.unallocated || 0) > 0)
      acts.push(
        `남은 ${fmtCurrency(allocation.unallocated, currency)}은 더 투입해도 효율이 오르지 않아 미배분으로 두는 편이 낫습니다.`,
      );
    return { tone, text, acts, S };
  })();

  const step3Toc = [
    { id: "s-scatter", title: "산점도" },
    { id: "s-controls", title: "예산" },
    { id: "s-bar", title: "배분" },
    { id: "s-scenario", title: "시나리오" },
    { id: "s-table", title: "상세" },
    { id: "s-algo", title: "알고리즘" },
  ];
  const step3StickyFilter = (
    <>
      <BasisCurrencyToggleBar />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "6px" }}>
        <button className={`ab-pill ${currency === "KRW" ? "active" : ""}`} onClick={() => setCurrency("KRW")}>₩ KRW</button>
        <button className={`ab-pill ${currency === "USD" ? "active" : ""}`} onClick={() => setCurrency("USD")}>$ USD</button>
      </div>

      {/* 적용된 필터 요약 (sticky 필터바 역할) + 필터 변경 */}
      <div style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 12px", marginTop: "10px", fontSize: "12px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        {effectiveObjective && ALLOC_OBJECTIVES[effectiveObjective] && (
          <strong style={{ color: "var(--primary, #adc6ff)" }}>🎯 {ALLOC_OBJECTIVES[effectiveObjective].short} {ALLOC_OBJECTIVES[effectiveObjective].arrow}</strong>
        )}
        <span>· <strong>{{ country: "국가별", channel: "국가 × 채널별", campaign_name: "국가 × 채널 × 캠페인별" }[unitField] || unitField}</strong></span>
        <span>· 국가: <strong>{selectedCountries && selectedCountries.size > 0 ? [...selectedCountries].join(", ") : "전체"}</strong></span>
        <span>· 채널: <strong>{selectedChannelsFilter && selectedChannelsFilter.size > 0 ? [...selectedChannelsFilter].join(", ") : "전체"}</strong></span>
        <span>· OS: <strong>{platformFilter === "all" ? "전체 OS" : platformFilter === "android" ? "Android" : "iOS"}</strong></span>
        <button className="btn secondary" style={{ padding: "4px 8px", fontSize: "11px", marginLeft: "auto" }} onClick={() => setStep(1)}>⚙ 필터 변경</button>
      </div>
    </>
  );

  return (
    <div className="tab-pane active" id="tab-alloc">
      <ToolPageShell
        title="예산 배분 시뮬레이터"
        chips={
          <span className="chip">
            <span className="dot"></span>{csvData?.fileName || ""}
          </span>
        }
        summary={
          <>
            <p>
              채널별 절대 성과(CPR/ROAS) 가중과 수확체감 모형을 반영하여 최적 예산 포트폴리오를 제안합니다.
            </p>
            <details style={{ marginTop: "6px", fontSize: "11.5px", color: "var(--text-secondary)", cursor: "pointer" }}>
              <summary>⚠️ 알고리즘 참고사항 펼치기</summary>
              <div style={{ marginTop: "6px", padding: "8px 10px", background: "var(--bg-1)", borderLeft: "3px solid var(--primary)", lineHeight: 1.6 }}>
                비용 대비 성과 산점도를 곡선 적합(Saturation)하여 한계효용 극대화 배분을 도출합니다. 데이터가 지나치게 적거나 채널별 지출액 변동성이 없으면 외삽이 불안정할 수 있으므로, 단순 CPR/ROAS 배분 비율과 비교하여 의사결정하시길 권장합니다.
              </div>
            </details>
          </>
        }
        toc={step3Toc}
        stickyFilter={step3StickyFilter}
      >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "16px" }}>Step 3: 시뮬레이션 및 예산 분배</h3>
        <button className="btn secondary" onClick={() => setStep(2)} style={{ padding: "4px 10px", fontSize: "12px" }}>← 검증 단계로 돌아가기</button>
      </div>

      <section className="block" id="s-scatter">
        <h2 className="section-title"><span className="ix">§1</span>효율 및 추세선 분석 (단위 곡선)</h2>
        <div className="alloc-card">
          {advancedPanel}
          {/* 차트 표시 대상 채널 필터 (예산 분배와 무관) */}
          {rankedChannels.length > 1 && (
            <div style={{ marginBottom: "0.75rem" }}>
              <strong style={{ fontSize: "13px", color: "var(--text-1)" }}>차트 표시 대상 선택</strong>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 8px" }}>아래에서 선택한 대상만 차트에 표시됩니다. (예산 분배와는 무관)</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {rankedChannels.map((ch) => {
                  const active = chartChannels ? chartChannels.has(ch) : rankedChannels.slice(0, 6).includes(ch);
                  return (
                    <button
                      key={ch}
                      className={`ab-pill ${active ? "active" : ""}`}
                      style={{ fontSize: "11px" }}
                      onClick={() =>
                        setChartChannels((prev) => {
                          const base = prev || new Set(rankedChannels.slice(0, 6));
                          const next = new Set(base);
                          if (next.has(ch)) next.delete(ch);
                          else next.add(ch);
                          return next;
                        })
                      }
                    >{ch}</button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="chart-canvas-wrap" style={{ height: "400px" }}>
            <canvas id="chart-alloc-scatter" ref={chartRef}></canvas>
          </div>
        </div>
      </section>

      {/* §0 진단 카드 — 지금 어디가 문제인가 */}
      {diagnosis && (
        <div
          className="alloc-diag-card"
          style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: "1rem" }}
        >
          <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "8px" }}>🔍 진단 — 지금 어디가 문제인가</div>
          {diagnosis.insufficient ? (
            <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              최근 {recentDays}일 집행 데이터가 부족해 문제 진단을 생략합니다.
            </div>
          ) : (
            diagnosis.lines.map((l, i) => (
              <div
                key={i}
                style={{
                  fontSize: "13px",
                  lineHeight: 1.55,
                  padding: "3px 0",
                  color:
                    l.cls === "bad"
                      ? "#f0917e"
                      : l.cls === "good"
                        ? "#5ad19a"
                        : l.cls === "muted"
                          ? "var(--text-muted)"
                          : "var(--text-secondary)",
                }}
              >
                {l.text}
              </div>
            ))
          )}
        </div>
      )}

      {/* 결론·액션 카드 */}
      {verdict && (
        <div
          className={`alloc-verdict-card ${verdict.tone}`}
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${verdict.tone === "good" ? "#5ad19a" : verdict.tone === "bad" ? "#f0917e" : "var(--primary, #adc6ff)"}`,
            borderRadius: "var(--radius)",
            padding: "14px 16px",
            marginBottom: "1rem",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "6px" }}>📌 결론 — 이 예산으로 무엇을 할까</div>
          <div style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--text-secondary)" }}>{verdict.text}</div>
          {verdict.acts.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "13px", lineHeight: 1.6 }}>
              {verdict.acts.map((a, i) => (
                <li key={i} style={{ color: "var(--text-secondary)" }}>{a}</li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "18px", marginTop: "10px", fontSize: "12px", color: "var(--text-muted)" }}>
            <div>예상 {unitLabel}수 <strong style={{ color: "var(--text-primary)" }}>{formatNumberK(verdict.S.next.results, 0)}</strong></div>
            <div>예상 평균 {metricLabel} <strong style={{ color: "var(--text-primary)" }}>{verdict.S.prevAvgCPR != null ? fmtCostMetric(verdict.S.prevAvgCPR, effectiveMetric, currency) : "—"} → {verdict.S.nextAvgCPR != null ? fmtCostMetric(verdict.S.nextAvgCPR, effectiveMetric, currency) : "—"}</strong></div>
            {verdict.S.nextROAS != null && (
              <div>예상 ROAS <strong style={{ color: "var(--text-primary)" }}>{(verdict.S.nextROAS * 100).toFixed(1)}%</strong></div>
            )}
          </div>
        </div>
      )}

      {/* 총 합계 비교 카드 */}
      {summary && (
        <div style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "14px 16px", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "10px" }}>
            총 합계 비교{" "}
            <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 400 }}>
              알고리즘: {allocMode === "c" ? "절대 CPR 가중" : "한계효용 그리디"} · 분배 기준: {budgetPeriod === "monthly" ? "월 (÷30 환산)" : "일"}예산 · 비교 기준: 최근 {summary.recentDays}일 CPR 기반
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "12px", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>과거 기준 (최근 {summary.recentDays}일 평균 일예산)</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>비용 (일평균)</span><strong className="tnum">{fmtCurrency(summary.prev.cost, currency)}</strong></div>
              {summary.prev.installs > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>설치 (예상)</span><strong className="tnum">{formatNumberK(summary.prev.installs, 0)}</strong></div>}
              {summary.prev.actions > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>액션 (예상)</span><strong className="tnum">{formatNumberK(summary.prev.actions, 0)}</strong></div>}
              {summary.prev.revenue > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>매출 (예상)</span><strong className="tnum">{fmtCurrency(summary.prev.revenue, currency)}</strong></div>}
              <div style={{ borderTop: "1px solid var(--border)", margin: "6px 0" }}></div>
              {summary.prev.installs > 0 && summary.prev.cost > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>평균 CPI</span><strong className="tnum">{fmtCurrency(summary.prev.cost / summary.prev.installs, currency, { metric: true })}</strong></div>}
              {summary.prev.actions > 0 && summary.prev.cost > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>평균 CPA</span><strong className="tnum">{fmtCurrency(summary.prev.cost / summary.prev.actions, currency, { metric: true })}</strong></div>}
              {summary.prevROAS != null && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>평균 ROAS</span><strong className="tnum">{(summary.prevROAS * 100).toFixed(1)}%</strong></div>}
            </div>
            <div style={{ fontSize: "20px", color: "var(--text-muted)" }}>→</div>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px" }}>분배 후 예상 (일 단위)</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>총 배분 Cost</span><strong className="tnum">{fmtCurrency(summary.next.cost, currency)}{allocation.unallocated > 0 && <span style={{ color: "var(--text-muted)", fontSize: "11px" }}> +미배분 {fmtCurrency(allocation.unallocated, currency)}</span>}</strong></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>예상 {unitLabel}수</span><strong className="tnum">{formatNumberK(summary.next.results, 0)}</strong></div>
              {summary.nextRevenue > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>예상 매출</span><strong className="tnum">{fmtCurrency(summary.nextRevenue, currency)}</strong></div>}
              <div style={{ borderTop: "1px solid var(--border)", margin: "6px 0" }}></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>예상 평균 {metricLabel}</span><strong className="tnum">{fmtCostMetric(summary.nextAvgCPR, effectiveMetric, currency)}{(() => {
                const dPrev = displayMetricValue(summary.prevAvgCPR, effectiveMetric);
                const dNext = displayMetricValue(summary.nextAvgCPR, effectiveMetric);
                if (dPrev == null || dNext == null || dPrev === 0) return null;
                const d = dNext - dPrev;
                const good = roas ? d > 0 : d < 0;
                const ar = d > 0 ? "▲" : d < 0 ? "▼" : "—";
                const pct = Math.abs(d / dPrev) * 100;
                return <span style={{ fontSize: "11px", marginLeft: "4px", color: good ? "#5ad19a" : "#f0917e" }}>{ar} {pct.toFixed(1)}%</span>;
              })()}</strong></div>
              {summary.nextROAS != null && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "2px 0" }}><span>예상 ROAS</span><strong className="tnum">{(summary.nextROAS * 100).toFixed(1)}%</strong></div>}
            </div>
          </div>
        </div>
      )}

      <section className="block" id="s-controls">
        <h2 className="section-title"><span className="ix">§2</span>예산 배분 모델 설정</h2>
        <div className="alloc-card">
          <div style={{ marginBottom: "1rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "1rem" }}>
            <div className="sim-mode-toggle budget-period-toggle" style={{ display: "inline-flex", marginBottom: "8px" }}>
              <button type="button" className={simMode === "auto" ? "active" : ""} onClick={() => setSimMode("auto")}>총 예산 자동 분배</button>
              <button type="button" className={simMode === "manual" ? "active" : ""} onClick={() => setSimMode("manual")}>캠페인별 수동 시뮬레이션</button>
            </div>
            <p className="muted" style={{ fontSize: "12px", margin: 0 }}>
              {simMode === "auto" ? "총 예산을 입력하면 모델에 따라 가장 효율적인 비율로 자동 분배합니다." : "캠페인별 수동 시뮬레이션은 준비 중입니다 — 현재는 자동 분배 결과만 제공합니다."}
            </p>
          </div>

          {simMode === "auto" && (
            <div className="alloc-controls" style={{ display: "grid", gridTemplateColumns: "1fr 200px 120px", gap: "1rem" }}>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>총 예산</span>
                  <span className="budget-period-toggle">
                    <button type="button" className={budgetPeriod === "daily" ? "active" : ""} onClick={() => setBudgetPeriod("daily")}>일예산</button>
                    <button type="button" className={budgetPeriod === "monthly" ? "active" : ""} onClick={() => setBudgetPeriod("monthly")}>월예산</button>
                  </span>
                </label>
                <input type="text" inputMode="numeric" placeholder={budgetPeriod === "monthly" ? "예: 30,000,000 (월)" : "예: 1,000,000 (일)"} value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
              <div>
                <label>최적화 목표 ({metricLabel} 기준)</label>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 0" }}>
                  <strong style={{ color: "var(--primary, #adc6ff)" }}>
                    {effectiveObjective && ALLOC_OBJECTIVES[effectiveObjective] ? `${ALLOC_OBJECTIVES[effectiveObjective].short} ${ALLOC_OBJECTIVES[effectiveObjective].arrow}` : metricLabel}
                  </strong>
                  <button className="btn secondary" style={{ padding: "3px 8px", fontSize: "11px" }} onClick={() => setStep(1)}>변경</button>
                </div>
              </div>
              <div>
                <label>&nbsp;</label>
                <button className="btn primary" onClick={() => setRecalcTick((t) => t + 1)}>재계산</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>비교 기준 데이터</span>
            <span className="budget-period-toggle">
              {[7, 14, 28].map((d) => (
                <button key={d} type="button" className={recentDays === d ? "active" : ""} onClick={() => setRecentDays(d)}>{d}일</button>
              ))}
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>ℹ️ 최근 N일 평균 데이터로 CPR/ROAS 산출</span>
          </div>
        </div>
      </section>

      {/* §5 배분 점검 스트립 */}
      {verify && dailyBudget > 0 && items.length >= 2 && (
        <div
          style={{
            background: "var(--bg-1)",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${verify.tone === "good" ? "#5ad19a" : verify.tone === "bad" ? "#f0917e" : "var(--primary, #adc6ff)"}`,
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            marginBottom: "1rem",
            fontSize: "13px",
            lineHeight: 1.55,
          }}
        >
          <div>
            <strong>{verify.head}</strong> <span style={{ color: "var(--text-secondary)" }}>{verify.body}</span>
          </div>
          {verify.note && <div style={{ marginTop: "4px", color: "var(--text-muted)", fontSize: "12px" }}>{verify.note}</div>}
        </div>
      )}

      {showTable && (() => {
        // #3 이전(과거) 평균 컬럼 — 최근 N일 평균 일예산/결과/CPR + 전체 비중
        const prevByCh = {};
        let prevTotalDaily = 0;
        items.forEach((it) => {
          const h = historyByCh[it.channel];
          const daily = h && isFinite(h.windowCost) ? h.windowCost / recentDays : 0;
          const resDaily = h && isFinite(h.windowResults) ? h.windowResults / recentDays : 0;
          prevByCh[it.channel] = { daily, resDaily, cpr: h ? h.avgCPR : null };
          prevTotalDaily += daily;
        });
        return (
        <section className="block" id="s-table">
          <h2 className="section-title"><span className="ix">§3</span>채널별 상세</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px", margin: "0 0 0.5rem" }}>
            각 행은 채널의 <strong>제안된 분배 Cost</strong>와 그에 따른 <strong>예상 {unitLabel}·효율</strong>을 표시합니다. Cost를 직접 입력하면 🔒 잠금(고정)되고, Min/Max로 채널별 제약을 걸 수 있습니다.
          </p>
          <div className="table-wrap">
            <table className="data" style={{ fontSize: "12px" }}>
              <thead>
                <tr>
                  <th style={{ minWidth: "150px" }}>채널 (검증 통과)</th>
                  <th style={{ minWidth: "120px", textAlign: "right" }}>배분 Cost</th>
                  <th style={{ minWidth: "150px" }}>Min ~ Max</th>
                  <th style={{ minWidth: "90px", textAlign: "right" }}>예상 {unitLabel}</th>
                  <th style={{ minWidth: "90px", textAlign: "right" }}>예상 {roas ? "ROAS" : "CPR"}</th>
                  <th style={{ minWidth: "60px", textAlign: "right" }}>비중</th>
                  <th style={{ minWidth: "90px", textAlign: "right", borderLeft: "2px solid var(--border)", color: "var(--text-muted)" }}>이전 비용</th>
                  <th style={{ minWidth: "80px", textAlign: "right", color: "var(--text-muted)" }}>이전 {unitLabel}</th>
                  <th style={{ minWidth: "80px", textAlign: "right", color: "var(--text-muted)" }}>이전 {roas ? "ROAS" : "CPR"}</th>
                  <th style={{ minWidth: "60px", textAlign: "right", color: "var(--text-muted)" }}>이전 비중</th>
                </tr>
              </thead>
              <tbody>
                {!(dailyBudget > 0) ? (
                  <tr>
                    <td colSpan="10" style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>
                      총 예산을 입력하면 채널별 분배 결과가 계산됩니다.
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan="10" style={{ textAlign: "center", color: "var(--text-muted)", padding: "16px" }}>
                      배분 가능한 채널이 없습니다. 검증 단계(§2)에서 추세선 적합에 성공한 채널이 있는지 확인하세요.
                    </td>
                  </tr>
                ) : (
                  <>
                    {items.map((it, i) => {
                      const isZero = it.cost === 0;
                      const prev = prevByCh[it.channel] || { daily: 0, resDaily: 0, cpr: null };
                      const prevShare = prevTotalDaily > 0 ? (prev.daily / prevTotalDaily) * 100 : 0;
                      const minVal = allocMinSpend[it.channel];
                      const maxVal = allocMaxSpend[it.channel];
                      const overrideVal = allocOverrides[it.channel];
                      const isMinMaxErr = minVal != null && maxVal != null && minVal > maxVal;
                      const isOverrideMinErr = overrideVal != null && minVal != null && overrideVal < minVal;
                      const isOverrideMaxErr = overrideVal != null && maxVal != null && overrideVal > maxVal;
                      const costErr = isOverrideMinErr || isOverrideMaxErr;
                      const draftVal = costDrafts[it.channel];
                      const costDisplay = draftVal != null ? draftVal : Math.round(it.cost).toLocaleString();
                      return (
                        <tr key={it.channel} className={isZero ? "alloc-row-zero" : ""}>
                          <td>
                            <div className="alloc-ch-name" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <span className="sw" style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", background: CHART_THEME.series[i % CHART_THEME.series.length] }}></span>
                              {it.channel}
                              {simMode === "auto" ? null : it.locked && (
                                <button
                                  type="button"
                                  onClick={() => unlockCost(it.channel)}
                                  title="잠금 해제 (자동 분배로 되돌리기)"
                                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: "12px", padding: 0 }}
                                >
                                  🔒
                                </button>
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "flex-end" }}>
                              <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                className={`tnum ${it.locked ? "locked" : ""}`}
                                value={costDisplay}
                                disabled={simMode === "auto"}
                                title={simMode === "auto" ? "총 예산 자동 분배 모드에서는 채널별 수동 오버라이드를 지원하지 않습니다" : undefined}
                                onChange={(e) =>
                                  setCostDrafts((prev) => ({ ...prev, [it.channel]: e.target.value.replace(/[^\d,]/g, "") }))
                                }
                                onBlur={() => commitCost(it.channel)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitCost(it.channel);
                                }}
                                style={{
                                  width: "100px",
                                  textAlign: "right",
                                  fontSize: "12px",
                                  padding: "3px 6px",
                                  border: `1px solid ${costErr ? "#e05656" : "var(--border)"}`,
                                  borderRadius: "4px",
                                  background: simMode === "auto" ? "var(--bg-1)" : it.locked ? "rgba(173,198,255,0.08)" : "var(--bg-2)",
                                  color: simMode === "auto" ? "var(--text-muted)" : "var(--text-1)",
                                  cursor: simMode === "auto" ? "not-allowed" : "text",
                                }}
                              />
                              {simMode !== "auto" && it.locked && (
                                <button
                                  type="button"
                                  onClick={() => unlockCost(it.channel)}
                                  title="자동 분배로 되돌리기"
                                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: "12px", padding: 0 }}
                                >
                                  ↺
                                </button>
                              )}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                              <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                placeholder="Min"
                                value={minVal != null ? Math.round(minVal).toLocaleString() : ""}
                                onChange={(e) => setNumMap(setAllocMinSpend, it.channel, e.target.value)}
                                style={{ width: "62px", fontSize: "11px", padding: "3px 6px", border: `1px solid ${isMinMaxErr ? "#e05656" : "var(--border)"}`, borderRadius: "4px", background: "var(--bg-2)", color: "var(--text-1)" }}
                              />
                              <span style={{ color: "var(--text-muted)" }}>~</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                placeholder="Max"
                                value={maxVal != null ? Math.round(maxVal).toLocaleString() : ""}
                                onChange={(e) => setNumMap(setAllocMaxSpend, it.channel, e.target.value)}
                                style={{ width: "62px", fontSize: "11px", padding: "3px 6px", border: `1px solid ${isMinMaxErr ? "#e05656" : "var(--border)"}`, borderRadius: "4px", background: "var(--bg-2)", color: "var(--text-1)" }}
                              />
                            </div>
                          </td>
                          <td className="tnum" style={{ textAlign: "right" }}>
                            {isZero ? <span style={{ color: "var(--text-muted)" }}>—</span> : formatNumberK(it.results, 0)}
                          </td>
                          <td className="tnum" style={{ textAlign: "right" }}>
                            {isZero ? <span style={{ color: "var(--text-muted)" }}>—</span> : fmtCostMetric(it.cpr, effectiveMetric, currency)}
                          </td>
                          <td className="tnum" style={{ textAlign: "right" }}><strong>{(it.weight * 100).toFixed(1)}%</strong></td>
                          <td className="tnum" style={{ textAlign: "right", borderLeft: "2px solid var(--border)", color: "var(--text-muted)" }}>{prev.daily > 0 ? fmtCurrency(prev.daily, currency) : "—"}</td>
                          <td className="tnum" style={{ textAlign: "right", color: "var(--text-muted)" }}>{prev.resDaily > 0 ? formatNumberK(prev.resDaily, 0) : "—"}</td>
                          <td className="tnum" style={{ textAlign: "right", color: "var(--text-muted)" }}>{prev.cpr != null ? fmtCostMetric(prev.cpr, effectiveMetric, currency) : "—"}</td>
                          <td className="tnum" style={{ textAlign: "right", color: "var(--text-muted)" }}>{prevShare > 0 ? prevShare.toFixed(1) + "%" : "—"}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: "var(--bg-2)", fontWeight: "bold", borderTop: "2px solid var(--border)" }}>
                      <td style={{ textAlign: "right", paddingRight: "16px" }}>TOTAL</td>
                      <td className="tnum" style={{ textAlign: "right" }}>{fmtCurrency(totalCost, currency)}</td>
                      <td></td>
                      <td className="tnum" style={{ textAlign: "right" }}>{formatNumberK(totalResults, 0)}</td>
                      <td className="tnum" style={{ textAlign: "right" }}>{fmtCostMetric(avgCpr, effectiveMetric, currency)}</td>
                      <td className="tnum" style={{ textAlign: "right" }}>100.0%</td>
                      <td className="tnum" style={{ textAlign: "right", borderLeft: "2px solid var(--border)", color: "var(--text-muted)" }}>{prevTotalDaily > 0 ? fmtCurrency(prevTotalDaily, currency) : "—"}</td>
                      <td></td>
                      <td></td>
                      <td className="tnum" style={{ textAlign: "right", color: "var(--text-muted)" }}>{prevTotalDaily > 0 ? "100.0%" : "—"}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          {allocation.unallocated > 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "8px" }}>
              · 미배분 {fmtCurrency(allocation.unallocated, currency)} (한계효용 ≤ 0 — 더 투입해도 효율이 오르지 않음)
            </p>
          )}
          {allocation.overspent && (
            <p style={{ color: "#f0917e", fontSize: "12px", marginTop: "4px" }}>
              · ⚠ 잠금(고정)된 Cost 합계가 총 예산을 초과합니다. 잠금 값을 낮추거나 총 예산을 늘리세요.
            </p>
          )}
        </section>
        );
      })()}

      {simMode === "auto" && (
        <section className="block" id="s-bar">
          <h2 className="section-title">
            <span className="ix">§4</span>추천 배분 비중
            <span className="alloc-mode-toggle" style={{ marginLeft: "12px" }}>
              <button type="button" className={allocMode === "c" ? "active" : ""} onClick={() => setAllocMode("c")}>절대 CPR/ROAS 가중</button>
              <button type="button" className={allocMode === "b" ? "active" : ""} onClick={() => setAllocMode("b")}>그리디 (고급)</button>
            </span>
          </h2>
          {!(dailyBudget > 0) || items.length === 0 ? (
            <p className="muted" style={{ fontSize: "12px", marginTop: "12px" }}>
              총 예산을 입력하면 채널별 추천 배분 비중이 막대로 표시됩니다.
            </p>
          ) : (
            <div className="chart-container" style={{ height: "120px", marginTop: "12px" }}>
              <canvas id="alloc-bar" ref={barChartRef}></canvas>
            </div>
          )}
        </section>
      )}

      {/* §5 What-if 시나리오 */}
      {simMode === "auto" && (
        <section className="block" id="s-scenario">
          <h2 className="section-title"><span className="ix">§5</span>What-if 시나리오 (예산별 예상 성과)</h2>
          {!(dailyBudget > 0) || scenarios.length === 0 ? (
            <p className="muted" style={{ fontSize: "12px", marginTop: "12px" }}>
              총 예산을 입력하면 현재 예산의 0.5×~2× 구간을 동일 알고리즘으로 재배분한 예상 성과를 비교합니다.
            </p>
          ) : (
            <div className="alloc-card">
              <div className="chart-container" style={{ height: "280px" }}>
                <canvas id="alloc-scenario-chart" ref={scenarioChartRef}></canvas>
              </div>
              <div className="table-wrap" style={{ marginTop: "12px" }}>
                <table className="data" style={{ fontSize: "11.5px" }}>
                  <thead>
                    <tr>
                      <th>시나리오</th>
                      <th style={{ textAlign: "right" }}>예산(일)</th>
                      <th style={{ textAlign: "right" }}>예상 {unitLabel}수</th>
                      <th style={{ textAlign: "right" }}>예상 평균 {metricLabel}</th>
                      <th style={{ textAlign: "right" }}>Δ{unitLabel} vs 현재</th>
                      <th style={{ textAlign: "right" }}>ΔCost</th>
                      <th style={{ textAlign: "right" }}>증분 {roas ? "ROAS" : metricLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const base = scenarios.find((s) => s.m === 1.0);
                      return scenarios.map((s) => {
                        const dResults = base ? s.totResults - base.totResults : 0;
                        const dCost = base ? s.totCost - base.totCost : 0;
                        const marginal = dCost !== 0 ? dResults / dCost : null;
                        const isBase = s.m === 1.0;
                        return (
                          <tr key={s.m} style={{ background: isBase ? "rgba(173,198,255,0.10)" : "transparent" }}>
                            <td className="tnum">{s.m}× {isBase && <span style={{ color: "var(--primary, #adc6ff)", fontSize: "10px" }}>현재</span>}</td>
                            <td className="tnum" style={{ textAlign: "right" }}>{fmtCurrency(s.budget, currency)}</td>
                            <td className="tnum" style={{ textAlign: "right" }}><strong>{formatNumberK(s.totResults, 0)}</strong> {unitLabel}</td>
                            <td className="tnum" style={{ textAlign: "right" }}>{fmtCostMetric(s.avgCpr, effectiveMetric, currency)}</td>
                            <td className="tnum" style={{ textAlign: "right" }}>{isBase ? "—" : (dResults >= 0 ? "+" : "") + formatNumberK(dResults, 0)}</td>
                            <td className="tnum" style={{ textAlign: "right" }}>{isBase ? "—" : (dCost >= 0 ? "+" : "") + fmtCurrency(dCost, currency)}</td>
                            <td className="tnum" style={{ textAlign: "right" }}>{isBase || marginal == null ? "—" : roas ? marginal.toFixed(2) + "×" : fmtCurrency(1 / marginal, currency, { metric: true })}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: "11px", marginTop: "6px" }}>
                증분 {roas ? "ROAS" : metricLabel} = 현재 대비 <strong>추가 비용 1단위가 만드는 추가 {unitLabel}</strong>의 효율. 증액할수록 악화되면(=한계효용 체감) 그 지점이 증액 한계입니다.
              </p>
            </div>
          )}
        </section>
      )}

      {/* §6 알고리즘 노트 (index.html s-algo 이식) */}
      <section className="block" id="s-algo">
        <h2 className="section-title"><span className="ix">§6</span>알고리즘 노트</h2>
        <p>본 페이지는 Campaign Allocator(Streamlit)의 <strong>모드 A · 효율 기반 추천 비중</strong>을 JS로 포팅한 것입니다. 핵심 식:</p>
        <pre style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px", fontSize: "11.5px", overflowX: "auto", lineHeight: 1.5 }}>
          <code>{`# 1) 채널별 합산
channel_cost    = Σ cost
channel_results = Σ conversions   # installs or pu_d7

# 2) 채널별 CPR (Cost Per Result)
CPR = channel_cost / channel_results

# 3) Efficiency = 역수, 정규화
efficiency = 1 / CPR
weight     = efficiency_i / Σ efficiency

# 4) 배분
allocation = total_budget × weight`}</code>
        </pre>
        <p style={{ marginTop: "1rem" }}>
          <strong>그리디 (고급·실험적, 모드 B)</strong>는 채널별로 Linear/Log/Poly2/Power 추세선을 적합하고, 작은 step 단위로 Δresults가 최대인 채널에 예산을 투입하는 방식. CPR Cap(외삽 한도), 최신 데이터 가중치 옵션 포함.
        </p>
        <div className="callout warning" style={{ marginTop: "0.75rem" }}>
          <div className="ico">⚠</div>
          <div className="body">
            <strong>그리디 주의사항</strong>
            <p>채널별 spend 변동이 작거나 데이터가 적으면 곡선 적합이 불안정해져 추천이 편향될 수 있습니다. <strong>기본 추천은 절대 CPR/ROAS 가중</strong>을 권장합니다.</p>
          </div>
        </div>
        <div className="callout info" style={{ marginTop: "1rem" }}>
          <div className="ico">i</div>
          <div className="body">
            <strong>주의</strong>
            <p>본 추천은 과거 데이터 기준입니다. 신규 채널 진입, 시장 변화, 매체 알고리즘 업데이트 시 재계산 필요. 절대 CPR/ROAS 가중은 데이터 부족·노이즈 채널에서도 안정적인 1차 권고를 제공합니다.</p>
          </div>
        </div>
      </section>
      </ToolPageShell>
    </div>
  );
}
