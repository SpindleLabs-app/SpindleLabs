// Sharing links (share.ts): the words, and both dialogs in a real DOM (happy-dom). The shared view: Open my own copy
// opens and closes, a refusal says why and stays, Report sends the chosen reason and says each answer, and the view
// tells the shell when it closes. The Share dialog: Make a link shows the address, a refusal is said, Turn off asks
// first. The real app in Chromium: apps/fission/e2e/share.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_LINKS, REPORT_ANSWERS, REPORT_KIND_WORDS, SHARE_REFUSALS, SHARE_TERMS_PLACEHOLDER, shareDialog, sharedView, turnOffQuestion, type ShareLinkRow } from "../src/share.ts";

const { Window } = await import("happy-dom");
const NOW = new Date(Date.UTC(2026, 11, 1, 12, 0, 0));
const doc = () => new Window().document as unknown as Document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = async (d: Document, sel: string) => {
  (d.querySelector(sel) as HTMLElement).click();
  await tick();
  await tick();
};

test("hand-worked: the report reasons are the database's eight, each with words, and each answer has words", () => {
  // supabase/migrations/20261111120000_shares.sql: copied, weapon, sexual, hateful, illegal, not-a-design, personal-info, other.
  assert.deepEqual(REPORT_KIND_WORDS.map(([k]) => k), ["copied", "weapon", "sexual", "hateful", "illegal", "not-a-design", "personal-info", "other"]);
  assert.ok(REPORT_KIND_WORDS.every(([, w]) => w.length > 5));
  assert.deepEqual(Object.keys(REPORT_ANSWERS).sort(), ["bad", "enough", "gone", "held", "kept", "off", "own"]);
  assert.deepEqual(Object.keys(SHARE_REFUSALS).sort(), ["daily", "full", "held", "off", "too-big"]);
  assert.match(SHARE_REFUSALS["daily"] ?? "", /20 links/);
  assert.match(SHARE_TERMS_PLACEHOLDER, /not yet checked by a lawyer/, "the terms say they are a placeholder");
  assert.equal(turnOffQuestion("Box"), "Turn off the link to “Box”? Nobody can open it again, and its copy is deleted. This can't be undone.");
});

function sharedParts(over: Partial<Parameters<typeof sharedView>[2]> = {}) {
  const log: string[] = [];
  const parts = {
    openCopy: async () => void log.push("open"),
    report: async (kind: string, reason: string) => (log.push(`report ${kind} ${reason}`), "kept"),
    closed: () => void log.push("closed"),
    now: () => NOW,
    ...over,
  };
  return { parts, log };
}

test("the shared view: Open my own copy opens it and closes; the shell is told once", async () => {
  const d = doc();
  const { parts, log } = sharedParts();
  const v = sharedView(d, { name: "Bracket", picture: null, createdAt: new Date(NOW.getTime() - 5 * 60_000) }, parts);
  await v.show();
  assert.equal(d.getElementById("shared-name")?.textContent, "Bracket");
  await click(d, "#shared-open");
  assert.deepEqual(log, ["open", "closed"]);
  assert.equal(v.open, false);
});

test("a refused copy says why, stays open and does not tell the shell it closed", async () => {
  const d = doc();
  const { parts, log } = sharedParts({ openCopy: async () => { throw new Error("it is damaged"); } });
  const v = sharedView(d, { name: "", picture: null, createdAt: NOW }, parts);
  await v.show();
  assert.equal(d.getElementById("shared-name")?.textContent, "Untitled");
  await click(d, "#shared-open");
  assert.equal(d.getElementById("shared-status")?.textContent, "It is damaged");
  assert.ok(d.getElementById("shared-status")?.classList.contains("bad"));
  assert.equal(v.open, true);
  assert.deepEqual(log, []);
});

test("Report: the form is hidden until asked, sends the reason and details cut to 1,000, and says each answer", async () => {
  const d = doc();
  let answer = "kept";
  const { parts, log } = sharedParts({ report: async (k, r) => (log.push(`${k}:${r.length}`), answer) });
  const v = sharedView(d, { name: "x", picture: null, createdAt: NOW }, parts);
  await v.show();
  assert.equal((d.getElementById("shared-report-form") as HTMLElement).hidden, true);
  await click(d, "#shared-report");
  assert.equal((d.getElementById("shared-report-form") as HTMLElement).hidden, false);
  (d.getElementById("shared-report-kind") as HTMLSelectElement).value = "illegal";
  (d.getElementById("shared-report-reason") as HTMLTextAreaElement).value = "y".repeat(1100); // 1.1 x 1000: cut
  await click(d, "#shared-report-send");
  assert.deepEqual(log, ["illegal:1000"]);
  assert.equal(d.getElementById("shared-status")?.textContent, REPORT_ANSWERS["kept"]);
  assert.equal((d.getElementById("shared-report-form") as HTMLElement).hidden, true, "a kept report puts the form away");
  for (const a of ["gone", "enough", "bad", "own", "held", "off"]) {
    answer = a;
    await click(d, "#shared-report");
    await click(d, "#shared-report-send");
    assert.equal(d.getElementById("shared-status")?.textContent, REPORT_ANSWERS[a], a);
    assert.ok(d.getElementById("shared-status")?.classList.contains("bad"), `${a} is not a success`);
  }
});

function shareParts(rows: ShareLinkRow[], over: Partial<Parameters<typeof shareDialog>[1]> = {}) {
  const log: string[] = [];
  const parts = {
    name: () => "Box",
    make: async () => (rows.unshift({ id: "i1", name: "Box", picture: null, createdAt: NOW, removedAt: null }), "https://x.test/?share=i1"),
    list: async () => [...rows],
    addressOf: (id: string) => `https://x.test/?share=${id}`,
    turnOff: async (id: string) => void (log.push(`off ${id}`), rows.splice(0, rows.length, ...rows.filter((r) => r.id !== id))),
    copy: async (t: string) => (log.push(`copy ${t}`), true),
    now: () => NOW,
    ...over,
  };
  return { parts, log };
}

test("the Share dialog: says there are no links, Make a link shows the address and lists it, Copy copies it", async () => {
  const d = doc();
  const { parts, log } = shareParts([]);
  const s = shareDialog(d, parts);
  await s.show();
  await tick();
  assert.equal(d.getElementById("share-status")?.textContent, NO_LINKS);
  await click(d, "#share-make");
  assert.equal((d.getElementById("share-address") as HTMLInputElement).value, "https://x.test/?share=i1");
  assert.equal(d.querySelectorAll("#share-items .share-item").length, 1);
  await click(d, "#share-copy");
  assert.deepEqual(log, ["copy https://x.test/?share=i1"]);
});

test("a refused link says why and makes nothing", async () => {
  const d = doc();
  const { parts } = shareParts([], { make: async () => { throw new Error(SHARE_REFUSALS["full"]); } });
  const s = shareDialog(d, parts);
  await s.show();
  await click(d, "#share-make");
  assert.match(d.getElementById("share-status")?.textContent ?? "", /as many links on/);
  assert.equal(d.getElementById("share-address"), null);
});

test("Turn off asks first: Keep it on does nothing, Turn off does it and the row goes; a taken-down link says so and has no Copy", async () => {
  const d = doc();
  const { parts, log } = shareParts([
    { id: "a", name: "One", picture: null, createdAt: NOW, removedAt: null },
    { id: "b", name: "Two", picture: null, createdAt: NOW, removedAt: NOW },
  ]);
  const s = shareDialog(d, parts);
  await s.show();
  await tick();
  assert.match(d.querySelector('[data-id="b"] .share-item-when')?.textContent ?? "", /taken down after a report/);
  assert.equal(d.querySelector('[data-id="b"] .share-item-copy'), null);
  await click(d, '[data-id="a"] .share-item-off');
  assert.equal(d.querySelector(".share-item-question")?.textContent, turnOffQuestion("One"));
  await click(d, ".share-item-keep");
  assert.deepEqual(log, []);
  await click(d, '[data-id="a"] .share-item-off');
  await click(d, ".share-item-off-sure");
  assert.deepEqual(log, ["off a"]);
  assert.equal(d.querySelector('[data-id="a"]'), null);
});

test("a list that can't be read says why", async () => {
  const d = doc();
  const { parts } = shareParts([], { list: async () => { throw new Error("offline"); } });
  const s = shareDialog(d, parts);
  await s.show();
  await tick();
  assert.equal(d.getElementById("share-status")?.textContent, "Your links can't be listed right now. offline");
});

test("My links (links only): lists the links, has no Make a link and no terms, its ids never clash with the Share dialog's, and Turn off asks first", async () => {
  const d = doc();
  const row = (id: string, name: string): ShareLinkRow => ({ id, name, picture: null, createdAt: NOW, removedAt: null });
  const { parts, log } = shareParts([row("i1", "Box"), row("i2", "Gear")]);
  shareDialog(d, parts); // the Share dialog beside it in the same page
  const mine = shareDialog(d, parts, { linksOnly: true });
  await mine.show();
  await tick();
  assert.equal(mine.element.id, "my-links");
  assert.equal(d.querySelectorAll("#my-links-items .share-item").length, 2);
  assert.equal(d.querySelector("#my-links-make"), null, "no way to make a link here");
  assert.equal(d.querySelector("#my-links-terms"), null);
  assert.equal(d.querySelector("#my-links #share-make"), null, "nothing of the Share dialog inside it");
  assert.equal(new Set([...d.querySelectorAll("[id]")].map((e) => e.id)).size, d.querySelectorAll("[id]").length, "every id is unique");
  await click(d, "#my-links .share-item-off");
  assert.match(d.querySelector("#my-links .share-item-question")?.textContent ?? "", /Turn off the link to “Box”\?/);
  await click(d, "#my-links .share-item-keep");
  assert.deepEqual(log.filter((l) => l.startsWith("off")), [], "Keep it on turns nothing off");
});
