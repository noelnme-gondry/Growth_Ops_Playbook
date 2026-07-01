/* ============================================================
 * statPrimitives — 저수준 수치 프리미티브 (gamma/beta/erf/정규/Student-t/chi2)
 *   index.html의 MMR_MATH/MMM_STATS 통계 엔진에서 verbatim 추출.
 *   regMath<->mmmMath 순환 참조를 끊기 위해 별도 모듈로 분리.
 *   순수 함수·결정론(Math.random 없음)·외부 의존 0.
 * ============================================================ */

/* lgamma (Lanczos) — chi2 CDF용 */
export function _lgamma(z) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - _lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (z + 0.5) * Math.log(t) -
    t +
    Math.log(x)
  );
}
/* 정규화 하부 불완전 감마 P(a,x) — 급수 + 연분수 */
export function _gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a,
      sum = 1 / a,
      del = 1 / a;
    for (let n = 0; n < 300; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - _lgamma(a));
  } else {
    // Lentz 연분수로 Q(a,x), P=1-Q
    let b = x + 1 - a,
      c = 1e300,
      d = 1 / b,
      h = d;
    for (let i = 1; i < 300; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c;
      if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    const Q = Math.exp(-x + a * Math.log(x) - _lgamma(a)) * h;
    return 1 - Q;
  }
}
export function chi2Cdf(x, k) {
  return x <= 0 ? 0 : _gammaP(k / 2, x / 2);
}

/* --- 고정밀 정규/Student-t (scipy 매칭용) --- */
export function _mmmErf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
export function mmmNormCdf(z) {
  return 0.5 * (1 + _mmmErf(z / Math.SQRT2));
}
export const _Z975 = 1.959963984540054;
export function _betacf(a, b, x) {
  const MAXIT = 200,
    EPS = 3e-14,
    FPMIN = 1e-300;
  let qab = a + b,
    qap = a + 1,
    qam = a - 1,
    c = 1,
    d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
export function _betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    _lgamma(a + b) -
      _lgamma(a) -
      _lgamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (bt * _betacf(a, b, x)) / a
    : 1 - (bt * _betacf(b, a, 1 - x)) / b;
}
// 양측 p (Student-t): P(|T|>|t|)
export function studentTp(t, df) {
  if (!isFinite(t)) return 0;
  return _betai(df / 2, 0.5, df / (df + t * t));
}
// t 임계값 (양측 conf): studentT.ppf(1-(1-conf)/2). 이분법.
export function studentTcrit(conf, df) {
  const target = 1 - conf; // 양측 p
  let lo = 0,
    hi = 100;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    studentTp(mid, df) > target ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}
