// index.html CREATIVE_CONFIG.bayes 상수(priorA/priorB/gridN) — betaProbGreater 모듈 클로저 이식.
// index 원본 시그니처: betaProbGreater(xA,nA,xB,nB, gridN=CREATIVE_CONFIG.bayes.gridN), priorA/priorB는 모듈 상수.
export const CREATIVE_BAYES = { priorA: 1, priorB: 1, gridN: 2000 };

export const CREATIVE_MATH = {
  transpose(M) {
    const r = M.length,
      c = M[0]?.length || 0;
    const out = Array.from({ length: c }, () => new Array(r));
    for (let i = 0; i < r; i++)
      for (let j = 0; j < c; j++) out[j][i] = M[i][j];
    return out;
  },
  matmul(A, B) {
    const ar = A.length,
      ac = A[0]?.length || 0,
      bc = B[0]?.length || 0;
    const out = Array.from({ length: ar }, () => new Array(bc).fill(0));
    for (let i = 0; i < ar; i++)
      for (let k = 0; k < ac; k++) {
        const aik = A[i][k];
        for (let j = 0; j < bc; j++) out[i][j] += aik * B[k][j];
      }
    return out;
  },
  inverse(M) {
    const n = M.length;
    const a = M.map((r) => r.slice());
    const I = Array.from({ length: n }, (_, i) => {
      const row = new Array(n).fill(0);
      row[i] = 1;
      return row;
    });
    for (let i = 0; i < n; i++) {
      let piv = i,
        max = Math.abs(a[i][i]);
      for (let r = i + 1; r < n; r++) {
        if (Math.abs(a[r][i]) > max) {
          max = Math.abs(a[r][i]);
          piv = r;
        }
      }
      if (max < 1e-12) return null; // singular
      if (piv !== i) {
        [a[i], a[piv]] = [a[piv], a[i]];
        [I[i], I[piv]] = [I[piv], I[i]];
      }
      const div = a[i][i];
      for (let j = 0; j < n; j++) {
        a[i][j] /= div;
        I[i][j] /= div;
      }
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const f = a[r][i];
        if (f === 0) continue;
        for (let j = 0; j < n; j++) {
          a[r][j] -= f * a[i][j];
          I[r][j] -= f * I[i][j];
        }
      }
    }
    return I;
  },
  demean(rows, groupKey) {
    if (!groupKey) return rows;
    const groups = new Map();
    for (const r of rows) {
      const g = r[groupKey] ?? "_";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    return rows;
  },
  demeanColumn(values, groupKeys) {
    const sum = new Map(),
      cnt = new Map();
    for (let i = 0; i < values.length; i++) {
      const g = groupKeys[i];
      sum.set(g, (sum.get(g) || 0) + values[i]);
      cnt.set(g, (cnt.get(g) || 0) + 1);
    }
    const mean = new Map();
    for (const [g, s] of sum) mean.set(g, s / cnt.get(g));
    return values.map((v, i) => v - mean.get(groupKeys[i]));
  },
  wlsSolve(X, y, w, dfLoss = 0) {
    const n = X.length,
      p = X[0]?.length || 0;
    if (n < p + dfLoss + 1) return null;
    const XtWX = Array.from({ length: p }, () => new Array(p).fill(0));
    const XtWy = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const wi = w[i];
      for (let j = 0; j < p; j++) {
        XtWy[j] += X[i][j] * wi * y[i];
        for (let k = 0; k < p; k++) XtWX[j][k] += X[i][j] * wi * X[i][k];
      }
    }
    const inv = this.inverse(XtWX);
    if (!inv) return null;
    const beta = new Array(p).fill(0);
    for (let j = 0; j < p; j++)
      for (let k = 0; k < p; k++) beta[j] += inv[j][k] * XtWy[k];
    let rss = 0,
      tss = 0;
    const wMean =
      y.reduce((a, yi, i) => a + w[i] * yi, 0) /
      w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) {
      let yhat = 0;
      for (let j = 0; j < p; j++) yhat += X[i][j] * beta[j];
      const e = y[i] - yhat;
      rss += w[i] * e * e;
      tss += w[i] * (y[i] - wMean) ** 2;
    }
    const dof = Math.max(1, n - p - dfLoss);
    const sigma2 = rss / dof;
    const se = new Array(p);
    for (let j = 0; j < p; j++)
      se[j] = Math.sqrt(Math.max(0, sigma2 * inv[j][j]));
    const R2 = tss > 0 ? 1 - rss / tss : 0;
    return { beta, se, sigma2, R2, n, p, dof };
  },
  vif(X) {
    const n = X.length,
      p = X[0]?.length || 0;
    const vifs = new Array(p).fill(0);
    for (let j = 0; j < p; j++) {
      const yj = X.map((r) => r[j]);
      const Xj = X.map((r) => r.filter((_, k) => k !== j));
      if (Xj[0].length === 0) {
        vifs[j] = 1;
        continue;
      }
      const w = new Array(n).fill(1);
      const fit = this.wlsSolve(Xj, yj, w);
      const r2 = fit ? fit.R2 : 0;
      vifs[j] = 1 / Math.max(0.001, 1 - r2);
    }
    return vifs;
  },
};

export const CREATIVE_FATIGUE = {
  olsSlope(values) {
    const pts = values
      .map((v, i) => ({ x: i, y: v }))
      .filter((p) => p.y != null && isFinite(p.y));
    const n = pts.length;
    if (n < 2) return null;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p.y, 0) / n;
    let sxy = 0,
      sxx = 0;
    for (const p of pts) {
      sxy += (p.x - mx) * (p.y - my);
      sxx += (p.x - mx) ** 2;
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    return { slope, intercept, n };
  },
  buildDailySeries(series) {
    return series.map((r) => {
      const imp = Number(r.impressions) || 0;
      const clk = Number(r.clicks) || 0;
      const spend = Number(r.spend ?? r.cost) || 0;
      return {
        date: r.date,
        ctr: imp > 0 ? clk / imp : null,
        impressions: imp,
        cpm: imp > 0 ? (spend / imp) * 1000 : null,
      };
    });
  },
  compositeIndex(dailySeries, cfg) {
    const W = cfg.trendWindow;
    const recent = dailySeries.slice(-W);
    if (recent.length < cfg.minDays) return null;
    const ctrVals = recent.map((d) => d.ctr);
    const freqVals = recent.map((d) => d.impressions);
    const cpmVals = recent.map((d) => d.cpm);
    const ctrFit = this.olsSlope(ctrVals);
    const freqFit = this.olsSlope(freqVals);
    const cpmFit = this.olsSlope(cpmVals);
    const meanOf = (arr) => {
      const v = arr.filter((x) => x != null && isFinite(x));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const ctrMean = meanOf(ctrVals);
    const freqMean = meanOf(freqVals);
    const cpmMean = meanOf(cpmVals);
    const ctrPctPerDay = ctrFit && ctrMean ? ctrFit.slope / ctrMean : 0;
    const freqPctPerDay = freqFit && freqMean ? freqFit.slope / freqMean : 0;
    const cpmPctPerDay = cpmFit && cpmMean ? cpmFit.slope / cpmMean : 0;
    const ctrRisk = Math.max(0, -ctrPctPerDay);
    const freqRisk = Math.max(0, freqPctPerDay);
    const cpmRisk = Math.max(0, cpmPctPerDay);
    const raw =
      cfg.ctrWeight * ctrRisk +
      cfg.freqWeight * freqRisk +
      cfg.cpmWeight * cpmRisk;
    const score = Math.max(0, Math.min(1, Math.tanh(raw * 20)));
    return {
      score,
      ctrTrendPctPerDay: ctrPctPerDay,
      freqTrendPctPerDay: freqPctPerDay,
      cpmTrendPctPerDay: cpmPctPerDay,
      n: recent.length,
    };
  },
  projectThreshold(dailySeries, cfg) {
    const W = cfg.trendWindow;
    const recent = dailySeries.slice(-W);
    if (recent.length < cfg.minDays)
      return { etaDays: null, reason: "데이터 부족" };
    const half = Math.floor(recent.length / 2);
    if (half < 2) return { etaDays: null, reason: "데이터 부족" };
    const idxFirst = this.compositeIndex(
      recent.slice(0, Math.max(cfg.minDays, half)),
      cfg,
    );
    const idxSecond = this.compositeIndex(recent, cfg);
    if (!idxFirst || !idxSecond)
      return { etaDays: null, reason: "데이터 부족" };
    const cur = idxSecond.score;
    if (cur >= cfg.alertScore)
      return { etaDays: 0, reason: "이미 임계 도달" };
    const deltaPerHalfWindow = idxSecond.score - idxFirst.score;
    const halfWindowDays = Math.max(
      1,
      recent.length - Math.max(cfg.minDays, half),
    );
    const ratePerDay = deltaPerHalfWindow / halfWindowDays;
    if (ratePerDay <= 0)
      return { etaDays: null, reason: "악화 추세 없음" };
    const remaining = cfg.alertScore - cur;
    const eta = remaining / ratePerDay;
    if (!isFinite(eta) || eta < 0)
      return { etaDays: null, reason: "추정 불가" };
    if (eta > cfg.horizonDays)
      return {
        etaDays: null,
        reason: `horizon(${cfg.horizonDays}일) 밖`,
      };
    return { etaDays: Math.round(eta), reason: "추세 외삽" };
  },
  buildAlerts(rows, cfg) {
    const byId = new Map();
    for (const r of rows) {
      if (!r.creative_id || !r.date) continue;
      if (!byId.has(r.creative_id)) byId.set(r.creative_id, []);
      byId.get(r.creative_id).push(r);
    }
    const out = [];
    for (const [id, series] of byId) {
      const sorted = series.slice().sort((a, b) => a.date.localeCompare(b.date));
      const daily = this.buildDailySeries(sorted);
      const idx = this.compositeIndex(daily, cfg);
      const proj = this.projectThreshold(daily, cfg);
      const channel = sorted[0]?.channel || null;
      out.push({
        creative_id: id,
        channel,
        days: sorted.length,
        score: idx ? idx.score : null,
        ctrTrendPctPerDay: idx ? idx.ctrTrendPctPerDay : null,
        freqTrendPctPerDay: idx ? idx.freqTrendPctPerDay : null,
        cpmTrendPctPerDay: idx ? idx.cpmTrendPctPerDay : null,
        alert: idx ? idx.score >= cfg.alertScore : false,
        etaDays: proj.etaDays,
        etaReason: proj.reason,
        lastDate: sorted[sorted.length - 1].date,
      });
    }
    return out;
  },
  buildPlan(alerts, weeklyVelocity, cfg) {
    const wv = Math.max(
      0.01,
      Number(weeklyVelocity) || cfg.defaultWeeklyVelocity,
    );
    const candidates = alerts
      .filter((a) => a.score != null)
      .slice()
      .sort((a, b) => {
        if (a.alert !== b.alert) return a.alert ? -1 : 1;
        const ea = a.etaDays == null ? Infinity : a.etaDays;
        const eb = b.etaDays == null ? Infinity : b.etaDays;
        if (ea !== eb) return ea - eb;
        return (b.score || 0) - (a.score || 0);
      });
    const plan = candidates.map((a, i) => {
      const weekIdx = Math.floor(i / wv);
      const urgency = a.alert
        ? "urgent"
        : a.etaDays != null && a.etaDays <= cfg.urgentDays
          ? "urgent"
          : a.etaDays != null && a.etaDays <= cfg.soonDays
            ? "soon"
            : "planned";
      return { ...a, queueRank: i + 1, scheduledWeek: weekIdx, urgency };
    });
    const urgentCount = plan.filter((p) => p.urgency === "urgent").length;
    const weeksNeededForUrgent = wv > 0 ? Math.ceil(urgentCount / wv) : null;
    const recommendedWeeklyVelocity = urgentCount > 0 ? urgentCount : 0;
    return {
      weeklyVelocity: wv,
      plan,
      urgentCount,
      weeksNeededForUrgent,
      recommendedWeeklyVelocity,
      isUndersupplied: recommendedWeeklyVelocity > wv,
    };
  },
  ganttBuckets(plan, maxWeeks = 8) {
    const buckets = Array.from({ length: maxWeeks }, (_, w) => ({
      week: w,
      items: [],
    }));
    for (const p of plan) {
      const w = Math.min(p.scheduledWeek, maxWeeks - 1);
      buckets[w].items.push(p);
    }
    return buckets;
  },
};

export const CREATIVE_STATS = {
  safeDiv(num, den) {
    const n = Number(num) || 0;
    const d = Number(den) || 0;
    return d > 0 ? n / d : null;
  },
  deriveMetrics(rows) {
    const map = new Map();
    for (const r of rows) {
      if (!r.creative_id) continue;
      const id = r.creative_id;
      if (!map.has(id)) {
        map.set(id, {
          creative_id: id,
          channel: r.channel,
          campaign_id: r.campaign_id || null,
          impressions: 0,
          clicks: 0,
          installs: 0,
          actions: 0,
          spend: 0,
          video_3s_views: null,
          video_completions: null,
          revenue_d7: null,
          hook_type: r.hook_type,
          message_angle: r.message_angle,
          first_3s: r.first_3s,
          format: r.format,
          has_text_overlay: r.has_text_overlay,
          cta_style: r.cta_style,
          duration_bucket: r.duration_bucket,
          audience_segment: r.audience_segment,
          dates: new Set(),
        });
      }
      const b = map.get(id);
      b.impressions += Number(r.impressions) || 0;
      b.clicks += Number(r.clicks) || 0;
      b.installs += Number(r.installs) || 0;
      b.actions += Number(r.actions) || 0;
      b.spend += Number(r.spend || r.cost) || 0;
      if (r.video_3s_views != null && r.video_3s_views !== "") {
        b.video_3s_views =
          (b.video_3s_views || 0) + (Number(r.video_3s_views) || 0);
      }
      if (r.video_completions != null && r.video_completions !== "") {
        b.video_completions =
          (b.video_completions || 0) + (Number(r.video_completions) || 0);
      }
      if (r.revenue_d7 != null && r.revenue_d7 !== "") {
        b.revenue_d7 = (b.revenue_d7 || 0) + (Number(r.revenue_d7) || 0);
      }
      if (r.date) b.dates.add(r.date);
    }
    return [...map.values()].map((b) => ({
      ...b,
      days: b.dates.size,
      ctr: this.safeDiv(b.clicks, b.impressions),
      cvr: this.safeDiv(b.installs, b.clicks),
      ipm: this.safeDiv(b.installs * 1000, b.impressions),
      cpi: this.safeDiv(b.spend, b.installs),
      cpa: this.safeDiv(b.spend, b.actions),
      hook_rate: this.safeDiv(b.video_3s_views, b.impressions),
      completion: this.safeDiv(
        b.video_completions,
        b.video_3s_views ?? b.impressions,
      ),
      roas: this.safeDiv(b.revenue_d7, b.spend),
      dates: undefined,
    }));
  },
  isoWeek(dateStr) {
    const d = new Date(dateStr);
    const target = new Date(d.valueOf());
    const dayNr = (d.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = new Date(
      Date.UTC(target.getUTCFullYear(), 0, 4),
    );
    const diff = target - firstThursday;
    const week = 1 + Math.round(diff / (7 * 86400000));
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  },
  // WLS 기반 LPM decompose (index.html CREATIVE_STATS.decompose 이식 — verbatim).
  // metric='ctr'|'cpa'|'roas'|'ipm'. attribute는 controls + active attrs로 더미 인코딩.
  // campaign_id는 within-transform(demean)으로 흡수 후 절편 제거(FWL 정석). weight =
  // 비율의 분모(impressions/actions/spend) — CPA·ROAS는 각자 분모로 가중해야 통계적으로 정당.
  decompose(rows, opts, CREATIVE_CONFIG) {
    const metric = opts.metric;
    const activeAttrs = opts.attributes; // ['hook_type','format', ...] 사용자 토글
    const controls = ["channel", "iso_week"];
    const cfg = CREATIVE_CONFIG.decompose;
    // valid rows: impressions ≥ min, ratio finite, attribute 모두 non-null
    const valid = rows.filter((r) => {
      if ((Number(r.impressions) || 0) < CREATIVE_CONFIG.minImpressions)
        return false;
      const ratio =
        metric === "ctr"
          ? this.safeDiv(r.clicks, r.impressions)
          : metric === "cpa"
            ? this.safeDiv(r.spend, r.actions)
            : metric === "roas"
              ? this.safeDiv(r.revenue_d7, r.spend)
              : metric === "ipm"
                ? this.safeDiv(r.installs * 1000, r.impressions)
                : metric === "cvr"
                  ? this.safeDiv(r.installs, r.clicks)
                  : null;
      if (ratio == null || !isFinite(ratio)) return false;
      for (const a of activeAttrs) {
        if (r[a] == null || r[a] === "") return false;
      }
      return true;
    });
    if (valid.length < 30)
      return {
        effects: [],
        dropped: ["데이터 부족 (<30 row)"],
        diag: { n: valid.length },
      };
    const rowsWithExtras = valid.map((r) => ({
      ...r,
      iso_week: this.isoWeek(r.date),
      _metricVal:
        metric === "ctr"
          ? r.clicks / r.impressions
          : metric === "cpa"
            ? r.spend / r.actions
            : metric === "roas"
              ? r.revenue_d7 / r.spend
              : metric === "cvr"
                ? r.installs / r.clicks
                : (r.installs * 1000) / r.impressions,
      // 가중치 = 비율의 정밀도를 좌우하는 분모(노출/액션/지출). CPA·ROAS는 노출이 아니라
      // 각자의 분모로 가중해야 통계적으로 정당함(작은 분모=노이즈 큰 추정치).
      _w:
        metric === "cpa"
          ? Number(r.actions) || 0
          : metric === "roas"
            ? Number(r.spend) || 0
            : metric === "cvr"
              ? Number(r.clicks) || 0
              : Number(r.impressions) || 0,
    }));
    const factorCols = []; // [{factor, level, ref}]
    const allFactors = [...activeAttrs, ...controls];
    const factorLevels = {};
    for (const f of allFactors) {
      const lvSet = new Set(
        rowsWithExtras
          .map((r) => r[f])
          .filter((v) => v != null && v !== ""),
      );
      const levels = [...lvSet].sort();
      factorLevels[f] = levels;
      // reference = 가장 흔한 level (n 최대)
      const counts = {};
      for (const r of rowsWithExtras)
        counts[r[f]] = (counts[r[f]] || 0) + 1;
      const ref = levels.reduce(
        (a, b) => (counts[a] >= counts[b] ? a : b),
        levels[0],
      );
      for (const lv of levels) {
        if (lv === ref) continue;
        factorCols.push({ factor: f, level: lv, ref });
      }
    }
    // X 행렬: [1, ...factorCols dummies]. 절편은 col 0.
    let X = rowsWithExtras.map((r) => {
      const row = [1];
      for (const fc of factorCols)
        row.push(r[fc.factor] === fc.level ? 1 : 0);
      return row;
    });
    let y = rowsWithExtras.map((r) => r._metricVal);
    const w = rowsWithExtras.map((r) => r._w);
    let hasIntercept = true;
    // campaign_id within-transformation (FWL). demean은 dummy 컬럼(1..p)만, 절편(col 0) 제외.
    if (rowsWithExtras[0].campaign_id) {
      const camp = rowsWithExtras.map((r) => r.campaign_id || "_");
      y = CREATIVE_MATH.demeanColumn(y, camp);
      for (let j = 1; j < X[0].length; j++) {
        const colVals = X.map((r) => r[j]);
        const dem = CREATIVE_MATH.demeanColumn(colVals, camp);
        for (let i = 0; i < X.length; i++) X[i][j] = dem[i];
      }
      // ⚠ within-transform 후 절편 제거(FWL 정석) — 상수 1열을 그룹평균(=1)으로 빼면 전 행이
      // 0이 돼 X'X가 특이행렬이 되고, 1로 남기면 가중치 큰 데이터에서 절편 대각항만 거대해져
      // ill-conditioned(SE 폭발·음수 R²). demean이 모든 그룹평균을 흡수하므로 절편 불필요.
      X = X.map((row) => row.slice(1));
      hasIntercept = false;
    }
    const off = hasIntercept ? 1 : 0; // beta/X에서 factorCols 시작 오프셋
    // VIF 체크 + 제거
    const dropped = [];
    let curX = X,
      curCols = factorCols.slice();
    let safety = 0;
    while (safety++ < 10) {
      const subX = curX.map((r) => r.slice(off));
      if (subX[0].length === 0) break;
      // campaign_id demean 후 분산 0이 된 컬럼(완전 공선)은 VIF가 못 잡으므로 먼저 직접 제거.
      let zeroVarIdx = -1;
      for (let j = 0; j < subX[0].length; j++) {
        const col = subX.map((r) => r[j]);
        if (Math.max(...col) - Math.min(...col) < 1e-9) {
          zeroVarIdx = j;
          break;
        }
      }
      if (zeroVarIdx !== -1) {
        const dc = curCols[zeroVarIdx];
        dropped.push(
          `${dc.factor}=${dc.level} (campaign_id와 완전 공선 — 분산 0)`,
        );
        curX = curX.map((r) => r.filter((_, k) => k !== zeroVarIdx + off));
        curCols = curCols.filter((_, k) => k !== zeroVarIdx);
        continue;
      }
      const vifs = CREATIVE_MATH.vif(subX);
      const maxVif = Math.max(...vifs);
      if (maxVif < cfg.vifThreshold) break;
      let dropIdx = -1,
        dropPri = -1;
      for (let j = 0; j < vifs.length; j++) {
        if (vifs[j] < cfg.vifThreshold) continue;
        const pri = cfg.vifDropPriority.indexOf(curCols[j].factor);
        const priorityScore = pri >= 0 ? 1000 - pri : 0;
        if (
          priorityScore > dropPri ||
          (priorityScore === dropPri && vifs[j] > vifs[dropIdx])
        ) {
          dropIdx = j;
          dropPri = priorityScore;
        }
      }
      if (dropIdx === -1) break;
      const dc = curCols[dropIdx];
      dropped.push(
        `${dc.factor}=${dc.level} (VIF=${vifs[dropIdx].toFixed(2)})`,
      );
      curX = curX.map((r) => r.filter((_, k) => k !== dropIdx + off));
      curCols = curCols.filter((_, k) => k !== dropIdx);
    }
    const fit = CREATIVE_MATH.wlsSolve(curX, y, w);
    if (!fit)
      return {
        effects: [],
        dropped,
        diag: { error: "행렬 특이값 — control 매핑 부족" },
      };
    // p-values (z-test 근사). off=절편 유무에 따른 factorCols 시작 인덱스.
    const effects = [];
    const pvals = [];
    for (let j = off; j < fit.beta.length; j++) {
      const z = fit.se[j] > 0 ? fit.beta[j] / fit.se[j] : 0;
      const p = 2 * (1 - this.stdNormalCdf(Math.abs(z)));
      pvals.push(p);
      effects.push({
        factor: curCols[j - off].factor,
        level: curCols[j - off].level,
        ref: curCols[j - off].ref,
        coef: fit.beta[j],
        se: fit.se[j],
        z,
        p,
        ciLow: fit.beta[j] - 1.96 * fit.se[j],
        ciHigh: fit.beta[j] + 1.96 * fit.se[j],
        n: rowsWithExtras.filter(
          (r) => r[curCols[j - off].factor] === curCols[j - off].level,
        ).length,
      });
    }
    const pAdj = this.bhAdjust(pvals);
    effects.forEach((e, i) => (e.pAdj = pAdj[i]));
    return {
      effects,
      dropped,
      diag: { n: rowsWithExtras.length, R2: fit.R2, factorLevels },
    };
  },
  stdNormalCdf(z) {
    if (z < 0) return 1 - this.stdNormalCdf(-z);
    const t = 1 / (1 + 0.2316419 * z);
    const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
    const cdf =
      1 -
      d *
        t *
        (0.31938153 +
          t *
            (-0.356563782 +
              t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return Math.min(1, Math.max(0, cdf));
  },
  stdNormalInv(p) {
    if (p < 0.5) return -this.stdNormalInv(1 - p);
    const t = Math.sqrt(-2.0 * Math.log(1 - p));
    const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
    const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
    return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
  },
  bhAdjust(pvals) {
    const n = pvals.length;
    if (n === 0) return [];
    const sorted = pvals
      .map((p, i) => ({ p, i }))
      .sort((a, b) => a.p - b.p);
    const out = new Array(n);
    let prev = 1;
    for (let k = n - 1; k >= 0; k--) {
      const adj = Math.min(prev, (sorted[k].p * n) / (k + 1));
      out[sorted[k].i] = adj;
      prev = adj;
    }
    return out;
  },
  fatigueDetect(rows, metric = "ctr", CREATIVE_CONFIG) {
    const byId = new Map();
    for (const r of rows) {
      if (!r.creative_id || !r.date) continue;
      if (!byId.has(r.creative_id)) byId.set(r.creative_id, []);
      byId.get(r.creative_id).push(r);
    }
    const out = [];
    for (const [id, series] of byId) {
      series.sort((a, b) => a.date.localeCompare(b.date));
      const W = CREATIVE_CONFIG.fatigue.decayWindow;
      const vals = series.map((r) =>
        metric === "ctr"
          ? this.safeDiv(r.clicks, r.impressions)
          : metric === "cvr"
            ? this.safeDiv(r.installs, r.clicks)
            : this.safeDiv(r.installs * 1000, r.impressions),
      );
      const rolling = vals.map((_, i) => {
        const start = Math.max(0, i - W + 1);
        const slice = vals
          .slice(start, i + 1)
          .filter((v) => v != null && isFinite(v));
        return slice.length
          ? slice.reduce((a, b) => a + b, 0) / slice.length
          : null;
      });
      const validRolling = rolling
        .map((v, i) => ({ v, i }))
        .filter((x) => x.v != null);
      if (validRolling.length < 3) {
        out.push({
          creative_id: id,
          fatigued: false,
          reason: "데이터 부족",
        });
        continue;
      }
      const peak = validRolling.reduce((a, b) => (b.v > a.v ? b : a));
      const after = validRolling.filter((x) => x.i > peak.i);
      const minAfter = after.length
        ? after.reduce((a, b) => (b.v < a.v ? b : a))
        : peak;
      const dropPct = peak.v > 0 ? (peak.v - minAfter.v) / peak.v : 0;
      const fatigued =
        dropPct >= CREATIVE_CONFIG.fatigue.dropPct && after.length >= W;
      out.push({
        creative_id: id,
        fatigued,
        peakDate: series[peak.i].date,
        peakValue: peak.v,
        currentValue: rolling[rolling.length - 1],
        dropPct,
        lifespanDays: series.length,
      });
    }
    return out;
  },
  conceptMatrix(metrics, axesCfg, CREATIVE_CONFIG) {
    const { rows: rowAttr, cols: colAttr } = axesCfg;
    const cells = new Map();
    const rowSet = new Set(),
      colSet = new Set();
    for (const m of metrics) {
      const rk = m[rowAttr];
      const ck = m[colAttr];
      if (!rk || !ck) continue;
      rowSet.add(rk);
      colSet.add(ck);
      const key = `${rk}|${ck}`;
      if (!cells.has(key))
        cells.set(key, {
          row: rk,
          col: ck,
          impressions: 0,
          clicks: 0,
          installs: 0,
          spend: 0,
          n: 0,
        });
      const c = cells.get(key);
      c.impressions += m.impressions;
      c.clicks += m.clicks;
      c.installs += m.installs;
      c.spend += m.spend;
      c.n++;
    }
    const rowsArr = [...rowSet].sort(),
      colsArr = [...colSet].sort();
    const grid = rowsArr.map((r) =>
      colsArr.map((c) => {
        const cell = cells.get(`${r}|${c}`);
        if (!cell) return { row: r, col: c, status: "empty", n: 0 };
        const ctr = this.safeDiv(cell.clicks, cell.impressions);
        const cvr = this.safeDiv(cell.installs, cell.clicks);
        const cpi = this.safeDiv(cell.spend, cell.installs);
        let status = "validated";
        if (cell.n < CREATIVE_CONFIG.minNCell) status = "insufficient";
        else if (cell.impressions < CREATIVE_CONFIG.minImpressions * 3)
          status = "promising";
        return { ...cell, ctr, cvr, cpi, status };
      }),
    );
    return { rows: rowsArr, cols: colsArr, grid };
  },
  sampleSize({ p0, mde, power = 0.8, alpha = 0.05 }) {
    const zA = this.stdNormalInv(1 - alpha / 2);
    const zB = this.stdNormalInv(power);
    const p1 = p0 + mde;
    const pBar = (p0 + p1) / 2;
    const num = 2 * pBar * (1 - pBar) * (zA + zB) ** 2;
    const den = (p1 - p0) ** 2;
    if (den <= 0) return null;
    return Math.ceil(num / den);
  },
  twoPropZ(xA, nA, xB, nB) {
    const pA = xA / nA,
      pB = xB / nB;
    const pBar = (xA + xB) / (nA + nB);
    const se = Math.sqrt(pBar * (1 - pBar) * (1 / nA + 1 / nB));
    const z = se > 0 ? (pB - pA) / se : 0;
    const p = 2 * (1 - this.stdNormalCdf(Math.abs(z)));
    return { z, p, pA, pB, diff: pB - pA };
  },
  betaProbGreater(xA, nA, xB, nB, gridN = CREATIVE_BAYES.gridN) {
    const a1 = CREATIVE_BAYES.priorA + xA;
    const b1 = CREATIVE_BAYES.priorB + nA - xA;
    const a2 = CREATIVE_BAYES.priorA + xB;
    const b2 = CREATIVE_BAYES.priorB + nB - xB;
    const logPdfA = new Array(gridN),
      logPdfB = new Array(gridN);
    let maxA = -Infinity,
      maxB = -Infinity;
    for (let i = 0; i < gridN; i++) {
      const x = (i + 0.5) / gridN;
      const lnx = Math.log(x),
        ln1mx = Math.log(1 - x);
      logPdfA[i] = (a1 - 1) * lnx + (b1 - 1) * ln1mx;
      logPdfB[i] = (a2 - 1) * lnx + (b2 - 1) * ln1mx;
      if (logPdfA[i] > maxA) maxA = logPdfA[i];
      if (logPdfB[i] > maxB) maxB = logPdfB[i];
    }
    const pdfA = new Array(gridN),
      pdfB = new Array(gridN);
    let normA = 0,
      normB = 0;
    for (let i = 0; i < gridN; i++) {
      pdfA[i] = Math.exp(logPdfA[i] - maxA);
      pdfB[i] = Math.exp(logPdfB[i] - maxB);
      normA += pdfA[i];
      normB += pdfB[i];
    }
    if (normA <= 0 || normB <= 0) return 0.5;
    let cumB = 0;
    const cdfB = new Array(gridN);
    for (let i = 0; i < gridN; i++) {
      cumB += pdfB[i] / normB;
      cdfB[i] = cumB;
    }
    let sum = 0;
    for (let i = 0; i < gridN; i++) {
      sum += ((1 - cdfB[i]) * pdfA[i]) / normA;
    }
    return Math.min(1, Math.max(0, sum));
  },
};
