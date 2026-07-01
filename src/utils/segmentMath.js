// Segment (5-12) pure math — extracted VERBATIM from index.html (near line 38560).
// Source of truth: index.html segmentMetricValue / SEGMENT_METRICS / buildSegmentCache 집계.
// Pure & deterministic (no Math.random). Golden: runSegmentTests.

// SEGMENT_METRICS — 지표별 better 방향 + val(순수 계산). fmt는 표시층이라 val만 이식.
// (index SEGMENT_METRICS의 fmt은 fmtCurrency 등 표시 함수 의존이라 컴포넌트에 잔류)
export const SEGMENT_METRIC_META = {
  cpi: { label: "CPI", better: "low" },
  cpa: { label: "CPA", better: "low" },
  roas: { label: "ROAS", better: "high" },
  ctr: { label: "CTR", better: "high" },
  cvr: { label: "CVR", better: "high" },
  cost: { label: "Cost", better: "none" },
};

// index.html segmentMetricValue(c, metric) — VERBATIM.
export function segmentMetricValue(c, metric) {
  switch (metric) {
    case "cpi":
      return c.installs > 0 ? c.cost / c.installs : null;
    case "cpa":
      return c.actions > 0 ? c.cost / c.actions : null;
    case "roas":
      return c.cost > 0 ? c.rev / c.cost : null;
    case "ctr":
      return c.impr > 0 ? c.clk / c.impr : null;
    case "cvr":
      return c.clk > 0 ? c.installs / c.clk : null;
    case "cost":
      return c.cost;
    default:
      return null;
  }
}

// index.html buildSegmentCache 집계부 — VERBATIM 로직(순수화).
// rows: 매핑된 행 배열. ra/ca: 행/열 축 필드키. → { grid, rows, cols }.
// 셀은 { cost, impr, clk, installs, actions, rev } 누적.
export function buildSegmentGrid(rows, ra, ca) {
  const cells = new Map();
  const rowSet = new Set(),
    colSet = new Set();
  for (const r of rows) {
    const rk = String(r[ra] ?? "").trim() || "(미지정)";
    const ck = String(r[ca] ?? "").trim() || "(미지정)";
    rowSet.add(rk);
    colSet.add(ck);
    const key2 = `${rk}|||${ck}`;
    if (!cells.has(key2))
      cells.set(key2, {
        cost: 0,
        impr: 0,
        clk: 0,
        installs: 0,
        actions: 0,
        rev: 0,
      });
    const b = cells.get(key2);
    b.cost += Number(r.cost) || 0;
    b.impr += Number(r.impressions) || 0;
    b.clk += Number(r.clicks) || 0;
    b.installs += Number(r.installs) || 0;
    b.actions += Number(r.actions) || 0;
    b.rev += Number(r.revenue_d7) || 0;
  }
  const rowsArr = [...rowSet].sort(),
    colsArr = [...colSet].sort();
  const grid = rowsArr.map((rk) =>
    colsArr.map((ck) => cells.get(`${rk}|||${ck}`) || null),
  );
  return { grid, rows: rowsArr, cols: colsArr };
}
