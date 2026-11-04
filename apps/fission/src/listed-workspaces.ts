// Which workspaces the public app lists (Ben, 2026-11-04: "remove everything
// from that list except design and slice. everything else can still
// silently exist but shouldnt be on the public app"). DESIGN ▾ lists these
// only, and there is no Split; the others stay built in and open by their
// links (#image, #laser…). `?all-workspaces`, the developers' switch, lists
// every workspace and brings Split back, as before.

/** The workspaces DESIGN ▾ lists in the public app, in menu order. */
export const PUBLIC_WORKSPACES: readonly string[] = ["design", "slice"];

/** The URL switch that lists every workspace (developers and the browser checks of unlisted workspaces). */
export const ALL_WORKSPACES_SWITCH = "all-workspaces";

/** The workspaces to list, in their own order: every one with the switch on, else the public ones. */
export function listedWorkspaces<T extends { id: string }>(all: readonly T[], everything: boolean): T[] {
  return everything ? [...all] : all.filter((w) => PUBLIC_WORKSPACES.includes(w.id));
}

