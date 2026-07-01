import "./globals.css";
import Script from "next/script";
import Footer from "@/components/Footer";

export const metadata = {
  title: {
    default: "Growth Ops Playbook | 데이터 드리븐 퍼포먼스 마케팅 SOP",
    template: "%s | Growth Ops Playbook",
  },
  description: "퍼포먼스 마케터와 데이터 분석가를 위한 실무 플레이북. GA4 세팅, ROAS 개선 전략, 콘텐츠 SEO 가이드 및 실무 마케팅 대시보드를 제공합니다.",
  keywords: "퍼포먼스 마케팅, 데이터 분석, 콘텐츠 마케팅, 구글 애널리틱스, GA4, SEO, 검색엔진최적화, ROAS, 그로스 해킹, CRM 마케팅, 데이터 드리븐, 마케팅 대시보드, 마케팅 예산 배분, MMM, 마케팅 믹스 모델링, 퍼포먼스 마케팅 SOP",
  authors: [{ name: "Growth Ops Playbook" }],
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://growthopsplaybook-production.up.railway.app/",
  },
  openGraph: {
    type: "website",
    url: "https://growthopsplaybook-production.up.railway.app/",
    title: "Growth Ops Playbook | 마케팅 엔지니어링 데스크",
    description: "실무에 바로 적용하는 퍼포먼스 마케팅 SOP & 데이터 분석 툴",
    siteName: "Growth Ops Playbook",
    locale: "ko_KR",
    images: [
      {
        url: "https://growthopsplaybook-production.up.railway.app/og-card.png",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Growth Ops Playbook",
    description: "실무에 바로 적용하는 퍼포먼스 마케팅 SOP & 데이터 분석 툴",
    images: ["https://growthopsplaybook-production.up.railway.app/og-card.png"],
  },
  other: {
    "google-adsense-account": "ca-pub-3073450406371629",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko" className="dark">
      <head>
        <meta name="theme-color" content="#121315" />
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%23adc6ff'/><text x='16' y='22' font-family='Inter, system-ui, sans-serif' font-size='18' font-weight='700' text-anchor='middle' fill='%231a1a2e'>M</text></svg>" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        {/* PapaParse·Chart.js·XLSX는 v2에서 npm 모듈로 직접 import(파일별 import) — index.html 시절
            CDN <Script beforeInteractive> 태그는 미사용·불필요(App Router에서 "script tag while rendering"
            콘솔 에러 유발)라 제거. Supabase는 전체 무료 전환으로 미사용(TODO(B2B) 재도입 시 layout에 재추가). */}
      </head>
      <body>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-T6C7QW75"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          ></iframe>
        </noscript>
        
        {/* GTM */}
        <Script id="gtm" strategy="afterInteractive">
          {`
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','GTM-T6C7QW75');
          `}
        </Script>

        {/* GA4 */}
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-DK12TNR0GW" strategy="afterInteractive" />
        <Script id="ga4" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-DK12TNR0GW');
          `}
        </Script>

        {/* AdSense */}
        <Script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3073450406371629" crossOrigin="anonymous" strategy="afterInteractive" />

        {children}
        <Footer />
      </body>
    </html>
  );
}
