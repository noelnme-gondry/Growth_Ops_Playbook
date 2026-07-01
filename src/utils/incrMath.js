// 5-4 AbTestReadoutIncr — 순수 수학 유틸 (index.html 원본 verbatim 이식)
// - INCR_MATH.compute: 홀드아웃 증분(counterfactual·lift·iROAS)
// - parseHoldoutGroup: test/control 그룹 표기 정규화
// - READOUT_CONFIG / parseControl / computeMetricVerdict: Test Readout verdict 로직
// 결정론(no Math.random). index.html이 SSOT — 값·분기 verbatim.

export const INCR_MATH = {
  // test/control 집계 → 증분 지표
  // test:{num,den,spend,rev}, control:{num,den}
  compute(test, control) {
    const tRate = test.den > 0 ? test.num / test.den : null;
    const cRate = control.den > 0 ? control.num / control.den : null;
    if (tRate == null || cRate == null) return null;
    // 반사실(counterfactual): 광고 없었으면 test 그룹도 control 전환율
    const expected = test.den * cRate;
    const incrementalConv = test.num - expected; // 증분 전환
    const liftAbs = tRate - cRate;
    const liftRel = cRate > 0 ? (tRate - cRate) / cRate : null;
    // 증분 매출: test 전환당 매출 가정 → 증분 전환 × (rev/conv)
    const revPerConv =
      test.rev != null && test.num > 0 ? test.rev / test.num : null;
    const incrementalRev =
      revPerConv != null ? incrementalConv * revPerConv : null;
    const iroas =
      incrementalRev != null && test.spend > 0
        ? incrementalRev / test.spend
        : null;
    const cpia =
      test.spend > 0 && incrementalConv > 0
        ? test.spend / incrementalConv
        : null; // 증분 전환당 비용
    return {
      tRate,
      cRate,
      expected,
      incrementalConv,
      liftAbs,
      liftRel,
      incrementalRev,
      iroas,
      cpia,
    };
  },
};

export function parseHoldoutGroup(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (
    s.includes("control") ||
    s.includes("holdout") ||
    s.includes("hold") ||
    s === "0" ||
    s.includes("off") ||
    s.includes("대조") ||
    s.includes("홀드")
  )
    return "control";
  if (
    s.includes("test") ||
    s.includes("exposed") ||
    s.includes("treat") ||
    s === "1" ||
    s.includes("on") ||
    s.includes("노출")
  )
    return "test";
  return null;
}

export const READOUT_CONFIG = {
  version: "1.0.0",
  alpha: 0.05,
  promoteProb: 0.95,
  killProb: 0.05,
  // bayes는 CREATIVE_CONFIG.bayes 재사용 (priorA/priorB/gridN)
};

/* is_control 다양한 표기 해석 */
export function parseControl(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return (
    s === "true" ||
    s === "1" ||
    s === "control" ||
    s === "yes" ||
    s === "y" ||
    s === "t"
  );
}

export function computeMetricVerdict(freq, probBgtA) {
  const alpha = READOUT_CONFIG.alpha;
  const promoteP = READOUT_CONFIG.promoteProb;
  const killP = READOUT_CONFIG.killProb;
  const freqSig = freq.p < alpha;
  const freqPositive = freq.diff > 0;

  // Bayesian: probBgtA = P(variant > control)
  const bayesPromote = probBgtA >= promoteP;
  const bayesKill = probBgtA <= killP;

  if (freqSig && freqPositive && bayesPromote) return "promote";
  if (freqSig && !freqPositive && bayesKill) return "kill";
  if ((freqSig && freqPositive) !== bayesPromote) return "inconclusive"; // 두 방법 불일치
  if ((freqSig && !freqPositive) !== bayesKill) return "inconclusive";
  return "inconclusive";
}
