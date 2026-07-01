/* Budget Allocation (5-3) — page-level orchestration helpers ported faithfully
   from index.html. Pure/deterministic (no randomness). The core curve math lives
   in ALLOC_MATH (allocationMath.js); these helpers add constrained greedy/weighted
   allocation, channel history summaries, and the summary-card reducer. */
import { ALLOC_MATH } from "@/utils/allocationMath";

/* ── 그룹 키: index.html getRowGroupKey를 unitField 기준으로 이식 ── */
export function getRowGroupKey(row, unit) {
  const country = String(row.country ?? "").trim();
  const channel = String(row.channel ?? "").trim();
  const campaign = String(row.campaign_name ?? "").trim();
  const platform = String(row.platform ?? "").trim();
  const parts = [];
  if (unit === "country") {
    if (country) parts.push(country);
    else if (channel) parts.push(channel);
    else if (campaign) parts.push(campaign);
  } else if (unit === "campaign_name") {
    if (country) parts.push(country);
    if (channel) parts.push(channel);
    if (campaign) parts.push(campaign);
  } else {
    if (country) parts.push(country);
    if (channel) parts.push(channel);
    if (!country && !channel && campaign) parts.push(campaign);
  }
  if (platform) {
    const pLow = platform.toLowerCase();
    if (pLow.includes("ios") || pLow === "iphone") parts.push("iOS");
    else if (pLow.includes("android")) parts.push("Android");
    else parts.push(platform);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function allocParseNum(s) {
  const n = parseFloat(String(s == null ? "" : s).replace(/[,\s]/g, ""));
  return isNaN(n) ? null : n;
}
export function allocFmtNum(n) {
  return n == null || isNaN(n) ? "" : Math.round(n).toLocaleString();
}

/* index.html calcChannelHistorySummary 이식 — rows/unit을 명시적으로 받는 순수 버전.
   모든 metric(installs/actions/revenue_d7/pu_d7) 동시 계산 후 반환. */
export function calcChannelHistorySummary(rows, unit, channel, metric, opts = {}) {
  const chRows = rows.filter((r) => getRowGroupKey(r, unit) === channel);
  if (!chRows.length) return null;

  const datesAll = rows
    .map((r) => (r.date ? Date.parse(r.date) : NaN))
    .filter((d) => !isNaN(d));
  if (!datesAll.length) return null;
  const maxDate = Math.max(...datesAll);

  const latestDayRows = chRows.filter(
    (r) => r.date && Date.parse(r.date) === maxDate,
  );
  let latestCost = 0;
  for (const r of latestDayRows) latestCost += Number(r.cost) || 0;

  let windowRows = chRows;
  if (opts.recentDays && opts.recentDays > 0) {
    const threshold = maxDate - opts.recentDays * 86400 * 1000;
    windowRows = chRows.filter((r) => r.date && Date.parse(r.date) > threshold);
  }
  if (!windowRows.length) return null;

  let windowCost = 0,
    windowInstalls = 0,
    windowActions = 0,
    windowRevenue = 0,
    windowPu = 0,
    windowResults = 0;
  for (const r of windowRows) {
    windowCost += Number(r.cost) || 0;
    windowInstalls += Number(r.installs) || 0;
    windowActions += Number(r.actions) || 0;
    windowRevenue += Number(r.revenue_d7) || 0;
    windowPu += Number(r.pu_d7) || 0;
    windowResults += Number(r[metric]) || 0;
  }

  const avgCPR = windowResults > 0 ? windowCost / windowResults : null;
  const avgCPI = windowInstalls > 0 ? windowCost / windowInstalls : null;
  const avgCPA = windowActions > 0 ? windowCost / windowActions : null;
  const avgROAS =
    windowCost > 0 && windowRevenue > 0 ? windowRevenue / windowCost : null;

  const periodDays =
    opts.recentDays && opts.recentDays > 0
      ? opts.recentDays
      : new Set(windowRows.map((r) => r.date)).size || 1;
  const baselineCost = windowCost / periodDays;
  const baselineResults = avgCPR ? baselineCost / avgCPR : 0;
  const baselineInstalls = avgCPI ? baselineCost / avgCPI : 0;
  const baselineActions = avgCPA ? baselineCost / avgCPA : 0;
  const baselineRevenue = avgROAS ? baselineCost * avgROAS : 0;

  return {
    rowCount: windowRows.length,
    latestCost,
    totalCost: baselineCost,
    totalResults: baselineResults,
    totalInstalls: baselineInstalls,
    totalActions: baselineActions,
    totalRevenue: baselineRevenue,
    totalPu: windowPu,
    avgCPR,
    avgCPI,
    avgCPA,
    avgROAS,
    windowCost,
    windowResults,
  };
}

/* ── 모드 C · 절대 CPR/ROAS 가중 (overrides/min/max/lock 반영) — index.html 이식 ── */
export function calculateAllocationModeC({
  modelsMap,
  totalBudget,
  selectedChannels,
  overrides = {},
  minSpends = {},
  maxSpends = {},
  metric,
  historyByCh = {},
}) {
  if (!modelsMap || totalBudget <= 0)
    return { items: [], unallocated: totalBudget || 0, overspent: false, totalAllocated: 0, lockedTotal: 0 };

  const lockedChannels = [];
  const greedyChannels = [];
  let fixedSum = 0;

  for (const [ch, meta] of modelsMap) {
    if (!meta) continue;
    if (selectedChannels && selectedChannels.size > 0 && !selectedChannels.has(ch)) continue;

    const shape = meta.model ? ALLOC_MATH.detectPoly2Shape(meta.model) : null;
    if (overrides[ch] != null && overrides[ch] >= 0) {
      const cost = Number(overrides[ch]);
      const cpr = meta.model ? ALLOC_MATH.predictSafeCpr(meta, cost) : null;
      const results = isFinite(cpr) && cpr > 0 && cost > 0 ? cost / cpr : 0;
      lockedChannels.push({
        channel: ch, cost, results, locked: true,
        xMin: meta.xMin, xMax: meta.xMax, poly2Shape: shape, model: meta.model, avgCPR: null,
      });
      fixedSum += cost;
      continue;
    }

    const history = historyByCh[ch];
    const avgCPR = history && history.avgCPR != null && history.avgCPR > 0 ? history.avgCPR : null;
    const min = Number(minSpends[ch]) || 0;
    const max =
      maxSpends[ch] != null && maxSpends[ch] >= 0 ? Math.max(min, Number(maxSpends[ch])) : Infinity;
    greedyChannels.push({
      channel: ch, cost: 0, results: 0, locked: false,
      xMin: meta.xMin, xMax: meta.xMax, poly2Shape: shape, model: meta.model,
      avgCPR, minSpend: min, maxSpend: max,
    });
  }

  const lockedTotal = fixedSum;
  const overspent = fixedSum > totalBudget;
  let remaining = Math.max(0, totalBudget - fixedSum);

  if (greedyChannels.length > 0 && remaining > 0) {
    const minSpendSum = greedyChannels.reduce((s, c) => s + c.minSpend, 0);
    if (minSpendSum > 0) {
      if (remaining >= minSpendSum) {
        for (const c of greedyChannels) c.cost = c.minSpend;
        remaining -= minSpendSum;
      } else {
        for (const c of greedyChannels) c.cost = remaining * (c.minSpend / minSpendSum);
        remaining = 0;
      }
    }
  }

  let active = greedyChannels.filter((c) => c.cost < c.maxSpend && c.avgCPR != null && c.avgCPR > 0);
  if (active.length > 0 && remaining > 0) {
    while (active.length > 0 && remaining > 0.01) {
      const totalEfficiency = active.reduce((s, c) => s + 1 / c.avgCPR, 0);
      if (totalEfficiency <= 0) break;
      let nextRemaining = 0;
      const nextActive = [];
      for (const c of active) {
        const weight = 1 / c.avgCPR / totalEfficiency;
        const share = remaining * weight;
        const newCost = c.cost + share;
        if (newCost > c.maxSpend) {
          const allowed = c.maxSpend - c.cost;
          c.cost = c.maxSpend;
          nextRemaining += share - allowed;
        } else {
          c.cost = newCost;
          nextActive.push(c);
        }
      }
      remaining = nextRemaining;
      active = nextActive;
    }
  }

  for (const c of greedyChannels) {
    if (c.model) {
      const cpr = ALLOC_MATH.predictSafeCpr(c, c.cost);
      c.results = cpr && cpr > 0 ? c.cost / cpr : c.cost / (c.avgCPR || 1);
    } else {
      c.results = c.cost / (c.avgCPR || 1);
    }
  }

  const allChannels = [...lockedChannels, ...greedyChannels];
  const totalAllocated = allChannels.reduce((a, c) => a + c.cost, 0);
  const items = allChannels
    .map((c) => ({
      channel: c.channel, cost: c.cost, results: c.results,
      cpr: c.results > 0 ? c.cost / c.results : null,
      weight: totalAllocated > 0 ? c.cost / totalAllocated : 0,
      locked: c.locked, xMin: c.xMin, xMax: c.xMax, poly2Shape: c.poly2Shape,
    }))
    .sort((a, b) => b.cost - a.cost);

  return { items, unallocated: Math.max(0, remaining), overspent, totalAllocated, lockedTotal };
}

/* ── 모드 B · 한계효용 그리디 (overrides/min/max/lock 반영) — index.html 이식 ── */
export function calculateAllocationModeB({
  modelsMap,
  totalBudget,
  selectedChannels,
  overrides = {},
  minSpends = {},
  maxSpends = {},
  extrapolateMode = "1.3",
  currency = "KRW",
  stepRatio = 0.002,
}) {
  if (!modelsMap || totalBudget <= 0)
    return { items: [], unallocated: totalBudget || 0, overspent: false, totalAllocated: 0, lockedTotal: 0 };

  const lockedChannels = [];
  const greedyChannels = [];
  let fixedCostSum = 0;

  for (const [ch, meta] of modelsMap) {
    if (!meta || !meta.model) continue;
    if (selectedChannels && selectedChannels.size > 0 && !selectedChannels.has(ch)) continue;

    const shape = ALLOC_MATH.detectPoly2Shape(meta.model);
    if (overrides[ch] != null && overrides[ch] >= 0) {
      const cost = Number(overrides[ch]);
      const cpr = meta.model.predict(cost);
      const results = isFinite(cpr) && cpr > 0 && cost > 0 ? cost / cpr : 0;
      lockedChannels.push({
        channel: ch, model: meta.model, xMin: meta.xMin, xMax: meta.xMax,
        poly2Shape: shape, cost, results, locked: true,
      });
      fixedCostSum += cost;
    } else {
      const min = Number(minSpends[ch]) || 0;
      const max =
        maxSpends[ch] != null && maxSpends[ch] >= 0 ? Math.max(min, Number(maxSpends[ch])) : null;
      greedyChannels.push({
        channel: ch, model: meta.model, xMin: meta.xMin, xMax: meta.xMax,
        poly2Shape: shape, cost: 0, results: 0, locked: false,
        minSpend: min, maxSpend: max, minMarginalSoFar: Infinity,
      });
    }
  }

  const lockedTotal = fixedCostSum;
  const overspent = fixedCostSum > totalBudget;
  let remaining = Math.max(0, totalBudget - fixedCostSum);

  if (greedyChannels.length > 0 && remaining > 0) {
    const minSpendSum = greedyChannels.reduce((s, c) => s + c.minSpend, 0);
    if (minSpendSum > 0) {
      if (remaining >= minSpendSum) {
        for (const c of greedyChannels) {
          c.cost = c.minSpend;
          const cpr = ALLOC_MATH.predictSafeCpr(c, c.cost);
          c.results = cpr && cpr > 0 ? c.cost / cpr : 0;
        }
        remaining -= minSpendSum;
      } else {
        for (const c of greedyChannels) {
          c.cost = remaining * (c.minSpend / minSpendSum);
          const cpr = ALLOC_MATH.predictSafeCpr(c, c.cost);
          c.results = cpr && cpr > 0 ? c.cost / cpr : 0;
        }
        remaining = 0;
      }
    }
  }

  if (greedyChannels.length > 0 && remaining > 0) {
    const minStep = currency === "USD" || currency === "usd" ? 0.01 : 10;
    const step = Math.max(minStep, remaining * stepRatio);
    if (step > 0) {
      const maxIters = Math.ceil(remaining / step) + 20;
      let iter = 0;
      while (remaining >= step && iter < maxIters) {
        let bestCh = null;
        let bestMarginal = 0;
        let bestRawMarginal = 0;
        for (const ch of greedyChannels) {
          const newCost = ch.cost + step;
          let cap = ch.maxSpend;
          if (cap == null) {
            if (extrapolateMode === "1.0") cap = ch.xMax;
            else if (extrapolateMode === "1.3") cap = ch.xMax * 1.3;
            else if (extrapolateMode === "1.5") cap = ch.xMax * 1.5;
            else cap = Infinity;
          }
          if (newCost > cap) continue;
          if (ch.poly2Shape) {
            if (ch.poly2Shape.shape === "bell" && newCost > ch.poly2Shape.vertex) continue;
            if (ch.poly2Shape.shape === "u" && newCost < ch.poly2Shape.vertex) continue;
          }
          const cpr = ALLOC_MATH.predictSafeCpr(ch, newCost);
          if (!cpr || cpr <= 0) continue;
          const newResults = newCost / cpr;
          const rawMarginal = newResults - ch.results;
          if (rawMarginal <= 0) continue;
          const marginalResults = Math.min(rawMarginal, ch.minMarginalSoFar);
          if (marginalResults > bestMarginal) {
            bestMarginal = marginalResults;
            bestRawMarginal = rawMarginal;
            bestCh = ch;
          }
        }
        if (!bestCh) break;
        bestCh.cost += step;
        const cpr = ALLOC_MATH.predictSafeCpr(bestCh, bestCh.cost);
        bestCh.results = bestCh.cost / cpr;
        bestCh.minMarginalSoFar = Math.min(bestCh.minMarginalSoFar, bestRawMarginal);
        remaining -= step;
        iter++;
      }
      const capOf = (ch) => {
        let cap = ch.maxSpend;
        if (cap == null) {
          if (extrapolateMode === "1.0") cap = ch.xMax;
          else if (extrapolateMode === "1.3") cap = ch.xMax * 1.3;
          else if (extrapolateMode === "1.5") cap = ch.xMax * 1.5;
          else cap = Infinity;
        }
        if (ch.poly2Shape) {
          if (ch.poly2Shape.shape === "bell") cap = Math.min(cap, ch.poly2Shape.vertex);
          if (ch.poly2Shape.shape === "u" && ch.cost < ch.poly2Shape.vertex) cap = Math.min(cap, ch.cost);
        }
        return cap;
      };

      if (remaining > 0 && remaining < step) {
        let bestCh = null;
        let bestEff = -Infinity;
        for (const ch of greedyChannels) {
          if (ch.cost + remaining > capOf(ch)) continue;
          const cpr = ALLOC_MATH.predictSafeCpr(ch, ch.cost);
          if (cpr && cpr > 0) {
            const eff = 1 / cpr;
            if (eff > bestEff) {
              bestEff = eff;
              bestCh = ch;
            }
          }
        }
        if (bestCh) {
          bestCh.cost += remaining;
          const cpr = ALLOC_MATH.predictSafeCpr(bestCh, bestCh.cost);
          bestCh.results = bestCh.cost / cpr;
          remaining = 0;
        }
      }
    }
  }

  if (greedyChannels.length > 0 && remaining > 0 && extrapolateMode !== "1.0") {
    const capOf2 = (ch) => {
      let cap = ch.maxSpend;
      if (cap == null) {
        cap = extrapolateMode === "1.3" ? ch.xMax * 1.3 : extrapolateMode === "1.5" ? ch.xMax * 1.5 : Infinity;
      }
      if (ch.poly2Shape) {
        if (ch.poly2Shape.shape === "bell") cap = Math.min(cap, ch.poly2Shape.vertex);
        if (ch.poly2Shape.shape === "u" && ch.cost < ch.poly2Shape.vertex) cap = Math.min(cap, ch.cost);
      }
      return cap;
    };
    let guard = 0;
    while (remaining > 0 && guard < 10) {
      const eligible = greedyChannels.filter((c) => c.cost < capOf2(c));
      const sumEligibleCost = eligible.reduce((s, c) => s + c.cost, 0);
      if (!eligible.length || sumEligibleCost <= 0) break;
      let leftover = 0;
      for (const c of eligible) {
        const cap = capOf2(c);
        const share = remaining * (c.cost / sumEligibleCost);
        const room = cap - c.cost;
        const extra = Math.min(share, room);
        leftover += share - extra;
        c.cost += extra;
        const cpr = ALLOC_MATH.predictSafeCpr(c, c.cost);
        c.results = cpr && cpr > 0 ? c.cost / cpr : c.results;
      }
      remaining = leftover;
      guard++;
    }
  }

  const allChannels = [...lockedChannels, ...greedyChannels];
  const totalAllocated = allChannels.reduce((a, ch) => a + ch.cost, 0);
  const items = allChannels
    .map((ch) => ({
      channel: ch.channel, cost: ch.cost, results: ch.results,
      cpr: ch.results > 0 ? ch.cost / ch.results : null,
      weight: totalAllocated > 0 ? ch.cost / totalAllocated : 0,
      locked: ch.locked, xMin: ch.xMin, xMax: ch.xMax, poly2Shape: ch.poly2Shape,
    }))
    .sort((a, b) => b.cost - a.cost);

  return { items, unallocated: Math.max(0, remaining), overspent, totalAllocated, lockedTotal };
}

/* What-if 시나리오: 현재 예산의 0.5×~2× 구간을 동일 알고리즘으로 재배분해 예상 성과 비교.
   index.html renderAllocScenario의 runAt 로직 이식(순수). 모델 재적합 없이 modelsMap lookup. */
export function computeAllocScenarios({
  modelsMap,
  dailyBudget,
  metric,
  mode,
  overrides = {},
  minSpends = {},
  maxSpends = {},
  extrapolateMode = "1.3",
  currency = "KRW",
  historyByCh = {},
}) {
  if (!modelsMap || dailyBudget <= 0) return [];
  const mults = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  const runAt = (budget) => {
    const r =
      mode === "c"
        ? calculateAllocationModeC({
            modelsMap,
            totalBudget: budget,
            overrides,
            minSpends,
            maxSpends,
            metric,
            historyByCh,
          })
        : calculateAllocationModeB({
            modelsMap,
            totalBudget: budget,
            overrides,
            minSpends,
            maxSpends,
            extrapolateMode,
            currency,
          });
    const totResults = r.items.reduce((s, it) => s + (it.results || 0), 0);
    const totCost = r.totalAllocated || r.items.reduce((s, it) => s + (it.cost || 0), 0);
    const avgCpr = totResults > 0 ? totCost / totResults : null;
    return { budget, totResults, totCost, avgCpr };
  };
  return mults.map((m) => ({ m, ...runAt(dailyBudget * m) }));
}

/* 배분 요약(이전 N일 vs 분배 후 예상) — 총합계 카드·결론 카드가 공유해 drift 방지.
   index.html computeAllocSummary 이식. historyByCh(전 채널 recentDays 요약)을 주입받음. */
export function computeAllocSummary(payload) {
  const { items, metric, historyByCh = {}, recentDays = 14 } = payload;
  const prev = items.reduce(
    (acc, it) => {
      const hist = historyByCh[it.channel];
      if (hist) {
        acc.cost += hist.totalCost;
        acc.results += hist.totalResults;
        acc.installs += hist.totalInstalls;
        acc.actions += hist.totalActions;
        acc.revenue += hist.totalRevenue;
        acc.rowCount = Math.max(acc.rowCount, hist.rowCount);
      }
      return acc;
    },
    { cost: 0, results: 0, installs: 0, actions: 0, revenue: 0, rowCount: 0 },
  );
  const next = items.reduce(
    (acc, it) => {
      acc.cost += it.cost;
      acc.results += it.results;
      return acc;
    },
    { cost: 0, results: 0 },
  );
  let nextRevenue = 0;
  for (const it of items) {
    const hist = historyByCh[it.channel];
    if (hist && hist.totalResults > 0 && hist.totalRevenue > 0) {
      nextRevenue += it.results * (hist.totalRevenue / hist.totalResults);
    }
  }
  return {
    recentDays,
    prev,
    next,
    nextRevenue,
    prevAvgCPR: prev.results > 0 ? prev.cost / prev.results : null,
    nextAvgCPR: next.results > 0 ? next.cost / next.results : null,
    prevROAS: prev.cost > 0 && prev.revenue > 0 ? prev.revenue / prev.cost : null,
    nextROAS: next.cost > 0 && nextRevenue > 0 ? nextRevenue / next.cost : null,
  };
}
