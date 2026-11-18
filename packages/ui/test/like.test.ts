// The like row (like.ts) in a real DOM (happy-dom), alone and inside the shared view: hidden until the count is read,
// the count's words worked by hand, a press likes and takes back (aria-pressed), signed out says to sign in and asks
// nothing, a refusal is said and leaves the state, a failed read leaves the row out. The real app: apps/fission
// e2e/share-likes.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { likeCountText, likeRow, type LikeParts, type LikeState, SIGN_IN_TO_LIKE } from "../src/like.ts";
import { sharedView } from "../src/share.ts";

const { Window } = await import("happy-dom");
const doc = () => new Window().document as unknown as Document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const press = async (d: Document, sel: string) => {
  (d.querySelector(sel) as HTMLElement).click();
  await tick();
  await tick();
};
const text = (d: Document, sel: string) => d.querySelector(sel)?.textContent ?? "";

/** A row over a plain model: `count` people like it and `mine` is the person's like; `calls` counts each set. */
function model(start: LikeState, refuse?: string) {
  let s = start;
  const calls: boolean[] = [];
  const parts: LikeParts = {
    read: async () => s,
    set: async (like) => {
      calls.push(like);
      if (refuse) throw new Error(refuse);
      s = { count: s.count + (like ? 1 : -1), mine: like };
      return s;
    },
  };
  return { parts, calls };
}

test("hand-worked count words", () => {
  assert.equal(likeCountText(0), "No likes yet");
  assert.equal(likeCountText(1), "1 like");
  assert.equal(likeCountText(2), "2 likes");
  // 1234 with a thousands comma, as the rest of the app writes numbers.
  assert.equal(likeCountText(1234), "1,234 likes");
});

test("hidden until read; a press likes (2 + 1 = 3, pressed) and a second takes it back (3 − 1 = 2)", async () => {
  const d = doc();
  const m = model({ count: 2, mine: false });
  const row = likeRow(d, "t", m.parts);
  d.body.append(row.element);
  assert.equal(row.element.hidden, true, "nothing shown before the service answers");
  await row.load();
  assert.equal(row.element.hidden, false);
  assert.equal(text(d, "#t-like-count"), "2 likes");
  assert.equal(d.querySelector("#t-like")?.getAttribute("aria-pressed"), "false");
  assert.match(text(d, "#t-like"), /Like$/);
  await press(d, "#t-like");
  assert.equal(text(d, "#t-like-count"), "3 likes");
  assert.equal(d.querySelector("#t-like")?.getAttribute("aria-pressed"), "true");
  assert.match(text(d, "#t-like"), /Liked$/);
  await press(d, "#t-like");
  assert.equal(text(d, "#t-like-count"), "2 likes");
  assert.equal(d.querySelector("#t-like")?.getAttribute("aria-pressed"), "false");
  assert.deepEqual(m.calls, [true, false]);
});

test("signed out: the count shows, and a press says to sign in and asks nothing", async () => {
  const d = doc();
  const m = model({ count: 1, mine: null });
  const row = likeRow(d, "t", m.parts);
  d.body.append(row.element);
  await row.load();
  assert.equal(text(d, "#t-like-count"), "1 like");
  await press(d, "#t-like");
  assert.equal(text(d, "#t-like-status"), SIGN_IN_TO_LIKE);
  assert.deepEqual(m.calls, []);
});

test("a refusal is said with a capital and leaves the count and the button as they were (deliberate break)", async () => {
  const d = doc();
  const m = model({ count: 4, mine: false }, "you shared this design yourself, so you can't like it.");
  const row = likeRow(d, "t", m.parts);
  d.body.append(row.element);
  await row.load();
  await press(d, "#t-like");
  assert.equal(text(d, "#t-like-status"), "You shared this design yourself, so you can't like it.");
  assert.equal(text(d, "#t-like-count"), "4 likes");
  assert.equal(d.querySelector("#t-like")?.getAttribute("aria-pressed"), "false");
});

test("no likes here (null) or a failed read leaves the row out", async () => {
  for (const read of [async () => null, async () => Promise.reject(new Error("offline"))]) {
    const d = doc();
    const row = likeRow(d, "t", { read, set: async () => ({ count: 0, mine: false }) });
    d.body.append(row.element);
    await row.load();
    assert.equal(row.element.hidden, true);
  }
});

test("a second press while the first is waiting asks once", async () => {
  const d = doc();
  let release = () => {};
  const calls: boolean[] = [];
  const row = likeRow(d, "t", {
    read: async () => ({ count: 0, mine: false }),
    set: (like) => {
      calls.push(like);
      return new Promise((r) => (release = () => r({ count: 1, mine: true })));
    },
  });
  d.body.append(row.element);
  await row.load();
  await press(d, "#t-like");
  await press(d, "#t-like");
  release();
  await tick();
  assert.deepEqual(calls, [true]);
  assert.equal(text(d, "#t-like-count"), "1 like");
});

test("the shared view shows the row after the name when given likes, and none without", async () => {
  const parts = { openCopy: async () => {}, report: async () => "kept", closed: () => {} };
  const d = doc();
  const v = sharedView(d, { name: "Box", picture: null, createdAt: new Date() }, { ...parts, like: model({ count: 0, mine: true }).parts });
  await v.show();
  assert.equal(text(d, "#shared-like-count"), "No likes yet");
  assert.equal(d.querySelector("#shared-like")?.getAttribute("aria-pressed"), "true");
  const d2 = doc();
  await sharedView(d2, { name: "Box", picture: null, createdAt: new Date() }, parts).show();
  assert.equal(d2.querySelector("#shared-like-row"), null);
});
