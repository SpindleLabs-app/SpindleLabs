// The print log kept in the account (account features 5): src/print-log.ts's rounds against the fake account
// (fake-print-log.ts, answering as supabase/migrations/20261113120000_print_log.sql does), with each browser's log the
// app's own: apps/fission src/print-log-sync.ts `localPrints` over @fission/print's store. The SQL itself is checked by
// supabase/test/test_print_log.py; the browser by apps/fission e2e/print-log-sync.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AuthClient } from "../src/auth.ts";
import { accountLogFrom, accountPrintFrom, PRINT_LOG_ACCOUNT_LIMITS, PRINT_LOG_SEEN_PREFIX, printLogApi, printLogSync, readSeen, savePrintsAnswerFrom, wirePrint, type PrintLogReport } from "../src/print-log.ts";
import { memoryStore } from "./fake-service.ts";
import { fakePrintLogAccount, type FakePrintLogAccount } from "./fake-print-log.ts";
import { repoFile } from "./repo-file.ts";

const g = globalThis as unknown as { addEventListener?: unknown };
g.addEventListener ??= () => {};
const print = (await import(repoFile("packages/print/src/index.ts").href)) as typeof import("../../print/src/index.ts");
const { localPrints, reportWords } = (await import(repoFile("apps/fission/src/print-log-sync.ts").href)) as typeof import("../../../apps/fission/src/print-log-sync.ts");
const { addPrint, changePrint, removePrint, readLog, writeLog, PRINT_LOG_OWNER_KEY } = print;

const at = (minutes: number) => new Date(Date.parse("2026-11-12T10:00:00Z") + minutes * 60_000);

/** One browser: its log (owned by `user` while signed in) and a round of `user`'s sync. */
function device(acc: FakePrintLogAccount, user: string | null = "ada", opts: { current?: () => boolean } = {}) {
  const raw = memoryStore();
  if (user) raw.setItem(PRINT_LOG_OWNER_KEY, user);
  const storage = raw as unknown as Storage;
  const store = memoryStore();
  const sync = printLogSync({ api: printLogApi(acc.as(user) as AuthClient), userId: user ?? "nobody", store, local: localPrints(storage), lock: (fn) => fn(), current: opts.current });
  return {
    raw,
    storage,
    store,
    round: (): Promise<PrintLogReport> => sync.round(),
    prints: () => readLog(storage).prints,
    one: (id: string) => readLog(storage).prints.find((p) => p.id === id),
    make: (name: string, when: Date) => addPrint(storage, { name, settings: "0.2 mm layers", grams: 12.34, seconds: 3000 }, when)!.print,
    change: (id: string, change: Parameters<typeof changePrint>[2], when: Date) => changePrint(storage, id, change, when),
    remove: (id: string) => removePrint(storage, id),
    signOut: () => raw.removeItem(PRINT_LOG_OWNER_KEY),
  };
}

const done = (sent: number, brought: number, deleted: number, full = 0): PrintLogReport => ({ kind: "done", sent, brought, deleted, full });

test("the limits and the problems are the migration's", () => {
  const sql = readFileSync(repoFile("supabase/migrations/20261113120000_print_log.sql"), "utf8");
  const m = /jsonb_build_object\('max_prints', (\d+), 'max_batch', (\d+), 'max_name', (\d+), 'max_settings', (\d+), 'max_note', (\d+)\)/.exec(sql);
  assert.ok(m, "print_log_limits() found");
  assert.deepEqual(m.slice(1).map(Number), [PRINT_LOG_ACCOUNT_LIMITS.maxPrints, PRINT_LOG_ACCOUNT_LIMITS.maxBatch, PRINT_LOG_ACCOUNT_LIMITS.maxName, PRINT_LOG_ACCOUNT_LIMITS.maxSettings, PRINT_LOG_ACCOUNT_LIMITS.maxNote]);
  // The browser's log keeps no more than the account takes.
  assert.equal(print.PRINT_LOG_LIMITS.prints, PRINT_LOG_ACCOUNT_LIMITS.maxPrints);
  assert.equal(print.PRINT_LOG_LIMITS.name, PRINT_LOG_ACCOUNT_LIMITS.maxName);
  assert.equal(print.PRINT_LOG_LIMITS.settings, PRINT_LOG_ACCOUNT_LIMITS.maxSettings);
  assert.equal(print.PRINT_LOG_LIMITS.note, PRINT_LOG_ACCOUNT_LIMITS.maxNote);
});

test("two devices, worked by hand: a print made on A shows on B, B's Failed shows on A", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  const b = device(acc);
  const p = a.make("Bracket", at(0));
  // A holds one print the account has never seen: sent, nothing to bring.
  assert.deepEqual(await a.round(), done(1, 0, 0));
  assert.equal(acc.rows.get("ada")!.size, 1);
  // B holds nothing, the account one print B never saw: brought, as Ada's.
  assert.deepEqual(await b.round(), done(0, 1, 0));
  assert.equal(b.one(p.id)!.name, "Bracket");
  assert.equal(b.one(p.id)!.owner, "ada");
  assert.equal(b.one(p.id)!.grams, 12.3); // 12.34 g to 0.1
  assert.equal(b.one(p.id)!.minutes, 50); // 3000 s / 60
  // B says it failed (warped) at 10:05: later than the account's 10:00, so sent.
  b.change(p.id, { result: "failed", problem: "warped", note: "lifted at the corner" }, at(5));
  assert.deepEqual(await b.round(), done(1, 0, 0));
  // A's copy is 10:00, the account's 10:05: brought.
  assert.deepEqual(await a.round(), done(0, 1, 0));
  assert.deepEqual({ result: a.one(p.id)!.result, problem: a.one(p.id)!.problem, note: a.one(p.id)!.note, updatedAt: a.one(p.id)!.updatedAt }, { result: "failed", problem: "warped", note: "lifted at the corner", updatedAt: at(5).toISOString() });
  // Both sides the same: a round changes nothing.
  assert.deepEqual(await a.round(), done(0, 0, 0));
  assert.deepEqual(await b.round(), done(0, 0, 0));
});

test("the later change wins whichever device syncs first", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  const b = device(acc);
  const p = a.make("Hook", at(0));
  await a.round();
  await b.round();
  a.change(p.id, { result: "well" }, at(10)); // later
  b.change(p.id, { result: "failed", problem: "stringing" }, at(5)); // earlier, but synced first
  assert.deepEqual(await b.round(), done(1, 0, 0));
  assert.deepEqual(await a.round(), done(1, 0, 0)); // 10:10 beats the account's 10:05
  assert.deepEqual(await b.round(), done(0, 1, 0));
  assert.equal(b.one(p.id)!.result, "well");
  assert.equal(b.one(p.id)!.problem, null);
});

test("a print deleted on one device goes from the account and then the other device", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  const b = device(acc);
  const p = a.make("Gear", at(0));
  const q = a.make("Clip", at(1));
  await a.round();
  await b.round();
  assert.equal(b.prints().length, 2);
  // Deleted on A: A saw it both sides, so it is deleted from the account, never brought back.
  a.remove(p.id);
  assert.deepEqual(await a.round(), done(0, 0, 1));
  assert.deepEqual([...acc.rows.get("ada")!.keys()], [q.id]);
  // B saw it both sides and the account has it no more: deleted on B, not sent back.
  assert.deepEqual(await b.round(), done(0, 0, 1));
  assert.deepEqual(b.prints().map((x) => x.id), [q.id]);
  assert.deepEqual(await a.round(), done(0, 0, 0));
});

test("a print changed here while a round runs is not deleted by it", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  const b = device(acc);
  const p = a.make("Gear", at(0));
  await a.round();
  await b.round();
  a.remove(p.id);
  await a.round();
  // B's round reads its log (10:00), then B changes the print before the round writes.
  const realApply = localPrints(b.storage).apply;
  b.change(p.id, { note: "kept" }, at(3));
  // The adapter is told to drop it as of 10:00; its 10:03 change keeps it.
  assert.equal(realApply([], [{ id: p.id, asOf: at(0).toISOString() }]), true);
  assert.equal(b.one(p.id)!.note, "kept");
  // Dropped only while unchanged since the round read it.
  assert.equal(realApply([], [{ id: p.id, asOf: at(3).toISOString() }]), true);
  assert.equal(b.one(p.id), undefined);
});

test("keeping turned off and on again: the fresh copy is filled again, never emptied here", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  const b = device(acc);
  const p = a.make("Bracket", at(0));
  await a.round();
  await b.round();
  // Off on A (the account's copy is deleted), then on again: since starts afresh.
  const api = printLogApi(acc.as("ada") as AuthClient);
  assert.deepEqual(await api.setKeeping(false), { kind: "ok", value: false });
  assert.deepEqual(await a.round(), { kind: "off" });
  assert.equal(a.store.getItem(PRINT_LOG_SEEN_PREFIX + "ada"), null); // what was seen is forgotten
  assert.deepEqual(await api.setKeeping(true), { kind: "ok", value: true });
  // B saw the print both sides, but under the old since: the empty fresh copy is not a deletion. Sent again.
  assert.deepEqual(await b.round(), done(1, 0, 0));
  assert.equal(b.one(p.id)!.name, "Bracket");
  assert.deepEqual(await a.round(), done(0, 0, 0));
  assert.equal(a.one(p.id)!.name, "Bracket");
});

test("Delete my print log in the account: every device's prints are sent again", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  a.make("Bracket", at(0));
  await a.round();
  const before = readSeen(a.store, "ada")!.since;
  assert.deepEqual((await acc.as("ada").asPerson("POST", "rpc/delete_my_print_log")).kind, "ok");
  assert.deepEqual(await a.round(), done(1, 0, 0));
  assert.equal(a.prints().length, 1);
  assert.notEqual(readSeen(a.store, "ada")!.since, before);
});

test("prints made signed out and other people's prints are never sent", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  a.signOut();
  const loose = a.make("Made signed out", at(0));
  assert.equal(loose.owner, null);
  a.raw.setItem(PRINT_LOG_OWNER_KEY, "bo");
  const bos = a.make("Bo's", at(1));
  a.raw.setItem(PRINT_LOG_OWNER_KEY, "ada");
  const adas = a.make("Ada's", at(2));
  assert.deepEqual(await a.round(), done(1, 0, 0));
  assert.deepEqual([...acc.rows.get("ada")!.keys()], [adas.id]);
  // Bo's account holding a print with Ada's id: brought to Bo's browser, never over Ada's print here.
  const bo = device(acc, "bo");
  acc.rows.set("bo", new Map([[adas.id, { ...[...acc.rows.get("ada")!.values()][0], name: "Not Ada's", updated_at: at(30).toISOString() }]]));
  const boOnA = printLogSync({ api: printLogApi(acc.as("bo") as AuthClient), userId: "bo", store: a.store, local: localPrints(a.storage), lock: (fn) => fn() });
  const r = await boOnA.round();
  assert.equal(r.kind, "done");
  assert.equal(a.one(adas.id)!.name, "Ada's");
  assert.equal(a.one(adas.id)!.owner, "ada");
  assert.equal(a.one(bos.id)!.owner, "bo");
  assert.equal(a.one(loose.id)!.owner, null);
  void bo;
});

test("Keep these in my account sends the prints made signed out", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  a.signOut();
  a.make("Earlier", at(0));
  a.raw.setItem(PRINT_LOG_OWNER_KEY, "ada");
  assert.deepEqual(await a.round(), done(0, 0, 0));
  assert.equal(print.claimPrints(a.storage, "ada", at(5)), 1);
  assert.deepEqual(await a.round(), done(1, 0, 0));
});

test("the batch of 50: 45 prints go in one save, 55 in two", async () => {
  for (const [n, saves] of [
    [45, 1],
    [55, 2],
  ] as const) {
    const acc = fakePrintLogAccount();
    const a = device(acc);
    for (let i = 0; i < n; i++) a.make(`Print ${i}`, at(i));
    assert.deepEqual(await a.round(), done(n, 0, 0));
    assert.equal(acc.calls.filter((c) => c.endsWith("save_prints")).length, saves);
    assert.equal(acc.rows.get("ada")!.size, n);
  }
});

test("a full account keeps the rest only here and says so", async () => {
  const acc = fakePrintLogAccount();
  const b = device(acc);
  for (let i = 0; i < 498; i++) b.make(`Old ${i}`, at(i));
  await b.round();
  const a = device(acc);
  // A brings the 498, then makes 4: room for 2.
  await a.round();
  for (let i = 0; i < 4; i++) a.make(`New ${i}`, at(600 + i));
  // A holds 502 now? No: the browser's log keeps 500, so the two oldest went first; they were seen, so they are
  // deleted from the account too, and then all four fit.
  assert.equal(a.prints().length, 500);
  const r = await a.round();
  assert.deepEqual(r, done(4, 0, 2));
  assert.equal(acc.rows.get("ada")!.size, 500);
  // A third device with 3 of its own, made where the account is full: they stay only there.
  const c = device(acc);
  c.make("Here only 1", at(900));
  c.make("Here only 2", at(901));
  c.make("Here only 3", at(902));
  const rc = await c.round();
  assert.equal(rc.kind, "done");
  assert.equal((rc as { full: number }).full, 3);
  assert.match(reportWords(rc), /full \(500 prints\), so 3 prints stay only in this browser/);
  assert.equal(acc.rows.get("ada")!.size, 500);
});

test("offline, not offered, off or signed out: nothing here changes", async () => {
  for (const mode of ["down", "missing"] as const) {
    const acc = fakePrintLogAccount();
    const a = device(acc);
    a.make("Bracket", at(0));
    acc.mode = mode;
    const before = JSON.stringify(a.prints());
    const r = await a.round();
    assert.deepEqual(r, { kind: "failed", reason: mode === "down" ? "offline" : "rejected" });
    assert.equal(JSON.stringify(a.prints()), before);
    assert.equal(a.store.getItem(PRINT_LOG_SEEN_PREFIX + "ada"), null);
  }
  assert.equal(reportWords({ kind: "failed", reason: "rejected" }), "");
  assert.match(reportWords({ kind: "failed", reason: "offline" }), /couldn't be reached/);
  // Signed out while the round ran: nothing brought here, nothing marked seen.
  const acc = fakePrintLogAccount();
  device(acc).make("x", at(0));
  const other = device(acc);
  other.make("There", at(1));
  await other.round();
  let signedIn = true;
  const a = device(acc, "ada", { current: () => signedIn });
  acc.beforeSave = () => void (signedIn = false);
  a.make("Mine", at(2));
  assert.deepEqual(await a.round(), { kind: "signed-out" });
  assert.equal(a.prints().length, 1);
  assert.equal(a.store.getItem(PRINT_LOG_SEEN_PREFIX + "ada"), null);
});

test("grams go to the account with at most three decimals, as it keeps them (security hunt 2026-11-13 A2)", () => {
  const p = { id: "00000000-0000-4000-8000-000000000001", madeAt: "2026-11-13T02:00:00.000Z", name: "Box", settings: "", grams: 12.34567, minutes: 80, result: "waiting" as const, problem: null, note: "", updatedAt: "2026-11-13T02:00:00.000Z" };
  // Worked by hand: 12.34567 g to the nearest milligram is 12.346; 0.1 + 0.2 (0.30000000000000004 in binary) is 0.3.
  assert.equal(wirePrint(p).grams, 12.346);
  assert.equal(JSON.stringify(wirePrint({ ...p, grams: 0.1 + 0.2 }).grams), "0.3");
  assert.equal(wirePrint({ ...p, grams: 12.5 }).grams, 12.5);
  assert.equal(wirePrint({ ...p, grams: null }).grams, null);
  // The fake refuses four decimals as the database does; the rounding is what lets a print kept here with more in.
  const acc = fakePrintLogAccount();
  const raw = acc.as("ada") as AuthClient;
  const api = printLogApi(raw);
  return raw.asPerson("POST", "rpc/save_prints", { p_prints: [{ ...wirePrint(p), grams: 12.3456 }] }).then(async (four) => {
    assert.deepEqual(four, { kind: "ok", body: { status: "invalid" } });
    const sent = await api.save([{ ...p, grams: 12.3456 }]);
    assert.equal(sent.kind === "ok" && typeof sent.value === "object" && sent.value.status, "done");
    assert.equal(acc.rows.get("ada")!.get(p.id)!.grams, 12.346);
  });
});

test("the account's answers are checked", async () => {
  const good = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", made_at: "2026-11-12T10:00:00+00:00", name: "a", settings: "", grams: null, minutes: 3, result: "well", problem: null, note: "", updated_at: "2026-11-12T10:00:00.5+00:00" };
  // PostgreSQL's +00:00 read as the browser writes the same moment.
  assert.equal(accountPrintFrom(good)!.updatedAt, "2026-11-12T10:00:00.500Z");
  for (const bad of [{ ...good, id: "x" }, { ...good, made_at: "soon" }, { ...good, grams: -1 }, { ...good, minutes: "3" }, { ...good, result: "ok" }, { ...good, problem: 3 }, { ...good, name: null }, null, []]) assert.equal(accountPrintFrom(bad), null, JSON.stringify(bad));
  assert.equal(accountLogFrom({ keep: true, since: "t", prints: [good, { ...good, id: "x" }] }), null);
  assert.equal(accountLogFrom({ keep: "yes", since: "t", prints: [] }), null);
  assert.equal(accountLogFrom({ keep: true, prints: [] }), null);
  assert.deepEqual(savePrintsAnswerFrom({ status: "off" }), "off");
  assert.deepEqual(savePrintsAnswerFrom({ status: "invalid" }), "invalid");
  assert.equal(savePrintsAnswerFrom({ status: "done", saved: [], older: [] }), null);
  assert.equal(savePrintsAnswerFrom({ status: "done", saved: [1], older: [], full: [] }), null);
  assert.equal(savePrintsAnswerFrom({ status: "maybe" }), null);
  // A malformed read changes nothing here.
  const acc = fakePrintLogAccount();
  const client = { asPerson: async () => ({ kind: "ok", body: { keep: true, since: "t", prints: [{ ...good, result: "?" }] } }) } as unknown as AuthClient;
  const a = device(acc);
  a.make("Bracket", at(0));
  const r = await printLogSync({ api: printLogApi(client), userId: "ada", store: a.store, local: localPrints(a.storage), lock: (fn) => fn() }).round();
  assert.deepEqual(r, { kind: "failed", reason: "malformed" });
  assert.equal(a.prints().length, 1);
  const removeBad = { asPerson: async () => ({ kind: "ok", body: -1 }) } as unknown as AuthClient;
  assert.deepEqual(await printLogApi(removeBad).remove(["a"]), { kind: "failed", reason: "malformed" });
});

test("a print a newer app wrote stays in the account, untouched here", async () => {
  const acc = fakePrintLogAccount();
  const a = device(acc);
  const p = a.make("Bracket", at(0));
  // The adapter skips what @fission/print can't keep.
  assert.equal(localPrints(a.storage).apply([{ ...p, id: "not-a-uuid" } as never], []), true);
  assert.deepEqual(a.prints().map((x) => x.id), [p.id]);
});

/** Numbers in [0, 1) from a seed (mulberry32). */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded sessions: three devices of one person make, change and delete prints and sync in a random order. After
// every device has synced twice, every device holds exactly the account's prints, and these are the model's: each
// print made and never deleted anywhere, in its latest change.
test("60 seeded sessions on three devices agree with a model", async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = mulberry(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const acc = fakePrintLogAccount();
    acc.now = Date.parse("2030-01-01T00:00:00Z");
    const devices = [device(acc), device(acc), device(acc)];
    const model = new Map<string, { result: string; note: string; updatedAt: string }>();
    const deleted = new Set<string>();
    let clock = 0;
    for (let step = 0; step < 40; step++) {
      const d = pick(devices);
      const what = rand();
      clock++;
      if (what < 0.25) {
        const p = d.make(`P${step}`, at(clock));
        model.set(p.id, { result: p.result, note: p.note, updatedAt: p.updatedAt });
      } else if (what < 0.5 && d.prints().length) {
        const p = pick(d.prints());
        const next = d.change(p.id, { result: pick(["well", "failed", "waiting"] as const), note: `n${step}` }, at(clock))!;
        const m = model.get(p.id);
        if (m && Date.parse(next.updatedAt) > Date.parse(m.updatedAt)) model.set(p.id, { result: next.result, note: next.note, updatedAt: next.updatedAt });
      } else if (what < 0.62 && d.prints().length) {
        const p = pick(d.prints());
        d.remove(p.id);
        deleted.add(p.id);
      } else {
        const r = await d.round();
        assert.equal(r.kind, "done", `seed ${seed} step ${step}`);
      }
    }
    for (let k = 0; k < 2; k++) for (const d of devices) assert.equal((await d.round()).kind, "done");
    const expected = [...model.entries()].filter(([id]) => !deleted.has(id)).map(([id, m]) => `${id} ${m.result} ${m.note} ${m.updatedAt}`).sort();
    const there = [...acc.rows.get("ada")!.values()].map((r) => `${r.id} ${r.result} ${r.note} ${new Date(r.updated_at).toISOString()}`).sort();
    assert.deepEqual(there, expected, `seed ${seed}: the account`);
    for (const [i, d] of devices.entries()) {
      const here = d.prints().map((p) => `${p.id} ${p.result} ${p.note} ${p.updatedAt}`).sort();
      assert.deepEqual(here, expected, `seed ${seed}: device ${i}`);
    }
  }
});
