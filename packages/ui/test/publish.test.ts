// The library's dialogs (publish.ts): the words, the tags as typed, and both dialogs in a real DOM (happy-dom). Publish:
// the title starts from the design's name, the licence's sentence follows the choice, a problem turns Publish off and
// says why, a refusal is said and the form stays, success hides the form. My library: each state in words, Take down asks
// first, Keep it changes nothing, a refusal is said. The real app in Chromium: apps/fission/e2e/library-publish.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type LibraryRow, myLibraryDialog, NO_ENTRIES, PUBLISH_TERMS_PLACEHOLDER, publishDialog, PUBLISHED_WORDS, type PublishForm, type PublishParts, rowWhen, tagsFrom, takeDownQuestion } from "../src/publish.ts";

const { Window } = await import("happy-dom");
const NOW = new Date(Date.UTC(2026, 11, 1, 12, 0, 0));
const doc = () => new Window().document as unknown as Document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = async (d: Document, sel: string) => {
  (d.querySelector(sel) as HTMLElement).click();
  await tick();
  await tick();
};
const type = (d: Document, sel: string, value: string) => {
  const box = d.querySelector(sel) as HTMLInputElement;
  box.value = value;
  box.dispatchEvent(new (d.defaultView as unknown as { Event: typeof Event }).Event("input"));
};
const text = (d: Document, sel: string) => d.querySelector(sel)?.textContent ?? "";

const LICENCES = [
  { id: "CC-BY-4.0", name: "CC BY 4.0", says: "Name me." },
  { id: "CC0-1.0", name: "CC0", says: "Anything goes." },
];

function publishParts(over: Partial<PublishParts> = {}) {
  const sent: PublishForm[] = [];
  const parts: PublishParts = {
    name: () => "  Cable clip ",
    picture: () => "data:image/png;base64,AAAA",
    licences: LICENCES,
    problem: (f) => (f.title.trim() === "" ? "Give it a title." : f.tags.includes("bad!") ? "Bad tag." : null),
    publish: async (f) => void sent.push(f),
    ...over,
  };
  return { parts, sent };
}

test("hand-worked: tags as typed become the library's: lowercase, split on commas and spaces, no blanks", () => {
  // "Desk, cable  clip," → lowercase "desk, cable  clip," → split on runs of commas/spaces → desk, cable, clip.
  assert.deepEqual(tagsFrom("Desk, cable  clip,"), ["desk", "cable", "clip"]);
  assert.deepEqual(tagsFrom("   "), []);
  assert.deepEqual(tagsFrom("a-b,c_d"), ["a-b", "c_d"], "an underscore is kept for the library's check to refuse, never changed into something else");
  assert.match(PUBLISH_TERMS_PLACEHOLDER, /not yet checked by a lawyer/);
  assert.equal(takeDownQuestion("Clip"), "Take “Clip” out of the library? Nobody can find or download it again, and its file is deleted. This can't be undone.");
});

test("Publish: the title from the design's name, the picture, the first licence and its sentence; publishing sends what was typed", async () => {
  const d = doc();
  const { parts, sent } = publishParts();
  const dialog = publishDialog(d, parts);
  await dialog.show();
  assert.ok(dialog.open);
  assert.equal((d.getElementById("publish-name") as HTMLInputElement).value, "Cable clip", "trimmed");
  assert.equal((d.getElementById("publish-picture") as HTMLImageElement).hidden, false);
  assert.equal((d.getElementById("publish-licence") as HTMLSelectElement).value, "CC-BY-4.0");
  assert.equal(text(d, "#publish-licence-says"), "Name me.");
  const licence = d.getElementById("publish-licence") as HTMLSelectElement;
  licence.value = "CC0-1.0";
  licence.dispatchEvent(new (d.defaultView as unknown as { Event: typeof Event }).Event("change"));
  assert.equal(text(d, "#publish-licence-says"), "Anything goes.");
  type(d, "#publish-description", "Clips on.");
  type(d, "#publish-tags", "Desk, clip");
  await click(d, "#publish-go");
  assert.deepEqual(sent, [{ title: "Cable clip", description: "Clips on.", licence: "CC0-1.0", tags: ["desk", "clip"], picture: "data:image/png;base64,AAAA" }]);
  assert.equal((d.getElementById("publish-form") as HTMLElement).hidden, true);
  assert.equal(text(d, "#publish-status"), PUBLISHED_WORDS);
});

test("Publish: a problem turns Publish off and says why; fixed, it goes on; a refusal is said and the form stays", async () => {
  const d = doc();
  let refuse = true;
  const { parts, sent } = publishParts({
    publish: async (f) => {
      if (refuse) throw new Error("you've published 10 designs today. Try again tomorrow.");
      sent.push(f);
    },
  });
  await publishDialog(d, parts).show();
  const go = d.getElementById("publish-go") as HTMLButtonElement;
  type(d, "#publish-name", "");
  assert.equal(go.disabled, true);
  assert.equal(text(d, "#publish-problem"), "Give it a title.");
  await click(d, "#publish-go");
  assert.equal(sent.length, 0, "a disabled Publish sends nothing");
  type(d, "#publish-name", "Clip");
  type(d, "#publish-tags", "bad!");
  assert.equal(text(d, "#publish-problem"), "Bad tag.");
  type(d, "#publish-tags", "");
  assert.equal(go.disabled, false);
  assert.equal(text(d, "#publish-problem"), "");
  await click(d, "#publish-go");
  assert.equal(text(d, "#publish-status"), "You've published 10 designs today. Try again tomorrow.");
  assert.ok(d.getElementById("publish-status")!.classList.contains("bad"));
  assert.equal((d.getElementById("publish-form") as HTMLElement).hidden, false, "the form stays to try again");
  assert.equal(go.disabled, false);
  refuse = false;
  await click(d, "#publish-go");
  assert.equal(sent.length, 1);
});

test("Publish: no picture hides the image; showing again starts afresh", async () => {
  const d = doc();
  const { parts } = publishParts({ picture: () => null });
  const dialog = publishDialog(d, parts);
  await dialog.show();
  assert.equal((d.getElementById("publish-picture") as HTMLImageElement).hidden, true);
  type(d, "#publish-tags", "desk");
  await click(d, "#publish-go");
  dialog.close();
  await dialog.show();
  assert.equal((d.getElementById("publish-tags") as HTMLInputElement).value, "");
  assert.equal((d.getElementById("publish-form") as HTMLElement).hidden, false);
  assert.equal(text(d, "#publish-status"), "");
});

test("hand-worked: My library's words for each state", () => {
  const at = new Date(NOW.getTime() - 5 * 60_000); // 5 minutes before NOW
  assert.equal(rowWhen({ id: "a", title: "T", picture: null, state: "live", at }, NOW), "In the library · published 5 minutes ago");
  assert.equal(rowWhen({ id: "a", title: "T", picture: null, state: "removed", at }, NOW), "Taken down after a report · 5 minutes ago");
  assert.equal(rowWhen({ id: "a", title: "T", picture: null, state: "waiting", at }, NOW), "Not finished publishing · 5 minutes ago");
});

test("My library: lists, Take down asks first, Keep it changes nothing, Take down takes it off; a refusal is said", async () => {
  const d = doc();
  let rows: LibraryRow[] = [
    { id: "1", title: "Clip", picture: "data:image/png;base64,AAAA", state: "live", at: NOW },
    { id: "2", title: "Hook", picture: null, state: "removed", at: NOW },
  ];
  const downs: string[] = [];
  let fail = false;
  const dialog = myLibraryDialog(d, {
    list: async () => rows,
    takeDown: async (id) => {
      if (fail) throw new Error("you're offline.");
      downs.push(id);
      rows = rows.filter((r) => r.id !== id);
    },
    now: () => NOW,
  });
  await dialog.show();
  await tick();
  assert.equal(d.querySelectorAll("#my-library-items .share-item").length, 2);
  assert.equal(d.querySelectorAll("#my-library-items .publish-thumb").length, 1);
  await click(d, '[data-id="1"] .publish-take-down');
  assert.equal(text(d, '[data-id="1"] .share-item-question'), takeDownQuestion("Clip"));
  assert.deepEqual(downs, [], "asking takes nothing down");
  await click(d, '[data-id="1"] .publish-keep');
  assert.deepEqual(downs, []);
  assert.equal(d.querySelector('[data-id="1"] .share-item-question'), null);
  fail = true;
  await click(d, '[data-id="1"] .publish-take-down');
  await click(d, '[data-id="1"] .publish-take-down-sure');
  assert.equal(text(d, "#my-library-status"), "You're offline.");
  fail = false;
  await click(d, '[data-id="1"] .publish-take-down');
  await click(d, '[data-id="1"] .publish-take-down-sure');
  await tick();
  assert.deepEqual(downs, ["1"]);
  assert.equal(d.querySelectorAll("#my-library-items .share-item").length, 1);
  rows = [];
  dialog.close();
  await dialog.show();
  await tick();
  assert.equal(text(d, "#my-library-status"), NO_ENTRIES);
});
