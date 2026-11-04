import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AuthClient } from "../src/auth.ts";
import { designsApi, LIMITS } from "../src/designs.ts";
import { designSync, LINKS_PREFIX, readLinks } from "../src/sync.ts";
import { fakeAccount, type FakeAccount } from "./fake-designs.ts";
import { memoryStore } from "./fake-service.ts";

/** One browser: its projects (id -> name and text), its storage, and a sync for `user`. */
function browser(acc: FakeAccount, user: string, tag: string) {
  const projects = new Map<string, { name: string; text: string; modified: Date }>();
  let n = 0;
  let clock = Date.UTC(2026, 10, 5);
  const store = memoryStore();
  let held = Promise.resolve();
  const sync = designSync({
    api: designsApi(acc.as(user) as AuthClient),
    userId: user,
    store,
    local: {
      list: async () => [...projects.entries()].map(([id, p]) => ({ id, name: p.name, modified: p.modified })),
      text: async (id) => projects.get(id)?.text ?? null,
      put: async (id, text, name, savedAt) => {
        const key = id ?? `${tag}-${++n}`;
        projects.set(key, { name, text, modified: savedAt });
        return key;
      },
    },
    hash: async (t) => createHash("sha256").update(t).digest("hex"),
    source: (_id, text) => (text.includes("slice") ? "slice" : "design"),
    picture: () => null,
    // One sync at a time, as navigator.locks gives in a browser.
    lock: (fn) => {
      const run = held.then(fn);
      held = run.then(() => undefined, () => undefined);
      return run;
    },
  });
  return {
    projects,
    store,
    sync,
    edit(id: string, text: string, name = projects.get(id)?.name ?? id) {
      projects.set(id, { name, text, modified: new Date((clock += 1000)) });
    },
  };
}

const bodies = (acc: FakeAccount) => acc.rows.map((r) => `${r.name}=${r.body}`).sort();

test("a project is sent once, again only when its text changes, and the link follows it", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  a.edit("p1", "box v1", "Box");
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] }, "unchanged: nothing sent");
  a.edit("p1", "box v1"); // saved again with the same text (a new save time, say): still nothing to send
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
  a.edit("p1", "box v2");
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
  assert.deepEqual(bodies(acc), ["Box=box v2"]);
  assert.equal(acc.rows[0]!.revision, 2);
  assert.equal(a.sync.remoteOf("p1"), acc.rows[0]!.id);
});

test("two browsers: the other's change comes across, and changes on both keep both", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  const b = browser(acc, "ada", "b");
  a.edit("p1", "v1", "Bracket");
  await a.sync.syncAll();
  const remote = acc.rows[0]!.id;
  // B opens it from the account: a new project in B, linked to the same design.
  const opened = await b.sync.bring(remote);
  assert.deepEqual(opened, { kind: "ok", value: "b-1" });
  assert.equal(b.projects.get("b-1")!.text, "v1");
  // B changes it and sends it; A, unchanged since, brings B's change in over its own project.
  b.edit("b-1", "v2 from B");
  await b.sync.syncAll();
  assert.deepEqual(await a.sync.bring(remote), { kind: "ok", value: "p1" });
  assert.equal(a.projects.get("p1")!.text, "v2 from B");
  // Both change it before either sends. B sends first; A's send finds it changed and keeps A's as a copy.
  a.edit("p1", "v3 from A");
  b.edit("b-1", "v3 from B");
  await b.sync.syncAll();
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: ["Bracket"], tooBig: [] });
  assert.deepEqual(bodies(acc), ["Bracket (copy)=v3 from A", "Bracket=v3 from B"]);
  // From now on A's project follows its copy, so it never fights B's again.
  a.edit("p1", "v4 from A");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Bracket (copy)=v4 from A", "Bracket=v3 from B"]);
});

test("bringing a design never overwrites a change made here", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  const b = browser(acc, "ada", "b");
  a.edit("p1", "v1", "Lid");
  await a.sync.syncAll();
  const remote = acc.rows[0]!.id;
  await b.sync.bring(remote);
  b.edit("b-1", "v2 from B");
  await b.sync.syncAll();
  a.edit("p1", "v2 from A"); // not sent yet
  const r = await a.sync.bring(remote);
  assert.deepEqual(r, { kind: "ok", value: "a-1" }, "B's version opens as a new project");
  assert.equal(a.projects.get("p1")!.text, "v2 from A", "A's own change is untouched");
  assert.equal(a.projects.get("a-1")!.text, "v2 from B");
  // A's own change then goes up as its own design, not over B's.
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Lid=v2 from A", "Lid=v2 from B"]);
});

test("a design deleted from the account is never sent back; the project here stays", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  a.edit("p1", "v1", "Gear");
  await a.sync.syncAll();
  await designsApi(acc.as("ada") as AuthClient).remove(acc.rows[0]!.id); // deleted on another device
  a.edit("p1", "v2");
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
  assert.deepEqual(acc.rows, []);
  a.edit("p1", "v3");
  await a.sync.syncAll();
  assert.deepEqual(acc.rows, [], "still not sent after more changes");
  assert.equal(a.projects.get("p1")!.text, "v3");
  assert.equal(a.sync.remoteOf("p1"), null);
});

test("deleting a project here never deletes it from the account", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  a.edit("p1", "v1", "Hook");
  await a.sync.syncAll();
  a.projects.delete("p1");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Hook=v1"]);
  assert.equal(readLinks(a.store, "ada").size, 0, "the link to the gone project is dropped");
});

test("too big waits until it changes; a full account stops the round and says so", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  // 1.1 x the 5 MiB limit is too big; it is not tried again until its text changes.
  a.edit("big", "x".repeat(Math.round(LIMITS.maxDesignBytes * 1.1)), "Big");
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: ["Big"] });
  const calls = acc.calls.length;
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
  assert.equal(acc.calls.length, calls, "not sent again unchanged");
  // Made smaller (0.9 x the limit), it goes.
  a.edit("big", "x".repeat(Math.round(LIMITS.maxDesignBytes * 0.9)));
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
  // Four of 4.5 MiB = 18 MiB fit in 20 MiB; a fifth of 4 MiB (22 MiB) doesn't.
  for (const id of ["f1", "f2", "f3"]) a.edit(id, "y".repeat(LIMITS.maxDesignBytes * 0.9), id);
  await a.sync.syncAll();
  a.edit("f4", "z".repeat(4 * 1024 * 1024), "F4");
  assert.deepEqual(await a.sync.syncAll(), { kind: "full", sent: 0 });
  assert.equal(acc.rows.length, 4);
});

test("too big on an existing design, then smaller again, goes back over that design, not a new one", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  a.edit("p1", "small", "Frame");
  await a.sync.syncAll();
  a.edit("p1", "x".repeat(LIMITS.maxDesignBytes + 1));
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: ["Frame"] });
  a.edit("p1", "small again");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Frame=small again"]);
  assert.equal(acc.rows[0]!.revision, 2);
});

test("turned off, nothing is sent; offline, nothing is lost and the next round sends it", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  acc.keep.set("ada", false);
  a.edit("p1", "v1", "Pin");
  assert.deepEqual(await a.sync.syncAll(), { kind: "off" });
  assert.deepEqual(acc.rows, []);
  acc.keep.set("ada", true);
  acc.mode = "down";
  assert.deepEqual(await a.sync.syncAll(), { kind: "failed", reason: "offline" });
  acc.mode = "up";
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
});

test("two tabs syncing at once send each project once", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  a.edit("p1", "v1", "Cap");
  a.edit("p2", "v1", "Cup");
  await Promise.all([a.sync.syncAll(), a.sync.syncAll(), a.sync.syncAll()]);
  assert.deepEqual(bodies(acc), ["Cap=v1", "Cup=v1"]);
});

test("each person's links are their own, and damaged links lose nothing", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", "a");
  a.edit("p1", "v1", "Peg");
  await a.sync.syncAll();
  assert.ok(a.store.getItem(LINKS_PREFIX + "ada"));
  assert.equal(readLinks(a.store, "bo").size, 0);
  for (const bad of ["{", "[]", '"x"', '{"p1":{"remote":5}}', '{"p1":{"remote":"r","revision":0,"hash":"h"}}']) {
    a.store.setItem(LINKS_PREFIX + "ada", bad);
    assert.equal(readLinks(a.store, "ada").size, 0, bad);
  }
  // With the link damaged, the project is sent as a new design: a duplicate at worst, never a lost change.
  a.edit("p1", "v2");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Peg=v1", "Peg=v2"]);
});

/**
 * Seeded runs: two browsers of one person and one of another, making, changing, deleting, sending and bringing
 * designs at random, with the network dropping now and then. After every run, once each browser has sent what it
 * can: every project's latest text is in the account (unless deleted there), nobody sees anyone else's designs,
 * and nothing in the account was overwritten by a browser that hadn't seen its latest revision.
 */
test("seeded random sessions against a plain model", async () => {
  for (let seed = 1; seed <= 60; seed++) {
    let s = seed * 7919;
    const rand = (n: number) => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s % n;
    };
    const acc = fakeAccount(seed);
    const browsers = [browser(acc, "ada", "a"), browser(acc, "ada", "b"), browser(acc, "bo", "c")];
    const users = ["ada", "ada", "bo"];
    const deletedRemote = new Set<string>();
    // The model: every revision ever written to the account, by design id, and who could have seen it.
    const seenRevisions = new Map<string, number>();
    let k = 0;
    for (let step = 0; step < 40; step++) {
      const i = rand(3);
      const br = browsers[i]!;
      const ids = [...br.projects.keys()];
      const op = rand(10);
      acc.mode = rand(8) === 0 ? "down" : "up";
      if (op <= 2 || ids.length === 0) br.edit(`n${seed}-${++k}`, `text ${++k}`, `D${k}`);
      else if (op <= 5) br.edit(ids[rand(ids.length)]!, `text ${++k}`);
      else if (op === 6) br.projects.delete(ids[rand(ids.length)]!);
      else if (op === 7) await br.sync.syncAll();
      else if (op === 8) {
        const mine = acc.rows.filter((r) => r.user === users[i]);
        if (mine.length) await br.sync.bring(mine[rand(mine.length)]!.id);
      } else {
        const mine = acc.rows.filter((r) => r.user === users[i]);
        if (mine.length && acc.mode === "up") {
          const gone = mine[rand(mine.length)]!.id;
          deletedRemote.add(gone);
          await designsApi(acc.as(users[i]!) as AuthClient).remove(gone);
        }
      }
      for (const r of acc.rows) {
        const before = seenRevisions.get(r.id) ?? 0;
        assert.ok(r.revision >= before, `seed ${seed}: a design's revision went back`);
        seenRevisions.set(r.id, r.revision);
      }
    }
    acc.mode = "up";
    for (const br of browsers) assert.equal((await br.sync.syncAll()).kind, "done", `seed ${seed}`);
    for (const [i, br] of browsers.entries()) {
      for (const [id, p] of br.projects) {
        const remote = br.sync.remoteOf(id);
        if (remote === null) {
          // Only a project whose design was deleted from the account is not kept there.
          const l = readLinks(br.store, users[i]!).get(id);
          assert.equal(l?.skip, "gone", `seed ${seed}: project ${id} is in no design and wasn't deleted`);
          continue;
        }
        const row = acc.rows.find((r) => r.id === remote);
        assert.ok(row, `seed ${seed}: project ${id}'s design is missing`);
        assert.equal(row.user, users[i], `seed ${seed}: kept in someone else's account`);
        // Its latest text is there, unless another browser of the same person sent a newer one over it after this one
        // brought it in unchanged; then this browser's text is that design's text from before, never lost work.
        if (row.body !== p.text) {
          const other = browsers.find((o, j) => j !== i && users[j] === users[i] && [...o.projects.values()].some((q) => q.text === row.body));
          assert.ok(other, `seed ${seed}: project ${id} (${p.text}) lost to "${row.body}"`);
        }
      }
    }
    for (const r of acc.rows) assert.ok(!deletedRemote.has(r.id), `seed ${seed}: a deleted design came back`);
  }
});
