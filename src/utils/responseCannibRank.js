/* ============================================================================
 * responseCannibRank — 5-18 MarketingResponse §4.5 카니발 랭킹 페이지-레벨 헬퍼
 * index.html의 인라인 헬퍼(CANNIBAL_RANK / mmmBuildCannibRank / mmmCannibLevel /
 * mmmCannibAction / mmmGlobalCannib / mmmCannibConf) 충실 포트.
 * 수학 엔진(mmmCannibalization·mmmChannelCoverage·mmmOls·_mmmChans)은 재사용 —
 * 여기 함수는 그 결과를 크로스채널 랭킹·버킷·전역 종합으로 조립하는 순수 함수.
 * 결정론(§3): 난수 없음, 동일 입력 → 동일 출력.
 * ========================================================================== */
import { mmmOls } from "./regMath.js";
import { MMM_CANNIB_RULES, _mmmChans } from "./mmmMath.js";

// index RANK_CFG — 적격 게이트 + CEI 가중치
export const RANK_CFG = {
  MIN_ACTIVE: 12, // 적격: 비-0 지출 주 수 최소
  MIN_DF: 8, // 적격: 탈추세 회귀 후 잔차 자유도 최소
  MIN_SPEND_CV: 0.1, // 적격: 지출 변동(sd/mean) 최소
  ALPHA: 0.05,
  P_WEAK: 0.1,
  W: { detrend: 1, diff: 1, net: 1 }, // CEI 가중치
};

// index CANNIBAL_RANK 순수함수 모듈 (부호 규약: 음수=카니발 방향, relu(-z)로 유의 음만 가산)
export const CANNIBAL_RANK = (() => {
  const mean = (a) =>
    a.length ? a.reduce((s, v) => s + (isFinite(v) ? v : 0), 0) / a.length : 0;
  const std = (a) => {
    const m = mean(a),
      n = a.length;
    return n
      ? Math.sqrt(a.reduce((s, v) => s + (isFinite(v) ? (v - m) ** 2 : 0), 0) / n)
      : 0;
  };
  function spendCV(spend) {
    const m = mean(spend);
    return m > 0 ? std(spend) / m : 0;
  }
  // Pearson r → Fisher-z 검정통계량 (음수=카니발). |r|≥1·n<4면 0.
  function zFromR(r, n) {
    if (!isFinite(r) || Math.abs(r) >= 1 || n < 4) return 0;
    return Math.atanh(r) * Math.sqrt(n - 3);
  }
  // 표준정규 양측 p (Abramowitz-Stegun erfc 근사) — 결정론
  function twoSidedP(z) {
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const erf =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
        t +
        0.254829592) *
        t *
        Math.exp(-x * x);
    return Math.max(0, Math.min(1, 1 - erf));
  }
  const relu = (x) => Math.max(0, x);
  function eligibility(spend, nActive, cfg) {
    const cv = spendCV(spend),
      df = nActive - 2,
      reasons = [];
    if (nActive < cfg.MIN_ACTIVE) reasons.push(`집행주 ${nActive} < ${cfg.MIN_ACTIVE}`);
    if (cv < cfg.MIN_SPEND_CV)
      reasons.push(`지출 변동 CV ${cv.toFixed(2)} < ${cfg.MIN_SPEND_CV}`);
    if (df < cfg.MIN_DF) reasons.push(`자유도 ${df} < ${cfg.MIN_DF}`);
    return { eligible: reasons.length === 0, spendCV: +cv.toFixed(3), dfResid: df, reasons };
  }
  return { spendCV, zFromR, twoSidedP, relu, eligibility, RANK_CFG };
})();

// 유효 RANK_CFG (사용자 오버라이드 머지) — v2엔 MMM_METH_STATE.rankCfg 상태가 없어 기본만.
export function mmmRankCfg(override) {
  const o = override || {};
  return { ...RANK_CFG, ...o, W: { ...RANK_CFG.W, ...(o.W || {}) } };
}

// 채널별 카니발 랭킹 행 빌드 — cannibByChannel(검정 결과) + coverage 재사용, CEI/적격/배지 산출.
export function mmmBuildCannibRank(panel, target, cannibByChannel, cov, chans, cfgOverride) {
  const cfg = mmmRankCfg(cfgOverride),
    n = panel.week.length,
    zA = 1.96,
    zW = 1.645;
  const totalSpend =
    chans.reduce(
      (s, k) => s + (panel.ch[k] || []).reduce((a, v) => a + (v > 0 ? v : 0), 0),
      0,
    ) || 1;
  // 타깃 12주 holdout coarse MDE(% of target)
  let mde12 = null;
  const yT = panel.targets[target] || [];
  if (yT.length > 3) {
    const meanY = yT.reduce((a, v) => a + (isFinite(v) ? v : 0), 0) / yT.length;
    const trFit = mmmOls(
      yT.map((_, i) => [1, i]),
      yT,
    );
    const resid = trFit ? trFit.resid : yT.map((v) => v - meanY);
    const rm = resid.reduce((a, v) => a + v, 0) / resid.length;
    const sigmaResid = Math.sqrt(resid.reduce((a, v) => a + (v - rm) ** 2, 0) / resid.length);
    if (meanY > 0)
      mde12 = +(
        (Math.sqrt(((1.96 + 0.84) ** 2 * 2 * sigmaResid ** 2) / 12) / meanY) *
        100
      ).toFixed(1);
  }
  const rows = chans
    .map((k) => {
      const cn = cannibByChannel[k];
      if (!cn) return null;
      const spend = panel.ch[k] || [],
        cv = cov[k] || { nonzero: 0 };
      const nActive = cv.nonzero;
      const el = CANNIBAL_RANK.eligibility(spend, nActive, cfg);
      const gated = !!(cn.power_gate && cn.power_gate.blocked);
      const rDet = cn.detrend_corr.detrended,
        rDiff = cn.detrend_corr.first_diff;
      const z2 = CANNIBAL_RANK.zFromR(rDet, n),
        z2d = CANNIBAL_RANK.zFromR(rDiff, n - 1);
      const ni = cn.net_incrementality;
      let z3 = 0,
        netSe = null;
      if (!gated && ni.ci_lo != null && ni.ci_hi != null && isFinite(ni.net_elasticity)) {
        netSe = (ni.ci_hi - ni.ci_lo) / (2 * zA);
        if (netSe > 0) z3 = ni.net_elasticity / netSe;
      }
      const relu = CANNIBAL_RANK.relu;
      // CEI = 유의(|z|≥1.645) 방향만 가산 (relu). 노이즈는 0.
      const contrib = (z) => relu(-z - zW);
      const cei = +(
        cfg.W.detrend * contrib(z2) +
        cfg.W.diff * contrib(z2d) +
        cfg.W.net * contrib(z3)
      ).toFixed(3);
      const detP = +CANNIBAL_RANK.twoSidedP(z2).toFixed(4);
      const anyAgainst =
        cn.precedence.vote === "AGAINST" ||
        cn.detrend_corr.vote === "AGAINST" ||
        ni.vote === "AGAINST" ||
        cn.granger_cannibal;
      const cannibSignal = z2 < -zA || z2d < -zA || anyAgainst;
      const votes3 = [cn.detrend_corr.vote, cn.precedence.vote, ni.vote];
      const forCount = votes3.filter((v) => v === "FOR").length;
      const againstCount =
        votes3.filter((v) => v === "AGAINST").length + (cn.granger_cannibal ? 1 : 0);
      const abstainCount =
        votes3.filter((v) => v === "ABSTAIN" || !v).length +
        (!cn.granger_cannibal && !cn.granger_help ? 1 : 0);
      const leanNeg = rDet <= MMM_CANNIB_RULES.detrendFor;
      let badge;
      if (!el.eligible) badge = "판단불가";
      else if (z2 < -zA && !gated && !(z3 > zA)) badge = "강";
      else if (anyAgainst || (rDet < 0 && detP < cfg.P_WEAK)) badge = "중";
      else badge = "약";
      const spendShare = +(
        spend.reduce((a, v) => a + (v > 0 ? v : 0), 0) / totalSpend
      ).toFixed(4);
      return {
        key: k,
        label: (_mmmChans(panel).find((c) => c.key === k) || {}).label || k,
        eligible: el.eligible,
        nActive,
        total: n,
        spendCV: el.spendCV,
        dfResid: el.dfResid,
        reasons: el.reasons,
        gated,
        z2: +z2.toFixed(2),
        z2d: +z2d.toFixed(2),
        z3: +z3.toFixed(2),
        cei,
        detP,
        rDet,
        rDiff,
        netElast: ni.net_elasticity,
        netP: ni.p,
        netCiLo: ni.ci_lo,
        netCiHi: ni.ci_hi,
        netSe: netSe == null ? null : +netSe.toFixed(4),
        cannibSignal,
        badge,
        verdict_class: cn.verdict_class,
        spendShare,
        brand: cn.is_brand_intercept,
        flighted: !!cn.flighted,
        flightTrans: cn.flight_transitions,
        flightZeroFrac: cn.flight_zero_frac,
        forCount,
        againstCount,
        abstainCount,
        leanNeg,
      };
    })
    .filter(Boolean);
  // 정렬: 적격 우선 → CEI desc → spendShare desc → 이름. Tier2: 잠식신호 우선 → nActive desc.
  rows.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible) {
      if (b.cei !== a.cei) return b.cei - a.cei;
      if (b.spendShare !== a.spendShare) return b.spendShare - a.spendShare;
      return a.key < b.key ? -1 : 1;
    }
    if (a.cannibSignal !== b.cannibSignal) return a.cannibSignal ? -1 : 1;
    if (b.nActive !== a.nActive) return b.nActive - a.nActive;
    return a.key < b.key ? -1 : 1;
  });
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  rows.mde12 = mde12;
  return rows;
}

// 권고 짧은 라벨(표 셀) + 전체 문구(title 툴팁)
export function mmmCannibAction(r) {
  if (!r.eligible)
    return r.cannibSignal
      ? "⚠ 데이터 부족하지만 잠식 방향 신호 — 데이터 축적·holdout 고려"
      : "모니터 — 집행 확대/데이터 축적 후 재검";
  if (r.flighted)
    return "⚡ 산발 집행(on/off) — 시차·선행성 검정 신뢰도↓. 매칭 on/off 비교 또는 holdout으로만 확인";
  if (r.badge === "강") return "holdout 우선순위 높음";
  if (r.badge === "중") return "holdout 후보 (우선순위 중)";
  if (r.gated) return "공선으로 관측 식별 불가 — '안전' 단정 말고 holdout으로 확인";
  if (r.leanNeg) return "약한 음의 기미·검정력 부족 — 모니터 / holdout 고려";
  return "관측상 이상 無 (비공선·탈추세 무해) — deprioritize 가능";
}
export function mmmCannibActionShort(r) {
  if (!r.eligible) return r.cannibSignal ? "⚠ 데이터·holdout" : "모니터·데이터축적";
  if (r.flighted) return "⚡ holdout 확인";
  if (r.badge === "강") return "holdout 1순위";
  if (r.badge === "중") return "holdout 후보";
  if (r.gated) return "🔗 holdout 확인";
  if (r.leanNeg) return "모니터/holdout";
  return "deprioritize 가능";
}

// 5단계 판정 그라데이션 — L1 데이터없음 / L2 신호없음 / L3 거의없음 / L4 신호조금 / L5 카니발
export function mmmCannibLevel(r) {
  if (!r.eligible)
    return { lv: 1, label: "데이터 없음", short: "데이터없음", color: "#9CA3AF", sym: "⊘" };
  if (r.verdict_class === "cannibal" || r.againstCount >= 1 || r.cei > 0)
    return { lv: 5, label: "카니발", short: "카니발", color: "#f87171", sym: "●" };
  if (r.leanNeg)
    return { lv: 4, label: "못 가리지만 신호 조금", short: "신호 조금", color: "#fbbf24", sym: "◑" };
  if (r.verdict_class === "ok")
    return { lv: 2, label: "적색신호 없음", short: "신호 없음", color: "#22c55e", sym: "●" };
  return { lv: 3, label: "적색신호 없음에 가까움", short: "거의 없음", color: "#2dd4bf", sym: "◐" };
}

// 전역 카니발 verdict = 식별 가능한 채널들의 worst-case (cannibal > inconclusive > ok).
export function mmmGlobalCannib(cannibByChannel, identifiedKeys) {
  if (!identifiedKeys || !identifiedKeys.length) {
    return {
      verdict_class: "inconclusive",
      noIdentified: true,
      n_identified: 0,
      identified: [],
      cannibChannels: [],
      inconclusiveChannels: [],
      okChannels: [],
      decisive: 0,
    };
  }
  const items = identifiedKeys.map((k) => cannibByChannel[k]).filter(Boolean);
  const has = (cls) => items.some((x) => x.verdict_class === cls);
  const verdict_class = has("cannibal") ? "cannibal" : has("inconclusive") ? "inconclusive" : "ok";
  const cannibItems = items.filter((x) => x.verdict_class === "cannibal");
  const decisive = cannibItems.reduce((m, x) => Math.max(m, (x.votes || {}).AGAINST || 0), 0);
  return {
    verdict_class,
    noIdentified: false,
    n_identified: identifiedKeys.length,
    identified: identifiedKeys,
    cannibChannels: cannibItems.map((x) => x.channelLabel || x.channel),
    inconclusiveChannels: items
      .filter((x) => x.verdict_class === "inconclusive")
      .map((x) => x.channelLabel || x.channel),
    okChannels: items.filter((x) => x.verdict_class === "ok").map((x) => x.channelLabel || x.channel),
    decisive,
  };
}

// 신뢰도 레벨(1~4) — 관측상 잠식 판정 상한(무죄 증명 불가). index mmmCannibConf 포트.
export function mmmCannibConf(g) {
  if (!g || g.noIdentified) return 1;
  if (g.verdict_class === "inconclusive") return 2;
  if (g.verdict_class === "ok") return Math.min(3, 1 + (g.n_identified || 1));
  if (g.verdict_class === "cannibal") return (g.decisive || 0) >= 2 ? 4 : 3;
  return 2;
}

// 전역 카니발 평어(plain-text 버전; React에서 JSX가 escape 처리하므로 문자열만).
export function mmmGlobalCannibPlain(g, target) {
  if (!g || g.noIdentified)
    return `현재 매핑에서 식별 가능한 채널이 없습니다 — 모든 채널이 데이터 부족(sparse)·저커버리지·공선/검정력 부족이라 관측만으로 잠식 여부를 가릴 수 없습니다. ${target} 잠식 판정은 holdout 실험(5-15)이 필요합니다.`;
  if (g.verdict_class === "cannibal")
    return `식별 채널 ${g.cannibChannels.join(", ")}에서 오가닉 ${target} 잠식 우려가 잡힙니다. 한 채널이라도 적색신호면 전역도 보수적으로 "잠식 우려"입니다 — holdout(5-15) 1순위.`;
  if (g.verdict_class === "inconclusive")
    return `식별 가능한 채널(${g.n_identified}개) 중 적어도 하나가 판단 보류(INCONCLUSIVE)라, 전역도 "방어/OK"로 단정하지 않습니다${g.inconclusiveChannels.length ? ` (${g.inconclusiveChannels.join(", ")})` : ""}. 잠식인지 방어인지 관측만으론 못 가릅니다 — holdout(5-15) 필요.`;
  return `식별 가능한 채널(${g.n_identified}개: ${g.okChannels.join(", ")}) 모두에서 관측상 적색신호가 없습니다. 다만 관측은 "잠식 없음"을 증명하지 못합니다 — 방어 가능성이 높다는 정황일 뿐, 확정은 geo holdout(5-15)입니다.`;
}
