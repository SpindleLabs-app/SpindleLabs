import { test } from "node:test";
import assert from "node:assert/strict";
import type { SolidReport } from "@fission/core";
import { badgeFor, CHECKED_HEADER, problemWords, SOLID_OVERLAY, solidBadge, solidOverlay, stampChecked, volumeWords } from "../src/solid-badge.ts";

const solid = (volume: number, triangles = 12, shells = 1): SolidReport => ({ verdict: "solid", triangles, shells, volume, problems: [] });

test("hand-worked: a 40 × 30 × 20 box's badge says solid, its 12 triangles and 24 cm³", () => {
  // 40 · 30 · 20 = 24,000 mm³ = 24 cm³ (1 cm³ = 1,000 mm³); a box is 6 faces of 2 triangles.
  const b = badgeFor(solid(24000));
  assert.equal(b.state, "solid");
  assert.equal(b.title, "Checked solid");
  assert.equal(b.detail, "Closed all round, nothing facing the wrong way, nothing crossing itself: a slicer will print what you designed.");
  assert.equal(b.facts, "12 triangles, 24 cm³.");
  assert.deepEqual(b.items, []);
  // Two pieces are named; a hollow's volume is what the file holds.
  assert.equal(badgeFor(solid(992, 24, 2)).facts, "24 triangles, 2 closed pieces, 992 mm³.");
});

test("volumes: under 1 cm³ in mm³, then cm³, three figures", () => {
  assert.equal(volumeWords(0.5), "0.5 mm³");
  assert.equal(volumeWords(999), "999 mm³");
  // 1,000 mm³ is exactly 1 cm³; a 10 mm sphere, 4/3 · π · 5³ = 523.6 mm³, stays in mm³ as 524.
  assert.equal(volumeWords(1000), "1 cm³");
  assert.equal(volumeWords((4 / 3) * Math.PI * 125), "524 mm³");
  assert.equal(volumeWords(1234567), "1,230 cm³");
});

test("problems in plain words, one and many, and the heading names the first two", () => {
  assert.equal(problemWords({ kind: "gap", count: 1, places: [] }), "a gap");
  assert.equal(problemWords({ kind: "gap", count: 1200, places: [] }), "1,200 gaps");
  assert.equal(problemWords({ kind: "inside-out", count: 2, places: [] }), "2 inside-out pieces");
  assert.equal(problemWords({ kind: "empty", count: 1, places: [] }), "nothing in it");
  const report: SolidReport = {
    verdict: "problems",
    triangles: 30,
    shells: 2,
    volume: 0,
    problems: [
      { kind: "gap", count: 3, places: [] },
      { kind: "flipped", count: 1, places: [] },
      { kind: "crossing", count: 5, places: [] },
    ],
  };
  const b = badgeFor(report);
  assert.equal(b.state, "problems");
  assert.equal(b.title, "Not solid: 3 gaps, a flipped face and 1 more");
  assert.deepEqual(b.items.map((i) => i.words), ["3 gaps", "a flipped face", "5 crossings"]);
  assert.match(b.items[0].means, /hole in the surface/);
  assert.match(b.detail, /was saved/);
});

test("an unfinished check never reads as solid", () => {
  const b = badgeFor({ verdict: "unfinished", triangles: 5_000_000, shells: 1, volume: 0, problems: [] });
  assert.equal(b.state, "unfinished");
  assert.equal(b.title, "Solid check not finished");
  assert.match(b.detail, /not known to be solid/);
});

test("the overlay marks every place in red, and there is none for a solid file", () => {
  assert.equal(solidOverlay(solid(1)), null);
  const report: SolidReport = { verdict: "problems", triangles: 2, shells: 1, volume: 0, problems: [{ kind: "pinched", count: 1, places: [{ point: [1, 1, 1] }] }] };
  const o = solidOverlay(report)!;
  assert.equal(o.id, SOLID_OVERLAY);
  assert.equal(o.label, "Not solid");
  assert.deepEqual(o.places, [{ severity: "error", point: [1, 1, 1] }]);
  assert.match(o.detail!, /^a pinched corner: two pieces touching/);
  // Problems with no place (an empty file) mark nothing.
  assert.equal(solidOverlay({ verdict: "problems", triangles: 0, shells: 0, volume: 0, problems: [{ kind: "empty", count: 1, places: [] }] }), null);
});

test("stamping writes only the 80-byte header, in ASCII, and never starts it with \"solid\"", () => {
  const file = new Uint8Array(84 + 50).map((_, i) => i % 251);
  const out = stampChecked(file, "2 bodies");
  const text = String.fromCharCode(...out.slice(0, 80));
  assert.equal(text, (CHECKED_HEADER + "2 bodies").padEnd(80, " "));
  assert.ok(!text.startsWith("solid"));
  assert.deepEqual([...out.slice(80)], [...file.slice(80)], "the count and triangles are untouched");
  assert.notEqual(out, file, "a copy: the kernel's bytes are left alone");
  // A long or non-ASCII name is cut to the header and turned printable.
  const long = String.fromCharCode(...stampChecked(file, "é".repeat(100)).slice(0, 80));
  assert.equal(long.length, 80);
  assert.equal(long, (CHECKED_HEADER + "?".repeat(48)).slice(0, 80));
  // A file too short to have a header is left as it is.
  assert.deepEqual([...stampChecked(new Uint8Array([1, 2, 3]), "x")], [1, 2, 3]);
});

test("hidden, the card keeps nothing of the last report, so it is the same nodes whatever was saved (issue #198)", async () => {
  const { Window } = await import("happy-dom");
  const doc = new Window().document as unknown as Document;
  const host = doc.createElement("div");
  doc.body.append(host);
  const card = solidBadge(host, () => {});
  // Every node under the card (elements and text), as the soak counts the page.
  const nodes = (n: Node): number => [...n.childNodes].reduce((s, c) => s + 1 + nodes(c), 0);
  const count = () => nodes(card.element);
  const fresh = count();
  // Three problems: three list rows, each a <strong> and its words.
  card.show({ verdict: "problems", triangles: 30, shells: 2, volume: 0, problems: [{ kind: "gap", count: 3, places: [] }, { kind: "flipped", count: 1, places: [] }, { kind: "crossing", count: 5, places: [] }] });
  assert.equal(card.element.querySelectorAll("li").length, 3);
  assert.ok(count() > fresh);
  card.hide();
  assert.equal(card.element.hidden, true);
  assert.equal(card.element.querySelectorAll("li").length, 0);
  assert.equal(count(), fresh, "a hidden card is as small as a new one");
  // Shown again it has the new report's words, nothing of the old.
  card.show(solid(24000));
  assert.equal(card.element.dataset.state, "solid");
  assert.equal(card.element.querySelectorAll("li").length, badgeFor(solid(24000)).items.length);
});
