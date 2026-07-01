import { describe, it, expect } from "vitest";
import { pvmGenerateDiagnosis, buildPvmResultCsv } from "./pvmExport.js";

const fmt = (v) => Math.round(v).toLocaleString() + "원";

describe("pvmGenerateDiagnosis", () => {
  it("creative level mentions 최하위 + both effects", () => {
    const txt = pvmGenerateDiagnosis(
      { mix: 100, rate: -40, contribution: 60 },
      "creative",
      fmt,
    );
    expect(txt).toContain("최하위");
    expect(txt).toContain("믹스 효과");
    expect(txt).toContain("레이트 효과");
  });

  it("channel mix<0 subMix>0 → 배달 사고 문구", () => {
    const txt = pvmGenerateDiagnosis(
      { mix: -100, cmpSumMix: 50, rate: 0, contribution: -100 },
      "channel",
      fmt,
    );
    expect(txt).toContain("배달 사고");
    expect(txt).toContain("채널");
  });

  it("campaign both>0 → 비효율 문구", () => {
    const txt = pvmGenerateDiagnosis(
      { mix: 80, creativeSumMix: 30, rate: 0, contribution: 80 },
      "campaign",
      fmt,
    );
    expect(txt).toContain("비효율");
    expect(txt).toContain("하위 세그먼트합 믹스");
  });

  it("campaign mix>0 subMix<0 → 캠페인 최적화 문구", () => {
    const txt = pvmGenerateDiagnosis(
      { mix: 80, creativeSumMix: -30, rate: 0, contribution: 50 },
      "campaign",
      fmt,
    );
    expect(txt).toContain("캠페인");
    expect(txt).toContain("최적화");
  });
});

describe("buildPvmResultCsv", () => {
  const cache = {
    currency: "krw",
    weekBasis: "calendar",
    lookback: 1,
    p1Range: ["2026-01-01", "2026-01-07"],
    p2Range: ["2026-01-08", "2026-01-14"],
    CPA1: 10,
    CPA2: 12,
    Cost1: 1000,
    Cost2: 1200,
    Result1: 100,
    Result2: 100,
    deltaCpa: 2,
    campaignMapped: true,
    crUrlMap: null,
    finest: [
      { chKey: "A", cmpKey: "A1", crKey: "cr1", cost1: 600, cost2: 700, result1: 60, result2: 58, cpa1: 10, cpa2: 12.07, s1: 0.6, s2: 0.58, mix: 0.5, rate: 1.2, contribution: 1.7 },
      { chKey: "A", cmpKey: "A1", crKey: "cr2", cost1: 400, cost2: 500, result1: 40, result2: 42, cpa1: 10, cpa2: 11.9, s1: 0.4, s2: 0.42, mix: -0.2, rate: 0.8, contribution: 0.6 },
    ],
    layer2: [
      { chKey: "A", cmpKey: "A1", key: "A1", contribution: 2.3, mix: 0.3, rate: 2.0 },
    ],
    layer1: [
      { key: "A", contribution: 2.0, mix: 0.3, rate: 1.7 },
    ],
  };

  it("emits BOM + CRLF joined lines", () => {
    const csv = buildPvmResultCsv(cache, "CPA");
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain("\r\n");
  });

  it("includes META, SCORECARD, CREATIVE_FULL, CAMPAIGN, CHANNEL sections", () => {
    const csv = buildPvmResultCsv(cache, "CPA");
    expect(csv).toContain("META");
    expect(csv).toContain("SCORECARD");
    expect(csv).toContain("CREATIVE_FULL");
    expect(csv).toContain("CAMPAIGN");
    expect(csv).toContain("CHANNEL");
  });

  it("emits live spreadsheet formulas for mix/rate/impact", () => {
    const csv = buildPvmResultCsv(cache, "CPA");
    expect(csv).toContain("mix=(cpaBar-Cbar)*(share2-share1)");
    // finest row impact formula =Q+R+S
    expect(/=Q\d+\+R\d+\+S\d+/.test(csv)).toBe(true);
    // scorecard delta formula
    expect(/=D\d+-C\d+/.test(csv)).toBe(true);
  });

  it("skips CAMPAIGN block when campaign not mapped", () => {
    const noCmp = { ...cache, campaignMapped: false };
    const csv = buildPvmResultCsv(noCmp, "CPA");
    expect(csv).not.toContain("CAMPAIGN");
    expect(csv).toContain("CHANNEL");
  });
});
