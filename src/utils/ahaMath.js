/* ----- 컬럼 자동 그룹핑: header → { action, window }.
 * 정규식 ^(.*?)[_-]?d(\d+)$ (대소문자 무시). 매치 안 되면 window=Infinity(단일 윈도우 액션).
 * (index.html ahaParseActionWindow ~30956 verbatim) */
export function ahaParseActionWindow(header) {
  const m = String(header).match(/^(.*?)[_-]?d(\d+)$/i);
  if (m && m[1]) return { action: m[1], window: parseInt(m[2], 10) };
  return { action: String(header), window: Infinity };
}

export const AHA_STATS = (() => {
  function f1(p, r) {
    if (!(p + r > 0)) return 0;
    return (2 * p * r) / (p + r);
  }

  function lift(precision, baseRate) {
    if (!(baseRate > 0)) return null;
    return precision / baseRate;
  }

  function _hashIdx(i, seed) {
    let h = (i * 2654435761 + seed * 40503) >>> 0;
    h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
    return (h >>> 0) / 4294967296;
  }

  function splitDeterministic(n, seed) {
    const train = [],
      holdout = [];
    for (let i = 0; i < n; i++)
      (_hashIdx(i, seed) < 0.5 ? train : holdout).push(i);
    return { train, holdout };
  }

  function bestThreshold(values, targets, idx, minSupport) {
    const pts = idx
      .map((i) => ({ v: values[i], t: targets[i] }))
      .filter((p) => p.v > 0);
    if (!pts.length) return null;
    pts.sort((a, b) => b.v - a.v);
    const totalPos = idx.reduce((s, i) => s + (targets[i] ? 1 : 0), 0);
    const uniqVals = [...new Set(pts.map((p) => p.v))].sort(
      (a, b) => b - a,
    );
    let cumTP = 0,
      cumN = 0,
      vi = 0;
    let best = null,
      bestAnySupport = null;
    for (const k of uniqVals) {
      while (vi < pts.length && pts[vi].v >= k) {
        cumN++;
        if (pts[vi].t) cumTP++;
        vi++;
      }
      const TP = cumTP,
        FP = cumN - cumTP,
        FN = totalPos - cumTP;
      const support = TP + FP;
      const P = support > 0 ? TP / support : 0;
      const R = TP + FN > 0 ? TP / (TP + FN) : 0;
      const F1 = f1(P, R);
      const cand = { k, P, R, F1, support, TP, FP, FN };
      if (
        !bestAnySupport ||
        cand.F1 > bestAnySupport.F1 ||
        (cand.F1 === bestAnySupport.F1 &&
          cand.support > bestAnySupport.support)
      )
        bestAnySupport = cand;
      if (support >= minSupport) {
        if (
          !best ||
          cand.F1 > best.F1 ||
          (cand.F1 === best.F1 && cand.support > best.support)
        )
          best = cand;
      }
    }
    if (!best) return { ...bestAnySupport, gated: true };
    return { ...best, gated: false };
  }

  function gridSearch(
    windowCols,
    targets,
    trainIdx,
    holdoutIdx,
    minSupport,
  ) {
    let bestW = null;
    const grid = [];
    for (const wc of windowCols) {
      const tr = bestThreshold(
        wc.valuesAll,
        targets,
        trainIdx,
        minSupport,
      );
      if (tr) {
        grid.push({
          window: wc.window,
          header: wc.header,
          k: tr.k,
          F1: tr.F1,
          P: tr.P,
          R: tr.R,
          support: tr.support,
          gated: tr.gated,
        });
        if (
          !bestW ||
          tr.F1 > bestW.train.F1 ||
          (tr.F1 === bestW.train.F1 && tr.support > bestW.train.support)
        ) {
          bestW = {
            window: wc.window,
            header: wc.header,
            k: tr.k,
            train: tr,
          };
        }
      }
    }
    if (!bestW) return null;
    const vals = windowCols.find(
      (w) => w.header === bestW.header,
    ).valuesAll;
    let TP = 0,
      FP = 0,
      FN = 0;
    for (const i of holdoutIdx) {
      const v = vals[i] || 0,
        t = targets[i];
      if (v >= bestW.k) {
        if (t) TP++;
        else FP++;
      } else if (t) FN++;
    }
    const support = TP + FP;
    const P = support > 0 ? TP / support : 0;
    const R = TP + FN > 0 ? TP / (TP + FN) : 0;
    const F1h = f1(P, R);
    return {
      bestWindow: bestW.window,
      bestHeader: bestW.header,
      bestK: bestW.k,
      train: {
        P: bestW.train.P,
        R: bestW.train.R,
        F1: bestW.train.F1,
        support: bestW.train.support,
      },
      holdout: { P, R, F1: F1h, support },
      gated: bestW.train.gated,
      grid,
    };
  }

  return { f1, lift, splitDeterministic, bestThreshold, gridSearch };
})();
