// Hunter D scratch helpers (not a journey).
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson, type BodyView, type DisplayMesh } from "@fission/core";
import { BodyCache, designWorkspace, rebuildTimeline, type DesignDocument } from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";
import { app } from "./design-app.ts";

export const kernel = nodeKernel();
export type App = Awaited<ReturnType<typeof app>>;

export function faceWhere(mesh: DisplayMesh, on: (p: number[]) => boolean): number {
  const all = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => {
    const ok = [0, 1, 2].every((k) => {
      const i = mesh.indices[3 * t + k];
      return on([mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]]);
    });
    all.set(f, (all.get(f) ?? true) && ok);
  });
  const found = [...all].filter(([, ok]) => ok).map(([f]) => f);
  assert.equal(found.length, 1, `one face, got ${found}`);
  return found[0];
}

export const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
export const v3 = (p: readonly number[]) => p.map(r6);

/** The finished sketches drawn: origin, xAxis, normal, lost. */
export const drawn = (a: App) => a.drawings().filter((d) => !d.editing).map((d) => ({ origin: v3(d.plane.origin), x: v3(d.plane.xAxis), n: v3(d.plane.normal), lost: d.lost === true }));

export const reopen = (doc: DesignDocument) => projectFromJson(projectToJson({ ...emptyProject("Hunt"), workspaces: { design: doc } }), [designWorkspace]).workspaces.design as DesignDocument;

/** Face centroid (mean of triangle corner points, area-weighted) by kernel face index. */
export function faceCentres(view: BodyView): number[][] {
  const { positions: p, indices, triangle_faces } = view.mesh;
  const sum = new Map<number, number[]>();
  for (let t = 0; t < triangle_faces.length; t++) {
    const pts = [0, 1, 2].map((k) => [0, 1, 2].map((c) => p[3 * indices[3 * t + k] + c]));
    const e1 = pts[1].map((x, i) => x - pts[0][i]);
    const e2 = pts[2].map((x, i) => x - pts[0][i]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const area = Math.hypot(...cr) / 2;
    const s = sum.get(triangle_faces[t]) ?? [0, 0, 0, 0];
    for (let c = 0; c < 3; c++) s[c] += (area * (pts[0][c] + pts[1][c] + pts[2][c])) / 3;
    s[3] += area;
    sum.set(triangle_faces[t], s);
  }
  return [...Array(view.faces).keys()].map((f) => {
    const s = sum.get(f) ?? [NaN, NaN, NaN, 1];
    return [r6(s[0] / s[3]), r6(s[1] / s[3]), r6(s[2] / s[3])];
  });
}

/** A fresh rebuild of `doc` (as a file just opened): per body volume, bounds; per sketch placement; per item status and warnings. */
export async function freshBuild(doc0: DesignDocument, names = false) {
  const doc = reopen(doc0);
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(doc, cache, kernel);
  const bodies: Record<string, { volume: number; bounds: number[][]; faces?: string[] }> = {};
  for (const [id, b] of Object.entries(build.bodies)) {
    const view = await cache.view(b.handle);
    const centres = faceCentres(view);
    bodies[id] = {
      volume: r6(view.volume),
      bounds: view.bounds.map(v3),
      ...(names ? { faces: centres.map((c, i) => `${i} @${c.join(",")} ${b.named ? JSON.stringify(b.named.faces[i]?.names) : "(spec)"}`) } : {}),
    };
  }
  const items: Record<string, unknown> = {};
  for (const id of build.order) {
    const r = build.results[id];
    if (r.status === "built") {
      const { holds: _h, pieceFaces: _p, placement, pinned: _pi, projected: _pr, solved: _s, ...rest } = r;
      items[id] = { ...rest, ...(placement ? { placement: { o: v3(placement.plane.origin), x: v3(placement.plane.xAxis), n: v3(placement.plane.normal), side: placement.side } } : {}) };
    } else items[id] = r;
  }
  await cache.close();
  return { bodies, items };
}

export const typeIn = (a: App, sel: string, value: string | number, event = "input") => {
  const box = a.$(sel) as HTMLInputElement;
  assert.ok(box, `no ${sel}`);
  box.value = String(value);
  box.dispatchEvent(new a.window.Event(event, { bubbles: true }) as unknown as Event);
};

/** Create sketch on the face `on` picks (clicked at `point` if given), circle radius r round (cx, cy) in sketch mm, finished. Returns the sketch id. */
export async function circleOnFace(a: App, on: (p: number[]) => boolean, cx: number, cy: number, r = 2, point?: [number, number, number]) {
  const before = new Set(a.doc().sketches.map((s) => s.id));
  a.$("#create-sketch")!.click();
  await a.settle();
  await a.pick({ face: faceWhere(a.mesh()!, on), ...(point ? { point } : {}) });
  assert.ok(a.sketching(), `a sketch opened on the face: ${a.error()} ${a.$("#status")?.textContent ?? ""}`);
  await a.key("sketch-circle");
  await a.click(cx, cy);
  await a.click(cx + r, cy);
  await a.finish();
  const id = a.doc().sketches.find((s) => !before.has(s.id))!.id;
  return id;
}

/** Extrude sketch (by clicking its offered profile) `distance` mm with operation, OK. Returns extrude id. */
export async function extrudeSketchInApp(a: App, sketch: string, distance: number, operation?: "join" | "cut" | "intersect" | "new") {
  const before = new Set(a.doc().timeline.features.map((f) => f.id));
  a.$("#extrude")!.click();
  await a.settle();
  const offered = a.extrudeShown()!.profiles;
  const p = offered.find((o) => (o as { sketch?: string }).sketch === sketch || o.id === sketch || o.id.startsWith(sketch));
  assert.ok(p, `sketch ${sketch} offered among ${offered.map((o) => o.id).join(" ")}`);
  await a.extrudePointer({ kind: "pick", profile: p.id });
  if (operation) {
    const sel = a.$("#extrude-operation") as HTMLSelectElement;
    assert.ok(sel, "an operation choice");
    sel.value = operation;
    sel.dispatchEvent(new a.window.Event("change", { bubbles: true }) as unknown as Event);
    await a.settle();
  }
  typeIn(a, "#extrude-distance", distance);
  await a.settle();
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const f = a.doc().timeline.features.find((x) => !before.has(x.id));
  assert.ok(f, `an extrude was made: ${a.$("#extrude-error")?.textContent} ${a.$("#extrude-status")?.textContent}`);
  return f.id;
}

/** Bodies shown by the live app compared with a fresh build's: total volume. */
export async function liveVsFresh(a: App, what: string) {
  const fresh = await freshBuild(a.doc());
  const total = Object.values(fresh.bodies).reduce((s, b) => s + b.volume, 0);
  return { live: r6(a.volume()), fresh: r6(total), what, items: fresh.items, bodies: fresh.bodies };
}
