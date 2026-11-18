// Account sync after an app update, and a design deleted from the account elsewhere (lost-work hunt 2026-11-12, issue
// #628 items 1 and 2). The real sync.ts and designs.ts, the app's reportWords, the real project store and readers;
// only the account service is the package's fake, which answers as the migrations do. Two devices share one account.
// "old" stands for the build that wrote OLD_FILE (Design data version 16): what it hashed and sent was the stored
// text itself, since a build's own files round-trip exactly (test/project-fuzz.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { projectFromJson, projectToJson } from "@fission/core";
import { memoryKeyValue, projectStore, versionedStore } from "@fission/storage";
import { READERS } from "../src/project-fuzz.ts";
import type { AuthClient } from "../../account/src/auth.ts";
import { designsApi } from "../../account/src/designs.ts";
import { designSync, LINKS_PREFIX, readLinks } from "../../account/src/sync.ts";
import { fakeAccount, type FakeAccount } from "../../account/test/fake-designs.ts";
import { memoryStore } from "../../account/test/fake-service.ts";

const g = globalThis as unknown as { addEventListener?: unknown };
g.addEventListener ??= () => {};
const app = (await import(new URL("../../../apps/fission/src/my-designs.ts", import.meta.url).href)) as typeof import("../../../apps/fission/src/my-designs.ts");

const sha = async (t: string) => createHash("sha256").update(t).digest("hex");
/** A project file written by the app when Design's own version was 16 (apps/fission/e2e/saved.spindle, committed then). */
const OLD_FILE = readFileSync(new URL("../../../apps/fission/e2e/saved.spindle", import.meta.url), "utf8");

/**
 * One device: the real project store (in memory), the real sync, wired exactly as apps/fission/src/main.ts wires the
 * host (text = projectToJson(store.open(id)); put = projectFromJson + store.save(key, project, savedAt)).
 * `app.version` "old" stands for the build that wrote OLD_FILE: for it, projectToJson(store.open(id)) IS the stored
 * text (an app's own files round-trip exactly: packages/testing/test/project-fuzz.test.ts line 185), so `text`
 * gives the stored text as it is. "new" is today's code.
 */
function device(acc: FakeAccount, user: string, tag: string) {
  const kv = memoryKeyValue();
  let clock = Date.UTC(2026, 10, 5, 8);
  const now = () => new Date((clock += 1000));
  const store = versionedStore(projectStore(kv, READERS, now), kv, READERS);
  const small = memoryStore();
  small.setItem(LINKS_PREFIX + user, "{}"); // the first-time question was answered "keep them"
  const appNow = { version: "new" as "old" | "new" };
  let n = 0;
  let held = Promise.resolve();
  const sync = designSync({
    api: designsApi(acc.as(user) as AuthClient),
    userId: user,
    who: () => user,
    store: small,
    local: {
      list: () => store.list(),
      text: async (id) => {
        if (appNow.version === "old") return (await kv.get(`project/${id}`)) ?? null;
        try {
          return projectToJson(await store.open(id));
        } catch {
          return null;
        }
      },
      // As main.ts wires them; the old build had neither.
      stored: async (id) => (appNow.version === "old" ? null : ((await kv.get(`project/${id}`)) ?? null)),
      put: async (id, text, name, savedAt) => {
        const project = projectFromJson(text, READERS);
        project.name = name;
        const key = id ?? `${tag}-${++n}`;
        await store.save(key, project, savedAt);
        return key;
      },
    },
    hash: sha,
    asRead: (text) => {
      if (appNow.version === "old") return null;
      try {
        return projectToJson(projectFromJson(text, READERS));
      } catch {
        return null;
      }
    },
    source: () => "design",
    picture: () => null,
    lock: (fn) => {
      const run = held.then(fn);
      held = run.then(() => undefined, () => undefined);
      return run;
    },
  });
  return {
    kv,
    store,
    small,
    sync,
    app: appNow,
    advance: (ms: number) => void (clock += ms),
    /** The old build keeping a file it wrote: the exact text, as its store did. */
    async keepOld(id: string, text: string) {
      const p = JSON.parse(text) as { name: string };
      await kv.set(`project/${id}`, text);
      await kv.set(`summary/${id}`, JSON.stringify({ name: p.name, modified: now().toISOString(), order: ++n }));
    },
    /** An edit with today's build: the box made `width` wide, saved as the autosave saves. */
    async setWidth(id: string, width: number) {
      const p = await store.open(id);
      const d = p.workspaces.design as { timeline: { features: { intent: { parameters: Record<string, number> } }[] } };
      d.timeline.features[0]!.intent.parameters.width = width;
      await store.save(id, p);
    },
    async width(id: string) {
      const p = await store.open(id);
      return (p.workspaces.design as { timeline: { features: { intent: { parameters: Record<string, number> } }[] } }).timeline.features[0]!.intent.parameters.width;
    },
  };
}
const names = (acc: FakeAccount) => acc.rows.map((r) => r.name).sort();
const widthIn = (body: string) => (JSON.parse(body) as { workspaces: { design: { timeline: { features: { intent: { parameters: { width: number } } }[] } } } }).workspaces.design.timeline.features[0]!.intent.parameters.width;

// ---------------------------------------------------------------------------------------------------------------
// D1. An app update that changes the file format makes every device think every project "changed here".

test("control: with one build on both devices, a device that is merely behind sends nothing and makes no copy", async () => {
  const acc = fakeAccount();
  const a = device(acc, "ada", "a");
  const b = device(acc, "ada", "b");
  a.app.version = b.app.version = "old";
  await a.keepOld("p1", OLD_FILE);
  await a.sync.syncAll();
  await b.keepOld("q1", OLD_FILE);
  // B holds the same design, linked at revision 1 (as after opening it from My designs with the old build).
  b.small.setItem(LINKS_PREFIX + "ada", JSON.stringify({ q1: { remote: acc.rows[0]!.id, revision: 1, hash: await sha(OLD_FILE) } }));
  assert.deepEqual(await b.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
  assert.deepEqual(names(acc), ["Untitled"]);
});

test("after the app updates, a device that was only BEHIND (no edit made on it) must not put its old state in the account as a '(copy)'", async () => {
  const acc = fakeAccount();
  const a = device(acc, "ada", "a");
  const b = device(acc, "ada", "b");
  a.app.version = b.app.version = "old";
  // Both devices hold the design at revision 1 (made on A, opened on B), kept by the build that wrote version 16.
  await a.keepOld("p1", OLD_FILE);
  await a.sync.syncAll();
  const remote = acc.rows[0]!.id;
  await b.keepOld("q1", OLD_FILE);
  b.small.setItem(LINKS_PREFIX + "ada", JSON.stringify({ q1: { remote, revision: 1, hash: await sha(OLD_FILE) } }));
  // The app updates on both (Design's version 16 -> 18). A makes a real edit (width 77) and sends it.
  a.app.version = b.app.version = "new";
  await a.setWidth("p1", 77);
  assert.equal((await a.sync.syncAll()).kind, "done");
  assert.equal(acc.rows.length, 1);
  assert.equal(widthIn(acc.rows[0]!.body), 77);
  // B just starts the updated app (startAccounts runs a round at every start). Nobody touched anything on B.
  const report = await b.sync.syncAll();
  assert.deepEqual(names(acc), ["Untitled"], "the account still holds one design: nothing was changed on B");
  assert.deepEqual(report, { kind: "done", sent: 0, copies: [], tooBig: [] });
});

test("a device that merely STARTS the updated app must not take the design's revision, turning another device's real edit into a '(copy)'", async () => {
  const acc = fakeAccount();
  const a = device(acc, "ada", "a");
  const b = device(acc, "ada", "b");
  a.app.version = b.app.version = "old";
  await a.keepOld("p1", OLD_FILE);
  await a.sync.syncAll();
  const remote = acc.rows[0]!.id;
  await b.keepOld("q1", OLD_FILE);
  b.small.setItem(LINKS_PREFIX + "ada", JSON.stringify({ q1: { remote, revision: 1, hash: await sha(OLD_FILE) } }));
  a.app.version = b.app.version = "new";
  // A edits while offline (a train ride): not sent yet.
  await a.setWidth("p1", 77);
  // B is opened at home meanwhile: the updated app starts and runs its round. Nothing is edited on B.
  const rb = await b.sync.syncAll();
  // A comes back online.
  const ra = await a.sync.syncAll();
  assert.deepEqual(acc.rows.map((r) => `${r.name} width ${widthIn(r.body)}`), ["Untitled width 77"], "A's edit is the design; B changed nothing");
});

// ---------------------------------------------------------------------------------------------------------------
// D2. A design deleted from the account on one device: the other device's later work silently stays out of the account.

test("a design deleted from the account elsewhere: the device still changing it is told, every round, and nothing is sent", async () => {
  const acc = fakeAccount();
  const a = device(acc, "ada", "a");
  const b = device(acc, "ada", "b");
  await a.keepOld("p1", OLD_FILE);
  await a.sync.syncAll();
  const remote = acc.rows[0]!.id;
  assert.deepEqual(await b.sync.bring(remote), { kind: "ok", value: "b-1" });
  await designsApi(acc.as("ada") as AuthClient).remove(remote); // tidied away on A
  assert.deepEqual(await b.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] }, "not changed on B: nothing to say");
  for (const w of [60, 70, 80]) {
    await b.setWidth("b-1", w);
    const r = await b.sync.syncAll();
    assert.deepEqual(r, { kind: "done", sent: 0, copies: [], tooBig: [], gone: ["Untitled"] }, `width ${w}`);
    assert.equal(app.reportWords(r), "“Untitled” was deleted from your account, so the changes made here since are kept only in this browser. Use Save to keep a file of it.");
  }
  assert.equal(acc.rows.length, 0, "a delete is never undone by a later change");
  assert.equal(readLinks(b.small, "ada").get("b-1")?.skip, "gone");
});

test("two deleted designs are named together", () => {
  assert.equal(app.reportWords({ kind: "done", sent: 0, copies: [], tooBig: [], gone: ["A", "B"] }), "“A”, “B” were deleted from your account, so the changes made here since are kept only in this browser. Use Save to keep a file of them.");
});

test("after the update the store's text is today's (saved again unchanged) and the account's is the old build's: the same design, no copy", async () => {
  const acc = fakeAccount();
  const a = device(acc, "ada", "a");
  const b = device(acc, "ada", "b");
  a.app.version = b.app.version = "old";
  await a.keepOld("p1", OLD_FILE);
  await a.sync.syncAll();
  const remote = acc.rows[0]!.id;
  await b.keepOld("q1", OLD_FILE);
  // B's link is one revision behind: A (still the old build) saved the same text again, taking revision 2.
  b.small.setItem(LINKS_PREFIX + "ada", JSON.stringify({ q1: { remote, revision: 1, hash: await sha(OLD_FILE) } }));
  await designsApi(acc.as("ada") as AuthClient).save({ id: remote, expected: 1, name: "Untitled", source: "design", body: OLD_FILE, picture: null, savedAt: new Date(Date.UTC(2026, 10, 6)) });
  assert.equal(acc.rows[0]!.revision, 2);
  // B updates, and its store writes the project again as today's readers do, nothing changed in it.
  b.app.version = "new";
  await b.store.save("q1", await b.store.open("q1"));
  assert.notEqual(await b.kv.get("project/q1"), OLD_FILE, "the stored text is today's now");
  const r = await b.sync.syncAll();
  assert.deepEqual(names(acc), ["Untitled"], "no (copy): the account's text, once read, is the text here");
  assert.deepEqual(r.kind === "done" ? r.copies : null, []);
  assert.equal(readLinks(b.small, "ada").get("q1")?.revision, 2);
});

test("a real change made after the update is still sent, once", async () => {
  const acc = fakeAccount();
  const a = device(acc, "ada", "a");
  a.app.version = "old";
  await a.keepOld("p1", OLD_FILE);
  await a.sync.syncAll();
  a.app.version = "new";
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] }, "the update alone sends nothing");
  await a.setWidth("p1", 77);
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
  assert.equal(widthIn(acc.rows[0]!.body), 77);
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
});
