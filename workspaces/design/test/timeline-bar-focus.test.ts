// The merge queue's flake on view-menu.mjs's "round 2 hunt E5" check: the
// bar is drawn new on every redraw (an undo's rebuild finishing draws it
// again), so the item a keyboard user had focused was thrown away with the
// old bar and focus fell to the page; the Delete or Backspace pressed next
// found no focused item and did nothing. The new bar now gives focus back
// to the same item, when the old bar held it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../src/document.ts";
import { addSketch } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { showTimelineBar } from "../src/timeline-bar.ts";

const { Window } = await import("happy-dom");

const threeItems = () => extrudeSketch(addSketch(partDocument("box", 40, 30, 20)).doc, "sketch-2", 10).doc;

function setUp() {
  const window = new Window({ width: 1280, height: 800 });
  const slot = window.document.createElement("div") as unknown as HTMLElement;
  window.document.body.append(slot as never);
  const doc = threeItems();
  showTimelineBar(slot, doc);
  return { window, slot, doc, focused: () => (window.document.activeElement as unknown as HTMLElement | null)?.closest?.("[data-item]")?.getAttribute("data-item") ?? null };
}

test("a redraw keeps focus on the bar item that had it, the same item on the new bar", () => {
  const { slot, doc, focused } = setUp();
  slot.querySelector<HTMLElement>('[data-item="sketch-2"]')!.focus();
  assert.equal(focused(), "sketch-2");
  showTimelineBar(slot, doc);
  assert.equal(focused(), "sketch-2", "focus on the redrawn item");
  assert.ok(slot.querySelector('[data-item="sketch-2"]')!.isConnected);
});

test("a redraw takes no focus when the bar had none, and none for an item that is gone", () => {
  const { window, slot, doc, focused } = setUp();
  showTimelineBar(slot, doc);
  assert.equal(focused(), null, "nothing focused before: nothing after");
  assert.equal(window.document.activeElement, window.document.body);
  // Focus on the extrude, then a redraw of a document without it: nothing to give focus to.
  slot.querySelector<HTMLElement>(`[data-item="${doc.timeline.features.at(-1)!.id}"]`)!.focus();
  showTimelineBar(slot, partDocument("box", 40, 30, 20));
  assert.equal(focused(), null);
});
