// The design tabs (design-tabs.ts): the list rules worked out by hand, then the strip in a DOM (happy-dom).
// The real app in Chromium: apps/fission/e2e/tabs.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activate, addTab, canAdd, closeQuestion, confirmClose, designTabs, MAX_TABS, NO_TABS, removeTab, restored, shortName, stored, tabName, TABS_PHONE_QUERY, update, workspaceChip, type DesignTab, type TabsState } from "../src/design-tabs.ts";

const { Window } = await import("happy-dom");
const t = (key: string, workspace = "design", name = key): DesignTab => ({ key, name, workspace });
const three: TabsState = { tabs: [t("a"), t("b", "slice"), t("c")], active: "b" };

test("hand-worked: closing the tab on screen brings up the one to its right, else the left, else none", () => {
  // Tabs a b c, b on screen. Close b: c took its place (index 1), so c.
  assert.equal(removeTab(three, "b").next, "c");
  assert.deepEqual(removeTab(three, "b").state.tabs.map((x) => x.key), ["a", "c"]);
  // Close c while it is on screen: nothing to its right, so b (the left).
  assert.equal(removeTab({ ...three, active: "c" }, "c").next, "b");
  // Close the only tab: none, and no tab is on screen.
  assert.deepEqual(removeTab({ tabs: [t("a")], active: "a" }, "a"), { state: { tabs: [], active: null }, next: null });
  // A tab that is not on screen leaves the one on screen alone and asks for no opening.
  assert.deepEqual(removeTab(three, "a"), { state: { tabs: [t("b", "slice"), t("c")], active: "b" }, next: null });
  // A key no tab has changes nothing.
  assert.equal(removeTab(three, "zzz").state, three);
});

test("a tab says what it is for: the workspace chip is the workspace's title in capitals", () => {
  assert.equal(workspaceChip("design"), "DESIGN");
  assert.equal(workspaceChip("slice", { slice: "Slice" }), "SLICE");
  assert.equal(workspaceChip("manufacture", { manufacture: "Manufacture" }), "MANUFACTURE");
});

test("names: empty reads Untitled, long ones are cut at 24 characters with an ellipsis", () => {
  assert.equal(tabName("   "), "Untitled");
  assert.equal(shortName("x".repeat(24)), "x".repeat(24)); // exactly 24: whole
  assert.equal(shortName("x".repeat(25)), "x".repeat(23) + "…"); // 25: 23 and the ellipsis make 24
});

test("add, activate and update", () => {
  const s = addTab(NO_TABS, t("a"));
  assert.deepEqual(s, { tabs: [t("a")], active: "a" });
  assert.equal(addTab(s, t("b")).active, "b");
  assert.deepEqual(addTab(addTab(s, t("b")), t("a", "slice")).tabs.map((x) => x.workspace), ["slice", "design"]); // replaced in place, order kept
  assert.equal(activate(three, "c").active, "c");
  assert.equal(activate(three, "nope"), three);
  const renamed = update(three, "b", { name: "Bracket" });
  assert.equal(renamed.tabs[1].name, "Bracket");
  assert.equal(update(three, "b", { name: "b" }), three); // nothing changed: the same object
  assert.equal(update(three, "b", { key: "k" }).active, "k"); // the active tab's key changed: still the one on screen
  assert.equal(update(three, "b", { key: "c" }), three); // two tabs never share a key
});

test("boundary: MAX_TABS tabs fit, the next one is refused by canAdd, and adding past it drops the oldest tab not on screen", () => {
  let s = NO_TABS;
  for (let i = 0; i < MAX_TABS; i++) s = addTab(s, t(`k${i}`));
  assert.equal(s.tabs.length, MAX_TABS);
  assert.equal(canAdd(s), false);
  assert.equal(canAdd({ ...s, tabs: s.tabs.slice(1) }), true);
  const over = addTab(s, t("new"));
  assert.equal(over.tabs.length, MAX_TABS);
  assert.equal(over.tabs[0].key, "k1"); // k0 was the oldest and not on screen
  assert.equal(over.active, "new");
});

test("what is stored: only kept tabs, in order, and the one on screen; a bad text gives no tabs, never an error", () => {
  const text = stored({ tabs: [t("a"), t("~1"), t("c", "slice")], active: "c" }, (k) => !k.startsWith("~"));
  assert.deepEqual(restored(text), { tabs: [t("a"), t("c", "slice")], active: "c" });
  // The one on screen was not kept: nothing is marked.
  assert.equal(restored(stored({ tabs: [t("a"), t("~1")], active: "~1" }, (k) => !k.startsWith("~"))).active, null);
  for (const bad of [null, "", "{", "[]", '{"v":2,"tabs":[]}', '{"v":1,"tabs":"x"}', '{"v":1,"tabs":[{"key":"a","name":1,"workspace":"d"}]}', '{"v":1,"tabs":[{"key":"a","name":"A","workspace":"d"},{"key":"a","name":"B","workspace":"d"}]}', '{"v":1,"tabs":[null]}']) {
    assert.deepEqual(restored(bad), NO_TABS, String(bad));
  }
  assert.equal(restored('{"v":1,"tabs":[{"key":"a","name":"A","workspace":"d"}],"active":"zzz"}').active, null); // names no tab
});

function strip(view?: () => HTMLElement | null) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const calls: string[] = [];
  const s = designTabs(doc, { activate: (k) => calls.push(`go ${k}`), close: (k) => calls.push(`close ${k}`), add: () => calls.push("add"), titles: () => ({ design: "Design", slice: "Slice" }), view });
  doc.body.append(s.element);
  return { doc, s, calls };
}

test("the strip: each tab shows its name and a workspace chip, the one on screen is selected, and it is hidden with no tabs", () => {
  const { s } = strip();
  s.render(NO_TABS);
  assert.equal(s.element.hidden, true);
  s.render({ tabs: [t("a", "design", "Bracket"), t("b", "slice", "Lid job")], active: "b" });
  assert.equal(s.element.hidden, false);
  const tabs = [...s.element.querySelectorAll<HTMLElement>(".design-tabs-tab")];
  assert.deepEqual(tabs.map((x) => x.dataset.workspace), ["design", "slice"]);
  assert.deepEqual(tabs.map((x) => x.querySelector(".design-tabs-kind")!.textContent), ["DESIGN", "SLICE"]);
  assert.deepEqual(tabs.map((x) => x.querySelector(".design-tabs-name")!.textContent), ["Bracket", "Lid job"]);
  assert.deepEqual(tabs.map((x) => x.querySelector(".design-tabs-main")!.getAttribute("aria-selected")), ["false", "true"]);
  assert.equal(tabs[1].querySelector(".design-tabs-close")!.getAttribute("aria-label"), "Close Lid job");
});

test("the strip: clicks report, the tab already on screen is not reported, and + is disabled at the limit", () => {
  const { s, calls } = strip();
  s.render({ tabs: [t("a"), t("b")], active: "a" });
  const click = (sel: string, n = 0) => (s.element.querySelectorAll<HTMLElement>(sel)[n] as HTMLElement).click();
  click(".design-tabs-main", 0); // already on screen
  click(".design-tabs-main", 1);
  click(".design-tabs-close", 0);
  click("#design-tabs-add");
  assert.deepEqual(calls, ["go b", "close a", "add"]);
  let full = NO_TABS;
  for (let i = 0; i < MAX_TABS; i++) full = addTab(full, t(`k${i}`));
  s.render(full);
  assert.equal((s.element.querySelector("#design-tabs-add") as HTMLButtonElement).disabled, true);
});

test("the close question names the design, and the dialog answers both ways", async () => {
  // Closing never throws the changes away (tabs hunt A5), so the question never says it does.
  assert.equal(closeQuestion("Bracket"), `"Bracket" has changes this browser hasn't finished storing. Closing the tab doesn't lose them: they stay kept here, and File > Projects in this browser opens it again. Close the tab?`);
  assert.doesNotMatch(closeQuestion("Bracket"), /not saved|anyway/);
  const window = new Window();
  const doc = window.document as unknown as Document;
  const yes = confirmClose(doc, "Bracket");
  (doc.getElementById("design-tabs-close-anyway") as HTMLElement).click();
  assert.equal(await yes, true);
  const no = confirmClose(doc, "");
  assert.match(doc.querySelector(".design-tabs-ask p")!.textContent ?? "", /"Untitled"/);
  (doc.getElementById("design-tabs-keep") as HTMLElement).click();
  assert.equal(await no, false);
  assert.equal(doc.querySelector(".design-tabs-ask"), null);
});

test("the phone's switcher names the design on screen with the count, and its list is built only while open", () => {
  const { s, calls, doc } = strip();
  s.render({ tabs: [t("a", "design", "Bracket"), t("b", "slice", "Lid job"), t("c")], active: "b" });
  const switcher = doc.getElementById("design-tabs-switch") as HTMLElement;
  assert.equal(switcher.querySelector(".design-tabs-name")!.textContent, "Lid job");
  assert.equal(switcher.querySelector(".design-tabs-kind")!.textContent, "SLICE");
  assert.equal(switcher.querySelector(".design-tabs-count")!.textContent, "3");
  assert.equal(switcher.getAttribute("aria-label"), "3 designs open, Lid job on screen: choose another");
  const menu = doc.getElementById("design-tabs-menu") as HTMLElement;
  assert.equal(menu.hidden, true);
  assert.equal(menu.children.length, 0); // not built while shut: the strip alone holds the tabs
  switcher.click();
  assert.equal(menu.hidden, false);
  assert.equal(switcher.getAttribute("aria-expanded"), "true");
  assert.equal(menu.querySelectorAll(".design-tabs-tab").length, 3);
  assert.equal(menu.querySelector('[data-active="true"] .design-tabs-main')!.getAttribute("aria-current"), "true");
  // Choosing a row reports it and shuts the list; × in the list reports a close and shuts it.
  (menu.querySelectorAll(".design-tabs-main")[0] as HTMLElement).click();
  assert.deepEqual(calls, ["go a"]);
  assert.equal(menu.hidden, true);
  switcher.click();
  (menu.querySelectorAll(".design-tabs-close")[2] as HTMLElement).click();
  assert.deepEqual(calls, ["go a", "close c"]);
  assert.equal(menu.hidden, true);
  // Escape shuts it too.
  switcher.click();
  doc.dispatchEvent(new (doc.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(menu.hidden, true);
});

test("tabs hunt E6: tabs read as name and workspace, only tabs are in the tablist for a screen reader, and Delete closes the focused tab", () => {
  const { s, calls, doc } = strip();
  doc.body.focus();
  s.render({ tabs: [t("a", "design", "Bracket"), t("b", "slice", "")], active: "b" });
  const tabs = [...s.element.querySelectorAll<HTMLElement>("[role=tablist] [role=tab]")];
  assert.deepEqual(tabs.map((x) => x.getAttribute("aria-label")), ["Bracket, Design", "Untitled, Slice"]); // not "BracketDESIGN"
  // Every other control in the tablist is out of a screen reader's way and out of Tab's order.
  const others = [...s.element.querySelectorAll<HTMLElement>("[role=tablist] button")].filter((b) => b.getAttribute("role") !== "tab");
  assert.equal(others.length, 2);
  assert.ok(others.every((b) => b.getAttribute("aria-hidden") === "true" && b.tabIndex === -1));
  const win = doc.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent };
  tabs[0].focus();
  tabs[0].dispatchEvent(new win.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  assert.deepEqual(calls, ["close a"]);
  // A focus elsewhere: Delete is the person's, never the strip's.
  doc.body.focus();
  doc.body.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  assert.deepEqual(calls, ["close a"]);
});

test("tabs hunt E6: a tab chosen by keyboard keeps the focus when the strip is drawn again (the tab on screen gets it)", () => {
  const { s, doc } = strip();
  s.render({ tabs: [t("a"), t("b")], active: "b" });
  (s.element.querySelector<HTMLElement>('[data-key="a"] .design-tabs-main'))!.focus(); // ArrowLeft, then Enter: a is chosen
  s.render({ tabs: [t("a"), t("b")], active: "a" });
  assert.ok(doc.activeElement === s.element.querySelector('[data-key="a"] [role=tab]'), "focus on the chosen tab"); // (a DOM node in assert.equal's diff runs out of memory)
  assert.equal(doc.activeElement?.getAttribute("aria-selected"), "true");
  // Focus outside the strip stays where it is.
  const box = doc.createElement("input");
  doc.body.append(box);
  box.focus();
  s.render({ tabs: [t("a"), t("b")], active: "b" });
  assert.ok(doc.activeElement === box, "focus left in the box");
});

test("tabs hunt E2: the stylesheet shows the phone switcher by the very query the code names (touch and short windows too)", () => {
  const css = readFileSync(new URL("../src/styles/design-tabs.css", import.meta.url), "utf8");
  const queries = [...css.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim());
  assert.deepEqual(queries, [TABS_PHONE_QUERY]);
  // A phone held sideways is 667 x 375 or 852 x 393 with a coarse pointer: each part of the query alone catches one.
  assert.match(TABS_PHONE_QUERY, /\(pointer: coarse\)/);
  assert.match(TABS_PHONE_QUERY, /\(max-height: 500px\)/);
  assert.match(TABS_PHONE_QUERY, /\(max-width: 640px\)/);
});

test("tabs hunt E3: the open phone list is capped at half the 3D view (worked: a 300 px view gives 150 px; a 60 px one still one 44 px row)", () => {
  let height = 300;
  const { s, doc } = strip(() => ({ getBoundingClientRect: () => ({ height }) }) as unknown as HTMLElement);
  s.render({ tabs: [t("a"), t("b"), t("c")], active: "a" });
  const menu = doc.getElementById("design-tabs-menu") as HTMLElement;
  const switcher = doc.getElementById("design-tabs-switch") as HTMLElement;
  switcher.click();
  assert.equal(menu.style.getPropertyValue("--design-tabs-view-half"), "150px"); // 300 / 2
  switcher.click();
  height = 60;
  switcher.click();
  assert.equal(menu.style.getPropertyValue("--design-tabs-view-half"), "44px"); // 60 / 2 = 30, raised to one row
  const css = readFileSync(new URL("../src/styles/design-tabs.css", import.meta.url), "utf8");
  assert.match(css, /max-height: min\(40dvh, calc\(5\.5 \* 44px\), var\(--design-tabs-view-half\)\)/);
});
