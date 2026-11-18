// Step 61c: the Pattern panel in a real DOM (happy-dom), and the flag that
// shows it. Every expected word and state is worked out by hand from what
// the panel was given: the rows each kind shows, when OK is on, what the
// boxes hand back, the typed-box rule (an empty box shows 0 once left, the
// angle stays empty), Enter and Escape, Edit feature's boxes, and what the
// address and the tab's store say about the flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { patternPanel, PATTERN_DEFAULTS } from "../src/pattern-panel.ts";
import { PATTERN_KEY, readPatternFlag } from "../src/pattern-flag.ts";
import { readPatternBoxes } from "../src/pattern-tool.ts";
import { EDIT_BODIES_NOTE } from "../src/pattern.ts";

const { Window } = await import("happy-dom");

function setup(media: (q: string) => boolean = () => false) {
  const window = new Window({ width: 1280, height: 800 });
  (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (q) => ({ matches: media(q) });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const heard: string[] = [];
  const panel = patternPanel(slot, { changed: () => heard.push("changed"), ok: () => heard.push("ok"), cancel: () => heard.push("cancel") });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const ROWS = ["pattern-direction-row", "pattern-spacing-row", "pattern-count-row", "pattern-direction2-row", "pattern-spacing2-row", "pattern-count2-row", "pattern-axis-row", "pattern-centre-row", "pattern-count3-row", "pattern-angle-row"];
  const shownRows = () => ROWS.filter((id) => !$(id).hidden);
  const choose = (id: string, value: string) => {
    const s = $<HTMLSelectElement>(id);
    s.value = value;
    s.dispatchEvent(new window.Event("change") as unknown as Event);
  };
  const type = (id: string, value: string) => {
    const i = $<HTMLInputElement>(id);
    i.value = value;
    i.dispatchEvent(new window.Event("input") as unknown as Event);
  };
  return { window, doc, panel, heard, $, shownRows, choose, type };
}

test("opens as a row of 3 along X at the spacing given; OK is off until a body is picked; the bodies are named", () => {
  const { panel, $, shownRows } = setup();
  panel.show([], 15);
  assert.equal(panel.shown, true);
  assert.equal($("pattern-panel").hidden, false);
  assert.equal($("pattern-title").textContent, "Pattern");
  assert.deepEqual(shownRows(), ["pattern-direction-row", "pattern-spacing-row", "pattern-count-row"]);
  assert.equal($<HTMLInputElement>("pattern-spacing").value, "15");
  assert.equal($<HTMLInputElement>("pattern-count").value, "3");
  assert.equal($<HTMLInputElement>("pattern-join").checked, false, "Join off by default, as Fusion's");
  assert.equal($("pattern-bodies").textContent, "Click the bodies to repeat, in the view or the browser.");
  assert.equal(panel.ready, false);
  panel.setBodies(["Body 1"]);
  assert.equal($("pattern-bodies").textContent, "Repeating Body 1");
  assert.equal(panel.ready, true);
  panel.setBodies(["Body 1", "Body 2", "Body 3"]);
  assert.equal($("pattern-bodies").textContent, "Repeating Body 1, Body 2 and Body 3");
  assert.deepEqual(readPatternBoxes(panel.typed), { kind: "linear", direction: "X", spacing: 15, count: 3, join: false });
  panel.busy(true);
  assert.equal(panel.ready, false, "off while the kernel checks");
  panel.busy(false);
  assert.equal(panel.ready, true);
  // Without a spacing given, the default's 20 mm.
  panel.show([]);
  assert.equal($<HTMLInputElement>("pattern-spacing").value, PATTERN_DEFAULTS.spacing);
});

test("each kind shows its own rows and the boxes hand back what that kind needs; a touch screen says tap", () => {
  const { panel, $, shownRows, choose, type, heard, window } = setup((q) => q === "(pointer: coarse)");
  panel.show([], 15);
  assert.equal($("pattern-bodies").textContent, "Tap the bodies to repeat, in the view or the browser.");
  choose("pattern-kind", "grid");
  assert.deepEqual(shownRows(), ["pattern-direction-row", "pattern-spacing-row", "pattern-count-row", "pattern-direction2-row", "pattern-spacing2-row", "pattern-count2-row"]);
  type("pattern-count2", "4");
  choose("pattern-direction2", "Z");
  assert.deepEqual(readPatternBoxes(panel.typed), { kind: "linear", direction: "X", spacing: 15, count: 3, direction2: "Z", spacing2: 15, count2: 4, join: false });
  choose("pattern-kind", "circular");
  assert.deepEqual(shownRows(), ["pattern-axis-row", "pattern-centre-row", "pattern-count3-row", "pattern-angle-row"]);
  type("pattern-centre-x", "10");
  type("pattern-angle", "90");
  $<HTMLInputElement>("pattern-join").checked = true;
  $<HTMLInputElement>("pattern-join").dispatchEvent(new window.Event("change") as unknown as Event);
  assert.deepEqual(readPatternBoxes(panel.typed), { kind: "circular", axis: "Z", centre: [10, 0, 0], count: 6, angle: 90, join: true });
  // Every change was told: two kinds and a direction chosen, three boxes typed, Join ticked.
  assert.equal(heard.filter((h) => h === "changed").length, 7);
});

test("the typed-box rule: an empty box counts as 0 and shows 0 once the focus leaves it; the empty angle stays empty, a full turn", () => {
  const { panel, $, type, heard, window } = setup();
  panel.show(["Body 1"], 15);
  type("pattern-spacing", "");
  assert.equal(readPatternBoxes(panel.typed).kind === "linear" && (readPatternBoxes(panel.typed) as { spacing: number }).spacing, 0, "counts as 0 meanwhile");
  const before = heard.length;
  $<HTMLInputElement>("pattern-spacing").dispatchEvent(new window.Event("blur") as unknown as Event);
  assert.equal($<HTMLInputElement>("pattern-spacing").value, "0");
  assert.equal(heard.length, before + 1, "the preview is asked again");
  type("pattern-count", "");
  $<HTMLInputElement>("pattern-count").dispatchEvent(new window.Event("blur") as unknown as Event);
  assert.equal($<HTMLInputElement>("pattern-count").value, "0");
  const angle = $<HTMLInputElement>("pattern-angle");
  angle.dispatchEvent(new window.Event("blur") as unknown as Event);
  assert.equal(angle.value, "", "empty is a full turn");
  assert.equal(angle.placeholder, "360");
});

test("Enter in a box is OK (only while OK is on), Escape is Cancel, the buttons say so", () => {
  const { panel, $, heard, window } = setup();
  panel.show([], 15);
  const key = (id: string, k: string) => $(id).dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  key("pattern-spacing", "Enter");
  assert.deepEqual(heard, [], "no body: OK is off");
  panel.setBodies(["Body 1"]);
  key("pattern-spacing", "Enter");
  key("pattern-count", "Escape");
  $<HTMLButtonElement>("pattern-ok").click();
  $<HTMLButtonElement>("pattern-cancel").click();
  assert.deepEqual(heard, ["ok", "cancel", "ok", "cancel"]);
});

test("Edit feature: the title names it, the note says its bodies stay, the boxes hold its values; hiding lets it go", () => {
  const { panel, $, shownRows } = setup();
  panel.show(["Box 1"], undefined, { id: "feature-3", name: "Pattern 1", bodies: ["body:feature-1"], values: { kind: "circular", axis: "Y", centre: [1, 2, 3], count: 5, angle: -120, join: true } });
  assert.equal(panel.editing, "feature-3");
  assert.equal($("pattern-title").textContent, "Edit Pattern 1");
  assert.equal($("pattern-edit-note").hidden, false);
  assert.equal($("pattern-edit-note").textContent, EDIT_BODIES_NOTE);
  assert.deepEqual(shownRows(), ["pattern-axis-row", "pattern-centre-row", "pattern-count3-row", "pattern-angle-row"]);
  assert.deepEqual(readPatternBoxes(panel.typed), { kind: "circular", axis: "Y", centre: [1, 2, 3], count: 5, angle: -120, join: true });
  panel.hide();
  assert.equal(panel.shown, false);
  assert.equal(panel.editing, null);
  assert.equal($("pattern-panel").hidden, true);
  panel.show([], 15);
  assert.equal($("pattern-edit-note").hidden, true, "a new one has no note");
  assert.equal($("pattern-title").textContent, "Pattern");
});

test("the preview's state and the refusal: copies counted for the e2e test, why in quiet or red words, put away by an empty message", () => {
  const { panel, $ } = setup();
  panel.show(["Body 1"], 15);
  panel.showPreview(2);
  assert.equal($("pattern-panel").dataset.previewCopies, "2");
  assert.equal($("pattern-preview-why").hidden, true);
  panel.showPreview(null, "A pattern needs at least 2, the body and one copy.", true);
  assert.equal($("pattern-panel").dataset.previewCopies, "");
  assert.equal($("pattern-preview-why").hidden, false);
  assert.equal($("pattern-preview-why").classList.contains("bad"), true);
  panel.showPreview(null, "No preview for a joined Pattern: its bodies are drawn joined, so the result shows after OK.");
  assert.equal($("pattern-preview-why").classList.contains("bad"), false, "a reason with no fault is quiet");
  panel.showError("The design changed while the Pattern was checked: nothing was changed. Press OK again.");
  assert.equal($("pattern-error").hidden, false);
  panel.showError("");
  assert.equal($("pattern-error").hidden, true);
});

test("the flag: ?pattern turns it on and keeps it for the tab, ?pattern=off forgets it, after the # too; anything else keeps the store", () => {
  const store = new Map<string, string>();
  const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  assert.equal(readPatternFlag("", s), false);
  assert.equal(readPatternFlag("?pattern", s), true);
  assert.equal(store.get(PATTERN_KEY), "on");
  assert.equal(readPatternFlag("", s), true, "kept for the tab");
  assert.equal(readPatternFlag("?pattern=maybe", s), true, "an unknown value keeps the store");
  assert.equal(readPatternFlag("?Pattern=OFF/", s), false, "capitals and a slash forgiven");
  assert.equal(store.has(PATTERN_KEY), false);
  assert.equal(readPatternFlag("", s, "#design?pattern=1"), true, "after the #");
  assert.equal(readPatternFlag("?pattern=0", s, "#design?pattern"), false, "the part before the # wins");
  const throwing = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
  assert.equal(readPatternFlag("?pattern", throwing), true);
  assert.equal(readPatternFlag("", throwing), false, "a store that throws counts as empty");
});

test("the spacing follows the picked bodies until it is typed in; an edited Pattern's spacing never moves", () => {
  const { panel, $, type, choose } = setup();
  // A cube 10 long along X and 30 along Y, with START_GAP's 5: 15 along X, 35 along Y.
  const along = (axis: string) => (axis === "X" ? 15 : axis === "Y" ? 35 : 25);
  panel.show([]);
  panel.followSpacing(along);
  assert.equal($<HTMLInputElement>("pattern-spacing").value, "15");
  assert.equal($<HTMLInputElement>("pattern-spacing2").value, "35", "the grid's second way, along Y");
  choose("pattern-direction", "Z");
  panel.followSpacing(along);
  assert.equal($<HTMLInputElement>("pattern-spacing").value, "25", "a new direction measures again");
  type("pattern-spacing", "12");
  panel.followSpacing(along);
  assert.equal($<HTMLInputElement>("pattern-spacing").value, "12", "typed: kept");
  assert.equal($<HTMLInputElement>("pattern-spacing2").value, "35");
  // Shown again for a new Pattern, it follows once more.
  panel.show([]);
  panel.followSpacing(along);
  assert.equal($<HTMLInputElement>("pattern-spacing").value, "15");
  panel.show(["Box 1"], undefined, { id: "feature-3", name: "Pattern 1", bodies: ["body:feature-1"], values: { kind: "linear", direction: "X", spacing: 40, count: 2, join: false } });
  panel.followSpacing(along);
  assert.equal($<HTMLInputElement>("pattern-spacing").value, "40", "an edit keeps its own");
});
