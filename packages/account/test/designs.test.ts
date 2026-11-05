import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthClient } from "../src/auth.ts";
import { readFileSync } from "node:fs";
import { designsApi, isSource, LIMITS, rowFrom, saveAnswerFrom, SOURCES } from "../src/designs.ts";
import { fakeAccount } from "./fake-designs.ts";

const api = (acc: ReturnType<typeof fakeAccount>, user: string | null) => designsApi(acc.as(user) as AuthClient);
const save = { id: null, expected: null, name: "Box", source: "design", body: "{}", picture: null, savedAt: new Date("2026-11-05T01:00:00Z") } as const;

test("a design is saved, listed without its file text, read back whole, and deleted", async () => {
  const acc = fakeAccount();
  const ada = api(acc, "ada");
  const s = await ada.save({ ...save, body: '{"name":"Box"}', picture: "data:image/png;base64,iVBORw0KGgo=" });
  assert.equal(s.kind, "ok");
  assert.equal(s.kind === "ok" && s.value.status, "saved");
  const id = s.kind === "ok" && s.value.status === "saved" ? s.value.id : "";
  const list = await ada.list();
  assert.equal(list.kind, "ok");
  if (list.kind !== "ok") return;
  assert.deepEqual(
    list.value.map((r) => [r.id, r.name, r.source, r.picture, r.bytes, r.revision]),
    // bytes: 14 for the file text + 34 for the picture's data: address
    [[id, "Box", "design", "data:image/png;base64,iVBORw0KGgo=", 14 + 34, 1]],
  );
  assert.deepEqual(await ada.get(id), { kind: "ok", value: { id, name: "Box", source: "design", body: '{"name":"Box"}', savedAt: new Date("2026-11-05T01:00:00Z"), revision: 1 } });
  assert.deepEqual(await ada.space(), { kind: "ok", value: { designs: 1, bytes: 48 } });
  assert.deepEqual(await ada.remove(id), { kind: "ok", value: true });
  assert.deepEqual(await ada.remove(id), { kind: "ok", value: false });
  assert.deepEqual(await ada.get(id), { kind: "ok", value: null });
});

test("another person's design is gone to them", async () => {
  const acc = fakeAccount();
  const s = await api(acc, "ada").save(save);
  const id = s.kind === "ok" && s.value.status === "saved" ? s.value.id : "";
  const bo = api(acc, "bo");
  assert.deepEqual(await bo.get(id), { kind: "ok", value: null });
  assert.deepEqual(await bo.save({ ...save, id, expected: 1 }), { kind: "ok", value: { status: "gone" } });
  assert.deepEqual(await bo.remove(id), { kind: "ok", value: false });
  assert.deepEqual(await bo.list(), { kind: "ok", value: [] });
});

test("signed out, nothing is asked; offline is reported as offline", async () => {
  const acc = fakeAccount();
  const nobody = api(acc, null);
  assert.deepEqual(await nobody.list(), { kind: "signed-out" });
  assert.deepEqual(await nobody.setKeeping(false), { kind: "signed-out" });
  acc.mode = "down";
  assert.deepEqual(await api(acc, "ada").save(save), { kind: "failed", reason: "offline" });
});

test("keeping designs is on by default and can be turned off", async () => {
  const acc = fakeAccount();
  const ada = api(acc, "ada");
  assert.deepEqual(await ada.keeping(), { kind: "ok", value: true });
  assert.deepEqual(await ada.setKeeping(false), { kind: "ok", value: false });
  assert.deepEqual(await ada.keeping(), { kind: "ok", value: false });
  assert.deepEqual(await ada.save(save), { kind: "ok", value: { status: "off" } });
});

test("every answer of the wrong shape is refused as malformed, never trusted", async () => {
  const acc = fakeAccount();
  const ada = api(acc, "ada");
  const good = { id: "00000000-0000-4000-8000-000000000001", name: "Box", source: "design", picture: null, bytes: 2, saved_at: "2026-11-05T01:00:00Z", updated_at: "2026-11-05T01:00:01Z", revision: 1 };
  assert.notEqual(rowFrom(good), null);
  const bads: unknown[] = [
    null,
    "text",
    { ...good, id: "not-a-uuid" },
    { ...good, source: "spreadsheet" },
    { ...good, picture: "https://tracker.example/p.png" },
    { ...good, picture: "data:text/html;base64,PHNjcmlwdD4=" },
    { ...good, revision: 0 },
    { ...good, bytes: -1 },
    { ...good, saved_at: "yesterday" },
    { ...good, name: 5 },
  ];
  for (const bad of bads) {
    assert.equal(rowFrom(bad), null, JSON.stringify(bad));
    acc.nextBody = [good, bad];
    assert.deepEqual(await ada.list(), { kind: "failed", reason: "malformed" }, JSON.stringify(bad));
  }
  for (const bad of [null, {}, { status: "saved" }, { status: "saved", id: good.id, revision: 0 }, { status: "changed" }, { status: "maybe" }]) {
    assert.equal(saveAnswerFrom(bad), null, JSON.stringify(bad));
    acc.nextBody = bad;
    assert.deepEqual(await ada.save(save), { kind: "failed", reason: "malformed" });
  }
  acc.nextBody = { id: good.id, name: "Box", source: "design", body: 5, saved_at: good.saved_at, revision: 1 };
  assert.deepEqual(await ada.get(good.id), { kind: "failed", reason: "malformed" });
  acc.nextBody = { id: "00000000-0000-4000-8000-000000000002", name: "Box", source: "design", body: "{}", saved_at: good.saved_at, revision: 1 };
  assert.deepEqual(await ada.get(good.id), { kind: "failed", reason: "malformed" }, "an answer for another design");
  acc.nextBody = "yes";
  assert.deepEqual(await ada.remove(good.id), { kind: "failed", reason: "malformed" });
});

test("an id that isn't one is never sent", async () => {
  const acc = fakeAccount();
  const ada = api(acc, "ada");
  assert.deepEqual(await ada.get("../profiles"), { kind: "ok", value: null });
  assert.deepEqual(await ada.remove("x"), { kind: "ok", value: false });
  assert.deepEqual(await ada.versions("x"), { kind: "ok", value: [] });
  assert.deepEqual(await ada.version("x", new Date()), { kind: "ok", value: null });
  assert.deepEqual(await ada.version("00000000-0000-4000-8000-000000000001", new Date(NaN)), { kind: "ok", value: null });
  assert.deepEqual(acc.calls, []);
});

// Account features 2: the copy each save replaces is kept in the account (the rules: test_design_versions.py).
test("hand-worked: earlier versions in the account, listed newest first and read back, only the person's own", async () => {
  const acc = fakeAccount();
  const ada = api(acc, "ada");
  const t = (min: number) => new Date(Date.UTC(2026, 10, 5, 9, min));
  // A at 09:00, B at 09:05, C at 09:12, D at 09:20: B replaces A (kept: none before); C replaces B (09:05 is only 5
  // minutes after 09:00: not kept); D replaces C (09:12 is 12 minutes after 09:00: kept). So 09:12 then 09:00.
  const first = await ada.save({ ...save, body: "A", savedAt: t(0) });
  const id = first.kind === "ok" && first.value.status === "saved" ? first.value.id : "";
  let rev = 1;
  for (const [body, min] of [["B", 5], ["C", 12], ["D", 20]] as const) {
    const r = await ada.save({ ...save, id, expected: rev, body, savedAt: t(min) });
    rev = r.kind === "ok" && r.value.status === "saved" ? r.value.revision : -1;
  }
  assert.deepEqual(await ada.versions(id), { kind: "ok", value: [t(12), t(0)] });
  assert.deepEqual(await ada.version(id, t(12)), { kind: "ok", value: "C" });
  assert.deepEqual(await ada.version(id, t(5)), { kind: "ok", value: null }, "B was never kept");
  const bo = api(acc, "bo");
  assert.deepEqual(await bo.versions(id), { kind: "ok", value: [] });
  assert.deepEqual(await bo.version(id, t(0)), { kind: "ok", value: null });
  for (const bad of [null, {}, [{ saved_at: "yesterday" }], [{}], "x"]) {
    acc.nextBody = bad;
    assert.deepEqual(await ada.versions(id), { kind: "failed", reason: "malformed" }, JSON.stringify(bad));
  }
  for (const bad of [{}, { body: 5 }, "C"]) {
    acc.nextBody = bad;
    assert.deepEqual(await ada.version(id, t(12)), { kind: "failed", reason: "malformed" }, JSON.stringify(bad));
  }
  acc.mode = "down";
  assert.deepEqual(await ada.versions(id), { kind: "failed", reason: "offline" });
});

test("the workspace tags and limits match the database's", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261105120000_my_designs.sql", import.meta.url), "utf8");
  const list = /source in \(([^)]*)\)/.exec(sql)![1]!.split(",").map((t) => t.trim().replace(/'/g, ""));
  assert.deepEqual([...SOURCES], list);
  // The newest limits are the versions migration's (it replaces design_limits()), which keeps the first four as they were.
  const latest = readFileSync(new URL("../../../supabase/migrations/20261105180000_design_versions.sql", import.meta.url), "utf8");
  for (const s of [sql, latest]) assert.match(s, new RegExp(`'max_designs', ${LIMITS.maxDesigns}, 'max_bytes', ${LIMITS.maxBytes}, 'max_design_bytes', ${LIMITS.maxDesignBytes}, 'max_picture_bytes', ${LIMITS.maxPictureBytes}[,)]`));
  assert.match(latest, new RegExp(`'versions_kept', ${LIMITS.versionsKept}, 'version_gap_seconds', ${LIMITS.versionGapMinutes * 60}\\)`));
  assert.equal(isSource("slice"), true);
  assert.equal(isSource("Slice"), false);
});
