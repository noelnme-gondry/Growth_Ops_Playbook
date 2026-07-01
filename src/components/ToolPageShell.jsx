"use client";
import React from "react";

/**
 * ToolPageShell — 5-x 분석 도구 공용 레이아웃 래퍼.
 *
 * 레거시 index.html의 `pageShell()` 중 5-x 분기(§4.1, CLAUDE.md)를 그대로
 * 미러링: page-sticky-bar(제목+칩+옵션 stickyFilter) + summary 콜아웃 +
 * children(본문) + 우측 플로팅 TOC. Dashboard.jsx가 이미 검증한 클래스/스타일
 * 값을 그대로 재사용(신규 스타일 발명 금지 — CLAUDE.md 지침).
 *
 * 순수 프레젠테이션 컴포넌트: store 구독·비즈니스 로직 없음.
 */
export default function ToolPageShell({ title, chips, summary, toc, stickyFilter, children }) {
  const tocItems = toc || [];
  const hasToc = tocItems.length > 0;

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* Main Content Area */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: hasToc ? "220px" : "0" }}>
        {/* Sticky title bar — legacy page-sticky-bar/page-sticky-row1/page-sticky-title
            (index.html pageShell 5-x 분기, CLAUDE.md §4.1) */}
        <div className="page-sticky-bar">
          <div className="page-sticky-row1">
            <span className="page-sticky-title">{title}</span>
            {chips}
          </div>
          {stickyFilter}
        </div>

        {/* Summary callout — .summary/.summary-label (globals.css, MarketingEfficiency.jsx 패턴 재사용) */}
        {summary && (
          <div className="summary">
            <div className="summary-label">핵심 요약</div>
            {summary}
          </div>
        )}

        {children}
      </div>

      {/* Floating Table of Contents (Right Side) — Dashboard.jsx 우측 TOC aside와 동일 마크업/포지셔닝 */}
      {hasToc && (
        <aside
          style={{
            position: "fixed",
            top: "100px",
            right: "24px",
            width: "180px",
            borderLeft: "1px solid var(--border-subtle)",
            paddingLeft: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: "700",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "4px",
            }}
          >
            목차
          </div>
          {tocItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              style={{ fontSize: "12px", color: "var(--text-2)", textDecoration: "none", transition: "color 0.2s" }}
              onMouseOver={(e) => (e.target.style.color = "var(--text-1)")}
              onMouseOut={(e) => (e.target.style.color = "var(--text-2)")}
            >
              {item.title}
            </a>
          ))}
        </aside>
      )}
    </div>
  );
}
