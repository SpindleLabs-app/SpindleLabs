// The design tabs (design-tabs.ts): the list rules worked out by hand, then the strip in a DOM (happy-dom).
// The real app in Chromium: apps/fission/e2e/tabs.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate, addTab, canAdd, closeQuestion, confirmClose, designTabs, MAX_TABS, NO_TABS, removeTab, restored, shortName, stored, tabName, update, workspaceChip, type DesignTab, type TabsState } from "../src/design-tabs.ts";

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

function strip() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const calls: string[] = [];
  const s = designTabs(doc, { activate: (k) => calls.push(`go ${k}`), close: (k) => calls.push(`close ${k}`), add: () => calls.push("add"), titles: () => ({ design: "Design", slice: "Slice" }) });
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
  assert.equal(closeQuestion("Bracket"), '"Bracket" has changes that are not saved yet. Close it anyway?');
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
