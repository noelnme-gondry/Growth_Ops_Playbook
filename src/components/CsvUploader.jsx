"use client";
import React, { useState, useRef, useMemo } from "react";
import Papa from "papaparse";
import { useAppStore } from "@/store/useDataStore";
import { STANDARD_FIELDS, TOOL_REQUIRED_FIELDS, TOOL_OPTIONAL_FIELDS } from "@/utils/csvConstants";
import DataFeatureMatrix from "@/components/DataFeatureMatrix";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function CsvUploader({ toolId }) {
  const csvData = useAppStore((s) => s.csvData);
  const setCsvData = useAppStore((s) => s.setCsvData);
  const setGroupAnalyzed = useAppStore((s) => s.setGroupAnalyzed);
  // Single-source analyze gate (store, group-scoped §12.5). Reading the whole
  // store here (not a memoized selector) so the boolean recomputes on any
  // csvData / analyzedByGroup change — the same slice the tools render from.
  const isAnalyzed = useAppStore((s) => s.isGroupAnalyzed(toolId));
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // Preview table is auto-shown while mapping and collapsed after analysis.
  // User can re-expand it manually anytime (independent of gate state).
  const [previewOpen, setPreviewOpen] = useState(true);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
    // reset input
    e.target.value = null;
  };

  const processFile = (file) => {
    setErrorMsg("");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          setErrorMsg("CSV 파일이 비어 있거나 올바르지 않습니다.");
          return;
        }

        const headers = results.meta.fields || [];
        const raw = results.data;
        
        // Auto-mapping logic
        const mapping = {};
        const availableStandardKeys = Object.keys(STANDARD_FIELDS);
        
        headers.forEach((header) => {
          const hLow = header.toLowerCase().trim();
          let matched = null;
          
          for (const sKey of availableStandardKeys) {
            const def = STANDARD_FIELDS[sKey];
            if (sKey.toLowerCase() === hLow) {
              matched = sKey;
              break;
            }
            if (def.aliases) {
              const hasAlias = def.aliases.some((alias) => {
                const a = alias.toLowerCase();
                return hLow === a || hLow === a.replace(/_/g, "") || hLow.replace(/_/g, "") === a;
              });
              if (hasAlias) {
                matched = sKey;
                break;
              }
            }
          }
          if (matched) {
            mapping[header] = matched;
          } else {
            mapping[header] = "__ignore__";
          }
        });

        setCsvData({
          raw,
          headers,
          mapping,
          fileName: file.name,
        });
        // New file → gate auto-resets in the store (sig change); re-open preview
        // so the user maps with data context.
        setPreviewOpen(true);
      },
      error: (err) => {
        setErrorMsg("CSV 파싱 중 오류 발생: " + err.message);
      },
    });
  };

  const handleMappingChange = (header, value) => {
    setCsvData({
      ...csvData,
      mapping: {
        ...csvData.mapping,
        [header]: value
      }
    });
    // Mapping edit changes the sig → store gate auto-resets. Re-open preview so
    // the user re-checks the columns before pressing 분석하기 again.
    setPreviewOpen(true);
  };

  const handleReset = () => {
    setCsvData({ raw: [], headers: [], mapping: {}, fileName: "" });
    setPreviewOpen(true);
  };

  const hasFile = csvData && csvData.headers && csvData.headers.length > 0;

  // --- Compute mapping requirements ---
  const { missing, reqLabels, fieldGroups, allowKeys } = useMemo(() => {
    if (!toolId) return { missing: [], reqLabels: [], fieldGroups: {}, allowKeys: new Set() };
    
    const reqs = TOOL_REQUIRED_FIELDS[toolId] || [];
    const opts = TOOL_OPTIONAL_FIELDS[toolId] || [];
    const mapped = new Set(
      Object.values(csvData.mapping || {}).filter((v) => v !== "__ignore__")
    );

    // checkRequiredForTool equivalent
    const missingKeys = [];
    reqs.forEach((r) => {
      if (typeof r === "string") {
        if (!mapped.has(r)) missingKeys.push(r);
      } else if (r.oneOf) {
        const hasAny = r.oneOf.some((k) => mapped.has(k));
        if (!hasAny) missingKeys.push(r.oneOf.join("|"));
      }
    });

    const labels = reqs.map((r) => {
      if (typeof r === "string") return STANDARD_FIELDS[r]?.label || r;
      if (r.oneOf)
        return `(${r.oneOf.map((k) => STANDARD_FIELDS[k]?.label || k).join(" / ")} 중 1)`;
      return "?";
    });

    // Determine allowKeys
    const allowed = new Set();
    reqs.forEach((r) => {
      if (typeof r === "string") allowed.add(r);
      else if (r.oneOf) r.oneOf.forEach((k) => allowed.add(k));
    });
    opts.forEach((o) => allowed.add(o.key));

    const groups = {};
    for (const [key, def] of Object.entries(STANDARD_FIELDS)) {
      if (allowed.size > 0 && !allowed.has(key)) continue;
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push({ key, label: def.label });
    }
    // Fallback if empty
    if (Object.keys(groups).length === 0) {
      for (const [key, def] of Object.entries(STANDARD_FIELDS)) {
        if (!groups[def.group]) groups[def.group] = [];
        groups[def.group].push({ key, label: def.label });
      }
    }

    return { missing: missingKeys, reqLabels: labels, fieldGroups: groups, allowKeys: allowed };
  }, [toolId, csvData.mapping]);

  // --- Data preview (#6): first ~8 rows × MAPPED columns so the user maps with
  // context. Ignored columns are dropped; each header shows its standard-field
  // label. Falls back to all headers when nothing is mapped yet (fresh upload).
  const preview = useMemo(() => {
    const headers = csvData.headers || [];
    const mapping = csvData.mapping || {};
    const mappedHeaders = headers.filter((h) => mapping[h] && mapping[h] !== "__ignore__");
    // Before any mapping exists, show all columns so the raw data is still visible.
    const cols = mappedHeaders.length > 0 ? mappedHeaders : headers;
    const rows = (csvData.raw || []).slice(0, 8);
    return {
      cols,
      rows,
      usingMapped: mappedHeaders.length > 0,
      totalRows: (csvData.raw || []).length,
    };
  }, [csvData.headers, csvData.mapping, csvData.raw]);

  if (!hasFile) {
    return (
      <div>
        <div
          className={`csv-dropzone ${isDragging ? "dragover" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="csv-drop-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </div>
          <div className="csv-drop-text">CSV 파일 드래그 & 드롭</div>
          <div className="csv-drop-sub">또는 클릭하여 파일 선택</div>
          <input
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            ref={fileInputRef}
            onChange={handleFileChange}
          />
        </div>
        {errorMsg && <div style={{ color: "var(--danger)", marginTop: "10px", fontSize: "12px" }}>{errorMsg}</div>}
        <DataFeatureMatrix toolId={toolId} analyzed={missing.length === 0} />
      </div>
    );
  }

  const mappedOptCount = (TOOL_OPTIONAL_FIELDS[toolId] || []).filter(
    (o) => csvData.mapping && csvData.mapping !== "__ignore__" && Object.values(csvData.mapping).includes(o.key)
  ).length;
  const totalOptCount = (TOOL_OPTIONAL_FIELDS[toolId] || []).length;

  return (
    <div>
      <div className="file-state">
        <div className="meta-text">
          <span className="dot" style={{ background: "#22c55e" }}></span>
          <strong>{csvData.fileName}</strong>
          <span className="csv-loaded-stats tnum">
            {csvData.raw.length.toLocaleString()}행 · {csvData.headers.length}컬럼
          </span>
        </div>
        <button className="ab-pill csv-change-btn" title="이 도구의 CSV를 제거하고 다른 파일 업로드" onClick={handleReset}>
          ⟳ CSV 변경
        </button>
      </div>

      {missing.length > 0 ? (
        <div className="required-banner">
          <strong>⚠ 이 도구가 필요로 하는 필수 컬럼이 매핑되지 않았습니다</strong>
          <p style={{ margin: "0.25rem 0 0" }}>
            필수: {reqLabels.map((l, i) => (
              <span key={i}><code className="inline">{l}</code>{i < reqLabels.length - 1 ? ", " : ""}</span>
            ))}
          </p>
        </div>
      ) : (
        <div className="required-banner ok">
          <strong>✓ 필수 컬럼 매핑 완료.</strong>
          <p style={{ margin: "0.25rem 0 0" }}>아래 도구를 사용할 수 있습니다.</p>
        </div>
      )}

      <div className="csv-mapping-block">
        <div className="csv-mapping-header">
          <div>
            <strong style={{ fontSize: "14px", color: "var(--primary, #adc6ff)" }}>📋 CSV 컬럼 → 표준 필드 매핑</strong>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>
              전체 {csvData.headers.length}컬럼 · 옵션 매핑 <strong style={{ color: "var(--text-primary)" }}>{mappedOptCount}/{totalOptCount}</strong>
            </span>
          </div>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>자동 + 수동. 드롭다운으로 변경 시 즉시 반영.</span>
        </div>
        <div className="mapping-grid">
          <div className="mapping-header">CSV 컬럼</div>
          <div></div>
          <div className="mapping-header">표준 필드</div>
          <div className="mapping-header" style={{ textAlign: "right" }}>상태</div>
          
          {csvData.headers.map((h) => {
            const sel = csvData.mapping[h] || "__ignore__";
            const isUnmapped = sel === "__ignore__";
            
            const outOfScope = !isUnmapped && STANDARD_FIELDS[sel] && allowKeys.size > 0 && !allowKeys.has(sel);

            return (
              <React.Fragment key={h}>
                <div className="map-csv-col" title={h}>{h}</div>
                <div className="map-arrow">→</div>
                <select 
                  className={`map-select ${isUnmapped ? "unmapped" : "auto"}`}
                  value={sel}
                  onChange={(e) => handleMappingChange(h, e.target.value)}
                >
                  <option value="__ignore__">(사용 안 함)</option>
                  {outOfScope && (
                    <option value={sel}>
                      {STANDARD_FIELDS[sel].label} (이 도구 미사용)
                    </option>
                  )}
                  {Object.entries(fieldGroups).map(([gr, fs]) => (
                    <optgroup key={gr} label={gr}>
                      {fs.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className={`map-status ${isUnmapped ? "" : "ok"}`}>
                  {isUnmapped ? "사용 안 함" : "매핑됨"}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* 데이터 미리보기(#6) — 매핑 중에는 자동 펼침(맥락 확인), 분석 확정 후 접힘.
          사용자가 언제든 수동으로 다시 펼칠 수 있음(previewOpen 로컬 상태). */}
      {preview.cols.length > 0 && preview.rows.length > 0 && (
        <div className="csv-preview-block" style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "6px" }}>
            <div>
              <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>🔎 데이터 미리보기</strong>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>
                {preview.usingMapped ? "매핑된 컬럼" : "전체 컬럼"} · 상위 {preview.rows.length}행 / 총 {preview.totalRows.toLocaleString()}행
              </span>
            </div>
            <button
              className="ab-pill"
              style={{ fontSize: "11px" }}
              onClick={() => setPreviewOpen((o) => !o)}
            >
              {previewOpen ? "▾ 접기" : "▸ 펼치기"}
            </button>
          </div>
          {previewOpen && (
            <div className="table-wrap" style={{ marginTop: "4px", maxHeight: "320px", overflow: "auto" }}>
              <table className="data" style={{ fontSize: "11.5px" }}>
                <thead>
                  <tr>
                    {preview.cols.map((h) => {
                      const sel = csvData.mapping[h];
                      const stdLabel = sel && sel !== "__ignore__" ? STANDARD_FIELDS[sel]?.label : null;
                      return (
                        <th key={h} title={stdLabel ? `${h} → ${stdLabel}` : h} style={{ whiteSpace: "nowrap" }}>
                          {escapeHtml(h)}
                          {stdLabel && (
                            <span style={{ display: "block", fontSize: "10px", fontWeight: 400, color: "var(--primary, #adc6ff)" }}>
                              → {escapeHtml(stdLabel)}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, ri) => (
                    <tr key={ri}>
                      {preview.cols.map((h) => (
                        <td key={h} style={{ whiteSpace: "nowrap", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {escapeHtml(row[h] != null ? String(row[h]) : "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <DataFeatureMatrix toolId={toolId} analyzed={missing.length === 0} />

      {missing.length === 0 && (
        isAnalyzed ? (
          <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ color: "#22c55e", fontSize: "12px", fontWeight: 600 }}>✓ 분석 완료</span>
            <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>매핑을 바꾸면 결과가 숨겨지고 다시 &quot;분석하기&quot;를 눌러야 합니다.</span>
            <button className="ab-pill" onClick={() => { setGroupAnalyzed(toolId); setPreviewOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ marginLeft: "auto" }}>↻ 다시 분석</button>
          </div>
        ) : (
          <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ color: "var(--danger)", fontSize: "12px", fontWeight: 600 }}>⚠ 매핑 확인 필요</span>
            <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>매핑이 올바른지 확인 후 &quot;분석하기&quot;를 클릭하여 분석을 시작하세요.</span>
            <button className="ab-button" onClick={() => { setGroupAnalyzed(toolId); setPreviewOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ marginLeft: "auto" }}>데이터 분석하기</button>
          </div>
        )
      )}
    </div>
  );
}
