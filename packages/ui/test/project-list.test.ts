// Projects in this browser (project-list.ts, U6a; round 2 hunt A2, A3): the words worked out by hand, the rows, and
// the dialog in a real DOM (happy-dom): Open opens and closes, a refused Open says why and stays, Delete asks first and
// is never offered for the open project, a refused Delete or list says why, keys never reach the app's shortcuts.
// The real app in Chromium: apps/fission/e2e/projects.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteQuestion, NO_PROJECTS, projectList, projectRows, savedWhen, type KeptProject, type ProjectListParts } from "../src/project-list.ts";
import { fileSections, type FileMenuEntry } from "../src/file-menu.ts";

const { Window } = await import("happy-dom");

const NOW = new Date(Date.UTC(2026, 10, 4, 12, 0, 0));
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const day = (d: Date) => `day ${d.toISOString().slice(0, 10)}`;

test("hand-worked: when a project was saved, in plain words", () => {
  // Under a minute is "just now": 59 s is 59,000 ms < 60,000.
  assert.equal(savedWhen(ago(59_000), NOW, day), "Saved just now");
  // 60,000 ms is exactly one whole minute, and one takes no "s".
  assert.equal(savedWhen(ago(MIN), NOW, day), "Saved 1 minute ago");
  // 59 min 59 s floors to 59 whole minutes, still under the hour.
  assert.equal(savedWhen(ago(60 * MIN - 1000), NOW, day), "Saved 59 minutes ago");
  // 60 minutes is 1 hour.
  assert.equal(savedWhen(ago(60 * MIN), NOW, day), "Saved 1 hour ago");
  // 23 h 59 min floors to 23 hours.
  assert.equal(savedWhen(ago(24 * 60 * MIN - MIN), NOW, day), "Saved 23 hours ago");
  // 24 hours is a day: the date itself (2026-11-04 12:00 less 24 h is 2026-11-03 12:00).
  assert.equal(savedWhen(ago(24 * 60 * MIN), NOW, day), "Saved day 2026-11-03");
  // A save time ahead of this clock (another device's) and one that can't be read are both "just now", never "-3 minutes" or "NaN".
  assert.equal(savedWhen(new Date(NOW.getTime() + 3 * MIN), NOW, day), "Saved just now");
  assert.equal(savedWhen(new Date(NaN), NOW, day), "Saved just now");
});

const kept: KeptProject[] = [
  { id: "b", name: "Bracket", modified: ago(5 * MIN) },
  { id: "u", name: "", modified: ago(2 * 60 * MIN) },
  { id: "x", name: "x", modified: new Date(0), problem: "this project's summary can't be read (no name)" },
];

test("hand-listed rows: in the order given, the open one marked, no name is Untitled, an unreadable summary says so", () => {
  assert.deepEqual(
    projectRows(kept, "u", NOW, day).map((r) => [r.id, r.name, r.when, r.open, r.problem]),
    [
      ["b", "Bracket", "Saved 5 minutes ago", false, false],
      ["u", "Untitled", "Saved 2 hours ago · open now", true, false],
      ["x", "A project whose name can't be read", "Its details can't be read; it may still open", false, true],
    ],
  );
  assert.equal(projectRows(kept, null, NOW, day).filter((r) => r.open).length, 0, "nothing kept is open: none marked");
});

test("File ▾ lists Projects in this browser… right after Open…, with the folder icon, when the shell gives it", () => {
  const ran: string[] = [];
  const entry = (id: string, label: string): FileMenuEntry => ({ id, label, title: label, run: () => ran.push(id) });
  const sections = fileSections({ open: entry("open", "Open…"), projects: entry("file-projects", "Projects in this browser…"), save: entry("file-save", "Save"), where: () => "Design", entries: () => null });
  assert.deepEqual(sections[0].items.map((i) => [i.id, i.icon]), [["start-fresh", "new"], ["open", "open"], ["file-projects", "folder"], ["file-save", "save"]]);
  sections[0].items[2].run();
  assert.deepEqual(ran, ["file-projects"]);
});

function page(over: Partial<ProjectListParts> = {}) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const calls: string[] = [];
  let projects = [...kept];
  const parts: ProjectListParts = {
    list: async () => projects,
    openId: () => "u",
    open: async (id, modified) => void calls.push(`open ${id} ${modified?.getTime() ?? null}`),
    remove: async (id) => {
      calls.push(`remove ${id}`);
      projects = projects.filter((p) => p.id !== id);
    },
    now: () => NOW,
    ...over,
  };
  const list = projectList(doc, parts);
  const rows = () => [...doc.querySelectorAll<HTMLLIElement>("#projects-items .project-row")];
  const row = (id: string) => rows().find((r) => r.dataset.id === id)!;
  const buttons = (id: string) => [...row(id).querySelectorAll("button")].map((b) => b.textContent);
  const click = (id: string, cls: string) => row(id).querySelector<HTMLButtonElement>(`.${cls}`)!.click();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const status = () => doc.getElementById("projects-status")!.textContent;
  return { window, doc, list, calls, rows, row, buttons, click, settle, status };
}

test("the dialog lists every kept project; the open one offers neither Open nor Delete", async () => {
  const { list, rows, buttons, row, doc } = page();
  await list.show();
  assert.equal(list.open, true);
  assert.equal(doc.getElementById("projects-title")!.textContent, "Projects in this browser");
  assert.deepEqual(rows().map((r) => r.dataset.id), ["b", "u", "x"]);
  assert.equal(row("u").dataset.open, "true");
  assert.deepEqual(buttons("u"), [], "the open project: nothing to open, and it can't be deleted");
  assert.deepEqual(buttons("b"), ["Open", "Delete"]);
  assert.equal(row("b").querySelector(".project-row-when")!.textContent, "Saved 5 minutes ago");
});

test("Open hands the shell the id and the save time it was listed with, then closes", async () => {
  const { list, click, calls, settle } = page();
  await list.show();
  click("b", "project-open");
  await settle();
  assert.deepEqual(calls, [`open b ${ago(5 * MIN).getTime()}`]);
  assert.equal(list.open, false);
});

test("an unreadable summary opens with no save time to expect", async () => {
  const { list, click, calls, settle } = page();
  await list.show();
  click("x", "project-open");
  await settle();
  assert.deepEqual(calls, ["open x null"]);
});

test("a refused Open says why and stays open, the list as it was", async () => {
  const { list, click, settle, status, rows } = page({ open: async () => Promise.reject(new Error("can't open the stored project \"b\": not a project file")) });
  await list.show();
  click("b", "project-open");
  await settle();
  await settle();
  assert.equal(list.open, true);
  assert.equal(status(), "Can't open the stored project \"b\": not a project file");
  assert.equal(rows().length, 3);
});

test("Delete asks first in the row; Keep it changes nothing; Delete then removes it and lists again", async () => {
  const { list, click, calls, settle, buttons, row, rows, doc } = page();
  await list.show();
  click("b", "project-delete");
  assert.equal(row("b").querySelector(".project-row-question")!.textContent, deleteQuestion("Bracket"));
  assert.equal(deleteQuestion("Bracket"), "Delete “Bracket” from this browser? This can't be undone.");
  assert.deepEqual(buttons("b"), ["Keep it", "Delete"]);
  assert.equal((doc.activeElement as HTMLElement).textContent, "Keep it", "the safe answer has the focus");
  click("b", "project-keep");
  assert.deepEqual(buttons("b"), ["Open", "Delete"]);
  assert.deepEqual(calls, [], "asking deleted nothing");
  click("b", "project-delete");
  click("b", "project-delete-sure");
  await settle();
  await settle();
  assert.deepEqual(calls, ["remove b"]);
  assert.deepEqual(rows().map((r) => r.dataset.id), ["u", "x"]);
  assert.equal(list.open, true, "a delete keeps the dialog open");
});

test("a refused Delete says why and keeps the project listed", async () => {
  const { list, click, settle, status, rows } = page({ remove: async () => Promise.reject(new Error("storage failing")) });
  await list.show();
  click("b", "project-delete");
  click("b", "project-delete-sure");
  await settle();
  await settle();
  assert.equal(status(), "Storage failing");
  assert.deepEqual(rows().map((r) => r.dataset.id), ["b", "u", "x"]);
});

test("a list that can't be read says so and points to Save; an empty one says how projects get here", async () => {
  const refused = page({ list: async () => Promise.reject(new Error("browser storage didn't answer")) });
  await refused.list.show();
  assert.equal(refused.status(), "The projects in this browser can't be listed (browser storage didn't answer). Save keeps your work as a file.");
  assert.equal(refused.rows().length, 0);
  const empty = page({ list: async () => [] });
  await empty.list.show();
  assert.equal(empty.status(), NO_PROJECTS);
});

test("Escape and Close shut it; keys pressed in it never reach the document", async () => {
  const { window, doc, list } = page();
  let heard = 0;
  doc.addEventListener("keydown", () => heard++);
  await list.show();
  const key = (k: string) => doc.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }) as unknown as Event);
  key("Delete"); // the app's Delete-the-selection key: kept in the dialog
  key("Escape");
  assert.equal(heard, 0);
  assert.equal(list.open, false);
  await list.show();
  doc.getElementById("projects-close")!.click();
  assert.equal(list.open, false);
});

test("a list read after the dialog was closed is never put in it", async () => {
  let answer: (k: KeptProject[]) => void = () => {};
  const { list, rows } = page({ list: () => new Promise((r) => (answer = r)) });
  const showing = list.show();
  list.close();
  answer(kept);
  await showing;
  assert.equal(rows().length, 0);
});
