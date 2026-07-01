"use client";
import React from "react";
import { useAppStore } from "@/store/useDataStore";
import { 
  Monitor, 
  TrendingUp, 
  BarChart2, 
  Activity,
  LineChart,
  Users,
  Filter,
  Grid,
  Clock,
  Target
} from "lucide-react";

const MON_TAB_GROUPS = [
  { label: "모니터링", icon: <Monitor size={14} />, tabs: ["viz", "scorecard", "pacing", "anomaly"] },
  { label: "장기 가치", icon: <TrendingUp size={14} />, tabs: ["ltv", "cohort"] },
  { label: "효율 진단", icon: <Target size={14} />, tabs: ["funnel", "segment"] },
];

const TABS_INFO = {
  viz: { label: "시각화", icon: <BarChart2 size={13} /> },
  scorecard: { label: "스코어카드", icon: <Grid size={13} /> },
  pacing: { label: "페이싱", icon: <Clock size={13} /> },
  anomaly: { label: "이상탐지", icon: <Activity size={13} /> },
  ltv: { label: "LTV & ROAS", icon: <LineChart size={13} /> },
  cohort: { label: "코호트 분석", icon: <Users size={13} /> },
  funnel: { label: "퍼널 진단", icon: <Filter size={13} /> },
  segment: { label: "세그먼트", icon: <Grid size={13} /> },
};

export default function DashboardTabs() {
  const dashboardTab = useAppStore((state) => state.dashboardTab);
  const setDashboardTab = useAppStore((state) => state.setDashboardTab);
  const csvData = useAppStore((state) => state.csvData);

  const hasData = csvData && csvData.raw.length > 0;
  if (!hasData) return null;

  return (
    <div className="mon-sticky-bar" style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", margin: "2px 0 16px 0" }}>
      {MON_TAB_GROUPS.map((group, gIdx) => (
        <React.Fragment key={group.label}>
          <div style={{ display: "inline-flex", alignItems: "center", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "3px 6px", gap: "2px" }}>
            <span style={{ fontSize: "10.5px", color: "var(--text-muted)", fontWeight: "700", marginRight: "6px", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "4px" }}>
              {group.icon} {group.label}
            </span>
            {group.tabs.map((tabId) => {
              const info = TABS_INFO[tabId];
              const isActive = dashboardTab === tabId;
              return (
                <button
                  key={tabId}
                  className={`ab-pill ${isActive ? "active" : ""}`}
                  onClick={() => setDashboardTab(tabId)}
                  style={{ display: "inline-flex", alignItems: "center", gap: "4px", margin: "2px", cursor: "pointer" }}
                >
                  {info.icon} {info.label}
                </button>
              );
            })}
          </div>
          {gIdx < MON_TAB_GROUPS.length - 1 && (
            <span style={{ color: "var(--border-stronger)", alignSelf: "center", fontSize: "16px", margin: "0 4px" }}>|</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
