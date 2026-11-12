// Shared helpers for the several-profile Extrude hunt tests (hunt 2026-11-12 C, SL #611; not a test file).
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { type DesignDocument } from "../src/document.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { regionRef, sketchRegions, type RegionRef } from "../src/regions.ts";

export const kernel = nodeKernel();

export async function regionsOf(doc: DesignDocument, id: string): Promise<{ ref: RegionRef; c: readonly [number, number]; area: number }[]> {
  const found = await sketchRegions(kernel, doc.sketches.find((s) => s.id === id)!);
  return found.regions.map((r) => ({ ref: regionRef(r, found.ids), c: r.centroid, area: (r as unknown as { area: number }).area }));
}

export async function volumesOf(doc: DesignDocument, item: string): Promise<{ status: string; vols: number[]; r: unknown }> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const r = build.results[item];
    if (r.status !== "built") return { status: r.status, vols: [], r };
    const vols = await Promise.all(r.bodies.map(async (b) => (await cache.view(build.bodies[b].handle)).volume));
    return { status: r.status, vols, r };
  } finally {
    // Freed, so a test of the app that asks whether every body went sees only its own.
    await cache.close();
  }
}
