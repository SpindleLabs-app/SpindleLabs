// The tools still to come, shown greyed in the toolbar's menus so people
// can see what is on the way (Ben, 2026-10-26: "placeholders that say eg.
// 'Fillet' but are greyed out so you know they aren't released yet").
// Each is a menu item that is off, with its expected window ("Mid 2027") at its right and its
// tooltip saying what it will do; choosing it does nothing. Never a tool
// that pretends to work. When a tool lands, its line here goes and a real
// item takes its place: test/coming-soon.test.ts fails once its step is
// ticked in docs/roadmap.md (or docs/progress/cad.md for 35e2 and
// 35f) while its line is still here. Construct ▾ holds only these for now;
// Modify ▾ has Move (35e2b) before them. Styles: src/styles/coming-soon.css.

import type { MenuItem } from "@fission/ui";

/** The toolbar group a coming tool sits in, as Fusion groups them. */
export type ComingGroup = "Create" | "Modify" | "Construct" | "Inspect";

export interface ComingTool {
  /** Its menu item's id is `coming-<id>` (read by the tests). */
  id: string;
  label: string;
  group: ComingGroup;
  /** The roadmap step that brings it (docs/roadmap.md, or docs/progress/cad.md for 35e2 and 35f). */
  step: string;
  /** What it will do, in plain words, for the tooltip. */
  does: string;
  /** Roughly when, leaning late, following the roadmap order: curved booleans (early 2027), fillets and chamfers, then the other features ("mid 2027", "late 2027"). */
  eta: string;
}

/** Every tool shown as coming soon, in each group's menu order. */
export const COMING_SOON: readonly ComingTool[] = [
  { id: "revolve", label: "Revolve", group: "Create", step: "56", does: "spin a closed sketch round an axis to make a solid", eta: "late 2027" },
  { id: "hole", label: "Hole", group: "Create", step: "54", does: "drill a hole of a set size and depth into a face", eta: "late 2027" },
  { id: "pattern", label: "Pattern", group: "Create", step: "61", does: "repeat a body or feature in rows or round a circle", eta: "late 2027" },
  { id: "sweep", label: "Sweep", group: "Create", step: "70", does: "move a sketch along a path to make a solid", eta: "2028" },
  { id: "loft", label: "Loft", group: "Create", step: "71", does: "blend between two or more sketches to make a solid", eta: "2028" },
  { id: "combine", label: "Combine", group: "Modify", step: "35f", does: "join two bodies into one, cut one from another, or keep only where they overlap", eta: "early 2027" },
  { id: "chamfer", label: "Chamfer", group: "Modify", step: "44", does: "cut a sloped face along the edges you pick", eta: "early 2027" },
  { id: "fillet", label: "Fillet", group: "Modify", step: "45", does: "round the edges you pick", eta: "mid 2027" },
  { id: "shell", label: "Shell", group: "Modify", step: "62", does: "hollow a body out, leaving walls of a set thickness", eta: "late 2027" },
  { id: "draft", label: "Draft", group: "Modify", step: "63", does: "slope faces slightly so a moulded part comes out of its mould", eta: "2028" },
  { id: "plane", label: "Construction plane", group: "Construct", step: "59", does: "make a plane to sketch on: offset from a face, at an angle, or midway between two", eta: "late 2027" },
  { id: "axis", label: "Construction axis", group: "Construct", step: "59", does: "make an axis to revolve round or mirror across", eta: "late 2027" },
  { id: "point", label: "Construction point", group: "Construct", step: "59", does: "make a point to measure from or build on", eta: "late 2027" },
  { id: "section", label: "Section view", group: "Inspect", step: "65", does: "cut the view open to see inside the part", eta: "late 2027" },
];

/** What a coming tool's greyed item says at its right: its expected window, capitalised. */
export const comingNote = (t: ComingTool) => t.eta.charAt(0).toUpperCase() + t.eta.slice(1);

/** The greyed menu items of `group`'s coming tools: off, saying what each will do, choosing one does nothing. */
export function comingItems(group: ComingGroup): MenuItem[] {
  return COMING_SOON.filter((t) => t.group === group).map((t) => ({
    id: `coming-${t.id}`,
    label: t.label,
    note: comingNote(t),
    off: `${t.label} is expected ${t.eta}: it will ${t.does}.`,
    data: { step: t.step },
    run: () => {},
  }));
}
