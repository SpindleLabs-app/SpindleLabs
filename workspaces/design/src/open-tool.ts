// An export pressed while a tool is still open (issue #639): Export STL, Slice
// for printing and its print preview save the design as it is recorded, so a
// Move typed into place but not yet OK'd, an Extrude's preview, an edit or a
// Combine not yet pressed OK, or a sketch still being drawn, would be saved
// as it was before, while the view shows it changed. Rather than save what
// the screen does not show (or an unconfirmed preview), every export route
// refuses in plain words naming the tool and how to finish it. Measure only
// reads the bodies, so it is not among them.

import { MOVE_VERBS } from "./move.ts";
import type { MoveKind } from "@fission/core";

/** The tools open now that change what the bodies will be (read off the workspace's panels). */
export interface ToolsOpen {
  /**
   * The Move panel (Move, Rotate or Scale): its kind, the timeline item it edits (null for a new one), and whether its
   * boxes move, turn and scale nothing (`still`): a new Move that still moves nothing (as Insert opens one) shows the
   * bodies where the design has them, so it holds no export up.
   */
  move: { kind: MoveKind; editing: string | null; still: boolean } | null;
  /** Extrude's panel. */
  extrude: boolean;
  /** Edit feature's panel: the item it edits. */
  edit: string | null;
  /** Combine's panel: the item it edits (null for a new one). */
  combine: { editing: string | null } | null;
  /** A sketch: picking its plane, or being drawn (the sketch's id when known). */
  sketch: { kind: "pick" } | { kind: "edit"; id: string | null } | null;
}

/** The open tool (which panel, to say the words in), its name as its panel shows it, and what finishes it. */
export interface OpenTool {
  tool: "move" | "extrude" | "edit" | "combine" | "pick" | "sketch";
  name: string;
  finish: string;
}

const OK_OR_CANCEL = "press OK or Cancel";

/** The tool to finish before an export, or null when none is open; `name` gives a timeline item's name from its id. */
export function openTool(open: ToolsOpen, name: (id: string) => string): OpenTool | null {
  if (open.move && !(open.move.editing === null && open.move.still)) return { tool: "move", name: open.move.editing === null ? MOVE_VERBS[open.move.kind] : name(open.move.editing), finish: OK_OR_CANCEL };
  if (open.extrude) return { tool: "extrude", name: "Extrude", finish: OK_OR_CANCEL };
  if (open.edit !== null) return { tool: "edit", name: `Edit ${name(open.edit)}`, finish: OK_OR_CANCEL };
  if (open.combine) return { tool: "combine", name: open.combine.editing === null ? "Combine" : `Edit ${name(open.combine.editing)}`, finish: OK_OR_CANCEL };
  if (open.sketch?.kind === "pick") return { tool: "pick", name: "Sketch", finish: "pick its plane or press Cancel" };
  if (open.sketch?.kind === "edit") return { tool: "sketch", name: open.sketch.id === null ? "The sketch" : name(open.sketch.id), finish: "press Finish sketch" };
  return null;
}

/** What `verb` (Export STL, Slice for printing) says while `tool` is open, or null to go ahead. */
export function openToolRefusal(tool: OpenTool | null, verb: string): string | null {
  if (tool === null) return null;
  return `${tool.name} is still open: ${tool.finish} first, then ${verb}. ${verb} saves the design as it is recorded, not what an open tool shows.`;
}

/** What `verb` says when the design is not built as it is now (a rebuild failed to end, or the design was replaced meanwhile): nothing is saved (SL #675 item 1). */
export function stillRebuilding(verb: string): string {
  return `The design has not finished rebuilding, so nothing was saved: try ${verb} again in a moment.`;
}
