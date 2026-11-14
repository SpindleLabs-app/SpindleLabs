// A save reads the state it replaces only when that state could become a version (load/save speed pass, 2026-11-11):
// within VERSION_GAP_MS of the newest version keep() passes it over, so reading the whole project text and writing
// the new one out again just to compare them was wasted (a third of a 1 MB project's save in the browser). Checked by
// hand on a counting store, through storage full (the refused save still leaves the state to keep), and by seeded
// sessions against the frozen copy of the code before (fixtures/versions-before.ts): every entry of the store ends
// exactly as it did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type DataReader, type Project } from "@fission/core";
import { memoryKeyValue, projectStore, versionedStore, type KeyValue } from "../src/index.ts";
import { versionedStore as versionedStoreBefore } from "./fixtures/versions-before.ts";

const design: DataReader = { id: "design", readData: (d) => d };
const part = (width: number, note = ""): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width, ...(note ? { note } : {}) } } });
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 4, 9, 0);

/** `kv` counting reads of project texts, and refusing writes past `room` characters as a full IndexedDB does. */
function counted(room = Infinity) {
  const kv = memoryKeyValue();
  const reads = { project: 0 };
  const used = (extra: Record<string, string>) => {
    const all = new Map(kv.entries);
    for (const [k, v] of Object.entries(extra)) all.set(k, v);
    return [...all.values()].reduce((n, v) => n + v.length, 0);
  };
  const full = () => new Error("browser storage is full: can't save the project (use Save to keep your work as a file)");
  const wrapped: KeyValue = {
    ...kv,
    get: async (k) => {
      if (k.startsWith("project/")) reads.project++;
      return kv.get(k);
    },
    set: async (k, v) => {
      if (used({ [k]: v }) > room) throw full();
      await kv.set(k, v);
    },
    update: async (keys, change) => {
      await kv.update(keys, (values) => {
        const writes = change(values);
        if (used(writes) > room) throw full();
        return writes;
      });
    },
  };
  return { kv: wrapped, entries: kv.entries, reads };
}

function setup(kv: KeyValue, make = versionedStore) {
  const clock = { minutes: 0 };
  const now = () => new Date(T0 + clock.minutes * MIN);
  const made = make(projectStore(kv, [design], now), kv, [design]);
  // Each save given the time its state was read, as the app's autosave gives it (a save given none is read as before).
  const store: typeof made = { ...made, save: (id, project, read = now(), ...rest) => made.save(id, project, read, ...rest) };
  return { store, at: (m: number) => (clock.minutes = m), kept: async () => (await store.versions("p")).map((d) => (d.getTime() - T0) / MIN) };
}

test("hand-worked: saves at 0, 1, 5, 11, 20 and 31 minutes read the replaced state three times (at 1, 20 and 31), not six", async () => {
  const { kv, reads } = counted();
  const { store, at, kept } = setup(kv);
  const steps: [number, number][] = [];
  for (const [m, w] of [[0, 10], [1, 11], [5, 12], [11, 13], [20, 14], [31, 15]]) {
    at(m);
    const was = reads.project;
    await store.save("p", part(w));
    steps.push([m, reads.project - was]);
  }
  // 0: no summary yet, nothing replaced. 1: no version yet, the 0-minute state may be kept: read. 5: replaces the
  // 1-minute state, 1 − 0 = 1 < 10: passed over unread. 11: 5 − 0 = 5 < 10: unread. 20: 11 − 0 = 11 ≥ 10: read and
  // kept. 31: 20 − 11 = 9 < 10, but the 20-minute state stood 31 − 20 = 11 ≥ 10 (issue #628 item 3): read and kept.
  // (A state that stood 9 minutes or more is read, a tenth of the gap kept for the store's own clock; the 5-minute
  // state stood 6.) The code before read it at every save (6 reads, the first finding none).
  assert.deepEqual(steps, [[0, 0], [1, 1], [5, 0], [11, 0], [20, 1], [31, 1]]);
  assert.deepEqual(await kept(), [20, 11, 0], "the same versions as versions.test.ts's hand-worked case");
});

test("deliberate break: the code before reads it at every save, so the count above can fail", async () => {
  const { kv, reads } = counted();
  const { store, at } = setup(kv, versionedStoreBefore);
  for (const [m, w] of [[0, 10], [1, 11], [5, 12], [11, 13], [20, 14], [31, 15]]) {
    at(m);
    await store.save("p", part(w));
  }
  assert.equal(reads.project, 6); // the first one too, finding none
});

test("storage full within the gap: the replaced state, passed over unread, is still read before the retry and kept once the old versions give way, as before", async () => {
  const one = projectToJson(part(1)).length;
  for (const make of [versionedStore, versionedStoreBefore]) {
    const { kv } = counted(one * 6.5);
    const { store, at, kept } = setup(kv, make);
    at(0);
    await store.save("p", part(0, "z".repeat(one * 3))); // a big state, so its version takes room
    at(1);
    await store.save("p", part(1)); // keeps the 0-minute state
    at(2);
    await store.save("p", part(2)); // 1 − 0 < 10: the 1-minute state is passed over
    assert.deepEqual(await kept(), [0]);
    at(3);
    // Replaces the 2-minute state (2 − 0 < 10, passed over unread), but too big beside the big version: the version
    // goes and the save is tried again; with no version left, the small 2-minute state is the one kept, and fits.
    const big = part(9, "x".repeat(one * 3));
    await store.save("p", big);
    assert.deepEqual(await store.open("p"), big);
    assert.deepEqual(await kept(), [2], make === versionedStore ? "now" : "before");
    assert.deepEqual(await store.openVersion("p", new Date(T0 + 2 * MIN)), part(2));
  }
});

/** A small seeded generator (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const seed of [1, 2, 3, 4, 5]) {
  test(`seeded session ${seed}: 600 saves of three projects (repeats, big ones, a store that fills) end with every entry exactly as the code before left it`, async () => {
    const r = random(seed);
    const one = projectToJson(part(1)).length;
    const room = seed % 2 ? Infinity : one * 60;
    const now = counted(room);
    const before = counted(room);
    const a = setup(now.kv);
    const b = setup(before.kv, versionedStoreBefore);
    let minutes = 0;
    for (let i = 0; i < 600; i++) {
      minutes += r() < 0.7 ? r() * 3 : r() * 25;
      a.at(minutes);
      b.at(minutes);
      const id = ["p", "q", "r"][Math.floor(r() * 3)];
      const w = r() < 0.2 ? 1 : Math.floor(r() * 50); // width 1 often: a save of the same state
      const project = r() < 0.05 ? part(w, "y".repeat(Math.floor(one * 10 * r()))) : part(w);
      const results = await Promise.allSettled([a.store.save(id, project), b.store.save(id, project)]);
      assert.equal(results[0].status, results[1].status, `save ${i}: ${JSON.stringify(results)}`);
    }
    assert.deepEqual([...now.entries].sort(), [...before.entries].sort());
    assert.ok(now.reads.project < before.reads.project, `fewer reads (${now.reads.project} against ${before.reads.project})`);
  });
}

test("a save given no time of its own (the store's clock gives it) reads the replaced state at every save, as before", async () => {
  // Its new save time is the store's clock's, unknown to the versions until after the save, so whether the replaced
  // state stood for ten minutes can't be told first: read each time a state is there to replace, as the code before
  // did, so 5 reads (the first save replaces nothing: no summary yet, nothing to read; the code before read it too, 6).
  const { kv, reads } = counted();
  const clock = { minutes: 0 };
  const store = versionedStore(projectStore(kv, [design], () => new Date(T0 + clock.minutes * MIN)), kv, [design]);
  for (const [m, w] of [[0, 10], [1, 11], [5, 12], [11, 13], [20, 14], [31, 15]]) {
    clock.minutes = m;
    await store.save("p", part(w));
  }
  assert.equal(reads.project, 5);
  assert.deepEqual((await store.versions("p")).map((d) => (d.getTime() - T0) / MIN), [20, 11, 0], "versions.test.ts's hand-worked versions");
});
