// Reading a laser job's SVG (svg.ts): hand-worked drawings with the working shown, every refusal, the colour rules,
// and seeded random drawings against a simple model (each shape's corners worked out apart from the reader).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSvg, type DrawingRead } from "../src/svg.ts";

const MM = (body: string, w = 200, h = 100, extra = "") => `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" ${extra}>${body}</svg>`;

function ok(text: string): DrawingRead {
  const r = readSvg(text);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.drawing;
}
function no(text: string, words: RegExp): void {
  const r = readSvg(text);
  assert.ok(!r.ok, "read when it should be refused");
  assert.match(r.reason, words);
}
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test("hand-worked: sizes in millimetres, pixels and Illustrator's points", () => {
  // A 50 × 20 rect in a document 200 mm wide with a 200-wide viewBox: one unit a millimetre, so 50 × 20 mm.
  let d = ok(MM(`<rect x="10" y="10" width="50" height="20" fill="none" stroke="#f00"/>`));
  near(d.width, 50);
  near(d.height, 20);
  assert.deepEqual(d.layers, { cut: 1, score: 0, engrave: 0 });
  assert.deepEqual(d.notes, []);
  // The same document 400 mm wide over the same viewBox: every unit 2 mm, so 100 × 40 mm.
  d = ok(MM(`<rect x="10" y="10" width="50" height="20" fill="none" stroke="#f00"/>`, 200, 100).replace('width="200mm" height="100mm"', 'width="400mm" height="200mm"'));
  near(d.width, 100);
  near(d.height, 40);
  // In centimetres: width 20cm over a 200 viewBox is 1 mm a unit again.
  d = ok(MM(`<rect width="50" height="20" fill="none" stroke="red"/>`).replace('width="200mm" height="100mm"', 'width="20cm" height="10cm"'));
  near(d.width, 50);
  // No units: CSS pixels, 96 to the inch, so 96 px is 25.4 mm; said in a note.
  d = ok(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="48" fill="none" stroke="#00f"/></svg>`);
  near(d.width, 25.4);
  near(d.height, 12.7);
  assert.deepEqual(d.layers, { cut: 0, score: 1, engrave: 0 });
  assert.match(d.notes.join(" "), /96 to the inch/);
  // Illustrator writes 72 user units to the inch: 72 is 25.4 mm there.
  d = ok(`<?xml version="1.0"?><!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 72"><rect width="72" height="72" fill="none" stroke="#FF0000"/></svg>`);
  near(d.width, 25.4);
  assert.match(d.notes.join(" "), /72 to the inch/);
});

test("hand-worked: transforms, curves and round corners", () => {
  // A 40 × 10 rect turned 90° about the origin stands 10 wide and 40 tall.
  let d = ok(MM(`<rect width="40" height="10" fill="none" stroke="#f00" transform="rotate(90)"/>`));
  near(d.width, 10);
  near(d.height, 40);
  // In a group scaled by 2 then shifted: shifts don't change size, so 80 × 20.
  d = ok(MM(`<g transform="translate(5 5) scale(2)"><rect width="40" height="10" fill="none" stroke="#f00"/></g>`));
  near(d.width, 80);
  near(d.height, 20);
  // skewX(45) moves each point right by its y: a 10 × 10 square becomes a parallelogram 20 wide, 10 tall.
  d = ok(MM(`<rect width="10" height="10" fill="none" stroke="#f00" transform="skewX(45)"/>`));
  near(d.width, 20, 1e-12);
  near(d.height, 10);
  // A 10 × 10 square with corner radius 5 is a circle of diameter 10: turned 45° it is still 10 × 10, where a sharp
  // square would be 10√2 = 14.14 across.
  d = ok(MM(`<rect width="10" height="10" rx="5" fill="none" stroke="#f00" transform="rotate(45)"/>`));
  near(d.width, 10, 1e-9);
  const sharp = ok(MM(`<rect width="10" height="10" fill="none" stroke="#f00" transform="rotate(45)"/>`));
  near(sharp.width, 10 * Math.SQRT2, 1e-9);
  // Path: a cubic from (0,0) to (30,0) with both controls at height 40 rises to ¾ of 40 = 30 (y(½) = 3·¼·40·2·½).
  d = ok(MM(`<path d="M0,0 C0,40 30,40 30,0" fill="none" stroke="#f00"/>`));
  near(d.height, 30);
  // The same with S: the reflection of the first's second control gives a wave, down by 30 then the mirror: 0..30
  // wide 60 in all and 60 tall (from −30 to 30). The second piece's first control is the reflection (30, −40).
  d = ok(MM(`<path d="M0,0 C0,40 30,40 30,0 S60,-40 60,0" fill="none" stroke="#f00"/>`));
  near(d.width, 60);
  near(d.height, 60);
  // An arc whose radii are too small to reach is grown until it does (the SVG rule): radius 1 from (0,0) to (10,0)
  // becomes a half circle of radius 5: 10 wide, 5 tall.
  d = ok(MM(`<path d="M0 0A1 1 0 0 1 10 0" fill="none" stroke="#f00"/>`));
  near(d.width, 10);
  near(d.height, 5);
  // Compact flags ("a5 5 0 1 0 0 10" written "a5,5 0 1010,10"): radius 5 from (0,0) to (0,10), large and sweep 0.
  d = ok(MM(`<path d="M0,0a5,5 0 1010,10" fill="none" stroke="#f00"/>`));
  assert.ok(d.width > 0);
  // Relative moves, H, V and Z: a 10 × 10 square drawn from (5,5).
  d = ok(MM(`<path d="m5 5h10v10h-10z" fill="none" stroke="#f00"/>`));
  near(d.width, 10);
  near(d.height, 10);
  // Polygon and polyline, line and ellipse.
  d = ok(MM(`<polygon points="0,0 30,0 15,20" fill="#000"/><line x1="0" y1="0" x2="5" y2="40" stroke="#00f"/><ellipse cx="100" cy="0" rx="10" ry="5" fill="none" stroke="red"/>`));
  near(d.width, 110);
  near(d.height, 45);
  assert.deepEqual(d.layers, { cut: 1, score: 1, engrave: 1 });
});

test("colours: attributes, style, the style sheet, inheritance and the default black fill", () => {
  // Style beats a class rule, a class rule beats the attribute (SVG's order).
  let d = ok(MM(`<style>.c{stroke:#00f;fill:none}</style><rect class="c" stroke="#f00" width="10" height="10"/>`));
  assert.deepEqual(d.layers, { cut: 0, score: 1, engrave: 0 });
  d = ok(MM(`<style>.c{stroke:#00f;fill:none}</style><rect class="c" style="stroke: rgb(255, 0, 0)" width="10" height="10"/>`));
  assert.deepEqual(d.layers, { cut: 1, score: 0, engrave: 0 });
  // An #id rule beats a .class rule whatever the order; CDATA round a sheet is read the same.
  d = ok(MM(`<style><![CDATA[#a{stroke:#f00} .c{stroke:#00f;fill:none}]]></style><rect id="a" class="c" width="10" height="10"/>`));
  assert.deepEqual(d.layers, { cut: 1, score: 0, engrave: 0 });
  // Colours inherit from the group; a shape with no fill said is filled black (SVG's default), so engraved.
  d = ok(MM(`<g stroke="#ff0000"><circle r="5"/></g>`));
  assert.deepEqual(d.layers, { cut: 1, score: 0, engrave: 1 });
  // currentColor, and fill="none" with no stroke: nothing for the laser, said in a note.
  d = ok(MM(`<g color="blue"><rect width="5" height="5" stroke="currentColor" fill="none"/></g><rect width="50" height="50" fill="none"/>`));
  assert.deepEqual(d.layers, { cut: 0, score: 1, engrave: 0 });
  near(d.width, 5);
  assert.match(d.notes.join(" "), /1 shape has no outline and no fill/);
  // Hidden things are left out: display none on a group, opacity 0, a zero stroke width, things in <defs>.
  d = ok(MM(`<rect width="5" height="5" fill="none" stroke="#f00"/><g style="display:none"><rect width="500" height="5" stroke="#f00"/></g><rect width="600" height="5" opacity="0" stroke="#f00"/><defs><rect width="700" height="5" stroke="#f00"/></defs><rect width="800" height="5" fill="none" stroke="#f00" stroke-width="0"/><sodipodi:namedview/>`));
  near(d.width, 5);
});

test("every refusal says what to do", () => {
  no(MM(`<rect width="5" height="5" fill="none" stroke="#0f0"/>`), /outline in #00ff00.*red \(#ff0000\).*blue/);
  no(MM(`<rect width="5" height="5" fill="#fe0000" stroke="none"/>`), /filled in #fe0000.*black/);
  no(MM(`<rect width="5" height="5" fill="#ccc"/>`), /filled in #cccccc/);
  no(MM(`<rect width="5" height="5" fill="url(#grad)"/>`), /filled in "url\(#grad\)"/);
  no(MM(`<rect width="5" height="5" fill="none" stroke="#000"/>`), /outline in #000000/);
  no(MM(`<text x="0" y="0">Hi</text>`), /text.*outlines/);
  no(MM(`<image href="a.png" width="5" height="5"/>`), /picture/);
  no(MM(`<use href="#a"/>`), /clone/);
  no(MM(`<rect width="5" height="5" fill="none" stroke="#f00"/>`).replace("</svg>", ""), /damaged.*never closed/);
  no(MM(`<rect width="5" height="5" fill="none" stroke="#f00"></g>`), /damaged/);
  no(`<html><body/></html>`, /not an SVG/);
  no(MM(``), /nothing for the laser/);
  no(MM(`<path d="M0 0 L 5" stroke="#f00"/>`), /missing number/);
  no(MM(`<path d="L0 0 5 5" stroke="#f00"/>`), /doesn't start with a move/);
  no(MM(`<rect width="5" height="5" stroke="#f00" transform="spin(3)"/>`), /transform/);
  no(MM(`<rect width="50%" height="5" stroke="#f00"/>`), /%/);
  no(MM(`<style>g > rect{stroke:red}</style><rect width="5" height="5"/>`), /style rule/);
  no(MM(`<rect width="5" height="5" fill="none" stroke="#f00"/>`).replace('viewBox="0 0 200 100"', 'viewBox="0 0 0 100"'), /viewBox/);
});

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("seeded random drawings: rects and circles in turned, scaled groups against their corners worked apart", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = mulberry(seed);
    const n = 1 + Math.floor(r() * 5);
    const scale = 0.5 + r() * 3; // mm a user unit
    let body = "";
    const model = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const add = (x: number, y: number) => {
      model.minX = Math.min(model.minX, x);
      model.maxX = Math.max(model.maxX, x);
      model.minY = Math.min(model.minY, y);
      model.maxY = Math.max(model.maxY, y);
    };
    for (let k = 0; k < n; k++) {
      const deg = Math.round(r() * 360);
      const [tx, ty] = [Math.round(r() * 100), Math.round(r() * 100)];
      const a = (deg * Math.PI) / 180;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      // The group's map: translate(tx, ty) rotate(deg), so a point (x, y) goes to (tx + x c − y s, ty + x s + y c).
      const put = (x: number, y: number) => add(scale * (tx + x * c - y * s), scale * (ty + x * s + y * c));
      if (r() < 0.5) {
        const [w, h] = [1 + Math.round(r() * 40), 1 + Math.round(r() * 40)];
        body += `<g transform="translate(${tx},${ty}) rotate(${deg})"><rect width="${w}" height="${h}" fill="none" stroke="#f00"/></g>`;
        for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]] as const) put(x, y);
      } else {
        const rad = 1 + Math.round(r() * 30);
        body += `<g transform="translate(${tx},${ty}) rotate(${deg})"><circle r="${rad}" fill="#000"/></g>`;
        // A circle's box is its centre ± its radius whatever it is turned by.
        put(0, 0);
        model.minX = Math.min(model.minX, scale * (tx - rad));
        model.maxX = Math.max(model.maxX, scale * (tx + rad));
        model.minY = Math.min(model.minY, scale * (ty - rad));
        model.maxY = Math.max(model.maxY, scale * (ty + rad));
      }
    }
    const d = ok(`<svg xmlns="http://www.w3.org/2000/svg" width="${100 * scale}mm" height="${100 * scale}mm" viewBox="0 0 100 100">${body}</svg>`);
    near(d.width, model.maxX - model.minX, 1e-9 * (1 + d.width));
    near(d.height, model.maxY - model.minY, 1e-9 * (1 + d.height));
  }
});
