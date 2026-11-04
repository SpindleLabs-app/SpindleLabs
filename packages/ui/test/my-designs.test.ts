// My designs (my-designs.ts): the words worked out by hand, the rows, and the dialog in a real DOM (happy-dom): Open
// opens and closes, a refused Open says why and stays, Delete asks first, the keep switch saves and is put back when
// refused, a list that can't be read says why. The real app in Chromium: apps/fission/e2e/my-designs.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designRows, KEEPING_OFF_NOTE, myDesigns, NO_DESIGNS, othersWords, removeQuestion, sizeWords, spaceWords, tagOf, type AccountDesign, type MyDesignsParts } from "../src/my-designs.ts";

const { Window } = await import("happy-dom");

const NOW = new Date(Date.UTC(2026, 10, 5, 12, 0, 0));
const MIN = 60_000;
const day = (d: Date) => `day ${d.toISOString().slice(0, 10)}`;
const LIMITS = { maxDesigns: 200, maxBytes: 20 * 1024 * 1024 };

test("hand-worked: sizes and space in plain words", () => {
  assert.equal(sizeWords(0), "0 kB");
  // 1 byte rounds to 0 kB, but anything kept shows at least 1 kB.
  assert.equal(sizeWords(1), "1 kB");
  // 1,536 bytes = 1.5 kB, which rounds to 2 kB.
  assert.equal(sizeWords(1536), "2 kB");
  // 1,048,575 bytes is 1 byte under 1 MB: 1023.999 kB rounds to 1024 kB, still in kB.
  assert.equal(sizeWords(1024 * 1024 - 1), "1024 kB");
  // 1 MB exactly; 1.25 MB floors to 1.2 (never rounds up past what is used).
  assert.equal(sizeWords(1024 * 1024), "1.0 MB");
  assert.equal(sizeWords(1.25 * 1024 * 1024), "1.2 MB");
  // The limit itself: 20,971,520 bytes = 20 MB.
  assert.equal(sizeWords(20 * 1024 * 1024), "20.0 MB");
  assert.equal(spaceWords({ designs: 3, bytes: 1.25 * 1024 * 1024 }, LIMITS), "3 of 200 designs · 1.2 MB of 20.0 MB used");
});

test("tags are the workspaces' names", () => {
  assert.equal(tagOf("design"), "Design");
  assert.equal(tagOf("slice"), "Slice");
  assert.equal(tagOf("laser"), "Laser");
  assert.equal(tagOf("future"), "Future", "a tag a newer build adds still shows");
});

const designs: AccountDesign[] = [
  { id: "d1", name: "Bracket", source: "slice", picture: "data:image/png;base64,iVBORw0KGgo=", savedAt: new Date(NOW.getTime() - 5 * MIN) },
  { id: "d2", name: "", source: "design", picture: null, savedAt: new Date(NOW.getTime() - 26 * 60 * MIN) },
];

test("rows: name (Untitled when empty), tag, when, the open one marked", () => {
  const rows = designRows(designs, "d2", NOW, day);
  assert.deepEqual(
    rows.map((r) => [r.id, r.name, r.tag, r.when, r.open]),
    [
      ["d1", "Bracket", "Slice", "Saved 5 minutes ago", false],
      // 26 hours ago is more than a day: its date.
      ["d2", "Untitled", "Design", "Saved day 2026-11-04 · open now", true],
    ],
  );
});

function page(over: Partial<MyDesignsParts> = {}) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const calls: string[] = [];
  let list = [...designs];
  let keeping = true;
  const parts: MyDesignsParts = {
    list: async () => list,
    openRemote: () => "d2",
    open: async (id) => void calls.push(`open ${id}`),
    remove: async (id) => {
      calls.push(`remove ${id}`);
      list = list.filter((d) => d.id !== id);
    },
    space: async () => ({ designs: list.length, bytes: 2048 }),
    limits: LIMITS,
    keeping: async () => keeping,
    setKeeping: async (yes) => {
      calls.push(`keep ${yes}`);
      keeping = yes;
    },
    syncWords: () => "",
    others: () => null,
    keepOthers: async (keep) => void calls.push(`others ${keep}`),
    now: () => NOW,
    ...over,
  };
  const dialog = myDesigns(doc, parts);
  const rows = () => [...doc.querySelectorAll<HTMLLIElement>("#my-designs-items .my-design")];
  const row = (id: string) => rows().find((r) => r.dataset.id === id)!;
  const buttons = (id: string) => [...row(id).querySelectorAll("button")].map((b) => b.textContent);
  const click = (id: string, cls: string) => row(id).querySelector<HTMLButtonElement>(`.${cls}`)!.click();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const status = () => doc.getElementById("my-designs-status")!.textContent;
  const keep = () => doc.getElementById("my-designs-keep") as HTMLInputElement;
  return { doc, dialog, calls, rows, row, buttons, click, settle, status, keep };
}

test("the dialog lists the account's designs with pictures, tags and the space used", async () => {
  const { dialog, rows, row, buttons, doc, keep } = page();
  await dialog.show();
  assert.equal(dialog.open, true);
  assert.deepEqual(rows().map((r) => r.dataset.id), ["d1", "d2"]);
  assert.equal(row("d1").querySelector("img")!.getAttribute("src"), "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(row("d2").querySelector("img"), null, "no picture: a plain box");
  assert.equal(row("d1").querySelector(".my-design-tag")!.textContent, "Slice");
  assert.deepEqual(buttons("d1"), ["Open", "Delete"]);
  assert.deepEqual(buttons("d2"), ["Delete"], "the one open now has nothing to open");
  assert.equal(doc.getElementById("my-designs-space")!.textContent, "2 of 200 designs · 2 kB of 20.0 MB used");
  assert.equal(keep().checked, true);
  assert.equal(keep().disabled, false);
});

test("Open hands over the design's id and closes; a refused Open says why and stays", async () => {
  const ok = page();
  await ok.dialog.show();
  ok.click("d1", "my-design-open");
  await ok.settle();
  assert.deepEqual(ok.calls, ["open d1"]);
  assert.equal(ok.dialog.open, false);
  const bad = page({ open: async () => Promise.reject(new Error("couldn't reach your account")) });
  await bad.dialog.show();
  bad.click("d1", "my-design-open");
  await bad.settle();
  await bad.settle();
  assert.equal(bad.dialog.open, true);
  assert.equal(bad.status(), "Couldn't reach your account");
});

test("Delete asks first, Keep it backs out, Delete deletes from the account", async () => {
  const { dialog, click, calls, row, rows, settle } = page();
  await dialog.show();
  click("d1", "my-design-delete");
  assert.equal(row("d1").querySelector(".my-design-question")!.textContent, removeQuestion("Bracket"));
  assert.deepEqual(calls, [], "nothing deleted by the first press");
  click("d1", "my-design-keep");
  assert.equal(row("d1").querySelector(".my-design-question"), null);
  click("d1", "my-design-delete");
  click("d1", "my-design-delete-sure");
  await settle();
  await settle();
  assert.deepEqual(calls, ["remove d1"]);
  assert.deepEqual(rows().map((r) => r.dataset.id), ["d2"]);
});

test("the keep switch saves; refused, it goes back and says why; off, the dialog says nothing is sent", async () => {
  const p = page();
  await p.dialog.show();
  p.keep().checked = false;
  p.keep().dispatchEvent(new p.doc.defaultView!.Event("change"));
  await p.settle();
  await p.settle();
  assert.deepEqual(p.calls, ["keep false"]);
  assert.equal(p.keep().checked, false);
  assert.equal(p.status(), KEEPING_OFF_NOTE);
  const bad = page({ setKeeping: async () => Promise.reject(new Error("you're offline")) });
  await bad.dialog.show();
  bad.keep().checked = false;
  bad.keep().dispatchEvent(new bad.doc.defaultView!.Event("change"));
  await bad.settle();
  await bad.settle();
  assert.equal(bad.keep().checked, true, "put back");
  assert.equal(bad.status(), "You're offline");
});

test("no designs, a list that can't be read, and an unknown keep choice each say so", async () => {
  const empty = page({ list: async () => [] });
  await empty.dialog.show();
  assert.equal(empty.status(), NO_DESIGNS);
  const broken = page({ list: async () => Promise.reject(new Error("You're offline.")), keeping: async () => null, space: async () => null });
  await broken.dialog.show();
  assert.equal(broken.status(), "Your designs can't be listed right now. You're offline.");
  assert.equal(broken.keep().disabled, true, "a choice that can't be read can't be changed");
  assert.equal(broken.doc.getElementById("my-designs-space")!.textContent, "");
});

test("words from the last sending round show when there is nothing else to say", async () => {
  const p = page({ syncWords: () => "Your account's space is full." });
  await p.dialog.show();
  assert.equal(p.status(), "Your account's space is full.");
});

test("Escape and Close shut it; keys pressed in it never reach the document", async () => {
  const p = page();
  let reached = 0;
  p.doc.addEventListener("keydown", () => reached++);
  await p.dialog.show();
  p.dialog.element.dispatchEvent(new p.doc.defaultView!.KeyboardEvent("keydown", { key: "a", bubbles: true }));
  assert.equal(reached, 0);
  p.dialog.element.dispatchEvent(new p.doc.defaultView!.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(p.dialog.open, false);
  await p.dialog.show();
  p.doc.getElementById("my-designs-close")!.click();
  assert.equal(p.dialog.open, false);
});

test("hand-worked: the words about projects from before signing in", () => {
  assert.equal(othersWords("ask", 1), "1 project was in this browser before you signed in. Keep it in your account too? On a shared computer it may be someone else's. Nothing is sent until you choose.");
  assert.equal(othersWords("ask", 3), "3 projects were in this browser before you signed in. Keep them in your account too? On a shared computer they may be someone else's. Nothing is sent until you choose.");
  assert.equal(othersWords("left", 2), "2 projects were in this browser before you signed in and aren't kept in your account.");
});

test("projects from before signing in: asked first, then offered again once left out", async () => {
  let state: "ask" | "left" = "ask";
  const p = page({ others: () => ({ state, count: 2 }) });
  await p.dialog.show();
  const box = () => p.doc.getElementById("my-designs-others")!;
  assert.equal(box().querySelector("p")!.textContent, othersWords("ask", 2));
  assert.deepEqual([...box().querySelectorAll("button")].map((b) => b.textContent), ["Keep them in my account", "Not now"]);
  box().querySelector<HTMLButtonElement>(".my-designs-leave-others")!.click();
  state = "left";
  await p.settle();
  await p.settle();
  assert.deepEqual(p.calls, ["others false"]);
  assert.deepEqual([...box().querySelectorAll("button")].map((b) => b.textContent), ["Keep them too"]);
  box().querySelector<HTMLButtonElement>(".my-designs-keep-others")!.click();
  await p.settle();
  assert.deepEqual(p.calls, ["others false", "others true"]);
});

test("with keeping off, nothing is asked about other projects", async () => {
  const p = page({ others: () => ({ state: "ask", count: 2 }), keeping: async () => false });
  await p.dialog.show();
  assert.equal(p.doc.getElementById("my-designs-others")!.children.length, 0);
});
