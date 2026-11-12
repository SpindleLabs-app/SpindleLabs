// What the kept-shape journeys of the timeline hunt (2026-11-11) share: the
// Design app's own gestures (a sketch point dragged, a side deleted, a region
// picked in Edit feature) and what a person then sees, on `design-app.ts`.
// Not a journey itself.
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { designWorkspace, partDocument, settleKept, type DesignDocument } from "@fission/design";
import { app, kernel } from "./design-app.ts";

export type App = Awaited<ReturnType<typeof app>>;

/** An empty design, as a new project opens with, at today's data version (a new part's: Undo reads its steps as files are read). */
export const empty = () => ({ version: partDocument("box", 1, 1, 1).version, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } }) as unknown as DesignDocument;

/** What the app shows: the volume drawn (to a millionth of a mm³), the items red on the bar, the kept-shape warning and the part's error line. */
export function seen(a: App) {
  const items = [...a.window.document.querySelectorAll(".timeline-bar-item")] as unknown as HTMLElement[];
  return {
    volume: Math.round(a.volume() * 1e6) / 1e6,
    failed: items.filter((i) => i.dataset.failed === "true").map((i) => i.dataset.item),
    warning: a.warning(),
    error: a.error(),
  };
}

const project = emptyProject("Kept");
/** The design as the project file holds it (the text Undo and Redo put back, and a save writes). */
export const fileOf = (doc: DesignDocument): string => projectToJson({ ...project, workspaces: { design: doc } });

/** Whether the design is settled: saved and opened, settling it against itself (`settleKept`, the rule every recorded edit must leave met) changes nothing. */
export async function isSettled(doc: DesignDocument): Promise<boolean> {
  const file = projectFromJson(fileOf(doc), [designWorkspace]).workspaces.design as DesignDocument;
  const settled = await settleKept(kernel, file, file);
  return JSON.stringify(settled) === JSON.stringify(file);
}

/** Edit Sketch on `sketch` with the Select tool. */
export async function editSketch(a: App, sketch: string) {
  assert.equal(await a.menu(sketch, "edit-sketch"), null);
  assert.ok(a.sketching());
  await a.key("clear-selection");
}

/** The Select tool's click on a curve at (x, y), then Delete. */
export async function deleteAt(a: App, x: number, y: number) {
  await a.key("clear-selection");
  await a.click(x, y);
  await a.key("delete-selection");
}

/** Lines drawn through `points` with the Line tool, then back to Select. */
export async function drawLines(a: App, points: readonly [number, number][]) {
  await a.key("sketch-line");
  for (const [x, y] of points) await a.click(x, y);
  await a.key("clear-selection");
}

/** The edited sketch's point at `from` pressed, dragged to `to` and let go (the Select tool's drag, one undo step). */
export async function dragPoint(a: App, from: [number, number], to: [number, number]) {
  await a.key("clear-selection");
  const grab = a.drawings().flatMap((d) => d.editing?.grab ?? []);
  const k = grab.findIndex((p) => p[0] === from[0] && p[1] === from[1]);
  assert.ok(k >= 0, `a point to drag at ${from}: ${JSON.stringify(grab)}`);
  a.pointer("grab", from, { grab: k } as never);
  await a.settle();
  a.pointer("drag", to);
  await a.settle();
  a.pointer("drop", to);
  await a.settle();
}

/**
 * Edit feature on `extrude`: the shaded region whose centroid is `centroid`
 * clicked (the sketch's only region when `centroid` is left out), then OK.
 */
export async function pickRegion(a: App, extrude: string, centroid?: [number, number]) {
  assert.equal(await a.menu(extrude, "edit"), null);
  const offers = (a.extrudeShown()?.profiles ?? []) as unknown as { id: string; ref: { centroid: [number, number] } }[];
  const offer = centroid === undefined ? (offers.length === 1 ? offers[0] : undefined) : offers.find((o) => Math.hypot(o.ref.centroid[0] - centroid[0], o.ref.centroid[1] - centroid[1]) < 1e-6);
  assert.ok(offer, `a region at ${centroid ?? "the only one"} among ${JSON.stringify(offers.map((o) => o.ref.centroid))}`);
  await a.extrudePointer({ kind: "pick", profile: offer.id });
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  assert.ok(a.$("#feature-edit")!.hidden, `Edit feature closed: ${a.$("#feature-edit-error")?.textContent}`);
}
