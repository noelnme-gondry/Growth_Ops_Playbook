// Cohort quality + maturation math — extracted VERBATIM from index.html.
// Source of truth: index.html (Quality engine ~34309-35043, retentionHeatColor ~35642,
// ROAS Maturation MATURATION_MATH ~39494, buildMaturationRows ~39606).
// Pure/deterministic (no Math.random). Golden tests: runQualityTests / runMaturationTests.

/* ============================================================
 * Quality (cohort retention / LTV) config + pure curve fits
 * ============================================================ */
export const QUALITY_CONFIG = {
  version: "1.0.0",
  ltvHorizons: [30, 90, 180, 365],
  curveModels: ["power", "logarithmic"], // y = a*x^b, y = a*ln(x)+b
  minCohortSize: 100,
};

/* 순수 함수: power curve fit y = a*x^b (loglog 변환 후 linear). NaN 안전. */
export function fitPowerCurve(xs, ys) {
  const pairs = xs
    .map((x, i) => ({ x, y: ys[i] }))
    .filter((p) => p.x > 0 && p.y > 0 && isFinite(p.x) && isFinite(p.y));
  if (pairs.length < 3) return null;
  const lnX = pairs.map((p) => Math.log(p.x));
  const lnY = pairs.map((p) => Math.log(p.y));
  const n = pairs.length;
  const meanX = lnX.reduce((s, v) => s + v, 0) / n;
  const meanY = lnY.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (lnX[i] - meanX) * (lnY[i] - meanY);
    den += (lnX[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  const b = num / den;
  const lnA = meanY - b * meanX;
  const a = Math.exp(lnA);
  // R² on log-log
  let ssRes = 0,
    ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yHat = lnA + b * lnX[i];
    ssRes += (lnY[i] - yHat) ** 2;
    ssTot += (lnY[i] - meanY) ** 2;
  }
  const R2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { type: "power", a, b, R2, predict: (x) => a * Math.pow(x, b) };
}

/* 순수 함수: logarithmic fit y = a*ln(x) + b. x > 0 필수. 누적 LTV에 적합(포화 수렴형). */
export function fitLogCurve(xs, ys) {
  const pairs = xs
    .map((x, i) => ({ x, y: ys[i] }))
    .filter((p) => p.x > 0 && isFinite(p.x) && isFinite(p.y));
  if (pairs.length < 3) return null;
  const lnX = pairs.map((p) => Math.log(p.x));
  const yy = pairs.map((p) => p.y);
  const n = pairs.length;
  const meanLnX = lnX.reduce((s, v) => s + v, 0) / n;
  const meanY = yy.reduce((s, v) => s + v, 0) / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    num += (lnX[i] - meanLnX) * (yy[i] - meanY);
    den += (lnX[i] - meanLnX) ** 2;
  }
  if (den === 0) return null;
  const a = num / den;
  const b = meanY - a * meanLnX;
  let ssRes = 0,
    ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yHat = a * lnX[i] + b;
    ssRes += (yy[i] - yHat) ** 2;
    ssTot += (yy[i] - meanY) ** 2;
  }
  const R2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return {
    type: "logarithmic",
    a,
    b,
    R2,
    predict: (x) => a * Math.log(x) + b,
  };
}

/* ------------------------------------------------------------
 * getMappedRows — index.html에서 CSV_STATE.raw/mapping을 표준필드로 변환.
 * v2에서는 rows/mapping을 명시적 인자로 받는 순수 버전으로 이식.
 * (숫자/percent 필드만 parseFloat, 나머지는 원본 문자열)
 * ------------------------------------------------------------ */
function mapRows(rawRows, mapping, numericFields) {
  const inverseMap = {}; // standardField → csvHeader
  for (const [csvH, stdK] of Object.entries(mapping)) {
    if (stdK !== "__ignore__") inverseMap[stdK] = csvH;
  }
  const numSet = new Set(numericFields);
  return rawRows.map((row) => {
    const out = {};
    for (const [stdK, csvH] of Object.entries(inverseMap)) {
      const raw = row[csvH];
      if (numSet.has(stdK)) {
        const num = parseFloat(String(raw).replace(/[^\d.\-]/g, ""));
        out[stdK] = isNaN(num) ? 0 : num;
      } else {
        out[stdK] = raw;
      }
    }
    return out;
  });
}

// Quality grain numeric fields (from STANDARD_FIELDS type=number/percent in index.html).
const QUALITY_NUMERIC_FIELDS = [
  "day_offset",
  "cohort_size",
  "retained_users",
  "cohort_revenue",
  "cohort_payments",
];

/* buildQualityCache 이식 — index.html buildQualityCache의 순수 부분.
 * rawRows/mapping을 받아 cohorts + retentionCurve + ltv + validation을 산출.
 * QUALITY_STATE(segmentBy/curveModel)는 state 인자로 전달. */
export function buildQualityData(
  rawRows,
  mapping,
  state = { segmentBy: "none", curveModel: "power" },
) {
  const rows = mapRows(rawRows, mapping, QUALITY_NUMERIC_FIELDS);
  const validation = { errors: [], droppedRows: 0 };

  // grain 정제
  const clean = [];
  for (const r of rows) {
    if (!r.cohort_date || r.day_offset == null || r.day_offset === "") {
      validation.droppedRows++;
      continue;
    }
    const day = Number(r.day_offset);
    const size = Number(r.cohort_size);
    const ret =
      r.retained_users != null && r.retained_users !== ""
        ? Number(r.retained_users)
        : null;
    const rev =
      r.cohort_revenue != null && r.cohort_revenue !== ""
        ? Number(r.cohort_revenue)
        : null;
    const pay =
      r.cohort_payments != null && r.cohort_payments !== ""
        ? Number(r.cohort_payments)
        : null;
    if (!isFinite(day) || day < 0) {
      validation.errors.push(
        `잘못된 day_offset: ${r.cohort_date} ${r.day_offset}`,
      );
      validation.droppedRows++;
      continue;
    }
    if (!isFinite(size) || size <= 0) {
      validation.errors.push(`잘못된 cohort_size: ${r.cohort_date} (${size})`);
      validation.droppedRows++;
      continue;
    }
    if (ret != null && ret > size) {
      validation.errors.push(
        `retained > size: ${r.cohort_date} day ${day} (${ret}/${size})`,
      );
    }
    clean.push({
      cohort_date: r.cohort_date,
      day,
      size,
      retained: ret,
      revenue: rev,
      payments: pay,
      channel: r.channel,
      country: r.country,
      platform: r.platform,
    });
  }

  // 코호트 단위 그룹화
  const cohortMap = new Map();
  for (const c of clean) {
    if (!cohortMap.has(c.cohort_date))
      cohortMap.set(c.cohort_date, {
        cohort_date: c.cohort_date,
        size: c.size,
        points: [],
        channel: c.channel,
        country: c.country,
        platform: c.platform,
      });
    cohortMap.get(c.cohort_date).points.push({
      day: c.day,
      retained: c.retained,
      retentionRate: c.retained != null ? c.retained / c.size : null,
      revenue: c.revenue,
      arpu: c.revenue != null ? c.revenue / c.size : null,
      payments: c.payments,
      pur: c.payments != null ? c.payments / c.size : null,
    });
  }
  const cohorts = [...cohortMap.values()].sort((a, b) =>
    a.cohort_date.localeCompare(b.cohort_date),
  );
  for (const co of cohorts) co.points.sort((a, b) => a.day - b.day);

  // 전체 평균 리텐션 곡선 (day별 가중평균)
  const dayMap = new Map();
  for (const co of cohorts) {
    for (const p of co.points) {
      if (p.retentionRate == null) continue;
      if (!dayMap.has(p.day))
        dayMap.set(p.day, {
          day: p.day,
          retSum: 0,
          sizeSum: 0,
          arpuSum: 0,
          arpuW: 0,
          purSum: 0,
          purW: 0,
        });
      const d = dayMap.get(p.day);
      d.retSum += p.retentionRate * co.size;
      d.sizeSum += co.size;
      if (p.arpu != null) {
        d.arpuSum += p.arpu * co.size;
        d.arpuW += co.size;
      }
      if (p.pur != null) {
        d.purSum += p.pur * co.size;
        d.purW += co.size;
      }
    }
  }
  const retentionCurve = [...dayMap.values()]
    .sort((a, b) => a.day - b.day)
    .map((d) => ({
      day: d.day,
      mean: d.sizeSum > 0 ? d.retSum / d.sizeSum : null,
      arpuMean: d.arpuW > 0 ? d.arpuSum / d.arpuW : null,
      purMean: d.purW > 0 ? d.purSum / d.purW : null,
      n: d.sizeSum,
    }));

  // LTV: cumulative ARPU curve fit + 외삽
  const validArpu = retentionCurve.filter((d) => d.arpuMean != null);
  let ltv = null;
  if (validArpu.length >= 3) {
    const days = validArpu.map((d) => d.day);
    const arpu = validArpu.map((d) => d.arpuMean);
    const power = fitPowerCurve(days, arpu);
    const log = fitLogCurve(days, arpu);
    const fit = state.curveModel === "logarithmic" ? log : power;
    const extrap = {};
    if (fit) {
      for (const h of QUALITY_CONFIG.ltvHorizons) {
        extrap[h] = fit.predict(h);
      }
    }
    ltv = {
      observed: validArpu.map((d) => ({ day: d.day, arpu: d.arpuMean })),
      fit,
      extrap,
    };
  }

  // 세그먼트 비교 (옵션)
  let segmentCompare = null;
  const seg = state.segmentBy;
  if (seg && seg !== "none") {
    const segMap = new Map();
    for (const co of cohorts) {
      const segKey = co[seg] || "unknown";
      if (!segMap.has(segKey)) segMap.set(segKey, []);
      segMap.get(segKey).push(co);
    }
    segmentCompare = [];
    for (const [segName, segCohorts] of segMap) {
      const dm = new Map();
      let totalSize = 0;
      for (const co of segCohorts) {
        totalSize += co.size;
        for (const p of co.points) {
          if (p.retentionRate == null) continue;
          if (!dm.has(p.day))
            dm.set(p.day, { day: p.day, retSum: 0, sizeSum: 0 });
          const d = dm.get(p.day);
          d.retSum += p.retentionRate * co.size;
          d.sizeSum += co.size;
        }
      }
      const curve = [...dm.values()]
        .sort((a, b) => a.day - b.day)
        .map((d) => ({
          day: d.day,
          mean: d.sizeSum > 0 ? d.retSum / d.sizeSum : null,
        }));
      segmentCompare.push({
        segment: segName,
        totalSize,
        cohortCount: segCohorts.length,
        curve,
      });
    }
    segmentCompare.sort((a, b) => b.totalSize - a.totalSize);
  }

  return { cohorts, retentionCurve, ltv, segmentCompare, validation };
}

/* ============================================================
 * COHORT_MATURATION — 순수 마투레이션 예측 엔진 (PR 3-B)
 * 2-트랙 자동 전환: ① 경험적 완성비 (empirical) ② parametric 곡선 폴백 (curve)
 * metric: "revenue" | "retention" | "payments"
 * 결정론: Math.random 없음. 단조 보정: revenue/payments=비감소, retention=비증가.
 * ============================================================ */
export const COHORT_MATUR_CFG = {
  maturedMinDaily: 30, // 일별 코호트 최소 성숙 코호트 수
  maturedMinWeekly: 12, // 주별 코호트 최소 성숙 코호트 수
  anchorDn: 7, // 경험적 비율의 분모 (기본 D7)
  horizons: [30, 90, 180, 365],
  convThreshold: 0.02, // anchor 수렴 임계 (3-D에서 사용)
};

export const COHORT_MATURATION = (function () {
  function _parseMs(s) {
    const [y, mo, d] = s.split("-").map(Number);
    return Date.UTC(y, mo - 1, d);
  }

  function cohortAge(cohort_date, asOfDate) {
    return Math.floor((_parseMs(asOfDate) - _parseMs(cohort_date)) / 86400000);
  }

  function inferAsOf(cohorts) {
    let maxMs = 0;
    for (const co of cohorts) {
      const bMs = _parseMs(co.cohort_date);
      const maxDay = co.points.length
        ? Math.max(...co.points.map((p) => p.day))
        : 0;
      const ms = bMs + maxDay * 86400000;
      if (ms > maxMs) maxMs = ms;
    }
    const d = new Date(maxMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  function detectGranularity(cohorts) {
    if (cohorts.length < 2) return "daily";
    const ms = cohorts
      .map((c) => _parseMs(c.cohort_date))
      .sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < ms.length; i++)
      gaps.push((ms[i] - ms[i - 1]) / 86400000);
    const sorted = [...gaps].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    return med >= 5 ? "weekly" : "daily";
  }

  function _getV(point, metric) {
    if (!point) return null;
    if (metric === "retention") return point.retentionRate;
    if (metric === "revenue") return point.arpu;
    if (metric === "payments") return point.pur;
    return null;
  }

  function _wStats(vals, wts) {
    const n = vals.length;
    if (n === 0) return { mean: null, ci95: 0 };
    const tw = wts.reduce((s, w) => s + w, 0);
    if (tw === 0) return { mean: null, ci95: 0 };
    const mean = vals.reduce((s, v, i) => s + v * wts[i], 0) / tw;
    if (n < 2) return { mean, ci95: 0 };
    const vari =
      wts.reduce((s, w, i) => s + w * (vals[i] - mean) ** 2, 0) /
      ((tw * (n - 1)) / n);
    return { mean, ci95: 1.96 * Math.sqrt(vari / n) };
  }

  /* 단조 보정: 오브젝트 배열 [{n, v, ...}] 를 day 순으로 정렬·수정 (in-place). */
  function monoCorrect(pts, metric) {
    if (!pts.length) return pts;
    pts.sort((a, b) => a.n - b.n);
    if (metric === "retention") {
      let run = Infinity;
      for (const p of pts) {
        if (p.v != null && isFinite(p.v)) {
          run = Math.min(run, p.v);
          p.v = Math.max(0, Math.min(1, run));
        }
      }
    } else {
      let run = -Infinity;
      for (const p of pts) {
        if (p.v != null && isFinite(p.v)) {
          run = Math.max(run, p.v);
          p.v = Math.max(0, run);
        }
      }
    }
    return pts;
  }

  function predict(cohorts, asOfDate, metric, cfg) {
    const anchorDn = cfg?.anchorDn ?? COHORT_MATUR_CFG.anchorDn;
    const horizons = cfg?.horizons || COHORT_MATUR_CFG.horizons;
    const asOf = asOfDate || inferAsOf(cohorts);
    const gran = detectGranularity(cohorts);
    const matMin =
      cfg?.maturedMin != null
        ? cfg.maturedMin
        : gran === "weekly"
          ? COHORT_MATUR_CFG.maturedMinWeekly
          : COHORT_MATUR_CFG.maturedMinDaily;

    /* ---- 전체 관측 평균 (곡선 폴백용) ---- */
    const obsByDay = new Map();
    for (const co of cohorts) {
      for (const pt of co.points) {
        const v = _getV(pt, metric);
        if (v == null || !isFinite(v)) continue;
        if (!obsByDay.has(pt.day)) obsByDay.set(pt.day, { vS: 0, wS: 0 });
        const d = obsByDay.get(pt.day);
        d.vS += v * co.size;
        d.wS += co.size;
      }
    }
    const obsPts = [...obsByDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, d]) => ({ day, v: d.wS > 0 ? d.vS / d.wS : null }))
      .filter((p) => p.v != null && isFinite(p.v));

    const fitObs = obsPts.filter((p) => p.day > 0 && p.v > 0);
    const cPwr = fitPowerCurve(
      fitObs.map((p) => p.day),
      fitObs.map((p) => p.v),
    );
    const cLog = fitLogCurve(
      fitObs.map((p) => p.day),
      fitObs.map((p) => p.v),
    );
    const curveFit =
      cPwr && cLog ? (cPwr.R2 >= cLog.R2 ? cPwr : cLog) : cPwr || cLog;

    /* ---- Per-horizon 계산 ---- */
    const avgCurve = [];

    for (const targetDn of horizons) {
      /* 성숙 코호트: cohortAge ≥ targetDn AND 해당 Dn 실측 보유 */
      const mature = cohorts.filter((co) => {
        if (cohortAge(co.cohort_date, asOf) < targetDn) return false;
        const pt = co.points.find((p) => p.day === targetDn);
        const v = _getV(pt, metric);
        return v != null && isFinite(v);
      });

      if (mature.length >= matMin) {
        /* 경험적 경로 */
        let entV = null,
          entLo = null,
          entHi = null;
        let avgRatio = null,
          ci95Ratio = 0;

        if (metric !== "retention") {
          /* 비율 기반: v(targetDn) / v(anchorDn) */
          const withAnchor = mature.filter((co) => {
            const apt = co.points.find((p) => p.day === anchorDn);
            const av = _getV(apt, metric);
            return av != null && av > 0 && isFinite(av);
          });
          if (withAnchor.length >= 2) {
            const ratios = withAnchor.map((co) => {
              const tpt = co.points.find((p) => p.day === targetDn);
              const apt = co.points.find((p) => p.day === anchorDn);
              return _getV(tpt, metric) / _getV(apt, metric);
            });
            const wts = withAnchor.map((co) => co.size);
            const { mean: mr, ci95: cir } = _wStats(ratios, wts);
            avgRatio = mr;
            ci95Ratio = cir;
          }
          /* 글로벌 평균 (표 표시용) */
          const aVals = mature.map((co) => {
            const pt = co.points.find((p) => p.day === targetDn);
            return _getV(pt, metric);
          });
          const aWts = mature.map((co) => co.size);
          const { mean: mv, ci95: cv } = _wStats(aVals, aWts);
          entV = mv;
          entLo = Math.max(0, mv - cv);
          entHi = mv + cv;
        } else {
          /* 리텐션: 레벨 가중평균 */
          const aVals = mature.map((co) => {
            const pt = co.points.find((p) => p.day === targetDn);
            return _getV(pt, metric);
          });
          const aWts = mature.map((co) => co.size);
          const { mean: mv, ci95: cv } = _wStats(aVals, aWts);
          entV = mv;
          entLo = Math.max(0, mv - cv);
          entHi = Math.min(1, mv + cv);
        }
        avgCurve.push({
          n: targetDn,
          v: entV,
          lo: entLo,
          hi: entHi,
          avgRatio,
          ci95Ratio,
          maturedCount: mature.length,
          method: "empirical",
        });
      } else if (curveFit) {
        /* 곡선 폴백 */
        const v = curveFit.predict(targetDn);
        if (isFinite(v) && v >= 0) {
          avgCurve.push({
            n: targetDn,
            v,
            lo: null,
            hi: null,
            avgRatio: null,
            ci95Ratio: 0,
            maturedCount: mature.length,
            method: "curve",
          });
        } else {
          avgCurve.push({
            n: targetDn,
            v: null,
            lo: null,
            hi: null,
            avgRatio: null,
            ci95Ratio: 0,
            maturedCount: mature.length,
            method: "insufficient",
          });
        }
      } else {
        avgCurve.push({
          n: targetDn,
          v: null,
          lo: null,
          hi: null,
          avgRatio: null,
          ci95Ratio: 0,
          maturedCount: mature.length,
          method: "insufficient",
        });
      }
    }

    /* avgCurve 단조 보정 (관측 평균 포함) */
    const monoInput = [
      ...obsPts.map((p) => ({ n: p.day, v: p.v })),
      ...avgCurve
        .filter((e) => e.v != null)
        .map((e) => ({ n: e.n, v: e.v })),
    ];
    monoCorrect(monoInput, metric);
    const monoMap = new Map(monoInput.map((p) => [p.n, p.v]));
    for (const ent of avgCurve) {
      if (ent.v != null) {
        const corrV = monoMap.get(ent.n);
        if (corrV != null) {
          const diff = corrV - ent.v;
          ent.v = corrV;
          if (ent.lo != null) ent.lo = Math.max(0, ent.lo + diff);
          if (ent.hi != null)
            ent.hi =
              metric === "retention"
                ? Math.min(1, ent.hi + diff)
                : ent.hi + diff;
        }
      }
    }

    /* ---- 코호트별 예측 ---- */
    const byCohort = cohorts.map((co) => {
      const age = cohortAge(co.cohort_date, asOf);
      const actual = co.points
        .map((p) => ({ n: p.day, v: _getV(p, metric) }))
        .filter((p) => p.v != null && isFinite(p.v));
      const actualSet = new Set(actual.map((p) => p.n));

      const anchorPt = co.points.find((p) => p.day === anchorDn);
      const anchorV = anchorPt ? _getV(anchorPt, metric) : null;

      const predicted = [];
      for (const ent of avgCurve) {
        if (actualSet.has(ent.n)) continue; // 이미 실측
        if (ent.v == null && ent.avgRatio == null) continue; // 데이터 부족

        let predV, predLo, predHi;
        if (ent.avgRatio != null && anchorV != null && anchorV > 0) {
          predV = anchorV * ent.avgRatio;
          predLo = Math.max(0, anchorV * (ent.avgRatio - ent.ci95Ratio));
          predHi = anchorV * (ent.avgRatio + ent.ci95Ratio);
        } else if (ent.v != null) {
          predV = ent.v;
          predLo = ent.lo;
          predHi = ent.hi;
        } else {
          continue;
        }
        if (!isFinite(predV) || predV < 0) continue;
        if (metric === "retention") {
          predV = Math.min(1, predV);
          predLo = predLo != null ? Math.max(0, predLo) : null;
          predHi = predHi != null ? Math.min(1, predHi) : null;
        }
        predicted.push({
          n: ent.n,
          v: predV,
          lo: predLo,
          hi: predHi,
          method: ent.method,
        });
      }

      /* 코호트별 단조 보정 (실측 + 예측 합산) */
      const combined = [
        ...actual.map((p) => ({ n: p.n, v: p.v, _a: true })),
        ...predicted.map((p) => ({
          n: p.n,
          v: p.v,
          lo: p.lo,
          hi: p.hi,
          method: p.method,
          _a: false,
        })),
      ];
      monoCorrect(combined, metric);
      const corrPred = combined
        .filter((p) => !p._a)
        .map((p) => ({
          n: p.n,
          v: p.v,
          lo: p.lo,
          hi: p.hi,
          method: p.method,
        }));

      return {
        cohort_date: co.cohort_date,
        size: co.size,
        age,
        actual,
        predicted: corrPred,
      };
    });

    return {
      avgCurve,
      byCohort,
      asOf,
      metric,
      anchorDn,
      curveFit: curveFit ? { type: curveFit.type, R2: curveFit.R2 } : null,
    };
  }

  function predictAll(cohorts, asOfDate, cfg) {
    return {
      revenue: predict(cohorts, asOfDate, "revenue", cfg),
      retention: predict(cohorts, asOfDate, "retention", cfg),
      payments: predict(cohorts, asOfDate, "payments", cfg),
    };
  }

  return {
    cohortAge,
    inferAsOf,
    detectGranularity,
    monoCorrect,
    predict,
    predictAll,
  };
})();

export const COHORT_MAT_STATE = {
  metric: "revenue", // "revenue" | "retention" | "payments"
  anchorDn: 7, // anchor Dn for ratio-based empirical
  maturedMin: null, // null = auto from COHORT_MATUR_CFG
};

/* buildMaturationCache 이식 — cohorts(빈 경우 null) → predictAll 결과. */
export function buildMaturationResult(
  cohorts,
  state = COHORT_MAT_STATE,
) {
  if (!cohorts?.length) return null;
  const cfg = {
    anchorDn: state.anchorDn,
    horizons: COHORT_MATUR_CFG.horizons,
    maturedMin: state.maturedMin ?? undefined,
  };
  return COHORT_MATURATION.predictAll(cohorts, null, cfg);
}

/* ============================================================
 * 리텐션 코호트 마감 필터 (§7 미마감 코호트 부풀림 방지, 브랜치 06cda0c)
 * 오늘(로컬 자정) 기준 D일이 지난 코호트(행)만 — 분자·분모 둘 다 동일 필터해야
 * 부풀려지지 않음(분모만 필터하면 오히려 더 부풀려짐). day=0/음수는 필터 불필요.
 * 결정론: Math.random 없음(now는 순수 인자로 주입 가능, 기본은 실제 오늘).
 * ============================================================ */

/* 오늘(로컬) 자정 UTC timestamp — 데이터 최대 날짜가 아닌 실제 오늘 기준. */
export function todayMidnightTs(now) {
  const t = now instanceof Date ? now : new Date();
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
}

/* 마감 코호트만 남기는 순수 필터. maturedOnly=false 또는 day<=0 → 원본 그대로.
 * @param {Array<Object>} rows 표준키 매핑된 rows (r.date = 코호트 날짜)
 * @param {number} day Dn (7·14·30…)
 * @param {boolean} maturedOnly 마감 코호트만 여부
 * @param {number} [nowTs] 기준 자정 ts(테스트 주입용, 기본 오늘) */
export function filterMaturedCohorts(rows, day, maturedOnly, nowTs) {
  if (!maturedOnly || !(day > 0)) return rows;
  const cutoff = (nowTs != null ? nowTs : todayMidnightTs()) - day * 86400000;
  return rows.filter((r) => {
    const d = Date.parse(r.date);
    return isFinite(d) && d <= cutoff;
  });
}

/* 리텐션 곡선 Dn 목록 산출 (D0 항상 100% 앵커 + D1 지원, 브랜치 43e5950).
 * ret_dN(N≥1)이 하나라도 매핑됐을 때만 D0을 곡선 시작점으로 prepend
 * (아무 ret도 없으면 빈 곡선 유지). 반환은 [0, ...매핑된 N] 정렬 배열.
 * @param {Set<string>} mappedSet 매핑된 표준키 집합 */
export function retentionDays(mappedSet) {
  const retDaysMapped = [1, 7, 14, 30, 60, 90, 180, 360].filter((d) =>
    mappedSet.has(`ret_d${d}`),
  );
  return retDaysMapped.length ? [0, ...retDaysMapped] : [];
}

/* 순수함수: 리텐션 히트맵 셀 색상. 실측/예측 구분·null가드·sqrt 단조. */
export function retentionHeatColor(rate, isPredicted) {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return "transparent";
  const clamped = Math.max(0, Math.min(1, rate));
  // 시각적 구분을 위해 sqrt curve로 저값 구간도 살짜기 보이게(0~1 비선형 매핑)
  const intensity = Math.sqrt(clamped);
  const maxAlpha = isPredicted ? 0.22 : 0.42;
  const alpha = (intensity * maxAlpha).toFixed(3);
  const rgb = isPredicted ? "148,163,184" : "173,198,255"; // 예측=슬레이트 / 실측=primary blue
  return `rgba(${rgb},${alpha})`;
}

/* ============================================================
 * ROAS Maturation (5-16) — 조기 ROAS로 성숙 ROAS 예측 (누적 ROAS power 외삽)
 * ============================================================ */
export const MATURATION_STATE = {
  unitField: "_all",
  anchorDns: null, // null = all available Dns; or sorted int[] subset to include in curve fit
  showCurve: true,
  showEmpirical: true,
  targetHorizon: 360, // for anchor sufficiency diagnosis
};

export const MATURATION_MATH = {
  ALL_DNS: [0, 7, 14, 30, 60, 90, 180, 360],
  // power fit y=a*(day+1)^b on [{day, roas}] points
  fit(points) {
    const v = points.filter(
      (p) => p.roas != null && isFinite(p.roas) && p.roas > 0,
    );
    if (v.length < 2) {
      const f = v[0]?.roas ?? null;
      return f != null ? { predict: () => f, kind: "flat" } : null;
    }
    const xs = v.map((p) => Math.log(p.day + 1)),
      ys = v.map((p) => Math.log(p.roas));
    const n = xs.length,
      mx = xs.reduce((a, b) => a + b, 0) / n,
      my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0,
      den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    if (den === 0) {
      const f = v[v.length - 1].roas;
      return { predict: () => f, kind: "flat" };
    }
    const b = num / den,
      a = Math.exp(my - b * mx);
    return {
      predict: (d) => a * Math.pow(d + 1, b),
      a,
      b,
      kind: "power",
    };
  },
  // Empirical completion ratios: for each targetDn, cost-weighted avg(roas[tDn]/roas[anchorDn])
  // among units that have both. returns {tDn: {avg, count}} or null entries if insufficient.
  empiricalRatios(units, anchorDn, targetDns) {
    const result = {};
    for (const tDn of targetDns) {
      if (tDn <= anchorDn) {
        result[tDn] = null;
        continue;
      }
      const complete = units.filter(
        (u) =>
          u.roas[anchorDn] != null &&
          u.roas[tDn] != null &&
          u.roas[anchorDn] > 0,
      );
      if (complete.length < 2) {
        result[tDn] = null;
        continue;
      }
      const tw = complete.reduce((s, u) => s + u.cost, 0);
      if (!tw) {
        result[tDn] = null;
        continue;
      }
      result[tDn] = {
        avg:
          complete.reduce(
            (s, u) => s + (u.roas[tDn] / u.roas[anchorDn]) * u.cost,
            0,
          ) / tw,
        count: complete.length,
      };
    }
    return result;
  },
  // Anchor sufficiency: expand anchor set step-by-step, track D{targetDn} prediction stability
  sufficiency(units, availDns, targetDn, threshold = 0.02) {
    const anchors = [...availDns]
      .filter((d) => d < targetDn)
      .sort((a, b) => a - b);
    if (anchors.length < 2) return null;
    const steps = [];
    for (let i = 2; i <= anchors.length; i++) {
      const set = anchors.slice(0, i);
      const sumR = {},
        sumC = {};
      for (const u of units) {
        for (const d of set) {
          if (u.roas[d] != null && u.cost > 0) {
            sumR[d] = (sumR[d] || 0) + u.roas[d] * u.cost;
            sumC[d] = (sumC[d] || 0) + u.cost;
          }
        }
      }
      const pts = Object.entries(sumR)
        .filter(([d]) => sumC[d] > 0)
        .map(([d, s]) => ({ day: Number(d), roas: s / sumC[d] }))
        .sort((a, b) => a.day - b.day);
      const fit = this.fit(pts);
      const raw = fit ? fit.predict(targetDn) : null;
      const pred = raw != null && isFinite(raw) && raw > 0 ? raw : null;
      const prev = steps.length > 0 ? steps[steps.length - 1].pred : null;
      const chg =
        pred != null && prev != null && prev > 0
          ? Math.abs(pred - prev) / prev
          : null;
      steps.push({
        set,
        pred,
        chg,
        converged: chg != null && chg < threshold,
      });
    }
    const idx = steps.findIndex((s) => s.converged);
    return { steps, convergedAt: idx >= 0 ? steps[idx].set : null };
  },
};

// ROAS maturation grain numeric fields (cost + revenue_dN).
const MATURATION_NUMERIC_FIELDS = [
  "cost",
  ...MATURATION_MATH.ALL_DNS.map((d) => `revenue_d${d}`),
];

/* buildMaturationRows 이식 — index.html의 순수 부분(rows/mapping 명시 인자).
 * MATURATION_STATE(unitField/anchorDns)는 state 인자로 전달. */
export function buildMaturationRows(
  rawRows,
  mapping,
  state = MATURATION_STATE,
) {
  const rows = mapRows(rawRows, mapping, MATURATION_NUMERIC_FIELDS);
  const unit = state.unitField;
  const ALL_DNS = MATURATION_MATH.ALL_DNS;
  const mapped = new Set(Object.values(mapping || {}));
  const isDnMapped = (d) => mapped.has(`revenue_d${d}`);
  const map = new Map();
  for (const r of rows) {
    const k =
      unit === "_all" ? "전체" : String(r[unit] ?? "").trim() || "(미지정)";
    if (!map.has(k)) {
      const e = { unit: k, cost: 0 };
      ALL_DNS.forEach((d) => {
        e[`r${d}`] = 0;
        e[`h${d}`] = false;
      });
      map.set(k, e);
    }
    const b = map.get(k);
    b.cost += Number(r.cost) || 0;
    for (const d of ALL_DNS) {
      if (!isDnMapped(d)) continue;
      const v = r[`revenue_d${d}`];
      const vNum = Number(v);
      if (vNum > 0) {
        b[`r${d}`] += vNum;
        b[`h${d}`] = true;
      }
    }
  }
  // Dns with actual data in at least one unit AND column is mapped
  const availDns = ALL_DNS.filter(
    (d) => isDnMapped(d) && [...map.values()].some((b) => b[`h${d}`]),
  );
  // Selected anchors for curve fit (subset of availDns)
  const selAnchors = state.anchorDns
    ? state.anchorDns.filter((d) => availDns.includes(d))
    : [...availDns];
  // Build unit records
  const units = [...map.values()]
    .map((b) => {
      const roas = {};
      ALL_DNS.forEach((d) => {
        roas[d] = b[`h${d}`] && b.cost > 0 ? b[`r${d}`] / b.cost : null;
      });
      const pts = selAnchors
        .filter((d) => roas[d] != null)
        .map((d) => ({ day: d, roas: roas[d] }));
      return {
        unit: b.unit,
        cost: b.cost,
        roas,
        fit: MATURATION_MATH.fit(pts),
      };
    })
    .sort((a, b) => b.cost - a.cost);
  // Empirical base = highest anchor where ALL units have observed data (so every unit gets a prediction)
  // Falls back to highest with any unit observed if "all" requirement can't be met
  const empiricalBase = (() => {
    if (!units.length) return null;
    return (
      [...selAnchors]
        .reverse()
        .find((d) => units.every((u) => u.roas[d] != null)) ??
      [...selAnchors].reverse().find((d) => units.some((u) => u.roas[d] != null)) ??
      null
    );
  })();
  const targetDns = ALL_DNS.filter(
    (d) => empiricalBase != null && d > empiricalBase,
  );
  const empRatios =
    empiricalBase != null
      ? MATURATION_MATH.empiricalRatios(units, empiricalBase, targetDns)
      : {};
  return { units, availDns, selAnchors, empiricalBase, empRatios };
}
