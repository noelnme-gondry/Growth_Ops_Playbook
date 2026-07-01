"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IA, SECTIONS } from "@/store/useDataStore";
import { idToSlug } from "@/lib/routeMap";

const GUIDE_SECTION = SECTIONS.find((s) => s.id === "guide");
const ANALYSIS_SECTION = SECTIONS.find((s) => s.id === "analysis");
const OPS_GROUP_IDS = new Set(ANALYSIS_SECTION.groups);

const GROUP_ICONS = { "05": "📊", "06": "🎨", "07": "🧪" };

function escapeHtml(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ──────────────────────────── STEP 1 ──────────────────────────── */
function LandingHome({ onTrack }) {
  const totalGuides = IA.filter((g) => !OPS_GROUP_IDS.has(g.id)).reduce(
    (a, g) => a + g.items.length,
    0
  );
  const totalTools = IA.filter((g) => OPS_GROUP_IDS.has(g.id)).reduce(
    (a, g) => a + g.items.length,
    0
  );

  return (
    <>
      <div className="page-eyebrow">Growth Ops Playbook</div>
      <h1 className="page-title">무엇을 하시겠어요?</h1>
      <p className="page-deck">
        운영 표준 가이드를 보거나, 내 운영 데이터를 올려 바로 분석하세요. 원하는
        쪽을 고르면 그 안에서만 메뉴가 열립니다.
      </p>

      <div
        className="phase-grid"
        style={{
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          marginTop: "1.6rem",
        }}
      >
        {/* 가이드 카드 */}
        <div
          className="phase-card"
          style={{ cursor: "pointer" }}
          onClick={() => onTrack("guide")}
        >
          <div className="phase-card-head">
            <span className="phase-card-step">가이드</span>
            <span className="phase-card-tag">SOP 문서</span>
          </div>
          <div className="phase-card-title">📘 운영 가이드 확인</div>
          <div className="phase-card-desc">
            MMP·트래킹 셋업부터 캠페인 운영·소재, 운영 후 분석·최적화까지. 단계별
            표준 절차 문서.
          </div>
          <div className="phase-card-foot">
            <span className="phase-card-meta tnum">{totalGuides}개 가이드</span>
          </div>
          <div className="phase-card-cta">가이드 보기 →</div>
        </div>

        {/* 분석 카드 */}
        <div
          className="phase-card phase-card-tool"
          style={{ cursor: "pointer" }}
          onClick={() => onTrack("analyze")}
        >
          <div className="phase-card-head">
            <span className="phase-card-step">분석</span>
            <span className="phase-card-tag">대시보드 · 도구</span>
          </div>
          <div className="phase-card-title">📊 마케팅 분석 · 대시보드</div>
          <div className="phase-card-desc">
            실제 운영한 캠페인 CSV를 올려 대시보드 시각화·효율 분석·실험 판독·고급
            회귀까지. 시각화·모니터링은 무료.
          </div>
          <div className="phase-card-foot">
            <span className="phase-card-meta tnum">
              {totalTools}개 분석 도구
            </span>
          </div>
          <div className="phase-card-cta">분석 시작 →</div>
        </div>
      </div>
    </>
  );
}

/* ──────────────────────────── STEP 2a ──────────────────────────── */
function LandingGuide({ onBack, onNavigate }) {
  // 가이드 섹션(01~04)을 병렬로 나열 — 예전엔 셋업/운영/운영후분석 3단계로
  // 불균등하게 묶었으나, 그룹당 1카드로 펼쳐 순서만 참고하게 함(강제 단계 아님).
  const guideGroups = IA.filter((g) => GUIDE_SECTION.groups.includes(g.id));

  return (
    <>
      <button
        className="landing-back-btn"
        onClick={onBack}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          color: "var(--text-2)",
          borderRadius: "9px",
          padding: "7px 13px",
          fontSize: "12.5px",
          cursor: "pointer",
          marginBottom: "1.2rem",
        }}
      >
        ← 처음으로
      </button>
      <div className="page-eyebrow">운영 가이드</div>
      <h1 className="page-title">어느 가이드를 보시겠어요?</h1>
      <p className="page-deck">
        셋업 → 운영 → 소재 → 운영 후 분석, 참고할 순서대로 나열했습니다.
      </p>
      <div className="phase-grid" style={{ marginTop: "1.4rem" }}>
        {guideGroups.map((g, idx) => (
          <a
            key={g.id}
            className="phase-card"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onNavigate(g.items[0].id);
            }}
            style={{ cursor: "pointer", textDecoration: "none" }}
          >
            <div className="phase-card-head">
              <span className="phase-card-step">STEP {idx + 1}</span>
            </div>
            <div className="phase-card-title">{g.title}</div>
            <div className="phase-card-desc">{g.desc}</div>
            <div className="phase-card-foot">
              <span className="phase-card-meta">
                {g.items.map((it) => it.title).join(" / ")}
              </span>
              <span className="phase-card-meta tnum">{g.items.length}개 항목</span>
            </div>
            <div className="phase-card-cta">시작하기 →</div>
          </a>
        ))}
      </div>
    </>
  );
}

/* ──────────────────────────── STEP 2b ──────────────────────────── */
function LandingAnalyze({ onBack, onNavigate }) {
  const opsGroups = IA.filter((g) => OPS_GROUP_IDS.has(g.id));

  const findMeta = (id) => {
    for (const group of IA) {
      const item = group.items.find((i) => i.id === id);
      if (item) return item;
    }
    return null;
  };

  return (
    <>
      <button
        className="landing-back-btn"
        onClick={onBack}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          color: "var(--text-2)",
          borderRadius: "9px",
          padding: "7px 13px",
          fontSize: "12.5px",
          cursor: "pointer",
          marginBottom: "1.2rem",
        }}
      >
        ← 처음으로
      </button>
      <div className="page-eyebrow">마케팅 분석 · 대시보드</div>
      <h1 className="page-title">무엇을 분석하시겠어요?</h1>
      <p className="page-deck">
        목표를 고르면 맞는 도구로 바로 들어갑니다.{" "}
        <strong>모든 분석 도구를 무료</strong>로 사용할 수 있습니다.
      </p>

      {opsGroups.map((g) => (
        <section key={g.id} className="block" style={{ marginTop: "1rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "10px",
            }}
          >
            <span style={{ fontSize: "18px" }}>
              {GROUP_ICONS[g.id] || "📦"}
            </span>
            <h2
              className="section-title"
              style={{ margin: 0, border: "none", padding: 0 }}
            >
              {g.title}
            </h2>
          </div>
          {g.subtitle && (
            <p className="muted" style={{ margin: "-4px 0 12px" }}>
              {g.subtitle}
            </p>
          )}
          <div className="phase-grid">
            {g.items.map((item) => {
              const meta = findMeta(item.id);
              if (!meta) return null;
              return (
                <a
                  key={item.id}
                  className="phase-card"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(item.id);
                  }}
                  style={{ cursor: "pointer", textDecoration: "none" }}
                >
                  <div className="phase-card-head">
                    <span className="phase-card-step">{meta.title}</span>
                  </div>
                  <div
                    className="phase-card-desc"
                    style={{ marginTop: "6px" }}
                  >
                    {meta.desc || ""}
                  </div>
                  <div className="phase-card-cta">바로 사용 →</div>
                </a>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

/* ──────────────────────────── MAIN ──────────────────────────── */
export default function LandingPage() {
  const [track, setTrack] = useState(null); // null = home, "guide", "analyze"
  const router = useRouter();

  const handleNavigate = (routeId) => {
    // Client-side nav → preserves the module-level Zustand store (csvData etc.).
    // The catch-all page effect then mirrors the resolved id into the store.
    router.push(idToSlug[routeId] || "/");
  };

  if (track === "guide") {
    return (
      <LandingGuide onBack={() => setTrack(null)} onNavigate={handleNavigate} />
    );
  }
  if (track === "analyze") {
    return (
      <LandingAnalyze
        onBack={() => setTrack(null)}
        onNavigate={handleNavigate}
      />
    );
  }
  return <LandingHome onTrack={setTrack} />;
}
