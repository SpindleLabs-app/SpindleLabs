// Extrude's Distance box ready to type into (UI audit 2026-11-12): with a mouse the cursor waits in the box as Extrude
// opens, its number selected, so "10" then Enter makes the extrude with no click on the box; on a touch screen it never
// takes the focus, whose keyboard would cover the view. The panel in a real DOM (happy-dom), the pointer told by a
// stand-in matchMedia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extrudePanel, typesStraightAway } from "../src/extrude-panel.ts";

const { Window } = await import("happy-dom");

/** A page whose pointer answers "(hover: hover) and (pointer: fine)" with `mouse`. */
function setup(mouse: boolean) {
  const window = new Window({ width: 1280, height: 800 });
  const asked: string[] = [];
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => {
      asked.push(query);
      return { matches: mouse && query === "(hover: hover) and (pointer: fine)", media: query, addEventListener() {}, removeEventListener() {} };
    },
  });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const heard: string[] = [];
  const panel = extrudePanel(slot, {
    distance: (typed) => heard.push(`distance ${typed}`),
    flip: () => heard.push("flip"),
    clear: () => heard.push("clear"),
    ok: (typed) => heard.push(`ok ${typed}`),
    cancel: () => heard.push("cancel"),
  });
  const input = () => doc.getElementById("extrude-distance") as HTMLInputElement;
  return { doc, panel, heard, input, asked };
}

test("with a mouse: Extrude opens with the cursor in Distance and its 0 selected, so typing replaces it", () => {
  const { doc, panel, input } = setup(true);
  // A number box keeps no selection range a script can read (selectionStart is null by the HTML rules), so the select()
  // call itself is watched: it is what makes the first key typed replace the "0" rather than make "010".
  const proto = (doc.defaultView as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement.prototype;
  const selected: string[] = [];
  const select = proto.select;
  proto.select = function (this: HTMLInputElement) {
    selected.push(this.id);
    return select.call(this);
  };
  panel.show("Sketch 1", "0");
  assert.equal(doc.activeElement === input(), true, "the Distance box has the focus");
  assert.deepEqual(selected, ["extrude-distance"], "its number selected, once");
  assert.equal(input().value, "0");
});

test("with a mouse: typing 10 then Enter is OK at 10 mm, with no click on the box (8 clicks for a box become 7)", () => {
  const { panel, heard, input } = setup(true);
  panel.show("Sketch 1", "0");
  panel.showStatus("Sketch 1 makes a closed outline.", true);
  const box = input();
  const view = box.ownerDocument.defaultView as unknown as { Event: typeof Event; KeyboardEvent: typeof KeyboardEvent };
  // What a keyboard does to the focused box: the selected "0" replaced by "10", an input event, then Enter.
  box.value = "10";
  box.dispatchEvent(new view.Event("input", { bubbles: true }));
  box.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(heard, ["distance 10", "ok 10"]);
});

test("on a touch screen: Extrude opens with nothing focused, so no keyboard comes up over the view", () => {
  const { doc, panel, input } = setup(false);
  panel.show("Sketch 1", "0");
  assert.equal(doc.activeElement === input(), false, "nothing in the panel focused");
  assert.equal(input().value, "0");
});

test("the query is exactly the mouse's: hover and a fine pointer; a page without matchMedia counts as touch", () => {
  const mouse = setup(true);
  assert.equal(typesStraightAway(mouse.doc), true);
  assert.deepEqual(mouse.asked, ["(hover: hover) and (pointer: fine)"]);
  assert.equal(typesStraightAway(setup(false).doc), false);
  const bare = new Window({ width: 400, height: 800 });
  Object.defineProperty(bare, "matchMedia", { value: undefined });
  assert.equal(typesStraightAway(bare.document as unknown as Document), false);
});

test("opening again (another Extrude) takes the focus again into the new box", () => {
  const { doc, panel, input } = setup(true);
  panel.show("Sketch 1", "0");
  const first = input();
  panel.hide();
  (doc.body as HTMLElement).focus();
  panel.show("Sketch 2", "0");
  assert.equal(input() === first, false, "the panel was built again");
  assert.equal(doc.activeElement === input(), true, "the new box has the focus");
});
