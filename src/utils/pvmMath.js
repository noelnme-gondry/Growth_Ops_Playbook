export const PVM_MATH = (function () {
  function aggregate(rows, groupKey, resultField) {
    const m = new Map();
    for (const r of rows) {
      const k = String(r[groupKey] ?? "");
      if (!m.has(k)) m.set(k, { cost: 0, result: 0 });
      const e = m.get(k);
      e.cost += Number(r.spend) || 0;
      e.result += Number(r[resultField]) || 0;
    }
    return m;
  }

  function applyNoiseGuard(agg1, agg2, threshold) {
    const keys = new Set([...agg1.keys(), ...agg2.keys()]);
    const out1 = new Map(),
      out2 = new Map();
    const OTHER = "기타(소액)";
    for (const k of keys) {
      const e1 = agg1.get(k) || { cost: 0, result: 0 };
      const e2 = agg2.get(k) || { cost: 0, result: 0 };
      const small = e1.result + e2.result < threshold;
      const dest = small ? OTHER : k;
      if (!out1.has(dest)) out1.set(dest, { cost: 0, result: 0 });
      if (!out2.has(dest)) out2.set(dest, { cost: 0, result: 0 });
      out1.get(dest).cost += e1.cost;
      out1.get(dest).result += e1.result;
      out2.get(dest).cost += e2.cost;
      out2.get(dest).result += e2.result;
    }
    return [out1, out2];
  }

  function calculateCpa(cost, result) {
    const userVal = result > 0 ? cost / result : null;
    let engineVal = 0;
    if (result > 0) {
      engineVal = cost / result;
    } else if (cost > 0) {
      engineVal = cost; // Rule A
    } else {
      engineVal = 0; // Rule B
    }
    return { userVal, engineVal };
  }

  function decompose(agg1, agg2) {
    const keys = new Set([...agg1.keys(), ...agg2.keys()]);
    const Cost1 = [...agg1.values()].reduce((a, e) => a + e.cost, 0);
    const Cost2 = [...agg2.values()].reduce((a, e) => a + e.cost, 0);
    const Result1 = [...agg1.values()].reduce((a, e) => a + e.result, 0);
    const Result2 = [...agg2.values()].reduce((a, e) => a + e.result, 0);
    if (Result1 <= 0 || Result2 <= 0) return null;
    const CPA1 = Cost1 / Result1,
      CPA2 = Cost2 / Result2;
    const Cbar = (CPA1 + CPA2) / 2;
    const entities = [];
    for (const k of keys) {
      const e1 = agg1.get(k) || { cost: 0, result: 0 };
      const e2 = agg2.get(k) || { cost: 0, result: 0 };
      const cpa1Data = calculateCpa(e1.cost, e1.result);
      const cpa2Data = calculateCpa(e2.cost, e2.result);
      const cpa1 = cpa1Data.engineVal;
      const cpa2 = cpa2Data.engineVal;
      const userCpa1 = cpa1Data.userVal;
      const userCpa2 = cpa2Data.userVal;
      const s1 = Result1 > 0 ? e1.result / Result1 : 0;
      const s2 = Result2 > 0 ? e2.result / Result2 : 0;
      const cpaBar = (cpa1 + cpa2) / 2;
      const sBar = (s1 + s2) / 2;
      const mix = (cpaBar - Cbar) * (s2 - s1);
      const rate = sBar * (cpa2 - cpa1);
      entities.push({
        key: k,
        cost1: e1.cost,
        cost2: e2.cost,
        result1: e1.result,
        result2: e2.result,
        cpa1,
        cpa2,
        userCpa1,
        userCpa2,
        s1,
        s2,
        mix,
        rate,
        contribution: mix + rate,
      });
    }
    return {
      CPA1,
      CPA2,
      deltaCpa: CPA2 - CPA1,
      Cost1,
      Cost2,
      Result1,
      Result2,
      entities,
    };
  }

  function decomposeFinest(rowsP1, rowsP2, keys) {
    const resultField = keys.resultField || "installs";
    function tupleKey(r) {
      const ch = String(r[keys.ch] ?? "");
      const cmp = keys.cmp ? String(r[keys.cmp] ?? "") : "";
      const cr = keys.cr ? String(r[keys.cr] ?? "") : "";
      return ch + " " + cmp + " " + cr;
    }
    function aggTuple(rows) {
      const m = new Map();
      for (const r of rows) {
        const k = tupleKey(r);
        if (!m.has(k)) {
          m.set(k, {
            chKey: String(r[keys.ch] ?? ""),
            cmpKey: keys.cmp ? String(r[keys.cmp] ?? "") : null,
            crKey: keys.cr ? String(r[keys.cr] ?? "") : null,
            cost: 0,
            result: 0,
          });
        }
        const e = m.get(k);
        e.cost += Number(r.spend) || 0;
        e.result += Number(r[resultField]) || 0;
      }
      return m;
    }
    const agg1 = aggTuple(rowsP1);
    const agg2 = aggTuple(rowsP2);
    const tupleKeys = new Set([...agg1.keys(), ...agg2.keys()]);
    const Cost1 = [...agg1.values()].reduce((a, e) => a + e.cost, 0);
    const Cost2 = [...agg2.values()].reduce((a, e) => a + e.cost, 0);
    const Result1 = [...agg1.values()].reduce((a, e) => a + e.result, 0);
    const Result2 = [...agg2.values()].reduce((a, e) => a + e.result, 0);
    if (Result1 <= 0 || Result2 <= 0) return null;
    const CPA1 = Cost1 / Result1,
      CPA2 = Cost2 / Result2;
    const Cbar = (CPA1 + CPA2) / 2;
    const finest = [];
    for (const k of tupleKeys) {
      const e1 = agg1.get(k) || { cost: 0, result: 0 };
      const e2 = agg2.get(k) || { cost: 0, result: 0 };
      const meta = agg1.get(k) || agg2.get(k);
      const cpa1Data = calculateCpa(e1.cost, e1.result);
      const cpa2Data = calculateCpa(e2.cost, e2.result);
      const cpa1 = cpa1Data.engineVal;
      const cpa2 = cpa2Data.engineVal;
      const userCpa1 = cpa1Data.userVal;
      const userCpa2 = cpa2Data.userVal;
      const s1 = Result1 > 0 ? e1.result / Result1 : 0;
      const s2 = Result2 > 0 ? e2.result / Result2 : 0;
      const cpaBar = (cpa1 + cpa2) / 2;
      const sBar = (s1 + s2) / 2;
      const mix = (cpaBar - Cbar) * (s2 - s1);
      const rate = sBar * (cpa2 - cpa1);
      finest.push({
        chKey: meta.chKey,
        cmpKey: meta.cmpKey,
        crKey: meta.crKey,
        cost1: e1.cost,
        cost2: e2.cost,
        result1: e1.result,
        result2: e2.result,
        cpa1,
        cpa2,
        userCpa1,
        userCpa2,
        s1,
        s2,
        mix,
        rate,
        contribution: mix + rate,
      });
    }
    return {
      CPA1,
      CPA2,
      deltaCpa: CPA2 - CPA1,
      Cost1,
      Cost2,
      Result1,
      Result2,
      finest,
    };
  }

  function decomposeLayer(
    rowsP1,
    rowsP2,
    keys,
    Result1,
    Result2,
    Cbar,
    level,
  ) {
    const resultField = keys.resultField || "installs";
    function getKeys(r) {
      const ch = String(r[keys.ch] ?? "");
      const cmp = keys.cmp ? String(r[keys.cmp] ?? "") : "";
      const cr = keys.cr ? String(r[keys.cr] ?? "") : "";
      if (level === "channel") {
        return { groupKey: ch, chKey: ch, cmpKey: "", crKey: "" };
      } else if (level === "campaign") {
        return {
          groupKey: ch + "│" + cmp,
          chKey: ch,
          cmpKey: cmp,
          crKey: "",
        };
      } else {
        return {
          groupKey: ch + "│" + cmp + "│" + cr,
          chKey: ch,
          cmpKey: cmp,
          crKey: cr,
        };
      }
    }

    const agg1 = new Map();
    const agg2 = new Map();
    const fillAgg = (rows, aggMap) => {
      for (const r of rows) {
        const { groupKey, chKey, cmpKey, crKey } = getKeys(r);
        if (!aggMap.has(groupKey)) {
          aggMap.set(groupKey, {
            chKey,
            cmpKey: keys.cmp ? cmpKey : null,
            crKey: keys.cr ? crKey : null,
            cost: 0,
            result: 0,
          });
        }
        const e = aggMap.get(groupKey);
        e.cost += Number(r.spend) || 0;
        e.result += Number(r[resultField]) || 0;
      }
    };
    fillAgg(rowsP1, agg1);
    fillAgg(rowsP2, agg2);

    const groupKeys = new Set([...agg1.keys(), ...agg2.keys()]);
    const entities = [];
    for (const gk of groupKeys) {
      const e1 = agg1.get(gk) || { cost: 0, result: 0 };
      const e2 = agg2.get(gk) || { cost: 0, result: 0 };
      const meta = agg1.get(gk) || agg2.get(gk);

      const cpa1Data = calculateCpa(e1.cost, e1.result);
      const cpa2Data = calculateCpa(e2.cost, e2.result);
      const cpa1 = cpa1Data.engineVal;
      const cpa2 = cpa2Data.engineVal;
      const userCpa1 = cpa1Data.userVal;
      const userCpa2 = cpa2Data.userVal;

      const s1 = Result1 > 0 ? e1.result / Result1 : 0;
      const s2 = Result2 > 0 ? e2.result / Result2 : 0;

      const cpaBar = (cpa1 + cpa2) / 2;
      const sBar = (s1 + s2) / 2;

      const mix = (cpaBar - Cbar) * (s2 - s1);
      const rate = sBar * (cpa2 - cpa1);

      entities.push({
        key:
          level === "channel"
            ? meta.chKey
            : level === "campaign"
              ? meta.cmpKey
              : meta.crKey,
        chKey: meta.chKey,
        cmpKey: meta.cmpKey,
        crKey: meta.crKey,
        cost1: e1.cost,
        cost2: e2.cost,
        result1: e1.result,
        result2: e2.result,
        cpa1,
        cpa2,
        userCpa1,
        userCpa2,
        s1,
        s2,
        mix,
        rate,
        contribution: mix + rate,
      });
    }
    return entities;
  }

  function rollup(finestArr, keyFn, Result1, Result2) {
    const groups = new Map();
    for (const f of finestArr) {
      const k = keyFn(f);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    const out = [];
    for (const [k, children] of groups) {
      const cost1 = children.reduce((a, c) => a + c.cost1, 0);
      const cost2 = children.reduce((a, c) => a + c.cost2, 0);
      const result1 = children.reduce((a, c) => a + c.result1, 0);
      const result2 = children.reduce((a, c) => a + c.result2, 0);
      const cpa1 = result1 > 0 ? cost1 / result1 : 0;
      const cpa2 = result2 > 0 ? cost2 / result2 : 0;
      const s1 = Result1 > 0 ? result1 / Result1 : 0;
      const s2 = Result2 > 0 ? result2 / Result2 : 0;
      const mix = children.reduce((a, c) => a + c.mix, 0);
      const rate = children.reduce((a, c) => a + c.rate, 0);
      const contribution = children.reduce(
        (a, c) => a + c.contribution,
        0,
      );
      out.push({
        key: k,
        cost1,
        cost2,
        result1,
        result2,
        cpa1,
        cpa2,
        s1,
        s2,
        mix,
        rate,
        contribution,
        children,
      });
    }
    return out;
  }

  function classifyNarrative(e, label) {
    const fmt0 = (v) => Math.round(v).toLocaleString();
    const fmtPct = (v) => (v * 100).toFixed(1) + "%";
    const absC = Math.abs(e.contribution) || 1e-9;
    const dualEffect =
      Math.abs(e.mix) >= 0.2 * absC && Math.abs(e.rate) >= 0.2 * absC;
    const leadMix = Math.abs(e.mix) >= Math.abs(e.rate);
    const mixWorse = e.mix >= 0;
    const rateWorse = e.rate >= 0;
    const mixText = mixWorse
      ? `<strong>${label}</strong>의 비중이 ${fmtPct(e.s1)}→${fmtPct(e.s2)}로 늘었고 평균보다 비싼 편(CPA ${fmt0(e.cpa2)}원)이라 전체를 <strong style="color:#f87171;">+${fmt0(e.mix)}원</strong> 끌어올림`
      : `<strong>${label}</strong>의 비중이 ${fmtPct(e.s1)}→${fmtPct(e.s2)}로 ${e.s2 >= e.s1 ? "늘었고" : "줄었고"} 평균보다 저렴해 전체를 <strong style="color:#22c55e;">${fmt0(e.mix)}원</strong> 끌어내림`;
    const rateText = rateWorse
      ? `<strong>${label}</strong> 자체의 CPA가 ${fmt0(e.cpa1)}→${fmt0(e.cpa2)}원으로 상승해 전체를 <strong style="color:#f87171;">+${fmt0(e.rate)}원</strong> 끌어올림(소재 피로/경쟁 심화 가능성)`
      : `<strong>${label}</strong> 자체의 CPA가 ${fmt0(e.cpa1)}→${fmt0(e.cpa2)}원으로 개선돼 전체를 <strong style="color:#22c55e;">${fmt0(e.rate)}원</strong> 끌어내림`;
    if (dualEffect)
      return `${mixText}. 동시에 ${rateText.replace(/<strong>.*?<\/strong>\s*/, "")}`;
    return leadMix ? mixText : rateText;
  }

  return {
    aggregate,
    applyNoiseGuard,
    decompose,
    classifyNarrative,
    decomposeFinest,
    rollup,
    decomposeLayer,
  };
})();
