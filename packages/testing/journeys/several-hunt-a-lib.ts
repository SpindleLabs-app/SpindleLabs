// Hunt A scratch helpers (not a journey).
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { designWorkspace, type DesignDocument } from "@fission/design";
import { BodyCache, rebuildTimeline } from "../../../workspaces/design/src/rebuild.ts";
import { app, kernel } from "./design-app.ts";
import { seen } from "./kept-app.ts";
export type App = Awaited<ReturnType<typeof app>>;
export type Offer = { id: string; sketch: string; refused?: string; face?: unknown; ref: { centroid: [number, number]; outer: unknown[] } };
export const offers = (a: App) => ((a.extrudeShown()?.profiles ?? []) as unknown as Offer[]);
export const offerAt = (a: App, c: [number, number], sketch?: string) => {
  const o = offers(a).find((o) => o.ref && (sketch === undefined || o.sketch === sketch) && Math.hypot(o.ref.centroid[0] - c[0], o.ref.centroid[1] - c[1]) < 1e-6);
  assert.ok(o, `an offer at ${c} among ${JSON.stringify(offers(a).map((o) => [o.sketch, o.ref?.centroid]))}`);
  return o;
};
export async function type(a: App, text: string, box = "#extrude-distance") {
  const el = a.$(box) as HTMLInputElement;
  el.value = text;
  el.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}
/** Extrude tool: picks at centroids (first plain, rest with Ctrl), distance typed, OK. Returns the panel's error text. */
export async function extrudeSeveral(a: App, picks: readonly ([number, number] | { c: [number, number]; sketch: string })[], distance: string, ok = true) {
  a.$("#extrude")!.click();
  await a.settle();
  let first = true;
  for (const p of picks) {
    const o = Array.isArray(p) ? offerAt(a, p as [number, number]) : offerAt(a, p.c, p.sketch);
    await a.extrudePointer({ kind: "pick", profile: o.id, ...(first ? {} : { add: true }) } as never);
    first = false;
  }
  await type(a, distance);
  const preview = a.$("#extrude-panel")?.dataset.previewVolume;
  if (ok) {
    (a.$("#extrude-ok") as HTMLButtonElement).click();
    await a.settle();
  }
  return { preview, error: a.$("#extrude-error")?.textContent ?? "", status: a.$("#extrude-status")?.textContent ?? "", open: a.extrudeShown() !== null };
}
export const rows = (a: App) => [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].map((r) => `${r.dataset.node}=${(r.textContent ?? "").trim().replace(/\s+/g, " ")}`);
export const bodyRows = (a: App) => rows(a).filter((r) => r.startsWith("body-"));
export const items = (a: App) => ([...a.window.document.querySelectorAll(".timeline-bar-item")] as unknown as HTMLElement[]).map((i) => `${i.dataset.item}${i.dataset.failed === "true" ? "!F" : ""}${i.dataset.warned === "true" ? "!W" : ""}${i.dataset.suppressed === "true" ? "!S" : ""}${i.dataset.greyed === "true" ? "!G" : ""}`);
const project = emptyProject("Hunt A");
export const fileOf = (doc: DesignDocument): string => projectToJson({ ...project, workspaces: { design: doc } });
export const reopen = (doc: DesignDocument) => projectFromJson(fileOf(doc), [designWorkspace]).workspaces.design as DesignDocument;
/** A fresh rebuild of the design as saved: each body's volume and bounds by id, each item's status. */
export async function fresh(doc: DesignDocument) {
  const d = reopen(doc);
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(d, cache, kernel);
    const bodies: Record<string, { vol: number; lo: number[]; hi: number[] }> = {};
    for (const [id, b] of Object.entries(build.bodies)) {
      const v = await cache.view(b.handle);
      bodies[id] = { vol: Math.round(v.volume * 1e6) / 1e6, lo: v.bounds[0].map((x) => Math.round(x * 1e6) / 1e6), hi: v.bounds[1].map((x) => Math.round(x * 1e6) / 1e6) };
    }
    const status: Record<string, string> = {};
    for (const [id, r] of Object.entries(build.results)) status[id] = r.status + (r.status === "failed" ? `(${r.message})` : r.status === "built" && (r as any).warning ? `(warn: ${(r as any).warning.message})` : "");
    return { bodies, status };
  } finally {
    await cache.close();
  }
}
/** What a person sees now, and what a fresh open of the saved file shows (a second app), for comparing. */
export async function both(a: App) {
  const live = { ...seen(a), bodies: bodyRows(a), items: items(a) };
  const doc = a.doc();
  const f = await fresh(doc);
  return { live, fresh: f };
}
export { seen };
