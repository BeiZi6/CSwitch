(function () {
  try {
    var theme = localStorage.getItem("cswitch.theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (_error) {
    /* ignore quota / private mode */
  }
})();
