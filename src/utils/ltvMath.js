export const LTV_DNS = [0, 7, 14, 30, 60, 90, 180, 360];

export const LTVCAC_MATH = {
  safeDiv(n, d) {
    n = Number(n) || 0;
    d = Number(d) || 0;
    return d > 0 ? n / d : null;
  },
  
  fitCumArpu(points) {
    const valid = points.filter((p) => p.arpu != null && isFinite(p.arpu) && p.arpu > 0);
    if (valid.length < 2) {
      const flat = valid[0]?.arpu ?? null;
      return flat != null ? { predict: () => flat, kind: "flat" } : null;
    }
    const xs = valid.map((p) => Math.log(p.day + 1));
    const ys = valid.map((p) => Math.log(p.arpu));
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    
    if (den === 0) {
      const f = valid[valid.length - 1].arpu;
      return { predict: () => f, kind: "flat" };
    }
    
    const b = num / den;
    const a = Math.exp(my - b * mx);
    
    return {
      predict: (day) => a * Math.pow(day + 1, b),
      a,
      b,
      kind: "power",
    };
  },
  
  ltvPredict(unitObj, targetDay) {
    if (!unitObj) return { value: null, predicted: false };
    const { arpu0, arpu7, arpu14, arpuByDay, fit } = unitObj;
    
    if (arpuByDay && arpuByDay[targetDay] != null) return { value: arpuByDay[targetDay], predicted: false };
    if (targetDay === 0 && arpu0 != null) return { value: arpu0, predicted: false };
    if (targetDay === 7 && arpu7 != null) return { value: arpu7, predicted: false };
    if (targetDay === 14 && arpu14 != null) return { value: arpu14, predicted: false };
    
    if (unitObj.ratioByDay && unitObj.ratioBase != null) {
      const ratio = unitObj.ratioByDay[targetDay];
      if (ratio != null && ratio > 0) return { value: unitObj.ratioBase * ratio, predicted: true };
    }
    
    if (fit) {
      const v = fit.predict(targetDay);
      if (v != null && isFinite(v) && v >= 0) return { value: v, predicted: true };
    }
    return { value: null, predicted: true };
  },
  
  paybackDay(fit, cac, maxDay = 720) {
    if (!fit || cac == null || cac <= 0) return null;
    for (let d = 0; d <= maxDay; d++) {
      if (fit.predict(d) >= cac) return d;
    }
    return null;
  }
};

export function buildLtvData(rows, mapping, unitField, ltvHorizon, denomBasis) {
  // 전역 분모 기준(§12.18): 요청 basis가 매핑에 있으면 사용, 없으면 installs→actions 폴백.
  const mappedSet = new Set(Object.values(mapping));
  let denomField = denomBasis || "installs";
  if (!mappedSet.has(denomField)) {
    denomField = mappedSet.has("installs") ? "installs" : mappedSet.has("actions") ? "actions" : denomField;
  }
  // rows는 getMappedRows()로 이미 표준키(standardKey)로 매핑된 상태 — mapping은
  // { origHeader: standardKey } 이므로 mapping[unitField]로 재조회하면 항상 undefined.
  // unitField 자체가 표준키이므로 그대로 사용.
  const realUnitField = unitField;

  const map = new Map();
  for (const r of rows) {
    const key = realUnitField && r[realUnitField] ? String(r[realUnitField]).trim() : "(미지정)";
    if (!map.has(key)) {
      const init = { unit: key, cost: 0, denom: 0 };
      LTV_DNS.forEach((d) => {
        init[`rev${d}`] = 0;
        init[`has${d}`] = false;
      });
      map.set(key, init);
    }
    const b = map.get(key);
    b.cost += Number(r.cost) || 0;
    b.denom += Number(r[denomField]) || 0;
    
    for (const d of LTV_DNS) {
      // r은 이미 표준키 매핑 완료 상태이므로 `revenue_d${d}`를 직접 키로 읽는다
      // (mapping[...] 재조회 금지 — mapping은 원본헤더→표준키, 표준키→표준키가 아님).
      const revKey = `revenue_d${d}`;
      if (r[revKey] != null && r[revKey] !== "") {
        b[`rev${d}`] += Number(r[revKey]) || 0;
        b[`has${d}`] = true;
      }
    }
  }

  const out = [];
  for (const b of map.values()) {
    const cac = LTVCAC_MATH.safeDiv(b.cost, b.denom);
    const arpuByDay = {};
    const observedDays = [];
    const pts = [];
    
    for (const d of LTV_DNS) {
      if (b[`has${d}`]) {
        const arpu = LTVCAC_MATH.safeDiv(b[`rev${d}`], b.denom);
        if (arpu != null) {
          arpuByDay[d] = arpu;
          observedDays.push(d);
          pts.push({ day: d, arpu });
        }
      }
    }
    
    const arpu0 = arpuByDay[0] ?? null;
    const arpu7 = arpuByDay[7] ?? null;
    const arpu14 = arpuByDay[14] ?? null;
    const fit = LTVCAC_MATH.fitCumArpu(pts);
    
    const ratioByDay = {};
    let ratioBase = null;
    if (observedDays.length >= 2) {
      const anchorDay = observedDays[observedDays.length - 1];
      ratioBase = arpuByDay[anchorDay];
      if (ratioBase != null && ratioBase > 0) {
        for (const [d, v] of Object.entries(arpuByDay)) ratioByDay[d] = v / ratioBase;
      }
    }
    
    const unitRef = { arpu0, arpu7, arpu14, arpuByDay, observedDays, fit, ratioByDay, ratioBase };
    const { value: ltvAtHorizon, predicted: ltvPredicted } = LTVCAC_MATH.ltvPredict(unitRef, ltvHorizon);
    
    const ratio = cac != null && ltvAtHorizon != null && cac > 0 ? ltvAtHorizon / cac : null;
    const payback = LTVCAC_MATH.paybackDay(fit, cac);
    const maxObsDn = observedDays.length ? observedDays[observedDays.length - 1] : 0;
    
    out.push({
      unit: b.unit,
      cost: b.cost,
      users: b.denom,
      cac,
      arpu0,
      arpu7,
      arpu14,
      arpuByDay,
      observedDays,
      fit,
      ratioByDay,
      ratioBase,
      ltvAtHorizon,
      ltvPredicted,
      ratio,
      payback,
      maxObsDn,
      roas0: LTVCAC_MATH.safeDiv(b.rev0, b.cost),
      roas7: LTVCAC_MATH.safeDiv(b.rev7, b.cost),
      roas14: LTVCAC_MATH.safeDiv(b.rev14, b.cost),
      fitKind: fit?.kind || "none",
      denomField,
      unitRef
    });
  }
  
  out.sort((a, b) => (b.cost || 0) - (a.cost || 0));
  return out;
}
