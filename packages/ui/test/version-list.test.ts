// Earlier versions (version-list.ts, missing basics 3b): the rows worked out by hand, the File entry, and the dialog
// in a real DOM (happy-dom): Restore hands the shell the version's time and closes, a refused Restore says why and
// stays, an empty or not-yet-kept project says so, keys never reach the app's shortcuts. The real app in Chromium:
// apps/fission/e2e/versions.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_VERSIONS, NOT_KEPT, versionList, versionRows, versionTime, type VersionListParts } from "../src/version-list.ts";
import { fileSections, type FileMenuEntry } from "../src/file-menu.ts";

const { Window } = await import("happy-dom");

const NOW = new Date(2026, 10, 4, 15, 0); // local time, so the day comparison is the reader's own
const MIN = 60_000;

test("hand-worked rows: newest first as given, how long ago, and the time", () => {
  const at = [new Date(NOW.getTime() - 25 * MIN), new Date(NOW.getTime() - 3 * 60 * MIN)];
  const rows = versionRows(at, NOW, (d) => `t${d.getHours()}:${d.getMinutes()}`);
  // 25 minutes before 15:00 is 14:35; 3 hours before is 12:00.
  assert.deepEqual(rows.map((r) => [r.when, r.time]), [["Saved 25 minutes ago", "t14:35"], ["Saved 3 hours ago", "t12:0"]]);
});

test("the time says the day only when it isn't today's", () => {
  const today = versionTime(new Date(2026, 10, 4, 9, 5), NOW);
  const before = versionTime(new Date(2026, 10, 3, 9, 5), NOW);
  assert.doesNotMatch(today, /,/, "today: the time alone");
  assert.match(before, /, /, "another day: the day, then the time");
  assert.ok(before.endsWith(today), "the same time of day after the day");
});

test("File ▾ lists Earlier versions… after Projects in this browser…, with the undo icon", () => {
  const entry = (id: string): FileMenuEntry => ({ id, label: id, title: id, run() {} });
  const items = fileSections({ open: entry("open"), projects: entry("file-projects"), versions: entry("file-versions"), save: entry("file-save"), where: () => "Design", entries: () => null })[0].items;
  assert.deepEqual(items.map((i) => [i.id, i.icon]), [["start-fresh", "new"], ["open", "open"], ["file-projects", "folder"], ["file-versions", "undo"], ["file-save", "save"]]);
});

function page(over: Partial<VersionListParts> = {}) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const calls: number[] = [];
  const times = [new Date(NOW.getTime() - 15 * MIN), new Date(NOW.getTime() - 40 * MIN)];
  const parts: VersionListParts = { list: async () => ({ name: "Bracket", times }), restore: async (at) => void calls.push(at.getTime()), now: () => NOW, ...over };
  const list = versionList(doc, parts);
  const rows = () => [...doc.querySelectorAll<HTMLLIElement>("#versions-items .project-row")];
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { window, doc, list, calls, rows, settle, times, status: () => doc.getElementById("versions-status")!.textContent };
}

test("the dialog lists the versions with Restore; Restore hands over the time and closes", async () => {
  const { doc, list, rows, calls, settle, times } = page();
  await list.show();
  assert.equal(doc.getElementById("versions-title")!.textContent, "Earlier versions of “Bracket”");
  assert.deepEqual(rows().map((r) => [r.querySelector(".project-row-when")!.textContent, r.querySelector("button")!.textContent]), [["Saved 15 minutes ago", "Restore"], ["Saved 40 minutes ago", "Restore"]]);
  rows()[1].querySelector<HTMLButtonElement>(".version-restore")!.click();
  await settle();
  assert.deepEqual(calls, [times[1].getTime()]);
  assert.equal(list.open, false);
});

test("a refused Restore says why and stays open", async () => {
  const { list, rows, settle, status } = page({ restore: async () => Promise.reject(new Error("can't open that version: not a project file")) });
  await list.show();
  rows()[0].querySelector<HTMLButtonElement>(".version-restore")!.click();
  await settle();
  await settle();
  assert.equal(status(), "Can't open that version: not a project file");
  assert.equal(list.open, true);
});

test("no versions yet, a project not kept yet, and a list that can't be read each say so", async () => {
  const none = page({ list: async () => ({ name: "Bracket", times: [] }) });
  await none.list.show();
  assert.equal(none.status(), NO_VERSIONS);
  const notKept = page({ list: async () => null });
  await notKept.list.show();
  assert.equal(notKept.status(), NOT_KEPT);
  assert.equal(notKept.doc.getElementById("versions-title")!.textContent, "Earlier versions");
  const refused = page({ list: async () => Promise.reject(new Error("browser storage didn't answer")) });
  await refused.list.show();
  assert.equal(refused.status(), "The earlier versions can't be listed (browser storage didn't answer).");
});

test("Escape and Close shut it; keys pressed in it never reach the document", async () => {
  const { window, doc, list } = page();
  let heard = 0;
  doc.addEventListener("keydown", () => heard++);
  await list.show();
  doc.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }) as unknown as Event); // Undo: kept in the dialog
  doc.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event);
  assert.equal(heard, 0);
  assert.equal(list.open, false);
  await list.show();
  doc.getElementById("versions-close")!.click();
  assert.equal(list.open, false);
});
