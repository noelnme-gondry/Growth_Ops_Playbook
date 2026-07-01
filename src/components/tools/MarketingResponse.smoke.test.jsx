// @vitest-environment jsdom
//
// Render-smoke for MarketingResponse (5-18, response group). Regression net for
// the CampaignPvm-class crashes: a route component that throws during render or
// a mount effect. Golden tests (src/utils/*.test.js) cover the MMM/regression
// engines; this asserts the component MOUNTS without throwing in the no-data
// and with-data states.
//
// 5-18 uses the DnD colMap (MmmColumnMapper) as the PRIMARY mapper — a single
// generic WIDE CSV (one column per channel spend + a target column) is dragged
// into roles, then "분석하기" gates the analysis. autoGuessColMap seeds roles by
// name (week→week, Regs→reg, *_spend→channel). Channels must vary INDEPENDENTLY
// so the OLS panel is non-singular. Deterministic — NO Math.random (harness §3).
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import MarketingResponse from "@/components/tools/MarketingResponse";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-18",
    csvGroups: { ...useAppStore.getState().csvGroups, response: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

function seedWithData() {
  // WIDE weekly panel: one row per week, independent channel spend columns +
  // Regs target. colMap autoGuess: week→week, Regs→reg, g_spend/m_spend→channel.
  const headers = ["week", "Regs", "g_spend", "m_spend"];
  const raw = [];
  for (let w = 0; w < 16; w++) {
    const gCost = 100000 + (w % 5) * 15000 + (w % 3) * 8000;
    const mCost = 80000 + (w % 4) * 12000 + ((w + 2) % 6) * 6000;
    const regs = Math.round(gCost / 5000 + mCost / 4200);
    raw.push({ week: w + 1, Regs: regs, g_spend: gCost, m_spend: mCost });
  }
  const slice = { raw, headers, mapping: {}, fileName: "response.csv" };
  useAppStore.setState({
    currentRouteId: "5-18",
    csvGroups: { ...useAppStore.getState().csvGroups, response: slice },
    csvData: slice,
  });
}

function clickByText(container, text) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent.includes(text),
  );
  expect(btn).toBeTruthy();
  fireEvent.click(btn);
}
// Default mode is MMM (colMap primary), so the analyze gate shows immediately.
// colMap is auto-seeded on mount → "▶ 분석하기" present.
function enterMmmAndAnalyze(container) {
  clickByText(container, "분석하기");
}

describe("MarketingResponse render smoke", () => {
  beforeEach(() => {
    seedNoData();
  });

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<MarketingResponse />)).not.toThrow();
    expect(document.body.querySelector("*")).toBeTruthy();
  });

  it("shows the colMap mapper + analyze gate by default (MMM primary) with a valid CSV", () => {
    seedWithData();
    render(<MarketingResponse />);
    // Primary mapper + analyze gate should render (not the analysis yet).
    expect(document.body.textContent).toContain("컬럼 역할 매핑");
    expect(document.body.textContent).toContain("분석하기");
  });

  it("renders diagnose→MMM panel (§1 macro/audit, §4.5 ranking) after analyze without throwing", () => {
    seedWithData();
    const { container } = render(<MarketingResponse />);
    expect(() => enterMmmAndAnalyze(container)).not.toThrow();
    expect(document.body.textContent).toContain("데이터 위생");
  });

  it("renders the 회귀·미래 예측 (lab) stage without throwing (3-tab, forecast merged)", () => {
    seedWithData();
    const { container } = render(<MarketingResponse />);
    expect(() => enterMmmAndAnalyze(container)).not.toThrow();
    // 구 "시뮬레이션" 탭은 제거됨 — 없어야 함.
    const simTab = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent.includes("시뮬레이션"),
    );
    expect(simTab).toBeFalsy();
    const labTab = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent.includes("회귀 · 미래 예측"),
    );
    expect(labTab).toBeTruthy();
    expect(() => fireEvent.click(labTab)).not.toThrow();
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });
});
