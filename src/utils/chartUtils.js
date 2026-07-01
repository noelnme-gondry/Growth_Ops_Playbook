/* text/textPrimary/muted/grid/border는 index.html CHART_THEME(약 9219행) 그대로 getter 이식 —
   document.body.classList.contains("light-mode") 여부로 라이트/다크 값 분기(§7 다크모드 함정). */
export const CHART_THEME = {
  get text() {
    return typeof document !== "undefined" && document.body.classList.contains("light-mode")
      ? "#4b5563"
      : "#9CA3AF";
  },
  get textPrimary() {
    return typeof document !== "undefined" && document.body.classList.contains("light-mode")
      ? "#111827"
      : "#F9FAFB";
  },
  get muted() {
    return typeof document !== "undefined" && document.body.classList.contains("light-mode")
      ? "#9ca3af"
      : "#6B7280";
  },
  get grid() {
    return typeof document !== "undefined" && document.body.classList.contains("light-mode")
      ? "rgba(0,0,0,0.06)"
      : "rgba(255,255,255,0.06)";
  },
  get border() {
    return typeof document !== "undefined" && document.body.classList.contains("light-mode")
      ? "rgba(0,0,0,0.08)"
      : "rgba(255,255,255,0.08)";
  },
  primary: "#adc6ff",
  secondary: "#4cd7f6",
  tertiary: "#94b8ff",
  quaternary: "#c2d6ff",
  accent: "#ffadc6",
  bg: "transparent",
  colors: [
    "#adc6ff", "#4cd7f6", "#94b8ff", "#c2d6ff", "#e0e7ff",
    "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca",
  ],
};
CHART_THEME.series = CHART_THEME.colors;

export function chartCommonOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    layout: { padding: { top: 12, right: 12, bottom: 0, left: 0 } },
    plugins: {
      legend: {
        display: true,
        position: "top",
        align: "end",
        labels: {
          color: CHART_THEME.muted,
          font: { family: "Pretendard", size: 11 },
          usePointStyle: true,
          boxWidth: 8,
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor: "rgba(0,0,0,0.85)",
        titleColor: CHART_THEME.text,
        bodyColor: CHART_THEME.text,
        bodyFont: { family: "JetBrains Mono", size: 12 },
        padding: 10,
        cornerRadius: 6,
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
        usePointStyle: true,
      },
    },
    scales: {
      x: {
        grid: { display: false, drawBorder: false },
        ticks: { color: CHART_THEME.muted, font: { family: "JetBrains Mono", size: 10 } },
      },
      y: {
        grid: { color: CHART_THEME.grid, drawBorder: false },
        ticks: { color: CHART_THEME.muted, font: { family: "JetBrains Mono", size: 10 } },
        beginAtZero: true,
      },
    },
    interaction: { mode: "index", intersect: false },
  };
}

/* 현재 테마의 CSS 변수 값 읽기 (다크/라이트 자동). index.html getCssVar 이식. */
export function getCssVar(name) {
  if (typeof window === "undefined" || typeof document === "undefined") return "#999";
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#999"
  );
}

/* Chart.js 캔버스를 PNG로 다운로드. Chart.js는 기본 transparent → 테마 배경 합성 후 export.
   index.html downloadChartAsPNG 이식(§7 dark 배경 명시 합성). */
export function downloadChartAsPNG(canvas, fileName) {
  if (typeof document === "undefined" || !canvas) return false;
  const tmp = document.createElement("canvas");
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const ctx = tmp.getContext("2d");
  const bg = getCssVar("--bg-1") || "#121212";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(canvas, 0, 0);

  const url = tmp.toDataURL("image/png");
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${fileName}_${ts}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}
