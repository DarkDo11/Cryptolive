// Applies the saved theme before first paint to avoid a flash of the wrong theme.
// theme === null (or missing) means "follow the system preference".
(function () {
  try {
    var raw = localStorage.getItem("cryptolive:settings");
    var settings = raw ? JSON.parse(raw) : {};
    var theme = settings.theme;
    if (theme === undefined) theme = localStorage.getItem("cryptolive-theme"); // legacy key
    if (!theme) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
