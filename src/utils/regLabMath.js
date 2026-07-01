import { REG_STATS, REG_TRANSFORMS } from "./regMath.js";
import { seededNoise } from "./testFixtures.js";

            export const REG_LAB_STATE = {
              fileName: null,
              rows: [],
              headers: [],
              map: {},
              lambda: 0.6,
              groupKeep: null,
              groupCol: null,
              fit: null,
              // 미래 예측(§7) 상태: horizon·밴드·계절성 토글 + 변수별 미래스펙 + OS 모드
              fc: {
                horizon: 13,
                band: "mean",
                season: true,
                spec: {}, // { [col]: {value} (연속) | {off} (이벤트) }
                osMode: "split", // split=OS별 분리 모델 | pool=전체 풀링
                osPick: null, // split 모드에서 보고 있는 OS 값
              },
            };

            export const REG_CACHE = { key: null };

            export const _REG_ROLES = [
              "ignore",
              "dependent",
              "cost",
              "event",
              "step",
              "time"
            ];

            export function regLabGuess(col, rows) {
              const name = String(col).toLowerCase();
              let tag = "both";
              if (name.includes("android")) tag = "android";
              else if (name.includes("ios")) tag = "ios";

              const vals = rows
                .map((r) => r[col])
                .filter((v) => v != null && v !== "");
              const nums = vals.filter((v) => typeof v === "number");
              const isNum = nums.length >= vals.length * 0.8 && vals.length > 0;
              const uniq = [...new Set(nums)];
              const isBin =
                isNum && uniq.every((v) => v === 0 || v === 1) && uniq.length <= 2;

              let role = "ignore";
              let tf = "none";
              if (isBin) {
                // 한번 켜지면 유지되는 연속 상태(종료·출시·전환 등)는 step, 단발성은 event.
                role = /sunset|종료|중단|launch|출시|시작|전환|상태|step|on_?off|폐지|단종/.test(
                  name,
                )
                  ? "step"
                  : "event";
              } else if (/date|day|week|월|일자|주차/.test(name)) {
                role = "time";
              } else if (/(^|_)regs?($|_)|react|conv|install|signup|purchase|pur|revenue|매출|등록|재활성/.test(name) && isNum) {
                role = "dependent";
              } else if (isNum && /cost|spend|비용|지출|budget|imp|click/.test(name)) {
                role = "cost";
                tf = "adstock_log";
              } else if (isNum) {
                role = "cost";
                tf = "adstock_log";
              }
              return { role, tf, tag };
            }

            export function regLabLoad(rows, headers) {
              const valid = rows.filter((r) =>
                headers.some((f) => r[f] != null && r[f] !== ""),
              );
              REG_LAB_STATE.fileName = REG_LAB_STATE.fileName || "uploaded.csv";
              REG_LAB_STATE.rows = valid;
              REG_LAB_STATE.headers = headers;
              REG_LAB_STATE.map = {};
              headers.forEach((c) => (REG_LAB_STATE.map[c] = regLabGuess(c, valid)));
              REG_LAB_STATE.groupKeep = null;
              REG_LAB_STATE.groupCol = null;
              REG_LAB_STATE.fits = null;
              REG_CACHE.key = null;
            }

            // MMM colMap → 범용회귀 역할 번역 브리지(index regLabFromMmm 이식). 채널→cost(adstock_log),
            // 더미→event, step→step, week/date→time, 활성 타깃(reg/react)→dependent, 나머지→ignore.
            // v2 map 포맷 {role,tf,tag} 유지(tag는 컬럼명에서 ios/android 추정).
            export function regLabFromMmm(rows, headers, colMap, target) {
              if (!rows || !rows.length || !headers || !headers.length) return false;
              const tagOf = (h) => {
                const n = String(h).toLowerCase();
                if (n.includes("android") || n.includes("aos")) return "android";
                if (/\bios\b/.test(n) || n.includes("iphone") || n.includes("ipad")) return "ios";
                return "both";
              };
              REG_LAB_STATE.fileName = (REG_LAB_STATE.fileName || "mmm_data.csv");
              REG_LAB_STATE.rows = rows.slice();
              REG_LAB_STATE.headers = headers.slice();
              REG_LAB_STATE.map = {};
              headers.forEach((h) => {
                const role = (colMap[h] || {}).role;
                let def = { role: "ignore", tf: "none", tag: tagOf(h) };
                if (role === "reg" || role === "react") {
                  const isTarget = (role === "reg" && target === "Regs") || (role === "react" && target === "React");
                  def = { role: isTarget ? "dependent" : "ignore", tf: "none", tag: tagOf(h) };
                } else if (role === "channel") {
                  def = { role: "cost", tf: "adstock_log", tag: tagOf(h) };
                } else if (role === "dummy") {
                  def = { role: "event", tf: "none", tag: tagOf(h) };
                } else if (role === "step") {
                  def = { role: "step", tf: "none", tag: tagOf(h) };
                } else if (role === "week" || role === "date") {
                  def = { role: "time", tf: "none", tag: tagOf(h) };
                }
                REG_LAB_STATE.map[h] = def;
              });
              REG_LAB_STATE.groupKeep = null;
              REG_LAB_STATE.groupCol = null;
              REG_LAB_STATE.fits = null;
              REG_CACHE.key = null;
              return true;
            }

            export function regLabMakeSample() {
              // OS별 종속변수 데모(#206 멀티모델 시연): regs_ios·regs_android 태그별 모델 + iOS 전용 Step.
              const fields = [
                "week",
                "cost_google",
                "cost_meta",
                "cost_tiktok",
                "is_holiday",
                "ios_sunset",
                "regs_ios",
                "regs_android",
              ];
              const rows = [],
                rng = seededNoise(20250610);
              for (let w = 0; w < 60; w++) {
                const g = Math.max(0, 12000 + 3000 * Math.sin(w / 6) + rng() * 4000);
                const me = Math.max(0, 8000 + 2500 * Math.cos(w / 5) + rng() * 3000);
                const tt = Math.max(
                  0,
                  w > 20 ? 5000 + 1500 * Math.sin(w / 4) + rng() * 2000 : 0,
                );
                const hol = w % 13 === 0 ? 1 : 0;
                // 연속적 상태(Step): iOS 캠페인 종료 — w≥40부터 1로 켜진 뒤 유지(누적). iOS 가입만 깎음.
                const iosSunset = w >= 40 ? 1 : 0;
                const reg = (base, sunsetEff) =>
                  Math.round(
                    base -
                      3 * w +
                      120 * Math.log1p(g) +
                      90 * Math.log1p(me) +
                      60 * Math.log1p(tt) +
                      180 * hol +
                      sunsetEff * iosSunset +
                      rng() * 120,
                  );
                rows.push({
                  week: `2025-W${String(w + 1).padStart(2, "0")}`,
                  cost_google: Math.round(g),
                  cost_meta: Math.round(me),
                  cost_tiktok: Math.round(tt),
                  is_holiday: hol,
                  ios_sunset: iosSunset,
                  regs_ios: reg(900, -500), // iOS: 종료 후 급감
                  regs_android: reg(1400, 0), // Android: 영향 없음
                });
              }
              return { rows, fields };
            }

            export function regLabGroupColOf() {
              return (
                REG_LAB_STATE.headers.find(
                  (c) => REG_LAB_STATE.map[c]?.role === "group",
                ) || null
              );
            }

            export function regLabReadMapping() {
              const m = {
                deps: [],
                indeps: [],
                tags: {},
                time: null,
                types: {},
                tf: {},
              };
              for (const c of REG_LAB_STATE.headers) {
                const def = REG_LAB_STATE.map[c] || {};
                const r = def.role || "ignore";

                if (r === "cost") {
                  m.indeps.push(c);
                  m.types[c] = "continuous";
                  m.tf[c] = "adstock_log";
                  m.tags[c] = def.tag || "both";
                } else if (r === "event") {
                  m.indeps.push(c);
                  m.types[c] = "binary";
                  m.tf[c] = "none";
                  m.tags[c] = def.tag || "both";
                } else if (r === "step") {
                  m.indeps.push(c);
                  m.types[c] = "binary";
                  m.tf[c] = "step";
                  m.tags[c] = def.tag || "both";
                } else if (r === "dependent") {
                  m.deps.push(c);
                  m.types[c] = "continuous";
                  m.tf[c] = "none";
                  m.tags[c] = def.tag || "both";
                } else if (r === "time") {
                  m.time = m.time || c;
                }
              }
              return m;
            }

            export function regLabSignature() {
              return JSON.stringify({
                f: REG_LAB_STATE.fileName,
                n: REG_LAB_STATE.rows.length,
                map: REG_LAB_STATE.map
              });
            }

            export function regLabRun() {
              const baseM = regLabReadMapping();
              if (baseM.deps.length === 0) throw new Error("종속변수(dependent)를 하나 이상 지정하세요.");

              let allRows = REG_LAB_STATE.rows.slice();
              REG_LAB_STATE.fits = {}; // Store models by tag (e.g. android, ios, both)
              REG_LAB_STATE.lambda = 0;

              let anyFit = false;

              baseM.deps.forEach(depCol => {
                 const depTag = baseM.tags[depCol] || "both";
                 const indepCols = baseM.indeps.filter(c => baseM.tags[c] === depTag || baseM.tags[c] === 'both');
                 if (!indepCols.length) return; // Skip if no independent variables for this target

                 // Filter valid rows for this specific model
                 const used = [depCol, ...indepCols];
                 const rows = allRows.filter((r) => used.every((c) => r[c] != null && r[c] !== "" && !isNaN(Number(r[c]))));
                 const n = rows.length, k = indepCols.length + 1;
                 if (n <= k) return; // Skip if not enough data

                 const tfOf = (c) => baseM.tf[c] || "none";
                 const rawY = rows.map((r) => Number(r[depCol]));

                 const hasAdstock = indepCols.some(c => tfOf(c) === "adstock_log");
                 let bestLam = 0.0, bestR2 = -Infinity, bestFit, bestXcols, bestY;
                 const lamCands = hasAdstock ? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] : [0];

                 for (const lam of lamCands) {
                   const tryY = rawY;
                   const tryXcols = indepCols.map((c) => REG_TRANSFORMS[tfOf(c)](rows.map((r) => Number(r[c])), lam));
                   const tryX = rows.map((_, i) => [1, ...tryXcols.map((col) => col[i])]);
                   try {
                     const fit = REG_STATS.ols(tryX, tryY);
                     if (fit.R2 > bestR2) {
                       bestR2 = fit.R2;
                       bestLam = lam;
                       bestFit = fit;
                       bestXcols = tryXcols;
                       bestY = tryY;
                     }
                   } catch(e) {}
                 }

                 if (!bestFit) return;

                 const lam = bestLam, fit = bestFit, Xcols = bestXcols, y = bestY;
                 const X = rows.map((_, i) => [1, ...Xcols.map((col) => col[i])]);
                 const vif = indepCols.map((_, j) => {
                   if (indepCols.length < 2) return 1;
                   const Xj = rows.map((_, i) => [1, ...Xcols.filter((_, jj) => jj !== j).map((col) => col[i])]);
                   const r2 = REG_STATS.r2of(Xj, Xcols[j]);
                   return isFinite(r2) && r2 < 1 ? 1 / (1 - r2) : Infinity;
                 });

                 const labelCol = baseM.time || baseM.label;
                 const labels = labelCol ? rows.map(r => r[labelCol]) : rows.map((_, i) => i + 1);

                 // Construct specific m for this model
                 const m = {
                   dep: depCol,
                   tag: depTag,
                   indep: indepCols,
                   time: baseM.time,
                   types: baseM.types,
                   tf: baseM.tf
                 };

                 REG_LAB_STATE.fits[depTag] = {
                   lam, fit, vif, terms: ["(Intercept)", ...indepCols], m, n, labels, y, rawY, Xcols, rows, k, tfOf: indepCols.map((c) => tfOf(c)), depTf: tfOf(depCol)
                 };
                 anyFit = true;
                 REG_LAB_STATE.lambda = Math.max(REG_LAB_STATE.lambda, lam); // Just a fallback global lambda
              });

              if (!anyFit) throw new Error("적합 가능한 회귀 모델이 없습니다. 독립변수가 부족하거나 표본 수가 적습니다.");
              REG_CACHE.key = regLabSignature();
              REG_LAB_STATE.fc.osPick = "sum"; // Reset default view to sum
            }

