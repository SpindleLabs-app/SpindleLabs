// A browser with no 3D drawing (WebGL off by a school's policy, a blocked graphics card): src/no-3d.ts. Bug hunt
// 2026-11-18 D-11: the app never started, the loading skeleton stayed for good with no words and an uncaught error.
// The browser side (Chromium with --disable-3d-apis) is e2e/no-webgl.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { NO_3D_WORDS, showNo3d, webglWorks } from "../src/no-3d.ts";

/** A document whose canvases give `context` for "webgl2" (and count what was asked and let go). */
function fakeDoc(context) {
  const asked = [];
  let lost = 0;
  const doc = {
    createElement: () => ({
      getContext: (kind) => {
        asked.push(kind);
        if (context === "throws") throw new Error("blocked");
        return context && { getExtension: (n) => (n === "WEBGL_lose_context" ? { loseContext: () => lost++ } : null) };
      },
    }),
  };
  return { doc, asked, lost: () => lost };
}

test("webglWorks: true only when a canvas gives a WebGL 2 context, which it lets go at once", () => {
  const on = fakeDoc(true);
  assert.equal(webglWorks(on.doc), true);
  assert.deepEqual(on.asked, ["webgl2"]);
  assert.equal(on.lost(), 1, "the trial context is given back (a page has 16 at most)");
  assert.equal(webglWorks(fakeDoc(null).doc), false);
  assert.equal(webglWorks(fakeDoc("throws").doc), false);
});

test("showNo3d: the loading skeleton becomes the words, said as an alert, and nothing waits on it", () => {
  const doc = new Window().document;
  doc.body.innerHTML = `<main><div id="viewport"></div><div id="app-skeleton" class="skeleton skeleton-app" role="status" aria-label="Loading SpindleLabs…"><span class="skeleton-bone"></span></div></main>`;
  showNo3d(doc);
  const sk = doc.getElementById("app-skeleton");
  assert.equal(sk.querySelector(".skeleton-bone"), null, "no shimmering shapes left");
  assert.equal(sk.getAttribute("role"), "alert");
  assert.equal(sk.hasAttribute("aria-label"), false);
  assert.match(sk.textContent, /could not start 3D drawing \(WebGL\)/);
  for (const w of NO_3D_WORDS) assert.ok(sk.textContent.includes(w), w);
  // With no skeleton on the page (it went already), the words go in the 3D view's place instead.
  const bare = new Window().document;
  bare.body.innerHTML = `<div id="viewport"></div>`;
  showNo3d(bare);
  assert.match(bare.getElementById("viewport").textContent, /could not start 3D drawing/);
});
