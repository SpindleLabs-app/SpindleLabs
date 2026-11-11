// Mouse controls (U2d): which preset of the mouse buttons the 3D view uses. A preset says what a left-button drag does
// when no navigation tool is lit on the bottom bar (the other buttons are the same in both), and its table of gestures
// is what Settings shows. The viewport, the Settings page and the page's storage all read this one list.

export type MousePreset = "spindle" | "fusion";

/** What a left-button drag does at rest: turn the view, or nothing (it selects; Orbit, Pan and Zoom on the bar give it a job). */
export type LeftDrag = "orbit" | "select";

export interface MousePresetInfo {
  id: MousePreset;
  label: string;
  /** One line on what is different about it. */
  summary: string;
  leftDrag: LeftDrag;
  /** The table Settings shows: each button or key and what it does. */
  rows: readonly { gesture: string; does: string }[];
}

/** Everything that is the same in both presets, after the left drag. */
const COMMON: readonly { gesture: string; does: string }[] = [
  { gesture: "Middle-button drag", does: "Moves the view sideways (pan)" },
  { gesture: "Shift + middle-button drag", does: "Turns the view (orbit)" },
  { gesture: "Wheel", does: "Zooms toward the pointer" },
  { gesture: "Ctrl + wheel, or a trackpad pinch", does: "Zooms toward the pointer, more gently" },
  { gesture: "Right button", does: "Nothing yet: kept for a menu" },
  { gesture: "Escape", does: "Puts the bar's Orbit, Pan or Zoom tool away" },
];

export const MOUSE_PRESETS: readonly MousePresetInfo[] = [
  {
    id: "spindle",
    label: "SpindleLabs",
    summary: "Drag with the left button to turn the view.",
    leftDrag: "orbit",
    rows: [
      { gesture: "Left click", does: "Picks what is under the pointer" },
      { gesture: "Left-button drag", does: "Turns the view (orbit), unless the bar's Pan or Zoom is lit" },
      ...COMMON,
    ],
  },
  {
    id: "fusion",
    label: "Fusion-style",
    summary: "The left button only picks; turn the view with Shift + middle drag, the orientation cube or the bar's Orbit.",
    leftDrag: "select",
    rows: [
      { gesture: "Left click", does: "Picks what is under the pointer" },
      { gesture: "Left-button drag", does: "Nothing, unless the bar's Orbit, Pan or Zoom is lit" },
      ...COMMON,
    ],
  },
];

/** The preset kept in Settings: SpindleLabs's own unless "fusion" is stored. */
export const readMousePreset = (raw: unknown): MousePreset => (raw === "fusion" ? "fusion" : "spindle");

/** What a left drag does at rest in `preset`. */
export const leftDragOf = (preset: MousePreset): LeftDrag => (preset === "fusion" ? "select" : "orbit");

/** The event the page sends on its document when the preset changes, and the root attribute that says which is worn. */
export const MOUSE_EVENT = "mousechange";
export const MOUSE_ATTRIBUTE = "mouse";
