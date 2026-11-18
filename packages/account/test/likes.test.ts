import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthClient } from "../src/auth.ts";
import { LIKE_ANSWERS, LIKE_LIMITS, likesApi, LIKE_WORDS, UNLIKE_ANSWERS } from "../src/likes.ts";
import { sharesApi } from "../src/shares.ts";
import { fakeLikes, type FakeLikes } from "./fake-likes.ts";
import { fakeShares } from "./fake-shares.ts";

function world(seed = 1) {
  const shares = fakeShares(seed);
  const likes = fakeLikes(shares);
  const as = (user: string | null) => likesApi(likes.as(user));
  const share = async (user: string, name = "Box") => {
    const r = await sharesApi(likes.as(user) as AuthClient).share(name, "{}", null);
    assert.ok(r.kind === "ok" && r.value.status === "shared");
    return r.kind === "ok" && r.value.status === "shared" ? r.value.id : "";
  };
  return { shares, likes, as, share };
}
const value = <T>(r: { kind: string; value?: T }) => (r.kind === "ok" ? r.value : r);

test("hand-worked: two people like Ada's link once each, so its count is 2; a repeat changes nothing; never your own", async () => {
  const { as, share } = world();
  const id = await share("ada");
  assert.equal(value(await as(null).count(id)), 0, "a fresh link: nobody has liked it");
  assert.equal(value(await as("bo").like(id)), "liked");
  assert.equal(value(await as("cy").like(id)), "liked");
  // Bo and Cy, one like each: 1 + 1 = 2.
  assert.equal(value(await as(null).count(id)), 2, "the count is for anyone, signed in or not");
  assert.equal(value(await as("bo").like(id)), "already");
  assert.equal(value(await as(null).count(id)), 2, "a second like from Bo is not a third like");
  assert.equal(value(await as("ada").like(id)), "own");
  assert.equal(value(await as("ada").mine(id)), false);
  assert.equal(value(await as("bo").mine(id)), true);
  // Bo takes his back: 2 − 1 = 1, and a second unlike changes nothing.
  assert.equal(value(await as("bo").unlike(id)), "unliked");
  assert.equal(value(await as("bo").unlike(id)), "not-liked");
  assert.equal(value(await as(null).count(id)), 1);
  assert.equal(value(await as("bo").mine(id)), false);
});

test("signed out: the count only; liking, unliking and asking whether you like it need an account and ask nothing", async () => {
  const { as, share, shares } = world();
  const id = await share("ada");
  const before = shares.calls.length;
  assert.deepEqual(await as(null).like(id), { kind: "signed-out" });
  assert.deepEqual(await as(null).unlike(id), { kind: "signed-out" });
  assert.deepEqual(await as(null).mine(id), { kind: "signed-out" });
  assert.equal(value(await as(null).count(id)), 0);
  assert.equal(shares.calls.length - before, 4);
});

test("a held account can't like, and its likes stop counting while it is held", async () => {
  const { as, share, likes } = world();
  const a = await share("ada");
  const b = await share("ada", "Plate");
  await as("bo").like(a);
  await as("cy").like(a);
  likes.held.add("cy");
  // Two likes, one from a held account: 2 − 1 = 1.
  assert.equal(value(await as(null).count(a)), 1);
  assert.equal(value(await as("cy").like(b)), "held");
  assert.equal(likes.changes.get("cy")?.length, 1, "the refused like took back the change it counted");
  assert.equal(value(await as("cy").unlike(a)), "unliked", "taking your own like back is always allowed");
  likes.held.delete("cy");
  assert.equal(value(await as(null).count(a)), 1, "Cy's like went with the unlike");
});

test("the off switch hides every count and stops liking; taking a like back still works", async () => {
  const { as, share, likes } = world();
  const id = await share("ada");
  await as("bo").like(id);
  likes.sharingOn = false;
  assert.equal(value(await as(null).count(id)), null);
  assert.equal(value(await as("cy").like(id)), "off");
  assert.equal(value(await as("bo").mine(id)), false);
  assert.equal(value(await as("bo").unlike(id)), "unliked");
});

test("a link turned off has no count and forgets its likes; a link that never was is gone", async () => {
  const { as, share, likes } = world();
  const id = await share("ada");
  await as("bo").like(id);
  await sharesApi(likes.as("ada") as AuthClient).unshare(id);
  assert.equal(value(await as(null).count(id)), null);
  assert.equal(value(await as("cy").like(id)), "gone");
  assert.equal(value(await as("bo").unlike(id)), "not-liked", "its likes were deleted with it");
  const never = "10000000-0000-4000-8000-0000000fffff";
  assert.equal(value(await as(null).count(never)), null);
  assert.equal(value(await as("bo").like(never)), "gone");
});

test("a malformed id asks nothing", async () => {
  const { as, shares } = world();
  const before = shares.calls.length;
  assert.deepEqual(await as("bo").like("not-an-id"), { kind: "ok", value: "gone" });
  assert.deepEqual(await as("bo").unlike("x"), { kind: "ok", value: "not-liked" });
  assert.deepEqual(await as("bo").mine("x"), { kind: "ok", value: false });
  assert.deepEqual(await as(null).count("x"), { kind: "ok", value: null });
  assert.equal(shares.calls.length, before);
});

/** Bo likes and unlikes link `id` `n` times in a row (one change each), returning how many went through. */
async function churn(likes: FakeLikes, id: string, n: number): Promise<{ through: number; daily: number }> {
  const bo = likesApi(likes.as("bo"));
  let through = 0;
  let daily = 0;
  for (let i = 0; i < n; i++) {
    const r = i % 2 === 0 ? await bo.like(id) : await bo.unlike(id);
    if (r.kind === "ok" && (r.value === "liked" || r.value === "unliked")) through++;
    if (r.kind === "ok" && r.value === "daily") daily++;
  }
  return { through, daily };
}

test("the daily cap: 0.9× of 300 changes all go through; at 1.1× the 301st on are refused, until a day has passed", async () => {
  const w = world();
  const id = await w.share("ada");
  // 0.9 × 300 = 270 changes, all under the cap.
  assert.deepEqual(await churn(w.likes, id, 270), { through: 270, daily: 0 });
  const w2 = world(2);
  const id2 = await w2.share("ada");
  // 1.1 × 300 = 330 tries: the first 300 go through. Of the 30 after them, the 15 likes are refused as daily, and the 15
  // unlikes find nothing to take back (Bo's like was refused), which is not-liked and costs nothing.
  assert.deepEqual(await churn(w2.likes, id2, 330), { through: 300, daily: 15 });
  // 300 changes, an even number, alternating like/unlike from not liking: Bo ends not liking it.
  assert.equal(value(await w2.as("bo").mine(id2)), false);
  assert.equal(value(await w2.as("bo").like(id2)), "daily");
  assert.equal(value(await w2.as("cy").like(id2)), "liked", "the cap is Bo's own: Cy can still like it (control)");
  w2.likes.clock += 86_400_000;
  assert.equal(value(await w2.as("bo").like(id2)), "liked", "a day later the changes are forgotten");
  // A repeated or refused one costs nothing.
  assert.equal(value(await w2.as("bo").like(id2)), "already");
  assert.equal(w2.likes.changes.get("bo")?.length, 1);
});

test("every answer is checked: a wrongly shaped one is malformed, never shown (deliberate breaks)", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const answering = (body: unknown) => likesApi({ asPerson: async () => ({ kind: "ok", body }), asAnyone: async () => ({ kind: "ok", body }) });
  const bad = { kind: "failed", reason: "malformed" };
  for (const body of [-1, 1.5, "3", true, {}, Number.MAX_SAFE_INTEGER + 2]) assert.deepEqual(await answering(body).count(id), bad, `count ${String(body)}`);
  assert.deepEqual(await answering(7).count(id), { kind: "ok", value: 7 });
  assert.deepEqual(await answering(null).count(id), { kind: "ok", value: null });
  for (const body of ["true", 1, null]) assert.deepEqual(await answering(body).mine(id), bad, `mine ${String(body)}`);
  for (const body of ["Liked", "unliked", null, 1]) assert.deepEqual(await answering(body).like(id), bad, `like ${String(body)}`);
  for (const body of ["liked", "gone", null]) assert.deepEqual(await answering(body).unlike(id), bad, `unlike ${String(body)}`);
  for (const a of LIKE_ANSWERS) assert.deepEqual(await answering(a).like(id), { kind: "ok", value: a });
  for (const a of UNLIKE_ANSWERS) assert.deepEqual(await answering(a).unlike(id), { kind: "ok", value: a });
});

test("a service without the likes functions (migration not applied yet) answers rejected, and a service down offline", async () => {
  const { as, share, likes, shares } = world();
  const id = await share("ada");
  likes.mode = "missing";
  assert.deepEqual(await as(null).count(id), { kind: "failed", reason: "rejected" });
  assert.deepEqual(await as("bo").like(id), { kind: "failed", reason: "rejected" });
  likes.mode = "up";
  shares.mode = "down";
  assert.deepEqual(await as(null).count(id), { kind: "failed", reason: "offline" });
});

test("words: every refusal has a sentence", () => {
  for (const k of ["gone", "own", "held", "daily", "off", "daily-unlike"] as const) assert.ok(LIKE_WORDS[k].length > 10, k);
  assert.match(LIKE_WORDS.daily, /300/);
});

test("the constants and answers match the migration", async () => {
  const { readFileSync } = await import("node:fs");
  const { repoFile } = await import("./repo-file.ts");
  const sql = readFileSync(repoFile("supabase/migrations/20261111170000_likes.sql"), "utf8");
  assert.ok(sql.includes(`'changes_per_day', ${LIKE_LIMITS.changesPerDay}`));
  for (const a of LIKE_ANSWERS) assert.ok(sql.includes(`return '${a}'`), a);
  for (const a of UNLIKE_ANSWERS) assert.ok(sql.includes(`return '${a}'`), a);
  // Exactly these: no answer in the SQL that the app doesn't know.
  const returned = new Set([...sql.matchAll(/return '([a-z-]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...returned].sort(), [...new Set([...LIKE_ANSWERS, ...UNLIKE_ANSWERS])].sort());
});

/** mulberry32: a small seeded random source. */
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

test("60 seeded sessions against a plain model: who likes what, counts, holds and the switch", async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = mulberry(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;
    const w = world(seed);
    const people = ["ada", "bo", "cy", "di"] as const;
    const links = [await w.share("ada"), await w.share("bo", "Plate")];
    const owner = new Map([[links[0], "ada"], [links[1], "bo"]]);
    const model = new Set<string>(); // "<link> <person>"
    const held = new Set<string>();
    let on = true;
    for (let step = 0; step < 40; step++) {
      const who = pick(people);
      const id = pick(links) as string;
      const roll = rand();
      const key = `${id} ${who}`;
      if (roll < 0.45) {
        const want = !on ? "off" : owner.get(id) === who ? "own" : model.has(key) ? "already" : held.has(who) ? "held" : "liked";
        assert.equal(value(await w.as(who).like(id)), want, `seed ${seed} step ${step} like`);
        if (want === "liked") model.add(key);
      } else if (roll < 0.75) {
        const want = model.has(key) ? "unliked" : "not-liked";
        assert.equal(value(await w.as(who).unlike(id)), want, `seed ${seed} step ${step} unlike`);
        model.delete(key);
      } else if (roll < 0.85) {
        if (held.has(who)) held.delete(who), w.likes.held.delete(who);
        else held.add(who), w.likes.held.add(who);
      } else if (roll < 0.9) {
        on = !on;
        w.likes.sharingOn = on;
      } else {
        const want = on ? [...model].filter((k) => k.startsWith(`${id} `) && !held.has(k.split(" ")[1] as string)).length : null;
        assert.equal(value(await w.as(null).count(id)), want, `seed ${seed} step ${step} count`);
        assert.equal(value(await w.as(who).mine(id)), on && model.has(key), `seed ${seed} step ${step} mine`);
      }
    }
  }
});
