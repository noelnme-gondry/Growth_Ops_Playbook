// 5-21 PVM 도구 전용 순수 헬퍼 — index.html pvmGenerateDiagnosis / downloadPvmCsv 이식.
// 살아있는 스프레드시트 수식 CSV(§7 CRLF+BOM+q() 이스케이프) + 진단 문구 생성.
// 순수 함수(사이드이펙트 없음) — 단위 테스트 대상.

// 진단(💡) 문구 — index.html pvmGenerateDiagnosis 이식.
// level: "channel" | "campaign" | "creative".
export function pvmGenerateDiagnosis(e, level, fmtMoney) {
  const fmt = (val) => {
    const s = fmtMoney(Math.abs(val));
    return val >= 0 ? `+${s}` : `-${s}`;
  };

  const mixVal = e.mix;
  const rateVal = e.rate;

  if (level === "creative") {
    return `소재 단위 최하위 레벨입니다. 이 소재의 예산 비중 변화(믹스 효과: ${fmt(mixVal)})와 단가 자체의 변동(레이트 효과: ${fmt(rateVal)})이 합산되어 최종 CPA에 ${fmt(e.contribution)}만큼 영향을 주었습니다.`;
  }

  const subMix = level === "channel" ? e.cmpSumMix || 0 : e.creativeSumMix || 0;

  let diagnosis = "";
  if (mixVal < 0 && subMix > 0) {
    diagnosis = `이 ${level === "channel" ? "채널" : "캠페인"}의 예산 비중을 줄인 전략(순수 이동 효과: ${fmt(mixVal)})은 매우 훌륭했습니다. 하지만 내부 하위 세그먼트에서 단가가 비싼 항목으로 예산이 쏠리는 배달 사고(하위 세그먼트합 믹스: ${fmt(subMix)})가 발생해 성과를 저해하고 있습니다. 하위 레벨 탭을 확인하여 비효율 항목의 예산을 줄이거나 OFF 하세요.`;
  } else if (mixVal > 0 && subMix < 0) {
    diagnosis = `이 ${level === "channel" ? "채널" : "캠페인"}에 예산을 더 배분한 결정(순수 이동 효과: ${fmt(mixVal)})은 일시적으로 CPA 상승 요인이 되었으나, 내부 하위 세그먼트 단위에서 단가가 저렴한 효율적 항목 위주로 유입을 집중시키는 최적화(하위 세그먼트합 믹스: ${fmt(subMix)})가 잘 작동하고 있습니다. 향후 이 세그먼트 배분 비중을 재조정해 보세요.`;
  } else if (mixVal < 0 && subMix < 0) {
    diagnosis = `예산 배분 전략(순수 이동 효과: ${fmt(mixVal)})과 하위 세그먼트 유입 최적화(하위 세그먼트합 믹스: ${fmt(subMix)})가 양방향 모두에서 극히 효율적으로 작동했습니다. 전체 CPA가 개선되는 이상적인 상태이므로 현재의 운영 기조를 유지해 주시기 바랍니다.`;
  } else if (mixVal > 0 && subMix > 0) {
    diagnosis = `예산 배분 비중 변화(순수 이동 효과: ${fmt(mixVal)})와 하위 세그먼트 선택(하위 세그먼트합 믹스: ${fmt(subMix)}) 모두 비효율적으로 작동해 CPA 상승의 주원인이 되고 있습니다. 성과가 저조한 하위 항목들의 비중을 대폭 줄이거나 소재를 점검해야 합니다.`;
  } else {
    diagnosis = `예산 이동 및 효율이 복합적인 영향을 미치고 있습니다. 순수 이동 효과: ${fmt(mixVal)}, 하위 세그먼트합 믹스: ${fmt(subMix)}, 단가 변동(레이트 효과): ${fmt(rateVal)}를 각각 분석해 개선 기회를 도출해 보세요.`;
  }
  return diagnosis;
}

function pvmWeekBasisLabel(wb) {
  return wb === "rolling7" ? "최근 7일" : "마감주(월~일)";
}
function pvmLookbackLabel(lb) {
  return lb === 1 ? "직전주" : lb === 2 ? "2주전" : "3주전";
}

// 살아있는 스프레드시트 수식 CSV 문자열 생성 — index.html downloadPvmCsv 이식.
// c = buildPvmCache 결과. ml = 지표 라벨(CPA/CPI). 반환: BOM 포함 CSV 텍스트.
export function buildPvmResultCsv(c, ml) {
  const q = (s) => {
    s = String(s == null ? "" : s);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const r0 = Math.round;
  const r1 = (v) => (v == null || !isFinite(v) ? "" : v.toFixed(1));
  const r4 = (v) => (v == null || !isFinite(v) ? "" : v.toFixed(4));
  const lines = [];
  const push = (arr) => lines.push(arr.map(q).join(","));
  const rowNum = () => lines.length + 1; // 다음 push의 스프레드시트 행번호(1-indexed)
  const Cbar = (c.CPA1 + c.CPA2) / 2; // 전체 평균 CPA(centering 기준)
  const sumF = (col, rows) =>
    rows.length ? "=" + rows.map((r) => col + r).join("+") : "0";

  // META — 공식 정의 + 상수(Cbar, 총 result) 노출
  push(["section", "key", "value"]);
  push(["META", "지표", ml]);
  push(["META", "통화", (c.currency || "krw") === "usd" ? "USD" : "KRW"]);
  push(["META", "기준주", pvmWeekBasisLabel(c.weekBasis)]);
  push(["META", "비교기준", pvmLookbackLabel(c.lookback)]);
  push(["META", "P1", `${c.p1Range[0]}~${c.p1Range[1]}`]);
  push(["META", "P2", `${c.p2Range[0]}~${c.p2Range[1]}`]);
  push(["META", "mix 공식", "mix=(cpaBar-Cbar)*(share2-share1)"]);
  push(["META", "rate 공식", "rate=sBar*(cpa2-cpa1)"]);
  push(["META", "Cbar(전체평균CPA)", r1(Cbar)]);
  push(["META", "총 result1(P1)", r0(c.Result1)]);
  push(["META", "총 result2(P2)", r0(c.Result2)]);
  lines.push("");

  // SCORECARD — delta는 수식
  push(["section", "metric", "P1", "P2", "delta"]);
  {
    const r = rowNum();
    push(["SCORECARD", "Cost", r0(c.Cost1), r0(c.Cost2), `=D${r}-C${r}`]);
  }
  {
    const r = rowNum();
    push(["SCORECARD", ml, r1(c.CPA1), r1(c.CPA2), `=D${r}-C${r}`]);
  }
  lines.push("");

  // 엔티티 공통 헤더(CREATIVE_FULL/CHANNEL/CAMPAIGN 공유, 컬럼 A~T 고정)
  push([
    "section", "channel", "campaign", "creative", "url",
    "cost1", "cost2", "result1", "result2",
    "cpa1", "cpa2", "share1", "share2",
    "cpaBar", "Cbar", "sBar", "mix_macro", "mix_within", "rate", "impact",
  ]);

  // CREATIVE_FULL(최소 grain) — mix/rate/impact 살아있는 수식, 컴포넌트 모두 노출
  const chRows = new Map();
  const cmpRows = new Map(); // 채널/(채널│캠페인) → 소속 소재 행번호
  [...c.finest]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .forEach((f) => {
      const r = rowNum();
      const url = c.crUrlMap ? c.crUrlMap.get(f.crKey) || "" : "";
      push([
        "CREATIVE_FULL", f.chKey, f.cmpKey || "", f.crKey || "", url,
        r0(f.cost1), r0(f.cost2), r0(f.result1), r0(f.result2),
        r1(f.cpa1), r1(f.cpa2), r4(f.s1), r4(f.s2),
        `=(J${r}+K${r})/2`, r1(Cbar), `=(L${r}+M${r})/2`,
        `=(N${r}-O${r})*(M${r}-L${r})`, "0", `=P${r}*(K${r}-J${r})`,
        `=Q${r}+R${r}+S${r}`,
      ]);
      if (!chRows.has(f.chKey)) chRows.set(f.chKey, []);
      chRows.get(f.chKey).push(r);
      const ck = `${f.chKey}│${f.cmpKey ?? ""}`;
      if (!cmpRows.has(ck)) cmpRows.set(ck, []);
      cmpRows.get(ck).push(r);
    });
  lines.push("");

  // CAMPAIGN(캠페인 매핑 시)
  const cmpRowNums = new Map(); // channel -> campaign row numbers
  if (c.campaignMapped) {
    const sortedCmp = [...c.layer2].sort(
      (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
    );
    sortedCmp.forEach((e) => {
      const r = rowNum();
      const ck = `${e.chKey}│${e.cmpKey ?? ""}`;
      const childCreatives = cmpRows.get(ck) || [];
      push([
        "CAMPAIGN", e.chKey, e.cmpKey || "", "", "",
        sumF("F", childCreatives), sumF("G", childCreatives),
        sumF("H", childCreatives), sumF("I", childCreatives),
        `=F${r}/H${r}`, `=G${r}/I${r}`,
        `=H${r}/${r0(c.Result1)}`, `=I${r}/${r0(c.Result2)}`,
        `=(J${r}+K${r})/2`, r1(Cbar), `=(L${r}+M${r})/2`,
        `=(N${r}-O${r})*(M${r}-L${r})`,
        `=${sumF("Q", childCreatives)}-Q${r}`,
        `=P${r}*(K${r}-J${r})`, `=Q${r}+R${r}+S${r}`,
      ]);
      if (!cmpRowNums.has(e.chKey)) cmpRowNums.set(e.chKey, []);
      cmpRowNums.get(e.chKey).push(r);
    });
    lines.push("");
  }

  // CHANNEL(rollup = 하위 소재 합)
  const sortedCh = [...c.layer1].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );
  sortedCh.forEach((e) => {
    const r = rowNum();
    const childCreatives = chRows.get(e.key) || [];
    const childCampaigns = cmpRowNums.get(e.key) || [];
    const mixWithinFormula =
      c.campaignMapped && childCampaigns.length
        ? `=${sumF("Q", childCampaigns)}+${sumF("R", childCampaigns)}-Q${r}`
        : "0";
    push([
      "CHANNEL", e.key, "", "", "",
      sumF("F", childCreatives), sumF("G", childCreatives),
      sumF("H", childCreatives), sumF("I", childCreatives),
      `=F${r}/H${r}`, `=G${r}/I${r}`,
      `=H${r}/${r0(c.Result1)}`, `=I${r}/${r0(c.Result2)}`,
      `=(J${r}+K${r})/2`, r1(Cbar), `=(L${r}+M${r})/2`,
      `=(N${r}-O${r})*(M${r}-L${r})`, mixWithinFormula,
      `=P${r}*(K${r}-J${r})`, `=Q${r}+R${r}+S${r}`,
    ]);
  });

  return "﻿" + lines.join("\r\n");
}
