// Step 44a-app2: the Chamfer panel in a real DOM (happy-dom), and the flag
// that shows it. Every expected word and state is worked out by hand from
// what the panel was given: the rows each type shows, when OK is on, what
// the boxes hand back, where the typing goes as it opens, and what the
// address and the tab's store say about the flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chamferPanel } from "../src/chamfer-panel.ts";
import { CHAMFER_KEY, readChamferFlag } from "../src/chamfer-flag.ts";

const { Window } = await import("happy-dom");

function setup(media: (q: string) => boolean = () => false) {
  const window = new Window({ width: 1280, height: 800 });
  (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (q) => ({ matches: media(q) });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const heard: string[] = [];
  const panel = chamferPanel(slot, { changed: () => heard.push("changed"), ok: () => heard.push("ok"), cancel: () => heard.push("cancel") });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const shownRows = () => ["chamfer-second-row", "chamfer-angle-row", "chamfer-flip-row"].filter((id) => !$(id).hidden);
  return { window, doc, panel, heard, $, shownRows };
}

test("opens at 1 mm, Equal distance, no Flip; OK is off until an edge is picked", () => {
  const { panel, $, shownRows } = setup();
  panel.show(0);
  assert.equal(panel.shown, true);
  assert.equal($("chamfer-panel").hidden, false);
  assert.equal($<HTMLInputElement>("chamfer-distance").value, "1");
  assert.equal($<HTMLSelectElement>("chamfer-kind").value, "equal");
  assert.deepEqual(shownRows(), [], "equal: one distance, nothing to flip");
  assert.equal($("chamfer-edges").textContent, "Click the edges to chamfer");
  assert.equal($<HTMLButtonElement>("chamfer-ok").disabled, true);
  assert.equal(panel.ready, false);
  panel.setEdges(2);
  assert.equal($("chamfer-edges").textContent, "2 edges");
  assert.equal(panel.ready, true);
  assert.deepEqual(panel.typed, { kind: "equal", first: "1", second: "1", flip: false });
  panel.busy(true);
  assert.equal(panel.ready, false, "off while the kernel checks");
  panel.busy(false);
  assert.equal(panel.ready, true);
});

test("each type shows its own rows, and the boxes hand back what that type needs; Flip only counts when shown", () => {
  const { panel, $, shownRows, heard, window } = setup();
  panel.show(1);
  const kind = $<HTMLSelectElement>("chamfer-kind");
  const flip = $<HTMLInputElement>("chamfer-flip");
  flip.checked = true; // ticked while hidden: an equal chamfer has nothing to flip
  assert.equal(panel.typed.flip, false);
  kind.value = "two";
  kind.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.deepEqual(shownRows(), ["chamfer-second-row", "chamfer-flip-row"]);
  assert.equal($("chamfer-distance-label").textContent, "Distance 1");
  $<HTMLInputElement>("chamfer-distance").value = "2";
  $<HTMLInputElement>("chamfer-second").value = "3";
  assert.deepEqual(panel.typed, { kind: "two", first: "2", second: "3", flip: true });
  kind.value = "angle";
  kind.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.deepEqual(shownRows(), ["chamfer-angle-row", "chamfer-flip-row"]);
  assert.equal($("chamfer-distance-label").textContent, "Distance");
  assert.deepEqual(panel.typed, { kind: "angle", first: "2", second: "45", flip: true }, "the angle box starts at 45°");
  assert.ok(heard.filter((h) => h === "changed").length >= 2, "a type change is heard");
  // Opened again: back to the defaults.
  panel.show(1);
  assert.deepEqual(panel.typed, { kind: "equal", first: "1", second: "1", flip: false });
  assert.deepEqual(shownRows(), []);
});

test("Enter in a box is OK (only when OK is on), Escape is Cancel, a button's own Enter is its own", () => {
  const { panel, $, heard, window } = setup();
  panel.show(0);
  const key = (el: HTMLElement, k: string) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  key($("chamfer-distance"), "Enter");
  assert.deepEqual(heard, [], "no edge picked: OK is off, Enter does nothing");
  panel.setEdges(1);
  key($("chamfer-distance"), "Enter");
  assert.deepEqual(heard, ["ok"]);
  key($("chamfer-cancel"), "Enter");
  assert.deepEqual(heard, ["ok"], "a button's Enter clicks that button, not OK");
  key($("chamfer-distance"), "Escape");
  assert.deepEqual(heard, ["ok", "cancel"]);
  $("chamfer-ok").click();
  $("chamfer-cancel").click();
  assert.deepEqual(heard, ["ok", "cancel", "ok", "cancel"]);
});

test("with a mouse the Distance box has the typing as it opens, its number selected; never on a touch screen", () => {
  const mouse = setup((q) => q === "(hover: hover) and (pointer: fine)");
  mouse.panel.show(1);
  const box = mouse.$<HTMLInputElement>("chamfer-distance");
  assert.equal(mouse.doc.activeElement, box);
  assert.deepEqual([box.selectionStart, box.selectionEnd], [0, 1], "the 1 selected, so typing replaces it");
  const finger = setup((q) => q === "(pointer: coarse)");
  finger.panel.show(0);
  assert.notEqual(finger.doc.activeElement, finger.$("chamfer-distance"));
  assert.equal(finger.$("chamfer-edges").textContent, "Tap the edges to chamfer");
});

test("an error shows and goes; hide puts the panel and its error away", () => {
  const { panel, $ } = setup();
  panel.show(1);
  panel.showError("That edge is curved");
  assert.equal($("chamfer-error").hidden, false);
  assert.equal($("chamfer-error").textContent, "That edge is curved");
  panel.showError("");
  assert.equal($("chamfer-error").hidden, true);
  panel.showError("again");
  panel.hide();
  assert.equal(panel.shown, false);
  assert.equal($("chamfer-panel").hidden, true);
  assert.equal($("chamfer-error").hidden, true);
});

test("the flag: ?chamfer on and remembered, =off forgets, after the # too, typed loosely; a store that throws", () => {
  const store = new Map<string, string>();
  const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  assert.equal(readChamferFlag("", s), false);
  assert.equal(readChamferFlag("?chamfer", s), true);
  assert.equal(store.get(CHAMFER_KEY), "on");
  assert.equal(readChamferFlag("", s), true, "remembered for the tab");
  assert.equal(readChamferFlag("?chamfer=maybe", s), true, "another value is ignored");
  assert.equal(readChamferFlag("?chamfer=off", s), false);
  assert.equal(store.has(CHAMFER_KEY), false);
  assert.equal(readChamferFlag("", s, "#design?chamfer"), true, "after the #");
  assert.equal(readChamferFlag("?chamfer=0", s, "#design?chamfer"), false, "the part before the # wins");
  assert.equal(readChamferFlag("?CHAMFER/", s), true, "capitals and a slash forgiven");
  assert.equal(readChamferFlag("?combine", null), false, "another flag is not this one");
  const throws = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(readChamferFlag("?chamfer", throws), true);
  assert.equal(readChamferFlag("", throws), false);
});

test("44a-app3: Edit feature on a Chamfer opens with its type, sizes and Flip, its edges as they are, and a new one opens fresh after it", () => {
  const { panel, $, shownRows } = setup();
  panel.show(3, { id: "feature-4", name: "Chamfer 2", edges: 3, size: { two: [2, 3.5] }, flip: true });
  assert.equal(panel.editing, "feature-4");
  assert.equal($("chamfer-title").textContent, "Edit Chamfer 2");
  assert.equal($("chamfer-edges").textContent, "3 edges");
  assert.equal($("chamfer-edit-note").hidden, false);
  assert.deepEqual(shownRows(), ["chamfer-second-row", "chamfer-flip-row"]);
  assert.deepEqual(panel.typed, { kind: "two", first: "2", second: "3.5", flip: true });
  assert.equal(panel.ready, true);
  // The preview's volume as drawn, and why there is none.
  panel.showPreview(955);
  assert.equal($("chamfer-panel").dataset.previewVolume, "955.000");
  panel.showPreview(null, "No preview: an item after this Chamfer changes the body, so the result shows after OK.");
  assert.equal($("chamfer-panel").dataset.previewVolume, "");
  assert.equal($("chamfer-preview-why").hidden, false);
  panel.hide();
  assert.equal(panel.editing, null);
  assert.equal($("chamfer-preview-why").hidden, true);
  // An angle chamfer: the angle box, not the second distance.
  panel.show(1, { id: "feature-5", name: "Chamfer 3", edges: 1, size: { angle: [2, 30] }, flip: false });
  assert.deepEqual(panel.typed, { kind: "angle", first: "2", second: "30", flip: false });
  // A new one after: the defaults, the plain title, no note.
  panel.show(0);
  assert.equal(panel.editing, null);
  assert.equal($("chamfer-title").textContent, "Chamfer");
  assert.equal($("chamfer-edit-note").hidden, true);
  assert.deepEqual(panel.typed, { kind: "equal", first: "1", second: "1", flip: false });
});
