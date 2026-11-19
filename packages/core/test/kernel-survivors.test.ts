// Mutation testing's survivors in the kernel bridge (test audit D-5, stryker/kernel.json: src/kernel/kernel-client.ts
// and src/kernel/time-limit.ts). Each test is worked by hand and fails under the mutants named beside it. The ones no
// test can kill are explained in packages/testing/stryker/explained.json. Kept apart from kernel-client.test.ts, which
// other pull requests edit.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTrap,
  KERNEL_NOT_DOWNLOADED,
  KERNEL_RESTARTED,
  KERNEL_SLICE_STOPPED,
  KERNEL_STOPPED_FOR_ANOTHER,
  KERNEL_TEST_STOPPED,
  KernelClient,
  KernelError,
  kernelFailure,
  UNKNOWN_BODY_WORDS,
  type KernelResponse,
} from "../src/kernel/kernel-client.ts";
import { CALIBRATION_TARGET, CALIBRATION_TOOL, calibrate, callUnits, checkUnits, sliceUnits, STRESS_MOST_UNITS, STRESS_WORST_UNITS, supportUnits, type BodySize } from "../src/kernel/time-limit.ts";

/** A worker the test answers by hand; it keeps what it was made with. */
class FakeWorker {
  static last: FakeWorker;
  static made = 0;
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string; preventDefault(): void }) => void) | null = null;
  posted: { id: number; op: string; args: unknown[] }[] = [];
  madeWith: unknown[];
  constructor(...args: unknown[]) {
    this.madeWith = args;
    FakeWorker.last = this;
    FakeWorker.made++;
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: KernelResponse | Record<string, unknown>) {
    this.onmessage?.({ data });
  }
  postMessage(m: { id: number; op: string; args: unknown[] }) {
    this.posted.push(m);
  }
  fail(message?: string) {
    this.onerror?.({ message, preventDefault: () => {} });
  }
  answer(id: number, value: unknown) {
    this.onmessage?.({ data: { id, ok: true, value } });
  }
  /** Answers the last call posted. */
  answerLast(value: unknown) {
    this.answer(this.posted.at(-1)!.id, value);
  }
  ready(unitMs?: number) {
    this.onmessage?.({ data: unitMs === undefined ? { ready: true } : { ready: true, unitMs } });
  }
}

async function withFakeWorker(fn: (client: KernelClient, worker: FakeWorker) => Promise<void>, options?: ConstructorParameters<typeof KernelClient>[0]) {
  const g = globalThis as { Worker?: unknown };
  const real = g.Worker;
  g.Worker = FakeWorker;
  try {
    await fn(new KernelClient(options), FakeWorker.last);
  } finally {
    g.Worker = real;
  }
}

/** A fake page whose visibility the test sets. */
function withFakeDocument<T>(fn: (page: { hidden: boolean; fire(type: string): void }) => Promise<T>) {
  const listeners = new Map<string, Array<() => void>>();
  const page = {
    hidden: false,
    addEventListener(type: string, f: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), f]);
    },
    fire(type: string) {
      (listeners.get(type) ?? []).forEach((f) => f());
    },
  };
  const g = globalThis as { document?: unknown };
  const real = g.document;
  g.document = page;
  return fn(page).finally(() => (g.document = real));
}

/** Whether a promise has settled by the time the queued callbacks have run. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((r) => setImmediate(r));
  return done;
}

const DEADLINE = 1000;
const BOX = { box: { width: 1, depth: 1, height: 1 } };
const unknownBody = (e: KernelError) => e instanceof KernelError && e.kind === "unknown-body" && e.message === UNKNOWN_BODY_WORDS && e.inputs.length === 0;
const STRESS = { youngsModulus: 2000, poissonsRatio: 0.35, strength: 30, held: [0], loads: [{ faces: [1], force: [0, 0, -10] as [number, number, number] }] };

/** Builds a box and answers it with the kernel's number `body`; the app's handle. */
async function build(client: KernelClient, worker: FakeWorker, body: number) {
  const p = client.call("body_build", BOX);
  worker.answerLast(body);
  return p;
}

test("the words the user reads when the kernel stops, a body is gone or the kernel didn't download", async () => {
  const m = await import("../src/kernel/kernel-client.ts");
  assert.equal(m.UNKNOWN_BODY_WORDS, "That body is no longer there (it was removed, or the design was rebuilt). Reload the design and try again.");
  assert.equal(m.KERNEL_SLICE_STOPPED, "The slice was stopped.");
  assert.equal(m.KERNEL_TEST_STOPPED, "The test was stopped.");
  assert.equal(m.KERNEL_STOPPED_FOR_ANOTHER, "The geometry kernel was started again, because a call before this one took too long.");
  assert.equal(m.KERNEL_NOT_DOWNLOADED, "The geometry kernel didn't start (its file didn't download). Reload the page to try again.");
});

test("isTrap without WebAssembly (an old browser) is false, never a crash", () => {
  const g = globalThis as { WebAssembly?: unknown };
  const real = g.WebAssembly;
  delete g.WebAssembly;
  try {
    assert.equal(isTrap(new Error("x")), false);
  } finally {
    g.WebAssembly = real;
  }
});

test("kernelFailure keeps every kind the kernel sends, and an empty kind is internal", () => {
  for (const kind of ["invalid-result", "too-many-bodies"]) assert.equal(kernelFailure(Object.assign(new Error("x"), { kind, inputs: [] })).kind, kind);
  assert.equal(kernelFailure(Object.assign(new Error("x"), { kind: "", inputs: [{ input: "param", name: "w" }] })).kind, "internal");
});

test("kernelFailure's places: a null place is skipped, an edge needs at: edge", () => {
  const edge = { at: "edge", from: [0, 0, 0], to: [1, 0, 0] };
  // A null among the places is left out (not read, which would throw).
  const touches = kernelFailure(Object.assign(new Error("x"), { kind: "non-manifold-result", inputs: [], touches: [null, { at: "other", from: [0, 0, 0], to: [1, 0, 0] }, edge] }));
  assert.deepEqual(touches.touches, [edge]);
  const thin = kernelFailure(Object.assign(new Error("x"), { kind: "thin-result", inputs: [], thin: [null, edge] }));
  assert.deepEqual(thin.thin, [edge]);
});

test("the worker is the kernel's module script", () =>
  withFakeWorker(async (_client, worker) => {
    const [url, options] = worker.madeWith as [URL, unknown];
    assert.ok(String(url).endsWith("/kernel.worker.ts"), String(url));
    assert.deepEqual(options, { type: "module" });
  }));

test("calls before the kernel is ready are never timed (a slow download)", (t) =>
  withFakeWorker(
    async (client, worker) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const call = client.call("body_count");
      t.mock.timers.tick(DEADLINE * 10);
      assert.equal(worker.terminated, false);
      assert.equal(await settled(call), false);
    },
    { floorMs: DEADLINE },
  ));

test("a page hidden and shown again while a call waits keeps its kernel; one only shown (never hidden) does not", (t) =>
  withFakeDocument((page) =>
    withFakeWorker(
      async (client, worker) => {
        t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
        worker.ready(1);
        const call = client.call("body_count");
        // Hidden and back while waiting, the timer on time: the worker may have had no CPU time, so it gets its limit again.
        page.hidden = true;
        page.fire("visibilitychange");
        page.hidden = false;
        page.fire("visibilitychange");
        t.mock.timers.tick(DEADLINE * 1.1);
        assert.equal(worker.terminated, false, "kept");
        worker.answerLast(0);
        await call;
        // A visibilitychange with the page visible all along says nothing: the limit stands.
        const second = client.call("body_count");
        page.fire("visibilitychange");
        t.mock.timers.tick(DEADLINE * 1.1);
        assert.equal(worker.terminated, true, "let go");
        await assert.rejects(second);
      },
      { floorMs: DEADLINE },
    ),
  ));

test("a timer exactly a second late still counts (only more than a second late means the device slept)", (t) =>
  withFakeWorker(
    async (client, worker) => {
      t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
      worker.ready(1);
      const call = client.call("body_count");
      // The wall clock jumps 1,000 ms without the timer firing, then the timer fires when due on its own clock:
      // it is exactly LATE_TIMER_MS (1,000 ms) late.
      t.mock.timers.setTime(1_000_000 + 1000);
      t.mock.timers.tick(DEADLINE);
      assert.equal(worker.terminated, true);
      await assert.rejects(call, (e: KernelError) => e.kind === "timed-out");
    },
    { floorMs: DEADLINE },
  ));

test("stress test progress reaches the listeners for a call waiting, never for one not waiting, and stops when they stop", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    const b = await build(client, worker, 11);
    const heard: unknown[] = [];
    const off = client.onTestProgress((stage) => heard.push(stage));
    const run = client.call("stress_test", b, STRESS);
    const id = worker.posted.at(-1)!.id;
    worker.reply({ id, testStage: "mesh" });
    worker.reply({ id: 99, testStage: "solve" });
    assert.deepEqual(heard, ["mesh"]);
    off();
    worker.reply({ id, testStage: "stresses" });
    assert.deepEqual(heard, ["mesh"]);
    worker.answer(id, "done");
    assert.equal(await run, "done");
  }));

test("only a missing reply tells the missing listeners; an answer for no call is dropped", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    let missing = 0;
    const off = client.onMissing(() => missing++);
    const a = client.call("body_count");
    worker.answerLast(0);
    await a;
    const b = client.call("body_count");
    worker.reply({ id: worker.posted.at(-1)!.id, ok: false, error: { kind: "invalid-input", inputs: [], message: "no" } });
    await assert.rejects(b);
    assert.equal(missing, 0);
    // A late answer for a call nobody waits on is dropped, not a crash.
    worker.answer(42, 1);
    // Unsubscribed, a missing reply tells nobody.
    off();
    const c = client.call("body_count");
    worker.reply({ id: worker.posted.at(-1)!.id, ok: false, error: { kind: "internal", inputs: [], message: KERNEL_NOT_DOWNLOADED }, missing: true });
    await assert.rejects(c);
    assert.equal(missing, 0);
  }));

test("a worker gone, a restart and a retry fail the calls waiting with internal errors and no inputs", () =>
  withFakeWorker(async (client, worker) => {
    const gone = client.call("body_count");
    worker.fail(undefined);
    await assert.rejects(gone, (e: KernelError) => e.kind === "internal" && e.inputs.length === 0);
    // retry: the call left waiting when the kernel went missing fails with KERNEL_NOT_DOWNLOADED.
    client.retry();
    const fresh = FakeWorker.last;
    const first = client.call("body_count");
    const second = client.call("body_count");
    fresh.reply({ id: fresh.posted[0].id, ok: false, error: { kind: "internal", inputs: [], message: KERNEL_NOT_DOWNLOADED }, missing: true });
    await assert.rejects(first);
    client.retry();
    await assert.rejects(second, (e: KernelError) => e instanceof KernelError && e.kind === "internal" && e.inputs.length === 0 && e.message === KERNEL_NOT_DOWNLOADED);
  }));

test("a stopped slice and the calls stopped with it carry no inputs", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    const slice = client.call("slice_stl", new Uint8Array(0), {} as never);
    const other = client.call("body_count");
    assert.equal(client.stopSlicing(), true);
    await assert.rejects(slice, (e: KernelError) => e.kind === "internal" && e.message === KERNEL_SLICE_STOPPED && e.inputs.length === 0);
    await assert.rejects(other, (e: KernelError) => e.kind === "internal" && e.message === KERNEL_RESTARTED && e.inputs.length === 0);
  }));

test("a call past its limit and the ones behind it carry no inputs", (t) =>
  withFakeWorker(
    async (client, worker) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      worker.ready(1);
      const slow = client.call("body_count");
      const behind = client.call("body_count");
      t.mock.timers.tick(DEADLINE * 1.1);
      await assert.rejects(slow, (e: KernelError) => e.kind === "timed-out" && e.inputs.length === 0);
      await assert.rejects(behind, (e: KernelError) => e.message === KERNEL_STOPPED_FOR_ANOTHER && e.inputs.length === 0);
    },
    { floorMs: DEADLINE },
  ));

test("stopTesting: stops a waiting stress test (and fails the others with KERNEL_RESTARTED), keeps a kernel with none", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    let heard = 0;
    client.onRestart(() => heard++);
    // Nothing waiting: nothing stopped, the kernel kept.
    assert.equal(client.stopTesting(), false);
    // Only another call waiting: still nothing stopped.
    const count = client.call("body_count");
    assert.equal(client.stopTesting(), false);
    assert.equal(worker.terminated, false);
    assert.equal(heard, 0);
    worker.answerLast(0);
    await count;
    // A stress test and another call waiting: the test stops in its own words, the other in KERNEL_RESTARTED.
    const b = await build(client, worker, 11);
    const made = FakeWorker.made;
    const run = client.call("stress_test", b, STRESS);
    const other = client.call("body_count");
    assert.equal(client.stopTesting(), true);
    await assert.rejects(run, (e: KernelError) => e.kind === "internal" && e.message === KERNEL_TEST_STOPPED && e.inputs.length === 0);
    await assert.rejects(other, (e: KernelError) => e.kind === "internal" && e.message === KERNEL_RESTARTED);
    assert.equal(worker.terminated, true);
    assert.equal(FakeWorker.made, made + 1);
    assert.equal(heard, 1);
    // A client whose worker is gone stops nothing.
    FakeWorker.last.fail(undefined);
    assert.equal(client.stopTesting(), false);
  }));

test("calls on a handle the client doesn't know are refused before sending, with no inputs", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    const refused = [
      client.call("body_stl", 99, "part"),
      client.call("body_step", 99),
      client.call("stress_test", 99, STRESS),
      client.call("body_view", 99),
      client.call("body_measure", { body: 99 }, null),
      client.call("body_construct", { kind: "point_at", point: { pick: { body: 99, vertex: 0 } } } as never),
      client.call("body_boolean", 99, [], "union" as never),
      client.call("body_shell", 99, [0], 1),
      client.call("body_move", 99, []),
      client.call("body_chamfer", 99, [0], { equal: 1 } as never, false),
    ];
    for (const p of refused) await assert.rejects(p, unknownBody);
    assert.equal(worker.posted.length, 0);
  }));

test("a construction slot given as null or left undefined is sent as it is", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    const made = client.call("body_construct", { kind: "offset_plane", plane: null, distance: 5, extra: undefined } as never);
    assert.deepEqual(worker.posted.at(-1)?.args, [{ kind: "offset_plane", plane: null, distance: 5, extra: undefined }]);
    worker.answerLast({});
    await made;
  }));

test("a freed body is forgotten: asked again, it is refused without sending", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    const b = await build(client, worker, 11);
    const freed = client.call("body_free", b);
    worker.answerLast(undefined);
    await freed;
    await new Promise((r) => setImmediate(r));
    const sent = worker.posted.length;
    await assert.rejects(client.call("body_view", b), unknownBody);
    assert.equal(worker.posted.length, sent);
  }));

test("a view answered after its body was freed (no box) is taken quietly", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    const b = await build(client, worker, 11);
    const freed = client.call("body_free", b);
    const view = client.call("body_view", b);
    const [freeId, viewId] = worker.posted.slice(-2).map((m) => m.id);
    worker.answer(freeId, undefined);
    await freed;
    await new Promise((r) => setImmediate(r));
    worker.answer(viewId, { faces: 6 });
    await view;
    await new Promise((r) => setImmediate(r));
  }));

test("moved and chamfered bodies get new handles, never one already given", () =>
  withFakeWorker(async (client, worker) => {
    worker.ready(1);
    const a = await build(client, worker, 11);
    const moved = client.call("body_move", a, []);
    worker.answerLast(12);
    const m = await moved;
    const chamfered = client.call("body_chamfer", a, [0], { equal: 1 } as never, false);
    worker.answerLast({ body: 13, faces: [] });
    const c = (await chamfered).body;
    const later = await build(client, worker, 14);
    assert.equal(new Set([a, m, c, later]).size, 4, `${[a, m, c, later]}`);
  }));

test("a body answered in the same moment its kernel is replaced is gone with it", async () => {
  // The answer arrives, then before its promise's callback runs the kernel stops (a crash after it started): the body
  // went with the old kernel, so its handle is retired: freeing it is done at once, anything else is refused, and
  // nothing about it reaches the fresh kernel.
  const cases: [string, (c: KernelClient, h: number) => Promise<unknown>, unknown][] = [
    ["body_build", (c) => c.call("body_build", BOX), 21],
    ["body_move", (c, h) => c.call("body_move", h, []), 21],
    ["body_chamfer", (c, h) => c.call("body_chamfer", h, [0], { equal: 1 } as never, false).then((r) => (r as { body: number }).body), { body: 21, faces: [] }],
    ["body_boolean", (c, h) => c.call("body_boolean", h, [], "union" as never).then((r) => (r as { bodies: number[] }).bodies[0]), { bodies: [21], history: [{ faces: [], edges: [] }] }],
  ];
  for (const [name, ask, value] of cases)
    await withFakeWorker(async (client, worker) => {
      worker.ready(1);
      const h = await build(client, worker, 11);
      const p = ask(client, h);
      worker.answerLast(value);
      worker.fail("crash");
      const handle = (await p) as number;
      const fresh = FakeWorker.last;
      assert.notEqual(fresh, worker, name);
      await assert.rejects(client.call("body_view", handle), unknownBody, name);
      await client.call("body_free", handle);
      assert.equal(fresh.posted.length, 0, name);
    });
});

// ---- time-limit.ts ----

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
type P = [number, number, number];
/** A binary STL of `tris` (three corners each, in order), its count field `count`. */
function stl(tris: P[][], count = tris.length): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50);
  const v = new DataView(out.buffer);
  v.setUint32(80, count, true);
  tris.forEach((t, i) => t.flat().forEach((x, k) => v.setFloat32(84 + i * 50 + 12 + k * 4, x, true)));
  return out;
}
/** A small triangle facing up at height z, far off to the side: it sets the floor. */
const floorAt = (z: number): P[] => [[200, 200, z], [201, 200, z], [200, 201, z]];
/** A 10 × 10 right triangle facing straight down at height z (seen from above: 50 mm²). */
const downAt = (z: number): P[] => [[0, 0, z], [0, 10, z], [10, 0, z]];

test("the calibration boolean: two 10 mm cubes, the second moved 5 mm along each axis", () => {
  assert.deepEqual(CALIBRATION_TARGET, { box: { width: 10, depth: 10, height: 10 } });
  assert.deepEqual(CALIBRATION_TOOL, { moved: { body: { box: { width: 10, depth: 10, height: 10 } }, moves: [{ move: [5, 5, 5] }] } });
});

test("calibrate stops after the least runs once 50 ms have passed, timed from its start", () => {
  // The clock reads 1,000 at the start and 1,050 ever after: after the third run (the least) 50 ms have passed,
  // which is not under 50, so it stops there: 50 ms over 3 runs.
  let reads = 0;
  const calls = { build: () => 1, boolean: () => ({ bodies: [], history: [] }), free: () => {}, now: () => (reads++ === 0 ? 1000 : 1050) };
  assert.ok(close(calibrate(calls as never), 50 / 3));
});

test("supportUnits: a hand-worked plate 5 mm above a floor at z 10", () => {
  // Floor at z 10; a 50 mm² face looking straight down at z 15, 0.25 mm layers: it is 5 / 0.25 = 20 layers up.
  // Tree: 4 × 50 + 0.015 × 50 × 20 + 40 × 20 = 200 + 15 + 800 = 1,015.
  assert.ok(close(supportUnits(stl([floorAt(10), downAt(15)]), 0.25, "tree"), 1015));
});

test("supportUnits: what counts as a face that needs holding up", () => {
  // Exactly one layer above the floor (0.25 over 0 at 0.25 mm layers) is not above the first layer: nothing.
  assert.equal(supportUnits(stl([floorAt(0), downAt(0.25)]), 0.25, "tree"), 0);
  // 0.125 above a floor at 10, under one layer: nothing.
  assert.equal(supportUnits(stl([floorAt(10), downAt(10.125)]), 0.25, "tree"), 0);
  // A face looking down that starts on the floor (its lowest corner at 0) stands on it: nothing.
  assert.equal(supportUnits(stl([[[0, 0, 0], [0, 10, 5], [10, 0, 0]]]), 0.2, "tree"), 0);
  // No layer height worth the name: nothing.
  assert.equal(supportUnits(stl([floorAt(0), downAt(15)]), -0.25, "tree"), 0);
  // A face of no area (three corners at one point) high up has no direction: nothing.
  assert.equal(supportUnits(stl([floorAt(0), [[5, 5, 15], [5, 5, 15], [5, 5, 15]]]), 0.25, "tree"), 0);
  // Tilted faces, 20 mm up. Sides (−4, −4, −4) and (−4, −3, −4): normal (4, 0, −4) (by the code's cross product),
  // z share −4 / √32 = −0.707, more than 60° towards down: counts.
  const up = (t: P[]) => t.map(([x, y, z]) => [x, y, z + 20] as P);
  assert.ok(supportUnits(stl([floorAt(0), up([[0, 0, 0], [-4, -4, -4], [-4, -3, -4]])]), 0.25, "tree") > 0);
  // Sides (2, 1, 1) and (1, 0, 0.5): normal (0.5, 0, −1), z share −1 / √1.25 = −0.894: counts.
  assert.ok(supportUnits(stl([floorAt(0), up([[0, 0, 0], [2, 1, 1], [1, 0, 0.5]])]), 0.25, "tree") > 0);
  // Sides (−6, 1, 2) and (2, 0, 0): normal (0, 4, −2), z share −2 / √20 = −0.447, steeper than 60° from down: nothing.
  assert.equal(supportUnits(stl([floorAt(0), up([[0, 0, 0], [-6, 1, 2], [2, 0, 0]])]), 0.25, "tree"), 0);
});

test("supportUnits: a face exactly 60° from straight down counts", () => {
  // Sides u = (1, 0, 0) and v = (0, −408,855,776, 708,158,977): 708,158,977² − 3 × 408,855,776² = 1 (a solution of
  // Pell's equation x² − 3y² = 1), so the normal (0, −x, −y) has length √(x² + y²) = √(4y² + 1), which rounds to 2y
  // exactly: its z share is −y / 2y = −0.5, the 60° limit. The corners are float32s whose differences give x and y.
  const face: P[] = [[0, 0, -1], [1, 0, -1], [0, -408855776, 708158976]];
  assert.ok(supportUnits(stl([floorAt(-1000), face]), 0.25, "tree") > 0);
});

test("supportUnits and sliceUnits: a file cut short is read only as far as it goes", () => {
  // The count says 2 triangles but only 1 is there: the file stops being read, never past its end.
  const short = stl([downAt(15)], 2);
  assert.equal(supportUnits(short, 0.25, "tree"), 0);
  assert.equal(sliceUnits(short, 0.25), 0);
});

test("sliceUnits: a hand-worked footprint off the origin", () => {
  // One triangle (100, 200, 0), (300, 200, 0), (100, 500, 5): 5 / 0.25 = 20 layers, footprint 200 × 300 = 60,000 mm²,
  // 15 % infill: share 0.25 + 0.15 = 0.4. Fill: 1.1e-3 × 60,000 × 20 × 0.4 = 528, over the triangles' 0.27 × 1 × 20.
  const one = stl([[[100, 200, 0], [300, 200, 0], [100, 500, 5]]]);
  assert.ok(close(sliceUnits(one, 0.25, 15), 528));
  // A negative layer height has no layers: nothing.
  assert.equal(sliceUnits(one, -0.25, 15), 0);
});

test("checkUnits: a file too short to hold its count has none", () => {
  assert.equal(checkUnits(new Uint8Array(10)), 0);
});

test("callUnits: the quick shapes, measures, constructions and stress tests by hand", () => {
  const sizes: Record<number, BodySize> = { 1: { faces: 6, mesh: 44 }, 2: { faces: 10, mesh: 50, sides: [10, 10, 10] } };
  const sizeOf = (h: number) => sizes[h];
  // A unit box: 4 corners × 11; a unit cylinder: 11.
  assert.equal(callUnits("make_box", [1, 1, 1] as never, sizeOf), 44);
  assert.equal(callUnits("make_cylinder", [1, 1] as never, sizeOf), 11);
  // Measuring a box's face against itself: 6 × 6 face pairs × 0.17 = 6.12; against the 10-faced body 6 × 10 × 0.17 = 10.2.
  assert.ok(close(callUnits("body_measure", [{ body: 1 }, null] as never, sizeOf), 6.12));
  assert.ok(close(callUnits("body_measure", [{ body: 1 }, { body: 2 }] as never, sizeOf), 10.2));
  // A construction from a pick on body 1 (mesh 44), with an empty, a missing and an unknown slot beside it: 44.
  assert.equal(callUnits("body_construct", [{ kind: "x", a: { pick: { body: 1 } }, b: null, c: undefined, d: { pick: { body: 9 } } }] as never, sizeOf), 44);
  // A stress test on a body whose size isn't known: the worst the default size can give.
  assert.equal(callUnits("stress_test", [9, {}] as never, sizeOf), STRESS_WORST_UNITS);
  // A mesh size of 0 would make endless cells: timed as the most a stress test can take.
  assert.equal(callUnits("stress_test", [2, { size: 0 }] as never, sizeOf), STRESS_MOST_UNITS);
});
