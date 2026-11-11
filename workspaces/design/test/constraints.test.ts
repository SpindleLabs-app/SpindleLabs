// Sketch constraints (step 47d2, constraints.ts) on the real kernel's
// solver: hand-worked sketches with their working, the MIN_FEATURE
// boundary at 0.9× and 1.1×, every refusal (a conflict with the
// constraints that fight, one that already holds, one that would shrink a
// line, H and V on one line's two ends, points that follow a body), a
// deleted curve taking its constraints with it, the file's checks, and
// seeded sessions of random constraints through the promises (every
// constraint holds, fixed points stay, no line shrinks below MIN_FEATURE,
// a refusal changes nothing).
import { test } from "node:test";
import assert from "node:assert/strict";
import { seeded } from "../../../packages/testing/src/index.ts";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { addConstraint, deleteConstraint, lineEnds, MIN_FEATURE, readAnswer, solverRequest, type Added, type NewConstraint } from "../src/constraints.ts";
import { partDocument, readDesignDocument, type DesignDocument, type Sketch, type SketchConstraint } from "../src/document.ts";
import { addSketch, deleteCurve, drawArc, drawLine, projectEdges } from "../src/sketch.ts";

const kernel = nodeKernel();
const LINEAR = 1e-5;
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const xy = (s: Sketch, p: string): [number, number] => {
  const q = s.points.find((x) => x.id === p)!;
  return [q.x, q.y];
};
const ok = (a: Added): { doc: DesignDocument; id: string } => {
  assert.ok("doc" in a, "refused" in a ? a.refused : "");
  return a;
};
const no = (a: Added): { refused: string; fighting: string[] } => {
  assert.ok("refused" in a, "it was added");
  return a;
};

/** A box, then Sketch 1 (sketch-2) with line-5 from (0, 0) to (4, 2): points 3 and 4. */
function oneLine(from: [number, number] = [0, 0], to: [number, number] = [4, 2]) {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const l = drawLine(s.doc, s.id, from, to);
  return { doc: l.doc, id: s.id, line: l.id };
}

test("the fixture's ids are as the comments say", () => {
  const { doc, id, line } = oneLine();
  assert.equal(id, "sketch-2");
  assert.equal(line, "line-5");
  assert.deepEqual(lineEnds(sketchOf(doc, id), line), ["point-3", "point-4"]);
});

test("horizontal on a line picked: its start held, its end comes level with it", async () => {
  // Line (0, 0)–(4, 2). Horizontal names its start then its end and holds
  // the start (the first pick), so the y group lands on the start's y, 0:
  // the end goes to (4, 0) and the start stays.
  const { doc, id } = oneLine();
  const got = ok(await addConstraint(kernel, doc, id, { kind: "horizontal", a: "point-3", b: "point-4" }));
  const s = sketchOf(got.doc, id);
  assert.deepEqual(xy(s, "point-3"), [0, 0]);
  assert.deepEqual(xy(s, "point-4"), [4, 0]);
  assert.deepEqual(s.constraints, [{ id: got.id, kind: "horizontal", a: "point-3", b: "point-4" }]);
  // The constraint takes the next id from the one counter.
  assert.equal(got.id, `constraint-${doc.nextId}`);
  assert.equal(got.doc.nextId, doc.nextId + 1);
});

test("vertical on a line: the end comes straight above the start", async () => {
  // Line (1, 1)–(3, 5), start held: the x group lands on 1, so the end goes to (1, 5).
  const { doc, id } = oneLine([1, 1], [3, 5]);
  const s = sketchOf(ok(await addConstraint(kernel, doc, id, { kind: "vertical", a: "point-3", b: "point-4" })).doc, id);
  assert.deepEqual([xy(s, "point-3"), xy(s, "point-4")], [[1, 1], [1, 5]]);
});

test("coincident: the second pick lands on the first", async () => {
  // Lines (0, 0)–(10, 0) and (10.5, 0.3)–(20, 5): point-4 (10, 0) held, so
  // point-6 (10.5, 0.3) moves onto it; point-7 stays where it was.
  const { doc, id } = oneLine([0, 0], [10, 0]);
  const two = drawLine(doc, id, [10.5, 0.3], [20, 5]);
  const s = sketchOf(ok(await addConstraint(kernel, two.doc, id, { kind: "coincident", a: "point-4", b: "point-6" })).doc, id);
  assert.deepEqual([xy(s, "point-4"), xy(s, "point-6"), xy(s, "point-7")], [[10, 0], [10, 0], [20, 5]]);
});

test("two fixed points 1 mm apart can't be made coincident: the three that fight are named", async () => {
  // Fixed at x = 0 and x = 1 (more than LINEAR apart): a coincident joins
  // their x, a conflict, blamed on the newest; nothing moves.
  const { doc, id } = oneLine([0, 0], [1, 0]);
  const f1 = ok(await addConstraint(kernel, doc, id, { kind: "fix", point: "point-3" }));
  const f2 = ok(await addConstraint(kernel, f1.doc, id, { kind: "fix", point: "point-4" }));
  const r = no(await addConstraint(kernel, f2.doc, id, { kind: "coincident", a: "point-3", b: "point-4" }));
  assert.match(r.refused, /coincident constraint fights/);
  assert.deepEqual(r.fighting, [f1.id, f2.id, `constraint-${f2.doc.nextId}`]);
});

test("a constraint that already holds is refused; one that holds in one axis only is kept", async () => {
  // Horizontal twice: the second joins two y already one group (redundant), refused.
  const { doc, id } = oneLine([0, 0], [10, 0]);
  const h = ok(await addConstraint(kernel, doc, id, { kind: "horizontal", a: "point-3", b: "point-4" }));
  assert.match(no(await addConstraint(kernel, h.doc, id, { kind: "horizontal", a: "point-4", b: "point-3" })).refused, /already holds/);
  // A fix on a point, twice: refused the second time.
  const f = ok(await addConstraint(kernel, h.doc, id, { kind: "fix", point: "point-3" }));
  assert.match(no(await addConstraint(kernel, f.doc, id, { kind: "fix", point: "point-3" })).refused, /already holds/);
  // Coincident on two points already level (a second line's start at
  // (12, 0)...): redundant in y only, so it is kept and joins their x.
  const two = drawLine(h.doc, id, [12, 3], [20, 5]);
  const level = ok(await addConstraint(kernel, two.doc, id, { kind: "horizontal", a: "point-4", b: "point-7" }));
  const c = ok(await addConstraint(kernel, level.doc, id, { kind: "coincident", a: "point-4", b: "point-7" }));
  assert.deepEqual(xy(sketchOf(c.doc, id), "point-7"), [10, 0]);
});

test("horizontal and vertical on one line's two ends would make it a point: refused", async () => {
  // Line (0, 0)–(4, 2) made horizontal (end at (4, 0)), then vertical: the
  // ends' x join too, so the line would be 0 long (Fusion refuses it).
  const { doc, id } = oneLine();
  const h = ok(await addConstraint(kernel, doc, id, { kind: "horizontal", a: "point-3", b: "point-4" }));
  const r = no(await addConstraint(kernel, h.doc, id, { kind: "vertical", a: "point-3", b: "point-4" }));
  assert.match(r.refused, /would shrink the line shown in red to almost nothing/);
  assert.deepEqual(r.fighting, ["line-5"], "the line drawn red");
  assert.deepEqual(sketchOf(h.doc, id).constraints.length, 1);
});

test("a line made horizontal is refused at 0.9 MIN_FEATURE long and kept at 1.1", async () => {
  // Line (0, 0)–(f·MIN_FEATURE, 5): horizontal holds the start, so the end
  // comes to (f·MIN_FEATURE, 0), a line f·MIN_FEATURE long.
  // The kernel's MIN_FEATURE is 1e-3 mm, written here by
  // hand so a wrong constant in constraints.ts can't move the boundary too.
  const KERNEL_MIN_FEATURE = 1e-3;
  assert.equal(MIN_FEATURE, KERNEL_MIN_FEATURE);
  for (const [f, kept] of [[0.9, false], [1.1, true]] as const) {
    const { doc, id } = oneLine([0, 0], [f * KERNEL_MIN_FEATURE, 5]);
    const a = await addConstraint(kernel, doc, id, { kind: "horizontal", a: "point-3", b: "point-4" });
    assert.equal("doc" in a, kept, `${f}`);
    if ("doc" in a) assert.deepEqual(xy(sketchOf(a.doc, id), "point-4"), [f * KERNEL_MIN_FEATURE, 0]);
  }
});

test("points it can't name are refused before any solve", async () => {
  const { doc, id } = oneLine();
  assert.match(no(await addConstraint(kernel, doc, id, { kind: "fix", point: "point-99" })).refused, /no point point-99/);
  assert.match(no(await addConstraint(kernel, doc, id, { kind: "coincident", a: "point-3", b: "point-3" })).refused, /two different points/);
  // A point pinned to a body's edge (26f) follows the body: a Fix on it, or a constraint between it and another followed
  // point, is refused (#517: one between it and a free point is solved with it fixed, constraints.test and followed-constraints.test).
  const pinned: DesignDocument = { ...doc, sketches: doc.sketches.map((s) => (s.id === id ? { ...s, pins: [{ point: "point-3", kind: "corner", name: "x" } as never] } : s)) };
  assert.match(no(await addConstraint(kernel, pinned, id, { kind: "fix", point: "point-3" })).refused, /follows a body's edge/);
  const both: DesignDocument = { ...doc, sketches: doc.sketches.map((s) => (s.id === id ? { ...s, pins: [{ point: "point-3", kind: "corner", name: "x" }, { point: "point-4", kind: "corner", name: "y" }] as never } : s)) };
  assert.match(no(await addConstraint(kernel, both, id, { kind: "horizontal", a: "point-3", b: "point-4" })).refused, /Both points follow a body's edge/);
});

test("an arc's ends stay on its circle when a constraint moves one", async () => {
  // A quarter arc from (10, 0) to (0, 10) round (0, 0), and a line from
  // (11, 1) to (20, 5). Coincident on the line's start (held) and the
  // arc's start: the arc's start goes to (11, 1), exactly, and Newton puts
  // the arc's end and centre where its ends are on one circle again
  // (|s − c| = |e − c| within LINEAR).
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const arc = drawArc(s0.doc, s0.id, [10, 0], [0, 10], [0, 0]); // points 3, 4, 5
  const line = drawLine(arc.doc, s0.id, [11, 1], [20, 5]); // points 7, 8
  const s = sketchOf(ok(await addConstraint(kernel, line.doc, s0.id, { kind: "coincident", a: "point-7", b: "point-3" })).doc, s0.id);
  assert.deepEqual(xy(s, "point-3"), [11, 1]);
  const [c, st, e] = [xy(s, "point-5"), xy(s, "point-3"), xy(s, "point-4")];
  assert.ok(Math.abs(Math.hypot(st[0] - c[0], st[1] - c[1]) - Math.hypot(e[0] - c[0], e[1] - c[1])) <= LINEAR);
});

test("the solver is told arcs first, then followed points, then the constraints oldest first", () => {
  const s0 = addSketch(partDocument("box", 40, 30, 20));
  const arc = drawArc(s0.doc, s0.id, [10, 0], [0, 10], [0, 0]);
  const sk: Sketch = { ...sketchOf(arc.doc, s0.id), constraints: [{ id: "c1", kind: "fix", point: "point-4" }], pins: [{ point: "point-5", kind: "corner", name: "x" } as never] };
  const r = solverRequest(sk, ["point-4", "point-4"]);
  assert.deepEqual(JSON.parse(r.text), { points: [[10, 0], [0, 10], [0, 0]], constraints: [["arc", 2, 0, 1], ["fix", 2], ["fix", 1]], held: [1], circles: 0 });
  assert.deepEqual(r.sources, [{ arc: "arc-6" }, { follows: "point-5" }, { constraint: "c1" }]);
  assert.throws(() => readAnswer('{"result": "solved"}'), /can't read/);
});

test("a deleted line takes the constraints on its points with it; a constraint deleted moves nothing", async () => {
  const { doc, id } = oneLine();
  const two = drawLine(doc, id, "point-4", [8, 8]); // point-6
  const h = ok(await addConstraint(kernel, two.doc, id, { kind: "horizontal", a: "point-3", b: "point-4" }));
  const f = ok(await addConstraint(kernel, h.doc, id, { kind: "fix", point: "point-6" }));
  // The second line goes and its own point-6 with it, so the fix goes; point-4 is still line-5's, so the horizontal stays.
  const gone = deleteCurve(f.doc, id, "line-7");
  assert.deepEqual(sketchOf(gone, id).constraints.map((c) => c.id), [h.id]);
  const plain = deleteConstraint(f.doc, id, h.id);
  assert.deepEqual(sketchOf(plain, id).points, sketchOf(f.doc, id).points);
  assert.deepEqual(sketchOf(plain, id).constraints.map((c) => c.id), [f.id]);
  assert.throws(() => deleteConstraint(f.doc, id, "nope"), /no constraint nope/);
});

test("constraints are saved and read back; a file's bad constraints are refused with the reason", async () => {
  const { doc, id } = oneLine();
  const h = ok(await addConstraint(kernel, doc, id, { kind: "horizontal", a: "point-3", b: "point-4" }));
  const read = readDesignDocument(JSON.parse(JSON.stringify(h.doc)));
  assert.deepEqual(sketchOf(read, id).constraints, sketchOf(h.doc, id).constraints);
  // Constraint ids are the document's ids (47d4 review): shaped as Design makes them and under the counter, so these
  // lists' ids are constraint-100 on, with the counter moved above them.
  const withList = (list: unknown[], change: (raw: DesignDocument) => void = () => {}) => {
    const raw = JSON.parse(JSON.stringify(h.doc));
    raw.sketches.find((s: Sketch) => s.id === id).constraints = list;
    raw.nextId = 10_000;
    change(raw);
    return () => readDesignDocument(raw);
  };
  assert.throws(withList([{ id: "constraint-100", kind: "tangent", a: "point-3", b: "point-4" }]), /constraint constraint-100 is a tangent, which this SpindleLabs can.t read yet/);
  assert.throws(withList([{ id: "constraint-100", kind: "fix", point: "point-9" }]), /constraint constraint-100 fixes point-9, which is not one of the sketch's points/);
  assert.throws(withList([{ id: "constraint-100", kind: "vertical", a: "point-3", b: "point-3" }]), /joins point point-3 to itself/);
  assert.throws(withList([{ id: "constraint-100", kind: "vertical", a: "point-3" }]), /names undefined|names .*not one of/);
  assert.throws(withList([{ kind: "fix", point: "point-3" }]), /constraint 1 has no id/);
  assert.throws(withList([{ id: "constraint-100", kind: "fix", point: "point-3" }, { id: "constraint-100", kind: "fix", point: "point-4" }]), /two constraints are called constraint-100$/);
  // 8,000 constraints is the solver's limit; one more is refused.
  const many = (n: number) => Array.from({ length: n }, (_, k) => ({ id: `constraint-${100 + k}`, kind: "fix", point: "point-3" }));
  assert.doesNotThrow(withList(many(8000)));
  assert.throws(withList(many(8001)), /8001 constraints, more than the 8000/);
  // Regressions (47d4 review). An id at the counter: a new constraint would repeat it, and the design would never open again.
  const fix = (cid: string) => [{ id: cid, kind: "fix", point: "point-3" }];
  assert.throws(withList(fix("constraint-9"), (raw) => void (raw.nextId = 9)), /nextId 9 is not above constraint-9/);
  // An id another object has (Select's Delete took the line with it), and ids no Design object has.
  assert.throws(withList(fix("line-5")), /Design id line-5 is used twice/);
  for (const bad of ["__proto__", ""]) assert.throws(withList(fix(bad)), /is not shaped like Design's ids/);
  // Only points pinned to a body's edge, or made by a projection: the body holds them (#517: one beside a free point is read).
  const pinned = (raw: DesignDocument) => {
    raw.sketches.find((s) => s.id === id)!.pins = [{ point: "point-3", kind: "endpoint", name: "v1", feature: "feature-1" } as never];
    const item = raw.timeline.features.find((f) => f.id === id)!;
    item.dependsOn = [...new Set([...item.dependsOn, "feature-1"])];
  };
  assert.doesNotThrow(withList([], pinned), "the pinned file itself opens");
  assert.throws(withList(fix("constraint-100"), pinned), /constraint constraint-100 names only points that follow a body's edge \(point-3\)/);
  assert.doesNotThrow(withList([{ id: "constraint-100", kind: "horizontal", a: "point-3", b: "point-4" }], pinned), "a pinned point beside a free one (#517)");
  // A projected line (27d), made by projectEdges, and a constraint on its end.
  const projected = projectEdges(h.doc, id, [{ feature: "feature-1", edge: "front+top", shape: { kind: "line", a: [0, 10], b: [10, 10] } }]).doc;
  const made = sketchOf(projected, id).points.at(-1)!.id;
  const raw = JSON.parse(JSON.stringify(projected));
  assert.doesNotThrow(() => readDesignDocument(JSON.parse(JSON.stringify(raw))), "the projected file itself opens");
  raw.sketches.find((s: Sketch) => s.id === id).constraints.push({ id: `constraint-${raw.nextId}`, kind: "fix", point: made });
  raw.nextId++;
  assert.throws(() => readDesignDocument(raw), new RegExp(`names only points that follow a body's edge \\(${made}\\)`));
});

/** Every constraint of the sketch holds at its points: horizontal and vertical exactly (one group), coincident exactly, fix where it was fixed. */
function holds(s: Sketch, fixedAt: ReadonlyMap<string, [number, number]>): string | null {
  for (const c of s.constraints as SketchConstraint[]) {
    if (c.kind === "fix") {
      const [x, y] = xy(s, c.point);
      const want = fixedAt.get(c.id)!;
      if (x !== want[0] || y !== want[1]) return `${c.id} moved its point from ${want} to ${[x, y]}`;
      continue;
    }
    const [a, b] = [xy(s, c.a), xy(s, c.b)];
    if ((c.kind !== "vertical" && a[1] !== b[1]) || (c.kind !== "horizontal" && a[0] !== b[0])) return `${c.id} (${c.kind}) does not hold: ${a} ${b}`;
  }
  for (const c of s.curves) {
    if (c.kind !== "line") continue;
    const [a, b] = [xy(s, c.start), xy(s, c.end)];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < MIN_FEATURE) return `${c.id} shrank below MIN_FEATURE`;
  }
  return null;
}

test("seeded sessions of random constraints keep every promise", async () => {
  const seed = BigInt(process.env.FISSION_SEED ?? 47_002);
  const rand = seeded(seed);
  const below = (n: number) => Math.floor(rand.next() * n);
  let added = 0;
  let refused = 0;
  for (let session = 0; session < 40; session++) {
    // A chain of 3–6 lines on a 1 mm grid, some ends shared.
    const s0 = addSketch(partDocument("box", 40, 30, 20));
    let doc = s0.doc;
    const id = s0.id;
    let last: string | [number, number] = [below(21) - 10, below(21) - 10];
    for (let k = 0; k < 3 + below(4); k++) {
      const to: [number, number] = [below(21) - 10, below(21) - 10];
      try {
        const l = drawLine(doc, id, last, to);
        doc = l.doc;
        last = below(3) === 0 ? to : sketchOf(doc, id).curves.at(-1)!.kind === "line" ? (sketchOf(doc, id).curves.at(-1) as { end: string }).end : to;
      } catch {
        // a line from a point to itself: skip it
      }
    }
    const fixedAt = new Map<string, [number, number]>();
    for (let k = 0; k < 8; k++) {
      const pts = sketchOf(doc, id).points.map((p) => p.id);
      const [a, b] = [pts[below(pts.length)], pts[below(pts.length)]];
      const kind = (["horizontal", "vertical", "coincident", "fix"] as const)[below(4)];
      const c: NewConstraint = kind === "fix" ? { kind, point: a } : { kind, a, b };
      const before = JSON.stringify(doc);
      const got = await addConstraint(kernel, doc, id, c);
      if ("refused" in got) {
        refused++;
        assert.equal(JSON.stringify(doc), before, "a refusal changes nothing");
        continue;
      }
      added++;
      const s = sketchOf(got.doc, id);
      if (c.kind === "fix") fixedAt.set(got.id, xy(sketchOf(doc, id), c.point));
      // Fixed points never move; every constraint holds; no line shrinks.
      const why = holds(s, fixedAt);
      assert.equal(why, null, `seed ${seed} session ${session}: ${why}`);
      doc = got.doc;
    }
  }
  assert.ok(added > 80 && refused > 20, `added ${added}, refused ${refused}`);
});
