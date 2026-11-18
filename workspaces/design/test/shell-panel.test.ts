// Step 35h2c-app2: the Shell panel in a real DOM (happy-dom), and the flag
// that shows it. Every expected word and state is worked out by hand from
// what the panel was given: when OK is on, what the box hands back, where
// the typing goes as it opens, and what the address and the tab's store say
// about the flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shellPanel } from "../src/shell-panel.ts";
import { readShellFlag, SHELL_KEY } from "../src/shell-flag.ts";
import { EDIT_FACES_NOTE } from "../src/shell.ts";
import { NO_PICKS } from "../src/shell-tool.ts";

const { Window } = await import("happy-dom");

function setup(media: (q: string) => boolean = () => false) {
  const window = new Window({ width: 1280, height: 800 });
  (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (q) => ({ matches: media(q) });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const heard: string[] = [];
  const panel = shellPanel(slot, { changed: () => heard.push("changed"), ok: () => heard.push("ok"), cancel: () => heard.push("cancel") });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  return { window, doc, panel, heard, $ };
}

test("opens at 1 mm; OK is off until a body is picked, and on for a sealed body (no face open)", () => {
  const { panel, $ } = setup();
  panel.show(NO_PICKS);
  assert.equal(panel.shown, true);
  assert.equal(panel.typed, "1");
  assert.equal($("shell-faces").textContent, "Click the faces to leave open");
  assert.equal(panel.ready, false);
  panel.setPicks({ body: "body:feature-1", faces: [] });
  assert.equal($("shell-faces").textContent, "No face open: sealed, hollow inside");
  assert.equal(panel.ready, true);
  panel.setPicks({ body: "body:feature-1", faces: [5, 2] });
  assert.equal($("shell-faces").textContent, "2 faces open");
  assert.equal($("shell-panel").dataset.open, "2");
  // Busy while the kernel checks: OK off, then on again.
  panel.busy(true);
  assert.equal(panel.ready, false);
  panel.busy(false);
  assert.equal(panel.ready, true);
});

test("a touch screen says Tap, and its keyboard is never opened by the panel; a mouse gets the typing with the number selected", () => {
  const touch = setup((q) => q.includes("coarse"));
  touch.panel.show(NO_PICKS);
  assert.equal(touch.$("shell-faces").textContent, "Tap the faces to leave open");
  assert.notEqual(touch.doc.activeElement?.id, "shell-thickness");
  const mouse = setup((q) => q.includes("hover") || q.includes("fine"));
  mouse.panel.show(NO_PICKS);
  assert.equal(mouse.doc.activeElement?.id, "shell-thickness");
});

test("Enter in the box is OK (only when OK is on), Escape is Cancel, typing says changed", () => {
  const { panel, heard, $, window } = setup();
  panel.show(NO_PICKS);
  const input = $<HTMLInputElement>("shell-thickness");
  const key = (k: string) => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  key("Enter");
  assert.deepEqual(heard, [], "OK is off: Enter does nothing");
  panel.setPicks({ body: "body:feature-1", faces: [0] });
  key("Enter");
  key("Escape");
  input.value = "2.5";
  input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  assert.deepEqual(heard, ["ok", "cancel", "changed"]);
  assert.equal(panel.typed, "2.5");
});

test("Edit feature on a Shell opens with its thickness and open count, the note shown, OK on; a new one opens fresh after", () => {
  const { panel, $ } = setup();
  panel.show(NO_PICKS, { id: "feature-4", name: "Shell 2", open: 1, thickness: 2.5 });
  assert.equal(panel.editing, "feature-4");
  assert.equal($("shell-title").textContent, "Edit Shell 2");
  assert.equal($("shell-faces").textContent, "1 face open");
  assert.equal($("shell-edit-note").hidden, false);
  assert.equal($("shell-edit-note").textContent, EDIT_FACES_NOTE);
  assert.equal(panel.typed, "2.5");
  assert.equal(panel.ready, true);
  panel.showPreview(424);
  assert.equal($("shell-panel").dataset.previewVolume, "424.000");
  panel.showPreview(null, "walls too thick", true);
  assert.equal($("shell-preview-why").classList.contains("bad"), true);
  assert.equal($("shell-preview-why").hidden, false);
  panel.hide();
  assert.equal(panel.shown, false);
  assert.equal(panel.editing, null);
  assert.equal($("shell-preview-why").hidden, true);
  panel.show(NO_PICKS);
  assert.equal($("shell-title").textContent, "Shell");
  assert.equal($("shell-edit-note").hidden, true);
  assert.equal(panel.typed, "1");
  assert.equal(panel.ready, false);
});

test("an error shows in the unit and goes", () => {
  const { panel, $ } = setup();
  panel.show(NO_PICKS);
  panel.showError("The shell can't be made: walls of 6 mm close up");
  assert.equal($("shell-error").hidden, false);
  panel.showError("");
  assert.equal($("shell-error").hidden, true);
});

test("the flag: ?shell on and remembered, =off forgets, after the # too, typed loosely; a store that throws", () => {
  const store = new Map<string, string>();
  const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  assert.equal(readShellFlag("", s), false);
  assert.equal(readShellFlag("?shell", s), true);
  assert.equal(store.get(SHELL_KEY), "on");
  assert.equal(readShellFlag("", s), true, "remembered for the tab");
  assert.equal(readShellFlag("?shell=maybe", s), true, "another value is ignored");
  assert.equal(readShellFlag("?shell=off", s), false);
  assert.equal(store.has(SHELL_KEY), false);
  assert.equal(readShellFlag("", s, "#design?shell"), true, "after the #");
  assert.equal(readShellFlag("?shell=0", s, "#design?shell"), false, "the part before the # wins");
  assert.equal(readShellFlag("?SHELL/", s), true, "capitals and a slash forgiven");
  assert.equal(readShellFlag("?chamfer", null), false, "another flag is not this one");
  const throws = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(readShellFlag("?shell", throws), true);
  assert.equal(readShellFlag("", throws), false);
});
