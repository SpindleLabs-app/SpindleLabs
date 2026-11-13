// The Slice page (Slice as its own page, step 1; behind the app's SLICE_PAGE switch, off until released): the design's
// bodies laid on the plate in the shared view, listed on the left, read through the representation registry (Design's
// lister and mesh producer), never from Design's own code. The properties hold the print choices and a Slice button (print-panel.ts, step 4b1); the download and the preview
// arrive in the next steps, and until then Design's File ▾ Slice for printing is the way to a file. Styles: src/styles/slice-page.css.

import { printPanel, type PrintPanel } from "./print-panel.ts";
import type { DisplayMesh, ListedObject, MountedWorkspace, RepresentationRegistry, WorkspaceContext, WorkspacePlugin } from "@fission/core";

/** One body as the page shows it: its name and its triangles (mm). */
export interface PlateBody {
  label: string;
  positions: number[];
  indices: number[];
}

/** Every body in one flat-shaded mesh, for the shared view (one draw): triangles are not shared, so each keeps its own face normal. Pure. */
export function plateMesh(bodies: readonly PlateBody[]): DisplayMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const b of bodies) {
    for (let t = 0; t + 2 < b.indices.length; t += 3) {
      const p = [0, 1, 2].map((k) => b.indices[t + k] * 3).map((i) => [b.positions[i], b.positions[i + 1], b.positions[i + 2]]);
      if (p.some((v) => v.some((x) => !Number.isFinite(x)))) continue; // never a NaN into the view
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
      const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      const unit = len > 0 ? n.map((x) => x / len) : [0, 0, 1];
      for (const q of p) {
        indices.push(positions.length / 3);
        positions.push(...q);
        normals.push(...unit);
      }
    }
  }
  const triangles = indices.length / 3;
  return { positions, normals, indices, triangle_faces: new Array<number>(triangles).fill(0), edge_lines: [], edge_line_edges: [] };
}

/** The words under the list: how many bodies are on the plate, or why none. */
export function plateWords(count: number, failed: number): string {
  const unread = failed > 0 ? ` ${failed} ${failed === 1 ? "body" : "bodies"} could not be read.` : "";
  if (count === 0) return `Nothing to print yet: the design has no body shown.${unread}`;
  return `${count} ${count === 1 ? "body" : "bodies"} on the plate.${unread}`;
}

/** Reads every body the design shows as a triangle mesh, through the registry; a body that can't be read is counted, not thrown. */
export async function readPlate(registry: RepresentationRegistry, objects: readonly ListedObject[]): Promise<{ bodies: PlateBody[]; failed: number }> {
  const bodies: PlateBody[] = [];
  let failed = 0;
  for (const o of objects) {
    try {
      const { representation } = await registry.deliver(o, ["mesh"]);
      if (representation.kind !== "mesh") throw new Error("not a mesh");
      bodies.push({ label: o.label, positions: representation.positions, indices: representation.indices });
    } catch {
      failed++;
    }
  }
  return { bodies, failed };
}

/** The page's mounting. */
export function mountSlicePage(ctx: WorkspaceContext): MountedWorkspace {
  const doc = ctx.toolbar.ownerDocument;
  let live = true;
  let awake = true;
  /** Counts reads: a later one replaces an earlier one still running. */
  let reading = 0;
  const list = doc.createElement("section");
  list.className = "slice-page";
  list.setAttribute("aria-label", "The plate");
  const heading = doc.createElement("h2");
  heading.textContent = "The plate";
  const items = doc.createElement("ul");
  items.className = "slice-page-bodies";
  const words = doc.createElement("p");
  words.className = "slice-page-words";
  words.setAttribute("role", "status");
  list.append(heading, items, words);
  ctx.browser.append(list);

  const objectsNow = () => ctx.representations.objectsOf("design", ctx.project);
  let storage: Storage | null = null;
  try {
    storage = doc.defaultView?.localStorage ?? null;
  } catch {
    storage = null; // storage off: the choices start from their defaults
  }
  const panel: PrintPanel = printPanel(doc, { kernel: ctx.kernel, registry: ctx.representations, objects: objectsNow, storage });
  ctx.properties.append(panel.element);

  const show = async () => {
    const mine = ++reading;
    const { bodies, failed } = await readPlate(ctx.representations, ctx.representations.objectsOf("design", ctx.project));
    if (!live || mine !== reading) return;
    items.replaceChildren(
      ...bodies.map((b) => {
        const li = doc.createElement("li");
        li.textContent = b.label;
        return li;
      }),
    );
    words.textContent = plateWords(bodies.length, failed);
    if (awake) {
      ctx.viewport.showBody(plateMesh(bodies));
      ctx.viewport.fit();
    }
  };
  const ready = show();
  return {
    ready,
    sleep() {
      awake = false;
    },
    wake() {
      awake = true;
      void show(); // the design may have changed while another workspace was on screen
    },
    unmount() {
      live = false;
      list.remove();
      panel.destroy();
    },
  };
}

export const slicePageWorkspace: WorkspacePlugin = {
  id: "slice",
  title: "SliceLab",
  summary: "A 3D printing slicer for any printer, fed directly by the design.",
  status: "working",
  representations: { produces: [], accepts: ["mesh", "data"] },
  commands: [],
  mount: mountSlicePage,
};
