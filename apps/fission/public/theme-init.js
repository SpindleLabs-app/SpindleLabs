// Runs before the page first paints (a classic script in <head>, so it blocks):
// puts the theme on the root so a light-mode user never sees a dark flash.
// The same rule as @fission/ui theme-choice.ts (a test runs both over one table).
(function () {
  var choice = "device";
  var custom = null; // the Custom theme's stored result (Settings), replayed here with no maths
  try {
    var raw = window.localStorage.getItem("spindlelabs-settings");
    var all = raw ? JSON.parse(raw) : {};
    var saved = all.theme;
    if (saved === "light" || saved === "dark") choice = saved;
    if (saved === "custom" && (all["custom-base"] === "light" || all["custom-base"] === "dark")) custom = all;
  } catch (e) {
    // Storage off or damaged: follow the device.
  }
  var light = false;
  try {
    light = window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch (e) {
    // No matchMedia: dark.
  }
  var theme = custom ? custom["custom-base"] : choice === "light" || (choice === "device" && light) ? "light" : "dark";
  var root = document.documentElement;
  var bar = theme === "light" ? "#e6eaf1" : "#0f141c";
  if (custom) {
    try {
      var vars = JSON.parse(custom["custom-vars"]);
      var names = [];
      for (var name in vars) {
        if (/^--[a-z0-9-]+$/.test(name) && typeof vars[name] === "string") {
          root.style.setProperty(name, vars[name]);
          names.push(name);
        }
      }
      root.setAttribute("data-custom-vars", names.join(","));
      if (/^#[0-9a-f]{6}$/i.test(custom["custom-secondary-used"])) root.setAttribute("data-custom-secondary", custom["custom-secondary-used"]);
      if (/^#[0-9a-f]{6}$/i.test(custom["custom-primary"])) bar = vars["--page"] || bar;
    } catch (e) {
      // Damaged: the base theme alone.
    }
  }
  root.setAttribute("data-theme", theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", bar);
})();
