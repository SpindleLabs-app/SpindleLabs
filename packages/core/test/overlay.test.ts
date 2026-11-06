import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayPlaces, SEVERITY_COLOURS, triangleColours, worstSeverity, type AnalysisOverlay } from "../src/model/overlay.ts";

const { warning, error, info } = SEVERITY_COLOURS;

test("marks colour the triangles of their face, the most severe winning", () => {
  // Four triangles: two on face 0, one on face 1, one on face 2.
  const tris = [0, 0, 1, 2];
  const overlays: AnalysisOverlay[] = [
    { id: "a", label: "thin walls", marks: [{ target: { face: 0 }, severity: "warning" }, { target: { face: 1 }, severity: "info" }] },
    { id: "b", label: "clearance", marks: [{ target: { face: 1 }, severity: "error" }] },
  ];
  assert.deepEqual(triangleColours(tris, overlays), [warning, warning, error, null]);
});

test("a whole-body mark colours every triangle, but a worse face mark still shows", () => {
  const overlays: AnalysisOverlay[] = [
    { id: "a", label: "too big", marks: [{ target: { body: true }, severity: "warning" }] },
    { id: "b", label: "x", marks: [{ target: { face: 1 }, severity: "error" }, { target: { face: 0 }, severity: "info" }] },
  ];
  assert.deepEqual(triangleColours([0, 1, 2], overlays), [warning, error, warning]);
  assert.deepEqual(triangleColours([0], []), [null]);
  assert.notDeepEqual(info, warning);
});

test("triangle marks (the print check, H1) colour only their triangles, part of a face; the most severe wins", () => {
  // Five triangles, all of face 0 (a curved face): triangles 1 and 2 need supports (error), 2 and 3 are thin
  // (warning): 2 is red, 3 amber, 1 red, 0 and 4 untouched. A face mark under them shows where they are not worse.
  const overlays: AnalysisOverlay[] = [
    { id: "supports", label: "Needs supports", marks: [{ target: { triangles: [1, 2] }, severity: "error" }] },
    { id: "thin", label: "Too thin", marks: [{ target: { triangles: [2, 3] }, severity: "warning" }] },
  ];
  assert.deepEqual(triangleColours([0, 0, 0, 0, 0], overlays), [null, error, error, warning, null]);
  const withFace: AnalysisOverlay[] = [...overlays, { id: "f", label: "f", marks: [{ target: { face: 0 }, severity: "info" }] }];
  assert.deepEqual(triangleColours([0, 0, 0, 0, 0], withFace), [info, error, error, warning, info]);
  // Triangles the mesh has not got (after an edit the overlay has not caught up with) are passed over.
  const stale: AnalysisOverlay[] = [{ id: "s", label: "s", marks: [{ target: { triangles: [-1, 1.5, 7, NaN, 0] }, severity: "error" }] }];
  assert.deepEqual(triangleColours([0, 0], stale), [error, null]);
});

test("an overlay's places (36d): a corner as a dot, an edge as a line, a gap of nothing as a dot, the most severe drawn last", () => {
  const error = SEVERITY_COLOURS.error;
  const info = SEVERITY_COLOURS.info;
  const overlays: AnalysisOverlay[] = [
    { id: "a", label: "A", marks: [], places: [{ severity: "error", from: [10, 0, 10], to: [10, 10, 10] }, { severity: "error", point: [0, 0, 0] }] },
    { id: "b", label: "B", marks: [], places: [{ severity: "info", from: [1, 2, 3], to: [1, 2, 3] }] },
    { id: "c", label: "C", marks: [] },
  ];
  // Sorted by severity, the info one first (drawn under), then the errors in the order given.
  assert.deepEqual(overlayPlaces(overlays), {
    points: [
      { at: [1, 2, 3], colour: info },
      { at: [0, 0, 0], colour: error },
    ],
    lines: [{ from: [10, 0, 10], to: [10, 10, 10], colour: error }],
  });
  assert.deepEqual(overlayPlaces([]), { points: [], lines: [] });
});

test("an overlay's worst severity, for its legend line: places count as marks do; none is a warning", () => {
  const face = (severity: "info" | "warning" | "error") => ({ target: { face: 0 }, severity }) as const;
  assert.equal(worstSeverity({ id: "a", label: "A", marks: [face("info"), face("warning")] }), "warning");
  assert.equal(worstSeverity({ id: "a", label: "A", marks: [face("info")], places: [{ severity: "error", point: [0, 0, 0] }] }), "error");
  assert.equal(worstSeverity({ id: "a", label: "A", marks: [face("error"), face("info")] }), "error");
  assert.equal(worstSeverity({ id: "a", label: "A", marks: [face("info")] }), "info");
  assert.equal(worstSeverity({ id: "a", label: "A", marks: [] }), "warning");
});
