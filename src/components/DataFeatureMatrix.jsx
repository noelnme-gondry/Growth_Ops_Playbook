"use client";
// 데이터×기능 연결표 — index.html renderDataFeatureMatrix (라인 ~10337-10544) React 포트.
// TOOL_REQUIRED/OPTIONAL_FIELDS + STANDARD_FIELDS에서 자동 생성(하드코딩 표 금지, §12.19).
// 항상 인라인 노출(접힘 토글 없음) — CSV 업로드 전/후 양쪽에서 렌더.
import React, { useMemo, useState, useEffect, useRef } from "react";
import { useAppStore, TOOL_GROUP } from "@/store/useDataStore";
import { STANDARD_FIELDS, TOOL_REQUIRED_FIELDS, TOOL_OPTIONAL_FIELDS } from "@/utils/csvConstants";

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 효율&예산 4총사 — 같은 grain(TOOL_GROUP === "efficiency")을 공유하는 도구들.
// legacy DFM_FAMILY(["5-2","5-3","5-22","5-21"])와 동일 id — v2도 같은 경로 id 사용(§4.1 불변).
const DFM_FAMILY = Object.keys(TOOL_GROUP).filter((id) => TOOL_GROUP[id] === "efficiency");

const DFM_TOOL_SHORT = {
  "5-2": "운영 대시보드",
  "5-3": "예산 배분",
  "5-22": "포화도 탐지",
  "5-21": "성과 변동 탐지",
  "5-18": "마케팅 반응 분석",
  "5-20": "핵심 가치 발굴",
  "5-4": "실험 분석",
  "5-6": "소재 분석",
};

function dfmToolName(id) {
  return DFM_TOOL_SHORT[id] || id;
}

// 통합 캔버니컬 컬럼 순서 — 차원 먼저(depth), 지표는 퍼널·가치 순.
const DFM_SERIES = [
  { name: "기간", fields: ["date", "week"] },
  {
    name: "세그먼트 (차원)",
    fields: ["country", "platform", "channel", "campaign_name", "adgroup_name", "creative_id", "creative_url"],
  },
  { name: "비용", fields: ["cost"] },
  { name: "유입·퍼널", fields: ["impressions", "clicks", "installs", "actions"] },
  {
    name: "결제 (PU Dn)",
    collapse: true,
    fields: ["pu_d0", "pu_d7", "pu_d14", "pu_d30", "pu_d60", "pu_d90", "pu_d180", "pu_d360"],
  },
  {
    name: "매출 (Revenue Dn)",
    collapse: true,
    fields: ["revenue_d0", "revenue_d7", "revenue_d14", "revenue_d30", "revenue_d60", "revenue_d90", "revenue_d180", "revenue_d360"],
  },
  {
    name: "리텐션 (Retention Dn)",
    collapse: true,
    fields: ["ret_d7", "ret_d14", "ret_d30", "ret_d60", "ret_d90", "ret_d180", "ret_d360"],
  },
  {
    name: "MMM (주간 패널)",
    fields: ["mmm_reg", "mmm_react", "ch_google_roi", "ch_google_cbua", "ch_meta", "ch_tiktok", "ch_brand"],
  },
];

// 도구에서 한 필드의 상태: 필수/필수(택1)/옵션/미사용.
function dfmStatus(toolId, key) {
  for (const r of TOOL_REQUIRED_FIELDS[toolId] || []) {
    if (typeof r === "string" && r === key) return { kind: "req" };
    if (r && r.oneOf && r.oneOf.includes(key)) return { kind: "req1" };
  }
  const o = (TOOL_OPTIONAL_FIELDS[toolId] || []).find((x) => x.key === key);
  if (o) return { kind: "opt", unlocks: o.unlocks };
  return { kind: "unused" };
}

function dfmFamilyUsers(key, exclude) {
  return DFM_FAMILY.filter((t) => t !== exclude && dfmStatus(t, key).kind !== "unused");
}

// 템플릿 헤더(canonical) — creative_id는 사용자 친화적으로 creative_name 표기.
function dfmCanonHeader(key) {
  return key === "creative_id" ? "creative_name" : key;
}

function dfmUnifiedFields() {
  return DFM_SERIES.flatMap((s) => s.fields);
}

// 깨끗한 헤더만(자동매핑 안 깨지게). BOM+CRLF (§7 CSV 규칙).
export function buildToolTemplateCsv(toolId, scope) {
  const all = dfmUnifiedFields();
  const fields = scope === "unified" ? all : all.filter((k) => dfmStatus(toolId, k).kind !== "unused");
  const headers = [...new Set(fields.map(dfmCanonHeader))];
  return "﻿" + headers.join(",") + "\r\n";
}

function dfmDownloadTemplate(toolId, scope) {
  const csv = buildToolTemplateCsv(toolId, scope);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = scope === "unified" ? "template_efficiency_unified.csv" : `template_${toolId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function DfmBadge({ kind }) {
  if (kind === "req" || kind === "req1") {
    return (
      <span className="chip danger" style={{ fontSize: "10px", padding: "1px 7px" }}>
        <span className="dot"></span>{kind === "req1" ? "필수 (택1)" : "필수"}
      </span>
    );
  }
  if (kind === "opt") {
    return (
      <span className="chip ok" style={{ fontSize: "10px", padding: "1px 7px" }}>
        <span className="dot"></span>옵션
      </span>
    );
  }
  return <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>— 미사용</span>;
}

function MapCell({ on }) {
  if (on) {
    return (
      <span className="chip ok" style={{ fontSize: "10px", padding: "1px 6px" }}>
        <span className="dot"></span>매핑됨
      </span>
    );
  }
  return <span style={{ color: "var(--text-muted)" }}>—</span>;
}

function FieldCell({ codeStr, label }) {
  return (
    <td style={{ padding: "6px 10px 6px 0" }}>
      <code className="inline" style={{ fontSize: "10.5px" }}>{codeStr}</code>
      {label ? (
        <span style={{ color: "var(--text-muted)", fontSize: "10.5px", marginLeft: "6px" }}>{label}</span>
      ) : null}
    </td>
  );
}

// 범용 per-tool 데이터×기능 연결표 — TOOL_REQUIRED/OPTIONAL_FIELDS + STANDARD_FIELDS에서 자동 생성.
// analyzed=true(분석 완료)면 접어서 결과에 집중 — CSV 업로드/매핑 중에는 펼쳐서 참고.
export default function DataFeatureMatrix({ toolId, analyzed = false }) {
  const mapping = useAppStore((s) => s.csvData.mapping);

  // 분석 완료 순간 자동 접힘(1회) — 이후 사용자가 수동으로 다시 펼치면 그 선택 유지.
  const [open, setOpen] = useState(!analyzed);
  const prevAnalyzed = useRef(analyzed);
  useEffect(() => {
    if (analyzed && !prevAnalyzed.current) setOpen(false);
    prevAnalyzed.current = analyzed;
  }, [analyzed]);

  const isFamily = DFM_FAMILY.includes(toolId);

  const mapped = useMemo(
    () => new Set(Object.values(mapping || {}).filter((v) => v && v !== "__ignore__")),
    [mapping],
  );

  const rows = useMemo(() => {
    const out = [];
    for (const series of DFM_SERIES) {
      const fields = isFamily
        ? series.fields
        : series.fields.filter((k) => dfmStatus(toolId, k).kind !== "unused");
      if (!fields.length) continue;

      out.push({ type: "header", name: series.name, key: `h-${series.name}` });

      if (series.collapse) {
        const statuses = fields.map((k) => dfmStatus(toolId, k));
        const best =
          statuses.find((s) => s.kind === "req" || s.kind === "req1") ||
          statuses.find((s) => s.kind === "opt") ||
          { kind: "unused" };
        const anyMapped = fields.some((k) => mapped.has(k));
        const range = `${dfmCanonHeader(fields[0])} ~ ${dfmCanonHeader(fields[fields.length - 1])}`;
        let note = (statuses.find((s) => s.unlocks) || {}).unlocks || "";
        if (best.kind === "unused") {
          const users = dfmFamilyUsers(fields[0], toolId);
          note = users.length
            ? `이 도구는 미사용 — <strong>${users.map(dfmToolName).join("·")}</strong>에서 사용`
            : "이 도구 미사용";
        }
        out.push({
          type: "row",
          key: `r-${series.name}`,
          codeStr: range,
          label: "",
          badgeKind: best.kind,
          mapped: anyMapped,
          note,
        });
      } else {
        for (const k of fields) {
          const st = dfmStatus(toolId, k);
          const def = STANDARD_FIELDS[k] || {};
          let note = st.unlocks || "";
          if (st.kind === "unused") {
            const users = dfmFamilyUsers(k, toolId);
            note = users.length
              ? `이 도구는 미사용 — <strong>${users.map(dfmToolName).join("·")}</strong>에서 사용`
              : "이 도구 미사용";
          }
          out.push({
            type: "row",
            key: `r-${k}`,
            codeStr: dfmCanonHeader(k),
            label: def.label || "",
            badgeKind: st.kind,
            mapped: mapped.has(k),
            note,
          });
        }
      }
    }
    return out;
  }, [toolId, isFamily, mapped]);

  return (
    <div className="block" style={{ padding: "16px 20px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
        <div
          style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-1)", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
          onClick={() => setOpen((o) => !o)}
        >
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{open ? "▾" : "▸"}</span>
          📋 데이터×기능 연결표 — {dfmToolName(toolId)}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {isFamily && (
            <button
              className="ab-pill"
              title="효율&예산 4개 도구 공통 통합 템플릿(전체 컬럼)"
              onClick={() => dfmDownloadTemplate(toolId, "unified")}
            >
              ⬇ 통합 템플릿 CSV
            </button>
          )}
          <button
            className="ab-pill"
            title="이 도구가 쓰는 컬럼만"
            onClick={() => dfmDownloadTemplate(toolId, "tool")}
          >
            ⬇ 이 도구 템플릿 CSV
          </button>
        </div>
      </div>
      {!open ? null : (
      <>
      <p style={{ fontSize: "11.5px", color: "var(--text-muted)", margin: "0 0 10px" }}>
        필수/옵션 컬럼과, 이 도구가 안 쓰지만 다른 도구가 쓰는 컬럼을 한눈에. 템플릿은 헤더만 들어있어 그대로 채워 올리면 됩니다.
        {isFamily ? " 4개 도구(운영·예산·포화도·변동)는 같은 CSV를 공유합니다." : ""}
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "4px 10px 4px 0", color: "var(--text-muted)", fontWeight: 600 }}>표준 필드</th>
            <th style={{ textAlign: "left", padding: "4px 10px", color: "var(--text-muted)", fontWeight: 600 }}>이 도구</th>
            <th style={{ textAlign: "left", padding: "4px 10px", color: "var(--text-muted)", fontWeight: 600 }}>매핑</th>
            <th style={{ textAlign: "left", padding: "4px 0", color: "var(--text-muted)", fontWeight: 600 }}>열리는 기능 / 비고</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.type === "header" ? (
              <tr key={r.key}>
                <td colSpan={4} style={{ padding: "9px 0 3px", fontWeight: 700, color: "var(--text-1)", fontSize: "11.5px", borderBottom: "1px solid var(--border)" }}>
                  {r.name}
                </td>
              </tr>
            ) : (
              <tr key={r.key} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <FieldCell codeStr={r.codeStr} label={r.label} />
                <td style={{ padding: "6px 10px" }}><DfmBadge kind={r.badgeKind} /></td>
                <td style={{ padding: "6px 10px" }}><MapCell on={r.mapped} /></td>
                <td
                  style={{ padding: "6px 0", color: "var(--text-2)", fontSize: "11px" }}
                  dangerouslySetInnerHTML={{ __html: r.note.includes("<strong>") ? r.note : escapeHtml(r.note) }}
                />
              </tr>
            ),
          )}
        </tbody>
      </table>
      <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "10px 0 0" }}>
        🔒 데이터는 브라우저 메모리에서만 처리됩니다. 서버 전송·저장 없음.
      </p>
      </>
      )}
    </div>
  );
}
