// Extrude's Operation row (Fusion's New body, Join, Cut, Intersect) and its
// list of bodies: the boxes' meeting rule (extrude-operation.ts) and the
// panel in a real DOM (happy-dom). Every expected answer is worked out by
// hand from the boxes and the list given, beside each assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyChoices, boxesMeet, operationNote, REACH, tickedBodies, type Bounds } from "../src/extrude-operation.ts";
import { extrudePanel, NEW_BODY_NOTE } from "../src/extrude-panel.ts";

const { Window } = await import("happy-dom");

const box = (lo: [number, number, number], hi: [number, number, number]): Bounds => [lo, hi];
const CUBE = box([0, 0, -5], [10, 10, 5]);

test("hand-worked: two boxes meet when they overlap or touch on every axis, within REACH (10 nm), and not past it", () => {
  // The square x 2..6, y 2..6 extruded z 0..20 overlaps the cube x 0..10, y 0..10, z −5..5 on all three axes.
  assert.equal(boxesMeet(box([2, 2, 0], [6, 6, 20]), CUBE), true);
  // A sketch on the cube's top (z = 5) extruded up runs z 5..25: it touches the top, which counts (a Join onto its own face).
  assert.equal(boxesMeet(box([2, 2, 5], [6, 6, 25]), CUBE), true);
  // Apart along x: x 20..30 starts 10 mm past the cube's 10.
  assert.equal(boxesMeet(box([20, 2, 0], [30, 6, 20]), CUBE), false);
  // Apart along y only (x and z overlap): y 11..12 is past 10, so they do not meet; one axis apart is enough.
  assert.equal(boxesMeet(box([2, 11, 0], [6, 12, 20]), CUBE), false);
  // The boundary: a gap of 0.9 × REACH above the top counts as touching, 1.1 × REACH does not. Either order.
  for (const [k, meets] of [[0.9, true], [1.1, false]] as const) {
    const above = box([2, 2, 5 + k * REACH], [6, 6, 25]);
    assert.equal(boxesMeet(above, CUBE), meets, `${k} × REACH`);
    assert.equal(boxesMeet(CUBE, above), meets, `${k} × REACH, other order`);
  }
  // And below the bottom (z = −5), on the low side.
  for (const [k, meets] of [[0.9, true], [1.1, false]] as const) assert.equal(boxesMeet(box([2, 2, -20], [6, 6, -5 - k * REACH]), CUBE), meets, `${k} × REACH below`);
});

test("hand-worked: the list holds the bodies reached, in the scene's order, ticked unless unticked; the words follow it", () => {
  const bodies = [
    { body: "body:feature-1", label: "Body 1", bounds: CUBE },
    { body: "body:feature-4", label: "Body 2", bounds: box([20, 0, -5], [30, 10, 5]) },
    { body: "body:feature-6", label: "Body 3", bounds: box([100, 0, 0], [110, 10, 10]) },
  ];
  // The bridge x 5..25, y 2..6, z 0..20 reaches Body 1 (x 0..10) and Body 2 (x 20..30), not Body 3 (x 100..110).
  const bridge = box([5, 2, 0], [25, 6, 20]);
  const list = bodyChoices(bridge, bodies, new Set());
  assert.deepEqual(list, [
    { body: "body:feature-1", label: "Body 1", ticked: true },
    { body: "body:feature-4", label: "Body 2", ticked: true },
  ]);
  assert.deepEqual(tickedBodies(list), ["body:feature-1", "body:feature-4"]);
  assert.deepEqual(operationNote("join", list), { text: "The extrude is joined to Body 1 and Body 2, all into the first.", ready: true });
  assert.deepEqual(operationNote("cut", list), { text: "The extrude is cut from Body 1 and Body 2.", ready: true });
  assert.deepEqual(operationNote("intersect", list), { text: "Only what Body 1 and Body 2 each share with the extrude is kept.", ready: true });
  // Body 1 unticked: only Body 2 is used.
  const one = bodyChoices(bridge, bodies, new Set(["body:feature-1"]));
  assert.deepEqual(tickedBodies(one), ["body:feature-4"]);
  assert.deepEqual(operationNote("cut", one), { text: "The extrude is cut from Body 2.", ready: true });
  assert.deepEqual(operationNote("intersect", one), { text: "Only what Body 2 shares with the extrude is kept.", ready: true });
  // Both unticked: OK off, and the words say what to do.
  const none = bodyChoices(bridge, bodies, new Set(["body:feature-1", "body:feature-4"]));
  assert.deepEqual(tickedBodies(none), []);
  assert.deepEqual(operationNote("join", none), { text: "Tick a body to join to.", ready: false });
  assert.deepEqual(operationNote("cut", none), { text: "Tick a body to cut.", ready: false });
  // Reaching nothing: an empty list, OK off.
  const far = bodyChoices(box([50, 50, 50], [60, 60, 60]), bodies, new Set());
  assert.deepEqual(far, []);
  assert.equal(operationNote("cut", far).ready, false);
  assert.match(operationNote("cut", far).text, /^The extrude reaches no body yet/);
});

function setup() {
  const window = new Window({ width: 1280, height: 800 });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const heard: string[] = [];
  const panel = extrudePanel(slot, {
    distance: () => heard.push("distance"),
    flip: () => heard.push("flip"),
    clear: () => heard.push("clear"),
    ok: () => heard.push("ok"),
    cancel: () => heard.push("cancel"),
    operation: (op) => heard.push(`operation ${op}`),
    tick: (body, on) => heard.push(`tick ${body} ${on}`),
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  return { window, doc, panel, heard, $ };
}

test("without operations (Combine hidden) the panel has no Operation row and says the extrude is a new body", () => {
  const { panel, $ } = setup();
  panel.show("Sketch 1", "0");
  assert.equal($("extrude-operation"), null);
  assert.equal($("extrude-what").textContent, NEW_BODY_NOTE);
  assert.equal(panel.operation, "new");
  panel.showStatus("Sketch 1 makes a closed outline.", true);
  assert.equal(panel.ready, true);
});

test("hand-worked: the Operation row starts at New body; Cut shows the list, and OK needs both a closed outline and a body ticked", () => {
  const { panel, heard, $ } = setup();
  panel.show("Sketch 1", "20", true);
  const select = $<HTMLSelectElement>("extrude-operation");
  assert.deepEqual([...select.options].map((o) => [o.value, o.textContent]), [["new", "New body"], ["join", "Join"], ["cut", "Cut"], ["intersect", "Intersect"]]);
  assert.equal(select.value, "new");
  assert.equal($("extrude-bodies").hidden, true);
  // New body with a closed outline: OK on.
  panel.showStatus("Sketch 1 makes a closed outline.", true);
  assert.equal(panel.ready, true);
  // Cut: the list shows; with nothing listed yet OK is off.
  select.value = "cut";
  select.dispatchEvent(new (select.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event("change"));
  assert.deepEqual(heard, ["operation cut"]);
  assert.equal(panel.operation, "cut");
  assert.equal($("extrude-bodies").hidden, false);
  panel.showBodies([], "The extrude reaches no body yet.", false);
  assert.equal(panel.ready, false);
  // Body 1 listed and ticked: OK on, the words shown.
  panel.showBodies([{ body: "body:feature-1", label: "Body 1", ticked: true }], "The extrude is cut from Body 1.", true);
  assert.equal(panel.ready, true);
  assert.equal($("extrude-what").textContent, "The extrude is cut from Body 1.");
  const tick = $("extrude-bodies").querySelector<HTMLInputElement>("input[type=checkbox]")!;
  assert.equal(tick.checked, true);
  assert.equal(tick.dataset.body, "body:feature-1");
  assert.equal(tick.parentElement!.textContent!.trim(), "Body 1");
  // Unticked by the person: the workspace hears it.
  tick.checked = false;
  tick.dispatchEvent(new (tick.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event("change"));
  assert.deepEqual(heard, ["operation cut", "tick body:feature-1 false"]);
  // The outline no longer closes: OK off even with a body ticked.
  panel.showStatus("Sketch 1 can't be extruded.", false);
  assert.equal(panel.ready, false);
  // Back to New body: the list hides, the note is a new body's, OK follows the outline alone.
  panel.showStatus("Sketch 1 makes a closed outline.", true);
  panel.showBodies([], "Tick a body to cut.", false);
  assert.equal(panel.ready, false);
  select.value = "new";
  select.dispatchEvent(new (select.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event("change"));
  assert.equal($("extrude-bodies").hidden, true);
  assert.equal($("extrude-what").textContent, NEW_BODY_NOTE);
  assert.equal(panel.ready, true);
});

test("the list's words never show under New body, and opening the panel again starts at New body", () => {
  const { panel, $ } = setup();
  panel.show("Sketch 1", "20", true);
  panel.showBodies([{ body: "body:feature-1", label: "Body 1", ticked: true }], "The extrude is cut from Body 1.", true);
  assert.equal($("extrude-what").textContent, NEW_BODY_NOTE);
  const select = $<HTMLSelectElement>("extrude-operation");
  select.value = "join";
  panel.hide();
  panel.show("Sketch 2", "5", true);
  assert.equal($<HTMLSelectElement>("extrude-operation").value, "new");
  assert.equal(panel.operation, "new");
});
