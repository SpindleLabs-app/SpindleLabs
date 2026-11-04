// Step 35f1c: the Combine panel in a real DOM (happy-dom), and the flag that
// shows it. Every expected word and state is worked out by hand from what
// the panel was given: which field is lit, what each field says, when OK is
// on, and what the address and the tab's store say about the flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { combinePanel, EDIT_NOTE, TARGET_EMPTY, TOOLS_EMPTY, type CombineField } from "../src/combine-panel.ts";
import { COMBINE_KEY, readCombineFlag } from "../src/combine-flag.ts";

const { Window } = await import("happy-dom");

function setup() {
  const window = new Window({ width: 1280, height: 800 });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const heard: string[] = [];
  const panel = combinePanel(slot, {
    field: (w: CombineField) => heard.push(`field ${w}`),
    changed: () => heard.push("changed"),
    ok: () => heard.push("ok"),
    cancel: () => heard.push("cancel"),
  });
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const pressed = () => ["target", "tools"].filter((w) => $(`combine-${w}`).getAttribute("aria-pressed") === "true");
  return { window, doc, panel, heard, $, pressed };
}

test("hand-worked: a new Combine picks its target, then its tools, and OK is on only with both", () => {
  const { panel, $, pressed } = setup();
  // Opened with nothing picked: both fields say what to click, the target field lit, Join and Keep tools off, OK off.
  panel.show({ id: null, name: "Combine", target: null, tools: [], operation: "join", keepTools: false });
  assert.equal($("combine-panel").hidden, false);
  assert.equal($("combine-title").textContent, "Combine");
  assert.equal($("combine-target-names").textContent, TARGET_EMPTY);
  assert.equal($("combine-tools-names").textContent, TOOLS_EMPTY);
  assert.deepEqual(pressed(), ["target"]);
  assert.equal(panel.field, "target");
  assert.equal(panel.operation, "join");
  assert.equal(panel.keepTools, false);
  assert.equal(panel.ready, false);
  assert.equal($("combine-note").hidden, true);
  // The target picked: still no tool, so OK stays off.
  panel.setBodies("Body 1", []);
  assert.equal($("combine-target-names").textContent, "Body 1");
  assert.ok(!$("combine-target-names").classList.contains("combine-panel-empty"));
  assert.ok($("combine-tools-names").classList.contains("combine-panel-empty"));
  assert.equal(panel.ready, false);
  // Two tools, in the order picked: OK on.
  panel.setField("tools");
  panel.setBodies("Body 1", ["Body 3", "Body 2"]);
  assert.deepEqual(pressed(), ["tools"]);
  assert.equal($("combine-tools-names").textContent, "Body 3, Body 2");
  assert.equal(panel.ready, true);
  // Busy while the kernel checks: OK off, then on again.
  panel.busy(true);
  assert.equal(panel.ready, false);
  panel.busy(false);
  assert.equal(panel.ready, true);
  // The tools taken out again: OK off.
  panel.setBodies("Body 1", []);
  assert.equal(panel.ready, false);
  // Opened with bodies already selected (the target and a tool): the tools field picks next.
  panel.show({ id: null, name: "Combine", target: "Body 2", tools: ["Body 1"], operation: "join", keepTools: false });
  assert.deepEqual(pressed(), ["tools"]);
  assert.equal(panel.ready, true);
});

test("the panel reports what was clicked and changed, and Enter is OK only off its buttons", () => {
  const { window, panel, heard, $ } = setup();
  panel.show({ id: null, name: "Combine", target: "Body 1", tools: ["Body 2"], operation: "join", keepTools: false });
  $("combine-target").click();
  $("combine-tools").click();
  const op = $<HTMLSelectElement>("combine-operation");
  op.value = "cut";
  op.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(panel.operation, "cut");
  const keep = $<HTMLInputElement>("combine-keep");
  keep.click();
  assert.equal(panel.keepTools, true);
  $("combine-ok").click();
  $("combine-cancel").click();
  assert.deepEqual(heard, ["field target", "field tools", "changed", "changed", "ok", "cancel"]);
  // Enter on the operation list is OK; on a button it is the button's own (no second OK).
  heard.length = 0;
  op.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
  $("combine-cancel").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
  assert.deepEqual(heard, ["ok"]);
  // Enter with OK off does nothing.
  heard.length = 0;
  panel.setBodies("Body 1", []);
  op.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
  assert.deepEqual(heard, []);
});

test("an edited Combine shows its bodies, operation and Keep tools; its fields are off, with the note saying why", () => {
  const { panel, $, pressed } = setup();
  panel.show({ id: "feature-3", name: "Combine 1", target: "Body 1", tools: ["Body 2"], operation: "intersect", keepTools: true });
  assert.equal($("combine-title").textContent, "Edit Combine 1");
  assert.equal(panel.editing, "feature-3");
  assert.equal(panel.operation, "intersect");
  assert.equal(panel.keepTools, true);
  assert.equal($<HTMLButtonElement>("combine-target").disabled, true);
  assert.equal($<HTMLButtonElement>("combine-tools").disabled, true);
  assert.deepEqual(pressed(), []);
  assert.equal($("combine-note").hidden, false);
  assert.equal($("combine-note").textContent, EDIT_NOTE);
  assert.equal(panel.ready, true);
  // An error shows, and goes with "".
  panel.showError("Combine 1 can't be made: the bodies don't overlap");
  assert.equal($("combine-error").hidden, false);
  panel.showError("");
  assert.equal($("combine-error").hidden, true);
  // Closed: hidden, nothing being edited; opened new again, the fields are back on and the note gone.
  panel.hide();
  assert.equal(panel.shown, false);
  assert.equal(panel.editing, null);
  assert.equal($("combine-panel").hidden, true);
  panel.show({ id: null, name: "Combine", target: null, tools: [], operation: "join", keepTools: false });
  assert.equal($<HTMLButtonElement>("combine-target").disabled, false);
  assert.equal($("combine-note").hidden, true);
  assert.equal($<HTMLInputElement>("combine-keep").checked, false);
});

/** A tab's store, as a map, that can be made to throw. */
function store(start: Record<string, string> = {}, throws = false) {
  const m = new Map(Object.entries(start));
  const no = () => {
    if (throws) throw new Error("blocked");
  };
  return {
    m,
    getItem: (k: string) => (no(), m.get(k) ?? null),
    setItem: (k: string, v: string) => (no(), void m.set(k, v)),
    removeItem: (k: string) => (no(), void m.delete(k)),
  };
}

test("hand-worked: the flag is on with ?combine, kept for the tab, and off again with ?combine=off", () => {
  // Nothing in the address or the store: off.
  const s = store();
  assert.equal(readCombineFlag("", s), false);
  assert.equal(s.m.size, 0);
  // ?combine alone (and its other spellings): on, remembered.
  for (const q of ["?combine", "?combine=", "?combine=on", "?combine=1", "?combine=true", "?x=1&combine"]) {
    const t = store();
    assert.equal(readCombineFlag(q, t), true, q);
    assert.equal(t.m.get(COMBINE_KEY), "on", q);
  }
  // Reloaded without it: still on, from the store.
  s.setItem(COMBINE_KEY, "on");
  assert.equal(readCombineFlag("", s), true);
  assert.equal(readCombineFlag("?other=2", s), true);
  // A value that is neither: ignored, the store decides.
  assert.equal(readCombineFlag("?combine=maybe", s), true);
  assert.equal(readCombineFlag("?combine=maybe", store()), false);
  // ?combine=off: off, and forgotten, so the next load without it is off.
  for (const q of ["?combine=off", "?combine=0", "?combine=false"]) {
    s.setItem(COMBINE_KEY, "on");
    assert.equal(readCombineFlag(q, s), false, q);
    assert.equal(s.m.has(COMBINE_KEY), false, q);
    assert.equal(readCombineFlag("", s), false, q);
  }
  // A store holding anything but "on" is off.
  assert.equal(readCombineFlag("", store({ [COMBINE_KEY]: "yes" })), false);
  // A store that throws (a private window): the address alone decides, and nothing throws.
  assert.equal(readCombineFlag("?combine", store({}, true)), true);
  assert.equal(readCombineFlag("", store({}, true)), false);
  assert.equal(readCombineFlag("?combine=off", store({}, true)), false);
  // No store at all (outside a browser): the address alone.
  assert.equal(readCombineFlag("?combine", null), true);
  assert.equal(readCombineFlag("", null), false);
});
