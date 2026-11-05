import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryInUnit } from "@fission/core";
import { partDocument } from "../src/document.ts";
import { browserTree } from "../src/browser.ts";
import { timelineBarItems } from "../src/timeline-bar.ts";
import { cardFacts } from "../src/timeline-card.ts";
import { propertiesPanel } from "../src/properties.ts";

// U2c3: the words the browser's Timeline rows, the bar's tooltips, the card and the Feature line say about an item
// follow the unit chosen in Settings. The saved summary stays in millimetres; only what is shown changes.

const box = () => partDocument("box", 40, 30, 20); // Box: 40 × 30 × 20 mm
const rowTitle = (tree: ReturnType<typeof browserTree>) => tree.find((n) => n.id === "timeline")!.children![0].title;

test("the saved summary is millimetres whichever unit is shown", () => {
  assert.equal(box().timeline.features[0].intent.summary, "Box: 40 × 30 × 20 mm");
});

test("hand-worked: the browser's Timeline row says the box in inches (40, 30, 20 / 25.4 = 1.575, 1.181, 0.787)", () => {
  assert.equal(rowTitle(browserTree(box())), "Box 1\nBox: 40 × 30 × 20 mm", "millimetres as before");
  assert.equal(rowTitle(browserTree(box(), undefined, false, "in")), "Box 1\nBox: 1.575 × 1.181 × 0.787 in");
});

test("the bar's tooltip description and the card follow the unit", () => {
  const doc = box();
  assert.equal(timelineBarItems(doc).items[0].description, "Box: 40 × 30 × 20 mm");
  assert.equal(timelineBarItems(doc, undefined, undefined, (s) => summaryInUnit(s, "in")).items[0].description, "Box: 1.575 × 1.181 × 0.787 in");
  const item = timelineBarItems(doc).items[0];
  assert.deepEqual(cardFacts(doc, doc.timeline.features[0], item, 0).details, ["40 × 30 × 20 mm", "width × depth × height"]);
  assert.deepEqual(cardFacts(doc, doc.timeline.features[0], item, 0, undefined, "in").details, ["1.575 × 1.181 × 0.787 in", "width × depth × height"]);
});

test("the Feature line of the Properties panel follows a unit change", async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("aside");
  doc.body.append(slot);
  const panel = propertiesPanel(slot);
  panel.showFeature(box().timeline.features[0]);
  assert.equal(slot.querySelector("#intent")!.textContent, "Box: 40 × 30 × 20 mm");
  doc.documentElement.dataset.unit = "in";
  doc.dispatchEvent(new window.CustomEvent("unitchange", { detail: "in" }) as unknown as Event);
  assert.equal(slot.querySelector("#intent")!.textContent, "Box: 1.575 × 1.181 × 0.787 in");
  panel.showFeature(null);
  assert.notEqual(slot.querySelector("#intent")!.textContent, "");
});
