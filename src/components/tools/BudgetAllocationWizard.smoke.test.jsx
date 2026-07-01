// @vitest-environment jsdom
//
// Render-smoke for the BudgetAllocation (5-3) multi-step wizard flow.
// Complements BudgetAllocation.smoke.test.jsx (which only mounts the Step 1
// default) — drives real DOM clicks through Step1 -> Step2 (추세선 검증) ->
// Step3 (§4 배분 비중 bar chart) so render-throw bugs in step-transition JSX
// and Chart.js effects are caught (golden tests only cover pure math, §7).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAppStore } from "@/store/useDataStore";
import BudgetAllocation from "@/components/tools/BudgetAllocation";

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
  const channels = ["Google", "Meta", "TikTok"];
  for (let d = 1; d <= 20; d++) {
    const date = `2026-01-${String(d).padStart(2, "0")}`;
    for (const ch of channels) {
      const base = ch === "Google" ? 100000 : ch === "Meta" ? 80000 : 40000;
      const cost = base + d * 3000;
      const divisor = ch === "Google" ? 5000 : ch === "Meta" ? 4200 : 6000;
      const installs = Math.round(cost / divisor);
      raw.push({ Date: date, Country: "KR", Platform: "iOS", Channel: ch, Spend: cost, Installs: installs });
    }
  }
  useAppStore.setState({
    currentRouteId: "5-3",
    csvGroups: { ...useAppStore.getState().csvGroups, efficiency: { raw, headers, mapping, fileName: "alloc.csv" } },
    csvData: { raw, headers, mapping, fileName: "alloc.csv" },
  });
}

describe("BudgetAllocation Step2/Step3 wizard flow render smoke", () => {
  beforeEach(() => {
    seedWithData();
    // jsdom doesn't implement confirm() (throws "Not implemented") — stub so the
    // unverified-groups gate can proceed deterministically in this test.
    window.confirm = () => true;
  });

  it("walks Step1 -> Step2 -> Step3 without throwing, and Step2 sidebar + chart render", () => {
    expect(() => render(<BudgetAllocation />)).not.toThrow();

    // Step 1: pick objective (Install · CPI) then apply
    const installBtn = screen.getByText(/CPI ↓/);
    fireEvent.click(installBtn);
    const applyBtn = screen.getByText(/적용 \(검증 진행\)/);
    expect(() => fireEvent.click(applyBtn)).not.toThrow();

    // Step 2 should now show the sidebar + scatter canvas
    expect(screen.getByText(/추세선 검증/)).toBeTruthy();
    const canvas = document.getElementById("chart-alloc-scatter-verify");
    expect(canvas).toBeTruthy();

    // Click a sidebar item (2nd unit if present) to exercise selection + re-render.
    const proceedBtns = screen.getAllByText(/검증 완료 및 예산 배분/);
    expect(() => fireEvent.click(proceedBtns[0])).not.toThrow();

    // Whether it proceeded or not (confirm dialog), no throw should occur.
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });

  it("reaches Step 3 and renders the §4 bar chart canvas without throwing", () => {
    render(<BudgetAllocation />);
    fireEvent.click(screen.getByText(/CPI ↓/));
    fireEvent.click(screen.getByText(/적용 \(검증 진행\)/));
    // bulk-approve then proceed to skip confirm() dialog
    const bulkBtn = screen.queryByText(/건강한 그룹 일괄 승인/);
    if (bulkBtn && !bulkBtn.disabled) fireEvent.click(bulkBtn);
    const proceedBtn = screen.getAllByText(/검증 완료 및 예산 배분|배분 모델 설정 이동/)[0];
    expect(() => fireEvent.click(proceedBtn)).not.toThrow();

    expect(document.body.textContent.length).toBeGreaterThan(0);
    // Look for the bar section presence (may be pre-budget-entry state, that's fine - no throw is the bar)
    const barSection = document.querySelector("#s-bar");
    expect(barSection).toBeTruthy();
  });

  it("renders the §4 bar chart as a real <canvas> (Chart.js) once a budget is entered", () => {
    render(<BudgetAllocation />);
    fireEvent.click(screen.getByText(/CPI ↓/));
    fireEvent.click(screen.getByText(/적용 \(검증 진행\)/));
    const bulkBtn = screen.queryByText(/건강한 그룹 일괄 승인/);
    if (bulkBtn && !bulkBtn.disabled) fireEvent.click(bulkBtn);
    fireEvent.click(screen.getAllByText(/검증 완료 및 예산 배분|배분 모델 설정 이동/)[0]);

    // Step 3: type a budget into the total-budget field to trigger the bar chart render path.
    const budgetInput = document.querySelector('input[type="text"]');
    expect(budgetInput).toBeTruthy();
    expect(() => {
      fireEvent.change(budgetInput, { target: { value: "1000000" } });
      fireEvent.blur(budgetInput);
    }).not.toThrow();

    const barCanvas = document.getElementById("alloc-bar");
    expect(barCanvas).toBeTruthy();
    expect(barCanvas.tagName).toBe("CANVAS");
    // Legacy flexbox segments must be gone from this section.
    expect(document.querySelector(".alloc-bar-seg")).toBeNull();
  });
});
