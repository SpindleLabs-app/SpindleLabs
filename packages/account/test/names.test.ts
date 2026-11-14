import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AuthClient } from "../src/auth.ts";
import { NAME_ANSWERS, NAME_LIMITS, myNameFrom, nameDate, nameWords, namesApi } from "../src/names.ts";
import { fakeNames } from "./fake-names.ts";
import { repoFile } from "./repo-file.ts";

const api = (s: ReturnType<typeof fakeNames>, user: string | null) => namesApi(s.as(user) as AuthClient);
const DAY = 86_400_000;

test("a first name is saved and read back with the day it may change next (hand-worked: 7 days = 604800 s later)", async () => {
  const s = fakeNames();
  assert.deepEqual(await api(s, "ada").mine(), { kind: "ok", value: null }, "none yet");
  assert.deepEqual(await api(s, "ada").set("Ada L"), { kind: "ok", value: "saved" });
  const got = await api(s, "ada").mine();
  assert.ok(got.kind === "ok" && got.value);
  // Set at 2026-11-11 01:00 UTC; +7 days is 2026-11-18 01:00 UTC.
  assert.equal(got.value.nextChangeAt.toISOString(), "2026-11-18T01:00:00.000Z");
  assert.equal(nameDate(got.value.nextChangeAt, "UTC"), "18 Nov 2026");
});

test("the weekly gap: a change at 0.9 of a week is too soon, at 1.1 it is saved (boundary), and the same name is always saved", async () => {
  const s = fakeNames();
  await api(s, "ada").set("Ada L");
  s.now += 0.9 * 7 * DAY;
  assert.deepEqual(await api(s, "ada").set("Ada Byron"), { kind: "ok", value: "too-soon" });
  assert.deepEqual(await api(s, "ada").set("Ada L"), { kind: "ok", value: "saved" }, "the name they already have changes nothing");
  s.now += 0.2 * 7 * DAY; // 1.1 weeks since
  assert.deepEqual(await api(s, "ada").set("Ada Byron"), { kind: "ok", value: "saved" });
});

test("look-alikes are one name, and another person can't take it; a refusal changes nothing", async () => {
  const s = fakeNames();
  await api(s, "ada").set("Ben_P");
  for (const same of ["ben p", "BEN.P", "Bén-P"]) assert.deepEqual(await api(s, "bo").set(same), { kind: "ok", value: "taken" }, same);
  assert.equal(s.rows.length, 1);
});

test("each refusal: too short, too long, odd characters, two spaces, blocked words (whole, start, end), held", async () => {
  const s = fakeNames();
  const say = async (n: string) => (await api(s, "ada").set(n)) as { value: string };
  assert.equal((await say("ab")).value, "bad");
  assert.equal((await say("a".repeat(NAME_LIMITS.maxLength + 1))).value, "bad");
  assert.equal((await say("a".repeat(NAME_LIMITS.maxLength))).value, "saved", "30 is allowed");
  s.now += 8 * DAY;
  assert.equal((await say("no@signs")).value, "bad");
  assert.equal((await say("two  spaces")).value, "bad");
  assert.equal((await say("-dash")).value, "bad");
  assert.equal((await say("Admin")).value, "blocked");
  assert.equal((await say("the_admin")).value, "blocked", "the end");
  assert.equal((await say("Badminton")).value, "saved", "inside a word is fine");
  s.now += 8 * DAY;
  s.held.add("ada");
  assert.equal((await say("Fresh Name")).value, "held");
});

test("the answers the database gives are checked; a damaged answer is malformed, a missing function is rejected, offline is offline", async () => {
  assert.equal(myNameFrom({ name: "x", changed_at: "nope", next_change_at: "2026-11-18T00:00:00Z" }), null);
  assert.equal(myNameFrom({ name: 5, changed_at: "2026-11-11T00:00:00Z", next_change_at: "2026-11-18T00:00:00Z" }), null);
  const odd = { asPerson: async () => ({ kind: "ok", body: "maybe" }) } as unknown as AuthClient;
  assert.deepEqual(await namesApi(odd).set("Ada L"), { kind: "failed", reason: "malformed" });
  assert.deepEqual(await namesApi({ asPerson: async () => ({ kind: "ok", body: { name: "x" } }) } as unknown as AuthClient).mine(), { kind: "failed", reason: "malformed" });
  const s = fakeNames();
  s.mode = "missing";
  assert.deepEqual(await api(s, "ada").mine(), { kind: "failed", reason: "rejected" });
  s.mode = "down";
  assert.deepEqual(await api(s, "ada").set("Ada L"), { kind: "failed", reason: "offline" });
  assert.deepEqual(await api(fakeNames(), null).set("Ada L"), { kind: "signed-out" });
});

test("every refusal has words, and too-soon names the day", () => {
  for (const a of NAME_ANSWERS) if (a !== "saved") assert.ok(nameWords(a).length > 20, a);
  assert.match(nameWords("too-soon", new Date("2026-11-18T01:00:00Z")), /18 Nov 2026|17 Nov 2026|18 Nov/);
});

test("the limits match the migration", () => {
  const sql = readFileSync(repoFile("supabase/migrations/20261111130000_display_names.sql"), "utf8");
  assert.match(sql, new RegExp(`'min_length', ${NAME_LIMITS.minLength}, 'max_length', ${NAME_LIMITS.maxLength}, 'change_gap_seconds', ${NAME_LIMITS.changeGapSeconds}`));
  for (const a of NAME_ANSWERS) assert.ok(sql.includes(`'${a}'`), a);
});
