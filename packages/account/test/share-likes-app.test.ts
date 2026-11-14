// The app side of likes (apps/fission/src/share.ts `likeParts`, community C7b) against the fake likes service: what the
// row is given to show, what a press asks, and the words for every refusal. The browser: apps/fission e2e/share-likes.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthClient } from "../src/auth.ts";
import { LIKE_WORDS } from "../src/likes.ts";
import { sharesApi } from "../src/shares.ts";
import { fakeLikes } from "./fake-likes.ts";
import { fakeShares } from "./fake-shares.ts";
import { repoFile } from "./repo-file.ts";

const g = globalThis as unknown as { addEventListener?: unknown };
g.addEventListener ??= () => {};
const { likeParts } = (await import(repoFile("apps/fission/src/share.ts").href)) as typeof import("../../../apps/fission/src/share.ts");

async function world() {
  const shares = fakeShares();
  const likes = fakeLikes(shares);
  const r = await sharesApi(likes.as("ada") as AuthClient).share("Box", "{}", null);
  const id = r.kind === "ok" && r.value.status === "shared" ? r.value.id : "";
  return { shares, likes, id, parts: (user: string | null) => likeParts(likes.as(user), id) };
}

test("hand-worked: Bo likes Ada's link (0 + 1 = 1, his), Cy sees 1 not hers, Bo takes it back (1 − 1 = 0)", async () => {
  const w = await world();
  assert.deepEqual(await w.parts("bo").read(), { count: 0, mine: false });
  assert.deepEqual(await w.parts("bo").set(true), { count: 1, mine: true });
  assert.deepEqual(await w.parts("cy").read(), { count: 1, mine: false });
  assert.deepEqual(await w.parts(null).read(), { count: 1, mine: null }, "signed out: the count, no like of their own");
  assert.deepEqual(await w.parts("bo").set(false), { count: 0, mine: false });
});

test("the count after a press is the service's, with other people's likes in it", async () => {
  const w = await world();
  await w.parts("cy").set(true);
  // Cy's like and then Bo's: 1 + 1 = 2.
  assert.deepEqual(await w.parts("bo").set(true), { count: 2, mine: true });
});

test("every refusal is said in words and changes nothing", async () => {
  const w = await world();
  await assert.rejects(w.parts("ada").set(true), { message: LIKE_WORDS.own });
  w.likes.held.add("bo");
  await assert.rejects(w.parts("bo").set(true), { message: LIKE_WORDS.held });
  w.likes.held.delete("bo");
  w.likes.changes.set("bo", Array.from({ length: 300 }, () => w.likes.clock));
  await assert.rejects(w.parts("bo").set(true), { message: LIKE_WORDS.daily });
  w.likes.changes.set("cy", []);
  await w.parts("cy").set(true);
  w.likes.changes.set("cy", Array.from({ length: 300 }, () => w.likes.clock));
  await assert.rejects(w.parts("cy").set(false), { message: LIKE_WORDS["daily-unlike"] });
  assert.deepEqual(await w.parts(null).read(), { count: 1, mine: null }, "Cy's like still there");
  w.shares.mode = "down";
  await assert.rejects(w.parts("bo").set(true), /internet|connect|offline/i);
});

test("no likes functions at the service yet, sharing off, or a link turned off: no row (null)", async () => {
  const w = await world();
  w.likes.mode = "missing";
  assert.equal(await w.parts("bo").read(), null);
  w.likes.mode = "up";
  w.likes.sharingOn = false;
  assert.equal(await w.parts("bo").read(), null);
  w.likes.sharingOn = true;
  await sharesApi(w.likes.as("ada") as AuthClient).unshare(w.id);
  assert.equal(await w.parts("bo").read(), null);
});

test("sharing switched off between reading and pressing: the like is refused with the off words", async () => {
  const w = await world();
  assert.ok(await w.parts("bo").read());
  w.likes.sharingOn = false;
  await assert.rejects(w.parts("bo").set(true), { message: LIKE_WORDS.off });
});
