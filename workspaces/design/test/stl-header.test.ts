// The STL header the app writes itself (kernel-results #103, app half): Download STL's join of several bodies
// (`joinStl`, also the MCP server's export, named for the project) and the "checked solid" stamp (`stampChecked`).
// The 80 bytes were cut inside a multi-byte character and kept newlines; now each character outside printable ASCII
// (space to ~) is one "?", as the kernel writes its own header, so the header is 80 bytes of printable ASCII.
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinStl } from "../src/actions.ts";
import { CHECKED_HEADER, stampChecked } from "../src/solid-badge.ts";

/** A binary STL of `n` zero triangles. */
const stl = (n: number) => {
  const out = new Uint8Array(84 + 50 * n);
  new DataView(out.buffer).setUint32(80, n, true);
  return out;
};
const header = (bytes: Uint8Array) => bytes.subarray(0, 80);
const printable = (bytes: Uint8Array) => [...header(bytes)].every((b) => b >= 0x20 && b <= 0x7e);
const text = (bytes: Uint8Array) => String.fromCharCode(...header(bytes));

test("joinStl: a two-byte character at byte 79 is one '?', never half a character", () => {
  // "SpindleLabs STL: " is 17 bytes, so 62 a's fill bytes 17 to 78 and the "é" (2 bytes in UTF-8) starts at byte 79:
  // cut there it was half a character. Now byte 79 is "?" and the header is printable ASCII.
  const out = joinStl([stl(1), stl(2)], `${"a".repeat(62)}é tail`);
  assert.ok(printable(out), JSON.stringify(text(out)));
  assert.equal(text(out), `SpindleLabs STL: ${"a".repeat(62)}?`);
  // The triangles are untouched: 1 + 2 = 3, 84 + 150 bytes.
  assert.equal(new DataView(out.buffer).getUint32(80, true), 3);
  assert.equal(out.length, 234);
});

test("joinStl: a newline, a NUL and a tab are each one '?', the rest spaces", () => {
  // "SpindleLabs STL: a?b?c?d" is 17 + 7 = 24 bytes, then 56 spaces.
  const out = joinStl([stl(1), stl(1)], "a\nb\0c\td");
  assert.equal(text(out), "SpindleLabs STL: a?b?c?d".padEnd(80, " "));
});

test("joinStl and stampChecked: a character outside the basic plane (two UTF-16 units, four UTF-8 bytes) is one '?'", () => {
  // "😀" is one character: the kernel writes it as one "?", and so does the app.
  assert.equal(text(joinStl([stl(1), stl(1)], "😀x")), "SpindleLabs STL: ?x".padEnd(80, " "));
  assert.equal(text(stampChecked(stl(1), "😀x")), `${CHECKED_HEADER}?x`.padEnd(80, " "));
});

test("control: a plain name is written as it is", () => {
  assert.equal(text(joinStl([stl(1), stl(1)], "2 bodies")), "SpindleLabs STL: 2 bodies".padEnd(80, " "));
  assert.equal(text(stampChecked(stl(1), "box")), `${CHECKED_HEADER}box`.padEnd(80, " "));
});
