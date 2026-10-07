try {
  // 先读新键，读不到再读改名前的旧键：不让一次改名把用户选好的主题丢掉。
  var theme = localStorage.getItem("eyedot-theme") || localStorage.getItem("jev-exam-theme");
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
} catch {
  // 隐私模式可能禁用 localStorage；忽略后使用系统/默认主题。
}
