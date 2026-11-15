// Whether the Chamfer tool shows (step 44a-app2): hidden until Ben says it
// goes public, as Combine is (combine-flag.ts, whose rules this follows).
// Opening the app with `?chamfer` in its address turns it on for the tab
// (kept in sessionStorage, so it stays on across reloads and moves between
// workspaces); `?chamfer=off` turns it off again; `?all` (@fission/core
// preview.ts) turns it on too. Written after the "#" (`#design?chamfer`) it
// works the same, the part before the "#" winning when both say; slashes,
// spaces and capitals typed round it are forgiven. Read once, when the
// Design workspace first asks. Without it, Modify ▾ shows Chamfer greyed as
// coming soon (coming-soon.ts), as before.

import { previews } from "@fission/core";

/** sessionStorage's key for the flag. */
export const CHAMFER_KEY = "spindle-chamfer";

type FlagStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The `chamfer` value in a query, forgiving how it was typed; null when there is none. */
function chamferIn(query: string): string | null {
  const plain = (s: string) => s.replace(/^[\s/]+|[\s/]+$/g, "").toLowerCase();
  for (const [name, value] of new URLSearchParams(query)) if (plain(name) === "chamfer") return plain(value);
  return null;
}

/**
 * The flag from the address's query (`search`, else the part of `hash`
 * after a "?") and the tab's store: `?chamfer` (or `=on`, `=1`, `=true`)
 * turns it on and remembers it, `?chamfer=off` (or `=0`, `=false`) turns it
 * off and forgets it, any other value is ignored; no `chamfer` in the
 * address keeps what the store says. A store that throws counts as empty.
 */
export function readChamferFlag(search: string, store: FlagStore | null, hash = ""): boolean {
  const asked = hash.indexOf("?");
  const value = chamferIn(search) ?? (asked < 0 ? null : chamferIn(hash.slice(asked + 1)));
  const on = value === null ? null : ["", "on", "1", "true"].includes(value) ? true : ["off", "0", "false"].includes(value) ? false : null;
  try {
    if (on === true) store?.setItem(CHAMFER_KEY, "on");
    if (on === false) store?.removeItem(CHAMFER_KEY);
    if (on !== null) return on;
    return store?.getItem(CHAMFER_KEY) === "on";
  } catch {
    return on ?? false;
  }
}

let flag: boolean | null = null;

/** Whether Chamfer shows in this tab, read once (none outside a browser: the journeys and unit tests, unless `setChamferShown`). */
export function chamferShown(): boolean {
  if (flag === null) {
    let store: FlagStore | null = null;
    try {
      store = globalThis.sessionStorage ?? null;
    } catch {
      store = null;
    }
    flag = readChamferFlag(globalThis.location?.search ?? "", store, globalThis.location?.hash ?? "") || previews().all;
  }
  return flag;
}

/** For tests: the flag as if the address had said so (null: read it again next time). */
export function setChamferShown(on: boolean | null): void {
  flag = on;
}
