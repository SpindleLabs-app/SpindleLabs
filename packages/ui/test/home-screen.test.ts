// The home screen (home-screen.ts, U6b): search, filter and the card worked out by hand, then the screen in a real DOM
// (happy-dom). The real app in Chromium: apps/fission/e2e/home.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carryOnRow, filterRows, homeRows, homeScreen, workspacesIn, type HomeParts, type HomeProject } from "../src/home-screen.ts";

const { Window } = await import("happy-dom");
const NOW = new Date(Date.UTC(2026, 10, 6, 12, 0, 0));
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

// Four projects. Used last first by `touched`: Gear (5 min ago), Bracket (2 h), Lid (3 h, saved long before it was last opened),
// the unreadable one (store order only).
const kept: HomeProject[] = [
  { id: "b", name: "Bracket", modified: ago(10 * 60 * MIN), touched: ago(120 * MIN), works: ["design"] },
  { id: "g", name: "Gear Box", modified: ago(5 * MIN), touched: ago(5 * MIN), works: ["design", "slice"] },
  { id: "l", name: "Lid", modified: ago(30 * 60 * MIN), touched: ago(180 * MIN), works: [] },
  { id: "x", name: "x", modified: new Date(0), problem: "can't be read" },
];

test("hand-worked: rows come most recently used first, and the card offers the first readable one", () => {
  const rows = homeRows(kept, "b", NOW);
  // Used times: Gear 5 min, Bracket 120 min, Lid 180 min ago, the unreadable one at 1970: so g, b, l, x.
  assert.deepEqual(rows.map((r) => r.id), ["g", "b", "l", "x"]);
  assert.equal(rows[0].when, "Last used 5 minutes ago");
  assert.equal(rows[1].when, "Last used 2 hours ago"); // 120 min = 2 whole hours
  assert.equal(rows[1].open, true);
  assert.equal(carryOnRow(rows)?.id, "g");
  assert.equal(carryOnRow(rows.filter((r) => r.problem)), null);
  assert.equal(carryOnRow([]), null);
});

test("hand-worked: search is by name, ignoring case and spaces round it; the workspace filter keeps only projects with work in it", () => {
  const rows = homeRows(kept, null, NOW);
  assert.deepEqual(filterRows(rows, "", null).map((r) => r.id), ["g", "b", "l", "x"]);
  // "gear" is inside "Gear Box" only; " BOX " trims to "box", which is inside "Gear Box" only.
  assert.deepEqual(filterRows(rows, "gear", null).map((r) => r.id), ["g"]);
  assert.deepEqual(filterRows(rows, " BOX ", null).map((r) => r.id), ["g"]);
  assert.deepEqual(filterRows(rows, "zzz", null), []);
  // Design has work in Gear Box and Bracket; Slice only in Gear Box; Lid has none, so it is in no filter.
  assert.deepEqual(filterRows(rows, "", "design").map((r) => r.id), ["g", "b"]);
  assert.deepEqual(filterRows(rows, "", "slice").map((r) => r.id), ["g"]);
  assert.deepEqual(filterRows(rows, "b", "design").map((r) => r.id), ["g", "b"]); // "b" is in "Gear Box" and "Bracket"
  assert.deepEqual(filterRows(rows, "bra", "slice"), []);
  // The unreadable project's name is unknown, so no search matches it, even with its id's letter.
  assert.deepEqual(filterRows(rows, "x", null).map((r) => r.id), ["g"]);
  assert.deepEqual(workspacesIn(rows), ["design", "slice"]);
});

function setup(over: Partial<HomeParts> = {}) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const calls: string[] = [];
  let list = kept.map((p) => ({ ...p }));
  const parts: HomeParts = {
    list: async () => list,
    openId: () => "g",
    open: async (id) => void calls.push(`open ${id}`),
    remove: async (id) => (calls.push(`remove ${id}`), void (list = list.filter((p) => p.id !== id))),
    rename: async (id, name) => (calls.push(`rename ${id} ${name}`), void (list = list.map((p) => (p.id === id ? { ...p, name } : p)))),
    newProject: async () => void calls.push("new"),
    chooseFile: () => void calls.push("choose"),
    showGuide: () => void calls.push("guide"),
    workspaceTitle: (id) => id.toUpperCase(),
    now: () => NOW,
    ...over,
  };
  const home = homeScreen(doc, parts);
  const q = <T extends Element>(s: string) => doc.querySelector(s) as unknown as T;
  const click = (s: string) => (q<HTMLElement>(s).click(), new Promise((r) => setTimeout(r, 0)));
  return { home, doc, calls, q, click, parts, setList: (l: HomeProject[]) => (list = l) };
}
const names = (doc: Document) => [...doc.querySelectorAll(".home-row-name")].map((n) => n.textContent);

test("the screen shows the card, the list and the filter; search and filter narrow the list", async () => {
  const { home, doc, q } = setup();
  await home.show();
  assert.equal(home.shown, true);
  assert.match(q("#home-card").textContent!, /Carry on with.*Gear Box/);
  assert.deepEqual(names(doc), ["Gear Box", "Bracket", "Lid", "A project whose name can't be read"]);
  const search = q<HTMLInputElement>("#home-search");
  search.value = "lid";
  search.dispatchEvent(new (doc.defaultView as any).Event("input"));
  assert.deepEqual(names(doc), ["Lid"]);
  search.value = "nothing";
  search.dispatchEvent(new (doc.defaultView as any).Event("input"));
  assert.match(q("#home-status").textContent!, /No project matches/);
});

test("the card on the open project just goes back; New, Open file, Upload STL and the guide each do their one thing", async () => {
  const s = setup();
  await s.home.show();
  await s.click("#home-carry-on");
  assert.deepEqual(s.calls, []); // the open project: nothing to open
  assert.equal(s.home.shown, false);
  await s.home.show();
  await s.click("#home-new");
  assert.deepEqual(s.calls, ["new"]);
  assert.equal(s.home.shown, false);
  await s.home.show();
  await s.click("#home-open-file");
  await s.home.show();
  await s.click("#home-upload-stl");
  await s.home.show();
  await s.click("#home-guide");
  assert.deepEqual(s.calls, ["new", "choose", "choose", "guide"]);
});

test("Open on another project opens it and closes the screen; a refusal says why and stays", async () => {
  let refuse = false;
  const s = setup({ open: async (id) => (refuse ? Promise.reject(new Error("it can't be read")) : void s.calls.push(`open ${id}`)) });
  await s.home.show();
  refuse = true;
  await s.click('[data-id="b"] .home-open');
  assert.equal(s.home.shown, true);
  assert.match(s.q("#home-status").textContent!, /It can't be read/);
  refuse = false;
  await s.click('[data-id="b"] .home-open');
  assert.deepEqual(s.calls, ["open b"]);
  assert.equal(s.home.shown, false);
});

test("Delete asks first and Keep it deletes nothing; the open project and an unreadable one get no Rename or Delete", async () => {
  const s = setup();
  await s.home.show();
  assert.equal(s.doc.querySelector('[data-id="g"] .home-delete'), null);
  assert.equal(s.doc.querySelector('[data-id="g"] .home-rename'), null);
  assert.equal(s.doc.querySelector('[data-id="x"] .home-delete'), null);
  await s.click('[data-id="b"] .home-delete');
  assert.match(s.q('[data-id="b"] .home-row-question').textContent!, /Delete “Bracket” from this browser\? This can't be undone\./);
  await s.click('[data-id="b"] .home-keep');
  assert.deepEqual(s.calls, []);
  await s.click('[data-id="b"] .home-delete');
  await s.click('[data-id="b"] .home-delete-sure');
  assert.deepEqual(s.calls, ["remove b"]);
  assert.deepEqual(names(s.doc), ["Gear Box", "Lid", "A project whose name can't be read"]);
});

test("Rename saves the typed name; a refusal says why and the old name stays", async () => {
  let refuse = true;
  const s = setup({ rename: async (id, name) => (refuse ? Promise.reject(new Error("a project needs a name")) : void s.calls.push(`rename ${id} ${name}`)) });
  await s.home.show();
  await s.click('[data-id="l"] .home-rename');
  const box = s.q<HTMLInputElement>('[data-id="l"] .home-rename-box');
  assert.equal(box.value, "Lid");
  assert.equal(box.maxLength, 100);
  box.value = "";
  await s.click('[data-id="l"] .home-rename-ok');
  assert.match(s.q("#home-status").textContent!, /needs a name/);
  assert.equal(s.q("#home-status").classList.contains("bad"), true);
  refuse = false;
  await s.click('[data-id="l"] .home-rename');
  s.q<HTMLInputElement>('[data-id="l"] .home-rename-box').value = "Lid 2";
  await s.click('[data-id="l"] .home-rename-ok');
  assert.deepEqual(s.calls, ["rename l Lid 2"]);
});

test("a list that can't be read says so, still offers New and Open file; no projects says that", async () => {
  const bad = setup({ list: async () => Promise.reject(new Error("storage is off")) });
  await bad.home.show();
  assert.match(bad.q("#home-status").textContent!, /can't be listed \(storage is off\)/);
  assert.equal(bad.q("#home-card").hidden, true);
  await bad.click("#home-new");
  assert.deepEqual(bad.calls, ["new"]);
  const none = setup({ list: async () => [] });
  await none.home.show();
  assert.match(none.q("#home-status").textContent!, /Nothing is kept/);
  assert.equal(none.q("#home-filter").hidden, true);
});

test("Escape goes back to the project and the key never reaches the app's shortcuts", async () => {
  const s = setup();
  await s.home.show();
  let reached = false;
  s.doc.addEventListener("keydown", () => (reached = true));
  const Event = (s.doc.defaultView as any).KeyboardEvent;
  s.q("#home-search").dispatchEvent(new Event("keydown", { key: "e", bubbles: true }));
  assert.equal(reached, false);
  s.q("#home-search").dispatchEvent(new Event("keydown", { key: "Escape", bubbles: true }));
  assert.equal(s.home.shown, false);
});

test("while the screen is shown the rest of the page can't be reached by Tab (inert), and is again once it goes", async () => {
  const s = setup();
  const app = s.doc.createElement("main");
  s.doc.body.prepend(app);
  const dialog = s.doc.createElement("dialog"); // something already inert-free and unrelated stays as it was
  s.doc.body.append(dialog);
  await s.home.show();
  assert.equal(app.hasAttribute("inert"), true, "the app is inert behind the screen");
  assert.equal(s.home.element.hasAttribute("inert"), false, "the screen itself is not");
  await s.home.show(); // shown twice (File > Home while it is up): still restores cleanly
  s.home.hide();
  assert.equal(app.hasAttribute("inert"), false);
  assert.equal(dialog.hasAttribute("inert"), false);
  assert.equal(s.home.element.getAttribute("aria-modal"), "true");
  // An element that was inert before stays inert after.
  const already = s.doc.createElement("div");
  already.setAttribute("inert", "");
  s.doc.body.append(already);
  await s.home.show();
  s.home.hide();
  assert.equal(already.hasAttribute("inert"), true);
});
