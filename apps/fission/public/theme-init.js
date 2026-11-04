// Runs before the page first paints (a classic script in <head>, so it blocks):
// puts the theme on the root so a light-mode user never sees a dark flash.
// The same rule as @fission/ui theme-choice.ts (a test runs both over one table).
(function () {
  var choice = "device";
  try {
    var raw = window.localStorage.getItem("spindlelabs-settings");
    var saved = raw ? JSON.parse(raw).theme : null;
    if (saved === "light" || saved === "dark") choice = saved;
  } catch (e) {
    // Storage off or damaged: follow the device.
  }
  var light = false;
  try {
    light = window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch (e) {
    // No matchMedia: dark.
  }
  var theme = choice === "light" || (choice === "device" && light) ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#e6eaf1" : "#0f141c");
})();
