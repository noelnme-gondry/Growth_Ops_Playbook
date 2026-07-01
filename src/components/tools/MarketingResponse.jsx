"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import Papa from "papaparse";
import Chart from "chart.js/auto";
import { useAppStore } from "@/store/useDataStore";
import { buildToolTemplateCsv } from "@/components/DataFeatureMatrix";
import {
  MMM_METH_CONFIG,
  MMM_CHANNELS,
  MMM_NONMEDIA_GROUPS,
  mmmValidate,
  mmmRunMmm,
  mmmChannelEffects,
  mmmWeeklyDecomp,
  mmmForecast,
  mmmTrendExistence,
  mmmElasticities,
  mmmCannibalization,
  mmmChannelCoverage,
  mmmIRF,
  mmmAudit,
  mmmMacroFacts,
  mmmResolveAbsorb,
  _mmmChans,
} from "@/utils/mmmMath";
import { mmmOls } from "@/utils/regMath";
import {
  mmmBuildCannibRank,
  mmmCannibLevel,
  mmmCannibAction,
  mmmCannibActionShort,
  mmmGlobalCannib,
  mmmGlobalCannibPlain,
  mmmCannibConf,
  mmmRankCfg,
  CANNIBAL_RANK,
} from "@/utils/responseCannibRank";
import {
  REG_LAB_STATE,
  regLabMakeSample,
  regLabLoad,
  regLabReadMapping,
  regLabRun,
  regLabFromMmm,
  _REG_ROLES,
} from "@/utils/regLabMath";
import { REG_FORECAST } from "@/utils/regForecastMath";
import CsvUploader from "@/components/CsvUploader";
import MmmColumnMapper, { autoGuessColMap, buildPanelFromColMap } from "@/components/tools/MmmColumnMapper";

/* ============================================================================
 * MarketingResponse (5-18) — MOCK → REAL 와이어링
 * index.html page_5_18 이식. 엔진(mmmMath/regMath/regForecastMath/regLabMath/
 * responseMath)은 이미 포팅·골든 검증됨 — 수학 재구현 금지, 이 컴포넌트는
 * (1) MmmColumnMapper(DnD colMap, index.html page_5_18 이식)가 PRIMARY 매퍼 — 단일 generic CSV를
 *     역할로 드래그 → buildPanelFromColMap로 패널 생성(모든 분석 공유)  (2) 엔진 호출  (3) 렌더.
 * 결정론(§3): 난수 사용 금지(0건). seededNoise만 사용.
 * ========================================================================== */

// _mmmSanKey 이식 — 채널/더미 키 위생(c_<slug>)
function mmmSanKey(name) {
  return (
    "c_" +
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  );
}

// 브랜드 채널 판별(이름 기반) — index kind='brand' 휴리스틱
function isBrandName(name) {
  return /brand|branded|검색|search.?ads|asa\b|apple.?search|브랜드/i.test(String(name || ""));
}

// _mmmTrimToActive 이식 — targets+ch 전부 0인 선/후행 주 제거(n≥4 가드)
function trimToActive(panel) {
  const n = panel.week.length;
  if (n < 4) return panel;
  const chKeys = Object.keys(panel.ch);
  const tgtKeys = Object.keys(panel.targets);
  const activeAt = (i) => {
    let s = 0;
    for (const k of tgtKeys) s += Math.abs(panel.targets[k][i] || 0);
    for (const k of chKeys) {
      const v = panel.ch[k][i];
      if (isFinite(v)) s += Math.abs(v || 0);
    }
    return s > 0;
  };
  let head = 0;
  while (head < n && !activeAt(head)) head++;
  let tail = n - 1;
  while (tail > head && !activeAt(tail)) tail--;
  if (head === 0 && tail === n - 1) return panel;
  if (tail - head + 1 < 4) return panel; // 너무 짧아지면 트림 안 함
  const slice = (arr) => arr.slice(head, tail + 1);
  const out = {
    ...panel,
    week: slice(panel.week),
    weekLabel: panel.weekLabel ? slice(panel.weekLabel) : undefined,
    ch: {},
    dummy: {},
    steps: {},
    targets: {},
  };
  for (const k of chKeys) out.ch[k] = slice(panel.ch[k]);
  for (const k of Object.keys(panel.dummy || {})) out.dummy[k] = slice(panel.dummy[k]);
  for (const k of Object.keys(panel.steps || {})) out.steps[k] = slice(panel.steps[k]);
  for (const k of tgtKeys) out.targets[k] = slice(panel.targets[k]);
  out.trimmed = { droppedHead: head, droppedTail: n - 1 - tail, origN: n, usedN: tail - head + 1 };
  return out;
}

function pickTarget(panel, preferred) {
  const avail = Object.keys(panel.targets);
  if (preferred && avail.includes(preferred)) return preferred;
  if (avail.includes("Regs")) return "Regs";
  return avail[0] || "Regs";
}

// 신뢰도 dots — p값 → ●●● / ●●○ / ●○○ / ○○○
function pDots(p) {
  if (p == null || !isFinite(p)) return "○○○";
  if (p < 0.01) return "●●●";
  if (p < 0.05) return "●●○";
  if (p < 0.1) return "●○○";
  return "○○○";
}
const POS = "#f87171";
const NEG = "#22c55e";
const MUTED = "var(--text-muted)";

const VERDICT_META = {
  incremental: { txt: "증분 ✓", color: NEG },
  suppress: { txt: "잠식 의심 ⚠", color: POS },
  noise: { txt: "불확실", color: MUTED },
  uncertain: { txt: "불확실", color: MUTED },
  sparse: { txt: "데이터 부족 ⊘", color: MUTED },
};

function fmtInt(v) {
  if (v == null || !isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

/* ── CSV helpers (§7 CRLF+BOM, RFC4180 quoting) — index _mmmDownload/q 이식 ── */
function csvQ(s) {
  s = String(s == null ? "" : s);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvNum(v, d = 2) {
  return v == null || !isFinite(v) ? "" : (+v).toFixed(d);
}
function csvDownload(name, lines) {
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
// 엑셀 열 문자(0→A). index colL 이식.
function csvColL(n) {
  let s = "",
    x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
const _today = () => new Date().toISOString().slice(0, 10);

/* ── §7 살아있는 수식 예측 CSV (index downloadMmmForecastCsv 이식) ──
 * spend 칸을 바꾸면 adstock→ln→예측이 엑셀 수식으로 자동 연쇄 계산.  */
function buildForecastCsv(fc, target) {
  const tKo = target === "Regs" ? "가입" : target === "React" ? "재활성" : target;
  const chByLn = {};
  fc.chans.forEach((ch) => (chByLn["ln_" + ch.key] = ch.label));
  const evLbl = {};
  (fc.steps || []).forEach((s) => {
    evLbl["d_" + s.key] = s.label;
    evLbl[s.key] = s.label;
  });
  const featPlain = (nm) => {
    if (nm === "(Intercept)") return "기본값 — 모든 재료가 0일 때의 출발점";
    if (nm === "trend") return "시간 추세 (전반적으로 늘고 있나 줄고 있나)";
    if (/^(sin|cos)_0$/.test(nm)) return "계절 패턴 (1년 주기)";
    if (/^(sin|cos)_/.test(nm)) return "계절 패턴 (보조 주기)";
    if (nm.startsWith("ln_"))
      return (
        (chByLn[nm] || nm.replace(/^ln_c_/, "").replace(/_/g, " ")) +
        " 지출 — 광고잔효+수확체감 변환값(클수록 예측↑, 계수 부호 따라)"
      );
    if (nm.startsWith("d_"))
      return "이벤트/휴일: " + (evLbl[nm] || nm.slice(2)) + " — 그 주 해당하면 1, 아니면 0";
    if (evLbl[nm]) return "구조변화: " + evLbl[nm] + " — 전환 후 1로 지속";
    return "재료 " + nm;
  };
  const L = [];
  let lamRow = 4;
  [
    ["# 도구", "MMM Trend Forecast (5-18)"],
    ["# 대상", tKo + " (" + target + ")"],
    ["# 모델", fc.model],
    ["# adstock_lambda(광고잔효 λ)", fc.lam],
    ["# R2(모델 적합도·1에 가까울수록 잘맞음)", fc.r2],
    ["# sigma_resid(평균 오차폭)", fc.sigma],
    ["# 과거 데이터 행수", fc.n],
    ["# 예측 기간(행)", fc.horizon],
    [
      "# 밴드 종류(95%)",
      fc.bandLabel +
        (fc.bandMode === "mean"
          ? " — 평균 추세 범위(좁음, t·σ·√leverage)"
          : " — 개별 주 범위(넓음, t·σ·√(1+leverage), 노이즈 포함)"),
    ],
    [
      "# 주의",
      "관측 회귀의 외삽(가설)입니다. 인과/증분 아님 — 확정은 holdout(5-15). 미래 휴일=0, 이벤트는 마지막 값 지속.",
    ],
  ].forEach((kv) => {
    if (String(kv[0]).includes("adstock_lambda")) lamRow = L.length + 1;
    L.push(kv.map(csvQ).join(","));
  });
  L.push("");
  // 계수표 (coef는 B열 — 아래 수식이 참조)
  L.push(["# 계수 (이 값들을 바꾸면 아래 예측이 자동 재계산됩니다)"].map(csvQ).join(","));
  L.push(
    ["term(재료)", "coef(계수)", "std_error(편차·불확실성)", "p_value(작을수록 신뢰)", "의미 (쉬운 설명)"]
      .map(csvQ)
      .join(","),
  );
  const coefRow = {};
  fc.coefTable.forEach((ct) => {
    coefRow[ct.term] = L.length + 1;
    L.push(
      [
        ct.term,
        csvNum(ct.coef, 6),
        ct.se == null ? "—" : csvNum(ct.se, 4),
        ct.p == null ? "—" : csvNum(ct.p, 4),
        featPlain(ct.term),
      ]
        .map(csvQ)
        .join(","),
    );
  });
  if (fc.isRidge)
    L.push(["# (릿지 모델은 정규화 추정이라 편차·p값이 없습니다)"].map(csvQ).join(","));
  L.push("");
  L.push(["# ── 아래 '예측값' 칸은 어떻게 나오나요? (엑셀 수식으로 살아있음) ──"].map(csvQ).join(","));
  [
    "# 1) 위 '기본값(Intercept)'에서 출발합니다.",
    "# 2) 각 재료마다 '계수'가 있습니다. 그 주의 '재료 값 × 계수'를 차례로 더합니다.",
    "# 3) 계수가 양수면 그 재료가 클수록 예측이 올라가고, 음수면 내려갑니다.",
    "# 4) 채널 지출(spend) 칸을 바꾸면 → 'adstock' 칸 → 'ln_채널' 칸 → 예측이 자동으로 줄줄이 다시 계산됩니다 (전부 수식).",
    "# 5) adstock(광고잔효) = 이번 주 지출 + λ × 지난주 adstock — 광고 효과가 다음 주로 이어지는 누적값입니다.",
    "# 6) ln_채널 = LN(1 + adstock) — 많이 쓸수록 추가 효과가 줄어드는(수확체감) 변환.",
    "# 7) 모든 재료를 더한 합이 그 주의 예측값입니다.",
    "# ※ 하한/상한(95%)은 예측값을 중심으로 한 오차 범위입니다 (미래만).",
    "# ※ adstock λ는 위 메타의 'adstock_lambda' 셀(B" + lamRow + ")을 참조합니다.",
  ].forEach((s) => L.push([s].map(csvQ).join(",")));
  L.push("");
  // 시계열 — spend → adstock → ln → 예측 살아있는 수식 체인
  const fcMatrix = fc.featMatrix;
  const featStart = 7,
    nNames = fc.names.length;
  const lnChanK = {};
  fc.chans.forEach((ch, k) => {
    const j = fc.names.indexOf("ln_" + ch.key);
    if (j >= 0) lnChanK[j] = k;
  });
  const chansLn = fc.chans.map((_, k) => k).filter((k) => Object.values(lnChanK).includes(k));
  const adStart = featStart + nNames,
    spStart = adStart + chansLn.length;
  const featCol = (j) => csvColL(featStart + j);
  const adCol = (k) => csvColL(adStart + chansLn.indexOf(k));
  const spCol = (k) => csvColL(spStart + k);
  const header = [
    "t",
    "label",
    "segment",
    "actual(실측)",
    "fitted_or_forecast(예측·수식)",
    "lo95(하한)",
    "hi95(상한)",
    ...fc.names,
    ...chansLn.map((k) => "adstock_" + fc.chans[k].label),
    ...fc.chans.map((ch) => "spend_" + ch.label),
  ];
  L.push("# 시계열 — spend 칸을 바꾸면 adstock·ln·예측이 자동 연쇄 계산 (전부 수식)");
  L.push(header.map(csvQ).join(","));
  const buildFitted = (er) =>
    "=$B$" +
    coefRow["(Intercept)"] +
    fc.names.map((nm, j) => "+$B$" + coefRow[nm] + "*" + featCol(j) + er).join("");
  const firstRow = L.length + 1;
  for (let i = 0; i < fc.n + fc.horizon; i++) {
    const er = L.length + 1,
      isHist = i < fc.n;
    const lbl = isHist ? fc.histLabels[i] : fc.futLabels[i - fc.n];
    const feats = fc.names.map((nm, j) =>
      lnChanK[j] != null ? "=LN(1+" + adCol(lnChanK[j]) + er + ")" : csvNum(fcMatrix[i][j], 6),
    );
    const adcells = chansLn.map((k) =>
      er === firstRow
        ? "=" + spCol(k) + er
        : "=" + spCol(k) + er + "+$B$" + lamRow + "*" + adCol(k) + (er - 1),
    );
    const spend = fc.chans.map((ch, k) =>
      isHist
        ? csvNum((fc.histSpendByKey[ch.key] || [])[i], 0)
        : csvNum(fc.futSpendByKey[ch.key][i - fc.n], 0),
    );
    let loCell = "",
      hiCell = "";
    if (!isHist) {
      const k = i - fc.n,
        margin = +(fc.hi[k] - fc.predFut[k]).toFixed(2);
      loCell = "=E" + er + "-" + margin;
      hiCell = "=E" + er + "+" + margin;
    }
    L.push(
      [
        i + 1,
        lbl,
        isHist ? "history" : "forecast",
        isHist ? Math.round(fc.actual[i]) : "",
        buildFitted(er),
        loCell,
        hiCell,
        ...feats,
        ...adcells,
        ...spend,
      ]
        .map(csvQ)
        .join(","),
    );
  }
  return L;
}

/* ── 채널별 카니발 삼각검증 + 탄력성·커버리지 CSV (index downloadMmmCannibCsv 이식) ── */
function buildCannibCsv(cannib, effects, target) {
  const chans = cannib.cannChannels || [];
  const effByKey = {};
  (effects || []).forEach((e) => (effByKey[e.key] = e));
  const header = [
    "channel", "channel_label", "is_brand_intercept", "verdict", "verdict_class",
    "vote_FOR", "vote_AGAINST", "vote_ABSTAIN", "for_bar", "power_gate_blocked",
    "power_gate_reasons", "reverse_causality_risk", "spend_time_corr",
    "prec_vote", "prec_low_n", "prec_p25", "prec_slope_per_wk", "prec_slope_p", "prec_change_pct",
    "detrend_vote", "detrend_raw", "detrend_detrended", "detrend_first_diff",
    "net_vote", "net_elasticity", "net_p", "net_ci_lo", "net_ci_hi",
    "elasticity", "ci_lo", "ci_hi", "p", "significant", "effect_verdict",
    "per10pct_pct", "weekly_per_1k", "mean_spend",
    "coverage_nonzero", "coverage_total", "coverage_ratio", "sparse", "trailing_zero",
    "granger_cannibal", "granger_help", "pacing",
    "granger_s2o_lag", "granger_s2o_F", "granger_s2o_p", "granger_s2o_coefsum",
    "granger_o2s_lag", "granger_o2s_F", "granger_o2s_p", "granger_o2s_coefsum",
  ];
  const lines = [header.map(csvQ).join(",")];
  for (const k of chans) {
    const cn = cannib.cannibByChannel[k];
    if (!cn) continue;
    const e = effByKey[k] || {};
    const pr = cn.precedence,
      dt = cn.detrend_corr,
      ni = cn.net_incrementality,
      vt = cn.votes || {},
      pg = cn.power_gate || {},
      g = cn.granger;
    const per10 = e.elas != null ? +(e.elas * 10).toFixed(2) : "";
    const cov = e.total ? +(e.nonzero / e.total).toFixed(3) : "";
    lines.push(
      [
        k, cn.channelLabel, cn.is_brand_intercept, cn.verdict, cn.verdict_class,
        vt.FOR, vt.AGAINST, vt.ABSTAIN, cn.for_bar, pg.blocked,
        (pg.reasons || []).join(" | "), cn.reverse_causality_risk, cn.spend_time_corr,
        pr.vote, pr.low_n, pr.p25, pr.kpi_slope_per_wk, pr.slope_p, pr.kpi_change_over_window_pct,
        dt.vote, dt.raw, dt.detrended, dt.first_diff,
        ni.vote, ni.net_elasticity, ni.p,
        ni.ci_lo != null ? ni.ci_lo : "", ni.ci_hi != null ? ni.ci_hi : "",
        e.elas != null ? e.elas : "", e.ci ? e.ci[0] : "", e.ci ? e.ci[1] : "",
        e.p != null ? e.p : "", e.sig != null ? e.sig : "", e.verdict || "",
        per10, e.weeklyPer1k == null ? "" : e.weeklyPer1k, e.meanSpend != null ? e.meanSpend : "",
        e.nonzero != null ? e.nonzero : "", e.total != null ? e.total : "", cov,
        e.sparse != null ? e.sparse : "", e.trailingZero != null ? e.trailingZero : "",
        cn.granger_cannibal, cn.granger_help, cn.pacing,
        g && g.spend_to_organic ? g.spend_to_organic.lag : "",
        g && g.spend_to_organic ? g.spend_to_organic.F : "",
        g && g.spend_to_organic ? g.spend_to_organic.p : "",
        g && g.spend_to_organic ? g.spend_to_organic.coefSum : "",
        g && g.organic_to_spend ? g.organic_to_spend.lag : "",
        g && g.organic_to_spend ? g.organic_to_spend.F : "",
        g && g.organic_to_spend ? g.organic_to_spend.p : "",
        g && g.organic_to_spend ? g.organic_to_spend.coefSum : "",
      ]
        .map(csvQ)
        .join(","),
    );
  }
  return lines;
}

/* ── §4 검정 원자료 CSV — 주별 타깃·채널별 ln(1+지출)·탈추세 잔차·1차차분
 * (index downloadMmmCannibSeriesCsv 이식 — 엑셀 CORREL로 화면 상관 직접 재현) ── */
function buildCannibSeriesCsv(panel, target) {
  const y = panel.targets[target],
    week = panel.week,
    n = week.length;
  const tr = week.map((_, i) => [1, i]);
  const yFit = mmmOls(tr, y);
  const yResid = yFit ? yFit.resid : y.map(() => null);
  const chans = _mmmChans(panel).filter((ch) => panel.ch[ch.key]);
  const series = chans.map((ch) => {
    const lnG = panel.ch[ch.key].map((v) => Math.log1p(v > 0 ? v : 0));
    const gFit = mmmOls(tr, lnG);
    return { ch, spend: panel.ch[ch.key], lnG, resid: gFit ? gFit.resid : lnG.map(() => null) };
  });
  const wl = (i) => (panel.weekLabel ? panel.weekLabel[i] : week[i]);
  const header = ["t", "week", target, target + "_detrend", target + "_diff"];
  chans.forEach((ch) =>
    header.push(
      "spend_" + ch.label,
      "ln_" + ch.label,
      "ln_" + ch.label + "_detrend",
      "ln_" + ch.label + "_diff",
    ),
  );
  const lines = [header.map(csvQ).join(",")];
  for (let i = 0; i < n; i++) {
    const row = [
      i + 1,
      wl(i),
      Math.round(y[i]),
      csvNum(yResid[i], 4),
      i > 0 ? (y[i] - y[i - 1]).toFixed(1) : "",
    ];
    series.forEach((s) =>
      row.push(
        isFinite(s.spend[i]) ? Math.round(s.spend[i]) : "",
        csvNum(s.lnG[i], 5),
        csvNum(s.resid[i], 5),
        i > 0 ? (s.lnG[i] - s.lnG[i - 1]).toFixed(5) : "",
      ),
    );
    lines.push(row.map(csvQ).join(","));
  }
  return lines;
}

// index.html MMM_STAGE_DEFS 이식 — 3단계 카드 탭(진단/기여/회귀·예측). 구 forecast(TF)는 lab에 흡수.
const MMM_STAGE_DEFS = [
  { id: "diagnose", no: "① 카니발", title: "카니발 진단", icon: "🔬", desc: "어느 채널이 오가닉을 잠식하나 / 추세 하락에 뭐가 영향 주나. 제거법 + 시차(lead/lag)." },
  { id: "mmm", no: "② 기여", title: "MMM 기여 분해", icon: "🧩", desc: "각 채널·이벤트가 매주 얼마 기여하나(decomp) + 채널별 효과. adstock·수확체감." },
  { id: "lab", no: "③ 회귀·예측", title: "회귀 · 미래 예측", icon: "📈", desc: "임의 CSV OLS(Cost·임의 변수 자유 매핑) — 계수·실제vs예측·기여도 + 미래 시나리오 예측(95% 밴드)·OS별 분리. MMM 데이터도 바로 불러오기." },
];

// 차트 테마·공통 옵션 — 컴포넌트 밖(상수)로 두어 effect 의존성 안정화
const CHART_THEME = { text: "#334155", muted: "#64748b", grid: "#e2e8f0" };
function chartBase() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { labels: { color: CHART_THEME.text, font: { size: 11 } } },
      tooltip: { backgroundColor: "rgba(15,23,42,0.9)", padding: 10, cornerRadius: 6 },
    },
    scales: {
      x: { ticks: { color: CHART_THEME.muted, font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: CHART_THEME.muted, font: { size: 10 } }, grid: { color: CHART_THEME.grid } },
    },
  };
}

export default function MarketingResponse() {
  // 3단계(index MMM_STAGE_DEFS): diagnose | mmm | lab. 구 "시뮬레이션"(forecast/TF)은
  // 회귀·미래예측(lab, REG_FORECAST)에 흡수·탭 제거(§12.15). forecast를 set하는 버튼 없음.
  const [stage, setStage] = useState("diagnose"); // diagnose | mmm | lab
  const [target, setTarget] = useState("Regs");
  const [decompModel, setDecompModel] = useState("ols"); // ols | ridge (merge/ridge 토글)
  const [spikeNotes, setSpikeNotes] = useState({}); // §5.5 튀는 구간 메모 { [target|week]: note }
  const [fcHorizon, setFcHorizon] = useState(13);
  const [fcBand, setFcBand] = useState("mean"); // mean | pred
  const [fcBudget, setFcBudget] = useState({}); // {chKey: 주 평균 예산} — 미입력 채널은 최근평균
  const [fcStepOff, setFcStepOff] = useState({}); // {stepKey: 켜둘 미래 기간 N} — 빈값=지속
  const [cannibChannel, setCannibChannel] = useState(null);
  const csvData = useAppStore((state) => state.csvData);
  const setCsvData = useAppStore((state) => state.setCsvData);
  const hasData = csvData?.raw?.length > 0;

  // 5-18 = colMap DnD가 PRIMARY 매퍼(index.html page_5_18 이식). 단일 generic CSV를
  // 주차/날짜/가입/재활성/채널(perf·brand)/더미/step 역할로 드래그 → 모든 분석(진단·MMM·시뮬)
  // 이 이 하나의 패널을 공유. 표준필드(DataFeatureMatrix) 경로 미사용.
  const [mmmColMap, setMmmColMap] = useState(null);
  const [mmmAnalyzedSig, setMmmAnalyzedSig] = useState(null);

  // CSV 로드 시 colMap 자동 초기화(이름 기반 부분 추정 — reg/react/채널만, 나머지는 트레이).
  const csvSig = hasData ? `${csvData.fileName}|${(csvData.headers || []).join(",")}` : "";
  const prevCsvSig = useRef(null);
  useEffect(() => {
    if (hasData && prevCsvSig.current !== csvSig) {
      setMmmColMap(autoGuessColMap(csvData.headers, csvData.raw));
      setMmmAnalyzedSig(null);
      prevCsvSig.current = csvSig;
    } else if (!hasData && prevCsvSig.current !== null) {
      setMmmColMap(null);
      setMmmAnalyzedSig(null);
      prevCsvSig.current = null;
    }
  }, [hasData, csvSig, csvData.headers, csvData.raw]);

  // 파일 업로드(자체 dropzone — 5-18은 표준 CsvUploader/DataFeatureMatrix 미사용).
  const mmmFileRef = useRef(null);
  const handleMmmFile = (file) => {
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
  const colMapSig = mmmColMap ? JSON.stringify(mmmColMap) : "";
  const mmmAnalyzed = mmmAnalyzedSig != null && mmmAnalyzedSig === colMapSig;

  // Lab 상태 (REG_LAB_STATE 전역 미러) — 별도 CSV
  const [labVersion, setLabVersion] = useState(0);
  const [labError, setLabError] = useState("");

  // Chart refs
  const cvRef = useRef(null);
  const shapleyRef = useRef(null);
  const satRef = useRef(null);
  const fitRef = useRef(null);
  const decompRef = useRef(null);
  const forecastRef = useRef(null);
  const trendRef = useRef(null);
  const simpleRef = useRef(null);
  const labChartRef = useRef(null);
  const irfRef = useRef(null);

  // ── MMM 캐시 (buildMmmMethCache 축약) — 매핑·데이터·target·model 변경 시 재계산 ──
  const mmm = useMemo(() => {
    if (!hasData) return null;
    // 분석 게이트(index 분석하기): 매핑 확정 전엔 무거운 엔진(mmmRunMmm 등)을 돌리지 않음 —
    // 드래그 도중 반쯤 매핑된 colMap으로 엔진이 도는 것을 막고(성능·크래시 방지) 게이트 후에만 계산.
    if (!mmmAnalyzed) return { empty: true, reason: "매핑 확정(분석하기) 후 결과가 표시됩니다." };
    try {
      // colMap(PRIMARY) → 패널. 미완성이면 매핑 안내(패널 empty).
      if (!mmmColMap) return { empty: true, reason: "컬럼 역할을 매핑하세요 (주차·가입/재활성·채널 spend)." };
      const built = buildPanelFromColMap(csvData.headers, csvData.raw, mmmColMap);
      if (built.missing.length) return { empty: true, reason: "필수 역할 미지정: " + built.missing.join(", ") };
      const panel = trimToActive(built.panel);
      const cfg = { ...MMM_METH_CONFIG, absorbed: new Set() };
      const t = pickTarget(panel, target);
      const validate = mmmValidate(panel);
      const derived = {
        orientation: "colmap",
        target: t,
        availableTargets: Object.keys(panel.targets),
        channels: built.roles.channels.map((c) => c.label),
        time: built.roles.week.length ? "매핑된 주차 컬럼" : "행 순서",
        n: panel.week.length,
        dummies: built.roles.dummies.map((d) => d.label),
        useDummies: panel.useDummies,
      };
      // 자동 흡수(공선쌍) — index와 동일 순서: resolve → cfg.absorbed 세팅 → run/effects/decomp가 반영.
      const absorb = mmmResolveAbsorb(panel, cfg);
      cfg.absorbed = absorb.absorbed;
      const run = mmmRunMmm(panel, cfg, t);
      const effects = mmmChannelEffects(panel, cfg, t, run.best_lambda);
      return { empty: false, panel, cfg, derived, target: t, validate, run, effects, absorb };
    } catch (e) {
      // null-fit(특이행렬)은 대개 채널 공선성(예산이 함께 움직임)·기간 부족 → 정직한 도메인 메시지 (§8)
      const msg = String(e && e.message || "");
      if (/reading '?(beta|coef|params)'?|null|singular|is not a function/i.test(msg)) {
        return {
          empty: true,
          reason:
            "회귀 추정 불가 — 채널 지출이 서로 강하게 연동(공선성)되어 있거나 유효 기간(주)이 부족합니다. 채널별로 독립적인 지출 변동이 있는 데이터가 필요합니다.",
        };
      }
      return { empty: true, reason: "분석 오류: " + msg };
    }
  }, [hasData, csvData, target, mmmColMap, mmmAnalyzed]);

  const decomp = useMemo(() => {
    if (!mmm || mmm.empty || stage !== "mmm") return null;
    try {
      return mmmWeeklyDecomp(mmm.panel, mmm.cfg, mmm.target, mmm.run.best_lambda, decompModel);
    } catch (e) {
      return null;
    }
  }, [mmm, stage, decompModel]);

  const forecast = useMemo(() => {
    if (!mmm || mmm.empty || stage !== "forecast") return null;
    try {
      // fcBudget: 채널별 주 평균 예산(명시 채널만 H개로 채움) → 미입력은 mmmForecast가 최근평균 사용.
      const chans = _mmmChans(mmm.panel).filter((ch) => mmm.panel.ch[ch.key]);
      const futureSpend = {};
      chans.forEach((ch) => {
        const b = fcBudget[ch.key];
        if (b != null && isFinite(b)) futureSpend[ch.key] = Array(fcHorizon).fill(b);
      });
      const hasBudget = Object.keys(futureSpend).length > 0;
      const hasStepOff = Object.keys(fcStepOff).length > 0;
      return mmmForecast(
        mmm.panel,
        mmm.cfg,
        mmm.target,
        mmm.run.best_lambda,
        decompModel,
        hasBudget ? futureSpend : null,
        fcHorizon,
        hasStepOff ? fcStepOff : null,
        fcBand,
      );
    } catch (e) {
      return null;
    }
  }, [mmm, stage, decompModel, fcHorizon, fcBand, fcBudget, fcStepOff]);

  const trend = useMemo(() => {
    if (!mmm || mmm.empty || stage !== "diagnose") return null;
    try {
      return mmmTrendExistence(mmm.panel, mmm.cfg, mmm.target);
    } catch (e) {
      return null;
    }
  }, [mmm, stage]);

  // 채널별 카니발 + §4.5 랭킹/전역 종합 (index buildMmmMethCache byTarget 오케스트레이션 포트)
  const cannib = useMemo(() => {
    if (!mmm || mmm.empty || stage !== "diagnose") return null;
    try {
      const { panel, cfg, target: t } = mmm;
      const elas = mmmElasticities(panel, cfg, t, cfg.defaultLam);
      const chans = _mmmChans(panel).filter((c) => panel.ch[c.key]);
      const cannibByChannel = {};
      const cannChannels = [];
      const rows = chans.map((c) => {
        const e = elas.find((x) => x.var === "ln_" + c.key);
        const net = e
          ? { coef: e.coef, ci_lo: e.ci_lo, ci_hi: e.ci_hi, p: e.p }
          : { coef: 0, ci_lo: -1, ci_hi: 1, p: 1 };
        const cn = mmmCannibalization(panel, cfg, t, net, c.key);
        cannibByChannel[c.key] = cn;
        cannChannels.push(c.key);
        return { channel: c, verdict: cn };
      });
      // 데이터 충분성(적격) 게이트 — index isIdentified: 집행주·지출변동CV·df (공선은 제외 안 함)
      const cov = mmmChannelCoverage(panel, cfg);
      const rcfg = mmmRankCfg();
      const isIdentified = (k) =>
        CANNIBAL_RANK.eligibility(panel.ch[k] || [], (cov[k] || { nonzero: 0 }).nonzero, rcfg)
          .eligible;
      const identifiedChannels = cannChannels.filter(isIdentified);
      const globalCannib = mmmGlobalCannib(cannibByChannel, identifiedChannels);
      const cannibRank = mmmBuildCannibRank(panel, t, cannibByChannel, cov, cannChannels);
      return { rows, cannibByChannel, cannChannels, cov, identifiedChannels, globalCannib, cannibRank };
    } catch (e) {
      return null;
    }
  }, [mmm, stage]);

  // ── §1 매크로 사실 + 자동 흡수(공선) + §2 naive-model audit (모델 독립) ──
  const diag = useMemo(() => {
    if (!mmm || mmm.empty || stage !== "diagnose") return null;
    try {
      const { panel, cfg } = mmm;
      // 주별 Date 배열 — weekLabel이 ISO(YYYY-MM-DD)면 그것을, 아니면 macro는 빈 객체.
      const dates = (panel.weekLabel || []).map((s) => {
        const t = new Date(String(s) + "T00:00:00Z").getTime();
        return isNaN(t) ? null : new Date(t);
      });
      const validDates = dates.every(Boolean) && dates.length === panel.week.length;
      const macro = validDates ? mmmMacroFacts(panel, cfg, dates) : {};
      // 자동 흡수는 mmm useMemo에서 이미 cfg.absorbed에 반영됨 — 여기선 노티스 표시용으로 재사용.
      const absorb = mmm.absorb || { absorbed: new Set(), notices: [] };
      // naive-model audit (RR 필요 — Regs+React 둘 다 있어야 의미). throw 가드.
      let audit = null;
      try {
        audit = mmmAudit(panel, cfg);
      } catch (e) {
        audit = null;
      }
      return { macro, absorb, audit, validDates };
    } catch (e) {
      return null;
    }
  }, [mmm, stage]);

  // target 사용 가능 목록 (setState-in-effect 회피: 선택은 파생값으로 클램프, mmm.target이 실제 사용 타깃)
  const availTargets = mmm && !mmm.empty ? mmm.derived.availableTargets : [];

  const cannibChannels = cannib ? cannib.rows.map((r) => r.channel.key) : [];
  const activeCannibCh =
    cannibChannel && cannibChannels.includes(cannibChannel)
      ? cannibChannel
      : cannibChannels[0] || null;
  // 활성 채널의 카니발 검정 결과(§4 상세용)
  const activeCn =
    cannib && activeCannibCh ? cannib.cannibByChannel[activeCannibCh] : null;

  /* ------------------------------ CHARTS ------------------------------ */
  // Stage ② charts: CV, Shapley, saturation, fit, decomp
  useEffect(() => {
    const inst = [];
    if (stage === "mmm" && mmm && !mmm.empty) {
      const run = mmm.run;
      // CV chart (adstock λ vs OOS RMSE)
      if (cvRef.current && run.cv_rmse) {
        const grid = mmm.cfg.adstockGrid.filter((l) => run.cv_rmse[l] != null);
        inst.push(
          new Chart(cvRef.current.getContext("2d"), {
            type: "line",
            data: {
              labels: grid.map((l) => l.toFixed(1)),
              datasets: [
                {
                  label: "OOS RMSE",
                  data: grid.map((l) => run.cv_rmse[l]),
                  borderColor: "#7aa2f7",
                  pointBackgroundColor: grid.map((l) => (l === run.best_lambda ? NEG : "#7aa2f7")),
                  pointRadius: grid.map((l) => (l === run.best_lambda ? 6 : 3)),
                  tension: 0.2,
                },
              ],
            },
            options: chartBase(),
          }),
        );
      }
      // Shapley R² share (horizontal bar)
      if (shapleyRef.current && run.shapley?.rows?.length) {
        const rows = [...run.shapley.rows].sort((a, b) => b.r2_share - a.r2_share);
        inst.push(
          new Chart(shapleyRef.current.getContext("2d"), {
            type: "bar",
            data: {
              labels: rows.map((r) => r.driver),
              datasets: [
                {
                  label: "R² 기여",
                  data: rows.map((r) => +r.r2_share.toFixed(4)),
                  backgroundColor: "#7aa2f7",
                  borderRadius: 3,
                },
              ],
            },
            options: {
              ...chartBase(),
              indexAxis: "y",
              plugins: {
                ...chartBase().plugins,
                tooltip: {
                  callbacks: { label: (c) => `${(rows[c.dataIndex].pct || 0).toFixed(1)}% (R² ${c.parsed.x})` },
                },
              },
            },
          }),
        );
      }
      // Saturation curves (per channel, y = ln_coef/(1+x)*1000)
      if (satRef.current && run.saturationByChannel) {
        const chs = Object.entries(run.saturationByChannel);
        if (chs.length) {
          const maxSpend = Math.max(...chs.map(([, s]) => s.recentMean || 0), 60000);
          const grid = Array.from({ length: 25 }, (_, i) => (i / 24) * maxSpend);
          const palette = ["#7aa2f7", "#f7768e", "#9ece6a", "#e0af68", "#bb9af7", "#7dcfff"];
          inst.push(
            new Chart(satRef.current.getContext("2d"), {
              type: "line",
              data: {
                labels: grid.map((x) => "$" + Math.round(x / 1000) + "k"),
                datasets: chs.map(([, s], i) => ({
                  label: s.label,
                  data: grid.map((x) => (s.ln_coef / (1 + x)) * 1000),
                  borderColor: palette[i % palette.length],
                  borderDash: s.ln_coef < 0 ? [5, 4] : [],
                  pointRadius: 0,
                  tension: 0.3,
                })),
              },
              options: chartBase(),
            }),
          );
        }
      }
      // Fit chart (actual vs fitted vs baseline)
      if (fitRef.current && decomp) {
        const labels = decomp.weeks.map((w, i) => mmm.panel.weekLabel?.[i] || w.week);
        inst.push(
          new Chart(fitRef.current.getContext("2d"), {
            type: "line",
            data: {
              labels,
              datasets: [
                { label: "실제", data: decomp.weeks.map((w) => w.actual), borderColor: CHART_THEME.muted, pointRadius: 0, tension: 0.2 },
                { label: "모델", data: decomp.weeks.map((w) => w.fitted), borderColor: "#7aa2f7", pointRadius: 0, tension: 0.2 },
                { label: "baseline", data: decomp.weeks.map((w) => w.baseline), borderColor: "#e0af68", borderDash: [5, 4], pointRadius: 0 },
              ],
            },
            options: chartBase(),
          }),
        );
      }
      // Decomp stacked area (baseline + cumulative contribution)
      if (decompRef.current && decomp) {
        const labels = decomp.weeks.map((w, i) => mmm.panel.weekLabel?.[i] || w.week);
        const drawGroups = decomp.groupNames;
        const palette = ["#565f89", "#7aa2f7", "#f7768e", "#9ece6a", "#e0af68", "#bb9af7", "#7dcfff", "#ff9e64"];
        // 누적 스택: baseline 먼저, 그 위로 각 그룹 contrib 누적
        const datasets = [];
        datasets.push({
          label: "baseline",
          data: decomp.weeks.map((w) => w.baseline),
          backgroundColor: "rgba(86,95,137,0.35)",
          borderColor: "#565f89",
          fill: "origin",
          pointRadius: 0,
          tension: 0.2,
        });
        let cum = decomp.weeks.map((w) => w.baseline);
        drawGroups.forEach((g, i) => {
          cum = cum.map((v, t) => v + decomp.weeks[t].contrib[g]);
          datasets.push({
            label: g,
            data: cum.slice(),
            backgroundColor: palette[i % palette.length] + "55",
            borderColor: palette[i % palette.length],
            fill: "-1",
            pointRadius: 0,
            tension: 0.2,
          });
        });
        datasets.push({
          label: "실제",
          data: decomp.weeks.map((w) => w.actual),
          borderColor: "#fff",
          backgroundColor: "transparent",
          fill: false,
          pointRadius: 0,
          borderWidth: 1.5,
        });
        inst.push(
          new Chart(decompRef.current.getContext("2d"), {
            type: "line",
            data: { labels, datasets },
            options: chartBase(),
          }),
        );
      }
    }
    return () => inst.forEach((c) => c && c.destroy());
  }, [stage, mmm, decomp]);

  // Stage ③ forecast chart
  useEffect(() => {
    const inst = [];
    if (stage === "forecast" && forecast && forecastRef.current) {
      const fc = forecast;
      const nHist = fc.splitAt;
      const labels = fc.labels;
      // actual: hist만; model: hist fitted + future pred (n-1 지점 연결)
      const actual = [...fc.actual, ...Array(fc.horizon).fill(null)];
      const model = [
        ...fc.fittedHist,
        ...Array(fc.horizon).fill(null),
      ];
      const future = [
        ...Array(nHist - 1).fill(null),
        fc.fittedHist[nHist - 1],
        ...fc.predFut,
      ];
      const bandLo = [...Array(nHist).fill(null), ...fc.lo];
      const bandHi = [...Array(nHist).fill(null), ...fc.hi];
      inst.push(
        new Chart(forecastRef.current.getContext("2d"), {
          type: "line",
          data: {
            labels,
            datasets: [
              { label: "실제", data: actual, borderColor: CHART_THEME.muted, pointRadius: 0, tension: 0.2 },
              { label: "모델(과거)", data: model, borderColor: "#7aa2f7", pointRadius: 0, tension: 0.2 },
              { label: "예측(미래)", data: future, borderColor: "#7aa2f7", borderDash: [6, 4], pointRadius: 0, tension: 0.2 },
              { label: "상한", data: bandHi, borderColor: "transparent", backgroundColor: "rgba(122,162,247,0.12)", fill: "+1", pointRadius: 0 },
              { label: "하한", data: bandLo, borderColor: "transparent", backgroundColor: "rgba(122,162,247,0.12)", fill: false, pointRadius: 0 },
            ],
          },
          options: chartBase(),
        }),
      );
    }
    return () => inst.forEach((c) => c && c.destroy());
  }, [stage, forecast]);

  // Stage ① trend chart (STL trend + actual)
  useEffect(() => {
    const inst = [];
    if (stage === "diagnose" && trend && trendRef.current && mmm && !mmm.empty) {
      const y = mmm.panel.targets[mmm.target];
      const labels = mmm.panel.weekLabel || y.map((_, i) => i + 1);
      inst.push(
        new Chart(trendRef.current.getContext("2d"), {
          type: "line",
          data: {
            labels,
            datasets: [
              { label: "실제", data: y, borderColor: CHART_THEME.muted, pointRadius: 0, tension: 0.15 },
              { label: "STL 추세", data: trend.stl?.trend || [], borderColor: "#7aa2f7", pointRadius: 0, borderWidth: 2 },
            ],
          },
          options: chartBase(),
        }),
      );
    }
    return () => inst.forEach((c) => c && c.destroy());
  }, [stage, trend, mmm]);

  // Stage ① §4 채널 상세 — 임펄스 응답(IRF): 지출 1SD 충격 → 타깃 반응 곡선
  useEffect(() => {
    const inst = [];
    if (
      stage === "diagnose" &&
      mmm &&
      !mmm.empty &&
      irfRef.current &&
      cannib &&
      activeCannibCh
    ) {
      try {
        const y = mmm.panel.targets[mmm.target] || [];
        const spend = mmm.panel.ch[activeCannibCh] || [];
        const irf = mmmIRF(y, spend, { horizon: 12 });
        if (irf) {
          const labels = irf.irf.map((_, i) => (i === 0 ? "충격" : `+${i}주`));
          inst.push(
            new Chart(irfRef.current.getContext("2d"), {
              type: "line",
              data: {
                labels,
                datasets: [
                  {
                    label: "주별 반응",
                    data: irf.irf,
                    borderColor: "#7aa2f7",
                    pointRadius: 0,
                    tension: 0.25,
                  },
                  {
                    label: "누적 반응",
                    data: irf.cum,
                    borderColor: "#e0af68",
                    borderDash: [5, 4],
                    pointRadius: 0,
                    tension: 0.2,
                  },
                ],
              },
              options: chartBase(),
            }),
          );
        }
      } catch (e) {
        /* IRF 데이터 부족(n<24) — 차트 생략 */
      }
    }
    return () => inst.forEach((c) => c && c.destroy());
  }, [stage, mmm, cannib, activeCannibCh]);

  // Stage ① simple-cannib chart 없음 (통계 카드만) — 잔차 산점도는 디퍼

  // Lab chart (actual vs predicted)
  useEffect(() => {
    const inst = [];
    if (stage === "lab" && labVersion > 0 && labChartRef.current && REG_LAB_STATE.fits) {
      const fits = REG_LAB_STATE.fits;
      const firstTag = Object.keys(fits)[0];
      const f = fits[firstTag];
      if (f) {
        const pred = f.fit.yhat || f.fit.fitted || [];
        inst.push(
          new Chart(labChartRef.current.getContext("2d"), {
            type: "line",
            data: {
              labels: f.labels,
              datasets: [
                { label: "실제", data: f.y, borderColor: CHART_THEME.muted, pointRadius: 0, tension: 0.15 },
                { label: "예측", data: pred, borderColor: "#7aa2f7", pointRadius: 0, tension: 0.15 },
              ],
            },
            options: chartBase(),
          }),
        );
      }
    }
    return () => inst.forEach((c) => c && c.destroy());
  }, [stage, labVersion]);

  /* ------------------------------ LAB actions ------------------------------ */
  const runLabSample = () => {
    setLabError("");
    try {
      const { rows, fields } = regLabMakeSample();
      REG_LAB_STATE.fileName = "sample.csv";
      regLabLoad(rows, fields);
      regLabRun();
      setLabVersion((v) => v + 1);
    } catch (e) {
      setLabError(e.message);
      setLabVersion((v) => v + 1);
    }
  };
  // 업로드한 MMM CSV + colMap 역할 → 회귀 역할로 번역해 lab에 로드(§12.15 브리지). "지가 어디서 컬럼
  // 가져옴" 버그 수정: 샘플 대신 실제 업로드 데이터를 씀.
  const mmmBridgeReady =
    hasData && mmmColMap && Object.values(mmmColMap).some((d) => d && d.role === "channel");
  const runLabFromMmm = () => {
    setLabError("");
    try {
      REG_LAB_STATE.fileName = (csvData.fileName || "mmm_data.csv") + " (MMM)";
      if (!regLabFromMmm(csvData.raw, csvData.headers, mmmColMap, target)) {
        setLabError("MMM 데이터를 불러올 수 없습니다 — 채널 spend가 매핑됐는지 확인하세요.");
        return;
      }
      regLabRun();
      setLabVersion((v) => v + 1);
    } catch (e) {
      setLabError(e.message);
      setLabVersion((v) => v + 1);
    }
  };
  const labForecast = useMemo(() => {
    if (stage !== "lab" || labVersion === 0 || !REG_LAB_STATE.fits) return null;
    try {
      const fits = REG_LAB_STATE.fits;
      const firstTag = Object.keys(fits)[0];
      const f = fits[firstTag];
      if (!f) return null;
      const mapping = regLabReadMapping();
      const m = {
        dep: f.m.dep,
        indep: f.m.indep,
        time: f.m.time,
        types: mapping.types,
        tf: mapping.tf,
      };
      return REG_FORECAST.run({
        rows: f.rows,
        m,
        lam: f.lam,
        horizon: REG_LAB_STATE.fc.horizon,
        bandMode: REG_LAB_STATE.fc.band,
        season: REG_LAB_STATE.fc.season,
        futureSpec: {},
      });
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }, [stage, labVersion]);

  /* ------------------------------ RENDER ------------------------------ */
  // index.html MMM_STAGE_DEFS(3단계) + renderMmmStageTabs 카드형 탭 이식. 구 "시뮬레이션"(TF)은
  // §12.15대로 회귀·미래예측(lab)에 흡수. 카드: no·아이콘·제목·설명 + active 하이라이트.
  const renderTabs = () => (
    <section className="block" style={{ padding: 0, border: "none", background: "none", marginBottom: "20px" }}>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {MMM_STAGE_DEFS.map((d) => {
          const on = stage === d.id;
          return (
            <button
              key={d.id}
              onClick={() => setStage(d.id)}
              style={{
                flex: 1, minWidth: "170px", textAlign: "left", color: "var(--text-1)",
                background: on ? "linear-gradient(135deg,rgba(122,162,247,0.16),rgba(122,162,247,0.04))" : "var(--bg-2)",
                border: `1px solid ${on ? "rgba(122,162,247,0.55)" : "var(--border)"}`,
                borderRadius: "12px", padding: "11px 14px", cursor: "pointer", transition: "all .15s",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: ".04em", color: on ? "#adc6ff" : "var(--text-2)" }}>{d.no}</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-1)", marginTop: "1px" }}>{d.icon} {d.title}</div>
              <div style={{ fontSize: "10.5px", color: "var(--text-2)", marginTop: "2px", lineHeight: 1.35 }}>{d.desc}</div>
            </button>
          );
        })}
      </div>
    </section>
  );

  // 5-18은 CsvUploader/DataFeatureMatrix를 안 쓰지만(§ colMap PRIMARY), 다른 도구와 똑같이
  // "⬇ 이 도구 템플릿 CSV" 다운로드는 있어야 함 — TOOL_REQUIRED/OPTIONAL_FIELDS["5-18"] 기준
  // (week/mmm_reg/mmm_react/ch_*) 헤더만 있는 빈 템플릿(§12.19 buildToolTemplateCsv 재사용).
  const downloadMmmTemplate = () => {
    const csv = buildToolTemplateCsv("5-18", "tool");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "template_5-18.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // 5-18 전용 dropzone (표준 CsvUploader/DataFeatureMatrix 미사용 — 단일 generic CSV → colMap).
  const mmmDropzone = (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
        <button className="ab-pill" onClick={downloadMmmTemplate}>⬇ 이 도구 템플릿 CSV</button>
      </div>
      <div
        className="csv-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) handleMmmFile(e.dataTransfer.files[0]); }}
        onClick={() => mmmFileRef.current?.click()}
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
        <div className="csv-drop-sub">주간 패널 CSV. 업로드 후 컬럼을 역할로 드래그합니다. 주차·가입(또는 재활성)·채널 spend 1개 이상 필요.</div>
        <input type="file" accept=".csv,text/csv" style={{ display: "none" }} ref={mmmFileRef}
          onChange={(e) => { if (e.target.files?.[0]) handleMmmFile(e.target.files[0]); e.target.value = null; }} />
      </div>
    </>
  );

  // colMap 매퍼 + 분석 게이트 섹션 (CSV 로드 후 · 분석 전). index.html §0 데이터·매핑 이식.
  const mmmMapperSection = () => {
    const built = mmmColMap ? buildPanelFromColMap(csvData.headers, csvData.raw, mmmColMap) : { missing: ["매핑"] };
    const ready = mmmColMap && built.missing.length === 0;
    return (
      <section className="block" id="s-prep">
        <div className="file-state">
          <div className="meta-text">
            <span className="dot" style={{ background: "#22c55e" }}></span>
            <strong>{csvData.fileName}</strong>
            <span className="csv-loaded-stats tnum">{csvData.raw.length.toLocaleString()}행 · {csvData.headers.length}컬럼</span>
          </div>
          <button className="ab-pill csv-change-btn" title="CSV 제거 후 다른 파일 업로드"
            onClick={() => setCsvData({ raw: [], headers: [], mapping: {}, fileName: "" })}>⟳ CSV 변경</button>
        </div>
        <h3 style={{ fontSize: "14px", margin: "12px 0 8px", color: "var(--primary, #adc6ff)" }}>🗂 컬럼 역할 매핑 (드래그로 지정)</h3>
        <MmmColumnMapper
          headers={csvData.headers}
          rows={csvData.raw}
          colMap={mmmColMap || autoGuessColMap(csvData.headers, csvData.raw)}
          onChange={setMmmColMap}
        />
        {ready && (
          <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", background: "linear-gradient(135deg,rgba(122,162,247,0.12),rgba(122,162,247,0.03))", border: "1px solid rgba(122,162,247,0.3)", borderRadius: "10px", padding: "14px 16px" }}>
            <span style={{ fontSize: "12.5px", color: "var(--text-1)" }}>✅ 필수 역할 매핑 완료. <strong>매핑이 맞는지 확인한 뒤 분석을 실행하세요.</strong> <span style={{ color: "var(--text-muted)" }}>(매핑만으로 자동 분석하지 않습니다.)</span></span>
            <button className="ab-button" style={{ marginLeft: "auto" }}
              onClick={() => { setMmmAnalyzedSig(colMapSig); window.scrollTo({ top: 0, behavior: "smooth" }); }}>▶ 분석하기</button>
          </div>
        )}
      </section>
    );
  };

  const effectiveTarget = mmm && !mmm.empty ? mmm.target : target;
  const targetSelector = () =>
    availTargets.length > 1 ? (
      <div className="ab-pillgroup" style={{ marginBottom: "12px" }}>
        <span className="ab-pillgroup-label">타깃</span>
        {availTargets.map((t) => (
          <button key={t} className={`ab-pill ${effectiveTarget === t ? "active" : ""}`} onClick={() => setTarget(t)}>
            {t === "Regs" ? "가입(Reg)" : t === "React" ? "재활성(React)" : "Reg+React"}
          </button>
        ))}
      </div>
    ) : null;

  const derivedChip = () =>
    mmm && !mmm.empty ? (
      <div className="callout ok" style={{ marginBottom: "12px" }}>
        <div className="ico">✓</div>
        <div className="body" style={{ fontSize: "12px" }}>
          <strong>자동 매핑</strong> — 타깃={mmm.target}
          {mmm.derived.targetMetricLabel ? `(${mmm.derived.targetMetricLabel})` : ""} · 채널=[
          {mmm.derived.channels.join(", ")}] · 시간={mmm.derived.time} · {mmm.derived.n}기간
          {mmm.derived.orientation === "long-pivot" ? " · LONG→WIDE 피벗" : ""}
          {mmm.validate?.warnings?.length ? (
            <span style={{ color: "#e0af68" }}> · ⚠ {mmm.validate.warnings.length}건 경고</span>
          ) : null}
        </div>
      </div>
    ) : null;

  // ── LAB stage ──
  if (stage === "lab") {
    const fits = REG_LAB_STATE.fits;
    const tags = fits ? Object.keys(fits) : [];
    return (
      <div className="tab-pane active" id="tab-response">
        {renderTabs()}
        <section className="block" id="s-prep">
          <h2 className="section-title">📈 회귀 · 미래 예측</h2>
          <p style={{ fontSize: "12px", color: MUTED, marginBottom: "12px" }}>
            {mmmBridgeReady
              ? "위 진단·MMM 탭에 올린 CSV를 그대로 회귀에 사용합니다 — 채널→비용(adstock), 더미→이벤트, 주차→시간, 활성 타깃→종속으로 자동 번역. 종속/독립 역할은 아래에서 수정 가능."
              : "임의 CSV로 OLS 회귀 + 미래 예측(REG_FORECAST). 종속/독립(비용·이벤트·시간) 역할을 매핑해 계수·R²·실제vs예측·미래투영을 확인합니다."}
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
            {mmmBridgeReady && (
              <button className="ab-pill active" style={{ borderColor: "rgba(122,162,247,0.5)" }} onClick={runLabFromMmm}>📊 MMM 데이터 불러오기</button>
            )}
            <button className={`ab-pill ${mmmBridgeReady ? "" : "active"}`} onClick={runLabSample}>▶ 샘플 데이터로 실행 (60주 데모)</button>
          </div>
          {labError && (
            <div className="callout warning"><div className="ico">!</div><div className="body">{labError}</div></div>
          )}
        </section>

        {fits && tags.length > 0 && (
          <>
            <section className="block" id="s-map">
              <h2 className="section-title">역할 매핑</h2>
              <div className="table-wrap">
                <table className="data" style={{ fontSize: "11.5px" }}>
                  <thead>
                    <tr><th>컬럼</th><th>역할</th><th>변환</th><th>태그(OS)</th></tr>
                  </thead>
                  <tbody>
                    {REG_LAB_STATE.headers.map((c) => {
                      const def = REG_LAB_STATE.map[c] || {};
                      return (
                        <tr key={c}>
                          <td><strong>{c}</strong></td>
                          <td>
                            <select
                              value={def.role || "ignore"}
                              onChange={(e) => {
                                REG_LAB_STATE.map[c] = { ...def, role: e.target.value };
                                try {
                                  regLabRun();
                                  setLabError("");
                                } catch (err) {
                                  setLabError(err.message);
                                }
                                setLabVersion((v) => v + 1);
                              }}
                            >
                              {_REG_ROLES.map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                          </td>
                          <td>{def.tf || "none"}</td>
                          <td>{def.tag || "both"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="block" id="s-fit">
              <h2 className="section-title">적합 결과 (모델별)</h2>
              {tags.map((tag) => {
                const f = fits[tag];
                return (
                  <div key={tag} style={{ marginBottom: "16px" }}>
                    <h3 style={{ fontSize: "13px", margin: "8px 0" }}>
                      모델: <strong>{f.m.dep}</strong> {tag !== "both" ? `(${tag})` : ""} · R²={f.fit.R2.toFixed(4)} · λ={f.lam}
                    </h3>
                    <div className="table-wrap">
                      <table className="data" style={{ fontSize: "11.5px" }}>
                        <thead>
                          <tr><th>항목</th><th>β</th><th>SE</th><th>t</th><th>p</th><th>VIF</th></tr>
                        </thead>
                        <tbody>
                          {f.terms.map((term, i) => (
                            <tr key={term}>
                              <td>{term}</td>
                              <td className="tnum">{f.fit.beta[i]?.toFixed(4)}</td>
                              <td className="tnum">{f.fit.se?.[i]?.toFixed(4) ?? "—"}</td>
                              <td className="tnum">{f.fit.tvalues?.[i]?.toFixed(2) ?? "—"}</td>
                              <td className="tnum">{f.fit.pval?.[i]?.toFixed(4) ?? "—"}</td>
                              <td className="tnum">{i === 0 ? "—" : (f.vif[i - 1] === Infinity ? "∞" : f.vif[i - 1]?.toFixed(2))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </section>

            <section className="block" id="s-chart">
              <h2 className="section-title">실제 vs 예측</h2>
              <div className="chart-container" style={{ height: "280px" }}>
                <canvas ref={labChartRef}></canvas>
              </div>
            </section>

            <section className="block" id="s-forecast-lab">
              <h2 className="section-title">§7 미래 예측 (REG_FORECAST)</h2>
              {labForecast && labForecast.ok ? (
                <>
                  <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "12px" }}>
                    <div className="stat-card"><div className="lbl">예측 평균</div><div className="val">{fmtInt(labForecast.predFut.reduce((a, b) => a + b, 0) / labForecast.predFut.length)}</div></div>
                    <div className="stat-card"><div className="lbl">과거 평균</div><div className="val">{fmtInt(labForecast.actual.reduce((a, b) => a + b, 0) / labForecast.actual.length)}</div></div>
                    <div className="stat-card"><div className="lbl">R²</div><div className="val">{labForecast.r2?.toFixed(3)}</div></div>
                  </div>
                  <div className="table-wrap">
                    <table className="data" style={{ fontSize: "11.5px" }}>
                      <thead><tr><th>기간</th><th>예측</th><th>하한</th><th>상한</th></tr></thead>
                      <tbody>
                        {labForecast.futLabels.map((lb, i) => (
                          <tr key={lb + i}>
                            <td>{lb}</td>
                            <td className="tnum">{fmtInt(labForecast.predFut[i])}</td>
                            <td className="tnum">{fmtInt(labForecast.lo[i])}</td>
                            <td className="tnum">{fmtInt(labForecast.hi[i])}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="callout warn"><div className="ico">!</div><div className="body">{labForecast?.reason || "예측 준비 중 — 종속·독립 변수를 매핑하세요."}</div></div>
              )}
            </section>
          </>
        )}
      </div>
    );
  }

  // ── no-data ──
  if (!hasData) {
    return (
      <div className="tab-pane active" id="tab-response">
        {renderTabs()}
        <section className="block" id="s-prep">
          <h2 className="section-title">데이터 준비</h2>
          <p className="muted" style={{ fontSize: "12px", marginBottom: "12px" }}>주간 패널 CSV 하나로 카니발 진단 → 기여 분해(MMM) → 회귀·미래예측을 모두 분석합니다. 업로드 후 컬럼을 역할로 드래그하세요. 데이터는 브라우저 메모리에만 — 서버 전송 없음.</p>
          {mmmDropzone}
        </section>
      </div>
    );
  }

  // ── data present ── colMap 미완성 or 분석 전이면 매퍼+게이트만 노출(PRIMARY 매핑).
  if (!mmmAnalyzed) {
    return (
      <div className="tab-pane active" id="tab-response">
        {renderTabs()}
        {mmmMapperSection()}
      </div>
    );
  }

  // ── analyzed: 매핑 완료 후에도 패널이 비면(엔진 오류·공선) 사유 표시 ──
  const panelEmpty = mmm && mmm.empty;

  return (
    <div className="tab-pane active" id="tab-response">
      {renderTabs()}

      {panelEmpty ? (
        <section className="block">
          <div className="callout warn"><div className="ico">!</div><div className="body"><strong>MMM 패널을 만들 수 없습니다</strong><p>{mmm.reason}</p></div></div>
          <div style={{ marginTop: "12px" }}>{mmmMapperSection()}</div>
        </section>
      ) : (
        <>
          {targetSelector()}
          {derivedChip()}

          {/* ── STAGE ① DIAGNOSE (MMM panel) ── */}
          {stage === "diagnose" && (
            <>
              {/* ── §0 전역 카니발 결론 요약 (worst-case 종합) ── */}
              {cannib && cannib.globalCannib && (() => {
                const g = cannib.globalCannib;
                const conf = mmmCannibConf(g);
                const vc = g.verdict_class;
                const cls = vc === "cannibal" ? "warning" : vc === "ok" ? "ok" : "warn";
                const ico = vc === "ok" ? "✓" : "!";
                const tgtKo = mmm.target === "Regs" ? "가입" : mmm.target === "React" ? "재활성" : mmm.target;
                return (
                  <section className="block" id="s-cannib-summary">
                    <h2 className="section-title">② 카니발(잠식) 여부 — 한눈에 보기</h2>
                    <div className={`callout ${cls}`}>
                      <div className="ico">{ico}</div>
                      <div className="body">
                        <div style={{ fontSize: "13px", lineHeight: 1.65 }}>{mmmGlobalCannibPlain(g, tgtKo)}</div>
                        <div style={{ fontSize: "11px", color: MUTED, marginTop: "6px" }}>
                          통계적 신뢰도 <span style={{ letterSpacing: "1px" }}>{"●".repeat(conf) + "○".repeat(5 - conf)}</span>{" "}
                          — {g.noIdentified ? "식별 채널 0개" : `식별 채널 ${g.n_identified}개 worst-case`}. {`관측은 "잠식 없음"을 증명하지 못하므로 OK라도 신뢰도 상한은 ●●●○○, 식별 채널이 없으면 ●○○○○.`}
                        </div>
                      </div>
                    </div>
                    <div style={{ background: "rgba(122,162,247,0.08)", borderRadius: "8px", padding: "10px 12px", fontSize: "11.5px", color: "var(--text-1)", marginTop: "8px" }}>
                      💡 <strong>쉽게 말하면</strong> — {`"잠식"은 유료 광고가 원래 공짜로 들어올 오가닉 `}{tgtKo}을(를) 빼앗는 것입니다. 아래 §4.5 랭킹에서 <strong>CEI(카니발 근거지수)</strong>가 높은 채널부터 holdout 실험(5-15) 우선순위로 검토하세요. 관측 검정은 용의자를 좁힐 뿐, 확정은 실험입니다.
                    </div>
                  </section>
                );
              })()}

              {/* ── §4.5 카니발 의심 랭킹 (CEI · 적격 · 5단계 버킷) ── */}
              {cannib && cannib.cannibRank && cannib.cannibRank.length ? (() => {
                const rk = cannib.cannibRank;
                const levOf = {};
                rk.forEach((r) => { levOf[r.key] = mmmCannibLevel(r); });
                const maxCei = Math.max(0.0001, ...rk.filter((r) => r.eligible).map((r) => r.cei));
                // 5단계 버킷 카운트(빠른 스캔)
                const bucketCounts = [0, 0, 0, 0, 0];
                rk.forEach((r) => { bucketCounts[levOf[r.key].lv - 1]++; });
                const bucketMeta = [
                  { lv: 1, label: "데이터 없음", color: "#9CA3AF", sym: "⊘" },
                  { lv: 2, label: "신호 없음", color: "#22c55e", sym: "●" },
                  { lv: 3, label: "거의 없음", color: "#2dd4bf", sym: "◐" },
                  { lv: 4, label: "신호 조금", color: "#fbbf24", sym: "◑" },
                  { lv: 5, label: "카니발", color: "#f87171", sym: "●" },
                ];
                return (
                  <section className="block" id="s-cannib">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                      <h2 className="section-title" style={{ margin: 0 }}>§4.5 카니발 의심 랭킹 — CEI 높을수록 우선 검토</h2>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          className="ab-pill"
                          title="모든 채널 × 3-state 투표(FOR/AGAINST/ABSTAIN) + 게이트·탄력성·커버리지·그랜저 1행씩 → CSV"
                          onClick={() =>
                            cannib &&
                            csvDownload(
                              `mmm_cannib_${mmm.target}_${_today()}.csv`,
                              buildCannibCsv(cannib, mmm.effects, mmm.target),
                            )
                          }
                        >
                          ⬇ 채널별 카니발 CSV
                        </button>
                        <button
                          className="ab-pill"
                          title="§4 검정 원자료 — 주별 타깃·채널별 ln(1+지출)·탈추세 잔차·1차차분. 엑셀 CORREL로 화면 상관 재현"
                          onClick={() =>
                            csvDownload(
                              `mmm_cannib_series_${mmm.target}_${_today()}.csv`,
                              buildCannibSeriesCsv(mmm.panel, mmm.target),
                            )
                          }
                        >
                          ⬇ 검정 원자료 CSV
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px", marginBottom: "10px" }}>
                      {bucketMeta.map((b) => (
                        <div key={b.lv} className="stat-card" style={{ minWidth: "80px" }}>
                          <div className="lbl" style={{ color: b.color }}>{b.sym} {b.label}</div>
                          <div className="val">{bucketCounts[b.lv - 1]}</div>
                        </div>
                      ))}
                    </div>
                    <div className="ab-pillgroup" style={{ marginBottom: "10px" }}>
                      <span className="ab-pillgroup-label">채널(상세로 이동)</span>
                      {cannib.rows.map((r) => (
                        <button key={r.channel.key} className={`ab-pill ${r.channel.key === activeCannibCh ? "active" : ""}`} onClick={() => setCannibChannel(r.channel.key)}>
                          {r.channel.label}
                        </button>
                      ))}
                    </div>
                    <div className="table-wrap">
                      <table className="data" style={{ fontSize: "11px" }}>
                        <thead>
                          <tr>
                            <th>순위</th><th>채널</th><th>판정</th><th title="근거강도 배지(강/중/약/판단불가)">근거강도</th>
                            <th title="카니발 근거지수 — 유의하게 음(잠식)일 때만 가산">CEI</th>
                            <th title="탈추세 잔차 Pearson r · 양측 p">탈추세 r·p</th>
                            <th title="순증분 탄력성 [95% CI]">net [CI]</th><th>검정력/적격</th><th>권고</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rk.map((r) => {
                            const L = levOf[r.key];
                            const w = Math.round(Math.min(1, r.cei / maxCei) * 100);
                            return (
                              <tr
                                key={r.key}
                                onClick={() => setCannibChannel(r.key)}
                                style={{ cursor: "pointer", background: r.key === activeCannibCh ? "rgba(122,162,247,0.08)" : undefined }}
                              >
                                <td className="tnum">{r.rank}</td>
                                <td><strong>{r.label}</strong>{r.brand ? " 🏷" : ""}{r.flighted ? " ⚡" : ""}</td>
                                <td style={{ color: L.color, fontWeight: 600 }}>{L.sym} {L.short}</td>
                                <td>{r.badge}</td>
                                <td>
                                  {r.eligible ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      <div style={{ width: "42px", height: "6px", background: "var(--bg-2)", borderRadius: "3px", overflow: "hidden" }}>
                                        <div style={{ width: `${w}%`, height: "100%", background: r.cei > 0 ? "#f87171" : "var(--text-muted)" }}></div>
                                      </div>
                                      <span className="tnum" style={{ fontSize: "10px" }}>{r.cei.toFixed(2)}</span>
                                    </div>
                                  ) : (
                                    <span style={{ color: MUTED, fontSize: "10px" }}>—</span>
                                  )}
                                </td>
                                <td className="tnum">{isFinite(r.rDet) ? r.rDet.toFixed(2) : "—"} · {r.detP}</td>
                                <td className="tnum">{isFinite(r.netElast) ? r.netElast : "—"}{r.netCiLo != null ? ` [${r.netCiLo}, ${r.netCiHi}]` : ""}</td>
                                <td>{r.eligible ? (r.gated ? "🔒 공선" : "적격") : `부족(${r.nActive}/${r.total}주)`}</td>
                                <td title={mmmCannibAction(r)} style={{ maxWidth: "150px" }}>{mmmCannibActionShort(r)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: "10.5px", color: MUTED, marginTop: "8px", lineHeight: 1.6 }}>
                      행 클릭 → 아래 §4 채널 상세로 이동. <strong>CEI</strong>(카니발 근거지수) = 탈추세·차분·net이 <strong>유의하게 음(잠식)</strong>일 때만 가산 → 높을수록 의심 큼. 판정 5단계: ⊘데이터없음 · ●신호없음 · ◐거의없음 · ◑신호조금 · ●카니발.
                      {rk.mde12 != null ? ` · 12주 holdout coarse MDE ≈ ${rk.mde12}%.` : ""}
                    </p>
                  </section>
                );
              })() : (
                <section className="block" id="s-cannib">
                  <h2 className="section-title">§4.5 카니발 의심 랭킹</h2>
                  <p className="muted" style={{ fontSize: "12px" }}>카니발 랭킹을 계산할 수 없습니다.</p>
                </section>
              )}

              {/* ── §4 채널 상세 — 왜 이 판정인지 (①~⑤ 삼각검증) ── */}
              {activeCn && (() => {
                const cn = activeCn;
                const p = cn.precedence, d = cn.detrend_corr, ni = cn.net_incrementality;
                const vcol = cn.verdict_class === "ok" ? "#22c55e" : cn.verdict_class === "cannibal" ? "#f87171" : "#fbbf24";
                const chLabel = (cannib.rows.find((r) => r.channel.key === activeCannibCh) || {}).channel?.label || activeCannibCh;
                const voteBadge = (v) =>
                  v === "FOR" ? <span style={{ color: "#22c55e", fontWeight: 700 }}>FOR (오가닉)</span>
                    : v === "AGAINST" ? <span style={{ color: "#f87171", fontWeight: 700 }}>AGAINST (카니발)</span>
                      : <span style={{ color: MUTED, fontWeight: 700 }}>ABSTAIN (판단보류)</span>;
                const gate = cn.power_gate || { blocked: false, reasons: [] };
                const g = cn.granger;
                return (
                  <section className="block" id="s-cannib-detail">
                    <h2 className="section-title">§4 채널 상세 — 왜 이 판정인지 ({chLabel})</h2>
                    <div className="callout" style={{ borderLeft: `3px solid ${vcol}` }}>
                      <div className="body">
                        <strong>판정:</strong> {cn.verdict}
                        <br />
                        <span style={{ fontSize: "12px", color: MUTED }}>투표 <strong>{cn.vote_summary}</strong> · {cn.is_brand_intercept ? "브랜드 가로채기형" : "프로스펙팅"} 채널 → 잠정 OK 기준 <strong>FOR ≥ {cn.for_bar} AND AGAINST = 0</strong></span>
                      </div>
                    </div>
                    {gate.blocked && (
                      <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: "8px", padding: "9px 12px", fontSize: "11.5px", color: "var(--text-1)", margin: "8px 0" }}>
                        🚧 <strong>검정력 게이트 작동</strong> — {(gate.reasons || []).join(" · ")}. {`이 상태에서 "순효과≈0"은 `}<strong>효과 없음이 아니라 증거 없음</strong>이라, ③은 자동 ABSTAIN이고 판정은 <strong>{`"방어/OK"가 될 수 없습니다`}</strong>(상한 INCONCLUSIVE).
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", margin: "10px 0" }}>
                      <div className="stat-card" style={{ minWidth: "180px" }}>
                        <div className="lbl">① 시간 선행성 (저지출 ≤p25, n={p.low_n})</div>
                        <div className="val" style={{ fontSize: "13px" }}>{voteBadge(p.vote)}</div>
                        <div style={{ fontSize: "10.5px", color: MUTED }}>slope {p.kpi_slope_per_wk}/주 (p={p.slope_p}) · 누적 {p.kpi_change_over_window_pct}%</div>
                      </div>
                      <div className="stat-card" style={{ minWidth: "180px" }}>
                        <div className="lbl">② 허위상관 (탈추세·차분)</div>
                        <div className="val" style={{ fontSize: "13px" }}>{voteBadge(d.vote)}</div>
                        <div style={{ fontSize: "10.5px", color: MUTED }}>raw {d.raw} → detrend {d.detrended} · 1차차분 {d.first_diff}</div>
                      </div>
                      <div className="stat-card" style={{ minWidth: "180px" }}>
                        <div className="lbl">③ 순증분 (net 탄력성)</div>
                        <div className="val" style={{ fontSize: "13px" }}>{voteBadge(ni.vote)}</div>
                        <div style={{ fontSize: "10.5px", color: MUTED }}>{isFinite(ni.net_elasticity) ? ni.net_elasticity : "—"} · p={isFinite(ni.p) ? ni.p : "—"}{ni.ci_lo != null ? ` · CI[${ni.ci_lo}, ${ni.ci_hi}]` : ""}{gate.blocked ? " · 게이트 ABSTAIN" : ""}</div>
                      </div>
                    </div>
                    {/* ④ 그랜저 인과 — 시차·방향 */}
                    {g ? (
                      <div style={{ background: "rgba(122,162,247,0.06)", border: "1px solid rgba(122,162,247,0.2)", borderRadius: "8px", padding: "9px 12px", margin: "8px 0" }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#adc6ff" }}>④ 그랜저 인과 — 시차·방향 (동시점 ①~③ 보완)</div>
                        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "6px" }}>
                          <div className="stat-card" style={{ minWidth: "180px" }}>
                            <div className="lbl">광고비 → 오가닉 (시차 잠식?)</div>
                            <div className="val" style={{ fontSize: "13px", color: cn.granger_cannibal ? "#f87171" : cn.granger_help ? "#22c55e" : "var(--text-muted)", fontWeight: 700 }}>
                              {cn.granger_cannibal ? "시차 잠식 신호" : cn.granger_help ? "시차 증분 신호" : "신호 없음"}
                            </div>
                            <div style={{ fontSize: "10.5px", color: MUTED }}>lag {g.spend_to_organic.lag} · F={g.spend_to_organic.F} · p={g.spend_to_organic.p} · Δ계수합 {g.spend_to_organic.coefSum}</div>
                          </div>
                          <div className="stat-card" style={{ minWidth: "180px" }}>
                            <div className="lbl">오가닉 → 광고비 (페이싱?)</div>
                            <div className="val" style={{ fontSize: "13px", color: cn.pacing ? "#fbbf24" : "var(--text-muted)", fontWeight: 700 }}>{cn.pacing ? "페이싱 감지" : "없음"}</div>
                            <div style={{ fontSize: "10.5px", color: MUTED }}>lag {g.organic_to_spend.lag} · F={g.organic_to_spend.F} · p={g.organic_to_spend.p}</div>
                          </div>
                        </div>
                        <p style={{ fontSize: "10.5px", color: "var(--text-1)", margin: "4px 0 0" }}>
                          {cn.granger_cannibal ? "🔴 광고비 과거값이 오가닉 미래 하락을 추가 설명 → 시차 잠식 의심(판정을 LEAN CANNIBAL로 올림)." : cn.granger_help ? "🟢 광고비 과거값이 오가닉 미래 상승을 추가 설명 → 시차 증분 신호." : "광고비→오가닉 시차 인과 신호 없음."}
                          {cn.pacing ? " ↩ 페이싱(역인과): 오가닉 약할 때 예산↑ → 음상관은 내생이니 잠식 단정 금지." : ""}
                          <span style={{ color: MUTED }}> 그랜저=예측 선행성이지 인과 확정 아님. 확정은 holdout.</span>
                        </p>
                      </div>
                    ) : (
                      <p className="muted" style={{ fontSize: "10.5px", marginTop: "6px" }}>④ 그랜저 인과: 데이터 부족(차분 후 표본&lt;24)으로 시차 검정 생략.</p>
                    )}
                    {/* 역인과 점검 박스 */}
                    {cn.reverse_causality_risk && (
                      <div style={{ background: "rgba(122,162,247,0.08)", borderRadius: "8px", padding: "8px 11px", fontSize: "11px", color: "var(--text-1)", margin: "6px 0" }}>
                        ↩ <strong>역인과 점검:</strong> 지출이 시간따라 늘고(↑) 오가닉과 음의 상관 — 오가닉이 약할 때 방어적으로 예산을 올린 <strong>페이싱</strong>이면 ②의 음상관은 광고→오가닉이 아니라 <strong>오가닉→광고(예산 반응)</strong>일 수 있습니다(내생). 이 경우 holdout이 더 필수.
                      </div>
                    )}
                    {/* ⑤ 임펄스 응답(IRF) */}
                    <div style={{ marginTop: "10px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#adc6ff" }}>
                        ⑤ 임펄스 응답(IRF) — 지출 1SD 충격이 {mmm.target === "Regs" ? "가입" : "재활성"}에 몇 주에 걸쳐 얼마나
                      </div>
                      <div className="chart-container" style={{ height: "200px", marginTop: "4px" }}>
                        <canvas ref={irfRef}></canvas>
                      </div>
                      <p style={{ fontSize: "10.5px", color: MUTED, marginTop: "4px" }}>
                        음(−)으로 내려가면 시차 잠식, 양(+)이면 시차 증분. prewhiten 레벨 VAR·관측 — 확정은 holdout. (n&lt;24면 곡선 생략)
                      </p>
                    </div>
                  </section>
                );
              })()}

              <section className="block" id="s-trend">
                <h2 className="section-title">추세 존재성 — {mmm.target}</h2>
                {trend ? (
                  <>
                    <div className={`callout ${trend.verdict.startsWith("trend EXISTS") ? "warn" : "ok"}`}>
                      <div className="ico">{trend.verdict.startsWith("NO") ? "✓" : "!"}</div>
                      <div className="body"><strong>{trend.verdict}</strong><p style={{ fontSize: "11.5px", marginTop: "4px" }}>STL 추세 변화 {trend.stl_pct}%</p></div>
                    </div>
                    <div className="chart-container" style={{ height: "240px", marginTop: "12px" }}>
                      <canvas ref={trendRef}></canvas>
                    </div>
                    <div className="table-wrap" style={{ marginTop: "12px" }}>
                      <table className="data" style={{ fontSize: "11.5px" }}>
                        <thead><tr><th>검정</th><th>결과</th><th>p</th></tr></thead>
                        <tbody>
                          <tr><td>Mann-Kendall (raw)</td><td>{trend.mk_raw[0]}</td><td className="tnum">{trend.mk_raw[1]}</td></tr>
                          <tr><td>MK (자기상관 보정)</td><td>{trend.mk_ac_robust[0]}</td><td className="tnum">{trend.mk_ac_robust[1]}</td></tr>
                          <tr><td>MK (계절 제거)</td><td>{trend.mk_deseason[0]}</td><td className="tnum">{trend.mk_deseason[1]}</td></tr>
                          <tr><td>ADF (추세정상성)</td><td>—</td><td className="tnum">{trend.adf_ct_p}</td></tr>
                          <tr><td>KPSS</td><td>—</td><td className="tnum">{trend.kpss_ct_p}</td></tr>
                          <tr><td>media 제거 후 잔차 MK</td><td>{trend.resid_after_media_mk[0]}</td><td className="tnum">{trend.resid_after_media_mk[1]}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: "12px" }}>추세 검정을 계산할 수 없습니다.</p>
                )}
              </section>

              {/* ── §1 데이터 위생 + 매크로 사실 (모델 독립) ── */}
              <section className="block" id="s-macro">
                <h2 className="section-title">§1 데이터 위생 + 매크로 사실 (모델 독립)</h2>
                <p className="muted" style={{ fontSize: "12px" }}>
                  스키마/연속성/결측을 모델링 전 검증. 매크로 = spend YoY vs KPI YoY (가장 강한 model-free 헤드라인).
                </p>
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", margin: "8px 0" }}>
                  <div className="stat-card"><div className="lbl">주 수(n)</div><div className="val">{mmm.derived.n}</div></div>
                  <div className="stat-card"><div className="lbl">위생 경고</div><div className="val" style={{ color: mmm.validate?.warnings?.length ? "#f87171" : "#22c55e" }}>{mmm.validate?.warnings?.length || "OK"}</div></div>
                </div>
                {diag && Object.keys(diag.macro).length ? (
                  <div className="table-wrap" style={{ maxWidth: "420px", marginTop: "8px" }}>
                    <table className="data" style={{ fontSize: "11.5px" }}>
                      <thead><tr><th>매크로 사실</th><th>값</th></tr></thead>
                      <tbody>
                        {Object.entries(diag.macro).map(([k, v]) => (
                          <tr key={k}><td>{k}</td><td className="tnum" style={{ color: v < 0 ? POS : NEG }}>{v > 0 ? "+" : ""}{v}%</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: "11px", marginTop: "6px" }}>
                    ⓘ 매크로 YoY(2024 vs 2025)는 날짜가 매핑된 데이터에서만 계산됩니다{diag && !diag.validDates ? " — 현재 데이터엔 유효 날짜 라벨이 없습니다." : " — 2024·2025 두 해가 모두 있어야 표시됩니다."}
                  </p>
                )}
                {mmm.validate?.warnings?.length ? (
                  <details style={{ marginTop: "8px" }}>
                    <summary style={{ cursor: "pointer", fontSize: "11px", color: "#fbbf24" }}>⚠ 데이터 위생 경고 {mmm.validate.warnings.length}건 (펼치기)</summary>
                    <ul style={{ fontSize: "11px", color: "#e0af68", marginTop: "4px" }}>
                      {mmm.validate.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                    </ul>
                  </details>
                ) : null}
                {diag && diag.absorb && diag.absorb.notices.length > 0 && (
                  <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: "8px", padding: "9px 12px", fontSize: "11.5px", color: "var(--text-1)", marginTop: "10px" }}>
                    🔗 <strong>자동 흡수(공선)</strong> — 채널 지출과 거의 동일하게 움직이는(|r|≥0.9) 구조변화 항목을 모델에서 제거해 계수 폭주를 막았습니다:
                    <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                      {diag.absorb.notices.map((nt) => (
                        <li key={nt.key}>{nt.channelLabel} ~ {nt.step} (r={nt.corr}) → <strong>{nt.dropped}</strong> 흡수(유지: {nt.kept})</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {/* ── §2 "단순 모델" audit — 흔한 함정 점검 (naive lumped 모델) ── */}
              {diag && diag.audit && (() => {
                const a = diag.audit;
                const f = (v, d = 2) => (v == null || !isFinite(v) ? "—" : (+v).toFixed(d));
                return (
                  <section className="block" id="s-audit">
                    <h2 className="section-title">§2 &quot;단순 모델&quot; audit — 흔한 함정 점검</h2>
                    <p className="muted" style={{ fontSize: "12px" }}>
                      모든 유료 지출을 <strong>하나로 뭉친 단순(naive) 모델</strong>(ln_총지출 = 전 채널 합산, 브랜드 제외 + 계절·더미·추세)을 재현해, 그 모델이 통계적으로 믿을 만한지 점검. target=RR · n={a.n} · R²={f(a.r2, 4)} adjR²={f(a.adj_r2, 4)} · HAC maxlags={a.hac_maxlags}.
                    </p>
                    <div className="table-wrap" style={{ marginTop: "6px" }}>
                      <table className="data" style={{ fontSize: "11px" }}>
                        <thead><tr><th>변수</th><th>coef</th><th title="일반 최소제곱 p — 자기상관 미보정(과신 가능)">OLS p</th><th title="자기상관 보정(HAC) p — 보수적">HAC p</th></tr></thead>
                        <tbody>
                          {a.coefficients.map((r) => (
                            <tr key={r.var}>
                              <td>{r.var}</td>
                              <td className="tnum">{f(r.coef)}</td>
                              <td className="tnum" style={{ color: MUTED }}>{f(r.ols_p, 4)}</td>
                              <td className="tnum">{f(r.hac_p, 4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: "12px", margin: "12px 0 2px", color: "var(--text-1)" }}>
                      ① 브랜드 추가 시 R²가 내려가는가? <span style={{ color: MUTED, fontSize: "11px" }}>(회귀변수 추가는 R²를 못 낮춤 → &quot;브랜드 빼자&quot; 논리 반박)</span>
                    </p>
                    <div className="table-wrap">
                      <table className="data" style={{ fontSize: "11px" }}>
                        <thead><tr><th>target</th><th>R²(브랜드 X)</th><th>R²(브랜드 O)</th><th>brand p</th></tr></thead>
                        <tbody>
                          {a.brand_test.map((r) => (
                            <tr key={r.target}>
                              <td>{r.target}</td>
                              <td className="tnum">{f(r.R2_no_brand, 4)}</td>
                              <td className="tnum" style={{ color: NEG }}>{f(r.R2_with_brand, 4)}</td>
                              <td className="tnum">{f(r.brand_p, 4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: "12px", margin: "12px 0 2px", color: "var(--text-1)" }}>
                      ② 같은 스펙인데 target만 바꿔도 &quot;총지출 계수&quot;가 출렁인다 = 공선 신호
                    </p>
                    <div className="table-wrap">
                      <table className="data" style={{ fontSize: "11px" }}>
                        <thead><tr><th>target</th><th>총지출 coef</th><th>HAC p</th><th>trend coef</th></tr></thead>
                        <tbody>
                          {a.channel_swing.map((r) => (
                            <tr key={r.target}>
                              <td>{r.target}</td>
                              <td className="tnum">{f(r.ln_G_coef)}</td>
                              <td className="tnum">{f(r.hac_p, 4)}</td>
                              <td className="tnum" style={{ color: POS }}>{f(r.trend_coef)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted" style={{ fontSize: "11px", marginTop: "6px" }}>
                      RR mean={a.composite.mean_RR} = 구성요소 합 {a.composite.components_mean_sum} (RR 정의 확인). ⚠ spend↔trend 공선 + 상쇄 계수 → 단순 모델 계수는 식별 불안정 → §5(채널분리·adstock·HAC)에서 제대로.
                    </p>
                  </section>
                );
              })()}
            </>
          )}

          {/* ── STAGE ② MMM ── */}
          {stage === "mmm" && (
            <>
              <section className="block" id="s-effects">
                <h2 className="section-title">채널별 효과 — {mmm.target}</h2>
                <div className="table-wrap">
                  <table className="data" style={{ fontSize: "11.5px" }}>
                    <thead>
                      <tr>
                        <th>채널</th>
                        <th title="지출 +10% 시 결과 탄력성">지출 +10%</th>
                        <th title="현 지출점에서 +$1,000당 주간 결과 증분(명)">+$1,000당</th>
                        <th>판정</th>
                        <th title="p값 → 신뢰도">신뢰도</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mmm.effects.map((e) => {
                        const vm = VERDICT_META[e.verdict] || VERDICT_META.uncertain;
                        const dim = e.sparse;
                        const elasPct = (e.elas * 10).toFixed(1);
                        return (
                          <tr key={e.key} style={dim ? { opacity: 0.55 } : undefined}>
                            <td><strong>{e.label}</strong></td>
                            <td className="tnum" style={{ color: e.elas >= 0 ? NEG : POS }}>{e.elas >= 0 ? "+" : ""}{elasPct}%</td>
                            <td className="tnum">{e.weeklyPer1k == null ? "—" : Math.round(e.weeklyPer1k).toLocaleString() + "명"}</td>
                            <td style={{ color: vm.color, fontWeight: 600 }}>{vm.txt}</td>
                            <td style={{ letterSpacing: "1px" }}>{pDots(e.p)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {mmm.effects.some((e) => e.sparse) && (
                  <p style={{ fontSize: "11px", color: MUTED, marginTop: "6px" }}>
                    ⊘ 데이터 부족 채널(흐리게): {mmm.effects.filter((e) => e.sparse).map((e) => `${e.label}(${e.nonzero}/${e.total}주)`).join(", ")}
                  </p>
                )}
                {mmm.effects.logDropped > 0 && (
                  <p style={{ fontSize: "11px", color: MUTED }}>ⓘ 타깃≤0인 {mmm.effects.logDropped}주가 log-log 적합에서 제외됨.</p>
                )}
              </section>

              <section className="block" id="s-budget-guide">
                <h2 className="section-title">§5.3 예산 배분 가이드</h2>
                {(() => {
                  const sat = mmm.run.saturationByChannel || {};
                  const ranked = Object.values(sat)
                    .map((s) => ({ ...s, curMarg: (s.ln_coef / (1 + (s.recentMean || 0))) * 1000 }))
                    .filter((s) => s.ln_coef > 0 && s.curMarg > 0)
                    .sort((a, b) => b.curMarg - a.curMarg);
                  return ranked.length ? (
                    <ol style={{ fontSize: "12px", lineHeight: 1.9, paddingLeft: "20px" }}>
                      {ranked.map((s, i) => (
                        <li key={s.label}>
                          <strong>{s.label}</strong> — +$1k당 +{s.curMarg.toFixed(1)}명 · 현 지출 ${((s.recentMean || 0) / 1000).toFixed(1)}k/주
                          {i === 0 && <span className="chip ok" style={{ marginLeft: "6px", fontSize: "9.5px", padding: "1px 6px" }}>다음 예산 우선</span>}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted" style={{ fontSize: "12px" }}>양(+)의 한계효율 채널이 없어 우선순위를 정할 수 없습니다.</p>
                  );
                })()}
                <p style={{ fontSize: "11px", color: MUTED, marginTop: "6px" }}>
                  가설 수준 안내(관측 회귀 외삽). 실제 배분·시나리오는 5-3 예산 배분 시뮬레이터를 사용하세요.
                </p>
              </section>

              <section className="block" id="s-mmm">
                <h2 className="section-title">§5 MMM — {mmm.target} (adstock CV · 탄력성 · Shapley · 수확체감)</h2>
                <div className="alloc-card" style={{ marginBottom: "8px" }}>
                  <p style={{ fontSize: "12px", color: MUTED, margin: 0 }}>
                    adstock λ는 rolling-origin OOS CV로 선택(in-sample 아님) → <strong>best λ={mmm.run.best_lambda}</strong>
                    {mmm.run.collinear_pairs?.length ? ` · 공선쌍(|r|≥0.85): ${mmm.run.collinear_pairs.map((p) => `${p.a}~${p.b}(${p.corr})`).join(", ")}` : " · 공선쌍: 없음"}
                  </p>
                </div>
                {/* ① adstock λ CV — full width */}
                <div className="chart-container" style={{ height: "200px", marginBottom: "12px" }}><canvas ref={cvRef}></canvas></div>
                {/* ② 탄력성 | VIF — 2-col */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  <div>
                    <p style={{ fontSize: "12px", margin: "0 0 4px" }}>탄력성 (log-log, AR1) — %ΔY/%Δspend</p>
                    <div className="table-wrap">
                      <table className="data" style={{ fontSize: "11px" }}>
                        <thead><tr><th>변수</th><th>coef</th><th>95% CI</th><th>p</th><th>유의</th></tr></thead>
                        <tbody>
                          {mmm.run.elasticities.map((e) => {
                            const ciNonzero = e.ci_lo > 0 || e.ci_hi < 0;
                            return (
                              <tr key={e.var}>
                                <td>{e.var}</td>
                                <td className="tnum">{e.coef}</td>
                                <td className="tnum" style={{ fontSize: "11px" }}>[{e.ci_lo}, {e.ci_hi}]</td>
                                <td className="tnum">{e.p}</td>
                                <td>{ciNonzero ? <span className="chip ok" style={{ fontSize: "10px", padding: "1px 6px" }}><span className="dot"></span>CI≠0</span> : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: "12px", margin: "0 0 4px" }}>VIF (&gt;{mmm.cfg.vifThreshold} = 식별 실패)</p>
                    <div className="table-wrap">
                      <table className="data" style={{ fontSize: "11px" }}>
                        <thead><tr><th>변수</th><th>VIF</th></tr></thead>
                        <tbody>
                          {mmm.run.vif.filter((v) => !v.var.startsWith("sin") && !v.var.startsWith("cos")).map((v) => (
                            <tr key={v.var}>
                              <td>{v.var}</td>
                              <td className="tnum" style={{ color: v.vif > mmm.cfg.vifThreshold ? POS : undefined }}>{v.vif}{v.vif > mmm.cfg.vifThreshold ? " ⚠" : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                {/* ③ Shapley R² — full width */}
                <p style={{ fontSize: "12px", margin: "10px 0 4px" }}>Shapley R² 분해 (설명분산의 공정 배분) · total R²={mmm.run.shapley?.total ?? "—"}</p>
                <div className="chart-container" style={{ height: "200px", marginBottom: "8px" }}><canvas ref={shapleyRef}></canvas></div>
                {/* ④ 수확체감 — chart | per-channel table 2-col */}
                <p style={{ fontSize: "12px", margin: "10px 0 4px" }}>수확체감 — 채널별 한계 응답(+$1k당)</p>
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "10px", alignItems: "start" }}>
                  <div className="chart-container" style={{ height: "240px" }}><canvas ref={satRef}></canvas></div>
                  <div>
                    <div className="table-wrap">
                      <table className="data" style={{ fontSize: "11px" }}>
                        <thead><tr><th>채널</th><th>현 지출<br />+$1k당</th><th>$10k당</th><th>$35k당</th><th>$60k당</th></tr></thead>
                        <tbody>
                          {(() => {
                            const sbc = mmm.run.saturationByChannel || {};
                            const keys = Object.keys(sbc);
                            if (!keys.length) return <tr><td colSpan="5" style={{ color: MUTED }}>—</td></tr>;
                            const cell = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v}명`);
                            return keys.map((k) => {
                              const s = sbc[k], m = s.marginal_kpi_per_1k || {}, neg = s.ln_coef < 0;
                              const curMarg = s.recentMean > 0 ? +((s.ln_coef / (1 + s.recentMean)) * 1000).toFixed(1) : null;
                              return (
                                <tr key={k} style={neg ? { opacity: 0.55 } : undefined}>
                                  <td><strong>{s.label}</strong>{neg ? <span style={{ fontSize: "9px", color: "#fbbf24" }}> 음수=노이즈</span> : ""}</td>
                                  <td className="tnum" style={{ color: "#adc6ff" }}>{curMarg == null ? "—" : cell(curMarg)}{curMarg != null && <span style={{ fontSize: "9px", color: MUTED }}><br />@${(s.recentMean / 1000).toFixed(1)}k</span>}</td>
                                  <td className="tnum">{cell(m["$10k"])}</td>
                                  <td className="tnum">{cell(m["$35k"])}</td>
                                  <td className="tnum">{cell(m["$60k"])}</td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted" style={{ fontSize: "10.5px", marginTop: "4px" }}>
                      <strong>&quot;+$1k당 N명&quot;</strong> = 그 지출 수준에서 1,000달러 더 쓸 때 늘어나는 결과(지출↑일수록 작아짐=수확체감). <strong>음수 채널은 노이즈</strong>(공선·데이터 부실 — 예산 결정 금지). 절대 인원은 holdout(5-15), 효율(CPR)은 비용 대비 따로.
                    </p>
                  </div>
                </div>
              </section>

              <section className="block" id="s-decomp">
                <h2 className="section-title">§5.5 기여 분해 — 실제 vs 모델 · {mmm.target}</h2>
                <div className="ab-pillgroup" style={{ marginBottom: "10px" }}>
                  <span className="ab-pillgroup-label">모델</span>
                  <button className={`ab-pill ${decompModel === "ols" ? "active" : ""}`} onClick={() => setDecompModel("ols")}>OLS(중심화)</button>
                  <button className={`ab-pill ${decompModel === "ridge" ? "active" : ""}`} onClick={() => setDecompModel("ridge")}>Ridge(절대)</button>
                </div>
                {decomp ? (
                  <>
                    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "12px" }}>
                      <div className="stat-card"><div className="lbl">RMSE</div><div className="val">±{decomp.rmse}명</div></div>
                      <div className="stat-card"><div className="lbl">MAPE</div><div className="val">{decomp.mape}%</div></div>
                      <div className="stat-card"><div className="lbl">baseline</div><div className="val">{fmtInt(decomp.baseline)}</div></div>
                    </div>
                    <div className="chart-container" style={{ height: "240px", marginBottom: "12px" }}><canvas ref={fitRef}></canvas></div>
                    <div className="chart-container" style={{ height: "280px" }}><canvas ref={decompRef}></canvas></div>
                    <div className="table-wrap" style={{ marginTop: "12px" }}>
                      <table className="data" style={{ fontSize: "11.5px" }}>
                        <thead><tr><th>드라이버</th><th>{decomp.level ? "평균 기여" : "주별 변동(swing)"}</th><th>매체?</th></tr></thead>
                        <tbody>
                          {decomp.driverStats.map((d) => (
                            <tr key={d.name}>
                              <td>{d.name}</td>
                              <td className="tnum">{decomp.level ? `${d.avg >= 0 ? "+" : ""}${fmtInt(d.avg)}명` : `±${fmtInt(d.swing)}명/주`}</td>
                              <td>{d.media ? "✓" : MMM_NONMEDIA_GROUPS.includes(d.name) ? "baseline" : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* 튀는 구간 — 평소와 다르게 크게 벗어난 주(잔차 2σ↑) + 원인 메모(index renderMmmDecomp spikes 이식) */}
                    {decomp.spikes && decomp.spikes.length > 0 && (
                      <>
                        <h3 className="section-title" style={{ fontSize: "13.5px", marginTop: "16px" }}>🔎 튀는 구간 (평소와 다르게 크게 벗어난 주 · 잔차 2σ↑)</h3>
                        <div className="table-wrap">
                          <table className="data" style={{ fontSize: "11.5px" }}>
                            <thead><tr><th>주</th><th>baseline 대비</th><th>자동 진단</th><th>메모 (원인 기록)</th></tr></thead>
                            <tbody>
                              {decomp.spikes.map((s) => {
                                const lbl = mmm.panel.weekLabel && s.i != null ? mmm.panel.weekLabel[s.i] : null;
                                const noteKey = `${mmm.target}|${s.week}`;
                                const clsLabel = s.cls === "channel"
                                  ? { txt: "채널 스파크", color: "#7aa2f7" }
                                  : s.cls === "baseline"
                                    ? { txt: "baseline·계절 변동", color: "#22c55e" }
                                    : { txt: "모델 밖(원인 입력 권장)", color: "#fbbf24" };
                                const driverTxt = s.cls === "unexplained"
                                  ? `잔차 ${s.residual >= 0 ? "+" : ""}${s.residual.toLocaleString()}명`
                                  : `${s.domDriver} ${s.domVal >= 0 ? "+" : ""}${s.domVal.toLocaleString()}명`;
                                return (
                                  <tr key={s.week}>
                                    <td className="tnum">t{s.i != null ? s.i + 1 : s.week}{lbl != null && <span style={{ fontSize: "9px", color: MUTED }}><br />{String(lbl)}</span>}</td>
                                    <td className="tnum" style={{ color: s.dev >= 0 ? POS : NEG }}>{s.dev >= 0 ? "+" : ""}{s.dev.toLocaleString()}명</td>
                                    <td>
                                      <span style={{ color: clsLabel.color, fontWeight: 600 }}>{clsLabel.txt}</span>
                                      <span style={{ fontSize: "10px", color: MUTED }}><br />주 원인: {driverTxt}</span>
                                    </td>
                                    <td>
                                      <input
                                        value={spikeNotes[noteKey] || ""}
                                        onChange={(e) => setSpikeNotes((n) => ({ ...n, [noteKey]: e.target.value }))}
                                        placeholder="이 주에 무슨 일? (예: 앱스토어 피처드, 경쟁사 이슈)"
                                        style={{ width: "100%", background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--border)", borderRadius: "4px", padding: "4px 7px", fontSize: "11px" }}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: "12px" }}>분해를 계산할 수 없습니다(ridge 특이·데이터 부족).</p>
                )}
              </section>
            </>
          )}

          {/* ── STAGE ③ FORECAST ── */}
          {stage === "forecast" && (
            <section className="block" id="s-forecast">
              <h2 className="section-title">§7 미래 예측 — {mmm.target}</h2>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px", alignItems: "center" }}>
                <div className="ab-pillgroup">
                  <span className="ab-pillgroup-label">모델</span>
                  <button className={`ab-pill ${decompModel === "ols" ? "active" : ""}`} onClick={() => setDecompModel("ols")}>OLS</button>
                  <button className={`ab-pill ${decompModel === "ridge" ? "active" : ""}`} onClick={() => setDecompModel("ridge")}>Ridge</button>
                </div>
                <div className="ab-pillgroup">
                  <span className="ab-pillgroup-label">밴드</span>
                  <button className={`ab-pill ${fcBand === "mean" ? "active" : ""}`} onClick={() => setFcBand("mean")}>신뢰구간</button>
                  <button className={`ab-pill ${fcBand === "pred" ? "active" : ""}`} onClick={() => setFcBand("pred")}>예측구간</button>
                </div>
                <label style={{ fontSize: "12px", color: MUTED }}>
                  예측 기간(주):{" "}
                  <input type="number" min="1" max="52" value={fcHorizon} onChange={(e) => setFcHorizon(Math.max(1, Math.min(52, parseInt(e.target.value, 10) || 1)))} style={{ width: "60px" }} />
                </label>
              </div>
              {forecast ? (
                <>
                  <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "12px" }}>
                    {(() => {
                      const futAvg = forecast.predFut.reduce((a, b) => a + b, 0) / forecast.predFut.length;
                      const recentN = Math.min(8, forecast.actual.length);
                      const histAvg = forecast.actual.slice(-recentN).reduce((a, b) => a + b, 0) / recentN;
                      const chg = histAvg ? (futAvg / histAvg - 1) * 100 : 0;
                      return (
                        <>
                          <div className="stat-card"><div className="lbl">예측 평균/주</div><div className="val">{fmtInt(futAvg)}</div></div>
                          <div className="stat-card"><div className="lbl">최근 {recentN}주 평균</div><div className="val">{fmtInt(histAvg)}</div></div>
                          <div className="stat-card"><div className="lbl">변화</div><div className="val" style={{ color: chg >= 0 ? NEG : POS }}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</div></div>
                          <div className="stat-card"><div className="lbl">모델 적합 R²</div><div className="val">{forecast.r2}</div></div>
                        </>
                      );
                    })()}
                  </div>
                  <div className="chart-container" style={{ height: "300px", marginBottom: "12px" }}><canvas ref={forecastRef}></canvas></div>
                  <p style={{ fontSize: "11px", color: MUTED, marginBottom: "10px" }}>
                    {forecast.bandLabel} · 채널별 미래 예산을 수정하면 그 시나리오로 즉시 재예측됩니다(주 평균). 실제 배분·시나리오는 5-3 예산 배분 시뮬레이터를 사용하세요.
                  </p>

                  {/* ── 채널별 미래 예산 편집 (수정 시 즉시 재예측) ── */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                    <button className="ab-pill" onClick={() => { setFcBudget({}); setFcStepOff({}); }}>↺ 최근 평균으로 초기화</button>
                    <button
                      className="ab-pill"
                      style={{ background: "#7aa2f7", color: "#0b0d12", fontWeight: 700, borderColor: "#7aa2f7" }}
                      title="계수·계산식·실측·예측을 살아있는 엑셀 수식으로 — spend 칸을 바꾸면 adstock·ln·예측이 자동 연쇄 재계산"
                      onClick={() => csvDownload(`mmm_forecast_${mmm.target}_${forecast.model}_${_today()}.csv`, buildForecastCsv(forecast, mmm.target))}
                    >
                      ⬇ 전체 예측 CSV (계수·계산식·실측·예측)
                    </button>
                  </div>
                  <h3 style={{ fontSize: "13px", margin: "10px 0 6px" }}>
                    채널별 미래 예산 (주 평균){" "}
                    <span style={{ fontSize: "11px", color: MUTED, fontWeight: 400 }}>— 기본값 = 최근 8주 평균. 수정하면 그 시나리오로 즉시 재예측.</span>
                  </h3>
                  <div className="table-wrap" style={{ maxWidth: "540px" }}>
                    <table className="data" style={{ fontSize: "12px" }}>
                      <thead><tr><th>채널</th><th>최근평균/주</th><th>미래 예산/주</th></tr></thead>
                      <tbody>
                        {forecast.chans.map((ch) => {
                          const rec = forecast.recentMean[ch.key] || 0;
                          const cur = fcBudget[ch.key];
                          const val = cur != null && isFinite(cur) ? cur : Math.round(rec);
                          return (
                            <tr key={ch.key}>
                              <td>{ch.label}</td>
                              <td className="tnum" style={{ color: MUTED }}>{fmtInt(rec)}</td>
                              <td>
                                <input
                                  type="number"
                                  value={val}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setFcBudget((prev) => {
                                      const next = { ...prev };
                                      if (v === "") delete next[ch.key];
                                      else next[ch.key] = Math.max(0, parseFloat(v) || 0);
                                      return next;
                                    });
                                  }}
                                  style={{ width: "130px", textAlign: "right" }}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ── 이벤트·구조변화·휴일더미 미래 처리 ── */}
                  {forecast.steps && forecast.steps.length ? (
                    <>
                      <h3 style={{ fontSize: "13px", margin: "16px 0 6px" }}>
                        이벤트 · 구조변화 · 휴일더미 미래 처리{" "}
                        <span style={{ fontSize: "11px", color: MUTED, fontWeight: 400 }}>— 비우면 <strong>지속</strong>(마지막 값 유지), 숫자 N이면 N주 켜둔 뒤 끔(0=즉시 끔)</span>
                      </h3>
                      <div className="table-wrap" style={{ maxWidth: "600px" }}>
                        <table className="data" style={{ fontSize: "12px" }}>
                          <thead><tr><th>항목</th><th>종류</th><th>현재(관측 끝)</th><th>켜둘 미래 주</th></tr></thead>
                          <tbody>
                            {forecast.steps.map((s) => {
                              const cur = fcStepOff[s.key];
                              return (
                                <tr key={s.key}>
                                  <td>{s.label}</td>
                                  <td style={{ fontSize: "11px", color: MUTED }}>{s.kind === "step" ? "구조변화" : "이벤트/휴일"}</td>
                                  <td style={{ color: s.lastOn ? "#22c55e" : MUTED, fontSize: "11px" }}>{s.lastOn ? "켜짐(ON)" : "꺼짐(OFF)"}</td>
                                  <td>
                                    <input
                                      type="number"
                                      min="0"
                                      placeholder="지속"
                                      value={cur != null && isFinite(cur) ? cur : ""}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setFcStepOff((prev) => {
                                          const next = { ...prev };
                                          if (v === "") delete next[s.key];
                                          else next[s.key] = Math.max(0, parseInt(v, 10) || 0);
                                          return next;
                                        });
                                      }}
                                      style={{ width: "110px", textAlign: "right" }}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="muted" style={{ fontSize: "11px", marginTop: "4px" }}>
                        매핑한 휴일/이벤트 더미는 <strong>모델에 포함</strong>되며 미래엔 <strong>마지막 값으로 지속</strong>합니다. 종료 시점은 N으로 지정(예: 12주 뒤 종료 → 12). 영구 구조변화는 비워두세요(지속).
                      </p>
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: "11px", marginTop: "8px" }}>매핑된 이벤트·구조변화·휴일더미가 없습니다.</p>
                  )}

                  <details style={{ marginTop: "12px" }}>
                    <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>미래 예측 상세 (기간별)</summary>
                    <div className="table-wrap" style={{ marginTop: "8px" }}>
                      <table className="data" style={{ fontSize: "11px" }}>
                        <thead>
                          <tr><th>기간</th><th>예측</th><th>하한</th><th>상한</th>{forecast.chans.map((c) => (<th key={c.key}>{c.label}</th>))}</tr>
                        </thead>
                        <tbody>
                          {forecast.futLabels.map((lb, i) => (
                            <tr key={lb + i}>
                              <td>{lb}</td>
                              <td className="tnum">{fmtInt(forecast.predFut[i])}</td>
                              <td className="tnum">{fmtInt(forecast.lo[i])}</td>
                              <td className="tnum">{fmtInt(forecast.hi[i])}</td>
                              {forecast.chans.map((c) => (<td key={c.key} className="tnum">{fmtInt(forecast.futSpendByKey[c.key]?.[i])}</td>))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              ) : (
                <div className="callout warn"><div className="ico">!</div><div className="body">
                  <strong>예측 불가</strong>
                  <p>MMM 모델이 적합되지 않았거나 데이터가 변수 수보다 적습니다. 기간을 늘리거나 채널을 줄이세요.</p>
                </div></div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
