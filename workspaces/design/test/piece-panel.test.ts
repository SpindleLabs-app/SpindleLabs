// #501 (Combine check, 2026-11-11): the Feature and Body sections describe
// the body selected, also when several bodies come from one item (a
// Combine's pieces): the second piece showed the first piece's numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panelFocus } from "../src/selection.ts";
import { bodyReference } from "../src/references.ts";
import type { Scene, ShownBody } from "../src/scene.ts";
import type { DesignDocument } from "../src/document.ts";
import type { Feature } from "@fission/core";

const item = (id: string): Feature => ({ id, intent: { kind: "x", parameters: {} }, provenance: { self: { workspace: "design", id, label: id }, from: [] }, dependsOn: [], suppressed: false }) as unknown as Feature;
// A bar 100 × 20 × 10 (feature-1) cut by slots at x 45..55 and x 80..90 in one Combine (feature-6):
// x 0..45 keeps the bar's id, 45 · 20 · 10 = 9,000; piece 1 is x 55..80, 25 · 20 · 10 = 5,000;
// piece 2 is x 90..100, 10 · 20 · 10 = 2,000.
const doc = { timeline: { features: [item("feature-1"), item("feature-6")] } } as unknown as DesignDocument;
const shown = (body: string, feature: string, place: number, volume: number) => ({ body, feature, place, view: { volume } }) as unknown as ShownBody;
const scene = { bodies: [shown("body:feature-1", "feature-6", 1, 9000), shown("body:feature-6/piece:1", "feature-6", 4, 5000), shown("body:feature-6/piece:2", "feature-6", 5, 2000)] } as unknown as Scene;
const focus = (id: string) => ((f) => f && [f.feature.id, f.body?.place ?? null, f.body?.view.volume ?? null])(panelFocus([bodyReference(id)], scene, doc));

test("each piece of one Combine is described by its own body", () => {
  assert.deepEqual(focus("body:feature-6/piece:1"), ["feature-6", 4, 5000]);
  assert.deepEqual(focus("body:feature-6/piece:2"), ["feature-6", 5, 2000]);
  // The target keeps its id: its own body, though a Combine made it last.
  assert.deepEqual(focus("body:feature-1"), ["feature-1", 1, 9000]);
});

test("a selected body the scene does not show is described as having none, never by another body of its item", () => {
  assert.deepEqual(focus("body:feature-6/piece:3"), ["feature-6", null, null]);
});
