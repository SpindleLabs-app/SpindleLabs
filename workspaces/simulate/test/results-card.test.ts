// TestLab's results card (results.ts): the set-up that was tested and its verdict at a glance, readable in a screenshot
// and copied as text; the full detail stays behind "How it was worked out". Each expected value worked by hand beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { materialLibrary, type StableId, type StressTestResult } from "@fission/core";
import { BEND_OVERLAY, cardLines, limitWords, pushedWords, RESULT_OVERLAY, resultOf, resultOverlays, resultSection, summaryText, verdictWords, type RunSetUp } from "../src/results.ts";
import type { Load } from "../src/study.ts";

const { Window } = await import("happy-dom");

const face = (label: string) => ({ ref: { kind: "face" as const, id: label as StableId }, label });
const load = (l: Partial<Load>): Load => ({ id: "load-1", faces: [face("Top face")], amount: 9800, unit: "N", direction: "down", ...l });
const pla = { name: "PLA", mechanical: materialLibrary().get("pla")!.mechanical! };
const steel = { name: "Steel", mechanical: materialLibrary().get("steel-a36")!.mechanical! };

/** An answer with the given safety factor, biggest stress (MPa) and biggest bend (mm). */
function answer(safetyFactor: number | null, maxVonMises: number, maxDisplacement: number): StressTestResult {
  return {
    points: [0, 0, 0, 100, 0, 0, 100, 10, 0],
    triangles: [0, 1, 2],
    triangleFaces: [3],
    displacement: [0, 0, 0, maxDisplacement, 0, 0, maxDisplacement, 0, 0],
    vonMises: [maxVonMises, maxVonMises, 0],
    maxDisplacement,
    maxDisplacementAt: [100, 0, 0],
    maxVonMises,
    maxVonMisesAt: [0, 0, 0],
    safetyFactor,
    applied: [0, 0, -9800],
    reaction: [0, 0, 9800],
    size: 5,
    nodes: 3,
    elements: 1,
    worstQuality: 0.5,
    method: "direct",
    iterations: 1,
    relativeResidual: 1e-12,
  };
}

/** Ben's run (19 Nov): Body 1 in PLA, 9,800 N down on its top, held by a face on the same side: SF 0.182, 192 MPa, 8.03 mm. */
const bens: RunSetUp = { body: "Body 1", held: [face("Top face 2")], loads: [load({})] };

test("Ben's run: 'Would break', where it is pushed and held, the material, and where it would start to break, with no numbers past breaking", () => {
  const r = resultOf(answer(0.182, 192, 8.03), pla, bens);
  assert.equal(verdictWords(r), "Would break");
  // The answer is linear: every stress grows in step with the loads. The biggest stress reaches the strength when the
  // loads are SF times what they are: 0.182 × 9,800 N = 1,783.6 N, to three figures 1,780 N.
  assert.equal(limitWords(r), "It would start to break at about 1,780 N.");
  assert.deepEqual(cardLines(r), [
    { label: "Part", words: "Body 1" },
    { label: "Made of", words: "PLA, printed" },
    { label: "Pushed", words: "9,800 N down on Top face" },
    { label: "Held", words: "Top face 2" },
  ]);
  assert.equal(
    summaryText(r),
    ["TestLab result: Would break (safety factor 0.182)", "Part: Body 1", "Made of: PLA, printed", "Pushed: 9,800 N down on Top face", "Held: Top face 2", "It would start to break at about 1,780 N.", "An estimate, not a promise."].join("\n"),
  );
  // Past breaking the linear 192 MPa and 8.03 mm are not real: the card never shows them, the details say why.
  const doc = new Window().document as unknown as Document;
  const box = resultSection(doc, r, "stress", false, () => {});
  const card = box.querySelector(".testlab-results-card")!;
  assert.equal(card.querySelector(".testlab-results-verdict")!.textContent, "Would break");
  assert.equal(card.querySelector(".testlab-results-verdict")!.getAttribute("data-band"), "fails");
  assert.equal(card.querySelector(".testlab-results-factor-value")!.textContent, "0.182");
  assert.doesNotMatch(card.textContent!, /192|8\.03/);
  assert.match(card.textContent!, /It would start to break at about 1,780 N\./);
  const how = box.querySelector("details.testlab-results-how")!;
  assert.match(how.textContent!, /Worked out as if the part stayed in one piece: it would break before these loads are reached, so the bend and stress below are bigger than a real part would show\./);
  assert.match(how.textContent!, /Biggest bend8\.03 mm/);
});

test("the limit by hand in each unit, for metals 'bend for good', and with more than one load as a multiple of them", () => {
  // Steel (yield) 5 kg hanging, SF 23.4: 5 × 23.4 = 117 kg.
  const kg = resultOf(answer(23.4, 10, 0.004), steel, { body: "Bracket", held: [face("Back face")], loads: [load({ amount: 5, unit: "kg" })] });
  assert.equal(verdictWords(kg), "Holds");
  assert.equal(limitWords(kg), "It could take about 117 kg before it starts to bend for good.");
  // 5 kg hanging is 5 × 9.80665 = 49.03 N, said to three figures.
  assert.equal(pushedWords(kg.setUp.loads[0]), "5 kg hanging (49.0 N) down on Top face");
  // A pressure of 20 kPa square into two faces, SF 0.5: 20 × 0.5 = 10 kPa.
  const kpa = resultOf(answer(0.5, 70, 1), pla, { body: "Lid", held: [face("A"), face("B"), face("C")], loads: [load({ amount: 20, unit: "kPa", direction: "into", faces: [face("Top face"), face("Side face")] })] });
  assert.equal(limitWords(kpa), "It would start to break at about 10 kPa.");
  assert.equal(pushedWords(kpa.setUp.loads[0]), "20 kPa pressing square into Top face and Side face");
  assert.equal(cardLines(kpa)[3].words, "A, B and C");
  // A force square into a face: no direction word of its own.
  assert.equal(pushedWords(load({ direction: "into" })), "9,800 N square into Top face");
  // Two loads, SF 1.5: the loads could be 1.5 times what they are.
  const two = resultOf(answer(1.5, 23.3, 0.3), pla, { body: "Body 1", held: [face("Back face")], loads: [load({}), load({ id: "load-2", amount: 3, direction: "+x" })] });
  assert.equal(verdictWords(two), "Holds, just");
  assert.equal(limitWords(two), "It could take about 1.5 times these loads before it starts to break.");
  assert.deepEqual(cardLines(two).filter((l) => l.label === "Pushed").map((l) => l.words), ["9,800 N down on Top face", "3 N along +X on Top face"]);
  // Nothing stressed: no limit to speak of. A factor over 1,000: said as such, not as a huge number.
  assert.equal(limitWords(resultOf(answer(null, 0, 0), pla, bens)), null);
  assert.equal(verdictWords(resultOf(answer(null, 0, 0), pla, bens)), "Holds");
  assert.equal(limitWords(resultOf(answer(5000, 0.007, 0.0001), pla, bens)), "It could take over 1,000 times these loads before it starts to break.");
});

test("the verdict either side of the bands' edges: 0.9 and 1.1 of 1, 0.9 and 1.1 of 2", () => {
  const v = (sf: number) => verdictWords(resultOf(answer(sf, 35 / sf, 1), pla, bens));
  assert.equal(v(0.9), "Would break");
  assert.equal(v(1.1), "Holds, just");
  assert.equal(v(1.8), "Holds, just");
  assert.equal(v(2.2), "Holds");
});

test("a part that holds shows its biggest bend on the card, and no past-breaking note in the details", () => {
  const r = resultOf(answer(3.5, 10, 0.002), pla, bens);
  const doc = new Window().document as unknown as Document;
  const box = resultSection(doc, r, "stress", false, () => {});
  const card = box.querySelector(".testlab-results-card")!;
  assert.match(card.textContent!, /Bends at most 0\.002 mm\./);
  // 3.5 × 9,800 = 34,300 N.
  assert.match(card.textContent!, /It could take about 34,300 N before it starts to break\./);
  assert.doesNotMatch(box.textContent!, /as if the part stayed in one piece/);
});

test("Copy summary puts the card's text on the clipboard and says so; a refused clipboard is said too", async () => {
  const r = resultOf(answer(0.182, 192, 8.03), pla, bens);
  const window = new Window();
  const doc = window.document as unknown as Document;
  let copied = "";
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t: string) => void (copied = t) }, configurable: true });
  const box = resultSection(doc, r, "stress", false, () => {});
  (box.querySelector("[data-testlab=copy-summary]") as HTMLButtonElement).click();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(copied, summaryText(r));
  assert.equal(box.querySelector(".testlab-results-copied")!.textContent, "Copied.");
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => Promise.reject(new Error("no")) }, configurable: true });
  (box.querySelector("[data-testlab=copy-summary]") as HTMLButtonElement).click();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(box.querySelector(".testlab-results-copied")!.textContent, "Couldn't copy: select the card's words and copy them instead.");
});

// Ben (19 Nov): the one red tag "Biggest stress and bend" floated away from the dots, and the violet dot had no words at
// all. Each dot now has its own legend line in its own colour, saying which colour it is and what it marks.
test("the view's dots: one legend line each, in its dot's colour, naming the colour and what it marks", () => {
  const r = resultOf(answer(0.182, 192, 8.03), pla, bens);
  const [stress, bend] = resultOverlays(r);
  assert.equal(stress.id, RESULT_OVERLAY);
  assert.equal(stress.label, "● Red dot: biggest stress");
  assert.deepEqual(stress.places!.map((p) => p.severity), ["error"]); // drawn red (core SEVERITY_COLOURS.error), its legend line red too
  assert.equal(bend.id, BEND_OVERLAY);
  assert.equal(bend.label, "● Violet dot: biggest bend");
  assert.deepEqual(bend.places!.map((p) => p.severity), ["info"]); // drawn violet (SEVERITY_COLOURS.info)
  // The red dot where the kernel says the stress is biggest, (0, 0, 0): the first point, which does not move.
  assert.deepEqual("point" in stress.places![0] && stress.places![0].point, [0, 0, 0]);
  // The violet dot at (100, 0, 0) drawn moved by the bend times the drawn scale along x: 100 + 8.03 · scale.
  assert.deepEqual("point" in bend.places![0] && bend.places![0].point, [100 + 8.03 * r.scale, 0, 0]);
  assert.equal(stress.marks.length + bend.marks.length, 0, "no faces painted: the colour map is the paint");
});

test("each face the card names is a button: a tap shows that face in the view; one not found now says why instead", () => {
  // Two loads and two held faces: every face name on the card (3 pushed, 2 held) is its own button, in the card's order.
  const top = face("Top face");
  const side = face("Side of line-20 face");
  const end = face("End face");
  const back = face("Back face");
  const setUp: RunSetUp = { body: "Body 1", held: [end, back], loads: [load({ faces: [top, side] }), load({ id: "load-2", amount: 3, direction: "+x", faces: [top] })] };
  const r = resultOf(answer(1.5, 23.3, 0.3), pla, setUp);
  const doc = new Window().document as unknown as Document;
  const shown: string[] = [];
  const box = resultSection(doc, r, "stress", false, () => {}, {
    whyNot: (f) => (f.ref.id === back.ref.id ? "Back face isn't on the part after the last edit." : null),
    show: (f) => void shown.push(f.label),
  });
  const buttons = [...box.querySelectorAll<HTMLButtonElement>(".testlab-results-card button[data-testlab-face]")];
  assert.deepEqual(buttons.map((b) => b.textContent), ["Top face", "Side of line-20 face", "Top face", "End face", "Back face"]);
  // Each is a real button, named for what it does with its own words in the name (so speech and the eye agree).
  for (const b of buttons) {
    assert.equal(b.type, "button");
    assert.equal(b.getAttribute("aria-label"), `Show ${b.textContent} in the view`);
  }
  // The lines still read as before around the buttons.
  const dd = [...box.querySelectorAll(".testlab-results-setup dd")].map((d) => d.textContent);
  assert.deepEqual(dd, ["Body 1", "PLA, printed", "9,800 N down on Top face and Side of line-20 face", "3 N along +X on Top face", "End face and Back face"]);
  buttons[1].click();
  buttons[3].click();
  assert.deepEqual(shown, ["Side of line-20 face", "End face"]);
  // A face not on the part now: marked, and a tap says why where the card says things, never turns the camera to a guess.
  assert.equal(buttons[4].getAttribute("aria-disabled"), "true");
  buttons[4].click();
  assert.deepEqual(shown, ["Side of line-20 face", "End face"]);
  assert.equal(box.querySelector(".testlab-results-copied")!.textContent, "Back face isn't on the part after the last edit.");
  // Without a way to show faces (a stand-in view) the names stay plain words.
  const plain = resultSection(doc, r, "stress", false, () => {});
  assert.equal(plain.querySelectorAll("button[data-testlab-face]").length, 0);
  assert.match(plain.querySelector(".testlab-results-setup")!.textContent!, /End face and Back face/);
});
