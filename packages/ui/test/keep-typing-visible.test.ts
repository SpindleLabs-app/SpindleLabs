// Keeping the box being typed in on the screen (keep-typing-visible.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { takesTyping, typingHidden } from "../src/keep-typing-visible.ts";

test("hand-worked: a box at 604 to 648 px under a keyboard that leaves 0 to 480 px is hidden", () => {
  // The phone hunt's case: 393 × 852 upright, the Properties sheet's Height box 604 to 648 px down; the keyboard takes
  // 372 px, so 852 − 372 = 480 px still show. 648 > 480, so the box is under the keyboard.
  assert.equal(typingHidden({ top: 604, bottom: 648 }, { top: 0, bottom: 480 }), true);
  // The same box once scrolled to the middle of what shows: 480 / 2 = 240, the box 44 px tall, so 218 to 262 px.
  assert.equal(typingHidden({ top: 218, bottom: 262 }, { top: 0, bottom: 480 }), false);
});

test("edges: a box exactly filling what shows is in sight; one pixel past either edge is not", () => {
  assert.equal(typingHidden({ top: 0, bottom: 480 }, { top: 0, bottom: 480 }), false);
  assert.equal(typingHidden({ top: 10, bottom: 481 }, { top: 0, bottom: 480 }), true);
  assert.equal(typingHidden({ top: -1, bottom: 40 }, { top: 0, bottom: 480 }), true);
  // iOS: the visual viewport scrolled 300 px down the layout viewport; a box at 250 px is above it.
  assert.equal(typingHidden({ top: 250, bottom: 290 }, { top: 300, bottom: 780 }), true);
  assert.equal(typingHidden({ top: 320, bottom: 360 }, { top: 300, bottom: 780 }), false);
});

test("only boxes that bring up a keyboard count", () => {
  const input = (type: string | null) => ({ tagName: "INPUT", getAttribute: (n: string) => (n === "type" ? type : null) }) as unknown as Element;
  for (const type of [null, "text", "number", "NUMBER", "search", "email", "url", "tel", "password"]) assert.equal(takesTyping(input(type)), true, `input ${type}`);
  for (const type of ["checkbox", "radio", "range", "button", "color", "file"]) assert.equal(takesTyping(input(type)), false, `input ${type}`);
  assert.equal(takesTyping({ tagName: "TEXTAREA" } as unknown as Element), true);
  assert.equal(takesTyping({ tagName: "DIV", isContentEditable: true } as unknown as Element), true);
  assert.equal(takesTyping({ tagName: "BUTTON", isContentEditable: false } as unknown as Element), false);
  assert.equal(takesTyping({ tagName: "SELECT", isContentEditable: false } as unknown as Element), false);
  assert.equal(takesTyping(null), false);
});
