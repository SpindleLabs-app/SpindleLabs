// Survivors of the Design reader on main, 2026-11-17 (issue #220 again, nightly run on 901478c): the Chamfer's checks
// (document.ts `chamferSizeProblem` and `checkChamfer`, Design data version 24) had tests for most breaks but not for
// a value that is not text, a size exactly at a limit, an angle of 0 or below, a body made after the Chamfer, too many
// edges or a wrong dependsOn of the right length. Each test names the change to the code it catches; the mutants no file
// can tell apart are explained in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { insertChamfer } from "../src/chamfer.ts";
import { CHAMFER_MAX, DESIGN_LIMITS, insertPreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { designNames } from "../src/boolean-names.ts";
import { namedBody } from "../src/built-body.ts";
import { heldEdgeNames } from "../src/design-edges.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const kernel = nodeKernel();

/** The held name of the 10 mm cube's top front edge (y = 0, z = 10), as the screen gives it. */
async function topFrontEdge(doc: DesignDocument): Promise<string> {
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const ids = Object.keys(build.bodies);
  const list = await Promise.all(ids.map(async (k) => namedBody(k, build.bodies[k], await cache.view(build.bodies[k].handle), 0)));
  const view = list[0].view;
  const on = (p: number[]) => Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9;
  const edges = view.edge_vertices.flatMap(([a, b], e) => (on(view.vertex_points[a]) && on(view.vertex_points[b]) ? [e] : []));
  assert.equal(edges.length, 1);
  const held = heldEdgeNames(designNames(list), 0)[edges[0]];
  await cache.clear();
  assert.ok(held !== null);
  return held!;
}

/** A cube (feature-1) with a 2 mm Chamfer on one edge, as JSON, and the Chamfer's id. */
async function chamfered(): Promise<{ json: string; id: string; edge: string }> {
  const d0 = partDocument("box", 10, 10, 10);
  const edge = await topFrontEdge(d0);
  const { doc, id } = insertChamfer(d0, "body:feature-1", [edge], { equal: 2 });
  return { json: JSON.stringify(doc), id, edge };
}

/** The file with the Chamfer changed by `patch`, read. */
function reading(json: string, id: string, patch: (f: Raw, p: Raw, d: Raw) => void): () => unknown {
  const d = JSON.parse(json);
  const f = d.timeline.features.find((x: Raw) => x.id === id);
  patch(f, f.intent.parameters, d);
  return () => readDesignDocument(d);
}

test("a Chamfer's size: exactly CHAMFER_MAX reads (d <= CHAMFER_MAX => d < CHAMFER_MAX)", async () => {
  const { json, id } = await chamfered();
  assert.doesNotThrow(reading(json, id, (_, p) => (p.distance = CHAMFER_MAX)));
  assert.doesNotThrow(reading(json, id, (_, p) => (p.second = CHAMFER_MAX)));
});

test("a Chamfer's size that is not a number is named as the reader shows it, not as JSON (typeof v === \"string\" => true)", async () => {
  const { json, id } = await chamfered();
  const at = `Design chamfer ${id}`;
  // shown([2]) is "a list"; JSON.stringify([2]) would be "[2]".
  assert.throws(reading(json, id, (_, p) => (p.distance = [2])), { message: `${at}'s size: its distance a list is not above 0 and at most 1000000 mm` });
});

test("a Chamfer's angle must be above 0: 0, -5 and \"30\" (text) are refused (each angle mutant)", async () => {
  const { json, id } = await chamfered();
  const at = `Design chamfer ${id}`;
  // 0: kills `p.angle > 0 => p.angle >= 0` and `=> true`. -5: kills `isFiniteNumber && > 0 => ||` and the whole `=> true`.
  assert.throws(reading(json, id, (_, p) => (p.angle = 0)), { message: `${at}'s size: its angle 0 is not between 0 and 90 degrees` });
  assert.throws(reading(json, id, (_, p) => (p.angle = -5)), { message: `${at}'s size: its angle -5 is not between 0 and 90 degrees` });
  assert.throws(reading(json, id, (_, p) => (p.angle = "30")), { message: `${at}'s size: its angle "30" is not between 0 and 90 degrees` });
  // The boundary the other side of 0: 0.9 × and 1.1 × of a tiny angle both read, as any angle above 0 does.
  assert.doesNotThrow(reading(json, id, (_, p) => (p.angle = 1e-9)));
});

test("a Chamfer's body that is not text or not a body id is refused in the reader's own words (the body checks)", async () => {
  const { json, id } = await chamfered();
  const at = `Design chamfer ${id}`;
  // A list whose text is a real body id: with `typeof id === "string" => true` its text would find Box 1 and read.
  assert.throws(reading(json, id, (_, p) => (p.body = ["body:feature-1"])), { message: `${at} chamfers a list, which is not a body made before it in the timeline` });
  // A number: no item. With `maker !== null => true` (or `=== null`), ID_SHAPE.test(null) is true ("null" is lower case
  // letters), so it would pass as a deleted body and fail later on dependsOn instead; with `there === undefined => false`
  // it would throw a TypeError reading there.at.
  assert.throws(reading(json, id, (_, p) => (p.body = 5)), { message: `${at} chamfers 5, which is not a body made before it in the timeline` });
});

test("a Chamfer of a body deleted since reads (the rebuild fails it), as a Move's does (the deleted-body rule)", async () => {
  const { json, id } = await chamfered();
  // feature-9 is no item in the file, but it is an item's id in form, below the counter: a body deleted since. `deleted => false` refuses it.
  assert.doesNotThrow(reading(json, id, (f, p, d) => ((p.body = "body:feature-9"), (f.dependsOn = ["feature-9"]), (d.nextId = 10))));
});

test("a Chamfer of a body made after it is refused (there.at >= ... => false, || => &&)", async () => {
  const { json, id } = await chamfered();
  const d = JSON.parse(json) as DesignDocument;
  // Box 2 goes in at the marker, after the Chamfer.
  const { doc: later, id: box2 } = insertPreset(d, "box", 5, 5, 5);
  assert.notEqual(box2, id);
  const at = `Design chamfer ${id}`;
  assert.throws(reading(JSON.stringify(later), id, (f, p) => ((p.body = `body:${box2}`), (f.dependsOn = [box2]))), {
    message: `${at} chamfers body:${box2}, which is not a body made before it in the timeline`,
  });
});

test("a Chamfer naming more edges than the reader opens says how many (notTooMany's words)", async () => {
  const { json, id, edge } = await chamfered();
  const n = DESIGN_LIMITS.items + 1;
  assert.throws(reading(json, id, (_, p) => (p.edges = Array.from({ length: n }, (_, k) => `${edge}#${k}`))), {
    message: `Design chamfer ${id} names ${n} edges, more than the ${DESIGN_LIMITS.items} this SpindleLabs opens`,
  });
});

test("a Chamfer's edge that is not text is refused in words, not by a TypeError (typeof e !== \"string\" => false)", async () => {
  const { json, id } = await chamfered();
  assert.throws(reading(json, id, (_, p) => (p.edges = [5])), { message: `Design chamfer ${id}'s edge 5 is not an edge's name` });
});

test("a Chamfer's flip that is a list is named as the reader shows it (typeof p.flip === \"string\" => true)", async () => {
  const { json, id } = await chamfered();
  assert.throws(reading(json, id, (_, p) => (p.flip = [true])), { message: `Design chamfer ${id}'s flip a list is not true or false` });
});

test("a Chamfer's dependsOn: two entries, or one that is not its body's item, are refused (the dependsOn checks)", async () => {
  const { json, id } = await chamfered();
  const why = `Design chamfer ${id} must depend on exactly the item that made the body it chamfers (feature-1)`;
  // Length 2 with the right first: kills `length !== 1 => false` and `|| => &&`.
  assert.throws(reading(json, id, (f) => (f.dependsOn = ["feature-1", "feature-1"])), (e: unknown) => e instanceof Error && !(e instanceof TypeError));
  // Length 1, the wrong item: kills `f.dependsOn[0] !== maker => false`. A deleted body's id, so no other check names it.
  assert.throws(reading(json, id, (f, _, d) => ((f.dependsOn = ["feature-9"]), (d.nextId = 10))), { message: why });
});
