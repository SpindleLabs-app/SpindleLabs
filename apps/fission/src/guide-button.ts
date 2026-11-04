// The top bar's Guide button (in Menu at phone width) opens the guide, a
// scrolling, 3D explanation of how SpindleLabs works (@fission/viewport's
// guide/). A ?guide link opens it straight away, for showing someone.
// Pressed again while open (by keys or a screen reader: the guide covers
// the screen) it closes, like AI and Community.
import "./frame-guard.ts"; // a framed page stops here (audit S10)
import { openGuide } from "@fission/viewport";

const button = document.getElementById("guide-open");
let open: HTMLDialogElement | null = null;
function toggle() {
  if (open) return open.close();
  open = openGuide(button);
  button?.setAttribute("aria-pressed", "true");
  open.addEventListener("close", () => {
    open = null;
    button?.setAttribute("aria-pressed", "false");
  });
}
button?.setAttribute("aria-pressed", "false");
button?.addEventListener("click", toggle);
if (new URLSearchParams(location.search).has("guide")) toggle();
