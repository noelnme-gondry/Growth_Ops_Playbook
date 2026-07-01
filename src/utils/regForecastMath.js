// regForecastMath.js — 범용회귀 미래 투영 엔진 (index.html 페이스풀 포팅)
// 원본: index.html REG_FORECAST + _mmmParseDate + _mmmFmtDate (VERBATIM)
import { REG_STATS, REG_TRANSFORMS } from "./regMath";

// 날짜 문자열/엑셀 serial → Date(UTC). 실패 시 null. (analysis는 행순서 t로 하되, 표시·예측·단위환산에 사용)
export function _mmmParseDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // YYYY-MM-DD
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // DD/MM/YYYY 또는 MM/DD/YYYY
  if (m) {
    let a = +m[1],
      b = +m[2];
    const mo = a > 12 ? b : a,
      da = a > 12 ? a : b;
    const d = new Date(Date.UTC(+m[3], mo - 1, da));
    return isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{4})[-/.]?(\d{2})$/); // YYYY-MM (월별)
  if (m && +m[2] >= 1 && +m[2] <= 12)
    return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 20000 && n < 80000)
      return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  } // 엑셀 serial
  return null;
}

// 차트·표용 날짜 라벨 (월별이면 YYYY-MM, 그 외 YY-MM-DD)
export function _mmmFmtDate(d, gran) {
  if (!d) return "";
  const y = d.getUTCFullYear(),
    mo = String(d.getUTCMonth() + 1).padStart(2, "0"),
    da = String(d.getUTCDate()).padStart(2, "0");
  if (gran && gran.unit === "monthly") return `${y}-${mo}`;
  return `${String(y).slice(2)}-${mo}-${da}`;
}

/* ============================================================
 * REG_FORECAST — 범용회귀 미래 투영 (Trend Forecast 일반화)
 * 임의 독립변수 회귀에 "미래로 투영" 층을 더한다: 변수별 미래스펙
 * (연속=시나리오 값 / 이벤트=지속·N기간후끔) + 시간→계절성/추세 자동연장
 * + 95% 밴드(leverage). REG_STATS.ols·REG_TRANSFORMS·_mmmParseDate 재사용. 결정론.
 * ⚠ 관측 회귀의 외삽(가설). 인과/증분 확정은 holdout(5-15) 전용.
 * ============================================================ */
export const REG_FORECAST = {
  _mean(a) {
    return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  },
  _std(a) {
    const m = this._mean(a);
    return Math.sqrt(
      a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1),
    );
  },
  _num(v) {
    if (v == null || String(v).trim() === "") return NaN;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? NaN : n;
  },
  // 95% 양측 t 임계값 (REG_STATS.tSF 역추적 — tinv 비노출 대체, 결정론 이분탐색)
  _tcrit(df) {
    let lo = 0,
      hi = 1000;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      REG_STATS.tSF(mid, df) > 0.05 ? (lo = mid) : (hi = mid);
    }
    return (lo + hi) / 2;
  },
  // 시간열 → 추세(표준화 인덱스) + (옵션)계절성(Fourier). 미래 horizon행 연장.
  buildTimeFeatures(timeVals, horizon, season) {
    const n = timeVals ? timeVals.length : 0;
    const t = Array.from({ length: n }, (_, i) => i + 1);
    const futT = Array.from({ length: horizon }, (_, j) => n + j + 1);
    const tm = this._mean(t),
      ts = this._std(t) || 1;
    const cols = [
      {
        name: "trend",
        hist: t.map((x) => (x - tm) / ts),
        fut: futT.map((x) => (x - tm) / ts),
      },
    ];
    let dates = null,
      hasDates = false,
      futLabels = futT.map((x) => "+" + (x - n));
    if (timeVals) {
      dates = timeVals.map((v) => _mmmParseDate(v));
      hasDates = dates.length > 1 && dates.every((d) => d);
    }
    if (hasDates) {
      const gaps = [];
      for (let i = 1; i < dates.length; i++)
        gaps.push((dates[i] - dates[i - 1]) / 86400000);
      const sorted = gaps.slice().sort((a, b) => a - b);
      const medGap = sorted[Math.floor(sorted.length / 2)] || 7;
      const rowsPerYear = 365.25 / (medGap || 7);
      const last = dates[n - 1];
      futLabels = Array.from({ length: horizon }, (_, j) =>
        new Date(last.getTime() + (j + 1) * medGap * 86400000)
          .toISOString()
          .slice(0, 10),
      );
      if (season && n >= rowsPerYear * 1.5 && rowsPerYear >= 3 && rowsPerYear <= 400) {
        const P = rowsPerYear;
        cols.push({
          name: "sin_yr",
          hist: t.map((x) => Math.sin((2 * Math.PI * x) / P)),
          fut: futT.map((x) => Math.sin((2 * Math.PI * x) / P)),
        });
        cols.push({
          name: "cos_yr",
          hist: t.map((x) => Math.cos((2 * Math.PI * x) / P)),
          fut: futT.map((x) => Math.cos((2 * Math.PI * x) / P)),
        });
      }
    }
    return { cols, futLabels, hasDates };
  },
  // 변환을 hist+future 결합 시리즈에 1회 적용 후 슬라이스 (adstock 이월·정규화 스케일 일관)
  _transformCombined(rawHist, rawFut, tf, lam) {
    const comb = REG_TRANSFORMS[tf]
      ? REG_TRANSFORMS[tf]([...rawHist, ...rawFut], lam)
      : [...rawHist, ...rawFut];
    return {
      hist: comb.slice(0, rawHist.length),
      fut: comb.slice(rawHist.length),
    };
  },
  // 종속 역변환 (예측을 원 스케일로) — rawY로 정규화 파라미터 복원
  _invDep(vals, tf, rawY) {
    if (tf === "none" || !tf) return vals.slice();
    if (tf === "log1p" || tf === "adstock_log")
      return vals.map((v) => Math.expm1(v));
    if (tf === "zscore") {
      const m = this._mean(rawY),
        s = this._std(rawY) || 1;
      return vals.map((v) => v * s + m);
    }
    if (tf === "minmax") {
      const lo = Math.min(...rawY),
        hi = Math.max(...rawY),
        r = hi - lo || 1;
      return vals.map((v) => v * r + lo);
    }
    return vals.slice();
  },
  /* 미래 예측 코어.
   * opts: { rows, m(매핑), lam, futureSpec{col→{off}|{value}}, horizon, bandMode, season }
   * 반환: { ok, reason?, terms[], coef[], r2, n, k, vif[], se[], pval[], sigma,
   *         actual[], fittedHist[], predFut[], lo[], hi[], histLabels[], futLabels[],
   *         labels[], splitAt, futRows{col→[]}, depTf, bandMode, hasSeasonality } */
  run(opts) {
    const { rows, m, lam, horizon, bandMode, season } = opts;
    const futureSpec = opts.futureSpec || {};
    const H = Math.max(1, Math.min(260, horizon | 0));
    const tfOf = (c) => m.tf[c] || "none";
    const num = (v) => this._num(v);
    if (!m.dep) return { ok: false, reason: "종속변수를 지정하세요." };
    if (!m.indep.length)
      return { ok: false, reason: "독립변수를 1개 이상 지정하세요." };
    const used = [m.dep, ...m.indep];
    const valid = rows.filter((r) =>
      used.every((c) => isFinite(num(r[c]))),
    );
    const nHist = valid.length;
    const rawY = valid.map((r) => num(r[m.dep]));
    const depTf = tfOf(m.dep);
    const y = REG_TRANSFORMS[depTf]
      ? REG_TRANSFORMS[depTf](rawY, lam)
      : rawY.slice();
    const futRows = {};
    const indepCols = m.indep.map((c) => {
      const rawHist = valid.map((r) => num(r[c]));
      const isBinary = m.types[c] === "binary";
      const isStep = m.tf[c] === "step";
      const spec = futureSpec[c] || {};
      let rawFut;
      if (isBinary) {
        const offType = spec.offType || (spec.off != null ? 'off_n' : 'keep');
        let baseV = isStep ? 0 : (rawHist[rawHist.length - 1] || 0);
        if (offType === 'keep') {
          rawFut = Array(H).fill(baseV);
        } else if (offType === 'off_now') {
          rawFut = Array(H).fill(0);
        } else if (offType === 'off_n') {
          const offN = spec.off || 0;
          rawFut = Array.from({ length: H }, (_, j) => j < offN ? baseV : 0);
        } else if (offType === 'seasonal') {
          const P = Math.min(valid.length, 52); // approx 1 year weekly
          rawFut = Array.from({ length: H }, (_, j) => rawHist[rawHist.length - P + (j % P)] || 0);
        } else {
          rawFut = Array(H).fill(baseV);
        }
      } else {
        const recentN = Math.min(8, nHist);
        const recentMean =
          this._mean(rawHist.slice(-recentN).filter(isFinite)) || 0;
        const val =
          spec.value != null && isFinite(spec.value)
            ? spec.value
            : recentMean;
        rawFut = Array(H).fill(val);
      }
      futRows[c] = rawFut.slice();
      return this._transformCombined(rawHist, rawFut, tfOf(c), lam);
    });
    const timeVals = m.time ? valid.map((r) => r[m.time]) : null;
    const tfeat = this.buildTimeFeatures(timeVals, H, season);
    const featNames = [...m.indep, ...tfeat.cols.map((c) => c.name)];
    const Xhist = [],
      Xfut = [];
    for (let i = 0; i < nHist; i++)
      Xhist.push([
        1,
        ...indepCols.map((c) => c.hist[i]),
        ...tfeat.cols.map((c) => c.hist[i]),
      ]);
    for (let j = 0; j < H; j++)
      Xfut.push([
        1,
        ...indepCols.map((c) => c.fut[j]),
        ...tfeat.cols.map((c) => c.fut[j]),
      ]);
    const k = featNames.length + 1;
    if (nHist <= k)
      return {
        ok: false,
        reason: `데이터 ${nHist}행이 변수 ${k}개(절편 포함)보다 적거나 같아 적합 불가. 기간을 늘리거나 변수를 줄이세요.`,
        n: nHist,
        k,
      };
    let fit;
    try {
      fit = REG_STATS.ols(Xhist, y);
    } catch (e) {
      return { ok: false, reason: "적합 실패: " + e.message, n: nHist, k };
    }
    const beta = fit.beta;
    const predFutT = Xfut.map((r) =>
      r.reduce((s, v, i) => s + v * beta[i], 0),
    );
    const tcrit = this._tcrit(Math.max(1, fit.df));
    const noise = bandMode === "pred" ? 1 : 0;
    const lev = (xrow) => {
      let s = 0;
      for (let a = 0; a < xrow.length; a++)
        for (let b = 0; b < xrow.length; b++)
          s += xrow[a] * fit.XtXi[a][b] * xrow[b];
      return s;
    };
    const loT = [],
      hiT = [];
    Xfut.forEach((r, j) => {
      const se = Math.sqrt(Math.max(0, fit.sigma2 * (noise + lev(r))));
      loT.push(predFutT[j] - tcrit * se);
      hiT.push(predFutT[j] + tcrit * se);
    });
    const fittedHist = this._invDep(fit.yhat, depTf, rawY);
    const predFut = this._invDep(predFutT, depTf, rawY);
    const lo = this._invDep(loT, depTf, rawY);
    const hi = this._invDep(hiT, depTf, rawY);
    const histLabels = m.time
      ? valid.map((r) => String(r[m.time]))
      : valid.map((_, i) => i + 1);
    const vif = m.indep.map((_, j) => {
      if (m.indep.length < 2) return 1;
      const Xj = Xhist.map((r) => r.filter((_, c) => c !== j + 1));
      const r2 = REG_STATS.r2of(Xj, indepCols[j].hist);
      return isFinite(r2) && r2 < 1 ? 1 / (1 - r2) : Infinity;
    });
    return {
      ok: true,
      terms: ["(Intercept)", ...featNames],
      coef: beta,
      r2: fit.R2,
      adjR2: fit.adjR2,
      n: nHist,
      k,
      df: fit.df,
      sigma: Math.sqrt(fit.sigma2),
      vif,
      se: fit.se,
      pval: fit.pval,
      actual: rawY,
      fittedHist,
      predFut,
      lo,
      hi,
      histLabels,
      futLabels: tfeat.futLabels,
      labels: [...histLabels, ...tfeat.futLabels],
      splitAt: nHist,
      futRows,
      depTf,
      bandMode: bandMode === "pred" ? "pred" : "mean",
      hasSeasonality: tfeat.cols.length > 1,
      indepNames: m.indep.slice(),
    };
  },
};
