// SL #764 item 6 (E-3, app-wide hunt 2026-11-14): Export pressed while an OK was still being checked by the kernel saved
// nothing (right: the tool was still open), but said why in the tool's own error line, which closed with the panel when
// the OK landed: no file and no words. An export now waits for the OK, as Insert and the ways into a tool do
// (ok-then-tool.journey.ts), then saves the design with the OK in it. An OK that is refused leaves its panel open, so
// the export is refused in that panel's words, which stay on screen. On the real kernel, in the app around Design.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRegistry } from "@fission/core";
import { DOWNLOAD_STL, insertMove, insertPreset, NO_MOVE, partDocument, registerDesignActions, setCombineShown, type DesignDocument } from "@fission/design";
import { registerMeshActions } from "../../../workspaces/design/src/mesh-export.ts";
import { app } from "./design-app.ts";

setCombineShown(true);
type App = Awaited<ReturnType<typeof app>>;
const saved: { name: string; bytes: Uint8Array }[] = [];

/** Box 1 (10 × 4 × 2) and Box 2 (2 × 6 × 4) moved 4 along x and 1 back along y and z: they cross over x 4..6. */
function start(): DesignDocument {
  const b = insertPreset(partDocument("box", 10, 4, 2), "box", 2, 6, 4);
  return insertMove(b.doc, [`body:${b.id}`], { ...NO_MOVE, x: 4, y: -1, z: -1 }).doc;
}

async function opened(): Promise<App> {
  // The workspace's own events (properties-reveal) are made with the page's Event, which in a browser is the global one.
  const actions = new ActionRegistry();
  registerDesignActions(actions, (bytes, name) => void saved.push({ name, bytes: bytes.slice() }), async () => {});
  registerMeshActions(actions, (bytes, name) => void saved.push({ name, bytes: bytes.slice() }));
  const a = await app(start(), undefined, { actions });
  (globalThis as { Event: unknown }).Event = a.window.Event;
  return a;
}

const body = (id: string) => ({ kind: "body" as const, id });
async function cutReady(a: App) {
  a.$("#modify-menu")!.click();
  await a.settle();
  a.$("#modify-menu-combine")!.click();
  await a.settle();
  a.selection.set([body("body:feature-1")]);
  await a.settle();
  a.selection.set([body("body:feature-1"), body("body:feature-2")]);
  await a.settle();
  const select = a.$("#combine-operation") as HTMLSelectElement;
  select.value = "cut";
  select.dispatchEvent(new a.window.Event("change") as never);
  const keep = a.$("#combine-keep") as HTMLInputElement;
  if (keep.checked) (keep.checked = false), keep.dispatchEvent(new a.window.Event("change") as never);
}

/** The signed volume of a binary STL's triangles (each facing out): Σ a · (b × c) / 6. */
function stlVolume(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(80, true);
  let six = 0;
  for (let t = 0; t < n; t++) {
    const at = 84 + 50 * t + 12;
    const p = (k: number, c: number) => v.getFloat32(at + 12 * k + 4 * c, true);
    const [a, b, c] = [0, 1, 2].map((k) => [p(k, 0), p(k, 1), p(k, 2)]);
    six += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return six / 6;
}

test("hand-worked: Combine's OK then File > Export STL at once saves the design with the Cut in it (waited since SL #819 B-2)", async () => {
  saved.length = 0;
  const a = await opened();
  await cutReady(a);
  (a.$("#combine-ok") as HTMLButtonElement).click();
  await a.command({ op: "export_stl" });
  await a.settle();
  assert.equal(a.doc().timeline.features.filter((f) => f.intent.type === "combine").length, 1, "the Combine is recorded");
  assert.equal(saved.length, 1, `a file is saved (note: ${a.$("#action-note")?.textContent})`);
  // Box 1, 10 · 4 · 2 = 80 mm³, less the cut x 4..6 through its whole depth and height, 2 · 4 · 2 = 16: 64 mm³.
  assert.ok(Math.abs(stlVolume(saved[0].bytes) - 64) < 1e-3, `volume ${stlVolume(saved[0].bytes)}`);
  await a.close();
});

test("Combine's OK then Export 3MF at once: the file is saved once the OK lands", async () => {
  saved.length = 0;
  const a = await opened();
  await cutReady(a);
  (a.$("#combine-ok") as HTMLButtonElement).click();
  a.$("#export-choice-3mf")!.click();
  await a.settle();
  assert.equal(saved.length, 1, `a file is saved (note: ${a.$("#action-note")?.textContent})`);
  assert.match(saved[0].name, /\.3mf$/);
  await a.close();
});

test("Combine's OK then the Selection's Download STL at once: run on the selection as the OK leaves it, and said in words", async () => {
  saved.length = 0;
  const a = await opened();
  await cutReady(a);
  (a.$("#combine-ok") as HTMLButtonElement).click();
  const download = a.$(`[data-action="${DOWNLOAD_STL}"]`) as HTMLButtonElement | null;
  assert.ok(download, "the Selection offers Download STL for the picked bodies");
  download.click();
  await a.settle();
  assert.equal(a.doc().timeline.features.filter((f) => f.intent.type === "combine").length, 1, "the Combine is recorded");
  // The OK clears the selection (pressed a moment later, the button would be gone): nothing to save, and it says so where
  // it stays on screen, never in the closed Combine panel.
  assert.equal(a.selection.items.length, 0);
  assert.equal(saved.length, 0);
  assert.match(a.$("#action-note")?.textContent ?? "", /takes at least one body/);
  await a.close();
});

test("control: Export with the Combine still open and no OK pressed is refused in the panel's own words, which stay", async () => {
  saved.length = 0;
  const a = await opened();
  await cutReady(a);
  await a.command({ op: "export_stl" });
  await a.settle();
  assert.equal(saved.length, 0, "nothing is saved while the tool is open");
  assert.match(a.$("#combine-error")?.textContent ?? a.$("#combine-panel")?.textContent ?? "", /Combine is still open/);
  await a.close();
});
