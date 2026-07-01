import { create } from "zustand";
import Papa from "papaparse";

// ── Group-scoped CSV state (Phase 6.3) ──────────────────────────────────────
// Tools with a similar data-grain SHARE one CSV slice; different-grain tools get
// SEPARATE slices. So an efficiency CSV (dashboard family) and an event CSV (Aha)
// can coexist without overwriting each other.
//
// route id → group. Legacy experiment ids (5-7/5-15) are defensive-only: the
// router always resolves to the primary id (5-4), so they never actually appear
// as currentRouteId — but they're harmless to keep here.
export const TOOL_GROUP = {
  "5-2": "efficiency", "5-21": "efficiency", "5-22": "efficiency", "5-3": "efficiency",
  "5-6": "creative",
  "5-4": "experiment", "5-7": "experiment", "5-15": "experiment",
  "5-18": "response",
  "5-20": "aha",
};

const EMPTY_SLICE = () => ({ raw: [], headers: [], mapping: {}, fileName: "" });

// Home / SOP guide ids (no CSV) fall back to "efficiency" so the mirror is always
// a valid slice; those pages never read csvData anyway.
export const groupForRoute = (id) => TOOL_GROUP[id] || "efficiency";

// ── Analyze-gate signature (index.html toolAnalyzeSig 이식, §12.5) ───────────
// SINGLE source of the "mapping I confirmed by pressing 분석하기" signature.
// Covers ONLY the column mapping (+ fileName + row count) — NOT exploratory
// toggles (target/platform/metric/grain) so users can freely switch AFTER
// analysis. Changing the mapping changes the sig → the stored analyzed sig no
// longer matches → the tool auto-hides results until 분석하기 is pressed again
// (faithful to isToolAnalyzed's sig-equality reset-on-mapping-change).
// Group-scoped by design: the efficiency family (5-2/5-21/5-22/5-3) shares one
// csv slice, so ONE confirmed mapping analyzes the whole group. Because every
// family tool derives this sig from the SAME active slice, the sig is identical
// across the family — one flag, no per-component dupes.
export const computeAnalyzeSig = (csvData) => {
  const m = (csvData && csvData.mapping) || {};
  const sig = Object.entries(m)
    .filter(([, v]) => v && v !== "__ignore__")
    .map(([h, v]) => `${v}:${h}`)
    .sort()
    .join("|");
  const fileName = (csvData && csvData.fileName) || "";
  const rowCount = ((csvData && csvData.raw) || []).length;
  return `${fileName}|${rowCount}|${sig}`;
};

export const IA = [
  {
    id: "01",
    title: "Foundation",
    desc: "MMP 인프라, 이벤트 택소노미, 매체 포스트백, iOS 프라이버시 대응까지. 본격 운영 전 반드시 갖춰야 할 토대.",
    items: [
      { id: "1-1", title: "개발자 협업 가이드 및 테크니컬 PRD" },
      { id: "1-2", title: "인앱 이벤트 택소노미 설계서" },
      { id: "1-3", title: "매체별 포스트백 연동 매뉴얼" },
      { id: "1-4", title: "iOS 프라이버시 대응 (ATT & SKAN)" },
    ],
  },
  {
    id: "02",
    title: "Execution",
    desc: "UAC·Meta·ASA·리타겟팅 캠페인 실전 셋업. 운영 일과의 표준 절차.",
    items: [
      { id: "2-1", title: "Google App Campaigns (UAC) 가이드" },
      { id: "2-2", title: "Meta Advantage+ App (AAP) 최적화" },
      { id: "2-3", title: "Apple Search Ads (ASA) 운영 매뉴얼" },
      { id: "2-4", title: "앱 리타겟팅 및 Re-engagement" },
    ],
  },
  {
    id: "03",
    title: "Creative & Copy",
    desc: "ASO 베이직부터 매체별 소재 규격, 3초 훅 설계까지.",
    items: [
      { id: "3-1", title: "앱 스토어 최적화 (ASO) 베이직" },
      { id: "3-2", title: "매체별 앱 설치 유도 소재 규격" },
      { id: "3-3", title: "초기 3초 훅(Hook) 설계 프레임워크" },
    ],
  },
  {
    id: "04",
    title: "Analysis & Optimization",
    desc: "KPI 벤치마크, 코호트·리텐션, 카니발리제이션 보정까지. 데이터로 검증하는 단계.",
    items: [
      { id: "4-1", title: "앱 마케팅 핵심 지표(KPI) 분석" },
      { id: "4-2", title: "코호트 기반 리텐션 가이드" },
      { id: "4-3", title: "오가닉 vs 페이드 카니발리제이션 분석" },
    ],
  },
  {
    id: "05",
    title: "운영 & 성과 분석",
    desc: "실제 운영한 캠페인 데이터를 업로드해 대시보드로 시각화하고, 성과 변동·포화도·예산 배분까지 한 CSV로 이어서 분석.",
    items: [
      { id: "5-2", title: "운영 대시보드 (스코어카드·페이싱·차트)" },
      { id: "5-21", title: "캠페인 성과 변동 (PVM 분해)" },
      { id: "5-22", title: "캠페인 포화도 진단 (한계 효율)" },
      { id: "5-3", title: "예산 배분 시뮬레이터" },
    ],
  },
  {
    id: "06",
    title: "소재·실험",
    desc: "소재 성과·피로도 진단과 A/B·홀드아웃 실험 판독.",
    items: [
      { id: "5-6", title: "소재 분석 (지표·피로도·포레스트)" },
      { id: "5-4", title: "실험 분석 (A/B·홀드아웃·증분)" },
    ],
  },
  {
    id: "07",
    title: "기여도·가치 분석",
    desc: "MMM·회귀 기반 마케팅 반응 분석과 핵심 가치(Aha-moment) 발굴.",
    items: [
      { id: "5-18", title: "마케팅 반응 분석 (MMM·회귀·예측)" },
      { id: "5-20", title: "핵심 가치 발굴 (Aha-moment)" },
    ],
  },
];

// ── 사이드바·브레드크럼 표시 번호 SSOT (§12.6: 내부 route id는 절대 불변,
// 표시 번호만 이 SECTIONS 기준으로 계산) ────────────────────────────────
// 가이드(구 SOP, 01~04)와 분석(구 05~07)을 병렬 두 섹션으로 분리 — 예전
// PHASES(p1 셋업/p2 운영/p3 운영후분석/p4 운영)가 01~04를 불균등하게 묶고
// p4.groups에 존재하지 않는 "10" 그룹을 참조하던 죽은 참조·왜곡 모두 제거.
export const SECTIONS = [
  { id: "guide", label: "가이드", groups: ["01", "02", "03", "04"] },
  { id: "analysis", label: "분석", groups: ["05", "06", "07"] },
];

export function findGroupSection(groupId) {
  return SECTIONS.find((s) => s.groups.includes(groupId)) || null;
}

export function findMeta(itemId) {
  for (const g of IA) {
    const it = g.items.find((x) => x.id === itemId);
    if (it) return { ...it, group: g };
  }
  return null;
}

// "가이드 1" / "분석 2" — 섹션 내 그룹 순번(1-based).
export function displayGroupNumber(groupId) {
  const section = findGroupSection(groupId);
  if (!section) return groupId;
  return `${section.label} ${section.groups.indexOf(groupId) + 1}`;
}

// "가이드 1-1" / "분석 2-3" — 섹션 내 그룹 순번-그룹 내 항목 순번.
export function displayItemNumber(itemId) {
  const meta = findMeta(itemId);
  if (!meta) return itemId;
  const section = findGroupSection(meta.group.id);
  if (!section) return itemId;
  const groupNum = section.groups.indexOf(meta.group.id) + 1;
  const itemNum = meta.group.items.findIndex((it) => it.id === itemId) + 1;
  return `${section.label} ${groupNum}-${itemNum}`;
}

// 사이드바용 짧은 번호(라벨 없음) — 섹션 헤더가 이미 라벨을 보여주므로 그룹/항목
// 칩에서는 숫자만("1"/"1-1"). 브레드크럼은 위 라벨-포함 버전을 그대로 사용.
export function displayGroupNumberShort(groupId) {
  const section = findGroupSection(groupId);
  if (!section) return groupId;
  return String(section.groups.indexOf(groupId) + 1);
}

export function displayItemNumberShort(itemId) {
  const meta = findMeta(itemId);
  if (!meta) return itemId;
  const section = findGroupSection(meta.group.id);
  if (!section) return itemId;
  const groupNum = section.groups.indexOf(meta.group.id) + 1;
  const itemNum = meta.group.items.findIndex((it) => it.id === itemId) + 1;
  return `${groupNum}-${itemNum}`;
}

export const useAppStore = create((set, get) => ({
  // Navigation State
  currentRouteId: "home",
  // On route change, swap the csvData mirror to the newly-active group's slice
  // so the rendered tool sees ITS group's data (efficiency family shares one
  // slice; aha/creative/experiment/response are isolated). The existing page.js
  // effect already calls this on every navigation (incl. browser back/forward),
  // so the mirror swap is automatic with no page.js structural change.
  setCurrentRouteId: (id) => set((state) => ({
    currentRouteId: id,
    csvData: state.csvGroups[groupForRoute(id)],
  })),

  // Theme State — 라이트모드 기본값 (매 새로고침 리셋 방지)
  isDarkMode: false,
  toggleTheme: () => set((state) => ({ isDarkMode: !state.isDarkMode })),

  // Command Palette State (CMDK)
  isCmdkOpen: false,
  setCmdkOpen: (isOpen) => set({ isCmdkOpen: isOpen }),

  // CSV Data State — group-scoped slices + an active-group mirror.
  // Consumers keep reading `s.csvData` unchanged; scoping happens by storing
  // per-group and swapping the mirror on route change (see setCurrentRouteId).
  csvGroups: {
    efficiency: EMPTY_SLICE(),
    creative: EMPTY_SLICE(),
    experiment: EMPTY_SLICE(),
    response: EMPTY_SLICE(),
    aha: EMPTY_SLICE(),
  },
  // Mirror of the ACTIVE group's slice. Initial currentRouteId is "home" →
  // "efficiency", so the initial mirror is the (empty) efficiency slice.
  csvData: {
    raw: [],
    headers: [],
    mapping: {},
    fileName: "",
  },
  // Writes the ACTIVE group's slice AND updates the mirror to the SAME object
  // reference, so consumer selectors (s => s.csvData) fire on identity change.
  // Also RESETS the group's analyze gate whenever the confirmed sig would change
  // (new upload / mapping edit): drop the stored sig so results re-hide until the
  // user presses 분석하기 again. Sig-equality in isGroupAnalyzed already handles
  // this, but clearing here keeps analyzedByGroup from holding stale sigs.
  setCsvData: (data) => set((state) => {
    const g = groupForRoute(state.currentRouteId);
    const nextSig = computeAnalyzeSig(data);
    const analyzedByGroup =
      state.analyzedByGroup[g] && state.analyzedByGroup[g] !== nextSig
        ? { ...state.analyzedByGroup, [g]: null }
        : state.analyzedByGroup;
    return { csvGroups: { ...state.csvGroups, [g]: data }, csvData: data, analyzedByGroup };
  }),

  // ── Analyze gate (single source, §12.5 / #4/#5) ────────────────────────────
  // analyzedByGroup[group] holds the mapping sig that was CONFIRMED by pressing
  // 분석하기. A tool is "analyzed" iff that stored sig equals the current slice's
  // sig — so editing the mapping (new sig) auto-hides results until re-confirmed.
  // Keyed by TOOL_GROUP so the whole efficiency family shares ONE flag: Dashboard
  // (5-2) and every 5-x tool read the SAME gate via isGroupAnalyzed(routeId),
  // eliminating the per-component analyzedSig dupes (5-22 etc.).
  analyzedByGroup: {
    efficiency: null,
    creative: null,
    experiment: null,
    response: null,
    aha: null,
  },
  // Confirm analysis for the route's group. Stores the CURRENT active-slice sig.
  // Call from CsvUploader's "분석하기/데이터 분석하기" (and "↻ 다시 분석") button.
  setGroupAnalyzed: (routeId) => set((state) => {
    const g = groupForRoute(routeId);
    return { analyzedByGroup: { ...state.analyzedByGroup, [g]: computeAnalyzeSig(state.csvData) } };
  }),
  // Read the gate: true iff the group's confirmed sig matches the active slice.
  // Consumers: `useAppStore((s) => s.isGroupAnalyzed("5-2"))` — recomputes on any
  // csvData/analyzedByGroup change (both live in the store the selector reads).
  isGroupAnalyzed: (routeId) => {
    const state = get();
    const g = groupForRoute(routeId);
    const stored = state.analyzedByGroup[g];
    if (!stored) return false;
    return stored === computeAnalyzeSig(state.csvData);
  },

  // CSV 업로드 및 파싱 (PapaParse). Currently unused (CsvUploader has its own
  // parse path) — kept group-scoped so a future caller can't reintroduce a flat
  // write that desyncs csvGroups from the mirror.
  handleAnalyze: (file) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => String(h).trim(),
      complete: (results) => {
        const data = {
          raw: results.data,
          headers: results.meta.fields || [],
          mapping: {}, // TODO: Auto mapping logic if needed
          fileName: file.name,
        };
        set((state) => {
          const g = groupForRoute(state.currentRouteId);
          return { csvGroups: { ...state.csvGroups, [g]: data }, csvData: data };
        });
      },
      error: (err) => {
        alert("CSV 파싱 오류: " + err.message);
      },
    });
  },

  // Ops Dashboard State
  dashboardTab: "viz", // viz, scorecard, pacing, anomaly, ltv, cohort, funnel, segment
  setDashboardTab: (tab) => set({ dashboardTab: tab }),

  dashboardFilter: {
    dateStart: null,
    dateEnd: null,
    platforms: new Set(),
    countries: new Set(),
    channels: new Set(),
  },
  setDashboardFilter: (filterUpdate) => set((state) => ({
    dashboardFilter: { ...state.dashboardFilter, ...filterUpdate }
  })),

  // Selected Cohort (0, 7, 14, 30...)
  selectedCohort: 7,
  setSelectedCohort: (c) => set({ selectedCohort: c }),

  // 전역 분모 기준(설치/가입) — 운영 대시보드 §12.18 MON_DENOM_STATE 이식.
  // CPI/CPA·CVR·ARPU·리텐션·LTV·퍼널이 이 토글 하나로 함께 전환. 미매핑 시
  // effectiveDenomBasis(csvData, denomBasis)가 installs→actions 자동 폴백.
  denomBasis: "installs", // "installs" | "actions"
  setDenomBasis: (basis) => set({ denomBasis: basis }),

  // LTV 표시 옵션 — 표시 통화(₩/$) 토글(§12.18). 값 변환이 아니라 표시 단위만.
  displayCurrency: "KRW", // "KRW" | "USD"
  setDisplayCurrency: (cur) => set({ displayCurrency: cur }),

  // 코호트 성숙(closure) 필터(#7) — 아직 관측 윈도우가 안 닫힌 미성숙 코호트를
  // 리텐션/LTV 곡선에서 제외할지. index.html 코호트 closure 필터 이식.
  // true = 성숙 코호트만(윈도우 마감), false = 전부 포함. CohortTab/LtvTab이 읽음.
  matureCohortOnly: false,
  setMatureCohortOnly: (v) => set({ matureCohortOnly: !!v }),

  // Event Markers for Dashboard Charts
  eventMarkers: [],
  addEventMarker: (marker) => set((state) => ({ 
    eventMarkers: [...state.eventMarkers, { ...marker, id: "m" + Date.now() + Math.random().toString(36).slice(2, 7) }] 
  })),
  removeEventMarker: (id) => set((state) => ({ 
    eventMarkers: state.eventMarkers.filter((m) => m.id !== id) 
  })),
}));
