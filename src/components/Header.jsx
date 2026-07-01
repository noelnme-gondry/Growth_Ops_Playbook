"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore, findMeta, displayGroupNumber, displayItemNumber } from "@/store/useDataStore";
import { resolveSlugToId } from "@/lib/routeMap";

export default function Header() {
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const setCmdkOpen = useAppStore((state) => state.setCmdkOpen);
  // 현재 활성 그룹(효율/소재/실험/응답/aha)의 csvData — 전역 헤더에서 파일명 노출 +
  // 어느 도구에서든 동일하게 초기화 가능하게(§ 그룹 스코프 csvData 미러).
  const csvData = useAppStore((state) => state.csvData);
  const setCsvData = useAppStore((state) => state.setCsvData);
  const hasCsv = !!(csvData && csvData.raw && csvData.raw.length > 0);
  const resetCsv = () => setCsvData({ raw: [], headers: [], mapping: {}, fileName: "" });
  // Breadcrumb sourced from the URL (SSOT) → correct on deep-link + back/forward.
  const pathname = usePathname();
  const currentRouteId =
    resolveSlugToId((pathname || "/").split("/").filter(Boolean)) ?? "home";

  // Apply theme to body tag + localStorage persistence (원본 initTheme/toggleTheme 동일 로직)
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove("light-mode");
    } else {
      document.body.classList.add("light-mode");
    }
    localStorage.setItem("mkt-library-theme", isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  // On mount: restore saved theme from localStorage. 기본값=라이트모드(store 초기값) —
  // 명시적으로 저장된 dark 선택만 복원, 시스템 설정으로 임의 전환하지 않음(새로고침마다
  // 라이트모드가 dark로 되돌아가던 버그 원인 — Gondry 피드백).
  useEffect(() => {
    const savedTheme = localStorage.getItem("mkt-library-theme");
    if (savedTheme === "dark" && !isDarkMode) {
      toggleTheme(); // switch to dark
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 브레드크럼: 홈이면 "Library / Overview", 도구/문서 페이지면 3단계
  // (Library / {그룹번호 · 그룹명} / {항목번호 · 항목명}) — 원본 setBreadcrumb 동일.
  const meta = currentRouteId === "home" ? null : findMeta(currentRouteId);

  return (
    <header className="topbar" role="banner">
      <nav className="breadcrumb" aria-label="페이지 경로">
        <Link href="/" className="crumb-link" style={{ textDecoration: "none", color: "inherit" }}>Library</Link>
        {meta ? (
          <>
            <span className="sep">/</span>
            <span
              className="current"
              title={meta.group.title}
              style={{ color: "var(--text-secondary)", cursor: "default" }}
            >
              {displayGroupNumber(meta.group.id)} · {meta.group.title}
            </span>
            <span className="sep">/</span>
            <span className="current">
              {displayItemNumber(meta.id)} · {meta.title}
            </span>
          </>
        ) : (
          <>
            <span className="sep">/</span>
            <span className="current">Overview</span>
          </>
        )}
      </nav>
      <div className="topbar-actions">
        {hasCsv && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--text-muted)", marginRight: "4px" }}>
            <span className="chip" title={csvData.fileName}>
              <span className="dot"></span>{csvData.fileName || "data.csv"}
            </span>
            <button
              className="btn ghost"
              type="button"
              title="현재 CSV를 지우고 다시 업로드 (이 CSV를 공유하는 모든 도구에 적용)"
              onClick={resetCsv}
              style={{ fontSize: "11.5px" }}
            >
              🔄 CSV 변경
            </button>
          </span>
        )}
        <button
          className="btn ghost"
          id="theme-toggle"
          type="button"
          aria-label="테마 전환"
          title="테마 전환 (라이트/다크)"
          onClick={toggleTheme}
        >
          {/* 원본 로직: 다크모드일 때 sun 아이콘 보여주고(클릭→라이트로), 라이트모드일 때 moon 아이콘 */}
          {isDarkMode ? (
            <svg className="sun-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          ) : (
            <svg className="moon-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          )}
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => setCmdkOpen(true)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>빠른 이동</span>
          <span className="kbd">⌘K</span>
        </button>
      </div>
    </header>
  );
}
