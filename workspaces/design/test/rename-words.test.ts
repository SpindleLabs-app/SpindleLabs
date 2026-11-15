// SL #524 item 1 (app bug hunt 2026-11-11): after Rename, items made from the renamed one still described it by its old
// name ("Mirror of Box 1 across the YZ plane", "Cut Box 2 from Box 1", "Move Box 1 by …") while the delete question said
// the new one. As Fusion does, every description naming the item says its name now; only the whole name changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertCombine } from "../src/combine.ts";
import { bodyIdOf, insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertDuplicates } from "../src/duplicate.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { renameItem } from "../src/timeline-edits.ts";

const renamed = (doc: DesignDocument, id: string, typed: string) => {
  const r = renameItem(doc, id, typed);
  if ("refused" in r) throw new Error(`refused: ${r.message}`);
  return r.doc;
};
const words = (doc: DesignDocument) => doc.timeline.features.map((f) => `${f.provenance.self.label}: ${f.intent.summary}`);

/** Box 1, then Boxes 2 to 10 (so a "Box 10" is there to leave alone), a Mirror of Box 1, a Move of Box 1, and Box 10 cut from Box 1. */
function design() {
  let doc = partDocument("box", 40, 30, 20);
  const ids = ["feature-1"];
  for (let k = 2; k <= 10; k++) {
    const p = insertPreset(doc, "box", 10, 10, 10);
    doc = p.doc;
    ids.push(p.id);
  }
  const mirror = insertDuplicates(doc, [bodyIdOf("feature-1")], "YZ");
  doc = mirror.doc;
  const move = insertMove(doc, [bodyIdOf("feature-1")], { ...NO_MOVE, x: 10 });
  doc = move.doc;
  const cut = insertCombine(doc, bodyIdOf("feature-1"), [bodyIdOf(ids[9])], "cut");
  return { doc: cut.doc, mirror: mirror.ids[0], move: move.id, cut: cut.id, ten: ids[9] };
}

test("hand-worked: Box 1 renamed Base: the Mirror, the Move and the Cut say Base; Box 10 stays Box 10", () => {
  const { doc, mirror, move, cut } = design();
  const before = words(doc);
  const at = (d: DesignDocument, id: string) => d.timeline.features.find((f) => f.id === id)!.intent.summary;
  assert.equal(at(doc, mirror), "Mirror of Box 1 across the YZ plane");
  assert.equal(at(doc, move), "Move Box 1 by (10, 0, 0) mm");
  assert.equal(at(doc, cut), "Cut Box 10 from Box 1");
  const base = renamed(doc, "feature-1", "Base");
  // Worked by hand: "Box 1" is replaced where it is the whole name; "Box 10" holds "Box 1" followed by a digit, so stays.
  assert.equal(at(base, mirror), "Mirror of Base across the YZ plane");
  assert.equal(at(base, move), "Move Base by (10, 0, 0) mm");
  assert.equal(at(base, cut), "Cut Box 10 from Base");
  // Every other item's words as they were (the boxes' sizes), and the renamed item's own.
  const changed = words(base).map((w, k) => (w === before[k] ? null : k)).filter((k) => k !== null);
  assert.deepEqual(changed.map((k) => base.timeline.features[k!].id), ["feature-1", mirror, move, cut]);
});

test("a name with characters a pattern would read (a dot, brackets, a dollar) is replaced as plain text", () => {
  const { doc, mirror } = design();
  const odd = renamed(doc, "feature-1", "Base (v1.2) $&");
  assert.equal(odd.timeline.features.find((f) => f.id === mirror)!.intent.summary, "Mirror of Base (v1.2) $& across the YZ plane");
  // Renamed again from that name: the brackets and dot in the old name are matched as themselves.
  const again = renamed(odd, "feature-1", "Plate");
  assert.equal(again.timeline.features.find((f) => f.id === mirror)!.intent.summary, "Mirror of Plate across the YZ plane");
});

test("an item not made from the renamed one keeps its words even when they hold the same text", () => {
  const { doc, ten } = design();
  // Box 10 renamed: the Cut names Box 10 (its tool) and follows; Box 1's Mirror doesn't name Box 10 and stays.
  const two = renamed(doc, ten, "Cutter");
  assert.ok(two.timeline.features.some((f) => f.intent.summary === "Cut Cutter from Box 1"));
  assert.ok(two.timeline.features.some((f) => f.intent.summary === "Mirror of Box 1 across the YZ plane"));
});
