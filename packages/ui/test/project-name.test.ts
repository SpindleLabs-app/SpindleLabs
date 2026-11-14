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
