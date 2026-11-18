import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthClient } from "../src/auth.ts";
import { isShareId, REPORT_KINDS, SHARE_LIMITS, shareAnswerFrom, shareRowFrom, sharesApi } from "../src/shares.ts";
import { fakeShares } from "./fake-shares.ts";

const api = (s: ReturnType<typeof fakeShares>, user: string | null) => sharesApi(s.as(user) as AuthClient);
const shareId = async (a: ReturnType<typeof api>, body = "{}") => {
  const r = await a.share("Box", body, null);
  assert.ok(r.kind === "ok" && r.value.status === "shared");
  return r.kind === "ok" && r.value.status === "shared" ? r.value.id : "";
};

test("a link opens for someone not signed in, as the frozen copy, and lists for its owner only", async () => {
  const s = fakeShares();
  const id = await shareId(api(s, "ada"), '{"name":"Box"}');
  const got = await api(s, null).open(id);
  assert.deepEqual(got.kind === "ok" && got.value && [got.value.name, got.value.body], ["Box", '{"name":"Box"}']);
  assert.deepEqual(Object.keys(got.kind === "ok" && got.value ? got.value : {}).sort(), ["body", "createdAt", "id", "name", "picture"], "never says who shared it");
  const mine = await api(s, "ada").list();
  assert.equal(mine.kind === "ok" && mine.value.length, 1);
  const theirs = await api(s, "bo").list();
  assert.equal(theirs.kind === "ok" && theirs.value.length, 0);
});

test("turning a link off stops it opening; another person cannot turn it off; it cannot be turned off twice", async () => {
  const s = fakeShares();
  const id = await shareId(api(s, "ada"));
  assert.deepEqual(await api(s, "bo").unshare(id), { kind: "ok", value: false });
  assert.deepEqual(await api(s, "ada").unshare(id), { kind: "ok", value: true });
  assert.deepEqual(await api(s, "ada").unshare(id), { kind: "ok", value: false });
  assert.deepEqual(await api(s, null).open(id), { kind: "ok", value: null });
  assert.equal(s.rows[0]?.body, "", "its copy is gone");
});

test("a signed-out person cannot make or list links, a malformed id asks nothing", async () => {
  const s = fakeShares();
  assert.deepEqual(await api(s, null).share("x", "{}", null), { kind: "signed-out" });
  assert.deepEqual(await api(s, null).list(), { kind: "signed-out" });
  assert.deepEqual(await api(s, null).open("not-an-id"), { kind: "ok", value: null });
  assert.deepEqual(await api(s, "ada").unshare("../x"), { kind: "ok", value: false });
  assert.deepEqual(s.calls, ["rpc/share_design", "rpc/my_shares"]);
});

test("the file limit: 0.9x of 5 MiB shares, 1.1x is too big", async () => {
  const s = fakeShares();
  const ada = api(s, "ada");
  const at = (x: number) => ada.share("Box", "x".repeat(Math.round(SHARE_LIMITS.maxShareBytes * x)), null);
  assert.equal((await at(0.9)).kind === "ok" && (await at(0.9)).kind, "ok");
  assert.deepEqual(await at(1.1), { kind: "ok", value: { status: "too-big" } });
});

test("50 links on at once: the 51st is full (made across days, so the daily limit is not what stops it)", async () => {
  const s = fakeShares();
  const ada = api(s, "ada");
  for (let i = 0; i < 50; i++) {
    if (i % 15 === 0) for (const r of s.rows) r.createdAt = "2026-01-01T00:00:00.000Z";
    const r = await ada.share("Box", "{}", null);
    assert.ok(r.kind === "ok" && r.value.status === "shared", `link ${i + 1}`);
  }
  for (const r of s.rows) r.createdAt = "2026-01-01T00:00:00.000Z";
  assert.deepEqual(await ada.share("Box", "{}", null), { kind: "ok", value: { status: "full" } });
});

test("20 new links a day, turned-off ones counting", async () => {
  const s = fakeShares();
  const ada = api(s, "ada");
  for (let i = 0; i < 20; i++) await ada.share("Box", "{}", null);
  for (const r of s.rows) Object.assign(r, { offAt: "2026-11-11T01:00:00.000Z", body: "" });
  assert.deepEqual(await ada.share("Box", "{}", null), { kind: "ok", value: { status: "daily" } });
});

test("reports: kept from anyone, a bad kind or a reason over 1000 is bad, 5 a person, gone for a link that is off", async () => {
  const s = fakeShares();
  const id = await shareId(api(s, "ada"));
  assert.deepEqual(await api(s, null).report(id, "weapon", "a gun part"), { kind: "ok", value: "kept" });
  assert.deepEqual(await api(s, "bo").report(id, "other", "x".repeat(900)), { kind: "ok", value: "kept" }); // 0.9 x 1000
  assert.deepEqual(await api(s, "bo").report(id, "other", "x".repeat(1100)), { kind: "ok", value: "bad" }); // 1.1 x 1000
  assert.deepEqual(await api(s, "bo").report(id, "spam" as never, ""), { kind: "ok", value: "bad" });
  for (let i = 0; i < 4; i++) await api(s, "bo").report(id, "copied", "");
  assert.deepEqual(await api(s, "bo").report(id, "copied", ""), { kind: "ok", value: "enough" });
  await api(s, "ada").unshare(id);
  assert.deepEqual(await api(s, null).report(id, "copied", ""), { kind: "ok", value: "gone" });
});

test("reporting your own link keeps nothing and says so", async () => {
  const s = fakeShares();
  const id = await shareId(api(s, "ada"));
  assert.deepEqual(await api(s, "ada").report(id, "other", ""), { kind: "ok", value: "own" });
  assert.equal(s.reports.length, 0);
  assert.deepEqual(await api(s, "bo").report(id, "other", ""), { kind: "ok", value: "kept" });
});

test("a held account's answers are passed on as \"held\"", () => {
  assert.deepEqual(shareAnswerFrom({ status: "held" }), { status: "held" });
  const held = { asPerson: async () => ({ kind: "ok", body: "held" }), asAnyone: async () => ({ kind: "ok", body: "held" }), state: () => ({ kind: "signed-out" }) };
  return sharesApi(held as never).report("10000000-0000-4000-8000-000000000001", "other", "").then((r) => assert.deepEqual(r, { kind: "ok", value: "held" }));
});

test("a failing service is passed on as it is, and a wrong shape is malformed", async () => {
  const s = fakeShares();
  s.mode = "down";
  assert.deepEqual(await api(s, "ada").share("x", "{}", null), { kind: "failed", reason: "offline" });
  assert.deepEqual(await api(s, null).open("10000000-0000-4000-8000-000000000001"), { kind: "failed", reason: "offline" });
  const bad = { asPerson: async () => ({ kind: "ok", body: { status: "shared", id: "nope" } }), asAnyone: async () => ({ kind: "ok", body: { id: "x" } }), state: () => ({ kind: "signed-out" }) };
  assert.deepEqual(await sharesApi(bad as never).share("x", "{}", null), { kind: "failed", reason: "malformed" });
});

test("answer checks: row and answer shapes", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  assert.equal(shareRowFrom({ id, name: "a", picture: "javascript:alert(1)", bytes: 1, created_at: "2026-11-11T00:00:00Z", removed_at: null }), null);
  assert.equal(shareRowFrom({ id, name: "a", picture: null, bytes: 1, created_at: "2026-11-11T00:00:00Z", removed_at: "bad" }), null);
  assert.ok(shareRowFrom({ id, name: "a", picture: null, bytes: 1, created_at: "2026-11-11T00:00:00Z", removed_at: "2026-11-11T01:00:00Z" })?.removedAt);
  assert.equal(shareAnswerFrom({ status: "shared", id: "nope", created_at: "2026-11-11T00:00:00Z" }), null);
  assert.equal(isShareId("10000000-0000-4000-8000-00000000000G"), false);
});

test("the constants match the migration", async () => {
  const { readFileSync } = await import("node:fs");
  const { repoFile } = await import("./repo-file.ts");
  const sql = readFileSync(repoFile("supabase/migrations/20261111120000_shares.sql"), "utf8");
  for (const [k, v] of Object.entries({ max_links: 50, max_bytes: 20971520, max_share_bytes: 5242880, max_picture_bytes: 32768, links_per_day: 20, reports_per_person: 5, reports_per_link: 200, max_reason: 1000 })) assert.ok(sql.includes(`'${k}', ${v}`), k);
  for (const k of REPORT_KINDS) assert.ok(sql.includes(`'${k}'`), k);
  assert.equal(REPORT_KINDS.length, 8);
});
