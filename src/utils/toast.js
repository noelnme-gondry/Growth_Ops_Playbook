export function showToast({ title, body, variant, duration = 4200 }) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  
  const el = document.createElement("div");
  el.className = `toast ${variant || ""}`;
  
  // escape function to prevent xss
  const escapeHtml = (str) => {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  el.innerHTML = `
    ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ""}
    ${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ""}
  `;
  container.appendChild(el);
  
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 250);
  }, duration);
}

export function copyToClipboard(text, successTitle = "복사 완료", successBody = "클립보드에 복사되었습니다.") {
  navigator.clipboard.writeText(text).then(() => {
    showToast({
      title: successTitle,
      body: successBody,
      variant: "success",
      duration: 3000,
    });
  }).catch((err) => {
    console.error("Failed to copy:", err);
    showToast({
      title: "복사 실패",
      body: "클립보드 접근 권한을 확인해주세요.",
      variant: "error",
      duration: 4000,
    });
  });
}
