import { test } from "node:test";
import assert from "node:assert/strict";
import { openTool, openToolRefusal, stillRebuilding, type ToolsOpen } from "../src/open-tool.ts";

// SL #639 item 1: an export pressed with a tool still open saves the design as recorded, not what the tool shows, so
// it is refused in words naming the tool. The words are written out by hand here, as a person would read them.

const NONE: ToolsOpen = { move: null, extrude: false, edit: null, combine: null, sketch: null };
const names: Record<string, string> = { "feature-1": "Box 1", "feature-3": "Move 1", "feature-4": "Combine 1", "sketch-5": "Sketch 2" };
const name = (id: string) => names[id] ?? id;
const said = (open: Partial<ToolsOpen>, verb = "Export STL") => openToolRefusal(openTool({ ...NONE, ...open }, name), verb);

test("no tool open: the export goes ahead (Measure is not among the tools: it only reads the bodies)", () => {
  assert.equal(said({}), null);
  assert.equal(openTool(NONE, name), null);
});

test("a new Move that moves nothing yet (as Insert opens one) holds nothing up: the view shows the design as recorded", () => {
  assert.equal(said({ move: { kind: "move", editing: null, still: true } }), null);
  assert.equal(said({ move: { kind: "scale", editing: null, still: true } }), null);
  // An edited Move is its own change being made again, so it waits even with its numbers as recorded.
  assert.match(said({ move: { kind: "move", editing: "feature-3", still: true } })!, /^Move 1 is still open/);
});

test("each tool that changes the bodies is named as its panel names it, with how to finish it", () => {
  const tail = "Export STL saves the design as it is recorded, not what an open tool shows.";
  assert.equal(said({ move: { kind: "move", editing: null, still: false } }), `Move is still open: press OK or Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ move: { kind: "rotate", editing: null, still: false } }), `Rotate is still open: press OK or Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ move: { kind: "scale", editing: null, still: false } }), `Scale is still open: press OK or Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ move: { kind: "move", editing: "feature-3", still: false } }), `Move 1 is still open: press OK or Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ extrude: true }), `Extrude is still open: press OK or Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ edit: "feature-1" }), `Edit Box 1 is still open: press OK or Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ combine: { editing: null } }), `Combine is still open: press OK or Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ combine: { editing: "feature-4" } }), `Edit Combine 1 is still open: press OK or Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ sketch: { kind: "pick" } }), `Sketch is still open: pick its plane or press Cancel first, then Export STL. ${tail}`);
  assert.equal(said({ sketch: { kind: "edit", id: "sketch-5" } }), `Sketch 2 is still open: press Finish sketch first, then Export STL. ${tail}`);
  assert.equal(said({ sketch: { kind: "edit", id: null } }), `The sketch is still open: press Finish sketch first, then Export STL. ${tail}`);
});

test("the verb is the route's own: Slice for printing and Preview say theirs", () => {
  assert.equal(said({ move: { kind: "move", editing: null, still: false } }, "Slice for printing"), "Move is still open: press OK or Cancel first, then Slice for printing. Slice for printing saves the design as it is recorded, not what an open tool shows.");
  assert.match(said({ extrude: true }, "Preview")!, /^Extrude is still open: press OK or Cancel first, then Preview\./);
});

test("which panel says it: the tool's own, and the plane prompt's words under the properties", () => {
  const tools = (open: Partial<ToolsOpen>) => openTool({ ...NONE, ...open }, name)?.tool;
  assert.equal(tools({ move: { kind: "scale", editing: null, still: false } }), "move");
  assert.equal(tools({ extrude: true }), "extrude");
  assert.equal(tools({ edit: "feature-1" }), "edit");
  assert.equal(tools({ combine: { editing: null } }), "combine");
  assert.equal(tools({ sketch: { kind: "pick" } }), "pick");
  assert.equal(tools({ sketch: { kind: "edit", id: "sketch-5" } }), "sketch");
});

test("an export asked before the design is built as it is now says nothing was saved, naming the export (SL #675 item 1)", () => {
  assert.equal(stillRebuilding("Export STL"), "The design has not finished rebuilding, so nothing was saved: try Export STL again in a moment.");
  assert.equal(stillRebuilding("Export 3MF"), "The design has not finished rebuilding, so nothing was saved: try Export 3MF again in a moment.");
});
