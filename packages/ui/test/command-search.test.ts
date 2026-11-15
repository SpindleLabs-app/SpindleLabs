// The command search box (command-search.ts, the S key): the matching worked
// by hand, and the box in a real DOM (happy-dom): typing narrows, the arrows
// move, Enter runs the marked command, an off one never runs, Escape and a
// press outside close it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { commandSearch, matchCommands, shellCommands, type Command } from "../src/command-search.ts";

const { Window } = await import("happy-dom");

const ran: string[] = [];
const cmd = (id: string, label: string, off?: string): Command => ({ id, label, off, run: () => void ran.push(id) });
const COMMANDS = [cmd("sketch", "Create sketch"), cmd("extrude", "Extrude"), cmd("move", "Move"), cmd("fillet", "Fillet", "Fillet is coming soon"), cmd("remove", "Remove body")];

test("matching by hand: every word somewhere in the name, any case; names starting with the query first", () => {
  const ids = (q: string) => matchCommands(COMMANDS, q).map((c) => c.id);
  assert.deepEqual(ids(""), ["sketch", "extrude", "move", "fillet", "remove"], "nothing typed: all, in order");
  assert.deepEqual(ids("   "), ["sketch", "extrude", "move", "fillet", "remove"]);
  // "mo": in "Move" (at the start) and "Remove body" (inside): Move first.
  assert.deepEqual(ids("mo"), ["move", "remove"]);
  assert.deepEqual(ids("MO"), ["move", "remove"], "any case");
  // Two words, both needed, in any order: "body re" is only "Remove body".
  assert.deepEqual(ids("body re"), ["remove"]);
  assert.deepEqual(ids("ske crea"), ["sketch"]);
  assert.deepEqual(ids("zzz"), []);
  // "e": in every name but "Fillet"? No: Fillet has an e too. All five, "Extrude" (starting so) first.
  assert.deepEqual(ids("e"), ["extrude", "sketch", "move", "fillet", "remove"]);
});

function page() {
  const window = new Window({ url: "https://example.org/" });
  const doc = window.document as unknown as Document;
  const key = (k: string) => doc.getElementById("command-search-input")!.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  const type = (t: string) => {
    const input = doc.getElementById("command-search-input") as HTMLInputElement;
    input.value = t;
    input.dispatchEvent(new window.Event("input") as unknown as Event);
  };
  const rows = () => [...doc.querySelectorAll("#command-search-list li")].map((li) => `${li.textContent}${li.getAttribute("aria-selected") === "true" ? " *" : ""}`);
  return { doc, window, key, type, rows };
}

test("the box: opens focused with every command, narrows as typed, the arrows move, Enter runs the marked one and closes", () => {
  ran.length = 0;
  const { doc, key, type, rows } = page();
  const box = commandSearch(doc, () => COMMANDS);
  box.open();
  assert.equal(box.isOpen, true);
  assert.equal(doc.activeElement?.id, "command-search-input");
  assert.deepEqual(rows(), ["Create sketch *", "Extrude", "Move", "FilletFillet is coming soon", "Remove body"]);
  type("mo");
  assert.deepEqual(rows(), ["Move *", "Remove body"]);
  key("ArrowDown");
  assert.deepEqual(rows(), ["Move", "Remove body *"]);
  key("ArrowDown"); // wraps round
  assert.deepEqual(rows(), ["Move *", "Remove body"]);
  key("ArrowUp");
  key("Enter");
  assert.deepEqual(ran, ["remove"]);
  assert.equal(box.isOpen, false);
  assert.equal(doc.querySelector(".command-search"), null);
});

test("an off command is listed but never runs (the first runnable one is marked); nothing matching says so", () => {
  ran.length = 0;
  const { doc, key, type, rows } = page();
  const box = commandSearch(doc, () => COMMANDS);
  box.open();
  type("fil");
  assert.deepEqual(rows(), ["FilletFillet is coming soon *"]);
  key("Enter");
  assert.deepEqual(ran, [], "an off command never runs");
  assert.equal(box.isOpen, true);
  (doc.querySelector("#command-search-list li") as HTMLElement).click();
  assert.deepEqual(ran, [], "nor by a click");
  type("e");
  assert.equal(rows()[0], "Extrude *", "the first that can run is marked");
  type("nothing like it");
  assert.deepEqual(rows(), []);
  assert.equal((doc.querySelector(".command-search-none") as HTMLElement).hidden, false);
});

test("Escape and a press outside close it, running nothing; the commands are read afresh at each open", () => {
  ran.length = 0;
  const { doc, window, key } = page();
  let list = COMMANDS.slice(0, 1);
  const box = commandSearch(doc, () => list);
  box.open();
  key("Escape");
  assert.equal(box.isOpen, false);
  list = COMMANDS;
  box.open();
  assert.equal(doc.querySelectorAll("#command-search-list li").length, 5);
  doc.querySelector(".command-search")!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }) as unknown as Event);
  assert.equal(box.isOpen, false);
  assert.deepEqual(ran, []);
});

test("issue #523: a press on a dimmed row keeps the focus in the box, so Escape still closes it", () => {
  ran.length = 0;
  const { doc, window, key, type } = page();
  const box = commandSearch(doc, () => COMMANDS);
  box.open();
  type("fillet");
  const row = doc.querySelector("#command-search-list li") as HTMLElement;
  // The browser moves the focus on a mousedown unless it is prevented: a row must prevent it.
  const down = new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }) as unknown as Event;
  row.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true, "a press on a row would take the focus out of the box");
  // Should the focus have gone anyway (a touch), the click on the off row puts it back.
  (doc.activeElement as HTMLElement).blur();
  row.click();
  assert.deepEqual(ran, []);
  assert.equal(doc.activeElement?.id, "command-search-input");
  key("Escape");
  assert.equal(box.isOpen, false);
});

test("issue #523: the shell's commands (Undo, Save…) are listed after the workspace's, read at each open", () => {
  ran.length = 0;
  const { doc, type, rows } = page();
  let undoOff: string | undefined = "Nothing to undo";
  shellCommands(doc, () => [cmd("undo", "Undo", undoOff), cmd("save", "Save")]);
  const box = commandSearch(doc, () => COMMANDS.slice(0, 2));
  box.open();
  assert.deepEqual(rows(), ["Create sketch *", "Extrude", "UndoNothing to undo", "Save"]);
  box.close();
  undoOff = undefined;
  box.open();
  type("und");
  assert.deepEqual(rows(), ["Undo *"]);
  box.close();
});

test("the box is modal (accessibility pass 2026-11-11): Tab never leaves it for the page behind, and the list is named", () => {
  const { doc, window } = page();
  const box = commandSearch(doc, () => COMMANDS);
  box.open();
  const tab = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }) as unknown as Event;
  doc.getElementById("command-search-input")!.dispatchEvent(tab);
  // A browser moves the focus on a Tab only when nothing prevented it: here the box prevents it, so the focus stays put.
  assert.equal(tab.defaultPrevented, true, "Tab is kept in the box");
  assert.equal(box.isOpen, true);
  assert.equal(doc.getElementById("command-search-list")!.getAttribute("aria-label"), "Commands");
  box.close();
});
