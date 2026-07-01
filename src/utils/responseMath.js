export function dayOfYear(dateStr) {
  const d = new Date(dateStr);
  const s = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - s) / 86400000);
}

export const CANNIBAL_STATS = {
  linearFit(values) {
    const n = values.length;
    if (n < 2) return null;
    const ts = values.map((_, i) => i);
    const meanT = ts.reduce((a, b) => a + b, 0) / n;
    const meanY = values.reduce((a, b) => a + b, 0) / n;
    let num = 0,
      den = 0;
    for (let i = 0; i < n; i++) {
      num += (ts[i] - meanT) * (values[i] - meanY);
      den += (ts[i] - meanT) ** 2;
    }
    if (den === 0)
      return { slope: 0, intercept: meanY, fit: values.map(() => meanY) };
    const slope = num / den;
    const intercept = meanY - slope * meanT;
    return {
      slope,
      intercept,
      fit: ts.map((t) => intercept + slope * t),
    };
  },

  centeredMA(values, window) {
    const n = values.length;
    const half = Math.floor(window / 2);
    const out = new Array(n).fill(NaN);
    for (let i = half; i < n - half; i++) {
      let s = 0,
        c = 0;
      for (let j = i - half; j <= i + half; j++) {
        if (Number.isFinite(values[j])) {
          s += values[j];
          c++;
        }
      }
      if (c > 0) out[i] = s / c;
    }
    return out;
  },

  loess(xs, ys, options = {}) {
    const { bandwidth = 0.3 } = options;
    const n = xs.length;
    const k = Math.max(3, Math.ceil(bandwidth * n));
    const out = new Array(n).fill(NaN);

    const validIdx = [];
    for (let i = 0; i < n; i++)
      if (Number.isFinite(ys[i])) validIdx.push(i);
    if (validIdx.length < 3) return out;

    for (let i = 0; i < n; i++) {
      const dists = validIdx.map((j) => ({
        idx: j,
        d: Math.abs(xs[j] - xs[i]),
      }));
      dists.sort((a, b) => a.d - b.d);
      const neigh = dists.slice(0, k);
      const maxD = neigh[neigh.length - 1].d || 1;

      let sw = 0,
        swx = 0,
        swy = 0,
        swxx = 0,
        swxy = 0;
      for (const nb of neigh) {
        const u = nb.d / maxD;
        if (u >= 1) continue;
        const w = Math.pow(1 - u * u * u, 3);
        const xn = xs[nb.idx];
        const yn = ys[nb.idx];
        sw += w;
        swx += w * xn;
        swy += w * yn;
        swxx += w * xn * xn;
        swxy += w * xn * yn;
      }
      if (sw <= 0) continue;
      const meanX = swx / sw,
        meanY = swy / sw;
      const denom = swxx - sw * meanX * meanX;
      if (denom === 0) {
        out[i] = meanY;
        continue;
      }
      const slope = (swxy - sw * meanX * meanY) / denom;
      const intercept = meanY - slope * meanX;
      out[i] = intercept + slope * xs[i];
    }
    return out;
  },

  stlDecompose(values, dates, period = 365) {
    const n = values.length;
    const ts = Array.from({ length: n }, (_, i) => i);

    const trendBw = Math.min(0.95, Math.max(0.15, (1.5 * period) / n));
    const trend = this.loess(ts, values, { bandwidth: trendBw });

    const r1 = values.map((v, i) =>
      Number.isFinite(trend[i]) ? v - trend[i] : NaN,
    );

    const doySubseries = Array.from({ length: 367 }, () => ({
      idx: [],
      y: [],
    }));
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(r1[i])) continue;
      const doy = dayOfYear(dates[i]);
      if (doy < 0 || doy >= 367) continue;
      doySubseries[doy].idx.push(i);
      doySubseries[doy].y.push(r1[i]);
    }

    const seasonal = new Array(n).fill(0);
    for (let doy = 0; doy < 367; doy++) {
      const sub = doySubseries[doy];
      if (sub.idx.length === 0) continue;
      if (sub.idx.length < 4) {
        const m = sub.y.reduce((a, b) => a + b, 0) / sub.y.length;
        for (const i of sub.idx) seasonal[i] = m;
      } else {
        const subSmoothed = this.loess(sub.idx, sub.y, {
          bandwidth: 0.6,
        });
        for (let j = 0; j < sub.idx.length; j++) {
          seasonal[sub.idx[j]] = Number.isFinite(subSmoothed[j])
            ? subSmoothed[j]
            : sub.y[j];
        }
      }
    }

    const seasonalFinite = seasonal.filter((v) => Number.isFinite(v));
    const seasonMean =
      seasonalFinite.reduce((a, b) => a + b, 0) /
      Math.max(1, seasonalFinite.length);
    for (let i = 0; i < n; i++) {
      seasonal[i] = (seasonal[i] || 0) - seasonMean;
    }

    const residual = values.map((v, i) =>
      Number.isFinite(trend[i]) ? v - trend[i] - seasonal[i] : NaN,
    );
    return { trend, seasonal, residual };
  },

  weekdayDetrend(residuals, dates) {
    const buckets = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    for (let i = 0; i < dates.length; i++) {
      if (!Number.isFinite(residuals[i])) continue;
      const w = new Date(dates[i]).getDay();
      buckets[w].sum += residuals[i];
      buckets[w].n++;
    }
    const weekdayMean = buckets.map((b) => (b.n > 0 ? b.sum / b.n : 0));
    const detrended = residuals.map((r, i) => {
      if (!Number.isFinite(r)) return NaN;
      const w = new Date(dates[i]).getDay();
      return r - weekdayMean[w];
    });
    return { weekdayMean, detrended };
  },

  pearson(a, b) {
    let sx = 0,
      sy = 0,
      n = 0;
    const idx = [];
    for (let i = 0; i < a.length; i++) {
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
        sx += a[i];
        sy += b[i];
        n++;
        idx.push(i);
      }
    }
    if (n < 2) return NaN;
    const mx = sx / n,
      my = sy / n;
    let num = 0,
      dxx = 0,
      dyy = 0;
    for (const i of idx) {
      const xd = a[i] - mx,
        yd = b[i] - my;
      num += xd * yd;
      dxx += xd * xd;
      dyy += yd * yd;
    }
    if (dxx === 0 || dyy === 0) return NaN;
    return num / Math.sqrt(dxx * dyy);
  },

  crossCorrelation(a, b, maxLag = 10) {
    const out = [];
    for (let L = -maxLag; L <= maxLag; L++) {
      const aS = [],
        bS = [];
      for (let i = 0; i < a.length; i++) {
        const j = i - L;
        if (j >= 0 && j < b.length) {
          aS.push(a[i]);
          bS.push(b[j]);
        }
      }
      out.push({ lag: L, r: this.pearson(aS, bS) });
    }
    return out;
  },
};
