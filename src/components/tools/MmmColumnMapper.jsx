"use client";
import { useState } from "react";

/* index.html의 5-18 DnD colMap(§12.20류 이관) — mmmGuessRole/mmmAutoMapPartial/
 * mmmColMapRoles/mmmGetPanelFromColMap을 React 네이티브 HTML5 DnD로 포팅.
 * colMap: { [header]: { role, kind?, plat? } }
 * role: week|date|reg|react|channel|dummy|step|platform|ignore */

function looksDate(v) {
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(v).trim());
}

function guessPlat(name) {
  const s = String(name).toLowerCase();
  const hasA = /(android|aos|google_?play|playstore)/.test(s);
  const hasI = /\bios\b/.test(s) || /_ios(_|\b)/.test(s) || /(iphone|ipad)/.test(s);
  if (hasA && hasI) return s.lastIndexOf("android") > s.lastIndexOf("ios") ? "android" : "ios";
  if (hasA) return "android";
  if (hasI) return "ios";
  return "common";
}

function guessRole(col, rows) {
  const name = String(col).toLowerCase();
  const vals = rows.map((r) => r[col]).filter((v) => v != null && String(v).trim() !== "");
  const nums = vals.map((v) => parseFloat(String(v).replace(/[^0-9.\-]/g, ""))).filter((v) => !isNaN(v));
  const isNum = nums.length >= vals.length * 0.7 && vals.length > 0;
  const uniq = [...new Set(nums)];
  const isBin = isNum && uniq.every((v) => v === 0 || v === 1) && uniq.length <= 2;
  const kind = /brand|브랜드/.test(name) ? "brand" : "perf";
  const isDateCol = vals.length > 0 && vals.filter(looksDate).length >= vals.length * 0.7;
  let role = "ignore";
  if (isDateCol) role = "date";
  else if (/^(week|t|wk)$/.test(name) || /week|주차|일자|주인덱스/.test(name)) role = "week";
  else if (/날짜|date/.test(name)) role = "date";
  else if (isBin && /step|구조변화|regime|레짐|shutdown|중단|종료|launch|런칭/.test(name)) role = "step";
  else if (isBin) role = "dummy";
  else if (isNum && /reg|가입|등록|signup|sign_up|install/.test(name)) role = "reg";
  else if (isNum && /react|재활성|reactiv|resurrect|win.?back|winback/.test(name)) role = "react";
  else if (isNum && /cost|spend|비용|지출|budget|imp|click|ch_|채널|brand/.test(name)) role = "channel";
  else if (!isNum && /platform|os|플랫폼|기기|device|segment|세그/.test(name)) role = "platform";
  else if (isNum) role = "channel";
  return { role, kind };
}

// 부분 자동 매핑(index.html mmmAutoMapPartial 이식) — reg/react/채널 spend만 강한 키워드로 배치,
// 나머지(week·더미·플랫폼·impression/click·파생컬럼 등)는 전부 트레이(ignore)에 남겨 사용자가 직접 드래그.
// partial=false(🪄 전부 자동 추정)면 guessRole 전체 휴리스틱(catch-all 포함) 사용.
export function autoGuessColMap(headers, rows, partial = true) {
  const derivedRe = /^\s*(ln|log|sin|cos)\s*[\(_]|^\s*(ln|log|sin|cos)\b|description/i;
  const out = {};
  const once = { week: false, date: false, platform: false };
  for (const h of headers || []) {
    const name = String(h).toLowerCase();
    if (!partial) {
      const g = guessRole(h, rows || []);
      let role = g.role;
      if (role in once) {
        if (once[role]) role = "ignore";
        else once[role] = true;
      }
      out[h] = { role, kind: g.kind };
      if (["reg", "react", "channel"].includes(role)) out[h].plat = guessPlat(h);
      continue;
    }
    // partial: 강한 키워드만. isNum·isBin·isDateCol 판정 후 reg/react/channel/date만.
    const vals = (rows || []).map((r) => r[h]).filter((v) => v != null && String(v).trim() !== "");
    const nums = vals.map((v) => parseFloat(String(v).replace(/[^0-9.\-]/g, ""))).filter((v) => !isNaN(v));
    const isNum = nums.length >= vals.length * 0.7 && vals.length > 0;
    const uniq = [...new Set(nums)];
    const isBin = isNum && uniq.every((v) => v === 0 || v === 1) && uniq.length <= 2;
    const isDateCol = vals.length > 0 && vals.filter(looksDate).length >= vals.length * 0.7;
    const kind = /brand|브랜드/.test(name) ? "brand" : "perf";
    let role = "ignore";
    if (isDateCol) role = "date"; // 날짜는 분석 무영향(표시/예측용)이라 자동 배치
    else if (!derivedRe.test(name) && isNum && !isBin) {
      if (/reg|가입|등록|signup|sign_up|install/.test(name)) role = "reg";
      else if (/react|재활성|reactiv|resurrect|win.?back|winback/.test(name)) role = "react";
      else if (/spend|cost|비용|지출|budget|brand/.test(name)) role = "channel";
    }
    if (role === "date") { if (once.date) role = "ignore"; else once.date = true; }
    out[h] = { role, kind };
    if (["reg", "react", "channel"].includes(role)) out[h].plat = guessPlat(h);
  }
  return out;
}

function sanKey(name, used) {
  let b = "c_" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (b === "c_") b = "c";
  let k = b, i = 2;
  while (used.has(k)) { k = b + i; i++; }
  used.add(k);
  return k;
}

function colMapRoles(headers, colMap) {
  const out = { week: [], date: null, reg: [], react: [], platform: null, channels: [], dummies: [], steps: [] };
  const used = new Set();
  for (const h of headers || []) {
    const def = colMap[h] || {};
    const r = def.role, plat = def.plat || "common";
    if (r === "week") out.week.push({ header: h, plat });
    else if (r === "date" && !out.date) out.date = h;
    else if (r === "reg") out.reg.push({ header: h, plat });
    else if (r === "react") out.react.push({ header: h, plat });
    else if (r === "platform" && !out.platform) out.platform = h;
    else if (r === "channel") out.channels.push({ header: h, key: sanKey(h, used), label: h, kind: def.kind === "brand" ? "brand" : "perf", plat });
    else if (r === "dummy") out.dummies.push({ header: h, key: sanKey(h, used), label: h, plat });
    else if (r === "step") out.steps.push({ header: h, key: sanKey(h, used), label: h, plat });
  }
  return out;
}

export function colMapMissing(headers, colMap) {
  if (!colMap) return ["채널·타깃 매핑"];
  const r = colMapRoles(headers, colMap);
  const miss = [];
  if (!r.reg.length && !r.react.length) miss.push("가입 또는 재활성(타깃) 1개");
  if (!r.channels.length) miss.push("채널 spend 1개 이상");
  return miss;
}

// 컬럼 태그 모드(플랫폼 단일 컬럼 없이 헤더명 android/ios 태그로 구분)인지 + 존재하는 태그 목록.
// index mmmIsTagMode/mmmColMapPlatforms 이식.
export function mmmPlatformTags(headers, colMap) {
  const r = colMapRoles(headers, colMap);
  if (r.platform) return []; // 행 필터(단일 컬럼) 모드는 태그 토글 대상 아님 — 값 자체가 플랫폼
  const set = new Set();
  [...r.reg, ...r.react, ...r.channels].forEach((x) => {
    if (x.plat && x.plat !== "common") set.add(x.plat);
  });
  return [...set];
}

// colMap → MMM panel (index mmmGetPanelFromColMap 이식). platform: "all"|"android"|"ios" —
// 컬럼 태그 모드면 plat 일치(+공통) 컬럼만 선택, 플랫폼 단일 컬럼(행필터) 모드면 그 값으로 행 필터.
export function buildPanelFromColMap(headers, rows, colMap, platform = "all") {
  const r = colMapRoles(headers, colMap);
  const tagMode = !r.platform && mmmPlatformTags(headers, colMap).length > 0;
  const P = platform === "all" ? null : platform;
  const inPlat = (x) => !tagMode || !P || x.plat === P || x.plat === "common";
  const pick = (list) => {
    if (!tagMode || !P) return list[0] || null;
    return list.find((x) => x.plat === P) || list.find((x) => x.plat === "common") || list[0] || null;
  };
  let baseRows = rows || [];
  if (r.platform && P) baseRows = baseRows.filter((row) => String(row[r.platform]) === P);
  const num = (h, allowNaN) => baseRows.map((row) => {
    const v = row[h];
    if (v == null || String(v).trim() === "") return allowNaN ? NaN : 0;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? (allowNaN ? NaN : 0) : n;
  });
  const weekC = r.week[0] || null;
  const week = weekC ? num(weekC.header, false) : baseRows.map((_, i) => i + 1);
  const weekLabelRaw = weekC ? baseRows.map((row) => row[weekC.header]) : null;
  const panel = { week, ch: {}, dummy: {}, steps: {}, targets: {} };
  const chans = r.channels.filter(inPlat);
  for (const ch of chans) panel.ch[ch.key] = num(ch.header, true);
  for (const d of r.dummies) panel.dummy[d.key] = num(d.header, false);
  for (const s of r.steps) panel.steps[s.key] = num(s.header, false);
  const regC = pick(r.reg), reactC = pick(r.react);
  if (regC) panel.targets.Regs = num(regC.header, false);
  if (reactC) panel.targets.React = num(reactC.header, false);
  const order = week.map((_, i) => i).sort((a, b) => week[a] - week[b]);
  const re = (arr) => order.map((i) => arr[i]);
  panel.week = re(panel.week);
  if (weekLabelRaw) panel.weekLabel = re(weekLabelRaw);
  for (const k in panel.ch) panel.ch[k] = re(panel.ch[k]);
  for (const k in panel.dummy) panel.dummy[k] = re(panel.dummy[k]);
  for (const k in panel.steps) panel.steps[k] = re(panel.steps[k]);
  for (const k in panel.targets) panel.targets[k] = re(panel.targets[k]);
  if (panel.targets.Regs && panel.targets.React) {
    panel.targets.RR = panel.week.map((_, i) => panel.targets.Regs[i] + panel.targets.React[i]);
  }
  // deriveWide와 동일한 패널 형태로 — 엔진(mmmChannelEffects/decomp)·렌더가 참조.
  panel.channels = chans.map((c) => ({ key: c.key, label: c.label, kind: c.kind }));
  panel.dummyDefs = r.dummies.map((d) => ({ key: d.key, label: d.label }));
  panel.stepDefs = r.steps.map((s) => ({ key: s.key, label: s.label }));
  panel.useDummies = r.dummies.length > 0;
  return { panel, roles: r, missing: colMapMissing(headers, colMap) };
}

const ZONES = [
  ["week", "🗓 주차(t) · 1개 (없으면 행순서)", false, false],
  ["date", "📅 날짜 · 1개 (표시용)", false, false],
  ["reg", "🎯 가입 Regs", false, true],
  ["react", "🎯 재활성 React", false, true],
  ["channel", "📈 채널 spend (여러 개 · perf/brand · 플랫폼)", true, true],
  ["dummy", "🔢 더미/이벤트 (0·1, 여러 개)", false, false],
  ["step", "📐 구조변화 step (0·1, 선택)", false, false],
  ["platform", "🔀 플랫폼 단일 컬럼 (있을 때만)", false, false],
];

export default function MmmColumnMapper({ headers, rows, colMap, onChange }) {
  const [dragCol, setDragCol] = useState(null);
  const cm = colMap || {};

  const setRole = (col, role) => {
    const next = { ...cm };
    if (["week", "date", "platform"].includes(role)) {
      for (const h of headers || []) {
        if (next[h] && next[h].role === role) next[h] = { ...next[h], role: "ignore" };
      }
    }
    const prev = next[col] || {};
    next[col] = { ...prev, role, plat: ["reg", "react", "channel"].includes(role) ? prev.plat || guessPlat(col) : prev.plat };
    onChange(next);
  };
  const setField = (col, field, value) => {
    onChange({ ...cm, [col]: { ...(cm[col] || {}), [field]: value } });
  };

  const inRole = (role) => (headers || []).filter((h) => (cm[h]?.role || "ignore") === role);

  const Chip = ({ col, withKind, withPlat }) => {
    const def = cm[col] || {};
    return (
      <span
        className="reg-chip"
        draggable
        onDragStart={() => setDragCol(col)}
        style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", margin: "2px", borderRadius: "6px", background: "var(--bg-2)", border: "1px solid var(--border)", fontSize: "12px", cursor: "grab" }}
      >
        <strong>{col}</strong>
        {withKind && (
          <select value={def.kind || "perf"} onChange={(e) => setField(col, "kind", e.target.value)} style={{ fontSize: "11px" }}>
            <option value="perf">perf spend</option>
            <option value="brand">brand spend</option>
          </select>
        )}
        {withPlat && (
          <select value={def.plat || "common"} onChange={(e) => setField(col, "plat", e.target.value)} style={{ fontSize: "11px" }}>
            <option value="common">공통</option>
            <option value="android">Android</option>
            <option value="ios">iOS</option>
          </select>
        )}
        <span onClick={() => setRole(col, "ignore")} style={{ cursor: "pointer", color: "var(--text-muted)" }}>✕</span>
      </span>
    );
  };

  const Zone = ({ role, label, withKind, withPlat }) => (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (dragCol) setRole(dragCol, role); setDragCol(null); }}
      style={{ border: "1px dashed var(--border)", borderRadius: "8px", padding: "8px", minHeight: "44px" }}
    >
      <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginBottom: "4px" }}>{label}</div>
      <div>
        {inRole(role).length
          ? inRole(role).map((c) => <Chip key={c} col={c} withKind={withKind} withPlat={withPlat} />)
          : <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>여기로 드래그</span>}
      </div>
    </div>
  );

  const tray = (headers || []).filter((h) => (cm[h]?.role || "ignore") === "ignore");
  const missing = colMapMissing(headers, cm);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <p className="muted" style={{ fontSize: "12px", margin: 0 }}>
          컬럼을 역할 영역으로 드래그하세요. 칩을 끌어 언제든 수정 가능합니다.
        </p>
        <button
          type="button"
          className="ab-pill"
          onClick={() => onChange(autoGuessColMap(headers, rows, false))}
        >
          🪄 전부 자동 추정
        </button>
      </div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (dragCol) setRole(dragCol, "ignore"); setDragCol(null); }}
        style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px", marginBottom: "10px" }}
      >
        <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginBottom: "4px" }}>📦 컬럼 (미지정 — 드래그해서 배치)</div>
        <div>
          {tray.length ? tray.map((h) => <Chip key={h} col={h} withKind={false} withPlat={false} />) : <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>모두 배치됨</span>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        {ZONES.map(([role, label, withKind, withPlat]) => (
          <Zone key={role} role={role} label={label} withKind={withKind} withPlat={withPlat} />
        ))}
      </div>
      {missing.length > 0 && (
        <div className="callout warning" style={{ marginTop: "10px" }}>
          <div className="ico">!</div>
          <div className="body"><strong>필수 역할이 비어 있습니다</strong><p>{missing.join(", ")}</p></div>
        </div>
      )}
    </div>
  );
}
