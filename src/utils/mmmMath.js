import { CREATIVE_MATH, CREATIVE_STATS } from "./creativeMath.js";
import { CANNIBAL_STATS } from "./responseMath.js";
import { mmmOls, REG_STATS, REG_TRANSFORMS } from "./regMath.js";
import { _Z975, mmmNormCdf, chi2Cdf, studentTp, studentTcrit } from "./statPrimitives.js";
import { _mmmFmtDate } from "./regForecastMath.js";

            export const MMR_MATH = {
              // 기하 adstock: a_t = x_t + θ·a_{t-1}
              adstock(x, theta) {
                const out = new Array(x.length);
                for (let t = 0; t < x.length; t++)
                  out[t] = (Number(x[t]) || 0) + (t > 0 ? theta * out[t - 1] : 0);
                return out;
              },
              // Hill 포화: x^n / (x^n + K^n) ∈ [0,1). half=반포화점 K, slope=n. (adstocked 값에 적용)
              hill(x, half, slope) {
                half = half > 0 ? half : 1;
                slope = slope > 0 ? slope : 1;
                return x.map((v) => {
                  v = Math.max(0, v);
                  const xn = Math.pow(v, slope);
                  const kn = Math.pow(half, slope);
                  return xn + kn > 0 ? xn / (xn + kn) : 0;
                });
              },
              logSat(x) {
                return x.map((v) => Math.log1p(Math.max(0, v)));
              },
              // Fourier 특성: period(주) 기준 K쌍의 [sin,cos]. t = 0..n-1
              fourier(n, period, K) {
                const cols = [];
                for (let k = 1; k <= K; k++) {
                  const s = [],
                    c = [];
                  for (let t = 0; t < n; t++) {
                    const a = (2 * Math.PI * k * t) / period;
                    s.push(Math.sin(a));
                    c.push(Math.cos(a));
                  }
                  cols.push({ name: `sin${k}_${period}w`, col: s });
                  cols.push({ name: `cos${k}_${period}w`, col: c });
                }
                return cols;
              },
              zscore(x) {
                const m = x.reduce((a, b) => a + b, 0) / x.length;
                const sd =
                  Math.sqrt(
                    x.reduce((a, v) => a + (v - m) ** 2, 0) /
                      Math.max(1, x.length - 1),
                  ) || 1;
                return { z: x.map((v) => (v - m) / sd), mean: m, sd };
              },
            };

            export const MMR_STATS = {
              // OLS (정규방정식). X: n×p (intercept 포함), y: n. 반환 {beta, resid, fitted, XtXinv, n, p, r2, adjR2}
              ols(X, y) {
                const n = X.length,
                  p = X[0].length;
                if (n <= p) return null;
                const Xt = CREATIVE_MATH.transpose(X);
                const XtX = CREATIVE_MATH.matmul(Xt, X);
                const XtXinv = CREATIVE_MATH.inverse(XtX);
                if (!XtXinv) return null;
                const ycol = y.map((v) => [v]);
                const Xty = CREATIVE_MATH.matmul(Xt, ycol);
                const betaCol = CREATIVE_MATH.matmul(XtXinv, Xty);
                const beta = betaCol.map((r) => r[0]);
                const fitted = X.map((row) =>
                  row.reduce((s, v, j) => s + v * beta[j], 0),
                );
                const resid = y.map((v, i) => v - fitted[i]);
                const ybar = y.reduce((a, b) => a + b, 0) / n;
                const ssRes = resid.reduce((a, e) => a + e * e, 0);
                const ssTot = y.reduce((a, v) => a + (v - ybar) ** 2, 0);
                const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
                const adjR2 = 1 - ((1 - r2) * (n - 1)) / Math.max(1, n - p);
                return { beta, resid, fitted, XtXinv, n, p, r2, adjR2, ssRes };
              },
              // Newey-West HAC 표준오차 (Bartlett kernel). L 미지정 시 NW rule.
              neweyWest(X, y, L) {
                const fit = this.ols(X, y);
                if (!fit) return null;
                const { beta, resid, XtXinv, n, p } = fit;
                if (L == null)
                  L = Math.max(1, Math.floor(4 * Math.pow(n / 100, 2 / 9)));
                // meat = Σ e_t² x_t x_t' + Σ_{l=1}^L w_l Σ_{t>l} e_t e_{t-l}(x_t x_{t-l}' + x_{t-l} x_t')
                const meat = Array.from({ length: p }, () => new Array(p).fill(0));
                const addOuter = (xa, xb, scale) => {
                  for (let i = 0; i < p; i++)
                    for (let j = 0; j < p; j++) meat[i][j] += scale * xa[i] * xb[j];
                };
                for (let t = 0; t < n; t++) addOuter(X[t], X[t], resid[t] * resid[t]);
                for (let l = 1; l <= L; l++) {
                  const w = 1 - l / (L + 1);
                  for (let t = l; t < n; t++) {
                    const ee = w * resid[t] * resid[t - l];
                    addOuter(X[t], X[t - l], ee);
                    addOuter(X[t - l], X[t], ee);
                  }
                }
                // cov = XtXinv · meat · XtXinv
                const tmp = CREATIVE_MATH.matmul(XtXinv, meat);
                const cov = CREATIVE_MATH.matmul(tmp, XtXinv);
                const se = beta.map((_, j) => Math.sqrt(Math.max(0, cov[j][j])));
                const tstat = beta.map((b, j) => (se[j] > 0 ? b / se[j] : 0));
                const pval = tstat.map(
                  (t) => 2 * (1 - CREATIVE_STATS.stdNormalCdf(Math.abs(t))),
                );
                const ci95 = beta.map((b, j) => [b - 1.96 * se[j], b + 1.96 * se[j]]);
                return {
                  beta,
                  se,
                  tstat,
                  pval,
                  ci95,
                  resid,
                  r2: fit.r2,
                  adjR2: fit.adjR2,
                  n,
                  p,
                  L,
                };
              },
              durbinWatson(resid) {
                let num = 0,
                  den = 0;
                for (let t = 1; t < resid.length; t++)
                  num += (resid[t] - resid[t - 1]) ** 2;
                for (let t = 0; t < resid.length; t++) den += resid[t] * resid[t];
                return den > 0 ? num / den : null;
              },
              // Breusch-Godfrey LM 검정 (lag p). resid를 [X, lagged resid]에 회귀 → n·R² ~ chi2(p)
              breuschGodfrey(resid, X, p) {
                const n = resid.length;
                const aug = [];
                const yb = [];
                for (let t = 0; t < n; t++) {
                  const row = X[t].slice();
                  for (let l = 1; l <= p; l++)
                    row.push(t - l >= 0 ? resid[t - l] : 0);
                  aug.push(row);
                  yb.push(resid[t]);
                }
                const fit = this.ols(aug, yb);
                if (!fit) return null;
                const LM = n * fit.r2;
                const pValue = 1 - chi2Cdf(LM, p);
                return { LM, df: p, pValue };
              },
              // detrend+deseasonalize 잔차 (prewhitening): y ~ [1, t, fourier(52w,2)]
              prewhitenResiduals(y, period = 52, K = 2) {
                const n = y.length;
                const X = [];
                const f = MMR_MATH.fourier(n, period, K);
                for (let t = 0; t < n; t++) {
                  const row = [1, t];
                  for (const fc of f) row.push(fc.col[t]);
                  X.push(row);
                }
                const fit = this.ols(X, y);
                return fit ? fit.resid : y.slice();
              },
              rmse(actual, pred) {
                let s = 0,
                  c = 0;
                for (let i = 0; i < actual.length; i++)
                  if (isFinite(actual[i]) && isFinite(pred[i])) {
                    s += (actual[i] - pred[i]) ** 2;
                    c++;
                  }
                return c > 0 ? Math.sqrt(s / c) : null;
              },
              mape(actual, pred) {
                let s = 0,
                  c = 0;
                for (let i = 0; i < actual.length; i++)
                  if (actual[i] !== 0 && isFinite(actual[i]) && isFinite(pred[i])) {
                    s += Math.abs((actual[i] - pred[i]) / actual[i]);
                    c++;
                  }
                return c > 0 ? (s / c) * 100 : null;
              },
              // rolling-origin OOS: 최소 minTrain부터 1-step씩 확장, 각 fold에서 다음 점 예측 RMSE
              rollingOriginRMSE(X, y, minTrain) {
                minTrain =
                  minTrain || Math.max(X[0].length + 2, Math.floor(y.length * 0.6));
                const preds = [],
                  acts = [];
                for (let cut = minTrain; cut < y.length; cut++) {
                  const fit = this.ols(X.slice(0, cut), y.slice(0, cut));
                  if (!fit) continue;
                  const yhat = X[cut].reduce((s, v, j) => s + v * fit.beta[j], 0);
                  preds.push(yhat);
                  acts.push(y[cut]);
                }
                return {
                  rmse: this.rmse(acts, preds),
                  mape: this.mape(acts, preds),
                  folds: preds.length,
                };
              },
            };

            export function _mkScore(x) {
              let s = 0,
                n = x.length;
              for (let k = 0; k < n - 1; k++)
                for (let j = k + 1; j < n; j++) s += Math.sign(x[j] - x[k]);
              return s;
            }

            export function _mkVarS(x) {
              const n = x.length;
              const counts = new Map();
              for (const v of x) counts.set(v, (counts.get(v) || 0) + 1);
              let tie = 0;
              for (const t of counts.values())
                if (t > 1) tie += t * (t - 1) * (2 * t + 5);
              return (n * (n - 1) * (2 * n + 5) - tie) / 18;
            }

            export function _mkZ(s, varS) {
              if (varS <= 0) return 0;
              if (s > 0) return (s - 1) / Math.sqrt(varS);
              if (s < 0) return (s + 1) / Math.sqrt(varS);
              return 0;
            }

            export function _mkVerdict(z, alpha = 0.05) {
              const p = 2 * (1 - mmmNormCdf(Math.abs(z)));
              const crit = alpha === 0.05 ? _Z975 : 1 - mmmNormCdf(0); // alpha=0.05 고정
              const h = Math.abs(z) > crit;
              const trend =
                z < 0 && h ? "decreasing" : z > 0 && h ? "increasing" : "no trend";
              return { p, h, trend };
            }

            export function _theilSen(x) {
              const n = x.length,
                sl = [];
              for (let i = 0; i < n - 1; i++)
                for (let j = i + 1; j < n; j++) sl.push((x[j] - x[i]) / (j - i));
              sl.sort((a, b) => a - b);
              const m = Math.floor(sl.length / 2);
              return sl.length % 2 ? sl[m] : (sl[m - 1] + sl[m]) / 2;
            }

            export function _rankAvg(x) {
              const n = x.length,
                idx = x.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
              const ranks = new Array(n);
              let i = 0;
              while (i < n) {
                let j = i;
                while (j < n - 1 && idx[j + 1][0] === idx[i][0]) j++;
                const r = (i + j) / 2 + 1;
                for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
                i = j + 1;
              }
              return ranks;
            }

            export function _mmmAcf(x, nlags) {
              const n = x.length,
                m = x.reduce((a, b) => a + b, 0) / n,
                y = x.map((v) => v - m);
              let c0 = 0;
              for (let t = 0; t < n; t++) c0 += y[t] * y[t];
              const out = [1];
              for (let k = 1; k <= nlags; k++) {
                let s = 0;
                for (let t = k; t < n; t++) s += y[t] * y[t - k];
                out.push(c0 > 0 ? s / c0 : 0);
              }
              return out;
            }

            export function mkOriginal(x) {
              const s = _mkScore(x),
                varS = _mkVarS(x),
                z = _mkZ(s, varS),
                v = _mkVerdict(z);
              return {
                trend: v.trend,
                h: v.h,
                p: v.p,
                z,
                tau: s / (0.5 * x.length * (x.length - 1)),
                s,
                varS,
                slope: _theilSen(x),
              };
            }

            export function mkHamedRao(x, alpha = 0.05, lag = null) {
              const n = x.length,
                s = _mkScore(x);
              let varS = _mkVarS(x);
              const L = lag == null ? n : lag + 1;
              const slope = _theilSen(x);
              const xdet = x.map((v, i) => v - (i + 1) * slope);
              const I = _rankAvg(xdet);
              const acf = _mmmAcf(I, L - 1);
              const interval = _Z975 / Math.sqrt(n); // alpha=0.05
              let sni = 0;
              for (let i = 1; i < L; i++) {
                if (!(acf[i] <= interval && acf[i] >= -interval))
                  sni += (n - i) * (n - i - 1) * (n - i - 2) * acf[i];
              }
              const nns = 1 + (2 / (n * (n - 1) * (n - 2))) * sni;
              varS *= nns;
              const z = _mkZ(s, varS),
                v = _mkVerdict(z, alpha);
              return {
                trend: v.trend,
                h: v.h,
                p: v.p,
                z,
                tau: s / (0.5 * n * (n - 1)),
                s,
                varS,
                slope,
              };
            }

            export function mkSeasonal(x, period) {
              // pad NaN to multiple of period, column = same season; sum S,var over columns
              let s = 0,
                varS = 0;
              for (let col = 0; col < period; col++) {
                const series = [];
                for (let i = col; i < x.length; i += period) series.push(x[i]);
                if (series.length < 2) continue;
                s += _mkScore(series);
                varS += _mkVarS(series);
              }
              const z = _mkZ(s, varS),
                v = _mkVerdict(z);
              return { trend: v.trend, h: v.h, p: v.p, z, s, varS };
            }

            export function _mackinnonpCT(stat) {
              const TAU_MAX = 0.7,
                TAU_MIN = -16.18,
                TAU_STAR = -2.89;
              const SMALL = [3.2512, 1.6047, 0.049588],
                LARGE = [2.5261, 0.61654, -0.37956, -0.060285];
              if (stat > TAU_MAX) return 1.0;
              if (stat < TAU_MIN) return 0.0;
              const coef = stat <= TAU_STAR ? SMALL : LARGE;
              let val = 0;
              for (let i = 0; i < coef.length; i++)
                val += coef[i] * Math.pow(stat, i);
              return mmmNormCdf(val);
            }

            export function adfCT(x) {
              const n0 = x.length;
              let maxlag = Math.ceil(12 * Math.pow(n0 / 100, 0.25));
              maxlag = Math.min(Math.floor(n0 / 2) - 2 - 1, maxlag);
              if (maxlag < 0) maxlag = 0;
              const xdiff = [];
              for (let i = 1; i < n0; i++) xdiff.push(x[i] - x[i - 1]);
              const nd = xdiff.length,
                nobs = nd - maxlag;
              if (nobs < 5) return { stat: NaN, p: NaN, usedlag: 0, nobs };
              const xdshort = [],
                level = [],
                dlags = [];
              for (let k = 1; k <= maxlag; k++) dlags.push([]);
              for (let r = 0; r < nobs; r++) {
                xdshort.push(xdiff[maxlag + r]);
                level.push(x[n0 - nobs - 1 + r]);
                for (let k = 1; k <= maxlag; k++)
                  dlags[k - 1].push(xdiff[maxlag + r - k]);
              }
              const design = (j) => {
                const X = [];
                for (let r = 0; r < nobs; r++) {
                  const row = [1, r + 1, level[r]];
                  for (let k = 0; k < j; k++) row.push(dlags[k][r]);
                  X.push(row);
                }
                return X;
              };
              let best = { aic: Infinity, j: 0 };
              for (let j = 0; j <= maxlag; j++) {
                const f = mmmOls(design(j), xdshort);
                if (f && f.aic < best.aic) best = { aic: f.aic, j };
              }
              const f = mmmOls(design(best.j), xdshort);
              const stat = f.tvalues[2];
              return { stat, p: _mackinnonpCT(stat), usedlag: best.j, nobs };
            }

            export function _kpssAutolag(e, n) {
              const covlags = Math.floor(Math.pow(n, 2 / 9));
              let s0 = 0;
              for (let i = 0; i < n; i++) s0 += e[i] * e[i];
              s0 /= n;
              let s1 = 0;
              for (let i = 1; i <= covlags; i++) {
                let prod = 0;
                for (let t = i; t < n; t++) prod += e[t] * e[t - i];
                prod /= n / 2;
                s0 += prod;
                s1 += i * prod;
              }
              const shat = s1 / s0,
                pwr = 1 / 3;
              return Math.floor(
                1.1447 * Math.pow(shat * shat, pwr) * Math.pow(n, pwr),
              );
            }

            export function kpssCT(x) {
              const n = x.length;
              const X = x.map((_, i) => [1, i + 1]);
              const f = mmmOls(X, x),
                e = f.resid;
              const crit = [0.119, 0.146, 0.176, 0.216],
                pv = [0.1, 0.05, 0.025, 0.01];
              let nlags = _kpssAutolag(e, n);
              nlags = Math.min(nlags, n - 1);
              let cs = 0,
                eta = 0;
              for (let i = 0; i < n; i++) {
                cs += e[i];
                eta += cs * cs;
              }
              eta /= n * n;
              let sh = 0;
              for (let i = 0; i < n; i++) sh += e[i] * e[i];
              for (let i = 1; i <= nlags; i++) {
                let prod = 0;
                for (let t = i; t < n; t++) prod += e[t] * e[t - i];
                sh += 2 * prod * (1 - i / (nlags + 1));
              }
              sh /= n;
              const stat = eta / sh;
              // np.interp(stat, crit(asc), pv(desc)) — 범위 밖 클램프
              let p;
              if (stat <= crit[0]) p = pv[0];
              else if (stat >= crit[crit.length - 1]) p = pv[pv.length - 1];
              else {
                for (let i = 1; i < crit.length; i++) {
                  if (stat <= crit[i]) {
                    const f2 = (stat - crit[i - 1]) / (crit[i] - crit[i - 1]);
                    p = pv[i - 1] + f2 * (pv[i] - pv[i - 1]);
                    break;
                  }
                }
              }
              return { stat, p, nlags };
            }

            export function ljungBox(resid, lags) {
              const n = resid.length,
                acf = _mmmAcf(resid, lags);
              let Q = 0;
              for (let k = 1; k <= lags; k++) Q += (acf[k] * acf[k]) / (n - k);
              Q *= n * (n + 2);
              return { Q, df: lags, p: 1 - chi2Cdf(Q, lags) };
            }

            export function _yuleWalker1(e) {
              // adjusted, demean
              const n = e.length,
                m = e.reduce((a, b) => a + b, 0) / n,
                y = e.map((v) => v - m);
              let r0 = 0;
              for (let t = 0; t < n; t++) r0 += y[t] * y[t];
              r0 /= n;
              let r1 = 0;
              for (let t = 0; t < n - 1; t++) r1 += y[t] * y[t + 1];
              r1 /= n - 1;
              return r0 > 0 ? r1 / r0 : 0;
            }

            export function fitAR1(X, y, maxiter = 10) {
              let f = mmmOls(X, y);
              if (!f) return null;
              let rho = _yuleWalker1(f.resid),
                beta = f.beta;
              let last = null;
              for (let it = 0; it < maxiter; it++) {
                const n = X.length,
                  k = X[0].length;
                const Xw = [],
                  yw = [];
                for (let t = 1; t < n; t++) {
                  yw.push(y[t] - rho * y[t - 1]);
                  Xw.push(X[t].map((v, j) => v - rho * X[t - 1][j]));
                }
                const fw = mmmOls(Xw, yw);
                if (!fw) break;
                last = fw;
                beta = fw.beta;
                // 원공간 잔차로 rho 재추정
                const resid = y.map(
                  (v, i) => v - X[i].reduce((s, xv, j) => s + xv * beta[j], 0),
                );
                const newRho = _yuleWalker1(resid);
                if (Math.abs(newRho - rho) < 1e-6) {
                  rho = newRho;
                  break;
                }
                rho = newRho;
              }
              if (!last) return null;
              const df = last.n - last.k,
                tcrit = studentTcrit(0.95, df);
              return {
                beta: last.beta,
                se: last.se,
                rho,
                df,
                tvalues: last.tvalues,
                pval: last.tvalues.map((t) => studentTp(t, df)),
                ci95: last.beta.map((b, j) => [
                  b - tcrit * last.se[j],
                  b + tcrit * last.se[j],
                ]),
                resid: last.resid,
              };
            }

            export function shapleyR2Exact(y, groups, X) {
              // groups: [{name, cols:[colIdx...]}], X: design (no intercept)
              const G = groups.length;
              const memo = new Map();
              const r2OfMask = (mask) => {
                if (memo.has(mask)) return memo.get(mask);
                const cols = [];
                for (let g = 0; g < G; g++)
                  if (mask & (1 << g)) cols.push(...groups[g].cols);
                let r2;
                if (!cols.length) r2 = 0;
                else {
                  const D = X.map((row) => [1, ...cols.map((c) => row[c])]);
                  const f = mmmOls(D, y);
                  r2 = f ? f.r2 : 0;
                }
                memo.set(mask, r2);
                return r2;
              };
              // factorial 가중
              const fact = [1];
              for (let i = 1; i <= G; i++) fact.push(fact[i - 1] * i);
              const shares = new Array(G).fill(0);
              for (let g = 0; g < G; g++) {
                const others = [...Array(G).keys()].filter((i) => i !== g);
                const M = others.length;
                for (let sub = 0; sub < 1 << M; sub++) {
                  let mask = 0,
                    sz = 0;
                  for (let b = 0; b < M; b++)
                    if (sub & (1 << b)) {
                      mask |= 1 << others[b];
                      sz++;
                    }
                  const w = (fact[sz] * fact[G - sz - 1]) / fact[G];
                  shares[g] += w * (r2OfMask(mask | (1 << g)) - r2OfMask(mask));
                }
              }
              const total = r2OfMask((1 << G) - 1);
              const sum = shares.reduce((a, b) => a + b, 0);
              const rows = groups
                .map((gr, g) => ({
                  driver: gr.name,
                  r2_share: shares[g],
                  pct: sum > 0 ? (shares[g] / sum) * 100 : 0,
                }))
                .sort((a, b) => b.r2_share - a.r2_share);
              return { rows, total };
            }

            export function stlWeekly(values, period = 52, iters = 2) {
              const n = values.length,
                ts = Array.from({ length: n }, (_, i) => i);
              const trendBw = Math.min(0.95, Math.max(0.15, (1.5 * period) / n));
              let trend = new Array(n).fill(0),
                seasonal = new Array(n).fill(0);
              for (let it = 0; it < iters; it++) {
                const detr = values.map((v, i) =>
                  Number.isFinite(trend[i]) ? v - trend[i] : v,
                );
                const seas = new Array(n).fill(0);
                for (let ph = 0; ph < period; ph++) {
                  const idx = [],
                    ys = [];
                  for (let i = ph; i < n; i += period) {
                    if (Number.isFinite(detr[i])) {
                      idx.push(i);
                      ys.push(detr[i]);
                    }
                  }
                  if (!idx.length) continue;
                  if (idx.length < 4) {
                    const m = ys.reduce((a, b) => a + b, 0) / ys.length;
                    for (const i of idx) seas[i] = m;
                  } else {
                    const sm = CANNIBAL_STATS.loess(idx, ys, { bandwidth: 0.75 });
                    for (let j = 0; j < idx.length; j++)
                      seas[idx[j]] = Number.isFinite(sm[j]) ? sm[j] : ys[j];
                  }
                }
                const fin = seas.filter(Number.isFinite),
                  sm0 = fin.reduce((a, b) => a + b, 0) / Math.max(1, fin.length);
                for (let i = 0; i < n; i++) seasonal[i] = (seas[i] || 0) - sm0;
                const deseason = values.map((v, i) => v - seasonal[i]);
                trend = CANNIBAL_STATS.loess(ts, deseason, { bandwidth: trendBw });
              }
              const residual = values.map((v, i) =>
                Number.isFinite(trend[i]) ? v - trend[i] - seasonal[i] : NaN,
              );
              return { trend, seasonal, residual };
            }

            export const MMM_STATS = {
              mmmOls,
              mkOriginal,
              mkHamedRao,
              mkSeasonal,
              adfCT,
              kpssCT,
              ljungBox,
              fitAR1,
              shapleyR2Exact,
              stlWeekly,
              normCdf: mmmNormCdf,
              studentTp,
              studentTcrit,
              theilSen: _theilSen,
            };

            export const MMM_METH_CONFIG = {
              version: "1.0.0",
              seasonalityPeriods: [52.18, 13.04], // annual + quarterly (각 sin+cos pair)
              adstockGrid: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
              cvMinTrain: 40,
              defaultLam: 0.6, // cannibalization net elasticity용
              lunarWeeks: {
                seollal: [5, 6, 56, 57, 111, 112],
                chuseok: [38, 39, 92, 93],
              },
              steps: { post_step: 42, line_off: 55 }, // 영구 step (week>=from_week)
              foldIntoRegime: ["google_cbua"], // 구조변화와 공선 → 레짐 흡수, 단독해석 금지
              combinedGoogle: ["google_roi", "google_cbua"], // G_Total (sheet/precedence/detrend)
              vifThreshold: 10,
              sparseMinWeeks: 20, // 비-0 주가 이 미만이면 "데이터 부족" (계수 신뢰 불가)
              excludeSparse: false, // ON 시 데이터 부족 채널을 모델에서 제외 (식별 정리; 기본 off=충실)
              hacAutoLag: (n) => Math.floor(4 * Math.pow(n / 100, 2 / 9)),
            };

            export const MMM_CANNIB_RULES = {
              lowSpendPct: 0.25, // ① 저지출 구간 = 채널 spend ≤ p25
              precMinN: 6, // ① 저지출 구간 최소 표본
              precDeclinePct: 10, // ① FOR: 누적 하락 ≥ 10%
              precSlopeP: 0.05, // ① slope 유의 임계 (FOR=유의 하락 / AGAINST=유의 상승)
              detrendFor: -0.1, // ② FOR: detrended r ≥ -0.10 AND 1차차분 r ≥ -0.10
              detrendAgainst: -0.2, // ② AGAINST: detrended r ≤ -0.20 OR 1차차분 r ≤ -0.20
              netP: 0.05, // ③ 유의 임계
              netMaterial: 0.05, // ③ FOR(대안): 95%CI 하한 > -material 이면 의미있는 카니발 배제
              gateVif: 5, // 게이트: VIF ≥ 5
              gateSpendTimeCorr: 0.7, // 게이트: |corr(ln_spend, t)| ≥ 0.7
              gateCiMult: 3, // 게이트: ③ CI폭 ≥ 3×|점추정|
              gateMinN: 30, // 게이트: n < 30
              brandBarFor: 3, // 브랜드 가로채기 채널: FOR=3 AND AGAINST=0 일 때만 잠정 OK
              otherBarFor: 2, // 그 외(prospecting): FOR≥2 AND AGAINST=0
              brandInterceptRe:
                /brand|branded|asa\b|apple.?search|search.?ads|브랜드|검색/i,
            };

            export function mmmIsBrandIntercept(label, kind) {
              return (
                kind === "brand" ||
                MMM_CANNIB_RULES.brandInterceptRe.test(String(label || ""))
              );
            }

            export const MMM_CHANNELS = [
              { key: "google_roi", field: "ch_google_roi", label: "Google ROI" },
              { key: "google_cbua", field: "ch_google_cbua", label: "Google CBUA" },
              { key: "meta", field: "ch_meta", label: "Meta" },
              { key: "tiktok", field: "ch_tiktok", label: "TikTok" },
              { key: "brand", field: "ch_brand", label: "Brand" },
            ];

            export function _mmmChans(panel) {
              const raw = panel.channels
                ? panel.channels
                : MMM_CHANNELS.filter((ch) => panel.ch[ch.key]).map((ch) => ({
                    key: ch.key,
                    label: ch.label,
                    kind: ch.key === "brand" ? "brand" : "perf",
                  }));
              // 키 중복 제거 (colMap 태그모드에서 같은 채널이 두 번 들어오면 표·effects가 중복 렌더되는 버그 방지)
              const seen = new Set(),
                out = [];
              for (const ch of raw) {
                if (seen.has(ch.key)) continue;
                seen.add(ch.key);
                out.push(ch);
              }
              return out;
            }

            export function mmmAdstock(x, lam) {
              const o = [];
              for (let i = 0; i < x.length; i++)
                o.push((isNaN(x[i]) ? 0 : x[i]) + (i > 0 ? lam * o[i - 1] : 0));
              return o;
            }

            export function mmmLnMedia(raw, lam) {
              const missing = raw.map((v) => isNaN(v) || v == null);
              const series = mmmAdstock(
                raw.map((v, i) => (missing[i] ? 0 : v)),
                lam,
              ).map((v) => Math.log1p(v));
              const active = raw
                .map((v, i) => (!missing[i] && v > 0 ? i : -1))
                .filter((i) => i >= 0);
              if (missing.some((x) => x) && active.length > 6) {
                const last8 = active.slice(-8).map((i) => series[i]);
                const fill = last8.reduce((a, b) => a + b, 0) / last8.length;
                return series.map((v, i) => (missing[i] ? fill : v));
              }
              return series;
            }

            export function _mean(a) {
              return a.reduce((x, y) => x + y, 0) / a.length;
            }

            export function _pstd(a) {
              const m = _mean(a);
              return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
            }

            export function mmmChannelCoverage(panel, cfg) {
              const out = {};
              for (const ch of _mmmChans(panel)) {
                if (!panel.ch[ch.key]) continue;
                const arr = panel.ch[ch.key];
                const nonzero = arr.filter((v) => v > 0 && isFinite(v)).length;
                const trailingZero = arr.length > 8 && arr.slice(-8).every((v) => !v);
                out[ch.key] = {
                  label: ch.label,
                  nonzero,
                  total: arr.length,
                  coverage: nonzero / arr.length,
                  trailingZero,
                  sparse: nonzero < (cfg.sparseMinWeeks || 20),
                };
              }
              return out;
            }

            export function mmmSparseChannels(panel, cfg) {
              const cov = mmmChannelCoverage(panel, cfg),
                s = new Set();
              for (const k in cov) if (cov[k].sparse) s.add(k);
              return s;
            }

            export function _mmmStepSeries(panel, cfg) {
              if (panel.steps && Object.keys(panel.steps).length) return panel.steps; // 사용자 매핑 step 컬럼 (week-threshold 가정 대체)
              const s = {};
              for (const [nm, fw] of Object.entries(cfg.steps || {}))
                s[nm] = panel.week.map((tt) => (tt >= fw ? 1 : 0));
              return s;
            }

            export function mmmBuildFeatures(panel, cfg, lam, withTrend = true) {
              const t = panel.week,
                n = t.length,
                cols = [],
                names = [];
              const push = (nm, arr) => {
                names.push(nm);
                cols.push(arr);
              };
              cfg.seasonalityPeriods.forEach((P, i) => {
                push(
                  `sin_${i}`,
                  t.map((tt) => Math.sin((2 * Math.PI * tt) / P)),
                );
                push(
                  `cos_${i}`,
                  t.map((tt) => Math.cos((2 * Math.PI * tt) / P)),
                );
              });
              // 흡수(공선) 집합: cfg.absorbed = 다중공선으로 제거할 컬럼 키(채널 key 또는 step 이름). 기본은 step 흡수(캠페인 유지).
              const absorbed = cfg.absorbed || new Set(cfg.foldIntoRegime || []);
              // 휴일/이벤트: 사용자가 매핑한 더미(panel.useDummies)가 있으면 그것을 모델에 포함(실제 이벤트 신호 — liveness 등).
              // 없으면 도구 기본 cfg.lunarWeeks(주차번호 가정). → legacy/골든 패널(useDummies 미설정)은 byte-동일.
              if (
                panel.useDummies &&
                panel.dummy &&
                Object.keys(panel.dummy).length
              ) {
                for (const [nm, arr] of Object.entries(panel.dummy)) {
                  if (absorbed.has("d_" + nm)) continue;
                  push("d_" + nm, arr);
                }
              } else {
                const seol = new Set(cfg.lunarWeeks.seollal),
                  chu = new Set(cfg.lunarWeeks.chuseok);
                push(
                  "lny",
                  t.map((tt) => (seol.has(tt) ? 1 : 0)),
                );
                push(
                  "chuseok",
                  t.map((tt) => (chu.has(tt) ? 1 : 0)),
                );
              }
              const steps = _mmmStepSeries(panel, cfg);
              for (const [nm, arr] of Object.entries(steps)) {
                if (absorbed.has(nm)) continue;
                push(nm, arr);
              }
              const sparse = cfg.excludeSparse
                ? mmmSparseChannels(panel, cfg)
                : new Set();
              for (const ch of _mmmChans(panel)) {
                if (absorbed.has(ch.key) || sparse.has(ch.key)) continue;
                if (!panel.ch[ch.key]) continue;
                push("ln_" + ch.key, mmmLnMedia(panel.ch[ch.key], lam));
              }
              if (withTrend) {
                const tm = _mean(t),
                  ts = _pstd(t) || 1;
                push(
                  "trend",
                  t.map((tt) => (tt - tm) / ts),
                );
              }
              const X = [];
              for (let i = 0; i < n; i++) X.push(cols.map((c) => c[i]));
              // 랭크 결손 열 드롭(상수=전부-0 채널[예: ASA-Android] · 완전공선) → 다운스트림 mmmOls/fitAR1 특이행렬 방지.
              // 절편 포함 Gram-Schmidt 기준. Tinder/골든은 redundant 없어 전 열 유지 → byte-동일.
              const keep = _nonRedundantCols(X, names);
              if (keep.length === names.length) return { X, names };
              return {
                X: X.map((r) => keep.map((j) => r[j])),
                names: keep.map((j) => names[j]),
                dropped: names.filter((_, j) => !keep.includes(j)),
              };
            }

            export function mmmSheetDesign(panel, cfg, withBrand = false) {
              const t = panel.week,
                n = t.length,
                cols = [],
                names = [];
              const push = (nm, arr) => {
                names.push(nm);
                cols.push(arr);
              };
              // ln_total = log1p(전체 유료 합산, 브랜드 제외) — "naive lumped" 베이스라인 (시트가 지출을 하나로 뭉친 것을 일반화)
              const lumpKeys = _mmmChans(panel)
                .filter((ch) => ch.kind !== "brand" && panel.ch[ch.key])
                .map((ch) => ch.key);
              const gtot = t.map((_, i) =>
                lumpKeys.reduce((s, k) => s + (panel.ch[k][i] || 0), 0),
              );
              push(
                "ln_total",
                gtot.map((v) => Math.log1p(v)),
              );
              push(
                "sin13",
                t.map((tt) => Math.sin((2 * Math.PI * tt) / 13.0)),
              );
              push(
                "cos52",
                t.map((tt) => Math.cos((2 * Math.PI * tt) / 52.0)),
              );
              // dummies: 매핑된 모든 더미 (Tinder=PreLNY/Seollal/ChuseokOnly/PostChuWk/OtherHol) + LineOff(step). OLS는 순서 무관 → audit 계수 byte-동일.
              for (const k in panel.dummy) push(k, panel.dummy[k]);
              // 구조변화 step: 사용자 매핑 step 컬럼(panel.steps)이 있으면 그것, 아니면 cfg.steps.line_off 주차임계값(Tinder LineOff).
              // Config에서 cfg.steps={}로 비우면(또는 임의데이터에서 미정의) audit 설계행렬에서도 제외 → 둘 다 없으면 step 없음.
              if (panel.steps && Object.keys(panel.steps).length) {
                for (const [nm, arr] of Object.entries(panel.steps)) push(nm, arr);
              } else if (cfg.steps && cfg.steps.line_off != null)
                push(
                  "LineOff",
                  t.map((tt) => (tt >= cfg.steps.line_off ? 1 : 0)),
                );
              push("t", t.slice());
              if (withBrand) {
                // brand-kind 채널 합산 → 0→NaN ffill/bfill → log1p (Tinder: brand 1개 → 기존과 동일)
                const brandKeys = _mmmChans(panel)
                  .filter((c) => c.kind === "brand" && panel.ch[c.key])
                  .map((c) => c.key);
                if (brandKeys.length) {
                  const b = t.map((_, i) =>
                    brandKeys.reduce((s, k) => s + (panel.ch[k][i] || 0), 0),
                  );
                  let last = null;
                  for (let i = 0; i < b.length; i++) {
                    if (b[i] === 0 || isNaN(b[i])) b[i] = last;
                    else last = b[i];
                  }
                  last = null;
                  for (let i = b.length - 1; i >= 0; i--) {
                    if (b[i] == null) b[i] = last;
                    else last = b[i];
                  }
                  push(
                    "ln_Brand",
                    b.map((v) => Math.log1p(v || 0)),
                  );
                }
              }
              const X = [];
              for (let i = 0; i < n; i++) X.push(cols.map((c) => c[i]));
              return { X, names };
            }

            export function _designConst(X) {
              return X.map((r) => [1, ...r]);
            }

            export function mmmFitHac(X, y, cfg) {
              return MMR_STATS.neweyWest(
                _designConst(X),
                y,
                cfg.hacAutoLag(y.length),
              );
            }

            export function _nonRedundantCols(X, names) {
              const n = X.length;
              if (!n) return [];
              const keep = [],
                basis = [];
              const ones = new Array(n).fill(1 / Math.sqrt(n));
              basis.push(ones); // 절편(상수열은 이것과 공선 → 자동 드롭)
              for (let j = 0; j < names.length; j++) {
                const v = X.map((r) => r[j]);
                const norm0 = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
                for (const b of basis) {
                  let d = 0;
                  for (let i = 0; i < n; i++) d += v[i] * b[i];
                  for (let i = 0; i < n; i++) v[i] -= d * b[i];
                }
                const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
                if (norm / norm0 > 1e-8) {
                  for (let i = 0; i < n; i++) v[i] /= norm;
                  basis.push(v);
                  keep.push(j);
                }
              }
              return keep;
            }

            export function mmmFitNamed(X, names, y, cfg, hac) {
              const keep = _nonRedundantCols(X, names);
              const Xk = X.map((r) => keep.map((j) => r[j])),
                nk = keep.map((j) => names[j]);
              const f = hac ? mmmFitHac(Xk, y, cfg) : mmmOls(_designConst(Xk), y);
              const map = {};
              names.forEach((nm) => {
                map[nm] = { coef: 0, p: 1, dropped: !nk.includes(nm) };
              });
              if (f)
                nk.forEach((nm, i) => {
                  const j = i + 1;
                  map[nm] = {
                    coef: f.beta[j],
                    p: hac ? f.pval[j] : studentTp(f.tvalues[j], f.n - f.k),
                    dropped: false,
                  };
                });
              return {
                map,
                fit: f,
                r2: f ? f.r2 : 0,
                adjR2: f ? f.adjR2 : 0,
                n: f ? f.n : y.length,
              };
            }

            export function mmmValidate(panel) {
              const rep = { n_weeks: panel.week.length, issues: [], warnings: [] };
              // 주 인덱스 비연속: 개별 나열(@1..@126 폭주) 대신 1건으로 요약. Week 컬럼이 1,2,3..이 아니면(날짜/연도) 흔함 — 행 순서(t)로 분석하므로 경고 수준.
              let nonContig = 0;
              for (let i = 1; i < panel.week.length; i++)
                if (panel.week[i] - panel.week[i - 1] !== 1) nonContig++;
              if (nonContig > 0)
                rep.warnings.push(
                  `주 인덱스가 1씩 증가하지 않음(${nonContig}곳) — Week 컬럼이 날짜/연도일 수 있음. 분석은 행 순서(t=1…N)로 진행.`,
                );
              for (const [nm, arr] of Object.entries(panel.targets))
                if (arr.some((v) => v <= 0 || isNaN(v)))
                  rep.warnings.push(`target '${nm}' 비양수/결측 존재`);
              for (const ch of _mmmChans(panel)) {
                if (!panel.ch[ch.key]) continue;
                const arr = panel.ch[ch.key],
                  nz = arr.filter((v) => v > 0).length,
                  nMiss = arr.filter((v) => isNaN(v) || v == null).length;
                rep[`nonzero::${ch.key}`] = `${nz}/${arr.length}`;
                if (nMiss)
                  rep.warnings.push(
                    `channel '${ch.key}': ${nMiss} 결측(NaN) — features에서 대치`,
                  );
                if (nz === 0)
                  rep.warnings.push(`channel '${ch.key}' 전부 0 → 식별 불가`);
                if (arr.length > 6 && arr.slice(-6).every((v) => v === 0) && nz > 6)
                  rep.warnings.push(
                    `channel '${ch.key}': 마지막 6주 0 — 결측-vs-진짜0 확인`,
                  );
              }
              return rep;
            }

            export function mmmAudit(panel, cfg) {
              const RR =
                panel.targets.RR ||
                panel.week.map((_, i) =>
                  Object.values(panel.targets).reduce((s, a) => s + a[i], 0),
                );
              const sd = mmmSheetDesign(panel, cfg, false);
              const olsN = mmmFitNamed(sd.X, sd.names, RR, cfg, false);
              const hacN = mmmFitNamed(sd.X, sd.names, RR, cfg, true);
              const coefRows = [
                "ln_total",
                "t",
                "LineOff",
                "Seollal",
                "sin13",
                "cos52",
              ]
                .filter((v) => sd.names.includes(v))
                .map((v) => ({
                  var: v,
                  coef: +olsN.map[v].coef.toFixed(2),
                  ols_p: +olsN.map[v].p.toFixed(4),
                  hac_p: +hacN.map[v].p.toFixed(4),
                }));
              const brandRows = [];
              for (const [nm, y] of [
                ["Regs", panel.targets.Regs],
                ["React", panel.targets.React],
                ["RR", RR],
              ]) {
                if (!y) continue;
                const sd0 = mmmSheetDesign(panel, cfg, false),
                  r0 = mmmFitNamed(sd0.X, sd0.names, y, cfg, false);
                const sdB = mmmSheetDesign(panel, cfg, true),
                  r1 = mmmFitNamed(sdB.X, sdB.names, y, cfg, false);
                brandRows.push({
                  target: nm,
                  R2_no_brand: +r0.r2.toFixed(4),
                  R2_with_brand: +r1.r2.toFixed(4),
                  adjR2_no_brand: +r0.adjR2.toFixed(4),
                  adjR2_with_brand: +r1.adjR2.toFixed(4),
                  brand_p: r1.map.ln_Brand ? +r1.map.ln_Brand.p.toFixed(4) : null,
                });
              }
              const swingRows = [];
              for (const [nm, y] of [
                ["Regs", panel.targets.Regs],
                ["React", panel.targets.React],
                ["RR", RR],
              ]) {
                if (!y) continue;
                const sdc = mmmSheetDesign(panel, cfg, false),
                  m = mmmFitNamed(sdc.X, sdc.names, y, cfg, true);
                swingRows.push({
                  target: nm,
                  ln_G_coef: +m.map.ln_total.coef.toFixed(2),
                  hac_p: +m.map.ln_total.p.toFixed(4),
                  trend_coef: +m.map.t.coef.toFixed(2),
                });
              }
              return {
                target: "RR",
                n: olsN.n,
                r2: +olsN.r2.toFixed(4),
                adj_r2: +olsN.adjR2.toFixed(4),
                hac_maxlags: cfg.hacAutoLag(RR.length),
                coefficients: coefRows,
                brand_test: brandRows,
                channel_swing: swingRows,
                composite: {
                  mean_RR: Math.round(_mean(RR)),
                  components_mean_sum: Math.round(
                    _mean(
                      panel.week.map(
                        (_, i) =>
                          (panel.targets.Regs ? panel.targets.Regs[i] : 0) +
                          (panel.targets.React ? panel.targets.React[i] : 0),
                      ),
                    ),
                  ),
                },
              };
            }

            // 채널 ln(1+지출) ↔ step(구조변화) 계열 상관 |r|≥0.9 공선쌍 탐지. index mmmDetectCollinear 이식(순수).
            export function mmmDetectCollinear(panel, cfg) {
              const pairs = [];
              const chSeries = {};
              for (const ch of _mmmChans(panel))
                if (panel.ch[ch.key])
                  chSeries[ch.key] = mmmLnMedia(panel.ch[ch.key], cfg.defaultLam);
              const stepSeries = _mmmStepSeries(panel, cfg);
              for (const ck of Object.keys(chSeries))
                for (const sk of Object.keys(stepSeries)) {
                  const r = CANNIBAL_STATS.pearson(chSeries[ck], stepSeries[sk]);
                  if (Math.abs(r) >= 0.9)
                    pairs.push({
                      channel: ck,
                      step: sk,
                      corr: +r.toFixed(3),
                      channelLabel:
                        (_mmmChans(panel).find((c) => c.key === ck) || {}).label ||
                        ck,
                    });
                }
              return pairs;
            }

            // 감지된 공선쌍 + 사용자 선택(choice: {`ch__step`:"step"|"channel"}) → 흡수할 컬럼 Set + 노티스.
            // index는 MMM_METH_STATE.absorbChoice를 읽지만 v2는 순수성 유지 위해 choice를 인자로 받음(기본 step 흡수).
            export function mmmResolveAbsorb(panel, cfg, choice) {
              const pairs = mmmDetectCollinear(panel, cfg);
              const absorbed = new Set();
              const notices = [];
              choice = choice || {};
              for (const p of pairs) {
                const key = `${p.channel}__${p.step}`;
                const side = choice[key] || "step"; // 기본: step 흡수(캠페인 유지)
                const dropped = side === "step" ? p.step : p.channel;
                const kept = side === "step" ? p.channelLabel : p.step;
                absorbed.add(dropped);
                notices.push({
                  key,
                  channel: p.channel,
                  channelLabel: p.channelLabel,
                  step: p.step,
                  corr: p.corr,
                  dropped,
                  kept,
                  side,
                });
              }
              return { absorbed, notices };
            }

            // 모델-독립 매크로 사실 — YoY 2024 vs 2025 (spend·target). dates: 주별 정렬 Date 배열.
            // index mmmMacroFacts 이식(순수). 24/25 둘 다 없으면 {} 반환.
            export function mmmMacroFacts(panel, cfg, dates) {
              const out = {};
              if (!dates || !dates.length) return out;
              const years = dates.map((d) => d.getUTCFullYear());
              const has24 = years.includes(2024),
                has25 = years.includes(2025);
              if (!has24 || !has25) return out;
              const sumWhere = (arr, yr) =>
                arr.reduce((s, v, i) => (years[i] === yr ? s + (v || 0) : s), 0);
              const yoy = (arr) => {
                const a = sumWhere(arr, 2024),
                  b = sumWhere(arr, 2025);
                return a > 0 ? +((b / a - 1) * 100).toFixed(1) : null;
              };
              const chKeys = _mmmChans(panel)
                .filter((ch) => panel.ch[ch.key])
                .map((ch) => ch.key);
              const totalPaid = panel.week.map((_, i) =>
                chKeys.reduce((s, k) => s + (panel.ch[k][i] || 0), 0),
              );
              const tp = yoy(totalPaid);
              if (tp != null) out["전체유료 spend YoY %"] = tp;
              for (const ch of _mmmChans(panel)) {
                if (!panel.ch[ch.key]) continue;
                const v = yoy(panel.ch[ch.key]);
                if (v != null) out[`${ch.label} spend YoY %`] = v;
              }
              for (const [nm, arr] of Object.entries(panel.targets)) {
                const v = yoy(arr);
                if (v != null) out[`${nm} YoY %`] = v;
              }
              return out;
            }

            export function mmmTrendExistence(panel, cfg, targetName) {
              const y = panel.targets[targetName];
              const stl = stlWeekly(y, 52);
              const deseason = y.map((v, i) => v - stl.seasonal[i]);
              const mkRaw = mkOriginal(y),
                mkAc = mkHamedRao(y),
                mkSeas = mkSeasonal(y, 52),
                mkDes = mkHamedRao(deseason);
              const adf = adfCT(y),
                kp = kpssCT(y);
              // diff drift (HAC maxlags=6, intercept only)
              const dy = [];
              for (let i = 1; i < y.length; i++) dy.push(y[i] - y[i - 1]);
              const dd = MMR_STATS.neweyWest(
                dy.map(() => [1]),
                dy,
                6,
              );
              // resid after media+season+holidays (no trend term), MK
              const { X } = mmmBuildFeatures(panel, cfg, 0.6, false);
              const fit = mmmOls(_designConst(X), y);
              const residMk = fit ? mkHamedRao(fit.resid) : mkHamedRao(y); // 특이행렬 방어(이론상 mmmBuildFeatures 랭크감소로 안 걸림)
              const stlPct = +(
                ((stl.trend[y.length - 1] - stl.trend[0]) / _mean(y)) *
                100
              ).toFixed(1);
              const assumptionFreeNo =
                mkAc.trend === "no trend" && mkDes.trend === "no trend";
              const organic = residMk.trend !== "no trend";
              const ts = adf.p < 0.05 && kp.p >= 0.05;
              let verdict;
              if (assumptionFreeNo)
                verdict = "NO robust trend — fitted t-coefficient는 artifact";
              else if (organic && ts)
                verdict =
                  "trend EXISTS (trend-stationary, not spurious); media 제거 후에도 organic 잔존";
              else
                verdict = "mixed — trend는 있으나 작음/부분적으로 media-confounded";
              return {
                target: targetName,
                stl_pct: stlPct,
                mk_raw: [mkRaw.trend, +mkRaw.p.toFixed(4)],
                mk_ac_robust: [mkAc.trend, +mkAc.p.toFixed(4)],
                mk_seasonal: [mkSeas.trend, +mkSeas.p.toFixed(4)],
                mk_deseason: [mkDes.trend, +mkDes.p.toFixed(4)],
                adf_ct_p: +adf.p.toFixed(4),
                kpss_ct_p: +kp.p.toFixed(4),
                diff_drift_per_wk: [+dd.beta[0].toFixed(1), +dd.pval[0].toFixed(4)],
                resid_after_media_mk: [residMk.trend, +residMk.p.toFixed(4)],
                verdict,
                stl,
              };
            }

            export function _mmmPrewhiten(series, withSeason) {
              const X = series.map((_, i) => {
                const row = [1, i];
                if (withSeason) {
                  const a = (2 * Math.PI * i) / 52.18;
                  row.push(Math.sin(a), Math.cos(a));
                }
                return row;
              });
              const fit = REG_STATS.ols(X, series);
              return fit ? fit.resid.slice() : series.slice();
            }

            export function mmmGranger(y, x, maxLagCap, opts) {
              opts = opts || {};
              const method = opts.method || "prewhiten";
              const N = y.length;
              if (N < 24) return null;
              const lx = x.map((v) => Math.log1p(v > 0 ? v : 0));
              let uy, ux;
              if (method === "diff") {
                uy = [];
                ux = [];
                for (let i = 1; i < N; i++) {
                  uy.push(y[i] - y[i - 1]);
                  ux.push(lx[i] - lx[i - 1]);
                }
              } else {
                const ws = N >= 60; // prewhiten: 추세(+계절) 제거 레벨 잔차 — 차분보다 신호 보존
                uy = _mmmPrewhiten(y, ws);
                ux = _mmmPrewhiten(lx, ws);
              }
              const dy = uy,
                dx = ux;
              const M = dy.length,
                maxLag = Math.max(1, Math.min(maxLagCap || 6, Math.floor(M / 12)));
              const fit = (tgt, causes, p) => {
                const rows = [],
                  yv = [];
                for (let t = p; t < M; t++) {
                  const row = [1];
                  for (const s of causes)
                    for (let l = 1; l <= p; l++) row.push(s[t - l]);
                  rows.push(row);
                  yv.push(tgt[t]);
                }
                try {
                  return REG_STATS.ols(rows, yv);
                } catch (e) {
                  return null;
                }
              };
              const test = (tgt, cause) => {
                // does cause Granger-cause tgt?
                let best = null;
                for (let p = 1; p <= maxLag; p++) {
                  const fu = fit(tgt, [tgt, cause], p);
                  if (!fu) continue;
                  const aic = fu.n * Math.log(fu.RSS / fu.n + 1e-12) + 2 * fu.k;
                  if (!best || aic < best.aic) best = { p, aic, fu };
                }
                if (!best) return { lag: 0, F: 0, p: 1, coefSum: 0 };
                const p = best.p,
                  fu = best.fu,
                  fr = fit(tgt, [tgt], p);
                if (!fr) return { lag: p, F: 0, p: 1, coefSum: 0 };
                const q = p,
                  dfd = fu.n - fu.k;
                const F =
                  dfd > 0 && fu.RSS > 0 ? (fr.RSS - fu.RSS) / q / (fu.RSS / dfd) : 0;
                const pval =
                  F > 0 && dfd > 0
                    ? REG_STATS.ibeta(dfd / 2, q / 2, dfd / (dfd + q * F))
                    : 1;
                const coefSum = fu.beta.slice(1 + p).reduce((a, b) => a + b, 0); // cause lag 계수합
                return {
                  lag: p,
                  F: +F.toFixed(2),
                  p: +pval.toFixed(4),
                  coefSum: +coefSum.toFixed(4),
                };
              };
              return {
                spend_to_organic: test(dy, dx),
                organic_to_spend: test(dx, dy),
              };
            }

            export function mmmDeseasonHoliday(panel, target) {
              const y = panel.targets[target] || [];
              const n = y.length;
              if (n < 8) return y.slice();
              const dums = panel.dummy || {},
                steps = panel.steps || {};
              const dumKeys = Object.keys(dums),
                stepKeys = Object.keys(steps);
              const X = y.map((_, i) => {
                const a = (2 * Math.PI * i) / 52.18;
                const row = [1, i, Math.sin(a), Math.cos(a)];
                dumKeys.forEach((k) => row.push((dums[k] || [])[i] || 0));
                stepKeys.forEach((k) => row.push((steps[k] || [])[i] || 0));
                return row;
              });
              let fit;
              try {
                fit = REG_STATS.ols(X, y);
              } catch (e) {
                return y.slice();
              }
              if (!fit) return y.slice();
              const b = fit.beta; // [int, t, sin, cos, ...dummies, ...steps]
              const sh = y.map((_, i) => {
                const a = (2 * Math.PI * i) / 52.18;
                let s = b[2] * Math.sin(a) + b[3] * Math.cos(a);
                dumKeys.forEach((k, j) => {
                  s += b[4 + j] * ((dums[k] || [])[i] || 0);
                });
                return s;
              });
              // 양방향 평탄화 + base(평균) 보존: 계절·휴일 기여의 "평균 대비 편차"만 제거.
              // +기여(평균↑)면 빼서 내리고, −기여(평균↓)면 더해서 올림. 전체 레벨(Base)은 불변.
              const meanSh = sh.reduce((s, v) => s + v, 0) / sh.length;
              return y.map((v, i) => +(v - (sh[i] - meanSh)).toFixed(1));
            }

            export function mmmIRF(y, x, opts) {
              opts = opts || {};
              const H = opts.horizon || 12,
                cap = opts.maxLag || 6;
              const N = y.length;
              if (N < 24) return null;
              const ws = N >= 60;
              const uy = _mmmPrewhiten(y, ws),
                ux = _mmmPrewhiten(
                  x.map((v) => Math.log1p(v > 0 ? v : 0)),
                  ws,
                );
              const M = uy.length;
              const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
              const mx = mean(ux),
                sdx = Math.sqrt(
                  ux.reduce((s, v) => s + (v - mx) ** 2, 0) / ux.length,
                );
              if (!(sdx > 0)) return null;
              const maxLag = Math.max(1, Math.min(cap, Math.floor(M / 12)));
              const fitEq = (tgt, p) => {
                const rows = [],
                  yv = [];
                for (let t = p; t < M; t++) {
                  const r = [1];
                  for (let l = 1; l <= p; l++) r.push(uy[t - l]);
                  for (let l = 1; l <= p; l++) r.push(ux[t - l]);
                  rows.push(r);
                  yv.push(tgt[t]);
                }
                try {
                  return REG_STATS.ols(rows, yv);
                } catch (e) {
                  return null;
                }
              };
              let p = 1,
                best = null;
              for (let pp = 1; pp <= maxLag; pp++) {
                const f = fitEq(uy, pp);
                if (!f) continue;
                const aic = f.n * Math.log(f.RSS / f.n + 1e-12) + 2 * f.k;
                if (!best || aic < best.aic) {
                  best = { aic };
                  p = pp;
                }
              }
              const fy = fitEq(uy, p),
                fx = fitEq(ux, p);
              if (!fy || !fx) return null;
              const ay = fy.beta.slice(1, 1 + p),
                bx = fy.beta.slice(1 + p, 1 + 2 * p); // y eq: 자기lag, x lag
              const cy = fx.beta.slice(1, 1 + p),
                dx = fx.beta.slice(1 + p, 1 + 2 * p); // x eq
              const yH = [],
                xH = [],
                irf = [];
              for (let h = 0; h <= H; h++) {
                let yh, xh;
                if (h === 0) {
                  yh = 0;
                  xh = sdx;
                } // spend-first: 충격은 x에 sdx, organic은 다음 주부터 반응
                else {
                  yh = 0;
                  xh = 0;
                  for (let l = 1; l <= p; l++) {
                    const yv = h - l >= 0 ? yH[h - l] || 0 : 0,
                      xv = h - l >= 0 ? xH[h - l] || 0 : 0;
                    yh += ay[l - 1] * yv + bx[l - 1] * xv;
                    xh += cy[l - 1] * yv + dx[l - 1] * xv;
                  }
                }
                yH[h] = yh;
                xH[h] = xh;
                irf.push(+yh.toFixed(4));
              }
              const cum = [];
              let s = 0;
              irf.forEach((v) => {
                s += v;
                cum.push(+s.toFixed(4));
              });
              let peak = 0,
                peakWk = 0;
              irf.forEach((v, i) => {
                if (Math.abs(v) > Math.abs(peak)) {
                  peak = v;
                  peakWk = i;
                }
              });
              return {
                lag: p,
                horizon: H,
                shockSd: +sdx.toFixed(4),
                irf,
                cum,
                peak: +peak.toFixed(4),
                peakWeek: peakWk,
                cumTotal: +s.toFixed(4),
              };
            }

            export function mmmChangePoints(series, opts) {
              opts = opts || {};
              const minSeg = opts.minSeg || 4,
                mult = opts.penaltyMult != null ? opts.penaltyMult : 2;
              const N0 = (series || []).length;
              if (N0 < 2 * minSeg + 2)
                return {
                  points: [],
                  pointTypes: [],
                  segments: [],
                  outliers: [],
                  dy: [],
                };
              const z = [];
              for (let i = 1; i < N0; i++) z.push(series[i] - series[i - 1]); // Δ(성장률)
              const m = z.length;
              const ps = [0],
                ps2 = [0];
              for (let i = 0; i < m; i++) {
                ps.push(ps[i] + z[i]);
                ps2.push(ps2[i] + z[i] * z[i]);
              }
              const cost = (s, e) => {
                // [s,e) Gaussian -2logL (평균·분산 MLE)
                const len = e - s;
                if (len <= 0) return 0;
                const sum = ps[e] - ps[s],
                  sum2 = ps2[e] - ps2[s];
                let v = (sum2 - (sum * sum) / len) / len;
                if (!(v > 1e-9)) v = 1e-9;
                return len * (Math.log(2 * Math.PI * v) + 1);
              };
              const beta = mult * Math.log(m);
              const F = new Array(m + 1).fill(Infinity),
                prev = new Array(m + 1).fill(0);
              F[0] = -beta;
              for (let t = minSeg; t <= m; t++) {
                for (let s = 0; s <= t - minSeg; s++) {
                  if (F[s] === Infinity) continue;
                  const c = F[s] + cost(s, t) + beta;
                  if (c < F[t]) {
                    F[t] = c;
                    prev[t] = s;
                  }
                }
              }
              const bounds = [];
              let t = m;
              while (t > 0) {
                bounds.push(t);
                t = prev[t];
              }
              bounds.push(0);
              bounds.reverse();
              // z-경계 인덱스 s ↔ series 인덱스 s (그 지점에서 성장률 regime 전환)
              const cps = bounds.slice(1, -1);
              // 세그먼트별 평균 성장률(/주, Δ) + 평균 레벨(원 series) — 해석용
              const segments = [];
              for (let i = 0; i < bounds.length - 1; i++) {
                const s = bounds[i],
                  e = bounds[i + 1],
                  len = e - s;
                const segVals = series.slice(s, Math.min(e + 1, N0));
                const meanLevel =
                  segVals.reduce((a, b) => a + b, 0) / (segVals.length || 1);
                segments.push({
                  startIdx: s,
                  endIdx: e,
                  meanGrowth: +((ps[e] - ps[s]) / len).toFixed(2),
                  meanLevel: +meanLevel.toFixed(1),
                });
              }
              // robust 이상치 탐지 (rolling median window 7 + 전역 MAD) — 1주 spike 분류용
              const half = 3;
              const med = [...series].sort((a, b) => a - b)[Math.floor(N0 / 2)];
              const madArr = series
                .map((v) => Math.abs(v - med))
                .sort((a, b) => a - b);
              const mad = (madArr[Math.floor(N0 / 2)] || 0) * 1.4826 + 1e-9;
              const outliers = [];
              for (let i = 0; i < N0; i++) {
                const w = series
                  .slice(Math.max(0, i - half), Math.min(N0, i + half + 1))
                  .sort((a, b) => a - b);
                const mwin = w[Math.floor(w.length / 2)];
                const zsc = Math.abs(series[i] - mwin) / mad;
                if (zsc > 3) outliers.push({ idx: i, z: +zsc.toFixed(1) });
              }
              const outIdx = new Set(outliers.map((o) => o.idx));
              // 변화점 분류: 인근(±2주)에 이상치 주가 있으면 spike(일시), 아니면 shift(추세전환)
              const pointTypes = cps.map((s) => {
                for (let d = -2; d <= 2; d++) if (outIdx.has(s + d)) return "spike";
                return "shift";
              });
              return { points: cps, pointTypes, segments, outliers, dy: z };
            }

            export function mmmChangePointDrivers(panel, target, cp, opts) {
              opts = opts || {};
              const W = opts.window || 4;
              const y = panel.targets[target] || [],
                wk = panel.week || [],
                N = y.length;
              const chans = _mmmChans(panel).filter((ch) => panel.ch[ch.key]);
              const outIdx = new Set((cp.outliers || []).map((o) => o.idx));
              const mean = (a) =>
                a.length
                  ? a.reduce((s, v) => s + (isFinite(v) ? v : 0), 0) / a.length
                  : NaN;
              return (cp.points || []).map((idx, k) => {
                const lo = Math.max(0, idx - W),
                  hi = Math.min(N, idx + W);
                const tb = mean(y.slice(lo, idx)),
                  ta = mean(y.slice(idx, hi));
                const channels = chans
                  .map((ch) => {
                    const sp = panel.ch[ch.key] || [];
                    const sb = mean(sp.slice(lo, idx)),
                      sa = mean(sp.slice(idx, hi));
                    const pct = sb > 0 ? ((sa - sb) / sb) * 100 : sa > 0 ? 100 : 0;
                    return {
                      key: ch.key,
                      label: ch.label,
                      before: sb,
                      after: sa,
                      delta: sa - sb,
                      pct,
                    };
                  })
                  .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
                const events = [];
                const dums = panel.dummy || {};
                for (const dn in dums) {
                  let act = 0;
                  for (let i = lo; i < hi; i++) if (dums[dn][i]) act++;
                  if (act > 0) events.push(dn);
                }
                return {
                  idx,
                  week: wk[idx],
                  type: cp.pointTypes[k],
                  isOutlier: outIdx.has(idx),
                  targetBefore: +tb.toFixed(1),
                  targetAfter: +ta.toFixed(1),
                  targetDelta: +(ta - tb).toFixed(1),
                  targetPct: tb > 0 ? +(((ta - tb) / tb) * 100).toFixed(1) : 0,
                  channels,
                  events,
                };
              });
            }

            export function mmmCannibalization(
              panel,
              cfg,
              targetName,
              netElasticity,
              channelKey,
            ) {
              const R = MMM_CANNIB_RULES;
              const y = panel.targets[targetName],
                t = panel.week,
                n = t.length;
              const chMeta = channelKey
                ? _mmmChans(panel).find((c) => c.key === channelKey) || {}
                : {};
              const chLabel = channelKey ? chMeta.label || channelKey : "전체 유료";
              const isBrand = channelKey
                ? mmmIsBrandIntercept(chLabel, chMeta.kind)
                : false;
              // 선택 채널의 spend (합산 안 함 — 채널별 개별). channelKey 없으면 전체 합산(레거시).
              const spend = channelKey
                ? panel.ch[channelKey]
                  ? panel.ch[channelKey].map((v) => v || 0)
                  : t.map(() => 0)
                : t.map((_, i) =>
                    _mmmChans(panel)
                      .filter((c) => panel.ch[c.key])
                      .reduce((s, c) => s + (panel.ch[c.key][i] || 0), 0),
                  );

              // ── ① 시간 선행성: 저지출 구간(spend ≤ p25)에서 오가닉 추세 (광고 본격화 前부터 죽었나) ──
              const sortedSp = spend.slice().sort((a, b) => a - b);
              const p25 = sortedSp.length
                ? sortedSp[Math.floor((sortedSp.length - 1) * R.lowSpendPct)]
                : 0;
              const lowIdx = spend
                .map((s, i) => (s <= p25 ? i : -1))
                .filter((i) => i >= 0);
              // 집행 연속성: on/off 전환 수 + 무집행 비율. 산발(flighted)이면 저지출창(=0지출)이 시점 혼재 → 선행성 confounded.
              const _onoff = spend.map((v) => (v > 0 ? 1 : 0));
              let flightTrans = 0;
              for (let i = 1; i < n; i++)
                if (_onoff[i] !== _onoff[i - 1]) flightTrans++;
              const zeroFrac = +(1 - _onoff.reduce((a, b) => a + b, 0) / n).toFixed(
                2,
              );
              const flighted = flightTrans >= 4 && zeroFrac >= 0.2; // ≥2 분리 플라이트 + 무집행 ≥20%
              const lowDegenerate = p25 <= 0; // 저지출창이 0지출 주들(초반 블록이 아니라 흩어지면 시점 혼재)
              let slope = 0,
                slopeP = 1,
                changePct = 0;
              const lowN = lowIdx.length;
              if (lowN >= R.precMinN) {
                const lx = lowIdx.map((i) => t[i]),
                  ly = lowIdx.map((i) => y[i]);
                const fit = mmmOls(
                  lx.map((w) => [1, w]),
                  ly,
                );
                if (fit) {
                  slope = fit.beta[1];
                  slopeP = studentTp(fit.tvalues[1], fit.n - fit.k);
                  const span = Math.max(...lx) - Math.min(...lx),
                    lyM = _mean(ly) || 1;
                  changePct = ((slope * span) / lyM) * 100;
                }
              }
              let precVote;
              if (lowN < R.precMinN) precVote = "ABSTAIN";
              else if (flighted && lowDegenerate)
                precVote = "ABSTAIN"; // 산발 집행·저지출창=0지출 시점혼재 → 선행성 신뢰 불가(degenerate P25)
              else if (
                slope < 0 &&
                slopeP < R.precSlopeP &&
                changePct <= -R.precDeclinePct
              )
                precVote = "FOR";
              else if (slope > 0 && slopeP < R.precSlopeP) precVote = "AGAINST";
              else precVote = "ABSTAIN";
              const precedence = {
                window: "low-spend(≤p25)",
                low_n: lowN,
                p25: Math.round(p25),
                avg_spend: Math.round(_mean(lowIdx.map((i) => spend[i])) || 0),
                kpi_slope_per_wk: +slope.toFixed(1),
                slope_p: +slopeP.toFixed(4),
                kpi_change_over_window_pct: +changePct.toFixed(1),
                vote: precVote,
                declining_pre_ramp: precVote === "FOR",
                flighted,
                low_degenerate: lowDegenerate,
              };

              // ── ② 탈추세·차분 상관 (시간 착시 vs 진짜 음상관) ──
              const lnG = spend.map((v) => Math.log1p(v));
              const raw = CANNIBAL_STATS.pearson(lnG, y);
              const tr = t.map((_, i) => i);
              const gFit = mmmOls(
                  tr.map((i) => [1, i]),
                  lnG,
                ),
                yFit = mmmOls(
                  tr.map((i) => [1, i]),
                  y,
                );
              const det =
                gFit && yFit ? CANNIBAL_STATS.pearson(gFit.resid, yFit.resid) : 0;
              const dlnG = [],
                dy = [];
              for (let i = 1; i < n; i++) {
                dlnG.push(lnG[i] - lnG[i - 1]);
                dy.push(y[i] - y[i - 1]);
              }
              const fd = CANNIBAL_STATS.pearson(dlnG, dy);
              let detVote;
              if (det >= R.detrendFor && fd >= R.detrendFor) detVote = "FOR";
              else if (det <= R.detrendAgainst || fd <= R.detrendAgainst)
                detVote = "AGAINST";
              else detVote = "ABSTAIN";
              const detrend = {
                raw: +raw.toFixed(3),
                detrended: +det.toFixed(3),
                first_diff: +fd.toFixed(3),
                vote: detVote,
                negative_collapses: detVote === "FOR" && raw < 0,
              };

              // ── 역인과(페이싱) 점검: 오가닉 약할 때 방어적으로 예산↑면 ②의 음상관은 오가닉→광고(내생) ──
              const spendTimeCorr = CANNIBAL_STATS.pearson(lnG, tr);
              const reverseRisk = raw < -0.1 && spendTimeCorr > 0.3;

              // ── ③ 순증분 탄력성 (NET) ──
              const coef = netElasticity.coef,
                p = netElasticity.p,
                ciLo = netElasticity.ci_lo,
                ciHi = netElasticity.ci_hi;
              const hasCi = isFinite(ciLo) && isFinite(ciHi);
              let netVote;
              if (!isFinite(coef) || !isFinite(p)) netVote = "ABSTAIN";
              else if (coef >= 0 && p < R.netP) netVote = "FOR";
              else if (hasCi && ciLo > -R.netMaterial)
                netVote = "FOR"; // 의미있는 카니발 배제
              else if (coef < 0 && p < R.netP) netVote = "AGAINST";
              else netVote = "ABSTAIN";

              // ── 검정력 게이트 (CLEAR 차단): 하나라도 걸리면 ③ 자동 ABSTAIN + 판정 상한 INCONCLUSIVE ──
              const gateReasons = [];
              if (Math.abs(spendTimeCorr) >= R.gateSpendTimeCorr)
                gateReasons.push(
                  `spend↔시간 공선 |r|=${Math.abs(spendTimeCorr).toFixed(2)} ≥ ${R.gateSpendTimeCorr}`,
                );
              const vif = netElasticity.vif;
              if (isFinite(vif) && vif >= R.gateVif)
                gateReasons.push(`VIF=${(+vif).toFixed(1)} ≥ ${R.gateVif}`);
              if (
                hasCi &&
                isFinite(coef) &&
                Math.abs(coef) > 1e-9 &&
                ciHi - ciLo >= R.gateCiMult * Math.abs(coef)
              )
                gateReasons.push(
                  `③ CI폭 ${(ciHi - ciLo).toFixed(3)} ≥ ${R.gateCiMult}×|점추정|`,
                );
              if (n < R.gateMinN) gateReasons.push(`n=${n} < ${R.gateMinN}`);
              const powerGateBlocked = gateReasons.length > 0;
              if (powerGateBlocked) netVote = "ABSTAIN";
              const net = {
                net_elasticity: +(isFinite(coef) ? coef : NaN).toFixed(4),
                p: +(isFinite(p) ? p : NaN).toFixed(4),
                ci_lo: hasCi ? +ciLo.toFixed(4) : null,
                ci_hi: hasCi ? +ciHi.toFixed(4) : null,
                vote: netVote,
              };

              // ── ④ 그랜저 인과 (시차·방향) — 동시점 검정이 못 보는 lagged 신호 ──
              const gr = mmmGranger(y, spend, 6);
              const grP = R.netP;
              const grangerCannibal =
                gr && gr.spend_to_organic.p < grP && gr.spend_to_organic.coefSum < 0; // 광고비→오가닉 시차 하락
              const grangerHelp =
                gr && gr.spend_to_organic.p < grP && gr.spend_to_organic.coefSum > 0; // 광고비→오가닉 시차 상승
              const pacing = gr && gr.organic_to_spend.p < grP; // 오가닉→광고비 (페이싱·역인과)

              // ── 투표 집계 + 채널 prior bar ──
              const votes = { FOR: 0, AGAINST: 0, ABSTAIN: 0 };
              [precVote, detVote, netVote].forEach((v) => votes[v]++);
              const forBar = isBrand ? R.brandBarFor : R.otherBarFor;

              // ── 최종 판정 (입증책임 비대칭) ──
              let verdict, verdictClass;
              if (votes.AGAINST >= 1) {
                verdictClass = "cannibal";
                verdict = "LEAN CANNIBAL — 카니발 우려, holdout 1순위";
              } else if (
                !powerGateBlocked &&
                votes.FOR >= forBar &&
                votes.AGAINST === 0
              ) {
                verdictClass = "ok";
                verdict =
                  "관측상 적색신호 없음 (잠정 OK) — 방어 가능성 높음, 단 결정적 확인은 geo holdout";
              } else {
                verdictClass = "inconclusive";
                verdict = "INCONCLUSIVE — 증거 부족, holdout 필요";
              }
              // 그랜저 시차 잠식이 유의하면 비-카니발 판정을 LEAN CANNIBAL로 격상 (동시점이 놓친 신호 — 보수적으로 우려만 ↑)
              // 단, 산발(flighted) 집행이면 그랜저 단독으로 격상 금지(on/off 버스트가 시차 신호를 왜곡 — 매칭 on/off/holdout 필요).
              if (grangerCannibal && verdictClass !== "cannibal" && !flighted) {
                verdictClass = "cannibal";
                verdict = `LEAN CANNIBAL — 그랜저 시차 인과(광고비→오가닉↓, lag ${gr.spend_to_organic.lag}), holdout 1순위`;
              }

              return {
                precedence,
                detrend_corr: detrend,
                net_incrementality: net,
                votes,
                vote_summary: `FOR ${votes.FOR} · AGAINST ${votes.AGAINST} · ABSTAIN ${votes.ABSTAIN}`,
                power_gate: { blocked: powerGateBlocked, reasons: gateReasons },
                spend_time_corr: +spendTimeCorr.toFixed(3),
                flighted,
                flight_transitions: flightTrans,
                flight_zero_frac: zeroFrac,
                is_brand_intercept: isBrand,
                for_bar: forBar,
                reverse_causality_risk: reverseRisk,
                granger: gr,
                granger_cannibal: !!grangerCannibal,
                granger_help: !!grangerHelp,
                pacing: !!pacing,
                verdict,
                verdict_class: verdictClass,
                organic_votes: votes.FOR, // 하위호환(레거시 소비처)
                channel: channelKey || "__total__",
                channelLabel: chLabel,
              };
            }

            export function _cvPredict(XtrFull, ytr, xrowFull) {
              const k = XtrFull[0].length,
                keep = [0];
              for (let j = 1; j < k; j++) {
                const col = XtrFull.map((r) => r[j]);
                let mn = col[0],
                  mx = col[0];
                for (const v of col) {
                  if (v < mn) mn = v;
                  if (v > mx) mx = v;
                }
                if (mx - mn > 1e-12) keep.push(j);
              }
              const Xtr = XtrFull.map((r) => keep.map((j) => r[j]));
              const f = mmmOls(Xtr, ytr);
              if (!f) return null;
              return keep.reduce((s, j, i) => s + xrowFull[j] * f.beta[i], 0);
            }

            export function mmmSelectAdstock(panel, cfg, targetName) {
              const y = panel.targets[targetName],
                n = y.length,
                grid = cfg.adstockGrid,
                minTrain = cfg.cvMinTrain;
              const results = {};
              for (const lam of grid) {
                const { X } = mmmBuildFeatures(panel, cfg, lam);
                const errs = [];
                for (let cut = minTrain; cut < n - 1; cut++) {
                  const pred = _cvPredict(
                    _designConst(X.slice(0, cut)),
                    y.slice(0, cut),
                    [1, ...X[cut]],
                  );
                  if (pred == null) continue;
                  errs.push((y[cut] - pred) ** 2);
                }
                results[lam] = errs.length ? +Math.sqrt(_mean(errs)).toFixed(1) : NaN;
              }
              let best = grid
                .filter((l) => !isNaN(results[l]))
                .reduce((a, l) => (results[l] < results[a] ? l : a), grid[0]);
              return { cv_rmse: results, best_lambda: best };
            }

            export function mmmShapleyGroups(names, channels) {
              // 휴일=lny/chuseok 또는 매핑 더미(d_*). Regime=cfg.steps + 사용자 매핑 step(나머지 비-계절/추세/휴일/채널).
              // 골든(lny/chuseok·post_step/line_off·ln_*)은 그룹 멤버십·순서 동일 → byte-동일.
              const isSeason = (n) => /^(sin|cos)_/.test(n),
                isHol = (n) => n === "lny" || n === "chuseok" || n.startsWith("d_"),
                isCh = (n) => n.startsWith("ln_");
              const colsWhere = (pred) =>
                names.map((n, i) => (pred(n) ? i : -1)).filter((i) => i >= 0);
              const groups = [
                { name: "Trend", cols: colsWhere((n) => n === "trend") },
                { name: "Seasonality", cols: colsWhere(isSeason) },
                { name: "Holidays", cols: colsWhere(isHol) },
                {
                  name: "Regime(steps)",
                  cols: colsWhere(
                    (n) => n !== "trend" && !isSeason(n) && !isHol(n) && !isCh(n),
                  ),
                },
              ];
              for (const ch of channels || [])
                groups.push({
                  name: ch.label,
                  cols: [names.indexOf("ln_" + ch.key)].filter((i) => i >= 0),
                });
              return groups.filter((g) => g.cols.length);
            }

            export function mmmRunMmm(panel, cfg, targetName) {
              const ad = mmmSelectAdstock(panel, cfg, targetName);
              const lam = ad.best_lambda;
              const { X, names } = mmmBuildFeatures(panel, cfg, lam);
              const y = panel.targets[targetName];
              // VIF (design + const, skip const)
              const vifs = CREATIVE_MATH.vif(_designConst(X));
              const vifByName = names
                .map((nm, i) => ({ var: nm, vif: +vifs[i + 1].toFixed(3) }))
                .sort((a, b) => b.vif - a.vif);
              // collinear pairs (|corr|>=0.85)
              const pairs = [];
              for (let i = 0; i < names.length; i++)
                for (let j = i + 1; j < names.length; j++) {
                  const r = CANNIBAL_STATS.pearson(
                    X.map((row) => row[i]),
                    X.map((row) => row[j]),
                  );
                  if (Math.abs(r) >= 0.85)
                    pairs.push({ a: names[i], b: names[j], corr: +r.toFixed(3) });
                }
              pairs.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));
              // elasticities (AR1, log y)
              const elas = mmmElasticities(panel, cfg, targetName, lam);
              // shapley
              const groups = mmmShapleyGroups(names, _mmmChans(panel));
              const sh = shapleyR2Exact(y, groups, X);
              // saturation: 모델에 포함된 첫 perf 채널 (Tinder=google_roi, 임의 데이터=첫 perf) — sat은 골든 호환 유지
              const satCh = _mmmChans(panel).find(
                (c) => c.kind !== "brand" && names.includes("ln_" + c.key),
              );
              const sat = satCh
                ? mmmSaturation(panel, cfg, targetName, satCh.key, lam)
                : null;
              // 채널별 saturation (수확체감 곡선용) — brand·sparse·absorbed·미포함 채널 제외
              const sparseSet = cfg.excludeSparse
                ? mmmSparseChannels(panel, cfg)
                : new Set();
              const satByChannel = {};
              for (const ch of _mmmChans(panel)) {
                if (
                  ch.kind === "brand" ||
                  !panel.ch[ch.key] ||
                  (cfg.absorbed && cfg.absorbed.has(ch.key)) ||
                  sparseSet.has(ch.key) ||
                  !names.includes("ln_" + ch.key)
                )
                  continue;
                const s = mmmSaturation(panel, cfg, targetName, ch.key, lam);
                if (s) {
                  s.label = ch.label;
                  s.recentMean = (() => {
                    const a = panel.ch[ch.key].filter((v) => v > 0 && isFinite(v));
                    return a.length
                      ? Math.round(
                          a.slice(-12).reduce((x, y2) => x + y2, 0) /
                            Math.min(12, a.length),
                        )
                      : 0;
                  })();
                  satByChannel[ch.key] = s;
                }
              }
              return {
                best_lambda: lam,
                cv_rmse: ad.cv_rmse,
                vif: vifByName,
                collinear_pairs: pairs,
                elasticities: elas,
                shapley: sh,
                saturation: sat,
                saturationByChannel: satByChannel,
              };
            }

            export function _mmmLogFitAR1(Xc, yRaw) {
              const idx = [];
              for (let i = 0; i < yRaw.length; i++)
                if (yRaw[i] > 0 && isFinite(yRaw[i])) idx.push(i);
              const fa = fitAR1(
                idx.map((i) => Xc[i]),
                idx.map((i) => Math.log(yRaw[i])),
              );
              return { fa, dropped: yRaw.length - idx.length, n: idx.length };
            }

            export function mmmElasticities(panel, cfg, targetName, lam) {
              const { X, names } = mmmBuildFeatures(panel, cfg, lam, true);
              const fa = _mmmLogFitAR1(_designConst(X), panel.targets[targetName]).fa;
              if (!fa) return []; // 특이행렬(드롭 후 상수열 등) 방어
              const keep = names
                .map((nm, i) => ({ nm, i }))
                .filter((o) => o.nm.startsWith("ln_") || o.nm === "trend");
              return keep.map(({ nm, i }) => {
                const j = i + 1;
                return {
                  var: nm,
                  coef: +fa.beta[j].toFixed(4),
                  ci_lo: +fa.ci95[j][0].toFixed(4),
                  ci_hi: +fa.ci95[j][1].toFixed(4),
                  p: +fa.pval[j].toFixed(4),
                };
              });
            }

            export function mmmSaturation(
              panel,
              cfg,
              targetName,
              channelKey,
              lam,
              levels = [10000, 35000, 60000],
            ) {
              const { X, names } = mmmBuildFeatures(panel, cfg, lam, true);
              const col = "ln_" + channelKey,
                j = names.indexOf(col);
              if (j < 0) return null;
              const fa = fitAR1(_designConst(X), panel.targets[targetName]);
              const b = fa.beta[j + 1];
              const marg = {};
              for (const lv of levels)
                marg[`$${lv / 1000}k`] = +((b / (1 + lv)) * 1000).toFixed(1);
              return {
                channel: channelKey,
                ln_coef: +b.toFixed(1),
                marginal_kpi_per_1k: marg,
              };
            }

            export function mmmChannelEffects(panel, cfg, targetName, lam) {
              const { X, names } = mmmBuildFeatures(panel, cfg, lam, true);
              const logFit = _mmmLogFitAR1(
                _designConst(X),
                panel.targets[targetName],
              ); // 탄력성(log-log) — 타깃≤0 주 제외
              const faLog = logFit.fa;
              const faRaw = fitAR1(_designConst(X), panel.targets[targetName]); // 주당 인원(semi-log)
              const folded = cfg.absorbed || new Set(cfg.foldIntoRegime || []);
              const cov = mmmChannelCoverage(panel, cfg);
              const out = [];
              for (const ch of _mmmChans(panel)) {
                if (folded.has(ch.key) || !panel.ch[ch.key]) continue;
                const cv = cov[ch.key] || {
                  sparse: false,
                  trailingZero: false,
                  nonzero: 0,
                  total: 0,
                };
                const j = names.indexOf("ln_" + ch.key);
                if (j < 0 || !faLog || !faRaw) {
                  // 모델 제외(sparse·랭크드롭) 또는 적합 실패 — 데이터부족 표기
                  out.push({
                    key: ch.key,
                    label: ch.label,
                    elas: 0,
                    ci: [0, 0],
                    p: 1,
                    weeklyPer1k: null,
                    meanSpend: 0,
                    sig: false,
                    nonzero: cv.nonzero,
                    total: cv.total,
                    sparse: true,
                    trailingZero: cv.trailingZero,
                    verdict: "sparse",
                  });
                  continue;
                }
                const elas = faLog.beta[j + 1],
                  ci = faLog.ci95[j + 1],
                  p = faLog.pval[j + 1],
                  bRaw = faRaw.beta[j + 1];
                const active = panel.ch[ch.key].filter((v) => v > 0 && isFinite(v));
                const recentMean = active.length
                  ? active.slice(-12).reduce((a, b) => a + b, 0) /
                    Math.min(12, active.length)
                  : 0;
                const weeklyPer1k =
                  recentMean > 0 ? (bRaw / (1 + recentMean)) * 1000 : null;
                const sig = ci[0] > 0 || ci[1] < 0;
                // 데이터 부족·낮은 커버리지·최근끊김 채널의 음수는 노이즈로 — "잠식 의심"은 데이터 충분+유의한 음수만
                const lowCov = cv.coverage < 0.5;
                let verdict;
                if (cv.sparse) verdict = "sparse";
                else if (!sig) verdict = "noise";
                else if (elas > 0) verdict = "incremental";
                else verdict = cv.trailingZero || lowCov ? "noise" : "suppress";
                out.push({
                  key: ch.key,
                  label: ch.label,
                  elas: +elas.toFixed(4),
                  ci: [+ci[0].toFixed(4), +ci[1].toFixed(4)],
                  p: +p.toFixed(4),
                  weeklyPer1k: weeklyPer1k == null ? null : +weeklyPer1k.toFixed(1),
                  meanSpend: Math.round(recentMean),
                  sig,
                  nonzero: cv.nonzero,
                  total: cv.total,
                  sparse: cv.sparse,
                  trailingZero: cv.trailingZero,
                  verdict,
                });
              }
              out.logDropped = logFit.dropped; // 타깃≤0로 log-log 적합에서 제외된 주 수
              return out;
            }

            export function mmmRidgeFit(X, y, names) {
              const n = X.length,
                k = names.length;
              if (!n || !k) return null;
              const mean = (a) => a.reduce((s, x) => s + x, 0) / n;
              const colM = names.map((_, j) => mean(X.map((r) => r[j])));
              const colS = names.map((_, j) => {
                const m = colM[j];
                return Math.sqrt(mean(X.map((r) => (r[j] - m) ** 2))) || 1;
              });
              const Z = X.map((r) => r.map((v, j) => (v - colM[j]) / colS[j]));
              const ybar = mean(y),
                yc = y.map((v) => v - ybar);
              const ZtZ0 = names.map((_, a) =>
                names.map((__, b) => Z.reduce((s, r) => s + r[a] * r[b], 0)),
              );
              const Zty = names.map((_, a) =>
                Z.reduce((s, r, i) => s + r[a] * yc[i], 0),
              );
              const solve = (lambda) => {
                const A = ZtZ0.map((r, i) => {
                  const row = r.slice();
                  row[i] += lambda;
                  return [...row, Zty[i]];
                });
                for (let c = 0; c < k; c++) {
                  let p = c;
                  for (let r = c + 1; r < k; r++)
                    if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
                  [A[c], A[p]] = [A[p], A[c]];
                  const d = A[c][c] || 1e-9;
                  for (let j = c; j <= k; j++) A[c][j] /= d;
                  for (let r = 0; r < k; r++) {
                    if (r === c) continue;
                    const f = A[r][c];
                    for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j];
                  }
                }
                const beta = A.map((r, j) => r[k] / colS[j]);
                const b0 = ybar - beta.reduce((s, b, j) => s + b * colM[j], 0);
                return { beta, b0 };
              };
              const grid = [
                0.5, 1, 2, 5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 800, 1200,
              ];
              let chosen = null;
              for (const L of grid) {
                const r = solve(L);
                const maxCh = Math.max(
                  0,
                  ...names.map((nm, j) =>
                    nm.startsWith("ln_") ? r.beta[j] * colM[j] : 0,
                  ),
                );
                if (r.b0 >= 0 && maxCh <= ybar) {
                  chosen = { ...r, lambda: L };
                  break;
                }
              }
              if (!chosen) {
                const L = grid[grid.length - 1];
                chosen = { ...solve(L), lambda: L };
              }
              const fitted = X.map(
                (r) => chosen.b0 + r.reduce((s, v, j) => s + v * chosen.beta[j], 0),
              );
              return {
                beta: chosen.beta,
                b0: chosen.b0,
                lambda: chosen.lambda,
                fitted,
              };
            }

            export function mmmMergedPanel(panel, cfg) {
              const chans = _mmmChans(panel).filter((c) => panel.ch[c.key]);
              if (chans.length < 2) return panel;
              const ln = {};
              chans.forEach(
                (c) => (ln[c.key] = mmmLnMedia(panel.ch[c.key], cfg.defaultLam)),
              );
              const parent = {};
              chans.forEach((c) => (parent[c.key] = c.key));
              const find = (x) =>
                parent[x] === x ? x : (parent[x] = find(parent[x]));
              for (let i = 0; i < chans.length; i++)
                for (let j = i + 1; j < chans.length; j++) {
                  const r = CANNIBAL_STATS.pearson(
                    ln[chans[i].key],
                    ln[chans[j].key],
                  );
                  if (Math.abs(r) >= 0.9)
                    parent[find(chans[i].key)] = find(chans[j].key);
                }
              const groups = {};
              chans.forEach((c) => {
                const g = find(c.key);
                (groups[g] = groups[g] || []).push(c);
              });
              const newCh = {},
                newChannels = [];
              for (const members of Object.values(groups)) {
                if (members.length === 1) {
                  const c = members[0];
                  newCh[c.key] = panel.ch[c.key];
                  newChannels.push({ key: c.key, label: c.label, kind: c.kind });
                } else {
                  const key = "m_" + members.map((m) => m.key).join("_");
                  const label = members.map((m) => m.label).join("+");
                  const kind = members.some((m) => m.kind !== "brand")
                    ? "perf"
                    : "brand";
                  newCh[key] = panel.week.map((_, i) =>
                    members.reduce((s, m) => s + (panel.ch[m.key][i] || 0), 0),
                  );
                  newChannels.push({ key, label, kind });
                }
              }
              return { ...panel, ch: newCh, channels: newChannels };
            }

            export function mmmWeeklyDecomp(panel, cfg, targetName, lam, model) {
              model = model || "ols";
              if (model === "merge") panel = mmmMergedPanel(panel, cfg);
              const { X, names } = mmmBuildFeatures(panel, cfg, lam, true);
              const y = panel.targets[targetName];
              const groups = mmmShapleyGroups(names, _mmmChans(panel));
              const groupNames = groups.map((g) => g.name);
              const ybar = _mean(y);
              let baseline,
                contribOf,
                fittedOf,
                level = false,
                lambda = null;
              if (model === "ridge") {
                const rf = mmmRidgeFit(X, y, names);
                if (!rf) return null;
                baseline = rf.b0;
                level = true;
                lambda = rf.lambda;
                contribOf = (t, g) => {
                  let c = 0;
                  for (const j of g.cols) c += rf.beta[j] * X[t][j];
                  return c;
                }; // LEVEL β·X
                fittedOf = (t) => rf.fitted[t];
              } else {
                const fit = mmmOls(_designConst(X), y);
                if (!fit) return null;
                const colMean = names.map((_, j) => _mean(X.map((r) => r[j])));
                baseline = ybar;
                contribOf = (t, g) => {
                  let c = 0;
                  for (const j of g.cols)
                    c += fit.beta[j + 1] * (X[t][j] - colMean[j]);
                  return c;
                }; // centered
                fittedOf = (t) =>
                  fit.beta[0] + X[t].reduce((s, v, j) => s + v * fit.beta[j + 1], 0);
              }
              const weeks = [];
              for (let t = 0; t < X.length; t++) {
                const contrib = {};
                for (const g of groups) contrib[g.name] = contribOf(t, g);
                const fitted = fittedOf(t);
                weeks.push({
                  week: panel.week[t],
                  actual: y[t],
                  baseline: +baseline.toFixed(1),
                  fitted: +fitted.toFixed(1),
                  residual: +(y[t] - fitted).toFixed(1),
                  contrib,
                });
              }
              const meanContrib = {};
              groupNames.forEach(
                (g) => (meanContrib[g] = _mean(weeks.map((w) => w.contrib[g]))),
              );
              const resids = weeks.map((w) => w.residual);
              const rMean = _mean(resids),
                rStd = Math.sqrt(_mean(resids.map((r) => (r - rMean) ** 2))) || 1;
              const spikes = weeks
                .map((w, i) => {
                  const dev = w.actual - ybar;
                  let domG = null,
                    domV = 0;
                  for (const g of groupNames) {
                    const d = w.contrib[g] - meanContrib[g];
                    if (Math.abs(d) > Math.abs(domV)) {
                      domV = d;
                      domG = g;
                    }
                  } // 평균 대비 편차
                  const unexplained = Math.abs(w.residual) > Math.abs(domV);
                  const cls = unexplained
                    ? "unexplained"
                    : MMM_NONMEDIA_GROUPS.includes(domG)
                      ? "baseline"
                      : "channel";
                  const z = Math.abs(w.residual - rMean) / rStd;
                  return {
                    i,
                    week: w.week,
                    actual: Math.round(w.actual),
                    dev: Math.round(dev),
                    residual: Math.round(w.residual),
                    domDriver: domG,
                    domVal: Math.round(domV),
                    cls,
                    z: +z.toFixed(2),
                  };
                })
                .filter((s) => s.z >= 2)
                .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))
                .slice(0, 8);
              // level: avg=평균 level 기여(채널 절대), swing=평균 대비 변동. centered: avg≈0이라 swing이 핵심.
              const driverStats = groupNames
                .map((g) => ({
                  name: g,
                  avg: +_mean(weeks.map((w) => w.contrib[g])).toFixed(1),
                  swing: +_mean(
                    weeks.map((w) => Math.abs(w.contrib[g] - meanContrib[g])),
                  ).toFixed(1),
                  media: !MMM_NONMEDIA_GROUPS.includes(g),
                }))
                .sort((a, b) =>
                  level
                    ? Math.abs(b.avg) + b.swing - (Math.abs(a.avg) + a.swing)
                    : b.swing - a.swing,
                );
              const rmse = Math.sqrt(_mean(weeks.map((w) => w.residual ** 2)));
              const mape =
                _mean(
                  weeks.map((w) => (w.actual ? Math.abs(w.residual / w.actual) : 0)),
                ) * 100;
              return {
                weeks,
                groupNames,
                baseline: +baseline.toFixed(1),
                ybar: +ybar.toFixed(1),
                level,
                model,
                lambda,
                spikes,
                driverStats,
                rmse: +rmse.toFixed(1),
                mape: +mape.toFixed(1),
                rStd: +rStd.toFixed(1),
              };
            }

            export function mmmForecast(
              panel,
              cfg,
              target,
              lam,
              model,
              futureSpend,
              horizon,
              stepOff,
              bandMode,
            ) {
              model = model || "ols";
              bandMode = bandMode || "mean"; // mean=신뢰구간(평균 추세·좁음, t·σ·√h) / pred=예측구간(개별 주·넓음, t·σ·√(1+h))
              const y = panel.targets[target];
              if (!y || !y.length) return null;
              const n = y.length,
                H = Math.max(1, Math.min(260, horizon | 0));
              const chans = _mmmChans(panel).filter((ch) => panel.ch[ch.key]);
              const RN = Math.min(8, n);
              const recentMean = {};
              chans.forEach((ch) => {
                const a = panel.ch[ch.key].slice(-RN).filter((v) => isFinite(v));
                recentMean[ch.key] = a.length
                  ? a.reduce((s, v) => s + v, 0) / a.length
                  : 0;
              });
              const lastWk = panel.week[n - 1];
              const futWeek = Array.from(
                { length: H },
                (_, j) => (isFinite(lastWk) ? lastWk : n) + j + 1,
              );
              const futSpendByKey = {};
              chans.forEach((ch) => {
                const fs = (futureSpend && futureSpend[ch.key]) || null;
                futSpendByKey[ch.key] = Array.from({ length: H }, (_, j) =>
                  fs && isFinite(fs[j]) ? fs[j] : recentMean[ch.key],
                );
              });
              const combined = {
                week: [...panel.week, ...futWeek],
                ch: {},
                dummy: {},
                steps: {},
                targets: {},
                useDummies: panel.useDummies,
              };
              chans.forEach(
                (ch) =>
                  (combined.ch[ch.key] = [
                    ...panel.ch[ch.key],
                    ...futSpendByKey[ch.key],
                  ]),
              );
              // 이벤트/구조변화/휴일더미: 관측 시리즈를 그대로(=비-forecast 파이프라인과 동일) materialize 후
              // 미래는 stepOff[key] 제어 — 빈값=지속(마지막 값·1로 끝난 이벤트는 계속 ON), 숫자 N=N기간 켜둔 뒤 0, N=0=즉시 끔.
              const obsSteps = _mmmStepSeries(panel, cfg);
              const useDum =
                panel.useDummies && panel.dummy && Object.keys(panel.dummy).length;
              const ctl = []; // 제어 대상: step + (useDummies면) 매핑 더미
              Object.keys(obsSteps).forEach((k) =>
                ctl.push({ key: k, kind: "step", obs: obsSteps[k] }),
              );
              if (useDum)
                Object.keys(panel.dummy).forEach((k) =>
                  ctl.push({ key: k, kind: "event", obs: panel.dummy[k] }),
                );
              ctl.forEach((it) => {
                const obs = it.obs,
                  lastV = obs[obs.length - 1] || 0;
                const offN = stepOff ? stepOff[it.key] : null;
                const fut = Array.from({ length: H }, (_, j) =>
                  offN != null && isFinite(offN) ? (j < offN ? lastV : 0) : lastV,
                );
                const full = [...obs, ...fut];
                if (it.kind === "step") combined.steps[it.key] = full;
                else combined.dummy[it.key] = full;
              });
              combined.targets[target] = [...y, ...Array(H).fill(NaN)];
              combined.channels = panel.channels;
              const cpanel =
                model === "merge" ? mmmMergedPanel(combined, cfg) : combined;
              const built = mmmBuildFeatures(cpanel, cfg, lam, true);
              const X = built.X,
                names = built.names;
              const Xobs = X.slice(0, n),
                Xfut = X.slice(n);
              let fittedHist,
                predFut,
                lo = [],
                hi = [],
                sigma,
                beta,
                intercept,
                r2 = 0,
                seArr = null,
                pArr = null;
              const isRidge = model === "ridge";
              if (isRidge) {
                const rf = mmmRidgeFit(Xobs, y, names);
                if (!rf) return null;
                fittedHist = rf.fitted;
                beta = rf.beta;
                intercept = rf.b0;
                predFut = Xfut.map(
                  (r) => rf.b0 + r.reduce((s, v, j) => s + v * rf.beta[j], 0),
                );
                const resid = y.map((v, i) => v - fittedHist[i]),
                  rm = _mean(resid);
                sigma = Math.sqrt(_mean(resid.map((e) => (e - rm) ** 2))) || 1;
                const ssr = resid.reduce((s, e) => s + e * e, 0),
                  ybar = _mean(y),
                  sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
                r2 = sst > 0 ? 1 - ssr / sst : 0;
                predFut.forEach((p) => {
                  lo.push(p - 1.96 * sigma);
                  hi.push(p + 1.96 * sigma);
                });
              } else {
                const fit = mmmOls(_designConst(Xobs), y);
                if (!fit) return null;
                fittedHist = fit.fitted;
                beta = fit.beta.slice(1);
                intercept = fit.beta[0];
                sigma = Math.sqrt(fit.sigma2);
                r2 = fit.r2;
                seArr = fit.se;
                pArr = fit.tvalues.map((tv) => studentTp(tv, fit.n - fit.k)); // 계수 편차·p값 (OLS만)
                const tcrit = studentTcrit(0.95, Math.max(1, fit.n - fit.k));
                const lev = (xrow) => {
                  const x = [1, ...xrow];
                  let s = 0;
                  for (let a = 0; a < x.length; a++)
                    for (let b = 0; b < x.length; b++)
                      s += x[a] * fit.XtXinv[a][b] * x[b];
                  return s;
                };
                const noise = bandMode === "pred" ? 1 : 0; // 예측구간은 개별 주 노이즈(+1) 포함, 신뢰구간(평균)은 leverage만
                predFut = Xfut.map(
                  (r) =>
                    fit.beta[0] + r.reduce((s, v, j) => s + v * fit.beta[j + 1], 0),
                );
                Xfut.forEach((r) => {
                  const se = Math.sqrt(Math.max(0, fit.sigma2 * (noise + lev(r))));
                  const p =
                    fit.beta[0] + r.reduce((s, v, j) => s + v * fit.beta[j + 1], 0);
                  lo.push(p - tcrit * se);
                  hi.push(p + tcrit * se);
                });
              }
              // 날짜·라벨 연장
              const gran = panel.granularity;
              let futDates = null,
                futLabels = null;
              if (panel.dates && gran) {
                const last = panel.dates[panel.dates.length - 1];
                if (last) {
                  futDates = Array.from(
                    { length: H },
                    (_, j) =>
                      new Date(last.getTime() + (j + 1) * gran.days * 86400000),
                  );
                  futLabels = futDates.map((d) => _mmmFmtDate(d, gran));
                }
              }
              if (!futLabels) futLabels = futWeek.map((_, j) => "+" + (j + 1));
              const histLabels =
                panel.dateLabel && panel.dateLabel.length === n
                  ? panel.dateLabel
                  : panel.week.map((_, i) => i + 1);
              // 계수표(편차·p값 포함, 절편 먼저) + 설계행렬(엑셀 수식·재료값 칼럼용)
              const coefTable = [
                {
                  term: "(Intercept)",
                  coef: intercept,
                  se: seArr ? seArr[0] : null,
                  p: pArr ? pArr[0] : null,
                },
              ].concat(
                names.map((nm, j) => ({
                  term: nm,
                  coef: beta[j],
                  se: seArr ? seArr[j + 1] : null,
                  p: pArr ? pArr[j + 1] : null,
                })),
              );
              const bandLabel =
                bandMode === "pred" ? "예측구간(개별 주)" : "신뢰구간(평균 추세)";
              return {
                model,
                lam,
                target,
                horizon: H,
                n,
                names,
                beta,
                intercept,
                isRidge,
                sigma: +sigma.toFixed(2),
                r2: +r2.toFixed(4),
                bandMode,
                bandLabel,
                coefTable,
                featMatrix: X,
                histLabels,
                futLabels,
                labels: [...histLabels, ...futLabels],
                splitAt: n,
                actual: y.slice(),
                fittedHist: fittedHist.map((v) => +v.toFixed(2)),
                predFut: predFut.map((v) => +v.toFixed(2)),
                lo: lo.map((v) => +v.toFixed(2)),
                hi: hi.map((v) => +v.toFixed(2)),
                futWeek,
                futDates,
                gran,
                chans: chans.map((ch) => ({ key: ch.key, label: ch.label })),
                futSpendByKey,
                recentMean,
                histSpendByKey: Object.fromEntries(
                  chans.map((ch) => [ch.key, panel.ch[ch.key]]),
                ),
                steps: ctl.map((it) => ({
                  key: it.key,
                  kind: it.kind,
                  label:
                    (it.kind === "step"
                      ? panel.stepDefs &&
                        (panel.stepDefs.find((s) => s.key === it.key) || {}).label
                      : panel.dummyDefs &&
                        (panel.dummyDefs.find((d) => d.key === it.key) || {})
                          .label) || it.key,
                  lastOn: (it.obs[it.obs.length - 1] || 0) > 0.5,
                })),
                stepOff: { ...(stepOff || {}) },
              };
            }

            export const MMM_NONMEDIA_GROUPS = [
              "Trend",
              "Seasonality",
              "Holidays",
              "Regime(steps)",
            ]; // 비매체 드라이버 (baseline 포함 토글 대상)

