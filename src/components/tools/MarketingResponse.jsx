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
  mmmCannibActionShort,
  mmmGlobalCannib,
  mmmRankCfg,
  CANNIBAL_RANK,
} from "@/utils/responseCannibRank";
import {
  REG_LAB_STATE,
  regLabReadMapping,
  regLabRun,
} from "@/utils/regLabMath";
import { REG_FORECAST } from "@/utils/regForecastMath";
import CsvUploader from "@/components/CsvUploader";
import MmmColumnMapper, { autoGuessColMap, buildPanelFromColMap, mmmPlatformTags } from "@/components/tools/MmmColumnMapper";

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

// 상태 배지(Red/Yellow/Green) — 카니발 판정 등 Card 레이아웃 전반에서 재사용.
const BADGE_TONE = {
  ok: { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.45)", color: "#22c55e" },
  warn: { bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.45)", color: "#fbbf24" },
  danger: { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.45)", color: "#f87171" },
  neutral: { bg: "var(--bg-2)", border: "var(--border)", color: MUTED },
};
function Badge({ tone = "neutral", color, children }) {
  const c = BADGE_TONE[tone] || BADGE_TONE.neutral;
  const finalColor = color || c.color;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "999px", background: color ? `${color}1f` : c.bg, border: `1px solid ${color || c.border}`, color: finalColor, fontWeight: 700, fontSize: "11.5px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}
// Card — border/shadow/rounded 래퍼(레거시 톤 복구, §6).
function Card({ children, style }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "12px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", padding: "14px 16px", background: "var(--bg-2)", ...style }}>
      {children}
    </div>
  );
}

// 통계 상세(아코디언 B) 소제목 — 좌측 액센트 바 + 볼드 + 평어 한 줄로 섹션 구분.
function StatHead({ title, hint }) {
  return (
    <div style={{ margin: "18px 0 8px", borderLeft: "3px solid var(--primary, #adc6ff)", paddingLeft: "10px" }}>
      <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--text-1)" }}>{title}</div>
      {hint ? <div style={{ fontSize: "11px", color: MUTED, marginTop: "3px", lineHeight: 1.55 }}>{hint}</div> : null}
    </div>
  );
}

function fmtInt(v) {
  if (v == null || !isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

// ③ 회귀·미래예측: 타깃(가입/재활성/Total)×플랫폼(Total/Android/iOS) 토글에 맞는 Y 컬럼들을
// 인덱스별로 합산(벡터합)해 단일 종속변수를 만들고, X(채널 spend)는 플랫폼으로 필터해 REG_LAB_STATE에
// 세팅 후 regLabRun 호출. 모든 태그 both → 단일 결합 모델. utils(수학 엔진) 불변, 집계만 여기서.
const _labTagOf = (h) => {
  const n = String(h).toLowerCase();
  if (n.includes("android") || n.includes("aos")) return "android";
  if (/\bios\b/.test(n) || n.includes("iphone") || n.includes("ipad")) return "ios";
  return "both";
};
function buildAggregatedLab(rows, headers, colMap, target, platform) {
  if (!rows?.length || !headers?.length || !colMap) return { fits: null, error: "" };
  const platMatch = (h) => platform === "all" || _labTagOf(h) === platform || _labTagOf(h) === "both";
  const wantY = (role) =>
    (target === "Regs" && role === "reg") ||
    (target === "React" && role === "react") ||
    (target === "RR" && (role === "reg" || role === "react"));
  const yCols = headers.filter((h) => wantY((colMap[h] || {}).role) && platMatch(h));
  if (!yCols.length) return { fits: null, error: "선택한 타깃·플랫폼에 맞는 종속(가입/재활성) 컬럼이 없습니다." };
  const chCols = headers.filter((h) => (colMap[h] || {}).role === "channel" && platMatch(h));
  const evCols = headers.filter((h) => (colMap[h] || {}).role === "dummy");
  const stCols = headers.filter((h) => (colMap[h] || {}).role === "step");
  const tCol = headers.find((h) => ["week", "date"].includes((colMap[h] || {}).role));
  const numOf = (v) => parseFloat(String(v).replace(/[^0-9.\-]/g, "")) || 0;
  const DEP = "__Y_agg__";
  const augRows = rows.map((r) => ({ ...r, [DEP]: yCols.reduce((s, c) => s + numOf(r[c]), 0) }));
  REG_LAB_STATE.rows = augRows;
  REG_LAB_STATE.headers = [DEP, ...chCols, ...evCols, ...stCols, ...(tCol ? [tCol] : [])];
  REG_LAB_STATE.map = { [DEP]: { role: "dependent", tf: "none", tag: "both" } };
  chCols.forEach((c) => { REG_LAB_STATE.map[c] = { role: "cost", tf: "adstock_log", tag: "both" }; });
  evCols.forEach((c) => { REG_LAB_STATE.map[c] = { role: "event", tf: "none", tag: "both" }; });
  stCols.forEach((c) => { REG_LAB_STATE.map[c] = { role: "step", tf: "step", tag: "both" }; });
  if (tCol) REG_LAB_STATE.map[tCol] = { role: "time", tf: "none", tag: "both" };
  REG_LAB_STATE.groupKeep = null;
  REG_LAB_STATE.groupCol = null;
  REG_LAB_STATE.fits = null;
  try {
    regLabRun();
    return { fits: REG_LAB_STATE.fits, error: "", yCols, chCols };
  } catch (e) {
    return { fits: null, error: e.message };
  }
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

// 텍스트(.md) 다운로드 — "이 과정 자세히" 문서용.
function textDownload(name, text) {
  const blob = new Blob(["﻿" + text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

// 카니발 진단 전 과정을 평어+전문 병기로 설명하는 자체완결 문서(현재 결과 요약 포함).
function buildCannibGuideDoc(cannib, targetKo) {
  const L = [];
  L.push(`# 카니발(잠식) 진단 — 이 분석은 무엇이고 어떻게 판정하나`);
  L.push("");
  L.push(`대상 지표: ${targetKo} · 생성일: ${_today()}`);
  L.push("");
  L.push(`## 한 줄 요약`);
  L.push(`"카니발리제이션(잠식)"은 유료 광고가, 원래 광고 없이도 공짜로 들어왔을 오가닉(자연) 유입을 갉아먹는 현상입니다. 이 도구는 채널마다 "그 채널 광고가 오가닉을 잠식하는가?"를 4가지 서로 다른 각도로 따져보고, 그 결과를 종합해 **잠식 의심 / 애매함 / 문제 없음** 세 칸으로 분류합니다.`);
  L.push("");
  L.push(`## 왜 중요한가`);
  L.push(`광고 대시보드에 찍히는 전환은 "광고가 새로 만든 것"과 "원래 왔을 사람을 광고가 가로챈 것"이 섞여 있습니다. 뒤쪽(잠식)이 크면, 광고를 꺼도 성과가 별로 안 줄어드는데도 예산만 계속 쓰게 됩니다. 그래서 "이 채널을 늘려야 하나?"의 답이 달라집니다.`);
  L.push("");
  L.push(`## 4가지 신호 (각 채널마다 따져보는 것)`);
  L.push(`- **① 광고를 늘리기 전에 이미 줄고 있었나?** — 저지출 구간에서 오가닉이 이미 하락 추세였다면, 그 하락은 광고 탓이 아닐 가능성이 큽니다. (전문: 저지출 구간 기울기 검정)`);
  L.push(`- **② 시즌·추세를 걷어내도 광고 늘 때 오가닉이 줄어드나?** — 계절성·전반 추세를 제거한 뒤에도 광고비↑ 시 오가닉↓이면 잠식이 의심됩니다. (전문: 탈추세·1차차분 상관)`);
  L.push(`- **③ 광고를 늘리면 (잠식을 빼고도) 전체 성과가 순증가하나?** — 잠식분을 감안하고도 전체가 순으로 늘면 방어 양호입니다. (전문: 순증분 탄력성, 95% 신뢰구간)`);
  L.push(`- **④ 광고비가 몇 주 뒤에 오가닉을 끌어내리나?** — ①~③은 "같은 주"만 봅니다. ④는 시차를 두고(예: 3~6주 뒤) 광고비가 오가닉을 떨어뜨리는지 봅니다. (전문: 그랜저 인과, prewhitening 후 F-검정)`);
  L.push(`- **⑤ 충격 반응(IRF)** — 지출을 한 번 확 늘렸을 때 이후 몇 주간 성과가 어떻게 반응하는지 곡선으로 봅니다. 아래로 내려가면 시차 잠식, 위로 올라가면 시차 증분.`);
  L.push("");
  L.push(`## 판정은 어떻게 종합하나 (입증책임 비대칭)`);
  L.push(`- **문제 없음(방어 양호)**: 네 방향 모두 뚜렷한 잠식 신호가 없을 때만. "잠식 신호가 없다"는 강한 증거가 있어야 OK를 줍니다.`);
  L.push(`- **잠식 의심**: 어느 한 신호라도 잠식을 가리키면(특히 ④ 시차 신호가 있으면) 의심으로 올립니다. 같은 주 지표가 괜찮아도 시차에서 걸리면 의심입니다.`);
  L.push(`- **애매함(판단 보류)**: 데이터가 부족하거나(집행 주 수가 적음) 채널끼리 지출이 거의 똑같이 움직여(공선) 서로 구분이 안 되면, 억지로 판정하지 않고 보류합니다.`);
  L.push("");
  L.push(`## 꼭 기억할 것`);
  L.push(`이 진단은 전부 **"연관(association)"**이지 **"인과(causation)"**가 아닙니다. 관측 데이터만으로는 "광고가 잠식을 유발했다"를 확정할 수 없습니다. 이 도구의 역할은 **의심 채널을 좁혀주는 것**이고, 확정은 반드시 **홀드아웃(geo/시간 분할) 실험**으로 해야 합니다. "잠식 의심" 칸의 채널부터 실험 1순위로 검토하세요.`);
  L.push("");
  L.push(`## 수학·통계 상세 (전문가용)`);
  L.push("");
  L.push(`### ① 시간 선행성 — Theil-Sen 기울기 + Mann-Kendall 유의성`);
  L.push(`저지출 구간(지출 ≤ 전체 지출의 25번째 백분위수, p25)만 잘라내 그 구간 안에서 오가닉 KPI의 시간 추세를 봅니다.`);
  L.push(`- **기울기 추정**: Theil-Sen estimator — 모든 두 점 쌍 (i,j)의 기울기 (yⱼ−yᵢ)/(j−i)를 계산해 그 **중앙값**을 대표 기울기로 씀(이상치에 강함, OLS보다 로버스트).`);
  L.push(`- **유의성 검정**: Mann-Kendall 검정 통계량 S = Σᵢ<ⱼ sign(yⱼ−yᵢ). 분산 Var(S) = n(n−1)(2n+5)/18(동순위 보정 포함). Z = (S−sign(S))/√Var(S). |Z| > 1.96(양측 α=0.05)이면 유의한 추세로 판정.`);
  L.push(`- **판정 규칙**: 유의하게 하락(slope<0, p<0.05) → FOR(오가닉, 광고와 무관한 하락). 유의하게 상승 → AGAINST(카니발 의심). 유의하지 않거나 표본(n=low_n) 부족 → ABSTAIN.`);
  L.push("");
  L.push(`### ② 허위상관 — 탈추세·1차차분 Pearson 상관`);
  L.push(`시간(t)에 걸쳐 같이 늘어나는 두 변수는 서로 무관해도 상관이 크게 나옵니다(허위상관). 이를 걸러내기 위해:`);
  L.push(`1. **원상관(raw)**: 광고비와 오가닉 KPI의 단순 Pearson r.`);
  L.push(`2. **탈추세(detrended)**: 각 시계열에서 선형 추세(OLS 적합값)를 빼고 남은 잔차끼리의 상관.`);
  L.push(`3. **1차차분(first_diff)**: yₜ − yₜ₋₁ 변환 후 상관(단위근 제거 효과, 추세를 완전히 없앰).`);
  L.push(`- **판정 규칙**: detrended ≥ −0.10 AND first_diff ≥ −0.10 → FOR(허위상관이었을 뿐, 진짜 음의 관계 아님). detrended ≤ −0.20 OR first_diff ≤ −0.20 → AGAINST(탈추세해도 음의 관계 유지 = 잠식 의심). 그 사이는 ABSTAIN.`);
  L.push("");
  L.push(`### ③ 순증분 — log-log 탄력성 회귀 (AR(1) 자기상관 보정)`);
  L.push(`ln(오가닉 KPI) = β·ln(1+광고비) + 통제변수 + 오차, 형태의 회귀를 적합해 계수 β(탄력성)를 추정합니다.`);
  L.push(`- **AR(1) 보정**: 잔차가 자기상관(어제 오차가 오늘 오차에 영향)을 가지면 OLS 표준오차가 과소평가돼 거짓 유의성이 나올 수 있습니다. Yule-Walker로 AR(1) 계수 ρ를 추정하고 Cochrane-Orcutt류 변환(yₜ−ρyₜ₋₁)으로 재적합해 보정된 표준오차·p값을 씁니다.`);
  L.push(`- **95% 신뢰구간**: β ± 1.96×SE(β). CI가 0을 포함하지 않고 β>0이면 FOR(순증분 확인), β<0이고 CI가 0 미포함이면 AGAINST(순수 잠식), CI가 0을 포함하면 ABSTAIN(증거 없음 ≠ 효과 없음).`);
  L.push(`- **검정력 게이트**: 표본(n)이 적거나 광고비 변동계수(CV)가 작으면(=지출이 거의 늘 비슷해서 효과를 식별할 통계적 힘이 없으면) ③을 강제로 ABSTAIN 처리 — "효과 없음"과 "증거 없음"을 구분하기 위한 안전장치.`);
  L.push("");
  L.push(`### ④ 그랜저 인과 — Prewhitening 후 lagged F-검정`);
  L.push(`①~③은 전부 "같은 주(동시점)" 관계만 봅니다. 그랜저 인과는 "광고비의 **과거값**이 오가닉의 **미래값**을 추가로 설명하는가"를 봐서 시차 효과를 잡습니다.`);
  L.push(`- **Prewhitening**: 두 시계열 각각에서 추세(선형)+52주 계절성(Fourier 2차 항)을 먼저 제거해 순수한 단기 변동만 남깁니다(장기 추세 때문에 생기는 허위 그랜저-인과 방지).`);
  L.push(`- **F-검정**: "오가닉ₜ = f(오가닉 과거값들)"만 있는 축소모형과, "오가닉ₜ = f(오가닉 과거값들, 광고비 과거값들)"인 완전모형을 비교. 완전모형이 유의하게 더 잘 맞으면(F-검정 p<0.05) 광고비가 오가닉을 그랜저-인과함.`);
  L.push(`- **방향 두 가지**: 광고비→오가닉(시차 잠식/증분 여부), 오가닉→광고비(페이싱=예산 담당자가 오가닉이 약할 때 방어적으로 예산을 올리는 역인과 패턴 — 이게 유의하면 ②④의 음의 관계가 인과가 아니라 반응일 수 있음).`);
  L.push("");
  L.push(`### ⑤ 임펄스 응답 함수(IRF)`);
  L.push(`Prewhiten한 레벨 VAR(벡터자기회귀) 모형에서, 광고비에 1표준편차(1SD) 크기의 충격을 한 번 줬을 때 이후 여러 주에 걸쳐 오가닉이 어떻게 반응하는지 경로를 계산합니다. 음수 구간이 있으면 시차 잠식, 양수면 시차 증분. n<24주면 신뢰할 수 없어 곡선을 생략합니다.`);
  L.push("");
  L.push(`### 추세 존재성 검정 — STL 분해 + Mann-Kendall 4변형 + 단위근 검정`);
  L.push(`- **STL(Seasonal-Trend decomposition using Loess)**: 시계열을 추세+계절+잔차로 분해(52주 주기, 2회 반복).`);
  L.push(`- **Mann-Kendall 4가지**: 원본(raw), 자기상관 보정(Hamed-Rao, 순위 기반 분산 보정), 계절형(seasonal MK, 같은 계절끼리만 비교), 탈계절 잔차형(deseason). 네 개가 일치해야 "진짜 추세"로 확신.`);
  L.push(`- **ADF(Augmented Dickey-Fuller)**: 단위근(비정상성, 추세가 발산) 존재 여부 검정. p<0.05면 정상(추세가 있어도 발산 안 함).`);
  L.push(`- **KPSS**: ADF와 반대 귀무가설(정상성을 귀무가설로) — 두 검정이 서로 보완. 둘 다 통과해야 "trend-stationary" 확정.`);
  L.push("");
  L.push(`### 데이터 위생 + 매크로 — 모델-독립 검증`);
  L.push(`모델을 적합하기 전에 스키마·연속성·결측을 점검(위생 경고)하고, 2024 vs 2025처럼 연도 단위 YoY(spend·KPI)를 계산합니다. 이건 어떤 회귀 모형에도 의존하지 않는 "가장 확실한" 헤드라인 숫자라, 모델이 이상해도 이 숫자는 흔들리지 않습니다.`);
  L.push("");
  L.push(`### 단순 모델 audit — HAC(Newey-West) 표준오차`);
  L.push(`모든 채널 지출을 하나로 합친 naive 모델(ln_총지출)을 적합하고, 일반 OLS p값과 **HAC(Newey-West) 자기상관·이분산 보정** p값을 나란히 비교합니다. HAC는 OLS보다 항상 보수적(표준오차가 크거나 같음) — 둘이 크게 다르면 OLS 결과를 그대로 믿으면 안 된다는 신호입니다. 또한 브랜드 채널 추가 전후 R²·계수 변화로 공선성(다중공선성)을 점검합니다(회귀변수 추가는 이론상 R²를 못 낮추므로, 다른 target에서 총지출 계수가 크게 출렁이면 공선 증거).`);
  L.push("");
  if (cannib && cannib.cannibRank && cannib.cannibRank.length) {
    L.push(`## 현재 데이터 판정 요약`);
    for (const r of cannib.cannibRank) {
      const lv = mmmCannibLevel(r);
      const bucket = !r.eligible || lv.lv === 1 ? "애매함(판단 보류)" : lv.lv >= 4 ? "잠식 의심" : "문제 없음";
      L.push(`- **${r.label}** → ${bucket}${r.eligible ? "" : ` (데이터 부족 ${r.nActive}/${r.total}주)`}`);
    }
    L.push("");
  }
  L.push(`## 함께 보는 다른 분석`);
  L.push(`- **추세 존재성**: 성과에 광고와 무관한 시간 흐름 자체의 추세가 있는지(STL 분해 + Mann-Kendall·ADF·KPSS 검정).`);
  L.push(`- **데이터 위생**: 분석 전에 데이터가 깨끗한지(결측·연속성) + 작년 대비 지표 변화.`);
  L.push(`- **단순 모델 점검**: "모든 지출을 하나로 뭉친 대충 만든 모델"이 왜 못 믿을 만한지(자기상관·공선성) 확인.`);
  L.push("");
  L.push(`— Growth Ops Playbook · 마케팅 반응 분석(MMM)`);
  return L.join("\n");
}

// MMM 기여 분해 전 과정 설명 문서(평어 + 수학·통계 상세 + 현재 결과 요약).
function buildMmmGuideDoc(mmm, targetKo) {
  const L = [];
  const run = mmm.run || {};
  L.push(`# MMM 기여 분해 — 이 분석은 무엇이고 어떻게 계산하나`);
  L.push("");
  L.push(`대상 지표: ${targetKo} · 생성일: ${_today()}`);
  L.push("");
  L.push(`## 한 줄 요약`);
  L.push(`MMM(Marketing Mix Modeling·마케팅 믹스 모델링)은 "지난 ${targetKo} 성과의 등락을 무엇이 얼마나 만들었나"를 나눠보는 분석입니다. 시즌·추세 같은 비매체 요인과 각 광고 채널의 기여를 공정하게 분해하고, "다음 1,000달러를 어디에 쓰면 가장 효율적인가"까지 안내합니다.`);
  L.push("");
  L.push(`## 무엇을 보여주나 (평어)`);
  L.push(`- **무엇이 성과를 움직였나**: 성과 등락의 설명력을 시즌·추세·채널별로 % 배분(설명력 비중).`);
  L.push(`- **다음 예산은 어디로**: 지금 지출 수준에서 1,000달러를 더 쓸 때 채널별로 늘어나는 ${targetKo} 인원 순위.`);
  L.push(`- **실제 vs 모델**: 모델이 실제 성과를 얼마나 잘 따라갔는지(오차), 어느 주가 크게 튀었는지.`);
  L.push("");
  L.push(`## 수학·통계 상세 (전문가용)`);
  L.push("");
  L.push(`### 1. Adstock (광고 잔효)`);
  L.push(`광고 효과는 집행한 주에만 나타나지 않고 다음 주로 이어집니다(잔향). adstockₜ = spendₜ + λ·adstockₜ₋₁ 형태의 기하 감쇠로 이월을 모델링합니다. λ(0~1)는 **rolling-origin out-of-sample CV**로 선택 — 여러 λ 후보로 "아직 안 본 미래 주"를 예측했을 때 RMSE가 가장 작은 값을 씁니다(in-sample 과적합 방지). 현재 best λ = ${run.best_lambda ?? "—"}.`);
  L.push("");
  L.push(`### 2. Saturation (수확체감)`);
  L.push(`같은 채널도 많이 쓸수록 1달러당 효과가 줄어듭니다. ln(1+adstock) 변환으로 로그-오목(concave) 반응곡선을 만들어, 지출이 커질수록 한계효과가 감소하도록 합니다. "+$1k당 N명"은 현재 지출점에서의 국소 기울기(β/(1+지출)×1000)이며 지출이 클수록 작아집니다.`);
  L.push("");
  L.push(`### 3. 회귀 적합 + HAC`);
  L.push(`ln(${targetKo}) = Σβᵢ·ln(1+adstockᵢ) + 추세 + 계절(Fourier) + 휴일·구조변화 더미 + 오차. 시계열 잔차의 자기상관·이분산을 감안해 **HAC(Newey-West) 표준오차**로 유의성을 보수적으로 평가합니다. 채널끼리 지출이 겹치면 계수가 불안정해지므로 **VIF>10** 항목은 "식별 실패"로 표시합니다.`);
  L.push("");
  L.push(`### 4. 탄력성 (Elasticity)`);
  L.push(`log-log 회귀 계수 β는 "지출 1%↑ → 성과 β%↑"로 읽는 탄력성입니다(예: 0.3이면 지출 10%↑ → 약 3%↑). 95% 신뢰구간이 0을 넘지 않아야 통계적으로 유의합니다.`);
  L.push("");
  L.push(`### 5. Shapley R² 분해`);
  L.push(`각 드라이버가 성과 변동(R²)을 몇 % 설명하는지 **공정하게** 나눕니다. 모델에 변수를 넣는 순서를 바꾸면 누가 공을 가져갈지 달라지므로, 가능한 모든 투입 순서(부분집합)의 기여를 평균낸 Shapley 값을 씁니다(LMG 방식). 모든 몫의 합 = 전체 R². 지출 비중을 그대로 기여도로 쓰는 단순 점유율 분해는 로그·수확체감 때문에 틀리므로 금지합니다.`);
  L.push("");
  L.push(`### 6. 주별 기여 분해 (decomposition)`);
  L.push(`매주 실제값을 baseline(비매체 기저) + 각 드라이버 기여로 쪼갭니다. OLS(중심화)는 평균 대비 ± 변동을, Ridge(정규화)는 매체 0일 때 기준의 절대 기여를 봅니다. RMSE·MAPE로 모델이 실제를 얼마나 잘 따라갔는지 확인하고, 잔차가 평소의 2σ를 넘는 주는 "튀는 구간"으로 표시해 원인을 기록하게 합니다.`);
  L.push("");
  if (run.shapley && run.shapley.rows && run.shapley.rows.length) {
    L.push(`## 현재 데이터 설명력 비중 (Shapley R², total R²=${run.shapley.total})`);
    [...run.shapley.rows].sort((a, b) => b.r2_share - a.r2_share).forEach((r) => {
      L.push(`- ${r.driver}: ${(r.pct || 0).toFixed(1)}%`);
    });
    L.push("");
  }
  L.push(`## 꼭 기억할 것`);
  L.push(`MMM는 관측 데이터 기반 **연관·기술(descriptive) 모델**이지 인과 확정이 아닙니다. "다음 예산 순위"는 반응곡선상의 가설이며, 실제 증분·ROI 확정은 홀드아웃 실험에서 합니다. 단기 캠페인 단위 배분은 예산 배분 시뮬레이터(5-3)를 쓰세요.`);
  L.push("");
  L.push(`— Growth Ops Playbook · 마케팅 반응 분석(MMM)`);
  return L.join("\n");
}

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
  { id: "diagnose", no: "① 잠식 진단", title: "카니발 진단", icon: "🔬", desc: "유료 광고가 공짜로 들어올 오가닉 유입을 갉아먹고 있나? — 채널별로 점검합니다." },
  { id: "mmm", no: "② 기여 분해", title: "MMM 기여 분해", icon: "🧩", desc: "무엇이 우리 성과를 실제로 움직였나? 다음 예산은 어디에 써야 하나?" },
  { id: "lab", no: "③ 미래 예측", title: "회귀 · 미래 예측", icon: "📈", desc: "이대로 가면, 또는 예산을 바꾸면 다음 몇 주 성과는 어떻게 될까?" },
];

// ② 기여 분해 스택 차트 버킷 — 12+ 드라이버를 마케터가 한눈에 읽는 4묶음으로.
// 엔진 groupNames→버킷 매핑(수학 불변, 표시 그룹핑만). tone은 다크/라이트 둘 다 읽히는 중간 채도.
const MMM_BUCKET_META = {
  base: { label: "기본 수요", tone: "#94a3b8" },
  trend: { label: "장기 추세", tone: "#38bdf8" },
  event: { label: "이벤트·구조변화", tone: "#f59e0b" },
  media: { label: "광고 효과", tone: "#8b7ff0" },
};
// 아래→위 쌓는 순서. base(=baseline+계절)는 절대 밴드로 별도 처리, 나머지는 그 위 누적.
const MMM_BUCKET_ORDER = ["base", "trend", "event", "media"];
function decompBucketOf(g) {
  if (g === "Seasonality") return "base"; // 계절은 기본 수요에 흡수(§유저: baseline+계절=기본 수요)
  if (g === "Trend") return "trend";
  if (g === "Holidays" || g === "Regime(steps)") return "event";
  return MMM_NONMEDIA_GROUPS.includes(g) ? "event" : "media";
}
// 개별 채널(광고) 밴드용 팔레트 — 보라 계열 명도차. hex+alpha는 fill에만.
const MMM_MEDIA_PALETTE = ["#8b7ff0", "#a78bfa", "#c084fc", "#e879f9", "#7dd3fc", "#67e8f9"];

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
  const [decompGrouped, setDecompGrouped] = useState(true); // §5.5 true=4버킷 묶음 / false=광고 개별채널
  const [satHidden, setSatHidden] = useState({}); // 수확체감 곡선 채널별 표시 토글 { [chKey]: true=숨김 }
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
  // 플랫폼 필터(Total/Android/iOS) — colMap 헤더 태그(_android/_ios) 기준. 태그 없으면 토글 자체 숨김.
  const [platformFilter, setPlatformFilter] = useState("all"); // all | android | ios

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
      const built = buildPanelFromColMap(csvData.headers, csvData.raw, mmmColMap, platformFilter);
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
  }, [hasData, csvData, target, mmmColMap, mmmAnalyzed, platformFilter]);

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
      // 반응 곡선 (per channel, y = ln_coef·ln(1+x) = 그 지출에서의 예상 기여).
      // 기존 한계응답(ln_coef/(1+x)) 곡선은 x→0에서 발산(1,000,000)해 판독 불가(§유저) →
      // 누적 반응 곡선으로 교체(단조·발산 없음, 평평해질수록 수확체감). 현재 지출 위치 점으로 표시.
      if (satRef.current && run.saturationByChannel) {
        const themeVarS = (n) => (typeof document !== "undefined" ? getComputedStyle(document.body).getPropertyValue(n).trim() : "") || "";
        const mutedColS = themeVarS("--text-muted") || CHART_THEME.muted;
        const textColS = themeVarS("--text-1") || CHART_THEME.text;
        const chs = Object.entries(run.saturationByChannel);
        if (chs.length) {
          const maxSpend = Math.max(...chs.map(([, s]) => s.recentMean || 0)) * 1.6 || 40000;
          const grid = Array.from({ length: 41 }, (_, i) => (i / 40) * maxSpend);
          const respAt = (s, x) => s.ln_coef * Math.log(1 + x);
          // 현재 지출 위치(●)는 각 채널 선 위 데이터점으로 → 선을 숨기면 점도 같이 숨겨짐(별도 scatter 제거).
          const lineDs = chs.map(([key, s], i) => {
            const col = MMM_MEDIA_PALETTE[i % MMM_MEDIA_PALETTE.length];
            let curIdx = -1;
            if (s.recentMean > 0) {
              let best = Infinity;
              grid.forEach((x, gi) => { const d = Math.abs(x - s.recentMean); if (d < best) { best = d; curIdx = gi; } });
            }
            return {
              type: "line",
              label: s.label,
              data: grid.map((x) => ({ x, y: respAt(s, x) })),
              borderColor: col,
              borderDash: s.ln_coef < 0 ? [5, 4] : [],
              borderWidth: 1.75,
              tension: 0.3,
              pointRadius: grid.map((_, gi) => (gi === curIdx ? 4.5 : 0)),
              pointBackgroundColor: col,
              pointBorderColor: textColS,
              pointBorderWidth: 1.5,
              hidden: !!satHidden[key],
            };
          });
          const satOpts = chartBase();
          satOpts.plugins.legend = { display: false }; // 커스텀 HTML 범례(채널 토글) 사용
          satOpts.plugins.tooltip = { ...satOpts.plugins.tooltip, callbacks: { label: (c) => `${c.dataset.label}: ${Math.round(c.parsed.y).toLocaleString()}명 @ $${Math.round(c.parsed.x / 1000)}k` } };
          satOpts.scales.x = { type: "linear", ticks: { color: mutedColS, font: { size: 10 }, callback: (v) => "$" + Math.round(v / 1000) + "k" }, grid: { display: false } };
          satOpts.scales.y = { ticks: { color: mutedColS, font: { size: 10 }, callback: (v) => Math.round(v).toLocaleString() }, grid: { color: CHART_THEME.grid } };
          inst.push(
            new Chart(satRef.current.getContext("2d"), {
              data: { datasets: lineDs },
              options: satOpts,
            }),
          );
        }
      }
      // "baseline" 필드는 회귀절편(전체 기간 평균) 단일 상수라 원래 평평함 — 시즌·추세는 그 위에
      // 별도 contrib로 얹힘. 그래서 이 필드만 그리면 "왜 안 움직이나" 혼란(§ 실사용 피드백) →
      // 두 차트 모두 baseline+비매체(시즌·추세·휴일·구조변화) 합산 시계열을 같이 씀.
      const nonMediaGroupsAll = decomp ? decomp.groupNames.filter((g) => MMM_NONMEDIA_GROUPS.includes(g)) : [];
      const nonMediaSeries = decomp
        ? decomp.weeks.map((w) => w.baseline + nonMediaGroupsAll.reduce((s, g) => s + (w.contrib[g] || 0), 0))
        : [];
      // Fit chart (actual vs fitted vs 시즌·추세 등)
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
                { label: "시즌·추세 등(비매체)", data: nonMediaSeries, borderColor: "#e0af68", borderDash: [5, 4], pointRadius: 0, tension: 0.2 },
              ],
            },
            options: chartBase(),
          }),
        );
      }
      // Decomp stacked area — 기준선(기본 수요) 위에 버킷/채널을 누적. 맨 위 누적선 = 모델(fitted).
      // 그룹모드: 4버킷(기본·시즌추세·이벤트·광고). 개별모드: 비매체 버킷 + 광고를 채널별로 각각 누적.
      // 어느 모드든 모든 밴드를 기준선 위로 쌓아 최상단이 모델선과 일치(=아래 텍스트의 "모델"과 sum 일치).
      if (decompRef.current && decomp) {
        const labels = decomp.weeks.map((w, i) => mmm.panel.weekLabel?.[i] || w.week);
        // 테마 토큰은 body.light-mode에 재정의됨 → documentElement가 아니라 body에서 읽어야 라이트 반영.
        const themeVar = (n) => (typeof document !== "undefined" ? getComputedStyle(document.body).getPropertyValue(n).trim() : "") || "";
        const textCol = themeVar("--text-1") || CHART_THEME.text;
        const mutedCol = themeVar("--text-muted") || CHART_THEME.muted;
        // 버킷별 주간 합 시계열
        const bucketSeries = (bucket) =>
          decomp.weeks.map((w) =>
            decomp.groupNames.reduce((s, g) => (decompBucketOf(g) === bucket ? s + (w.contrib[g] || 0) : s), 0),
          );
        // area+누적선 방식은 밴드가 음수일 때 선이 역행해 다른 밴드를 침범(§유저 피드백: "쭉 꺼지는 게 카니발?").
        // stacked bar로 전환 — Chart.js는 양/음수를 0선 기준 위/아래로 각자 독립 누적해 절대 안 꼬임.
        // 기본 수요 = baseline(상수) + 계절(Seasonality) 흡수.
        const bars = [];
        bars.push({ label: MMM_BUCKET_META.base.label, data: decomp.weeks.map((w, t) => w.baseline + bucketSeries("base")[t]), tone: MMM_BUCKET_META.base.tone });
        bars.push({ label: MMM_BUCKET_META.trend.label, data: bucketSeries("trend"), tone: MMM_BUCKET_META.trend.tone });
        bars.push({ label: MMM_BUCKET_META.event.label, data: bucketSeries("event"), tone: MMM_BUCKET_META.event.tone });
        if (decompGrouped) {
          bars.push({ label: MMM_BUCKET_META.media.label, data: bucketSeries("media"), tone: MMM_BUCKET_META.media.tone });
        } else {
          const mediaGroups = decomp.groupNames.filter((g) => decompBucketOf(g) === "media");
          mediaGroups.forEach((g, i) => {
            bars.push({ label: g, data: decomp.weeks.map((w) => w.contrib[g] || 0), tone: MMM_MEDIA_PALETTE[i % MMM_MEDIA_PALETTE.length] });
          });
        }
        const datasets = bars.map((b) => ({
          type: "bar",
          label: b.label,
          data: b.data,
          backgroundColor: b.tone,
          stack: "decomp",
          borderRadius: 2,
          order: 2,
        }));
        // 실제(점선 오버레이) — 막대 스택 합과 얼마나 가까운지 눈으로 확인.
        datasets.push({
          type: "line",
          label: "실제",
          data: decomp.weeks.map((w) => w.actual),
          borderColor: textCol,
          backgroundColor: "transparent",
          borderDash: [4, 3],
          fill: false,
          pointRadius: 0,
          borderWidth: 1.5,
          order: 0,
        });
        const decompOpts = chartBase();
        decompOpts.plugins.legend = {
          position: "bottom",
          labels: { color: textCol, font: { size: 11 }, boxWidth: 12, boxHeight: 12, padding: 10, usePointStyle: true },
        };
        decompOpts.plugins.tooltip = {
          ...decompOpts.plugins.tooltip,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? "+" : ""}${Math.round(ctx.parsed.y).toLocaleString()}명`,
          },
        };
        decompOpts.scales.x = { ...decompOpts.scales.x, stacked: true, ticks: { ...decompOpts.scales.x.ticks, color: mutedCol, autoSkip: true, maxTicksLimit: 12, maxRotation: 0 } };
        decompOpts.scales.y = { ...decompOpts.scales.y, stacked: true, ticks: { ...decompOpts.scales.y.ticks, color: mutedCol, callback: (v) => Math.round(v).toLocaleString() } };
        // 메모 남긴 튀는 주 → 세로 점선 + 번호 뱃지(글씨 겹침 방지, 실제 메모는 아래 표에 동일 번호로).
        const notedSpikes = (decomp.spikes || []).filter((s) => (spikeNotes[`${mmm.target}|${s.week}`] || "").trim());
        const numOf = (s) => notedSpikes.findIndex((n) => n.week === s.week) + 1;
        const spikeLinePlugin = {
          id: "spikeLines",
          afterDraw(chart) {
            if (!notedSpikes.length) return;
            const { ctx, chartArea, scales } = chart;
            ctx.save();
            notedSpikes.forEach((s) => {
              const idx = s.i != null ? s.i : s.week - 1;
              const x = scales.x.getPixelForValue(idx);
              if (x < chartArea.left || x > chartArea.right) return;
              ctx.strokeStyle = "#f59e0b";
              ctx.setLineDash([4, 3]);
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x, chartArea.top + 12);
              ctx.lineTo(x, chartArea.bottom);
              ctx.stroke();
              ctx.setLineDash([]);
              // 번호 뱃지(원)
              ctx.fillStyle = "#f59e0b";
              ctx.beginPath();
              ctx.arc(x, chartArea.top + 7, 8, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#fff";
              ctx.font = "bold 10px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(String(numOf(s)), x, chartArea.top + 7);
            });
            ctx.restore();
          },
        };
        inst.push(
          new Chart(decompRef.current.getContext("2d"), {
            data: { labels, datasets },
            options: decompOpts,
            plugins: [spikeLinePlugin],
          }),
        );
      }
    }
    return () => inst.forEach((c) => c && c.destroy());
  }, [stage, mmm, decomp, spikeNotes, decompGrouped, satHidden]);

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
  /* ------------------------------ LAB (③ 회귀·미래예측) ------------------------------ */
  // ①②와 동일 CSV·매핑(shared colMap)을 그대로 사용 — 별도 업로드·샘플·매핑 없음. 채널 spend가
  // 매핑돼 있으면 브리지로 회귀 역할(독립·이벤트·시간·종속) 자동 번역. mmm처럼 useMemo로 계산
  // (effect+setState 회피). REG_LAB_STATE(전역)에 결과를 쓰고 fits/error를 반환.
  const lab = useMemo(() => {
    const bridgeReady = hasData && mmmColMap && Object.values(mmmColMap).some((d) => d && d.role === "channel");
    if (stage !== "lab" || !mmmAnalyzed || !bridgeReady) return { fits: null, error: "" };
    // 타깃(가입/재활성/Total)×플랫폼(Total/Android/iOS) 토글에 맞춰 Y 합산 + X 필터 → 단일 결합 모델.
    return buildAggregatedLab(csvData.raw, csvData.headers, mmmColMap, target, platformFilter);
  }, [stage, mmmColMap, mmmAnalyzed, hasData, csvData, target, platformFilter]);

  useEffect(() => {
    const inst = [];
    if (stage === "lab" && lab.fits && labChartRef.current) {
      const firstTag = Object.keys(lab.fits)[0];
      const f = lab.fits[firstTag];
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
  }, [stage, lab]);

  const labForecast = useMemo(() => {
    if (stage !== "lab" || !lab.fits) return null;
    try {
      const fits = lab.fits;
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
  }, [stage, lab]);

  /* ------------------------------ RENDER ------------------------------ */
  // 아코디언 안 차트는 접힘 상태에서 폭 0으로 마운트됨(§7 함정) → 펼칠 때 resize 이벤트로 재측정.
  const onAccordionToggle = (e) => {
    if (e.currentTarget.open) requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  };

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
  // 태그(_android/_ios) 있는 컬럼이 매핑돼 있을 때만 플랫폼 토글 노출(단일 플랫폼 컬럼 없는 wide 데이터용).
  const platformTags = hasData && mmmColMap ? mmmPlatformTags(csvData.headers, mmmColMap) : [];

  // 브레드크럼(현재 위치) + 타깃/플랫폼 토글을 한 줄로 병합 — flex justify-between.
  const controlBar = () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
      <span style={{ fontSize: "12px", color: MUTED }}>
        채널별 카니발 <span style={{ margin: "0 4px" }}>·</span> MMM Panel
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        {availTargets.length > 1 && (
          <div className="ab-pillgroup" style={{ margin: 0 }}>
            <span className="ab-pillgroup-label">타깃</span>
            {availTargets.map((t) => (
              <button key={t} className={`ab-pill ${effectiveTarget === t ? "active" : ""}`} onClick={() => setTarget(t)}>
                {t === "Regs" ? "가입(Reg)" : t === "React" ? "재활성(React)" : "Reg+React"}
              </button>
            ))}
          </div>
        )}
        {platformTags.length > 0 && (
          <div className="ab-pillgroup" style={{ margin: 0 }}>
            <span className="ab-pillgroup-label">플랫폼</span>
            <button className={`ab-pill ${platformFilter === "all" ? "active" : ""}`} onClick={() => setPlatformFilter("all")}>Total</button>
            {platformTags.includes("android") && (
              <button className={`ab-pill ${platformFilter === "android" ? "active" : ""}`} onClick={() => setPlatformFilter("android")}>Android</button>
            )}
            {platformTags.includes("ios") && (
              <button className={`ab-pill ${platformFilter === "ios" ? "active" : ""}`} onClick={() => setPlatformFilter("ios")}>iOS</button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // ── LAB stage ──
  // ③ 회귀·미래예측(lab)은 이제 ①②와 동일하게 no-data→shared 게이트→분석완료 흐름을 타므로
  // 여기서 early-return하지 않는다(별도 업로드·샘플·매핑 제거). 실제 렌더는 아래 analyzed return에서.

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
          {controlBar()}

          {/* ── STAGE ③ LAB (회귀·미래예측) — ①②와 동일 CSV·매핑 자동 사용 ── */}
          {stage === "lab" && (() => {
            const fits = lab.fits;
            const tags = fits ? Object.keys(fits) : [];
            return (
              <>
                <section className="block" id="s-prep">
                  <h2 className="section-title">📈 회귀 · 미래 예측</h2>
                  <p style={{ fontSize: "12px", color: MUTED, marginBottom: "8px", lineHeight: 1.55 }}>
                    ①·② 탭과 <strong>같은 CSV·매핑</strong>을 그대로 씁니다 — 매핑을 바꾸려면 상단 &quot;매핑 수정&quot;에서 고치면 세 탭에 함께 반영돼요. 채널→독립(광고 여운), 더미→이벤트, 주차→시간, 활성 타깃({mmm.target})→종속으로 번역해 다음 몇 주를 예측합니다.
                  </p>
                  {lab.error && (
                    <div className="callout warning"><div className="ico">!</div><div className="body">{lab.error}</div></div>
                  )}
                </section>
                {fits && tags.length > 0 ? (
                  <>
                    <section className="block" id="s-fit">
                      <h2 className="section-title">적합 결과 (모델별)</h2>
                      {tags.map((tag) => {
                        const f = fits[tag];
                        const tgtKo = target === "Regs" ? "가입" : target === "React" ? "재활성" : "가입+재활성";
                        const platKo = platformFilter === "android" ? "Android" : platformFilter === "ios" ? "iOS" : "전체 플랫폼";
                        return (
                          <div key={tag} style={{ marginBottom: "16px" }}>
                            <h3 style={{ fontSize: "13px", margin: "8px 0" }}>
                              종속변수: <strong>{tgtKo}</strong> · {platKo} · R²={f.fit.R2.toFixed(4)} · λ={f.lam}
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
                ) : (
                  <section className="block">
                    <p className="muted" style={{ fontSize: "12px" }}>회귀 모델을 준비 중이거나 만들 수 없어요 — 채널 spend와 종속 타깃({mmm.target}) 매핑을 확인하세요.</p>
                  </section>
                )}
              </>
            );
          })()}

          {/* ── STAGE ① DIAGNOSE (MMM panel) ── */}
          {stage === "diagnose" && (
            <>
              {/* ── 메인: 판정별 3버킷 칸반(그룹핑) + 짧은 평어 헤드라인 ── 통계는 아래 아코디언 ── */}
              {cannib && cannib.cannibRank && cannib.cannibRank.length ? (() => {
                const rk = cannib.cannibRank;
                // 엔진 5단계(lv) → 마케터용 3버킷: 잠식의심 / 애매함(데이터부족·공선) / 문제없음.
                const bucketOf = (r) => {
                  const L = mmmCannibLevel(r);
                  if (!r.eligible || L.lv === 1) return "unclear";
                  if (L.lv >= 4) return "danger"; // 카니발 + 신호 조금 → 점검 대상
                  return "ok"; // 신호 없음 / 거의 없음
                };
                const buckets = { danger: [], unclear: [], ok: [] };
                rk.forEach((r) => buckets[bucketOf(r)].push(r));
                const nD = buckets.danger.length;
                const headTone = nD > 0 ? "danger" : buckets.ok.length > 0 ? "ok" : "warn";
                const headBadge = nD > 0 ? "잠식 의심" : buckets.ok.length > 0 ? "방어 양호" : "판단 보류";
                const headline = nD > 0
                  ? `${rk.length}개 채널 중 ${nD}개에서 잠식이 의심돼요 — 빨간 칸부터 점검하세요.`
                  : buckets.ok.length > 0
                    ? `${rk.length}개 채널 대체로 방어 양호 — 지금 뚜렷한 잠식 신호는 없어요.`
                    : `판정할 만큼 데이터가 충분한 채널이 적어요 — 애매함 칸을 확인하세요.`;
                const col = (key, title, icon, tone) => {
                  const list = buckets[key];
                  const c = BADGE_TONE[tone];
                  return (
                    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: "12px", padding: "10px 12px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: c.color, marginBottom: "8px" }}>{icon} {title} · {list.length}</div>
                      {list.length ? list.map((r) => (
                        <div key={r.key} onClick={() => setCannibChannel(r.key)}
                          style={{ background: "var(--bg-2)", border: `1px solid ${r.key === activeCannibCh ? "rgba(122,162,247,0.55)" : "var(--border)"}`, borderRadius: "8px", padding: "8px 10px", marginBottom: "6px", cursor: "pointer" }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span>{r.label}{r.brand ? " 🏷" : ""}</span>
                            <span style={{ fontSize: "11px", color: MUTED }}>›</span>
                          </div>
                          <div style={{ fontSize: "11px", color: MUTED, marginTop: "2px" }}>
                            {key === "unclear"
                              ? (r.eligible ? "채널끼리 지출이 겹침(공선)" : `데이터 부족 (${r.nActive}/${r.total}주)`)
                              : mmmCannibActionShort(r)}
                          </div>
                        </div>
                      )) : <div style={{ fontSize: "11px", color: MUTED }}>없음</div>}
                    </div>
                  );
                };
                return (
                  <>
                    <Card style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <Badge tone={headTone}>{headBadge}</Badge>
                      <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text-1)" }}>{headline}</span>
                    </Card>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px", marginBottom: "10px" }}>
                      {col("danger", "잠식 의심", "⚠", "danger")}
                      {col("unclear", "애매함", "?", "neutral")}
                      {col("ok", "문제 없음", "✓", "ok")}
                    </div>
                    <p style={{ fontSize: "11px", color: MUTED, marginBottom: "14px" }}>
                      채널을 클릭하면 아래에 왜 그렇게 판정했는지(근거)가 열려요.{rk.mde12 != null ? ` · 12주 실험 최소검출력 ≈ ${rk.mde12}%` : ""}
                    </p>
                  </>
                );
              })() : (
                <Card style={{ marginBottom: "14px" }}>
                  <span style={{ fontSize: "13px", color: MUTED }}>카니발 판정을 계산할 수 없습니다 (데이터·매핑 확인).</span>
                </Card>
              )}

              {/* ── 채널 드릴다운: 4가지를 평어 질문으로, ①②③ 3열 균등, 헤드라인은 버킷과 일치 ── */}
              {activeCn && (() => {
                const cn = activeCn;
                const p = cn.precedence, d = cn.detrend_corr, ni = cn.net_incrementality;
                const chLabel = (cannib.rows.find((r) => r.channel.key === activeCannibCh) || {}).channel?.label || activeCannibCh;
                const g = cn.granger;
                const gate = cn.power_gate || { blocked: false, reasons: [] };
                // 헤드라인을 칸반 버킷과 동일 규칙으로 계산 → "문제없다는데 왜 잠식의심" 모순 제거.
                const rr = (cannib.cannibRank || []).find((x) => x.key === activeCannibCh);
                const lv = rr ? mmmCannibLevel(rr).lv : null;
                const bucket = !rr || !rr.eligible || lv === 1 ? "unclear" : lv >= 4 ? "danger" : "ok";
                const votes = [p.vote, d.vote, ni.vote];
                const nFor = votes.filter((v) => v === "FOR").length;
                const nAg = votes.filter((v) => v === "AGAINST").length;
                const nAb = votes.filter((v) => v === "ABSTAIN").length;
                const headTone = bucket === "danger" ? "danger" : bucket === "ok" ? "ok" : "warn";
                const headBadge = bucket === "danger" ? "잠식 의심" : bucket === "ok" ? "방어 양호" : "판단 보류";
                const headWhy = bucket === "danger"
                  ? (cn.granger_cannibal
                      ? "같은 주 지표(①②③)는 대체로 괜찮은데, 몇 주 시차를 두고 광고비가 오가닉을 끌어내리는 신호(④)가 나왔어요. 그래서 의심으로 올렸습니다."
                      : "광고가 늘 때 오가닉이 줄어드는 신호가 나왔어요.")
                  : bucket === "ok"
                    ? "네 방향으로 따져봐도 뚜렷한 잠식 신호가 없어요."
                    : "데이터가 부족하거나 채널끼리 지출이 겹쳐(공선) 판정하기 어려워요.";
                const voteView = (v) => v === "FOR" ? { t: "괜찮음", c: "#22c55e" } : v === "AGAINST" ? { t: "잠식 신호", c: "#f87171" } : { t: "판단 보류", c: MUTED };
                const signal = (num, q, help, v, tech) => {
                  const vv = voteView(v);
                  return (
                    <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "10px", padding: "12px 14px" }}>
                      <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-1)", lineHeight: 1.4, minHeight: "34px" }}>{num} {q}</div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: vv.c, margin: "8px 0 4px" }}>{vv.t}</div>
                      <div style={{ fontSize: "11px", color: MUTED, lineHeight: 1.5 }}>{help}</div>
                      <div style={{ fontSize: "10px", color: MUTED, marginTop: "6px", opacity: 0.8 }} title="통계 원값(전문가용)">{tech}</div>
                    </div>
                  );
                };
                return (
                  <section className="block" id="s-cannib-detail">
                    <h2 className="section-title">이 채널은 왜 이렇게 판정됐나? — {chLabel}</h2>
                    <Card style={{ marginBottom: "12px", display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
                      <Badge tone={headTone}>{headBadge}</Badge>
                      <div style={{ flex: 1, minWidth: "220px" }}>
                        <div style={{ fontSize: "13px", color: "var(--text-1)", lineHeight: 1.6 }}>{headWhy}</div>
                        <div style={{ fontSize: "11px", color: MUTED, marginTop: "4px" }}>아래 4가지를 각각 따져본 결과예요 · 괜찮음 {nFor} / 잠식 신호 {nAg} / 판단 보류 {nAb} · 확정은 holdout 실험(5-4)에서만.</div>
                      </div>
                    </Card>
                    {gate.blocked && (
                      <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: "8px", padding: "9px 12px", fontSize: "11.5px", color: "var(--text-1)", marginBottom: "10px" }}>
                        ⓘ 데이터가 적거나 지출 변동이 작아 ③을 신뢰하기 어려워요 — 이럴 땐 &quot;문제 없음&quot;으로 단정하지 않고 보류합니다.
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "10px" }}>
                      {signal("①", "광고를 늘리기 전에 오가닉이 이미 줄고 있었나?", "이미 줄고 있었다면 하락은 광고 탓이 아닐 수 있어요.", p.vote, `저지출 구간 기울기 ${p.kpi_slope_per_wk}/주 (p=${p.slope_p}) · 누적 ${p.kpi_change_over_window_pct}%`)}
                      {signal("②", "시즌·추세를 걷어내도 광고 늘 때 오가닉이 줄어드나?", "걷어내도 반대로 움직이면 잠식 의심.", d.vote, `탈추세 상관 ${d.detrended} · 1차차분 ${d.first_diff} (원상관 ${d.raw})`)}
                      {signal("③", "광고를 늘리면 (잠식 빼고도) 전체 성과가 순증가하나?", "순증가면 방어 양호.", ni.vote, `순증분 탄력성 ${isFinite(ni.net_elasticity) ? ni.net_elasticity : "—"} · p=${isFinite(ni.p) ? ni.p : "—"}${ni.ci_lo != null ? ` · CI[${ni.ci_lo}, ${ni.ci_hi}]` : ""}`)}
                    </div>
                    {/* ④ 그랜저 — 시차 (①~③은 같은 주만 봄) */}
                    <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: "10px", padding: "12px 14px", marginTop: "10px" }}>
                      <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-1)" }}>④ 광고비가 몇 주 뒤에 오가닉을 끌어내리나? <span style={{ color: MUTED, fontWeight: 400 }}>(①~③은 같은 주만 봐요 · 이건 시차 효과)</span></div>
                      {g ? (
                        <>
                          <div style={{ fontSize: "15px", fontWeight: 700, margin: "8px 0 4px", color: cn.granger_cannibal ? "#f87171" : cn.granger_help ? "#22c55e" : MUTED }}>
                            {cn.granger_cannibal ? "몇 주 뒤 끌어내리는 신호 있음" : cn.granger_help ? "몇 주 뒤 밀어올리는 신호" : "시차 신호 없음"}
                          </div>
                          <div style={{ fontSize: "11px", color: MUTED, lineHeight: 1.5 }}>
                            {cn.granger_cannibal ? "광고비 과거값이 오가닉의 이후 하락을 설명 → 잠식 의심으로 반영." : cn.granger_help ? "광고비 과거값이 오가닉의 이후 상승을 설명." : "광고비가 이후 오가닉 변화를 설명하지 못함."}
                            {cn.pacing ? " · ↩ 오가닉이 약할 때 예산을 올린 흔적(페이싱)이 있어, 음의 관계를 잠식으로 단정하긴 어려워요." : ""}
                          </div>
                          <div style={{ fontSize: "10px", color: MUTED, marginTop: "6px", opacity: 0.8 }} title="Granger F-검정(전문가용)">시차 {g.spend_to_organic.lag}주 · F={g.spend_to_organic.F} · p={g.spend_to_organic.p}</div>
                        </>
                      ) : (
                        <div style={{ fontSize: "11px", color: MUTED, marginTop: "6px" }}>데이터가 부족해 시차 분석은 생략했어요.</div>
                      )}
                    </div>
                    {/* ⑤ IRF */}
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-1)" }}>지출을 한 번 늘리면, 이후 몇 주간 {mmm.target === "Regs" ? "가입" : "성과"}이(가) 어떻게 반응하나</div>
                      <div style={{ fontSize: "11px", color: MUTED, margin: "2px 0 4px" }}>아래로 내려가면 시차 잠식, 위로 올라가면 시차 증분. <span title="충격반응함수(Impulse Response)">(전문: 임펄스 응답)</span></div>
                      <div className="chart-container" style={{ height: "200px" }}><canvas ref={irfRef}></canvas></div>
                    </div>
                  </section>
                );
              })()}

              {/* ── 통계 근거·방법론 전부 여기로 격리(기본 접힘) — 비전문 유저는 위 칸반·평어만 보면 됨 ── */}
              <details className="block" style={{ marginBottom: "14px" }} onToggle={onAccordionToggle}>
                <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "var(--primary, #adc6ff)", padding: "4px 0" }}>
                  카니발이 뭐고, 이 판정은 어떻게 나온 건가요? — 추세·데이터 위생·단순모델 점검 (통계 상세)
                </summary>
                <div style={{ marginTop: "12px" }}>
                  <p className="muted" style={{ fontSize: "12px", lineHeight: 1.7, marginBottom: "10px" }}>
                    <strong>카니발리제이션(잠식)</strong>이란 유료 광고가 원래 공짜로 들어올 오가닉 유입을 빼앗는 현상입니다. 이 도구는 4가지 독립 신호(①시간 선행성 ②탈추세·차분 상관 ③순증분 탄력성 ④그랜저 인과)를 투표로 종합해 채널별로 판정합니다. 관측 검정은 용의자를 좁힐 뿐이며, 확정은 홀드아웃 실험(5-4)에서만 가능합니다.
                  </p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
                    <button className="ab-pill" title="채널 × 3-state 투표 + 게이트·탄력성·커버리지·그랜저 → CSV"
                      onClick={() => cannib && csvDownload(`mmm_cannib_${mmm.target}_${_today()}.csv`, buildCannibCsv(cannib, mmm.effects, mmm.target))}>
                      ⬇ 채널별 카니발 CSV
                    </button>
                    <button className="ab-pill" title="주별 타깃·채널별 ln(1+지출)·탈추세 잔차·1차차분 원자료"
                      onClick={() => csvDownload(`mmm_cannib_series_${mmm.target}_${_today()}.csv`, buildCannibSeriesCsv(mmm.panel, mmm.target))}>
                      ⬇ 검정 원자료 CSV
                    </button>
                  </div>

              <section className="block" id="s-trend">
                <h2 className="section-title">성과에 광고와 무관한 &apos;추세&apos;가 있나요?</h2>
                <p className="muted" style={{ fontSize: "12px", marginBottom: "8px" }}>시간이 흐르며 성과가 저절로 오르내리는 흐름(추세)이 있는지 봐요. 추세가 크면, 광고 효과와 헷갈리지 않게 따로 떼어내야 해요.</p>
                {trend ? (
                  <>
                    {(() => {
                      const isNo = trend.verdict.startsWith("NO");
                      const isYes = trend.verdict.startsWith("trend EXISTS");
                      const plain = isNo
                        ? "뚜렷한 추세는 없어요 — 성과 등락은 대부분 광고·계절 영향입니다."
                        : isYes
                          ? "추세가 있어요 — 광고를 걷어내도 시간 흐름 자체의 상승/하락이 남습니다."
                          : "추세가 조금 있지만 광고·계절과 얽혀 있어요.";
                      return (
                        <div className={`callout ${isNo ? "ok" : "warn"}`}>
                          <div className="ico">{isNo ? "✓" : "!"}</div>
                          <div className="body">
                            <strong>{plain}</strong>
                            <p style={{ fontSize: "11px", color: MUTED, marginTop: "4px" }} title={trend.verdict}>전 구간 추세 변화 {trend.stl_pct}% · 판정 근거: {trend.verdict}</p>
                          </div>
                        </div>
                      );
                    })()}
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
                <h2 className="section-title">데이터가 분석하기에 깨끗한가요?</h2>
                <p className="muted" style={{ fontSize: "12px" }}>
                  분석 전에 데이터에 빠진 주·이상한 값이 없는지 점검하고, 작년 대비 지출·성과가 얼마나 변했는지(가장 단순하고 확실한 비교)를 봐요.
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
                    <h2 className="section-title">&apos;대충 뭉친 모델&apos;은 왜 못 믿나요?</h2>
                    <p className="muted" style={{ fontSize: "12px" }}>
                      모든 채널 지출을 <strong>하나로 뭉쳐 대충 만든 모델</strong>이 흔히 빠지는 함정(자기상관을 무시해 과신하거나, 채널끼리 겹쳐 계수가 출렁이는 것)을 보여줘요 — 그래서 채널을 나누고 광고 잔효·수확체감을 반영한 제대로 된 MMM(② 기여 분해)이 필요합니다.
                    </p>
                    <p style={{ fontSize: "11px", color: MUTED, marginTop: "2px" }}>
                      target=RR · n={a.n} · R²={f(a.r2, 4)} · adjR²={f(a.adj_r2, 4)} · HAC maxlags={a.hac_maxlags}
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
                </div>
              </details>

              {/* ── 맨 밑: 전 과정 상세 설명 문서 다운로드 ── */}
              <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
                <button className="ab-button"
                  onClick={() => textDownload(`카니발_진단_설명_${mmm.target}_${_today()}.md`, buildCannibGuideDoc(cannib, mmm.target === "Regs" ? "가입" : mmm.target === "React" ? "재활성" : mmm.target))}>
                  📄 이 과정에 대한 자세한 설명이 듣고 싶으신가요? — 상세 문서 받기
                </button>
              </div>
            </>
          )}

          {/* ── STAGE ② MMM ── */}
          {stage === "mmm" && (() => {
            const shRows = (mmm.run.shapley?.rows || []).slice().sort((a, b) => b.r2_share - a.r2_share);
            const PLAIN_DRV = { Trend: "시간 추세", Seasonality: "시즌·계절", Holidays: "휴일·이벤트", "Regime(steps)": "구조 변화", Regime: "구조 변화", baseline: "기본값" };
            const plainDrv = (nm) => PLAIN_DRV[nm] || nm;
            const isMediaDrv = (nm) => !MMM_NONMEDIA_GROUPS.includes(nm) && nm !== "baseline";
            const tgtKo = mmm.target === "Regs" ? "가입" : mmm.target === "React" ? "재활성" : mmm.target;
            const topDrv = shRows[0];
            const topMedia = shRows.find((r) => isMediaDrv(r.driver));
            const headline = shRows.length
              ? `${tgtKo} 성과를 움직인 건 대부분 ${plainDrv(topDrv.driver)}(${(topDrv.pct || 0).toFixed(0)}%)였고${topMedia ? `, 광고 중엔 ${topMedia.driver}가 가장 컸어요` : "예요"}.`
              : "기여 분해 결과를 계산할 수 없어요.";
            const maxPct = Math.max(0.0001, ...shRows.map((r) => r.pct || 0));
            const barColor = (nm) => isMediaDrv(nm) ? "#7F77DD" : nm === "Seasonality" ? "#5DCAA5" : nm === "baseline" ? "var(--border-strong)" : "#85B7EB";
            const sat = mmm.run.saturationByChannel || {};
            const ranked = Object.values(sat)
              .map((s) => ({ ...s, curMarg: (s.ln_coef / (1 + (s.recentMean || 0))) * 1000 }))
              .filter((s) => s.ln_coef > 0 && s.curMarg > 0)
              .sort((a, b) => b.curMarg - a.curMarg);
            // 음(−) 기여 알림 — 어떤 버킷이 특정 주에 성과를 크게 끌어내렸나. baseline(기본 수요)은 상수라 제외.
            const negAlert = (() => {
              if (!decomp || !decomp.weeks?.length) return null;
              let worst = null;
              decomp.weeks.forEach((w, i) => {
                const byB = {};
                decomp.groupNames.forEach((g) => { const b = decompBucketOf(g); byB[b] = (byB[b] || 0) + (w.contrib[g] || 0); });
                Object.entries(byB).forEach(([b, v]) => { if (v < 0 && (!worst || v < worst.val)) worst = { bucket: b, val: v, i }; });
              });
              const thr = -0.08 * Math.abs(decomp.baseline || 1);
              if (!worst || worst.val > thr) return null;
              const w = decomp.weeks[worst.i];
              let domG = null, domV = 0;
              decomp.groupNames.forEach((g) => { if (decompBucketOf(g) !== worst.bucket) return; const v = w.contrib[g] || 0; if (v < domV) { domV = v; domG = g; } });
              return { ...worst, domG, domV, lbl: mmm.panel.weekLabel?.[worst.i] || `주차 ${worst.i + 1}`, bLabel: MMM_BUCKET_META[worst.bucket]?.label || worst.bucket };
            })();
            return (
            <>
              {/* ── 메인: 평어 헤드라인 ── */}
              <Card style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <Badge color="#7aa2f7">기여 분해</Badge>
                <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text-1)" }}>{headline}</span>
              </Card>

              {/* ── 메인: 무엇이 성과를 움직였나 — 드라이버 기여 바 (Shapley %) ── */}
              <section className="block">
                <h2 className="section-title">무엇이 성과를 움직였나 <span style={{ fontSize: "12px", color: MUTED, fontWeight: 400 }}>· 설명력 비중</span></h2>
                {shRows.length ? (
                  // 단일 grid — 라벨 열 폭을 전 행 공유(max-content)해 가장 긴 변수명에 맞춰 정렬, 막대 시작점 일치.
                  <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr 44px", alignItems: "center", columnGap: "10px", rowGap: "8px", marginTop: "6px" }}>
                    {shRows.map((r) => (
                      <React.Fragment key={r.driver}>
                        <span style={{ fontSize: "12.5px", textAlign: "left", color: "var(--text-1)", whiteSpace: "nowrap" }} title={r.driver}>{plainDrv(r.driver)}</span>
                        <div style={{ background: "var(--bg-1)", borderRadius: "6px", height: "20px", minWidth: 0 }}>
                          <div style={{ width: `${Math.round((r.pct || 0) / maxPct * 100)}%`, minWidth: "2px", background: barColor(r.driver), height: "100%", borderRadius: "6px" }}></div>
                        </div>
                        <span style={{ fontSize: "12.5px", fontWeight: 600, textAlign: "right" }}>{(r.pct || 0).toFixed(0)}%</span>
                      </React.Fragment>
                    ))}
                  </div>
                ) : <p className="muted" style={{ fontSize: "12px" }}>계산할 수 없어요.</p>}
                <p className="muted" style={{ fontSize: "11px", marginTop: "8px" }}>지난 성과의 등락을 무엇이 얼마나 설명하는지 나눠본 결과예요. 진한 보라 = 광고 채널. <span title="Shapley R² 분해 — 모든 투입 순서를 평균낸 공정 배분, 합=전체 R²">(전문: Shapley R² 분해)</span></p>
              </section>

              {/* ── 메인: 다음 예산은 여기로 (액션 카드) ── */}
              {ranked.length > 0 && (
                <section className="block" style={{ border: "2px solid var(--primary, #adc6ff)" }}>
                  <h2 className="section-title">🎯 다음 예산은 여기로 <span style={{ fontSize: "12px", color: MUTED, fontWeight: 400 }}>· 지금 지출에서 +$1,000당 늘어나는 {tgtKo}</span></h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {ranked.map((s, i) => (
                      <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: i === 0 ? "rgba(122,162,247,0.1)" : "transparent", borderRadius: "8px" }}>
                        <span style={{ fontSize: "15px", fontWeight: 700, color: i === 0 ? "#7aa2f7" : MUTED, minWidth: "20px" }}>{i + 1}</span>
                        <span style={{ flex: 1, fontSize: "14px", fontWeight: i === 0 ? 700 : 400 }}>{s.label}</span>
                        <span style={{ fontSize: "14px", fontWeight: 600, color: "#22c55e" }}>+{s.curMarg.toFixed(0)}명</span>
                        <span style={{ fontSize: "12px", color: MUTED }}>현 ${((s.recentMean || 0) / 1000).toFixed(1)}k/주</span>
                      </div>
                    ))}
                  </div>
                  <p className="muted" style={{ fontSize: "11px", marginTop: "8px" }}>많이 쓸수록 1달러당 효과는 줄어요(수확체감). 관측 회귀 기반 가설 — 단기 캠페인 배분은 예산 배분 도구(5-3)에서. 음(−)의 효율 채널은 노이즈라 제외했어요.</p>
                </section>
              )}

              {/* ── 아코디언 A: 실제 vs 모델 (fit + 드라이버 분해 + 튀는 주) ── */}
              <details className="block" onToggle={onAccordionToggle}>
                <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "var(--primary, #adc6ff)", padding: "4px 0" }}>실제 성과와 모델이 얼마나 맞나? — 실제 vs 모델 그래프 · 드라이버 분해 · 튀는 주</summary>
                <div style={{ marginTop: "12px" }}>
                  <div className="ab-pillgroup" style={{ marginBottom: "10px" }}>
                    <span className="ab-pillgroup-label">모델</span>
                    <button className={`ab-pill ${decompModel === "ols" ? "active" : ""}`} onClick={() => setDecompModel("ols")}>OLS(중심화)</button>
                    <button className={`ab-pill ${decompModel === "ridge" ? "active" : ""}`} onClick={() => setDecompModel("ridge")}>Ridge(절대)</button>
                  </div>
                  {decomp ? (
                    <>
                      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "10px" }}>
                        <div className="stat-card"><div className="lbl">평균 오차(RMSE)</div><div className="val">±{decomp.rmse}명</div></div>
                        <div className="stat-card"><div className="lbl">평균 오차율(MAPE)</div><div className="val">{decomp.mape}%</div></div>
                        <div className="stat-card"><div className="lbl">전체 기간 평균</div><div className="val">{fmtInt(decomp.baseline)}</div></div>
                      </div>
                      <p className="muted" style={{ fontSize: "11px", marginBottom: "6px" }}>실제(회색)와 모델(파랑)이 가까울수록 잘 맞은 거예요. 점선(시즌·추세 등)은 광고와 무관한 부분만 뽑아낸 흐름이라 시간에 따라 움직여요 — &quot;전체 기간 평균&quot;(고정값)과는 다른 선입니다.</p>
                      <div className="chart-container" style={{ height: "240px", marginBottom: "12px" }}><canvas ref={fitRef}></canvas></div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "6px" }}>
                        <h3 className="section-title" style={{ fontSize: "13.5px", margin: 0 }}>매주 성과는 무엇으로 이뤄졌나 <span style={{ fontSize: "11px", color: MUTED, fontWeight: 400 }}>· 막대는 0을 기준으로 위/아래로 쌓은 값</span></h3>
                        <div className="ab-pillgroup">
                          <button className={`ab-pill ${decompGrouped ? "active" : ""}`} onClick={() => setDecompGrouped(true)}>그룹으로 보기</button>
                          <button className={`ab-pill ${!decompGrouped ? "active" : ""}`} onClick={() => setDecompGrouped(false)}>광고 채널 펼치기</button>
                        </div>
                      </div>
                      <p className="muted" style={{ fontSize: "11px", marginBottom: "6px", lineHeight: 1.5 }}>
                        막대는 <b style={{ color: MMM_BUCKET_META.base.tone }}>기본 수요</b>(계절 포함) · <b style={{ color: MMM_BUCKET_META.trend.tone }}>장기 추세</b> · <b style={{ color: MMM_BUCKET_META.event.tone }}>이벤트·구조변화</b> · <b style={{ color: MMM_BUCKET_META.media.tone }}>광고 효과</b>를 한 막대에 쌓은 값이에요.
                        어떤 항목이 그 주에 마이너스면 <b>막대가 0 아래로 내려가</b> 바로 보여요(예: 광고 효과가 노이즈로 마이너스). 막대 합과 <b>실제</b>(점선)가 가까울수록 모델이 잘 맞은 거예요.
                      </p>
                      {negAlert && (
                        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "9px 12px", marginBottom: "8px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.4)", borderRadius: "8px" }}>
                          <span style={{ fontSize: "15px" }}>⚠️</span>
                          <span style={{ fontSize: "12px", color: "var(--text-1)", lineHeight: 1.5 }}>
                            <b>{String(negAlert.lbl)}</b> 주에 <b style={{ color: MMM_BUCKET_META[negAlert.bucket]?.tone }}>{negAlert.bLabel}</b>가 성과를 크게 끌어내렸어요 (약 {fmtInt(negAlert.val)}명).
                            {negAlert.domG && negAlert.domV < 0 ? <> 주 원인은 <b>{plainDrv(negAlert.domG)}</b>({fmtInt(negAlert.domV)}명)예요.</> : null}
                            {negAlert.bucket === "media" ? " 광고가 오히려 마이너스로 잡히면 노이즈·공선일 수 있으니 아래 상세를 확인하세요." : ""}
                          </span>
                        </div>
                      )}
                      <div className="chart-container" style={{ height: "440px", minHeight: "440px" }}><canvas ref={decompRef}></canvas></div>
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
                      {decomp.spikes && decomp.spikes.length > 0 && (
                        <>
                          <h3 className="section-title" style={{ fontSize: "13.5px", marginTop: "16px" }}>🔎 튀는 구간 <span style={{ fontSize: "11px", color: MUTED, fontWeight: 400 }}>· 평소와 다르게 크게 벗어난 주 (메모 남기면 위 그래프에 번호로 표시)</span></h3>
                          <div className="table-wrap">
                            <table className="data" style={{ fontSize: "11.5px" }}>
                              <thead><tr><th>기간</th><th>기준선 대비</th><th>자동 진단</th><th>메모 (원인 기록)</th></tr></thead>
                              <tbody>
                                {decomp.spikes.map((s) => {
                                  const lbl = mmm.panel.weekLabel && s.i != null ? mmm.panel.weekLabel[s.i] : null;
                                  const noteKey = `${mmm.target}|${s.week}`;
                                  const noteNum = decomp.spikes.filter((n) => (spikeNotes[`${mmm.target}|${n.week}`] || "").trim()).findIndex((n) => n.week === s.week) + 1;
                                  const clsLabel = s.cls === "channel"
                                    ? { txt: "채널 스파크", color: "#7aa2f7" }
                                    : s.cls === "baseline"
                                      ? { txt: "기준선·계절 변동", color: "#22c55e" }
                                      : { txt: "모델 밖(원인 입력 권장)", color: "#fbbf24" };
                                  const driverTxt = s.cls === "unexplained"
                                    ? `잔차 ${s.residual >= 0 ? "+" : ""}${s.residual.toLocaleString()}명`
                                    : `${s.domDriver} ${s.domVal >= 0 ? "+" : ""}${s.domVal.toLocaleString()}명`;
                                  return (
                                    <tr key={s.week}>
                                      <td>
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                          {noteNum > 0 && <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "16px", height: "16px", borderRadius: "50%", background: "#f59e0b", color: "#fff", fontSize: "9px", fontWeight: 700, flexShrink: 0 }}>{noteNum}</span>}
                                          <b style={{ fontSize: "12px" }}>{lbl != null ? String(lbl) : `주차 ${mmm.panel.week?.[s.i] ?? (s.i != null ? s.i + 1 : s.week)}`}</b>
                                        </span>
                                        {lbl != null && <span style={{ fontSize: "9px", color: MUTED, display: "block" }}>주차 {mmm.panel.week?.[s.i] ?? (s.i != null ? s.i + 1 : s.week)}</span>}
                                      </td>
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
                </div>
              </details>

              {/* ── 아코디언 B: 이 숫자들은 어떻게 나왔나요? (adstock CV·탄력성·VIF·Shapley·수확체감·채널효과) ── */}
              <details className="block" onToggle={onAccordionToggle}>
                <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "var(--primary, #adc6ff)", padding: "4px 0" }}>이 숫자들은 어떻게 나왔나요? — 계산 과정 자세히 보기</summary>
                <div style={{ marginTop: "12px" }}>
                  <StatHead title="① 광고 여운 강도 정하기" hint="광고는 집행 후에도 며칠~몇 주 효과가 남아요(여운). 과거에 안 본 기간에 맞춰보며 여운 길이를 골랐어요 — 아래 그래프에서 오차가 가장 낮은 지점이 선택된 값이에요." />
                  <div className="alloc-card" style={{ marginBottom: "8px" }}>
                    <p style={{ fontSize: "12px", color: MUTED, margin: 0, lineHeight: 1.55 }}>
                      선택된 <strong>여운 강도 λ={mmm.run.best_lambda}</strong>
                      {mmm.run.collinear_pairs?.length ? ` · 서로 너무 비슷하게 움직인 채널쌍: ${mmm.run.collinear_pairs.map((p) => `${p.a}~${p.b}(${p.corr})`).join(", ")} (효과를 따로 떼기 어려워요)` : " · 서로 겹치는 채널: 없음"}
                    </p>
                  </div>
                  <div className="chart-container" style={{ height: "200px", marginBottom: "12px" }}><canvas ref={cvRef}></canvas></div>
                  <StatHead title="② 채널별 영향력과 겹침" hint="왼쪽 = 지출을 1% 늘릴 때 성과가 몇 % 움직이나(영향력). CI에 0이 안 걸리면 통계적으로 확실. 오른쪽 = 채널끼리 너무 비슷하게 움직여 효과를 나누기 어려운 정도(겹침)." />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                    <div>
                      <p style={{ fontSize: "12px", margin: "0 0 4px" }}>채널별 영향력 <span style={{ color: MUTED, fontSize: "11px" }}>(탄력성 — 지출 1%↑당 성과 %↑)</span></p>
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
                      <p style={{ fontSize: "12px", margin: "0 0 4px" }}>채널 간 겹침 <span style={{ color: MUTED, fontSize: "11px" }}>(VIF &gt;{mmm.cfg.vifThreshold}=겹침 큼)</span></p>
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
                  <StatHead title="③ 무엇이 성과를 설명했나" hint={`지난 성과의 등락(변동)을 각 항목이 몇 %씩 설명하는지 공정하게 나눈 몫이에요(합 = 전체 설명력 R²=${mmm.run.shapley?.total ?? "—"}).`} />
                  <div className="chart-container" style={{ height: "200px", marginBottom: "8px" }}><canvas ref={shapleyRef}></canvas></div>
                  <StatHead title="④ 수확체감 — 더 쓰면 효과가 얼마나 꺾이나" hint="곡선이 평평해질수록 1달러당 효과가 줄어요(수확체감). ● = 지금 지출 위치. 이미 꺾인 뒤에 있으면 증액 효율이 낮다는 뜻. 점선 = 음수(노이즈)." />
                  {/* 커스텀 채널 토글 범례 — 클릭으로 곡선+현재지출점 함께 표시/숨김(§유저: 켠 채널 점만) */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                    {Object.entries(mmm.run.saturationByChannel || {}).map(([key, s], i) => {
                      const col = MMM_MEDIA_PALETTE[i % MMM_MEDIA_PALETTE.length];
                      const off = !!satHidden[key];
                      return (
                        <button key={key} onClick={() => setSatHidden((h) => ({ ...h, [key]: !h[key] }))}
                          style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 9px", borderRadius: "6px", border: "1px solid var(--border)", background: off ? "transparent" : "var(--bg-1)", color: off ? MUTED : "var(--text-1)", fontSize: "10.5px", cursor: "pointer", opacity: off ? 0.5 : 1, textDecoration: off ? "line-through" : "none" }}>
                          <span style={{ width: "9px", height: "9px", borderRadius: "2px", background: s.ln_coef < 0 ? "transparent" : col, outline: s.ln_coef < 0 ? `1px dashed ${col}` : "none", display: "inline-block" }}></span>
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                  <div>
                    <div className="chart-container" style={{ height: "340px", minHeight: "340px", marginBottom: "12px" }}><canvas ref={satRef}></canvas></div>
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
                        <strong>&quot;+$1k당 N명&quot;</strong> = 그 지출 수준에서 1,000달러 더 쓸 때 늘어나는 결과(지출↑일수록 작아짐). <strong>음수 채널은 노이즈</strong>. 절대 인원은 holdout, 효율(CPR)은 비용 대비 따로.
                      </p>
                    </div>
                  </div>
                  {/* 채널별 탄력성·판정 요약 표 */}
                  <p style={{ fontSize: "12px", margin: "14px 0 4px" }}>채널별 효과 요약</p>
                  <div className="table-wrap">
                    <table className="data" style={{ fontSize: "11.5px" }}>
                      <thead><tr><th>채널</th><th title="지출 +10% 시 결과 탄력성">지출 +10%</th><th>+$1,000당</th><th>판정</th><th>신뢰도</th></tr></thead>
                      <tbody>
                        {mmm.effects.map((e) => {
                          const vm = VERDICT_META[e.verdict] || VERDICT_META.uncertain;
                          return (
                            <tr key={e.key} style={e.sparse ? { opacity: 0.55 } : undefined}>
                              <td><strong>{e.label}</strong></td>
                              <td className="tnum" style={{ color: e.elas >= 0 ? NEG : POS }}>{e.elas >= 0 ? "+" : ""}{(e.elas * 10).toFixed(1)}%</td>
                              <td className="tnum">{e.weeklyPer1k == null ? "—" : Math.round(e.weeklyPer1k).toLocaleString() + "명"}</td>
                              <td style={{ color: vm.color, fontWeight: 600 }}>{vm.txt}</td>
                              <td style={{ letterSpacing: "1px" }}>{pDots(e.p)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>

              {/* ── 맨 밑: 상세 설명 문서 다운로드 ── */}
              <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
                <button className="ab-button"
                  onClick={() => textDownload(`MMM_기여분해_설명_${mmm.target}_${_today()}.md`, buildMmmGuideDoc(mmm, tgtKo))}>
                  📄 이 과정에 대한 자세한 설명이 듣고 싶으신가요? — 상세 문서 받기
                </button>
              </div>
            </>
            );
          })()}

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
