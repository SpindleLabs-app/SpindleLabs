// The flat view (flat-view.ts) in a DOM (happy-dom): what it draws, where, and how it slides and zooms. The numbers
// are view-box.test.ts's hand-worked ones (a 400 × 400 mm bed in a 980 × 756 px view fits at 1.59 px per mm with its
// lower-left corner at (186, 672)). The real thing in Chromium: apps/fission/e2e/laser-page.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFlatView, type FlatScene, type FlatViewOptions } from "../src/index.ts";

const { Window } = await import("happy-dom");

const SIZE = { width: 980, height: 756 };
const RECT = { id: "s1", label: "Sketch 1", d: "M3 -3L43 -3L43 -33L3 -33Z", box: { minX: 3, minY: 3, maxX: 43, maxY: 33 } };
const SCENE: FlatScene = { bed: { width: 400, height: 400 }, parts: [RECT] };

function setUp(size = SIZE, windowWidth = size.width, options: FlatViewOptions = {}) {
  // The app's window: as wide as the view unless a test says the view is only part of it.
  const window = new Window({ innerWidth: windowWidth, innerHeight: size.height });
  const doc = window.document as unknown as Document;
  const host = doc.body.appendChild(doc.createElement("div"));
  host.setAttribute("aria-label", "3D view");
  host.innerHTML = `<canvas></canvas><div class="view-cube"></div><div class="view-controls" id="view-controls"></div>`;
  const view = createFlatView(doc, { size: () => size, ...options });
  const svg = view.element.querySelector("svg")!;
  /** An event on `target` (a part's outline, a button), heard by the view as it bubbles up. */
  const fireOn = (target: Element, type: string, init: Record<string, unknown>) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, ...init }); // a held left button, as a real drag reports
    target.dispatchEvent(e as unknown as Event);
    return e;
  };
  const fire = (type: string, init: Record<string, unknown>) => fireOn(svg, type, init);
  /** The sheet's matrix: [scale, x of the bed's origin, y of the bed's origin]. */
  const matrix = () => {
    const m = /^matrix\((\S+) 0 0 (\S+) (\S+) (\S+)\)$/.exec(view.element.querySelector(".laser-flat-world")!.getAttribute("transform")!)!;
    assert.equal(m[1], m[2]);
    return [Number(m[1]), Number(m[3]), Number(m[4])];
  };
  const texts = (cls: string) => [...view.element.querySelectorAll(`text.${cls}`)].map((t) => t.textContent);
  /** The outline of part `id` on the page. */
  const part = (id: string) => view.element.querySelector(`path.laser-flat-part[data-part="${id}"]`)!;
  return { window, doc, host, view, svg, fire, fireOn, part, matrix, texts };
}
const near = (got: number, want: number, what: string) => assert.ok(Math.abs(got - want) <= 1e-9, `${what}: got ${got}, want ${want}`);

test("attached, the view lies straight over the 3D canvas, the host is named for it, and detaching gives the host back as it was", () => {
  const { host, view } = setUp();
  view.attach(host);
  // After the canvas, under everything else laid over the view. (Compared as true or false: a failed comparison of two
  // elements would print the whole page.)
  assert.equal(host.children[1] === view.element, true, "the view comes straight after the canvas");
  // The 3D view's row of buttons is a later sibling of the view: what the style sheet hides it by (.laser-flat ~ .view-controls).
  assert.deepEqual([...host.children].map((c) => c.className), ["", "laser-flat", "view-cube", "view-controls"]);
  assert.equal(view.element.querySelector(".view-controls.laser-flat-bar") !== null, true, "the view's own row is inside it, so it stays");
  assert.equal(host.getAttribute("aria-label"), "Laser bed, flat view");
  view.detach();
  assert.equal(host.querySelector(".laser-flat") === null, true, "the view is off the page");
  assert.equal(host.getAttribute("aria-label"), "3D view");
  assert.equal(host.children.length, 3);
  view.detach(); // twice is nothing
});

test("hand-worked: the bed and the part are drawn in mm, the sheet's matrix puts them at true scale, and the words say which is which", () => {
  const { host, view, matrix, texts } = setUp();
  view.attach(host);
  view.show(SCENE, true);
  // The bed: a 400 × 400 rectangle from the origin, y flipped as the SVG file's (so it runs from y = −400 to 0).
  const bed = view.element.querySelector(".laser-flat-bed")!;
  assert.deepEqual(["x", "y", "width", "height"].map((a) => bed.getAttribute(a)), ["0", "-400", "400", "400"]);
  // The part: the very path data it was given (the file's), named in its tooltip with its size.
  const parts = [...view.element.querySelectorAll("path.laser-flat-part")];
  assert.deepEqual(parts.map((p) => [p.getAttribute("d"), p.getAttribute("data-part"), p.querySelector("title")!.textContent]), [["M3 -3L43 -3L43 -33L3 -33Z", "s1", "Sketch 1, cut, 40 × 30 mm"]]);
  // Fitted: 1.59 px per mm, the bed's origin at (186, 672) (view-box.test.ts's working).
  const [scale, x, y] = matrix();
  near(scale, 1.59, "scale");
  near(x, 186, "origin x");
  near(y, 672, "origin y");
  assert.deepEqual(texts("laser-flat-bed-name"), ["Bed 400 × 400 mm"]);
  assert.deepEqual(texts("laser-flat-part-name"), ["Sketch 1"]); // 63.6 × 47.7 px: the name fits
  assert.equal(view.element.querySelector("svg")!.getAttribute("aria-label"), "The laser bed from above, 400 × 400 mm, with 1 part: Sketch 1.");
  // The name sits at the part's middle, (23, 18) mm: 186 + 23 × 1.59 = 222.57 across, 672 − 18 × 1.59 = 643.38 down (the text's baseline 4 px lower).
  const name = view.element.querySelector("text.laser-flat-part-name")!;
  assert.deepEqual([name.getAttribute("x"), name.getAttribute("y"), name.getAttribute("text-anchor")], ["222.6", "647.4", "middle"]);
});

test("hand-worked: the ruler marks every 50 mm at the fitted zoom, numbered below and to the left of the bed", () => {
  const { host, view, texts } = setUp();
  view.attach(host);
  view.show(SCENE, true);
  // 1.59 px per mm: marks must be 35.2 mm apart or more, so every 50 mm: nine lines each way, 0 to 400.
  const lines = view.element.querySelector(".laser-flat-grid")!.getAttribute("d")!;
  assert.equal(lines, [0, 50, 100, 150, 200, 250, 300, 350, 400].map((v) => `M${v} 0V-400`).join("") + [0, 50, 100, 150, 200, 250, 300, 350, 400].map((v) => `M0 ${-v}H400`).join(""));
  // Numbers: 0…400 along the bottom, 50…400 up the left side (one 0 at the corner is enough).
  assert.deepEqual(texts("laser-flat-mark"), ["0", "50", "100", "150", "200", "250", "300", "350", "400", "50", "100", "150", "200", "250", "300", "350", "400"]);
  const marks = [...view.element.querySelectorAll("text.laser-flat-mark")];
  // The 100 below the bed: at 186 + 159 = 345 across, 15 px under the bed's bottom edge (672). The 100 on the left: 6 px
  // left of the bed's side, level with 672 − 159 = 513 (baseline 4 px lower).
  assert.deepEqual([marks[2].getAttribute("x"), marks[2].getAttribute("y")], ["345.0", "687.0"]);
  assert.deepEqual([marks[10].getAttribute("x"), marks[10].getAttribute("y"), marks[10].getAttribute("text-anchor")], ["180.0", "517.0", "end"]);
});

test("a part too small on screen for its name goes without it; an empty bed says so in its middle", () => {
  const phone = setUp({ width: 375, height: 756 });
  phone.view.attach(phone.host);
  phone.view.show(SCENE, true);
  near(phone.matrix()[0], 0.7675, "a phone's fitted scale"); // the part is 30.7 px wide: under the 57.6 its name needs
  assert.deepEqual(phone.texts("laser-flat-part-name"), []);
  assert.equal(phone.view.element.querySelectorAll("path.laser-flat-part").length, 1); // still drawn
  phone.view.show({ bed: SCENE.bed, parts: [], note: ["Nothing to cut yet.", "Closed sketches from DesignLab appear here."] }, false);
  assert.deepEqual(phone.texts("laser-flat-note"), ["Nothing to cut yet.", "Closed sketches from DesignLab appear here."]);
  assert.equal(phone.view.element.querySelector("svg")!.getAttribute("aria-label"), "The laser bed from above, 400 × 400 mm, with no parts.");
  assert.equal(phone.view.element.dataset.parts, "0");
});

test("the row of buttons is the flat view's own: Zoom out, Zoom in and Fit, with nothing that turns the view", () => {
  const { host, view, matrix } = setUp();
  view.attach(host);
  view.show(SCENE, true);
  const bar = view.element.querySelector(".view-controls.laser-flat-bar")!;
  assert.equal(bar.getAttribute("role"), "toolbar");
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>("button.nav-button")];
  // The view's three, and Turn for a picked part (L1b), which is away while no part is picked: it turns a part, never the view.
  assert.deepEqual(buttons.map((b) => [b.dataset.view, b.getAttribute("aria-label")]), [["zoom-out", "Zoom out"], ["zoom-in", "Zoom in"], ["fit", "Fit"], ["turn", "Turn"]]);
  assert.equal(buttons[3].closest<HTMLElement>(".nav-group")!.hidden, true);
  assert.ok(buttons.every((b) => b.title.length > 0 && b.type === "button"));
  // Zoom in: ×1.25 about the view's middle (490, 378). The origin was 186 − 490 = −304 px from it across and 672 − 378 = 294
  // down; both grow by 1.25: 490 − 380 = 110 and 378 + 367.5 = 745.5.
  buttons[1].click();
  let [scale, x, y] = matrix();
  near(scale, 1.59 * 1.25, "zoomed in");
  near(x, 110, "origin x");
  near(y, 745.5, "origin y");
  buttons[0].click(); // and back out
  [scale, x, y] = matrix();
  near(scale, 1.59, "zoomed back out");
  near(x, 186, "origin x again");
  buttons[1].click();
  buttons[2].click(); // Fit
  [scale, x, y] = matrix();
  near(scale, 1.59, "fitted");
  near(x, 186, "fitted x");
  near(y, 672, "fitted y");
});

test("hand-worked: the wheel zooms about the pointer; a drag slides the view; a second finger pinches", () => {
  const { host, view, fire, matrix } = setUp();
  view.attach(host);
  view.show(SCENE, true);
  // One notch away over the bed's origin (186, 672): ×e^0.2 = 1.2214…, the origin staying under the pointer.
  const wheel = fire("wheel", { clientX: 186, clientY: 672, deltaY: -100, deltaMode: 0, ctrlKey: false });
  assert.equal(wheel.defaultPrevented, true); // the page behind never scrolls
  let [scale, x, y] = matrix();
  near(scale, 1.59 * Math.E ** 0.2, "wheel scale");
  near(x, 186, "origin stays, x");
  near(y, 672, "origin stays, y");
  view.fit();
  // A drag from (300, 300) to (340, 280): everything moves 40 px right and 20 px up.
  fire("pointerdown", { pointerId: 1, clientX: 300, clientY: 300 });
  assert.equal(view.element.dataset.dragging, "");
  fire("pointermove", { pointerId: 1, clientX: 340, clientY: 280 });
  [scale, x, y] = matrix();
  near(scale, 1.59, "a drag never zooms");
  near(x, 226, "slid x");
  near(y, 652, "slid y");
  // A pointer that is not down moves nothing.
  fire("pointermove", { pointerId: 7, clientX: 0, clientY: 0 });
  near(matrix()[1], 226, "an idle pointer");
  // A second finger at (540, 280), 200 px from the first, then out to (740, 280), 400 px: twice as close, about the
  // point midway between the fingers. That point slid from (440, 280) to (540, 280), and the origin, 214 px left and
  // 372 px below the first midpoint, ends twice as far from the second: 540 − 428 = 112 across, 280 + 744 = 1024 down.
  fire("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 540, clientY: 280 });
  fire("pointermove", { pointerId: 2, pointerType: "touch", clientX: 740, clientY: 280 });
  [scale, x, y] = matrix();
  near(scale, 3.18, "pinched scale");
  near(x, 112, "pinched x");
  near(y, 1024, "pinched y");
  fire("pointerup", { pointerId: 1 });
  fire("pointerup", { pointerId: 2 });
  assert.equal(view.element.dataset.dragging, undefined);
  // A right-button press is not a drag.
  fire("pointerdown", { pointerId: 3, button: 2, clientX: 0, clientY: 0 });
  fire("pointermove", { pointerId: 3, clientX: 90, clientY: 90 });
  near(matrix()[1], 112, "a right-drag");
});

test("the keyboard: + and − zoom, the arrows slide, 0 fits; other keys and key chords are left to the app", () => {
  const { host, view, fire, matrix } = setUp();
  view.attach(host);
  view.show(SCENE, true);
  assert.equal(view.element.querySelector("svg")!.getAttribute("tabindex"), "0");
  assert.equal(fire("keydown", { key: "+" }).defaultPrevented, true);
  near(matrix()[0], 1.59 * 1.25, "+");
  fire("keydown", { key: "-" });
  near(matrix()[0], 1.59, "−");
  fire("keydown", { key: "ArrowRight" }); // looks further right: the sheet moves 48 px left
  near(matrix()[1], 186 - 48, "→");
  fire("keydown", { key: "ArrowUp" }); // looks further up: the sheet moves 48 px down
  near(matrix()[2], 672 + 48, "↑");
  fire("keydown", { key: "0" });
  near(matrix()[1], 186, "0 fits");
  assert.equal(fire("keydown", { key: "z", ctrlKey: true }).defaultPrevented, false); // undo stays the app's
  assert.equal(fire("keydown", { key: "+", ctrlKey: true }).defaultPrevented, false); // the browser's own zoom
  assert.equal(fire("keydown", { key: "x" }).defaultPrevented, false);
  near(matrix()[0], 1.59, "nothing moved");
});

test("a view the person moved stays where they put it when the parts change; an untouched one keeps the whole bed fitted", () => {
  const { host, view, fire, matrix } = setUp();
  view.attach(host);
  view.show(SCENE, true);
  view.show({ bed: SCENE.bed, parts: [] }, false);
  near(matrix()[1], 186, "still fitted");
  fire("wheel", { clientX: 186, clientY: 672, deltaY: -100, deltaMode: 0 });
  const moved = matrix();
  view.show(SCENE, false); // a part turned back on
  assert.deepEqual(matrix(), moved);
  view.show({ bed: { width: 200, height: 100 }, parts: [] }, true); // a new bed size frames the bed again
  // 200 × 100 in the 912 × 636 room: 912 / 200 = 4.56 px per mm, the bed 48…960 across.
  near(matrix()[0], 4.56, "the new bed fitted");
  near(matrix()[1], 48, "its left edge");
  // Taken off the page and put back (another workspace was shown meanwhile), the view is as it was left.
  fire("wheel", { clientX: 100, clientY: 100, deltaY: 100, deltaMode: 0 });
  const left = matrix();
  view.detach();
  view.attach(host);
  assert.deepEqual(matrix(), left);
});

test("the fitted bed keeps clear of the parts list lying over the view", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const host = doc.body.appendChild(doc.createElement("div"));
  const card = doc.createElement("aside");
  // The view's own box is at the page's (0, 44); the card at (8, 52) to (248, 152): (8, 8) to (248, 108) in the view.
  const box = (left: number, top: number, right: number, bottom: number) => () => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }) as DOMRect;
  card.getBoundingClientRect = box(8, 52, 248, 152);
  const view = createFlatView(doc, { size: () => SIZE, cards: () => [card] });
  view.element.getBoundingClientRect = box(0, 44, 980, 800);
  view.attach(host);
  view.show(SCENE, true);
  // view-box.test.ts's working: the bed starts right of the card, its left edge at 292, still 1.59 px per mm.
  const m = /^matrix\((\S+) 0 0 \S+ (\S+) \S+\)$/.exec(view.element.querySelector(".laser-flat-world")!.getAttribute("transform")!)!;
  near(Number(m[1]), 1.59, "scale");
  near(Number(m[2]), 292, "left edge");
});

// Found by the review of L1a2 (each failed before its fix).

test("before the page has said what the bed is, the view draws no bed of its own making", () => {
  const { host, view, texts } = setUp();
  view.attach(host);
  assert.deepEqual(texts("laser-flat-bed-name"), []);
  assert.deepEqual(texts("laser-flat-mark"), []);
  assert.equal(view.element.querySelector(".laser-flat-world")!.getAttribute("transform"), null);
  view.show(SCENE, true);
  assert.deepEqual(texts("laser-flat-bed-name"), ["Bed 400 × 400 mm"]);
});

test("a drag whose release was never heard ends at the next move with no button held, and a new press starts clean", () => {
  const { host, view, fire, matrix } = setUp();
  view.attach(host);
  view.show(SCENE, true);
  // Pressed at (300, 300); the release goes missing (a menu opened, the window lost the pointer). The mouse then only hovers.
  fire("pointerdown", { pointerId: 1, clientX: 300, clientY: 300 });
  fire("pointermove", { pointerId: 1, clientX: 400, clientY: 300, buttons: 0 });
  near(matrix()[1], 186, "a hover slides nothing");
  assert.equal(view.element.dataset.dragging, undefined);
  fire("pointermove", { pointerId: 1, clientX: 500, clientY: 300, buttons: 0 });
  near(matrix()[1], 186, "nor the next");
  // Left held, right pressed, left let go: only the right button is down (buttons 2), so the drag is over.
  fire("pointerdown", { pointerId: 1, clientX: 300, clientY: 300 });
  fire("pointermove", { pointerId: 1, clientX: 310, clientY: 300, buttons: 3 }); // both down: still the drag, 10 px
  near(matrix()[1], 196, "both buttons");
  fire("pointermove", { pointerId: 1, clientX: 400, clientY: 300, buttons: 2 });
  near(matrix()[1], 196, "the right button alone drags nothing");
  // The browser taking the pointer away ends the drag too.
  fire("pointerdown", { pointerId: 1, clientX: 300, clientY: 300 });
  fire("lostpointercapture", { pointerId: 1 });
  assert.equal(view.element.dataset.dragging, undefined);
  fire("pointermove", { pointerId: 1, clientX: 390, clientY: 300 });
  near(matrix()[1], 196, "after the capture was lost");
  // A finger whose lift went missing: the next first finger down slides the view by itself, 30 px, and is no pinch against a ghost.
  fire("pointerdown", { pointerId: 5, pointerType: "touch", isPrimary: true, clientX: 100, clientY: 100 });
  fire("pointerdown", { pointerId: 6, pointerType: "touch", isPrimary: true, clientX: 300, clientY: 300 });
  fire("pointermove", { pointerId: 6, pointerType: "touch", clientX: 330, clientY: 300 });
  near(matrix()[0], 1.59, "no pinch");
  near(matrix()[1], 226, "slid by one finger");
});

test("a move that moves nothing leaves a fitted view fitted, so it still follows the view's size", () => {
  const size = { ...SIZE };
  const { host, view, fire, matrix } = setUp(size);
  view.attach(host);
  view.show(SCENE, true);
  fire("wheel", { clientX: 186, clientY: 672, deltaY: 0, deltaMode: 0 }); // a sideways swipe: no zoom at all
  fire("keydown", { key: "ArrowLeft" }); // the fitted bed is whole in sight… this one does slide it
  fire("keydown", { key: "0" });
  fire("wheel", { clientX: 186, clientY: 672, deltaY: 0, deltaMode: 0 });
  // The view narrows to 580 px (window 980): room 580 − 48 − 20 = 512 across, 636 down, so 512 / 400 = 1.28 px per mm.
  size.width = 580;
  view.show(SCENE, false);
  near(matrix()[0], 1.28, "fitted again at the new size");
  // A real move still holds the view where the person put it.
  fire("wheel", { clientX: 100, clientY: 100, deltaY: -100, deltaMode: 0 });
  const moved = view.view();
  size.width = 980;
  view.show(SCENE, false);
  assert.deepEqual(view.view(), moved); // the same middle and zoom (on screen the sheet follows the view's middle)
});

test("hand-worked: a narrow view in a wide window is fitted with the desktop's margins, a phone's window with the phone's", () => {
  // A 580 × 756 view beside an open panel in a 1200 px window: no phone buttons over it. Room 512 × 636: 1.28 px per mm,
  // the bed 512 px tall, centred down the room: 36 + (636 − 512) / 2 = 98 to 610. So the bed's lower-left corner is at y = 610.
  const desk = setUp({ width: 580, height: 756 }, 1200);
  desk.view.attach(desk.host);
  desk.view.show(SCENE, true);
  near(desk.matrix()[0], 1.28, "scale");
  near(desk.matrix()[2], 610, "origin y, desktop margins");
  // The same view in a 580 px window (a phone on its side): the top margin is 92, the room 512 × 580, the bed
  // centred from 92 + (580 − 512) / 2 = 126 to 638.
  const phone = setUp({ width: 580, height: 756 });
  phone.view.attach(phone.host);
  phone.view.show(SCENE, true);
  near(phone.matrix()[0], 1.28, "scale");
  near(phone.matrix()[2], 638, "origin y, phone margins");
});

test("in a pane whose view is switched off (a workspace shown as coming soon) the flat view is hidden, and back when it is on", async () => {
  const { host, view } = setUp();
  host.dataset.drawing = "off";
  view.attach(host);
  assert.equal(view.element.hidden, true);
  delete host.dataset.drawing;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(view.element.hidden, false);
  host.dataset.drawing = "off"; // the app switches it off after the page has mounted
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(view.element.hidden, true);
  view.detach();
  delete host.dataset.drawing;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(view.element.hidden, true, "a detached view listens to nothing");
});

test("hand-worked: a part out of sight gets no name; the wheel with Ctrl held (a trackpad pinch) zooms five times as fast", () => {
  const { host, view, fire, matrix, texts } = setUp();
  view.attach(host);
  view.show(SCENE, true);
  // A pinch of 20 px on a trackpad arrives as a wheel of −20 with Ctrl: ×e^(0.002 × 20 × 5) = e^0.2.
  fire("wheel", { clientX: 186, clientY: 672, deltaY: -20, deltaMode: 0, ctrlKey: true });
  near(matrix()[0], 1.59 * Math.E ** 0.2, "pinch on a trackpad");
  view.fit();
  assert.deepEqual(texts("laser-flat-part-name"), ["Sketch 1"]);
  // Zoom ×4 about the bed's top-right corner, (822, 36) on screen: the part's box, 3…43 mm across from the origin at
  // 186, lands at 822 − 4 × (822 − 186 − 1.59 × 43) = −1448.52 on its right side: wholly left of the view.
  fire("wheel", { clientX: 822, clientY: 36, deltaY: -10000, deltaMode: 0 }); // clamped to ×4 a turn
  near(matrix()[0], 6.36, "×4");
  assert.deepEqual(texts("laser-flat-part-name"), []);
  assert.equal(view.element.querySelectorAll("path.laser-flat-part").length, 1); // the outline itself is still there
});

// Parts picked, moved and turned (L1b). The view only reports; `heard` is what the page would be told.

function withHandlers(size = SIZE) {
  const heard: unknown[][] = [];
  const all = setUp(size, size.width, {
    onPick: (id) => heard.push(["pick", id]),
    onMove: (id, dx, dy, key) => heard.push(["move", id, dx, dy, key]),
    onTurn: (id, degrees) => heard.push(["turn", id, degrees]),
  });
  all.view.attach(all.host);
  all.view.show(SCENE, true);
  return { ...all, heard };
}

test("a click on a part picks it, a click on the bare bed lets it go, and the picked part is marked and offered Turn", () => {
  const { view, fire, fireOn, part, heard } = withHandlers();
  // The part's box, 3…43 × 3…33 mm, is 190.77…254.37 across and 619.53…667.23 down on screen: (200, 650) is on it.
  fireOn(part("s1"), "pointerdown", { pointerId: 1, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointermove", { pointerId: 1, clientX: 202, clientY: 651 }); // a hand never holds quite still: 2.2 px is still a click
  fireOn(part("s1"), "pointerup", { pointerId: 1, clientX: 202, clientY: 651 });
  assert.deepEqual(heard, [["pick", "s1"]]);
  assert.equal(part("s1").getAttribute("transform"), null);
  // The page draws the scene with the part picked.
  view.show({ ...SCENE, picked: "s1" }, false);
  assert.equal(part("s1").getAttribute("class"), "laser-flat-part laser-flat-part-cut laser-flat-part-picked");
  assert.equal(part("s1").getAttribute("aria-pressed"), "true");
  assert.equal(view.element.dataset.picked, "s1");
  const turn = view.element.querySelector<HTMLButtonElement>('button[data-view="turn"]')!;
  assert.equal(turn.closest<HTMLElement>(".nav-group")!.hidden, false);
  turn.click();
  assert.deepEqual(heard.splice(0), [["pick", "s1"], ["turn", "s1", 90]]);
  // A click on the picked part again says nothing new; one on the bare bed lets it go.
  fireOn(part("s1"), "pointerdown", { pointerId: 1, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointerup", { pointerId: 1, clientX: 200, clientY: 650 });
  assert.deepEqual(heard, []);
  fire("pointerdown", { pointerId: 1, clientX: 500, clientY: 300 });
  fire("pointerup", { pointerId: 1, clientX: 500, clientY: 300 });
  assert.deepEqual(heard, [["pick", null]]);
  // A picked part that is no longer on the bed is no pick: no Turn.
  view.show({ bed: SCENE.bed, parts: [], picked: "s1" }, false);
  assert.equal(view.element.dataset.picked, undefined);
  assert.equal(turn.closest<HTMLElement>(".nav-group")!.hidden, true);
});

test("hand-worked: a mouse drags the part under it, its box's corner landing on whole mm; the view stays put and the name goes along", () => {
  const { view, fireOn, part, matrix, heard } = withHandlers();
  fireOn(part("s1"), "pointerdown", { pointerId: 1, clientX: 200, clientY: 650 });
  // 100 px right and 50 px up at 1.59 px per mm: 62.89 mm across and 31.45 mm up. The box's lower-left corner, (3, 3),
  // would be at (65.89, 34.45): it lands on (66, 34), so the part has moved (63, 31). In the sheet's own numbers y is flipped.
  fireOn(part("s1"), "pointermove", { pointerId: 1, clientX: 300, clientY: 600 });
  assert.equal(part("s1").getAttribute("transform"), "translate(63 -31)");
  assert.equal(view.element.dataset.moving, "s1");
  near(matrix()[1], 186, "the view did not slide");
  // The name sits at the part's middle, now (23 + 63, 18 + 31) = (86, 49) mm: 186 + 86 × 1.59 = 322.74, 672 − 49 × 1.59 = 594.09 (baseline 4 px lower).
  const name = view.element.querySelector("text.laser-flat-part-name")!;
  assert.deepEqual([name.getAttribute("x"), name.getAttribute("y")], ["322.7", "598.1"]);
  assert.deepEqual(heard, []); // nothing is told before the part is let go
  fireOn(part("s1"), "pointerup", { pointerId: 1, clientX: 300, clientY: 600 });
  assert.deepEqual(heard, [["move", "s1", 63, 31, false]]);
  // Let go, the part is back where the scene has it until the page draws the new scene.
  assert.equal(part("s1").getAttribute("transform"), null);
  assert.equal(view.element.dataset.moving, undefined);
  // A drag that ends where it began (under half a mm) moves nothing and is told to nobody.
  fireOn(part("s1"), "pointerdown", { pointerId: 1, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointermove", { pointerId: 1, clientX: 210, clientY: 650 });
  fireOn(part("s1"), "pointermove", { pointerId: 1, clientX: 200.5, clientY: 650 }); // 0.31 mm: the corner is back on 3
  fireOn(part("s1"), "pointerup", { pointerId: 1, clientX: 200.5, clientY: 650 });
  assert.deepEqual(heard.length, 1);
});

test("a finger slides the view across a part that is not picked, and moves the part once it is; a second finger makes it a pinch and moves no part", () => {
  const { view, fireOn, part, matrix, heard } = withHandlers();
  const touch = { pointerType: "touch", isPrimary: true };
  fireOn(part("s1"), "pointerdown", { ...touch, pointerId: 5, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointermove", { ...touch, pointerId: 5, clientX: 240, clientY: 630 });
  near(matrix()[1], 226, "the view slid 40 px"); // the whole way from where the finger went down, though the first 8 px were a tap still
  near(matrix()[2], 652, "and 20 px up");
  assert.equal(part("s1").getAttribute("transform"), null);
  fireOn(part("s1"), "pointerup", { ...touch, pointerId: 5, clientX: 240, clientY: 630 });
  assert.deepEqual(heard, []); // a slide is no tap: nothing picked
  // Picked, the same finger moves the part: 100 px right and 50 px up is (63, 31) mm as with the mouse.
  view.show({ ...SCENE, picked: "s1" }, true);
  fireOn(part("s1"), "pointerdown", { ...touch, pointerId: 6, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointermove", { ...touch, pointerId: 6, clientX: 300, clientY: 600 });
  assert.equal(part("s1").getAttribute("transform"), "translate(63 -31)");
  // A second finger down: the part goes back, and the two fingers pinch the view.
  fireOn(part("s1"), "pointerdown", { pointerType: "touch", isPrimary: false, pointerId: 7, clientX: 500, clientY: 600 });
  assert.equal(part("s1").getAttribute("transform"), null);
  fireOn(part("s1"), "pointerup", { ...touch, pointerId: 6, clientX: 300, clientY: 600 });
  fireOn(part("s1"), "pointerup", { pointerType: "touch", pointerId: 7, clientX: 500, clientY: 600 });
  assert.deepEqual(heard, []);
  // A tap on a part that is not picked picks it.
  view.show(SCENE, false);
  fireOn(part("s1"), "pointerdown", { ...touch, pointerId: 8, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointermove", { ...touch, pointerId: 8, clientX: 205, clientY: 654 }); // 6.4 px: a finger's tap
  fireOn(part("s1"), "pointerup", { ...touch, pointerId: 8, clientX: 205, clientY: 654 });
  assert.deepEqual(heard, [["pick", "s1"]]);
});

test("with a part picked the arrows move it 1 mm (10 with Shift), R turns it, Escape lets it go; Enter on a part picks it", () => {
  const { view, fire, fireOn, part, matrix, heard } = withHandlers();
  assert.equal(fireOn(part("s1"), "keydown", { key: "Enter" }).defaultPrevented, true);
  assert.deepEqual(heard.splice(0), [["pick", "s1"]]);
  fire("keydown", { key: "ArrowRight" }); // nothing picked yet: the arrows are the view's
  near(matrix()[1], 186 - 48, "the view slid");
  assert.deepEqual(heard, []);
  view.show({ ...SCENE, picked: "s1" }, true);
  fire("keydown", { key: "ArrowRight" });
  fire("keydown", { key: "ArrowUp", shiftKey: true });
  fire("keydown", { key: "ArrowLeft" });
  fire("keydown", { key: "ArrowDown", shiftKey: true });
  fire("keydown", { key: "r" });
  fire("keydown", { key: "R", shiftKey: true });
  fire("keydown", { key: "Escape" });
  assert.deepEqual(heard, [["move", "s1", 1, 0, true], ["move", "s1", 0, 10, true], ["move", "s1", -1, 0, true], ["move", "s1", 0, -10, true], ["turn", "s1", 90], ["turn", "s1", -90], ["pick", null]]);
  near(matrix()[1], 186, "the view stayed where it was");
  assert.equal(fire("keydown", { key: "r", ctrlKey: true }).defaultPrevented, false); // reload stays the browser's
  // A pick that is no longer on the bed is no pick: the arrows are the view's again.
  heard.length = 0;
  view.show({ bed: SCENE.bed, parts: [], picked: "s1" }, true);
  fire("keydown", { key: "ArrowRight" });
  assert.deepEqual(heard, []);
  near(matrix()[1], 186 - 48, "the view slid");
});

test("a part that sits wrongly is marked and says why; with no one listening for moves a press on a part slides the view as before", () => {
  const { host, view, fireOn, part, matrix } = setUp();
  view.attach(host);
  view.show({ bed: SCENE.bed, parts: [{ ...RECT, warn: "off the bed: 5 mm past the right side" }] }, true);
  assert.equal(part("s1").getAttribute("class"), "laser-flat-part laser-flat-part-cut laser-flat-part-warn");
  assert.equal(part("s1").querySelector("title")!.textContent, "Sketch 1, cut, 40 × 30 mm, off the bed: 5 mm past the right side");
  assert.equal(part("s1").getAttribute("tabindex"), null); // nothing to pick it for
  fireOn(part("s1"), "pointerdown", { pointerId: 1, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointermove", { pointerId: 1, clientX: 240, clientY: 630 });
  near(matrix()[1], 226, "the view slid");
  assert.equal(part("s1").getAttribute("transform"), null);
});

test("a part being dragged stays in the hand through a redraw that left it as it was; a redraw that moved it ends the drag", () => {
  const { view, fireOn, part, heard } = withHandlers();
  const other = { id: "s2", label: "Sketch 2", d: "M100 -3L140 -3L140 -33L100 -33Z", box: { minX: 100, minY: 3, maxX: 140, maxY: 33 } };
  fireOn(part("s1"), "pointerdown", { pointerId: 1, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointermove", { pointerId: 1, clientX: 300, clientY: 600 }); // (63, 31) mm, as worked above
  // The page draws again (an answer about other parts came in): s1 itself is as it was.
  view.show({ bed: SCENE.bed, parts: [RECT, { ...other, warn: "overlaps Sketch 3" }] }, false);
  assert.equal(part("s1").getAttribute("transform"), "translate(63 -31)");
  assert.equal(view.element.dataset.moving, "s1");
  fireOn(part("s1"), "pointerup", { pointerId: 1, clientX: 300, clientY: 600 });
  assert.deepEqual(heard.splice(0), [["move", "s1", 63, 31, false]]);
  // The scene moves the part under the hand (an Undo, a typed number): the drag is over and tells nobody.
  fireOn(part("s1"), "pointerdown", { pointerId: 1, clientX: 200, clientY: 650 });
  fireOn(part("s1"), "pointermove", { pointerId: 1, clientX: 300, clientY: 600 });
  view.show({ bed: SCENE.bed, parts: [{ ...RECT, d: "M13 -3L53 -3L53 -33L13 -33Z", box: { minX: 13, minY: 3, maxX: 53, maxY: 33 } }] }, false);
  assert.equal(part("s1").getAttribute("transform"), null);
  assert.equal(view.element.dataset.moving, undefined);
  fireOn(part("s1"), "pointerup", { pointerId: 1, clientX: 300, clientY: 600 });
  assert.deepEqual(heard, []);
});

test("hand-worked: each layer drawn in its own look, and a key above the bed's top-right corner names only the layers on it", () => {
  const { host, view, part } = setUp();
  view.attach(host);
  const engraved = { ...RECT, id: "s2", label: "Sketch 2", op: "engrave" as const, d: "M50 -3L60 -3L60 -13L50 -13Z", box: { minX: 50, minY: 3, maxX: 60, maxY: 13 } };
  view.show({ ...SCENE, parts: [RECT, engraved] }, true);
  // A part with no layer given is cut.
  assert.equal(part("s1").getAttribute("class"), "laser-flat-part laser-flat-part-cut");
  assert.equal(part("s2").getAttribute("class"), "laser-flat-part laser-flat-part-engrave");
  assert.equal(part("s2").querySelector("title")!.textContent, "Sketch 2, engrave, 10 × 10 mm");
  // The key, worked by hand: fitted at 1.59 px per mm with the origin at (186, 672), the bed's top-right corner is at
  // (186 + 400 × 1.59, 672 − 400 × 1.59) = (822, 36); the key's line is 8 px above it, y = 28. Right to left: "Cut" ends
  // at x = 822, its swatch (10 px) 4 px before the words, which are 3 × 6.2 = 18.6 px wide: x = 822 − 18.6 − 4 − 10 =
  // 789.4. Then 12 px of space: "Engrave" ends at 777.4, its swatch at 777.4 − 7 × 6.2 − 4 − 10 = 720. No Score: none on the bed.
  const key = [...view.element.querySelectorAll("text.laser-flat-key")].map((t) => [t.textContent, t.getAttribute("x"), t.getAttribute("y"), t.getAttribute("text-anchor")]);
  assert.deepEqual(key, [["Cut", "822.0", "28.0", "end"], ["Engrave", "777.4", "28.0", "end"]]);
  const swatches = [...view.element.querySelectorAll("rect.laser-flat-swatch")].map((r) => [r.getAttribute("class"), r.getAttribute("x"), r.getAttribute("y")]);
  // Each swatch sits on the words' line: its top 9 px above it (10 px tall, 1 px below the line).
  assert.deepEqual(swatches, [["laser-flat-swatch laser-flat-part-cut", "789.4", "19.0"], ["laser-flat-swatch laser-flat-part-engrave", "720.0", "19.0"]]);
  // No parts, no key.
  view.show({ ...SCENE, parts: [] }, false);
  assert.equal(view.element.querySelectorAll(".laser-flat-key, .laser-flat-swatch").length, 0);
  view.detach();
});
