// Tagging a hole or peg with its fit (FK2, fit-tag.ts, sketch.ts
// setCircleFit, the Circle tool's fit, document.ts version 14): the tag
// never changes the circle's size, it is saved and read back exactly, a
// file holding a broken one is refused with the reason, and the sketch
// shows it beside the circle's diameter. Browser check:
// apps/fission/e2e/fit-tag.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIT_CHOICES, type Fit } from "@fission/print";
import { projectFromJson, projectToJson, emptyProject } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { toggleConstruction } from "../src/construction.ts";
import { addConstraint } from "../src/constraints.ts";
import { dimensionLabels, FIT_LABEL } from "../src/constraint-tool.ts";
import { partDocument, readDesignDocument, type DesignDocument, type Sketch, type SketchCircleCurve } from "../src/document.ts";
import { fitPicker, NO_FIT_LABEL } from "../src/fit-tag.ts";
import { addSketch, drawCircle, drawLine, setCircleFit, SKETCH_STEPS } from "../src/sketch.ts";
import { clickAt, startTool, type CircleTool } from "../src/sketch-tool.ts";
import { typedBoxes } from "../src/typed-boxes.ts";
import { designWorkspace } from "../src/index.ts";

const M3: Fit = { role: "hole", kind: "bolt-normal" };
const PIN_SLIDE: Fit = { role: "hole", kind: "slide", partner: "bought" };
const sketchOf = (doc: DesignDocument, id: string): Sketch => doc.sketches.find((s) => s.id === id)!;
const circleOf = (doc: DesignDocument, sketch: string, id: string) => sketchOf(doc, sketch).curves.find((c) => c.id === id) as SketchCircleCurve;

/** A box with a sketch holding a 3 mm circle and a line. */
function withCircle() {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const c = drawCircle(s.doc, s.id, [10, 10], 1.5);
  const l = drawLine(c.doc, s.id, [20, 0], [30, 0]);
  return { doc: l.doc, sketch: s.id, circle: c.id, line: sketchOf(l.doc, s.id).curves.find((q) => q.kind === "line")!.id };
}

const ok = (r: ReturnType<typeof setCircleFit>) => {
  assert.ok(!("refused" in r), "refused" in r ? r.refused : "");
  return r as { doc: DesignDocument; step: string | null };
};

test("tagging a circle keeps its size; untagging takes the tag off; the same tag again is no step", () => {
  const t = withCircle();
  const tagged = ok(setCircleFit(t.doc, t.sketch, t.circle, M3));
  assert.equal(tagged.step, SKETCH_STEPS.fit);
  const c = circleOf(tagged.doc, t.sketch, t.circle);
  assert.deepEqual(c.fit, M3);
  // The radius is the design's size: 1.5 mm (⌀ 3) before and after, to the last bit.
  assert.equal(c.radius, 1.5);
  assert.equal(circleOf(t.doc, t.sketch, t.circle).fit, undefined, "the document it was given is unchanged");
  // Everything but the tag is as it was.
  const { fit: _f, ...rest } = c;
  assert.deepEqual(rest, circleOf(t.doc, t.sketch, t.circle));
  const again = ok(setCircleFit(tagged.doc, t.sketch, t.circle, { ...M3 }));
  assert.equal(again.step, null);
  assert.equal(again.doc, tagged.doc);
  const changed = ok(setCircleFit(tagged.doc, t.sketch, t.circle, PIN_SLIDE));
  assert.deepEqual(circleOf(changed.doc, t.sketch, t.circle).fit, PIN_SLIDE);
  const off = ok(setCircleFit(changed.doc, t.sketch, t.circle, null));
  assert.equal(off.step, SKETCH_STEPS.unfit);
  assert.equal(Object.hasOwn(circleOf(off.doc, t.sketch, t.circle), "fit"), false, "no fit key left behind");
  assert.deepEqual(off.doc.sketches, t.doc.sketches);
  assert.equal(ok(setCircleFit(t.doc, t.sketch, t.circle, null)).step, null, "nothing to take off");
});

test("only a circle that makes something holds a fit: lines, construction and projected circles are refused, saying why", () => {
  const t = withCircle();
  assert.deepEqual(setCircleFit(t.doc, t.sketch, t.line, M3), { refused: "Only a circle can be tagged with a fit." });
  assert.deepEqual(setCircleFit(t.doc, t.sketch, "circle-404", M3), { refused: "Only a circle can be tagged with a fit." });
  const built = toggleConstruction(t.doc, t.sketch, [t.circle]);
  assert.ok("doc" in built);
  assert.deepEqual(setCircleFit(built.doc, t.sketch, t.circle, M3), { refused: "A construction circle makes no hole or peg, so it can't hold a fit." });
  // A circle a projection made follows its body's edge.
  const projected: DesignDocument = { ...t.doc, sketches: t.doc.sketches.map((s) => (s.id === t.sketch ? { ...s, projected: [{ id: "projection-99", feature: "feature-1", edge: "edge:x", made: t.circle }] } : s)) };
  assert.match((setCircleFit(projected, t.sketch, t.circle, M3) as { refused: string }).refused, /^A projected circle follows its body's edge/);
  // A fit that isn't one is a fault in the caller, never stored.
  assert.throws(() => setCircleFit(t.doc, t.sketch, t.circle, { role: "hole", kind: "snug" } as unknown as Fit), /is not a fit this SpindleLabs knows/);
  assert.throws(() => drawCircle(t.doc, t.sketch, [0, 0], 2, { role: "peg", kind: "bolt-normal" } as unknown as Fit), /is not a fit/);
});

test("making a tagged circle construction drops its fit", () => {
  const t = withCircle();
  const tagged = ok(setCircleFit(t.doc, t.sketch, t.circle, M3)).doc;
  const built = toggleConstruction(tagged, t.sketch, [t.circle]);
  assert.ok("doc" in built);
  const c = circleOf(built.doc, t.sketch, t.circle);
  assert.equal(c.construction, true);
  assert.equal(Object.hasOwn(c, "fit"), false);
  // So the file it saves still opens.
  readDesignDocument(JSON.parse(JSON.stringify(built.doc)));
});

test("the Circle tool tags each circle it draws with the fit picked, until another is picked", () => {
  const t = withCircle();
  let tool: CircleTool = { ...(startTool("circle", t.sketch) as CircleTool), fit: M3 };
  let doc = t.doc;
  for (const [cx, cy] of [[0, 0], [5, 0]] as const) {
    const a = clickAt(doc, tool, [cx, cy]);
    const b = clickAt(a.doc, a.tool, [cx + 1.5, cy]);
    assert.equal(b.drew, true);
    ({ doc, tool } = b);
    assert.deepEqual(tool.fit, M3, "the fit stays picked");
  }
  const circles = sketchOf(doc, t.sketch).curves.filter((c): c is SketchCircleCurve => c.kind === "circle");
  assert.equal(circles.length, 3);
  assert.deepEqual(circles.map((c) => c.fit ?? null), [null, M3, M3]);
  assert.deepEqual(circles.map((c) => c.radius), [1.5, 1.5, 1.5]);
  // Without a fit the tool draws plain circles, as before.
  const plain = clickAt(clickAt(doc, startTool("circle", t.sketch) as CircleTool, [20, 20]).doc, { kind: "circle", sketch: t.sketch, centre: [20, 20] } as CircleTool, [22, 20]);
  assert.equal(Object.hasOwn(sketchOf(plain.doc, t.sketch).curves.at(-1)!, "fit"), false);
});

test("saved and read back exactly, version 16; every broken fit in a file is refused with the reason", () => {
  const t = withCircle();
  const tagged = ok(setCircleFit(t.doc, t.sketch, t.circle, PIN_SLIDE)).doc;
  const json = JSON.parse(JSON.stringify(tagged));
  assert.equal(json.version, 16);
  assert.deepEqual(readDesignDocument(json), readDesignDocument(tagged));
  // Through the project file too.
  const project = projectFromJson(projectToJson({ ...emptyProject(), workspaces: { design: tagged } }), [designWorkspace]);
  assert.deepEqual(circleOf(project.workspaces.design as DesignDocument, t.sketch, t.circle).fit, PIN_SLIDE);
  const withCurve = (change: (c: Record<string, unknown>) => void, id = t.circle) => {
    const d = JSON.parse(JSON.stringify(tagged));
    const s = d.sketches.find((q: Sketch) => q.id === t.sketch);
    change(s.curves.find((c: { id: string }) => c.id === id));
    return d;
  };
  const at = `Design sketch ${t.sketch}`;
  assert.throws(() => readDesignDocument(withCurve((c) => (c.fit = { role: "hole", kind: "snug", partner: "bought" }))), { message: `${at}: circle ${t.circle}'s fit {"role":"hole","kind":"snug","partner":"bought"} is not one this SpindleLabs knows` });
  assert.throws(() => readDesignDocument(withCurve((c) => (c.fit = { ...PIN_SLIDE, size: 6 }))), /is not one this SpindleLabs knows/);
  assert.throws(() => readDesignDocument(withCurve((c) => (c.fit = "bolt-normal"))), { message: `${at}: circle ${t.circle}'s fit "bolt-normal" is not one this SpindleLabs knows` });
  assert.throws(() => readDesignDocument(withCurve((c) => (c.fit = null))), /fit null is not one/);
  assert.throws(() => readDesignDocument(withCurve((c) => (c.construction = true))), { message: `${at}: construction circle ${t.circle} has a fit, but a construction circle makes no hole or peg` });
  assert.throws(() => readDesignDocument(withCurve((c) => (c.fit = M3), t.line)), { message: `${at}: curve ${t.line} has a fit, which only a circle holds` });
  // Version 13 never held a fit.
  assert.throws(() => readDesignDocument({ ...json, version: 13 }), { message: "Design data says version 13 but has a circle tagged with its fit, which version 14 brought" });
  // Untagged version 13 data opens as version 16, unchanged.
  const plain = JSON.parse(JSON.stringify(t.doc));
  assert.deepEqual(readDesignDocument({ ...plain, version: 13 }), readDesignDocument(plain));
  // A kept shape's circle may keep its fit (a lost sketch's last shape), and is checked the same way.
  const kept = { ...json, kept: { "feature-x": { points: sketchOf(tagged, t.sketch).points, curves: sketchOf(tagged, t.sketch).curves } } };
  assert.throws(() => readDesignDocument({ ...kept, version: 13 }), /version 14 brought/);
  // Only the kept shape's circle tagged, the sketch's own not: still refused (mutation survivor 11-08: kept shapes were never looked at alone).
  const keptOnly = JSON.parse(JSON.stringify(kept));
  for (const c of keptOnly.sketches.find((q: Sketch) => q.id === t.sketch).curves) delete c.fit;
  assert.throws(() => readDesignDocument({ ...keptOnly, version: 13 }), { message: "Design data says version 13 but has a circle tagged with its fit, which version 14 brought" });
});

test("seeded: random tags on random circles save and read back exactly, and the circles' sizes never move", () => {
  const seed = Number(process.env.FISSION_SEED ?? 20261108);
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (let n = 0; n < 60; n++) {
    const s = addSketch(partDocument("box", 40, 30, 20));
    let doc = s.doc;
    const ids: string[] = [];
    const radii: number[] = [];
    for (let k = 0; k < 1 + Math.floor(r() * 6); k++) {
      const radius = Math.round((0.5 + r() * 20) * 1000) / 1000;
      const c = drawCircle(doc, s.id, [k * 50, 0], radius);
      doc = c.doc;
      ids.push(c.id);
      radii.push(radius);
    }
    // A few rounds of tagging, retagging and untagging at random.
    const want = new Map<string, Fit | null>();
    for (let k = 0; k < 10; k++) {
      const id = ids[Math.floor(r() * ids.length)]!;
      const pick = r() < 0.25 ? null : FIT_CHOICES[Math.floor(r() * FIT_CHOICES.length)]!.fit;
      doc = ok(setCircleFit(doc, s.id, id, pick)).doc;
      want.set(id, pick);
    }
    const back = readDesignDocument(JSON.parse(JSON.stringify(doc)));
    assert.deepEqual(back, readDesignDocument(doc), `seed ${seed} round ${n}`);
    ids.forEach((id, k) => {
      const c = circleOf(back, s.id, id);
      assert.equal(c.radius, radii[k], `seed ${seed} round ${n}: ${id}'s radius`);
      assert.deepEqual(c.fit ?? null, want.get(id) ?? null, `seed ${seed} round ${n}: ${id}'s fit`);
    });
  }
});

test("hand-worked: the sketch shows a tag after the diameter, on a dimension's label or on the circle's own", async () => {
  const kernel = nodeKernel();
  const t = withCircle();
  const tagged = ok(setCircleFit(t.doc, t.sketch, t.circle, M3)).doc;
  // No diameter dimension: a label of its own, by the fit's id, where the dimension's would sit.
  let labels = dimensionLabels(sketchOf(tagged, t.sketch), 1);
  assert.deepEqual(labels.map((l) => [l.id, l.text]), [[`${FIT_LABEL}${t.circle}`, "⌀ 3 · M3 bolt"]]);
  // Where: ⌀ 3 round (10, 10): the dimension's line ends at r·(√½, √½) from the centre, the label half a mark past it,
  // (10 + 1.5·0.7071 + 0.5, 10 + 1.5·0.7071 + 0.5) = (11.5607, 11.5607).
  assert.ok(Math.abs(labels[0]!.at[0] - 11.5607) < 1e-4 && Math.abs(labels[0]!.at[1] - 11.5607) < 1e-4, String(labels[0]!.at));
  // An untagged circle shows nothing.
  assert.deepEqual(dimensionLabels(sketchOf(t.doc, t.sketch), 1), []);
  // With a diameter dimension, its label carries the tag and there is no second label.
  const dimensioned = await addConstraint(kernel, tagged, t.sketch, { kind: "diameter", circle: t.circle, value: 3 });
  assert.ok("doc" in dimensioned, JSON.stringify(dimensioned));
  labels = dimensionLabels(sketchOf(dimensioned.doc, t.sketch), 1);
  assert.equal(labels.length, 1);
  assert.equal(labels[0]!.text, "⌀ 3 · M3 bolt");
  assert.notEqual(labels[0]!.id.startsWith(FIT_LABEL), true);
});

const { Window } = await import("happy-dom");

test("the list: + Fit and every fit, grouped; a pick is heard; set shows one without being heard", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const heard: (Fit | null)[] = [];
  const p = fitPicker(doc, (f) => heard.push(f));
  const options = [...p.element.querySelectorAll("option")];
  assert.equal(options.length, 16);
  assert.equal(options[0]!.textContent, NO_FIT_LABEL);
  assert.deepEqual([...p.element.querySelectorAll("optgroup")].map((g) => g.label), ["Bolt or screw (the diameter is its M size)", "Hole for a pin or peg (the diameter is the pin's)", "Peg (the diameter is the hole's)"]);
  p.element.value = "hole-slide-bought";
  p.element.dispatchEvent(new window.Event("change") as unknown as Event);
  p.element.value = "";
  p.element.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.deepEqual(heard, [PIN_SLIDE, null]);
  p.set(M3);
  assert.equal(p.element.value, "bolt-normal");
  assert.equal(p.element.classList.contains("fit-tag-on"), true);
  p.set(null);
  assert.equal(p.element.value, "");
  assert.equal(p.element.classList.contains("fit-tag-on"), false);
  assert.equal(heard.length, 2, "set is never heard");
  // A key in it never reaches the sketch tools behind it.
  const keys: string[] = [];
  doc.addEventListener("keydown", (e) => keys.push((e as KeyboardEvent).key));
  doc.body.append(p.element);
  p.element.dispatchEvent(new window.KeyboardEvent("keydown", { key: "l", bubbles: true }) as unknown as Event);
  assert.deepEqual(keys, []);
});

test("the boxes put the list right under Diameter while it shows, and nowhere else", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const host = doc.createElement("div");
  doc.body.append(host);
  const b = typedBoxes(host, { locks: () => {}, enter: () => {}, escape: () => {} });
  const p = fitPicker(doc, () => {});
  b.under("diameter", p.element);
  assert.equal(p.element.isConnected, false, "nothing shows yet");
  b.show(["diameter"], { diameter: 3 }, 10, 10);
  assert.equal(doc.querySelector("label[data-field=diameter]")!.nextElementSibling, p.element);
  b.show(["length", "angle"], {}, 10, 10);
  assert.equal(p.element.isConnected, false, "a line's boxes have no fit");
  b.show(["diameter"], {}, 10, 10);
  assert.equal(p.element.isConnected, true);
  b.hide();
  assert.equal(p.element.isConnected, false);
  b.show(["diameter"], {}, 10, 10);
  b.under("diameter", null);
  assert.equal(p.element.isConnected, false, "taken away");
});

test("Tab reaches the list under Diameter and goes on round; Shift+Tab goes back (the browser check found it out of reach)", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const host = doc.createElement("div");
  doc.body.append(host);
  const b = typedBoxes(host, { locks: () => {}, enter: () => {}, escape: () => {} });
  const p = fitPicker(doc, () => {});
  b.under("diameter", p.element);
  const tab = (shiftKey = false) => doc.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }) as unknown as Event);
  const at = () => doc.activeElement?.id;
  // A circle's one box: Diameter, then the list, then round to Diameter.
  b.show(["diameter"], {}, 10, 10);
  doc.getElementById("typed-diameter")!.focus();
  tab();
  assert.equal(at(), "typed-fit");
  tab();
  assert.equal(at(), "typed-diameter");
  tab(true);
  assert.equal(at(), "typed-fit", "Shift+Tab from Diameter goes back round to the list");
  tab(true);
  assert.equal(at(), "typed-diameter");
  // A line's boxes have no list: Tab goes Length, Angle, Length as before.
  b.show(["length", "angle"], {}, 10, 10);
  doc.getElementById("typed-length")!.focus();
  tab();
  assert.equal(at(), "typed-angle");
  tab();
  assert.equal(at(), "typed-length");
});

test("put away, the list hears nothing and the boxes let go of it (a list Chrome kept held the old Design's panels, closed-views.mjs)", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const host = doc.createElement("div");
  doc.body.append(host);
  const b = typedBoxes(host, { locks: () => {}, enter: () => {}, escape: () => {} });
  const heard: (Fit | null)[] = [];
  const p = fitPicker(doc, (f) => heard.push(f));
  b.under("diameter", p.element);
  b.show(["diameter"], {}, 10, 10);
  const pick = (id: string) => ((p.element.value = id), p.element.dispatchEvent(new window.Event("change") as unknown as Event));
  pick("bolt-normal");
  assert.equal(heard.length, 1, "heard while in use");
  // Taken away: Tab on it no longer moves the keys (its listener is gone), and disposed it hears no change.
  b.under("diameter", null);
  doc.body.append(p.element);
  p.element.focus();
  p.element.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }) as unknown as Event);
  assert.equal(doc.activeElement?.id, "typed-fit", "the boxes no longer move the keys from it");
  p.dispose();
  assert.equal(p.element.isConnected, false, "out of the page");
  pick("hole-slide-bought");
  assert.equal(heard.length, 1, "nothing heard once put away");
});
