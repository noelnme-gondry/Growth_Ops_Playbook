# V2 CODE MAP — 어디에 무엇이 있는가

> 목적: 최소 토큰으로 즉시 파일 탐색. 설명 최소화, **경로 매핑**에 집중.
> 이행 중: `index.html`(레거시, Phase 8 컷오버 전 라이브) → 이 `v2-migration/`(Next.js). 상세 계획·현황: `../docs/v2-migration-tasks.md`.

## 1. 디렉토리 트리 (핵심)
```
v2-migration/
├─ src/
│  ├─ app/
│  │  ├─ [[...slug]]/page.js # ★ Path 라우팅 dispatch (URL→routeMap→컴포넌트) + not-found.js
│  │  ├─ sitemap.js         # sitemap.xml (23 URL)
│  │  ├─ layout.js          # <head>·CDN 스크립트(Supabase 주석화·TODO(B2B))
│  │  ├─ globals.css        # ★ 전 디자인 시스템 (Obsidian Flux 토큰·다크/라이트·전 클래스)
│  │  └─ page.module.css    # 랜딩 일부 스코프 스타일
│  ├─ lib/routeMap.js       # ★ slug↔id↔컴포넌트 SSOT (id 불변, §4.1)
│  ├─ store/
│  │  └─ useDataStore.js    # ★ SSOT: Zustand — IA·csvGroups(스코프)·csvData(미러)·TOOL_GROUP·필터·currentRouteId·테마
│  ├─ utils/                # ★ 순수 통계엔진 (ESM, 수학 불변, vitest 골든) + 데이터층 + 추출 math(funnel/segment/anomaly/pacing/cohort/incr)
│  └─ components/
│     ├─ Sidebar/Header/LandingPage/CsvUploader/GlobalModals/Dashboard.jsx  # 셸
│     ├─ tools/             # 8개 Pro 도구 (route별 1 컴포넌트)
│     ├─ dashboard/         # 5-2 운영 대시보드 8탭 + 필터바 + 이벤트마커
│     └─ sops/SopContent.jsx # SOP 가이드(1-x~4-x) + 랜딩 IA 렌더
├─ ARCHITECTURE.md (이 파일) · package.json (test=vitest run src/utils)
```

## 2. 라우트 → slug → 컴포넌트 (Next Path 라우팅)
**Next 표준 Path 라우팅**: `src/app/[[...slug]]/page.js`(optional catch-all)가 URL을 `src/lib/routeMap.js`(slug↔id SSOT)로 id 해석 → 컴포넌트 렌더. `src/app/sitemap.js`(23 URL)·`not-found.js`. route id는 §4.1 불변, slug↔id 매핑층. 사이드바=`<Link href>`, store `currentRouteId`는 URL 미러.

| slug (URL) | id | 컴포넌트 |
|---|---|---|
| `/` | home | LandingPage |
| `/dashboard` | 5-2 | Dashboard → dashboard/* (8탭) |
| `/tools/campaign-variance` | 5-21 | tools/CampaignPvm.jsx (PVM) |
| `/tools/campaign-saturation` | 5-22 | tools/MarketingEfficiency.jsx (포화도) |
| `/tools/budget-allocation` | 5-3 | tools/BudgetAllocation.jsx (예산) |
| `/tools/creative-analysis` | 5-6 | tools/CreativeAnalyzer.jsx (소재) |
| `/tools/experiment-analysis` | 5-4(+5-7,5-15) | tools/AbTestHoldout.jsx (실험) |
| `/tools/marketing-response` | 5-18 | tools/MarketingResponse.jsx (MMM·회귀·예측·Lab) |
| `/tools/aha-moment` | 5-20 | tools/AhaMomentFinder.jsx (Aha) |
| `/guide/<kebab>` | 1-x~4-x | sops/SopContent.jsx (SOP) |

## 3. 도메인 매핑 (도구 UI ↔ 순수 엔진)
| 도구 (UI) | 엔진 (수학, utils/) | 비고 |
|---|---|---|
| BudgetAllocation.jsx | `allocationMath.js` (ALLOC_MATH) | fitBest·predictSafeCpr·removeOutliers |
| MarketingEfficiency.jsx | `satMath.js` (SAT_MATH,satBuildPoints) + allocationMath | 포화지수 |
| CampaignPvm.jsx | `pvmMath.js` (PVM_MATH) | Bennet 분해·rollup |
| CreativeAnalyzer.jsx | `creativeMath.js` (CREATIVE_MATH/FATIGUE/STATS) | WLS·피로도 |
| AbTestHoldout.jsx | `abTestMath.js` (STATS) | z-test·bayesian·powerCurve |
| MarketingResponse.jsx | `mmmMath.js`+`regMath.js`+`regForecastMath.js`+`regLabMath.js`+`statPrimitives.js` | MMM·OLS·예측·regLab |
| AhaMomentFinder.jsx | `ahaMath.js` (AHA_STATS) | gridSearch·F1/Lift |
| dashboard/* (5-2) | `dashboardAggregator.js`(getMappedRows·KPI)·`ltvMath.js`·`funnelMath.js`·`segmentMath.js`·`anomalyMath.js`·`pacingMath.js`·`cohortMath.js`·`responseMath.js`(CANNIBAL_STATS) | 탭별 순수 math 추출 완료(골든 커버) |
| AbTestHoldout 증분 | `incrMath.js`(홀드아웃 증분)·abTestMath.js | readout/incr 추출 |
| (공통) | `chartUtils.js`·`testFixtures.js`(seededNoise) | 차트 헬퍼·결정론 픽스처 |
| (필드 정의) | `csvConstants.js` (STANDARD_FIELDS·TOOL_REQUIRED/OPTIONAL_FIELDS) | 매핑 스키마 |

## 4. 상태 & 데이터 흐름 (SSOT)
- **전역 상태 = `src/store/useDataStore.js` (Zustand)**: `currentRouteId`(URL 미러) · `dashboardFilter` · `isDarkMode` · `isCmdkOpen` · `IA`·`PHASES` · **`TOOL_GROUP`·`groupForRoute`**.
- **CSV 그룹 스코프 상태(Phase 6.3)**: `csvGroups`{efficiency·creative·experiment·response·aha} 슬라이스. `csvData`=활성 그룹 **미러**(`setCurrentRouteId`가 라우트 변경 시 스왑, `setCsvData`가 활성 그룹+미러 기록). 효율 family(5-2·5-21·5-22·5-3) 공유, 나머지 격리. **소비자는 `s.csvData`만 읽으면 됨**(미러라 무변경).
- **데이터 파이프라인**: 업로드(`CsvUploader.jsx`, PapaParse+자동매핑) → `csvData` → **`dashboardAggregator.js:getMappedRows(csvData)`** (raw행 → 표준키 행; **cost↔spend 별칭 채움 §7**) → 도구별 엔진 입력 구성 → 순수엔진 → 렌더.
- **함정**: 효율 CSV는 비용=`cost`키, PVM/creative 엔진은 `spend` 읽음 → getMappedRows가 양쪽 채움. creative 등 하위 grain CSV는 분해 안 하는 도구(5-22·5-3)에서 (그룹×날짜)로 **sum 후 점 생성**(satBuildPoints·buildByChannel).
- **CSV 상태 스코프(Phase 6.3 예정)**: TOOL_GROUP 기반 — 효율 CSV family(5-2·5-21·5-22·5-3) 공유, 이질 도구는 별도 슬라이스.

## 5. 글로벌 스타일 (CSS/테마)
- **`src/app/globals.css`** — 전 디자인 시스템(단일 파일). **CSS Modules로 쪼개지 말 것**(토큰 스코핑 불가).
- **Obsidian Flux 토큰**: `:root { --bg-1·--text-muted·--border·--primary... }`. **다크/라이트 = `body.light-mode` 오버라이드** (토큰 값 스왑).
- 공용 클래스 전역: `.chart-container`·`.callout`·`.block`·`.ab-pill`·`.cmdk-*`·`.toast-*`·`.pvm-*` 등. 차트 색은 `CHART_THEME` getter(하드코딩 hex 금지).
- 일회성 컴포넌트 스타일만 `*.module.css`.

## 6. 테스트 & 린트 (배포 게이트)
- vitest **2 프로젝트**: `npm test`=golden(node, `src/utils/*.test.js`, 순수엔진 골든 22파일) · `npm run test:smoke`=jsdom 컴포넌트 마운트(`*.smoke.test.jsx`) · `npm run test:all`=둘 다(**42파일·202 GREEN**). 골든=index `runXxxTests` verbatim(tolerance 완화 금지). 스모크 목킹은 `vitest.smoke.setup.js`(chart.js/next-navigation/ResizeObserver/matchMedia/canvas).
- `npm run lint` = eslint(0 errors) · `npx next build`(컴파일 게이트). 추가 렌더 검증은 preview 라이브.

## 7. 내비게이션 팁
- **수학/통계 고칠 땐 → `src/utils/*.js`** (엔진; 수학 변경 시 대응 `*.test.js` 골든 확인).
- **도구 UI 고칠 땐 → `src/components/tools/<도구>.jsx`** (표 §2에서 route→파일 찾기).
- **대시보드(5-2) 탭 고칠 땐 → `src/components/dashboard/<Tab>.jsx`**.
- **전역 상태·IA·라우트 → `src/store/useDataStore.js`**.
- **색/테마/레이아웃 → `src/app/globals.css`** (토큰은 `:root`+`body.light-mode`).
- **CSV 매핑/필드 스키마 → `src/utils/csvConstants.js` + `src/components/CsvUploader.jsx`**.
- **데이터가 엔진에 안 들어감 → `getMappedRows`(dashboardAggregator.js) + 표준키/별칭 확인**.
