export const STATS = (() => {
  function erf(x) {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592,
      a2 = -0.284496736,
      a3 = 1.421413741,
      a4 = -1.453152027,
      a5 = 1.061405429,
      p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y =
      1 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
        t *
        Math.exp(-x * x);
    return sign * y;
  }
  function normalCDF(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
  }

  function normalInverse(p) {
    if (p <= 0 || p >= 1) return NaN;
    const a = [
      -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
    ];
    const b = [
      -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1,
    ];
    const c = [
      -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783,
    ];
    const d = [
      7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
      3.754408661907416,
    ];
    const pLow = 0.02425,
      pHigh = 1 - pLow;
    let q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q +
          c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      );
    }
    if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (
        ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r +
          a[5]) *
          q) /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
      );
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q +
        c[5]
      ) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  function studentTCDF(t, v) {
    if (v <= 0) return NaN;
    if (v === 1) return 0.5 + Math.atan(t) / Math.PI; // Exact for Cauchy
    if (v > 1000) return normalCDF(t);
    // Hill-Davis (1968) approximation for Student's T CDF
    const t2 = t * t;
    const t4 = t2 * t2;
    const t6 = t4 * t2;
    const z = t * (
      1 
      - (t2 + 3) / (4 * v) 
      + (5 * t4 + 16 * t2 + 3) / (96 * v * v) 
      + (3 * t6 + 19 * t4 + 17 * t2 - 15) / (384 * v * v * v)
    );
    return normalCDF(z);
  }

  function sampleSizePerArm({
    baseline,
    mdeRelative,
    alpha = 0.05,
    power = 0.8,
    twoSided = true,
  }) {
    const p1 = baseline;
    const p2 = baseline * (1 + mdeRelative);
    if (p2 <= 0 || p2 >= 1) return { n: NaN, p1, p2 };
    const pBar = (p1 + p2) / 2;
    const zA = twoSided
      ? normalInverse(1 - alpha / 2)
      : normalInverse(1 - alpha);
    const zB = normalInverse(power);
    const num = 2 * Math.pow(zA + zB, 2) * pBar * (1 - pBar);
    const den = Math.pow(p2 - p1, 2);
    return { n: Math.ceil(num / den), p1, p2, zA, zB };
  }

  function twoPropZTest(nA, xA, nB, xB) {
    const pA = xA / nA,
      pB = xB / nB;
    const pPool = (xA + xB) / (nA + nB);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
    const z = se > 0 ? (pB - pA) / se : 0;
    const pValue = 2 * (1 - normalCDF(Math.abs(z)));
    const liftAbs = pB - pA;
    const liftRel = pA > 0 ? (pB - pA) / pA : 0;
    const seDiff = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
    const ciLow95 = liftAbs - 1.96 * seDiff;
    const ciHigh95 = liftAbs + 1.96 * seDiff;
    return { pA, pB, liftAbs, liftRel, z, pValue, ciLow95, ciHigh95 };
  }

  function randGamma(shape) {
    if (shape < 1) {
      const u = Math.random();
      return randGamma(shape + 1) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, v;
      do {
        x = randNormal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v)))
        return d * v;
    }
  }
  function randNormal() {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function randBeta(alpha, beta) {
    const x = randGamma(alpha);
    const y = randGamma(beta);
    return x / (x + y);
  }
  function bayesianAB({
    nA,
    xA,
    nB,
    xB,
    sims = 10000,
    priorAlpha = 1,
    priorBeta = 1,
  }) {
    const aA = priorAlpha + xA,
      bA = priorBeta + (nA - xA);
    const aB = priorAlpha + xB,
      bB = priorBeta + (nB - xB);
    let winB = 0,
      sumLift = 0;
    const samplesA = [],
      samplesB = [];
    for (let i = 0; i < sims; i++) {
      const pA = randBeta(aA, bA);
      const pB = randBeta(aB, bB);
      if (pB > pA) winB++;
      sumLift += pA > 0 ? (pB - pA) / pA : 0;
      samplesA.push(pA);
      samplesB.push(pB);
    }
    samplesA.sort((a, b) => a - b);
    samplesB.sort((a, b) => a - b);
    return {
      probBWins: winB / sims,
      expectedLift: sumLift / sims,
      ciA: [
        samplesA[Math.floor(sims * 0.025)],
        samplesA[Math.floor(sims * 0.975)],
      ],
      ciB: [
        samplesB[Math.floor(sims * 0.025)],
        samplesB[Math.floor(sims * 0.975)],
      ],
    };
  }

  function sampleSizeContinuous({
    baselineMean,
    mdeRelative,
    sigma,
    alpha = 0.05,
    power = 0.8,
    twoSided = true,
  }) {
    const delta = baselineMean * mdeRelative;
    if (delta === 0 || sigma <= 0) return { n: NaN, delta, sigma };
    const zA = twoSided
      ? normalInverse(1 - alpha / 2)
      : normalInverse(1 - alpha);
    const zB = normalInverse(power);
    const num = 2 * Math.pow(zA + zB, 2) * sigma * sigma;
    const den = delta * delta;
    return { n: Math.ceil(num / den), delta, sigma, zA, zB };
  }

  function continuousTest(nA, meanA, sdA, nB, meanB, sdB) {
    const seA2 = (sdA * sdA) / nA;
    const seB2 = (sdB * sdB) / nB;
    const se = Math.sqrt(seA2 + seB2);
    const z = se > 0 ? (meanB - meanA) / se : 0; // z is actually t-statistic here
    const df =
      (seA2 + seB2) ** 2 /
      ((seA2 * seA2) / Math.max(1, nA - 1) + (seB2 * seB2) / Math.max(1, nB - 1));
    const pValue = 2 * (1 - studentTCDF(Math.abs(z), df));
    const liftAbs = meanB - meanA;
    const liftRel = meanA > 0 ? (meanB - meanA) / meanA : 0;
    
    // Calculate critical t-value for 95% CI (two-tailed). Since normalInverse is standard normal,
    // we use a simple normal approx for CI bound if df is large, else we could invert the t-dist.
    // For simplicity and speed, we will approximate t-critical for 95% CI
    // t_crit ~ z_crit + (z_crit^3 + z_crit)/(4*df)
    const zCrit = 1.95996;
    const tCrit = zCrit + (Math.pow(zCrit, 3) + zCrit) / (4 * df);
    
    const ciLow95 = liftAbs - tCrit * se;
    const ciHigh95 = liftAbs + tCrit * se;
    return {
      meanA,
      meanB,
      sdA,
      sdB,
      liftAbs,
      liftRel,
      z,
      pValue,
      ciLow95,
      ciHigh95,
      df,
    };
  }

  function budgetForTest({ nPerArm, cprA, cprB }) {
    const cprBuse = cprB != null && !isNaN(cprB) ? cprB : cprA;
    const costA = nPerArm * cprA;
    const costB = nPerArm * cprBuse;
    return { costA, costB, total: costA + costB, cprA, cprB: cprBuse };
  }

  function massReadout(arms, CREATIVE_STATS) {
    const control = arms.find((a) => a.isControl) || arms[0];
    if (!control || !control.n || control.n <= 0)
      return { control: null, rows: [] };
    const rows = arms.map((a) => {
      if (a === control) {
        return {
          name: a.name,
          n: a.n,
          x: a.x,
          isControl: true,
          rate: a.n > 0 ? a.x / a.n : 0,
          liftRel: 0,
          z: 0,
          pValue: 1,
          ciLow95: 0,
          ciHigh95: 0,
          probBWins: 0.5,
          sig: false,
        };
      }
      const freq = twoPropZTest(control.n, control.x, a.n, a.x);
      const probBWins =
        typeof CREATIVE_STATS !== "undefined"
          ? CREATIVE_STATS.betaProbGreater(control.x, control.n, a.x, a.n)
          : NaN;
      return {
        name: a.name,
        n: a.n,
        x: a.x,
        isControl: false,
        rate: freq.pB,
        liftRel: freq.liftRel,
        z: freq.z,
        pValue: freq.pValue,
        ciLow95: freq.ciLow95,
        ciHigh95: freq.ciHigh95,
        probBWins,
        sig: freq.pValue < 0.05,
      };
    });
    return { control, rows };
  }

  function mdeForSampleSize({
    baseline,
    n,
    alpha = 0.05,
    power = 0.8,
    twoSided = true,
    maxMde = 5,
  }) {
    if (!(baseline > 0) || baseline >= 1 || !(n > 0)) return NaN;
    let lo = 1e-6,
      hi = maxMde;
    for (let i = 0; i < 30; i++) {
      const nHi = sampleSizePerArm({
        baseline,
        mdeRelative: hi,
        alpha,
        power,
        twoSided,
      }).n;
      if (isFinite(nHi) && nHi <= n) break;
      hi *= 1.6;
      if (hi > 50) break;
    }
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const r = sampleSizePerArm({
        baseline,
        mdeRelative: mid,
        alpha,
        power,
        twoSided,
      });
      if (!isFinite(r.n) || isNaN(r.n) || r.n > n) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  function powerCurve({
    baseline,
    alpha = 0.05,
    power = 0.8,
    points = 24,
    nMin = 200,
    nMax = 200000,
  }) {
    const out = [];
    const logMin = Math.log(nMin),
      logMax = Math.log(nMax);
    for (let i = 0; i < points; i++) {
      const n = Math.round(
        Math.exp(logMin + ((logMax - logMin) * i) / (points - 1)),
      );
      const mde = mdeForSampleSize({ baseline, n, alpha, power });
      out.push({ n, mdePct: isFinite(mde) ? mde * 100 : null });
    }
    return out;
  }

  return {
    normalCDF,
    normalInverse,
    studentTCDF,
    sampleSizePerArm,
    twoPropZTest,
    bayesianAB,
    sampleSizeContinuous,
    continuousTest,
    budgetForTest,
    massReadout,
    mdeForSampleSize,
    powerCurve,
  };
})();
