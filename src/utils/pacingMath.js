// Pacing math — extracted VERBATIM from index.html PACING_MATH (near line 37375).
// Pure, deterministic (no Math.random). Source of truth = index.html golden.
export const PACING_MATH = {
  // 일별 시리즈 → {mtd, daysElapsed, daysInMonth, runRate, projected}
  // dates: 'YYYY-MM-DD' 정렬됨. 최신 월 기준.
  pace(daily) {
    if (!daily.length) return null;
    const last = daily[daily.length - 1].date;
    const ym = last.slice(0, 7);
    const monthRows = daily.filter((d) => d.date.slice(0, 7) === ym);
    const mtd = monthRows.reduce((s, d) => s + d.value, 0);
    const lastDay = Number(last.slice(8, 10));
    const y = Number(ym.slice(0, 4)),
      mo = Number(ym.slice(5, 7));
    const daysInMonth = new Date(y, mo, 0).getDate(); // mo는 1-based → day0 of next = last day
    const daysElapsed = lastDay;
    const runRate = daysElapsed > 0 ? mtd / daysElapsed : 0;
    const projected = runRate * daysInMonth;
    return { ym, mtd, daysElapsed, daysInMonth, runRate, projected };
  },
  // 최근 N주(4~8주) 일별 시리즈 → 요일별 평균 맵(0=일~6=토) + 표본수
  // 'YYYY-MM-DD' ISO 형식, getDay() UTC 파싱(buildDailyAgg와 동일)
  weekdayProfile(daily, recentWeeks) {
    const weeks = recentWeeks || 6;
    const n = weeks * 7;
    const recent = daily.slice(-n);
    const sums = [0, 0, 0, 0, 0, 0, 0],
      counts = [0, 0, 0, 0, 0, 0, 0];
    for (const d of recent) {
      const wd = new Date(d.date).getDay();
      sums[wd] += d.value;
      counts[wd]++;
    }
    const means = sums.map((s, i) =>
      counts[i] >= 1 ? s / counts[i] : null,
    );
    const minOk = means.every(
      (m) => m !== null && counts[means.indexOf(m)] >= 1,
    );
    // 요일당 최소 3개 가드
    const ok = counts.every((c) => c >= 3);
    return { means, counts, ok };
  },
  // 요일별 평균 합산 예측(산식 A): mtd + Σ잔여일 wdMean[getDay()]
  paceWeekday(daily, opts) {
    if (!daily.length) return null;
    const p = this.pace(daily);
    if (!p) return null;
    const recentWeeks = (opts && opts.recentWeeks) || 6;
    const prof = this.weekdayProfile(daily, recentWeeks);
    if (!prof.ok)
      return Object.assign({}, p, {
        weekdayProjected: null,
        fallback: true,
      });
    const lastDateStr =
      daily.filter((d) => d.date.slice(0, 7) === p.ym).pop()?.date ||
      daily[daily.length - 1].date;
    const lastDay = Number(lastDateStr.slice(8, 10));
    const y = Number(p.ym.slice(0, 4)),
      mo = Number(p.ym.slice(5, 7));
    let remaining = 0;
    for (let d = lastDay + 1; d <= p.daysInMonth; d++) {
      const dt = new Date(Date.UTC(y, mo - 1, d));
      const wd = dt.getDay();
      const wdMean = prof.means[wd];
      if (wdMean != null) remaining += wdMean;
    }
    const weekdayProjected = p.mtd + remaining;
    return Object.assign({}, p, {
      weekdayProjected,
      fallback: false,
      profile: prof,
    });
  },
};
