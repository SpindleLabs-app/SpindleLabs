// Issue #628 item 8 (lost-work hunt 2026-11-12, helper D's D7): a design opened from My designs keeps the save time
// of the device it was saved on. When that device's clock was ahead, every later state here was measured from that
// future time, so no earlier versions were kept until real time caught up (red on main a4bd339: one version in two
// hours). A state is now measured from the newest version not saved after it (`previousKept`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type DataReader, type Project } from "@fission/core";
import { memoryKeyValue, projectStore, versionedStore, VERSION_GAP_MS } from "../src/index.ts";
import { previousKept } from "../src/versions.ts";

const design: DataReader = { id: "design", readData: (d) => d };
const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 20, 9, 0);

function setup() {
  const kv = memoryKeyValue();
  const clock = { minutes: 0 };
  const store = versionedStore(projectStore(kv, [design], () => new Date(T0 + clock.minutes * MIN)), kv, [design]);
  const at = (minutes: number) => (clock.minutes = minutes);
  const kept = async () => (await store.versions("p")).map((d) => (d.getTime() - T0) / MIN);
  return { store, at, kept };
}

test("previousKept: the newest kept time not after the one asked about (worked by hand)", () => {
  assert.equal(previousKept([], 5), null);
  assert.equal(previousKept([1440, 20, 10], 25), 20, "1440 is later than 25: passed over");
  assert.equal(previousKept([1440, 20, 10], 20), 20, "the same time counts");
  assert.equal(previousKept([1440], 25), null, "only one from the future: none before it");
  assert.equal(previousKept([10, 30, 20], 35), 30, "in any order");
});

test("item 8: a design brought in with a save time a day ahead still gets a version every ten minutes as work goes on", async () => {
  const { store, at, kept } = setup();
  at(0);
  await store.save("p", part(1), new Date(T0 + 1440 * MIN)); // brought from My designs: the other device's time, a day ahead
  // Two hours of work here, a save every 5 minutes (each with this browser's time).
  for (let m = 5; m <= 120; m += 5) {
    at(m);
    await store.save("p", part(1 + m), new Date(T0 + m * MIN));
  }
  // Hand-worked: the 5-minute save replaces the brought state (saved at 1440): no version yet, kept. The 10-minute save
  // replaces the state of 5: nothing at or before 5 is kept, so it is kept. After that, from 5 on, one every ten
  // minutes: 15, 25, … 115 (each 10 after the one before; the states of 10, 20, … are 5 after and stood 5).
  assert.deepEqual(await kept(), [1440, 115, 105, 95, 85, 75, 65, 55, 45, 35, 25, 15, 5]);
  assert.equal((await kept()).length >= 10, true, "the hunt's line: about one every ten minutes over two hours");
});

test("item 8: boundary at the gap, measured from the version before (not the future one): 0.9× not kept, 1.1× kept", async () => {
  for (const [k, expect] of [[0.9, [1440, 0]], [1.1, [1440, 11, 0]]] as const) {
    const { store, at, kept } = setup();
    at(0);
    await store.save("p", part(1), new Date(T0 + 1440 * MIN));
    await store.save("p", part(2), new Date(T0)); // replaces the brought state: kept at 1440
    const later = (k * VERSION_GAP_MS) / MIN;
    at(later);
    await store.save("p", part(3), new Date(T0 + later * MIN)); // replaces the state of 0: none before it, kept at 0
    at(later + 0.5);
    await store.save("p", part(4), new Date(T0 + (later + 0.5) * MIN)); // replaces the state of `later`: later − 0 vs 10 minutes
    assert.deepEqual(await kept(), expect, `${k}×`);
  }
});
