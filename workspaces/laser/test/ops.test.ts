// Layers (ops.ts), by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OP, isOp, OP_LOOK, opOf, OPS, overlapMatters, readOps, withOp } from "../src/ops.ts";

test("a part is cut unless an entry says otherwise; the beam's order is engrave, score, cut", () => {
  assert.equal(DEFAULT_OP, "cut");
  assert.equal(opOf({}, "a"), "cut");
  assert.equal(opOf({ a: "engrave" }, "a"), "engrave");
  assert.equal(opOf({ a: "engrave" }, "b"), "cut");
  // An id that is a property every object has is still just an id.
  assert.equal(opOf({}, "toString"), "cut");
  assert.equal(opOf({}, "__proto__"), "cut");
  assert.deepEqual(OPS, ["engrave", "score", "cut"]);
});

test("setting a part's layer keeps only what isn't cut, and never touches another part's", () => {
  const ops = withOp({}, "a", "score");
  assert.deepEqual(ops, { a: "score" });
  assert.deepEqual(withOp(ops, "b", "engrave"), { a: "score", b: "engrave" });
  // Back to cut: the entry goes, as if never chosen.
  assert.deepEqual(withOp({ a: "score", b: "engrave" }, "a", "cut"), { b: "engrave" });
  assert.deepEqual(withOp({}, "a", "cut"), {});
  // The input is not changed.
  const held = { a: "score" as const };
  withOp(held, "a", "engrave");
  assert.deepEqual(held, { a: "score" });
});

test("the project's layers are read defensively: anything not a layer's name, and cut, is dropped; never throws", () => {
  assert.deepEqual(readOps({ a: "engrave", b: "score", c: "cut", d: "Engrave", e: 3, f: null, g: ["score"] }), { a: "engrave", b: "score" });
  for (const bad of [undefined, null, 7, "engrave", ["engrave"], true]) assert.deepEqual(readOps(bad), {}, JSON.stringify(bad));
  assert.equal(isOp("cut") && isOp("score") && isOp("engrave"), true);
  assert.equal(isOp("CUT") || isOp("") || isOp(undefined) || isOp("fill"), false);
});

test("overlaps matter only between two cut parts: an engraving or a score lying on a part is what it is for", () => {
  assert.equal(overlapMatters("cut", "cut"), true);
  for (const [a, b] of [["cut", "engrave"], ["engrave", "cut"], ["cut", "score"], ["score", "cut"], ["engrave", "score"], ["score", "score"], ["engrave", "engrave"]] as const)
    assert.equal(overlapMatters(a, b), false, `${a} ${b}`);
});

test("each layer's paint and DXF colour: cut red, score blue, engrave filled black (DXF colours 1, 5, 7)", () => {
  assert.match(OP_LOOK.cut.svgPaint, /fill="none" stroke="#f00"/);
  assert.match(OP_LOOK.score.svgPaint, /fill="none" stroke="#00f"/);
  assert.equal(OP_LOOK.engrave.svgPaint, `fill="#000" stroke="none"`);
  assert.deepEqual(OPS.map((o) => [OP_LOOK[o].dxfLayer, OP_LOOK[o].dxfColour]), [["ENGRAVE", 7], ["SCORE", 5], ["CUT", 1]]);
});
