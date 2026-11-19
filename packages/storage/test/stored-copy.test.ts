// Real-use hunt B3: every Open stored a new copy of the file, so opening the same file again piled up copies no one
// could reach. storedCopy finds the stored project that already holds exactly the opened one (store.ts), and
// keepStorage asks the browser once, after the first save, not to clear the store under storage pressure (persist.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson, type DataReader, type Project } from "@fission/core";
import { keepStorage, memoryKeyValue, projectStore, storedCopy, storedCopyOf } from "../src/index.ts";

const part = (name: string, width: number): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });
const settle = () => new Promise<void>((r) => setImmediate(r));

test("the stored copy of an opened project, worked by hand", async () => {
  // Stored: a = "A" width 1, b = "A" width 2, c = "C" width 1. Opening "A" width 2 is b's text exactly, so b; "A"
  // width 3 is no one's; "C" width 1 differs from a only by its name, so c, not a; "B" width 1 is no one's (no "B").
  const store = projectStore(memoryKeyValue(), []);
  await store.save("a", part("A", 1));
  await store.save("b", part("A", 2));
  await store.save("c", part("C", 1));
  assert.equal((await storedCopy(store, part("A", 2)))?.id, "b");
  assert.equal(await storedCopy(store, part("A", 3)), undefined);
  assert.equal((await storedCopy(store, part("C", 1)))?.id, "c");
  assert.equal(await storedCopy(store, part("B", 1)), undefined);
});

test("the copy found carries its save time, so the first save over it checks no other tab changed it since", async () => {
  const store = projectStore(memoryKeyValue(), [], () => new Date(5000));
  await store.save("p", part("P", 1));
  const found = await storedCopy(store, part("P", 1));
  assert.equal(found?.modified.getTime(), 5000);
});

test("two stored copies of the same text: the one saved last is reused", async () => {
  // Copies left by the app before this fix: x saved first (order 1), y next (order 2); the list puts y first.
  const store = projectStore(memoryKeyValue(), []);
  await store.save("x", part("P", 1));
  await store.save("y", part("P", 1));
  assert.equal((await storedCopy(store, part("P", 1)))?.id, "y");
});

test("a project read through the workspaces' readers matches the stored copy it was saved as", async () => {
  // The app compares projects as read (projectFromJson upgrades each workspace's part), not the file's own bytes: a
  // file saved with other spacing, or by an older version, still finds the copy stored after it was opened.
  const design: DataReader = { id: "design", readData: (d) => ({ ...(d as object), read: true }) };
  const store = projectStore(memoryKeyValue(), [design]);
  const file = JSON.stringify(JSON.parse(projectToJson(part("P", 4))), null, 2); // spaced out, not yet read
  const opened = projectFromJson(file, [design]);
  await store.save("p", opened); // what openProject's first autosave stores
  assert.equal((await storedCopy(store, projectFromJson(file, [design])))?.id, "p");
});

test("a stored project that can't be read, or whose summary can't, is passed over, not an error", async () => {
  // The check fails for a storedCopy that let open's refusal through: Open would then refuse a good file.
  const kv = memoryKeyValue();
  const store = projectStore(kv, []);
  await kv.set("project/bad", "{ not json");
  await kv.set("summary/bad", JSON.stringify({ name: "P", modified: "2026-01-01T00:00:00.000Z", order: 9 }));
  await kv.set("project/odd", projectToJson(part("P", 1)));
  await kv.set("summary/odd", "{ not json");
  assert.equal(await storedCopy(store, part("P", 1)), undefined);
  await store.save("good", part("P", 1));
  assert.equal((await storedCopy(store, part("P", 1)))?.id, "good");
});

test("keepStorage asks the browser once, however many saves follow", async () => {
  let asked = 0;
  const ask = keepStorage({ persist: async () => (asked++, true) });
  assert.equal(asked, 0, "nothing asked before the first save");
  ask();
  ask();
  ask();
  await settle();
  assert.equal(asked, 1);
});

test("keepStorage with no storage manager, no persist, or a persist that throws or refuses does nothing visible", async () => {
  keepStorage(undefined)();
  keepStorage({})();
  let unhandled = 0;
  const count = () => void unhandled++;
  process.on("unhandledRejection", count);
  keepStorage({ persist: () => Promise.reject(new Error("denied")) })();
  keepStorage({
    persist: () => {
      throw new Error("not allowed here");
    },
  })();
  keepStorage({ persist: async () => false })();
  await settle();
  await settle();
  process.off("unhandledRejection", count);
  assert.equal(unhandled, 0);
});

// Nightly monkey issue #749: Open looked for its stored copy one project at a time, each read a browser storage
// round trip of its own (60-140 ms each in headless Chromium), and twice over when the file's name was taken as the
// project's. With 60 projects kept in this browser an Open stayed "Saving…" for 20-35 s, and a reload in that time
// ran past the monkey's 30 s. The reads are counted here in rounds: every read asked for before the store answers is
// one round, as concurrent IndexedDB reads are.

/** A KeyValue whose reads answer only when `round()` is called, all of the reads waiting then at once. */
function roundsKeyValue() {
  const kv = memoryKeyValue();
  let waiting: (() => void)[] = [];
  const later = <T>(f: () => Promise<T>) => new Promise<T>((resolve, reject) => waiting.push(() => void f().then(resolve, reject)));
  return {
    kv: { ...kv, get: (k: string) => later(() => kv.get(k)), keys: (p: string) => later(() => kv.keys(p)) },
    plain: kv,
    /** Answers every read waiting now; false when none was waiting. */
    round() {
      const now = waiting;
      waiting = [];
      now.forEach((f) => f());
      return now.length > 0;
    },
  };
}
/** How many rounds of reads `work` needs, and what it gave. */
async function rounds<T>(r: ReturnType<typeof roundsKeyValue>, work: Promise<T>): Promise<{ rounds: number; value: T }> {
  let done = false;
  let value!: T;
  void work.then((v) => ((done = true), (value = v)));
  let n = 0;
  for (let idle = 0; !done && idle < 50; ) {
    await settle();
    if (r.round()) n++;
    else idle++;
  }
  assert.ok(done, "the lookup never finished");
  return { rounds: n, value };
}
async function keptProjects(count: number, name: string) {
  const r = roundsKeyValue();
  const plainStore = projectStore(r.plain, []);
  for (let i = 0; i < count; i++) await plainStore.save(`p${String(i).padStart(3, "0")}`, part(name, i + 1));
  return r;
}

test("an Open's lookup among 40 kept projects of its name reads them a batch at a time, not one by one (#749)", async () => {
  // Worked by hand: listing is 2 rounds (the summary keys, then every summary at once); the 40 projects are read
  // STORED_COPY_BATCH (16) at a time, so 16 + 16 + 8 = 3 rounds; 5 in all. One by one it was 2 + 40 = 42.
  const r = await keptProjects(40, "Untitled");
  const { rounds: n, value } = await rounds(r, storedCopy(projectStore(r.kv, []), part("Untitled", 999)));
  assert.equal(value, undefined, "no kept project holds width 999");
  assert.equal(n, 5);
});

test("a batch is 16 projects: 16 kept are read in one round, 17 in two (#749)", async () => {
  // The boundary of the batch: 2 rounds of listing + 1 for 16 projects = 3; 17 need a second batch of 1, so 4.
  for (const [count, expected] of [
    [16, 3],
    [17, 4],
  ] as const) {
    const r = await keptProjects(count, "Untitled");
    const { rounds: n } = await rounds(r, storedCopy(projectStore(r.kv, []), part("Untitled", 999)));
    assert.equal(n, expected, `${count} kept projects`);
  }
});

test("the copy found is still the newest of several, and is found in the batch that holds it (#749)", async () => {
  // Kept p000..p039 with widths 1..40, each saved after the one before, so the list is newest first: p039, p038, …
  // Width 30 is p029 only: the 11th in the list (p039..p029), so in the first batch of 16: 2 + 1 = 3 rounds.
  // Width 3 is p002 only: the 38th in the list, in the third batch: 2 + 3 = 5 rounds.
  const r = await keptProjects(40, "Untitled");
  const store = projectStore(r.kv, []);
  const near = await rounds(r, storedCopy(store, part("Untitled", 30)));
  assert.deepEqual([near.value?.id, near.rounds], ["p029", 3]);
  const far = await rounds(r, storedCopy(store, part("Untitled", 3)));
  assert.deepEqual([far.value?.id, far.rounds], ["p002", 5]);
  // Two copies of width 7: p006 (older) and "copy" saved last, so "copy" is the newest and the one found.
  await projectStore(r.plain, []).save("copy", part("Untitled", 7));
  assert.equal((await rounds(r, storedCopy(store, part("Untitled", 7)))).value?.id, "copy");
});

test("an opened file looked up under two names reads each kept project once, and the first name's copy wins (#749)", async () => {
  // main.ts looks an opened "Untitled" file up as the file's name ("Untitled" too, the monkey's case) and as the
  // name inside it: two lookups of the same 40 projects were 2 × 42 rounds. Now one look: 2 + 3 = 5 rounds.
  const r = await keptProjects(40, "Untitled");
  const store = projectStore(r.kv, []);
  const both = await rounds(r, storedCopyOf(store, [part("Untitled", 999), part("Untitled", 998)]));
  assert.deepEqual([both.value, both.rounds], [undefined, 5]);
  // Priority, worked by hand: "Bracket" width 5 is stored as "new" (saved last, so listed first); "Untitled" width 5
  // is p004. Wanted [Untitled 5, Bracket 5]: the first wanted one has a copy, so p004 at place 0, though "new" is newer.
  await projectStore(r.plain, []).save("new", part("Bracket", 5));
  const first = await rounds(r, storedCopyOf(store, [part("Untitled", 5), part("Bracket", 5)]));
  assert.deepEqual([first.value?.summary.id, first.value?.index], ["p004", 0]);
  // Wanted [Untitled 999, Bracket 5]: no copy of the first, so "new" at place 1.
  const second = await rounds(r, storedCopyOf(store, [part("Untitled", 999), part("Bracket", 5)]));
  assert.deepEqual([second.value?.summary.id, second.value?.index], ["new", 1]);
  // A name match alone is not enough: "Bracket" width 5's text under the wanted "Untitled" is not its copy.
  assert.equal((await rounds(r, storedCopyOf(store, [part("Untitled", 1000)]))).value, undefined);
});
