/* ============================================================
 * regMath — 회귀/MMM 공통 수학 엔진 (index.html faithful port)
 * mmmOls · REG_STATS · REG_TRANSFORMS · TRANSFORM_LABELS
 * ============================================================ */
import { CREATIVE_MATH } from "./creativeMath";

/* --- OLS (+ se, t, AIC: statsmodels 호환) --- */
export function mmmOls(X, y) {
  const n = X.length,
    k = X[0].length;
  if (n <= k) return null;
  const Xt = CREATIVE_MATH.transpose(X);
  const XtX = CREATIVE_MATH.matmul(Xt, X);
  const XtXinv = CREATIVE_MATH.inverse(XtX);
  if (!XtXinv) return null;
  const Xty = CREATIVE_MATH.matmul(
    Xt,
    y.map((v) => [v]),
  );
  const beta = CREATIVE_MATH.matmul(XtXinv, Xty).map((r) => r[0]);
  const fitted = X.map((row) =>
    row.reduce((s, v, j) => s + v * beta[j], 0),
  );
  const resid = y.map((v, i) => v - fitted[i]);
  const ssr = resid.reduce((a, e) => a + e * e, 0);
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  const sst = y.reduce((a, v) => a + (v - ybar) ** 2, 0);
  const r2 = sst > 0 ? 1 - ssr / sst : 0,
    adjR2 = 1 - ((1 - r2) * (n - 1)) / Math.max(1, n - k);
  const sigma2 = ssr / (n - k);
  const se = beta.map((_, j) =>
    Math.sqrt(Math.max(0, sigma2 * XtXinv[j][j])),
  );
  const tvalues = beta.map((b, j) => (se[j] > 0 ? b / se[j] : 0));
  const llf = -0.5 * n * (Math.log(2 * Math.PI) + 1 + Math.log(ssr / n));
  const aic = -2 * llf + 2 * k;
  return {
    beta,
    resid,
    fitted,
    ssr,
    n,
    k,
    r2,
    adjR2,
    sigma2,
    se,
    tvalues,
    XtXinv,
    llf,
    aic,
  };
}

/* ============================================================
 * 공통 회귀 엔진 (Regression Lab 5-19 + MMM 리팩터 공유)
 * ⚠ 검증된 코드 — 재유도 금지 (β=(2,3,-1.5) 정확복원, t(2.776,df4) p=.05).
 * 헬퍼는 IIFE에 가둬 기존 전역(_mean 등)과 충돌 회피. 결정론.
 * ============================================================ */
export const REG_STATS = (() => {
  const T = (A) => A[0].map((_, j) => A.map((r) => r[j]));
  const mul = (A, B) =>
    A.map((r) =>
      B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)),
    );
  const matVec = (A, v) =>
    A.map((r) => r.reduce((s, x, k) => s + x * v[k], 0));
  function inv(M) {
    const n = M.length,
      A = M.map((r, i) => [
        ...r,
        ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
      ]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++)
        if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12)
        throw new Error("특이행렬 — 변수 간 완전 공선성일 수 있음");
      [A[c], A[p]] = [A[p], A[c]];
      const pv = A[c][c];
      for (let j = 0; j < 2 * n; j++) A[c][j] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c];
        for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j];
      }
    }
    return A.map((r) => r.slice(n));
  }
  function gammaln(x) {
    const c = [
      76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
    ];
    let y = x,
      t = x + 5.5;
    t -= (x + 0.5) * Math.log(t);
    let s = 1.000000000190015;
    for (let j = 0; j < 6; j++) {
      y++;
      s += c[j] / y;
    }
    return -t + Math.log((2.5066282746310005 * s) / x);
  }
  function betacf(a, b, x) {
    const FP = 1e-30;
    let qab = a + b,
      qap = a + 1,
      qam = a - 1,
      c = 1,
      d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FP) d = FP;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FP) d = FP;
      c = 1 + aa / c;
      if (Math.abs(c) < FP) c = FP;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FP) d = FP;
      c = 1 + aa / c;
      if (Math.abs(c) < FP) c = FP;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 3e-7) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(
      gammaln(a + b) -
        gammaln(a) -
        gammaln(b) +
        a * Math.log(x) +
        b * Math.log(1 - x),
    );
    return x < (a + 1) / (a + b + 2)
      ? (bt * betacf(a, b, x)) / a
      : 1 - (bt * betacf(b, a, 1 - x)) / b;
  }
  const tSF = (t, df) => betai(df / 2, 0.5, df / (df + t * t));
  function tinv(p, df) {
    let lo = 0,
      hi = 1000;
    for (let i = 0; i < 100; i++) {
      const m = (lo + hi) / 2;
      tSF(m, df) > p ? (lo = m) : (hi = m);
    }
    return (lo + hi) / 2;
  }
  function ols(X, y) {
    const n = X.length,
      k = X[0].length;
    const Xt = T(X),
      XtX = mul(Xt, X),
      Xty = matVec(Xt, y);
    let XtXi;
    try {
      XtXi = inv(XtX);
    } catch (e) {
      for (let i = 0; i < k; i++) XtX[i][i] += 1e-8 * (XtX[i][i] || 1);
      XtXi = inv(XtX);
    }
    const beta = matVec(XtXi, Xty);
    const yhat = matVec(X, beta),
      resid = y.map((v, i) => v - yhat[i]);
    const ybar = y.reduce((a, b) => a + b, 0) / n;
    const RSS = resid.reduce((s, r) => s + r * r, 0);
    const TSS = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
    const df = n - k,
      sigma2 = RSS / df;
    const R2 = 1 - RSS / TSS,
      adjR2 = 1 - ((1 - R2) * (n - 1)) / df;
    const se = beta.map((_, j) => Math.sqrt(sigma2 * XtXi[j][j]));
    const tval = beta.map((b, j) => b / se[j]);
    const pval = tval.map((t) => tSF(Math.abs(t), df));
    const tc = tinv(0.05, df);
    const ci = beta.map((b, j) => [b - tc * se[j], b + tc * se[j]]);
    const F = (TSS - RSS) / (k - 1) / sigma2,
      Fp = betai(df / 2, (k - 1) / 2, df / (df + (k - 1) * F));
    return {
      beta,
      se,
      tval,
      pval,
      ci,
      yhat,
      resid,
      R2,
      adjR2,
      n,
      k,
      df,
      sigma2,
      RSS,
      TSS,
      F,
      Fp,
      XtXi, // 예측 밴드 leverage 계산용 (additive — 기존 호출부 무영향)
    };
  }
  function r2of(X, y) {
    try {
      return ols(X, y).R2;
    } catch (e) {
      return NaN;
    }
  }
  return { ols, r2of, tSF, ibeta: betai };
})();

export const { REG_TRANSFORMS, TRANSFORM_LABELS } = (() => {
  const adstock = (v, lam) => {
    const o = [];
    let p = 0;
    for (const x of v) {
      const a = x + lam * p;
      o.push(a);
      p = a;
    }
    return o;
  };
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const std = (a, m = mean(a)) =>
    Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  const REG_TRANSFORMS = {
    none: (v) => v.slice(),
    log1p: (v) => v.map((x) => Math.log1p(Math.max(0, x))),
    zscore: (v) => {
      const m = mean(v),
        s = std(v, m) || 1;
      return v.map((x) => (x - m) / s);
    },
    minmax: (v) => {
      const lo = Math.min(...v),
        hi = Math.max(...v),
        r = hi - lo || 1;
      return v.map((x) => (x - lo) / r);
    },
    adstock_log: (v, lam) =>
      adstock(v, lam).map((x) => Math.log1p(Math.max(0, x))),
    step: (v) => {
      let sum = 0;
      return v.map(x => { sum += Number(x) || 0; return sum; });
    }
  };
  const TRANSFORM_LABELS = {
    none: "없음",
    log1p: "log(1+x)",
    zscore: "표준화 z",
    minmax: "min-max",
    adstock_log: "adstock+log",
  };
  return { REG_TRANSFORMS, TRANSFORM_LABELS };
})();
