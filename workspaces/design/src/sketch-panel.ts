// The sketch tool's panel (step 21c), at the top of the properties: the
// "Pick a plane" prompt of Create sketch, then while a sketch is edited its
// name, how to draw with the tool in use (the tools themselves are on the sketch's toolbar since SF3b, sketch-toolbar.ts), the typeable grid size and Snap to grid (SF1, off by default), Look at (SF2), whether the lines close,
// Finish sketch and Extrude (step 21d). The workspace drives it; the panel
// only shows what it is given and reports clicks. Styles: src/styles/sketch.css.

import { ORIGIN_PLANES, type ToolKind } from "./sketch-tool.ts";
import type { SketchPlane } from "./document.ts";

export interface SketchPanelEvents {
  pickPlane(id: SketchPlane): void;
  cancel(): void;
  grid(typed: string): void;
  /** Snap to grid ticked (true) or unticked. */
  gridSnap(on: boolean): void;
  finish(): void;
  /** Extrude this sketch (step 21d): finishes it and opens the Extrude panel. */
  extrude(): void;
  /** Look At: the camera square onto the sketch again (SF2). */
  lookAt(): void;
}

/** Where clicks land, under every tool's help (sketch feel SF1). */
export const SNAP_HELP = "Points go where you click, and snap to nearby ends, midpoints, centres and body edges, or line up with them, and to the origin and along the red and green axes. Hold Ctrl (Cmd on a Mac) to place a point without snapping, or turn Snap off in the toolbar.";

/** How to draw with each tool, under the tool buttons. */
export const TOOL_HELP: Record<ToolKind, string> = {
  line: "Click to place points: each click draws a line from the last one. Click the first point to close the shape. Escape ends the line.",
  rectangle: "Click one corner, then the opposite corner: four lines. Escape drops the first corner.",
  circle: "Click the centre, then a point on the circle. Escape drops the centre.",
  arc: "Click the start, then the end, then a point the arc passes through. For the end you can type its length and angle from the start. Escape drops the ends.",
  centre: "Click the centre, then the start, then where the arc ends: it goes round the way you move the pointer, past half a turn if you go that far. You can type the radius and angle for the start, and how far round the arc goes for the end. Escape drops the centre and start.",
  tangent: "Click the end of a line or arc, then where the arc ends: it leaves the line smoothly, and the next click carries on from its end. You can type the end's length and angle from the start. Escape ends it.",
  select: "Click a line, circle or arc to select it; Shift+click adds or takes one out, a click on empty space clears. Delete or Backspace (or the Delete button) removes what is selected; points only it used go with it. X (or the Construction button) makes it a construction line, drawn dashed and left out of the outline, or turns it back. Pick a tool to draw again.",
  horizontal: "Click a line to make it level (its start stays, its end moves), or two points to put the second level with the first. A constraint that fights the others, or already holds, is refused.",
  vertical: "Click a line to make it upright (its start stays, its end moves), or two points to put the second straight above or below the first. A constraint that fights the others, or already holds, is refused.",
  coincident: "Click a point to keep still, then the point to move onto it: they stay together from then on.",
  fix: "Click a point to fix it where it is: no other constraint can move it.",
  dimension: "Click a line to set its length, an arc for its radius, a circle for its diameter, or two points for the distance between them, then type the size and press Enter. Double-click a size to change it. A size that fights the others, or already holds, is refused.",
  "centre-rectangle": "Click the centre, then a corner: four lines, kept level and upright, with its diagonals as construction lines. You can type its width and height. Escape drops the centre.",
  "three-rectangle": "Click two corners for its first side, then a third point for how high it is: a rectangle at any angle. You can type the first side's length and angle, then the height. One drawn level stays level and upright; a tilted one holds its corners square only until you drag or size it (that waits for the Perpendicular constraint). Escape drops the corners.",
  "three-circle": "Click three points the circle passes through. Escape drops the points.",
  polygon: "Click the centre, then a corner: the corners lie on a circle round the centre. Type the number of sides (6 to start), the diameter across the corners and the angle. Its sides are equal as drawn; dragging or sizing one side can change the others until the Equal constraint comes. Escape drops the centre.",
  "outside-polygon": "Click the centre, then the middle of a side: the sides touch a circle round the centre, so the diameter is the size across the flats (a nut's spanner size). Type the number of sides (6 to start), the diameter and the angle. Its sides are equal as drawn; dragging or sizing one side can change the others until the Equal constraint comes. Escape drops the centre.",
  slot: "Click the centre of one end, then the other's, then a point on its side for its width: two straight sides and two round ends, with its centre line as a construction line. You can type the centres' distance and angle, then the width. A level or upright slot stays a slot when you size or drag it; a tilted one waits for the Tangent constraint. Escape drops the clicks.",
  "overall-slot": "Click one end of the slot, then the other, then a point on its side for its width: the round ends reach the two points you clicked. You can type the overall length and angle, then the width. A level or upright slot stays a slot when you size or drag it; a tilted one waits for the Tangent constraint. Escape drops the clicks.",
  point: "Click to place a point on its own: a hole's centre to measure and size from, or a place to snap to. Select picks it to delete it.",
  project: "Click an edge of a body before this sketch to bring it in, or a face to bring in all its edges. Projected edges follow the body when it changes; they can be snapped to and extruded, but not moved.",
};

export interface SketchPanel {
  /** The prompt: the offered planes as buttons too (the view's planes are the same choice), and Cancel. */
  showPick(): void;
  /** The sketch being edited, its grid as typed, whether points snap to it, the tool in use. */
  showEditing(name: string, grid: string, gridSnap: boolean, tool: ToolKind): void;
  /** The tool in use: its help shown. */
  showTool(kind: ToolKind): void;
  /** What the sketch holds and whether it makes a closed outline, or why not. */
  showStatus(text: string): void;
  /** A message under the panel's buttons (so it never moves them mid-click): a grid the kernel refused, or a point it could not place; while a plane is picked, why a face can't be sketched on. Empty hides it. */
  showError(message: string): void;
  /** Puts `grid` (as typed) back in the grid box: the last size taken, after a refused one. */
  showGrid(grid: string): void;
  hide(): void;
}

export function sketchPanel(slot: HTMLElement, on: SketchPanelEvents): SketchPanel {
  const document = slot.ownerDocument;
  const box = document.createElement("section");
  box.className = "sketch";
  box.id = "sketch-panel"; // read by the e2e test
  box.setAttribute("aria-label", "Sketch");
  box.hidden = true;
  slot.prepend(box);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: { id?: string; className?: string; textContent?: string } = {}): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (props.id) e.id = props.id;
    if (props.className) e.className = props.className;
    if (props.textContent) e.textContent = props.textContent;
    return e;
  };
  const button = (text: string, id: string, click: () => void, extra = "") => {
    const b = el("button", { textContent: text, id });
    b.type = "button";
    if (extra) b.className = extra;
    b.addEventListener("click", click);
    return b;
  };
  let status: HTMLElement | null = null;
  let gridError: HTMLElement | null = null;
  let help: HTMLElement | null = null;
  let gridBox: HTMLInputElement | null = null;
  const showTool = (kind: ToolKind) => {
    if (help) help.textContent = TOOL_HELP[kind];
  };
  return {
    showPick() {
      const planes = el("div", { className: "sketch-planes" });
      planes.setAttribute("role", "group");
      planes.setAttribute("aria-label", "Planes");
      for (const p of ORIGIN_PLANES) planes.append(button(p.label, `sketch-plane-${p.id}`, () => on.pickPlane(p.id)));
      // Why a face picked in the view can't be sketched on (26d: a curved one, Q5).
      const refused = el("p", { id: "sketch-pick-error", className: "bad" });
      refused.hidden = true;
      refused.setAttribute("role", "alert");
      box.replaceChildren(
        el("h2", { textContent: "Create sketch" }),
        el("p", { className: "sketch-prompt", id: "sketch-prompt", textContent: "Pick a plane or a flat face of a body: click it in the view, or choose a plane here." }),
        planes,
        refused,
        button("Cancel", "sketch-cancel", () => on.cancel()),
      );
      status = help = gridBox = null;
      gridError = refused;
      box.hidden = false;
    },
    showTool,
    showEditing(name, grid, gridSnap, tool) {
      const input = el("input", { id: "sketch-grid" });
      Object.assign(input, { type: "number", step: "any", min: "0", value: grid });
      input.addEventListener("change", () => on.grid(input.value));
      gridBox = input;
      const label = el("label", { className: "sketch-grid" });
      label.append("Grid ", input, " mm");
      const snapBox = el("input", { id: "sketch-grid-snap" });
      Object.assign(snapBox, { type: "checkbox", checked: gridSnap });
      snapBox.addEventListener("change", () => on.gridSnap(snapBox.checked));
      const snapLabel = el("label", { className: "sketch-grid-snap" });
      snapLabel.append(snapBox, " Snap to grid");
      status = el("p", { id: "sketch-status", className: "sketch-status" });
      gridError = el("p", { id: "sketch-grid-error", className: "bad" });
      gridError.hidden = true;
      help = el("p", { className: "sketch-help", id: "sketch-help" });
      showTool(tool);
      box.replaceChildren(
        el("h2", { id: "sketch-name", textContent: name }),
        help,
        el("p", { className: "sketch-help", id: "sketch-snap-help", textContent: SNAP_HELP }),
        label,
        snapLabel,
        button("Look at", "sketch-look-at", () => on.lookAt(), "sketch-look-at"),
        status,
        el("div", { className: "sketch-buttons" }),
        // Under the buttons, not above them: a bad grid size is judged when the box loses focus, which is the press on
        // Extrude or Finish sketch, and a message appearing above them pushed the button down before the release, so the
        // click was lost (the Firefox bug pinned in e2e/sketch-tool.mjs since TC4; every engine when a letter was typed).
        gridError,
      );
      box.querySelector(".sketch-buttons")!.append(button("Finish sketch", "sketch-finish", () => on.finish(), "sketch-finish"), button("Extrude", "sketch-extrude", () => on.extrude(), "sketch-finish"));
      box.hidden = false;
    },
    showGrid(grid) {
      if (gridBox) gridBox.value = grid;
    },
    showStatus(text) {
      if (status) status.textContent = text;
    },
    showError(message) {
      if (!gridError) return;
      gridError.textContent = message;
      gridError.hidden = message === "";
    },
    hide() {
      // Emptied while still drawn, then hidden: a button under the pointer taken out of a panel already hidden leaves Chromium
      // holding the panel as hovered, and then in memory once a new design replaces it (e2e/closed-panels.mjs).
      box.replaceChildren();
      box.hidden = true;
      status = gridError = help = gridBox = null;
    },
  };
}
