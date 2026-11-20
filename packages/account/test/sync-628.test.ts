// Issue #628 items 5, 7 and the "keep it again" half of item 2 (lost-work hunt 2026-11-12, helper D's D6 and D8):
// projects made while signed out on a shared computer, a big design on a slow upload, and a design deleted from the
// account but changed here. Each regression was red on main a4bd339 (D6: the brother's project went to Ada's account;
// D8: the small design never reached it; item 2: there was no way back).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authClient, REQUEST_MS, requestMs, SLOW_LINK_BYTES_PER_S, type AuthClient } from "../src/auth.ts";
import { designsApi, type DesignsApi } from "../src/designs.ts";
import { AWAY_PREFIX, designSync, forgetLinks, LINKS_PREFIX, readLinks, SLOW_SAVE_BYTES } from "../src/sync.ts";
import { fakeAccount, type FakeAccount } from "./fake-designs.ts";
import { fakeService, KEY, memoryStore, SERVICE, seededRandom } from "./fake-service.ts";

/** One browser shared by everyone who uses it: its projects, its storage, and a sync for `user` (as the app makes one). */
function browser(acc: FakeAccount, wrap: (api: DesignsApi) => Pick<DesignsApi, "save" | "get" | "list" | "space"> = (a) => a) {
  const projects = new Map<string, { name: string; text: string; modified: Date }>();
  let clock = Date.UTC(2026, 10, 20);
  const store = memoryStore();
  let held = Promise.resolve();
  const syncFor = (user: string) =>
    designSync({
      api: wrap(designsApi(acc.as(user) as AuthClient)),
      userId: user,
      who: () => user,
      store,
      local: {
        // newest first, as the store lists them
        list: async () => [...projects.entries()].map(([id, p]) => ({ id, name: p.name, modified: p.modified })).sort((a, b) => b.modified.getTime() - a.modified.getTime()),
        text: async (id) => projects.get(id)?.text ?? null,
        put: async (id, text, name, savedAt) => {
          const key = id ?? `p${projects.size + 1}`;
          projects.set(key, { name, text, modified: savedAt });
          return key;
        },
      },
      hash: async (t) => createHash("sha256").update(t).digest("hex"),
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
    syncFor,
    edit(id: string, text: string, name = projects.get(id)?.name ?? id) {
      projects.set(id, { name, text, modified: new Date((clock += 1000)) });
    },
  };
}

const names = (acc: FakeAccount, user = "ada") => acc.rows.filter((r) => r.user === user).map((r) => r.name).sort();

// ---------------------------------------------------------------------------------------------------------------------
// Item 5 (D6): a shared computer.

test("item 5: a project made while Ada was signed out isn't sent at her next sign-in until she says it is hers", async () => {
  const acc = fakeAccount();
  const pc = browser(acc);
  pc.store.setItem(LINKS_PREFIX + "ada", "{}"); // her first sign-in here: "keep them" answered
  const ada = pc.syncFor("ada");
  pc.edit("mine", "ada's bracket", "Bracket");
  await ada.syncAll();
  assert.deepEqual(names(acc), ["Bracket"]);
  assert.equal(await ada.away(), true); // Sign out
  // Her brother, who has no account, uses the computer.
  pc.edit("bo", "bo's present", "Bo's secret present");
  // Ada signs in again. Hand-worked: "bo" has no link and wasn't here when she signed out, so it is the one to ask about.
  assert.equal(ada.firstTime(), false);
  assert.equal(await ada.arrivedCount(), 1);
  assert.deepEqual(await ada.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [], waiting: true });
  assert.deepEqual(names(acc), ["Bracket"], "nothing of the brother's went to Ada's account unasked");
  // Her own design still goes while the question waits.
  pc.edit("mine", "ada's bracket v2");
  assert.deepEqual(await ada.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [], waiting: true });
  // "Not now": left out, as on a first sign-in, and offered again as "Keep them too".
  assert.equal(await ada.arrivedChoice(false), true);
  assert.equal(await ada.arrivedCount(), 0);
  assert.equal(ada.leftCount(), 1);
  assert.equal(pc.store.getItem(AWAY_PREFIX + "ada"), null, "the note goes once answered");
  assert.deepEqual(await ada.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
  assert.deepEqual(names(acc), ["Bracket"]);
  assert.equal(await ada.includeLeft(), true);
  await ada.syncAll();
  assert.deepEqual(names(acc), ["Bo's secret present", "Bracket"]);
});

test("item 5: answered Keep them, the projects made while signed out are sent", async () => {
  const acc = fakeAccount();
  const pc = browser(acc);
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  await ada.away();
  pc.edit("n1", "made on the train", "Clip");
  assert.equal(await ada.arrivedCount(), 1);
  assert.equal(await ada.arrivedChoice(true), true);
  assert.deepEqual(await ada.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
  assert.deepEqual(names(acc), ["Clip"]);
});

test("item 5: Ada's own project from before signing out, never sent (offline), still goes without asking; Not now leaves only the new one", async () => {
  const acc = fakeAccount();
  const pc = browser(acc);
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  pc.edit("hers", "made offline", "Hinge"); // no round reached the account before she signed out
  await ada.away();
  pc.edit("bo", "bo's", "Robot");
  assert.equal(await ada.arrivedCount(), 1, "only the one made while signed out");
  assert.equal(await ada.arrivedChoice(false), true);
  await ada.syncAll();
  assert.deepEqual(names(acc), ["Hinge"]);
  assert.equal(readLinks(pc.store, "ada").get("bo")?.skip, "left");
  assert.equal(readLinks(pc.store, "ada").get("hers")?.skip, undefined);
});

test("item 5: signing out and in with nothing new asks nothing, and the note goes at the first round", async () => {
  const acc = fakeAccount();
  const pc = browser(acc);
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  pc.edit("a", "x", "A");
  await ada.syncAll();
  await ada.away();
  assert.equal(await ada.arrivedCount(), 0);
  assert.deepEqual(await ada.syncAll(), { kind: "done", sent: 0, copies: [], tooBig: [] });
  assert.equal(pc.store.getItem(AWAY_PREFIX + "ada"), null);
  // Made after that round, while signed in: hers, sent without asking.
  pc.edit("b", "y", "B");
  assert.deepEqual(await ada.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
});

test("item 5: signing out twice keeps the first note (a project made between is still asked about), and deleting the account forgets it", async () => {
  const acc = fakeAccount();
  const pc = browser(acc);
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  await ada.away();
  pc.edit("bo", "bo's", "Robot");
  await ada.away(); // the session lost, then Sign out again, with no round between
  assert.equal(await ada.arrivedCount(), 1);
  forgetLinks(pc.store, "ada");
  assert.equal(pc.store.getItem(AWAY_PREFIX + "ada"), null);
  assert.equal(ada.firstTime(), true, "a deleted account starts again with the first-time question");
});

test("item 5: someone who never answered the first-time question has no note (they are asked as the first time anyway)", async () => {
  const pc = browser(fakeAccount());
  const ada = pc.syncFor("ada");
  pc.edit("x", "x", "X");
  assert.equal(await ada.away(), true);
  assert.equal(pc.store.getItem(AWAY_PREFIX + "ada"), null);
  assert.equal(ada.firstTime(), true);
});

test("item 5, can fail: without the note made at sign out the brother's project goes up (the bug the note fixes)", async () => {
  const acc = fakeAccount();
  const pc = browser(acc);
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  pc.edit("mine", "ada's", "Bracket");
  await ada.syncAll();
  pc.edit("bo", "bo's", "Bo's secret present"); // signed out with no note (main's account.ts before this fix)
  await ada.syncAll();
  assert.deepEqual(names(acc), ["Bo's secret present", "Bracket"]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Item 2: a design deleted from the account, changed here since, kept in the account again.

test("item 2: Keep in my account again sends a project changed here since its design was deleted, as a new design", async () => {
  const acc = fakeAccount();
  const pc = browser(acc);
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  const api = designsApi(acc.as("ada") as AuthClient);
  pc.edit("lid", "v1", "Lid");
  pc.edit("cap", "c1", "Cap");
  await ada.syncAll();
  for (const r of [...acc.rows]) await api.remove(r.id); // both deleted from the account on another device
  pc.edit("lid", "v2"); // only the lid changed here since
  const r = await ada.syncAll();
  assert.equal(r.kind === "done" && r.gone?.join(), "Lid");
  assert.equal(ada.goneHere(), 1, "the cap is unchanged: deleting it there was the person's choice");
  assert.equal(await ada.keepGone(), true);
  assert.equal(ada.goneHere(), 0);
  assert.deepEqual(await ada.syncAll(), { kind: "done", sent: 1, copies: [], tooBig: [] });
  assert.deepEqual(names(acc), ["Lid"]);
  assert.equal(acc.rows[0]!.body, "v2");
  assert.equal(ada.remoteOf("lid"), acc.rows[0]!.id, "the project follows its new design");
  // The cap stays out, however many rounds go by.
  await ada.syncAll();
  assert.deepEqual(names(acc), ["Lid"]);
});

test("item 2: kept again while a signed-out note waits, the project still goes (it was here, and hers)", async () => {
  const acc = fakeAccount();
  const pc = browser(acc);
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  pc.edit("lid", "v1", "Lid");
  await ada.syncAll();
  await designsApi(acc.as("ada") as AuthClient).remove(acc.rows[0]!.id);
  pc.edit("lid", "v2");
  await ada.syncAll();
  await ada.away();
  pc.edit("bo", "bo's", "Robot");
  await ada.keepGone();
  await ada.syncAll();
  assert.deepEqual(names(acc), ["Lid"], "the lid went; the brother's is still asked about");
  assert.equal(await ada.arrivedCount(), 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Item 7 (D8): one big design that runs out of time doesn't hold up the rest.

/** Saves whose text is at least `bytes` long don't answer in time, as on a slow upload. */
const slowFrom = (bytes: number) => (api: DesignsApi) => ({ ...api, save: (d: Parameters<DesignsApi["save"]>[0]) => (d.body.length >= bytes ? Promise.resolve({ kind: "failed" as const, reason: "offline" as const }) : api.save(d)) });

test("item 7: a big design whose save runs out of time is passed over, the small ones after it still go, and the round says it failed", async () => {
  const acc = fakeAccount();
  const pc = browser(acc, slowFrom(SLOW_SAVE_BYTES));
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  pc.edit("small", "a small part", "Small");
  pc.edit("big", "x".repeat(3 * 1024 * 1024), "Scanned part"); // saved last, so tried first
  assert.deepEqual(await ada.syncAll(), { kind: "failed", reason: "offline" }, "said, and tried again later");
  assert.deepEqual(names(acc), ["Small"], "the small design reached the account");
  // The big one stays noted as being added, so a lost answer is still found next round.
  assert.equal(readLinks(pc.store, "ada").get("big")?.adding !== undefined, true);
});

test("item 7: at 1.1× of SLOW_SAVE_BYTES a timed-out save is passed over; at 0.9× it ends the round (the connection is the trouble)", async () => {
  for (const [k, passed] of [[1.1, true], [0.9, false]] as const) {
    const acc = fakeAccount();
    const size = Math.round(SLOW_SAVE_BYTES * k);
    const pc = browser(acc, slowFrom(size));
    pc.store.setItem(LINKS_PREFIX + "ada", "{}");
    const ada = pc.syncFor("ada");
    pc.edit("small", "tiny", "Small");
    pc.edit("big", "x".repeat(size), "Big");
    await ada.syncAll();
    assert.deepEqual(names(acc), passed ? ["Small"] : [], `${k}×`);
  }
});

test("item 7: after one big design is passed over, a second failure ends the round", async () => {
  const acc = fakeAccount();
  let saves = 0;
  const pc = browser(acc, (api) => ({ ...api, save: (d) => (++saves <= 2 ? Promise.resolve({ kind: "failed" as const, reason: "offline" as const }) : api.save(d)) }));
  pc.store.setItem(LINKS_PREFIX + "ada", "{}");
  const ada = pc.syncFor("ada");
  pc.edit("c", "small", "C");
  pc.edit("b", "y".repeat(SLOW_SAVE_BYTES), "B");
  pc.edit("a", "x".repeat(SLOW_SAVE_BYTES), "A");
  assert.deepEqual(await ada.syncAll(), { kind: "failed", reason: "offline" });
  assert.equal(saves, 2, "C was never tried: the second big failure ended the round");
  assert.deepEqual(names(acc), []);
});

test("item 7: a request's time limit grows with what it sends and may get back (worked by hand)", () => {
  assert.equal(REQUEST_MS, 15_000);
  assert.equal(SLOW_LINK_BYTES_PER_S, 51_200);
  assert.equal(requestMs(0), 15_000);
  // 3 MiB = 3,145,728 bytes; at 51,200 bytes a second that is 61.44 s, so 15 + 61.44 = 76.44 s.
  assert.equal(requestMs(3 * 1024 * 1024), 76_440);
  // The hunt's case: 3 MiB at 1 Mbit/s up (125,000 bytes a second) takes 25.17 s: inside 76.44 s, outside the old 15 s.
  assert.ok((3 * 1024 * 1024) / 125_000 < requestMs(3 * 1024 * 1024) / 1000);
  // An answer counts the same as a body: 512 KiB back, 10.24 s more.
  assert.equal(requestMs(0, 512 * 1024), 25_240);
  assert.equal(requestMs(-5, -5), 15_000, "nothing negative takes time off");
});

/** A signed-in client whose requests take `bytes / speed` seconds on a pretend link and fail when that passes their time limit. */
async function slowLinkClient(speed: number) {
  let ms = 1_800_000_000_000;
  const svc = fakeService(() => ms / 1000);
  let limit = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const sent = typeof init?.body === "string" ? init.body.length : 0;
    if (String(input).includes("/rest/v1/") && (sent * 1000) / speed > limit) throw new DOMException("The operation timed out.", "TimeoutError");
    return svc.fetch(input, init);
  }) as typeof globalThis.fetch;
  const client = authClient({ config: { url: SERVICE, anonKey: KEY, redirectTo: "https://spindlelabs.app/" }, fetch, store: memoryStore(), now: () => ms, random: seededRandom(4), timeout: (t) => ((limit = t), new AbortController().signal) });
  const go = new URL((await client.beginSignIn())!);
  const back = new URL("https://spindlelabs.app/");
  back.searchParams.set("code", svc.approve(go.searchParams.get("code_challenge")!));
  assert.equal((await client.finishSignIn(back.href)).kind, "signed-in");
  return client;
}

test("item 7: a 1 MiB save gets the time it needs: 0.9× of its limit on the link answers, 1.1× runs out", async () => {
  const body = { p_body: "x".repeat(1024 * 1024) };
  const sent = JSON.stringify(body).length;
  const limitS = requestMs(sent) / 1000;
  for (const [k, offline] of [[0.9, false], [1.1, true]] as const) {
    const client = await slowLinkClient(sent / (limitS * k)); // the link takes k × the limit for this body
    const r = await client.asPerson("POST", "rpc/save_design", body);
    assert.equal(r.kind === "failed" && r.reason === "offline", offline, `${k}×`);
  }
  // Hand-worked: that 0.9× link takes 0.9 × (15 + 20.48) s ≈ 31.9 s for 1 MiB, more than the old 15 s for everything.
  assert.ok(0.9 * limitS > REQUEST_MS / 1000);
});
