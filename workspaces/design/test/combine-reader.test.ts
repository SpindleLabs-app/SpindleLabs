// Combine bug hunt 2026-11-06: Combine items and the file reader (readDesignDocument), hand-crafted files and saved-then-opened edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertCombine } from "../src/combine.ts";
import { insertPreset, numberPieces, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { deleteItem } from "../src/timeline-edits.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";

const kernel = nodeKernel();

const box = (id: string, label: string) => ({
  id,
  intent: { type: "box", parameters: { width: 10, depth: 10, height: 10 }, summary: "Box" },
  provenance: { self: { workspace: "design", id, label }, from: [] },
  dependsOn: [],
  suppressed: false,
});
const combine = (id: string, params: Record<string, unknown>, dependsOn: string[]) => ({
  id,
  intent: { type: "combine", parameters: { operation: "cut", keepTools: false, ...params }, summary: "Combine" },
  provenance: { self: { workspace: "design", id, label: id }, from: [] },
  dependsOn,
  suppressed: false,
});
const file = (features: unknown[], bodies: { id: string; number: number }[], nextId: number) => ({
  version: 8, nextId, profiles: [], sketches: [], timeline: { features }, bodies, nextBody: bodies.length + 1,
});

test("a Move of a Combine's piece, then the Combine deleted: saved, the file opens again", async () => {
  // Bar 100 x 20 x 10 (feature-1), slot box (feature-2) moved through x 30..40 (feature-3), cut (feature-4) leaving
  // piece body:feature-4/piece:1 (x 40..100); a Move (feature-5) moves that piece up 50.
  let doc: DesignDocument = partDocument("box", 100, 20, 10);
  doc = insertPreset(doc, "box", 10, 40, 20).doc;
  doc = insertMove(doc, ["body:feature-2"], { ...NO_MOVE, x: 30, y: -10, z: -5 }).doc;
  const c = insertCombine(doc, "body:feature-1", ["body:feature-2"], "cut");
  const build = await rebuildTimeline(c.doc, new BodyCache(kernel), kernel);
  doc = numberPieces(c.doc, Object.keys(build.bodies));
  doc = insertMove(doc, [`body:${c.id}/piece:1`], { ...NO_MOVE, z: 50 }).doc;
  // The Combine deleted (confirmed): the Move fails naming it, as a Move of a deleted box does. Saving must not make a file that won't open.
  doc = deleteItem(doc, c.id);
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(doc))));
});

test("hand-crafted Combine files that must be refused in words", () => {
  const refused = (f: unknown, re: RegExp) => assert.throws(() => readDesignDocument(f), (e: unknown) => e instanceof Error && !(e instanceof TypeError) && re.test(e.message));
  // A Combine (feature-3) using its own piece as a tool, the piece numbered: it would depend on itself.
  refused(file([box("feature-1", "Box 1"), box("feature-2", "Box 2"), combine("feature-3", { target: "body:feature-1", tools: ["body:feature-3/piece:1"] }, ["feature-1", "feature-3"])],
    [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }, { id: "body:feature-3/piece:1", number: 3 }], 4), /feature-3/);
  // A Combine (feature-3) using a piece of a later Combine (feature-4), and that one the piece's... a forward reference.
  refused(file([box("feature-1", "Box 1"), box("feature-2", "Box 2"), combine("feature-3", { target: "body:feature-1", tools: ["body:feature-4/piece:1"] }, ["feature-1", "feature-4"]),
    combine("feature-4", { target: "body:feature-1", tools: ["body:feature-2"] }, ["feature-1", "feature-2"])],
    [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }, { id: "body:feature-4/piece:1", number: 3 }], 5), /not a body made before it/);
  // keepTools as text, the operation as a list, tools holding null and an object.
  refused(file([box("feature-1", "B"), box("feature-2", "C"), combine("feature-3", { target: "body:feature-1", tools: ["body:feature-2"], keepTools: 1 }, ["feature-1", "feature-2"])], [], 4), /keepTools 1 is not true or false/);
  refused(file([box("feature-1", "B"), box("feature-2", "C"), combine("feature-3", { target: "body:feature-1", tools: ["body:feature-2"], operation: ["cut"] }, ["feature-1", "feature-2"])], [], 4), /operation a list/);
  refused(file([box("feature-1", "B"), box("feature-2", "C"), combine("feature-3", { target: "body:feature-1", tools: [null, {}] }, ["feature-1"])], [], 4), /tool null/);
  refused(file([box("feature-1", "B"), box("feature-2", "C"), combine("feature-3", { target: { toString: 1 }, tools: ["body:feature-2"] }, ["feature-1"])], [], 4), /target an object/);
  // No target at all.
  refused(file([box("feature-1", "B"), box("feature-2", "C"), combine("feature-3", { tools: ["body:feature-2"] }, ["feature-2"])], [], 4), /target undefined/);
});

test("a Combine with 200,000 tool ids (bodies deleted since) is read or refused within 5 s, never thrown by the engine", () => {
  const n = 200_000;
  const tools = Array.from({ length: n }, (_, i) => `body:feature-${i + 10}`);
  const f = file([box("feature-1", "B"), box("feature-2", "C"), combine("feature-3", { target: "body:feature-1", tools }, ["feature-1", ...tools.map((t) => t.slice(5))])],
    [{ id: "body:feature-1", number: 1 }, { id: "body:feature-2", number: 2 }], n + 20);
  const t0 = Date.now();
  try {
    readDesignDocument(f);
  } catch (e) {
    assert.ok(e instanceof Error && !(e instanceof TypeError) && !(e instanceof RangeError), String(e));
  }
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
});
