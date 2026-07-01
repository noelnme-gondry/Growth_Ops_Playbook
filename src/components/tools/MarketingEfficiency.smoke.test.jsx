// @vitest-environment jsdom
//
// Render-smoke for MarketingEfficiency / Saturation (5-22). Regression net for
// render/mount-effect crashes. Golden tests cover satMath/ALLOC_MATH; this
// asserts the component MOUNTS without throwing in the no-data and with-data
// states (including the response-curve chart effect once >=1 fittable entity).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import MarketingEfficiency from "@/components/tools/MarketingEfficiency";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-22",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// A minimal VALID efficiency CSV for saturation: channel/cost/installs/date.
// Each channel needs >= SAT_CONFIG.minPoints (4) daily observations with
// cost>0 & result>0 to fit a response curve, so span 12 days × 2 channels.
// mapping = { origHeader: standardKey }.
function seedWithData() {
  const headers = ["Date", "Country", "Platform", "Channel", "Spend", "Installs"];
  const mapping = {
    Date: "date",
    Country: "country",
    Platform: "platform",
    Channel: "channel",
    Spend: "cost",
    Installs: "installs",
  };
  const raw = [];
  const channels = ["Google", "Meta"];
  for (let d = 1; d <= 12; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of channels) {
      const cost = ch === "Google" ? 100000 + d * 6000 : 80000 + d * 5000;
      // deterministic diminishing returns (result grows sub-linearly with cost) — §8, no Math.random
      const installs = Math.round(Math.pow(cost, 0.85) / (ch === "Google" ? 40 : 34));
      raw.push({ Date: date, Country: "KR", Platform: "iOS", Channel: ch, Spend: cost, Installs: installs });
    }
  }
  const slice = { raw, headers, mapping, fileName: "sat.csv" };
  useAppStore.setState({
    currentRouteId: "5-22",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice },
    csvData: slice,
  });
}

describe("MarketingEfficiency render smoke", () => {
  beforeEach(() => seedNoData());

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<MarketingEfficiency />)).not.toThrow();
    // No-data branch renders the CsvUploader panel prompting a CSV upload.
    expect(screen.getByText(/CSV 업로드 대기/)).toBeTruthy();
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    expect(() => render(<MarketingEfficiency />)).not.toThrow();
    // With-data branch renders the saturation diagnosis hero.
    expect(screen.getByText(/마케팅 효율 진단/)).toBeTruthy();
  });

  // Analysis gate: results hidden until analyzed; visible after. The tool's own
  // ▶ 분석하기 button was removed in #5 dedup — CsvUploader now owns the single
  // gate button which sets the store group signature. So we drive the gate via
  // the store (setGroupAnalyzed) and re-render to verify the gated content.
  it("gates results behind the 분석하기 button", () => {
    seedWithData();
    const { rerender } = render(<MarketingEfficiency />);
    // Before analyze: gate placeholder shown, no §0 summary section yet.
    expect(screen.getByText(/분석 대기 중/)).toBeTruthy();
    expect(screen.queryByText(/한눈에 보기/)).toBeNull();
    // Set the group gate (as CsvUploader's analyze button would).
    act(() => useAppStore.getState().setGroupAnalyzed("5-22"));
    rerender(<MarketingEfficiency />);
    // After analyze: §0 summary + §1 ranking render.
    expect(screen.getByText(/한눈에 보기/)).toBeTruthy();
    // "포화도 순위" now appears twice (section heading + right-side TOC link
    // added via ToolPageShell) — assert at least one match rather than a
    // single unique node.
    expect(screen.getAllByText(/포화도 순위/).length).toBeGreaterThan(0);
    // Currency toggle present in the analyzed view.
    expect(screen.getByRole("button", { name: /USD/ })).toBeTruthy();
  });
});
