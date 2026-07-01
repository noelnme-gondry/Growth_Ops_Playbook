"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore, IA, SECTIONS, displayGroupNumberShort, displayItemNumberShort } from "@/store/useDataStore";
import { idToSlug, resolveSlugToId } from "@/lib/routeMap";

export default function Sidebar() {
  // Active id is derived from the URL (SSOT) so highlight is correct even before
  // the page-level store-sync effect runs (avoids a first-paint race).
  const pathname = usePathname();
  const currentRouteId =
    resolveSlugToId((pathname || "/").split("/").filter(Boolean)) ?? "home";
  const setCmdkOpen = useAppStore((state) => state.setCmdkOpen);

  // Keep track of collapsed states
  // By default, expand if an item is active, otherwise collapsed
  // But we need to manage local toggle state.
  // Actually, let's derive it from active route initially, and allow local toggle.
  const [collapsedSections, setCollapsedSections] = useState({});
  const [collapsedGroups, setCollapsedGroups] = useState({});

  // 첫 클릭 무반응 버그(§7): prev[id]가 아직 undefined일 때 !prev[id]로 토글하면
  // "화면에 파생상태로 보이던 값"과 무관하게 무조건 true(닫힘)로 저장돼, 이미
  // 파생상태로 열려 있던 섹션/그룹은 첫 클릭에 아무 변화가 없고 두 번째 클릭에야
  // 실제로 뒤집힘. 클릭 시점의 "현재 표시된" 값을 받아 그 반대를 명시적으로 저장.
  const toggleSection = (sectionId, currentlyCollapsed) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !currentlyCollapsed }));
  };

  const toggleGroup = (groupId, currentlyCollapsed) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !currentlyCollapsed }));
  };

  return (
    <aside className="sidebar" id="sidebar">
      <Link
        href="/"
        className="brand"
        id="brand"
        style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}
      >
        <div className="brand-mark">GO</div>
        <div>
          <div className="brand-name">Growth Ops</div>
          <div className="brand-sub">Playbook</div>
        </div>
      </Link>

      <div className="sidebar-search" onClick={() => setCmdkOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input type="text" placeholder="가이드·파라미터·코드 검색…" readOnly />
        <kbd>⌘K</kbd>
      </div>

      <nav id="nav" data-rendered="1">
        {SECTIONS.map((section) => {
          const sectionGroups = IA.filter((g) => section.groups.includes(g.id));
          const sectionHasActive = sectionGroups.some((g) =>
            g.items.some((it) => it.id === currentRouteId)
          );

          // If it hasn't been explicitly toggled, use the derived state
          const isSectionCollapsed = collapsedSections[section.id] !== undefined
            ? collapsedSections[section.id]
            : !sectionHasActive;

          return (
            <section
              key={section.id}
              className={`phase-section ${isSectionCollapsed ? "collapsed" : ""}`}
              data-section={section.id}
            >
              <button
                className="phase-header"
                type="button"
                onClick={() => toggleSection(section.id, isSectionCollapsed)}
                aria-expanded={!isSectionCollapsed}
              >
                <span className="phase-header-left">
                  <span className="phase-tag">{section.label}</span>
                </span>
                <svg className="phase-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              <div className="phase-body">
                {sectionGroups.map((group) => {
                  const hasActive = group.items.some((it) => it.id === currentRouteId);
                  const isGroupCollapsed = collapsedGroups[group.id] !== undefined
                    ? collapsedGroups[group.id]
                    : !hasActive;

                  return (
                    <div key={group.id} className={`nav-group ${isGroupCollapsed ? "collapsed" : ""}`} data-group={group.id}>
                      <div
                        className="nav-group-header"
                        onClick={() => toggleGroup(group.id, isGroupCollapsed)}
                      >
                        <span className="nav-group-title">
                          <span className="nav-group-index">{displayGroupNumberShort(group.id)}</span>
                          <span>{group.title}</span>
                        </span>
                        <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </div>
                      <div className="nav-items">
                        {group.items.map((it) => (
                          <Link
                            key={it.id}
                            href={idToSlug[it.id] || "/"}
                            className={`nav-item ${it.id === currentRouteId ? "active" : ""}`}
                            data-route={it.id}
                          >
                            <span className="ix tnum">{displayItemNumberShort(it.id)}</span>
                            <span>{it.title}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>

      <a className="sidebar-feedback" href="https://forms.gle/vxTfmt6HmxwNnWb99" target="_blank" rel="noopener noreferrer">
        <span className="sf-ico">💬</span>
        <span className="sf-text">의견 보내기<small>1분 설문</small></span>
      </a>
    </aside>
  );
}
