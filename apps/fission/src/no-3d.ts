// A browser that can't draw in 3D (WebGL turned off by a school's or company's policy, a graphics card the browser
// blocks): the app can't start, so it says so in plain words where the loading shapes were, instead of shimmering for
// good over an uncaught error (bug hunt 2026-11-18 D-11). Checked before the viewer is made (main.ts).

/** What the person reads, one paragraph each. */
export const NO_3D_WORDS = [
  "This browser could not start 3D drawing (WebGL), so SpindleLabs can't open.",
  "Turn on hardware acceleration (graphics acceleration) in the browser's settings and reload, or try another browser or computer. On a school or work computer it may be turned off for everyone: ask whoever looks after it.",
  "Projects kept in this browser are still here.",
];

/** Whether a canvas here gives a WebGL 2 context (what the 3D view needs); the trial context is given back at once. */
export function webglWorks(doc: Pick<Document, "createElement">): boolean {
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // a page has 16 contexts at most: don't hold this one
    return true;
  } catch {
    return false;
  }
}

/** Puts the words in place of index.html's loading skeleton (or in the 3D view's place when it has gone), as an alert. */
export function showNo3d(doc: Document): void {
  const at = doc.getElementById("app-skeleton") ?? doc.getElementById("viewport");
  if (!at) return;
  at.replaceChildren(
    ...NO_3D_WORDS.map((w) => {
      const p = doc.createElement("p");
      p.textContent = w;
      return p;
    }),
  );
  at.classList.add("no-3d");
  at.setAttribute("role", "alert");
  at.removeAttribute("aria-label");
}
