// SL #507 (Combine check 11-11): the reader trusted a Combine's saved
// description, so a hand-edited file could show "Join" on a row whose solid
// is the Cut. A Combine's description says its operation first and ends
// ", keeping the tools" exactly when it keeps them (combine.ts
// combineSummary); the reader now refuses one that doesn't.

import { test } from "node:test";
import assert from "node:assert/strict";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";

/** Box 1 and Box 2 and Combine 1 of them as `insertCombine` makes it, as a file's JSON. */
function file(operation: "cut" | "join" | "intersect", keep = false): DesignDocument {
  let doc = partDocument("box", 40, 30, 20);
  let id: string;
  ({ doc, id } = insertPreset(doc, "box", 10, 10, 10));
  return JSON.parse(JSON.stringify(insertCombine(doc, "body:feature-1", [`body:${id}`], operation, keep).doc));
}
const combine = (d: DesignDocument) => d.timeline.features.find((f) => f.intent.type === "combine")!;
const refusal = (d: DesignDocument) => {
  try {
    readDesignDocument(d);
  } catch (e) {
    return (e as Error).message;
  }
  return "opened";
};

test("#507, by hand: every Combine the app makes opens, its words as made", () => {
  // combineSummary: "Cut Box 2 from Box 1", "Join Box 2 to Box 1", "Intersect Box 1 with Box 2", each with
  // ", keeping the tools" after it when Keep tools is on.
  const words = [];
  for (const op of ["cut", "join", "intersect"] as const) {
    for (const keep of [false, true]) {
      const d = file(op, keep);
      assert.deepEqual(readDesignDocument(d), d);
      words.push(combine(d).intent.summary);
    }
  }
  assert.deepEqual(words, ["Cut Box 2 from Box 1", "Cut Box 2 from Box 1, keeping the tools", "Join Box 2 to Box 1", "Join Box 2 to Box 1, keeping the tools", "Intersect Box 1 with Box 2", "Intersect Box 1 with Box 2, keeping the tools"]);
});

test("#507: a Cut whose saved words say Join is refused, naming what they must say", () => {
  const d = file("cut");
  combine(d).intent.summary = "Join Box 2 to Box 1";
  assert.equal(refusal(d), `Design combine ${combine(d).id}'s description "Join Box 2 to Box 1" doesn't say it is a cut: it must start with "Cut"`);
  // An Intersect's words on a Join, and a lower-case verb, the same.
  const j = file("join");
  combine(j).intent.summary = "Intersect Box 1 with Box 2";
  assert.match(refusal(j), /doesn't say it is a join: it must start with "Join"$/);
  combine(j).intent.summary = "join Box 2 to Box 1";
  assert.match(refusal(j), /doesn't say it is a join/);
});

test("#507: words saying the tools are kept on a Combine that uses them up, or the other way round, are refused", () => {
  const used = file("cut");
  combine(used).intent.summary = "Cut Box 2 from Box 1, keeping the tools";
  assert.match(refusal(used), /says it keeps its tools, but it uses them up$/);
  const kept = file("cut", true);
  combine(kept).intent.summary = "Cut Box 2 from Box 1";
  assert.match(refusal(kept), /doesn't say it keeps its tools$/);
});
