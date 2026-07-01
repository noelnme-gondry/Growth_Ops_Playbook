// @vitest-environment jsdom
//
// Render-smoke for CampaignPvm (5-21). Regression net for render/mount-effect
// crashes (the class of bug this component is named after). Golden tests cover
// the pure PVM_MATH decomposition; this asserts the component MOUNTS without
// throwing in the no-data and with-data states.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import CampaignPvm from "@/components/tools/CampaignPvm";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "5-21",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

// A minimal VALID efficiency CSV for PVM: channel/cost/installs/date. PVM needs
// >=2 calendar weeks so the lookback compare (P1 vs P2) isn't fully locked, so
// span 21 days (3 weeks) across 2 channels. mapping = { origHeader: standardKey }.
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
  // 2026-01-05 is a Monday → 3 full calendar weeks (05..25).
  for (let d = 5; d <= 25; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of channels) {
      const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
      const installs = Math.round(cost / (ch === "Google" ? 5000 : 4200)); // NO Math.random — §8
      raw.push({ Date: date, Country: "KR", Platform: "iOS", Channel: ch, Spend: cost, Installs: installs });
    }
  }
  const slice = { raw, headers, mapping, fileName: "pvm.csv" };
  useAppStore.setState({
    currentRouteId: "5-21",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice },
    csvData: slice,
  });
}

describe("CampaignPvm render smoke", () => {
  beforeEach(() => seedNoData());

  it("mounts without throwing in the no-data state", () => {
    expect(() => render(<CampaignPvm />)).not.toThrow();
    // No-data branch shows the uploader-prep block (ToolPageShell also renders
    // a matching TOC link with the same text, so scope to the section heading).
    expect(screen.getByRole("heading", { name: "데이터 준비" })).toBeTruthy();
  });

  it("mounts without throwing with a valid seeded CSV", () => {
    seedWithData();
    expect(() => render(<CampaignPvm />)).not.toThrow();
    // With-data branch renders the "한눈에 보기" §0 section (heading, distinct
    // from the ToolPageShell TOC link of the same name).
    expect(screen.getByRole("heading", { name: /한눈에 보기/ })).toBeTruthy();
  });
});
