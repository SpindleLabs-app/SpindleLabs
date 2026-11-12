// The Design workspace: the CAD, and the source of truth for all geometry.
// Until the sketcher (steps 21–33) it builds primitives and ready-made
// outlines; every other workspace will refer to its bodies, faces and edges.

import { summaryInUnit, wordsInUnit, latestOnly, NO_HIGHLIGHT, playback, ORIGIN_AT_FIRST, type AnalysisOverlay, type BodyHandle, type BodySpec, type MoveKind, type BodyView, type ExtrudeArrow, type OfferedProfile, type SketchPointer, type SketchXY, type Command, type Feature, type Framing, type Plane, type GeometryReference, type MountedWorkspace, type Selected, type SharedViewport, type WorkspaceContext, type WorkspaceId, type WorkspacePlugin, type HistoryStep, withWorkspaceDocument } from "@fission/core";
import { needsRefit, printView, snapDistance } from "@fission/viewport";
import type { ShapeKind } from "./profiles.ts";
import { bodyHidden, bodyIdOf, bodyItem, bodyNumbers, combineBodies, EYE_FOLDERS, isCombineItem, extrudeOperation, insertAt, isHidden, isMoveItem, isOperationExtrude, isPiece, isSketchExtrude, numberPieces, isSketchItem, ORIGIN_AXES, ORIGIN_PLANES as EYE_PLANES, builds, ownShape, originDrawn, partFeature, partOf, readDesignDocument, shapeOf, withPartAt, SKETCH_PLANES, type DesignDocument, type MoveParam, type PartKind } from "./document.ts";
import { alreadyPicked, arrowOf, DEFAULT_DISTANCE, distanceRefused, DISTANCE_STEP, extrudeSketch, NO_SKETCH, NO_USABLE_SKETCH, PICK_PROFILE_STATUS, extrudeStep, featureSpec, previewSpec, setExtrudeDistance, setExtrudeOperation, signedDistance, ZERO_OK } from "./extrude.ts";
import { extrudePanel } from "./extrude-panel.ts";
import { FACE_ALONE, joinedView, ONE_PROFILE_OPERATION, pickedWords, severalWords, togglePick, type PickedProfile } from "./extrude-picks.ts";
import { bodyChoices, operationNote, tickedBodies, type BodyChoice, type Bounds, type ExtrudeOperation, type ListedBody } from "./extrude-operation.ts";
import { CHANGED_WHILE_CHECKING, editableFeature, editFeature, editStep, readTyped, refusedSizes } from "./feature-edit.ts";
import { featureEditPanel } from "./feature-edit-panel.ts";
import { copiedText, copiesOf, DUPLICATE_STEP, insertDuplicates, MIRROR_STEP, pastedBodies } from "./duplicate.ts";
import { changedMove, factorOf, insertMove, MOVE_STEP, MOVE_VERBS, moveKindOf, movedBodies, moveValues, NO_MOVE, ROTATE_STEP, SCALE_STEP, type MoveBox, type MoveValues } from "./move.ts";
import { EXPLODE_DEFAULT, explodedMesh, readSpread } from "./explode.ts";
import { draggedValues, editedBodies, editedMoveMesh, handlesCentre, heldBefore, MOVE_BOX_WORDS, movedMesh, pickedBodies, previewable, readMoveBoxes, refusedMove, startPivot, boxCentre } from "./move-tool.ts";
import { movePanel } from "./move-panel.ts";
import { changedCombine, COMBINE_STEP, forgetPieces, insertCombine } from "./combine.ts";
import { combinePanel } from "./combine-panel.ts";
import { askWords, bodyNamer, checkedItem, cutAsk, type Checked } from "./cut-ask.ts";
import type { Miss } from "./misses.ts";
import { combineShown } from "./combine-flag.ts";
import { snapEnds, snappedValues, snapPart, type SnapPart } from "./move-snap.ts";
import { PART_VIEW, syncGraph } from "./graph.ts";
import { registerDesign } from "./representations.ts";
import { DESIGN_COMMANDS, documentFor, DRAW_OPS, DRAW_STEPS, drawingFor, drawRefused, EXTRUDE_OP, commandDistance, extrudeTarget, RENAME_OP, renameTarget } from "./commands.ts";
import { buildSpec } from "./spec.ts";
import { SHAPE_LABELS, toolbarGroups, type ToolButton } from "./toolbar.ts";
import { currentDesignDefaults, currentUnit, UNIT_EVENT, commandSearch, GCODE_KIND, iconSvg, PNG_KIND, saveFile, toolGroup, type Command as SearchCommand, type SaveKind, type IconName, type MenuButton, type MenuSection } from "@fission/ui";
import { comingItems, type ComingGroup } from "./coming-soon.ts";
import { INSERT_SIZES, INSERT_TITLE, inserted, insertSections, insertStep } from "./insert.ts";
import { startHint } from "./start-hint.ts";
import { SOLID_OVERLAY, solidBadge } from "./solid-badge.ts";
import { bodyRows, browserTree, eyeId, failedIds, rowItem, rowReferences, type BrowserNode } from "./browser.ts";
import { callOffDrag, editOff, showTimelineBar, timelineBarItems, type MenuEntry } from "./timeline-bar.ts";
import { DEFAULT_SIZES, followUnit, panelSizeRefused, parameterRows, propertiesPanel, revertedNote, SIZE_KEYS, type SizeKey } from "./properties.ts";
import { FOLDED_AT_START, panelShown, propertiesFold, readPinned, type FoldState, type PropertiesFold } from "./properties-fold.ts";
import { partFailure } from "./part-failure.ts";
import { freshDesign, START_FRESH_STEP, startFresh } from "./start-fresh.ts";
import { BUILD_AREA_ROW, BUILD_AREA_TITLE, buildArea, buildAreaShownIn, keepBuildAreaShown, P1S_AREA, type BuildArea, type FirstLayerExtras } from "@fission/print";
import { printFileOf, SLICE_PRINT_TITLE, sliceBodies, slicePrint } from "./slice-print.ts";
import { gcodeName, gcodeOfPackage, P1S_KIND, PREVIEW_EARLIER, printFileName, printLead, printMovesOf, printWords, SliceDropped, testPieceFile } from "@fission/print";
import { openPrintPreview } from "./print-preview.ts";
import { deleteAsk } from "./delete-ask.ts";
import { deleteKeyTarget } from "./delete-key.ts";
import { renameBox } from "./rename-box.ts";
import { hideRow, itemName, renameItem, TIMELINE_STEPS, usedSketchHidden } from "./timeline-edits.ts";
import { extrudeSketches, moreProfiles } from "./extrude-profiles.ts";
import { chooseBarAction, chooseEntry, menuEntries, openAction, renameEntry, type MenuHost } from "./timeline-menu.ts";
import { showEntries, viewMenuEntries, viewMenuTarget } from "./view-menu.ts";
import { showAllBodies, showOnlyBody } from "./show-only.ts";
import { applyChange, pickChange } from "./picking.ts";
import { DESIGN_SHORTCUTS, designShortcut, sketchToolKey, typedSizeKey } from "./shortcuts.ts";
import { sketchPlaceScene } from "./sketch-place.ts";
import { BodyCache, builtPieceFaces, followedDoc, keptUnsettled, placedOnBodies, rebuildTimeline, settleKept, SlowItems, tookTooLong, type TimelineBuild } from "./rebuild.ts";
import { droppedNote, followedNote, highlightOf, panelFocus, panelPart, selectionRows, survivors } from "./selection.ts";
import { measureView } from "./measure-view.ts";
import { bodyOf, joinBodies, sceneHit, shownBodies, type Scene, type ShownBody } from "./scene.ts";
import { bodyReference, readProfileReference } from "./references.ts";
import { addFaceSketch, addSketch, askOutline, outlineSourceOf, pinNewPoints, planeOf, projectEdges, setCircleFit, SKETCH_STEPS, sketchCurves, sketchItem, sketchPlane, sketchSide } from "./sketch.ts";
import { fitPicker } from "./fit-tag.ts";
import { dragTo, grabProblem } from "./point-drag.ts";
import { PROJECT_AGAIN, projectedOpen, projectPick, sketchEdgeCurves } from "./projection.ts";
import { sketchEdgeTargets, sketchPlaneCorners } from "./face-edges.ts";
import { sketchableFaces, sketchSpot, type SketchSpot } from "./face-pick.ts";
import { FACE_NEW_BODY, faceOpen, faceProfile, faceRegion, type FaceProfile } from "./face-extrude.ts";
import { editRegionWords, offerOf, pickRegionWords, regionChosenWords, regionOffers, regionRefusedWords, type RegionOffer } from "./extrude-regions.ts";
import type { RegionRef } from "./regions.ts";
import { rounding, SNAP_PIXELS, snapOnSketch, snapsNow, withSnap, type BodySnaps, type Snap } from "./snap.ts";
import { aimOf, anchorOf, lengthRefused, liveValues, NO_AIM, typedFields, withLocks, type Locks } from "./typed-entry.ts";
import { typedBoxes } from "./typed-boxes.ts";
import { hintOf, pointerHint } from "./pointer-hint.ts";
import { clickAt, CONSTRAINT_MARK_PIXELS, curveCount, hoverTool, DEFAULT_GRID_SNAP, drawStep, GRID_ATE_RADIUS, NO_RADIUS, ORIGIN_PLANES, originPlanes, sketchDrawings, startTool, switchTool, toolBusy, unfinishedWords, type SketchTool, type ToolKind } from "./sketch-tool.ts";
import { sketchPanel } from "./sketch-panel.ts";
import { sketchToolbar } from "./sketch-toolbar.ts";
import { PICK_PIXELS, deleteCurves, deleteStep, pickCurve, selectStatus, stillPicked } from "./sketch-select.ts";
import { changeDimensionTool, clickConstraint, constraintPickAt, constraintStep, dimensionLine, isConstraintTool, selectAt } from "./constraint-tool.ts";
import { addConstraint, changeDimension, type NewConstraint } from "./constraints.ts";
import { toggleConstruction } from "./construction.ts";
import type { Sketch, SketchPlane } from "./document.ts";
import { rememberedBetterGrip, rememberedWarmUp, type Fit, type PrintFacts } from "@fission/print";
import { aiFaces, designAIView } from "./ai-view.ts";
import { refusalOverlay, REFUSAL_OVERLAY } from "./refusal-overlay.ts";
import { ALL_PRINT_CHECK_IDS, checkShown, keepPrintCheckShown, printCheckShownIn, printCheckSummary, printRulesIn } from "./print-check-view.ts";
import { COPY_SVG, DOWNLOAD_STL, hiddenStlNote, NO_BODY_STL, noBodyWords, registerDesignActions, shownBodyFeature, shownBodyRefs, STL_OVERLAY, targetsOf, type DesignRun } from "./actions.ts";

/**
 * What the user last entered (as typed), kept while other workspaces are
 * shown, with the document it made: when the project holds a different
 * document (a file was opened), the panel shows that one instead.
 */
let saved: { doc: DesignDocument; shape: PartKind; sizes: string[]; part: string | null } | null = null;
let framed: Framing | null = null;
let framedKind: PartKind | null = null;
/**
 * Design was put away by an Undo or Redo made in another workspace: the
 * project that restore put back, so the next mount on it is the restore's.
 * On any other project (a file opened or a new project since: undo hunt
 * 11-01, which then opened in the old sketch's id, unframed) it is not.
 */
let putAwayByRestore: object | null = null;
/**
 * Rebuilds asked for and not answered yet, per view element: its `data-rebuilding` says whether any is, so a test reads
 * the page only once it shows the last edit (the monkey). Counted across mounts: every Undo remounts Design on the same
 * view, and a rebuild of the Design put away that ends first must not say "done" while the new one's still runs
 * (real-use hunt C2, 2026-10-28).
 */
const rebuildsOn = new WeakMap<HTMLElement, number>();
/**
 * The sketch being edited and its grid, kept across mounts: Undo and Redo
 * re-mount Design, and you stay in the sketch (the chain in progress ends,
 * since the point it ran from may be gone). Cleared by Finish sketch.
 */
let editingSketch: { id: string; grid: number; typed: string; tool: ToolKind } | null = null;
/** Grid snap on or off (sketch feel SF1; off by default: points go where you click), kept for every sketch until the page reloads. */
let gridSnap = DEFAULT_GRID_SNAP;
/** The Settings default for Snap to grid last taken (U2b): a new sketch takes a changed default, else keeps the toggle as left. */
let snapDefaultTaken = DEFAULT_GRID_SNAP;
/** Each sketch's grid size as typed and taken, kept until the page reloads like Snap to grid: Edit Sketch opens it on the grid it was left on (typed-sizes hunt 2026-11-01). */
const sketchGrids = new Map<string, { grid: number; typed: string }>();
/** How long (ms) Ctrl or Cmd is held with no other key before the snap under a still pointer goes: long enough for a shortcut's second key. */
const HELD_SHOW_MS = 150;
/** The Snap button on the sketch's toolbar: snapping to points, edges and line-ups on (the default) or off, kept for every sketch until the page reloads. */
let snapOn = true;
/** The properties' fold a new mount starts with (U0b): the user's pin, kept across Undo, Redo and switching; null until the first mount reads it from storage. */
let foldKept: FoldState | null = null;
/** How many times Design has framed the part, read by the e2e test (an undo must not add one). */
let fits = 0;

/**
 * The `detail` of the "properties-reveal" event Body facts sends: the shell (apps/fission main.ts) sets `phone` at phone
 * width, where the panel is a sheet, and `opened` when it opened that sheet for it, so a second press can shut only that.
 */
export interface FactsReveal {
  opened: boolean;
  phone: boolean;
}

/** What Inspect ▾ does (U0f): show the body facts (pressed again, put them away), and why there are none yet (null once a body is built). */
interface Inspecting {
  facts(): void;
  none(): string | null;
  /** Turns the print check (H1) on or off. */
  printCheck(): void;
  /** Opens Measure (35e2l2), or closes it when open. */
  measure(): void;
  /** Exploded view (explode.ts): turns it on or off. */
  explode(): void;
  /** Whether the view is exploded now. */
  exploded(): boolean;
  /** Why Exploded view is off (fewer than two bodies shown), else null. */
  noExplode(): string | null;
}

/** Duplicate, Mirror body and Scale in Modify ▾ (step 35e2): what they do, and why Duplicate and Mirror are off. */
interface Duplicating {
  run(): void;
  /** Why it can't be chosen now (nothing picked), or null: Mirror body's too. */
  off(): string | null;
  /** Mirror body: a mirrored copy of each picked body across origin plane `plane`. */
  mirror(plane: SketchPlane): void;
  /** Scale: opens the Move panel as Scale. */
  scale(): void;
}

const SCALE_TITLE = "Scale: make bodies bigger or smaller by a factor you type (2 doubles every size), about a pivot. Pick the bodies, then OK. A Scale in the timeline, at the marker.";
const mirrorTitle = (plane: SketchPlane) => `Mirror body: a mirror image of the picked bodies across the ${plane} plane, as new bodies. A Mirror in the timeline, at the marker.`;

const DUPLICATE_TITLE = "Duplicate: copy the picked bodies where they are, then move the copies. A copy follows its body's sizes. A Duplicate in the timeline, at the marker.";

/** Exploded view's tooltip. */
const EXPLODE_TITLE = "Exploded view: draw the bodies pulled apart from the middle, to see how they fit. Only the view changes: the design stays as it is.";
/** Why Exploded view is off with fewer than two bodies shown. */
const NO_EXPLODE = "Exploded view pulls bodies apart: it needs two bodies or more on screen.";
/** Exploded view's spread (explode.ts) while on, null while off; kept until the page reloads, across Undo and switching like Snap to grid. */
let explodeSpread: number | null = null;

/** Why Body facts is off with nothing built. */
const NO_FACTS = "Nothing built yet: insert a preset or extrude a sketch, and its volume, area and faces show here.";

/**
 * Fills the toolbar slot the way Fusion lays it out (U0f): groups of icons,
 * each over its name. Create ▾ (Create sketch, Extrude), Modify ▾ (Move,
 * 35e2b), Insert ▾ (the presets, U0d), Inspect ▾ (Body facts), then the
 * command groups. Returns
 * each command button with its element, the Insert menu and the Body facts
 * button.
 */
function toolbar(slot: HTMLElement, onClick: (b: ToolButton) => void, onSketch: () => void, onExtrude: () => void, onMove: () => void, onRotate: () => void, onCombine: () => void, onInsert: (kind: ShapeKind) => void, inspect: Inspecting, duplicate: Duplicating): { made: [ToolButton, HTMLButtonElement][]; insert: MenuButton; facts: HTMLButtonElement; printCheck: HTMLButtonElement; explode: HTMLButtonElement; measure: HTMLButtonElement; commands: () => SearchCommand[] } {
  const made: [ToolButton, HTMLButtonElement][] = [];
  const document = slot.ownerDocument; // the slot's own page, not a global one
  const button = (id: string, words: string, title: string, run: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.id = id;
    b.textContent = words;
    b.title = title;
    b.addEventListener("click", run);
    return b;
  };
  // The sketch tool is the user's, not a command yet: whether the AI gets
  // create_sketch and draw_line is the AI workstream's call (docs/ai.md).
  const sketchTitle = "Create sketch: draw lines, rectangles, circles and arcs on a plane. Pick the plane, then click.";
  const extrudeTitle = "Extrude: make a solid from a closed sketch or a flat face, by a distance you drag or type. A new body in the timeline, at the marker.";
  const create = button("create-sketch", "Create sketch", sketchTitle, onSketch);
  create.dataset.modelling = ""; // hidden while a sketch is edited (SF3b): the sketch's toolbar stands in
  const extrude = button("extrude", "Extrude", extrudeTitle, onExtrude);
  const createSections = (): MenuSection[] => [
    {
      items: [
        { id: "create-menu-sketch", label: "Create sketch", icon: "sketch", title: sketchTitle, run: onSketch },
        { id: "create-menu-extrude", label: "Extrude", icon: "extrude", key: "E", title: extrudeTitle, run: onExtrude },
      ],
    },
    { items: comingItems("Create") },
  ];
  const creating = toolGroup(document, { name: "Create", menu: { id: "create-menu", title: "Every way to make a solid, by name", sections: createSections } });
  creating.add([create, "sketch"], [extrude, "extrude"]);
  // While a sketch is edited its own Create ▾ stands in, and Extrude (kept, SF3b) sits over the plain name Solid.
  creating.menu!.element.dataset.modelling = "";
  const solid = document.createElement("span");
  solid.textContent = "Solid";
  solid.dataset.sketching = "";
  solid.hidden = true;
  creating.menu!.element.after(solid);
  // The presets, hidden in a menu until wanted, each a new body (insert.ts).
  const inserting = toolGroup(document, { name: "Insert", solo: "insert", menu: { id: "insert", title: INSERT_TITLE, sections: () => insertSections(onInsert) } });
  inserting.element.dataset.modelling = "";
  // The body facts (volume, area, faces), from the properties panel, folded since U0b.
  const facts = button("inspect-facts", "Body facts", "Body facts: the volume, area and faces of what is built, in the properties.", () => inspect.facts());
  facts.disabled = true; // until a body is built (workspace: after each build)
  facts.setAttribute("aria-pressed", "false"); // lit while its press shows the numbers; pressed again puts them away
  // The print check (H1, Ben 2026-11-05): a switch, lit while on (print-check-view.ts).
  const printCheckTitle = "Print check: colours what would go wrong printing it as modelled on the P1S. Red needs supports, amber is too thin, violet is a bridge that may sag, and a red ring marks the weakest spot. Updates as you model.";
  const printCheck = button("inspect-print-check", "Print check", printCheckTitle, () => inspect.printCheck());
  printCheck.setAttribute("aria-pressed", "false");
  // Measure (35e2l2, measure-view.ts): pick two things, read the distance and angle between them; lit while open.
  const measureTitle = "Measure: click a face, edge, corner or body for its size, then another for the distance and angle between them, from the exact model.";
  const measure = button("inspect-measure", "Measure", measureTitle, () => inspect.measure());
  measure.setAttribute("aria-pressed", "false");
  // Exploded view (explode.ts): the bodies drawn pulled apart, view only; pressed while on.
  const explode = button("inspect-explode", "Exploded view", EXPLODE_TITLE, () => inspect.explode());
  explode.setAttribute("aria-pressed", "false");
  explode.disabled = true; // until two bodies are shown (workspace: after each build)
  const inspectSections = (): MenuSection[] => [
    {
      items: [
        { id: "inspect-menu-facts", label: facts.getAttribute("aria-pressed") === "true" ? "Body facts: on" : "Body facts", icon: "inspect", title: facts.title, off: inspect.none() ?? undefined, run: () => inspect.facts() },
        { id: "inspect-menu-print-check", label: printCheck.getAttribute("aria-pressed") === "true" ? "Print check: on" : "Print check", icon: "print-check", title: printCheckTitle, run: () => inspect.printCheck() },
        { id: "inspect-menu-measure", label: "Measure", icon: "measure", title: measureTitle, run: () => inspect.measure() },
        { id: "inspect-menu-explode", label: inspect.exploded() ? "Exploded view: off" : "Exploded view", icon: "explode", title: EXPLODE_TITLE, off: (inspect.exploded() ? null : inspect.noExplode()) ?? undefined, run: () => inspect.explode() },
      ],
    },
    { items: comingItems("Inspect") },
  ];
  const inspecting = toolGroup(document, { name: "Inspect", menu: { id: "inspect-menu", title: "Every way to look into the part, by name", sections: inspectSections } });
  inspecting.add([facts, "inspect"], [printCheck, "print-check"], [measure, "measure"], [explode, "explode"]);
  inspecting.element.dataset.modelling = "";
  // Groups whose tools are all still to come (coming-soon.ts), greyed: their menus list what is on the way.
  const coming = (name: string, id: string, icon: IconName, title: string) => {
    const g = toolGroup(document, { name, solo: icon, menu: { id, title, sections: () => [{ items: comingItems(name as ComingGroup) }] } });
    g.element.classList.add("coming-soon");
    g.element.dataset.modelling = "";
    return g;
  };
  // Modify ▾ (35e2b): Move and (Ben, 2026-10-29) Rotate, each its own tool, then the tools still to come.
  const moveTitle = "Move: slide bodies along X, Y and Z by distances you drag or type. Pick the bodies, then OK. A Move in the timeline, at the marker.";
  const move = button("move", "Move", moveTitle, onMove);
  const rotateTitle = "Rotate: turn bodies about X, Y and Z by angles you drag or type. Pick the bodies, then OK. A Rotate in the timeline, at the marker.";
  const rotate = button("rotate", "Rotate", rotateTitle, onRotate);
  // Combine (35f1c): in Modify ▾, and (Ben, 2026-11-04) its own button beside Move and Rotate, only with ?combine
  // (combine-flag.ts) until it goes public (35f5); else greyed as coming soon in the menu, with no button.
  const combineTitle = "Combine: join bodies into one, cut tools from a body, or keep only where they overlap. Pick the target body, then the tools, then OK. A Combine in the timeline, at the marker.";
  const combining = combineShown();
  const combine = button("combine", "Combine", combineTitle, onCombine);
  const modifySections = (): MenuSection[] => [
    {
      items: [
        { id: "modify-menu-move", label: "Move", icon: "move", key: "M", title: moveTitle, run: onMove },
        { id: "modify-menu-rotate", label: "Rotate", icon: "rotate", key: "Shift+R", title: rotateTitle, run: onRotate },
        { id: "modify-menu-scale", label: "Scale", icon: "scale", title: SCALE_TITLE, run: duplicate.scale },
        { id: "modify-menu-duplicate", label: "Duplicate", icon: "duplicate", title: DUPLICATE_TITLE, off: duplicate.off() ?? undefined, run: duplicate.run },
        ...(combining ? [{ id: "modify-menu-combine", label: "Combine", icon: "combine" as const, title: combineTitle, run: onCombine }] : []),
      ],
    },
    // Mirror body (step 35e2): across an origin plane for now; a face of the body as the plane comes with construction planes.
    { heading: "Mirror body", items: SKETCH_PLANES.map((plane) => ({ id: `modify-menu-mirror-${plane.toLowerCase()}`, label: `Across ${plane}`, icon: "mirror" as const, title: mirrorTitle(plane), off: duplicate.off()?.replace("Duplicate", "Mirror") ?? undefined, run: () => duplicate.mirror(plane) })) },
    { items: comingItems("Modify").filter((i) => !combining || i.id !== "coming-combine") },
  ];
  const modifying = toolGroup(document, { name: "Modify", menu: { id: "modify-menu", title: "Every way to change bodies, by name", sections: modifySections } });
  modifying.add([move, "move"], [rotate, "rotate"], ...(combining ? [[combine, "combine"] as [HTMLButtonElement, IconName]] : []));
  modifying.element.dataset.modelling = "";
  const constructing = coming("Construct", "construct-menu", "plane", "Construct: planes, axes and points to build on. Coming soon: open to see what is on the way.");
  // Fusion's order: Create, Modify, Construct, Inspect, Insert, then the exports.
  slot.append(creating.element, modifying.element, constructing.element, inspecting.element, inserting.element);
  /** The toolbar's own buttons as the command search names them: the group's name, then the button's ("Export STL"). */
  const named: [string, HTMLButtonElement][] = [];
  for (const group of toolbarGroups()) {
    const g = toolGroup(document, { name: group.name });
    g.element.dataset.modelling = "";
    for (const b of group.buttons) {
      const el = button(`tool-${b.command.op}`, b.label, `${b.label}: ${b.title}`, () => onClick(b));
      el.dataset.op = b.command.op; // read by the e2e test
      if (typeof b.command.shape === "string") el.dataset.shape = b.command.shape;
      g.add([el, b.icon]);
      made.push([b, el]);
      named.push([`${group.name} ${b.label}`, el]);
    }
    slot.append(g.element);
  }
  // The command search box (S, Ben's keys 10-29): every menu's items as they are now, in the toolbar's order, then the
  // toolbar's own buttons (Export STL…), each off with its reason exactly when its menu item or button is.
  const commands = (): SearchCommand[] => {
    const items = [createSections(), modifySections(), [{ items: comingItems("Construct") }], inspectSections(), insertSections(onInsert)].flatMap((ss) => ss.flatMap((sec) => sec.items));
    return [
      ...items.map((i) => ({ id: i.id, label: i.label, key: i.key, off: i.off, run: i.run })),
      ...named.map(([label, el]) => ({ id: el.id, label, off: el.disabled ? `${label} is off now` : undefined, run: () => el.click() })),
    ];
  };
  return { made, insert: inserting.menu!, facts, printCheck, explode, measure, commands };
}

/** A browser row's icon (U0f3): 16 px, before its words, hidden from screen readers. */
const rowIcon = (document: Document, name: IconName) => {
  const icon = iconSvg(document, name, 16);
  icon.classList.add("browser-row-icon");
  return icon;
};

/** Whether two sets of ids hold the same ids. */
const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

/** Browser groups the user folded (false) or opened (true), kept across rebuilds and workspace switches; any other group starts as its node says (`startsFolded`). */
const folding = new Map<string, boolean>();
const isOpen = (n: { id: string; startsFolded?: boolean }) => folding.get(n.id) ?? !n.startsFolded;

/** Lights the browser rows whose geometry is selected (aria-current), and only those; `failed`, the last rebuild's failed ids, select nothing. */
/**
 * A Timeline row's Retry (35d4): shown, after its words, while its item
 * took the kernel too long; its title says so. A click tries it again.
 */
function retryOn(row: HTMLElement, slow: boolean, retry: (id: string) => void) {
  const line = row.parentElement;
  const id = row.dataset.node!;
  const had = line?.querySelector<HTMLButtonElement>(":scope > .retry-row");
  if (!slow) {
    had?.remove();
    if (row.title.startsWith("Took too long: ")) row.title = row.dataset.tip ?? "";
    return;
  }
  row.title = `Took too long: ${row.dataset.label ?? id} was stopped, so it has no body. Retry tries it again.`;
  if (had || !line) return;
  const button = row.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "retry-row";
  button.dataset.retry = id; // read by the e2e test
  button.textContent = "Retry";
  button.title = `Try ${row.dataset.label ?? id} again`;
  button.addEventListener("click", () => retry(id));
  row.after(button);
}

function lightRows(slot: HTMLElement, doc: DesignDocument, failed: ReadonlySet<string>, items: readonly GeometryReference[]) {
  const refOf = rowReferences(doc, failed);
  for (const row of slot.querySelectorAll<HTMLElement>(".tree-row")) {
    const ref = refOf(row.dataset.node!);
    if (ref && items.some((i) => i.kind === ref.kind && i.id === ref.id)) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
  }
}

/**
 * Fills the browser slot with the document's tree: groups fold (native
 * details/summary). A row for selectable geometry (Body 1, a profile) is a button
 * that selects it (Shift adds or takes out); the others are plain rows
 * until features (step 24) and origin planes (step 21) can be selected.
 * A sketch's row in the Sketches group opens its menu (Delete, 24e4) on a
 * right-click, or from its ⋯ button for touch and the keyboard; a
 * double-click on it or a Timeline row opens the item (`onOpen`, 25a3).
 * The items the last rebuild failed (`failed`) have no Body row and their
 * Timeline rows select nothing. Rebuilt on every edit and after every
 * rebuild that changes `failed`; folding is kept by id.
 */
function browser(slot: HTMLElement, doc: DesignDocument, failed: ReadonlySet<string>, onSelect: (ref: GeometryReference, shift: boolean) => void, onMenu: (node: string, at: { x: number; y: number }) => void, onOpen: (node: string) => void, onEye: (node: string) => void, buildAreaShown = false) {
  // Rows with the timeline's item menu (24f3): every Timeline row by its item's id, and each sketch's row in Sketches.
  const items = new Set(doc.timeline.features.map((f) => f.id));
  const refOf = rowReferences(doc, failed);
  const document = slot.ownerDocument;
  // The toggle event fires a task after the click, so a rebuild can come
  // first: read the folding from the tree being replaced, not only events.
  for (const d of slot.querySelectorAll<HTMLDetailsElement>("details[data-node]")) folding.set(d.dataset.node!, d.open);
  // A row's eye (U0f3, Fusion's; on every row that draws something since Ben's ask 2026-10-29): hides or shows it, one undo step; a hidden row is dimmed.
  const eyeOf = (n: BrowserNode): HTMLButtonElement | null => {
    if (n.hidden === undefined) return null;
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "browser-row-eye";
    eye.dataset.eye = n.id; // read by the e2e test
    const words = `${n.hidden ? "Show" : "Hide"} ${n.label}`;
    eye.setAttribute("aria-label", words);
    eye.setAttribute("aria-pressed", String(!n.hidden)); // pressed while it shows
    eye.title = words;
    eye.append(iconSvg(document, n.hidden ? "eye-off" : "eye", 16));
    eye.addEventListener("click", (e) => {
      e.preventDefault(); // in a folder's summary: the press is the eye's, not the fold's
      onEye(n.id);
    });
    return eye;
  };
  const list = (nodes: BrowserNode[]) => {
    const ul = document.createElement("ul");
    ul.className = "tree";
    for (const n of nodes) {
      const li = document.createElement("li");
      if (n.children) {
        const details = document.createElement("details");
        details.open = isOpen(n);
        details.dataset.node = n.id; // read by the e2e test
        details.addEventListener("toggle", () => {
          if (details.isConnected) folding.set(n.id, details.open);
        });
        const summary = document.createElement("summary");
        summary.textContent = n.label;
        summary.prepend(rowIcon(document, n.icon)); // U0f3: a folder before each group's name
        // A folder's eye (Ben, 2026-10-29): shut, nothing in it is drawn; its press doesn't fold the folder.
        const shut = eyeOf(n);
        if (shut) summary.prepend(shut);
        details.append(summary, list(n.children));
        li.append(details);
      } else {
        const ref = refOf(n.id);
        const row = document.createElement(ref ? "button" : "span");
        if (ref) row.setAttribute("type", "button");
        row.className = "tree-row";
        row.textContent = n.label;
        row.prepend(rowIcon(document, n.icon)); // U0f3: the item's icon before its words (its words stay its name)
        // One line per row (U0a): a label too long for it ends in "…", and the tooltip has it whole, or an item's description (U0e).
        row.title = n.title ?? n.label;
        row.dataset.label = n.label;
        row.dataset.tip = row.title;
        row.dataset.node = n.id;
        if (ref) row.addEventListener("click", (e) => onSelect(ref, (e as MouseEvent).shiftKey));
        if (items.has(n.id) || n.id.startsWith("sketches/") || n.id.startsWith("body-")) {
          row.addEventListener("dblclick", () => onOpen(n.id));
          // The row's menu: a right-click at the pointer, or the ⋯ button under itself.
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            onMenu(n.id, { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
          });
          const more = document.createElement("button");
          more.type = "button";
          more.className = "delete-ask-more";
          more.dataset.more = n.id; // read by the e2e test
          more.textContent = "⋯";
          more.title = `${n.label}: more`;
          more.setAttribute("aria-label", `${n.label} options`);
          more.setAttribute("aria-haspopup", "menu");
          more.addEventListener("click", () => {
            const r = more.getBoundingClientRect();
            onMenu(n.id, { x: r.left, y: r.bottom });
          });
          const line = document.createElement("div");
          line.className = "delete-ask delete-ask-row";
          line.append(row, more);
          const eye = eyeOf(n);
          if (eye) line.prepend(eye);
          if (n.hidden || n.folderHidden) line.classList.add("browser-row-hidden");
          li.append(line);
        } else if (n.hidden !== undefined) {
          // An origin row's eye, on a line of its own as an item row's.
          const line = document.createElement("div");
          line.className = "delete-ask delete-ask-row";
          line.append(eyeOf(n)!, row);
          if (n.hidden || n.folderHidden) line.classList.add("browser-row-hidden");
          li.append(line);
        } else li.append(row);
      }
      ul.append(li);
    }
    return ul;
  };
  // The whole panel folds too (SF3d): it floats over the view, so folding it gives the view back.
  const fold = document.createElement("details");
  fold.className = "browser-fold";
  fold.dataset.node = "browser";
  fold.open = isOpen({ id: "browser" });
  fold.addEventListener("toggle", () => {
    if (fold.isConnected) folding.set("browser", fold.open);
  });
  const title = document.createElement("summary");
  title.textContent = "Browser";
  fold.append(title, list(browserTree(doc, failed, buildAreaShown, currentUnit(document))));
  slot.replaceChildren(fold);
}

/** A warning from the rebuild (24d2's kept shape; 26e's lost plane and lost source): its item, the Timeline rows it marks, the sketch it is about, its words, and whether it is a lost plane. */
interface Warned {
  item: string;
  rows: string[];
  sketch: string;
  words: string;
  lost?: true;
}

/** The open design's token for copied bodies (duplicate.ts `copiedText`). */
let designToken = "0";

function mount(ctx: WorkspaceContext): MountedWorkspace {
  const panel = propertiesPanel(ctx.properties);
  const { inputs } = panel;
  let shape: PartKind = "box";
  const held = ctx.project.workspaces.design as DesignDocument | undefined;
  /** A document the project holds that this panel did not make (an opened file): shown as it is, and framed. */
  let loaded: DesignDocument | undefined;
  /** The document this panel last made, mounted again (Design moved to the other pane): shown as it is, never remade from the size boxes (daily hunt 2026-10-23: a design with no body got a new box). */
  let remounted: DesignDocument | undefined;
  /**
   * The id of the body the size boxes and Shape choice describe, which a size typed changes (bug hunt 2026-11-01): the
   * selected body (`panelPart`), else the last (`partFeature`). Each change of selection brings the boxes to it (`followSelection`).
   */
  let boxesPart: string | null = null;
  if (saved && held === saved.doc) {
    shape = saved.shape;
    inputs.forEach((input, i) => (input.value = saved!.sizes[i]));
    boxesPart = saved.part;
    remounted = held;
  } else if (held) {
    const part = partOf(held); // readDesignDocument checked it when the file was opened; null when it has no body (24f4)
    if (part) {
      shape = part.shape;
      for (const [i, key] of SIZE_KEYS.entries()) if (part.sizes[key] !== undefined) inputs[i].value = String(part.sizes[key]);
      boxesPart = partFeature(held)!.id;
    }
    loaded = held;
    framedKind = null; // an opened file is a new part: frame it (not after Undo or Redo: keepCamera)
  }
  /** Mounted by Undo or Redo (step 20c): the first build keeps the camera unless the body no longer fits, even for another shape. */
  const restored = putAwayByRestore !== null && putAwayByRestore === ctx.project;
  if (putAwayByRestore !== null && !restored) editingSketch = null; // that sketch was the old project's
  let keepCamera = ctx.history.restoring() || restored;
  putAwayByRestore = null;
  /** Whether Body facts' press is what shows the numbers now, on a wide screen (the fold's reveal) or a phone (the sheet). */
  let factsByFold = false;
  let factsBySheet = false;
  /** Whether a tool's box was in the panel when Body facts opened it: a change is the user moving on, so it goes out. */
  let factsTool: boolean | null = null;
  const factsOn = () => factsByFold || factsBySheet;
  const drawFacts = () => factsButton.setAttribute("aria-pressed", String(factsOn()));
  const inspecting: Inspecting = {
    // Opens the folded panel until the user moves on (U0b), at the numbers; pressed again it puts away what it opened
    // (button toggles, Ben 2026-11-11): the panel's reveal on a wide screen, the Properties sheet on a phone.
    facts() {
      if (inspecting.none()) return;
      const foldedBefore = fold !== null && !panelShown(fold.state); // only a press that opens the panel can shut it again
      if (factsByFold || factsBySheet) {
        factsByFold = factsBySheet = false;
        fold?.conceal();
        ctx.properties?.dispatchEvent(new Event("properties-conceal", { bubbles: true })); // a phone shuts the sheet (main.ts)
        return drawFacts();
      }
      // A new Move with nothing moved yet (as an inserted preset starts, Ben 2026-11-04) is put away first: a phone's
      // sheet shows the Move alone (move-panel.css), so the numbers would stay out of sight behind it, and nothing is lost.
      // A phone's sheet that opened for the Move shuts as it goes (main.ts watches for that in a microtask), so the
      // numbers are shown in the microtask after it, opening the sheet again for them.
      const reveal = () => {
        fold?.reveal();
        // A phone opens its Properties sheet (main.ts), saying so in `detail`; there the fold is not drawn, so only the sheet counts.
        const asked: FactsReveal = { opened: false, phone: false };
        ctx.properties?.dispatchEvent(new CustomEvent("properties-reveal", { bubbles: true, detail: asked }));
        factsByFold = !asked.phone && foldedBefore && fold !== null && panelShown(fold.state);
        factsTool = fold ? fold.state.tool : null;
        factsBySheet = asked.opened;
        drawFacts();
        ctx.properties?.querySelector("#volume")?.closest("dl")?.scrollIntoView({ block: "nearest" });
      };
      if (!moveUntouched()) return reveal();
      leaveMove();
      queueMicrotask(reveal);
    },
    none: () => ((lastScene?.bodies.length ?? 0) > 0 ? null : NO_FACTS),
    printCheck: () => togglePrintCheck(),
    measure: () => (measureBox.shown ? measureBox.close() : startMeasure()),
    explode: () => setExploded(explodeSpread === null ? EXPLODE_DEFAULT : null),
    exploded: () => explodeSpread !== null,
    noExplode: () => ((lastScene?.bodies.length ?? 0) >= 2 ? null : NO_EXPLODE),
  };
  const { insert: insertMenu, facts: factsButton, printCheck: printCheckButton, explode: explodeButton, measure: measureButton, commands } = toolbar(ctx.toolbar, (b) => run(b.command), () => startSketch(), () => startExtrude(), () => startMove(), () => startMove(null, "rotate"), () => startCombine(), (kind) => void insertBody(kind), inspecting, { run: () => void duplicateBodies(), off: duplicateOff, mirror: (plane) => void duplicateBodies(undefined, plane), scale: () => startMove(null, "scale") });
  // S: the command search box over the page (Ben's keys 10-29), listing what the toolbar offers now.
  const searchBox = commandSearch(ctx.toolbar.ownerDocument, commands);
  // A Cut or Join whose tools change nothing asks before OK records it (Ben, 11 Nov).
  const missAsk = cutAsk(ctx.toolbar);
  const fresh = startFresh(ctx.toolbar, { current: () => designDoc(), confirm: () => (ctx.startedFresh?.(), void clearDesign()) });
  /** Slice for printing's warm-up loop and Better grip as last ticked (null: as remembered); the build area counts them. */
  let printExtras: FirstLayerExtras | null = null;
  /** Draws the build area again (set once the build area's own state exists below; the dialog may tick before then). */
  let refreshArea = () => {};
  // File ▾ > Slice for printing (H2a, W6c): every body shown, as Export STL takes them, sliced and saved as the P1S's print file (.gcode.3mf) or plain G-code.
  const printing = slicePrint(ctx.toolbar, {
    async slice(choices, file, alive) {
      const doc = designDoc();
      // By body (35f1: a Combine's pieces have no item of their own).
      const features = doc ? shownBodyRefs(doc, failedNow).flatMap((r) => { const f = shownBodyFeature(r, doc, failedNow); return f ? [{ body: r.id as string, feature: f }] : []; }) : [];
      const save = async (print: PrintFacts, suggestedName: string, kind: SaveKind, bytes: Uint8Array<ArrayBuffer>) => {
        if (!alive()) throw new SliceDropped();
        const r = await saveFile(ctx.toolbar.ownerDocument, { suggestedName, kind, bytes });
        if (r.status === "failed") throw new Error(r.message);
        return { print, saved: r.status === "saved", name: r.status === "saved" ? r.name : suggestedName };
      };
      if (file.format === "p1s") {
        const print = await printFileOf(kernel, doc!, features, choices, file.plate, file.nozzle);
        return save(print, printFileName(choices, file.plate, file.nozzle, printLead(ctx.project.name, ctx.fileName?.())), P1S_KIND, print.package);
      }
      const print = await sliceBodies(kernel, doc!, features, choices);
      return save(print, gcodeName(choices, printLead(ctx.project.name, ctx.fileName?.())), GCODE_KIND, new TextEncoder().encode(print.gcode) as Uint8Array<ArrayBuffer>);
    },
    // Preview (H2b, H2c): the same slice, played through the replayer and shown in 3D with its time-lapse.
    async preview(choices, file, alive, changed) {
      const doc = designDoc();
      // By body (35f1: a Combine's pieces have no item of their own).
      const features = doc ? shownBodyRefs(doc, failedNow).flatMap((r) => { const f = shownBodyFeature(r, doc, failedNow); return f ? [{ body: r.id as string, feature: f }] : []; }) : [];
      // The file Slice and download would save: the P1S's own G-code (its time, filament and start routine), else the plain slice.
      const p1s = file.format === "p1s" ? await printFileOf(kernel, doc!, features, choices, file.plate, file.nozzle) : null;
      const gcode = p1s ? printMovesOf(gcodeOfPackage(p1s.package) ?? "") : null;
      const print = p1s && gcode !== null ? { ...p1s, gcode } : await sliceBodies(kernel, doc!, features, choices);
      if (!alive()) throw new SliceDropped();
      // A choice changed while it sliced: the preview says it shows the earlier ones, as Slice and download's result does.
      openPrintPreview(ctx.toolbar, playback(print.gcode), printWords(print), (host, p) => printView(host, p), changed() ? PREVIEW_EARLIER : undefined);
    },
    // The bar follows the engine's own reports (Ben, 2026-11-01).
    onProgress: (listener) => kernel.onProgress?.(listener) ?? (() => {}),
    // The build area counts the warm-up loop and Better grip's brim as Slice for printing will print them.
    extrasChanged(extras) {
      printExtras = extras;
      refreshArea();
    },
    // Printer fits (P13): the fit test piece's P1S print file, saved like a slice's.
    async testPiece(choices, file, alive) {
      const print = await testPieceFile(kernel, choices, file.plate, file.nozzle);
      if (!alive()) throw new SliceDropped();
      const suggestedName = printFileName({ ...choices, supports: "off" }, file.plate, file.nozzle, "fit-test-piece");
      const r = await saveFile(ctx.toolbar.ownerDocument, { suggestedName, kind: P1S_KIND, bytes: print.package });
      if (r.status === "failed") throw new Error(r.message);
      return { saved: r.status === "saved", name: r.status === "saved" ? r.name : suggestedName };
    },
  });
  const deleting = deleteAsk(ctx.toolbar);
  const renaming = renameBox(ctx.toolbar);
  /** Where the last item menu opened: Rename's box opens there (U0e2). */
  let menuAt = { x: 0, y: 0 };
  // An empty design's hint (U0c): its buttons do what the toolbar's and the top bar's do.
  const startCard = startHint(ctx.viewport.element, { sketch: () => startSketch(), insert: () => insertMenu.open(true), open: ctx.openFile });
  // The export badge (Ben 2026-11-05): what the last Download STL's solid check found, for the design it was made
  // from; ✕ or any edit puts it and its red marks away.
  const solidCard = solidBadge(ctx.viewport.element, () => ctx.viewport.clearOverlay(SOLID_OVERLAY));
  let solidFor: DesignDocument | undefined;
  /**
   * Shows the hint while the design is empty and no sketch is being started, and only while Design is on screen:
   * the card sits in the shared 3D view, so asleep it would float over another workspace (owner's report, 2026-10-28).
   */
  const showStart = () => startCard.update(shown ? (ctx.project.workspaces.design as DesignDocument | undefined) : undefined, mode.kind !== "none");
  const { kernel, viewport } = ctx;
  /** On screen (awake); false while asleep (X7) and after unmount. */
  let shown = true;
  /** A build finished while asleep and was not drawn: wake builds again. */
  let missed = false;
  /** Every body drawn, with its faces' and edges' names (steps 24c, 24d3b), which the selection holds. */
  let lastScene: Scene | null = null;
  /** Edit feature's regions (48d4, `offerEditRegions`): the extrude edited, its sketch's regions offered, the one chosen and the one picked (null until a pick). */
  let editRegions: { id: string; sketch: string; name: string; offers: RegionOffer[]; chosen: string | null; picked: RegionRef | null } | null = null;
  /** The part's body in the last scene that showed it: the panel's numbers, marked out of date, while the part fails. */
  let partShown: ShownBody | null = null;
  /** The note about items the last rebuild dropped, and whether that drop is being applied now. */
  let note = "";
  let settling = false;

  /** The failed ids the browser's rows were last drawn with. */
  let rowsFailed: ReadonlySet<string> = new Set();
  /** Draws the browser for `doc` with the last rebuild's failed items (no Body row for them). */
  function drawBrowser(doc: DesignDocument) {
    rowsFailed = failedNow;
    browser(ctx.browser, doc, failedNow, selectRow, openRowMenu, (node) => openItem(itemOfRow(node)), toggleHidden, buildAreaOn);
    showBuildAreaWords();
  }

  /**
   * The unit changed (Settings): the browser's and the timeline's words say it (U2c3). Held by `unmount`, since the page's
   * listener holds it only weakly (followUnit); false once unmounted, and it is dropped.
   */
  let unitWatch: (() => boolean) | null = () => {
    if (putAway || unitWatch === null) return false;
    const doc = designDoc();
    drawBrowser(doc);
    showBar(doc);
    return true;
  };
  followUnit(ctx.properties.ownerDocument, unitWatch);

  /** The origin's axes and planes as their eyes say (Ben, 2026-10-29): every axis and no plane until an eye is pressed. */
  function showOrigin(doc: DesignDocument) {
    area = buildAreaOn && !isHidden(doc, EYE_FOLDERS.origin) && lastScene !== null ? buildArea([lastScene.mesh], P1S_AREA, printExtras ?? { warmUp: rememberedWarmUp(storage), betterGrip: rememberedBetterGrip(storage) }) : null;
    viewport.showOrigin({
      axes: [originDrawn(doc, ORIGIN_AXES[0]), originDrawn(doc, ORIGIN_AXES[1]), originDrawn(doc, ORIGIN_AXES[2])],
      planes: EYE_PLANES.filter((id) => originDrawn(doc, id)).map((id) => ({ id, plane: planeOf(id.slice("origin-".length).toUpperCase() as SketchPlane) })),
      ...(area && { buildArea: { lo: area.lo, hi: area.hi, strip: area.strip, corner: area.corner, outside: area.outside !== null } }),
    });
    showBuildAreaWords();
  }

  /**
   * The build area (Ben, 2026-11-01: a part could be "outside the area" when sliced with no way to see it): its eye in
   * Origin, kept as a view setting of this browser; the box under the bodies shown (build-area.ts), and while they go
   * outside it, why, on a note in the view and on its row.
   */
  const storage = (() => {
    try {
      return ctx.toolbar.ownerDocument.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  let buildAreaOn = buildAreaShownIn(storage);
  /**
   * The print check (H1, Ben 2026-11-05): Inspect ▾ Print check paints what would go wrong printing the bodies shown
   * (print-check-view.ts), checked again after every build while on and while Design is on screen. A view setting of
   * this browser: no undo step, nothing saved in the design.
   */
  let printCheckOn = printCheckShownIn(storage);
  let printCheckRuns = 0;
  function showPrintCheck() {
    const run = ++printCheckRuns;
    printCheckButton.setAttribute("aria-pressed", String(printCheckOn));
    const scene = lastScene;
    // Its marks are placed on the bodies where they really are, so none while they are drawn exploded.
    if (!printCheckOn || !shown || scene === null || explodeSpread !== null) {
      for (const id of ALL_PRINT_CHECK_IDS) viewport.clearOverlay(id);
      delete viewport.element.dataset.printCheck;
      return;
    }
    // After the frame that draws the build, so checking a big part never holds the new body back.
    setTimeout(() => {
      if (run !== printCheckRuns || !printCheckOn || !shown || lastScene !== scene || explodeSpread !== null) return;
      const { found, overlays } = checkShown(scene.bodies.map((b) => b.view.mesh), printRulesIn(storage));
      for (const id of ALL_PRINT_CHECK_IDS) if (!overlays.some((o) => o.id === id)) viewport.clearOverlay(id);
      for (const o of overlays) viewport.setOverlay(o);
      viewport.element.dataset.printCheck = printCheckSummary(found); // read by the e2e test
    }, 0);
  }
  function togglePrintCheck() {
    printCheckOn = !printCheckOn;
    keepPrintCheckShown(storage, printCheckOn);
    showPrintCheck();
  }
  showPrintCheck(); // lit at once when left on; painted once the first build lands
  refreshArea = () => {
    const doc = designDoc();
    if (buildAreaOn && doc) showOrigin(doc);
  };
  let area: BuildArea | null = null;
  const areaNote = ctx.viewport.element.ownerDocument.createElement("div");
  areaNote.className = "build-area";
  areaNote.setAttribute("role", "status");
  areaNote.hidden = true;
  ctx.viewport.element.append(areaNote);
  function showBuildAreaWords() {
    const words = shown ? (area?.outside ?? null) : null;
    areaNote.hidden = words === null;
    areaNote.textContent = words ?? "";
    const row = ctx.browser.querySelector<HTMLElement>(`[data-node="${BUILD_AREA_ROW}"]`);
    if (row) {
      row.title = words ?? BUILD_AREA_TITLE;
      row.classList.toggle("build-area-row", words !== null);
    }
  }

  /**
   * A Body row's eye (U0f3): hides its body, or shows it again, as one undo
   * step ("Hide Body 1"), in any mode (a sketch being drawn stays open, as
   * in Fusion). Hiding clears the selection: what was picked may be on it.
   */
  function toggleHidden(node: string) {
    const doc = designDoc();
    // The build area's eye is a view setting, not a design change: no undo step.
    if (node === BUILD_AREA_ROW) {
      buildAreaOn = !buildAreaOn;
      keepBuildAreaShown(storage, buildAreaOn);
      drawBrowser(doc);
      showOrigin(doc);
      // Shown: framed with the part, as a slicer shows its plate (the camera is the user's again at once).
      if (buildAreaOn && area) viewport.fit();
      return;
    }
    const flat = (nodes: readonly BrowserNode[]): BrowserNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
    const n = flat(browserTree(doc, failedNow)).find((r) => r.id === node);
    const id = eyeId(doc, node, failedNow);
    if (n?.hidden === undefined || id === null) return;
    const hide = !n.hidden;
    if (hide) ctx.selection.clear();
    void update(hide ? TIMELINE_STEPS.hide(n.label) : TIMELINE_STEPS.show(n.label), undefined, hideRow(doc, id, hide));
  }

  /** The browser's Body 1 row: a click selects the body, Shift adds or takes it out. */
  function selectRow(ref: GeometryReference, shift: boolean) {
    // A new Move picks its bodies one click at a time, as Fusion's selection box does (35e2b).
    if (shift || (picksBodies() && ref.kind === "body")) ctx.selection.toggle(ref);
    else ctx.selection.set([ref]);
  }

  /** The properties' fold (U0b), made once the tool boxes are in the panel; a selection drawn before then folds nothing. */
  let fold: PropertiesFold | null = null;
  /** The ids of the sketches whose outlines are selected, as the last showSelection found them. */
  let selectedSketches: ReadonlySet<string> = new Set();
  /** Draws the selection: the viewport's colours, the lit browser rows, the properties' rows. */
  function showSelection() {
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    if (!doc) return;
    const items = ctx.selection.items;
    // Which selected outlines are sketches', for the note when a rebuild drops one (25c1); one already
    // gone from `doc` (shown again before the rebuild that drops it) keeps what it was.
    selectedSketches = new Set(
      items.flatMap((i) => {
        const id = readProfileReference(i);
        if (id === null) return [];
        const source = outlineSourceOf(i, doc);
        return (source ? source.kind === "sketch" : selectedSketches.has(id)) ? [id] : [];
      }),
    );
    followSelection(doc);
    viewport.showSelection(highlightOf(items, lastScene));
    lightRows(ctx.browser, doc, failedNow, items);
    fold?.update({ selected: items.length > 0 });
    panel.showSelection(selectionRows(items, lastScene, doc));
    // The Feature and Body sections describe the selected feature (else the part), with the browser's number for its body.
    const focus = panelFocus(items, lastScene, doc);
    panel.showFeature(focus?.feature ?? null);
    if (focus?.body) panel.showBody(focus.body.view, `Body ${focus.body.place}`);
    // The part failed: the numbers it last built, marked out of date (markStale, "Out of date: these numbers are for the last part that built").
    else if (focus && partShown?.feature === focus.feature.id && focus.feature === partFeature(doc)) panel.showBody(partShown.view, `Body ${partShown.place}`);
    else panel.showNoBody(); // a body that did not build, or a design with no body (24f4)
    // Verbs, not apps: whatever the registry offers for this selection, from any workspace.
    const verbs = ctx.actions.actionsFor(targetsOf(items, doc, failedNow));
    panel.showActions(verbs, (id) => runAction(id, ctx.selection.items));
  }

  /** Runs a registered verb on these targets and shows what it said. */
  async function runAction(id: string, targets: readonly Selected[], note = "") {
    const action = ctx.actions.get(id);
    if (!action) return panel.showActionNote(`No action ${id} is registered.`, true);
    // Design's own runs know the bodies drawn (actions.ts, DesignRun: the precision overlay marks only those that warned);
    // the shell's context stays the prototype, so its getters (the project, the graph) read live as ever.
    const run: DesignRun = Object.assign(Object.create(ctx) as WorkspaceContext, { scene: lastScene, failed: failedNow });
    const outcome = await action.run(targets, run);
    if (outcome.solid && shown) {
      solidCard.show(outcome.solid);
      solidFor = ctx.project.workspaces.design as DesignDocument | undefined;
    }
    if (shown) panel.showActionNote([outcome.message, note].filter(Boolean).join(" "), outcome.bad);
  }

  // The body is built from the part's feature intent (document.ts); an extrude of a sketch asks the kernel for the outline (extrude.ts).
  // Its faces and edges are named from the spec it was built from (naming.ts).
  // The whole timeline is rebuilt on the kernel's body store (step 24d2,
  // rebuild.ts): a feature whose spec is unchanged keeps its body, and
  // bodies no feature holds are freed. Rebuilds run one after another, so
  // one never frees a body another is about to show.
  // Settling an edit (26c, 26g) places its face sketches on these bodies too, reusing what is built: a body is never
  // held twice, and the ones a settle builds that no rebuild keeps are freed once it ends (BodyCache.using).
  const bodies = new BodyCache(kernel);
  /** The items that took the kernel too long (35d4): failed with "took too long" and not tried again until Retry on their row. */
  const slow = new SlowItems();
  // A kernel that trapped is replaced by a fresh one (kernel-client.ts): its bodies are gone, so the design is built
  // again on the new one, and every item the trap turned red comes back (Ben's phone project, 2026-10-28). A restart
  // while that build runs (memory still tight, another call trapping) builds once more when it ends, or the design
  // stayed red until the next edit (real-use hunt E2); a design that traps every fresh kernel stops after HEALS builds
  // in a row and shows the failure, rather than restarting forever.
  const HEALS = 3;
  let healing = false;
  let again = false;
  let heals = 0;
  const heal = () => {
    healing = true;
    again = false;
    heals++;
    void show(designDoc(), shape).finally(() => {
      healing = false;
      if (!again) heals = 0;
      else if (heals < HEALS) heal();
      else heals = 0;
    });
  };
  /** Kernel restarts so far: a panel's question cut off by one is asked again on the fresh kernel (onceMoreAfterRestart). */
  let restarts = 0;
  /**
   * `ask`, and once more if the kernel restarted while it was asked: the answer it gave (often "the geometry kernel ...
   * was started again", or a body the restart left unbuilt) is the old kernel's, not the question's (weak-spot hunt C3:
   * Extrude's outline check stuck with OK off, Move's OK saying the box was not built though it was drawn again).
   */
  async function onceMoreAfterRestart<T>(ask: () => Promise<T>): Promise<T> {
    const seen = restarts;
    try {
      const answer = await ask();
      if (restarts === seen) return answer;
    } catch (e) {
      if (restarts === seen) throw e;
    }
    return ask();
  }
  const stopHealing = kernel.onRestart?.(() => {
    restarts++;
    bodies.forget();
    if (healing) again = true;
    else heal();
  });
  let rebuilds: Promise<unknown> = Promise.resolve();
  const build = latestOnly((doc: DesignDocument) => {
    const next = rebuilds.then(() => buildPart(doc));
    rebuilds = next.catch(() => {});
    return next;
  });
  /**
   * Every body the timeline built, joined for drawing (scene.ts, 24d3b);
   * when a body is built from a kept shape, the warning (the last such);
   * and, when the part (the last solid feature) has no body, why: the
   * bodies that did build are drawn all the same (bug hunt 2026-10-19,
   * finding 5: a failed part left the scene from before, so the browser's
   * rows and the panel described bodies that were not there). A design
   * with no part (24f4) builds an empty scene.
   */
  async function buildPart(doc: DesignDocument) {
    const feature = partFeature(doc);
    const build = await rebuildTimeline(doc, bodies, kernel, slow);
    // 35d4: a body whose view took too long is failed as its build would be, and not tried again until Retry.
    const drawn = await shownBodies(doc, build, bodies, (id) => {
      const f = doc.timeline.features.find((x) => x.id === id)!;
      slow.note(doc, f);
      build.results[id] = { status: "failed", cause: "timed-out", message: tookTooLong(f.provenance.self.label) };
    });
    // The kernel keeps a display mesh only for the bodies on screen (35d2's store): the rest are hidden there.
    await bodies.showOnly(drawn.flatMap((b) => {
      const r = build.bodies[b.body];
      return r !== undefined ? [r.handle] : [];
    }));
    // 35f1: a Combine's numbered piece this rebuild didn't make counts as failed, so no row or STL offers it.
    failedNow = failedIds(doc, build.results, new Set(Object.keys(build.bodies)));
    slowNow = new Set(Object.keys(build.results).filter((id) => { const r = build.results[id]; return r.status === "failed" && r.cause === "timed-out"; }));
    resultsNow = build.results;
    handlesNow = Object.fromEntries(Object.entries(build.bodies).map(([id, b]) => [id, b.handle]));
    // Where each sketch on a face was placed (26c), so it is drawn there.
    placedNow = new Map(Object.entries(build.results).flatMap(([id, r]) => (r.status === "built" && r.placement ? [[id, r.placement.plane] as const] : [])));
    // A part whose body a later Combine used up did not fail (part-failure.ts).
    const failure = partFailure(doc.timeline.features, feature, build);
    return { scene: joinBodies(drawn, build), results: build.results, warnings: warningsOf(doc, build), failure, followed: numberPieces(followedDoc(doc, build), Object.keys(build.bodies), builtPieceFaces(build)) };
  }
  /**
   * The rebuild's warnings in timeline order: an extrude built from its kept
   * shape (the owner's rule: on its row and its sketch's), and from 26e a
   * sketch whose plane is lost (Q1, Q6: it stays where it was, drawn red)
   * and an extrude built from one (its source is lost); from 26f a
   * sketch's points whose edges are lost, and from 27d its projections;
   * a Combine whose numbered pieces changed (hunt 11-06).
   */
  function warningsOf(doc: DesignDocument, build: TimelineBuild): Warned[] {
    const out: Warned[] = [];
    for (const f of doc.timeline.features) {
      const r = build.results[f.id];
      if (r?.status !== "built") continue;
      const label = f.provenance.self.label;
      if (r.plane) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.plane.message}.`, ...(r.plane.cause !== "plane-split" && { lost: true as const }) });
      if (r.warning) out.push({ item: f.id, rows: [f.id, r.warning.sketch], sketch: r.warning.sketch, words: `${label} keeps its last shape. ${r.warning.message}.` });
      if (r.source) out.push({ item: f.id, rows: [f.id], sketch: r.source.sketch, words: `${r.source.message}.` });
      if (r.points) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.points.message}.` });
      if (r.projections) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.projections.message}.` });
      if (r.constraints) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.constraints.message}.` });
      // A Combine whose numbered pieces changed with an earlier edit (hunt 11-06): on its row, never a silent switch.
      if (r.pieces) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.pieces.message}.` });
      // A Cut or Join whose tools change nothing (Ben 11 Nov): OK asked first; an earlier edit since can't ask, so the row says it.
      if (r.misses) out.push({ item: f.id, rows: [f.id], sketch: f.id, words: `${r.misses.message}.` });
    }
    return out;
  }
  /** Where the last rebuild's refused Combines would touch themselves or be too thin (36d), or null. */
  let refusalsNow: AnalysisOverlay | null = null;
  /** Points at them in the view while Design is on screen. */
  function showRefusals() {
    if (refusalsNow && shown) viewport.setOverlay(refusalsNow);
    else viewport.clearOverlay(REFUSAL_OVERLAY);
  }
  /** The last rebuild's warnings: shown on their timeline rows and items and, once the sketch each is about is finished, in the panel. */
  let warningsNow: Warned[] = [];
  /** The warnings to show now: while a sketch is being edited, none about it (the outline status says what is open; the owner's rule: a warning after Finish Sketch). */
  const shownWarnings = () => warningsNow.filter((w) => !(mode.kind === "edit" && editingSketch?.id === w.sketch));
  /** Each row's warning words, by row (a row with two warnings has both). */
  function warnedRows(): Map<string, string> {
    const rows = new Map<string, string>();
    for (const w of shownWarnings()) for (const row of w.rows) rows.set(row, rows.has(row) ? `${rows.get(row)} ${w.words}` : w.words);
    return rows;
  }
  function showKept() {
    const shown = shownWarnings();
    panel.showWarning(shown.map((w) => w.words).join(" "));
    const rows = warnedRows();
    for (const row of ctx.browser.querySelectorAll<HTMLElement>(".tree-row")) {
      const words = rows.get(row.dataset.node!);
      if (words !== undefined) row.title = words;
      else if (row.classList.contains("kept")) row.title = row.dataset.tip ?? "";
      row.classList.toggle("kept", words !== undefined);
    }
  }

  /** Never shows stale numbers unmarked: dims them while out of date, and says so if the rebuild failed. */
  function markStale(failed = false) {
    panel.markStale(ctx.graph.isStale(PART_VIEW), failed);
    showDownstream();
  }

  /**
   * The chips for what other workspaces make from the design, their state
   * read from the graph now: drawn after every change Design makes to the
   * graph (markStale runs after each), so none shows a state it has lost.
   */
  function showDownstream() {
    const chips = ctx.downstream.summaries("design", ctx.graph).map((s) => ({ ...s, targetName: ctx.workspaceTitle(s.target) }));
    panel.showDownstream(chips, (target) => ctx.openWorkspace(target as WorkspaceId));
  }

  /** The command the toolbar and the inputs stand for: set_part with this shape and these sizes. */
  function partCommand(): Command {
    const [width, depth, height] = inputs.map((i) => Number(i.value));
    return { op: "set_part", shape, width, depth, height };
  }

  /** The body the boxes describe (`part`, `boxesPart` unless told) in `doc` while it is a body that builds, else the last body; null with none. */
  function boxesFeature(doc: DesignDocument, part = boxesPart): Feature | null {
    const f = part === null ? undefined : doc.timeline.features.find((x) => x.id === part);
    return f !== undefined && ownShape(f) && builds(doc, f) ? f : partFeature(doc);
  }
  /** The boxes and the Shape choice show `part`'s shape and sizes, and a size typed now changes it. */
  function showPartSizes(doc: DesignDocument, part: Feature) {
    const { shape: kind, sizes } = shapeOf(doc, part);
    shape = kind;
    for (const [i, key] of SIZE_KEYS.entries()) if (sizes[key] !== undefined) inputs[i].value = String(sizes[key]);
    boxesPart = part.id;
    panel.setShape(kind, kind);
    if (saved) saved = { ...saved, shape, sizes: inputs.map((i) => i.value), part: boxesPart };
  }
  /**
   * The boxes brought to the body the Feature section describes (`panelPart`): the selected body, else the last
   * (bug hunt 2026-11-01). Only when that body changes, so a size being typed is never written over.
   */
  function followSelection(doc: DesignDocument) {
    const part = panelPart(ctx.selection.items, lastScene, doc);
    if (part !== null && part.id !== boxesPart) showPartSizes(doc, part);
  }

  /**
   * Does what a Design command says: the toolbar's buttons come here, and
   * the AI's accepted commands will too. A set_part from the toolbar names
   * only the shape and keeps the sizes; the kernel judges the sizes (a bad
   * one shows its message, as when typed).
   */
  function run(command: Command) {
    // The whole design's STL, every body shown in one file (25c1): the same verb selected bodies offer, from the registry.
    if (command.op === "export_stl") {
      const doc = ctx.project.workspaces.design as DesignDocument | undefined;
      const bodies = doc ? shownBodyRefs(doc, failedNow) : [];
      if (bodies.length === 0) return panel.showActionNote(doc ? noBodyWords(doc, failedNow) : NO_BODY_STL, true);
      // Hidden bodies are left out, as in Fusion; the note says which (beginner play-test 2026-10-28).
      return runAction(DOWNLOAD_STL, bodies, hiddenStlNote(doc!, failedNow));
    }
    if (command.op === "create_sketch") return aiSketch(String(command.on));
    if (DRAW_OPS.includes(command.op)) return aiDraw(command);
    if (command.op === EXTRUDE_OP) return aiExtrude(command);
    if (command.op === RENAME_OP) return aiRename(command);
    if (command.op !== "set_part") throw new Error(`Design has no command ${command.op}`);
    // The assistant's set_part changes the last body, as it is told (ai-view.ts), with that body's own sizes for any it
    // leaves out (`aiView` says which), whatever is selected; the boxes come back to the selection after.
    const last = partFeature(designDoc());
    if (last !== null && last.id !== boxesPart) showPartSizes(designDoc(), last);
    return setPart(command);
  }
  /** set_part on the body the boxes describe: this shape, and the sizes the command names (the rest kept). */
  function setPart(command: Command) {
    const kind = command.shape as ShapeKind;
    shape = kind;
    for (const [i, key] of SIZE_KEYS.entries()) if (typeof command[key] === "number") inputs[i].value = String(command[key]);
    return update(`Change shape to ${SHAPE_LABELS[kind] ?? kind}`);
  }

  /** Why the panel's sizes for `kind` can't be taken (`panelSizeRefused`: the first shown box that isn't from 0.001 mm to 1 km, a round shape's radius, a slot's depth), or null. */
  function refusedSize(kind: PartKind): string | null {
    const why = panelSizeRefused(kind, Object.fromEntries(SIZE_KEYS.map((k, i) => [k, inputs[i].value])) as Record<SizeKey, string>);
    return why === null ? null : wordsInUnit(why, currentUnit(ctx.properties.ownerDocument));
  }
  /** Leaving a size box whose text was refused: the size the design last took comes back, and the words go. */
  function restoreRefused(i: number) {
    const why = saved === null ? null : refusedSize(shape);
    if (saved === null || why === null) return;
    const typed = inputs[i].value;
    inputs[i].value = saved.sizes[i];
    // It went back without a word (beginner play-test 2026-10-28): say so, until the next size typed.
    if (refusedSize(shape) === null) panel.showError(wordsInUnit(revertedNote(why, typed, saved.sizes[i], shape === "sketch-extrude"), currentUnit(ctx.properties.ownerDocument)));
  }

  /**
   * Builds the part from the panel, or makes `next` the document (an
   * extrude); `label` and `mergeKey` name the undo step when this is a
   * user's edit (none while mounting).
   */
  async function update(label?: string, mergeKey?: string, next?: DesignDocument) {
    const kind = shape;
    // A size typed in the panel that isn't one is refused there, and the design keeps its last sizes: no number, or one
    // no file can hold ("Infinity" where the box takes it as typed; hunt 26g: it took the size, its undo step couldn't
    // be saved, and nothing said so), and an empty box, 0 or below (Ben's Fusion answer 8: -5 and 0 are not accepted;
    // hunt 26h: they went to the kernel and the failed part was recorded and saved). Leaving the box puts the last
    // size back (`restoreRefused`). Under 0.001 mm or over 1 km is refused there too (`lengthRefused`), and a round shape's radius under 0.001 mm and a slot no wider than deep
    // (`panelSizeRefused`, clumsy hunt 2026-11-04); the kernel judges the rest.
    if (next === undefined && loaded === undefined) {
      const refused = refusedSize(kind);
      if (refused !== null) return panel.showError(refused);
    }
    // Made and recorded at once, in the order asked, even while an edit before it is still being settled on the kernel
    // (#537): that settle is written into its own step when it comes (`settledBy`), so every step is the settled design.
    // A size that waited its turn instead was not in the project until then, so a reload or another project dropped it
    // (#627: "10" kept as 1), and an action meanwhile went ahead of it (#622: a Suppress made at the first digit).
    await makeEdit(kind, inputs.map((i) => i.value), label, mergeKey, next);
  }
  /** `update`'s edit made, recorded and shown as far as asking the kernel to settle it; resolves when it is drawn. `sizes` are the boxes' as typed, for the body they describe (`boxesPart`). */
  function makeEdit(kind: PartKind, sizes: string[], label?: string, mergeKey?: string, next?: DesignDocument): Promise<void> {
    viewport.clearOverlay(STL_OVERLAY); // it described the part before this edit
    // The panel edits the part's one solid feature, keeping the sketches; the
    // project holds it. An opened file's document is kept as it is until the
    // first edit. An extrude of a sketch has one size, its distance (the height box).
    const current = ctx.project.workspaces.design as DesignDocument | undefined;
    // The body the boxes describe (the selected one, else the last) is the one changed (bug hunt 2026-11-01).
    const target = current && next === undefined && loaded === undefined && remounted === undefined ? boxesFeature(current) : null;
    let doc: DesignDocument;
    if (next ?? loaded ?? remounted) doc = (next ?? loaded ?? remounted)!;
    else if (kind === "sketch-extrude" && current) doc = setExtrudeDistance(current, Number(sizes[2]), target?.id);
    else if (!current) doc = documentFor(partCommand(), current);
    else {
      const [w, d, h] = sizes.map(Number);
      const made = withPartAt(current, target, kind as ShapeKind, w, d, h);
      doc = made.doc;
      // A new body (a preset shape chosen for an extruded sketch, which has none to become) is added at the marker;
      // the selection stays as it was (nothing leaves it unannounced, refind.journey.ts), so the boxes go back to
      // the selected body when it is not the new one, as the Feature section does.
      boxesPart = made.id;
    }
    // No shape is the part's while the design has no body (24f4): the Shape choice says "—".
    panel.setShape(kind, partFeature(doc) === null ? null : kind);
    // An opened document is all new to the graph: out of date until it builds.
    const before = loaded ? null : (current ?? null);
    loaded = undefined;
    remounted = undefined;
    saved = { doc, shape, sizes, part: boxesPart };
    syncGraph(ctx.graph, doc, before, ctx.changeNotes);
    const changed = ctx.project.workspaces.design !== doc;
    // A user's edit is settled once recorded (`settled`), from the design before the first edit not yet settled.
    if (changed && label !== undefined && current) unsettled ??= current;
    ctx.project.workspaces.design = doc;
    if (changed) ctx.projectChanged(label, mergeKey); // the shell autosaves (19c) and records the undo step (20b)
    return show(doc, kind);
  }

  /**
   * Start fresh (start-fresh.ts), once its dialog is confirmed: out of any
   * sketch or Extrude panel, the selection cleared, the panel back to the
   * box at its default sizes, and the fresh design as one undo step, framed.
   */
  function clearDesign() {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    leaveCombine();
    if (mode.kind !== "none") leaveSketch(false); // update() below shows the fresh design
    ctx.selection.clear();
    shape = "box";
    inputs.forEach((input, i) => (input.value = DEFAULT_SIZES[SIZE_KEYS[i]]));
    boxesPart = null;
    framedKind = null; // a new part: frame it
    return update(START_FRESH_STEP, undefined, freshDesign());
  }

  /**
   * Insert ▾ (insert.ts): a whole new `kind` body at the marker at the
   * default sizes, as one undo step, never changing a body already there.
   * The panel then edits it (the boxes take its sizes) and opens to show
   * them; the first body of an empty design is framed, a later one keeps
   * the camera. Once built, the new body starts picked in a Move (Ben,
   * 2026-11-04), so it can go where it is wanted straight away; not if it
   * failed, or anything else changed or opened while it was built.
   */
  async function insertBody(kind: ShapeKind) {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    leaveCombine();
    if (mode.kind !== "none") leaveSketch(false);
    const doc = designDoc();
    ctx.selection.clear();
    shape = kind;
    inputs.forEach((input, i) => (input.value = String(INSERT_SIZES[SIZE_KEYS[i]])));
    if (partFeature(doc) === null) framedKind = null;
    const added = inserted(doc, kind);
    boxesPart = added.id;
    const made = update(insertStep(kind), undefined, added.doc);
    fold?.reveal();
    await made;
    const body = bodyIdOf(added.id);
    const built = (lastScene?.bodies ?? []).some((b) => b.body === body);
    if (!built || designDoc() !== added.doc || mode.kind !== "none" || extruding || extrudeBox.shown || editBox.editing !== null || moveBox.shown || combineBox.shown || deleting.open !== null) return;
    ctx.selection.set([bodyReference(body)]);
    startMove();
    moveFromInsert = true;
  }

  // A new token for copied bodies whenever Design opens other than by Undo or Redo putting it back (a project opened,
  // another workspace left): a paste finds only bodies copied from the design on screen, through any undo.
  if (!ctx.history.restoring()) designToken = Math.floor(Math.random() * 2 ** 48).toString(36);

  /** Why Duplicate is off: no body picked (a face or edge picks its body). */
  function duplicateOff(): string | null {
    return pickedBodies(ctx.selection.items, lastScene).length === 0 ? "Pick one or more bodies first, then Duplicate." : null;
  }

  /**
   * Duplicate (step 35e2), from Modify ▾: a Duplicate of each picked body
   * at the marker (`insertDuplicates`), one undo step, then, as Insert does,
   * the Move panel opens on the copies so they can be slid off their bodies
   * straight away (Fusion's copy and paste); Cancel leaves them where they are.
   * With `mirror` (Mirror body) each copy is mirrored across that origin
   * plane, already away from its body, so the copies are only picked.
   */
  async function duplicateBodies(bodies?: readonly string[], mirror?: SketchPlane) {
    const picked = bodies ?? pickedBodies(ctx.selection.items, lastScene);
    if (picked.length === 0) return;
    leaveExtrude();
    leaveEdit();
    leaveMove();
    leaveCombine();
    if (mode.kind !== "none") leaveSketch(false);
    let added: ReturnType<typeof insertDuplicates>;
    try {
      added = insertDuplicates(designDoc(), picked, mirror);
    } catch (err) {
      return panel.showError(err instanceof Error ? err.message : String(err));
    }
    ctx.selection.clear();
    await update(mirror === undefined ? DUPLICATE_STEP : MIRROR_STEP, undefined, added.doc);
    const shownNow = new Set((lastScene?.bodies ?? []).map((b) => b.body));
    const copies = copiesOf(added.ids).filter((b) => shownNow.has(b));
    if (copies.length === 0 || designDoc() !== added.doc || mode.kind !== "none" || extruding || extrudeBox.shown || editBox.editing !== null || moveBox.shown || combineBox.shown || deleting.open !== null) return;
    ctx.selection.set(copies.map(bodyReference));
    if (mirror === undefined) startMove();
  }

  /** The sketches whose plane the last rebuild found lost (26e): drawn red where they stay. */
  const lostSketches = () => new Set(warningsNow.flatMap((w) => (w.lost ? [w.item] : [])));
  /** The items the last rebuild failed (24f3: red in the bar and the browser's Timeline rows); the data's own failures are added by `timelineBarItems`. */
  let failedNow: ReadonlySet<string> = new Set();
  /** Those of them that took the kernel too long (35d4): each with a Retry on its row. */
  let slowNow: ReadonlySet<string> = new Set();
  /** Retry on a row (35d4): the item that took too long is tried once more, and the design built again with it. */
  function retry(id: string) {
    if (!slow.retry(id)) return;
    void show(designDoc(), shape);
  }
  /** Where the last rebuild placed each sketch on a face (26c), by sketch id: drawn and looked at there. */
  let placedNow: ReadonlyMap<string, Plane> = new Map();
  /** What the last rebuild made of each item (built, failed, greyed…): an edited Move's preview starts from it (35e2c). */
  let resultsNow: Readonly<Record<string, { status: string; holds?: readonly number[]; pieces?: { renumbered: readonly string[] } }>> = {};
  /** Each built body's handle in the kernel's store, by body id, from the last rebuild: Measure (35e2l2) asks the kernel about them. */
  let handlesNow: Readonly<Record<string, BodyHandle>> = {};
  /** The last sketchPlaceScene worked out, and what from: worked again only when one of them changes. */
  let placeMemo: { scene: Scene; features: unknown; results: unknown; id: string; out: Scene } | null = null;
  /**
   * The bodies as sketch `id` sees them (#540 item 1, sketch-place.ts): those made before it where they are at its
   * place in the timeline, which is where its pins and projections follow them; drawn so while it is edited, and what
   * it snaps to and projects from.
   */
  const sceneFor = (id: string, scene = lastScene): Scene | null => {
    if (scene === null) return null;
    const features = designDoc().timeline.features;
    const m = placeMemo;
    if (m && m.scene === scene && m.features === features && m.results === resultsNow && m.id === id) return m.out;
    const out = sketchPlaceScene(scene, designDoc(), resultsNow, id);
    placeMemo = { scene, features, results: resultsNow, id, out };
    return out;
  };
  /**
   * What a pointer on sketch `id` may snap to on its face's edges (26f):
   * their ends, middles and centres in the plane the sketch is drawn in
   * (the last rebuild's placement, or, for a sketch just made on a face and
   * not rebuilt since, the frame it was made in).
   */
  const edgeTargets = (id: string) => sketchEdgeTargets(designDoc(), id, sceneFor(id), sketchPlane(designDoc(), id, placedNow));
  /** The body edges sketch `id` lands on part way along ("on edge", projection.ts `sketchEdgeCurves`) and the corners in its plane it lines up with. */
  const bodySnaps = (id: string): BodySnaps => {
    const plane = sketchPlane(designDoc(), id, placedNow);
    const scene = sceneFor(id);
    return { curves: sketchEdgeCurves(designDoc(), id, scene, plane), corners: sketchPlaneCorners(designDoc(), id, scene, plane) };
  };
  /** Ctrl (Cmd on a Mac) held over the view: snapping and the grid are off while it is (snap.ts `snapsNow`). */
  let modHeld = false;
  /** Where the pointer landed on `doc`'s sketch for `tool`: snap.ts `snapOnSketch` with the body's corners and edges, unless snapping is off now. */
  const snapHere = (doc: DesignDocument, tool: SketchTool, at: SketchXY, rounded: SketchXY, pixel: number | undefined, edges = edgeTargets(tool.sketch), held = modHeld) =>
    snapOnSketch(doc, tool, at, rounded, pixel, edges, bodySnaps(tool.sketch), snapsNow(snapOn, held, gridSnap).points);
  /** The bar's item whose ⋯ shows (a click or tap picked it). */
  let picked: string | null = null;
  /** The sketch being edited, whose own Suppress and Delete are off. */
  const editingId = () => (mode.kind === "edit" && editingSketch ? editingSketch.id : null);

  /** The timeline bar for `doc`, wired to the item menu. */
  function showBar(doc: DesignDocument) {
    if (!ctx.timeline) return;
    showTimelineBar(ctx.timeline, doc, {
      describe: (summary) => summaryInUnit(summary, currentUnit(ctx.timeline!.ownerDocument)),
      failed: failedNow,
      slow: slowNow,
      onRetry: retry,
      warnings: warnedRows(),
      picked,
      scene: () => lastScene,
      onPick: (id) => {
        picked = picked === id ? null : id;
        showBar(designDoc());
      },
      onMenu: (id, at) => openMenu(id, at),
      // 25a3: a double-click opens the item: Edit Sketch, or Edit feature.
      onOpen: (id) => openItem(id),
      // 24f5: the playback buttons, the marker dragged and a tap between items, each one undo step.
      editing: editingId(),
      // A refusal goes to the error line and back to the bar, which shows it beside itself (timeline hunt, finding 4).
      onAction: (a) => {
        if (a.kind === "menu") return;
        let refused: string | undefined;
        try {
          chooseBarAction({ ...menuHost, refuse: (message) => (menuHost.refuse(message), (refused = message)) }, a, editingId());
        } catch (err) {
          panel.showError(err instanceof Error ? err.message : String(err));
        }
        return refused;
      },
    });
  }

  /**
   * The bar's items and the browser's Timeline rows red for every failed
   * item (24f3), greyed for every item after the marker (24f5), and from 26e
   * greyed for every item built on a suppressed one (Q3), its title saying
   * which. Rows with a warning are `showKept`'s.
   */
  function showFailed(doc: DesignDocument) {
    showBar(doc);
    const { items } = timelineBarItems(doc, failedNow);
    const failed = new Set(items.filter((i) => i.failed).map((i) => i.id));
    const rolledBack = new Set(items.filter((i) => i.rolledBack).map((i) => i.id));
    const greyed = new Map(items.flatMap((i) => (i.greyed === null ? [] : [[i.id, i.greyed] as const])));
    for (const row of ctx.browser.querySelectorAll<HTMLElement>('[data-node="timeline"] .tree-row')) {
      const id = row.dataset.node!;
      const red = failed.has(id);
      const grey = rolledBack.has(id);
      const by = greyed.get(id);
      row.classList.toggle("timeline-menu", red || grey || by !== undefined);
      row.classList.toggle("timeline-menu-failed", red);
      row.classList.toggle("timeline-menu-rolled-back", grey);
      row.classList.toggle("timeline-menu-greyed", by !== undefined);
      if (by !== undefined) row.title = `Greyed: ${by} is suppressed`;
      else if (row.title.startsWith("Greyed: ")) row.title = row.dataset.tip ?? "";
      retryOn(row, slowNow.has(id), retry);
    }
  }

  /** The timeline item of a browser row with a menu: "sketches/<id>" or an item's id. */
  /** The item a row stands for (browser.ts rowItem), or "" for none. */
  const itemOfRow = (node: string) => rowItem(node, designDoc(), failedNow) ?? "";
  /** A row's menu (24e4 for sketches, 24f3 for every timeline item, U0a for bodies: their feature's). */
  function openRowMenu(node: string, at: { x: number; y: number }) {
    openMenu(itemOfRow(node), at, node.startsWith("body-") ? node : undefined);
  }

  /**
   * Show only this body, or Show all bodies (quick wins, Ben 2026-11-04), from Body row `row`'s menu or the view's:
   * only eyes change, one undo step ("Show only Body 2", "Show all bodies"); nothing is recorded when nothing changes.
   */
  function showFrom(action: "show-only" | "show-all", row: string) {
    const doc = designDoc();
    const r = bodyRows(doc, failedNow).find((x) => x.id === row);
    if (!r) return;
    try {
      const next = action === "show-only" ? showOnlyBody(doc, r.body, failedNow) : showAllBodies(doc, failedNow);
      if (next !== doc) void update(action === "show-only" ? TIMELINE_STEPS.showOnly(r.label) : TIMELINE_STEPS.showAll, undefined, next);
    } catch (err) {
      panel.showError(err instanceof Error ? err.message : String(err));
    }
  }

  /** A double-click on item `id` (25a3): its menu's Edit Sketch or Edit feature, refused with the menu's words when that is off. */
  function openItem(id: string) {
    const doc = designDoc();
    if (!doc.timeline.features.some((f) => f.id === id)) return;
    void chooseEntry(menuHost, id, openAction(doc, id), editingId()).catch((err) => panel.showError(err instanceof Error ? err.message : String(err)));
  }

  /** Item `id`'s menu (timeline-menu.ts): Move the marker here, Suppress or Unsuppress, Delete; an entry that is off says why. */
  function openMenu(id: string, at: { x: number; y: number }, row?: string) {
    const doc = designDoc();
    const item = doc.timeline.features.find((f) => f.id === id);
    if (!item) return;
    const editing = editingId();
    // A Body row's menu starts with Show only this body and Show all bodies (its eye is the row's Hide).
    const shows = row === undefined ? [] : showEntries(doc, row, failedNow).map((e) => ({ ...e, run: () => showFrom(e.action as "show-only" | "show-all", row) }));
    const entries = [...shows, ...menuEntries(doc, id, editing).map((e) => ({ ...e, run: () => void chooseEntry(menuHost, id, e.action, editing).catch((err) => panel.showError(err instanceof Error ? err.message : String(err))) }))];
    menuAt = at;
    deleting.menu(itemName(item), at, entries);
  }

  /**
   * The menu on a body in the view (missing basics, Ben 2026-11-04): a right-click or a held finger on a body's face
   * or edge selects it, as a click does (unless it is selected already, so a Shift-picked set stays), and opens its
   * Body row's menu with Hide first. Nothing opens on empty space, while a sketch is being placed or edited, in
   * Extrude or in a Move (their clicks pick other things), or with a box or menu already open.
   */
  function openViewMenu(pick: Parameters<NonNullable<SharedViewport["onMenu"]>>[0], at: { x: number; y: number }): boolean {
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    if (!doc || mode.kind !== "none" || extruding || moveBox.shown || combineBox.shown || deleting.open !== null) return false;
    const target = viewMenuTarget(doc, lastScene, pick, failedNow);
    const item = doc.timeline.features.find((f) => f.id === target?.feature);
    if (!target || !item) return false;
    if (!ctx.selection.items.some((r) => r.kind === target.item.kind && r.id === target.item.id)) ctx.selection.set([target.item]);
    const editing = editingId();
    const fail = (err: unknown) => panel.showError(err instanceof Error ? err.message : String(err));
    const entries = viewMenuEntries(doc, target.feature, editing, target.row, failedNow).map((e) => ({
      ...e,
      run:
        e.action === "hide"
          ? () => toggleHidden(target.row)
          : e.action === "show-only" || e.action === "show-all"
            ? () => showFrom(e.action as "show-only" | "show-all", target.row)
            : () => void chooseEntry(menuHost, target.feature, e.action as MenuEntry["action"], editing).catch(fail),
    }));
    menuAt = at;
    deleting.menu(itemName(item), at, entries);
    return true;
  }

  /**
   * Delete or Backspace with no sketch open (round 2 hunt E5): asks to delete
   * the item of the timeline row or bar item that has focus, else the item
   * whose body everything selected lies on (`deleteKeyTarget`), as the row
   * menu's Delete does: the are-you-sure box when something is built from
   * it, one undo step. Not while a panel or box is open, and nothing (the
   * key does what it would) when there is no one item to ask about.
   */
  function deleteKey(): boolean {
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    if (!doc || extruding || moveBox.shown || combineBox.shown || deleting.open !== null) return false;
    const on = document.activeElement;
    const barItem = on instanceof HTMLElement ? on.closest<HTMLElement>("[data-item]") : null;
    const row = on instanceof HTMLElement && ctx.browser.contains(on) ? on.closest<HTMLElement>("[data-node], [data-more]") : null;
    const focus = barItem?.dataset.item !== undefined ? { item: barItem.dataset.item } : row ? { node: row.dataset.node ?? row.dataset.more! } : null;
    const target = deleteKeyTarget(doc, lastScene, ctx.selection.items, focus, failedNow);
    if (target === null) return false;
    const editing = editingId();
    void chooseEntry(menuHost, target, "delete", editing).catch((err) => panel.showError(err instanceof Error ? err.message : String(err)));
    return true;
  }

  /**
   * File > Save picture (PNG) (quick wins, Ben 2026-11-04): the view as it is
   * on screen, without the view cube, saved under the project's name (the
   * browser's save picker, or the name box), as Export STL saves.
   */
  async function savePicture() {
    try {
      const picture = await viewport.picture?.();
      if (!picture) throw new Error("This browser couldn't make a picture of the view.");
      const r = await saveFile(ctx.toolbar.ownerDocument, { suggestedName: ctx.project.name || "Untitled", kind: PNG_KIND, bytes: picture });
      if (r.status === "failed") throw new Error(r.message);
    } catch (err) {
      panel.showError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * How a menu choice reaches the project: the document recorded as one
   * undo step (out of any sketch or Extrude panel first, the panel showing
   * the part the edit leaves), the delete box asking first (24e4), and a
   * refusal shown as the part's error line.
   */
  const menuHost: MenuHost = {
    kernel,
    bodies,
    current: () => designDoc(),
    record(step, next) {
      leaveExtrude();
      leaveEdit();
      leaveMove();
      leaveCombine();
      if (mode.kind !== "none") leaveSketch(false); // update() below shows the new design
      // The part the panel shows may now be another feature (the last body that still builds), or none (24f4):
      // then the boxes stay, and a size typed adds a preset of the shape shown. After an extrude of a sketch, that is a
      // new box at a fresh design's sizes: the boxes held its distance as a height and older numbers (hunt 26g).
      const part = partOf(next);
      if (part) {
        shape = part.shape;
        for (const [i, key] of SIZE_KEYS.entries()) if (part.sizes[key] !== undefined) inputs[i].value = String(part.sizes[key]);
        boxesPart = partFeature(next)!.id;
      } else if (shape === "sketch-extrude") {
        shape = "box";
        inputs.forEach((input, i) => (input.value = DEFAULT_SIZES[SIZE_KEYS[i]]));
        boxesPart = null;
      } else boxesPart = null;
      void update(step, undefined, next);
    },
    ask: (q, go) => deleting.ask(q, go),
    hold: (work) => ctx.history.hold(work), // a delete the kernel still plans, held like an OK it still checks (#537)
    refuse: (message) => panel.showError(message),
    edit: (id) => openEdit(id),
    editSketch: (id) => openSketch(id),
    rename(id) {
      const item = designDoc().timeline.features.find((f) => f.id === id);
      if (item) renaming.show(itemName(item), menuAt, (typed) => renameEntry(menuHost, id, typed));
    },
  };

  /** Shows a document the project now holds and builds its part: the browser, sketches, selection, then the body or the reason it failed. */
  /** The design last shown and built: a sketch left after edits to it differs, and is rebuilt (25a3). */
  let shownDoc: DesignDocument | null = null;
  /** Counts show() calls: one overtaken while its settle waited on the kernel draws nothing (app hunt 2026-11-04). */
  let showing = 0;
  /** Set once unmounted: a show() still waiting on the kernel then draws nothing. */
  let putAway = false;
  async function show(doc: DesignDocument, kind: PartKind) {
    shownDoc = doc;
    const n = ++showing;
    const view = viewport.element;
    rebuildsOn.set(view, (rebuildsOn.get(view) ?? 0) + 1);
    view.dataset.rebuilding = "true";
    try {
      // The bar and the browser show `doc` at once, before the kernel settles it (a slow kernel: a phone, a big design):
      // a second drag on a bar still showing the last design would land elsewhere than its line showed (hunt2 C1).
      // showBuilt draws them again for the settled design.
      drawBrowser(doc);
      showFailed(doc);
      const next = await settled(doc);
      // A newer show() started while the kernel settled this one: it draws the newer design (an older ask answered
      // later must not show over it). Put away meanwhile (an Undo that unmounted this Design), the bar and browser
      // belong to the Design mounted in its place: this one draws nothing more.
      if (n !== showing || putAway) return;
      await showBuilt(next, kind);
    } finally {
      const left = rebuildsOn.get(view)! - 1;
      rebuildsOn.set(view, left);
      view.dataset.rebuilding = String(left > 0);
    }
  }
  /**
   * The design before the first edit recorded since the last settle (26g),
   * or null: an edit made outside a sketch (Edit feature, a shape or size
   * from the panel or the assistant, the timeline's verbs) can lose a face
   * sketch's face, find it again or move it, so the edit is settled as the
   * naming harness settles Design after every edit (`settleKept`): a sketch
   * whose face goes holds where it last was (Fusion's last place, not where
   * it was first drawn), one found again holds nothing, pinned points follow.
   * Sketch clicks and deletes settle themselves before they are recorded.
   */
  let unsettled: DesignDocument | null = null;
  /**
   * `doc`, the design just recorded, settled against `unsettled` and taken
   * into the edit's own undo step (the typing in a box still one step), or
   * `doc` itself: when nothing is unsettled, when it has no sketch on a face or following a body
   * and asks no extrude for another outline (`keptUnsettled`; nothing else
   * a non-sketch edit changes is settled), or when the design
   * changed again while the kernel looked (the next edit settles from the
   * same `unsettled`).
   */
  async function settled(doc: DesignDocument): Promise<DesignDocument> {
    const from = unsettled;
    if (from === null || ctx.history.restoring()) return doc;
    // A sketch on a face, or one with points pinned to edges or edges projected (hunt A, 2026-11-04: a followed point
    // can lose an origin sketch, whose extrude then keeps its last shape); or an extrude given another region by Edit
    // feature, which forgets the shape kept for the old one (timeline hunt 2026-11-11).
    if (!doc.timeline.features.some((f) => placedOnBodies(doc, f)) && !keptUnsettled(from, doc)) {
      unsettled = null;
      return doc;
    }
    // Held in the history until the kernel has answered and the step is settled (#537): Undo, Redo or a jump pressed
    // meanwhile waits (main.ts), so it never puts back a step still as first recorded. Let go however it ends (taken
    // in, failed, timed out, the design replaced or Design put away).
    const kept = settledBy(from, doc, ctx.history.present());
    void ctx.history.hold(kept).catch(() => {}); // `show` hears how it ended
    return kept;
  }
  /**
   * `settled`'s work on the kernel: `doc` settled from `from` and taken into its undo step `step`, or `doc` itself.
   * When another action was recorded on top meanwhile (an eye, Insert, Rename, an OK, a size typed, an AI accept: #624,
   * #622), the settled design is still written into `doc`'s own step (`History.amendStep`), so Undo, Redo and a history
   * jump land on it settled; the steps on top settle from the same `unsettled`, since they were made on `doc`.
   */
  async function settledBy(from: DesignDocument, doc: DesignDocument, step: HistoryStep): Promise<DesignDocument> {
    let next: DesignDocument;
    try {
      next = await settleKept(kernel, from, doc, bodies);
    } catch {
      return doc; // the rebuild says what failed
    }
    if (ctx.history.restoring()) return doc;
    if (designDoc() !== doc) {
      if (next !== doc) ctx.history.amendStep(step, (snapshot) => withWorkspaceDocument(snapshot, "design", doc, next));
      return doc;
    }
    unsettled = null;
    if (next !== doc) takeIn(doc, next);
    return next;
  }
  /**
   * `next`, `doc` settled or with its pinned points followed, taken in as
   * the design in `doc`'s own undo step: it follows from that step, so the
   * typing in a box stays one step.
   */
  function takeIn(doc: DesignDocument, next: DesignDocument) {
    ctx.project.workspaces.design = next;
    if (saved?.doc === doc) saved = { ...saved, doc: next };
    if (shownDoc === doc) shownDoc = next;
    ctx.history.amend(true);
  }
  async function showBuilt(doc: DesignDocument, kind: PartKind) {
    // The item the Edit feature panel is open on was deleted (the bar, Undo in another way): the panel goes with it.
    if (editBox.editing !== null && !doc.timeline.features.some((f) => f.id === editBox.editing)) leaveEdit();
    // So does the Move panel's Move (35e2b).
    if (moveBox.editing !== null && !doc.timeline.features.some((f) => f.id === moveBox.editing)) leaveMove();
    // And the Combine panel's Combine (35f1c).
    if (combineBox.editing !== null && !doc.timeline.features.some((f) => f.id === combineBox.editing)) leaveCombine();
    drawBrowser(doc);
    showOrigin(doc);
    showStart();
    if (solidFor !== undefined && doc !== solidFor) {
      solidCard.hide();
      ctx.viewport.clearOverlay(SOLID_OVERLAY);
      solidFor = undefined;
    }
    showFailed(doc);
    showKept();
    drawSketches();
    showSelection();
    markStale();
    try {
      const { current, value } = await build(doc);
      if (!current) return;
      if (!shown) return void (missed = true);
      missed = false;
      const { scene, failure } = value;
      // Points pinned to a face's edges (26f) where this rebuild found them, taken into the edit's own undo step (the
      // typing in a box still one step): drawn there, and held there should their edge go. An edit's settling has
      // followed them already, so this takes in a file opened with its points elsewhere (or an edit whose settling
      // failed). Not while an undo or redo is putting a snapshot back (it was taken in when that step was made), nor
      // once the design has changed again.
      const taken = value.followed !== doc && designDoc() === doc && !ctx.history.restoring();
      if (taken) takeIn(doc, value.followed);
      // The rows were drawn before the rebuild said what failed: a failed item has no Body row. Nor had a Combine's new
      // piece its number then (numberPieces, in what was just taken in): 35f4, Fusion check F2's Body 3 had no row.
      if (taken || !sameIds(rowsFailed, failedNow)) drawBrowser(taken ? value.followed : doc);
      warningsNow = value.warnings;
      showKept();
      showFailed(doc);
      // Built from the current inputs: the feature and the numbers are fresh. A failed part is not (its numbers stay, marked).
      if (failure === undefined) {
        for (const f of doc.timeline.features) ctx.graph.markFresh(f.id);
        ctx.graph.markFresh(PART_VIEW);
      }
      markStale(failure !== undefined);
      showBodies(scene); // Edit feature offering regions leaves the edited body out (48d4, bodyMesh)
      // 36d: where a refused Combine would touch itself or be too thin, pointed at over everything.
      refusalsNow = refusalOverlay(doc.timeline.features, value.results);
      showRefusals();
      // A sketch on a face is drawn where this rebuild placed it (26c).
      drawSketches();
      const empty = scene.bodies.length === 0;
      // A different shape is a new part: frame it (not when Undo or Redo put
      // it back: the camera stays unless the body no longer fits). With no
      // body (24f4) the camera stays where it is, for the body's return; so
      // it does while the part fails, for its return.
      if (failure === undefined) {
        const newPart = kind !== framedKind && !keepCamera;
        keepCamera = false;
        if (!empty && (newPart || needsRefit(framed, viewport.bodyFraming()))) {
          framed = viewport.fit();
          viewport.element.dataset.framedRadius = String(framed?.radius); // read by the e2e test
          viewport.element.dataset.fits = String(++fits);
        }
        if (!empty) framedKind = kind;
      }
      panel.showError(failure ?? "");
      // Faces and edges the edit took off the body leave the selection, with a
      // note (17e); so do ones whose name now names two (25a4: never a guess);
      // the rest follow their names, however the kernel numbers them now.
      const outlines = [...doc.profiles.map((p) => p.id), ...doc.sketches.flatMap((s) => (s.curves.length > 0 ? [s.id] : []))];
      const { kept, dropped, shared, followed } = survivors(ctx.selection.items, scene, outlines, (id) => doc.timeline.features.some((f) => f.id === id), (b) => bodyHidden(doc, b));
      lastScene = scene;
      measureBox.rebuilt(); // the bodies picked may have changed
      if (buildAreaOn) showOrigin(doc);
      showPrintCheck();
      // A snap's "from" was read off the bodies as they were: picked again on these (35e2d).
      if (snapping) (snapping.from = null), showMoveHint();
      // A new Move's preview drawn again on the bodies as now built (a body it picked that no longer shows is let go); an edited one's too (35e2c).
      if (picksBodies()) pickBodies();
      else if (moveBox.shown) previewMove();
      factsButton.disabled = inspecting.none() !== null;
      explodeButton.disabled = explodeSpread === null && inspecting.noExplode() !== null; // on, it can always be turned off
      if (mode.kind === "pick") viewport.showPlanes(originPlanes(), sketchableFaces(scene)); // the faces offered are this scene's
      // Extrude opened before this build landed (a slow kernel, a file just opened, an Undo) offered the faces of the scene
      // before it, or none: they are offered again from this one, so a face is never missing or where the body was.
      if (extruding && designDoc() === doc) void offerProfiles(doc, [...extruding.usable]);
      const part = partFeature(doc);
      partShown = scene.bodies.find((b) => b.feature === part?.id) ?? (failure === undefined ? null : partShown);
      note = [droppedNote(dropped, shared, selectedSketches), followedNote(followed)].filter((x) => x !== "").join(" ");
      if (kept.length < ctx.selection.items.length) {
        settling = true;
        ctx.selection.set(kept);
        settling = false;
      }
      panel.showSelectionNote(note);
      showSelection();
      if (failure === undefined) viewport.element.dataset.shape = empty ? "none" : kind; // read by the e2e test: what is on screen
    } catch (e) {
      if (!shown) return void (missed = true);
      missed = false;
      warningsNow = [];
      if (designDoc() === doc && !sameIds(rowsFailed, failedNow)) drawBrowser(doc);
      showKept();
      if (designDoc() === doc) showFailed(doc);
      panel.showError(e instanceof Error ? e.message : String(e));
      markStale(true);
    }
  }

  // The sketch tool (step 21c, docs/document-model.md section 3).
  /** While editing: the tool, the grid, where the pointer landed (snapped) and why, with the pixel size it was snapped at. */
  type Mode = { kind: "none" } | { kind: "pick" } | { kind: "edit"; tool: SketchTool; grid: number; pointer: SketchXY | null; snap: Snap | null; pixel?: number };
  let mode: Mode = { kind: "none" };
  const sketchPanelBox = sketchPanel(ctx.properties, {
    pickPlane: (id) => pickPlane(id),
    cancel: () => leaveSketch(),
    grid: (typed) => void setGrid(typed),
    gridSnap: (on) => setGridSnap(on),
    finish: () => finishSketch(),
    extrude: () => startExtrude(),
    lookAt: () => lookAtSketch(),
  });
  /**
   * Why the last click or press did nothing, also shown by the pointer
   * (`hint`) while sketching: on a phone the panel is in the Properties
   * sheet, closed while drawing, so a refused click said nothing at all
   * (beginner play-test 2026-10-28). Empty when there is nothing to say.
   */
  let sketchNote = "";
  const sketchBox: typeof sketchPanelBox = {
    ...sketchPanelBox,
    showError(message) {
      sketchPanelBox.showError(message);
      if (message === sketchNote) return;
      sketchNote = message;
      if (mode.kind === "edit") drawSketches();
    },
    // A panel shown afresh has no note, and neither has the pointer.
    showPick: () => ((sketchNote = ""), sketchPanelBox.showPick()),
    showEditing: (...args) => ((sketchNote = ""), sketchPanelBox.showEditing(...args)),
    hide: () => ((sketchNote = ""), sketchPanelBox.hide()),
  };
  /** The tool whose unfinished shape Extrude or Finish sketch last warned of: pressed again with it unchanged, it goes on (`unfinishedWords`). */
  let warnedUnfinished: SketchTool | null = null;
  /** True when `verb` must wait: the tool has a shape half drawn that it would drop, and this is the first press since. */
  function holdUnfinished(verb: "Extrude" | "Finish sketch"): boolean {
    if (mode.kind !== "edit") return false;
    // A click still waiting for the kernel may finish the shape, or start one: asked again once it has landed.
    if (waiting > 0) {
      const again = () => void (mode.kind === "edit" && (verb === "Extrude" ? startExtrude() : finishSketch()));
      clicks = clicks.then(again, again);
      return true;
    }
    if (warnedUnfinished === mode.tool) return false;
    const words = unfinishedWords(mode.tool, verb);
    if (words === null) return false;
    warnedUnfinished = mode.tool;
    sketchBox.showError(words);
    return true;
  }
  /** The sketch's own toolbar (SF3b), standing in for the modelling buttons while a sketch is edited; Extrude stays. */
  const sketchBar = sketchToolbar(ctx.toolbar, { tool: (kind) => chooseTool(kind), finish: () => finishSketch(), snap: (on) => setSnapOn(on), type: () => typed.start(""), remove: () => void deletePicked(), construction: () => void constructPicked() });
  /** Typed sizes (SF4): what the boxes by the pointer lock, and where the pointer is over the view (px), where they float. */
  let locks: Locks = {};
  let screen = { x: 0, y: 0 };
  /** Where on the edited sketch's plane the pointer was last (the raw point, before snapping): `screen` again after the view changes size. */
  let pointerAt: SketchXY | null = null;
  const typed = typedBoxes(viewport.element, {
    locks: (next) => ((locks = next), drawSketches()),
    enter: () => placeTyped(),
    escape: () => {
      locks = {};
      // Escape in a dimension's box (47e) leaves the dimension: nothing is added or changed.
      if (mode.kind === "edit" && isConstraintTool(mode.tool) && mode.tool.pending) mode.tool = { ...mode.tool, pending: null, changing: undefined };
      drawSketches();
    },
  });
  // FK2: the fit list under the Diameter box tags the circle a diameter dimension sizes (at once, its own undo step),
  // or each circle the Circle tool draws next. The number stays the design's size.
  const fitList = fitPicker(viewport.element.ownerDocument, (fit) => pickFit(fit));
  typed.under("diameter", fitList.element);
  /** The fit the list shows now: the Circle tool's, or the dimensioned circle's. */
  function fitNow(): Fit | null {
    if (mode.kind !== "edit") return null;
    const tool = mode.tool;
    if (tool.kind === "circle") return tool.fit ?? null;
    if (isConstraintTool(tool) && tool.pending?.kind === "diameter") {
      const circle = tool.pending.circle;
      const c = designDoc().sketches.find((s) => s.id === tool.sketch)?.curves.find((q) => q.id === circle);
      return c?.kind === "circle" ? (c.fit ?? null) : null;
    }
    return null;
  }
  function pickFit(fit: Fit | null) {
    if (mode.kind !== "edit") return;
    const tool = mode.tool;
    if (tool.kind === "circle") {
      const { fit: _old, ...rest } = tool;
      mode.tool = fit ? { ...rest, fit } : rest;
    } else if (isConstraintTool(tool) && tool.pending?.kind === "diameter") {
      const got = setCircleFit(designDoc(), tool.sketch, tool.pending.circle, fit);
      if ("refused" in got) sketchBox.showError(got.refused);
      else if (got.step) applySketchEdit(got.doc, got.step, tool.sketch);
    }
    fitList.set(fitNow());
    drawSketches();
    // Back to the number, so Enter places the circle or the dimension as before.
    viewport.element.ownerDocument.getElementById("typed-diameter")?.focus();
  }
  /** What the next click places, by the pointer ("Specify next point"). */
  const hint = pointerHint(viewport.element);
  /** Empties the boxes: a point placed, the tool changed or ended, the sketch left. */
  function unlock(keepFocus = false) {
    locks = {};
    typed.clear(keepFocus);
  }
  /** Shows the modelling buttons (true) or the sketch's toolbar in their place (false). */
  function modelling(on: boolean) {
    for (const el of ctx.toolbar.querySelectorAll<HTMLElement>("[data-modelling]")) el.hidden = !on;
    for (const el of ctx.toolbar.querySelectorAll<HTMLElement>("[data-sketching]")) el.hidden = on;
  }
  const designDoc = () => ctx.project.workspaces.design as DesignDocument;
  /** Counts tool changes (a tool chosen, Escape, the sketch entered again): a click the kernel was still snapping across one is dropped. */
  let toolChanges = 0;
  /** The sketch point being dragged (47d3, onPointDrag), if one is. */
  let pointDrag: PointDrag | null = null;
  /** The edited sketch's points a press can grab, by id, in the order last drawn (editing.grab). */
  let grabbable: string[] = [];
  /** The drag the pointer is pressing now, until it is let go (it may still wait for its turn). */
  let liveDrag: PointDrag | null = null;
  /** Read by the e2e tests: how many drags have ended (recorded or not), and how many steps have been solved. */
  // Counted on from what the view says: an undo mounts Design again, and the tests wait for the count to go up.
  let dragsEnded = Number(viewport.element.dataset.pointDrags ?? 0);
  let dragSolves = Number(viewport.element.dataset.dragSolves ?? 0);

  /** Millimetres a screen pixel on the edited sketch's plane at `at` (its origin when null), from the camera as it is now; undefined when not on screen. */
  function pixelNow(at: SketchXY | null): number | undefined {
    const [x, y] = at ?? [0, 0];
    const a = viewport.sketchScreenPoint([x, y]);
    const b = viewport.sketchScreenPoint([x + 1, y]);
    const c = viewport.sketchScreenPoint([x, y + 1]);
    if (!a || !b || !c) return undefined;
    const across = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y));
    return across > 0 && Number.isFinite(across) ? 1 / across : undefined;
  }

  /** Draws every sketch, the edited one with its grid, points and preview. */
  function drawSketches() {
    // A point being dragged (47d3) shows the sketch as its last solved step left it, until it is let go and recorded.
    const doc = pointDrag && dragStillFor(pointDrag) ? pointDrag.doc : (ctx.project.workspaces.design as DesignDocument | undefined);
    if (!doc) return;
    const editing = mode.kind === "edit" ? mode : null;
    // The points a press drags, as drawn (sketch-tool.ts editing.grab): a grab names one by its place here, which a delete landing
    // since may have shifted in the document (47d4 review).
    grabbable = editing?.tool.kind === "select" ? (doc.sketches.find((s) => s.id === editing.tool.sketch)?.points.map((p) => p.id) ?? []) : [];
    // With a size typed the preview goes where the locks put it, and the snap marks (which the locks overrule) are left out.
    const locked = Object.keys(locks).length > 0;
    const aim = editing && aimOf(doc, editing.tool, editing.pointer, locks);
    // A typed arc angle goes the pointer's way round however little it went (typed-entry.ts withLocks): the preview from the tool the click will use.
    // Marks and dimension labels are sized in screen pixels at the camera as it is now, never at the pointer's last move: a camera
    // that moved since left them sized for the old view, and the next click jumped a label from under the pointer (47e, Firefox).
    const pixel = editing ? (pixelNow(editing.pointer) ?? editing.pixel) : undefined;
    viewport.showSketches(withSnap(sketchDrawings(doc, editing && { ...editing, pixel, tool: withLocks(editing.tool, locks, editing.pointer), pointer: aim, gridSnap }, placedNow, lostSketches()), locked ? null : (editing?.snap ?? null), editing?.pixel));
    const anchor = editing && anchorOf(doc, editing.tool);
    sketchBar.showPicked(editing?.tool.kind === "select" ? stillPicked(doc.sketches.find((s) => s.id === editing.tool.sketch), editing.tool.picked).length : 0);
    if (!editing) return (typed.hide(), sketchBar.showType(false), hint.hide());
    const width = viewport.element.clientWidth;
    sketchBar.showType(typedFields(editing.tool).length > 0);
    // A dimension waiting for its value (47e): its box by its label, starting at the size as drawn.
    const tool = editing.tool;
    const pending = isConstraintTool(tool) && tool.pending ? tool.pending : null;
    const sketch = pending ? doc.sketches.find((s) => s.id === tool.sketch) : undefined;
    const spot = pending && sketch ? dimensionLine(sketch, pending, 10 * (editing.pixel ?? 0.1)) : null;
    const box = (spot && viewport.sketchScreenPoint(spot.label)) || screen;
    const live = pending ? { [typedFields(tool)[0]]: pending.value } : anchor && aim ? liveValues(anchor, aim, tool) : {};
    // A dimension's box stays by its label: the next thing is typing, not a tap on a point, and moving it off the points sent it
    // to the view's far corner on almost any small sketch (the solver bug hunt, 2026-11-06).
    fitList.set(fitNow());
    // The fit list tags a circle: a polygon's Diameter box (52c) takes no fit, so the list stays under circles' boxes only.
    typed.under("diameter", tool.kind === "circle" || pending?.kind === "diameter" ? fitList.element : null);
    typed.show(typedFields(tool), live, Math.min(box.x, Math.max(0, width - 200)), box.y, pending ? undefined : viewport.editedScreenPoints());
    // A note shows where the pointer last was even once it has left the view (a finger lifted, the mouse gone to Extrude).
    if (editing.pointer || sketchNote) hint.show(sketchNote || hintOf(editing.tool), Math.min(screen.x, Math.max(0, width - 200)), screen.y, sketchNote !== "");
    else hint.hide();
  }

  /**
   * Applies a sketch edit to the project: one undo step named `label`
   * (SKETCH_STEPS), the timeline in the graph (a sketch has nothing to
   * build: its outline is asked of the kernel when read), the browser
   * and the drawing. What is built from the sketch is marked out of date
   * and rebuilt when the sketch is left (Finish Sketch, 25a3), as the
   * reference app does: never part way through drawing an outline.
   */
  function applySketchEdit(next: DesignDocument, label: string, sketchId: string) {
    const before = designDoc();
    syncGraph(ctx.graph, next, before, ctx.changeNotes);
    ctx.graph.markFresh(sketchId);
    ctx.project.workspaces.design = next;
    saved = { doc: next, shape, sizes: inputs.map((i) => i.value), part: boxesPart };
    ctx.projectChanged(label);
    drawBrowser(next);
    showStart();
    showFailed(next);
    showKept(); // the rows are new: mark them again until the rebuild says otherwise
    markStale();
  }

  /** Create sketch: the origin planes appear at the origin, the flat faces of the bodies on screen light under the pointer (26d), and the panel asks for one. */
  function startSketch() {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    leaveCombine();
    if (mode.kind === "edit") leaveSketch();
    leaveExplode(); // a tool works on the bodies where they are
    mode = { kind: "pick" };
    showStart();
    viewport.showPlanes(originPlanes(), sketchableFaces(lastScene));
    sketchBox.showPick();
  }

  /** A plane picked: the new sketch (one undo step), looked at straight down, ready to draw on. */
  function pickPlane(plane: SketchPlane) {
    if (mode.kind !== "pick" || !ORIGIN_PLANES.some((p) => p.id === plane)) return;
    startNewSketch(addSketch(designDoc(), plane));
  }

  /**
   * A face picked (26d, face-pick.ts): a flat one gets the new sketch on it,
   * drawn with the frame its face gives it (rule 8) and looked at from
   * outside the body; a curved one, or one with no name of its own, is
   * refused in the panel's words and the planes stay offered.
   */
  function pickFace(spot: SketchSpot & { kind: "face" | "refused" }) {
    if (mode.kind !== "pick") return;
    if (spot.kind === "refused") return sketchBox.showError(spot.message);
    let made: ReturnType<typeof addFaceSketch>;
    try {
      made = addFaceSketch(designDoc(), spot.face, spot.drawn);
    } catch (e) {
      return sketchBox.showError(e instanceof Error ? e.message : String(e));
    }
    startNewSketch(made);
  }

  /**
   * create_sketch (AI7a): what Create sketch then a click on the plane or
   * face does, out of any tool open first. A face is found by its name on
   * the bodies on screen, as the AI was told of them (ai-view.ts
   * `aiFaces`); a name no flat face there has is refused, so the
   * assistant puts the project back.
   */
  function aiSketch(on: string) {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    leaveCombine();
    if (mode.kind !== "none") leaveSketch();
    startNewSketch(sketchOn(designDoc(), on));
  }

  /** The sketch create_sketch makes on a plane or a named face of the bodies on screen, added to `doc` (a name no flat face there has is refused). */
  function sketchOn(doc: DesignDocument, on: string): { doc: DesignDocument; id: string } {
    if ((SKETCH_PLANES as readonly string[]).includes(on)) return addSketch(doc, on as SketchPlane);
    const spot = lastScene === null ? null : sketchableFaces(lastScene).map((face) => sketchSpot({ face, shift: false }, lastScene)).find((x) => x?.kind === "face" && x.face.plane === on);
    if (spot?.kind !== "face") throw new Error(`There is no flat face ${on} on the bodies shown to start a sketch on.`);
    return addFaceSketch(doc, spot.face, spot.drawn);
  }

  /**
   * extrude_sketch (AI7c): what the Extrude tool's OK does with a typed
   * distance, for the sketch named, else the one open, else the newest.
   * Out of the sketch first without a rebuild (the extrude's own shows the
   * new design). `check` has already had the kernel build it, so only a
   * design that changed meanwhile can fail here, and the assistant puts
   * the project back.
   */
  function aiExtrude(command: Command) {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    leaveCombine();
    const doc = designDoc();
    const id = extrudeTarget(doc, command, mode.kind === "edit" ? mode.tool.sketch : null);
    const d = commandDistance(command);
    const made = extrudeSketch(doc, id, Math.abs(d), d < 0);
    if (mode.kind !== "none") leaveSketch(false);
    shape = "sketch-extrude";
    inputs[SIZE_KEYS.indexOf("height")].value = String(Math.abs(d));
    boxesPart = made.id;
    return update(extrudeStep(doc, id), undefined, usedSketchHidden(made.doc, id));
  }

  /**
   * rename_item (AI7d): what Rename in an item's menu does with the name
   * typed, for the item named, else the one just made. An open sketch stays
   * open (a draw may follow in the same answer); anything else is recorded as one
   * step, the part the panel shows left as it is.
   */
  function aiRename(command: Command) {
    const doc = designDoc();
    const id = renameTarget(doc, command);
    const renamed = renameItem(doc, id, String(command.name));
    if ("refused" in renamed) throw new Error(renamed.message);
    if (renamed.doc === doc) return;
    const step = TIMELINE_STEPS.rename(itemName(doc.timeline.features.find((f) => f.id === id)!));
    if (mode.kind === "edit") return applySketchEdit(renamed.doc, step, mode.tool.sketch);
    leaveExtrude();
    leaveEdit();
    leaveMove();
    leaveCombine();
    return update(step, undefined, renamed.doc);
  }

  /**
   * Whether the kernel can build what `commands` would do, played out on a
   * copy of the design (null: yes; else the reason, in words): the same
   * steps `run` takes, sketches started and drawn in, and each extrude
   * built by the kernel (an open or empty outline, or a size it refuses).
   * Asked before the preview, so the user is never shown a change that
   * cannot be made. Changes nothing.
   */
  async function aiCheck(commands: readonly Command[]): Promise<string | null> {
    let doc = designDoc();
    let open: string | null = mode.kind === "edit" ? mode.tool.sketch : null;
    try {
      for (const c of commands) {
        if (c.op === "create_sketch") {
          const made = sketchOn(doc, String(c.on));
          doc = made.doc;
          open = made.id;
        } else if (DRAW_OPS.includes(c.op)) {
          if (open === null) throw new Error("No sketch is open to draw in: ask for a new sketch first, or open one with Edit Sketch.");
          const refused = drawRefused(doc, open);
          if (refused) throw new Error(refused);
          doc = drawingFor(doc, open, c);
        } else if (c.op === RENAME_OP) {
          const renamed = renameItem(doc, renameTarget(doc, c), String(c.name));
          if ("refused" in renamed) throw new Error(renamed.message);
          doc = renamed.doc;
        } else if (c.op === EXTRUDE_OP) {
          const id = extrudeTarget(doc, c, open);
          const d = commandDistance(c);
          const made = extrudeSketch(doc, id, Math.abs(d), d < 0);
          const built = await buildSpec(kernel, await featureSpec(kernel, made.doc, made.doc.timeline.features.find((f) => f.id === made.id)!));
          if (built.errors.length > 0) throw new Error(`the kernel's checks failed: ${built.errors.join("; ")}`);
          doc = made.doc;
          open = null;
        }
      }
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return null;
  }

  /**
   * A draw command (AI7b): drawn in the sketch open, as its tool would
   * draw it with typed sizes, the tool's step in the undo list ("Draw
   * circle", inside the AI's one step). Refused, so the assistant puts the
   * project back, with no sketch open or one an extrude is built from (its
   * edits are settled on the kernel first, which an AI step can't wait
   * for: `drawRefused`). Anything part drawn with the tool is dropped first,
   * as Escape would.
   */
  function aiDraw(command: Command) {
    if (mode.kind !== "edit") throw new Error("No sketch is open to draw in: ask for a new sketch first, or open one with Edit Sketch.");
    const id = mode.tool.sketch;
    const refused = drawRefused(designDoc(), id);
    if (refused) throw new Error(refused);
    const next = drawingFor(designDoc(), id, command);
    if (toolBusy(mode.tool)) {
      mode.tool = startTool(mode.tool.kind, id);
      mode.snap = null;
      toolChanges++;
      unlock();
    }
    applySketchEdit(next, DRAW_STEPS[command.op], id);
    drawSketches();
    void showOutline();
  }

  /** A new sketch made on a plane or a face: recorded (one undo step), opened with the line tool, looked at square on. */
  function startNewSketch(made: { doc: DesignDocument; id: string }) {
    viewport.showPlanes([]);
    applySketchEdit(made.doc, SKETCH_STEPS.create, made.id);
    // A new sketch starts with the grid size and Snap to grid chosen in Settings (U2b), the built-in ones when none is.
    const start = currentDesignDefaults(ctx.properties.ownerDocument);
    if (start.snap !== snapDefaultTaken) gridSnap = snapDefaultTaken = start.snap;
    editingSketch = { id: made.id, grid: start.grid, typed: String(start.grid), tool: "line" };
    enterSketch();
    lookAtSketch();
  }

  /**
   * Edit Sketch (25a3, from an item's menu or a double-click): sketch `id`
   * open again with the line tool, out of any other sketch (rebuilt when
   * changed), Extrude or Edit feature panel first, looked at straight down.
   * Nothing is recorded until something is drawn; the kept-shape warning
   * of what is built from it waits for Finish Sketch.
   */
  function openSketch(id: string) {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    leaveCombine();
    if (mode.kind !== "none") leaveSketch();
    const kept = sketchGrids.get(id);
    editingSketch = { id, grid: kept?.grid ?? currentDesignDefaults(ctx.properties.ownerDocument).grid, typed: kept?.typed ?? String(currentDesignDefaults(ctx.properties.ownerDocument).grid), tool: "line" };
    enterSketch();
    if (mode.kind !== "edit") return;
    showKept();
    lookAtSketch();
  }

  /** Look At (SF2): the camera square onto the edited sketch's plane, framing the body and what is drawn; from outside the body on a back or bottom face (26d). */
  function lookAtSketch() {
    if (mode.kind !== "edit" || !editingSketch) return;
    const doc = designDoc();
    viewport.lookAt(sketchPlane(doc, editingSketch.id, placedNow), sketchSide(doc, editingSketch.id));
  }

  /** Edits the sketch named in editingSketch with its tool, nothing clicked yet. */
  function enterSketch() {
    const doc = designDoc();
    if (!editingSketch || !doc.sketches.some((s) => s.id === editingSketch!.id)) return void (editingSketch = null);
    leaveExplode(); // a tool works on the bodies where they are
    mode = { kind: "edit", tool: startTool(editingSketch.tool, editingSketch.id), grid: editingSketch.grid, pointer: null, snap: null };
    pointerAt = null;
    toolChanges++;
    sketchBox.showEditing(sketchItem(doc, editingSketch.id).provenance.self.label, editingSketch.typed, gridSnap, editingSketch.tool);
    modelling(false);
    sketchBar.show(editingSketch.tool);
    sketchBar.showSnap(snapOn);
    drawSketches();
    if (lastScene) showBodies(lastScene); // where the sketch sees them (#540 item 1)
    showBar(doc); // the playback buttons that would roll the sketch back are off (24f5)
    void showOutline();
  }

  /** Line, Rectangle, Circle or an arc (3-point, centre or tangent; the buttons and Create menu, or L, R, C, A and T): what was part way through is dropped, as Escape would, except that a line chain and a tangent arc carry on from each other's last point (`switchTool`). */
  function chooseTool(kind: ToolKind) {
    if (mode.kind !== "edit" || !editingSketch) return;
    editingSketch.tool = kind;
    mode.tool = switchTool(designDoc(), mode.tool, kind);
    mode.snap = null;
    toolChanges++;
    unlock();
    sketchBox.showTool(kind);
    sketchBar.showTool(kind);
    sketchBox.showError("");
    showSketchStatus(); // a tool chosen drops the Select tool's picks, and their words (app hunt 2026-11-04)
    drawSketches();
  }

  /**
   * Cancel, Finish sketch, Extrude, another sketch or item opened: back to
   * modelling; the sketch stays as drawn. When the design changed since it
   * was last built (something was drawn), everything is rebuilt from it
   * (25a3): what is built from the sketch, and everything after that; the
   * rebuild keeps every body whose spec is unchanged. `rebuild` false: the
   * caller shows a new design straight after.
   */
  function leaveSketch(rebuild = true) {
    // A point held or waiting its turn (47d4 review: Cancel or an AI step left the sketch mid-drag, and the drag's turn never ended).
    for (const d of [pointDrag, liveDrag]) if (d) cancelDrag(d);
    const drew = mode.kind === "edit" && rebuild && designDoc() !== shownDoc;
    mode = { kind: "none" };
    unlock();
    editingSketch = null;
    showStart();
    viewport.showPlanes([]);
    sketchBox.hide();
    sketchBar.hide();
    modelling(true);
    drawSketches();
    if (lastScene) showBodies(lastScene); // back where the timeline's end has them (#540 item 1)
    showKept();
    showBar(designDoc());
    if (drew) void show(designDoc(), shape);
  }

  /** Finish Sketch (the toolbar's or the panel's): back to modelling, the camera at the home view (as the owner's CAD suite does, not the view from before the sketch). */
  function finishSketch() {
    if (mode.kind !== "edit") return leaveSketch();
    // A click still waiting for the kernel is drawn first, then the sketch closes (`holdUnfinished` asks again once it has
    // landed): closed at once, the click's turn came for a sketch no longer open and it was dropped (a slow phone tapping fast
    // lost its last circle; found in 27b).
    if (holdUnfinished("Finish sketch")) return;
    leaveSketch();
    viewport.setView("home");
  }

  /**
   * A grid size typed: under 0.001 mm or over 1 km is refused in plain words before the kernel is asked (1e300 got the
   * kernel's refusal with all 301 digits), then the kernel judges it (snapping 0, 0 to it). A refused one keeps the
   * grid, puts its size back in the box and says why and that the old grid is still in use (typed-sizes hunt 2026-11-01).
   */
  async function setGrid(typed: string) {
    if (mode.kind !== "edit" || !editingSketch) return;
    const sketch = editingSketch;
    const grid = Number(typed);
    try {
      if (typed.trim() === "" || !Number.isFinite(grid)) throw new Error("Type the grid size in mm.");
      const refused = lengthRefused(grid);
      if (refused !== null) throw new Error(refused.replace(/^A length/, "The grid size"));
      await kernel.call("snap_to_grid", 0, 0, grid);
    } catch (e) {
      if (mode.kind !== "edit" || editingSketch !== sketch) return;
      sketchBox.showGrid(sketch.typed);
      return sketchBox.showError(`${e instanceof Error ? e.message : String(e)} The grid stays at ${sketch.typed} mm.`);
    }
    // The kernel answered after an Undo, Escape or Finish put this sketch away: the size is for a sketch no longer open.
    if (mode.kind !== "edit" || editingSketch !== sketch) return;
    sketchBox.showError("");
    mode.grid = sketch.grid = grid;
    sketch.typed = typed;
    sketchGrids.set(sketch.id, { grid, typed });
    drawSketches();
  }

  /** The Snap button pressed: snapping to points, edges and line-ups on or off, from the snap shown now. */
  function setSnapOn(on: boolean) {
    snapOn = on;
    sketchBar.showSnap(on);
    if (mode.kind === "edit") mode.snap = null;
    if (mode.kind === "edit" && lastHover) onSketchPointer(lastHover);
    drawSketches();
  }

  /** Grid snap ticked or unticked: from the next pointer move, points land on the grid or where you click. */
  function setGridSnap(on: boolean) {
    gridSnap = on;
    if (mode.kind === "edit") mode.snap = null;
    drawSketches();
  }

  /** Says what the edited sketch holds and whether it makes one closed outline, or the kernel's reason it doesn't. */
  // Every answer goes through one latestOnly, those needing no kernel too, so an older ask answered later never shows over a newer one.
  const outlineOf = latestOnly(async (sketch: Sketch) => (sketch.curves.length === 0 ? null : (projectedOpen(sketch) ?? (await askOutline(kernel, sketchCurves(sketch))))));
  async function showOutline() {
    if (mode.kind !== "edit") return;
    const id = mode.tool.sketch;
    const sketch = designDoc().sketches.find((s) => s.id === id);
    if (!sketch) return;
    const n = curveCount(sketch);
    try {
      const { current, value } = await outlineOf(sketch);
      if (current) outlineWords = value === null ? `${n}.` : typeof value === "string" ? `${n}, not closed: ${value}.` : "closed" in value ? `${n}, a closed outline.` : `${n}, not closed: ${value.open}.`;
    } catch (e) {
      outlineWords = `${n}: ${e instanceof Error ? e.message : String(e)}`;
    }
    showSketchStatus();
  }
  /** The outline's words as last asked (`showOutline`), shown with what the Select tool has picked. */
  let outlineWords = "";
  function showSketchStatus() {
    if (mode.kind !== "edit") return;
    const tool = mode.tool;
    const picks = tool.kind === "select" ? selectStatus(designDoc().sketches.find((s) => s.id === tool.sketch), tool.picked) : "";
    sketchBox.showStatus(picks ? `${outlineWords} ${picks}` : outlineWords);
  }

  /**
   * A constraint the picks made (47d2): added on the kernel's solver as one
   * undo step ("Horizontal", "Fix"…), in turn behind the clicks before it,
   * or refused with the reason in the sketch panel and the constraints and
   * arcs that fight drawn red. A tool change, undo or Escape while the
   * solver works drops the answer: it was for a sketch no longer there.
   */
  /**
   * A sketch point being dragged with the Select tool (47d3, point-drag.ts):
   * the document before the press, the last solved step (`doc`, drawn), the
   * newest pointer not yet solved toward (`want`), whether it was let go,
   * and what the press's turn in line waits on.
   */
  interface PointDrag {
    sketch: string;
    point: string;
    /** The design when its turn came (after the clicks, deletes and drags before it landed); null until then. */
    before: DesignDocument | null;
    doc: DesignDocument | null;
    want: SketchXY | null;
    pixel: number | undefined;
    running: boolean;
    dropped: "drop" | "cancel" | null;
    changes: number;
    ended: boolean;
    finished: () => void;
  }

  /** Whether a drag is still for what is shown: its turn has come, the same sketch is open with the same tool, the design not changed under it (Undo). */
  function dragStillFor(drag: PointDrag): drag is PointDrag & { before: DesignDocument; doc: DesignDocument } {
    return !drag.ended && drag.before !== null && mode.kind === "edit" && toolChanges === drag.changes && designDoc() === drag.before;
  }

  /**
   * The Select tool's press on a point that moved (`grab`), its moves
   * (`drag`) and its release (`drop`). A point that can't be dragged says
   * why and nothing moves. The drag takes its turn behind the clicks,
   * deletes and drags before it (each on the document the last left, so a
   * second quick drag starts from the first one's result); its moves are
   * kept meanwhile, and each is solved toward from the last solved step,
   * the newest winning (pumpDrag); the release records one undo step
   * ("Move point"). Moves and a release go to the drag the press began
   * (`liveDrag`), never to one already let go.
   */
  function onPointDrag(pointer: SketchPointer) {
    if (mode.kind !== "edit") return;
    if (pointer.kind === "grab") {
      if (mode.tool.kind !== "select") return;
      if (liveDrag) cancelDrag(liveDrag); // a press whose release never came (the view lost it): it comes to nothing
      const sketchId = mode.tool.sketch;
      const sketch = designDoc().sketches.find((s) => s.id === sketchId);
      const pointId = pointer.grab === undefined ? undefined : grabbable[pointer.grab];
      const point = pointId === undefined ? undefined : sketch?.points.find((p) => p.id === pointId);
      // A point a delete has taken since it was drawn: nothing to drag (the delete may still be in line, and then the drag waits for it).
      const problem = !sketch || pointId === undefined ? "" : point ? grabProblem(sketch, pointId) : null;
      if (problem === "") return void (viewport.element.dataset.pointDrags = String(++dragsEnded));
      sketchBox.showError(problem ?? "");
      // Refused: nothing moves, and the drag counts as ended at once (its moves and release go nowhere).
      if (problem !== null) return void (viewport.element.dataset.pointDrags = String(++dragsEnded));
      let finished = () => {};
      const done = new Promise<void>((resolve) => (finished = resolve));
      const drag: PointDrag = { sketch: sketchId, point: pointId!, before: null, doc: null, want: null, pixel: pointer.pixel, running: false, dropped: null, changes: toolChanges, ended: false, finished };
      liveDrag = drag;
      inTurn(async () => {
        // Its turn: what came before it has landed. Gone with the sketch, the tool, or the point (a delete before it took it): it comes to nothing.
        const now = designDoc();
        const there = now.sketches.find((s) => s.id === sketchId)?.points.some((p) => p.id === pointId);
        if (drag.ended || mode.kind !== "edit" || toolChanges !== drag.changes || !there || drag.dropped === "cancel") return endDrag(drag);
        drag.before = drag.doc = now;
        pointDrag = drag;
        void pumpDrag(drag);
        await done;
      });
      return;
    }
    const drag = liveDrag;
    if (!drag) return;
    if (pointer.at) drag.want = pointer.at;
    if (pointer.pixel !== undefined) drag.pixel = pointer.pixel;
    if (pointer.kind === "drop") {
      drag.dropped = pointer.cancelled ? "cancel" : "drop";
      liveDrag = null;
    }
    void pumpDrag(drag);
  }

  /** A drag called off (Escape, the sketch left, a new press): nothing it did is kept. */
  function cancelDrag(drag: PointDrag) {
    drag.dropped = "cancel";
    if (liveDrag === drag) liveDrag = null;
    endDrag(drag);
  }

  /** Solves a drag toward its newest pointer, one at a time, each from the last solved step, and records it once let go. */
  async function pumpDrag(drag: PointDrag) {
    if (drag.running || drag.before === null || drag.ended) return;
    drag.running = true;
    try {
      while (!drag.ended) {
        if (!dragStillFor(drag)) return endDrag(drag);
        const to = drag.want;
        if (to === null) return drag.dropped ? await finishDrag(drag) : undefined;
        drag.want = null;
        const stale = () => !dragStillFor(drag);
        try {
          const got = await dragTo(kernel, drag.doc, drag.sketch, drag.point, to, drag.pixel, () => drag.want !== null || stale(), (doc) => {
            if (stale()) return;
            drag.doc = doc;
            // Counted on the view at once: the drag's end (pointDrags) can be said before this loop's finally runs.
            viewport.element.dataset.dragSolves = String(++dragSolves);
            drawSketches();
          }, drag.before);
          if (stale()) return endDrag(drag);
          drag.doc = got.doc;
          sketchBox.showError(got.refused ?? "");
        } catch (e) {
          sketchBox.showError(e instanceof Error ? e.message : String(e));
        }
        drawSketches();
      }
    } finally {
      drag.running = false;
      viewport.element.dataset.dragSolves = String(dragSolves);
    }
  }

  /** A drag let go: nothing recorded for one called off or that moved nothing; else settled as a click is (an extrude it breaks keeps its shape) and recorded as one undo step. */
  async function finishDrag(drag: PointDrag & { before: DesignDocument; doc: DesignDocument }) {
    if (drag.dropped === "cancel" || drag.doc === drag.before) return endDrag(drag);
    let next: DesignDocument;
    try {
      next = await settleKept(kernel, drag.before, drag.doc, bodies);
    } catch (e) {
      sketchBox.showError(e instanceof Error ? e.message : String(e));
      return endDrag(drag);
    }
    if (!dragStillFor(drag)) return endDrag(drag);
    pointDrag = null;
    applySketchEdit(next, SKETCH_STEPS.move, drag.sketch);
    endDrag(drag);
    await showOutline();
  }

  /** The drag over (once): what it showed goes unless it was recorded, and its turn in line ends. */
  function endDrag(drag: PointDrag) {
    if (drag.ended) return;
    drag.ended = true;
    if (pointDrag === drag) pointDrag = null;
    viewport.element.dataset.pointDrags = String(++dragsEnded);
    drag.finished();
    if (!putAway) drawSketches();
  }

  /**
   * Enter in a dimension's box (47e): the dimension added with the value
   * typed (the size as drawn when nothing is), or the double-clicked one
   * changed to it, as one undo step ("Dimension", "Change dimension"); a
   * size the solver can't reach, or one that fights the others, is refused
   * with the reason, the box keeping what was typed.
   */
  function placeDimension() {
    if (mode.kind !== "edit" || !isConstraintTool(mode.tool) || !mode.tool.pending) return;
    const tool = mode.tool;
    const pending = tool.pending!;
    const field = typedFields(tool)[0];
    const texts = typed.texts();
    // A box holding text it refused keeps the keys there: its reason shows under it.
    if ((texts[field] ?? "").trim() !== "" && locks[field] === undefined) return;
    const value = locks[field] ?? pending.value;
    const changes = toolChanges;
    mode.tool = { ...tool, pending: null, changing: undefined };
    unlock();
    drawSketches();
    // Refused: the box opens again with the value typed, so it can be corrected (the solver bug hunt, 2026-11-06: it closed and lost it).
    const reopen = () => {
      if (mode.kind === "edit" && isConstraintTool(mode.tool) && !mode.tool.pending) mode.tool = { ...mode.tool, pending: { ...pending, value }, pendingField: tool.pendingField, changing: tool.changing };
    };
    if (tool.changing === undefined) return constrain(tool.sketch, { ...pending, value } as NewConstraint, reopen);
    const id = tool.changing;
    inTurn(async () => {
      if (mode.kind !== "edit" || toolChanges !== changes) return;
      const before = designDoc();
      let got: Awaited<ReturnType<typeof changeDimension>>;
      try {
        got = await changeDimension(kernel, before, tool.sketch, id, value);
        // Settled as a constraint is (`constrain`): an extrude whose outline the new size spoils keeps its last shape.
        if (!("refused" in got)) got = { ...got, doc: await settleKept(kernel, before, got.doc, bodies) };
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      if (mode.kind !== "edit" || toolChanges !== changes || designDoc() !== before) return;
      if ("refused" in got) {
        if (isConstraintTool(mode.tool)) mode.tool = { ...mode.tool, fighting: got.fighting };
        reopen();
        drawSketches();
        return sketchBox.showError(got.refused);
      }
      applySketchEdit(got.doc, SKETCH_STEPS.redimension, tool.sketch);
      drawSketches();
      await showOutline();
    });
  }

  /** Gives the keys to the first typed box after the click a tap makes (47e), or after 400 ms when none comes. */
  function keysAfterTap() {
    const changes = toolChanges;
    let done = false;
    const heard = new AbortController(); // taken off when given, so no click listener outlives the tap (or this workspace)
    const give = () => {
      if (done) return;
      done = true;
      heard.abort();
      if (mode.kind === "edit" && toolChanges === changes && typedFields(mode.tool).length > 0) typed.start("");
    };
    viewport.element.ownerDocument.addEventListener("click", give, { capture: true, once: true, signal: heard.signal });
    setTimeout(give, 400);
  }

  /** A dimension's label double-clicked, or tapped with the Dimension tool (47e): the Dimension tool changing it, its value in the box. */
  function editDimension(id: string) {
    if (mode.kind !== "edit" || pointDrag || liveDrag) return;
    const sketchId = mode.tool.sketch;
    const sketch = designDoc().sketches.find((s) => s.id === sketchId);
    const next = sketch && changeDimensionTool(sketch, id);
    if (!next) return;
    if (editingSketch) editingSketch.tool = "dimension";
    toolChanges++;
    mode.tool = next;
    mode.snap = null;
    sketchBox.showTool("dimension");
    sketchBar.showTool("dimension");
    sketchBox.showError("");
    unlock();
    drawSketches();
    typed.start("");
  }
  // A label's double-click, or its tap with the Dimension tool; heard from `listen` to `sleep` only, since the view's
  // element outlives this workspace (a listener left on it kept every closed workspace's panels in memory).
  const onLabelDblclick = (e: MouseEvent) => {
    const label = e.target instanceof Element ? e.target.closest<HTMLElement>(".sketch-label") : null;
    if (label?.dataset.dimension) editDimension(label.dataset.dimension);
  };
  const onLabelClick = (e: MouseEvent) => {
    const label = e.target instanceof Element ? e.target.closest<HTMLElement>(".sketch-label") : null;
    if (label?.dataset.dimension && mode.kind === "edit" && mode.tool.kind === "dimension") editDimension(label.dataset.dimension);
  };

  function constrain(sketchId: string, add: NewConstraint, refused: () => void = () => {}) {
    const changes = toolChanges;
    inTurn(async () => {
      if (mode.kind !== "edit" || !isConstraintTool(mode.tool) || toolChanges !== changes) return;
      const before = designDoc();
      let got: Awaited<ReturnType<typeof addConstraint>>;
      try {
        got = await addConstraint(kernel, before, sketchId, add);
        // Settled as a drag or a delete is before it is recorded (timeline hunt 2026-11-11): an extrude whose outline
        // the solved sketch no longer makes keeps its last shape, and one whose outline it closes again forgets it.
        if (!("refused" in got)) got = { ...got, doc: await settleKept(kernel, before, got.doc, bodies) };
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      if (mode.kind !== "edit" || !isConstraintTool(mode.tool) || toolChanges !== changes || designDoc() !== before) return;
      if ("refused" in got) {
        mode.tool = { ...mode.tool, fighting: got.fighting };
        refused();
        drawSketches();
        return sketchBox.showError(got.refused);
      }
      applySketchEdit(got.doc, constraintStep(add.kind), sketchId);
      drawSketches();
      await showOutline();
    });
  }

  /**
   * Delete (the key, Backspace or the sketch toolbar's button) with the Select
   * tool's picks: they go from the sketch as one undo step ("Delete line",
   * "Delete 3 curves"), in turn behind the clicks before it, settled as a
   * click is, so an extrude whose outline this breaks keeps its last shape
   * (the owner's rule, rebuild.ts). False when nothing is picked, so the key
   * does what it would.
   */
  /**
   * Construction (47f: X, or the sketch toolbar's button) with the Select
   * tool's picks: they become construction curves, or ordinary ones again
   * when every one already is (construction.ts), as one undo step, settled
   * as a delete is (an extrude whose outline this breaks keeps its last
   * shape). The picks stay, so a second press turns them back. False when
   * nothing is picked, so the key does what it would.
   */
  function constructPicked(): boolean {
    if (mode.kind !== "edit" || mode.tool.kind !== "select") return false;
    const sketchId = mode.tool.sketch;
    if (stillPicked(designDoc().sketches.find((s) => s.id === sketchId), mode.tool.picked).length === 0) return false;
    const changes = toolChanges;
    inTurn(async () => {
      if (mode.kind !== "edit" || mode.tool.kind !== "select" || toolChanges !== changes) return;
      const before = designDoc();
      const ids = stillPicked(before.sketches.find((s) => s.id === sketchId), mode.tool.picked);
      if (ids.length === 0) return;
      const turned = toggleConstruction(before, sketchId, ids);
      if ("refused" in turned) return sketchBox.showError(turned.refused);
      let next: DesignDocument;
      try {
        next = await settleKept(kernel, before, turned.doc, bodies);
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      if (mode.kind !== "edit" || mode.tool.kind !== "select" || toolChanges !== changes || designDoc() !== before) return;
      sketchBox.showError("");
      applySketchEdit(next, turned.step, sketchId);
      drawSketches();
      await showOutline();
    });
    return true;
  }

  function deletePicked(): boolean {
    if (mode.kind !== "edit" || mode.tool.kind !== "select") return false;
    const sketchId = mode.tool.sketch;
    if (stillPicked(designDoc().sketches.find((s) => s.id === sketchId), mode.tool.picked).length === 0) return false;
    const changes = toolChanges;
    inTurn(async () => {
      if (mode.kind !== "edit" || mode.tool.kind !== "select" || toolChanges !== changes) return;
      const before = designDoc();
      const sketch = before.sketches.find((s) => s.id === sketchId);
      const ids = stillPicked(sketch, mode.tool.picked);
      if (ids.length === 0) return;
      let next: DesignDocument;
      try {
        next = await settleKept(kernel, before, deleteCurves(before, sketchId, ids), bodies);
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      // Undo, Escape or a tool change while the kernel looked: the delete was for a sketch no longer there.
      if (mode.kind !== "edit" || mode.tool.kind !== "select" || toolChanges !== changes || designDoc() !== before) return;
      mode.tool = { ...mode.tool, picked: [], hover: null };
      sketchBox.showError("");
      applySketchEdit(next, deleteStep(sketch, ids), sketchId);
      drawSketches();
      await showOutline();
    });
    return true;
  }

  // Extrude (step 21d; UX1b, Fusion's feel): click a closed sketch in the view (or its row in the
  // browser), see the extrude as OK would make it, drag its arrow or type the distance; OK when the
  // kernel says the outline closes. Nothing is recorded until OK, as one undo step.
  /**
   * While the Extrude panel is open: the sketches it can use (before the
   * marker, not suppressed), the one chosen, the closed outlines offered in
   * the view, the distance (signed mm; null while the box holds none), the
   * chosen sketch's extrude going 1 mm (`previewSpec` turns it into any
   * distance; worked out once per sketch and document, so a drag never asks
   * for the outline again), the preview built and its arrow.
   */
  let extruding: {
    usable: ReadonlySet<string>;
    /** The flat faces of the bodies on screen it can use (UX1c), by face name, each with its sketch of the face's edges (face-extrude.ts). */
    faces: ReadonlyMap<string, FaceProfile>;
    /** The flat faces not offered, by name, with why (a face with holes until step 48). */
    refusedFaces: ReadonlyMap<string, string>;
    /** A face selected before Extrude (Fusion: select, then the command): chosen once it is offered. */
    wanted: string | null;
    /** The sketch or face chosen (a face by its name). */
    sketch: string | null;
    /** The kernel said the chosen sketch's outline closes (checkExtrude): only then is a preview built. */
    closed: boolean;
    /** The design the chosen sketch's outline was last checked in: a newer one checks and previews it again (`offerProfiles`). */
    checked: DesignDocument | null;
    offered: OfferedProfile[];
    /** Step 48: every sketch region offered, by its id in the view (extrude-regions.ts `offerId`). */
    regions: ReadonlyMap<string, RegionOffer>;
    /** The region of the chosen sketch picked (its id in the view, drawn chosen) and what its extrude saves; null while none is. */
    offer: string | null;
    region: RegionRef | null;
    distance: number | null;
    base: { doc: DesignDocument; sketch: string; region: RegionRef | null; spec: BodySpec } | null;
    preview: BodyView | null;
    arrow: ExtrudeArrow | null;
    /** Fusion's Operation (only with Combine shown): a new body, or Join, Cut or Intersect with the bodies listed and ticked. */
    operation: ExtrudeOperation;
    /** The bodies listed for Join, Cut or Intersect (those the preview reaches), and those unticked while the panel is open. */
    choices: BodyChoice[];
    unticked: Set<string>;
    /** The profiles picked after the first (Ctrl, Cmd or Shift click, or Pick several; Design data version 18), each a new array when they change. */
    more: PickedProfile[];
    /** Each of those profiles' extrude going 1 mm, by its id in the view, in the design it was worked out in. */
    moreBases: Map<string, { doc: DesignDocument; spec: BodySpec }>;
    /** Pick several is on (a phone's Ctrl): every tap adds or takes away a profile. */
    pickMany: boolean;
  } | null = null;
  const extrudeBox = extrudePanel(ctx.properties, {
    distance: (typed) => extrudeDistance(signedDistance(typed)),
    flip: (typed) => extrudeDistance(signedDistance(typed)),
    clear: () => chooseProfile(null),
    ok: (typed) => void ctx.history.hold(finishExtrude(typed)),
    cancel: () => leaveExtrude(),
    operation: (op) => {
      if (!extruding) return;
      extruding.operation = op;
      extrudeBox.showError("");
      showOperationBodies();
      showExtrudeView();
    },
    tick: (body, on) => {
      if (!extruding) return;
      if (on) extruding.unticked.delete(body);
      else extruding.unticked.add(body);
      showOperationBodies();
    },
    several: (on) => {
      if (extruding) extruding.pickMany = on;
    },
  });
  /**
   * Join, Cut or Intersect chosen: the bodies on screen the preview reaches,
   * as Fusion lists them, ticked unless unticked, and what OK will do (OK
   * off with none ticked). Listed again with each new preview.
   */
  function showOperationBodies() {
    const e = extruding;
    if (!e || e.operation === "new") return;
    const listed = (lastScene?.bodies ?? []).map((b) => ({ body: b.body, label: `Body ${b.place}`, bounds: b.view.bounds }));
    e.choices = e.preview === null ? [] : bodyChoices(e.preview.bounds, listed, e.unticked);
    const note = e.preview === null ? { text: OPERATION_WAITS, ready: false } : operationNote(e.operation, e.choices);
    extrudeBox.showBodies(e.choices, note.text, note.ready);
  }
  const sketchLabel = (id: string) => sketchItem(designDoc(), id).provenance.self.label;
  /** What the chosen `id` extrudes: a sketch of the design, or a face's sketch in the design it was offered in (UX1c). */
  const sourceOf = (id: string): { doc: DesignDocument; sketch: string; label: string; face: FaceProfile | null } => {
    const face = extruding?.faces.get(id) ?? null;
    return face ? { doc: face.doc, sketch: face.sketch, label: face.label, face } : { doc: designDoc(), sketch: id, label: sketchLabel(id), face: null };
  };

  /**
   * Extrude: like Finish sketch first when a sketch is being drawn (that
   * sketch is the one chosen); else a sketch selected in the browser (picked
   * before the command, as in Fusion); else the newest. Every usable
   * sketch's closed outline is offered in the view to click.
   */
  function startExtrude() {
    if (holdUnfinished("Extrude")) return;
    leaveEdit();
    leaveMove();
    leaveCombine();
    extrudeOpenings++;
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    const editing = mode.kind === "edit" ? mode.tool.sketch : null;
    if (mode.kind !== "none") leaveSketch();
    // Extrude from inside a sketch: back to the home view, as Finish Sketch does, so the person sees what the extrude makes (Ben 11-05).
    if (editing !== null) viewport.setView("home");
    // Only sketches an extrude put in at the marker can use: before it, and not suppressed (hunt 2026-10-21).
    const sketches = doc ? doc.timeline.features.filter(isSketchItem) : [];
    const items = doc ? sketches.filter((f) => !f.suppressed && doc.timeline.features.indexOf(f) < insertAt(doc)) : [];
    const selected = ctx.selection.items.length === 1 ? readProfileReference(ctx.selection.items[0]) : null;
    // A flat face selected first is chosen once it is offered (UX1c); meanwhile nothing is.
    const wanted = editing === null && ctx.selection.items.length === 1 && ctx.selection.items[0].kind === "face" ? String(ctx.selection.items[0].id) : null;
    const chosen = items.find((f) => f.id === editing)?.id ?? items.find((f) => f.id === selected)?.id ?? (wanted ? undefined : items.at(-1)?.id) ?? null;
    extruding = { usable: new Set(items.map((f) => f.id)), faces: new Map(), refusedFaces: new Map(), wanted, sketch: chosen, closed: false, checked: null, offered: [], regions: new Map(), offer: null, region: null, distance: DEFAULT_DISTANCE, base: null, preview: null, arrow: null, operation: "new", choices: [], unticked: new Set(), more: [], moreBases: new Map(), pickMany: false };
    leaveExplode(); // a tool works on the bodies where they are
    extrudeBox.show(chosen ? sketchLabel(chosen) : null, String(DEFAULT_DISTANCE), combineShown());
    // No usable sketch: say why (a body's flat faces are still offered to click, UX1c); with no sketch at all and a body, just how to pick.
    if (items.length > 0 ? !chosen : sketches.length === 0 && (lastScene?.bodies.length ?? 0) > 0) extrudeBox.showStatus(PICK_PROFILE_STATUS, false);
    else if (items.length === 0) extrudeBox.showStatus(sketches.length > 0 ? NO_USABLE_SKETCH : NO_SKETCH, false);
    showExtrudeView();
    if (doc) void offerProfiles(doc, items.map((f) => f.id));
    if (chosen) void checkExtrude(chosen);
  }

  /** Each opening and closing of the Extrude panel counted: an OK whose build lands after it changed is out of date (bug hunt 11-04, E2). */
  let extrudeOpenings = 0;
  function leaveExtrude() {
    extrudeOpenings++;
    extruding = null;
    extrudeBox.hide();
    viewport.showExtrude(null);
  }

  /** What the view shows while Extrude is open: the outlines offered, the chosen one, the preview and its arrow at the distance now. */
  function showExtrudeView() {
    // Asleep or put away (an Undo before a preview build answered), the view is not this Design's to draw on (app hunt 2026-11-04).
    if (!shown) return;
    const e = extruding;
    // Edit feature's regions (48d4) stay drawn while it is open.
    if (!e) return editRegions !== null ? showEditRegions() : viewport.showExtrude(null);
    const arrow = e.arrow && e.distance !== null ? { ...e.arrow, distance: e.distance } : null;
    viewport.showExtrude({ profiles: e.offered, chosen: e.offer ?? e.sketch, ...(e.more.length > 0 ? { alsoChosen: e.more.map((m) => m.id) } : {}), preview: e.preview?.mesh ?? null, arrow, ...(e.operation === "cut" ? { cut: true } : {}) });
    // Read by the tests: the sketches it can use, the one chosen (and its region picked), and the volume of the body OK would make, as the kernel worked it out.
    const box = ctx.properties.querySelector<HTMLElement>("#extrude-panel");
    if (box) Object.assign(box.dataset, { usable: [...e.usable].join(" "), faces: [...e.faces.keys()].join(" "), chosen: e.sketch ?? "", region: e.offer ?? "", more: e.more.map((m) => m.id).join(" "), previewVolume: e.preview ? String(e.preview.volume) : "" });
  }

  /**
   * Every usable sketch that makes a closed outline, then every flat face of
   * the bodies on screen whose edges do (UX1c), offered to click (asked of
   * the kernel at once, none waiting on another). Sketches come first, so a
   * sketch drawn on a face wins a click on both.
   */
  async function offerProfiles(doc: DesignDocument, ids: readonly string[]) {
    const scene = lastScene;
    const faces = new Map<string, FaceProfile>();
    const refusedFaces = new Map<string, string>();
    for (const f of sketchableFaces(scene)) {
      const made = faceProfile(doc, scene, f);
      if (made !== null && !("refused" in made)) faces.set(made.face, made);
    }
    // A face with holes (48d2) is offered as the region of its edges that is the face, holes and all; a face whose edges make
    // no such region is not offered, and a click on it says why.
    const faceOffers = Promise.all([...faces.values()].map(async (f): Promise<OfferedProfile | null> => {
      try {
        const sketch = f.doc.sketches.find((s) => s.id === f.sketch)!;
        const out = await askOutline(kernel, sketchCurves(sketch));
        if ("closed" in out) return { id: f.face, plane: f.plane, outline: out.closed, face: true };
        const region = /separate loops/.test(out.open) ? await faceRegion(kernel, f, sketch) : { refused: faceOpen(out.open) };
        if ("outline" in region) {
          faces.set(f.face, { ...f, region: region.ref });
          return { id: f.face, plane: f.plane, outline: region.outline, face: true };
        }
        refusedFaces.set(f.face, region.refused);
      } catch (e) {
        refusedFaces.set(f.face, `This face can't be extruded: ${e instanceof Error ? e.message : String(e)}`);
      }
      return null;
    }));
    // Every region of every usable sketch (step 48), each shaded to click; the ones that can't be extruded marked.
    const offered = (
      await Promise.all(ids.map(async (id): Promise<RegionOffer[]> => {
        const sketch = doc.sketches.find((s) => s.id === id);
        if (!sketch) return [];
        try {
          return (await regionOffers(kernel, sketch, sketchPlane(doc, id, placedNow))).offers;
        } catch {
          return []; // a sketch the kernel refuses is not offered; its status says why when it is chosen
        }
      }))
    ).flat();
    const facesOffered = (await faceOffers).filter((p) => p !== null);
    if (!extruding || designDoc() !== doc) return;
    extruding.offered = [...offered, ...facesOffered];
    extruding.regions = new Map(offered.map((o) => [o.id, o]));
    // The region picked keeps its place in the view by its curves (an id in the view can move when a region comes or goes).
    if (extruding.sketch !== null && extruding.region !== null) extruding.offer = offerOf(offered, extruding.sketch, extruding.region)?.id ?? null;
    // So do the others picked (version 18); one gone from the design is let go.
    const more = extruding.more.flatMap((m) => {
      const o = m.region === null ? undefined : offerOf(offered, m.sketch, m.region);
      return o === undefined || o.refused !== undefined ? [] : [{ ...m, id: o.id }];
    });
    if (more.length !== extruding.more.length || more.some((m, k) => m.id !== extruding!.more[k].id)) {
      extruding.more = more;
      showPicks();
      refreshPreview();
    }
    const before = extruding.faces;
    extruding.faces = new Map(facesOffered.map((p) => [p.id, faces.get(p.id)!]));
    extruding.refusedFaces = refusedFaces;
    // Offered again from a newer scene: a face chosen from the old one is checked and previewed again from its new
    // outline, or let go if this scene has no such flat face.
    const was = extruding.sketch;
    if (was !== null && before.has(was)) {
      if (!extruding.faces.has(was)) chooseProfile(null);
      else if (before.get(was) !== extruding.faces.get(was)) void checkExtrude(was);
    } else if (was !== null && extruding.usable.has(was) && extruding.checked !== null && extruding.checked !== doc) {
      // A sketch chosen before the design changed (a size typed: the face under it moved, its projected edges changed
      // shape): its outline is checked and previewed again, so OK makes the body shown (extrude hunt 2026-11-01).
      Object.assign(extruding, { closed: false, base: null, preview: null });
      void checkExtrude(was);
    }
    const wanted = extruding.wanted;
    extruding.wanted = null;
    if (wanted !== null && extruding.sketch === null && extruding.faces.has(wanted)) chooseProfile(wanted);
    else if (extruding.sketch === null && extruding.offered.length === 0 && ids.length === 0) extrudeBox.showStatus(doc.sketches.length > 0 ? NO_USABLE_SKETCH : NO_SKETCH, false);
    showExtrudeView();
  }

  /**
   * Another sketch chosen (a click in the view, its row in the browser, or ✕ for none): its preview and arrow start
   * again. The other profiles picked go (a plain click picks one, as Fusion's), unless `keepMore` (the first of
   * several taken away, `addProfile`).
   */
  function chooseProfile(id: string | null, keepMore = false) {
    const e = extruding;
    // A sketch region (step 48): its sketch is chosen with it; one that can't be extruded says why and changes nothing.
    const offer = id === null ? undefined : e?.regions.get(id);
    if (e && offer?.refused !== undefined) return void extrudeBox.showError(regionRefusedWords(sketchLabel(offer.sketch), offer.refused));
    const sketch = offer?.sketch ?? id;
    if (!e || (sketch !== null && !e.usable.has(sketch) && !e.faces.has(sketch))) return;
    const dropMore = !keepMore && e.more.length > 0;
    if (dropMore) e.more = [];
    if (e.sketch === sketch && (offer === undefined || e.offer === offer.id)) {
      if (dropMore) showPicks(), refreshPreview();
      return;
    }
    // A face with holes extrudes its region (48d2), saved like a sketch region's.
    Object.assign(e, { sketch, offer: offer?.id ?? null, region: offer?.ref ?? (sketch === null ? null : e.faces.get(sketch)?.region) ?? null, closed: false, checked: null, base: null, preview: null, arrow: null });
    id = sketch;
    extrudeBox.showProfile(picksLabel());
    extrudeBox.showError("");
    if (id) void checkExtrude(id);
    else extrudeBox.showStatus(PICK_PROFILE_STATUS, false);
    showExtrudeView();
  }

  /** The distance typed, flipped or dragged to (signed mm, null for none): the arrow moves at once, the preview follows. */
  function extrudeDistance(d: number | null) {
    const e = extruding;
    if (!e) return;
    e.distance = d;
    // Under 0.001 mm or over 1 km: refused in OK's words, never sent to the kernel (extrude hunt 2026-11-01).
    const refused = d === null ? null : distanceRefused(d);
    extrudeBox.showError(refused ?? "");
    if (d === null || refused !== null) e.preview = null;
    showExtrudeView();
    if (refused !== null) return;
    if (d !== null) refreshPreview();
  }

  // The pointer while Extrude is shown (UX1b): a click on an offered outline chooses it (one on
  // none keeps the choice, as Fusion does); the arrow dragged sets the distance in whole mm.
  const onExtrudePointer: SharedViewport["onExtrudePointer"] = (pointer) => {
    if (!extruding) {
      if (editRegions !== null && pointer.kind === "pick" && pointer.profile !== null) pickEditRegion(pointer.profile);
      return;
    }
    if (pointer.kind === "pick") {
      // Ctrl, Cmd or Shift held, or Pick several on: adds the profile, or takes it away (version 18).
      if (pointer.profile !== null && (pointer.add === true || extruding.pickMany)) return void addProfile(pointer.profile);
      if (pointer.profile !== null) return void chooseProfile(pointer.profile);
      // On no outline but on a face that can't be extruded (a curved one, one with holes): say why, keeping the choice.
      const made = pointer.face != null ? faceProfile(designDoc(), lastScene, pointer.face) : null;
      const why = made === null ? undefined : "refused" in made ? made.refused : extruding.refusedFaces.get(made.face);
      if (why) extrudeBox.showError(why);
      return;
    }
    extrudeBox.dragging(!pointer.done); // the distance box glows while the arrow is held
    const d = snapDistance(pointer.distance);
    if (d === extruding.distance) return;
    extrudeBox.showDistance(String(d));
    extrudeDistance(d);
  };

  /**
   * Builds the preview for the distance now, at most one at a time: a
   * change while one builds asks for one more after it, so a fast drag
   * never queues a build per pointer move. The built body is freed at once;
   * only its view is kept. A preview the kernel refuses (a distance too
   * long) shows why, and OK says it again.
   */
  let previewing = false;
  let previewAgain = false;
  function refreshPreview() {
    if (previewing) return void (previewAgain = true);
    previewing = true;
    void buildPreview().finally(() => {
      previewing = false;
      if (previewAgain) {
        previewAgain = false;
        refreshPreview();
      }
    });
  }
  async function buildPreview() {
    const e = extruding;
    const id = e?.sketch;
    const d = e?.distance;
    if (!e || !id || !e.closed || d === null || d === undefined || distanceRefused(d) !== null) return;
    // A face's sketch lives in the design it was offered in (UX1c), a sketch in the design now.
    const { doc, sketch } = sourceOf(id);
    const region = e.region;
    try {
      if (e.base?.doc !== doc || e.base.sketch !== id || e.base.region !== region) {
        const made = extrudeSketch(doc, sketch, 1, false, region ?? undefined);
        const spec = await featureSpec(kernel, made.doc, made.doc.timeline.features.find((f) => f.id === made.id)!);
        if (extruding !== e || e.sketch !== id || e.region !== region) return;
        e.base = { doc, sketch: id, region, spec };
      }
      // At 0 mm (where Extrude starts) nothing is drawn, but the arrow still stands on the profile: it is found from a 1 mm build.
      const at = d === 0 ? 1 : d;
      const viewOf = async (spec: BodySpec) => {
        const handle = await kernel.call("body_build", previewSpec(spec, at));
        return await kernel.call("body_view", handle).finally(() => void bodies.release(handle));
      };
      const first = await viewOf(e.base.spec);
      // The other profiles picked (version 18), each built as its own extrude and drawn with the first.
      const extras = e.more;
      const views = [first];
      for (const m of extras) {
        let b = e.moreBases.get(m.id);
        if (b?.doc !== doc) {
          const made = extrudeSketch(doc, m.sketch, 1, false, m.region ?? undefined);
          b = { doc, spec: await featureSpec(kernel, made.doc, made.doc.timeline.features.find((f) => f.id === made.id)!) };
          e.moreBases.set(m.id, b);
        }
        views.push(await viewOf(b.spec));
      }
      const view = joinedView(views);
      // Out of date: another sketch or region chosen or the panel closed. A newer distance only means another build follows.
      if (extruding !== e || e.sketch !== id || e.region !== region || e.more !== extras) return;
      // A distance refused since this build began (extrudeDistance said why) shows no preview under the words.
      e.preview = e.distance === null || d === 0 || distanceRefused(e.distance) !== null ? null : view;
      e.arrow = arrowOf(view, d === 0 ? 1 : d) ?? e.arrow;
      showOperationBodies();
    } catch (err) {
      // Out of date too when another region was picked since (48d hunt): its words are not this one's.
      if (extruding !== e || e.sketch !== id || e.region !== region || e.distance !== d) return;
      // A profile picked after the first that can't be built: let go of it, saying why (the first's preview builds again).
      if (e.more.length > 0) {
        e.more = [];
        showPicks();
        refreshPreview();
      }
      e.preview = null;
      extrudeBox.showError(err instanceof Error ? err.message : String(err));
    }
    showExtrudeView();
  }

  /** Says whether the chosen sketch makes a closed outline (OK on, and its preview built) or the kernel's reason it doesn't (OK off). */
  const extrudeOutline = latestOnly((curves: ReturnType<typeof sketchCurves>) => askOutline(kernel, curves));
  async function checkExtrude(id: string) {
    const source = sourceOf(id);
    const sketch = source.doc.sketches.find((s) => s.id === source.sketch);
    if (!sketch) return;
    const name = source.label;
    if (extruding?.sketch === id) extruding.checked = source.doc;
    extrudeBox.showStatus(sketch.curves.length === 0 ? `${name} has nothing drawn yet.` : `Checking ${name}…`, false);
    if (sketch.curves.length === 0) return;
    // Only projected curves, none joining another: the outline leaves them all out, so the kernel would be asked about no
    // curves and say none are drawn (extrude hunt 2026-11-01); say why, as the sketch panel and the rebuild do.
    const projectedOnly = projectedOpen(sketch);
    if (projectedOnly !== null) return extrudeBox.showStatus(`${name} can't be extruded: ${projectedOnly}.`, false);
    try {
      if (!source.face) return await checkRegions(id, sketch, name);
      // A face with holes: the region that is the face was found when it was offered (48d2).
      if (source.face.region !== undefined) {
        if (extruding?.sketch !== id) return;
        Object.assign(extruding, { region: source.face.region, closed: true });
        extrudeBox.showStatus(`${name} makes a closed outline.${combineShown() ? "" : ` ${FACE_NEW_BODY}`}`, true);
        return refreshPreview();
      }
      const { current, value } = await onceMoreAfterRestart(() => extrudeOutline(sketchCurves(sketch)));
      if (!current || extruding?.sketch !== id) return;
      if ("closed" in value) {
        // A face's extrude is a new body until Combine (35f): said plainly (UX1c).
        extrudeBox.showStatus(`${name} makes a closed outline.${combineShown() ? "" : ` ${FACE_NEW_BODY}`}`, true);
        extruding.closed = true;
        refreshPreview();
      } else extrudeBox.showStatus(`${name} can't be extruded: it doesn't make one closed outline (${value.open}).`, false);
    } catch (e) {
      if (extruding?.sketch === id) extrudeBox.showStatus(`${name} can't be extruded: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  /**
   * A sketch chosen (step 48): its region picked, found again by its curves
   * (OK on, and its preview built); else its only region, picked for it (as
   * a sketch of one outline always was); else how many it has, to click
   * one; or the kernel's reason it has none (OK off). A region that can't
   * be extruded says why.
   */
  const extrudeRegions = latestOnly((sketch: Sketch, plane: Plane) => regionOffers(kernel, sketch, plane));
  async function checkRegions(id: string, sketch: Sketch, name: string) {
    const { current, value } = await onceMoreAfterRestart(() => extrudeRegions(sketch, sketchPlane(designDoc(), id, placedNow)));
    const e = extruding;
    if (!current || !e || e.sketch !== id) return;
    const { offers, why } = value;
    let offer = e.region === null ? undefined : offerOf(offers, id, e.region);
    if (offer === undefined && offers.length === 1) offer = offers[0];
    if (offer === undefined || offer.refused !== undefined) Object.assign(e, { offer: null, region: null });
    if (offer?.refused !== undefined) extrudeBox.showStatus(regionRefusedWords(name, offer.refused), false);
    else if (offer !== undefined) {
      Object.assign(e, { offer: offer.id, region: offer.ref, closed: true });
      extrudeBox.showStatus(e.more.length > 0 ? severalWords(e.more.length + 1) : offers.length === 1 ? `${name} makes a closed outline.` : regionChosenWords(name), true);
      refreshPreview();
    } else if (offers.length === 0) extrudeBox.showStatus(`${name} can't be extruded: it doesn't make one closed outline (${why ?? "it has no closed region"}).`, false);
    else extrudeBox.showStatus(pickRegionWords(name, offers.length), false);
    showExtrudeView();
  }

  /** The panel's profile row: the one profile's name, or "3 selected" for several (version 18). */
  function picksLabel(): string | null {
    const e = extruding;
    if (!e) return null;
    return pickedWords({ first: e.sketch === null ? null : { id: e.offer ?? e.sketch, sketch: e.sketch, region: e.region }, more: e.more }, e.sketch === null ? null : sourceOf(e.sketch).label);
  }

  /** The profiles picked shown again: the panel's row and, with several all closed, the status line. */
  function showPicks() {
    const e = extruding;
    if (!e) return;
    extrudeBox.showProfile(picksLabel());
    if (e.more.length > 0 && e.closed) extrudeBox.showStatus(severalWords(e.more.length + 1), true);
    showExtrudeView();
  }

  /**
   * A click with Ctrl, Cmd or Shift held, or any while Pick several is on
   * (version 18, Fusion's Ctrl-click): the sketch region is added to the
   * profiles picked, or taken away when picked already (`togglePick`); the
   * first taken away makes the next one first. A flat face extrudes alone
   * for now (`FACE_ALONE`), and a region that can't be extruded says why.
   */
  function addProfile(id: string) {
    const e = extruding;
    if (!e) return;
    const offer = e.regions.get(id);
    const faceFirst = e.sketch !== null && e.faces.has(e.sketch);
    if (offer === undefined || faceFirst) {
      if (e.sketch === null || (faceFirst && e.sketch === id)) return chooseProfile(e.sketch === id ? null : id);
      return void extrudeBox.showError(FACE_ALONE);
    }
    if (offer.refused !== undefined) return void extrudeBox.showError(regionRefusedWords(sketchLabel(offer.sketch), offer.refused));
    if (!e.usable.has(offer.sketch)) return;
    // A sketch chosen whose region isn't picked yet (it has several) counts as nothing picked.
    const first: PickedProfile | null = e.sketch === null || e.offer === null ? null : { id: e.offer, sketch: e.sketch, region: e.region };
    const next = togglePick({ first, more: e.more }, { id: offer.id, sketch: offer.sketch, region: offer.ref });
    extrudeBox.showError("");
    e.more = next.more;
    if (next.first?.id !== first?.id) return chooseProfile(next.first?.id ?? null, true);
    showPicks();
    refreshPreview();
  }

  /**
   * OK: the kernel builds the extrude first; only one that builds is
   * recorded, as one undo step ("Extrude Sketch 1"; a face's sketch and its
   * extrude together, "Extrude Face of Box 1", UX1c). A negative distance
   * goes the other way (recorded as Flip). A refused distance keeps the
   * panel open and says why.
   */
  async function finishExtrude(typed: string) {
    const id = extruding?.sketch;
    if (!id) return;
    const opened = extrudeOpenings;
    const distance = Number(typed);
    if (typed.trim() === "" || !Number.isFinite(distance)) return extrudeBox.showError("Type the distance in mm.");
    if (distance === 0) return extrudeBox.showError(ZERO_OK);
    // Under 0.001 mm or over 1 km, either way: the one rule for typed lengths, in short words (1e300 gave the kernel's
    // 350-character refusal, weak-spot hunt 10-29).
    const tooFar = lengthRefused(Math.abs(distance));
    if (tooFar !== null) return extrudeBox.showError(`The distance${tooFar.slice("A length".length)}`);
    const before = designDoc();
    const source = sourceOf(id);
    const region = extruding?.region ?? null;
    // A face offered in another design is out of date (that design changed since).
    if (source.face && source.face.from !== before) return;
    // Join, Cut or Intersect (with Combine shown): the bodies ticked, which the kernel's boolean must take (else the panel says why).
    const operation = extruding?.operation ?? "new";
    const choice = operation === "new" ? null : { operation, bodies: tickedBodies(extruding?.choices ?? []) };
    // The other profiles picked (version 18), as the extrude saves them.
    const picked = extruding?.more ?? [];
    if (choice !== null && picked.length > 0) return extrudeBox.showError(ONE_PROFILE_OPERATION);
    const more = picked.map((m) => ({ sketch: m.sketch, ...(m.region ? { region: m.region } : {}) }));
    if (choice !== null && choice.bodies.length === 0) return extrudeBox.showError(`Tick a body to ${operation === "join" ? "join to" : operation} first.`);
    let made: ReturnType<typeof extrudeSketch>;
    let misses: Miss[] = [];
    try {
      made = extrudeSketch(source.doc, source.sketch, Math.abs(distance), distance < 0, region ?? undefined, choice, more);
      await buildSpec(kernel, await featureSpec(kernel, made.doc, made.doc.timeline.features.find((f) => f.id === made.id)!));
      // Several profiles are joined only in the rebuild (SL #611 C1): the whole item is built before it is recorded.
      if (choice !== null || more.length > 0) {
        const checked = await onceMoreAfterRestart(() => checkedItem(kernel, made.doc, made.id));
        if (checked.refused !== null) throw new Error(checked.refused);
        misses = checked.misses;
      }
    } catch (e) {
      if (extrudeOpenings === opened && extruding?.sketch === id && extruding.region === region && extruding.more === picked) extrudeBox.showError(e instanceof Error ? e.message : String(e));
      return;
    }
    // A Cut or Join that reaches nothing (#521): asked first, as a Combine's; Cancel leaves the panel open.
    if (choice !== null && choice.operation !== "intersect" && misses.length > 0 && extrudeOpenings === opened && extruding?.sketch === id && extruding.region === region && designDoc() === before) {
      if (!(await askExtrudeMisses(made.doc, made.id, choice.operation, misses))) return;
    }
    // Closed or opened again, another sketch chosen, or something else changed the design, while the kernel worked: this extrude is out of date.
    // Another region of the sketch picked meanwhile is another sketch chosen (48d hunt): the one picked last is what OK makes.
    if (extrudeOpenings !== opened || extruding?.sketch !== id || extruding.region !== region || extruding.more !== picked || designDoc() !== before) return;
    leaveExtrude();
    shape = "sketch-extrude";
    inputs[SIZE_KEYS.indexOf("height")].value = String(Math.abs(distance));
    boxesPart = made.id;
    // Recorded as update starts (before its first wait), so the Undo held for this OK (`hold`) can go while it shows.
    // SL #611 C6: every sketch its profiles come from is hidden, not only the first's.
    const madeItem = made.doc.timeline.features.find((x) => x.id === made.id)!;
    const hidden = extrudeSketches(madeItem).reduce((d, sk) => usedSketchHidden(d, sk), made.doc);
    void update(source.face ? `Extrude ${source.label}` : extrudeStep(before, id), undefined, hidden);
  }

  /** Asks whether to record operation extrude `id` of `doc` whose Cut or Join changes nothing (#521); true to record. */
  function askExtrudeMisses(doc: DesignDocument, id: string, op: "cut" | "join", misses: readonly Miss[]): Promise<boolean> {
    const f = doc.timeline.features.find((x) => x.id === id)!;
    const own = bodyIdOf(id);
    const label = f.provenance.self.label;
    const name = bodyNamer(doc, (b) => {
      if (b === own) return label;
      const item = doc.timeline.features.find((x) => x.id === bodyItem(b));
      return item === undefined ? b : isPiece(b) ? `a piece of ${itemName(item)}` : itemName(item);
    });
    return missAsk.ask(askWords(op, misses, name, { kind: "extrude", label, own }));
  }

  /** What the bodies list says before the preview shows where the extrude reaches. */
  const OPERATION_WAITS = "Type a distance or drag the arrow: the bodies the extrude reaches are listed here.";

  // Edit feature (step 25a2): an earlier feature's sizes from its timeline item or browser row.
  const editBox = featureEditPanel(ctx.properties, {
    ok: (typed, flip) => void ctx.history.hold(finishEdit(typed, flip)),
    cancel: () => leaveEdit(),
    operation: (op) => {
      if (editOps === null) return;
      editOps.operation = op;
      showEditBodies();
    },
    tick: (body, on) => {
      if (editOps === null) return;
      if (on) editOps.unticked.delete(body);
      else editOps.unticked.add(body);
      showEditBodies();
    },
    sizes: (typed, flip) => void reachAgain(typed, flip),
  });
  /**
   * Edit feature on an extrude of a sketch with Combine shown: its operation
   * as Extrude's panel has it, the bodies built before it (each with its box)
   * and its own body's box, found once the panel opens (null meanwhile); the
   * bodies its operation uses are ticked, any of the others reached unticked.
   */
  let editOps: { id: string; operation: ExtrudeOperation; candidates: ListedBody[] | null; own: Bounds | null; kept: Set<string>; unticked: Set<string>; choices: BodyChoice[]; asked: number } | null = null;
  /** The bodies an edited extrude can work on, and what OK will do, in the Edit panel. */
  function showEditBodies() {
    const e = editOps;
    if (e === null || e.operation === "new") return;
    if (e.candidates === null || e.own === null) return editBox.showBodies([], "Finding the bodies the extrude reaches…", false);
    e.choices = bodyChoices(e.own, e.candidates, e.unticked, e.kept);
    const note = operationNote(e.operation, e.choices);
    editBox.showBodies(e.choices, note.text, note.ready);
  }
  /**
   * The bodies built just before extrude `id` (the design rolled back to the item before it, on a body store of its own)
   * with their boxes, and its own body's box; the bodies its operation uses ticked, the rest unticked. Shown when the
   * Edit panel is still on it.
   */
  async function loadEditBodies(id: string) {
    const doc = designDoc();
    const at = doc.timeline.features.findIndex((f) => f.id === id);
    const f = doc.timeline.features[at];
    const rolled: DesignDocument = { ...doc, timeline: { ...doc.timeline, marker: at === 0 ? "start" : doc.timeline.features[at - 1].id } };
    const store = new BodyCache(kernel);
    let found: { candidates: ListedBody[]; own: Bounds } | null = null;
    try {
      const build = await rebuildTimeline(rolled, store, kernel);
      const numbers = bodyNumbers(doc);
      const candidates = await Promise.all(Object.entries(build.bodies).map(async ([body, b]) => ({ body, label: `Body ${numbers.get(body) ?? "?"}`, bounds: (await store.view(b.handle)).bounds })));
      found = { candidates, own: await ownBox(doc, f) };
    } catch {
      // Its sketch makes no outline now, or the kernel refused: no list, and Join, Cut or Intersect can't be picked anew.
      found = { candidates: [], own: [[0, 0, 0], [0, 0, 0]] };
    } finally {
      await store.close();
    }
    const e = editOps;
    if (e === null || e.id !== id || editBox.editing !== id || designDoc() !== doc) return;
    const saved = extrudeOperation(f)?.bodies ?? null;
    // Its own bodies first in their order, reached or not; the others reached, unticked when it already has bodies.
    const listed = [...(saved ?? []).map((b) => found.candidates.find((c) => c.body === b) ?? { body: b, label: `Body ${bodyNumbers(doc).get(b) ?? "?"}`, bounds: found.own }), ...found.candidates.filter((c) => !(saved ?? []).includes(c.body))];
    e.candidates = listed;
    e.own ??= found.own;
    e.kept = new Set(saved ?? []);
    if (saved !== null) for (const c of found.candidates) if (!saved.includes(c.body)) e.unticked.add(c.body);
    showEditBodies();
  }

  /** The box round extrude `f`'s own body in `doc`, as the kernel builds it. */
  async function ownBox(doc: DesignDocument, f: Feature): Promise<Bounds> {
    return (await buildSpec(kernel, await featureSpec(kernel, doc, f))).bounds;
  }
  /**
   * A distance typed or Flip changed in the Edit panel: the extrude's own box found again at the sizes typed, so the list
   * holds the bodies it reaches now (as the new extrude's preview does); a size that can't be read or built leaves it as it was.
   */
  async function reachAgain(typed: Partial<Record<SizeKey, string>>, flip?: boolean) {
    const e = editOps;
    if (e === null) return;
    const asked = ++e.asked;
    const doc = designDoc();
    let own: Bounds;
    try {
      const read = readTyped(editableFeature(doc, e.id).keys, typed);
      if (!("sizes" in read)) return;
      const next = editFeature(doc, e.id, read.sizes, flip, editRegions?.id === e.id ? (editRegions.picked ?? undefined) : undefined);
      own = await ownBox(next, next.timeline.features.find((f) => f.id === e.id)!);
    } catch {
      return;
    }
    if (editOps !== e || e.asked !== asked || designDoc() !== doc) return;
    e.own = own;
    showEditBodies();
  }

  // Move (step 35e2b): a new Move of the bodies picked, or a Move's numbers edited from its timeline item.
  const moveBox = movePanel(ctx.properties, {
    typed: () => previewMove(),
    ok: (typed) => void ctx.history.hold(finishMove(typed)),
    cancel: () => leaveMove(),
    snap: () => (snapping ? stopSnap() : startSnap()),
    centre: () => void centreOfBodies(),
  });
  // Exploded view (explode.ts): a bar over the view with the spread and Done, while on.
  const explodeBar = viewport.element.ownerDocument.createElement("div");
  explodeBar.id = "explode-bar"; // read by the e2e test
  explodeBar.className = "explode explode-bar";
  explodeBar.hidden = true;
  const spreadLabel = viewport.element.ownerDocument.createElement("label");
  spreadLabel.className = "explode-bar-label";
  spreadLabel.textContent = "Spread";
  const spreadInput = viewport.element.ownerDocument.createElement("input");
  Object.assign(spreadInput, { id: "explode-spread", type: "range", min: "0", max: "100", step: "1", title: "How far apart the bodies are drawn: 0 where they are, 100 twice as far from the middle" });
  spreadLabel.append(spreadInput);
  const explodeDone = viewport.element.ownerDocument.createElement("button");
  Object.assign(explodeDone, { id: "explode-done", type: "button", textContent: "Done", title: "Back to the bodies where they are" });
  explodeDone.className = "explode-bar-done";
  explodeBar.append(spreadLabel, explodeDone);
  viewport.element.append(explodeBar);
  spreadInput.addEventListener("input", () => setExploded(readSpread(spreadInput.value)));
  explodeDone.addEventListener("click", () => setExploded(null));

  /** The bodies' mesh as the view draws it: pulled apart while Exploded view is on. */
  function bodyMesh(scene: Scene) {
    // A sketch being edited sees the bodies at its own place in the timeline (#540 item 1): drawn there too.
    const at = mode.kind === "edit" ? (sceneFor(mode.tool.sketch, scene) ?? scene) : scene;
    return explodeSpread === null ? editMesh(at) : explodedMesh(at, explodeSpread);
  }

  /**
   * Draws the bodies (pulled apart while Exploded view is on) and notes the box around them as drawn, in mm to 0.001,
   * "lo x y z hi x y z" (read by the e2e test: the view's pixels never hold still, so they can't say where the bodies are).
   */
  function showBodies(scene: Scene) {
    const mesh = bodyMesh(scene);
    viewport.showBody(mesh);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const p = mesh.positions;
    for (let n = 0; n + 2 < p.length; n += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[n + k] < lo[k]) lo[k] = p[n + k];
        if (p[n + k] > hi[k]) hi[k] = p[n + k];
      }
    }
    viewport.element.dataset.drawnBox = p.length < 3 ? "" : [...lo, ...hi].map((v) => v.toFixed(3)).join(" ");
  }

  /** Exploded view on at `spread`, or off (null): the view only, nothing recorded. */
  function setExploded(spread: number | null) {
    explodeSpread = spread;
    explodeButton.setAttribute("aria-pressed", String(spread !== null));
    explodeButton.disabled = spread === null && inspecting.noExplode() !== null;
    explodeBar.hidden = spread === null;
    if (spread !== null && spreadInput.ownerDocument.activeElement !== spreadInput) spreadInput.value = String(Math.round(spread * 100));
    viewport.element.dataset.exploded = spread === null ? "" : String(spread); // read by the e2e test
    if (lastScene) showBodies(lastScene);
    showPrintCheck();
  }

  /** Out of Exploded view, if on: a tool opening works on the bodies where they are. */
  function leaveExplode() {
    if (explodeSpread !== null) setExploded(null);
  }

  /** The bodies the Move panel moves (body ids, 35eb): the selection's, and an edited Move's hidden or unbuilt ones it still holds (35e2i). */
  let moveBodies: string[] = [];
  /** Whether the Move panel is picking its bodies: a new Move's, or since 35e2i an edited one's (a click adds a body or takes it out). */
  const picksBodies = () => moveBox.shown || (combineBox.shown && combineBox.editing === null);
  /** The picked bodies handed to the panel picking them. */
  const pickBodies = () => (moveBox.shown ? pickMoveBodies() : pickCombineBodies());
  /** Over the view while a new Move has no body yet: on a phone the panel's own words wait in the shut sheet, so the view stays clear to tap. */
  const moveHint = viewport.element.ownerDocument.createElement("p");
  moveHint.id = "move-hint"; // read by the e2e test
  moveHint.className = "move-panel-hint";
  moveHint.textContent = "";
  moveHint.hidden = true;
  viewport.element.append(moveHint);
  /** What the hint says while Snap picks (35e2d): first what to snap, then where it lands. */
  const SNAP_FROM = "Snap: click or tap a face or edge to move";
  const SNAP_TO = "Now click or tap where it lands, on another body";
  /** Words when a snap pick is on the wrong body. */
  const SNAP_NOT_MOVING = "Pick a face or edge of the bodies being moved first.";
  const SNAP_MOVING = "That body is being moved: pick where it lands on another body.";
  /** Snap (35e2d) while it picks: null when off, else the face or edge to snap once picked (on body `body`, as the scene shows it). */
  let snapping: { from: { body: string; part: SnapPart } | null } | null = null;
  function showMoveHint() {
    moveHint.textContent = snapping ? (snapping.from === null ? SNAP_FROM : SNAP_TO) : moveBox.kind === "rotate" ? "Rotate: click or tap the bodies to turn" : moveBox.kind === "scale" ? "Scale: click or tap the bodies to scale" : "Move: click or tap the bodies to move";
    if (moveBox.shown) moveBox.snapping(snapping && moveHint.textContent);
    moveHint.hidden = !(shown && moveBox.shown && (snapping !== null || (picksBodies() && moveBodies.length === 0)));
    viewport.element.dataset.moveSnap = snapping ? (snapping.from === null ? "from" : "to") : ""; // read by the e2e test
  }
  /** The names of bodies `ids` (body ids, 35eb) as their items are named. */
  const bodyLabels = (ids: readonly string[]) => ids.map((id) => itemName(designDoc().timeline.features.find((f) => f.id === bodyItem(id))!));
  /** An edited Move's bodies' names: a body deleted since keeps the name the Move knew it by. */
  const heldLabels = (ids: readonly string[]) => {
    const doc = designDoc();
    const move = moveBox.editing === null ? undefined : doc.timeline.features.find((f) => f.id === moveBox.editing);
    return ids.map((body) => {
      const id = bodyItem(body) ?? body;
      const f = doc.timeline.features.find((x) => x.id === id);
      return f ? itemName(f) : (move?.provenance.from.find((r) => r.id === id)?.label ?? id);
    });
  };

  // Combine (step 35f1c, behind ?combine until 35f5): a new Combine of a target body and tool bodies picked one click at a
  // time, or a Combine's operation and Keep tools edited from its timeline item (its bodies stay as made).
  const combineBox = combinePanel(ctx.properties, {
    field: (which) => {
      combineBox.setField(which);
      showCombineHint();
    },
    changed: () => combineBox.showError(""),
    ok: () => void ctx.history.hold(finishCombine()), // held like Move's and Extrude's OK: an Undo pressed while the kernel checks waits, then takes this back (#503)
    cancel: () => leaveCombine(),
  });
  // Measure (35e2l2, measure-view.ts): Inspect ▾ Measure's panel; while open the view's clicks pick what to measure, and select nothing.
  const measureBox = measureView({
    slot: ctx.properties,
    scene: () => lastScene,
    handle: (b) => {
      const body = lastScene?.bodies[b]?.body;
      return body === undefined ? null : (handlesNow[body] ?? null);
    },
    measure: (first, second) => kernel.call("body_measure", first, second),
    unit: () => currentUnit(ctx.properties.ownerDocument),
    showOverlay: (o) => viewport.setOverlay(o),
    clearOverlay: (id) => viewport.clearOverlay(id),
    changed: () => {
      measureButton.setAttribute("aria-pressed", String(measureBox.shown));
      if (measureBox.shown) fold?.reveal(); // the folded panel opens at it (U0b)
    },
    over: viewport.element,
    // A phone opens its Properties sheet (main.ts) once there is a distance to read, not before: the view stays clear for the picks.
    reveal: () => ctx.properties.dispatchEvent(new Event("properties-reveal", { bubbles: true })),
    offerCorners: (corners) => viewport.showCorners(corners), // corners to pick (35e2l3)
  });
  /** Inspect ▾ Measure: every other tool put away first, and the selection let go (a click now picks for Measure). */
  function startMeasure() {
    leaveExtrude();
    leaveEdit();
    leaveMove();
    if (mode.kind !== "none") leaveSketch();
    leaveCombine();
    ctx.selection.clear();
    measureBox.open();
  }
  const onUnitChange = () => measureBox.unitChanged();
  /** The Combine's bodies (body ids): the target (null: none yet) and the tools, in the order picked. */
  let combineTarget: string | null = null;
  let combineTools: string[] = [];
  /** Each opening and closing of the Combine panel counted: an OK whose check lands after it changed is out of date. */
  let combineOpenings = 0;
  /** Over the view while a new Combine lacks its target or a tool: on a phone the panel's words wait in the shut sheet. */
  const combineHint = viewport.element.ownerDocument.createElement("p");
  combineHint.id = "combine-hint"; // read by the e2e test
  combineHint.className = "move-panel-hint";
  combineHint.hidden = true;
  viewport.element.append(combineHint);
  function showCombineHint() {
    combineHint.textContent = combineBox.field === "target" ? "Combine: click or tap the body to change" : "Now click or tap the bodies to use as tools";
    combineHint.hidden = !(shown && combineBox.shown && combineBox.editing === null && (combineTarget === null || combineTools.length === 0));
  }
  /** What the panel calls body `id`: "Body 2" as the browser numbers it, else its item's name. */
  const combineLabel = (id: string) => {
    const doc = designDoc();
    const n = bodyNumbers(doc).get(id);
    if (n !== undefined) return `Body ${n}`;
    const item = doc.timeline.features.find((f) => f.id === bodyItem(id));
    return item === undefined ? id : isPiece(id) ? `a piece of ${itemName(item)}` : itemName(item);
  };

  /**
   * Combine (35f1c), from Modify ▾ with ?combine, or Edit feature on a
   * Combine: out of any sketch or other panel first. A new one starts with
   * the selection's bodies (a face or edge picks its body), the first the
   * target and the rest tools, Join and Keep tools off (Fusion's); an
   * edited one shows its bodies, operation and Keep tools.
   */
  function startCombine(id: string | null = null) {
    leaveExplode(); // a tool works on the bodies where they are
    leaveExtrude();
    leaveEdit();
    leaveMove();
    if (mode.kind !== "none") leaveSketch();
    leaveCombine();
    combineOpenings++;
    const doc = designDoc();
    if (id !== null) {
      const f = doc.timeline.features.find((x) => x.id === id)!;
      const c = combineBodies(f);
      combineTarget = c.target;
      combineTools = [...c.tools];
      combineBox.show({ id, name: itemName(f), target: combineLabel(c.target), tools: c.tools.map(combineLabel), operation: c.operation, keepTools: c.keepTools });
      ctx.selection.clear();
      return showCombineHint();
    }
    const picked = pickedBodies(ctx.selection.items, lastScene);
    combineTarget = picked[0] ?? null;
    combineTools = picked.slice(1);
    combineBox.show({ id: null, name: "Combine", target: combineTarget && combineLabel(combineTarget), tools: combineTools.map(combineLabel), operation: "join", keepTools: false });
    pickCombineBodies();
  }

  /**
   * A new Combine's bodies from the selection, as it changes (a click in
   * the view or a browser row adds a body or takes it out): a body taken
   * out leaves its field (the target's leaves the target field picking
   * again); a body added fills the field picking now, the target's
   * replacing the one there and passing the picking on to the tools. The
   * selection becomes the bodies, target first; bodies no longer shown
   * (deleted, hidden) are let go.
   */
  function pickCombineBodies() {
    if (!combineBox.shown || combineBox.editing !== null) return;
    const picked = pickedBodies(ctx.selection.items, lastScene);
    const now = new Set(picked);
    const was = new Set([combineTarget, ...combineTools]);
    let target = combineTarget !== null && now.has(combineTarget) ? combineTarget : null;
    const tools = combineTools.filter((b) => now.has(b));
    if (target === null && combineTarget !== null) combineBox.setField("target");
    for (const b of picked) {
      if (was.has(b)) continue;
      if (combineBox.field === "target") {
        target = b;
        combineBox.setField("tools");
      } else tools.push(b);
    }
    combineTarget = target;
    combineTools = tools.filter((b) => b !== target);
    const refs = [...(target === null ? [] : [target]), ...combineTools].map(bodyReference);
    const items = ctx.selection.items;
    if (items.length !== refs.length || items.some((r, i) => r.kind !== "body" || r.id !== refs[i].id)) return ctx.selection.set(refs); // comes back here
    combineBox.setBodies(target && combineLabel(target), combineTools.map(combineLabel));
    showCombineHint();
  }

  /**
   * The Combine panel put away; a new Combine's bodies stay selected, an edited one's are let go. Every other tool
   * calls this as it starts, so Measure (35e2l2) is put away here too: one tool at a time.
   */
  function leaveCombine() {
    measureBox.close();
    if (!combineBox.shown) return;
    combineOpenings++;
    const edited = combineBox.editing !== null;
    combineBox.hide();
    combineTarget = null;
    combineTools = [];
    showCombineHint();
    if (edited) ctx.selection.clear();
  }

  /** OK's words when the design changed while the kernel checked the Combine: nothing was recorded. */
  const COMBINE_CHANGED = "The design changed while the Combine was checked: nothing was changed. Press OK again.";
  const COMBINE_PICKS_CHANGED = "The bodies or choices changed while the Combine was checked: nothing was changed. Press OK again.";

  /**
   * OK: the Combine made (`insertCombine` at the marker, or
   * `changedCombine`), checked by building the design on the kernel (a
   * Combine the kernel can't make, such as an Intersect of bodies that
   * don't overlap, is refused with its words) and recorded as one undo
   * step, "Combine bodies" or "Edit Combine 1". An edit that changes
   * nothing closes the panel and records nothing.
   */
  /** The panel's choices as one string: target, tools in order, operation, Keep tools. */
  const combineAsked = () => JSON.stringify([combineTarget, combineTools, combineBox.operation, combineBox.keepTools]);
  async function finishCombine() {
    if (!combineBox.shown || !combineBox.ready || combineTarget === null) return;
    const id = combineBox.editing;
    const before = designDoc();
    let next: DesignDocument;
    let made: string;
    try {
      if (id === null) ({ doc: next, id: made } = insertCombine(before, combineTarget, combineTools, combineBox.operation, combineBox.keepTools));
      else [next, made] = [changedCombine(before, id, combineTarget, combineTools, combineBox.operation, combineBox.keepTools, resultsNow[id]?.pieces?.renumbered ?? []), id];
    } catch (e) {
      return combineBox.showError(e instanceof Error ? e.message : String(e));
    }
    if (next === before) return leaveCombine();
    const opened = combineOpenings;
    // What OK was pressed on: a pick, operation or Keep tools changed while the kernel looked is not recorded unseen (hunt 11-06).
    const asked = combineAsked();
    combineBox.busy(true);
    let checked: Checked;
    try {
      checked = await onceMoreAfterRestart(() => checkedItem(kernel, next, made));
    } catch (e) {
      checked = { refused: e instanceof Error ? e.message : String(e), misses: [] };
    }
    // Closed, or opened again, while the kernel looked: this OK is out of date.
    if (combineOpenings !== opened) return;
    combineBox.busy(false);
    if (designDoc() !== before) return combineBox.showError(COMBINE_CHANGED);
    if (combineAsked() !== asked) return combineBox.showError(COMBINE_PICKS_CHANGED);
    if (checked.refused !== null) return combineBox.showError(checked.refused);
    // A Cut or Join whose tools change nothing (Ben, 11 Nov): asked first; Cancel leaves the panel open, nothing recorded.
    const op = combineBox.operation;
    if (checked.misses.length > 0 && op !== "intersect") {
      const yes = await missAsk.ask(askWords(op, checked.misses, combineLabel, { kind: "combine", keepTools: combineBox.keepTools }));
      if (!yes || combineOpenings !== opened) return;
      if (designDoc() !== before) return combineBox.showError(COMBINE_CHANGED);
      if (combineAsked() !== asked) return combineBox.showError(COMBINE_PICKS_CHANGED);
    }
    if (id === null) ctx.selection.clear();
    menuHost.record(id === null ? COMBINE_STEP : editStep(before, id), next);
  }

  // The panel folds away until something is selected or a tool's box is in it (U0b); the user's pin is kept across mounts.
  fold = propertiesFold(
    ctx.properties,
    ["sketch-panel", "extrude-panel", "feature-edit", "move-panel", "combine-panel"].map((id) => ctx.properties.querySelector<HTMLElement>(`#${id}`)!),
    foldKept ?? { ...FOLDED_AT_START, pinned: readPinned() },
  );
  fold.update({ selected: ctx.selection.items.length > 0 });
  // Body facts goes out once the panel it opened folds some other way or a tool's box comes or goes, or the sheet it opened shuts.
  fold.onChange((state) => {
    // A tool's box coming or going is the user moving on (Body facts must never fold a tool's box away); a selection that
    // changes either folds the panel (caught here as not shown) or leaves the numbers up, still Body facts' to put away.
    const movedOn = factsTool !== null && state.tool !== factsTool;
    if (factsByFold && (!panelShown(state) || movedOn)) (factsByFold = false), drawFacts();
  });
  // Taken off at unmount (timeline hunt 2026-11-11: left on the shell's properties slot, each Undo's remount kept the
  // old mount alive with its DOM, design and caches, and long sessions ran out of memory).
  const onPropertiesSheet = (e: Event) => {
    if (factsBySheet && !(e as CustomEvent<{ open: boolean }>).detail?.open) (factsBySheet = false), drawFacts();
  };
  ctx.properties.addEventListener("properties-sheet", onPropertiesSheet);

  /** Opens item `id`'s sizes in the Edit feature panel, out of any sketch or Extrude panel first. */
  function openEdit(id: string) {
    const item = designDoc().timeline.features.find((f) => f.id === id)!;
    if (isMoveItem(item)) return startMove(id);
    if (isCombineItem(item)) return startCombine(id);
    // Asked before any open tool is left (hunt 11-11, E2: a Copy, which has nothing to edit, shut an open Move and lost
    // what was typed in it before the refusal): an item with nothing to edit says why, in the menu's words, and nothing changes.
    const off = editOff(item);
    if (off !== null) return panel.showError(off);
    const feature = editableFeature(designDoc(), id);
    leaveExtrude();
    leaveMove();
    leaveCombine();
    if (mode.kind !== "none") leaveSketch();
    leaveExplode(); // a tool works on the bodies where they are
    editBox.show(feature);
    leaveEditRegions(); // another item's, still offered: its body is drawn again
    editOps = null;
    // Extrude's Operation row (with Combine shown), as Fusion's Extrude edited.
    if (combineShown() && isSketchExtrude(item)) {
      const op = extrudeOperation(item)?.operation ?? "new";
      editOps = { id, operation: op, candidates: null, own: null, kept: new Set(), unticked: new Set(), choices: [], asked: 0 };
      editBox.showOperation(op);
      showEditBodies();
      void loadEditBodies(id);
    }
    void offerEditRegions(id);
  }

  function leaveEdit() {
    editBox.hide();
    editOps = null;
    leaveEditRegions();
  }

  /**
   * Out of the regions Edit feature offers (48d4), by whichever way they are left: the panel closed, or opened on
   * another item (hunt 11-11, A2: that way forgot them without drawing, so the edited extrude's body stayed out of the
   * view and the regions shaded after Cancel). None is shaded, and the body left out while they were is drawn again.
   */
  function leaveEditRegions() {
    if (editRegions === null) return;
    editRegions = null;
    viewport.showExtrude(null);
    if (shown && lastScene) showBodies(lastScene);
  }

  /**
   * Edit feature on an extrude of a sketch (48d4, as Fusion's Extrude edited): its sketch's regions are shaded in the view,
   * the one it extrudes chosen (found by its curves, `offerOf`), so a click or tap picks another, which OK saves with the
   * sizes as one undo step. The sketch's one region is shown too, chosen. An old extrude without a region chooses none
   * while its sketch has several (picking one gives it a region); a sketch gone, or one the kernel refuses, offers none.
   */
  async function offerEditRegions(id: string) {
    const doc = designDoc();
    const f = doc.timeline.features.find((x) => x.id === id);
    if (!f || !isSketchExtrude(f)) return;
    const sketchId = f.intent.parameters.sketch as string;
    const sketch = doc.sketches.find((x) => x.id === sketchId);
    if (!sketch || !doc.timeline.features.some((x) => x.id === sketchId)) return;
    let offers: RegionOffer[];
    try {
      offers = (await regionOffers(kernel, sketch, sketchPlane(doc, sketchId, placedNow))).offers;
    } catch {
      return;
    }
    // Closed, opened on another item, or the design changed while the kernel looked: out of date.
    if (editBox.editing !== id || designDoc() !== doc || offers.length === 0) return;
    const saved = f.intent.parameters.region as RegionRef | undefined;
    const chosen = saved !== undefined ? (offerOf(offers, sketchId, saved)?.id ?? null) : offers.length === 1 ? offers[0].id : null;
    // The sketch's one region, the one it extrudes: nothing to pick, so nothing shaded and its body stays drawn.
    if (offers.length === 1 && chosen !== null) return;
    editRegions = { id, sketch: sketchId, name: sketchLabel(sketchId), offers, chosen, picked: null };
    editBox.showRegion(editRegionWords(editRegions.name, offers.length, chosen !== null, false));
    showEditRegions();
  }

  /**
   * The bodies drawn while Edit feature offers regions: every one but the edited extrude's own, which stands on its
   * sketch and would hide the regions (Fusion rolls the timeline back to before it while it is edited); the whole
   * scene otherwise.
   */
  function editMesh(scene: Scene) {
    const hidden = editRegions === null ? null : bodyIdOf(editRegions.id);
    return hidden === null || !scene.bodies.some((b) => b.body === hidden) ? scene.mesh : joinBodies(scene.bodies.filter((b) => b.body !== hidden)).mesh;
  }

  /** The regions Edit feature offers, drawn in the view with the chosen one, the edited body put out of the way; read by the tests from the panel. */
  function showEditRegions() {
    const r = editRegions;
    if (!shown || r === null) return;
    if (lastScene) showBodies(lastScene);
    viewport.showExtrude({ profiles: r.offers, chosen: r.chosen, preview: null, arrow: null });
    const box = ctx.properties.querySelector<HTMLElement>("#feature-edit");
    if (box) Object.assign(box.dataset, { regions: r.offers.map((o) => o.id).join(" "), regionChosen: r.chosen ?? "" });
  }

  /** A click or tap on a region while Edit feature is open: it is the one OK saves; one that can't be extruded says why. */
  function pickEditRegion(offerId: string) {
    const r = editRegions;
    const offer = r?.offers.find((o) => o.id === offerId);
    if (!r || !offer || offer.sketch !== r.sketch) return;
    if (offer.refused !== undefined) return void editBox.showError(regionRefusedWords(r.name, offer.refused));
    // SL #611 C2: a region that is already another of the extrude's profiles can't be its first as well.
    const f = designDoc().timeline.features.find((x) => x.id === r.id);
    if (f && moreProfiles(f).some((p) => p.sketch === r.sketch && p.region !== undefined && offerOf(r.offers, r.sketch, p.region)?.id === offer.id)) return void editBox.showError(alreadyPicked(f.provenance.self.label));
    Object.assign(r, { chosen: offer.id, picked: offer.ref });
    editBox.showError("");
    editBox.showRegion(editRegionWords(r.name, r.offers.length, true, true));
    showEditRegions();
  }

  /**
   * OK: the typed sizes made the item's (`editFeature`), checked by the
   * kernel (`refusedSizes`) and recorded as one undo step ("Edit Extrude
   * 1") only when it takes them; the rebuild builds the item and everything
   * after it. A refused size keeps the panel open with the kernel's words
   * and records nothing; sizes that change nothing close it.
   */
  async function finishEdit(typed: Partial<Record<SizeKey, string>>, flip?: boolean) {
    const id = editBox.editing;
    if (id === null) return;
    const before = designDoc();
    let next: DesignDocument;
    try {
      const f = editableFeature(before, id);
      const read = readTyped(f.keys, typed);
      if (!("sizes" in read)) {
        const key = "bad" in read ? read.bad : read.refused;
        const label = f.shape === "sketch-extrude" ? "distance" : parameterRows(f.shape).find((r) => r.key === key)!.label.toLowerCase();
        return editBox.showError("bad" in read ? `Type the ${label} in mm.` : `The ${label}${read.why.slice("A length".length)}`);
      }
      next = editFeature(before, id, read.sizes, flip, editRegions?.id === id ? (editRegions.picked ?? undefined) : undefined);
      // Its operation (with Combine shown): New body, or Join, Cut or Intersect with the bodies ticked.
      const op = editOps?.id === id ? editBox.operation : null;
      if (op !== null && editOps !== null) {
        if (op !== "new" && editOps.candidates === null) return editBox.showError("Wait a moment: the bodies the extrude reaches are still being found.");
        next = setExtrudeOperation(next, id, op === "new" ? null : { operation: op, bodies: tickedBodies(editOps.choices) });
      }
    } catch (e) {
      return editBox.showError(e instanceof Error ? e.message : String(e));
    }
    if (next === before) return leaveEdit();
    // Editing an extrude confirms its pieces the last build warned about as they are now, as editing a Combine does (hunt 11-08).
    next = forgetPieces(next, id, resultsNow[id]?.pieces?.renumbered ?? []);
    editBox.busy(true);
    let refused: string | null;
    let misses: Miss[] = [];
    try {
      refused = await refusedSizes(kernel, before, next, id);
      // An extrude that joins, cuts or intersects: its boolean must work too, or the edit says why and records nothing.
      const now = next.timeline.features.find((f) => f.id === id);
      if (refused === null && now !== undefined && isOperationExtrude(now)) ({ refused, misses } = await onceMoreAfterRestart(() => checkedItem(kernel, next, id)));
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e);
    }
    // Closed, or the design changed while the kernel looked: this edit is out of date.
    if (editBox.editing !== id) return;
    editBox.busy(false);
    if (designDoc() !== before) return editBox.showError(CHANGED_WHILE_CHECKING);
    if (refused !== null) return editBox.showError(refused);
    // Its Cut or Join now reaches nothing (#521): asked first; Cancel leaves the panel open.
    const op = extrudeOperation(next.timeline.features.find((f) => f.id === id)!)?.operation;
    if (misses.length > 0 && (op === "cut" || op === "join")) {
      if (!(await askExtrudeMisses(next, id, op, misses)) || editBox.editing !== id) return;
      if (designDoc() !== before) return editBox.showError(CHANGED_WHILE_CHECKING);
    }
    menuHost.record(editStep(before, id), next);
  }

  /**
   * Move (35e2b), from Modify ▾, M, or Edit feature on a Move; Rotate (Ben,
   * 2026-10-29, its own tool) from Modify ▾ or Shift+R: out of any sketch
   * or other panel first. A new one starts with the selection's bodies (a
   * face or edge picks its body) and turns about their centre; an edited
   * one opens in the tool its numbers say (move.ts moveKindOf), shows them
   * and keeps its bodies.
   */
  function startMove(id: string | null = null, kind: MoveKind = "move") {
    leaveExplode(); // a tool works on the bodies where they are
    moveFromInsert = false;
    leaveExtrude();
    leaveEdit();
    leaveCombine();
    if (mode.kind !== "none") leaveSketch();
    moveOpenings++;
    dragCalledOff = false;
    const doc = designDoc();
    if (id !== null) {
      const f = doc.timeline.features.find((x) => x.id === id)!;
      moveBodies = movedBodies(f);
      moveBox.show({ id, kind: moveKindOf(f), name: itemName(f), bodies: f.dependsOn.map((b) => doc.timeline.features.find((x) => x.id === b)?.provenance.self.label ?? f.provenance.from.find((r) => r.id === b)?.label ?? b), values: moveValues(f) });
      // Its bodies picked as a new Move's are (35e2i), so a click adds one or takes one out; this comes back through pickMoveBodies.
      const shownNow = new Set((lastScene?.bodies ?? []).map((b) => b.body));
      ctx.selection.set(moveBodies.filter((b) => shownNow.has(b)).map(bodyReference));
      return pickMoveBodies();
    }
    moveBodies = pickedBodies(ctx.selection.items, lastScene);
    const [pivotX, pivotY, pivotZ] = startPivot(moveBodies, lastScene);
    moveBox.show({ id: null, kind, name: MOVE_VERBS[kind], bodies: bodyLabels(moveBodies), values: { ...NO_MOVE, pivotX, pivotY, pivotZ } });
    pickMoveBodies();
  }

  /**
   * A new Move's bodies from the selection, as it changes: a face or edge
   * picked stands for its body, so the selection becomes the bodies (they
   * light as picked); the names, the pivot (unless typed) and the preview
   * follow.
   */
  function pickMoveBodies() {
    const id = moveBox.editing;
    let picked = pickedBodies(ctx.selection.items, lastScene);
    // An edited Move (35e2i) can't move a body made after it: the pick is let go, saying why.
    const edited = id === null ? null : editedBodies(designDoc(), id, moveBodies, picked, lastScene);
    if (edited?.refused) {
      moveBox.showError(edited.refused);
      picked = picked.filter((b) => edited.bodies.includes(b));
    }
    const refs = picked.map(bodyReference);
    const items = ctx.selection.items;
    if (items.length !== refs.length || items.some((r, i) => r.kind !== "body" || r.id !== refs[i].id)) return ctx.selection.set(refs); // comes back here
    moveBodies = edited ? edited.bodies : picked;
    if (snapping?.from && !picked.includes(snapping.from.body)) snapping.from = null;
    if (snapping && picked.length === 0) snapping = null;
    showMoveHint();
    moveBox.setBodies(edited ? heldLabels(moveBodies) : bodyLabels(picked));
    // The pivot follows the bodies unless typed. A new Move's are where the scene shows them. An edited Move's, once its
    // Centre of the bodies was pressed, are found where they were before it, as the button finds them (hunt 11-11, E1:
    // read off the scene here, a click on a body or a rebuild put the pivot where the bodies end up).
    if (id === null) moveBox.setPivot(startPivot(picked, lastScene));
    else if (!moveBox.pivotTyped) void centreOfBodies();
    previewMove();
  }

  /**
   * The preview: a new Move's bodies drawn turned and shifted by the boxes
   * as typed (move-tool.ts `movedMesh`, no kernel call), the rest as built;
   * an edited Move's bodies where OK will put them (35e2c, `editedMoveMesh`:
   * out of where the Move put them as built, into where the boxes say); a
   * box that isn't a number shows them as built. The arrows and rings
   * follow (`showMoveHandles`).
   */
  /**
   * Centre of the bodies: the centre of the box round the Move's bodies
   * where they are before it. A new Move's are where the scene shows them;
   * an edited Move's are found as the Moves from it on hold them
   * (`heldBefore`), since the scene shows them after it and every later
   * Move. Nothing changes if the panel moved on while the kernel answered.
   */
  async function centreOfBodies() {
    const id = moveBox.editing;
    const scene = lastScene;
    const picked = [...moveBodies];
    let boxes: (readonly [readonly [number, number, number], readonly [number, number, number]])[];
    if (id === null) boxes = (scene?.bodies ?? []).filter((b) => picked.includes(b.body)).map((b) => b.view.bounds);
    else {
      const held = heldBefore(designDoc(), resultsNow, id, picked);
      try {
        boxes = [];
        for (const [n, body] of picked.entries()) {
          const h = held[n];
          const shown = scene?.bodies.find((b) => b.body === body);
          if (h !== null) boxes.push((await bodies.view(h)).bounds);
          else if (shown) boxes.push(shown.view.bounds);
        }
      } catch {
        return; // the kernel didn't answer: the pivot stays as typed
      }
    }
    if (!moveBox.shown || moveBox.editing !== id || lastScene !== scene || picked.join() !== moveBodies.join()) return;
    moveBox.setPivot(boxCentre(boxes));
    previewMove();
  }

  function previewMove() {
    if (!lastScene) return;
    const read = readMoveBoxes(moveBox.typed);
    const v = moveBox.shown && "values" in read && previewable(read.values) ? read.values : null;
    const id = moveBox.editing;
    viewport.showBody(v === null ? lastScene.mesh : id === null ? movedMesh(lastScene, moveBodies, v) : editedMoveMesh(lastScene, designDoc(), resultsNow, id, v, moveBodies));
    showMoveHandles();
  }

  /**
   * Move's arrows and rings (35e2c) where the pivot ends up, while the panel
   * is open on bodies and every box reads as a number (a box half typed
   * hides them, as it stops the preview); taken away otherwise.
   */
  function showMoveHandles() {
    const read = readMoveBoxes(moveBox.typed);
    // Not while Snap picks (35e2d): a click on the bodies is a pick then, never a grab of an arrow or ring over them.
    const on = shown && moveBox.shown && moveBodies.length > 0 && snapping === null && "values" in read && previewable(read.values);
    viewport.showMoveHandles(on ? { centre: handlesCentre(read.values), kind: moveBox.kind } : null);
  }

  /** The Move's numbers as a handle's drag began (the boxes then), or null while none is held. */
  let dragFrom: MoveValues | null = null;
  /**
   * A Move handle dragged (35e2c): the handle's box set to its number at the
   * press moved by the drag in whole millimetres or 15° steps
   * (`draggedValues`), so the typed values follow the drag and the preview
   * and handles follow the box; a box typed after the drag is the user's.
   */
  /** Escape called the held drag off (bug hunt 11-04, E6): the viewer still holds it, so its moves are let go until its release. */
  let dragCalledOff = false;
  /** The handle held while `dragFrom` is set. */
  let dragHandle: MoveParam | null = null;
  const onMovePointer: SharedViewport["onMovePointer"] = (pointer) => {
    if (dragCalledOff) {
      if (pointer.done) dragCalledOff = false;
      return;
    }
    if (!moveBox.shown) return;
    if (dragFrom === null) {
      const read = readMoveBoxes(moveBox.typed);
      if ("bad" in read) return moveBox.showError(`Type the ${MOVE_BOX_WORDS[read.bad]}.`);
      dragFrom = read.values;
    }
    dragHandle = pointer.handle;
    moveBox.setValue(pointer.handle, draggedValues(dragFrom, pointer.handle, pointer.amount)[pointer.handle]);
    moveBox.dragging(pointer.done ? null : pointer.handle); // the box being changed glows while the drag lasts
    if (pointer.done) dragFrom = null;
    previewMove();
  };

  /** The held handle's drag called off: its box back to its number at the press, the rest of the drag let go. */
  function callOffMoveDrag() {
    if (dragFrom === null) return;
    if (dragHandle !== null) moveBox.setValue(dragHandle, dragFrom[dragHandle]);
    dragFrom = null;
    dragCalledOff = true;
    moveBox.dragging(null);
    previewMove();
  }

  function startSnap() {
    if (!moveBox.shown || moveBodies.length === 0) return;
    snapping = { from: null };
    moveBox.showError("");
    showMoveHint();
    showMoveHandles();
  }
  function stopSnap() {
    snapping = null;
    showMoveHint();
    showMoveHandles();
  }
  /**
   * A click while Snap picks: the first, a face or edge of a body the Move
   * moves; the second, one of another body, where it lands. The boxes are
   * then set to the numbers that lay the one on the other (move-snap.ts,
   * on top of the turn they held) and the preview follows; OK records them
   * as typed numbers. A curved face, a body on the wrong side or a face
   * onto an edge says why and waits for another pick; empty space does
   * nothing.
   */
  function snapPick(pick: Parameters<NonNullable<SharedViewport["onPick"]>>[0]) {
    const at = pick.edge != null ? ({ kind: "edge", index: pick.edge } as const) : pick.face !== null ? ({ kind: "face", index: pick.face } as const) : null;
    const hit = at && lastScene ? sceneHit(lastScene, at.kind, at.index) : null;
    if (!snapping || !at || !hit || !lastScene) return;
    const body = lastScene.bodies[hit.body];
    const got = snapPart(body.view, at.kind, hit.index);
    if ("refused" in got) return moveBox.showError(got.refused);
    const moving = moveBodies.includes(body.body);
    if (snapping.from === null) {
      if (!moving) return moveBox.showError(SNAP_NOT_MOVING);
      snapping.from = { body: body.body, part: got.part };
      moveBox.showError("");
      return showMoveHint();
    }
    if (moving) return moveBox.showError(SNAP_MOVING);
    const read = readMoveBoxes(moveBox.typed);
    if ("bad" in read) return moveBox.showError(`Type the ${MOVE_BOX_WORDS[read.bad]}.`);
    const ends = snapEnds(designDoc(), resultsNow, moveBox.editing, snapping.from.body, snapping.from.part, got.part, { body: body.body, bodies: moveBodies });
    const r = snappedValues(read.values, ends.from, ends.to);
    if ("refused" in r) return moveBox.showError(r.refused);
    moveBox.setValues(r.values);
    moveBox.showError("");
    stopSnap();
    previewMove();
  }

  /** Each opening and closing of the Move panel counted: an OK whose check lands after it changed is out of date (bug hunt 11-04, E2). */
  let moveOpenings = 0;
  /** The open Move is the one an Insert started on its new body (Ben, 2026-11-04): leaving it lets that body go again, as Insert left nothing picked before. */
  let moveFromInsert = false;
  /** The Move panel put away, its preview with it; a new Move's picked bodies stay selected, an edited one's are let go (35e2i). */
  /** A new Move open whose boxes move and turn nothing yet: Cancel would lose nothing. */
  function moveUntouched(): boolean {
    if (!moveBox.shown || moveBox.editing !== null) return false;
    const read = readMoveBoxes(moveBox.typed);
    return "values" in read && (["x", "y", "z", "turnX", "turnY", "turnZ"] as const).every((k) => read.values[k] === 0);
  }

  function leaveMove() {
    if (!moveBox.shown) return;
    moveOpenings++;
    // An edited Move's bodies, and the new body an Insert picked for its Move, were picked by the tool, not the user.
    const edited = moveBox.editing !== null || moveFromInsert;
    const fromInsert = moveFromInsert;
    moveFromInsert = false;
    moveBox.hide();
    moveBodies = [];
    dragFrom = null;
    snapping = null;
    showMoveHint();
    viewport.showMoveHandles(null);
    if (lastScene) showBodies(lastScene);
    if (edited) ctx.selection.clear();
    // And the panel stays open at the new body's sizes, as Insert left it (U0d): the fold sees the Move's box go in a
    // microtask (properties-fold.ts), queued as it hid above, so it is opened again in the one after.
    if (fromInsert) queueMicrotask(() => fold?.reveal());
  }

  /** OK's words when the design changed while the kernel checked the Move: nothing was recorded. */
  const MOVE_CHANGED = "The design changed while the Move was checked: nothing was changed. Press OK again.";

  /**
   * OK: the boxes read (one that isn't a number says which), the Move made
   * (`insertMove` at the marker, or `changedMove`), checked by building the
   * design on the kernel (`refusedMove`: a body moved out past model space
   * is refused with the kernel's words) and recorded as one undo step,
   * "Move bodies" or "Edit Move 1". A new Move that moves, turns and scales nothing, or an
   * edit that changes nothing, closes the panel and records nothing.
   */
  async function finishMove(typed: Record<MoveBox, string>) {
    if (!moveBox.shown) return;
    const id = moveBox.editing;
    const before = designDoc();
    const read = readMoveBoxes(typed);
    if ("bad" in read) return moveBox.showError(`Type the ${MOVE_BOX_WORDS[read.bad]}.`);
    const v = read.values;
    let next: DesignDocument;
    let moved: string;
    try {
      if (id === null) {
        // A Scale of 2 moves nothing yet changes everything (the browser check found it closing as if nothing was asked).
        if (v.x === 0 && v.y === 0 && v.z === 0 && v.turnX === 0 && v.turnY === 0 && v.turnZ === 0 && factorOf(v) === 1 && moveBodies.length > 0) return leaveMove();
        ({ doc: next, id: moved } = insertMove(before, moveBodies, v, moveBox.kind));
      } else [next, moved] = [changedMove(before, id, v, moveBodies), id];
    } catch (e) {
      return moveBox.showError(e instanceof Error ? e.message : String(e));
    }
    if (next === before) return leaveMove();
    const opened = moveOpenings;
    moveBox.busy(true);
    let refused: string | null;
    try {
      refused = await onceMoreAfterRestart(() => refusedMove(kernel, next, moved));
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e);
    }
    // Closed, or opened again (on this Move or another), while the kernel looked: this OK is out of date.
    if (moveOpenings !== opened) return;
    moveBox.busy(false);
    if (designDoc() !== before) return moveBox.showError(MOVE_CHANGED);
    if (refused !== null) return moveBox.showError(refused);
    if (id === null) ctx.selection.clear();
    menuHost.record(id === null ? { move: MOVE_STEP, rotate: ROTATE_STEP, scale: SCALE_STEP }[moveBox.kind] : editStep(before, id), next);
  }

  /** The pointer rounded by the kernel: onto the grid with grid snap on, else where it is to within half a pixel (snap.ts `rounding`). */
  const roundPointer = (at: SketchXY, grid: number, pixel: number | undefined, held = modHeld): Promise<SketchXY> => {
    const r = rounding(at, grid, snapsNow(snapOn, held, gridSnap).grid, pixel);
    return r.op === "snap_to_grid" ? kernel.call("snap_to_grid", ...r.args) : kernel.call("place_freely", ...r.args);
  };
  /** The pointer's moves counted, the pointer leaving the view among them: a move's rounding answered after a later move is dropped, so it never shows a snap where the pointer was. */
  let moves = 0;
  /** The last hover the kernel has answered (its move's count, where the pointer was, rounded, its pixel); null once the pointer left the view. */
  let hovered: { move: number; at: SketchXY; rounded: SketchXY; pixel: number | undefined } | null = null;
  /**
   * The pointer's last move since the last click (its count, where it was, its pixel, and the kernel's rounding of it
   * on the way), or null: an Enter places from where the pointer was as Enter was pressed, once that move is rounded.
   */
  let lastMove: { at: SketchXY; pixel: number | undefined; rounded: Promise<SketchXY> } | null = null;
  /**
   * An Enter in the typed boxes placed a point and the pointer has not moved since: a second Enter with nothing typed
   * places nothing (typed-sizes hunt 2026-11-01: "10, Tab, 0, Enter, Enter" drew a stray line to where the pointer had
   * been before the typed point). A move clears it, so Enter after a real move still places as a click.
   */
  let enteredStill = false;
  /** The pointer's last move over the sketch, snapped again when Ctrl or Cmd is pressed or let go with the pointer still. */
  let lastHover: SketchPointer | null = null;
  /** A press of Ctrl or Cmd waiting to show: dropped when another key follows, a shortcut like Ctrl+Z rather than a hold. */
  let heldShow: ReturnType<typeof setTimeout> | undefined;
  /** Another key pressed while Ctrl or Cmd is held (a shortcut, not a hold). */
  let chord = false;
  /**
   * Ctrl or Cmd pressed or let go: the snap under a still pointer shows the change, as Fusion's does. A press shows it
   * after HELD_SHOW_MS unless another key comes first, and a release after another key shows nothing until the pointer
   * moves, so Ctrl+Z never snaps a hover again just as Undo puts the sketch state away (a hover answered after Undo
   * would draw the old tool on the new document: sketch-session.mjs, seed 1).
   */
  const onHeldKey = (e: KeyboardEvent) => {
    clearTimeout(heldShow);
    const now = e.ctrlKey || e.metaKey;
    if (now && e.type === "keydown" && e.key !== "Control" && e.key !== "Meta") chord = true;
    if (now === modHeld) return;
    modHeld = now;
    const show = () => {
      if (shown && mode.kind === "edit" && lastHover) onSketchPointer(lastHover);
    };
    // Let go after a shortcut: the next pointer move shows the snap, never a hover snapped while the shortcut's change lands.
    if (now) heldShow = setTimeout(show, HELD_SHOW_MS);
    else if (!chord) show();
    if (!now) chord = false;
  };
  /** The window lost focus (Alt-Tab, Ctrl+Tab): a held Ctrl or Cmd's release will never arrive here, so it counts as let go now. */
  const onLostFocus = () => {
    clearTimeout(heldShow);
    chord = false;
    if (!modHeld) return;
    modHeld = false;
    if (shown && mode.kind === "edit" && lastHover) onSketchPointer(lastHover);
  };
  /** Clicks are handled one after another, each on the document the last one left. */
  let clicks = Promise.resolve();
  /** How many clicks (typed Enters and projections too) wait their turn: Finish Sketch waits for them. */
  let waiting = 0;
  /** `turn` in line behind the clicks before it. */
  const inTurn = (turn: () => Promise<void>) => {
    waiting++;
    clicks = clicks.then(turn).finally(() => void waiting--);
  };
  const onSketchPointer = (pointer: SketchPointer) => {
    if (mode.kind !== "edit") return;
    const at = pointer.at;
    if (at) pointerAt = at;
    if (pointer.kind === "grab" || pointer.kind === "drag" || pointer.kind === "drop") return onPointDrag(pointer);
    // Step 27d: the Project tool snaps nothing and places nothing; a click projects what the viewport says is under it.
    if (mode.tool.kind === "project") {
      ++moves;
      hovered = lastMove = null;
      mode.snap = null;
      mode.pointer = at;
      if (pointer.kind === "click") projectAt(pointer);
      return drawSketches();
    }
    // The Select tool snaps nothing and places nothing: the curve within a snap's reach of the pointer lights, and a click picks it (Shift adds).
    if (mode.tool.kind === "select") {
      ++moves;
      hovered = lastMove = null;
      mode.snap = null;
      mode.pointer = at;
      const tool = mode.tool;
      const sketch = designDoc().sketches.find((s) => s.id === tool.sketch);
      const reach = PICK_PIXELS[pointer.touch ? "touch" : "mouse"] * (pointer.pixel ?? 0);
      // A constraint's mark (47d2) or a curve, whichever is nearer (constraint-tool.ts selectAt).
      const hit = at && sketch ? selectAt(sketch, at, reach, CONSTRAINT_MARK_PIXELS * (pointer.pixel ?? 0.1)) : null;
      mode.pixel = pointer.pixel;
      if (pointer.kind !== "click") mode.tool = { ...tool, hover: hit };
      else {
        mode.tool = { ...tool, picked: pickCurve(stillPicked(sketch, tool.picked), hit, pointer.shift === true), hover: hit };
        sketchBox.showError("");
        showSketchStatus();
      }
      return drawSketches();
    }
    // The constraint tools (47d2) snap nothing and place nothing either: the point (or, for Horizontal and Vertical, the
    // line) within reach lights, and a click picks it; once the picks make a constraint it is added on the solver.
    if (isConstraintTool(mode.tool)) {
      ++moves;
      hovered = lastMove = null;
      mode.snap = null;
      mode.pointer = at;
      const tool = mode.tool;
      const sketch = designDoc().sketches.find((s) => s.id === tool.sketch);
      const hit = at && sketch ? constraintPickAt(sketch, tool.kind, at, PICK_PIXELS[pointer.touch ? "touch" : "mouse"] * (pointer.pixel ?? 0)) : null;
      mode.pixel = pointer.pixel;
      if (pointer.kind !== "click" || !sketch) mode.tool = { ...tool, hover: hit };
      else {
        const { tool: next, add } = clickConstraint(tool, sketch, hit);
        mode.tool = next;
        sketchBox.showError("");
        if (add) constrain(tool.sketch, add);
        // A dimension's picks done (47e): the keys go to its value's box, which starts at the size as drawn.
        if (next.pending && !tool.pending) {
          unlock();
          drawSketches();
          if (!pointer.touch) return typed.start("");
          // A tap: the browser's own click comes after it and would take the keys back to the page, so the box takes
          // them in that click (a tap's gesture, so a phone shows its keyboard), or a moment later when none comes.
          return keysAfterTap();
        }
      }
      return drawSketches();
    }
    if (pointer.kind === "move") {
      lastHover = at ? pointer : null;
      enteredStill = false;
      const move = ++moves;
      if (!at) {
        mode.pointer = mode.snap = null;
        hovered = lastMove = null;
        return drawSketches();
      }
      // The centre arc follows which way the pointer goes round its centre, from every move (a reply the kernel drops as stale must not lose a turn).
      mode.tool = hoverTool(mode.tool, at);
      // A hover off the modelling range just doesn't move the preview.
      const rounded = roundPointer(at, mode.grid, pointer.pixel);
      lastMove = { at, pixel: pointer.pixel, rounded };
      void rounded.then((value) => {
        if (move !== moves || mode.kind !== "edit") return;
        hovered = { move, at, rounded: value, pixel: pointer.pixel };
        mode.snap = snapHere(designDoc(), mode.tool, at, value, pointer.pixel);
        mode.pointer = mode.snap.at;
        mode.pixel = pointer.pixel;
        drawSketches();
      }, () => {});
      return;
    }
    if (!at) return;
    const changes = toolChanges;
    // What is typed as the click is made (hunt 26h): the kernel may answer after more is typed, which is for the next point.
    const took = locks;
    // Ctrl or Cmd as the click is made: the kernel may answer after it is let go.
    const held = modHeld;
    const movedAt = moves;
    lastMove = null; // an Enter from now on places from this click's point, or from a hover after it
    inTurn(async () => {
      if (mode.kind !== "edit") return;
      let rounded: SketchXY;
      try {
        rounded = await roundPointer(at, mode.grid, pointer.pixel, held);
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      // The tool changed while the kernel snapped (L, R, C or Escape): the click was for the old tool, so it is dropped.
      if (mode.kind !== "edit" || toolChanges !== changes) return;
      // The click lands where the hover showed it would: where it was rounded to (free or on the grid), or on the point or line-up snap.ts finds.
      const edges = edgeTargets(mode.tool.sketch);
      const snapped = snapHere(designDoc(), mode.tool, at, rounded, pointer.pixel, edges, held).at;
      // A typed size overrules the pointer for what it locks (SF4): the point goes where the locks put it, exactly.
      const aim = aimOf(designDoc(), mode.tool, snapped, took);
      if (!aim) return sketchBox.showError(NO_AIM);
      const before = designDoc();
      const done = clickAt(before, withLocks(mode.tool, took, snapped), aim);
      // The owner's rule (rebuild.ts): an extrude whose sketch this edit breaks keeps the sketch as it was, in the same undo step.
      // A new point on the face's edges is pinned there (26f), in the same step.
      let next = pinNewPoints(before, done.doc, done.tool.sketch, edges);
      if (done.drew) {
        try {
          next = await settleKept(kernel, before, next, bodies);
        } catch (e) {
          return sketchBox.showError(e instanceof Error ? e.message : String(e));
        }
        // Undo, Escape or a tool change while the kernel looked: the click was for a sketch that is no longer there.
        if (mode.kind !== "edit" || toolChanges !== changes || designDoc() !== before) return;
      }
      // A circle's rim the grid rounded onto its centre from further out than a snap's reach (so not a click on the centre)
      // says the grid did it (a small circle at phone zoom; beginner play-test 2026-10-28).
      sketchBox.showError(done.note === NO_RADIUS && snapsNow(snapOn, held, gridSnap).grid && rounded[0] === snapped[0] && rounded[1] === snapped[1] && pointer.pixel !== undefined && Math.sqrt((at[0] - snapped[0]) ** 2 + (at[1] - snapped[1]) ** 2) > SNAP_PIXELS * pointer.pixel ? GRID_ATE_RADIUS : (done.note ?? ""));
      if (done.tool !== mode.tool && locks === took) unlock(); // the sizes it placed with, not any typed since
      mode.tool = done.tool;
      // What the pointer snaps to now, with the new point and the tool's next step: where a hover answered since the
      // click has it (the click waited its turn behind the kernel while the pointer moved on: hunt 26h), else still at
      // the click. (A finger has left the view by now, and this keeps the hint and the boxes by the tap; sketch-hover.journey.ts.)
      const now = hovered !== null && hovered.move > movedAt ? hovered : { at, rounded, pixel: pointer.pixel };
      mode.snap = snapHere(done.doc, done.tool, now.at, now.rounded, now.pixel, edges);
      mode.pointer = mode.snap.at;
      mode.pixel = now.pixel;
      if (done.drew) applySketchEdit(next, drawStep(done.tool), done.tool.sketch);
      drawSketches();
      if (done.drew) await showOutline();
    });
  };

  /**
   * A click with the Project tool (27d): the edge under the pointer, else
   * every edge of the face there, of a body before the sketch, projected
   * into it as one undo step ("Project"), in turn with the clicks before it
   * (each on the document the last left); settled as a click is, so an
   * extrude of the sketch keeps its shape if this breaks its outline. What
   * was refused, left out or projected already is said in the panel.
   */
  function projectAt(pointer: SketchPointer) {
    const changes = toolChanges;
    inTurn(async () => {
      if (mode.kind !== "edit" || mode.tool.kind !== "project" || toolChanges !== changes) return;
      const id = mode.tool.sketch;
      const before = designDoc();
      const pick = projectPick(before, id, sceneFor(id), sketchPlane(before, id, placedNow), pointer);
      let made: ReturnType<typeof projectEdges>;
      try {
        made = projectEdges(before, id, pick.edges);
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      sketchBox.showError(pick.note ?? (pick.edges.length > 0 && made.ids.length === 0 ? PROJECT_AGAIN : ""));
      if (made.ids.length === 0) return;
      let next: DesignDocument;
      try {
        next = await settleKept(kernel, before, made.doc, bodies);
      } catch (e) {
        return sketchBox.showError(e instanceof Error ? e.message : String(e));
      }
      // Undo, Escape or a tool change while the kernel looked: the click was for a sketch that is no longer there.
      if (mode.kind !== "edit" || toolChanges !== changes || designDoc() !== before) return;
      applySketchEdit(next, SKETCH_STEPS.project, id);
      drawSketches();
      await showOutline();
    });
  }

  /**
   * Enter in a typed box (SF4): the point placed where the locks and the
   * pointer put it as Enter is pressed, as a click there would; the keys
   * stay in the boxes for the next line. Enter takes the boxes and empties
   * them at once (hunt 26h): placing waits behind the kernel's last answer,
   * and the next side typed meanwhile must go into fresh boxes, not be read
   * by this Enter (a fast "10, Tab, 90, Enter" placed a point 180 mm off).
   * An Enter that places nothing gives its sizes back, unless something was
   * typed since.
   */
  function placeTyped() {
    if (mode.kind !== "edit") return;
    if (isConstraintTool(mode.tool) && mode.tool.pending) return placeDimension();
    // Nothing typed and the pointer still since the last Enter: that Enter placed its point already (enteredStill).
    if (enteredStill && Object.keys(locks).length === 0) return;
    enteredStill = true;
    const took = locks;
    const texts = typed.texts();
    const from = lastMove;
    const changes = toolChanges;
    unlock(true);
    drawSketches();
    const giveBack = () => void (mode.kind === "edit" && typed.restore(texts));
    inTurn(async () => {
      // A tool chosen (or Escape) since: the sizes were for the old tool, so the Enter is dropped, as a click is.
      if (mode.kind !== "edit" || toolChanges !== changes) return;
      // Where the pointer was as Enter was pressed: its last move, rounded and snapped on the sketch as it is now (the
      // points placed before this one in), else where the last click or hover left it.
      let pointer = mode.pointer;
      if (from) {
        const rounded = await from.rounded.catch(() => null);
        if (mode.kind !== "edit" || toolChanges !== changes) return;
        if (rounded) pointer = snapHere(designDoc(), mode.tool, from.at, rounded, from.pixel).at;
      }
      const aim = aimOf(designDoc(), mode.tool, pointer, took);
      if (!aim) return (sketchBox.showError(NO_AIM), giveBack());
      const before = designDoc();
      const done = clickAt(before, withLocks(mode.tool, took, pointer), aim);
      // As a click: an extrude whose sketch this breaks keeps the sketch as it was (rebuild.ts), in the same undo step, and a point on the face's edges is pinned (26f).
      let next = pinNewPoints(before, done.doc, done.tool.sketch, edgeTargets(done.tool.sketch));
      if (done.drew) {
        try {
          next = await settleKept(kernel, before, next, bodies);
        } catch (e) {
          return (sketchBox.showError(e instanceof Error ? e.message : String(e)), giveBack());
        }
        if (mode.kind !== "edit" || toolChanges !== changes || designDoc() !== before) return;
      }
      sketchBox.showError(done.note ?? "");
      if (done.tool === mode.tool) giveBack();
      mode.tool = done.tool;
      mode.snap = null;
      if (done.drew) applySketchEdit(next, drawStep(done.tool), done.tool.sketch);
      drawSketches();
      if (done.drew) await showOutline();
    });
  }
  const onViewportMove = (e: PointerEvent) => {
    modHeld = e.ctrlKey || e.metaKey;
    if (e.target instanceof Node && typed.element.contains(e.target)) return; // over the boxes themselves: they stay put
    const r = viewport.element.getBoundingClientRect();
    screen = { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Picking (17b): a click on a face selects it, Shift adds, empty space or Escape clears.
  const onPick: SharedViewport["onPick"] = (pick) => {
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    if (!doc) return;
    // Choosing where Create sketch puts the sketch: an origin plane, or a flat face of a body on screen (26d).
    if (mode.kind === "pick") {
      const spot = sketchSpot(pick, lastScene);
      if (spot?.kind === "plane") pickPlane(spot.plane);
      else if (spot) pickFace(spot);
      return;
    }
    // Measure (35e2l2): the click picks what to measure, and selects nothing.
    if (measureBox.shown) return measureBox.pick(pick);
    // Snap (35e2d): the click picks what to snap, then where it lands, and picks no bodies.
    if (moveBox.shown && snapping) return snapPick(pick);
    // A Move (35e2b; an edited one too since 35e2i), or a new Combine (35f1c): a click on a body adds it or takes it out; empty space keeps what is picked.
    if (moveBox.shown || combineBox.shown) {
      const c = pickChange({ ...pick, shift: true, double: undefined }, lastScene); // every click toggles a body here, a quick second one too
      const b = c.change === "toggle" && lastScene ? bodyOf(lastScene, c.item) : -1;
      if (picksBodies() && b >= 0) ctx.selection.toggle(bodyReference(lastScene!.bodies[b].body));
      return;
    }
    applyChange(ctx.selection, pickChange(pick, lastScene)); // a double-click picks the whole body (picking.ts)
  };
  let stopWatching = () => {};
  // The phone turned or the window resized (a keyboard, a panel): the line's point moved on screen, so the typed
  // boxes and the hint go beside it again rather than staying where they were, maybe past the view's edge (hunt D2).
  // The viewer's own observer, made first, has already fitted the camera to the new size. (None outside a browser: the journeys.)
  const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    if (mode.kind !== "edit" || !pointerAt) return;
    const at = viewport.sketchScreenPoint(pointerAt);
    if (at) screen = at;
    drawSketches();
  });
  /** Listens to picks and the selection: from mount, and again on each wake. Keys come from the shell (X7b), only while shown. */
  function listen() {
    viewport.onPick = onPick;
    viewport.onMenu = openViewMenu;
    viewport.onSketchPointer = onSketchPointer;
    viewport.onExtrudePointer = onExtrudePointer;
    viewport.onMovePointer = onMovePointer;
    showExtrudeView();
    showMoveHandles();
    viewport.element.addEventListener("pointermove", onViewportMove);
    viewport.element.addEventListener("pointerdown", onViewportMove); // a tap moves no pointer first
    viewport.element.addEventListener("dblclick", onLabelDblclick);
    viewport.element.addEventListener("click", onLabelClick);
    resized?.observe(viewport.element);
    globalThis.addEventListener?.("keydown", onHeldKey);
    globalThis.addEventListener?.("keyup", onHeldKey);
    globalThis.addEventListener?.("blur", onLostFocus);
    ctx.properties.ownerDocument.addEventListener(UNIT_EVENT, onUnitChange);
    if (mode.kind === "pick") viewport.showPlanes(originPlanes(), sketchableFaces(lastScene));
    drawSketches();
    showMoveHint();
    stopWatching = ctx.selection.onChange(() => {
      // Extrude (UX1b): a sketch's row clicked in the browser chooses it, as a click on its outline in the view does.
      const items = ctx.selection.items;
      const sketch = extruding && items.length === 1 ? readProfileReference(items[0]) : null;
      if (sketch !== null) chooseProfile(sketch);
      if (picksBodies()) pickBodies();
      // The user's next change of selection retires the note about dropped items.
      if (!settling && note) panel.showSelectionNote((note = ""));
      showSelection();
    });
  }
  function sleep() {
    if (!shown) return;
    shown = false;
    // Design's own overlay goes with it: another workspace's view says nothing about a Combine (36d).
    viewport.clearOverlay(REFUSAL_OVERLAY);
    showPrintCheck(); // asleep: cleared
    measureBox.close(); // its line is drawn in the shared view
    ctx.properties.ownerDocument.removeEventListener(UNIT_EVENT, onUnitChange);
    showBuildAreaWords();
    viewport.onPick = null;
    viewport.onMenu = null;
    viewport.onSketchPointer = null;
    viewport.onExtrudePointer = null;
    viewport.showExtrude(null);
    viewport.onMovePointer = null;
    viewport.showMoveHandles(null);
    viewport.element.removeEventListener("pointermove", onViewportMove);
    viewport.element.removeEventListener("pointerdown", onViewportMove);
    viewport.element.removeEventListener("dblclick", onLabelDblclick);
    viewport.element.removeEventListener("click", onLabelClick);
    resized?.disconnect();
    globalThis.removeEventListener?.("keydown", onHeldKey);
    globalThis.removeEventListener?.("keyup", onHeldKey);
    globalThis.removeEventListener?.("blur", onLostFocus);
    clearTimeout(heldShow);
    typed.hide();
    sketchBar.showType(false);
    hint.hide();
    moveHint.hidden = true;
    showStart(); // hidden while asleep; wake shows it again if it still applies
    sketchBar.closeMenu();
    // Asleep, the sketches stay drawn as finished ones: no grid, no planes to pick.
    viewport.showPlanes([]);
    const doc = ctx.project.workspaces.design as DesignDocument | undefined;
    viewport.showSketches(doc ? sketchDrawings(doc, null, placedNow, lostSketches()) : []);
    viewport.showSelection(NO_HIGHLIGHT);
    stopWatching();
  }

  // The Shape choice (U0d) does what the toolbar's shape buttons did: set_part with this shape and the boxes' sizes.
  // Asleep or put away, the panel is out of the page and edits nothing (issue #267, monkey seed 202611010): Chromium
  // fired a Shape change as Open took the panel out of the page (main.ts replaceProject: the new project first, then
  // each view's sleep), and the opened file's box became a cylinder. Its size boxes are held the same way.
  panel.shapeChoice.addEventListener("change", () => {
    if (!shown) return;
    const kind = panel.shapeChoice.value as ShapeKind;
    if (kind) void setPart({ op: "set_part", shape: kind });
  });
  // Typing in one box is one undo step (the merge key), named for the box; typing for another body is another step
  // (the key names the body: Undo after typing for Body 1 put back Body 2's width typed before it, bug hunt 2026-11-01).
  inputs.forEach((input, i) => {
    input.addEventListener("input", () => shown && update(shape === "sketch-extrude" && SIZE_KEYS[i] === "height" ? DISTANCE_STEP : `Change ${SIZE_KEYS[i]}`, `${SIZE_KEYS[i]} ${boxesPart ?? ""}`));
    // Left (or Enter): a refused size gives way to the last one. Blur too: Firefox gives no change for a number box
    // left empty after 0 and -5 (hunt 26h, CI's browsers job).
    input.addEventListener("change", () => restoreRefused(i));
    input.addEventListener("blur", () => restoreRefused(i));
  });
  listen();
  // A new project's design starts empty (U0c, the owner's ask), never as a box made from the size boxes.
  const first = held === undefined ? update(undefined, undefined, freshDesign()) : update();
  enterSketch(); // after an Undo or Redo inside a sketch: still in it
  return {
    ready: first.then(
      () => {},
      () => {},
    ),
    sleep,
    run,
    check: aiCheck,
    // File ▾ (U0f2a): New clears the design after asking (start-fresh.ts); Export STL downloads every body shown, as the toolbar's STL does.
    fileEntries: () => {
      const doc = designDoc();
      const stl = DESIGN_COMMANDS.find((c) => c.op === "export_stl")!;
      const bodies = shownBodyRefs(doc, failedNow);
      return {
        new: fresh.entry(doc, mode.kind !== "none"),
        exports: [
          { id: "file-export-stl", label: "Export STL", title: `Export STL: ${stl.summary}`, off: bodies.length === 0 ? noBodyWords(doc, failedNow) : undefined, run: () => run({ op: "export_stl" }) },
          { id: "file-save-picture", label: "Save picture (PNG)", title: "Save picture: the view as it is on screen, as a PNG file", off: viewport.picture ? undefined : "This browser can't make a picture of the view", run: () => void savePicture() },
          { id: "file-slice-print", label: "Slice for printing", title: SLICE_PRINT_TITLE, off: bodies.length === 0 ? noBodyWords(doc, failedNow) : undefined, run: () => printing.ask() },
        ],
      };
    },
    // What the AI assistant is told before a request (25c3): the timeline as last built, and the panel's sizes, which a set_part keeps for each it leaves out.
    aiView: () => {
      const doc = ctx.project.workspaces.design as DesignDocument | undefined;
      // The sizes set_part keeps are the last body's (`run`), even while the boxes show a selected one.
      const last = doc ? partFeature(doc) : null;
      const kept = last !== null && last.id !== boxesPart ? shapeOf(doc!, last).sizes : {};
      const [width, depth, height] = SIZE_KEYS.map((key, i) => kept[key] ?? Number(inputs[i].value));
      const label = (id: string) => doc?.timeline.features.find((f) => f.id === id)?.provenance.self.label ?? id;
      return designAIView(doc, failedNow, { width, depth, height }, aiFaces(lastScene, label), mode.kind === "edit" ? mode.tool.sketch : null);
    },
    // Escape clears the selection; Copy with one profile selected runs Copy as SVG (shortcuts.ts).
    shortcut(id, e) {
      if (!shown) return false; // the shell only asks while shown; never act asleep
      // Ctrl+D duplicates the picked bodies; Ctrl+C copies them (with no profile picked) and Ctrl+V pastes a Duplicate
      // of each, outside a sketch (missing basics: Fusion's keys); the pasted copies open in Move as Duplicate's do.
      if (id === "duplicate-bodies") return mode.kind === "none" && duplicateOff() === null ? (void duplicateBodies(), true) : false;
      if (id === "copy-svg" && mode.kind === "none" && designShortcut(id, ctx.selection.items) === null) {
        const picked = pickedBodies(ctx.selection.items, lastScene);
        const data = (e as ClipboardEvent | undefined)?.clipboardData;
        if (picked.length === 0 || !data) return false;
        data.setData("text/plain", copiedText(designToken, picked));
        return true;
      }
      if (id === "paste-bodies") {
        const bodies = mode.kind === "none" ? pastedBodies((e as ClipboardEvent | undefined)?.clipboardData?.getData("text/plain") ?? "", designToken) : null;
        return bodies === null ? false : (void duplicateBodies(bodies), true);
      }
      // Escape during a drag on the timeline bar calls the drag off, and only that (timeline hunt, finding 7).
      if (id === "clear-selection" && callOffDrag()) return true;
      // Escape with Pan or Zoom lit on the view bar turns it off, back to Orbit, and only that (U7b, as in Fusion).
      if (id === "clear-selection" && viewport.leaveNavTool?.()) return true;
      // Escape with the Create menu open closes the menu, and only that.
      if (id === "clear-selection" && sketchBar.menuOpen) return sketchBar.closeMenu(), true;
      // Escape in the sketch tool: leaves the plane prompt, or ends the line, rectangle, circle, arc or tangent arc being drawn.
      if (id === "clear-selection" && mode.kind === "pick") return leaveSketch(), true;
      if (id === "clear-selection" && extrudeBox.shown) return leaveExtrude(), true;
      // Enter is the Extrude panel's OK with the focus on the view (after a drag of the arrow) or nowhere; anything else focused (a button, a timeline item) takes its own Enter.
      if (id === "extrude-ok") {
        const active = ctx.properties.ownerDocument.activeElement;
        // A browser row clicked to pick a body or sketch keeps the focus; it counts as the view, or Enter would click it again and let the pick go (bug hunt 11-04, E3).
        const onView = !active || active === active.ownerDocument.body || viewport.element.contains(active) || (ctx.browser.contains(active) && active.matches(".tree-row"));
        // Enter is the Move panel's OK the same way (35e2b).
        if (moveBox.shown && !extrudeBox.shown) {
          if (!onView) return false;
          if (moveBox.ready) void ctx.history.hold(finishMove(moveBox.typed)); // busy while the kernel checks: a second Enter records nothing twice
          return true;
        }
        // And the Combine panel's (35f1c).
        if (combineBox.shown && !extrudeBox.shown) {
          if (!onView) return false;
          if (combineBox.ready) void ctx.history.hold(finishCombine());
          return true;
        }
        if (!extrudeBox.shown || !onView) return false;
        if (extrudeBox.ready) void ctx.history.hold(finishExtrude(extrudeBox.typed));
        return true;
      }
      if (id === "clear-selection" && editBox.editing !== null) return leaveEdit(), true;
      // Escape while Snap picks stops the snap, and only that (35e2d).
      if (id === "clear-selection" && moveBox.shown && snapping) return stopSnap(), true;
      // Escape while a Move handle is held calls off the drag, and only that: its box back to its number at the press (E6).
      if (id === "clear-selection" && moveBox.shown && dragFrom !== null) return callOffMoveDrag(), true;
      if (id === "clear-selection" && moveBox.shown) return leaveMove(), true;
      if (id === "clear-selection" && combineBox.shown) return leaveCombine(), true;
      if (id === "clear-selection" && measureBox.shown) return measureBox.close(), true;
      // M opens Move outside a sketch (Fusion's key); in a sketch the key does what it would.
      if (id === "move-tool") return mode.kind === "none" ? (startMove(), true) : false;
      // E is Extrude (Fusion's key), in a sketch too (Extrude leaves it, as its toolbar button does); not while a plane is
      // being picked, nor with Extrude already open. S opens the command search box outside a sketch (Ben's keys 10-29).
      if (id === "extrude-tool") return mode.kind === "pick" || extrudeBox.shown ? false : (startExtrude(), true);
      if (id === "command-search") return mode.kind === "none" ? (searchBox.open(), true) : false;
      if (id === "rotate-tool") return mode.kind === "none" ? (startMove(null, "rotate"), true) : false;
      if (id === "clear-selection" && mode.kind === "edit" && toolBusy(mode.tool)) {
        mode.tool = startTool(mode.tool.kind, mode.tool.sketch);
        mode.snap = null;
        toolChanges++;
        unlock();
        sketchBox.showError("");
        drawSketches();
        return true;
      }
      // Escape while a sketch point is held (47d3): the drag comes to nothing, the point back where it was pressed.
      if (id === "clear-selection" && (pointDrag || liveDrag)) {
        for (const d of [pointDrag, liveDrag]) if (d) cancelDrag(d);
        return true;
      }
      // Escape with nothing half drawn (missing basics, 2026-11-04, as in Fusion): the picks go, else the Select tool is chosen.
      if (id === "clear-selection" && mode.kind === "edit" && mode.tool.kind === "select" && mode.tool.picked.length > 0) {
        mode.tool = { ...mode.tool, picked: [] };
        showSketchStatus();
        drawSketches();
        return true;
      }
      if (id === "clear-selection" && mode.kind === "edit" && mode.tool.kind !== "select") return chooseTool("select"), true;
      // Delete or Backspace in a sketch with curves picked takes them out; otherwise the key does what it would.
      if ((id === "delete-selection" || id === "delete-selection-back") && mode.kind === "edit") return deletePicked();
      // X in a sketch with curves picked turns them into construction curves and back (47f, Fusion's key).
      if (id === "sketch-construction" && mode.kind === "edit") return constructPicked();
      // L, R, C and A choose the line, rectangle, circle and arc tools while a sketch is edited; otherwise the key does what it would.
      // A digit, point or minus while a line or rectangle is part drawn starts typing its size in the first box (SF4).
      const typedKey = typedSizeKey(id);
      if (typedKey !== null) return mode.kind === "edit" && typedFields(mode.tool).length > 0 ? (typed.start(typedKey), true) : false;
      const kind = sketchToolKey(id);
      if (kind) return mode.kind === "edit" ? (chooseTool(kind), true) : false;
      // Delete or Backspace outside a sketch (round 2 hunt E5): the focused row's or the selected body's item, the menu's way.
      if ((id === "delete-selection" || id === "delete-selection-back") && mode.kind === "none") return deleteKey();
      const items = ctx.selection.items;
      const what = designShortcut(id, items);
      if (what === "clear") ctx.selection.clear();
      else if (what === "copy") void runAction(COPY_SVG, items);
      return what !== null;
    },
    wake() {
      if (shown) return;
      shown = true;
      listen();
      showStart();
      showBuildAreaWords();
      showRefusals();
      showPrintCheck();
      // A build that finished while asleep was not drawn: show the document again
      // (never rebuilt from the size boxes, which would add a box to a design with
      // no body; hunt 2026-10-21). Otherwise the body is still in the viewport;
      // redraw what others may have changed.
      if (missed) return void show(designDoc(), shape);
      showSelection();
      markStale();
    },
    unmount() {
      putAway = true;
      unitWatch = null;
      for (const d of [pointDrag, liveDrag]) if (d) cancelDrag(d);
      putAwayByRestore = ctx.history.restoring() ? ctx.project : null;
      if (putAwayByRestore === null) editingSketch = null;
      // A click, Enter or hover still waiting on the kernel was for the sketch shown until now; an undo that puts the
      // workspace away may have taken that sketch out, so it is dropped as a tool change drops it (app sweep 2026-10-28).
      toolChanges++;
      moves++;
      sleep();
      ctx.properties.removeEventListener("properties-sheet", onPropertiesSheet);
      stopHealing?.();
      void bodies.close();
      areaNote.remove();
      viewport.showSketches([]);
      viewport.showOrigin(ORIGIN_AT_FIRST);
      typed.under("diameter", null);
      fitList.dispose();
      typed.element.remove();
      hint.element.remove();
      moveHint.remove();
      explodeBar.remove();
      combineHint.remove();
      measureBox.dispose();
      startCard.element.remove();
      solidCard.element.remove();
      ctx.viewport.clearOverlay(SOLID_OVERLAY); // the card that explained the marks is gone (an Undo mounts Design again)
      if (fold) {
        foldKept = { ...FOLDED_AT_START, pinned: fold.state.pinned };
        fold.close();
      }
      for (const slot of [ctx.toolbar, ctx.browser, ctx.properties, ctx.timeline]) slot?.replaceChildren();
    },
  };
}

export const designWorkspace: WorkspacePlugin = {
  id: "design",
  title: "Design",
  summary: "Parametric modelling: sketches, features and the timeline. The source of truth for all geometry.",
  status: "working",
  representations: { produces: ["solid", "mesh", "outline"], accepts: [] },
  registerRepresentations: registerDesign,
  registerActions: (registry) => registerDesignActions(registry),
  readData: readDesignDocument,
  commands: DESIGN_COMMANDS,
  shortcuts: DESIGN_SHORTCUTS,
  mount,
};
