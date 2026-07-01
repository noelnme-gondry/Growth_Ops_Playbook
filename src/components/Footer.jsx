"use client";
import Link from "next/link";

export default function Footer() {
  return (
    <footer
      style={{
        textAlign: "center",
        padding: "24px 16px",
        fontSize: "12px",
        color: "var(--text-muted)",
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      <Link href="/privacy" style={{ color: "var(--text-muted)", marginRight: "16px" }}>개인정보처리방침</Link>
      <Link href="/terms" style={{ color: "var(--text-muted)" }}>이용약관</Link>
    </footer>
  );
}
