// The slicing engine's side, free of Design: the bodies' files as the engine reads them, and the slices under way.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KernelCalls } from "@fission/core";
import { bodiesOfFiles, PRINT_DEFAULTS, refusalWords, SliceDropped, sliceStls, stopSlices } from "../src/index.ts";

/** A binary STL of one triangle with the three given z values (x, y fixed): 80-byte header, count 1, then 50 bytes. */
function triangle(z0: number, z1: number, z2: number): Uint8Array {
  const bytes = new Uint8Array(84 + 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  const corners = [[0, 0, z0], [10, 0, z1], [0, 10, z2]];
  corners.forEach((c, i) => c.forEach((v, k) => view.setFloat32(84 + 12 + i * 12 + k * 4, v, true)));
  return bytes;
}

test("two bodies together are as tall as the lowest corner to the highest: 0 to 7 is 7 mm", () => {
  // Body A spans z 0 to 2, body B z 5 to 7: together from 0 up to 7, so 7 mm (worked by hand, not by the code).
  const made = bodiesOfFiles([triangle(0, 1, 2), triangle(5, 6, 7)]);
  assert.equal(made.height, 7);
  assert.equal(made.stl.length, 2 * (84 + 50), "the files back to back, each whole: 134 bytes (84 + one 50-byte triangle) twice");
});

test("no body is refused in words", () => {
  assert.throws(() => bodiesOfFiles([]), /no body to slice/);
});

test("a slice asks the engine with the stacked file and the choices; Stop before it asks drops it", async () => {
  const calls: unknown[][] = [];
  const kernel = { call: (...a: unknown[]) => (calls.push(a), Promise.resolve({ layers: 1 })), stopSlicing: () => undefined } as unknown as KernelCalls;
  const done = await sliceStls(kernel, () => Promise.resolve([triangle(0, 1, 2)]), PRINT_DEFAULTS);
  assert.equal(calls[0][0], "slice_stl");
  assert.equal(calls[0][2], PRINT_DEFAULTS.layerHeight);
  assert.equal((done as { layers: number }).layers, 1);
  let release: () => void = () => undefined;
  const waiting = sliceStls(kernel, () => new Promise((r) => (release = () => r([triangle(0, 1, 2)]))), PRINT_DEFAULTS);
  stopSlices();
  release();
  await assert.rejects(waiting, SliceDropped);
  assert.equal(calls.length, 1, "the stopped slice never reached the engine");
});

test("a part too thin for the first layer is said with its height rounded and a full stop, never the float32 mesh's digits (bug sweep 2026-11-28, A2-4)", () => {
  // The engine's words for a box typed 0.05 mm high: its float32 mesh is 0.05000000074505806 mm high (0.05 has no exact
  // float32), and half the 0.2 mm first layer is 0.1 mm. By hand the person typed 0.05, so "0.05 mm high"; to be cut by
  // the first layer it must be at least half of it, 0.1 mm.
  const engine = "the part is 0.05000000074505806 mm high, lower than half the first layer (0.1 mm), so no layer cuts it";
  assert.equal(refusalWords(engine), "The part is 0.05 mm high, lower than half the first layer (0.1 mm), so no layer cuts it. Make it at least 0.1 mm tall.");
  // Three significant figures keep a very thin part's size (0.004 mm is not rounded to 0): 0.00412345 -> 0.00412.
  assert.equal(refusalWords("the part is 0.00412345 mm high, lower than half the first layer (0.06000000000000001 mm), so no layer cuts it"), "The part is 0.00412 mm high, lower than half the first layer (0.06 mm), so no layer cuts it. Make it at least 0.06 mm tall.");
});
