import { test } from "node:test";
import assert from "node:assert/strict";
import { nameToKeep, projectNameBox } from "../src/project-name.ts";

const { Window } = await import("happy-dom");

test("hand-worked: what a typed name keeps", () => {
  // Spaces either side are dropped: "  Bracket v2 " is the name "Bracket v2".
  assert.equal(nameToKeep("  Bracket v2 ", "Untitled", 100), "Bracket v2");
  // Nothing typed, or only spaces, keeps the old name (a project always has one): null, nothing to change.
  assert.equal(nameToKeep("", "Bracket", 100), null);
  assert.equal(nameToKeep("   ", "Bracket", 100), null);
  // The same name again is no change, so no undo step.
  assert.equal(nameToKeep("Bracket ", "Bracket", 100), null);
  // Longer than the limit: cut to it. 5 letters with a limit of 3 keep "abc".
  assert.equal(nameToKeep("abcde", "x", 3), "abc");
});

function made(start = "Untitled") {
  const window = new Window();
  const doc = window.document as unknown as Document;
  let name = start;
  const renamed: string[] = [];
  const box = projectNameBox(doc, { name: () => name, rename: (n) => { name = n; renamed.push(n); }, maxLength: 100 });
  doc.body.append(box.element);
  const key = (k: string) => box.element.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  const change = () => box.element.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
  return { box, renamed, key, change, set: (n: string) => (name = n) };
}

test("the box shows the project's name and renames it when the change is committed", () => {
  const { box, renamed, change } = made("Untitled");
  assert.equal(box.element.value, "Untitled");
  assert.equal(box.element.getAttribute("aria-label"), "Project name");
  assert.equal(box.element.maxLength, 100);
  box.element.value = " Bracket ";
  change();
  assert.deepEqual(renamed, ["Bracket"]);
  assert.equal(box.element.value, "Bracket");
});

test("an empty or unchanged name renames nothing and shows the name back", () => {
  const { box, renamed, change } = made("Bracket");
  box.element.value = "  ";
  change();
  box.element.value = "Bracket";
  change();
  assert.deepEqual(renamed, []);
  assert.equal(box.element.value, "Bracket");
});

test("Escape puts the name back without renaming; Enter commits it", () => {
  const { box, renamed, key } = made("Bracket");
  box.element.value = "Typo";
  key("Escape");
  assert.equal(box.element.value, "Bracket");
  assert.deepEqual(renamed, []);
  box.element.value = "Hinge";
  key("Enter");
  assert.deepEqual(renamed, ["Hinge"]);
});

test("refresh shows a name changed elsewhere (an undo, another project opened), but never under the person's typing", () => {
  const { box, set } = made("Bracket");
  set("Hinge");
  box.refresh();
  assert.equal(box.element.value, "Hinge");
  box.element.focus();
  box.element.value = "Half typ";
  set("Lid");
  box.refresh();
  assert.equal(box.element.value, "Half typ");
  box.element.blur();
});

// SL #764 item 4 (S-3, app-wide hunt 2026-11-14): a name typed was kept only on Enter or on leaving the box, so a reload
// dropped it and Ctrl+S saved the old name. It is now kept on every key, as the size boxes are (one undo step: `typing`).
function typing(start = "Untitled") {
  const window = new Window();
  const doc = window.document as unknown as Document;
  let name = start;
  const renamed: [string, boolean][] = [];
  const box = projectNameBox(doc, { name: () => name, rename: (n, t) => { name = n; renamed.push([n, t === true]); }, maxLength: 100 });
  doc.body.append(box.element);
  const type = (value: string) => {
    box.element.value = value;
    box.element.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  };
  const key = (k: string) => box.element.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  const change = () => box.element.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
  box.element.focus();
  return { box, renamed, type, key, change, name: () => name };
}

test("hand-worked: every key typed renames the project at once, as typing (one merged undo step)", () => {
  const t = typing("Untitled");
  t.type("H");
  t.type("Hi");
  t.type("Hin");
  // Three keys, three renames, each marked as typing so the shell folds them into one step "Rename project".
  assert.deepEqual(t.renamed, [["H", true], ["Hi", true], ["Hin", true]]);
  // A reload or Ctrl+S now, with the caret still in the box, finds the name on screen.
  assert.equal(t.name(), "Hin");
  assert.equal(t.box.element.value, "Hin", "the box is left alone while typed in");
});

test("typing spaces or emptying the box keeps the last name; leaving an emptied box puts back the name it had on focus", () => {
  const t = typing("Bracket");
  t.type("B ");
  t.type("");
  // "B " is the name "B"; the empty box renames nothing while typed.
  assert.deepEqual(t.renamed, [["B", true]]);
  t.change();
  // Left empty: the name it had when the box was focused comes back, as typing (folded into the same step, which then goes).
  assert.deepEqual(t.renamed, [["B", true], ["Bracket", true]]);
  assert.equal(t.box.element.value, "Bracket");
});

test("Escape after typing puts back the name the box had on focus", () => {
  const t = typing("Bracket");
  t.type("Ty");
  t.type("Typo");
  t.key("Escape");
  assert.equal(t.name(), "Bracket");
  assert.equal(t.box.element.value, "Bracket");
  assert.deepEqual(t.renamed.at(-1), ["Bracket", true]);
});

test("control: Enter after typing renames nothing more (the name is already kept)", () => {
  const t = typing("Bracket");
  t.type("Hinge");
  t.key("Enter");
  assert.deepEqual(t.renamed, [["Hinge", true]]);
  assert.equal(t.name(), "Hinge");
});
