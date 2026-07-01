import React from 'react';
import { IA, displayGroupNumber, displayItemNumber } from '@/store/useDataStore';
import { copyToClipboard } from '@/utils/toast';

// 결정론적 element id 생성기 (§3 Math.random 금지). 렌더마다 0부터 재시작해
// 같은 콘텐츠는 byte-identical 마크업을 낸다.
let __sopUid = 0;
function nextSopUid(prefix) {
  __sopUid += 1;
  return `${prefix}_${__sopUid}`;
}
function resetSopUid() {
  __sopUid = 0;
}

function renderFeedbackNudge(pageId) {
  return ""; // v2에서는 전역 모달/토스트로 대체됨 (SOP용 레거시 호환)
}

function renderDemoBanner(pageId) {
  return ""; // v2에서는 삭제됨 (SOP용 레거시 호환)
}

function escapeHtml(unsafe) { if(!unsafe) return ''; return String(unsafe).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

function hl(code, lang) {
  let s = escapeHtml(code);
  if (lang === "swift" || lang === "kotlin") {
    s = s.replace(/(\/\/[^\n]*)/g, '<span class="c">$1</span>');
    s = s.replace(
      /\b(import|let|var|val|fun|func|class|object|return|if|else|for|while|self|this|true|false|nil|null|companion|override|private|public|internal|suspend)\b/g,
      '<span class="k">$1</span>',
    );
    s = s.replace(/(&quot;[^&]*?&quot;)/g, '<span class="s">$1</span>');
    s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="n">$1</span>');
  } else if (lang === "json") {
    s = s.replace(
      /(&quot;[^&]*?&quot;)(\s*:)/g,
      '<span class="a">$1</span>$2',
    );
    s = s.replace(
      /:\s*(&quot;[^&]*?&quot;)/g,
      ': <span class="s">$1</span>',
    );
    s = s.replace(/\b(true|false|null)\b/g, '<span class="k">$1</span>');
    s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="n">$1</span>');
  } else if (lang === "bash") {
    s = s.replace(
      /(^|\n)(\s*)(#[^\n]*)/g,
      '$1$2<span class="c">$3</span>',
    );
    s = s.replace(
      /\b(curl|export|echo|cd|grep|adjust|adb|xcrun)\b/g,
      '<span class="k">$1</span>',
    );
    s = s.replace(/(--?[a-zA-Z][\w-]*)/g, '<span class="t">$1</span>');
  } else if (lang === "http") {
    s = s.replace(
      /\b(GET|POST|PUT|PATCH|DELETE)\b/g,
      '<span class="k">$1</span>',
    );
    s = s.replace(/(\{[^}]+\})/g, '<span class="t">$1</span>');
  }
  return s;
}

            function codeBlock(lang, label, code) {
              const id = nextSopUid("cb");
              return `
          <div class="code-block">
            <div class="code-block-header">
              <div class="code-lang ${lang}"><span class="lang-dot"></span>${label || lang.toUpperCase()}</div>
              <button class="copy-btn" data-copy-target="${id}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copy
              </button>
            </div>
            <pre id="${id}"><code>${hl(code, lang)}</code></pre>
          </div>`;
            }

            function dataTable(headers, rows, opts = {}) {
              const id = nextSopUid("tb");
              const head = headers
                .map(
                  (h, i) =>
                    `<th data-col="${i}" data-type="${h.type || "string"}">${escapeHtml(h.label)}<span class="sort-icon">↕</span></th>`,
                )
                .join("");
              const body = rows
                .map(
                  (r) =>
                    "<tr>" +
                    r
                      .map((cell) => {
                        if (cell && typeof cell === "object" && "html" in cell)
                          return `<td class="${cell.cls || ""}">${cell.html}</td>`;
                        return `<td>${escapeHtml(String(cell))}</td>`;
                      })
                      .join("") +
                    "</tr>",
                )
                .join("");
              return `
          <div class="table-wrap">
            <table class="data" id="${id}" data-sortable="1">
              <thead><tr>${head}</tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>`;
            }

            // 사이드바/랜딩 렌더러(구 pageHome/renderNav/renderLandingGuide 등)는
            // React 컴포넌트(Sidebar.jsx/LandingPage.jsx/Header.jsx)로 대체되어
            // PAGE_RENDERERS_MAP에서 호출되지 않는 죽은 코드였음 — 정리(SECTIONS 전환 시).

            /* ---------- 1-1 (Full quality) ---------- */
            function page_1_1() {
              return `
          <div class="page-eyebrow">1 Foundation · 1-1</div>
          <h1 class="page-title">개발자 협업 가이드 및 테크니컬 PRD</h1>
          <p class="page-deck">MMP(Adjust) SDK 초기화 스펙, 딥링크 라우팅 로직, 그리고 릴리즈 전 QA 시나리오를 단일 문서로 통합한 개발 협업 표준. 본 문서가 그대로 PRD가 되도록 작성됨.</p>

          <div class="meta-row">
            <span class="chip"><span class="dot"></span>담당 · Growth Eng.</span>
            <span class="chip"><span class="dot"></span>Adjust SDK ≥ v5.0.0</span>
            <span class="chip warning"><span class="dot"></span>iOS 14.5+ 필수</span>
          </div>

          <div class="with-toc">
            <div>
              <div class="summary">
                <div class="summary-label">핵심 요약</div>
                <p>본 문서는 신규 앱 또는 리뉴얼 앱의 어트리뷰션 기반 마련을 위해 개발팀이 구현해야 할 <strong>최소 필수 스펙</strong>을 정의한다. Adjust SDK v5 초기화 → 디퍼드 딥링크 라우팅 → 릴리즈 QA 체크리스트의 3단 게이트를 통과한 빌드만 LIVE 캠페인에 진입한다. 잘못 셋업된 SDK 한 줄이 전 캠페인 데이터를 무효화시키므로, 모든 항목은 <strong>코드 리뷰 + QA Lead 더블 사인오프</strong>를 강제한다.</p>
              </div>

              <section class="block" id="s-prereq">
                <h2 class="section-title"><span class="ix">§1</span>사전 요구사항</h2>
                <ul>
                  <li><strong>Adjust 대시보드 권한</strong>: App Token (iOS/Android 분리), Environment(sandbox/production), Default Tracker 발급 완료</li>
                  <li><strong>Bundle ID / Package Name</strong> 사전 등록. Android는 <code class="inline">applicationId</code> 기준, iOS는 App Store Connect의 <code class="inline">Bundle Identifier</code> 기준</li>
                  <li><strong>StoreKit 2 + ATTrackingManager</strong> 의존성 및 iOS 14.5+ 지원</li>
                  <li><strong>App Links / Universal Links</strong> 도메인 검증 파일 호스팅 (<code class="inline">.well-known/apple-app-site-association</code>, <code class="inline">.well-known/assetlinks.json</code>)</li>
                </ul>
              </section>

              <section class="block" id="s-sdk">
                <h2 class="section-title"><span class="ix">§2</span>구현 단계</h2>

                <h3 class="sub-title">2.1 iOS · Adjust SDK 초기화 (Swift, AppDelegate)</h3>
                <p>초기화는 <strong>반드시 ATT 프롬프트 응답 후</strong> 진행한다. 프롬프트 이전 초기화 시 IDFA가 영구적으로 0으로 고정되어 attribution이 SKAdNetwork 단일 채널로 강제 다운그레이드된다.</p>
                ${codeBlock(
                  "swift",
                  "iOS · AppDelegate.swift",
                  `import Adjust
      import AdjustSdk
      import AppTrackingTransparency

      func application(_ application: UIApplication,
                       didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

          let appToken = "abc1234xyz9"  // Production token
          let environment = ADJEnvironmentProduction

          let config = ADJConfig(appToken: appToken,
                                 environment: environment,
                                 allowSuppressLogLevel: false)
          config?.logLevel = ADJLogLevelInfo
          config?.needsCost = true                 // ROAS 계산용 비용 데이터
          config?.linkMeMetadata = true            // LinkMe 클립보드 매칭 활성화
          // attConsentWaitingInterval: Adjust가 ATT 응답을 기다리는 최대 시간(초).
          // 응답이 늦어도 첫 install/session 이벤트를 발화시키는 fallback 타이머이며,
          // ATT 프롬프트 자체의 표시 시간과는 무관 (App Store 가이드라인과 별개 영역).
          // 120초 = ATT 응답 확보율 최대화 우선 운영.
          config?.attConsentWaitingInterval = 120

          // SKAN 4.0 ConversionValue 업데이트 위임
          config?.delegate = SKANDelegateHandler.shared

          Adjust.appDidLaunch(config)

          // ATT 프롬프트는 사용자가 앱의 가치를 인지한 시점에 호출 (온보딩 완료 후 등).
          // 첫 실행 즉시 호출하면 거부율↑, 또한 너무 빠른 호출은 사용자 컨텍스트 부재로 reject 사유.
          // 1-4 가이드의 ATT 디자인 패턴 참고.
          OnboardingState.shared.onCompleted = {
              ATTrackingManager.requestTrackingAuthorization { _ in
                  Adjust.requestTrackingAuthorization { status in
                      // status: 0 Not Determined / 3 Authorized
                      print("[ATT] status=\\(status)")
                  }
              }
          }
          return true
      }`,
                )}

                <h3 class="sub-title">2.2 Android · Adjust SDK 초기화 (Kotlin, Application 클래스)</h3>
                <p>Application 서브클래스에서 <strong>최상위 onCreate</strong>에 위치시켜야 한다. 외부 라이브러리(Firebase 등)보다 늦게 초기화될 경우, 첫 세션의 install referrer가 누락된다.</p>
                ${codeBlock(
                  "kotlin",
                  "Android · App.kt",
                  `import android.app.Application
      import com.adjust.sdk.Adjust
      import com.adjust.sdk.AdjustConfig
      import com.adjust.sdk.LogLevel

      class App : Application() {
          override fun onCreate() {
              super.onCreate()

              val appToken = "abc1234xyz9"
              val environment = AdjustConfig.ENVIRONMENT_PRODUCTION

              val config = AdjustConfig(this, appToken, environment).apply {
                  setLogLevel(LogLevel.INFO)
                  setNeedsCost(true)
                  setPreinstallTrackingEnabled(true)        // 사전탑재 트래킹
                  setSendInBackground(true)                 // 백그라운드 전송
                  setEventBufferingEnabled(false)           // 실시간 캠페인 운영 시 false
                  setOnAttributionChangedListener { attr ->
                      // network_name / campaign_name / adgroup_name / creative_name
                      AppAnalytics.bindAttribution(attr)
                  }
                  setOnDeeplinkResponseListener { uri ->
                      DeeplinkRouter.handle(uri)            // 디퍼드 딥링크 라우팅
                      true
                  }
              }

              Adjust.onCreate(config)
              registerActivityLifecycleCallbacks(AdjustLifecycleCallbacks())
          }
      }`,
                )}

                <h3 class="sub-title">2.3 딥링크 라우팅 로직 (디퍼드 포함)</h3>
                <p>3가지 진입점을 단일 라우터로 통합한다: <strong>(a)</strong> Universal Link / App Link 진입, <strong>(b)</strong> 커스텀 URI 스킴, <strong>(c)</strong> Adjust 디퍼드 딥링크(미설치 상태에서 스토어 경유 후 첫 실행 시 발화). 라우터는 항상 <code class="inline">scheme://host/path?params</code> 표준형으로 정규화한 뒤 분기한다.</p>
                ${codeBlock(
                  "kotlin",
                  "Android · DeeplinkRouter.kt",
                  `object DeeplinkRouter {
          fun handle(uri: Uri): Boolean {
              val path = uri.pathSegments.firstOrNull() ?: return openHome()
              return when (path) {
                  "product" -> openProduct(uri.lastPathSegment ?: return openHome())
                  "promo"   -> openPromo(uri.getQueryParameter("code"))
                  "invite"  -> openReferral(uri.getQueryParameter("ref"))
                  else      -> openHome()
              }.also {
                  Analytics.track("deeplink_opened", mapOf(
                      "deeplink_path"   to uri.path.orEmpty(),
                      "deeplink_source" to (uri.getQueryParameter("utm_source") ?: "direct"),
                      "is_deferred"     to (DeferredFlag.consume())
                  ))
              }
          }
      }`,
                )}

                <h3 class="sub-title">2.4 표준 URL 스키마</h3>
                <p>매체 트래커 URL은 <strong>Adjust Custom URL</strong>에 아래 스키마를 강제한다. 모든 매크로는 매체별 placeholder를 사용하며, 임의 추가는 불가하다.</p>
                ${codeBlock(
                  "http",
                  "Adjust Click URL Template",
                  `https://app.adjust.com/{tracker_token}
        ?campaign={campaign_name}
        &adgroup={adgroup_name}
        &creative={creative_name}
        &idfa={idfa}            // iOS 14.5+ 에서는 자동 0 처리
        &gps_adid={gps_adid}    // Google Play Services ADID
        &cost_type=cpc
        &cost_amount={cost}
        &cost_currency=USD
        &deeplink=myapp%3A%2F%2Fproduct%2F{product_id}
        &fallback=https%3A%2F%2Fwww.example.com%2Fproduct%2F{product_id}`,
                )}
              </section>

              <section class="block" id="s-qa">
                <h2 class="section-title"><span class="ix">§3</span>QA 시나리오 (릴리즈 게이트)</h2>
                <p>아래 12개 시나리오를 모두 PASS해야 LIVE 빌드로 승인된다. 실패 1건 = 빌드 반려.</p>
                ${dataTable(
                  [
                    { label: "ID", type: "string" },
                    { label: "Scenario", type: "string" },
                    { label: "Expected", type: "string" },
                    { label: "Severity", type: "string" },
                    { label: "Tool", type: "string" },
                  ],
                  [
                    [
                      "QA-01",
                      "신규 설치 → 첫 세션 발화",
                      "install + session_start 1회씩 발화",
                      { html: '<span class="pill tier-1">Blocker</span>' },
                      "Adjust Testing Console",
                    ],
                    [
                      "QA-02",
                      "ATT 프롬프트 Authorized 케이스",
                      "IDFA 비공백, attribution sandbox에 도달",
                      { html: '<span class="pill tier-1">Blocker</span>' },
                      "Charles Proxy",
                    ],
                    [
                      "QA-03",
                      "ATT Denied 케이스",
                      "IDFA=00000... 0, SKAN 단일 채널 정상 동작",
                      { html: '<span class="pill tier-1">Blocker</span>' },
                      "Console",
                    ],
                    [
                      "QA-04",
                      "Universal Link 콜드 스타트",
                      "DeeplinkRouter.handle 1회 호출",
                      { html: '<span class="pill tier-2">Major</span>' },
                      "Safari → 앱 전환",
                    ],
                    [
                      "QA-05",
                      "디퍼드 딥링크 (미설치 → 설치)",
                      "최초 실행 시 onDeeplinkResponse 발화",
                      { html: '<span class="pill tier-1">Blocker</span>' },
                      "Test Console + Test Device",
                    ],
                    [
                      "QA-06",
                      "커스텀 URI 스킴 (외부 브라우저)",
                      "Router 분기 정확",
                      { html: '<span class="pill tier-2">Major</span>' },
                      "adb shell am start",
                    ],
                    [
                      "QA-07",
                      "백그라운드 ↔ 포그라운드 전환",
                      "session 중복 발화 없음",
                      { html: '<span class="pill tier-2">Major</span>' },
                      "Adjust Logs",
                    ],
                    [
                      "QA-08",
                      "비행기 모드 → 온라인 복귀",
                      "이벤트 큐잉 후 1회만 전송",
                      { html: '<span class="pill tier-2">Major</span>' },
                      "Charles",
                    ],
                    [
                      "QA-09",
                      "SKAN postback (Apple Test Mode)",
                      "coarse value [low|medium|high] 매핑 정상",
                      { html: '<span class="pill tier-1">Blocker</span>' },
                      "xcrun simctl + Apple Console",
                    ],
                    [
                      "QA-10",
                      "Cost data 수신 (UAC/AAP)",
                      "Adjust 대시보드에 cost_amount 노출",
                      { html: '<span class="pill tier-3">Minor</span>' },
                      "Adjust > Cost Data",
                    ],
                    [
                      "QA-11",
                      "in_app_purchase 매출 이벤트",
                      "revenue + currency 정확",
                      { html: '<span class="pill tier-1">Blocker</span>' },
                      "StoreKit Test",
                    ],
                    [
                      "QA-12",
                      "Uninstall + Reinstall",
                      "reattribution 분류 정상",
                      { html: '<span class="pill tier-2">Major</span>' },
                      "Adjust > Reattribution",
                    ],
                  ],
                )}
              </section>

              <section class="block" id="s-troubleshoot">
                <h2 class="section-title"><span class="ix">§4</span>트러블슈팅 / 함정</h2>

                <div class="callout danger">
                  <div class="ico">!</div>
                  <div class="body">
                    <strong>install 이벤트가 중복 발화된다</strong>
                    <p>Adjust.appDidLaunch가 Application과 AppDelegate 양쪽에서 호출되는 경우. Application 클래스에서 단 1회만 호출되도록 통일하고, ActivityLifecycleCallbacks는 register는 하되 SDK 초기화는 분리한다.</p>
                  </div>
                </div>

                <div class="callout warn">
                  <div class="ico">!</div>
                  <div class="body">
                    <strong>iOS에서 attribution이 organic으로만 잡힌다</strong>
                    <p>1) ATT 프롬프트가 SDK 초기화 이후에 호출되었는지 확인. 2) <code class="inline">attConsentWaitingInterval</code>이 너무 짧으면 사용자가 응답하기 전 install이 noIDFA로 굳어버림 — 120초로 설정해 응답 윈도우 확보. 3) LinkMe 도메인이 매체별 클릭 URL에 일치하는지 확인.</p>
                  </div>
                </div>

                <div class="callout warn">
                  <div class="ico">!</div>
                  <div class="body">
                    <strong>디퍼드 딥링크가 첫 실행에 발화되지 않는다</strong>
                    <p>Android: Play Install Referrer API 의존성 누락 가능성. <code class="inline">com.android.installreferrer:installreferrer:2.2</code> 추가. iOS: Universal Links의 <code class="inline">apple-app-site-association</code>가 HTTPS, Content-Type=application/json으로 서빙되는지 검증.</p>
                  </div>
                </div>

                <div class="callout info">
                  <div class="ico">i</div>
                  <div class="body">
                    <strong>Sandbox에서 production 토큰을 잘못 사용 중</strong>
                    <p>환경 분리는 <code class="inline">BuildConfig.DEBUG</code> 또는 <code class="inline">#if DEBUG</code>로 빌드 타임에 분기. Sandbox 토큰을 Production에 사용하면 raw event는 Adjust에 도달하지만 attribution은 발생하지 않음.</p>
                  </div>
                </div>
              </section>

              <section class="block" id="s-handoff">
                <h2 class="section-title"><span class="ix">§5</span>인수인계 체크리스트</h2>
                <p>QA Lead → Growth PM 인수인계 전 확인:</p>
                <ul>
                  <li>Adjust 대시보드 raw export 1일치 다운로드, 디버그 트래픽 분리 검증</li>
                  <li>SKAN postback 수신 endpoint 등록 (<code class="inline">skadnetwork.adjust.com</code>) 및 partner re-direct ON</li>
                  <li>Firebase / Amplitude 등 2nd-party 분석 툴과 user_id 키 정합성 확인</li>
                  <li>Adjust → BigQuery / S3 export 파이프라인 sync 확인</li>
                </ul>
              </section>

              <div class="page-footer">
                <span>1-1. Developer Collaboration & Technical PRD</span>
                <span>Updated · 2026-05-22</span>
              </div>
            </div>

            <aside class="toc">
              <div class="toc-title">목차</div>
              <a href="#s-prereq">사전 요구사항</a>
              <a href="#s-sdk">구현 단계</a>
              <a href="#s-qa">QA 시나리오</a>
              <a href="#s-troubleshoot">트러블슈팅</a>
              <a href="#s-handoff">인수인계 체크리스트</a>
            </aside>
          </div>
        `;
            }

            /* ---------- 1-2 (Full quality) ---------- */
            function page_1_2() {
              const taxonomyRows = [
                [
                  "session_start",
                  "Lifecycle",
                  "앱 포그라운드 진입",
                  "platform, app_version, network_type",
                  { html: '<span class="pill tier-1">Tier-1</span>' },
                  "auto",
                ],
                [
                  "sign_up",
                  "Acquisition",
                  "회원가입 완료",
                  "method(email|kakao|apple), user_grade",
                  { html: '<span class="pill tier-1">Tier-1</span>' },
                  "manual",
                ],
                [
                  "login",
                  "Lifecycle",
                  "기존 사용자 로그인",
                  "method, days_since_last_login",
                  { html: '<span class="pill tier-2">Tier-2</span>' },
                  "manual",
                ],
                [
                  "onboarding_complete",
                  "Activation",
                  "온보딩 마지막 스텝 종료",
                  "duration_sec, skipped(bool)",
                  { html: '<span class="pill tier-1">Tier-1</span>' },
                  "manual",
                ],
                [
                  "product_view",
                  "Funnel",
                  "상품 상세 조회",
                  "product_id, category, price, currency",
                  { html: '<span class="pill tier-2">Tier-2</span>' },
                  "manual",
                ],
                [
                  "add_to_cart",
                  "Funnel",
                  "장바구니 추가",
                  "product_id, quantity, price",
                  { html: '<span class="pill tier-1">Tier-1</span>' },
                  "manual",
                ],
                [
                  "begin_checkout",
                  "Funnel",
                  "결제 화면 진입",
                  "cart_value, item_count",
                  { html: '<span class="pill tier-1">Tier-1</span>' },
                  "manual",
                ],
                [
                  "purchase",
                  "Revenue",
                  "결제 완료 (트랜잭션)",
                  "transaction_id, revenue, currency, payment_method",
                  { html: '<span class="pill tier-1">Tier-1</span>' },
                  "manual",
                ],
                [
                  "subscribe",
                  "Revenue",
                  "구독 시작 (Trial 포함)",
                  "plan_id, trial(bool), revenue",
                  { html: '<span class="pill tier-1">Tier-1</span>' },
                  "manual",
                ],
                [
                  "refund",
                  "Revenue",
                  "환불 처리",
                  "transaction_id, refund_amount",
                  { html: '<span class="pill tier-2">Tier-2</span>' },
                  "server",
                ],
                [
                  "share",
                  "Engagement",
                  "외부 공유 액션",
                  "channel(km|fb|link), content_type",
                  { html: '<span class="pill tier-3">Tier-3</span>' },
                  "manual",
                ],
                [
                  "push_open",
                  "Re-engagement",
                  "푸시 알림 진입",
                  "campaign_id, segment",
                  { html: '<span class="pill tier-2">Tier-2</span>' },
                  "manual",
                ],
              ];

              return `
          <div class="page-eyebrow">1 Foundation · 1-2</div>
          <h1 class="page-title">인앱 이벤트 택소노미 설계서</h1>
          <p class="page-deck">비즈니스 핵심 퍼널을 단일 진실 원천(SSOT)으로 정의하는 이벤트 스펙. 매체 최적화 시그널, 코호트 분석, LTV 검증의 기반이 되며, <strong>이름·파라미터·발화 시점</strong> 3요소가 모두 표준화된다.</p>

          <div class="meta-row">
            <span class="chip"><span class="dot"></span>담당 · Growth + Product</span>
            <span class="chip"><span class="dot"></span>명명 규칙 · snake_case</span>
            <span class="chip warning"><span class="dot"></span>Tier-1 이벤트 <span class="tnum">12</span>개</span>
          </div>

          <div class="with-toc">
            <div>
              <div class="summary">
                <div class="summary-label">핵심 요약</div>
                <p>본 택소노미는 <strong>퍼널 7단(Install → Activate → Convert → Retain → Refer → Monetize → Reactivate)</strong>을 12개의 Tier-1 이벤트로 압축한다. 모든 이벤트는 <code class="inline">snake_case</code> 명명, 영문 소문자, 동사+명사 또는 명사+상태 구조를 강제한다. Tier-1은 매체 최적화 시그널(UAC/AAP/ASA tCPA) 및 SKAN Conversion Value 매핑의 입력값으로 사용되며, 임의 변경 시 캠페인 러닝 데이터를 폐기하고 재학습이 필요하다.</p>
              </div>

              <section class="block" id="s-principles">
                <h2 class="section-title"><span class="ix">§1</span>명명 원칙</h2>
                <ul>
                  <li><strong>snake_case 강제</strong>: <code class="inline">addToCart</code>(X) → <code class="inline">add_to_cart</code>(O). Camel/Pascal/Kebab 혼용 금지</li>
                  <li><strong>동사+명사 또는 명사+상태</strong>: <code class="inline">view_product</code> 대신 <code class="inline">product_view</code> (GA4 표준 정합)</li>
                  <li><strong>예약 이벤트명 회피</strong>: <code class="inline">session_start</code>, <code class="inline">first_open</code>, <code class="inline">in_app_purchase</code> 등 Adjust/Firebase 예약어는 자체 정의 불가. Adjust의 <code class="inline">in_app_purchase</code>는 자동 매핑되도록 <code class="inline">purchase</code> 이벤트로 매출 송신</li>
                  <li><strong>최대 길이 40자</strong>, 파라미터 키 25자, 값 100자 이내</li>
                  <li><strong>PII 절대 금지</strong>: email, phone, name, address, device_token 직접 송신 금지. 필요한 경우 hash(SHA-256) + salt 후 전송</li>
                  <li><strong>currency는 ISO 4217</strong> 3자리 (KRW, USD, JPY). revenue는 단일 통화로 정규화하지 말고 currency 파라미터를 항상 동반</li>
                </ul>
              </section>

              <section class="block" id="s-master">
                <h2 class="section-title"><span class="ix">§2</span>이벤트 마스터 목록</h2>
                <p>컬럼 헤더를 클릭하면 정렬됩니다. Tier-1은 매체 최적화 신호로 사용되는 핵심 이벤트입니다.</p>
                ${dataTable(
                  [
                    { label: "Event Name", type: "string" },
                    { label: "Funnel Stage", type: "string" },
                    { label: "Trigger", type: "string" },
                    { label: "Required Params", type: "string" },
                    { label: "Tier", type: "string" },
                    { label: "Source", type: "string" },
                  ],
                  taxonomyRows,
                )}
              </section>

              <section class="block" id="s-params">
                <h2 class="section-title"><span class="ix">§3</span>표준 파라미터 스펙</h2>
                ${dataTable(
                  [
                    { label: "Parameter", type: "string" },
                    { label: "Type", type: "string" },
                    { label: "Example", type: "string" },
                    { label: "Required", type: "string" },
                    { label: "Description", type: "string" },
                  ],
                  [
                    [
                      "transaction_id",
                      "string",
                      "tx_20260525_a91b3",
                      "Yes (purchase)",
                      "결제 트랜잭션 유니크 식별자. 중복 송신 차단 키",
                    ],
                    [
                      "revenue",
                      "decimal(10,2)",
                      "29900.00",
                      "Yes (purchase)",
                      "VAT 포함 매출. 음수는 환불 시에만 허용",
                    ],
                    [
                      "currency",
                      "string(3)",
                      "KRW",
                      "Yes (purchase)",
                      "ISO 4217 통화 코드",
                    ],
                    [
                      "product_id",
                      "string",
                      "sku_88421",
                      "Yes (commerce)",
                      "내부 SKU. 카탈로그 매칭 키",
                    ],
                    [
                      "category",
                      "string",
                      "outerwear",
                      "No",
                      "L1 카테고리. 슬래시 구분으로 L2까지 표기 가능",
                    ],
                    ["quantity", "integer", "2", "Yes (cart)", "수량. 1 이상 정수"],
                    [
                      "price",
                      "decimal(10,2)",
                      "14950.00",
                      "Yes (cart)",
                      "단가. revenue = price × quantity",
                    ],
                    [
                      "payment_method",
                      "string",
                      "card_visa",
                      "Yes (purchase)",
                      "card_* / kakaopay / naverpay / applepay / googlepay",
                    ],
                    [
                      "user_grade",
                      "string",
                      "vip",
                      "No",
                      "guest / new / regular / vip 4단계",
                    ],
                    [
                      "screen",
                      "string",
                      "home_main",
                      "No",
                      "발화 시점 화면명. 스크린명은 별도 사전 관리",
                    ],
                  ],
                )}
              </section>

              <section class="block" id="s-payload">
                <h2 class="section-title"><span class="ix">§4</span>참조 페이로드</h2>
                <p>모든 클라이언트 SDK는 아래 JSON 구조로 직렬화한 후 Adjust SDK의 <code class="inline">ADJEvent / AdjustEvent</code>에 매핑한다. 서버 사이드 송신 시 동일 페이로드를 S2S endpoint로 전달한다.</p>
                ${codeBlock(
                  "json",
                  "Event Payload · purchase",
                  `{
        "event_token": "p4q7zx",
        "event_name": "purchase",
        "timestamp_ms": 1779360000000,
        "user": {
          "user_id_hashed": "sha256:8a7d...e1c2",
          "user_grade": "regular",
          "is_logged_in": true
        },
        "params": {
          "transaction_id": "tx_20260525_a91b3",
          "revenue": 29900.00,
          "currency": "KRW",
          "payment_method": "kakaopay",
          "item_count": 2,
          "products": [
            { "product_id": "sku_88421", "category": "outerwear", "price": 14950.00, "quantity": 2 }
          ],
          "screen": "checkout_complete"
        },
        "context": {
          "platform": "android",
          "app_version": "4.12.0",
          "network_type": "wifi",
          "ab_variant": "ckt_v3_B"
        }
      }`,
                )}

                <h3 class="sub-title">4.1 Adjust 매핑 (Kotlin)</h3>
                ${codeBlock(
                  "kotlin",
                  "TaxonomyMapper.kt",
                  `fun trackPurchase(tx: Transaction) {
          val event = AdjustEvent("p4q7zx").apply {
              setRevenue(tx.revenue, tx.currency)
              setOrderId(tx.id)                      // dedup key
              addCallbackParameter("payment_method", tx.method)
              addCallbackParameter("item_count", tx.items.size.toString())
              addPartnerParameter("ab_variant", tx.abVariant)
          }
          Adjust.trackEvent(event)
      }`,
                )}
              </section>

              <section class="block" id="s-versioning">
                <h2 class="section-title"><span class="ix">§5</span>버전 관리 및 거버넌스</h2>
                <ul>
                  <li><strong>v{major}.{minor}</strong> 형식. Tier-1 이벤트 추가/삭제는 major, 파라미터 추가는 minor</li>
                  <li><strong>Deprecation 정책</strong>: 60일 dual-write 기간 유지 후 구 이벤트 송신 중단. 매체 최적화 모델은 신 이벤트로 재학습 필요</li>
                  <li><strong>변경 요청</strong>은 Notion DB의 Taxonomy Change Request 템플릿으로만 접수. Growth Lead + Data Eng + iOS/Android Lead 3자 승인</li>
                </ul>
              </section>

              <section class="block" id="s-pitfalls">
                <h2 class="section-title"><span class="ix">§6</span>트러블슈팅 / 함정</h2>

                <div class="callout danger">
                  <div class="ico">!</div>
                  <div class="body">
                    <strong>revenue가 매체 대시보드에서 항상 0으로 보고된다</strong>
                    <p>1) <code class="inline">setRevenue</code> 호출 전에 currency가 누락. 2) Adjust 대시보드에서 해당 event_token이 <strong>Revenue Event</strong>로 체크되지 않음. 3) 클라이언트 통화와 매체 reporting currency 불일치 시 FX 변환 누락. 매체별 reporting currency를 단일 KRW 또는 USD로 통일 권장.</p>
                  </div>
                </div>

                <div class="callout warn">
                  <div class="ico">!</div>
                  <div class="body">
                    <strong>중복 purchase 이벤트로 ROAS가 부풀려진다</strong>
                    <p>StoreKit/Play Billing의 결제 콜백이 retry되며 동일 트랜잭션을 다회 송신하는 패턴. <code class="inline">transaction_id</code>를 Adjust <code class="inline">orderId</code>에 강제 매핑하고 SDK 레벨 dedup에 위임. 또한 서버 검증(Receipt Validation) 완료 후에만 클라이언트가 이벤트를 발화하도록 시점을 강제.</p>
                  </div>
                </div>

                <div class="callout warn">
                  <div class="ico">!</div>
                  <div class="body">
                    <strong>UAC tCPA 캠페인이 학습 단계에서 빠져나가지 못한다</strong>
                    <p>Tier-1 이벤트 발화량이 주당 30건 미만이면 머신러닝이 수렴하지 않음. 발화량이 부족하면 conversion 정의를 <code class="inline">purchase</code> → <code class="inline">add_to_cart</code> 또는 <code class="inline">begin_checkout</code> 등 상위 퍼널 이벤트로 일시 변경하여 학습량 확보 후 재전환.</p>
                  </div>
                </div>

                <div class="callout info">
                  <div class="ico">i</div>
                  <div class="body">
                    <strong>PII가 파라미터에 포함되었다</strong>
                    <p>이메일/전화번호가 product_id에 섞이거나, search_keyword에 자유 입력값이 들어가는 케이스. 출시 전 Adjust raw export에서 정규식(<code class="inline">@</code>, 010, +) 필터로 1차 스캔. 적발 시 즉시 해당 파라미터를 hash 처리 또는 제거하고 매체사 데이터 삭제 요청 절차 가동.</p>
                  </div>
                </div>
              </section>

              <div class="page-footer">
                <span>1-2. In-App Event Taxonomy v2.4</span>
                <span>Updated · 2026-05-20</span>
              </div>
            </div>

            <aside class="toc">
              <div class="toc-title">목차</div>
              <a href="#s-principles">명명 원칙</a>
              <a href="#s-master">이벤트 마스터 목록</a>
              <a href="#s-params">표준 파라미터 스펙</a>
              <a href="#s-payload">참조 페이로드</a>
              <a href="#s-versioning">버전 관리 및 거버넌스</a>
              <a href="#s-pitfalls">트러블슈팅</a>
            </aside>
          </div>
        `;
            }

            /* ========== 데이터 기반 페이지 렌더링 엔진 ==========
         content/pages/{id}.json 형식의 데이터를 비동기로 로드해 HTML로 변환한다.
         스키마 정의: /content/schema.md 참조. */

            const PAGE_DATA_CACHE = {};
            // 이 Set에 등록된 페이지 ID는 JSON 데이터 기반으로 렌더.
            // 등록되지 않은 페이지는 기존 PAGE_RENDERERS 함수를 사용 (점진 마이그레이션).
            const DATA_BASED_PAGES = new Set(["1-1"]);

            async function loadPageData(id) {
              if (PAGE_DATA_CACHE[id]) return PAGE_DATA_CACHE[id];
              try {
                const res = await fetch(`./content/pages/${id}.json`, {
                  cache: "no-cache",
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                PAGE_DATA_CACHE[id] = data;
                return data;
              } catch (e) {
                console.warn(`[content] ${id}.json 로드 실패:`, e.message);
                return null;
              }
            }

            function renderChips(chips = []) {
              return chips
                .map((c) => {
                  const variant = c.variant ? ` ${c.variant}` : "";
                  return `<span class="chip${variant}"><span class="dot"></span>${c.label || ""}</span>`;
                })
                .join("");
            }

            function renderBlock(block) {
              if (!block || !block.type) return "";
              switch (block.type) {
                case "paragraph":
                  return `<p>${block.html != null ? block.html : escapeHtml(block.text || "")}</p>`;

                case "subheading":
                  return `<h3 class="sub-title">${escapeHtml(block.title || "")}</h3>`;

                case "list": {
                  const tag = block.ordered ? "ol" : "ul";
                  const items = (block.items || [])
                    .map((i) => `<li>${i}</li>`)
                    .join("");
                  return `<${tag}>${items}</${tag}>`;
                }

                case "code":
                  return codeBlock(
                    block.lang || "bash",
                    block.label || "",
                    block.code || "",
                  );

                case "table": {
                  const headers = (block.headers || []).map((h) => ({
                    label: h.label,
                    type: h.type || "string",
                  }));
                  const rows = (block.rows || []).map((row) =>
                    row.map((cell) => {
                      if (cell && typeof cell === "object") {
                        if (cell.pill)
                          return {
                            html: `<span class="pill ${cell.pill}">${escapeHtml(cell.text || "")}</span>`,
                          };
                        if (cell.html != null) return { html: cell.html };
                      }
                      return cell;
                    }),
                  );
                  return dataTable(headers, rows);
                }

                case "callout": {
                  const variant = block.variant || "info";
                  const iconChar = variant === "info" ? "i" : "!";
                  return `
              <div class="callout ${variant}">
                <div class="ico">${iconChar}</div>
                <div class="body">
                  ${block.title ? `<strong>${escapeHtml(block.title)}</strong>` : ""}
                  ${block.html != null ? `<p>${block.html}</p>` : ""}
                </div>
              </div>`;
                }

                default:
                  return "";
              }
            }

            function renderSections(sections = []) {
              return sections
                .map((s) => {
                  if (s.type !== "section") return "";
                  return `
            <section class="block" id="${escapeHtml(s.id || "")}">
              <h2 class="section-title">
                ${s.ix ? `<span class="ix">${escapeHtml(s.ix)}</span>` : ""}
                ${escapeHtml(s.title || "")}
              </h2>
              ${(s.content || []).map(renderBlock).join("")}
            </section>
          `;
                })
                .join("");
            }

            async function renderPageFromData(id) {
              const data = await loadPageData(id);
              if (!data) return null;
              const meta = findMeta(id);
              if (!meta) return null;
              return pageShell(meta, {
                deck: data.deck || meta.desc,
                chips: renderChips(data.chips),
                summary: data.summary || "",
                toc: data.toc || [],
                body: renderSections(data.body || []),
              });
            }

            /* ---------- Common page wrapper ---------- */
function findMeta(id) {
  for (const g of IA) {
    const it = g.items.find((x) => x.id === id);
    if (it) return { ...it, group: g };
  }
  return null;
}

            function pageShell(meta, opts) {
              const group = IA.find((g) => g.items.some((it) => it.id === meta.id));
              const tocAside = `
          <aside class="toc">
            ${opts.tocFilters ? `<div class="toc-filters">${opts.tocFilters}</div>` : ""}
            <div class="toc-title">목차</div>
            ${(opts.toc || []).map((t) => `<a href="#${t.id}">${escapeHtml(t.title)}</a>`).join("")}
          </aside>`;
              const footer = `
          <div class="page-footer">
            <span>${displayItemNumber(meta.id)}. ${escapeHtml(meta.title)}</span>
            <span>최종 업데이트 · 2026-05-22</span>
          </div>`;
              const summary = opts.summary
                ? `<div class="summary"><div class="summary-label">핵심 요약</div><p>${opts.summary}</p></div>`
                : "";

              // 분석 도구(5-x): 압축 sticky 바 + eyebrow/deck 생략
              if (/^5-/.test(meta.id)) {
                return `
            <div class="page-sticky-bar">
              <div class="page-sticky-row1">
                <span class="page-sticky-title">${escapeHtml(meta.title)}</span>
                ${opts.chips || ""}
              </div>
              ${opts.stickyFilter ? opts.stickyFilter : ""}
            </div>
            <div class="with-toc">
              <div>
                ${renderDemoBanner(meta.id)}
                ${summary}
                ${opts.body}
                ${renderFeedbackNudge(meta.id)}
                ${footer}
              </div>
              ${tocAside}
            </div>
          `;
              }

              // SOP 문서(1-x~4-x): 현행 구조 유지
              return `
          <div class="page-eyebrow">${displayGroupNumber(group.id)} ${escapeHtml(group.title)} · ${displayItemNumber(meta.id)}</div>
          <h1 class="page-title">${escapeHtml(meta.title)}</h1>
          <p class="page-deck">${opts.deck || escapeHtml(meta.desc)}</p>
          <div class="meta-row">${opts.chips || ""}</div>
          <div class="with-toc">
            <div>
              ${renderDemoBanner(meta.id)}
              ${summary}
              ${opts.body}
              ${footer}
            </div>
            ${tocAside}
          </div>
        `;
            }

            /* 페이지 ID → 렌더 함수 디스패치 테이블. 각 페이지 함수 정의 후 등록한다. */
            const PAGE_RENDERERS = {
              "1-1": page_1_1,
              "1-2": page_1_2,
            };

            /* ---------- 1-3. 매체별 포스트백(Postback) 연동 매뉴얼 ---------- */
            function page_1_3() {
              const meta = findMeta("1-3");
              return pageShell(meta, {
                deck: "Adjust와 매체(Meta/Google/TikTok/Apple) 간 파트너 연동을 표준화한다. 잘못 설정된 포스트백 1개가 매체 머신러닝 최적화를 무너뜨리므로, 모든 연동은 본 절차로 검증 후 LIVE 전환.",
                chips: `
            <span class="chip"><span class="dot"></span>담당 · Growth Ops</span>
            <span class="chip"><span class="dot"></span>매체 <span class="tnum">7</span>개 연동</span>`,
                summary:
                  "포스트백은 MMP(Adjust)가 매체사에 어트리뷰션 결과를 전달하는 채널이다. 매체별로 (1) 파트너 활성화, (2) 포스트백 매핑, (3) 매크로 검증 3단계를 거치며, Meta/TikTok은 SAN(Self-Attributing Network), Google/Apple은 SAN+S2S 혼합이 기본이다.",
                toc: [
                  { id: "s-overview", title: "포스트백 개요" },
                  { id: "s-partners", title: "매체별 연동 방식" },
                  { id: "s-setup", title: "Adjust 파트너 셋업" },
                  { id: "s-macros", title: "URL 매크로 사양" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-overview">
              <h2 class="section-title"><span class="ix">§1</span>포스트백 개요</h2>
              <ul>
                <li><strong>Install Postback</strong> — 신규 설치 발생 시 매체에 전송. 머신러닝 최적화의 핵심 학습 신호.</li>
                <li><strong>In-App Event Postback</strong> — 가입·구매 등 인앱 이벤트 발생 시 전송. tCPA/tROAS 입찰 시 필수.</li>
              </ul>
              <p>SAN 매체는 Adjust가 클릭 URL을 발급하지 않고, 매체가 자체적으로 클릭/뷰 데이터를 MMP에 제공한다. Meta·Google·TikTok·Snap·X·Apple Search Ads가 대표적.</p>
            </section>

            <section class="block" id="s-partners">
              <h2 class="section-title"><span class="ix">§2</span>매체별 연동 방식</h2>
              ${dataTable(
                [
                  { label: "매체", type: "string" },
                  { label: "유형", type: "string" },
                  { label: "어트리뷰션 윈도우", type: "string" },
                  { label: "Cost 수신", type: "string" },
                  { label: "특이사항", type: "string" },
                ],
                [
                  [
                    "Meta Ads",
                    { html: '<span class="pill tier-1">SAN</span>' },
                    "1d click / 1d view",
                    "자동",
                    "AEM 우선순위 8개 설정 필수",
                  ],
                  [
                    "Google Ads (UAC)",
                    { html: '<span class="pill tier-1">SAN</span>' },
                    "30d click / 1d engaged-view",
                    "자동",
                    "Firebase 링크 필수, gbraid/wbraid 자동 수집",
                  ],
                  [
                    "TikTok",
                    { html: '<span class="pill tier-1">SAN</span>' },
                    "7d click / 1d view",
                    "자동",
                    "iOS SKAN postback 분리 채널 운영",
                  ],
                  [
                    "Apple Search Ads",
                    { html: '<span class="pill tier-2">S2S</span>' },
                    "30d click",
                    "자동(ASA API)",
                    "App Token에 ASA 캠페인 ID 매핑",
                  ],
                  [
                    "Moloco",
                    { html: '<span class="pill tier-2">S2S</span>' },
                    "7d click",
                    "수동(파일)",
                    "Probabilistic 매칭 비활성 권장",
                  ],
                  [
                    "LINE Ads",
                    { html: '<span class="pill tier-3">Click URL</span>' },
                    "7d click",
                    "수동",
                    "JP/TW 시장 한정",
                  ],
                  [
                    "AppLovin",
                    { html: '<span class="pill tier-1">SAN</span>' },
                    "7d click",
                    "자동",
                    "MAX 입찰 vs Direct 분리 검증",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-setup">
              <h2 class="section-title"><span class="ix">§3</span>Adjust 파트너 셋업 (공통 절차)</h2>
              <ol>
                <li>Adjust 대시보드 → 해당 앱 → <code class="inline">Partner Setup</code> 진입</li>
                <li>파트너 검색 → <code class="inline">+ Add Partner</code> 클릭</li>
                <li>인증 정보 입력 (Meta=Pixel ID, Google=Linker ID, TikTok=Advertiser ID)</li>
                <li><strong>Sending Settings</strong>: Install + Tier-1 In-App Events만 선별 전송</li>
                <li>Sandbox 테스트 디바이스로 install/event 발화 → 매체 대시보드 수신 확인 (최대 24h 지연)</li>
                <li>검증 완료 후 Production 전환</li>
              </ol>

              <h3 class="sub-title">3.1 Meta · Aggregated Event Measurement (AEM)</h3>
              <p>iOS 14.5+는 AEM으로 최대 8개 이벤트만 전송 가능. 비즈니스 가치 높은 이벤트를 상위에 배치한다. value optimization은 매출 기반 이벤트에만 활성화.</p>
              ${codeBlock(
                "json",
                "Meta AEM Priority Map",
                `{
        "app_id": "fb_app_1234567890",
        "events": [
          { "priority": 1, "event_name": "purchase",          "value_optimization": true  },
          { "priority": 2, "event_name": "subscribe",         "value_optimization": true  },
          { "priority": 3, "event_name": "begin_checkout",    "value_optimization": false },
          { "priority": 4, "event_name": "add_to_cart",       "value_optimization": false },
          { "priority": 5, "event_name": "complete_tutorial", "value_optimization": false },
          { "priority": 6, "event_name": "sign_up",           "value_optimization": false },
          { "priority": 7, "event_name": "level_achieved",    "value_optimization": false },
          { "priority": 8, "event_name": "session_start",     "value_optimization": false }
        ]
      }`,
              )}

              <h3 class="sub-title">3.2 Google Ads · Firebase 링크</h3>
              <p>UAC는 Firebase 연결이 강제된다. Adjust에서 발행한 이벤트를 GA4로 미러링하거나 Adjust → Google Ads 직접 전송. 직접 전송 방식이 데이터 손실이 적어 1차 권장.</p>
              ${codeBlock(
                "bash",
                "Google Conversion Linker 매핑",
                `# Adjust 대시보드의 Google Ads 파트너 페이지에서 확인
      # Linker ID 예: aw-123456789
      # Conversion Label은 이벤트별로 별도 발급:
      #   install:   AbCdEf1234-aw-installs
      #   purchase:  XyZ789-aw-purchase
      # Adjust → Partner Setup → Google Ads → Conversion Mapping에서 1:1 매칭`,
              )}
            </section>

            <section class="block" id="s-macros">
              <h2 class="section-title"><span class="ix">§4</span>URL 매크로 사양</h2>
              <p>비SAN 매체(Moloco, LINE 등)는 Click URL에 Adjust 매크로를 명시 삽입한다. 매체사가 클릭 시점에 매크로를 자체 값으로 치환해 전달.</p>
              ${dataTable(
                [
                  { label: "매크로", type: "string" },
                  { label: "Adjust 파라미터", type: "string" },
                  { label: "용도", type: "string" },
                ],
                [
                  [
                    "{campaign_id}",
                    "campaign_id",
                    "캠페인 식별자. 매체 캠페인 ID와 1:1 매칭",
                  ],
                  [
                    "{campaign_name}",
                    "campaign",
                    "캠페인명 (한글/공백은 URL 인코딩 필수)",
                  ],
                  ["{adgroup_name}", "adgroup", "광고 그룹/타겟 단위"],
                  ["{creative_name}", "creative", "소재 단위 (A/B 테스트용)"],
                  ["{idfa}", "idfa", "iOS 광고 식별자 (ATT 허용 시)"],
                  ["{gps_adid}", "gps_adid", "Android Google Play Services ADID"],
                  ["{cost}", "cost_amount", "클릭/노출 단가"],
                  ["{click_id}", "click_id", "매체사 클릭 유니크 ID"],
                  ["{deeplink}", "deeplink", "딥링크 URL (URL 인코딩)"],
                ],
              )}
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§5</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>매체 대시보드에 install이 0으로 보고된다</strong>
                  <p>1) Adjust → Partner Setup의 Install Postback 토글 확인. 2) SAN 매체에 클릭 URL을 따로 발급하지 말 것 — 이중 트래킹으로 organic 분류됨. 3) Sandbox 토큰을 Production에 사용 중이지 않은지 확인.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>Cost 데이터가 Adjust 대시보드에서 0으로 표시</strong>
                  <p>매체별 Cost API 연동은 별도 신청 항목. Adjust → App Setup → Cost Data → 매체별 API 키 등록. Meta=System User Access Token, Google=Ads API 인증. 최초 동기화 24~48시간 소요.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>Probabilistic 매칭 비율이 높다</strong>
                  <p>iOS 14.5+ ATT 거부 시 IDFA가 0으로 마스킹되어 deterministic 매칭 불가. Adjust는 IP+UA fingerprint로 fallback하지만 Moloco 등은 이를 신뢰하지 않음. 해당 매체는 SKAdNetwork 단일 채널로 운영 권장.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["1-3"] = page_1_3;

            /* ---------- 1-4. iOS 프라이버시 대응 (ATT & SKAN) ---------- */
            function page_1_4() {
              const meta = findMeta("1-4");
              return pageShell(meta, {
                deck: "ATT 프롬프트 허용률을 끌어올리고, SKAdNetwork 4.0 Conversion Value 스키마를 비즈니스 KPI에 맞춰 설계한다. ATT 허용률 0.1pp 차이가 iOS CPI 5~10% 영향으로 직결된다.",
                chips: `
            <span class="chip"><span class="dot"></span>담당 · Growth + Product</span>
            <span class="chip ok"><span class="dot"></span>SKAN 4.0 대응</span>
            <span class="chip warning"><span class="dot"></span>iOS 14.5+ 필수</span>`,
                summary:
                  "ATT(App Tracking Transparency)는 IDFA 사용 동의를 묻는 시스템 프롬프트이며, 미허용 시 어트리뷰션이 SKAdNetwork(SKAN) 단일 채널로 강제 다운그레이드된다. SKAN 4.0은 3개 시점(0~2일/3~7일/8~35일)에 Coarse(low/medium/high) + Fine(0~63) 값을 전송한다. 본 가이드는 (1) ATT 프롬프트 최적화, (2) SKAN CV 스키마 설계, (3) Adjust 매핑 셋업을 다룬다.",
                toc: [
                  { id: "s-att", title: "ATT 프롬프트 설계" },
                  { id: "s-skan", title: "SKAN 4.0 스키마" },
                  { id: "s-cvmap", title: "Conversion Value 매핑" },
                  { id: "s-adjust", title: "Adjust 셋업" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-att">
              <h2 class="section-title"><span class="ix">§1</span>ATT 프롬프트 설계</h2>
              <p>업계 평균 ATT 허용률: 게임 ~28%, 커머스 ~35%, 핀테크 ~42% (2025 기준). 허용률 끌어올리는 3가지 레버:</p>
              <ol>
                <li><strong>Pre-prompt(설명 다이얼로그) 삽입</strong> — 시스템 프롬프트 호출 직전 자체 디자인 화면에서 "왜 동의가 필요한지"를 카피로 설명. 거부 의도가 있는 사용자는 Pre-prompt에서 걸러 시스템 프롬프트 거부율을 낮춤.</li>
                <li><strong>호출 시점 지연</strong> — 첫 실행 즉시가 아니라 가치 인지 후(온보딩 완료 직후, 첫 구매 전, 푸시 동의 직후 등) 호출. 30~60초 지연 권장.</li>
                <li><strong>NSUserTrackingUsageDescription 카피</strong> — Info.plist의 ATT 설명 문구. "개인 맞춤 광고" 대신 "더 적합한 콘텐츠 추천" 등 사용자 효익 중심 카피.</li>
              </ol>
              ${codeBlock(
                "swift",
                "Pre-prompt + ATT 호출 흐름",
                `import AppTrackingTransparency
      import AdjustSdk

      func showATTFlow(from vc: UIViewController) {
          // 1. 가치 인지 시점 체크 (예: 온보딩 완료)
          guard OnboardingState.shared.isCompleted else { return }

          // 2. Pre-prompt 표시
          let pre = PrePromptViewController(
              title: "개인화된 콘텐츠 추천을 위한 동의",
              body: "다음 화면에서 '허용'을 선택하시면 더 관심에 맞는 콘텐츠를 추천드릴 수 있습니다.",
              primaryAction: "계속",
              secondaryAction: "지금은 건너뛰기"
          )
          pre.onPrimary = { requestSystemATT() }
          pre.onSecondary = { /* 7일 후 재시도 큐잉 */ }
          vc.present(pre, animated: true)
      }

      func requestSystemATT() {
          ATTrackingManager.requestTrackingAuthorization { status in
              // Adjust SDK는 결과를 자동 수신
              Analytics.track("att_response", [
                  "status": status.rawValue,
                  "is_authorized": status == .authorized
              ])
          }
      }`,
              )}
              ${codeBlock(
                "json",
                "Info.plist · 권장 카피",
                `{
        "NSUserTrackingUsageDescription":
          "더 관심에 맞는 콘텐츠와 혜택을 추천드리기 위해 활동 데이터를 사용합니다."
      }`,
              )}
            </section>

            <section class="block" id="s-skan">
              <h2 class="section-title"><span class="ix">§2</span>SKAdNetwork 4.0 스키마</h2>
              <p>SKAN 4.0의 핵심 변경점:</p>
              <ul>
                <li><strong>3-postback 윈도우</strong>: 설치 후 0~2일 / 3~7일 / 8~35일에 각각 1개씩 postback 발화</li>
                <li><strong>Coarse Conversion Value</strong>: <code class="inline">low</code> / <code class="inline">medium</code> / <code class="inline">high</code> 3단계 — 트래픽이 적은 캠페인도 신호 수집 가능</li>
                <li><strong>Fine Conversion Value</strong>: 0~63 (6bit) — 충분한 트래픽이 있는 캠페인만 허용</li>
                <li><strong>Hierarchical Source ID</strong>: 캠페인/광고그룹/소재 단위 시그널 가능 (이전 2-digit → 4-digit)</li>
              </ul>
            </section>

            <section class="block" id="s-cvmap">
              <h2 class="section-title"><span class="ix">§3</span>Conversion Value 매핑 (커머스 앱 예시)</h2>
              <p>매출 누적액 + 핵심 이벤트 발생 여부의 조합으로 64개 슬롯에 매핑한다. 0~2일차에 Fine 64단계, 3~7일차와 8~35일차에 Coarse 3단계만 활용 가능.</p>
              ${dataTable(
                [
                  { label: "Fine CV", type: "number" },
                  { label: "조건", type: "string" },
                  { label: "Coarse", type: "string" },
                  { label: "비즈니스 의미", type: "string" },
                ],
                [
                  [
                    "0",
                    "install only",
                    { html: '<span class="pill">low</span>' },
                    "설치만",
                  ],
                  [
                    "1",
                    "session_start ≥ 2",
                    { html: '<span class="pill">low</span>' },
                    "재방문",
                  ],
                  [
                    "5",
                    "add_to_cart 1회",
                    { html: '<span class="pill">low</span>' },
                    "관여 시작",
                  ],
                  [
                    "10",
                    "add_to_cart ≥ 2 OR begin_checkout",
                    { html: '<span class="pill tier-2">medium</span>' },
                    "고관여",
                  ],
                  [
                    "20",
                    "purchase 1회 · revenue < $5",
                    { html: '<span class="pill tier-2">medium</span>' },
                    "저액 구매",
                  ],
                  [
                    "30",
                    "purchase 1회 · revenue $5~$20",
                    { html: '<span class="pill tier-2">medium</span>' },
                    "중간 구매",
                  ],
                  [
                    "45",
                    "purchase 1회 · revenue $20~$50",
                    { html: '<span class="pill tier-1">high</span>' },
                    "고액 구매",
                  ],
                  [
                    "55",
                    "purchase ≥ 2 OR revenue ≥ $50",
                    { html: '<span class="pill tier-1">high</span>' },
                    "충성 구매",
                  ],
                  [
                    "63",
                    "subscribe (월 구독)",
                    { html: '<span class="pill tier-1">high</span>' },
                    "구독 전환",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-adjust">
              <h2 class="section-title"><span class="ix">§4</span>Adjust SKAN 셋업</h2>
              <ol>
                <li>Adjust 대시보드 → App Setup → SKAdNetwork → <code class="inline">Enable SKAN 4.0</code></li>
                <li><strong>Conversion Value Schema</strong>: Revenue + Events 조합 모드 선택</li>
                <li>이벤트별 Coarse Tier 매핑 (위 표 §3 기준)</li>
                <li>매체별 SKAN 채널 활성화: Meta/Google/TikTok/AppLovin 별도 토글</li>
                <li>Apple Console에서 Test Mode로 postback 발화 검증 (xcrun simctl)</li>
              </ol>
              ${codeBlock(
                "swift",
                "SKAN CV 업데이트 (Adjust 위임)",
                `class SKANDelegateHandler: NSObject, AdjustDelegate {
          static let shared = SKANDelegateHandler()

          func adjustConversionValueUpdated(_ conversionValue: NSNumber?) {
              // Adjust가 자동으로 conversion value 계산 후 호출
              guard let cv = conversionValue?.intValue else { return }
              Analytics.track("skan_cv_updated", [
                  "fine_value": cv,
                  "coarse_tier": cv < 10 ? "low" : cv < 45 ? "medium" : "high"
              ])
          }
      }`,
              )}
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§5</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>ATT 프롬프트가 표시되지 않는다</strong>
                  <p>1) <code class="inline">NSUserTrackingUsageDescription</code> Info.plist 누락. 2) iOS 14.5 미만 디바이스. 3) 이미 응답한 사용자(설정 → 개인정보 보호 → 추적에서 초기화 후 재테스트). 4) Adjust SDK 초기화가 ATT 호출 이전에 완료되어야 함.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>SKAN postback이 도달하지 않는다</strong>
                  <p>1) Apple Console의 SKAdNetwork Identifier(.skadnetworkidentifier)가 Info.plist에 등록되었는지 확인 — 매체별 식별자가 모두 들어가야 함 (보통 30~50개). 2) Adjust는 자동으로 매체사 redirect를 처리하지만, 매체사가 SKAN 채널을 별도 활성화해야 함. 3) postback 지연 정상 범위: 0~24시간.</p>
                </div>
              </div>
              <div class="callout info">
                <div class="ico">i</div>
                <div class="body">
                  <strong>CV 분포가 한쪽으로 쏠림 (대부분 0)</strong>
                  <p>CV 매핑이 너무 빡빡하게 설정된 경우. 매출 임계값을 낮추거나, 이벤트만으로도 CV가 올라가도록 mid-tier 슬롯을 확장. Apple Privacy Threshold(25 install/일) 미달 캠페인은 CV가 NULL로 마스킹되므로 작은 캠페인은 합쳐서 운영.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["1-4"] = page_1_4;

            /* ---------- 2-1. Google App Campaigns (UAC) ---------- */
            function page_2_1() {
              const meta = findMeta("2-1");
              return pageShell(meta, {
                deck: "UAC는 머신러닝이 입찰·타겟팅·소재를 자동 결정하는 black-box 캠페인이다. 운영자가 컨트롤할 수 있는 레버는 (1) 캠페인 구조, (2) 비드 단계 전환, (3) 에셋 그룹 다양성 3가지다.",
                chips: `
            <span class="chip"><span class="dot"></span>채널 · Google Ads</span>
            <span class="chip ok"><span class="dot"></span>입찰 · tCPI/tCPA/tROAS</span>
            <span class="chip warning"><span class="dot"></span>학습 단계 최소 7일</span>`,
                summary:
                  "UAC는 Install 캠페인(I)과 In-app Action 캠페인(II/III)으로 나뉜다. 신규 앱은 I로 시작해 일 install 30건 이상 확보 후 II(tCPA)로 전환, 매출 신호가 충분히 쌓이면 III(tROAS)로 단계 격상한다. 입찰 변경은 1주에 1회, ±20% 이내가 안전선이다.",
                toc: [
                  { id: "s-structure", title: "캠페인 구조" },
                  { id: "s-bid", title: "비드 전략 단계" },
                  { id: "s-asset", title: "에셋 그룹 룰" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-structure">
              <h2 class="section-title"><span class="ix">§1</span>캠페인 구조 (OS × 국가 × 단계)</h2>
              <p>UAC는 캠페인 단위로 머신러닝이 학습하므로 분리 = 분산 학습. 너무 잘게 쪼개면 학습량 부족, 너무 합치면 최적화 노이즈. 기본 분리축: <strong>iOS / Android</strong> 와 <strong>국가</strong>는 무조건 분리, <strong>유사 국가는 묶어서</strong> (US+CA, JP+TW 등) 운영.</p>
              ${dataTable(
                [
                  { label: "캠페인 유형", type: "string" },
                  { label: "입찰 옵션", type: "string" },
                  { label: "전환 정의", type: "string" },
                  { label: "최소 일 전환량", type: "number" },
                  { label: "권장 시점", type: "string" },
                ],
                [
                  [
                    "UAC for Install (UAC-I)",
                    "tCPI",
                    "Install",
                    "10",
                    "출시 ~ Day 30",
                  ],
                  [
                    "UAC for In-app Action (UAC-II)",
                    "tCPA",
                    "Tier-1 이벤트 (sign_up 등)",
                    "10",
                    "Day 30 이후",
                  ],
                  [
                    "UAC for ROAS (UAC-III)",
                    "tROAS",
                    "Revenue",
                    "30",
                    "월 매출 안정화 후",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-bid">
              <h2 class="section-title"><span class="ix">§2</span>비드 전략 단계별 전환</h2>
              <ol>
                <li><strong>Phase 1 · tCPI (Day 1~30)</strong> — 초기 타겟 CPI는 시장 평균의 1.3~1.5배로 설정 (학습 가속용). 일 install 30+ 도달 후 단계적으로 -10%씩 인하.</li>
                <li><strong>Phase 2 · tCPA (Day 30~60)</strong> — Tier-1 in-app event(sign_up, purchase 등)를 conversion으로 지정. CPA = CPI × (install→event CVR 역수)로 계산해 초기 설정.</li>
                <li><strong>Phase 3 · tROAS (Day 60+)</strong> — D7 또는 D30 revenue 안정화 후 진입. 초기 ROAS 타겟은 LTV/CAC = 1.0 수준에서 시작, 매주 +10%씩 상향.</li>
              </ol>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>학습 단계 (Learning Phase)</strong>
                  <p>입찰 변경 후 최소 7일 + 50 conversion까지는 학습 중. 이 기간 동안 추가 변경 시 머신러닝 재시작되어 비용 효율 급락. 한 번에 ±20% 이내만 변경.</p>
                </div>
              </div>
            </section>

            <section class="block" id="s-asset">
              <h2 class="section-title"><span class="ix">§3</span>에셋 그룹 룰 (소재 다양성)</h2>
              <p>UAC는 에셋을 자동 조합해 광고를 생성한다. 다양성 부족 = 학습 신호 부족. 캠페인당 에셋 그룹 2~3개, 각 그룹당 다음 최소 수량 강제:</p>
              ${dataTable(
                [
                  { label: "에셋 유형", type: "string" },
                  { label: "최소 수량", type: "number" },
                  { label: "권장 수량", type: "number" },
                  { label: "사양", type: "string" },
                ],
                [
                  ["헤드라인 (Text)", "5", "10", "30자 이내, 매체별 자동 truncate"],
                  ["설명 (Text)", "5", "10", "90자 이내"],
                  ["이미지 (Image)", "3", "8", "1200×628 + 1200×1200 + 1200×1500"],
                  ["가로 동영상", "1", "3", "16:9, 15~30초, MP4"],
                  ["세로 동영상", "1", "3", "9:16, 15~30초 (YouTube Shorts 노출)"],
                  ["정사각형 동영상", "1", "2", "1:1, 15~30초"],
                  ["HTML5 (선택)", "0", "1", "300×250 또는 320×480 인터스티셜"],
                ],
              )}
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>학습 단계에서 벗어나지 못한다</strong>
                  <p>일 conversion 10건 미만이면 학습 수렴 불가. 1) Conversion 정의를 한 단계 상위 funnel로 (purchase → add_to_cart). 2) 입찰을 +30% 일시 상향. 3) 국가/OS를 묶어서 캠페인 통합. 학습 완료 후 다시 분리 가능.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>tROAS 캠페인의 매출이 0으로 보고된다</strong>
                  <p>Adjust → Google Ads partner에서 purchase 이벤트의 revenue 송신 토글 확인. Firebase 미연결 시 revenue 전달 불가 → Adjust 직접 전송 모드로 전환.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>iOS 캠페인 install이 SKAN으로만 보고된다</strong>
                  <p>정상 동작. iOS 14.5+ ATT 거부 사용자는 모두 SKAN 채널로 분류되며, Adjust 대시보드에서 deterministic + probabilistic + SKAN을 합산해야 전체 install 수치가 됨.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["2-1"] = page_2_1;

            /* ---------- 2-2. Meta Advantage+ App (AAP) ---------- */
            function page_2_2() {
              const meta = findMeta("2-2");
              return pageShell(meta, {
                deck: "Meta AAP는 OS 분리 운영이 강제 사항이며, iOS는 SKAN 채널에 별도 캠페인을 운영해야 한다. Meta 기본 어트리뷰션은 7d click + 1d view이며, iOS 14.5+ 트래픽 평가는 1d click으로 축소 운영해 다른 매체와 비교 가능하도록 정렬한다.",
                chips: `
            <span class="chip"><span class="dot"></span>채널 · Meta Ads</span>
            <span class="chip ok"><span class="dot"></span>기본 · 7d click + 1d view</span>
            <span class="chip warning"><span class="dot"></span>OS 분리 필수</span>`,
                summary:
                  "AAP(Advantage+ App Campaigns)는 Meta의 자동화 캠페인. 광고 그룹 단위 디테일 제어가 제한되고 캠페인 단위 최적화가 강제된다. Meta 기본 어트리뷰션은 7-day click + 1-day view이며, MMP·타 매체와 동일 기준 비교를 위해 보고 시 1d_click으로 축소 운영하는 것이 표준 관행. iOS는 AEM(Aggregated Event Measurement) 8개 이벤트 우선순위, Android는 일반 인앱 이벤트 전체 송신이 기본.",
                toc: [
                  { id: "s-structure", title: "캠페인 구조" },
                  { id: "s-setup", title: "AAP 설정 단계" },
                  { id: "s-bid", title: "어트리뷰션 및 입찰" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-structure">
              <h2 class="section-title"><span class="ix">§1</span>캠페인 구조</h2>
              <p>OS × 국가 × 최적화 목표 3축 분리. iOS는 SKAN 전용 캠페인을 추가로 분리한다.</p>
              ${dataTable(
                [
                  { label: "캠페인", type: "string" },
                  { label: "OS", type: "string" },
                  { label: "최적화 목표", type: "string" },
                  { label: "예산 일 권장", type: "string" },
                  { label: "비고", type: "string" },
                ],
                [
                  [
                    "AAP-iOS-KR-Install",
                    "iOS",
                    "App Install",
                    "$50+",
                    "ATT 허용 사용자 대상",
                  ],
                  [
                    "AAP-iOS-KR-Purchase-SKAN",
                    "iOS",
                    "Purchase (SKAN)",
                    "$100+",
                    "SKAN 단일 채널 전용",
                  ],
                  [
                    "AAP-AOS-KR-Install",
                    "Android",
                    "App Install",
                    "$50+",
                    "신규 사용자 학습",
                  ],
                  [
                    "AAP-AOS-KR-Purchase-VBO",
                    "Android",
                    "Value-Based (Purchase)",
                    "$100+",
                    "VBO 활성화",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-setup">
              <h2 class="section-title"><span class="ix">§2</span>AAP 설정 단계</h2>
              <ol>
                <li>Meta Ads Manager → <code class="inline">캠페인 만들기</code> → 목표: <strong>App Promotion</strong></li>
                <li>캠페인 유형: <code class="inline">Advantage+ App Campaign</code> 선택 (Manual App Ads 아님)</li>
                <li>앱 선택 → Adjust 등록된 App ID 확인</li>
                <li>최적화 이벤트 선택 (Install / In-App Event / Value)</li>
                <li>예산: 캠페인 단위 일 예산 권장. ABO(Ad-Set Budget Optimization)는 AAP에서 비활성</li>
                <li>오디언스: 자동(Advantage+ Audience). 제외(exclusion)만 수동 지정 — 최근 30일 구매자 제외</li>
                <li>크리에이티브: 최대 50개 에셋 업로드. Meta가 자동 조합 생성</li>
              </ol>
              ${codeBlock(
                "json",
                "AEM 이벤트 우선순위 (Meta Events Manager)",
                `{
        "app_id": "fb_app_1234567890",
        "aem_priority": [
          "purchase",
          "subscribe",
          "begin_checkout",
          "add_to_cart",
          "complete_registration",
          "complete_tutorial",
          "level_achieved",
          "session_start"
        ],
        "value_optimization_events": ["purchase", "subscribe"]
      }`,
              )}
            </section>

            <section class="block" id="s-bid">
              <h2 class="section-title"><span class="ix">§3</span>어트리뷰션 및 입찰</h2>
              <ul>
                <li><strong>어트리뷰션 윈도우 (Meta 기본값)</strong>: <code class="inline">7-day click + 1-day view</code>. iOS 14.5+ ATT 거부 트래픽은 자동으로 SKAN postback 윈도우(0~2일)로 제한됨.</li>
                <li><strong>운영 권장 (멀티 매체 비교용)</strong>: 보고 시 <code class="inline">1-day click</code>으로 축소 후 평가하면 Google/TikTok 등과 동일 기준으로 비교 가능. Meta는 기본 7d_click에 대비 1d_click이 약 30~40% 낮게 보고됨.</li>
                <li><strong>입찰 전략</strong>: Highest Volume(자동) → Cost Cap → Bid Cap 순서로 단계 격상. 첫 7일은 Highest Volume으로 학습 가속.</li>
                <li><strong>VBO(Value Optimization)</strong>: 매출 기반 입찰. 일 50+ purchase 안정화 후 활성화.</li>
              </ul>
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>iOS 캠페인 install 보고가 급감</strong>
                  <p>SKAN postback 지연 또는 AEM 우선순위 변경 가능성. Meta Events Manager에서 AEM Priority 최근 변경 이력 확인 — 변경 시 학습 리셋되며 28일간 보고 누락 가능.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>VBO 캠페인에서 매출이 일관되지 않는다</strong>
                  <p>Adjust → Meta Partner에서 purchase 이벤트의 revenue 송신 활성 확인. AEM의 value_optimization 토글이 ON이어야 함. iOS는 SKAN postback 윈도우(0~2일) 내 매출만 신호로 사용됨.</p>
                </div>
              </div>
              <div class="callout info">
                <div class="ico">i</div>
                <div class="body">
                  <strong>Advantage+ vs 일반 캠페인 선택 기준</strong>
                  <p>일 예산 $100 미만 또는 한정된 타겟(예: 특정 직군) 운영 시 일반 App Ads. 일 $100+ 매스 타겟이면 AAP. AAP가 머신러닝 학습량을 더 빨리 채움.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["2-2"] = page_2_2;

            /* ---------- 2-3. Apple Search Ads (ASA) ---------- */
            function page_2_3() {
              const meta = findMeta("2-3");
              return pageShell(meta, {
                deck: "ASA는 App Store 검색 결과에 노출되는 유일한 키워드 광고. iOS 사용자의 70%가 앱 발견 경로로 App Store 검색을 사용하므로 ASA는 iOS 마케팅의 필수 채널이다.",
                chips: `
            <span class="chip"><span class="dot"></span>채널 · Apple Search Ads</span>
            <span class="chip ok"><span class="dot"></span>Cost-Per-Tap 입찰</span>
            <span class="chip warning"><span class="dot"></span>iOS 전용</span>`,
                summary:
                  "ASA는 4가지 캠페인 유형(Search Match, Search Keywords, Discovery, Brand)을 구분 운영해야 한다. Brand는 자기 브랜드 보호용 방어 캠페인, Discovery는 신규 키워드 발굴, Search Keywords는 수동 최적화, Search Match는 자동 매칭 — 각각 분리해야 KPI가 명확해진다.",
                toc: [
                  { id: "s-structure", title: "4단 캠페인 구조" },
                  { id: "s-keyword", title: "키워드 그룹핑" },
                  { id: "s-bid", title: "입찰 전략" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-structure">
              <h2 class="section-title"><span class="ix">§1</span>4단 캠페인 구조 (필수)</h2>
              ${dataTable(
                [
                  { label: "캠페인", type: "string" },
                  { label: "키워드", type: "string" },
                  { label: "Search Match", type: "string" },
                  { label: "목적", type: "string" },
                  { label: "권장 일 예산", type: "string" },
                ],
                [
                  [
                    "1. Brand",
                    "자사 브랜드명만",
                    "OFF",
                    "브랜드 키워드 방어 (경쟁사 침투 차단)",
                    "$20~$50",
                  ],
                  [
                    "2. Competitor",
                    "경쟁사 브랜드명",
                    "OFF",
                    "경쟁사 검색 사용자 가로채기",
                    "$50~$100",
                  ],
                  [
                    "3. Generic",
                    "카테고리 일반 키워드",
                    "OFF",
                    "수동 최적화된 핵심 키워드",
                    "$100~$500",
                  ],
                  [
                    "4. Discovery",
                    "(없음)",
                    "ON",
                    "Apple이 자동 매칭 → 새 키워드 발굴",
                    "$30~$100",
                  ],
                ],
              )}
              <p>Discovery에서 일정 클릭 이상 발생한 키워드는 Generic 캠페인으로 이관해 직접 입찰한다. Discovery는 발굴 채널, Generic은 운영 채널.</p>
            </section>

            <section class="block" id="s-keyword">
              <h2 class="section-title"><span class="ix">§2</span>키워드 그룹핑</h2>
              <p>Ad Group 단위로 의도(intent)에 따라 키워드를 묶는다. 같은 그룹 내 키워드는 동일한 CPI/CPA 타겟으로 운영.</p>
              ${dataTable(
                [
                  { label: "Ad Group", type: "string" },
                  { label: "예시 키워드", type: "string" },
                  { label: "Match Type", type: "string" },
                  { label: "타겟 CPI", type: "string" },
                ],
                [
                  ["Brand-Exact", "myapp, myapp 앱", "Exact", "$0.50"],
                  ["Brand-Broad", "myapp 다운로드", "Broad", "$0.80"],
                  ["Competitor", "competitor1, competitor2", "Exact", "$2.50"],
                  ["Generic-High", "쇼핑앱, 쇼핑몰", "Exact", "$3.00"],
                  ["Generic-Mid", "옷 쇼핑, 패션 앱", "Broad", "$2.00"],
                  [
                    "Generic-Long-tail",
                    "겨울 코트 쇼핑, 패딩 추천",
                    "Broad",
                    "$1.50",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-bid">
              <h2 class="section-title"><span class="ix">§3</span>입찰 전략</h2>
              <ul>
                <li><strong>Cost-Per-Tap (CPT)</strong>: ASA는 클릭 기반 과금. CPI = CPT / Tap-Through-Rate(TTR)</li>
                <li><strong>최대 CPT 입찰</strong>: Apple 추천 입찰의 1.2~1.5배에서 시작 → 일 7일 후 조정</li>
                <li><strong>CPA Goal</strong>: 캠페인 레벨 옵션. Adjust 연동된 in-app event 기준으로 자동 입찰 가능</li>
                <li><strong>스케줄링</strong>: ASA는 24/7 운영이 기본. 시간대별 광고 OFF 옵션 없음 — 입찰 +- 만 가능</li>
              </ul>
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>Brand 캠페인에서 install이 0</strong>
                  <p>1) ASA Attribution API 키 등록 여부 확인 (Adjust → ASA Partner). 2) Brand 키워드가 자기 앱 이름과 정확히 일치하는지. 3) App Store 검색 시 자기 앱이 organic 1위면 광고 표시 자체가 안 될 수 있음 — Apple이 자동 suppress.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>Discovery 캠페인 비용만 크고 install이 없다</strong>
                  <p>Search Match가 너무 광범위한 키워드로 매칭 중. Adjust 키워드 리포트에서 클릭 발생 키워드 추출 → 부정 키워드(Negative Keywords)로 추가. 카테고리 무관 키워드(예: "게임" 같은 광의)는 모두 차단.</p>
                </div>
              </div>
              <div class="callout info">
                <div class="ico">i</div>
                <div class="body">
                  <strong>CPP(Custom Product Page) 활용</strong>
                  <p>iOS 15+에서 키워드별로 다른 스크린샷/설명을 보여줄 수 있다. ASA Ad Group 단위로 CPP variant 지정 가능. 키워드와 일치하는 변형을 보여주면 TTR이 평균 30~50% 개선.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["2-3"] = page_2_3;

            /* ---------- 2-4. 앱 리타겟팅 및 Re-engagement ---------- */
            function page_2_4() {
              const meta = findMeta("2-4");
              return pageShell(meta, {
                deck: "리타겟팅은 기존 유저 재방문 유도 + 휴면 유저 부활을 목표로 한다. 핵심은 (1) 정확한 오디언스 세분화, (2) 디퍼드 딥링크로 첫 화면 정확 매칭, (3) 개인화 카피.",
                chips: `
            <span class="chip"><span class="dot"></span>채널 · Meta/Google 리타겟</span>
            <span class="chip ok"><span class="dot"></span>Customer List + Lookalike</span>
            <span class="chip warning"><span class="dot"></span>디퍼드 딥링크 필수</span>`,
                summary:
                  "신규 획득(UA)과 리타겟팅(RT)은 별도 캠페인으로 분리. RT는 LTV 검증된 고가치 유저 시드(seed)로 Lookalike를 만들고, 휴면 7~30일 유저에게 개인화 메시지로 도달. 모든 RT 광고 클릭은 디퍼드 딥링크로 사용자가 마지막에 본 화면으로 직접 진입시켜야 한다.",
                toc: [
                  { id: "s-audience", title: "오디언스 세분화" },
                  { id: "s-deeplink", title: "디퍼드 딥링크" },
                  { id: "s-seed", title: "Lookalike 시드 설계" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-audience">
              <h2 class="section-title"><span class="ix">§1</span>오디언스 세분화</h2>
              ${dataTable(
                [
                  { label: "세그먼트", type: "string" },
                  { label: "정의", type: "string" },
                  { label: "타겟 메시지", type: "string" },
                  { label: "예상 ROAS", type: "string" },
                ],
                [
                  [
                    "Cart Abandoner",
                    "add_to_cart 후 24h 내 미구매",
                    "장바구니 상품 + 무료배송 쿠폰",
                    "8.0x",
                  ],
                  [
                    "First Purchase",
                    "구매 1회, 14일 무재구매",
                    "두 번째 구매 5% 할인",
                    "5.5x",
                  ],
                  [
                    "VIP Dormant",
                    "purchase ≥ 3, 최근 30일 미접속",
                    "신상 큐레이션 + 개인화 추천",
                    "12.0x",
                  ],
                  [
                    "7d Inactive",
                    "session_start 7일 무발화, install < 30d",
                    "최근 본 카테고리 신상품 알림",
                    "3.2x",
                  ],
                  [
                    "30d Inactive",
                    "30일 무접속, 비결제",
                    "복귀 쿠폰 + 시즌 베스트",
                    "2.0x",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-deeplink">
              <h2 class="section-title"><span class="ix">§2</span>디퍼드 딥링크 (Deferred Deeplink)</h2>
              <p>리타겟팅 광고 클릭 → 앱 미설치자는 스토어 경유 후 첫 실행 시 광고 원본 URL로 라우팅. 1-1 가이드의 DeeplinkRouter 사용.</p>
              ${codeBlock(
                "http",
                "Adjust 리타겟팅 URL 예시",
                `https://app.adjust.com/{tracker_token}?
        campaign=rt_cart_abandoner_2026_05
        &adgroup=meta_lookalike_1p
        &creative=video_cart_v3
        &deeplink=myapp%3A%2F%2Fcart%3Fpromo%3DFREESHIP
        &fallback=https%3A%2F%2Fwww.example.com%2Fcart
        &reengagement_window=30`,
              )}
            </section>

            <section class="block" id="s-seed">
              <h2 class="section-title"><span class="ix">§3</span>Lookalike 시드 설계</h2>
              <ul>
                <li><strong>1차 시드: VIP Purchaser</strong> — purchase 3+ 또는 LTV 상위 10%. 매체 Lookalike 1% 생성.</li>
                <li><strong>2차 시드: High Engagement</strong> — D7 retention 유지 + session 5+/일. 시드가 부족할 때 사용.</li>
                <li><strong>금지 시드</strong>: 단순 install, 가입만 한 유저 — 매체 광고 클릭 가능성만 닮은 Lookalike가 생성되어 CPI는 낮으나 LTV는 평균 이하.</li>
              </ul>
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>리타겟팅과 UA가 같은 사용자에게 노출되어 카니발</strong>
                  <p>UA 캠페인에 Customer List(설치자) Exclusion 필수. Meta는 Audience Suppression 옵션, Google은 비교 캠페인의 Negative Audience로 처리.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>디퍼드 딥링크가 첫 실행에 발화되지 않음</strong>
                  <p>1-1 가이드 §4 참조. Android는 Install Referrer API 의존성, iOS는 LinkMe 또는 Universal Link 도메인 검증 필수.</p>
                </div>
              </div>
              <div class="callout info">
                <div class="ico">i</div>
                <div class="body">
                  <strong>Customer List 매칭률이 낮다 (Meta 기준 40% 미만)</strong>
                  <p>해싱 전 이메일/전화번호 정규화 누락. 소문자 변환, 공백 제거, 국가 코드 통일(+82 등) 후 SHA-256. Meta는 raw가 아닌 hash만 업로드.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["2-4"] = page_2_4;

            /* ---------- 3-1. 앱 스토어 최적화 (ASO) 베이직 ---------- */
            function page_3_1() {
              const meta = findMeta("3-1");
              return pageShell(meta, {
                deck: "ASO는 무료 트래픽 채널이지만 결과 측정이 어렵다. (1) 메타데이터 최적화, (2) 비주얼 A/B 테스트, (3) 키워드 점수표 3축으로 운영한다.",
                chips: `
            <span class="chip"><span class="dot"></span>채널 · App Store + Play Store</span>
            <span class="chip ok"><span class="dot"></span>측정 도구 · App Store Connect / Play Console</span>`,
                summary:
                  "ASO의 핵심 지표는 Conversion Rate(노출→설치 전환율) = Install / Impression. 평균 25%는 양호, 35%+는 우수. 키워드 노출 확보는 메타데이터, 클릭 → 설치 전환은 스크린샷/아이콘이 좌우한다.",
                toc: [
                  { id: "s-meta", title: "메타데이터 최적화" },
                  { id: "s-ab", title: "스크린샷 A/B 테스트" },
                  { id: "s-keyword", title: "키워드 점수표" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-meta">
              <h2 class="section-title"><span class="ix">§1</span>메타데이터 최적화</h2>
              ${dataTable(
                [
                  { label: "필드", type: "string" },
                  { label: "iOS (App Store)", type: "string" },
                  { label: "Android (Play)", type: "string" },
                  { label: "최적화 룰", type: "string" },
                ],
                [
                  [
                    "앱 이름",
                    "30자",
                    "30자",
                    "핵심 키워드 1개 + 브랜드명. 예: 'OO 쇼핑 - 패션 쇼핑몰'",
                  ],
                  [
                    "부제 / 짧은 설명",
                    "30자(subtitle)",
                    "80자",
                    "iOS는 검색 가중치 높음. Android는 검색 비중 낮음, 전환율 영향",
                  ],
                  [
                    "키워드 필드",
                    "100자(comma)",
                    "-",
                    "iOS 전용. 띄어쓰기 없이 콤마 구분. 한국어/영어 혼용 가능",
                  ],
                  [
                    "설명",
                    "4000자",
                    "4000자",
                    "Android는 검색 가중치 매우 높음. 핵심 키워드를 첫 3줄에 배치",
                  ],
                  [
                    "프로모션 텍스트",
                    "170자",
                    "-",
                    "iOS 전용. 앱 업데이트 없이 변경 가능 — 시즌 메시지 활용",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-ab">
              <h2 class="section-title"><span class="ix">§2</span>스크린샷 A/B 테스트</h2>
              <ul>
                <li><strong>iOS</strong>: Product Page Optimization(PPO) 사용. 최대 3개 variant, 50/50/50 트래픽 분배, 통계적 유의성 14~30일 확보.</li>
                <li><strong>Android</strong>: Play Console Store Listing Experiments. 최대 4개 variant, 한 번에 1개 필드만 테스트.</li>
                <li><strong>테스트 우선순위</strong>: 아이콘 → 첫 스크린샷 → 동영상 프리뷰 → 추가 스크린샷. 첫 스크린샷이 conversion에 미치는 영향이 가장 큼 (35% 이상).</li>
              </ul>
              ${dataTable(
                [
                  { label: "테스트 가설", type: "string" },
                  { label: "Variant A", type: "string" },
                  { label: "Variant B", type: "string" },
                  { label: "기대 효과", type: "string" },
                ],
                [
                  [
                    "첫 스크린샷 카피",
                    "기능 설명 (FEATURE)",
                    "혜택 강조 (BENEFIT)",
                    "CVR +10~15%",
                  ],
                  ["아이콘 컬러", "브랜드 컬러", "고채도 액센트", "CVR +5~8%"],
                  ["스크린샷 비율", "단일 화면", "캐러셀 스토리텔링", "CVR +8~12%"],
                  [
                    "동영상 첫 3초",
                    "UI 화면 전환",
                    "사용자 리뷰 인용",
                    "CVR +15~20%",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-keyword">
              <h2 class="section-title"><span class="ix">§3</span>키워드 점수표 (난이도 × 검색량)</h2>
              <p>키워드 우선순위는 <strong>Difficulty Score</strong>(경쟁 강도)와 <strong>Search Score</strong>(검색량)의 비율로 결정한다. <code class="inline">Priority = Search Score / Difficulty Score</code>. Priority가 1.5 이상인 키워드부터 공략.</p>
              ${dataTable(
                [
                  { label: "키워드", type: "string" },
                  { label: "Search Score", type: "number" },
                  { label: "Difficulty", type: "number" },
                  { label: "Priority", type: "number" },
                  { label: "전략", type: "string" },
                ],
                [
                  ["쇼핑앱", "75", "82", "0.91", "Brand 캠페인 + 부제 활용"],
                  [
                    "옷쇼핑",
                    "68",
                    "45",
                    "1.51",
                    { html: '<span class="pill tier-1">우선 타겟</span>' },
                  ],
                  [
                    "겨울코트",
                    "55",
                    "30",
                    "1.83",
                    { html: '<span class="pill tier-1">우선 타겟</span>' },
                  ],
                  ["패션쇼핑몰", "72", "78", "0.92", "장기 빌딩"],
                  ["여성패션앱", "48", "35", "1.37", "추가 검토"],
                ],
              )}
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>PPO 결과가 유의미하지 않다 (통계적 유의성 미확보)</strong>
                  <p>일 노출 1000건 미만이면 유의성 확보까지 60일+ 소요. 큰 변화(완전히 다른 컨셉)로 테스트하거나, ASA를 활용해 강제로 트래픽 확보 후 테스트.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>키워드 순위가 갑자기 하락</strong>
                  <p>경쟁사 신규 진입, Apple/Google 알고리즘 업데이트(분기별 발생), 부정 리뷰 급증 가능성. 별 평점 4.2 미만 시 검색 가중치 패널티. 리뷰 응답 + 버그 픽스 우선.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["3-1"] = page_3_1;

            /* ---------- 3-2. 매체별 앱 설치 유도 소재 규격 ---------- */
            function page_3_2() {
              const meta = findMeta("3-2");
              return pageShell(meta, {
                deck: "매체별 소재 규격을 위반한 광고는 게재되지 않거나 자동 크롭되어 핵심 메시지가 잘린다. 사양 일람 + 플레이어블 5MB 제약 + 영상 세이프존을 표준화.",
                chips: `
            <span class="chip"><span class="dot"></span>대상 · 디자이너/마케터</span>
            <span class="chip ok"><span class="dot"></span>5개 매체 대응</span>`,
                summary:
                  "각 매체별 소재 규격은 매년 변경된다. 본 가이드는 2026년 5월 기준이며, 분기 1회 재검증 필요. 플레이어블은 IAB Mobile RB Standard(5MB) 강제, 영상은 매체별 세이프존(상하 15%) 내에 핵심 텍스트 배치.",
                toc: [
                  { id: "s-matrix", title: "사이즈 매트릭스" },
                  { id: "s-playable", title: "플레이어블 가이드" },
                  { id: "s-safe", title: "영상 세이프존" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-matrix">
              <h2 class="section-title"><span class="ix">§1</span>매체별 사이즈 매트릭스</h2>
              ${dataTable(
                [
                  { label: "매체", type: "string" },
                  { label: "포맷", type: "string" },
                  { label: "비율", type: "string" },
                  { label: "최소 해상도", type: "string" },
                  { label: "용량 제한", type: "string" },
                ],
                [
                  ["Meta", "Feed 이미지", "1:1", "1080×1080", "30MB"],
                  ["Meta", "Story 영상", "9:16", "1080×1920", "4GB / 15초~60초"],
                  ["Meta", "Reels 영상", "9:16", "1080×1920", "4GB / 최대 90초"],
                  ["TikTok", "In-Feed 영상", "9:16", "720×1280", "500MB / 9~60초"],
                  ["TikTok", "Spark Ads", "9:16", "720×1280", "500MB"],
                  [
                    "Google",
                    "App Install 영상",
                    "16:9 / 9:16 / 1:1",
                    "480p+",
                    "1GB / 10초~30초",
                  ],
                  [
                    "Google",
                    "App Install 이미지",
                    "1.91:1 / 1:1 / 4:5",
                    "600px+",
                    "5MB",
                  ],
                  ["Snap", "Snap Ads", "9:16", "1080×1920", "1GB / 3~180초"],
                  ["AppLovin", "Playable", "9:16 / 1:1", "640×1136", "5MB (IAB)"],
                ],
              )}
            </section>

            <section class="block" id="s-playable">
              <h2 class="section-title"><span class="ix">§2</span>플레이어블 가이드</h2>
              <ul>
                <li><strong>용량 5MB 강제</strong>: HTML5 + JS + 이미지 합산. WebP/AVIF 사용, 폰트는 시스템 폰트로 fallback</li>
                <li><strong>로딩 시간 1.5초 이내</strong>: 첫 인터랙션까지 대기 시간이 길면 매체사 reject</li>
                <li><strong>3가지 필수 요소</strong>: (1) 시작 1초 내 명확한 액션 안내, (2) 핵심 게임플레이/기능 시뮬레이션, (3) 종료 시 CTA (앱 설치 버튼)</li>
                <li><strong>iframe 격리</strong>: 매체 SDK는 iframe 내에서 실행하므로 외부 도메인 호출 불가. 모든 리소스 base64 인라인</li>
              </ul>
            </section>

            <section class="block" id="s-safe">
              <h2 class="section-title"><span class="ix">§3</span>영상 세이프존</h2>
              <p>9:16 세로 영상은 매체별 UI 오버레이(좋아요 버튼, 사용자명, CTA 등)에 가려진다. 핵심 텍스트는 세이프존 내부에 배치.</p>
              ${dataTable(
                [
                  { label: "매체", type: "string" },
                  { label: "상단 마진", type: "string" },
                  { label: "하단 마진", type: "string" },
                  { label: "좌우 마진", type: "string" },
                ],
                [
                  ["TikTok", "상 14%", "하 35% (CTA + 사용자명)", "좌우 10%"],
                  ["Meta Reels", "상 12%", "하 30%", "좌 10% / 우 25% (액션 버튼)"],
                  ["YouTube Shorts", "상 10%", "하 25%", "좌우 8%"],
                  ["Snapchat", "상 18%", "하 20%", "좌우 8%"],
                ],
              )}
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>플레이어블이 매체 검수 reject</strong>
                  <p>1) 5MB 초과(GZIP 해제 기준 측정). 2) 외부 도메인 호출(api.example.com 등) — 모두 인라인 처리. 3) 자동 redirect 또는 자동 클릭 — 반드시 명시적 사용자 액션 후 CTA.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>영상 중요 정보가 가려짐 (TikTok)</strong>
                  <p>하단 35% 세이프존 미준수. 자막/가격 정보/CTA 텍스트는 영상 중앙 또는 상단 절반에 배치. 다국가 운영 시 가장 텍스트가 긴 언어 기준으로 세이프존 잡기.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["3-2"] = page_3_2;

            /* ---------- 3-3. 초기 3초 훅(Hook) 설계 프레임워크 ---------- */
            function page_3_3() {
              const meta = findMeta("3-3");
              return pageShell(meta, {
                deck: "광고 시청 결정의 80%가 첫 3초에 일어난다. 4가지 검증된 훅 패턴과 첫 프레임 체크리스트로 영상 CTR을 2배까지 끌어올린다.",
                chips: `
            <span class="chip"><span class="dot"></span>대상 · 크리에이티브 PM</span>
            <span class="chip ok"><span class="dot"></span>훅 패턴 <span class="tnum">4</span>종</span>`,
                summary:
                  "3초 훅은 광고 영상이 사용자의 스크롤을 멈춰 세우는 첫 3초의 설계. UGC형, 문제 제기형, 결과 보여주기형, 벤치마크 인용형 4가지 패턴 중 1개를 선택해 첫 프레임을 구성한다.",
                toc: [
                  { id: "s-patterns", title: "4가지 훅 패턴" },
                  { id: "s-checklist", title: "첫 프레임 체크리스트" },
                  { id: "s-measure", title: "측정 방법" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-patterns">
              <h2 class="section-title"><span class="ix">§1</span>4가지 검증된 훅 패턴</h2>
              ${dataTable(
                [
                  { label: "패턴", type: "string" },
                  { label: "구성", type: "string" },
                  { label: "최적 카테고리", type: "string" },
                  { label: "평균 CTR 개선", type: "string" },
                ],
                [
                  [
                    "1. UGC형 (Talking Head)",
                    "출연자가 정면 카메라에 대고 직접 화법으로 추천",
                    "커머스, 핀테크, 헬스",
                    "+45~80%",
                  ],
                  [
                    "2. 문제 제기형",
                    "타겟이 겪는 페인 포인트를 자막+상황극으로 보여줌",
                    "유틸리티, SaaS",
                    "+30~60%",
                  ],
                  [
                    "3. 결과 보여주기형",
                    "Before/After 또는 사용 후 결과를 첫 컷에 배치",
                    "다이어트, 학습, 미용",
                    "+50~100%",
                  ],
                  [
                    "4. 벤치마크 인용형",
                    "리뷰/평점/언론 보도 캡처를 자막과 함께 노출",
                    "전 카테고리 신뢰도용",
                    "+25~40%",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-checklist">
              <h2 class="section-title"><span class="ix">§2</span>첫 프레임 체크리스트</h2>
              <p>영상 0초 정지 화면(첫 프레임 = thumbnail)에서 다음 7가지가 모두 보여야 한다:</p>
              <ol>
                <li>사람 얼굴 또는 강한 비주얼 임팩트 (단순 UI 화면 금지)</li>
                <li>큰 자막 텍스트 1줄 (4~6단어 이내)</li>
                <li>자막은 매체 세이프존 내부에 배치</li>
                <li>고채도 컬러 (브랜드 컬러 + 보색 1개)</li>
                <li>음소거 상태에서도 메시지 전달 가능 (자동재생 + 무음이 기본값)</li>
                <li>스크롤 방향과 반대로 움직이는 모션 1개 이상</li>
                <li>광고임을 즉시 인지하지 못하게 디자인 (콘텐츠 느낌, "광고 카피" 회피)</li>
              </ol>
            </section>

            <section class="block" id="s-measure">
              <h2 class="section-title"><span class="ix">§3</span>측정 방법</h2>
              <ul>
                <li><strong>Hook Rate</strong> = 3초 시청 / 노출 — 매체별 다르지만 평균 25~35% (TikTok 기준)</li>
                <li><strong>Hold Rate</strong> = 50% 시청 / 3초 시청 — 핵심 메시지 전달 효율</li>
                <li><strong>CTR</strong> = 클릭 / 노출 — 최종 의사결정 지표</li>
                <li>매체 대시보드의 동영상 분석 리포트에서 위 3개 지표를 매주 모니터링. Hook Rate 25% 미만 영상은 즉시 교체.</li>
              </ul>
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>Hook Rate는 높은데 CTR이 낮다</strong>
                  <p>훅으로 끌어들였지만 메시지/CTA가 약함. 중반부에 핵심 가치 제안 강화, 마지막 3초에 명확한 CTA(설치 유도 화면).</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>UGC형 출연자 신뢰도 이슈</strong>
                  <p>전문 배우 티가 나면 효과 -30%. 실제 사용자 인터뷰 또는 마이크로 인플루언서 활용. 화질을 일부러 낮춰 "진짜 영상" 느낌을 줄 수 있음.</p>
                </div>
              </div>
              <div class="callout info">
                <div class="ico">i</div>
                <div class="body">
                  <strong>훅 패턴 로테이션 주기</strong>
                  <p>같은 훅을 3주 이상 운영하면 학습 피로(creative fatigue) — CTR 30%+ 하락. 동일 컨셉의 variant 3개를 2주 단위로 로테이션.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["3-3"] = page_3_3;

            /* ---------- 4-1. 앱 마케팅 핵심 지표(KPI) 분석 ---------- */
            function page_4_1() {
              const meta = findMeta("4-1");
              return pageShell(meta, {
                deck: "CPI/CPA/ARPU/ROAS의 정의를 통일하고, 국가·OS·카테고리별 벤치마크를 기준으로 캠페인 성과를 판단한다. 벤치마크 없는 절대값 비교는 무의미하다.",
                chips: `
            <span class="chip"><span class="dot"></span>측정 기준 · MMP 어트리뷰션</span>
            <span class="chip ok"><span class="dot"></span>벤치마크 · 2026 Q1</span>`,
                summary:
                  "KPI는 5개 레이어로 측정한다: (1) 효율(CPI/CPC), (2) 전환(CPA/CVR), (3) 가치(ARPU/ARPPU), (4) 회수(ROAS), (5) 지속성(LTV/Retention). 단일 지표만 보지 말고 5개를 동시에 모니터링.",
                toc: [
                  { id: "s-defs", title: "지표 정의" },
                  { id: "s-bench", title: "벤치마크 표" },
                  { id: "s-analysis", title: "분석 방법론" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-defs">
              <h2 class="section-title"><span class="ix">§1</span>지표 정의 (SSOT)</h2>
              ${dataTable(
                [
                  { label: "지표", type: "string" },
                  { label: "정의", type: "string" },
                  { label: "계산식", type: "string" },
                  { label: "측정 시점", type: "string" },
                ],
                [
                  ["CPI", "설치당 비용", "cost / installs", "캠페인 단위 일별"],
                  ["CPC", "클릭당 비용", "cost / clicks", "캠페인 단위 일별"],
                  ["CPA", "특정 액션당 비용", "cost / conversions", "D7 기준 일반적"],
                  [
                    "CTR",
                    "노출→클릭 전환율",
                    "clicks / impressions",
                    "매체사 리포트 기준",
                  ],
                  [
                    "IPM",
                    "1000노출당 설치 수",
                    "(installs / impressions) × 1000",
                    "TikTok 등에서 사용",
                  ],
                  [
                    "ARPU",
                    "사용자당 평균 매출",
                    "revenue / installs",
                    "D7 / D30 시점",
                  ],
                  [
                    "ARPPU",
                    "결제자당 평균 매출",
                    "revenue / paying_users",
                    "코호트 단위",
                  ],
                  ["ROAS", "광고 비용 대비 매출", "revenue / cost", "D7 / D30 / D90"],
                  [
                    "LTV",
                    "사용자 생애 가치 (예측)",
                    "cumulative ARPU × retention curve",
                    "12개월 예측",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-bench">
              <h2 class="section-title"><span class="ix">§2</span>업계 벤치마크 (2026 Q1)</h2>
              <p>USD 기준, Adjust + AppsFlyer 종합 데이터. 카테고리/국가/OS별로 표준편차가 크니 참고용으로만 사용.</p>
              ${dataTable(
                [
                  { label: "국가/OS", type: "string" },
                  { label: "카테고리", type: "string" },
                  { label: "CPI", type: "string" },
                  { label: "D7 ROAS", type: "string" },
                  { label: "D7 잔존율", type: "string" },
                ],
                [
                  ["KR iOS", "커머스", "$3.20 ~ $4.80", "12% ~ 25%", "22% ~ 30%"],
                  ["KR iOS", "게임", "$4.50 ~ $7.00", "8% ~ 18%", "18% ~ 25%"],
                  ["KR AOS", "커머스", "$1.80 ~ $3.20", "10% ~ 22%", "19% ~ 27%"],
                  ["KR AOS", "게임", "$2.50 ~ $4.50", "6% ~ 15%", "15% ~ 22%"],
                  ["JP iOS", "커머스", "$4.80 ~ $7.50", "15% ~ 30%", "25% ~ 33%"],
                  ["JP iOS", "게임", "$6.00 ~ $9.50", "12% ~ 22%", "22% ~ 30%"],
                  ["US iOS", "커머스", "$4.50 ~ $6.80", "10% ~ 20%", "20% ~ 28%"],
                  ["US iOS", "게임", "$5.50 ~ $9.00", "10% ~ 22%", "18% ~ 26%"],
                  ["US AOS", "커머스", "$2.50 ~ $4.20", "8% ~ 18%", "17% ~ 24%"],
                  ["SEA AOS", "커머스", "$0.60 ~ $1.50", "6% ~ 12%", "12% ~ 20%"],
                ],
              )}
            </section>

            <section class="block" id="s-analysis">
              <h2 class="section-title"><span class="ix">§3</span>분석 방법론</h2>
              <ul>
                <li><strong>1단계: 효율</strong> — CPI/CPC가 벤치마크 ±30% 이내인지 확인. 벗어나면 캠페인 구조 또는 입찰 검토.</li>
                <li><strong>2단계: 품질</strong> — 동일 캠페인 내 D7 잔존율이 벤치마크 대비 70% 이상인지. 미달 시 매체별 트래픽 품질 차이 또는 디퍼드 딥링크 누락 가능성.</li>
                <li><strong>3단계: 회수</strong> — D7 ROAS가 손익분기 LTV/CAC = 1.0의 30% 이상이면 정상 학습 중. 50%+ 도달 시 입찰 상향 가능.</li>
                <li><strong>금지 패턴</strong>: CPI만 보고 캠페인 평가 → 저품질 트래픽 매체로 예산 쏠림. 반드시 D7 ROAS와 동시 평가.</li>
              </ul>
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>매체 대시보드와 Adjust 수치가 30% 이상 차이</strong>
                  <p>1) 어트리뷰션 윈도우 불일치 (Meta 1d_click vs Adjust 7d_click). 2) SKAN postback 지연으로 iOS install이 D-2~D-3에 늦게 집계. 3) Cost data 동기화 누락. 모든 분석은 Adjust 수치를 SSOT로 사용.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>ARPU는 좋은데 ROAS는 나쁘다</strong>
                  <p>고가치 사용자는 잡고 있지만 획득 비용이 너무 비싼 경우. 1) 입찰 -10% 하향. 2) 동일 LTV 그룹을 더 싼 매체에서도 시도. 3) Lookalike seed를 좁혀서 더 정확한 타겟팅.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["4-1"] = page_4_1;

            /* ---------- 4-2. 코호트 기반 리텐션 가이드 ---------- */
            function page_4_2() {
              const meta = findMeta("4-2");
              return pageShell(meta, {
                deck: "코호트는 동일 시점에 install한 사용자 그룹. 코호트별 retention curve와 누적 ARPU로 LTV를 예측하고, 캠페인의 진짜 가치를 평가한다.",
                chips: `
            <span class="chip"><span class="dot"></span>분석 단위 · 일/주 코호트</span>
            <span class="chip ok"><span class="dot"></span>LTV 예측 · 12개월</span>`,
                summary:
                  "코호트 분석은 (1) Retention curve 형태 진단, (2) 누적 ARPU 곡선 예측, (3) 채널별 LTV 비교의 3단계로 진행. D7 잔존율이 같아도 D30 ARPU 차이가 2배 이상 날 수 있으므로 잔존율만으로 판단하지 않는다.",
                toc: [
                  { id: "s-def", title: "코호트 정의" },
                  { id: "s-curve", title: "Retention Curve" },
                  { id: "s-ltv", title: "LTV 예측 모델" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-def">
              <h2 class="section-title"><span class="ix">§1</span>코호트 정의 및 분할 기준</h2>
              <ul>
                <li><strong>시간 코호트</strong>: 일/주 단위 install date. 주간 분석이 노이즈가 적음.</li>
                <li><strong>채널 코호트</strong>: 매체별, 캠페인별. 동일 시점 install이라도 채널별로 retention/ARPU 차이.</li>
                <li><strong>퍼스트 액션 코호트</strong>: 첫 24시간 내 핵심 이벤트(예: add_to_cart) 발생 여부로 분할.</li>
              </ul>
            </section>

            <section class="block" id="s-curve">
              <h2 class="section-title"><span class="ix">§2</span>Retention Curve (D+N 잔존율)</h2>
              ${dataTable(
                [
                  { label: "Day", type: "number" },
                  { label: "커머스 평균", type: "string" },
                  { label: "게임 평균", type: "string" },
                  { label: "SNS 평균", type: "string" },
                ],
                [
                  ["D1", "32%", "38%", "45%"],
                  ["D3", "22%", "27%", "33%"],
                  ["D7", "17%", "20%", "26%"],
                  ["D14", "12%", "15%", "20%"],
                  ["D30", "8%", "10%", "15%"],
                  ["D60", "5%", "7%", "11%"],
                  ["D90", "4%", "5%", "9%"],
                ],
              )}
              <p>잔존율 곡선은 보통 <strong>power-law decay</strong>를 따른다. <code class="inline">retention(t) = a × t^(-b)</code>에 fit하여 미래 시점 예측 가능. R² 0.95 이상이면 신뢰 가능한 예측.</p>
            </section>

            <section class="block" id="s-ltv">
              <h2 class="section-title"><span class="ix">§3</span>LTV 예측 모델</h2>
              <p>LTV = 누적 ARPU × Retention 보정. D7 시점 데이터로 D90/D365 예측이 가능하다.</p>
              ${codeBlock(
                "json",
                "LTV 예측 입력 (예시)",
                `{
        "cohort_install_date": "2026-04-01",
        "channel": "Meta",
        "campaign": "AAP-iOS-KR-Purchase",
        "observed": {
          "d1_arpu":  0.15,
          "d3_arpu":  0.38,
          "d7_arpu":  0.62,
          "d14_arpu": 0.95,
          "d30_arpu": 1.40
        },
        "predicted": {
          "d90_arpu_low":   2.10,
          "d90_arpu_mid":   2.50,
          "d90_arpu_high":  3.05,
          "d365_arpu_mid":  4.20,
          "ltv_confidence": 0.87
        }
      }`,
              )}
              <p>D7 ARPU 대비 D90 ARPU의 multiplier는 카테고리별로 다르다: 커머스 ≈ 4.0, 게임 ≈ 6.0, 구독 SaaS ≈ 8.0. 이 multiplier로 빠른 LTV 추정 가능.</p>
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>채널별 D7 잔존율은 비슷한데 D30 ARPU가 2배 차이</strong>
                  <p>해당 채널의 트래픽 품질이 다름. D7 retention만으로 판단 금지. ARPPU(결제자당 매출)와 결제 전환율을 추가 비교 — 한 채널이 고가치 결제자를 더 많이 잡아오는지 확인.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>코호트별 데이터 매트릭스가 모자란다 (작은 캠페인)</strong>
                  <p>일 install 50건 미만이면 노이즈 너무 큼. 주간 단위 또는 매체 단위로 묶어서 분석. 단, OS는 절대 묶지 말 것 (iOS vs Android는 retention 패턴이 완전히 다름).</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["4-2"] = page_4_2;

            /* ---------- 4-3. 오가닉 vs 페이드 카니발리제이션 분석 ---------- */
            function page_4_3() {
              const meta = findMeta("4-3");
              return pageShell(meta, {
                deck: "유료 광고로 잡힌 install의 일부는 사실 광고가 없어도 organic으로 들어왔을 사용자다. 이를 측정·보정하지 않으면 ROAS가 과대 평가된다.",
                chips: `
            <span class="chip"><span class="dot"></span>측정 방법 · GeoX / Holdout</span>
            <span class="chip ok"><span class="dot"></span>분기 1회 실시</span>`,
                summary:
                  "카니발리제이션은 유료 광고가 organic install을 잠식하는 현상. 진짜 incremental install을 측정하는 표준 방법은 (1) Geo Holdout 실험, (2) Causal Impact 모델링 두 가지. 큰 광고 채널은 분기 1회 incrementality 측정 필수.",
                toc: [
                  { id: "s-def", title: "카니발리제이션 정의" },
                  { id: "s-geox", title: "GeoX 실험" },
                  { id: "s-holdout", title: "Holdout 실험" },
                  { id: "s-adj", title: "결과 보정" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-def">
              <h2 class="section-title"><span class="ix">§1</span>카니발리제이션 측정 모델</h2>
              <p>관찰된 paid install 중 진짜 증가분(incremental)의 비율 = <code class="inline">iROAS = incremental_revenue / cost</code>. 일반 ROAS와 iROAS의 차이가 클수록 카니발 비중이 높다.</p>
              ${dataTable(
                [
                  { label: "지표", type: "string" },
                  { label: "정의", type: "string" },
                  { label: "측정 방식", type: "string" },
                ],
                [
                  [
                    "Apparent ROAS",
                    "매체 어트리뷰션 기반 ROAS",
                    "Adjust 일반 리포트",
                  ],
                  [
                    "Incremental ROAS",
                    "광고가 없으면 일어나지 않았을 매출만 측정",
                    "GeoX 또는 Holdout",
                  ],
                  ["Carbon Tax", "카니발 비율", "1 - (iROAS / ROAS)"],
                ],
              )}
            </section>

            <section class="block" id="s-geox">
              <h2 class="section-title"><span class="ix">§2</span>GeoX (Geographic Experiment)</h2>
              <ol>
                <li>국가/지역을 2개 그룹으로 분할 (Treatment / Control). 인구·매출 비중이 유사하도록 매칭.</li>
                <li>Treatment 그룹에는 평소대로 광고 노출, Control 그룹은 해당 매체/캠페인 OFF.</li>
                <li>2~4주 운영 후 두 그룹의 install/revenue 차이 측정.</li>
                <li><code class="inline">incremental = treatment - control_baseline</code></li>
              </ol>
              ${codeBlock(
                "json",
                "GeoX 설계 예시 (Meta 캠페인)",
                `{
        "experiment_name": "meta_aap_geox_2026_q2",
        "duration_days": 28,
        "treatment_geo": ["KR-Seoul", "KR-Busan", "KR-Incheon"],
        "control_geo":   ["KR-Daegu", "KR-Daejeon", "KR-Gwangju"],
        "metric_primary":   "d7_revenue_per_user",
        "metric_secondary": "install_count",
        "min_detectable_lift": 0.05,
        "alpha": 0.05,
        "power": 0.80
      }`,
              )}
            </section>

            <section class="block" id="s-holdout">
              <h2 class="section-title"><span class="ix">§3</span>Holdout (Audience / User Holdout)</h2>
              <p>GeoX가 지역 단위로 광고를 끄는 방식이라면, Holdout은 <strong>사용자 단위</strong>로 특정 비율을 광고 노출에서 제외하는 방식이다. 단일 지역 운영(예: 한국만)에서 GeoX가 불가능할 때 차선책. Meta·Google·TikTok 모두 캠페인 단위 holdout 기능을 제공한다.</p>

              <h3 class="sub-title">3.1 매체별 Holdout 옵션</h3>
              ${dataTable(
                [
                  { label: "매체", type: "string" },
                  { label: "기능명", type: "string" },
                  { label: "Holdout 비율", type: "string" },
                  { label: "분석 단위", type: "string" },
                ],
                [
                  [
                    "Meta",
                    "Conversion Lift / Brand Lift",
                    "10% / 20% / 30% 선택",
                    "사용자 단위 (FB ID)",
                  ],
                  [
                    "Google",
                    "Conversion Lift Study",
                    "10% / 50% 선택",
                    "Google 계정 단위",
                  ],
                  ["TikTok", "Lift Studies", "10%~50% 자율", "Advertising ID 단위"],
                  [
                    "AppLovin",
                    "Incrementality Test",
                    "캠페인 단위 OFF",
                    "Geo + 디바이스 ID",
                  ],
                ],
              )}

              <h3 class="sub-title">3.2 실험 설계 — Power & Duration</h3>
              <p>holdout 그룹이 너무 작으면 통계적 유의성 확보 어려움. 일반적으로:</p>
              <ul>
                <li><strong>최소 holdout 크기</strong>: 일 install 1,000건 기준 holdout 비율 30% 이상 권장</li>
                <li><strong>실험 기간</strong>: 최소 4주 (week-of-day 효과 제거) — D14 매출까지 관찰</li>
                <li><strong>유의수준</strong>: α = 0.05, power = 0.80, MDE(Minimum Detectable Effect) = 5%</li>
                <li>매체별 자동 power 계산 도구 활용 (Meta Conversion Lift, Google Lift Study)</li>
              </ul>
              ${codeBlock(
                "json",
                "Holdout 실험 설계 예시 (Meta Conversion Lift)",
                `{
        "study_name": "meta_aap_holdout_2026_q2",
        "objective": "incremental_purchase",
        "test_groups": [
          { "name": "test",    "split": 0.70, "exposure": "ads_on"  },
          { "name": "control", "split": 0.30, "exposure": "ads_off" }
        ],
        "duration_days": 28,
        "primary_metric":   "d7_revenue_per_user",
        "secondary_metric": "purchase_count",
        "minimum_detectable_lift": 0.05,
        "alpha": 0.05,
        "expected_p_value_threshold": 0.05
      }`,
              )}

              <h3 class="sub-title">3.3 GeoX vs Holdout 선택 가이드</h3>
              ${dataTable(
                [
                  { label: "조건", type: "string" },
                  { label: "권장 방식", type: "string" },
                  { label: "이유", type: "string" },
                ],
                [
                  ["단일 국가/지역 운영", "Holdout", "GeoX는 지역 분할 불가"],
                  [
                    "다국가 운영 + 매체 인지도 캠페인",
                    "GeoX",
                    "사용자 단위로 누수 위험",
                  ],
                  [
                    "일 install 5000+ 대규모 캠페인",
                    "Holdout",
                    "사용자 단위 통계 검정력 충분",
                  ],
                  [
                    "일 install 1000 미만 소규모",
                    "GeoX 또는 Causal Impact",
                    "Holdout 검정력 부족",
                  ],
                  [
                    "TV·옥외 등 오프라인 매체 영향 큰 브랜드",
                    "GeoX",
                    "오프라인 노출이 user-level에 섞임",
                  ],
                  [
                    "매체별 incremental 비교가 목적",
                    "Holdout",
                    "매체별 동시 실험 가능",
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-adj">
              <h2 class="section-title"><span class="ix">§4</span>결과 보정 (Attribution Adjustment)</h2>
              <ul>
                <li>iROAS / ROAS 비율을 매체별로 산출 (Lift Factor)</li>
                <li>모든 매체 ROAS에 Lift Factor 곱해서 비교 (단순 ROAS는 매체 간 직접 비교 부적합)</li>
                <li>업계 평균 Lift Factor: Meta UA ≈ 0.7~0.8, Google UAC ≈ 0.6~0.75, ASA Brand ≈ 0.3~0.5 (브랜드는 카니발 비중 높음)</li>
                <li>Lift Factor는 6개월에 1회 재측정 — 매체 트래픽 품질·시장 상황 변화 반영</li>
              </ul>
              ${codeBlock(
                "json",
                "매체별 Lift Factor 적용 예시",
                `{
        "as_of": "2026-05-01",
        "media_lift_factors": {
          "Meta_UA":     { "apparent_roas": 1.85, "lift": 0.75, "iroas": 1.39 },
          "Google_UAC":  { "apparent_roas": 2.10, "lift": 0.68, "iroas": 1.43 },
          "TikTok":      { "apparent_roas": 1.60, "lift": 0.82, "iroas": 1.31 },
          "ASA_Brand":   { "apparent_roas": 4.20, "lift": 0.35, "iroas": 1.47 },
          "ASA_Generic": { "apparent_roas": 1.95, "lift": 0.78, "iroas": 1.52 }
        },
        "decision": "ASA_Generic 최우선 확대, ASA_Brand는 현재 비중 유지"
      }`,
              )}
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§5</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>Control 그룹에서도 organic이 영향 받는다</strong>
                  <p>Brand 인지도 캠페인은 다른 지역 사용자에게도 노출(예: TV, 옥외광고). GeoX는 디지털 채널 한정. Brand 매스 캠페인은 별도의 holdout 기간(전국 OFF) 필요.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>실험 결과가 노이즈 수준</strong>
                  <p>매주 install 5000+ 또는 매출 $50,000+ 이상의 규모가 안 되면 통계적 유의성 확보 어려움. 작은 캠페인은 GeoX 대신 Causal Impact (시계열 모델) 사용.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>Holdout 그룹에서도 매출이 발생하는 게 정상</strong>
                  <p>오해 금물 — 광고를 끈다고 매출이 0이 되는 게 아니다. organic·재방문·다른 매체 영향으로 baseline 매출은 유지된다. <code class="inline">incremental = test_매출 − control_매출</code>의 차이가 진짜 효과.</p>
                </div>
              </div>
              <div class="callout info">
                <div class="ico">i</div>
                <div class="body">
                  <strong>Lift 결과를 입찰에 어떻게 반영하나</strong>
                  <p>iROAS 기준으로 매체별 예산 재분배. Lift Factor가 낮은 매체(예: ASA Brand 0.35)는 절대 끄지 말고 비중만 조정 — 브랜드 키워드는 경쟁사 침투 차단 역할도 하므로 ROI 외 가치가 있다.</p>
                </div>
              </div>
            </section>
          `,
              });
            }
            PAGE_RENDERERS["4-3"] = page_4_3;

            /* ---------- 4-4. 모바일 광고 프로드(Ad Fraud) 탐지 ---------- */
            function page_4_4() {
              const meta = findMeta("4-4");
              return pageShell(meta, {
                deck: "모바일 광고 프로드는 연간 글로벌 광고 예산의 8~15%를 잠식한다. Adjust Fraud Prevention Suite의 탐지 시그널 13종을 모두 활성화하고 매주 모니터링.",
                chips: `
            <span class="chip"><span class="dot"></span>도구 · Adjust Fraud Suite</span>
            <span class="chip warning"><span class="dot"></span>유형 <span class="tnum">5</span>종 / 시그널 <span class="tnum">13</span>종</span>`,
                summary:
                  "광고 프로드는 5가지 유형으로 분류된다: (1) Click Spam (대량 가짜 클릭), (2) Click Injection (Android Install Referrer 가로채기), (3) SDK Spoofing (가짜 install 신호 위조), (4) Device Farm (실제 디바이스 농장), (5) Fake Engagement (가짜 인앱 이벤트). 각각 다른 탐지 시그널이 필요.",
                toc: [
                  { id: "s-types", title: "프로드 유형 5종" },
                  { id: "s-signals", title: "탐지 시그널 13종" },
                  { id: "s-action", title: "차단 절차" },
                  { id: "s-trouble", title: "트러블슈팅" },
                ],
                body: `
            <section class="block" id="s-types">
              <h2 class="section-title"><span class="ix">§1</span>프로드 유형 5종</h2>
              ${dataTable(
                [
                  { label: "유형", type: "string" },
                  { label: "설명", type: "string" },
                  { label: "Adjust 차단", type: "string" },
                ],
                [
                  [
                    "Click Spam",
                    "광고 미노출 사용자에게도 대량 클릭 발생시켜 install을 가로챔",
                    { html: '<span class="pill tier-1">자동</span>' },
                  ],
                  [
                    "Click Injection",
                    "Android Install Referrer broadcast를 가로채 직전 클릭 위조",
                    { html: '<span class="pill tier-1">자동</span>' },
                  ],
                  [
                    "SDK Spoofing",
                    "Adjust SDK 통신을 reverse engineering해 가짜 install 신호 전송",
                    { html: '<span class="pill tier-1">자동</span>' },
                  ],
                  [
                    "Device Farm",
                    "실제 디바이스 수십~수천 대로 install 양산 (사람 같지만 패턴 있음)",
                    { html: '<span class="pill tier-2">반자동</span>' },
                  ],
                  [
                    "Fake Engagement",
                    "incentivized 트래픽 또는 봇으로 인앱 이벤트 위조 (KPI 부풀리기)",
                    { html: '<span class="pill tier-3">수동</span>' },
                  ],
                ],
              )}
            </section>

            <section class="block" id="s-signals">
              <h2 class="section-title"><span class="ix">§2</span>탐지 시그널 13종</h2>
              <ol>
                <li><strong>CTIT(Click-to-Install Time) 분포 이상</strong> — 정상은 lognormal, 프로드는 spike</li>
                <li><strong>너무 짧은 CTIT (10초 미만)</strong> — Click Injection 가능성</li>
                <li><strong>너무 긴 CTIT (24시간+)</strong> — Click Spam 가능성</li>
                <li><strong>동일 IP에서 비정상적 install 수</strong></li>
                <li><strong>VPN/Datacenter IP 비율</strong> — 일반 트래픽은 1% 미만, 프로드는 10%+</li>
                <li><strong>Emulator/Rooted 디바이스 비율</strong></li>
                <li><strong>IDFA/GAID 신규성</strong> — 모든 install이 새 디바이스 ID면 의심</li>
                <li><strong>비정상 디바이스 모델 분포</strong> — 특정 저가 모델 집중</li>
                <li><strong>D1 retention 비정상</strong> — 정상 25%+, 프로드는 5% 미만</li>
                <li><strong>이벤트 발생 시간 패턴</strong> — 24시간 균등 분포(봇) vs 활동 시간 집중(사람)</li>
                <li><strong>인앱 액션 시퀀스</strong> — 정상 사용자 흐름과 다른 순서</li>
                <li><strong>매체별 incremental 차이</strong> — 일반 ROAS는 높은데 GeoX iROAS는 0에 가까움</li>
                <li><strong>Reattribution 비율</strong> — 같은 디바이스 ID가 짧은 주기로 재설치</li>
              </ol>
            </section>

            <section class="block" id="s-action">
              <h2 class="section-title"><span class="ix">§3</span>차단 절차</h2>
              <ol>
                <li>Adjust → Fraud Prevention 메뉴에서 Suite 전체 활성화 (Click Injection, Click Spam, SDK Signature, Distribution Outlier)</li>
                <li>매주 Rejected Install 리포트 다운로드, 매체별 프로드 비율 추적</li>
                <li>특정 매체 프로드 비율 5% 초과 시 1차 경고, 10% 초과 시 일시 정지</li>
                <li>리펀드 정책: Adjust 자동 차단된 install은 매체사 청구 무효화. 매체사가 거부 시 Adjust 증빙 데이터로 재청구.</li>
              </ol>
            </section>

            <section class="block" id="s-trouble">
              <h2 class="section-title"><span class="ix">§4</span>트러블슈팅</h2>
              <div class="callout danger">
                <div class="ico">!</div>
                <div class="body">
                  <strong>차단된 install이 매체 대시보드에는 보고됨</strong>
                  <p>Adjust 차단 ≠ 매체 차단. 매체사 청구를 무효화하려면 매체별 fraud dispute 절차 진행. Adjust → Partner Setup에서 Rejected Postback 활성화 후 매체에 1차 통보.</p>
                </div>
              </div>
              <div class="callout warn">
                <div class="ico">!</div>
                <div class="body">
                  <strong>특정 매체의 D1 retention만 비정상적으로 낮다</strong>
                  <p>incentivized 트래픽(install 보상 받고 즉시 삭제) 또는 봇. 1) 해당 매체와 incentive 트래픽 제외 협상. 2) 안 되면 즉시 캠페인 중단. 3) Adjust Distribution Outlier로 자동 차단 강도 상향.</p>
                </div>
              </div>
              <div class="callout info">
                <div class="ico">i</div>
                <div class="body">
                  <strong>SKAN 트래픽의 프로드 탐지</strong>
                  <p>SKAN postback은 Apple이 서명/암호화 처리하므로 SDK Spoofing 불가능. 단, Click Spam은 여전히 가능 — Apple Console의 redownload 플래그 활용해 의심 트래픽 분리.</p>
                </div>
              </div>
            </section>
          `,
              });
            }

const PAGE_RENDERERS_MAP = {
  "1-1": typeof page_1_1 !== 'undefined' ? page_1_1 : null,
  "1-2": typeof page_1_2 !== 'undefined' ? page_1_2 : null,
  "1-3": typeof page_1_3 !== 'undefined' ? page_1_3 : null,
  "1-4": typeof page_1_4 !== 'undefined' ? page_1_4 : null,
  "1-5": typeof page_1_5 !== 'undefined' ? page_1_5 : null,
  "1-6": typeof page_1_6 !== 'undefined' ? page_1_6 : null,
  "1-7": typeof page_1_7 !== 'undefined' ? page_1_7 : null,
  "1-8": typeof page_1_8 !== 'undefined' ? page_1_8 : null,
  "1-9": typeof page_1_9 !== 'undefined' ? page_1_9 : null,
  "2-1": typeof page_2_1 !== 'undefined' ? page_2_1 : null,
  "2-2": typeof page_2_2 !== 'undefined' ? page_2_2 : null,
  "2-3": typeof page_2_3 !== 'undefined' ? page_2_3 : null,
  "2-4": typeof page_2_4 !== 'undefined' ? page_2_4 : null,
  "2-5": typeof page_2_5 !== 'undefined' ? page_2_5 : null,
  "2-6": typeof page_2_6 !== 'undefined' ? page_2_6 : null,
  "2-7": typeof page_2_7 !== 'undefined' ? page_2_7 : null,
  "2-8": typeof page_2_8 !== 'undefined' ? page_2_8 : null,
  "2-9": typeof page_2_9 !== 'undefined' ? page_2_9 : null,
  "3-1": typeof page_3_1 !== 'undefined' ? page_3_1 : null,
  "3-2": typeof page_3_2 !== 'undefined' ? page_3_2 : null,
  "3-3": typeof page_3_3 !== 'undefined' ? page_3_3 : null,
  "3-4": typeof page_3_4 !== 'undefined' ? page_3_4 : null,
  "3-5": typeof page_3_5 !== 'undefined' ? page_3_5 : null,
  "3-6": typeof page_3_6 !== 'undefined' ? page_3_6 : null,
  "3-7": typeof page_3_7 !== 'undefined' ? page_3_7 : null,
  "3-8": typeof page_3_8 !== 'undefined' ? page_3_8 : null,
  "3-9": typeof page_3_9 !== 'undefined' ? page_3_9 : null,
  "4-1": typeof page_4_1 !== 'undefined' ? page_4_1 : null,
  "4-2": typeof page_4_2 !== 'undefined' ? page_4_2 : null,
  "4-3": typeof page_4_3 !== 'undefined' ? page_4_3 : null,
  "4-4": typeof page_4_4 !== 'undefined' ? page_4_4 : null,
  "4-5": typeof page_4_5 !== 'undefined' ? page_4_5 : null,
  "4-6": typeof page_4_6 !== 'undefined' ? page_4_6 : null,
  "4-7": typeof page_4_7 !== 'undefined' ? page_4_7 : null,
  "4-8": typeof page_4_8 !== 'undefined' ? page_4_8 : null,
  "4-9": typeof page_4_9 !== 'undefined' ? page_4_9 : null,
};

/* 코드블록 복사 버튼 바인딩 (index bindCopyButtons 이식).
   toast.js copyToClipboard 재사용 + index와 동일한 "Copied" 체크 피드백. */
function bindCopyButtons(root) {
  const timers = [];
  const btns = root.querySelectorAll(".copy-btn[data-copy-target]");
  const handlers = [];
  btns.forEach((btn) => {
    const onClick = () => {
      const targetId = btn.dataset.copyTarget;
      const el = root.querySelector(`#${CSS.escape(targetId)}`);
      if (!el) return;
      copyToClipboard(el.innerText);
      btn.classList.add("copied");
      const prev = btn.innerHTML;
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied`;
      const t = setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = prev;
      }, 1400);
      timers.push(t);
    };
    btn.addEventListener("click", onClick);
    handlers.push([btn, onClick]);
  });
  return () => {
    timers.forEach(clearTimeout);
    handlers.forEach(([btn, onClick]) => btn.removeEventListener("click", onClick));
  };
}

/* 정렬 가능한 표 바인딩 (index bindSortableTables 이식). dataTable이 내는
   data-sortable="1" thead th[data-col][data-type] 마크업에 클릭 정렬을 붙인다. */
function bindSortableTables(root) {
  const handlers = [];
  root.querySelectorAll('table[data-sortable="1"]').forEach((tbl) => {
    const thead = tbl.querySelector("thead");
    const tbody = tbl.querySelector("tbody");
    if (!thead || !tbody) return;
    thead.querySelectorAll("th").forEach((th, colIdx) => {
      const onClick = () => {
        const type = th.dataset.type || "string";
        const wasAsc = th.classList.contains("sorted-asc");
        thead
          .querySelectorAll("th")
          .forEach((o) => o.classList.remove("sorted-asc", "sorted-desc"));
        const direction = wasAsc ? -1 : 1;
        th.classList.add(wasAsc ? "sorted-desc" : "sorted-asc");
        const rows = Array.from(tbody.querySelectorAll("tr"));
        rows.sort((a, b) => {
          const aCell = a.children[colIdx];
          const bCell = b.children[colIdx];
          const av = aCell?.innerText.trim() || "";
          const bv = bCell?.innerText.trim() || "";
          if (type === "number") {
            const an =
              aCell?.dataset.sortval !== undefined
                ? parseFloat(aCell.dataset.sortval)
                : parseFloat(av);
            const bn =
              bCell?.dataset.sortval !== undefined
                ? parseFloat(bCell.dataset.sortval)
                : parseFloat(bv);
            return (an - bn) * direction;
          }
          return (
            av.localeCompare(bv, undefined, {
              numeric: true,
              sensitivity: "base",
            }) * direction
          );
        });
        rows.forEach((r) => tbody.appendChild(r));
      };
      th.addEventListener("click", onClick);
      handlers.push([th, onClick]);
    });
  });
  return () => {
    handlers.forEach(([th, onClick]) => th.removeEventListener("click", onClick));
  };
}

export default function SopContent({ routeId }) {
  const containerRef = React.useRef(null);
  const renderFn = PAGE_RENDERERS_MAP[routeId];

  React.useEffect(() => {
    const root = containerRef.current;
    if (!root || !renderFn) return undefined;
    const cleanups = [bindCopyButtons(root), bindSortableTables(root)];
    return () => cleanups.forEach((fn) => fn && fn());
  }, [routeId, renderFn]);

  // 결정론적 id 생성기를 페이지 계산 직전에 리셋 → 같은 페이지는 byte-identical 마크업.
  // (useMemo 안에서 계산하므로 렌더 중 side-effect 규칙 위반이 아니며, routeId가
  //  바뀔 때만 재계산된다.)
  const htmlContent = React.useMemo(() => {
    if (!renderFn) return null;
    resetSopUid();
    return renderFn();
  }, [renderFn]);

  if (!renderFn) {
    return (
      <div style={{ padding: '2rem' }}>
        <h2>개발 진행 중...</h2>
        <p>선택하신 가이드 문서 ({routeId}) 는 아직 제공되지 않습니다.</p>
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="tab-pane active"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}
