try {
  if (localStorage.getItem("jev-exam-theme") === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
} catch {
  // 隐私模式可能禁用 localStorage；忽略后使用系统/默认主题。
}
