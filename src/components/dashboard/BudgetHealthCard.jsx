"use client";
import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useDataStore";
import { idToSlug } from "@/lib/routeMap";

const BUDGET_HEALTH_RULES = {
  minCostShare: 0.05,
  minCprGapRatio: 0.2,
  minDays: 5,
  minRows: 5,
};

function calcCprWeightedAllocPure(campaigns) {
  const valid = campaigns.filter((c) => c.avgCPR > 0 && isFinite(c.avgCPR));
  if (!valid.length) return {};
  const totalEff = valid.reduce((s, c) => s + 1 / c.avgCPR, 0);
  if (totalEff <= 0) return {};
  const out = {};
  for (const c of valid) out[c.id] = 1 / c.avgCPR / totalEff;
  return out;
}

export default function BudgetHealthCard() {
  const csvData = useAppStore((state) => state.csvData);
  const router = useRouter();

  const health = useMemo(() => {
    if (!csvData || !csvData.raw.length) return { hasData: false };

    const recentDays = 28;
    const allRows = csvData.raw;

    const dts = allRows
      .map((r) => (r.date ? Date.parse(r.date) : NaN))
      .filter((d) => !isNaN(d));
    if (!dts.length) return { hasData: false };
    const maxDate = Math.max(...dts);
    const threshold = maxDate - recentDays * 86400 * 1000;
    const rows = allRows.filter((r) => r.date && Date.parse(r.date) >= threshold);
    if (!rows.length) return { hasData: false };

    const hasCountry = rows.some((r) => r.country);
    const hasPlatform = rows.some((r) => r.platform);
    const segKey = (r) => {
      const parts = [];
      if (hasCountry && r.country) parts.push(r.country);
      if (hasPlatform && r.platform) parts.push(r.platform);
      return parts.length ? parts.join("|") : "_all";
    };
    const campKey = (r) => r.campaign_name || r.channel || "_total";

    const segs = new Map();
    const metric = "installs"; // fallback

    for (const r of rows) {
      const sk = segKey(r), ck = campKey(r);
      if (!segs.has(sk)) segs.set(sk, new Map());
      const seg = segs.get(sk);
      if (!seg.has(ck)) {
        seg.set(ck, { id: ck, totalCost: 0, totalResults: 0, dates: new Set(), rowCount: 0 });
      }
      const c = seg.get(ck);
      c.totalCost += Number(r.cost) || 0;
      c.totalResults += Number(r[metric]) || 0;
      if (r.date) c.dates.add(r.date);
      c.rowCount++;
    }

    const flags = [];
    let totalReallocPotential = 0;

    for (const [sk, seg] of segs) {
      const camps = [...seg.values()].map((c) => ({
        ...c,
        dayCount: c.dates.size,
        avgCPR: c.totalResults > 0 ? c.totalCost / c.totalResults : null,
      }));
      const segCost = camps.reduce((s, c) => s + c.totalCost, 0);
      if (segCost <= 0) continue;

      const validCamps = camps.filter((c) => c.avgCPR != null && c.avgCPR > 0);
      if (validCamps.length < 2) continue;

      const allocShares = calcCprWeightedAllocPure(validCamps);
      const wCPR = validCamps.reduce((s, c) => s + 1 / c.avgCPR, 0);
      const segEffCPR = wCPR > 0 ? validCamps.length / wCPR : null;

      for (const c of validCamps) {
        if (!c.avgCPR || !segEffCPR) continue;
        const costShare = c.totalCost / segCost;
        const cprRatio = c.avgCPR / segEffCPR - 1;
        const dataOK = c.dayCount >= BUDGET_HEALTH_RULES.minDays && c.rowCount >= BUDGET_HEALTH_RULES.minRows;
        if (!dataOK) continue;

        if (costShare >= BUDGET_HEALTH_RULES.minCostShare && cprRatio >= BUDGET_HEALTH_RULES.minCprGapRatio) {
          const effAllocCost = (allocShares[c.id] || 0) * segCost;
          const reallocDiff = c.totalCost - effAllocCost;
          if (reallocDiff > 0) {
            flags.push({ seg: sk, campaign: c.id, costShare, cprRatio, reallocDiff });
            totalReallocPotential += reallocDiff;
          }
        }
      }
    }

    return {
      hasData: true,
      segmentCount: segs.size,
      flagCount: flags.length,
      flags,
      totalReallocPotential,
      recentDays,
    };
  }, [csvData]);

  if (!health.hasData || !health.flagCount) return null;

  const potential = Math.round(health.totalReallocPotential).toLocaleString();

  return (
    <div className="callout warning" style={{ marginBottom: "1.25rem" }} id="budget-health-card">
      <div className="ico">💰</div>
      <div className="body">
        <strong>예산 배분 이상 탐지</strong>
        <p>
          최근 {health.recentDays}일 기준 <strong>{health.flagCount}개 캠페인</strong>이 세그먼트 내 효율 구간을 초과합니다. 재배분 여지 약 <strong>{potential}</strong>.
        </p>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          캠페인별 상세 배분 계획·시나리오는 예산 배분에서 확인하세요.
        </p>
        <button
          className="btn primary"
          style={{ marginTop: "0.5rem" }}
          onClick={() => router.push(idToSlug["5-3"])}
        >
          📊 예산 배분에서 보기 →
        </button>
      </div>
    </div>
  );
}
