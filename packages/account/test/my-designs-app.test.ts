// The app side of My designs (apps/fission/src/my-designs.ts), bug hunt 2026-11-11 issue items 6, 7 and 9: a round that
// failed because the account service was down is tried again by itself, later each time; sync failures have their own
// words, never the sign-in ones; and a browser without navigator.locks still lets only one tab send at a time.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AuthClient, PersonReply } from "../src/auth.ts";
import { designsApi } from "../src/designs.ts";
import { designSync, LINKS_PREFIX } from "../src/sync.ts";
import { fakeAccount } from "./fake-designs.ts";
import { memoryStore } from "./fake-service.ts";

const g = globalThis as unknown as { addEventListener?: unknown };
g.addEventListener ??= () => {};
const app = await import("../../../apps/fission/src/my-designs.ts");
const { startDesigns, reportWords, REQUEST_WORDS, RETRY_FIRST_MS, RETRY_MAX_MS, storageLock, LEASE_KEY, LEASE_MS } = app;

type Projects = Map<string, { name: string; text: string; modified: Date }>;
function host(projects: Projects) {
  return {
    list: async () => [...projects].map(([id, p]) => ({ id, name: p.name, modified: p.modified })),
    text: async (id: string) => projects.get(id)?.text ?? null,
    put: async () => "x",
    openId: () => null,
    open: async () => {},
    workspace: () => "design",
    picture: () => null,
  };
}
/** A one-tab navigator.locks for the timed tests, so only the retry timers run on the mocked clock (the lease lock has its own tests). */
function oneTabLocks(): () => void {
  const nav = globalThis.navigator as unknown as { locks?: unknown };
  Object.defineProperty(nav, "locks", { value: { request: (_name: string, fn: () => Promise<unknown>) => fn() }, configurable: true });
  return () => {
    delete nav.locks;
  };
}
const settle = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

// ---- 6. Trying again by itself.

/** Waits (on the real event loop, mocked clock still) until `cond` holds; hashing runs on a thread, so it can take a while. */
async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 20_000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(cond(), what);
  await settle(50); // the rest of that round
}

/**
 * A client counting the rounds that reach the account: each round's first request (a save, or looking for an add
 * whose answer was lost) is one entry, at the mocked time it was made. Fails with `reason` while `down.on`.
 */
function countingClient(down: { on: boolean }, reason: "unavailable" | "offline", acc = fakeAccount()) {
  const real = acc.as("ada");
  const rounds: number[] = [];
  const clock = { t: 0 };
  let lastRound = -1;
  const client = {
    state: real.state,
    async asPerson(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<PersonReply> {
      if (clock.t !== lastRound) rounds.push((lastRound = clock.t));
      if (down.on) return { kind: "failed", reason };
      return real.asPerson(method, path, body);
    },
  } as unknown as AuthClient;
  /** Moves the clock `gap` on; checks no round starts before it, and that one starts at it. */
  async function next(gap: number) {
    const n = rounds.length;
    mock.timers.tick(gap - 1);
    clock.t += gap - 1;
    await settle(200);
    assert.equal(rounds.length, n, `no round before ${gap} ms`);
    mock.timers.tick(1);
    clock.t += 1;
    await until(() => rounds.length === n + 1, `a round ${gap} ms later`);
  }
  return { acc, client, rounds, clock, next };
}

test("after the service was down, the change is sent by itself, the waits doubling from 30 s", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const unlock = oneTabLocks();
  try {
    const down = { on: true };
    const { acc, client, rounds, next } = countingClient(down, "unavailable");
    const store = memoryStore();
    store.setItem(LINKS_PREFIX + "ada", "{}");
    const d = startDesigns(client, host(new Map([["p1", { name: "Lid", text: "v1", modified: new Date(Date.UTC(2026, 10, 5)) }]])), store);
    d.saved();
    // Sent 4 s after the save (SEND_AFTER_MS); then tried again 30 s, 60 s and 120 s after each failure: 4, 34, 94, 214 s.
    await next(4000);
    await next(30_000);
    await next(60_000);
    await next(120_000);
    assert.deepEqual(rounds, [4000, 34_000, 94_000, 214_000]);
    assert.equal(acc.rows.length, 0);
    assert.match(reportWords({ kind: "failed", reason: "unavailable" }), /by themselves/);
    down.on = false; // back; the person has stopped editing, and the network itself was fine (no "online" event)
    await next(240_000); // the next wait: 240 s, so at 454 s
    assert.equal(acc.rows.length, 1, "sent by itself");
    assert.deepEqual(rounds.slice(4), [454_000]);
    mock.timers.tick(3_600_000);
    await settle(200);
    assert.equal(rounds.length, 5, "no more rounds once it worked");
  } finally {
    unlock();
    mock.timers.reset();
  }
});

test("the wait between tries stops growing at 10 minutes", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const unlock = oneTabLocks();
  try {
    const { client, rounds, next } = countingClient({ on: true }, "offline");
    const store = memoryStore();
    store.setItem(LINKS_PREFIX + "ada", "{}");
    const d = startDesigns(client, host(new Map([["p1", { name: "Lid", text: "v1", modified: new Date(Date.UTC(2026, 10, 5)) }]])), store);
    await d.sendNow();
    assert.equal(rounds.length, 1);
    // 30, 60, 120, 240, 480 s, then 600 s (not 960): RETRY_FIRST_MS doubling, bounded by RETRY_MAX_MS.
    assert.equal(RETRY_FIRST_MS, 30_000);
    assert.equal(RETRY_MAX_MS, 600_000);
    for (const gap of [30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000]) await next(gap);
    assert.equal(rounds.length, 8);
  } finally {
    unlock();
    mock.timers.reset();
  }
});

test("an account service not ready for designs yet (every request refused) is tried again, and sent once it is", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const unlock = oneTabLocks();
  try {
    const acc = fakeAccount();
    let ready = false;
    const real = acc.as("ada");
    const client = {
      state: real.state,
      async asPerson(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<PersonReply> {
        if (!ready && path.startsWith("rpc/")) return { kind: "failed", reason: "rejected" }; // 404: no such function yet
        return real.asPerson(method, path, body);
      },
    } as unknown as AuthClient;
    const store = memoryStore();
    store.setItem(LINKS_PREFIX + "ada", "{}");
    const d = startDesigns(client, host(new Map([["p1", { name: "Lid", text: "v1", modified: new Date(Date.UTC(2026, 10, 5)) }]])), store);
    await d.sendNow();
    ready = true;
    for (let m = 0; m < 30; m++) {
      mock.timers.tick(60_000);
      await settle(100);
    }
    assert.equal(acc.rows.length, 1);
  } finally {
    unlock();
    mock.timers.reset();
  }
});

// ---- 7. Their own words.

test("a sync failure is never described as a sign-in problem, and each one has its own sentence", () => {
  const reasons = ["offline", "unavailable", "rejected", "malformed", "storage"] as const;
  const round = reasons.map((reason) => reportWords({ kind: "failed", reason }));
  const request = reasons.map((reason) => REQUEST_WORDS[reason]);
  for (const w of [...round, ...request]) {
    assert.doesNotMatch(w, /sign-in|sign in/i, w);
    assert.match(w, /^[A-Z].*\.$/);
  }
  assert.equal(new Set(round).size, reasons.length);
  assert.equal(new Set(request).size, reasons.length);
  assert.match(REQUEST_WORDS.storage, /storage is full/);
  assert.match(reportWords({ kind: "done", sent: 1, copies: [], tooBig: [], refused: ["Odd file"] }), /refused “Odd file”/);
});

// ---- 9. One tab at a time without navigator.locks.

/** Two tabs of one browser sharing storage and projects, each with its own sync and the storage lock. */
function tabs(count: number, lockFor: (i: number) => <T>(fn: () => Promise<T>) => Promise<T>) {
  const acc = fakeAccount();
  const store = memoryStore();
  store.setItem(LINKS_PREFIX + "ada", "{}");
  const projects: Projects = new Map([["p1", { name: "Cap", text: "v1", modified: new Date(Date.UTC(2026, 10, 5)) }]]);
  const syncs = Array.from({ length: count }, (_, i) =>
    designSync({
      api: designsApi(acc.as("ada") as AuthClient),
      userId: "ada",
      who: () => "ada",
      store,
      local: { list: async () => [...projects].map(([id, p]) => ({ id, name: p.name, modified: p.modified })), text: async (id) => projects.get(id)?.text ?? null, put: async () => "x" },
      hash: async (t) => createHash("sha256").update(t).digest("hex"),
      source: () => "design",
      picture: () => null,
      lock: lockFor(i),
    }),
  );
  return { acc, store, syncs };
}

/** Runs fn as in a browser without navigator.locks: newer Node versions have a real one, which would skip the fallback. */
async function withoutLocks(fn: () => Promise<void>): Promise<void> {
  const kept = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    if (kept) Object.defineProperty(globalThis, "navigator", kept);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test("without navigator.locks, two tabs of the app sending at once add a project once", () => withoutLocks(async () => {
  assert.equal((globalThis as { navigator?: { locks?: unknown } }).navigator?.locks, undefined, "this test runs the fallback");
  const acc = fakeAccount();
  const store = memoryStore();
  store.setItem(LINKS_PREFIX + "ada", "{}");
  const projects: Projects = new Map([["p1", { name: "Cap", text: "v1", modified: new Date(Date.UTC(2026, 10, 5)) }]]);
  const t1 = startDesigns(acc.as("ada") as AuthClient, host(projects), store);
  const t2 = startDesigns(acc.as("ada") as AuthClient, host(projects), store);
  await Promise.all([t1.sendNow(), t2.sendNow()]);
  assert.deepEqual(acc.rows.map((r) => `${r.name}=${r.body}`), ["Cap=v1"]);
  assert.equal(store.getItem(LEASE_KEY), null, "the lease is given back");
}));

test("seeded: however the tabs' starts interleave, the storage lock is held by one at a time", async () => {
  for (let seed = 1; seed <= 25; seed++) {
    let s = seed * 7919;
    const rand = (n: number) => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s % n;
    };
    let ids = 0;
    let inside = 0;
    let most = 0;
    const store = memoryStore();
    // Waits scaled down 50 times so the run is quick; the lock's safety doesn't depend on the scale.
    const lock = storageLock(store, { now: () => Date.now(), wait: (ms) => new Promise((r) => setTimeout(r, Math.ceil(ms / 50))), id: () => `tab${++ids}` });
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        await new Promise((r) => setTimeout(r, rand(4)));
        await lock(async () => {
          most = Math.max(most, ++inside);
          await new Promise((r) => setTimeout(r, rand(3)));
          inside--;
        });
      }),
    );
    assert.equal(most, 1, `seed ${seed}: two tabs held the lock at once`);
    assert.equal(store.getItem(LEASE_KEY), null, `seed ${seed}`);
  }
});

test("a lease left by a closed tab is waited for until it runs out (0.9× of LEASE_MS waits, 1.1× goes)", async () => {
  for (const [fraction, waits] of [[0.9, true], [1.1, false]] as const) {
    const store = memoryStore();
    const t0 = 1_000_000;
    let now = t0 + fraction * LEASE_MS;
    store.setItem(LEASE_KEY, JSON.stringify({ id: "closed tab", until: t0 + LEASE_MS }));
    let waited = 0;
    const lock = storageLock(store, {
      now: () => now,
      wait: async (ms) => {
        waited += ms;
        if (waited > 5000) now = t0 + 2 * LEASE_MS; // let a waiting run finish: the lease runs out later
      },
      id: () => "me",
    });
    let ran = false;
    await lock(async () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert.equal(waited > 5000, waits, `${fraction}× of LEASE_MS`);
  }
});

test("the two tabs' duplicate comes back without a lock (the test can fail)", async () => {
  const { acc, syncs } = tabs(2, () => (fn) => fn());
  await Promise.all(syncs.map((x) => x.syncAll()));
  assert.equal(acc.rows.length, 2, "with no lock at all both add it: what the storage lock prevents");
});

// ---- 8. The app hands the projects it can't read this round to the sync, so their links stay.

test("in the app, a project unreadable for one round keeps its 'left out' mark and is never sent", async () => {
  const acc = fakeAccount();
  const store = memoryStore();
  const hash = (t: string) => createHash("sha256").update(t).digest("hex");
  // Someone else's project on this computer, left out when Ada first signed in here.
  store.setItem(LINKS_PREFIX + "ada", JSON.stringify({ p2: { remote: "", revision: 1, hash: hash("sibling"), skip: "left" } }));
  let problem: string | undefined = "summary unreadable";
  let text = "sibling";
  const d = startDesigns(acc.as("ada") as AuthClient, {
    ...host(new Map()),
    list: async () => [{ id: "p2", name: "Sibling's", modified: new Date(Date.UTC(2026, 10, 4)), ...(problem ? { problem } : {}) }],
    text: async () => text,
  }, store);
  await d.sendNow();
  problem = undefined;
  text = "sibling changed";
  await d.sendNow();
  assert.deepEqual(acc.rows, [], "the left-out project isn't sent");
});
