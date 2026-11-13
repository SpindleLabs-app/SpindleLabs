// Where Undo and Redo go over an open phone sheet (src/undo-lift.ts `liftedBottom`), worked by hand. The browser side
// (real taps at 320, 375 and 393 px) is in e2e/phone-undo-sheet.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { GAP, liftedBottom, liftOverSheets } from "../src/undo-lift.ts";

// A 375 × 667 phone's view: the pair's container runs from y 100 to y 560; the Properties sheet's top is at y 387.
const TOP = 100;
const FOOT = 560;
const SHEET = 387;

test("no sheet open: the pair stays in its corner", () => {
  assert.equal(liftedBottom(552, 48, TOP, FOOT, null), null);
});

test("a sheet over the pair lifts it 8 px clear of the sheet's top", () => {
  // The sheet's top is 560 − 387 = 173 px above the container's foot, so the pair's bottom goes 173 + 8 = 181 px up.
  assert.equal(GAP, 8);
  assert.equal(liftedBottom(552, 48, TOP, FOOT, SHEET), 181);
});

test("a pair already clear of the sheet by the gap stays; one pixel less and it is lifted", () => {
  // Its bottom at 387 − 8 = 379 is exactly clear; at 380 it would be 7 px from the edge.
  assert.equal(liftedBottom(379, 48, TOP, FOOT, SHEET), null);
  assert.equal(liftedBottom(380, 48, TOP, FOOT, SHEET), 181);
});

test("a sheet taller than the view leaves the pair at the view's top, never off it", () => {
  // Sheet top at 120: 560 − 120 + 8 = 448 up would put the pair's top at 560 − 448 − 48 = 64, above the container (100).
  // The highest it may go: 560 − 100 − 48 − 8 = 404, the pair's top then 8 px under the container's top.
  assert.equal(liftedBottom(552, 48, TOP, FOOT, 120), 404);
  // And a container too short for the pair at all: 0, its corner.
  assert.equal(liftedBottom(552, 48, 530, FOOT, 540), 0);
});

/** A page with the shell's sheets in its workspace, and a ResizeObserver that tells which elements it still watches. */
function sheetPage() {
  const window = new Window();
  const watching = new Set();
  window.ResizeObserver = class {
    observe(el) {
      watching.add(el);
    }
    unobserve(el) {
      watching.delete(el);
    }
    disconnect() {
      watching.clear();
    }
  };
  const document = window.document;
  document.body.innerHTML = `<div id="workspace"><aside id="browser"></aside><aside id="properties"></aside><div id="undo-redo"></div></div><aside id="assistant" hidden></aside>`;
  const phone = { matches: false, addEventListener() {} };
  liftOverSheets(document, document.getElementById("undo-redo"), phone);
  return { window, document, watching };
}
const settled = () => new Promise((done) => setTimeout(done, 0)); // the MutationObserver's callback has run

test("a sheet swapped out of the page is no longer watched (soak, issue #198)", async () => {
  // Each workspace switch puts new Browser and Properties slots in the page (main.ts placeSlots); before the fix every slot
  // ever shown stayed in the watched set and its ResizeObserver, so a long session kept them all (the soak's nodes grew
  // by about 8 a cycle, 1975 at cycle 15 to 2517 at cycle 60). Watched: the three sheets in the page, never more.
  const { window, document, watching } = sheetPage();
  assert.equal(watching.size, 3);
  const swaps = 20;
  for (let i = 0; i < swaps; i++) {
    for (const id of ["browser", "properties"]) {
      const next = document.createElement("aside");
      next.id = id;
      document.getElementById(id).replaceWith(next);
    }
    await settled();
  }
  // After 20 swaps of both slots: the 3 in the page (browser, properties, assistant), not 3 + 2 · 20 = 43.
  assert.equal(watching.size, 3);
  for (const el of watching) assert.ok(el.isConnected, `${el.id} watched while out of the page`);
  window.happyDOM.close();
});

test("a slot put back in the page (a sleeping workspace woken) is watched again", async () => {
  const { window, document, watching } = sheetPage();
  const first = document.getElementById("browser");
  const empty = document.createElement("aside");
  empty.id = "browser";
  first.replaceWith(empty); // the workspace sleeps: empty slots in its place
  await settled();
  assert.equal(watching.has(first), false);
  empty.replaceWith(first); // it wakes: its own slot back
  await settled();
  assert.equal(watching.has(first), true);
  assert.equal(watching.has(empty), false);
  window.happyDOM.close();
});
