"use client";
import React, { useState } from "react";
import { useAppStore } from "@/store/useDataStore";
import CsvUploader from "@/components/CsvUploader";
import DashboardFilterBar from "@/components/dashboard/DashboardFilterBar";
import DashboardTabs from "@/components/dashboard/DashboardTabs";
import VizTab from "@/components/dashboard/VizTab";
import ScorecardTab from "@/components/dashboard/ScorecardTab";
import PacingTab from "@/components/dashboard/PacingTab";
import MonEventMarkerUI from "@/components/tools/MonEventMarkerUI";
import AnomalyTab from "@/components/dashboard/AnomalyTab";
import LtvTab from "@/components/dashboard/LtvTab";
import CohortTab from "@/components/dashboard/CohortTab";
import FunnelTab from "@/components/dashboard/FunnelTab";
import SegmentTab from "@/components/dashboard/SegmentTab";
import { FileText, ChevronRight } from "lucide-react";

const TOC_MAP = {
  viz: [
    { id: "s-cohort", title: "코호트" },
    { id: "s-kpi", title: "KPI 요약" },
    { id: "s-charts", title: "차트" },
  ],
  scorecard: [{ id: "s-score", title: "스코어카드" }],
  pacing: [{ id: "s-pace", title: "페이싱" }],
  anomaly: [{ id: "s-anom", title: "이상 감지" }],
  ltv: [
    { id: "s-ctl", title: "분석 단위" },
    { id: "s-table", title: "LTV:CAC 표" },
    { id: "s-mat", title: "ROAS 성숙도" },
  ],
  cohort: [
    { id: "s-retention", title: "리텐션 곡선" },
    { id: "s-ret-segment", title: "세그먼트별" },
    { id: "s-ret-predict", title: "예측" },
  ],
  funnel: [
    { id: "s-funnel-wow", title: "주간 변화" },
    { id: "s-funnel-ctl", title: "단계 선택" },
    { id: "s-funnel-trend", title: "시계열 급락" },
    { id: "s-funnel-seg", title: "세그먼트 랭킹" },
    { id: "s-funnel", title: "전체 퍼널 표" },
  ],
  segment: [{ id: "s-matrix", title: "세그먼트" }],
};

export default function Dashboard() {
  const csvData = useAppStore((state) => state.csvData);
  const dashboardTab = useAppStore((state) => state.dashboardTab);
  // #4 분석 게이트: 업로드·자동매핑만으로는 바로 분석하지 않는다. 사용자가
  // CsvUploader의 "분석하기"를 눌러 매핑을 확정해야(그룹 sig 저장) 결과가 열림.
  // 매핑을 바꾸면 sig가 달라져 다시 false → 결과 자동 숨김(faithful isToolAnalyzed).
  const analyzed = useAppStore((state) => state.isGroupAnalyzed("5-2"));
  // 분석 완료 후 접힌 "데이터 매핑 설정" details — native <details>는 열림/닫힘 상태를
  // React가 자동으로 모르므로 controlled로 추적(라벨 펼치기/접기 동기화, §CLAUDE 12.20류 렌더층 패턴).
  const [mappingOpen, setMappingOpen] = useState(false);

  const hasData = csvData && csvData.raw.length > 0;
  // 결과(탭·차트·TOC)는 데이터가 있고 + 분석이 확정된 뒤에만 렌더.
  const showResults = hasData && analyzed;
  const currentToc = showResults ? TOC_MAP[dashboardTab] || [] : [];

  return (
    <div className="section active" style={{ display: "flex", width: "100%", height: "100%" }}>
      
      {/* Main Content Area */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: showResults ? "220px" : "0" }}>
        {/* Header / Breadcrumb - Assuming handled by layout, but title here */}
        <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontSize: "20px", fontWeight: "700", margin: 0 }}>운영 대시보드</h1>
          {hasData && (
            <>
              <span className="chip" style={{ display: "inline-flex", alignItems: "center", background: "var(--bg-2)", border: "1px solid var(--border)", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", color: "var(--text-1)" }}>
                <span className="dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", marginRight: "6px" }}></span>
                {csvData.fileName || "Data.csv"}
              </span>
              <span className="chip ok" style={{ display: "inline-flex", alignItems: "center", background: "var(--bg-2)", border: "1px solid var(--border)", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", color: "var(--success)" }}>
                <span className="dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--success)", marginRight: "6px" }}></span>
                {csvData.raw.length.toLocaleString()}행
              </span>
            </>
          )}
        </div>

        {!hasData && (
          <p style={{ color: "var(--text-secondary)", marginBottom: "2rem", fontSize: "13px" }}>
            일일 캠페인 리포트 CSV를 업로드하여 성과를 요약하고 주요 지표를 시각화합니다.
          </p>
        )}

        {/* Filter Bar (#2 sticky) — 결과가 열린 뒤 스크롤해도 필터/기준 토글이
            상단(topbar 아래 top:48px)에 고정. 조상에 overflow가 없어(.app/.main/
            .content 모두 non-overflow) viewport 기준 sticky가 정상 동작. 배경·블러로
            아래 콘텐츠가 비쳐도 겹쳐 보이지 않게. 브레드크럼 복원은 Header 담당. */}
        {showResults && (
          <div
            className="mon-sticky-bar"
            style={{
              position: "sticky",
              top: "48px",
              zIndex: 9,
              background: "var(--page-sticky-bg)",
              backdropFilter: "saturate(160%) blur(8px)",
              margin: "0 -2.5rem",
              padding: "0 2.5rem",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <DashboardFilterBar />
          </div>
        )}

        {/* Csv Uploader — 상태별 3분기:
            ① 데이터 없음: 업로드 안내 + 드롭존(펼침).
            ② 데이터 有 · 미분석(#4): 매핑을 바로 볼 수 있게 펼친 상태로 노출 →
               사용자가 "데이터 분석하기"를 눌러 확정(CsvUploader가 게이트 세팅).
            ③ 데이터 有 · 분석 완료: 매핑을 접어(details) 결과에 집중. */}
        {!hasData ? (
          <div className="block">
            <h2 className="section-title">데이터 업로드</h2>
            <p className="card-desc" style={{ marginBottom: "1rem" }}>운영 대시보드를 생성하기 위해 마케팅 성과 CSV 파일을 업로드해주세요.</p>
            <CsvUploader toolId="5-2" />
          </div>
        ) : !analyzed ? (
          <div className="block" style={{ padding: "12px", margin: "0 0 16px", borderRadius: "var(--radius-lg)", background: "rgba(255,255,255,0.01)" }}>
            <div style={{ marginBottom: "8px", fontSize: "11px", color: "var(--text-muted)" }}>
              🔒 업로드 데이터는 브라우저 메모리에서만 안전하게 유지됩니다.
            </div>
            <CsvUploader toolId="5-2" />
          </div>
        ) : (
          <details
            className="block"
            open={mappingOpen}
            onToggle={(e) => setMappingOpen(e.target.open)}
            style={{ padding: "8px 12px", margin: "0 0 16px", borderRadius: "var(--radius-lg)", background: "rgba(255,255,255,0.01)" }}
          >
            <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: "700", color: "var(--primary, #adc6ff)", outline: "none", display: "flex", alignItems: "center" }}>
              <span style={{ marginRight: "6px" }}>⚙</span> 데이터 매핑 설정 {mappingOpen ? "(접기)" : "(펼치기)"}
            </summary>
            <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px dashed var(--border-subtle)" }}>
              <div style={{ marginBottom: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
                🔒 업로드 데이터는 브라우저 메모리에서만 안전하게 유지됩니다.
              </div>
              <CsvUploader toolId="5-2" />
            </div>
          </details>
        )}

        {/* #4 분석 대기: 데이터는 있으나 아직 "분석하기" 미확정 → 탭/결과 대신
            안내 플레이스홀더. 위 CsvUploader가 "데이터 분석하기"를 제공
            (게이트는 CsvUploader가 setGroupAnalyzed로 확정). */}
        {hasData && !analyzed && (
          <div className="card" style={{ marginTop: "1rem", textAlign: "center", padding: "2.5rem 1rem" }}>
            <div style={{ fontSize: "28px", marginBottom: "0.75rem" }}>🗂</div>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "15px", fontWeight: "700" }}>분석 대기 중</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0, lineHeight: 1.6 }}>
              위에서 컬럼 매핑이 올바른지 확인한 뒤
              <br />
              <strong>&quot;데이터 분석하기&quot;</strong>를 눌러 대시보드를 생성하세요.
              <br />
              <span style={{ fontSize: "11.5px" }}>매핑을 바꾸면 결과가 숨겨지고 다시 분석해야 합니다.</span>
            </p>
          </div>
        )}

        {/* Tabs & Content */}
        {showResults && (
          <div className="dashboard-content">
            <MonEventMarkerUI />
            <DashboardTabs />
            
            <div className="tab-content" style={{ marginTop: "1rem" }}>
              {dashboardTab === "viz" && <VizTab />}
              {dashboardTab === "scorecard" && <ScorecardTab />}
              {dashboardTab === "pacing" && <PacingTab />}
              {dashboardTab === "anomaly" && <AnomalyTab />}
              {dashboardTab === "ltv" && <LtvTab />}
              {dashboardTab === "cohort" && <CohortTab />}
              {dashboardTab === "funnel" && <FunnelTab />}
              {dashboardTab === "segment" && <SegmentTab />}
              {!["viz", "scorecard", "pacing", "anomaly", "ltv", "cohort", "funnel", "segment"].includes(dashboardTab) && (
                <div className="card">
                  <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem 0" }}>
                    [{dashboardTab}] 탭은 현재 마이그레이션 중입니다...
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Table of Contents (Right Side) — 결과가 열린 뒤에만(섹션 앵커 존재). */}
      {showResults && (
        <aside style={{
          position: "fixed",
          top: "100px",
          right: "24px",
          width: "180px",
          borderLeft: "1px solid var(--border-subtle)",
          paddingLeft: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}>
          <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
            목차
          </div>
          {currentToc.map((item) => (
            <a 
              key={item.id} 
              href={`#${item.id}`}
              style={{ fontSize: "12px", color: "var(--text-2)", textDecoration: "none", transition: "color 0.2s" }}
              onMouseOver={(e) => e.target.style.color = "var(--text-1)"}
              onMouseOut={(e) => e.target.style.color = "var(--text-2)"}
            >
              {item.title}
            </a>
          ))}
        </aside>
      )}
    </div>
  );
}
