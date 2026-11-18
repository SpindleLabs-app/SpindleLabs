import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson } from "../src/index.ts";

// SL #511 item 5: a project file opened from its bytes. A file saved in another text encoding (an editor that wrote
// Latin-1) used to open with its text quietly changed, "Café" as "Caf�", and the next save kept the damage.
const cafe = () => projectToJson(emptyProject("Café"));

test("a project's bytes saved as UTF-8 open with every letter as saved", () => {
  // "é" is U+00E9, which UTF-8 writes as the two bytes C3 A9.
  const bytes = new TextEncoder().encode(cafe());
  assert.ok(bytes.includes(0xc3), "the test file really holds é as UTF-8");
  assert.equal(projectFromJson(bytes, []).name, "Café");
});

test("a byte order mark in front of a UTF-8 project is dropped, as before", () => {
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(cafe())]);
  assert.equal(projectFromJson(bytes, []).name, "Café");
});

test("a project saved as Latin-1 is refused in plain words, never opened with its text changed", () => {
  // Latin-1 writes "é" as the one byte E9. In UTF-8, E9 starts a three-byte letter, and the next byte is '"' (22),
  // not a follow-on byte (80–BF), so the file is not UTF-8. Every character of the test text is below 256, so
  // charCodeAt is its Latin-1 byte.
  const bytes = Uint8Array.from([...cafe()].map((c) => c.charCodeAt(0)));
  assert.ok(bytes.includes(0xe9) && !bytes.includes(0xc3), "the test file really holds é as one Latin-1 byte");
  assert.throws(() => projectFromJson(bytes, []), {
    message: "can't open this project: its text isn't saved as UTF-8, so some letters would change. Save it as UTF-8 in the editor that changed it, then open it again.",
  });
});

test("a project's text given as text opens as before", () => {
  assert.equal(projectFromJson(cafe(), []).name, "Café");
});
