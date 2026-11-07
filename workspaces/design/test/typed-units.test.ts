import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_TYPED } from "../src/typed-entry.ts";
import { readDiameterIn, readLengthIn } from "../src/typed-length.ts";
import { typedBoxes } from "../src/typed-boxes.ts";

// U2c3: the sketch's typed-size boxes in the chosen unit. A length typed in inches is read as millimetres (the locks
// the workspace uses are always millimetres); angles stay degrees; the limits are the same lengths in either unit.

const { Window } = await import("happy-dom");

test("hand-worked: in inches a bare 1 is 25.4 mm, '25.4 mm' and '1 in' say the same length, 0.5 is 12.7 mm", () => {
  assert.deepEqual(readLengthIn("1", "in"), { value: 25.4 }); // 1 in x 25.4 mm/in
  assert.deepEqual(readLengthIn("0.5", "in"), { value: 12.7 });
  assert.deepEqual(readLengthIn("25.4 mm", "in"), { value: 25.4 });
  assert.deepEqual(readLengthIn('1"', "in"), { value: 25.4 });
  assert.deepEqual(readLengthIn("1 inch", "in"), { value: 25.4 });
  assert.deepEqual(readLengthIn("12.5", "mm"), { value: 12.5 }, "millimetres: exactly readLength");
});

test("the limits are the same in inches, at 0.9x and 1.1x of the smallest length (0.001 mm = 0.0000393701 in)", () => {
  const minIn = MIN_TYPED / 25.4;
  assert.ok("value" in readLengthIn(String(minIn * 1.1), "in"), "1.1x the smallest passes");
  const small = readLengthIn(String(minIn * 0.9), "in");
  assert.ok("error" in small, "0.9x the smallest is refused");
  assert.match((small as { error: string }).error, /at least 0\.0000394 in/);
  assert.doesNotMatch((small as { error: string }).error, /\bmm\b/);
  const big = readLengthIn(String((1e6 / 25.4) * 1.1), "in");
  assert.ok("error" in big, "1.1x a kilometre is refused");
  assert.ok("value" in readLengthIn(String((1e6 / 25.4) * 0.9), "in"));
  assert.match((readLengthIn("0", "in") as { error: string }).error, /more than 0 in/);
  assert.match((readLengthIn("1e", "in") as { error: string }).error, /number of inches/);
  assert.match((readLengthIn("1e", "mm") as { error: string }).error, /number of mm/, "millimetres keep the old words");
});

test("a diameter's half is still at least 0.001 mm: 0.0015 mm refused, 0.0025 mm kept, typed in inches", () => {
  assert.ok("error" in readDiameterIn(String(0.0015 / 25.4), "in"));
  assert.deepEqual(readDiameterIn("1", "in"), { value: 25.4 });
});

function setup(unit?: string) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  if (unit) doc.documentElement.dataset.unit = unit;
  const host = doc.createElement("div");
  doc.body.append(host);
  const seen: unknown[] = [];
  const boxes = typedBoxes(host, { locks: (l) => seen.push(l), enter() {}, escape() {} });
  const choose = (u: string) => {
    doc.documentElement.dataset.unit = u;
    doc.dispatchEvent(new window.CustomEvent("unitchange", { detail: u }) as unknown as Event);
  };
  const type = (id: string, text: string) => {
    const input = doc.getElementById(id) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new window.Event("input") as unknown as Event);
  };
  return { doc, boxes, choose, type, seen };
}

test("inches: the Length box says in, shows the live size in inches, locks millimetres; Angle stays degrees", () => {
  const { doc, boxes, type } = setup("in");
  boxes.show(["length", "angle"], { length: 50.8, angle: 30 }, 10, 10);
  assert.equal(doc.getElementById("typed-length")!.getAttribute("aria-label"), "Length (in)");
  assert.equal(doc.getElementById("typed-angle")!.getAttribute("aria-label"), "Angle (°)");
  assert.equal((doc.getElementById("typed-length") as HTMLInputElement).placeholder, "2", "50.8 mm = 2 in");
  assert.equal((doc.getElementById("typed-angle") as HTMLInputElement).placeholder, "30");
  type("typed-length", "1");
  type("typed-angle", "45");
  assert.deepEqual(boxes.locks, { length: 25.4, angle: 45 });
});

test("choosing the other unit with a length typed shows the same length in it, and the locks do not change", () => {
  const { doc, boxes, choose, type } = setup();
  boxes.show(["width", "height"], {}, 10, 10);
  type("typed-width", "25.4");
  assert.deepEqual(boxes.locks, { width: 25.4 });
  choose("in");
  assert.equal((doc.getElementById("typed-width") as HTMLInputElement).value, "1");
  assert.deepEqual(boxes.locks, { width: 25.4 });
  assert.equal(doc.querySelector("label[data-field=width] .typed-entry-unit")!.textContent, "in");
  choose("mm");
  assert.equal((doc.getElementById("typed-width") as HTMLInputElement).value, "25.4");
  assert.equal(doc.querySelector("label[data-field=width] .typed-entry-unit")!.textContent, "mm");
});

test("a refusal in inches names inches in the box", () => {
  const { doc, boxes, type } = setup("in");
  boxes.show(["length"], {}, 10, 10);
  type("typed-length", "0");
  assert.match(doc.querySelector("label[data-field=length] .typed-entry-error")!.textContent!, /more than 0 in/);
  assert.deepEqual(boxes.locks, {});
});
