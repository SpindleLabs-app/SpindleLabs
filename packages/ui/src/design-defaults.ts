// Design's sketch defaults (U2b): the grid size a new sketch starts with and whether points snap to the grid, Settings
// choices kept with the other settings. The grid size is millimetres here whichever unit is shown (the Settings box
// converts). The page wears them as `data-grid-size` and `data-grid-snap` on the root: a new sketch reads them when it
// starts, so nothing needs telling when they change.
import { lengthLimitRefusal } from "@fission/core";
import type { SettingsStore } from "./settings.ts";

export const GRID_SIZE_SETTING = "gridSize";
export const GRID_SNAP_SETTING = "gridSnap";
/** What a new sketch starts with when nothing is chosen (the same as Design's DEFAULT_GRID and DEFAULT_GRID_SNAP, tested equal). */
export const DEFAULT_GRID_MM = 10;
export const DEFAULT_GRID_SNAP_ON = false;

export interface DesignDefaults {
  /** Grid size in millimetres. */
  grid: number;
  snap: boolean;
}

/** The stored grid size in mm: the default unless a number the kernel accepts (1 µm to 1 km) is stored. */
export function readGridSize(settings: SettingsStore): number {
  const v = settings.get(GRID_SIZE_SETTING, DEFAULT_GRID_MM);
  return Number.isFinite(v) && lengthLimitRefusal(v) === null ? v : DEFAULT_GRID_MM;
}
/** The stored default for Snap to grid: off unless ticked. */
export const readGridSnap = (settings: SettingsStore): boolean => settings.get(GRID_SNAP_SETTING, DEFAULT_GRID_SNAP_ON);

/** What the page wears now; the defaults on a page that has not started them. */
export function currentDesignDefaults(doc: Document): DesignDefaults {
  const size = Number(doc.documentElement.dataset.gridSize);
  const grid = doc.documentElement.dataset.gridSize !== undefined && Number.isFinite(size) && lengthLimitRefusal(size) === null ? size : DEFAULT_GRID_MM;
  return { grid, snap: doc.documentElement.dataset.gridSnap === "on" };
}

function wear(doc: Document, d: DesignDefaults): void {
  doc.documentElement.dataset.gridSize = String(d.grid);
  doc.documentElement.dataset.gridSnap = d.snap ? "on" : "off";
}

export interface DesignDefaultChoices {
  /** Keeps `mm` as the grid size new sketches start with; returns why it was refused (and keeps the last good size), or null. */
  setGrid(mm: number): string | null;
  setSnap(on: boolean): void;
}

/** Wear the stored defaults now; returns the ways to choose new ones. */
export function startDesignDefaults(doc: Document, settings: SettingsStore): DesignDefaultChoices {
  wear(doc, { grid: readGridSize(settings), snap: readGridSnap(settings) });
  return {
    setGrid(mm) {
      const why = Number.isFinite(mm) ? lengthLimitRefusal(mm) : "A length must be a number.";
      if (why !== null) return why.replace(/^A length/, "The grid size");
      settings.set(GRID_SIZE_SETTING, mm);
      wear(doc, { ...currentDesignDefaults(doc), grid: mm });
      return null;
    },
    setSnap(on) {
      settings.set(GRID_SNAP_SETTING, on);
      wear(doc, { ...currentDesignDefaults(doc), snap: on });
    },
  };
}
