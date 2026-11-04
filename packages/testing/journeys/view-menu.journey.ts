// Journey: the menu on a body in the 3D view (missing basics, Ben
// 2026-11-04) in the real Design workspace on the real WASM kernel, mounted
// as the app mounts it (design-app.ts). A right-click (or a held finger) on
// a body's face or edge selects it as a click does (a face already picked
// keeps a Shift-picked set) and opens its Body row's menu with Hide first:
// Hide, Edit feature, Move the marker here, Suppress, Rename, Delete, each
// one undo step. Nothing opens on empty space or while a sketch is open.
// Hand-worked volumes first, then seeded sessions against a plain model,
// then bugs planted in workspace.ts, each caught. Run with `npm run journeys`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import type { WorkspacePlugin } from "@fission/core";
import { addSketch, designWorkspace, drawRectangle, extrudeSketch, partDocument, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

/**
 * Three bodies, in build order: Box 1 (feature-1, 10 × 10 × 10 = 1000 mm³),
 * Extrude 1 of a 40 × 30 rectangle from (0, 0) by 20 (24000 mm³) and
 * Extrude 2 of a 5 × 5 rectangle from (100, 100) by 4 (100 mm³). Each has 6
 * faces, so on screen body k's faces are 6k … 6k + 5 among those shown.
 */
function three() {
  let doc: DesignDocument = partDocument("box", 10, 10, 10);
  const s1 = addSketch(doc);
  const e1 = extrudeSketch(drawRectangle(s1.doc, s1.id, [0, 0], [40, 30]).doc, s1.id, 20);
  const s2 = addSketch(e1.doc);
  const e2 = extrudeSketch(drawRectangle(s2.doc, s2.id, [100, 100], [105, 105]).doc, s2.id, 4);
  doc = e2.doc;
  return { doc, items: ["feature-1", e1.id, e2.id], names: ["Box 1", "Extrude 1", "Extrude 2"], volumes: [1000, 24000, 100], sketch: s1.id };
}

const ENTRIES = ["hide", "edit", "marker", "suppress", "rename", "delete"];
type App = Awaited<ReturnType<typeof app>>;
/** The feature each selected face or edge is named on ("face:feature-4/top" is feature-4's). */
const selectedOn = (a: App) => a.selection.items.map((r) => r.id.slice(r.id.indexOf(":") + 1, r.id.indexOf("/")));

/** The hand-worked case, as a check returning what went wrong (null: nothing), so the planted bugs can be run through it too. */
async function handWorked(plugin: WorkspacePlugin): Promise<string | null> {
  const { doc, items, sketch } = three();
  const a = await app(doc, plugin);
  const fail = async (why: string) => (await a.close(), why);
  if (!close(a.volume(), 25100)) return fail(`at the start the view holds ${a.volume()}, not 1000 + 24000 + 100`);
  // Face 7 is past Box 1's six (0-5): Extrude 1's. Its menu opens, named for it, with Hide first; its face is selected.
  if (!(await a.viewMenu({ face: 7 }))) return fail("a right-click on Extrude 1's face opened no menu");
  const m = a.menuShown();
  if (m?.name !== "Extrude 1") return fail(`the menu is named "${m?.name}", not "Extrude 1"`);
  if (JSON.stringify(m.entries) !== JSON.stringify(ENTRIES)) return fail(`the menu holds ${m.entries.join(", ")}`);
  if (JSON.stringify(selectedOn(a)) !== JSON.stringify([items[1]]) || a.selection.items[0].kind !== "face") return fail(`the right-click selected ${a.selection.items.map((r) => r.id).join(", ")}`);
  if (a.history.canUndo()) return fail("opening the menu recorded an undo step");
  // Hide: one step, "Hide Body 2"; the view drops Extrude 1's 24000 mm³ and nothing stays selected.
  await a.chooseEntry("hide");
  if (a.history.undoLabel() !== "Hide Body 2") return fail(`Hide was recorded as "${a.history.undoLabel()}"`);
  if (!close(a.volume(), 1100)) return fail(`after Hide the view holds ${a.volume()}, not 1000 + 100`);
  if (a.selection.items.length !== 0) return fail("the hidden body's face stayed selected");
  if (a.menuShown() !== null) return fail("the menu stayed open after Hide");
  // Body 2 hidden, face 7 is now Extrude 2's (second of those shown); Escape chooses nothing and records nothing.
  await a.viewMenu({ face: 7 });
  if (a.menuShown()?.name !== "Extrude 2") return fail(`with Body 2 hidden, face 7's menu is "${a.menuShown()?.name}"`);
  await a.chooseEntry(null);
  if (a.menuShown() !== null || a.history.undoLabel() !== "Hide Body 2") return fail("Escape did not close the menu untouched");
  if ((await a.undo()) !== "Hide Body 2" || !close(a.volume(), 25100)) return fail(`Undo of Hide left ${a.volume()}`);

  // Two faces Shift-picked: a right-click on one of them keeps both; on another body's face, only that one.
  await a.pick({ face: 1 });
  await a.pick({ face: 2, shift: true });
  await a.viewMenu({ face: 2 });
  if (a.selection.items.length !== 2) return fail(`a right-click on a picked face left ${a.selection.items.length} selected, not the 2 picked`);
  await a.chooseEntry(null);
  await a.viewMenu({ face: 8 });
  if (JSON.stringify(selectedOn(a)) !== JSON.stringify([items[1]])) return fail(`a right-click on an unpicked face left ${selectedOn(a).join(", ")} selected`);
  await a.chooseEntry(null);

  // Delete from Box 1's edge 0 (an edge picks its body as a face does): nothing is built from it, so no question.
  await a.viewMenu({ edge: 0 });
  if (a.menuShown()?.name !== "Box 1") return fail(`edge 0's menu is "${a.menuShown()?.name}", not Box 1's`);
  if (a.selection.items[0]?.kind !== "edge") return fail("the right-click on an edge did not select the edge");
  await a.chooseEntry("delete");
  if (a.window.document.querySelector("#delete-ask[open]") !== null) return fail("deleting Box 1 asked a question");
  if (a.history.undoLabel() !== "Delete Box 1" || !close(a.volume(), 24100)) return fail(`Delete left "${a.history.undoLabel()}" and ${a.volume()}`);
  // The deleted box's edge leaves the selection (it stayed before this journey found it).
  if (a.selection.items.length !== 0) return fail(`after Delete ${a.selection.items.map((r) => r.id).join(", ")} stayed selected`);
  await a.undo();
  // Suppress Extrude 2 (face 13: the third body's second face): 100 mm³ less.
  await a.viewMenu({ face: 13 });
  await a.chooseEntry("suppress");
  if (a.history.undoLabel() !== "Suppress Extrude 2" || !close(a.volume(), 25000)) return fail(`Suppress left "${a.history.undoLabel()}" and ${a.volume()}`);
  await a.undo();
  // Rename Extrude 1 to Bracket through its box; its menu is then named Bracket.
  await a.viewMenu({ face: 6 });
  await a.chooseEntry("rename");
  const input = a.$("#rename-input") as HTMLInputElement | null;
  if (!input || !(a.$("#rename-box") as HTMLDialogElement).open) return fail("Rename opened no box");
  input.value = "Bracket";
  a.$("#rename-save")!.click();
  await a.settle();
  if (a.history.undoLabel() !== "Rename Extrude 1") return fail(`Rename was recorded as "${a.history.undoLabel()}"`);
  await a.viewMenu({ face: 6 });
  if (a.menuShown()?.name !== "Bracket") return fail(`after the rename the menu is "${a.menuShown()?.name}"`);
  await a.chooseEntry(null);
  await a.undo();
  // Edit feature on Extrude 1: its height 20 → 10 halves it, 40 · 30 · 10 = 12000, so 1000 + 12000 + 100 in view.
  await a.viewMenu({ face: 9 });
  await a.chooseEntry("edit");
  const height = a.$("#edit-height") as HTMLInputElement | null;
  if (!height) return fail("Edit feature opened no height box");
  height.value = "10";
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  if (!close(a.volume(), 13100)) return fail(`after Edit feature the view holds ${a.volume()}, not 13100`);
  await a.undo();
  // Move the marker to just after Box 1: the extrudes roll back, 1000 left.
  await a.viewMenu({ face: 3 });
  await a.chooseEntry("marker");
  if (!close(a.volume(), 1000)) return fail(`after the marker move the view holds ${a.volume()}, not 1000`);
  await a.undo();

  // No menu on empty space, on a face no body has (18 faces in all), or while a sketch is open.
  a.selection.clear();
  if ((await a.viewMenu({ face: null })) || a.menuShown() !== null) return fail("a right-click on empty space opened a menu");
  if ((await a.viewMenu({ face: 18 })) || a.menuShown() !== null) return fail("a right-click past the last face opened a menu");
  await a.menu(sketch, "edit-sketch");
  if (!a.sketching()) return fail("Edit Sketch did not open the sketch");
  if ((await a.viewMenu({ face: 1 })) || a.menuShown() !== null) return fail("a right-click opened a menu with a sketch open");
  if (a.selection.items.length !== 0) return fail("a right-click with a sketch open selected something");
  await a.finish();
  if (!(await a.close())) return "bodies left in the kernel's store";
  return null;
}

test("hand-worked: a right-click on each body opens its menu; Hide, Delete, Suppress, Rename, Edit feature and the marker each do what the row's menu does, one undo step each", async () => {
  assert.equal(await handWorked(designWorkspace), null);
});

// ---- Seeded sessions against a plain model ----

/** A small seeded generator (mulberry32): the same seed gives the same session. */
function random(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type Choice = "hide" | "suppress" | "delete" | null;
type Step = { do: "menu"; slot: number; face: number; choice: Choice } | { do: "empty" } | { do: "pick"; slot: number; face: number; shift: boolean } | { do: "undo" } | { do: "redo" };
/** Each body: on screen, hidden, suppressed or deleted (all but the first are the view's to undo). */
type State = "shown" | "hidden" | "suppressed" | "deleted";

function randomSteps(seed: number, n: number): Step[] {
  const r = random(seed);
  const steps: Step[] = [];
  for (let k = 0; k < n; k++) {
    const x = r();
    // `slot` is a place among the bodies on screen (2: the third, if three are shown); past those shown is empty space.
    if (x < 0.5) steps.push({ do: "menu", slot: Math.floor(r() * 3), face: Math.floor(r() * 6), choice: ([null, "hide", "suppress", "delete"] as const)[Math.floor(r() * 4)] });
    else if (x < 0.58) steps.push({ do: "empty" });
    else if (x < 0.7) steps.push({ do: "pick", slot: Math.floor(r() * 3), face: Math.floor(r() * 6), shift: r() < 0.5 });
    else if (x < 0.88) steps.push({ do: "undo" });
    else steps.push({ do: "redo" });
  }
  return steps;
}

/** One session; null when the app matched the model after every step, else what differed and where. */
async function runSession(seed: number, steps: Step[], plugin: WorkspacePlugin, reached = new Set<string>()): Promise<string | null> {
  const { doc, items, names, volumes } = three();
  const a = await app(doc, plugin);
  let states: State[] = ["shown", "shown", "shown"];
  const undo: { states: State[]; label: string }[] = [];
  const redo: { states: State[]; label: string }[] = [];
  /** The features whose faces are selected, as the model has them. */
  let selected: string[] = [];
  const done: string[] = [];
  const shown = () => states.flatMap((s, i) => (s === "shown" ? [i] : []));
  const check = (what: string): string | null => {
    const want = shown().reduce((v, i) => v + volumes[i], 0);
    if (!close(a.volume(), want)) return `${what}: the view holds ${a.volume()}, the model ${want}`;
    if ((a.history.undoLabel() ?? null) !== (undo.at(-1)?.label ?? null)) return `${what}: Undo would undo "${a.history.undoLabel()}", the model "${undo.at(-1)?.label}"`;
    if (JSON.stringify(selectedOn(a)) !== JSON.stringify(selected)) return `${what}: ${selectedOn(a).join(",")} selected, the model ${selected.join(",")}`;
    if (a.menuShown() !== null) return `${what}: a menu is still open`;
    return null;
  };
  let failure = check(`seed ${seed} at the start`);
  for (const [k, step] of steps.entries()) {
    if (failure) break;
    const what = `seed ${seed} step ${k} ${JSON.stringify(step)} after ${done.slice(-6).join("; ")}`;
    done.push(JSON.stringify(step));
    const on = shown();
    if (step.do === "menu" || step.do === "empty") {
      const body = step.do === "menu" ? on[step.slot] : undefined;
      const opened = await a.viewMenu({ face: step.do === "menu" && body !== undefined ? 6 * step.slot + step.face : null });
      if (body === undefined) {
        reached.add("menu on empty space");
        if (opened || a.menuShown() !== null) failure = `${what}: a menu opened on empty space`;
        failure ??= check(what);
        continue;
      }
      if (!opened) {
        failure = `${what}: no menu opened on ${names[body]}`;
        continue;
      }
      const m = a.menuShown();
      // The marker stands after the last item at first and the view can't move it: on Extrude 2, the last, "Move the marker here" is off.
      const entries = ENTRIES.map((e) => (e === "marker" && body === 2 ? "marker (off)" : e));
      if (m?.name !== names[body] || JSON.stringify(m.entries) !== JSON.stringify(entries)) failure = `${what}: the menu is ${JSON.stringify(m)}, the model ${names[body]}`;
      // A right-click on an unpicked body's face selects it alone; on a picked one, the picks stay.
      reached.add(selected.length > 1 && selected.includes(items[body]) ? "menu on one of several picked" : "menu selects");
      // The model tracks bodies, not faces (a picked body's other face is not picked): what it holds is the app's, checked to include this body.
      selected = selectedOn(a);
      if (!selected.includes(items[body])) failure ??= `${what}: ${names[body]}'s face is not selected after its menu opened`;
      await a.chooseEntry(step.choice);
      if (step.choice === null) {
        reached.add("menu closed by Escape");
        failure ??= check(what);
        continue;
      }
      reached.add(`menu ${step.choice}`);
      const label = step.choice === "hide" ? `Hide Body ${body + 1}` : `${step.choice === "delete" ? "Delete" : "Suppress"} ${names[body]}`;
      undo.push({ states, label });
      redo.length = 0;
      states = states.map((s, i) => (i === body ? (step.choice === "hide" ? "hidden" : step.choice === "delete" ? "deleted" : "suppressed") : s));
      // Hide clears the selection (as the browser's eye does); a delete takes the item's faces out (selection.ts
      // survivors: the user took it away); a suppressed body's stay, left alone for Unsuppress to bring back.
      if (step.choice === "hide") selected = [];
      else if (step.choice === "delete") selected = selected.filter((f) => f !== items[body]);
    } else if (step.do === "pick") {
      const body = on[step.slot];
      await a.pick({ face: body === undefined ? null : 6 * step.slot + step.face, shift: step.shift });
      selected = selectedOn(a); // which faces is the click's business (picking.journey); the menu's is that they stay
    } else {
      const label = step.do === "undo" ? await a.undo() : await a.redo();
      const from = step.do === "undo" ? undo : redo;
      const to = step.do === "undo" ? redo : undo;
      const back = from.pop();
      if (back === undefined) {
        if (label !== null) failure = `${what}: ${step.do} did ${label}, the model has nothing`;
        continue;
      }
      if (label !== back.label) failure = `${what}: ${step.do} did ${label}, the model ${back.label}`;
      reached.add(step.do);
      to.push({ states, label: back.label });
      states = back.states;
      // A face on a body the step takes off the screen leaves the selection.
      selected = selectedOn(a);
    }
    failure ??= check(what);
  }
  if (failure) return (await a.close(), failure);
  if (!(await a.close())) return `seed ${seed}: bodies left in the kernel's store`;
  return null;
}

const SEEDS = Number(process.env.FISSION_SESSIONS ?? 8);
const STEPS = Number(process.env.FISSION_SESSION_STEPS ?? 40);

test(`seeded: ${SEEDS} sessions × ${STEPS} steps of the view's menu (Hide, Suppress, Delete, Escape), clicks, Undo and Redo match the model after every step, reaching every case`, async () => {
  const reached = new Set<string>();
  // FISSION_SEED replays one session (as the failure message names it) and skips the reach check.
  const only = process.env.FISSION_SEED ? Number(process.env.FISSION_SEED) : null;
  for (let seed = only ?? 1; seed <= (only ?? SEEDS); seed++) assert.equal(await runSession(seed, randomSteps(seed, STEPS), designWorkspace, reached), null);
  if (only !== null) return;
  const every = ["menu on empty space", "menu selects", "menu on one of several picked", "menu closed by Escape", "menu hide", "menu suppress", "menu delete", "undo", "redo"];
  assert.deepEqual(every.filter((c) => !reached.has(c)), [], `reached: ${[...reached].join(", ")}`);
});

// ---- Bugs planted in workspace.ts, each caught ----

const WORKSPACE = new URL("../../../workspaces/design/src/workspace.ts", import.meta.url);

/** The planted bugs: each a text edit of workspace.ts. */
const PLANTS: { name: string; find: string; replace: string }[] = [
  // Hide hides the first body, whichever was right-clicked.
  { name: "hide-first-body", find: "e.action === \"hide\" ? () => toggleHidden(target.row)", replace: "e.action === \"hide\" ? () => toggleHidden(\"body-1\")" },
  // The right-click selects nothing.
  { name: "selects-nothing", find: "if (!ctx.selection.items.some((r) => r.kind === target.item.kind && r.id === target.item.id)) ctx.selection.set([target.item]);", replace: "" },
  // The right-click always selects what it is on alone, dropping a Shift-picked set.
  { name: "drops-picked-set", find: "if (!ctx.selection.items.some((r) => r.kind === target.item.kind && r.id === target.item.id)) ctx.selection.set([target.item]);", replace: "ctx.selection.set([target.item]);" },
  // The menu opens while a sketch is open.
  { name: "opens-in-sketch", find: "if (!doc || mode.kind !== \"none\" || extruding", replace: "if (!doc || extruding" },
  // An edge under the pointer is ignored.
  { name: "edges-ignored", find: "viewMenuTarget(doc, lastScene, pick, failedNow)", replace: "viewMenuTarget(doc, lastScene, { ...pick, edge: null }, failedNow)" },
  // The menu says it opened nothing (the browser's own menu would open over it).
  { name: "says-not-opened", find: "    deleting.menu(itemName(item), at, entries);\n    return true;", replace: "    deleting.menu(itemName(item), at, entries);\n    return false;" },
  // The menu's entries act on the sketch being edited, or none, rather than the body's item.
  { name: "acts-on-first-item", find: "() => void chooseEntry(menuHost, target.feature, e.action, editing)", replace: "() => void chooseEntry(menuHost, doc.timeline.features[0].id, e.action, editing)" },
];

/** Design with `plant` made: a copy of workspace.ts beside it (so its imports resolve), loaded, then deleted. */
async function planted(plant: { name: string; find: string; replace: string }): Promise<WorkspacePlugin> {
  const text = readFileSync(WORKSPACE, "utf8");
  const at = text.indexOf(plant.find);
  assert.ok(at >= 0 && text.indexOf(plant.find, at + 1) < 0, `${plant.name}: the text to replace must be in workspace.ts exactly once`);
  const file = new URL(`workspace.planted-view-menu-${plant.name}.ts`, WORKSPACE);
  writeFileSync(file, text.slice(0, at) + plant.replace + text.slice(at + plant.find.length));
  try {
    return (await import(file.href)).designWorkspace;
  } finally {
    rmSync(file);
  }
}

test("each bug planted in workspace.ts is caught by the hand-worked case or the seeded sessions", async () => {
  // The copy unplanted passes, so a catch is the plant's and not the copying's.
  const clean = await planted({ name: "none", find: "let fits = 0;", replace: "let fits = 0;" });
  assert.equal(await handWorked(clean), null);
  for (let seed = 1; seed <= 2; seed++) assert.equal(await runSession(seed, randomSteps(seed, STEPS), clean), null);
  for (const plant of PLANTS) {
    const design = await planted(plant);
    let caught = await handWorked(design);
    for (let seed = 1; seed <= SEEDS && caught === null; seed++) caught = await runSession(seed, randomSteps(seed, STEPS), design);
    assert.ok(caught !== null, `${plant.name} was not caught`);
    if (process.env.FISSION_PLANTED_REPORT) console.log(`${plant.name}: ${caught}`);
  }
});
