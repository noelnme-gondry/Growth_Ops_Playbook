// Golden test port of index.html `runRegForecastTests` (lines 29808-29877)
// Verifies v2 REG_FORECAST module against the original golden assertions.
// Numeric expectations kept IDENTICAL to index.html.
import { describe, it, expect } from "vitest";
import { REG_FORECAST } from "./regForecastMath";

// --- Reproduce synthetic data + mapping + opts VERBATIM from index.html ---
function buildOpts() {
  // 합성: y = 8000 + 600*log(cost) - 5*t + 400*sin(2πt/52) + noise
  const n = 104;
  let seed = 99;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const cost = 5000 + i * 40 + rnd() * 1000;
    const hol = i % 13 === 0 ? 1 : 0;
    const date = new Date(Date.UTC(2024, 0, 1) + i * 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    const y =
      8000 +
      600 * Math.log1p(cost) -
      5 * i +
      400 * Math.sin((2 * Math.PI * i) / 52.18) +
      300 * hol +
      rnd() * 100;
    rows.push({ week: date, cost, is_promo: hol, regs: Math.round(y) });
  }
  const m = {
    dep: "regs",
    indep: ["cost", "is_promo"],
    time: "week",
    group: null,
    types: { regs: "continuous", cost: "continuous", is_promo: "binary" },
    tf: { regs: "none", cost: "adstock_log", is_promo: "none" },
  };
  const opts = {
    rows,
    m,
    lam: 0.3,
    horizon: 13,
    bandMode: "mean",
    season: true,
    futureSpec: { cost: { value: 9000 }, is_promo: { off: null } },
  };
  return { rows, m, opts };
}

const meanFut = (x) => x.predFut.reduce((s, v) => s + v, 0) / x.predFut.length;

describe("REG_FORECAST · Golden (index.html runRegForecastTests)", () => {
  const { rows, opts } = buildOpts();
  const r1 = REG_FORECAST.run(opts);

  it("T1 · 예측 성공·R²유효", () => {
    expect(r1.ok && r1.r2 > 0 && r1.r2 < 1).toBe(true);
  });

  it("T2 · 예측 길이=horizon", () => {
    expect(r1.predFut && r1.predFut.length === 13).toBe(true);
  });

  it("T3 · 밴드 lo<hi", () => {
    expect(r1.lo && r1.lo.every((v, j) => v <= r1.hi[j])).toBe(true);
  });

  it("T4 · 계절성 포함(주간·2년+)", () => {
    expect(r1.hasSeasonality).toBe(true);
  });

  it("T5 · 결정론(2회 동일)", () => {
    const r2 = REG_FORECAST.run(opts);
    expect(JSON.stringify(r1.predFut) === JSON.stringify(r2.predFut)).toBe(true);
  });

  it("T6 · 예산↑→예측↑", () => {
    const rHi = REG_FORECAST.run({
      ...opts,
      futureSpec: { cost: { value: 20000 }, is_promo: { off: null } },
    });
    expect(meanFut(rHi) > meanFut(r1)).toBe(true);
  });

  it("T7 · 행≤변수 degenerate 거부", () => {
    const few = rows.slice(0, 3);
    const rDeg = REG_FORECAST.run({ ...opts, rows: few });
    expect(rDeg.ok === false).toBe(true);
  });

  it("T8 · 이벤트 off=3 미래반영", () => {
    const rOff = REG_FORECAST.run({
      ...opts,
      futureSpec: { cost: { value: 9000 }, is_promo: { off: 3 } },
    });
    expect(rOff.ok && rOff.futRows.is_promo[5] === 0).toBe(true);
  });
});
