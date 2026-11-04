// The 3D view's colours in the dark and the light theme (U1b). The app's
// stylesheets answer to `data-theme` on the root (theme.css); the view's
// colours are numbers three.js takes, so they live here, one palette per
// theme, and `setViewTheme` copies the chosen palette over the live objects the
// rest of the package reads (so nothing here is a getter, and the dark values
// are exactly what the view has always used). The page tells the view with a
// `themechange` event on the document (@fission/ui theme-choice.ts), and the
// view's own pieces re-draw from `onViewTheme`.
import { BACKDROP_BOTTOM, BACKDROP_TOP } from "./backdrop.ts";
import { EXTRUDE_COLOURS } from "./extrude-layer.ts";
import { EDGE_COLOUR, type Rgb } from "./highlight.ts";

export type ViewTheme = "dark" | "light";

/** The sketch colours (sRGB): the edited sketch's lines bright, finished ones quieter, the grid faint, the axes red (x) and green (y). */
export const SKETCH_COLOURS = { picked: 0xffe14d, hover: 0xb8e4ff, line: 0x6cc4ff, finished: 0x8b95a3, projected: 0xc77dff, projectedFinished: 0x9d6fc4, lost: 0xff6b6b, preview: 0xffb454, snap: 0x4dff88, constraint: 0x5eead4, construction: 0xe08a4f, point: 0xffffff, grid: 0xaab4c3, axisX: 0xe5534b, axisY: 0x57ab5a, plane: 0x6cc4ff, planeOff: 0x8b95a3 };
/** The build area's colours: a quiet blue when the bodies fit, red when they go outside, grey for the floor kept clear. */
export const BUILD_AREA_COLOURS = { fits: 0x6fa8ff, outside: 0xff4d4d, keptClear: 0x9aa3b2 };
/** The ground grid's centre lines and the other lines (three.js GridHelper colours). */
export const GROUND_GRID = { centre: 0x46536a, lines: 0x2a3242 };
/** The view cube's faces: the face, its corner squares, its label, and the box's outline. */
export const CUBE_COLOURS = { face: "#28313d", corner: "#323d4c", label: "#dfe5ee", outline: 0x8c9bb0 };

interface Palette {
  backdrop: { top: Rgb; bottom: Rgb };
  edge: Rgb;
  sketch: typeof SKETCH_COLOURS;
  buildArea: typeof BUILD_AREA_COLOURS;
  ground: typeof GROUND_GRID;
  cube: typeof CUBE_COLOURS;
  extrude: typeof EXTRUDE_COLOURS;
}

const dark: Palette = {
  backdrop: { top: [...BACKDROP_TOP] as Rgb, bottom: [...BACKDROP_BOTTOM] as Rgb },
  edge: [...EDGE_COLOUR] as Rgb,
  sketch: { ...SKETCH_COLOURS },
  buildArea: { ...BUILD_AREA_COLOURS },
  ground: { ...GROUND_GRID },
  cube: { ...CUBE_COLOURS },
  extrude: { ...EXTRUDE_COLOURS },
};

// Light: a light blue sky (lighter at the top, as the dark one is), lines
// and sketch colours darkened until they read on it (3 : 1 or more against the
// sky's middle, light.test.ts), the same body grey and edge.
const light: Palette = {
  backdrop: { top: [234, 244, 255], bottom: [176, 208, 244] },
  edge: [0x28 / 255, 0x2b / 255, 0x31 / 255],
  sketch: { picked: 0xb45309, hover: 0x3b9ae8, line: 0x0b6fcf, finished: 0x5d6978, projected: 0x8e3fd1, projectedFinished: 0x7a52a8, lost: 0xd32f2f, preview: 0xb05c00, snap: 0x0a7f3a, constraint: 0x0f766e, construction: 0xb4531f, point: 0x1b2330, grid: 0x6b7a8f, axisX: 0xd0372d, axisY: 0x2f8a3a, plane: 0x0b6fcf, planeOff: 0x5d6978 },
  buildArea: { fits: 0x2f6fd0, outside: 0xd32f2f, keptClear: 0x667283 },
  ground: { centre: 0x7d9cc4, lines: 0xa9c0de },
  cube: { face: "#e9eef6", corner: "#d6deea", label: "#1d2735", outline: 0x5c6b80 },
  extrude: { fill: 0x2f8fe0, preview: 0x1f7ad6, arrow: 0x1f7ad6, arrowHot: 0xe08a00 },
};

export const PALETTES: Record<ViewTheme, Palette> = { dark, light };

let current: ViewTheme = "dark";
const listeners = new Set<(theme: ViewTheme) => void>();

export const viewTheme = (): ViewTheme => current;

/** Make the live colour objects the palette of `theme`, then tell whoever drew with the old ones. */
export function setViewTheme(theme: ViewTheme): void {
  const p = PALETTES[theme];
  current = theme;
  BACKDROP_TOP.splice(0, 3, ...p.backdrop.top);
  BACKDROP_BOTTOM.splice(0, 3, ...p.backdrop.bottom);
  EDGE_COLOUR.splice(0, 3, ...p.edge);
  Object.assign(SKETCH_COLOURS, p.sketch);
  Object.assign(BUILD_AREA_COLOURS, p.buildArea);
  Object.assign(GROUND_GRID, p.ground);
  Object.assign(CUBE_COLOURS, p.cube);
  Object.assign(EXTRUDE_COLOURS, p.extrude);
  for (const l of [...listeners]) l(theme);
}

/** Call `listener` whenever the theme changes; returns the way to stop. */
export function onViewTheme(listener: (theme: ViewTheme) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// The page's own theme: read it now, and follow the document's `themechange`.
if (typeof document !== "undefined") {
  const root = document.documentElement;
  if (root?.dataset.theme === "light") setViewTheme("light");
  document.addEventListener("themechange", (e) => {
    const detail = (e as CustomEvent<unknown>).detail;
    setViewTheme(detail === "light" ? "light" : "dark");
  });
}
