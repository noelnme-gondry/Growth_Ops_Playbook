"use client";
import { use, useEffect } from "react";
import { notFound } from "next/navigation";

import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import GlobalModals from "@/components/GlobalModals";
import Dashboard from "@/components/Dashboard";
import SopContent from "@/components/sops/SopContent";
import LandingPage from "@/components/LandingPage";

// Pro Tools
import BudgetAllocation from "@/components/tools/BudgetAllocation";
import CampaignPvm from "@/components/tools/CampaignPvm";
import CreativeAnalyzer from "@/components/tools/CreativeAnalyzer";
import AbTestHoldout from "@/components/tools/AbTestHoldout";
import MarketingResponse from "@/components/tools/MarketingResponse";
import AhaMomentFinder from "@/components/tools/AhaMomentFinder";
import MarketingEfficiency from "@/components/tools/MarketingEfficiency";

import { useAppStore } from "@/store/useDataStore";
import { resolveSlugToId } from "@/lib/routeMap";

export default function PageClient({ params }) {
  // Next 16: params is a Promise. On the root "/" the optional catch-all gives
  // slug = undefined; on any nested path it's a string[].
  const { slug } = use(params);
  const routeId = resolveSlugToId(slug);

  // Unknown URL -> 404 (must run before any dispatch that assumes a valid id).
  if (routeId === null) notFound();

  // Mirror the URL-derived id into the module-level Zustand store so components
  // that still read store.currentRouteId (tool internals) stay in sync on every
  // navigation, incl. browser back/forward. Store is NOT the render source here.
  const setCurrentRouteId = useAppStore((state) => state.setCurrentRouteId);
  useEffect(() => {
    if (useAppStore.getState().currentRouteId !== routeId) {
      setCurrentRouteId(routeId);
    }
  }, [routeId, setCurrentRouteId]);

  return (
    <>
      <div className={`app ${routeId === "home" ? "is-home" : ""}`}>
        <Sidebar />
        <main className="main">
          <Header />
          <article className="content" id="content" aria-live="polite">
            {/* 라우팅: URL에서 해석한 routeId 기준 직접 디스패치 (스토어 비의존 → 첫 페인트 플래시 없음) */}
            {routeId === "home" && <LandingPage />}

            {routeId === "5-2" && <Dashboard />}
            {routeId === "5-3" && <BudgetAllocation />}
            {routeId === "5-21" && <CampaignPvm />}
            {routeId === "5-22" && <MarketingEfficiency />}
            {routeId === "5-6" && <CreativeAnalyzer />}
            {routeId === "5-4" && <AbTestHoldout />}
            {routeId === "5-18" && <MarketingResponse />}
            {routeId === "5-20" && <AhaMomentFinder />}

            {routeId !== "home" &&
             !routeId.startsWith("5-") && (
              <SopContent routeId={routeId} />
            )}
          </article>
        </main>
      </div>
      <GlobalModals />
    </>
  );
}
