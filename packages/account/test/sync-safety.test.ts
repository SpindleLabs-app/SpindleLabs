// My designs sending rounds when things go wrong (bug hunt 2026-11-11, issue items 1-5 and 8): another person signs
// in during a round, this browser can't keep the links, an answer is lost, the account is full, the service refuses
// one design, a project can't be read for a moment. Each test failed before its fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AuthClient, PersonReply, SmallStore } from "../src/auth.ts";
import { cleanName, designsApi, LIMITS, MAX_NAME } from "../src/designs.ts";
import { designSync, LINKS_PREFIX, readLinks } from "../src/sync.ts";
import { fakeAccount, type FakeAccount } from "./fake-designs.ts";
import { memoryStore } from "./fake-service.ts";

type Client = Pick<AuthClient, "asPerson" | "state">;
type Projects = Map<string, { name: string; text: string; modified: Date; problem?: string }>;

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** One browser, listing newest first as store.list does, with a pluggable client, store, person and projects. */
function browser(acc: FakeAccount, user: string, opts: { client?: Client; store?: SmallStore; projects?: Projects; who?: () => string | null } = {}) {
  const projects: Projects = opts.projects ?? new Map();
  let n = 0;
  let clock = Date.UTC(2026, 10, 5);
  const store = opts.store ?? memoryStore();
  if (store.getItem(LINKS_PREFIX + user) === null) store.setItem(LINKS_PREFIX + user, "{}"); // first-time question answered "keep"
  let held = Promise.resolve();
  const client = opts.client ?? acc.as(user);
  const sync = designSync({
    api: designsApi(client as AuthClient),
    userId: user,
    who: opts.who ?? (() => {
      const s = client.state();
      return s.kind === "signed-in" ? s.user.id : null;
    }),
    store,
    local: {
      list: async () =>
        [...projects.entries()]
          .map(([id, p]) => ({ id, name: p.name, modified: p.modified, ...(p.problem ? { problem: p.problem } : {}) }))
          .sort((a, b) => b.modified.getTime() - a.modified.getTime()),
      text: async (id) => projects.get(id)?.text ?? null,
      put: async (id, text, name, savedAt) => {
        const key = id ?? `${user}-${++n}`;
        projects.set(key, { name, text, modified: savedAt });
        return key;
      },
    },
    hash: async (t) => sha(t),
    source: () => "design",
    picture: () => null,
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

const bodies = (acc: FakeAccount, user = "ada") => acc.rows.filter((r) => r.user === user).map((r) => `${r.name}=${r.body}`).sort();
const saves = (acc: FakeAccount) => acc.calls.filter((c) => c === "POST rpc/save_design").length;

/** A store whose writes fail while `full.on` (localStorage over its quota: the unsaved-changes journal lives there too). */
function fillable() {
  const inner = memoryStore();
  const full = { on: false };
  const store: SmallStore = {
    getItem: (k) => inner.getItem(k),
    removeItem: (k) => inner.removeItem(k),
    setItem: (k, v) => {
      if (full.on) throw new DOMException("quota", "QuotaExceededError");
      inner.setItem(k, v);
    },
  };
  return { store, full };
}

// ---- 1. Another person signs in (in another tab) while a round runs.

test("someone else signing in during a round stops it: nothing of Ada's goes to Bo, and none of Ada's links is spoilt", async () => {
  const acc = fakeAccount();
  let who = "ada";
  let n = 0;
  // asPerson reads the session from localStorage on every call, so a sign-in in another tab changes who it acts for.
  const client: Client = {
    state: () => acc.as(who).state(),
    async asPerson(method, path, body) {
      const r = await acc.as(who).asPerson(method, path, body);
      if (path === "rpc/save_design" && ++n === 1) who = "bo"; // meanwhile, in tab 2: sign out, sign in as Bo
      return r;
    },
  };
  const a0 = browser(acc, "ada");
  a0.edit("p1", "v1", "Ada's lid");
  a0.edit("p2", "v1", "Ada's box");
  await a0.sync.syncAll();
  const a = browser(acc, "ada", { client, store: a0.store, projects: a0.projects });
  a.edit("p3", "secret", "Ada's new part");
  a.edit("p1", "v2");
  a.edit("p2", "v2"); // newest: sent first, as Ada, before the switch
  n = 0;
  assert.deepEqual(await a.sync.syncAll(), { kind: "signed-out" });
  assert.deepEqual(bodies(acc, "bo"), [], "Bo's account got none of Ada's projects");
  const links = readLinks(a.store, "ada");
  assert.ok([...links.values()].every((l) => l.skip === undefined), "no link marked deleted or anything else");
  assert.equal(links.get("p2")?.revision, 2, "the save made as Ada is recorded");
  // Ada signs back in: her round sends the rest to her own account, once.
  who = "ada";
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc, "ada"), ["Ada's box=v2", "Ada's lid=v2", "Ada's new part=secret"]);
  assert.deepEqual(bodies(acc, "bo"), []);
});

test("a round started for Ada after Bo signed in sends nothing at all", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", { client: acc.as("bo") });
  a.edit("p1", "mine", "Ada's part");
  assert.deepEqual(await a.sync.syncAll(), { kind: "signed-out" });
  assert.deepEqual(acc.calls, [], "not one request");
});

test("bringing a design when someone else signed in meanwhile puts nothing into Ada's projects", async () => {
  const acc = fakeAccount();
  const bo = browser(acc, "bo");
  bo.edit("q1", "bo's secret", "Bo's part");
  await bo.sync.syncAll();
  let who = "ada";
  const client: Client = {
    state: () => acc.as(who).state(),
    async asPerson(method, path, body) {
      who = "bo"; // the switch happens while the request is on its way
      return acc.as(who).asPerson(method, path, body);
    },
  };
  const a = browser(acc, "ada", { client });
  assert.deepEqual(await a.sync.bring(acc.rows[0]!.id), { kind: "signed-out" });
  assert.equal(a.projects.size, 0);
  assert.equal(readLinks(a.store, "ada").size, 0);
});

// ---- 2. This browser can't keep the links.

test("with storage full, a new project is never sent (so never sent again and again), and goes once storage works", async () => {
  const acc = fakeAccount();
  const { store, full } = fillable();
  const a = browser(acc, "ada", { store });
  full.on = true;
  a.edit("p1", "v1", "Bracket");
  for (let i = 0; i < 3; i++) assert.deepEqual(await a.sync.syncAll(), { kind: "failed", reason: "storage" });
  assert.deepEqual(bodies(acc), []);
  assert.equal(saves(acc), 0, "nothing sent while its link couldn't be kept");
  full.on = false;
  await a.sync.syncAll();
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Bracket=v1"]);
});

test("with storage full, an edit to a design already there makes no '(copy)' however many rounds run", async () => {
  const acc = fakeAccount();
  const { store, full } = fillable();
  const a = browser(acc, "ada", { store });
  a.edit("p1", "v1", "Bracket");
  await a.sync.syncAll();
  full.on = true;
  a.edit("p1", "v2");
  for (let i = 0; i < 3; i++) assert.deepEqual(await a.sync.syncAll(), { kind: "failed", reason: "storage" });
  assert.deepEqual(bodies(acc), ["Bracket=v2"], "the edit is there once, no copies: nobody else changed it");
  full.on = false;
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] }, "recognised as this browser's own save");
  assert.equal(readLinks(a.store, "ada").get("p1")?.revision, 2);
});

test("a round stops at the first link it can't keep: the projects after it aren't sent", async () => {
  const acc = fakeAccount();
  const { store, full } = fillable();
  const a = browser(acc, "ada", { store });
  a.edit("p1", "v1", "One");
  a.edit("p2", "v1", "Two");
  await a.sync.syncAll();
  a.edit("p1", "v2");
  a.edit("p2", "v2"); // newest: first
  let n = 0;
  const real = store.setItem;
  store.setItem = (k, v) => {
    if (k.startsWith(LINKS_PREFIX) && ++n >= 1) full.on = true;
    real(k, v);
  };
  // The first write after p2's save fails: the round stops there, so p1 isn't sent.
  assert.deepEqual(await a.sync.syncAll(), { kind: "failed", reason: "storage" });
  assert.deepEqual(bodies(acc), ["One=v1", "Two=v2"]);
});

// ---- 3. An answer lost on the way back (a big upload timing out after the account kept it).

function losingClient(acc: FakeAccount, user: string, lose: Set<number>): Client {
  const real = acc.as(user);
  let n = 0;
  return {
    state: real.state,
    async asPerson(method, path, body): Promise<PersonReply> {
      const r = await real.asPerson(method, path, body);
      if (path === "rpc/save_design" && lose.has(++n)) return { kind: "failed", reason: "offline" };
      return r;
    },
  };
}

test("a save the account kept but whose answer was lost isn't taken for another device's change", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", { client: losingClient(acc, "ada", new Set([2])) });
  a.edit("p1", "v1", "Bracket");
  await a.sync.syncAll();
  a.edit("p1", "v2");
  assert.deepEqual(await a.sync.syncAll(), { kind: "failed", reason: "offline" });
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] }, "no 'changed on another device too'");
  assert.deepEqual(bodies(acc), ["Bracket=v2"]);
  // Revision: 1 when added, 2 for the lost save; the link now names 2, so the next edit goes over it.
  a.edit("p1", "v3");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Bracket=v3"]);
  assert.equal(acc.rows[0]!.revision, 3);
});

test("another device's real change is still kept beside this browser's as a '(copy)'", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada");
  const b = browser(acc, "ada");
  a.edit("p1", "v1", "Bracket");
  await a.sync.syncAll();
  await b.sync.bring(acc.rows[0]!.id);
  b.edit("ada-1", "v2 from B");
  await b.sync.syncAll();
  a.edit("p1", "v2 from A");
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: ["Bracket"], tooBig: [] });
  assert.deepEqual(bodies(acc), ["Bracket (copy)=v2 from A", "Bracket=v2 from B"]);
});

test("a new design whose answer was lost isn't added twice", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", { client: losingClient(acc, "ada", new Set([1])) });
  a.edit("p1", "v1", "Bracket");
  assert.deepEqual(await a.sync.syncAll(), { kind: "failed", reason: "offline" });
  assert.equal(a.sync.remoteOf("p1"), null, "not known to be in the account yet");
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
  assert.deepEqual(bodies(acc), ["Bracket=v1"]);
  assert.equal(a.sync.remoteOf("p1"), acc.rows[0]!.id, "found and linked");
  a.edit("p1", "v2");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Bracket=v2"], "the next edit goes over it");
});

test("a new design whose request never arrived is still sent next round (looking for it never loses it)", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada");
  a.edit("p1", "v1", "Bracket");
  acc.mode = "down";
  assert.deepEqual(await a.sync.syncAll(), { kind: "failed", reason: "offline" });
  acc.mode = "up";
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
  assert.deepEqual(bodies(acc), ["Bracket=v1"]);
});

test("a lost new design changed here before the next round is found and the change goes over it", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", { client: losingClient(acc, "ada", new Set([1])) });
  a.edit("p1", "v1", "Bracket");
  await a.sync.syncAll();
  a.edit("p1", "v2");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Bracket=v2"]);
});

// ---- 4. A full account.

test("a full account doesn't stop edits to designs already there; it is said at the end, and the new one goes once there's room", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada");
  for (let i = 0; i < LIMITS.maxDesigns; i++) a.edit(`d${i}`, `t${i}`, `D${i}`);
  await a.sync.syncAll();
  assert.equal(acc.rows.length, LIMITS.maxDesigns);
  a.edit("d0", "t0 edited"); // fits: replaces its own design
  a.edit("new", "new part", "New"); // the 201st doesn't fit; newest, so listed first
  assert.deepEqual(await a.sync.syncAll(), { kind: "full", sent: 1 });
  assert.equal(acc.rows.find((x) => x.name === "D0")?.body, "t0 edited");
  assert.equal(readLinks(a.store, "ada").has("new"), false, "not marked: tried again next round");
  await designsApi(acc.as("ada") as AuthClient).remove(acc.rows.find((x) => x.name === "D5")!.id);
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
  assert.equal(acc.rows.filter((x) => x.name === "New").length, 1);
});

// ---- 5. One design the service refuses; names it can't take.

/** A database that refuses (400) any save whose text holds "\u0000", as PostgreSQL text does. */
function refusing(acc: FakeAccount, user: string): Client {
  const real = acc.as(user);
  return {
    state: real.state,
    async asPerson(method, path, body) {
      if (path === "rpc/save_design" && String((body as { p_body: string }).p_body).includes("\u0000")) return { kind: "failed", reason: "rejected" };
      return real.asPerson(method, path, body);
    },
  };
}

test("one design the service refuses is marked and passed over: every other project is still sent", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", { client: refusing(acc, "ada") });
  a.edit("ok1", "fine", "Fine part");
  a.edit("bad", "nul \u0000 inside", "Odd file"); // newest, so first
  a.edit("ok2", "also fine", "Other part");
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 2, copies: [], tooBig: [], refused: ["Odd file"] });
  assert.deepEqual(bodies(acc), ["Fine part=fine", "Other part=also fine"]);
  assert.equal(readLinks(a.store, "ada").get("bad")?.skip, "refused");
  const before = saves(acc);
  assert.deepEqual(await a.sync.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
  assert.equal(saves(acc), before, "not tried again unchanged");
  a.edit("bad", "now clean");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Fine part=fine", "Odd file=now clean", "Other part=also fine"]);
});

test("a refused edit to a design already there goes back over that design once it changes", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada", { client: refusing(acc, "ada") });
  a.edit("p1", "v1", "Frame");
  await a.sync.syncAll();
  a.edit("p1", "v2 \u0000");
  await a.sync.syncAll();
  a.edit("p1", "v3");
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Frame=v3"]);
  assert.equal(acc.rows[0]!.revision, 2);
});

test("a service that refuses every request (not ready for designs yet) stops the round without marking anything", async () => {
  const acc = fakeAccount();
  let ready = false;
  const real = acc.as("ada");
  const client: Client = {
    state: real.state,
    async asPerson(method, path, body) {
      return ready || !path.startsWith("rpc/") ? real.asPerson(method, path, body) : { kind: "failed", reason: "rejected" };
    },
  };
  const a = browser(acc, "ada", { client });
  a.edit("p1", "v1", "Hinge");
  a.edit("p2", "v1", "Pin");
  assert.deepEqual(await a.sync.syncAll(), { kind: "failed", reason: "rejected" });
  assert.equal(readLinks(a.store, "ada").size, 0, "nothing marked refused");
  ready = true;
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), ["Hinge=v1", "Pin=v1"]);
});

test("names: NUL characters go, a lone half of a character becomes U+FFFD, and the cut never splits a character", () => {
  // 199 letters, then 😀 (one character, two UTF-16 units: 😀), then "b": 201 characters, 202 units.
  // Cut to 200 characters: the 199 letters and the whole emoji. Cutting 200 units would have kept only \ud83d.
  const long = "a".repeat(199) + "😀" + "b";
  assert.equal(cleanName(long), "a".repeat(199) + "😀");
  assert.equal(JSON.stringify(cleanName(long)).includes("\\ud83d"), false, "no lone half in the JSON sent");
  assert.equal(cleanName("ab\u0000c\u0000"), "abc");
  assert.equal(cleanName("\ud83dx"), "�x", "a lone high half");
  assert.equal(cleanName("x\ude00"), "x�", "a lone low half");
  // The limit itself: exactly MAX_NAME characters stay whole, one more is cut.
  const at = "é".repeat(MAX_NAME);
  assert.equal(cleanName(at), at);
  assert.equal(cleanName(at + "z"), at);
  assert.equal([...cleanName("😀".repeat(MAX_NAME + 5))].length, MAX_NAME);
});

test("the name sent to the account is the cleaned one", async () => {
  const acc = fakeAccount();
  const sent: string[] = [];
  const real = acc.as("ada");
  const client: Client = {
    state: real.state,
    async asPerson(method, path, body) {
      if (path === "rpc/save_design") sent.push((body as { p_name: string }).p_name);
      return real.asPerson(method, path, body);
    },
  };
  const a = browser(acc, "ada", { client });
  a.edit("p1", "v1", "from a file\u0000" + "x".repeat(300));
  await a.sync.syncAll();
  assert.equal(sent.length, 1);
  assert.equal(sent[0], "from a file" + "x".repeat(MAX_NAME - "from a file".length));
});

// ---- 8. A project that can't be read for a moment.

test("a project unreadable for one round keeps its 'deleted from the account' and 'left out' marks", async () => {
  const acc = fakeAccount();
  const a = browser(acc, "ada");
  a.edit("p1", "v1", "Gear");
  await a.sync.syncAll();
  await designsApi(acc.as("ada") as AuthClient).remove(acc.rows[0]!.id); // deleted on another device
  a.edit("p1", "v2");
  await a.sync.syncAll();
  const links = readLinks(a.store, "ada");
  links.set("p2", { remote: "", revision: 1, hash: sha("sibling"), skip: "left" }); // someone else's on this computer
  a.store.setItem(LINKS_PREFIX + "ada", JSON.stringify(Object.fromEntries(links)));
  a.projects.set("p2", { name: "Sibling's", text: "sibling", modified: new Date(Date.UTC(2026, 10, 4)) });
  for (const id of ["p1", "p2"]) a.projects.set(id, { ...a.projects.get(id)!, problem: "summary unreadable" });
  await a.sync.syncAll();
  for (const id of ["p1", "p2"]) a.edit(id, `${id} changed`); // readable again (edit drops the problem)
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), [], "the deleted design isn't sent back and the left-out project isn't sent");
});

test("a project unreadable when the person chose to leave the projects here out is left out too", async () => {
  const acc = fakeAccount();
  const store = memoryStore(); // first time: no links yet
  const projects: Projects = new Map([["old", { name: "Theirs", text: "not mine", modified: new Date(Date.UTC(2026, 10, 1)), problem: "unreadable" }]]);
  const a = browser(acc, "ada", { store, projects });
  store.removeItem(LINKS_PREFIX + "ada");
  assert.equal(a.sync.firstTime(), true);
  assert.equal(await a.sync.firstChoice(false), true);
  projects.set("old", { name: "Theirs", text: "not mine", modified: new Date(Date.UTC(2026, 10, 1)) });
  await a.sync.syncAll();
  assert.deepEqual(bodies(acc), []);
  assert.equal(a.sync.leftCount(), 1);
});
