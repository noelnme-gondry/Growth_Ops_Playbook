export const metadata = { title: "이용약관 | Growth Ops Playbook" };

export default function TermsPage() {
  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 20px", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: "24px", marginBottom: "24px" }}>이용약관</h1>
      <p>
        본 서비스(Growth Ops Playbook)는 퍼포먼스 마케팅 SOP 문서와 CSV 기반 분석 도구를
        무료로 제공합니다. 서비스는 &quot;있는 그대로(as-is)&quot; 제공되며, 분석 결과의
        정확성에 대해 어떠한 보증도 하지 않습니다. 실제 의사결정은 사용자의 판단과 책임 하에
        이루어져야 합니다.
      </p>
      <h2 style={{ fontSize: "18px", margin: "24px 0 8px" }}>데이터 처리</h2>
      <p>
        업로드한 데이터는 서버로 전송되지 않고 브라우저 내에서만 처리됩니다. 서비스 이용에
        따른 데이터 유출·손실에 대해 운영자는 책임을 지지 않습니다.
      </p>
      <h2 style={{ fontSize: "18px", margin: "24px 0 8px" }}>약관 변경</h2>
      <p>본 약관은 사전 고지 없이 변경될 수 있습니다.</p>
    </main>
  );
}
