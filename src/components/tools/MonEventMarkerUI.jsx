"use client";
import React, { useState } from "react";
import { useAppStore } from "@/store/useDataStore";

export default function MonEventMarkerUI() {
  const eventMarkers = useAppStore((state) => state.eventMarkers);
  const addEventMarker = useAppStore((state) => state.addEventMarker);
  const removeEventMarker = useAppStore((state) => state.removeEventMarker);

  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");

  const handleAdd = () => {
    if (!date || !label.trim()) return;
    addEventMarker({ date, label: label.trim() });
    setDate("");
    setLabel("");
  };

  const sortedMarkers = [...eventMarkers].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  return (
    <div
      className="block"
      style={{
        padding: "14px 18px",
        margin: "12px 0",
        border: "1px solid var(--border-subtle)",
        borderRadius: "8px",
        background: "var(--bg-2)",
      }}
    >
      <div
        style={{
          fontSize: "12.5px",
          fontWeight: 700,
          color: "var(--text-1)",
          marginBottom: "8px",
        }}
      >
        📌 주요 이벤트 마커{" "}
        <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
          (캠페인 런칭·프로모션·매체 이슈 등 — 새로고침 시 초기화)
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            padding: "6px 8px",
            fontSize: "12px",
            background: "var(--bg-1)",
            color: "var(--text-1)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
          }}
        />
        <input
          type="text"
          placeholder="라벨 (예: 신규 프로모션 시작)"
          maxLength={40}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          style={{
            flex: 1,
            minWidth: "160px",
            padding: "6px 8px",
            fontSize: "12px",
            background: "var(--bg-1)",
            color: "var(--text-1)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
          }}
        />
        <button className="ab-pill" type="button" onClick={handleAdd}>
          + 마커 추가
        </button>
      </div>
      {sortedMarkers.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {sortedMarkers.map((m) => (
            <li
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "11.5px",
                color: "var(--text-2)",
              }}
            >
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "var(--text-muted)",
                }}
              >
                {m.date}
              </span>
              <span style={{ flex: 1 }}>{m.label}</span>
              <button
                className="ab-pill"
                type="button"
                style={{ padding: "2px 8px", fontSize: "10.5px" }}
                onClick={() => removeEventMarker(m.id)}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: "11.5px", color: "var(--text-muted)", margin: 0 }}>
          등록된 마커가 없습니다. 날짜와 라벨을 입력해 추가하세요.
        </p>
      )}
    </div>
  );
}
