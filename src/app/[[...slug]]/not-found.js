import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        textAlign: "center",
        padding: "3rem 1rem",
      }}
    >
      <div style={{ fontSize: "42px" }}>🧭</div>
      <h1 style={{ margin: 0, fontSize: "1.4rem" }}>페이지를 찾을 수 없습니다</h1>
      <p style={{ margin: 0, color: "var(--text-secondary, #888)" }}>
        요청하신 주소가 없거나 이동되었습니다.
      </p>
      <Link
        href="/"
        className="btn primary"
        style={{ marginTop: "0.5rem", textDecoration: "none" }}
      >
        홈으로 돌아가기 →
      </Link>
    </div>
  );
}
