export const metadata = { title: "개인정보처리방침 | Growth Ops Playbook" };

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 20px", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: "24px", marginBottom: "24px" }}>개인정보처리방침</h1>
      <p>
        본 서비스(Growth Ops Playbook)는 사용자가 업로드하는 CSV 등 운영 데이터를
        <strong> 서버로 전송하거나 저장하지 않으며, 브라우저 메모리에서만 처리</strong>합니다.
        페이지를 새로고침하면 업로드한 데이터는 즉시 삭제됩니다.
      </p>
      <h2 style={{ fontSize: "18px", margin: "24px 0 8px" }}>수집하는 정보</h2>
      <p>
        서비스 이용 분석을 위해 Google Analytics(GA4), Google Tag Manager, Google AdSense가
        쿠키 및 기기 식별자를 통해 방문 통계·광고 관련 정보를 수집할 수 있습니다.
        이는 Google의 개인정보처리방침을 따릅니다.
      </p>
      <h2 style={{ fontSize: "18px", margin: "24px 0 8px" }}>문의</h2>
      <p>개인정보 관련 문의는 서비스 운영자에게 별도로 연락해 주세요.</p>
    </main>
  );
}
