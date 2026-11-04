import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { TIP_SHORT_MAX, quickInfoFor, startTooltips, tipWords } from "../src/tooltip.ts";

const page = () => {
  const window = new Window();
  return { window, doc: window.document as unknown as Document };
};
const fire = (window: Window, el: Element, type: string, init: Record<string, unknown> = {}) => {
  const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  for (const [k, v] of Object.entries(init)) if (!(k in e)) Object.defineProperty(e, k, { value: v }); // pointerType is not a MouseEvent field
  el.dispatchEvent(e as unknown as Event);
  return e;
};

test("tipWords: the name before the first colon is the hover box, the whole title the quick info", () => {
  // "Extrude: make a solid ..." — the colon ends the name "Extrude" (7 letters), the rest is how to use it.
  const w = tipWords("Extrude: make a solid from a closed sketch.");
  assert.equal(w.short, "Extrude");
  assert.equal(w.full, "Extrude: make a solid from a closed sketch.");
});

test("tipWords: no colon, so the first sentence; a short single sentence is kept whole", () => {
  assert.equal(tipWords("Snaps to the grid. Hold Alt to turn it off.").short, "Snaps to the grid.");
  assert.equal(tipWords("Close (Esc)").short, "Close (Esc)");
});

test("tipWords: the hover box is at most 80 characters, cut at a word with an ellipsis", () => {
  const exactly = "a".repeat(TIP_SHORT_MAX); // 80 characters: kept
  assert.equal(tipWords(exactly).short, exactly);
  const words = "word ".repeat(20).trim(); // 99 characters: cut
  const cut = tipWords(words).short;
  assert.ok(cut.length <= TIP_SHORT_MAX, `${cut.length}`);
  assert.ok(cut.endsWith("…"));
  // the first 79 characters are 15 "word " (75) and "word" (4); the last space is at index 74, so the cut keeps the 74 characters before it: 15 words
  assert.equal(cut, `${"word ".repeat(15).trim()}…`);
});

test("quickInfoFor: a button with words yes; a field, a canvas, plain text or a button without words no", () => {
  const { doc } = page();
  doc.body.innerHTML = `<button id="b" title="Undo">U</button><button id="n">N</button><input id="i" title="x"><canvas id="c" title="x"></canvas><p id="p" title="x">t</p><button id="d" data-tip="Held">D</button>`;
  const q = (id: string) => quickInfoFor(doc.getElementById(id));
  assert.equal(q("b")?.id, "b");
  assert.equal(q("d")?.id, "d");
  assert.equal(q("n"), null);
  assert.equal(q("i"), null);
  assert.equal(q("c"), null);
  assert.equal(q("p"), null);
});

test("hover: the box shows at once, the title is held back from the browser, and is put back on leaving", () => {
  const { window, doc } = page();
  doc.body.innerHTML = `<button id="b" title="Extrude: make a solid from a sketch.">E</button>`;
  const t = startTooltips(doc);
  const b = doc.getElementById("b")!;
  const box = doc.getElementById("tooltip")!;
  assert.equal(box.hidden, true);
  fire(window, b, "pointerover");
  assert.equal(box.hidden, false);
  assert.equal(b.hasAttribute("title"), false); // else the browser's own box would show too
  assert.equal(box.querySelector(".words")!.textContent, "Extrude");
  assert.equal(b.getAttribute("aria-describedby"), "tooltip");
  fire(window, b, "pointerout", { relatedTarget: doc.body });
  assert.equal(box.hidden, true);
  assert.equal(b.getAttribute("title"), "Extrude: make a solid from a sketch.");
  assert.equal(b.hasAttribute("aria-describedby"), false);
  t.stop();
});

test("hover: a touch pointer shows nothing", () => {
  const { window, doc } = page();
  doc.body.innerHTML = `<button id="b" title="Undo">U</button>`;
  const t = startTooltips(doc);
  fire(window, doc.getElementById("b")!, "pointerover", { pointerType: "touch" });
  assert.equal(doc.getElementById("tooltip")!.hidden, true);
  t.stop();
});

test("right-click on a button: quick info with the whole title and its key; the browser's menu is suppressed", () => {
  const { window, doc } = page();
  doc.body.innerHTML = `<button id="b" title="Extrude: make a solid from a sketch." data-key="E">E</button>`;
  const t = startTooltips(doc);
  const e = fire(window, doc.getElementById("b")!, "contextmenu");
  const box = doc.getElementById("tooltip")!;
  assert.equal(e.defaultPrevented, true);
  assert.equal(box.hidden, false);
  assert.equal(box.querySelector(".words")!.textContent, "Extrude: make a solid from a sketch.");
  assert.equal((box.querySelector(".key") as HTMLElement).textContent, "E");
  assert.ok(box.classList.contains("pinned"));
  // Escape closes it and puts the title back, and is not stopped for anyone else.
  const esc = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  doc.body.dispatchEvent(esc as unknown as Event);
  assert.equal(box.hidden, true);
  assert.equal(doc.getElementById("b")!.getAttribute("title"), "Extrude: make a solid from a sketch.");
  t.stop();
});

test("right-click that something else already took (a menu of its own), or on a field, is left alone", () => {
  const { window, doc } = page();
  doc.body.innerHTML = `<div id="row"><button id="b" title="Row: more">⋯</button></div><input id="i" title="Name">`;
  const t = startTooltips(doc);
  const box = doc.getElementById("tooltip")!;
  // The row's own handler runs first (at the target) and prevents the default.
  doc.getElementById("b")!.addEventListener("contextmenu", (e) => e.preventDefault());
  fire(window, doc.getElementById("b")!, "contextmenu");
  assert.equal(box.hidden, true);
  const e = fire(window, doc.getElementById("i")!, "contextmenu");
  assert.equal(e.defaultPrevented, false); // the browser's own menu (paste, spelling) stays
  assert.equal(box.hidden, true);
  t.stop();
});
