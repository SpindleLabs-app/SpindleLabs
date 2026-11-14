// The print log kept in this browser (print-log.ts): hand-worked words and rounding, the limits at 0.9× and 1.1×,
// two tabs, a newer app's store, and the limits and problem list checked against the account's migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addPrint, changedPrint, changePrint, claimPrints, cut, PRINT_LOG_KEY, PRINT_LOG_LIMITS, PRINT_LOG_OWNER_KEY, printFrom, printOf, PROBLEMS, readLog, removePrint, settingsWords, summaryWords } from "../src/print-log.ts";

/** A plain storage in memory. */
function memory(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

const T0 = new Date("2026-11-13T02:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60000);
const made = { name: "Box", settings: "0.2 mm layers", grams: 12.34, seconds: 4830 };

test("a print as the slicer gives it, worked by hand", () => {
  const p = printOf(made, T0, null, "00000000-0000-0000-0000-000000000001");
  // 12.34 g to the nearest 0.1 g is 12.3; 4830 s is 80.5 min, which rounds half up to 81.
  assert.deepEqual(p, { id: "00000000-0000-0000-0000-000000000001", madeAt: "2026-11-13T02:00:00.000Z", name: "Box", settings: "0.2 mm layers", grams: 12.3, minutes: 81, result: "waiting", problem: null, note: "", updatedAt: "2026-11-13T02:00:00.000Z", owner: null });
  assert.equal(printOf({ name: "   ", settings: "", grams: NaN, seconds: -1 }, T0, "u1").name, "Untitled", "a blank name");
  assert.equal(printOf({ name: "x", settings: "", grams: NaN, seconds: -1 }, T0, "u1").grams, null, "no weight worked out");
  assert.equal(printOf({ name: "x", settings: "" }, T0, "u1").minutes, null);
  assert.match(printOf(made, T0, null).id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/, "a fresh random lower-case UUID");
});

test("the slicer's choices in words", () => {
  assert.equal(settingsWords({ layerHeight: 0.2, walls: 2, infill: 15, supports: "off" }, "standard"), "0.2 mm layers, 2 walls, 15% infill, no supports, standard nozzle");
  assert.equal(settingsWords({ layerHeight: 0.12, walls: 1, infill: 100, supports: "tree" }, "high-flow"), "0.12 mm layers, 1 wall, 100% infill, tree supports, high flow nozzle");
});

test("added, changed, read back; the owner is whoever the account code named", () => {
  const s = memory();
  const first = addPrint(s, made, T0);
  assert.ok(first);
  assert.equal(first.print.owner, null, "signed out: this browser's only");
  s.setItem(PRINT_LOG_OWNER_KEY, "user-1");
  const second = addPrint(s, { ...made, name: "Bracket" }, at(5));
  assert.equal(second?.print.owner, "user-1");
  assert.deepEqual(readLog(s).prints.map((p) => p.name), ["Bracket", "Box"], "newest made first");
  const failed = changePrint(s, first.print.id, { result: "failed", problem: "warped", note: "Lifted at the corner" }, at(60));
  assert.equal(failed?.result, "failed");
  assert.equal(failed?.updatedAt, at(60).toISOString());
  assert.deepEqual(readLog(s).prints[1], failed);
  assert.equal(changePrint(s, "00000000-0000-0000-0000-00000000dead", { result: "well" }, at(61)), null, "gone");
});

test("a problem is kept only while it failed, and a change never goes back in time", () => {
  const p = printOf(made, T0, null, "00000000-0000-0000-0000-000000000001");
  const failed = changedPrint(p, { result: "failed", problem: "came-off" }, at(1));
  assert.equal(failed.problem, "came-off");
  const well = changedPrint(failed, { result: "well" }, at(2));
  assert.equal(well.problem, null, "printed well: no problem");
  assert.equal(changedPrint(well, { result: "failed" }, at(3)).problem, null, "failed again: nothing picked yet");
  assert.equal(changedPrint(failed, { problem: "melted" as never }, at(4)).problem, null, "not on the list");
  assert.equal(changedPrint(p, { result: "waiting" }, at(5)), p, "nothing changes: the same print, the same time");
  // A clock that went back a day still makes the change the later one (1 ms after the last).
  const back = changedPrint(failed, { note: "x" }, at(-1440));
  assert.equal(back.updatedAt, new Date(at(1).getTime() + 1).toISOString());
});

test("a note up to 500 characters: 450 kept whole, 550 cut to 500, counted as characters", () => {
  const p = printOf(made, T0, null);
  assert.equal(changedPrint(p, { note: "é".repeat(450) }, at(1)).note.length, 450);
  assert.equal([...changedPrint(p, { note: "😀".repeat(550) }, at(1)).note].length, 500, "an emoji is one character, two UTF-16 units");
  assert.equal(cut("abc", 2), "ab");
  // A name over 100 is cut too: 90 stays, 110 becomes 100.
  assert.equal(printOf({ ...made, name: "n".repeat(90) }, T0, null).name.length, 90);
  assert.equal(printOf({ ...made, name: "n".repeat(110) }, T0, null).name.length, 100);
});

test("500 prints at most: at 450 nothing goes; adding past 500 drops the oldest each time", () => {
  const s = memory();
  for (let i = 0; i < 450; i++) addPrint(s, { ...made, name: `p${i}` }, at(i));
  assert.equal(readLog(s).prints.length, 450);
  let dropped: string[] = [];
  for (let i = 450; i < 550; i++) {
    const r = addPrint(s, { ...made, name: `p${i}` }, at(i));
    if (r?.dropped) dropped.push(r.dropped.name);
  }
  const log = readLog(s).prints;
  assert.equal(log.length, 500);
  // 550 made, 500 kept: the 50 oldest (p0 to p49) went, in order, and p50 is now the oldest.
  assert.deepEqual(dropped, Array.from({ length: 50 }, (_, i) => `p${i}`));
  assert.equal(log[log.length - 1].name, "p50");
  assert.equal(log[0].name, "p549");
  assert.equal(PRINT_LOG_LIMITS.prints, 500);
});

test("two tabs: each change reads the store again, so neither undoes the other", () => {
  const s = memory();
  const a = addPrint(s, made, T0)!.print;
  const b = addPrint(s, { ...made, name: "Other" }, at(1))!.print;
  // Tab 1 marks a; tab 2, which read the log before, marks b and adds a print.
  changePrint(s, a.id, { result: "well" }, at(2));
  changePrint(s, b.id, { result: "failed" }, at(3));
  addPrint(s, { ...made, name: "Third" }, at(4));
  const log = readLog(s).prints;
  assert.deepEqual(log.map((p) => [p.name, p.result]), [["Third", "waiting"], ["Other", "failed"], ["Box", "well"]]);
  assert.equal(removePrint(s, b.id), true);
  assert.equal(removePrint(s, b.id), false);
  assert.deepEqual(readLog(s).prints.map((p) => p.name), ["Third", "Box"]);
});

test("a store it can't read: a newer app's is never written over, other entries are kept", () => {
  const s = memory();
  s.setItem(PRINT_LOG_KEY, JSON.stringify({ version: 2, prints: [] }));
  assert.equal(addPrint(s, made, T0), null);
  assert.equal(JSON.parse(s.getItem(PRINT_LOG_KEY)!).version, 2);
  const odd = { id: "x", future: true };
  s.setItem(PRINT_LOG_KEY, JSON.stringify({ version: 1, prints: [odd] }));
  addPrint(s, made, T0);
  const stored = JSON.parse(s.getItem(PRINT_LOG_KEY)!);
  assert.equal(stored.prints.length, 2);
  assert.deepEqual(stored.prints[1], odd, "kept untouched, after the prints it reads");
  s.setItem(PRINT_LOG_KEY, "not json");
  assert.deepEqual(readLog(s).prints, []);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readLog(blocked).writable, false);
  assert.equal(addPrint(blocked, made, T0), null, "never throws");
});

test("printFrom refuses each broken field", () => {
  const good = printOf(made, T0, "u", "00000000-0000-0000-0000-000000000001");
  assert.deepEqual(printFrom(good), good);
  for (const broken of [{ id: "ABCDEF00-0000-0000-0000-000000000001" }, { madeAt: "yesterday" }, { name: "" }, { name: "n".repeat(101) }, { settings: "s".repeat(201) }, { note: "n".repeat(501) }, { grams: -1 }, { minutes: 1.5 }, { minutes: 100001 }, { result: "ok" }, { problem: "warped" }, { result: "failed", problem: "melted" }, { owner: 3 }]) {
    assert.equal(printFrom({ ...good, ...broken }), null, JSON.stringify(broken));
  }
  assert.ok(printFrom({ ...good, result: "failed", problem: "warped" }));
});

test("keep these in my account: prints of no account become the person's", () => {
  const s = memory();
  addPrint(s, made, T0);
  s.setItem(PRINT_LOG_OWNER_KEY, "other");
  addPrint(s, made, at(1));
  assert.equal(claimPrints(s, "me", at(2)), 1);
  assert.deepEqual(readLog(s).prints.map((p) => p.owner).sort(), ["me", "other"], "another account's print stays theirs");
  assert.equal(claimPrints(s, "me", at(3)), 0);
});

test("the log's counts in words", () => {
  const p = printOf(made, T0, null);
  assert.equal(summaryWords([]), "No prints yet.");
  assert.equal(summaryWords([p]), "1 print: 1 not said yet.");
  assert.equal(summaryWords([changedPrint(p, { result: "well" }, at(1)), changedPrint(p, { result: "well" }, at(1)), changedPrint(p, { result: "failed" }, at(1)), p]), "4 prints: 2 printed well, 1 failed, 1 not said yet.");
});

test("the limits and the problem list are the account's own (supabase print_log.sql)", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261113120000_print_log.sql", import.meta.url), "utf8");
  const limits = /jsonb_build_object\('max_prints', (\d+), 'max_batch', \d+, 'max_name', (\d+), 'max_settings', (\d+), 'max_note', (\d+)\)/.exec(sql);
  assert.ok(limits);
  assert.deepEqual(limits.slice(1).map(Number), [PRINT_LOG_LIMITS.prints, PRINT_LOG_LIMITS.name, PRINT_LOG_LIMITS.settings, PRINT_LOG_LIMITS.note]);
  const lists = [...sql.matchAll(/in \(('came-off'[^)]*)\)/g)].map((m) => m[1].replace(/'|\s/g, "").split(","));
  assert.ok(lists.length >= 2, "the table's check and the save's check");
  for (const list of lists) assert.deepEqual(list, PROBLEMS.map((p) => p.id));
});
