// Deterministic test fixtures: date + seeded-noise helpers.
// Ported VERBATIM from index.html (faithful copy). All RNGs are LCGs — NO Math.random.
// generateDates / seededNoise: index.html 16358-16373
// _mmrLcg: index.html 20437-20443

export function generateDates(n, startStr = "2024-01-01") {
  const start = Date.parse(startStr);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start + i * 86400000);
    return d.toISOString().slice(0, 10);
  });
}

export function seededNoise(seed) {
  // Linear Congruential Generator (deterministic)
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5; // [-0.5, 0.5)
  };
}

/* 결정론 LCG (테스트용; 런타임 모델엔 미사용) */
export function _mmrLcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}
