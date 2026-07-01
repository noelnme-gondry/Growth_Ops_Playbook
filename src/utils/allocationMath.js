export const ALLOC_MATH = (() => {
  /* WLS (Weighted Least Squares) 지원. weights는 옵션, 없으면 모두 1로 처리.
  Log/Power는 변수 변환 후 같은 가중치를 그대로 적용. Poly2는 가중 정규방정식. */
  function _ones(n) {
    return new Array(n).fill(1);
  }

  function fitLinear(pts, weights) {
    if (pts.length < 2) return null;
    const n = pts.length;
    const w = weights && weights.length === n ? weights : _ones(n);
    let W = 0,
      swx = 0,
      swy = 0,
      swxx = 0,
      swxy = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i],
        wi = w[i];
      W += wi;
      swx += wi * x;
      swy += wi * y;
      swxx += wi * x * x;
      swxy += wi * x * y;
    }
    const denom = W * swxx - swx * swx;
    if (denom === 0) return null;
    const a = (W * swxy - swx * swy) / denom;
    const b = (swy - a * swx) / W;
    return {
      type: "Linear",
      predict: (x) => a * x + b,
      params: { a, b },
    };
  }

  function fitLog(pts, weights) {
    // 유효 인덱스만 추출 (x>0), 가중치도 같은 인덱스로 추림
    const idx = [];
    for (let i = 0; i < pts.length; i++) if (pts[i][0] > 0) idx.push(i);
    if (idx.length < 2) return null;
    const tr = idx.map((i) => [Math.log(pts[i][0]), pts[i][1]]);
    const wTr = weights ? idx.map((i) => weights[i]) : null;
    const lin = fitLinear(tr, wTr);
    if (!lin) return null;
    const { a, b } = lin.params;
    return {
      type: "Log",
      predict: (x) => (x > 0 ? a * Math.log(x) + b : NaN),
      params: { a, b },
    };
  }

  function fitPower(pts, weights) {
    const idx = [];
    for (let i = 0; i < pts.length; i++)
      if (pts[i][0] > 0 && pts[i][1] > 0) idx.push(i);
    if (idx.length < 2) return null;
    const tr = idx.map((i) => [Math.log(pts[i][0]), Math.log(pts[i][1])]);
    const wTr = weights ? idx.map((i) => weights[i]) : null;
    const lin = fitLinear(tr, wTr);
    if (!lin) return null;
    const { a: slope, b: intercept } = lin.params;
    const A = Math.exp(intercept);
    return {
      type: "Power",
      predict: (x) => (x > 0 ? A * Math.pow(x, slope) : NaN),
      params: { a: A, b: slope },
    };
  }

  function fitPoly2(pts, weights) {
    const n = pts.length;
    if (n < 3) return null;
    const w = weights && weights.length === n ? weights : _ones(n);
    let s0 = 0,
      s1 = 0,
      s2 = 0,
      s3 = 0,
      s4 = 0,
      sy = 0,
      sxy = 0,
      sx2y = 0;
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i],
        wi = w[i];
      s0 += wi;
      s1 += wi * x;
      s2 += wi * x * x;
      s3 += wi * x * x * x;
      s4 += wi * x * x * x * x;
      sy += wi * y;
      sxy += wi * x * y;
      sx2y += wi * x * x * y;
    }
    const M = [
      [s4, s3, s2],
      [s3, s2, s1],
      [s2, s1, s0],
    ];
    const v = [sx2y, sxy, sy];
    const det3 = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det3(M);
    if (D === 0) return null;
    const repl = (m, col, vec) =>
      m.map((row, i) =>
        row.map((cell, j) => (j === col ? vec[i] : cell)),
      );
    const a = det3(repl(M, 0, v)) / D;
    const b = det3(repl(M, 1, v)) / D;
    const c = det3(repl(M, 2, v)) / D;
    return {
      type: "Poly2",
      predict: (x) => a * x * x + b * x + c,
      params: { a, b, c },
    };
  }

  function calcR2(pts, model, weights) {
    if (!model || pts.length < 2) return null;
    const w =
      weights && weights.length === pts.length
        ? weights
        : _ones(pts.length);
    let W = 0,
      swy = 0;
    for (let i = 0; i < pts.length; i++) {
      W += w[i];
      swy += w[i] * pts[i][1];
    }
    if (W === 0) return null;
    const yMean = swy / W;
    let ssRes = 0,
      ssTot = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const yhat = model.predict(x);
      if (!isFinite(yhat)) continue;
      ssRes += w[i] * (y - yhat) ** 2;
      ssTot += w[i] * (y - yMean) ** 2;
    }
    return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  }

  function fitBest(pts, weights) {
    const fitters = [
      ["Linear", fitLinear],
      ["Log", fitLog],
      ["Poly2", fitPoly2],
      ["Power", fitPower],
    ];
    let best = null,
      bestR2 = -Infinity;
    for (const [_, fn] of fitters) {
      const m = fn(pts, weights);
      if (!m) continue;
      const r2 = calcR2(pts, m, weights);
      if (r2 != null && r2 > bestR2) {
        best = { ...m, r2 };
        bestR2 = r2;
      }
    }
    return best;
  }

  function isDescending(model, xMin, xMax) {
    if (!model) return false;
    const yLow = model.predict(xMin);
    const yHigh = model.predict(xMax);
    return isFinite(yLow) && isFinite(yHigh) && yHigh < yLow;
  }

  /* Poly2 종모양(∩) / U자형(∪) 감지.
  - bell (a<0): vertex 이전 우상향 → vertex 이후 우하향 (데이터 비율 무관 외삽 위험)
  - u    (a>0): vertex 이전 우하향 → vertex 이후 우상향 (반대 방향 위험)
  vertex가 데이터 범위 내에 있으면 그 후/전 영역이 비정상 신호. */
  function detectPoly2Shape(model) {
    if (!model || model.type !== "Poly2" || model.params.a === 0)
      return null;
    const { a, b } = model.params;
    return {
      vertex: -b / (2 * a),
      shape: a < 0 ? "bell" : "u",
      a,
    };
  }

  /* 최근 데이터 가중치 계산
  - none:        모두 1
  - linear:      최신 1.0 → 최오래 0.2 (선형 감쇠)
  - exponential: w = 0.5 ^ (age / halfLife) (반감기 기준 지수 감쇠) */
  function calcDateWeights(dates, mode, maxDate, halfLifeDays = 30) {
    if (mode === "none" || !maxDate) return dates.map(() => 1);
    const ages = dates.map((d) => {
      if (!d) return 0;
      const t = Date.parse(d);
      return isNaN(t) ? 0 : Math.max(0, (maxDate - t) / 86400000);
    });
    const maxAge = Math.max(...ages, 1);
    if (mode === "linear") {
      return ages.map((a) => 0.2 + 0.8 * (1 - a / maxAge));
    }
    if (mode === "exponential") {
      return ages.map((a) =>
        Math.pow(0.5, a / Math.max(halfLifeDays, 1)),
      );
    }
    return dates.map(() => 1);
  }

  /* ========== Outlier 제거 ==========
  채널별 CPR(y) 분포 기준. 두 가지 방법 제공:
  - IQR (Tukey's Fence): Q1 - k×IQR ~ Q3 + k×IQR 범위 밖 제외 (k=1.5 표준)
  - Modified Z-score (Iglewicz-Hoaglin): |0.6745×(x - median)/MAD| > threshold 제외
  데이터가 4개 미만이면 통계량 의미 없으므로 skip. */
  function removeOutliers(pts, method, opts = {}) {
    if (!pts || pts.length < 4 || method === "none") {
      return { kept: pts || [], removed: [], bounds: null };
    }
    const ys = pts.map((p) => p.y);

    if (method === "iqr") {
      const sorted = [...ys].sort((a, b) => a - b);
      const n = sorted.length;
      const q1 = sorted[Math.floor((n - 1) * 0.25)];
      const q3 = sorted[Math.floor((n - 1) * 0.75)];
      const iqr = q3 - q1;
      const mult = opts.iqrMult ?? 1.5;
      const lo = q1 - mult * iqr;
      const hi = q3 + mult * iqr;
      const kept = [],
        removed = [];
      for (const p of pts) {
        if (p.y >= lo && p.y <= hi) kept.push(p);
        else removed.push(p);
      }
      return {
        kept,
        removed,
        bounds: { method: "iqr", q1, q3, iqr, lo, hi },
      };
    }

    if (method === "modz") {
      const sorted = [...ys].sort((a, b) => a - b);
      const median = sorted[Math.floor((sorted.length - 1) / 2)];
      const deviations = ys
        .map((y) => Math.abs(y - median))
        .sort((a, b) => a - b);
      const mad =
        deviations[Math.floor((deviations.length - 1) / 2)] || 1e-9;
      const threshold = opts.modzThreshold ?? 3.5;
      const kept = [],
        removed = [];
      for (const p of pts) {
        const modz = (0.6745 * (p.y - median)) / mad;
        if (Math.abs(modz) <= threshold) kept.push(p);
        else removed.push(p);
      }
      return {
        kept,
        removed,
        bounds: { method: "modz", median, mad, threshold },
      };
    }

    return { kept: pts, removed: [], bounds: null };
  }

  /* ========== 정규화 ==========
  차트 표시 전용. 추세선 fit은 raw 데이터 사용.
  - log:    log10(x), log10(y) — 마케팅 right-skewed에 적합
  - minmax: (x - min) / (max - min) 채널 내 0~1
  - robust: (x - median) / IQR  채널 내 robust z-score */
  function calcNormContext(pts, mode) {
    if (!pts.length || mode === "raw" || mode === "log") return null;
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    if (mode === "minmax") {
      return {
        xMin: Math.min(...xs),
        xMax: Math.max(...xs),
        yMin: Math.min(...ys),
        yMax: Math.max(...ys),
      };
    }
    if (mode === "robust") {
      const xsS = [...xs].sort((a, b) => a - b);
      const ysS = [...ys].sort((a, b) => a - b);
      const n = pts.length;
      return {
        xMedian: xsS[Math.floor((n - 1) / 2)],
        yMedian: ysS[Math.floor((n - 1) / 2)],
        xIqr:
          xsS[Math.floor((n - 1) * 0.75)] -
            xsS[Math.floor((n - 1) * 0.25)] || 1,
        yIqr:
          ysS[Math.floor((n - 1) * 0.75)] -
            ysS[Math.floor((n - 1) * 0.25)] || 1,
      };
    }
    return null;
  }

  function normalizeXY(x, y, mode, ctx) {
    if (mode === "raw") return { x, y };
    if (mode === "log") {
      if (x <= 0 || y <= 0) return null; // log는 양수만
      return { x: Math.log10(x), y: Math.log10(y) };
    }
    if (mode === "minmax" && ctx) {
      const xR = ctx.xMax - ctx.xMin || 1;
      const yR = ctx.yMax - ctx.yMin || 1;
      return { x: (x - ctx.xMin) / xR, y: (y - ctx.yMin) / yR };
    }
    if (mode === "robust" && ctx) {
      return {
        x: (x - ctx.xMedian) / (ctx.xIqr || 1),
        y: (y - ctx.yMedian) / (ctx.yIqr || 1),
      };
    }
    return { x, y };
  }

  function getAxisLabels(mode, metricLabel = "CPA", isRoas = false) {
    // ROAS 뷰는 항상 raw 스케일 + 높을수록 긍정 (y = Revenue / Cost)
    if (isRoas)
      return {
        x: "Cost",
        y: `${metricLabel} (Revenue / Cost, 높을수록 긍정)`,
      };
    switch (mode) {
      case "log":
        return { x: "log10(Cost)", y: `log10(${metricLabel})` };
      case "minmax":
        return {
          x: "Cost · 정규화 (0~1)",
          y: `${metricLabel} · 정규화 (0~1)`,
        };
      case "robust":
        return { x: "Cost · Robust z", y: `${metricLabel} · Robust z` };
      default:
        return {
          x: "Cost",
          y: `${metricLabel} (Cost / 결과, 낮을수록 긍정)`,
        };
    }
  }

  function predictSafeCpr(ch, cost) {
    if (!ch || !ch.model) return null;
    let evalCost = cost;
    if (ch.poly2Shape) {
      if (
        ch.poly2Shape.shape === "bell" &&
        evalCost > ch.poly2Shape.vertex
      ) {
        evalCost = ch.poly2Shape.vertex;
      } else if (
        ch.poly2Shape.shape === "u" &&
        evalCost < ch.poly2Shape.vertex
      ) {
        evalCost = ch.poly2Shape.vertex;
      }
    }
    if (evalCost > ch.xMax) {
      evalCost = ch.xMax;
    }
    // xMax만 clamp하고 xMin 하한이 없으면 예산이 작을 때(그리디 초기 step 등) 관측 구간
    // 밖 x→0 근처로 외삽 — Log/Power/Poly2가 발산·음수로 튀어 predict(xMax) 폴백으로 스케일이
    // 뒤바뀜(What-if 시나리오가 예산 배수 간 비단조로 튀는 원인). xMin도 동일하게 clamp.
    if (ch.xMin != null && evalCost < ch.xMin) {
      evalCost = ch.xMin;
    }
    const cpr = ch.model.predict(evalCost);
    if (isFinite(cpr) && cpr > 0) return cpr;
    const cprFallback = ch.model.predict(ch.xMax);
    if (isFinite(cprFallback) && cprFallback > 0) return cprFallback;
    return null;
  }

  // 채널 정렬: 최근 recentDays일 Cost 합산 큰 순서, 동률(최근 0)이면 전체 Cost로 2차 정렬
  // (전체 기간 합산 정렬은 과거 큰돈 쓴 채널이 상위를 점유해 최근 신규/활성 캠페인이
  //  상위 N에서 밀려 안 보이는 문제 → 최근 윈도우 기준 정렬)
  function sortChannelsByRecentCost(byChannel, recentDays) {
    const allDates = [];
    for (const pts of byChannel.values()) {
      for (const p of pts) {
        const t = p.date ? Date.parse(p.date) : NaN;
        if (!isNaN(t)) allDates.push(t);
      }
    }
    const maxDate = allDates.length ? Math.max(...allDates) : null;
    const recentThreshold =
      maxDate != null ? maxDate - recentDays * 86400 * 1000 : null;
    const recentCost = (ch) => {
      const pts = byChannel.get(ch) || [];
      if (recentThreshold == null)
        return pts.reduce((s, p) => s + p.x, 0);
      let sum = 0;
      for (const p of pts) {
        const t = p.date ? Date.parse(p.date) : NaN;
        if (!isNaN(t) && t >= recentThreshold) sum += p.x;
      }
      return sum;
    };
    const totalCost = (ch) =>
      (byChannel.get(ch) || []).reduce((s, p) => s + p.x, 0);
    return [...byChannel.keys()].sort((a, b) => {
      const d = recentCost(b) - recentCost(a);
      return d !== 0 ? d : totalCost(b) - totalCost(a);
    });
  }

  return {
    fitLinear,
    fitLog,
    fitPoly2,
    fitPower,
    fitBest,
    calcR2,
    isDescending,
    calcDateWeights,
    removeOutliers,
    calcNormContext,
    normalizeXY,
    getAxisLabels,
    detectPoly2Shape,
    predictSafeCpr,
    sortChannelsByRecentCost,
  };
})();
