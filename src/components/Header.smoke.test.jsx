// @vitest-environment jsdom
//
// Render-smoke for Header. Regression net for a render/mount-effect throw. Header
// runs two mount effects (theme apply → localStorage + body class; theme restore
// → matchMedia). It reads isDarkMode/theme from the store, NOT csvData. We seed
// the store (no-data + with-data) for parity; the topbar must mount either way.
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import Header from "@/components/Header";

const EMPTY_CSV = { raw: [], headers: [], mapping: {}, fileName: "" };

function seedNoData() {
  useAppStore.setState({
    currentRouteId: "home",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: EMPTY_CSV },
    csvData: EMPTY_CSV,
  });
}

function seedWithData() {
  const headers = ["Date", "Country", "Platform", "Channel", "Spend", "Installs"];
  const mapping = { Date: "date", Country: "country", Platform: "platform", Channel: "channel", Spend: "cost", Installs: "installs" };
  const raw = [];
  for (let d = 1; d <= 10; d++) for (const ch of ["Google", "Meta"]) {
    const cost = ch === "Google" ? 100000 + d * 3000 : 80000 + d * 2500;
    raw.push({ Date: `2026-01-${String(d).padStart(2, "0")}`, Country: "KR", Platform: "iOS", Channel: ch, Spend: cost, Installs: Math.round(cost / (ch === "Google" ? 5000 : 4200)) });
  }
  const slice = { raw, headers, mapping, fileName: "x.csv" };
  useAppStore.setState({ currentRouteId: "5-2", csvGroups: { ...useAppStore.getState().csvGroups, efficiency: slice }, csvData: slice });
}

describe("Header render smoke", () => {
  beforeEach(() => seedNoData());
  it("no-data mounts", () => {
    expect(() => render(<Header />)).not.toThrow();
    expect(document.querySelector("header.topbar")).toBeTruthy();
  });
  it("with-data mounts", () => {
    seedWithData();
    expect(() => render(<Header />)).not.toThrow();
    expect(document.querySelector("#theme-toggle")).toBeTruthy();
  });
});
