export function isAdminSession() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem("dealers-choice-admin") === "true";
}

export function setAdminSession(value: boolean) {
  if (typeof window === "undefined") return;
  if (value) window.sessionStorage.setItem("dealers-choice-admin", "true");
  else window.sessionStorage.removeItem("dealers-choice-admin");
}
