// Earlier versions (versions.ts, missing basics 3b): which states are kept, worked by hand on a fake clock (one
// every ten minutes at most while the work goes on, and always a state that stood for ten minutes); the
// newest twenty only; a save of the same state keeps none; versions never cost a save (one that can't be written is
// passed over, and storage full gives them up for the save); deleting a project deletes them; and seeded sessions
// against a plain model of the rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type DataReader, type Project } from "@fission/core";
import { forget, memoryKeyValue, projectStore, ProjectChangedError, storageFull, versionedStore, VERSION_GAP_MS, VERSION_LIMIT, type KeyValue } from "../src/index.ts";

const design: DataReader = { id: "design", readData: (d) => d };
const part = (width: number, name = "Box"): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 4, 9, 0);

/** A store with versions on a clock the test sets (`at`, minutes after 09:00 UTC). */
function setup(kv: KeyValue = memoryKeyValue(), options = {}) {
  const clock = { minutes: 0 };
  const now = () => new Date(T0 + clock.minutes * MIN);
  const store = versionedStore(projectStore(kv, [design], now), kv, [design], options);
  const at = (minutes: number) => (clock.minutes = minutes);
  const kept = async (id = "p") => (await store.versions(id)).map((d) => (d.getTime() - T0) / MIN);
  return { store, at, kept, kv };
}

test("the rules' numbers: one version every ten minutes at most, the newest twenty", () => {
  assert.equal(VERSION_GAP_MS, 600_000); // 10 · 60 · 1000
  assert.equal(VERSION_LIMIT, 20);
});

test("hand-worked: saves at 0, 1, 5, 11, 20 and 31 minutes keep the states of 0, 11 and 20", async () => {
  const { store, at, kept } = setup();
  at(0);
  await store.save("p", part(10)); // nothing before it: nothing to keep
  assert.deepEqual(await kept(), []);
  at(1);
  await store.save("p", part(11)); // replaces the 0-minute state; no version yet, so it is kept
  assert.deepEqual(await kept(), [0]);
  at(5);
  await store.save("p", part(12)); // replaces the 1-minute state: 1 − 0 = 1 < 10 minutes after the newest version, and it stood 5 − 1 = 4 < 10: not kept
  at(11);
  await store.save("p", part(13)); // replaces the 5-minute state: 5 − 0 = 5 < 10, and it stood 11 − 5 = 6 < 10: not kept
  assert.deepEqual(await kept(), [0]);
  at(20);
  await store.save("p", part(14)); // replaces the 11-minute state: 11 − 0 = 11 ≥ 10, kept
  assert.deepEqual(await kept(), [11, 0]);
  at(31);
  await store.save("p", part(15)); // replaces the 20-minute state: 20 − 11 = 9 < 10, but it stood 31 − 20 = 11 ≥ 10: kept
  assert.deepEqual(await kept(), [20, 11, 0]);
  assert.deepEqual(await store.openVersion("p", new Date(T0 + 20 * MIN)), part(14));
  // Each version is the state as it was then: at 11 minutes the width was 13, at 0 it was 10.
  assert.deepEqual(await store.openVersion("p", new Date(T0 + 11 * MIN)), part(13));
  assert.deepEqual(await store.openVersion("p", new Date(T0)), part(10));
  assert.deepEqual(await store.open("p"), part(15), "the project itself is the newest state");
});

test("boundary: a state exactly ten minutes after the newest version is kept, 599,998.8 ms after is not (and the hand-worked case has 0.9×, 9 min, not kept and 1.1×, 11 min, kept)", async () => {
  const { store, at, kept } = setup();
  at(0);
  await store.save("p", part(1));
  at(0.5);
  await store.save("p", part(2)); // keeps 0
  at(9.99998);
  await store.save("p", part(3)); // replaces 0.5: 0.5 after the newest version, stood 9.49998, both under 10: not kept
  at(10.5);
  await store.save("p", part(4)); // replaces 9.99998 min (599,998.8 ms after 0, under 600,000; stood 0.5): not kept
  assert.deepEqual(await kept(), [0]);
  at(11);
  await store.save("p", part(5)); // replaces 10.5 min: kept
  at(20.5);
  await store.save("p", part(6)); // replaces 11 min: 11 − 10.5 = 0.5 < 10 after the newest version, stood 20.5 − 11 = 9.5 < 10: not kept
  assert.deepEqual(await kept(), [10.5, 0]);
  at(30);
  await store.save("p", part(7)); // replaces 20.5: 20.5 − 10.5 = 10 ≥ 10, kept
  at(39);
  await store.save("p", part(8)); // replaces 30: 30 − 20.5 = 9.5 < 10, stood 39 − 30 = 9 < 10: not kept
  assert.deepEqual(await kept(), [20.5, 10.5, 0]);
  const exact = setup();
  exact.at(0);
  await exact.store.save("p", part(1));
  exact.at(1);
  await exact.store.save("p", part(2)); // keeps 0
  exact.at(10);
  await exact.store.save("p", part(3)); // replaces 1: 1 < 10, stood 9 < 10
  exact.at(12);
  await exact.store.save("p", part(4)); // replaces 10: exactly 10 minutes after 0, kept
  assert.deepEqual(await exact.kept(), [10, 0]);
});

test("hand-worked: the state a session ended in is kept when the next session, a week later, saves over it (issue #628, item 3)", async () => {
  const { store, at, kept } = setup();
  const WEEK = 7 * 24 * 60;
  // Monday: a save a minute from 09:00 to 09:09, widths 50 to 59. The 09:00 state is the first version (kept when
  // 09:01 replaces it, none before); the states of 09:01 to 09:08 are each 1 to 8 minutes after it (under 10) and
  // each stood for 1 minute (under 10): not kept.
  for (let m = 0; m < 10; m++) {
    at(m);
    await store.save("p", part(50 + m));
  }
  assert.deepEqual(await kept(), [0]);
  // The Monday after, a wrong edit: it replaces the 09:09 state, which is only 9 minutes after the newest version
  // but stood for 7 days − 9 minutes = 10,071 minutes, 10 or more: kept.
  at(WEEK);
  await store.save("p", part(1));
  assert.deepEqual(await kept(), [9, 0]);
  assert.deepEqual(await store.openVersion("p", new Date(T0 + 9 * MIN)), part(59), "the state Monday's session ended in");
  // A minute later another: the first wrong state is 10,071 minutes after the newest version: kept as before.
  at(WEEK + 1);
  await store.save("p", part(2));
  assert.deepEqual(await kept(), [WEEK, 9, 0]);
});

test("boundary: a replaced state that stood for 0.9 × ten minutes is not kept for that, one that stood for 1.1 × is, and exactly ten minutes is", async () => {
  // Each case: version at 0 (kept when 1 replaces it), then the 1-minute state, 1 < 10 minutes after the newest
  // version, is replaced after standing 9, 11 or exactly 10 minutes.
  for (const [stood, expected] of [[9, [0]], [11, [1, 0]], [10, [1, 0]], [9.99998, [0]]] as const) {
    const { store, at, kept } = setup();
    at(0);
    await store.save("p", part(1));
    at(1);
    await store.save("p", part(2));
    at(1 + stood);
    await store.save("p", part(3));
    assert.deepEqual(await kept(), expected, `stood ${stood} minutes`);
  }
});

test("only the newest twenty are kept, the oldest given up first", async () => {
  const { store, at, kept } = setup();
  for (let i = 0; i <= 25; i++) {
    at(i * 10);
    await store.save("p", part(i));
  }
  // Saves at 0, 10, …, 250 minutes: each replaces a state 10 minutes after the last kept, so 0…240 would all be kept
  // (25 states); the newest twenty are 240 back to 50.
  assert.deepEqual(await kept(), Array.from({ length: 20 }, (_, k) => 240 - k * 10));
});

test("a save of exactly the stored state keeps no version (a project brought forward, say)", async () => {
  const { store, at, kept } = setup();
  at(0);
  await store.save("p", part(1));
  at(20);
  await store.save("p", part(1));
  assert.deepEqual(await kept(), []);
});

test("each project keeps its own versions; deleting one (or forgetting it) takes its versions too", async () => {
  const { store, at, kept, kv } = setup();
  at(0);
  await store.save("a", part(1));
  await store.save("b", part(2));
  at(15);
  await store.save("a", part(3));
  await store.save("b", part(4));
  assert.deepEqual([await kept("a"), await kept("b")], [[0], [0]]);
  await store.remove("a");
  assert.deepEqual(await kept("a"), []);
  await forget(store, null, "b");
  assert.deepEqual(await kept("b"), []);
  assert.deepEqual([...kv.keys ? await kv.keys("version/") : []], [], "nothing left behind");
});

test("openVersion refuses a version that isn't kept, and one that can't be read, with a message", async () => {
  const { store, at, kv } = setup();
  at(0);
  await store.save("p", part(1));
  await assert.rejects(store.openVersion("p", new Date(T0)), /there is no version of this project saved at 2026-11-04T09:00:00.000Z/);
  await kv.set(`version/p/${T0}`, "{ not json");
  await assert.rejects(store.openVersion("p", new Date(T0)), /^Error: can't open that version: /);
});

test("a version that can't be written never fails the save", async () => {
  const kv = memoryKeyValue();
  const { store, at, kept } = setup({ ...kv, set: () => Promise.reject(new Error("browser storage is full: can't save")) });
  at(0);
  await store.save("p", part(1));
  at(20);
  await store.save("p", part(2)); // its version can't be written: passed over
  assert.deepEqual(await store.open("p"), part(2));
  assert.deepEqual(await kept(), []);
});

/** `kv` holding at most `room` characters of values: a write past that is refused as IndexedDB refuses it when full. */
function sized(room: number) {
  const kv = memoryKeyValue();
  const used = (extra: Record<string, string>) => {
    const all = new Map(kv.entries);
    for (const [k, v] of Object.entries(extra)) all.set(k, v);
    return [...all.values()].reduce((n, v) => n + v.length, 0);
  };
  const full = () => new Error("browser storage is full: can't save the project (use Save to keep your work as a file)");
  const limited: KeyValue = {
    ...kv,
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
  return { kv: limited, entries: kv.entries };
}

test("storage full: this project's versions give way to its save, which goes through", async () => {
  const one = projectToJson(part(1)).length;
  const { kv } = sized(one * 6); // room for the project, its summary and a few versions
  const { store, at, kept } = setup(kv, { gapMs: 0 });
  for (let i = 0; i < 4; i++) {
    at(i);
    await store.save("p", part(i));
  }
  assert.ok((await kept()).length >= 2, "versions were kept while there was room");
  at(10);
  const big: Project = { ...part(9), workspaces: { design: { version: 1, width: 9, note: "x".repeat(one * 3) } } };
  await store.save("p", big); // too big beside the versions: they go, and the save is tried again
  assert.deepEqual(await store.open("p"), big);
  assert.ok((await kept()).length <= 1, "the old versions gave way");
  assert.equal(storageFull(new Error("browser storage is full: can't save")), true);
  assert.equal(storageFull(new Error("browser storage failed: can't save (UnknownError)")), false);
});

test("a save refused for another reason leaves every version as it was, and is said as it was", async () => {
  const { store, at, kept } = setup();
  at(0);
  await store.save("p", part(1));
  at(20);
  await store.save("p", part(2));
  assert.deepEqual(await kept(), [0]);
  await assert.rejects(store.save("p", part(3), undefined, new Date(1)), ProjectChangedError); // another tab saved since
  await assert.rejects(store.save("p", part(Number.NaN)), /NaN|number/i); // refused before anything is written
  assert.deepEqual(await kept(), [0]);
  assert.deepEqual(await store.open("p"), part(2));
});

test("deliberate break: with no gap at all, every save keeps a version (so the gap is what limits them)", async () => {
  const { store, at, kept } = setup(memoryKeyValue(), { gapMs: 0 });
  for (const m of [0, 1, 2, 3]) {
    at(m);
    await store.save("p", part(m));
  }
  assert.deepEqual(await kept(), [2, 1, 0]);
});

/** Seeded: mulberry32. */
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
  test(`seeded session ${seed}: 1,000 saves of two projects, minutes apart, keep exactly the model's versions`, async () => {
    const r = random(seed);
    const { store, at } = setup();
    // The model: each project's stored [time, width], and its versions as [time, width], newest first.
    const model = new Map<string, { at: number; width: number; versions: [number, number][] }>();
    let minutes = 0;
    for (let step = 0; step < 1000; step++) {
      minutes += Math.floor(r() * 8) + (r() < 0.1 ? 30 : 0); // mostly a few minutes apart, now and then a long gap
      const id = r() < 0.7 ? "a" : "b";
      const was = model.get(id);
      const width = was !== undefined && r() < 0.1 ? was.width : Math.floor(r() * 50); // now and then the same state again
      at(minutes);
      await store.save(id, part(width));
      const versions = was?.versions ?? [];
      if (was !== undefined && was.width !== width && versions[0]?.[0] !== was.at && (versions.length === 0 || was.at - versions[0][0] >= 10 || minutes - was.at >= 10)) versions.unshift([was.at, was.width]);
      model.set(id, { at: minutes, width, versions: versions.slice(0, 20) });
      if (step % 100 === 99 || step === 999) {
        for (const [pid, m] of model) {
          const got = (await store.versions(pid)).map((d) => (d.getTime() - T0) / MIN);
          assert.deepEqual(got, m.versions.map(([t]) => t), `seed ${seed} step ${step}: ${pid}'s versions`);
          for (const [t, w] of m.versions.slice(0, 3)) assert.deepEqual(await store.openVersion(pid, new Date(T0 + t * MIN)), part(w), `seed ${seed} step ${step}: ${pid} at ${t}`);
        }
      }
    }
  });
}
