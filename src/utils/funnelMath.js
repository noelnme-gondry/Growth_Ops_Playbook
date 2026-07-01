// Funnel math — extracted VERBATIM from index.html `buildFunnelCache` / `runFunnelTests`
// (near line 37851 / 38377). Pure, deterministic. Source of truth = index.html.

export const FUNNEL_MATH = {
  // CVR ratio primitive — index.html runFunnelTests: (cur,prev) => (prev>0 ? cur/prev : null)
  cvr(cur, prev) {
    return prev > 0 ? cur / prev : null;
  },

  // Funnel step build — index.html buildFunnelCache `stepsOf(b)`.
  // stageDefs: [{ key, label }, ...] (already filtered to mapped stages).
  // b: bucket object keyed by stage.key. Returns per-stage { label, count, cvr, drop }.
  stepsOf(b, stageDefs) {
    const steps = [];
    for (let i = 0; i < stageDefs.length; i++) {
      const cur = b[stageDefs[i].key];
      const prev = i > 0 ? b[stageDefs[i - 1].key] : null;
      steps.push({
        label: stageDefs[i].label,
        count: cur,
        cvr: prev != null && prev > 0 ? cur / prev : null,
        drop: prev != null && prev > 0 ? (prev - cur) / prev : null,
      });
    }
    return steps;
  },

  // Weekday/weekend additive re-centering — index.html buildFunnelCache §요일 2-bucket 보정.
  // daily: [{ date:'YYYY-MM-DD', cvr, ... }, ...]. Mutates each row with
  // cvrAdj / devPctAdj / lowAdj when adjustment is applicable.
  // Returns { weekdayProfile, weekdayAdjOk }.
  applyWeekdayAdj(daily, dailyMean, dailySd) {
    let weekdayProfile = null,
      weekdayAdjOk = false;
    if (daily.length >= 2) {
      const valid = daily.filter((x) => x.cvr != null);
      const grpSums = [0, 0],
        grpNs = [0, 0];
      for (const x of valid) {
        const wd = new Date(x.date).getDay();
        const isWe = wd === 0 || wd === 6 ? 1 : 0;
        grpSums[isWe] += x.cvr;
        grpNs[isWe]++;
      }
      const grpMean = [
        grpNs[0] > 0 ? grpSums[0] / grpNs[0] : null,
        grpNs[1] > 0 ? grpSums[1] / grpNs[1] : null,
      ];
      weekdayAdjOk =
        grpNs[0] >= 3 &&
        grpNs[1] >= 3 &&
        grpMean[0] != null &&
        grpMean[1] != null;
      weekdayProfile = {
        weekday: grpMean[0],
        weekend: grpMean[1],
        nWeekday: grpNs[0],
        nWeekend: grpNs[1],
      };
      if (weekdayAdjOk && dailyMean != null) {
        // additive: cvrAdj = cvr - grpMean[bucket] + dailyMean
        for (const x of daily) {
          if (x.cvr == null) {
            x.cvrAdj = null;
            x.devPctAdj = null;
            x.lowAdj = false;
            continue;
          }
          const wd = new Date(x.date).getDay();
          const isWe = wd === 0 || wd === 6 ? 1 : 0;
          x.cvrAdj = x.cvr - grpMean[isWe] + dailyMean;
          x.devPctAdj =
            dailyMean > 0 ? (x.cvrAdj - dailyMean) / dailyMean : null;
          x.lowAdj = dailySd > 0 && x.cvrAdj < dailyMean - dailySd;
        }
      }
    }
    return { weekdayProfile, weekdayAdjOk };
  },
};

export const FUNNEL_FIELD_LABEL = {
  channel: "채널",
  country: "국가",
  platform: "OS",
};

// index.html buildFunnelCache 순수 이식. rows = 표준키로 매핑된 필터 후 행.
// mappedKeys = Set(표준키). state = { unitField, cvrStep, weekdayAdj }.
// 반환: stages/trans/selStep/rows/overall + wow/daily/segRank/weekday.
export function buildFunnelData(rows, mappedKeys, state) {
  const blank = () => ({ impr: 0, clk: 0, inst: 0, act: 0, rev: 0 });
  const add = (b, r) => {
    b.impr += Number(r.impressions) || 0;
    b.clk += Number(r.clicks) || 0;
    b.inst += Number(r.installs) || 0;
    b.act += Number(r.actions) || 0;
    b.rev += Number(r.revenue_d7) || 0;
  };
  const stageDefs = [
    { key: "impr", label: "노출", on: mappedKeys.has("impressions") },
    { key: "clk", label: "클릭", on: mappedKeys.has("clicks") },
    { key: "inst", label: "설치", on: mappedKeys.has("installs") },
    { key: "act", label: "액션", on: mappedKeys.has("actions") },
  ].filter((s) => s.on);

  const trans = [];
  for (let i = 1; i < stageDefs.length; i++)
    trans.push({
      i,
      fromKey: stageDefs[i - 1].key,
      toKey: stageDefs[i].key,
      label: `${stageDefs[i - 1].label}→${stageDefs[i].label}`,
    });
  // 기본 = 클릭→설치. 없으면 노출→클릭이 아닌 첫 전이.
  let selI = state.cvrStep;
  if (!trans.some((t) => t.i === selI)) {
    const pref =
      trans.find((t) => t.fromKey === "clk" && t.toKey === "inst") ||
      trans.find((t) => t.fromKey !== "impr") ||
      trans[0];
    selI = pref ? pref.i : null;
  }
  const selT = trans.find((t) => t.i === selI) || null;
  const cvrSel = (b) =>
    selT && b[selT.fromKey] > 0 ? b[selT.toKey] / b[selT.fromKey] : null;

  const unit = state.unitField;
  const overall = blank();
  const agg = new Map();
  for (const r of rows) {
    add(overall, r);
    const k = unit === "_all" ? "전체" : String(r[unit] ?? "").trim() || "(미지정)";
    if (!agg.has(k)) agg.set(k, { unit: k, ...blank() });
    add(agg.get(k), r);
  }
  const stepsOf = (b) => {
    const steps = [];
    for (let i = 0; i < stageDefs.length; i++) {
      const cur = b[stageDefs[i].key];
      const prev = i > 0 ? b[stageDefs[i - 1].key] : null;
      steps.push({
        label: stageDefs[i].label,
        count: cur,
        cvr: prev != null && prev > 0 ? cur / prev : null,
        drop: prev != null && prev > 0 ? (prev - cur) / prev : null,
      });
    }
    return steps;
  };
  const overallSteps = stepsOf(overall);
  const overallSelCvr = cvrSel(overall);

  // ── 주간 변화(WoW) ──
  let wow = null,
    wowBiggestDrop = null,
    wowRange = null;
  if (mappedKeys.has("date") && trans.length) {
    const uniqDates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
    if (uniqDates.length >= 4) {
      const thisD = new Set(uniqDates.slice(-7));
      const lastD = new Set(uniqDates.slice(-14, -7));
      const tw = blank(),
        lw = blank();
      for (const r of rows) {
        if (thisD.has(r.date)) add(tw, r);
        else if (lastD.has(r.date)) add(lw, r);
      }
      const cvrT = (b, t) => (b[t.fromKey] > 0 ? b[t.toKey] / b[t.fromKey] : null);
      wow = trans.map((t) => {
        const a = cvrT(tw, t),
          bb = cvrT(lw, t);
        const delta = a != null && bb != null && bb > 0 ? (a - bb) / bb : null;
        return { i: t.i, label: t.label, cvrThis: a, cvrLast: bb, delta };
      });
      const drops = wow.filter((w) => w.delta != null).sort((x, y) => x.delta - y.delta);
      wowBiggestDrop = drops.length ? drops[0] : null;
      const tw2 = [...thisD].sort();
      if (tw2.length) wowRange = { from: tw2[0], to: tw2[tw2.length - 1] };
    }
  }

  // ── 시계열: 날짜별 선택 단계 CVR + 급락 탐지(평균−1σ) ──
  let daily = [],
    dailyMean = null,
    dailySd = null;
  if (mappedKeys.has("date") && selT) {
    const dmap = new Map();
    for (const r of rows) {
      const d = r.date;
      if (!d) continue;
      if (!dmap.has(d)) dmap.set(d, { date: d, ...blank() });
      add(dmap.get(d), r);
    }
    daily = [...dmap.values()]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((b) => ({ date: b.date, cvr: cvrSel(b), vol: b[selT.fromKey] }));
    const valid = daily.filter((x) => x.cvr != null && x.vol > 0);
    if (valid.length) {
      dailyMean = valid.reduce((s, x) => s + x.cvr, 0) / valid.length;
      dailySd = Math.sqrt(
        valid.reduce((s, x) => s + (x.cvr - dailyMean) ** 2, 0) / valid.length,
      );
      daily.forEach((x) => {
        x.devPct = x.cvr != null && dailyMean > 0 ? (x.cvr - dailyMean) / dailyMean : null;
        x.low = x.cvr != null && dailySd > 0 && x.cvr < dailyMean - dailySd;
      });
    }
  }

  // ── 세그먼트 랭킹 ──
  let segRank = null;
  const segField =
    unit === "_all"
      ? mappedKeys.has("channel")
        ? "channel"
        : mappedKeys.has("country")
          ? "country"
          : mappedKeys.has("platform")
            ? "platform"
            : null
      : unit;
  if (segField && selT) {
    const smap = new Map();
    for (const r of rows) {
      const k = String(r[segField] ?? "").trim() || "(미지정)";
      if (!smap.has(k)) smap.set(k, { seg: k, ...blank() });
      add(smap.get(k), r);
    }
    const arr = [...smap.values()]
      .map((b) => ({ seg: b.seg, cvr: cvrSel(b), vol: b[selT.fromKey] }))
      .filter((x) => x.cvr != null && x.vol > 0)
      .sort((a, b) => b.cvr - a.cvr);
    if (arr.length >= 2)
      segRank = {
        field: segField,
        best: arr.slice(0, 3),
        worst: arr.slice(-3).reverse(),
        avg: overallSelCvr,
      };
  }

  // ── 요일 2-bucket 보정(additive) ── (FUNNEL_MATH.applyWeekdayAdj 재사용)
  const { weekdayProfile, weekdayAdjOk } =
    daily.length >= 2 && selT
      ? FUNNEL_MATH.applyWeekdayAdj(daily, dailyMean, dailySd)
      : { weekdayProfile: null, weekdayAdjOk: false };

  const rowsOut = [...agg.values()]
    .sort((a, b) => b.impr - a.impr)
    .map((b) => ({ unit: b.unit, steps: stepsOf(b) }));

  return {
    stages: stageDefs,
    rows: rowsOut,
    overall,
    overallSteps,
    trans,
    selStep: selI,
    selLabel: selT ? selT.label : null,
    selCvr: overallSelCvr,
    wow,
    wowBiggestDrop,
    wowRange,
    daily,
    dailyMean,
    dailySd,
    weekdayProfile,
    weekdayAdjOk,
    segRank,
  };
}
