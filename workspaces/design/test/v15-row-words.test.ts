// SL #512 item 1: version 16 made an Extrude Join's piece 1 the Join's own
// body, so a version 15 description naming "a piece of Extrude 1" for that
// piece is said as today's ("Extrude 1"); a description naming another piece
// of the same Join too is left as saved, since which "a piece of" is which
// can't be told from the words. The real file is in packages/testing
// journeys/old-files-later.journey.ts (v15-join-piece).

import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateDesignV15 } from "../src/document.ts";

/** A version 15 design: Box 1, an Extrude Join (feature-3) of Sketch 1 to it, then `later`. */
function v15(...later: Record<string, unknown>[]): Record<string, unknown> {
  const join = { id: "feature-3", intent: { type: "extrude", parameters: { sketch: "sketch-2", distance: 5, operation: "join", bodies: ["body:feature-1"] }, summary: "Extrude Sketch 1 by 5 mm, joined to Box 1" }, provenance: { self: { workspace: "design", id: "feature-3", label: "Extrude 1" }, from: [] }, dependsOn: ["sketch-2", "feature-1"], suppressed: false };
  return { version: 15, timeline: { features: [join, ...later] } };
}
const from = [{ workspace: "design", id: "feature-3", label: "Extrude 1" }, { workspace: "design", id: "feature-1", label: "Box 1" }];
const item = (id: string, type: string, parameters: Record<string, unknown>, summary: string) => ({ id, intent: { type, parameters, summary }, provenance: { self: { workspace: "design", id, label: id }, from }, dependsOn: ["feature-3"], suppressed: false });
const words = (d: Record<string, unknown>, id: string) => ((d.timeline as { features: { id: string; intent: { summary: string } }[] }).features.find((f) => f.id === id)!.intent.summary);

test("#512 item 1, by hand: a Copy and a Combine naming the Join's piece 1 say its own body's name after the upgrade", () => {
  const d = migrateDesignV15(
    v15(
      item("feature-4", "duplicate", { body: "body:feature-3/piece:1" }, "Copy of a piece of Extrude 1"),
      item("feature-5", "combine", { target: "body:feature-1", tools: ["body:feature-3/piece:1"], operation: "cut", keepTools: false }, "Cut a piece of Extrude 1 from Box 1"),
    ),
  );
  // Piece 1 is now body:feature-3, which combine.ts and duplicate.ts name "Extrude 1" (no "a piece of").
  assert.equal(words(d, "feature-4"), "Copy of Extrude 1");
  assert.equal(words(d, "feature-5"), "Cut Extrude 1 from Box 1");
});

test("#512 item 1: another piece keeps its words, and a description naming two pieces of the Join is left as saved", () => {
  const d = migrateDesignV15(
    v15(
      item("feature-4", "duplicate", { body: "body:feature-3/piece:2" }, "Copy of a piece of Extrude 1"),
      item("feature-5", "combine", { target: "body:feature-3/piece:2", tools: ["body:feature-3/piece:1"], operation: "join", keepTools: false }, "Join a piece of Extrude 1 to a piece of Extrude 1"),
      item("feature-6", "duplicate", { body: "body:feature-3/piece:1" }, "Copied by hand"),
    ),
  );
  // Piece 2 becomes piece 1, still a piece: "a piece of Extrude 1" is right.
  assert.equal(words(d, "feature-4"), "Copy of a piece of Extrude 1");
  // Two pieces named: which words are piece 1's can't be told, so they stay.
  assert.equal(words(d, "feature-5"), "Join a piece of Extrude 1 to a piece of Extrude 1");
  // Words that don't name the piece as a description does are left alone.
  assert.equal(words(d, "feature-6"), "Copied by hand");
});
