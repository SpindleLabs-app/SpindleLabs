// Undo steps kept in this browser (undo-steps.ts, step 89): the size limit worked by hand at its boundary, the text
// read back exactly and anything else refused, steps lined up with the project as it opens, the ten most recent
// projects only, failures that never cost a save, and a real history put back after a "reload", with seeded sessions
// against a plain model of the rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory, emptyProject, projectToJson, type DataReader, type Project, type SavedHistory } from "@fission/core";
import { alignSteps, decodeSteps, encodeSteps, memoryKeyValue, projectStore, stepsStore, STEPS_CHAR_LIMIT, STEPS_FORMAT, STEPS_PROJECTS, versionedStore, type KeyValue } from "../src/index.ts";
import * as storage from "../src/index.ts";

const entry = (snapshot: string, label = snapshot, at = 0, mergeKey?: string) => ({ snapshot, label, mergeKey, at });
/** Steps a, b, c, d (four characters each), the present at c. */
const abcd: SavedHistory = { kept: [entry("aaaa", ""), entry("bbbb"), entry("cccc", "cccc", 5, "width"), entry("dddd")], index: 2 };
const snapshots = (text: string | null) => {
  const s = decodeSteps(text ?? undefined);
  return s === null ? null : { snaps: s.kept.map((e) => e.snapshot), index: s.index };
};

test("the rules' numbers: 8 million characters a project, ten projects", () => {
  assert.equal(STEPS_CHAR_LIMIT, 8_000_000);
  assert.equal(STEPS_PROJECTS, 10);
  assert.equal(STEPS_FORMAT, 1);
});

test("hand-worked: the oldest steps go first past the limit, then the redo steps furthest away, never the present", () => {
  // 4 snapshots × 4 characters = 16, present at c (index 2).
  assert.deepEqual(snapshots(encodeSteps(abcd, 16)), { snaps: ["aaaa", "bbbb", "cccc", "dddd"], index: 2 }); // 16 ≤ 16: all kept
  // 16 > 15: a goes (12 left), index 2 − 1 = 1.
  assert.deepEqual(snapshots(encodeSteps(abcd, 15)), { snaps: ["bbbb", "cccc", "dddd"], index: 1 });
  assert.deepEqual(snapshots(encodeSteps(abcd, 12)), { snaps: ["bbbb", "cccc", "dddd"], index: 1 }); // 12 ≤ 12
  // 12 > 11: b goes too (8 left), index 0: c, the present, is the start now.
  assert.deepEqual(snapshots(encodeSteps(abcd, 11)), { snaps: ["cccc", "dddd"], index: 0 });
  // 8 > 7 and nothing before the present is left: d, the redo, goes (4 left).
  assert.deepEqual(snapshots(encodeSteps(abcd, 7)), { snaps: ["cccc"], index: 0 });
  assert.deepEqual(snapshots(encodeSteps(abcd, 4)), { snaps: ["cccc"], index: 0 });
  // The present alone (4) is over 3: nothing is kept.
  assert.equal(encodeSteps(abcd, 3), null);
});

test("the limit's boundary at 0.9× and 1.1× of a history's size: under it all is kept, over it the oldest goes", () => {
  // Ten 1,000-character steps, the present last: 10,000 characters.
  const kept = Array.from({ length: 10 }, (_, i) => entry(String(i).repeat(1000), `Step ${i}`, i));
  const saved: SavedHistory = { kept, index: 9 };
  assert.equal(snapshots(encodeSteps(saved, 11_000))!.snaps.length, 10); // 1.1×: the whole history
  assert.equal(snapshots(encodeSteps(saved, 9_000))!.snaps.length, 9); // 0.9×: 10,000 − 1,000 = 9,000 fits
  assert.equal(snapshots(encodeSteps(saved, 8_999))!.snaps.length, 8);
  assert.equal(decodeSteps(encodeSteps(saved, 9_000)!)!.kept[0].label, "Step 1"); // step 0 went, not the last
});

test("read back exactly: labels, times, merge keys (none too) and where the present is", () => {
  const back = decodeSteps(encodeSteps(abcd)!);
  assert.deepEqual(back, abcd);
  assert.equal(back!.kept[1].mergeKey, undefined);
  assert.equal(back!.kept[2].mergeKey, "width");
});

test("anything that isn't steps this build wrote is read as none, never thrown", () => {
  const good = JSON.parse(encodeSteps(abcd)!);
  const variants: [string, unknown][] = [
    ["a newer layout", { ...good, format: 2 }],
    ["no layout", { ...good, format: undefined }],
    ["the present past the end", { ...good, index: 4 }],
    ["the present before the start", { ...good, index: -1 }],
    ["a present that isn't a whole step", { ...good, index: 1.5 }],
    ["no steps", { ...good, kept: [], index: 0 }],
    ["steps not a list", { ...good, kept: "x" }],
    ["a snapshot missing", { ...good, kept: [{ label: "", mergeKey: null, at: 0 }, ...good.kept.slice(1)] }],
    ["a label that isn't text", { ...good, kept: [{ ...good.kept[0], label: 3 }, ...good.kept.slice(1)] }],
    ["a time that isn't a number", { ...good, kept: [{ ...good.kept[0], at: "0" }, ...good.kept.slice(1)] }],
    ["a merge key that isn't text", { ...good, kept: [{ ...good.kept[0], mergeKey: 7 }, ...good.kept.slice(1)] }],
    ["a step that isn't an object", { ...good, kept: [null, ...good.kept.slice(1)] }],
    ["not an object", 42],
    ["null", null],
  ];
  for (const [what, data] of variants) assert.equal(decodeSteps(JSON.stringify(data)), null, what);
  assert.equal(decodeSteps("{not json"), null, "damaged text");
  assert.equal(decodeSteps(undefined), null, "none written");
  assert.notEqual(decodeSteps(JSON.stringify(good)), null, "the control reads");
});

test("lined up with the project as it opens: at the present, moved back to its last match, or none", () => {
  assert.equal(alignSteps(abcd, "cccc"), abcd); // the present: as kept
  assert.deepEqual(alignSteps(abcd, "bbbb"), { kept: abcd.kept, index: 1 }); // the project's last save behind the steps: c and d a redo away
  assert.deepEqual(alignSteps(abcd, "dddd"), { kept: abcd.kept, index: 3 });
  const twice: SavedHistory = { kept: [entry("x"), entry("y"), entry("x"), entry("z")], index: 3 };
  assert.deepEqual(alignSteps(twice, "x"), { kept: twice.kept, index: 2 }); // the later of two matches: the fewest redos lost
  assert.equal(alignSteps(abcd, "eeee"), null); // changed in another tab since: start afresh
});

test("a store: written, read, forgotten; the steps of a project never written are none", async () => {
  const kv = memoryKeyValue();
  const steps = stepsStore(kv);
  assert.equal(await steps.read("p"), null);
  assert.equal(await steps.any(), false);
  await steps.write("p", abcd, 1000);
  assert.deepEqual(await steps.read("p"), abcd);
  assert.equal(kv.entries.get("steps-at/p"), "1000");
  assert.equal(await steps.any(), true);
  await steps.forget("p");
  assert.equal(await steps.read("p"), null);
  assert.deepEqual([...kv.entries.keys()], []);
});

test("only the projects written most recently keep their steps (two here, ten in the app)", async () => {
  const kv = memoryKeyValue();
  const steps = stepsStore(kv, { projects: 2 });
  await steps.write("a", abcd, 1);
  await steps.write("b", abcd, 2);
  await steps.write("c", abcd, 3); // a, written longest ago, goes
  assert.deepEqual([await steps.read("a"), (await steps.read("b")) !== null, (await steps.read("c")) !== null], [null, true, true]);
  await steps.write("b", abcd, 4); // b again: c is now the oldest, but both fit
  await steps.write("d", abcd, 4); // the same time as b: the one just written stays, c goes
  assert.deepEqual([await steps.read("c"), (await steps.read("b")) !== null, (await steps.read("d")) !== null], [null, true, true]);
  // Deliberate break: with room for every project nothing would go.
  const roomy = stepsStore(memoryKeyValue(), { projects: 3 });
  await roomy.write("a", abcd, 1);
  await roomy.write("b", abcd, 2);
  await roomy.write("c", abcd, 3);
  assert.deepEqual(await roomy.read("a"), abcd, "kept whole, as written");
});

test("the project just written always keeps its steps, even with the clock set back (save/load hunt C8)", async () => {
  const kv = memoryKeyValue();
  const steps = stepsStore(kv, { projects: 2 });
  await steps.write("a", abcd, 10_000);
  await steps.write("b", abcd, 10_001);
  await steps.write("now", abcd, 6_400); // an hour back: the oldest by the clock, but just written
  assert.deepEqual(await steps.read("now"), abcd, "kept whole, as written");
  assert.equal(await steps.read("a"), null); // a, the oldest of the others, goes
  assert.deepEqual(await steps.read("b"), abcd, "kept whole, as written");
});

test("a write that fails forgets that project's older steps, so they can't come back over newer work; never thrown", async () => {
  const kv = memoryKeyValue();
  const steps = stepsStore(kv);
  await steps.write("p", abcd, 1);
  const failing: KeyValue = { ...kv, update: async () => Promise.reject(new Error("browser storage is full: can't save")) };
  await stepsStore(failing).write("p", { kept: [entry("e")], index: 0 }, 2);
  assert.equal(await steps.read("p"), null);
  // A history too big to keep even its present forgets the older steps too.
  await steps.write("p", abcd, 3);
  await stepsStore(kv, { charLimit: 3 }).write("p", abcd, 4);
  assert.equal(await steps.read("p"), null);
  // A store that can't be read at all: none, never thrown.
  const broken: KeyValue = { ...kv, get: () => Promise.reject(new Error("no")), keys: () => Promise.reject(new Error("no")), delete: () => Promise.reject(new Error("no")), update: () => Promise.reject(new Error("no")) };
  const b = stepsStore(broken);
  assert.equal(await b.read("p"), null);
  assert.equal(await b.any(), false);
  await b.write("p", abcd, 5);
  await b.forget("p");
  await b.forgetAll();
});

const design: DataReader = { id: "design", readData: (d) => d };
const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });

test("deleting a kept project deletes its steps; another project's stay", async () => {
  const kv = memoryKeyValue();
  const store = versionedStore(projectStore(kv, [design]), kv, [design]);
  await store.save("p", part(1));
  await store.save("q", part(2));
  await store.steps.write("p", abcd, 1);
  await store.steps.write("q", abcd, 2);
  await store.remove("p");
  assert.equal(await store.steps.read("p"), null);
  assert.deepEqual(await store.steps.read("q"), abcd, "kept whole, as written");
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

test("storage full: this project's own steps give way first; the other projects' stay when that made room (save/load hunt C7)", async () => {
  const one = projectToJson(part(1)).length;
  const { kv, entries } = sized(one * 8);
  const store = versionedStore(projectStore(kv, [design]), kv, [design]);
  await store.save("p", part(1));
  const big = (n: number): SavedHistory => ({ kept: [entry("x".repeat(one * 2) + n, "")], index: 0 });
  await store.steps.write("p", big(1), 1);
  await store.steps.write("q", big(2), 2);
  assert.deepEqual([await store.steps.has("p"), await store.steps.has("q")], [true, true], "both kept while there was room");
  // What is held now, and p's own steps' share of it; p grown by `note` characters then needs used + note. A note of
  // room − used + half of p's steps is too big beside both sets of steps, and fits once p's steps go (half of them spare).
  const used = [...entries.values()].reduce((n, v) => n + v.length, 0);
  const own = entries.get("steps/p")!.length + entries.get("steps-at/p")!.length;
  const note = one * 8 - used + Math.floor(own / 2);
  const bigger: Project = { ...part(1), workspaces: { design: { version: 1, width: 1, note: "y".repeat(note) } } };
  await store.save("p", bigger);
  assert.deepEqual(await store.open("p"), bigger);
  assert.equal(await store.steps.has("p"), false, "p's own steps gave way");
  assert.equal(await store.steps.has("q"), true, "q's steps stayed: p's were enough");
});

test("storage full: every project's kept steps give way to a save, which goes through", async () => {
  const one = projectToJson(part(1)).length;
  const { kv } = sized(one * 8);
  const store = versionedStore(projectStore(kv, [design]), kv, [design]);
  await store.save("p", part(1));
  const big = (n: number): SavedHistory => ({ kept: [entry("x".repeat(one * 2) + n)], index: 0 });
  await store.steps.write("p", big(1), 1);
  await store.steps.write("q", big(2), 2);
  assert.equal(await store.steps.any(), true, "steps were kept while there was room");
  const bigger: Project = { ...part(9), workspaces: { design: { version: 1, width: 9, note: "y".repeat(one * 4) } } };
  await store.save("p", bigger); // too big beside the steps: they go, and the save is tried again
  assert.deepEqual(await store.open("p"), bigger);
  assert.equal(await store.steps.any(), false);
  // With no steps and no versions to give up, a save still too big is refused as it was.
  await assert.rejects(store.save("p", { ...bigger, workspaces: { design: { version: 1, note: "z".repeat(one * 9) } } }), /storage is full/);
});

test("a real history kept and put back after a reload: the same steps, Undo and Redo carry on", async () => {
  const kv = memoryKeyValue();
  const steps = stepsStore(kv);
  let project = "w=10";
  let t = 0;
  const h = createHistory({ capture: () => project, restore: (s) => (project = s), now: () => (t += 5000) });
  for (const w of [20, 30, 40]) {
    project = `w=${w}`;
    h.record(`Width ${w}`, "width");
  }
  h.undo(); // the present at w=30, Width 40 a redo away
  await steps.write("p", h.save(), 1);
  // The reload: a fresh history over the project as it was stored.
  const reopened = createHistory({ capture: () => project, restore: (s) => (project = s) });
  const saved = await steps.read("p");
  assert.equal(reopened.load(alignSteps(saved!, project)!), true);
  assert.deepEqual(reopened.steps(), h.steps());
  assert.equal(reopened.undoLabel(), "Width 30");
  assert.equal(reopened.redo(), "Width 40");
  assert.equal(project, "w=40");
  assert.equal(reopened.undo(), "Width 40");
  assert.equal(reopened.undo(), "Width 30");
  assert.equal(reopened.undo(), "Width 20");
  assert.equal(project, "w=10");
  // Deliberate break: the project changed in another tab since. The steps don't line up, and a load would be refused.
  project = "w=99";
  assert.equal(alignSteps(saved!, project), null);
  assert.equal(reopened.load(saved!), false);
});

/** A small seeded generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test("seeded sessions: edits, undos, redos, writes and reloads; after each reload the steps are the last ones written", async () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = rng(seed);
    const kv = memoryKeyValue();
    const steps = stepsStore(kv, { charLimit: 60 }); // small, so trimming happens: snapshots are 3–5 characters
    let project = "s0";
    let n = 0;
    let h = createHistory({ capture: () => project, restore: (s) => (project = s), limit: 15, mergeMs: 0 });
    /** The model: the steps last written, trimmed as the rule says, and the project stored then. */
    let written: { snaps: string[]; labels: string[]; index: number } | null = null;
    for (let i = 0; i < 300; i++) {
      const pick = r();
      if (pick < 0.5) {
        project = `s${++n}`;
        h.record(`Edit ${n}`);
      } else if (pick < 0.65) h.undo();
      else if (pick < 0.75) h.redo();
      else if (pick < 0.9) {
        const saved = h.save();
        await steps.write("p", saved, i);
        // Model of the trim: oldest first while over 60, then the furthest redo.
        let kept = saved.kept.map((e) => ({ s: e.snapshot, l: e.label }));
        let index = saved.index;
        const size = () => kept.reduce((c, e) => c + e.s.length, 0);
        while (size() > 60 && index > 0) (kept = kept.slice(1)), index--;
        while (size() > 60 && kept.length > index + 1) kept = kept.slice(0, -1);
        written = { snaps: kept.map((e) => e.s), labels: kept.map((e) => e.l), index };
      } else {
        // Reload: the project is as it is (the store saved it); a fresh history, the kept steps put back if they fit.
        h = createHistory({ capture: () => project, restore: (s) => (project = s), limit: 15, mergeMs: 0 });
        const saved = await steps.read("p");
        const fits = saved && alignSteps(saved, project);
        const expected = written && written.snaps.lastIndexOf(project);
        if (written === null || expected === -1 || expected === null) {
          assert.equal(fits ?? null, null, `seed ${seed} step ${i}: nothing to put back`);
        } else {
          assert.ok(fits, `seed ${seed} step ${i}: the steps fit`);
          assert.equal(h.load(fits), true);
          assert.deepEqual(fits.kept.map((e) => e.snapshot), written.snaps, `seed ${seed} step ${i}`);
          assert.deepEqual(h.steps().slice(1).map((s) => s.label), written.labels.slice(1));
          assert.equal(h.steps().findIndex((s) => s.state === "current"), expected);
        }
      }
    }
  }
});

test("extendSteps: the project as it opened becomes one more step after the present, and the redo steps go (worked by hand)", () => {
  const step = (snapshot: string, label: string, at: number) => ({ snapshot, label, mergeKey: undefined, at });
  const kept: SavedHistory = { kept: [step("a", "", 1), step("b", "B", 2), step("c", "C", 3)], index: 1 };
  // By hand: the present is "b" (index 1) with "c" a redo away. A new change "d" at time 9 drops "c" as any new change
  // does: the steps are a, b, d and the present is the last, index 2.
  const { extendSteps } = storage;
  assert.deepEqual(extendSteps(kept, "d", 9, "Left"), { kept: [step("a", "", 1), step("b", "B", 2), step("d", "Left", 9)], index: 2 });
  assert.deepEqual(kept.kept.map((e) => e.snapshot), ["a", "b", "c"], "the steps given are not changed");
  // The present the last step: nothing dropped.
  assert.deepEqual(extendSteps({ kept: kept.kept, index: 2 }, "d", 9, "Left").kept.map((e) => e.snapshot), ["a", "b", "c", "d"]);
});
