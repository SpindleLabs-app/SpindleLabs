// Journey: selecting and deleting single sketch curves (missing basics, Ben
// 2026-11-04) in the real Design workspace on the real WASM kernel, mounted
// as the app mounts it (design-app.ts). Escape with nothing half drawn
// chooses the Select tool (Fusion's way); a click within a snap's reach of a
// line, circle or arc picks it, Shift adds or takes one out; Delete,
// Backspace or the toolbar's Delete takes the picks out as one undo step.
// The owner's rule holds: an extrude whose outline the delete breaks keeps
// its last shape, with no question, and the warning waits for Finish Sketch.
// Hand-worked volumes first, then seeded sessions against a plain model,
// then bugs planted in workspace.ts, each caught. Run with `npm run journeys`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import type { WorkspacePlugin } from "@fission/core";
import { addSketch, designWorkspace, drawCircle, drawLine, drawRectangle, extrudeSketch, partDocument, type DesignDocument } from "@fission/design";
import { app, close } from "./design-app.ts";

const BOX = 1000; // the part's box, 10 × 10 × 10

/** A box (feature-1), then Sketch 1 with a 40 × 30 rectangle from (0, 0), extruded by 20 (Extrude 1: 40 · 30 · 20 = 24000 mm³). */
function extruded() {
  const made = addSketch(partDocument("box", 10, 10, 10));
  const rect = drawRectangle(made.doc, made.id, [0, 0], [40, 30]);
  const ex = extrudeSketch(rect.doc, made.id, 20);
  // The rectangle's lines run (0,0)→(40,0)→(40,30)→(0,30)→(0,0): the last is the left side, x = 0.
  return { doc: ex.doc, sketch: made.id, extrude: ex.id, lines: rect.ids };
}

const curvesOf = (doc: DesignDocument, id: string) => doc.sketches.find((s) => s.id === id)!.curves.map((c) => c.id);
const pickedSegments = (a: Awaited<ReturnType<typeof app>>) => a.drawings().find((d) => d.editing)?.editing?.picked?.length ?? 0;
const deleteOff = (a: Awaited<ReturnType<typeof app>>) => (a.$("#sketch-delete") as HTMLButtonElement).disabled;

/** The hand-worked case, as a check returning what went wrong (null: nothing), so the planted bugs can be run through it too. */
async function handWorked(plugin: WorkspacePlugin): Promise<string | null> {
  const { doc, sketch, extrude, lines } = extruded();
  const a = await app(doc, plugin);
  const fail = async (why: string) => (await a.close(), why);
  if (!close(a.volume(), BOX + 24000)) return fail(`at the start the view holds ${a.volume()}, not ${BOX + 24000}`);
  await a.menu(sketch, "edit-sketch");
  if (!a.sketching()) return fail("Edit Sketch did not open the sketch");
  // The line tool with nothing drawn: Delete has nothing to take, so the key is left to the browser and nothing is recorded.
  await a.key("delete-selection");
  if (a.history.canUndo()) return fail(`Delete with nothing picked recorded "${a.history.undoLabel()}"`);
  // Escape with nothing half drawn: the Select tool, pressed on the toolbar; Delete is off.
  await a.key("clear-selection");
  if (a.$("#sketch-tool-select")!.getAttribute("aria-pressed") !== "true") return fail("Escape did not choose the Select tool");
  if (!deleteOff(a)) return fail("Delete is on with nothing picked");
  // A click 0.5 mm right of the left side (x = 0, y 0..30) picks it, within the 1 mm reach (10 pixels of 0.1 mm): one segment lit, Delete on.
  await a.click(0.5, 15);
  if (pickedSegments(a) !== 1) return fail(`the left side's click lit ${pickedSegments(a)} segments, not 1`);
  if (deleteOff(a)) return fail("Delete is off with a line picked");
  if (a.history.canUndo()) return fail("a pick recorded an undo step");
  // Delete: one step, "Delete line"; the left side and nothing else gone (its two corners stay, the top and bottom still use them).
  await a.key("delete-selection");
  if (a.history.undoLabel() !== "Delete line") return fail(`the delete was recorded as "${a.history.undoLabel()}"`);
  if (JSON.stringify(curvesOf(a.doc(), sketch)) !== JSON.stringify(lines.slice(0, 3))) return fail(`the sketch holds ${curvesOf(a.doc(), sketch).join(", ")}`);
  if (a.doc().sketches.find((s) => s.id === sketch)!.points.length !== 4) return fail("a corner another line uses went with the left side");
  if (pickedSegments(a) !== 0 || !deleteOff(a)) return fail("the picks stayed after the delete");
  // The owner's rule: no question, the rectangle kept for Extrude 1 in the same step, no warning while the sketch is open, nothing rebuilt.
  if (a.window.document.querySelector("dialog[open]") !== null) return fail("the delete asked a question");
  if (a.doc().kept?.[extrude] === undefined) return fail("Extrude 1's rectangle was not kept in the delete's step");
  if (a.warning() !== null) return fail(`a warning while the sketch is open: ${a.warning()}`);
  // Finish: Extrude 1 keeps its 40 × 30 × 20 with the warning; the view still holds 1000 + 24000.
  await a.finish();
  if (!/^Extrude 1 keeps its last shape\. Sketch 1 has no closed outline/.test(a.warning() ?? "")) return fail(`after Finish the warning is ${a.warning()}`);
  if (!close(a.volume(), BOX + 24000)) return fail(`after Finish the view holds ${a.volume()}`);
  // Undo: the left side back, closed again, no warning; Redo: gone again.
  if ((await a.undo()) !== "Delete line") return fail("Undo did not undo the delete");
  if (curvesOf(a.doc(), sketch).length !== 4 || a.warning() !== null) return fail(`undone: ${curvesOf(a.doc(), sketch).length} lines, warning ${a.warning()}`);
  if ((await a.redo()) !== "Delete line" || curvesOf(a.doc(), sketch).length !== 3) return fail("Redo did not take the left side out again");
  if (!(await a.close())) return "bodies left in the kernel's store";
  return null;
}

test("hand-worked: Escape chooses Select, a click 0.5 mm off the 40 × 30 rectangle's left side picks it, Delete takes it out as one step and Extrude 1 keeps 40 · 30 · 20 = 24000 mm³ with the warning after Finish", async () => {
  assert.equal(await handWorked(designWorkspace), null);
});

test("hand-worked: Shift+click picks a circle and a line, Backspace takes both out as \"Delete 2 curves\", with the circle's centre; Escape clears picks without leaving Select", async () => {
  // Sketch 1 (no extrude): line-4 from (0,0) to (20,0) (points 2, 3), circle-6 round (50,0) radius 5 (point-5), line-9 from (0,40) to (20,40).
  const s = addSketch({ ...partDocument("box", 10, 10, 10) });
  const one = drawLine(s.doc, s.id, [0, 0], [20, 0]);
  const circle = drawCircle(one.doc, s.id, [50, 0], 5);
  const two = drawLine(circle.doc, s.id, [0, 40], [20, 40]);
  const a = await app(two.doc);
  await a.menu(s.id, "edit-sketch");
  await a.key("clear-selection");
  // The circle's rim at (55.8, 0), 0.8 out; then Shift on the first line's middle: 64 + 1 segments lit.
  await a.click(55.8, 0);
  await a.click(10, -0.6, {}, true);
  assert.equal(pickedSegments(a), 65);
  // Shift on the circle again takes it out; Shift on it once more puts it back.
  await a.click(50, 4.5, {}, true);
  assert.equal(pickedSegments(a), 1);
  await a.click(50, -5, {}, true);
  assert.equal(pickedSegments(a), 65);
  // Shift on empty space keeps the picks; a plain click there (1.5 mm from everything) clears them.
  await a.click(30, 20, {}, true);
  assert.equal(pickedSegments(a), 65);
  await a.click(10, 1.5);
  assert.equal(pickedSegments(a), 0);
  // Picked again; Escape clears the picks and stays in Select; a second Escape does nothing more.
  await a.click(10, 0);
  await a.key("clear-selection");
  assert.equal(pickedSegments(a), 0);
  assert.equal(a.$("#sketch-tool-select")!.getAttribute("aria-pressed"), "true");
  // Both picked; Backspace: one step, the circle and its centre gone, the far line kept.
  await a.click(10, 0);
  await a.click(45, 0, {}, true);
  await a.key("delete-selection-back");
  assert.equal(a.history.undoLabel(), "Delete 2 curves");
  assert.deepEqual(curvesOf(a.doc(), s.id), [two.id]);
  assert.deepEqual(a.doc().sketches[0].points.map((p) => [p.x, p.y]), [[0, 40], [20, 40]]);
  // The toolbar's Delete takes the last one out: the sketch is empty and stays in the timeline.
  await a.click(20.9, 40);
  (a.$("#sketch-delete") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.history.undoLabel(), "Delete line");
  assert.deepEqual(curvesOf(a.doc(), s.id), []);
  assert.ok(a.doc().timeline.features.some((f) => f.id === s.id));
  // A tool chosen leaves Select: L, then a click draws again (a line's first point), not a pick.
  await a.key("sketch-line");
  assert.equal(a.$("#sketch-tool-select")!.getAttribute("aria-pressed"), "false");
  await a.click(0, 0);
  await a.click(10, 0);
  assert.equal(a.history.undoLabel(), "Draw line");
  assert.ok(await a.close());
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

type Step =
  | { do: "pick"; i: number; shift: boolean; off: number }
  | { do: "empty"; shift: boolean }
  | { do: "escape" }
  | { do: "delete"; how: "delete-selection" | "delete-selection-back" | "button" }
  | { do: "undo" }
  | { do: "redo" }
  | { do: "line-then-escape" };

/**
 * The shapes: shape i is a line from (50i, 0) to (50i + 20, 0) when i is
 * even, else a circle round (50i + 10, 0) radius 5. A pick of shape i lands
 * `off` mm (|off| < 0.9, inside the 1 mm reach) off its middle or rim; every
 * other shape is over 10 mm away. Empty space is (50i + 10, 30): 30 mm from
 * the line, 25 from a circle's rim.
 */
const SHAPES = 6;
const segmentsOf = (i: number) => (i % 2 === 0 ? 1 : 64);
function pickAt(i: number, off: number): [number, number] {
  return i % 2 === 0 ? [50 * i + 10, off] : [50 * i + 10, 5 + off];
}

function randomSteps(seed: number, n: number): Step[] {
  const r = random(seed);
  const steps: Step[] = [];
  for (let k = 0; k < n; k++) {
    const x = r();
    if (x < 0.4) steps.push({ do: "pick", i: Math.floor(r() * SHAPES), shift: r() < 0.5, off: (r() * 2 - 1) * 0.85 });
    else if (x < 0.48) steps.push({ do: "empty", shift: r() < 0.5 });
    else if (x < 0.56) steps.push({ do: "escape" });
    else if (x < 0.74) steps.push({ do: "delete", how: (["delete-selection", "delete-selection-back", "button"] as const)[Math.floor(r() * 3)] });
    else if (x < 0.86) steps.push({ do: "undo" });
    else if (x < 0.94) steps.push({ do: "redo" });
    else steps.push({ do: "line-then-escape" });
  }
  return steps;
}

/** One session; null when the app matched the model after every step, else what differed and where. */
async function runSession(seed: number, steps: Step[], plugin: WorkspacePlugin, reached = new Set<string>()): Promise<string | null> {
  let doc: DesignDocument = partDocument("box", 10, 10, 10);
  const made = addSketch(doc);
  doc = made.doc;
  const ids: string[] = [];
  for (let i = 0; i < SHAPES; i++) {
    const d = i % 2 === 0 ? drawLine(doc, made.id, [50 * i, 0], [50 * i + 20, 0]) : drawCircle(doc, made.id, [50 * i + 10, 0], 5);
    doc = d.doc;
    ids.push(d.id);
  }
  const a = await app(doc, plugin);
  await a.menu(made.id, "edit-sketch");
  await a.key("clear-selection"); // the Select tool
  // The model: which shapes are left, which are picked (in order), and the undo and redo stacks of what was left and the step's name.
  let left = ids.map((_, i) => i);
  let picked: number[] = [];
  const undo: { left: number[]; label: string }[] = [];
  const redo: { left: number[]; label: string }[] = [];
  const done: string[] = [];
  const check = (what: string): string | null => {
    const curves = curvesOf(a.doc(), made.id);
    const want = left.map((i) => ids[i]);
    if (JSON.stringify(curves) !== JSON.stringify(want)) return `${what}: the sketch holds ${curves.join(",")}, the model ${want.join(",")}`;
    const lit = picked.reduce((n, i) => n + segmentsOf(i), 0);
    if (pickedSegments(a) !== lit) return `${what}: ${pickedSegments(a)} segments lit, the model ${lit}`;
    if (deleteOff(a) !== (picked.length === 0)) return `${what}: Delete is ${deleteOff(a) ? "off" : "on"} with ${picked.length} picked`;
    if (a.$("#sketch-tool-select")!.getAttribute("aria-pressed") !== "true") return `${what}: the Select tool is not in use`;
    if ((a.history.undoLabel() ?? null) !== (undo.at(-1)?.label ?? null)) return `${what}: Undo would undo "${a.history.undoLabel()}", the model "${undo.at(-1)?.label}"`;
    return null;
  };
  let failure = check(`seed ${seed} at the start`);
  for (const [k, step] of steps.entries()) {
    if (failure) break;
    const what = `seed ${seed} step ${k} ${JSON.stringify(step)} after ${done.slice(-6).join("; ")}`;
    done.push(JSON.stringify(step));
    if (step.do === "pick") {
      const [x, y] = pickAt(step.i, step.off);
      await a.click(x, y, {}, step.shift);
      // A deleted shape's place is empty space now.
      const hit = left.includes(step.i) ? step.i : null;
      reached.add(hit === null ? "pick on a deleted shape's place" : step.shift ? (picked.includes(hit) ? "shift takes one out" : "shift adds") : "plain pick");
      if (hit === null) picked = step.shift ? picked : [];
      else if (!step.shift) picked = [hit];
      else picked = picked.includes(hit) ? picked.filter((p) => p !== hit) : [...picked, hit];
    } else if (step.do === "empty") {
      await a.click(50 * Math.floor(SHAPES / 2) + 10, 30, {}, step.shift);
      reached.add(step.shift ? "shift on empty space" : "plain on empty space");
      if (!step.shift) picked = [];
    } else if (step.do === "escape") {
      await a.key("clear-selection");
      reached.add(picked.length > 0 ? "escape clears picks" : "escape with nothing picked");
      picked = [];
    } else if (step.do === "delete") {
      if (step.how === "button") {
        (a.$("#sketch-delete") as HTMLButtonElement).click(); // a disabled button's click does nothing, as in a browser
        await a.settle();
      } else await a.key(step.how);
      if (picked.length === 0) {
        reached.add("delete with nothing picked");
        continue;
      }
      reached.add(`delete ${picked.length === 1 ? "one" : "several"} by ${step.how}`);
      const label = picked.length > 1 ? `Delete ${picked.length} curves` : picked[0] % 2 === 0 ? "Delete line" : "Delete circle";
      undo.push({ left, label });
      redo.length = 0;
      left = left.filter((i) => !picked.includes(i));
      picked = [];
    } else if (step.do === "undo" || step.do === "redo") {
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
      to.push({ left, label: back.label });
      left = back.left;
      // Undo and Redo mount Design afresh: the sketch stays open with its tool, and nothing is picked.
      picked = [];
    } else {
      // L chooses the line tool; Escape with nothing half drawn goes back to Select, the picks gone with the switch.
      await a.key("sketch-line");
      await a.key("clear-selection");
      reached.add("line tool and back");
      picked = [];
    }
    failure ??= check(what);
  }
  if (failure) return (await a.close(), failure);
  if (!(await a.close())) return `seed ${seed}: bodies left in the kernel's store`;
  return null;
}

const SEEDS = Number(process.env.FISSION_SESSIONS ?? 12);
const STEPS = Number(process.env.FISSION_SESSION_STEPS ?? 60);

test(`seeded: ${SEEDS} sessions × ${STEPS} steps of picking, Shift, Escape, Delete (key, Backspace, button), Undo and Redo match the model after every step, reaching every case`, async () => {
  const reached = new Set<string>();
  // FISSION_SEED replays one session (as the failure message names it) and skips the reach check.
  const only = process.env.FISSION_SEED ? Number(process.env.FISSION_SEED) : null;
  for (let seed = only ?? 1; seed <= (only ?? SEEDS); seed++) assert.equal(await runSession(seed, randomSteps(seed, STEPS), designWorkspace, reached), null);
  if (only !== null) return;
  const every = ["plain pick", "shift adds", "shift takes one out", "pick on a deleted shape's place", "plain on empty space", "shift on empty space", "escape clears picks", "escape with nothing picked", "delete with nothing picked", "delete one by delete-selection", "delete one by delete-selection-back", "delete one by button", "delete several by delete-selection", "delete several by delete-selection-back", "delete several by button", "undo", "redo", "line tool and back"];
  assert.deepEqual(every.filter((c) => !reached.has(c)), [], `reached: ${[...reached].join(", ")}`);
});

// ---- Bugs planted in workspace.ts, each caught ----

const WORKSPACE = new URL("../../../workspaces/design/src/workspace.ts", import.meta.url);

/** The planted bugs: each a text edit of workspace.ts. */
const PLANTS: { name: string; find: string; replace: string }[] = [
  // Shift is ignored: every click picks only what it is on.
  { name: "shift-ignored", find: "hit, pointer.shift === true)", replace: "hit, false)" },
  // The reach is one pixel, not a snap's ten: a click 0.5 mm off a curve misses it.
  { name: "reach-one-pixel", find: "curveAt(sketch, at, SNAP_PIXELS * (pointer.pixel ?? 0))", replace: "curveAt(sketch, at, pointer.pixel ?? 0)" },
  // Escape leaves the picks as they are.
  { name: "escape-keeps-picks", find: "        mode.tool = { ...mode.tool, picked: [] };\n", replace: "" },
  // The delete is not settled: an extrude whose outline it breaks loses its shape.
  { name: "delete-not-settled", find: "next = await settleKept(kernel, before, deleteCurves(before, sketchId, ids), bodies);", replace: "next = deleteCurves(before, sketchId, ids);" },
  // Every delete is named as a line's.
  { name: "step-always-line", find: "applySketchEdit(next, deleteStep(sketch, ids), sketchId);", replace: "applySketchEdit(next, \"Delete line\", sketchId);" },
  // Only the first pick is deleted.
  { name: "deletes-first-only", find: "deleteCurves(before, sketchId, ids)", replace: "deleteCurves(before, sketchId, ids.slice(0, 1))" },
  // Escape with nothing half drawn no longer chooses Select.
  { name: "escape-no-select", find: "      if (id === \"clear-selection\" && mode.kind === \"edit\" && mode.tool.kind !== \"select\") return chooseTool(\"select\"), true;\n", replace: "" },
];

/** Design with `plant` made: a copy of workspace.ts beside it (so its imports resolve), loaded, then deleted. */
async function planted(plant: { name: string; find: string; replace: string }): Promise<WorkspacePlugin> {
  const text = readFileSync(WORKSPACE, "utf8");
  const at = text.indexOf(plant.find);
  assert.ok(at >= 0 && text.indexOf(plant.find, at + 1) < 0, `${plant.name}: the text to replace must be in workspace.ts exactly once`);
  const file = new URL(`workspace.planted-select-${plant.name}.ts`, WORKSPACE);
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
  for (let seed = 1; seed <= 3; seed++) assert.equal(await runSession(seed, randomSteps(seed, STEPS), clean), null);
  for (const plant of PLANTS) {
    const design = await planted(plant);
    let caught = await handWorked(design);
    for (let seed = 1; seed <= SEEDS && caught === null; seed++) caught = await runSession(seed, randomSteps(seed, STEPS), design);
    assert.ok(caught !== null, `${plant.name} was not caught`);
    if (process.env.FISSION_PLANTED_REPORT) console.log(`${plant.name}: ${caught}`);
  }
});
