import { describe, it, expect } from "vitest";
import { AHA_STATS, ahaParseActionWindow } from "./ahaMath";
import { seededNoise } from "./testFixtures";

// Golden test port of runAhaTests (index.html 34174-34297).
// Same inputs, same expected values, same tolerances — verbatim.
// T1–T6 use AHA_STATS pure functions; T7 uses ahaParseActionWindow
// (extracted to ahaMath.js from AhaMomentFinder.jsx). All ported verbatim.

describe("runAhaTests (golden parity)", () => {
  // T1: F1 항등식 — P=R=1→1, P=R=0→0(가드)
  it("T1 · F1 항등식 (P=R=1→1, P=R=0→0 가드)", () => {
    const f1a = AHA_STATS.f1(1, 1);
    const f1b = AHA_STATS.f1(0, 0);
    expect(f1a).toBe(1);
    expect(f1b).toBe(0);
  });

  // T2: bestThreshold 단조 — 완전 분리 신호(k>=k0에서 target=1) → bestK=k0, F1=1
  it("T2 · bestThreshold 완전분리 (bestK=5, F1=1)", () => {
    const N2 = 200,
      k0 = 5;
    const vals2 = Array.from({ length: N2 }, (_, i) => i % 10); // 0..9 반복
    const targets2 = vals2.map((v) => (v >= k0 ? 1 : 0));
    const idx2 = vals2.map((_, i) => i);
    const bt2 = AHA_STATS.bestThreshold(vals2, targets2, idx2, 5);
    expect(bt2).toBeTruthy();
    expect(bt2.k).toBe(k0);
    expect(Math.abs(bt2.F1 - 1)).toBeLessThan(1e-9);
  });

  // T3: split 결정론 — 같은 (n,seed) → 같은 분할(재호출 byte-identical)
  it("T3 · split 결정론 (같은 seed → byte-identical, 전체 커버)", () => {
    const sp1 = AHA_STATS.splitDeterministic(500, 777);
    const sp2 = AHA_STATS.splitDeterministic(500, 777);
    const splitIdentical = JSON.stringify(sp1) === JSON.stringify(sp2);
    const splitCoversAll =
      sp1.train.length + sp1.holdout.length === 500 &&
      new Set([...sp1.train, ...sp1.holdout]).size === 500;
    expect(splitIdentical).toBe(true);
    expect(splitCoversAll).toBe(true);
  });

  // T4: lift 정확 — baseRate 0.5, precision 0.75 → lift 1.5
  it("T4 · lift 정확 (precision=0.75, baseRate=0.5 → 1.5)", () => {
    const liftVal = AHA_STATS.lift(0.75, 0.5);
    expect(Math.abs(liftVal - 1.5)).toBeLessThan(1e-9);
  });

  // T5: support 게이트 — 전부 minSupport 미달 → 최대 support 조합 선택(크래시 없음)
  it("T5 · support 게이트 (전부 미달 → 최대 support 폴백, 크래시 없음)", () => {
    const vals5 = [1, 1, 2, 2, 3];
    const targets5 = [1, 0, 1, 0, 1];
    const idx5 = [0, 1, 2, 3, 4];
    let bt5,
      threw5 = false;
    try {
      bt5 = AHA_STATS.bestThreshold(vals5, targets5, idx5, 1000);
    } catch (e) {
      threw5 = true;
    }
    expect(threw5).toBe(false);
    expect(bt5).toBeTruthy();
    expect(bt5.gated).toBe(true);
    expect(bt5.support).toBeGreaterThan(0);
  });

  // T6: 윈도우×k 그리드 — 좁은 윈도우(d3)에 강신호, 넓은 윈도우(d14)에 노이즈 → bestW=3
  it("T6 · 윈도우×k 그리드 (d3 강신호 vs d14 노이즈 → bestWindow=3)", () => {
    const N6 = 300;
    const rng6 = seededNoise(31415);
    const targets6 = Array.from({ length: N6 }, () =>
      rng6() + 0.5 < 0.4 ? 1 : 0,
    );
    const d3vals = targets6.map((t) => (t === 1 ? 5 : 1)); // d3: 완전분리
    const d14vals = Array.from({ length: N6 }, () =>
      Math.round((rng6() + 0.5) * 10),
    ); // d14: 순수 노이즈
    const sp6 = AHA_STATS.splitDeterministic(N6, 1);
    const windowCols6 = [
      { header: "a_d3", window: 3, valuesAll: d3vals },
      { header: "a_d14", window: 14, valuesAll: d14vals },
    ];
    const gs6 = AHA_STATS.gridSearch(
      windowCols6,
      targets6,
      sp6.train,
      sp6.holdout,
      5,
    );
    expect(gs6).toBeTruthy();
    expect(gs6.bestWindow).toBe(3);
  });

  // T7: 컬럼 그룹핑 정규식 — invite_d7 → action=invite, window=7
  it("T7 · 컬럼 그룹핑 정규식 (invite_d7 → action=invite, window=7)", () => {
    const aw7 = ahaParseActionWindow("invite_d7");
    const aw7b = ahaParseActionWindow("revenue_d7"); // 의도적으로 같은 정규식에 걸림(스펙 §7 — 수동 보정 대상)
    const aw7c = ahaParseActionWindow("no_window_action"); // 매치 안 됨 → window=Infinity
    expect(aw7.action).toBe("invite");
    expect(aw7.window).toBe(7);
    expect(aw7c.window).toBe(Infinity);
    expect(aw7b.action).toBe("revenue");
    expect(aw7b.window).toBe(7);
  });
});
