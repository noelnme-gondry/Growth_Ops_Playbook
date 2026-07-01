// ANOMALY_MATH — EMA(지수이동평균) baseline + 요일(DOW) 계절성 보정 이상 감지
// (5-2 운영 대시보드 · 이상 감지 탭)
// origin/feat/dashboard-basis-csv-unify:index.html ANOMALY_MATH (near line 39258)에서
// VERBATIM 이식한 순수 함수. SMA→EMA 전환으로 트렌드 변화에 빠르게 적응(α=2/(win+1))해
// "기준이 못 따라와 뒤 정상값까지 이상" 문제를 해소. 요일 효과를 기대값에 반영해
// 요일 특성으로 인한 거짓 이상탐지를 줄임.
export const ANOMALY_MATH = {
  // 요일별 효과 계수: eff[dow] = 해당 요일 평균 / 전체 평균 (dow: 0=일 … 6=토, getUTCDay).
  // >1 = 그 요일에 평소보다 높은 게 정상, <1 = 낮은 게 정상.
  computeDowEffects(values, dates) {
    const sum = new Array(7).fill(0),
      cnt = new Array(7).fill(0);
    let tot = 0,
      totN = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!isFinite(v)) continue;
      const dt = new Date(dates[i]);
      if (isNaN(dt)) continue;
      const dow = dt.getUTCDay();
      sum[dow] += v;
      cnt[dow]++;
      tot += v;
      totN++;
    }
    const totAvg = totN ? tot / totN : 0;
    const eff = new Array(7).fill(1),
      avg = new Array(7).fill(null);
    for (let k = 0; k < 7; k++) {
      if (cnt[k]) {
        avg[k] = sum[k] / cnt[k];
        eff[k] = totAvg > 0 ? avg[k] / totAvg : 1;
      }
    }
    return { eff, avg, totAvg, cnt };
  },
  // EMA(지수이동평균) 기반 baseline + EMA 분산. 첫 win개는 baseline 부족으로 skip(z=null).
  // SMA 대비 트렌드 변화에 빠르게 적응(α=2/(win+1)) → "기준이 못 따라와 뒤 정상값까지
  // 이상" 문제 해소. dowEffects 주면 기대값 = EMA × 요일승수(요일 계절성 보정).
  detect(values, win, zThresh, dates, dowEffects) {
    const alpha = 2 / (win + 1);
    const out = [];
    let ema = null,
      emaVar = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      let expected = ema;
      if (dowEffects && dates && expected != null) {
        const dt = new Date(dates[i]);
        const m = !isNaN(dt) ? dowEffects.eff[dt.getUTCDay()] : 1;
        if (isFinite(m) && m > 0) expected = ema * m;
      }
      let z = null,
        flag = false;
      if (i >= win && ema != null) {
        const sd = Math.sqrt(emaVar) || 0;
        z = sd > 0 ? (v - expected) / sd : 0;
        flag = Math.abs(z) >= zThresh;
      }
      out.push({ i, z, mean: expected, flag });
      // EMA·EMA분산 업데이트(현재 값 반영) — West의 incremental 분산.
      if (isFinite(v)) {
        if (ema == null) {
          ema = v;
          emaVar = 0;
        } else {
          const diff = v - ema;
          ema += alpha * diff;
          emaVar = (1 - alpha) * (emaVar + alpha * diff * diff);
        }
      }
    }
    return out;
  },
};
