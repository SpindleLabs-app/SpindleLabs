// Whether the Construct menu shows (step 59a2): hidden until Ben says it
// goes public, as Combine is (combine-flag.ts, whose rules this follows).
// Opening the app with `?construct` in its address turns it on for the tab
// (kept in sessionStorage, so it stays on across reloads and moves between
// workspaces); `?construct=off` turns it off again; `?all` (@fission/core
// preview.ts) turns it on too. Written after the "#" (`#design?construct`) it
// works the same, the part before the "#" winning when both say; slashes,
// spaces and capitals typed round it are forgiven. Read once, when the
// Design workspace first asks. Without it, Construct ▾ lists its planes, axes and
// points greyed as coming soon (coming-soon.ts), as before.

import { previews } from "@fission/core";

/** sessionStorage's key for the flag. */
export const CONSTRUCT_KEY = "spindle-construct";

type FlagStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The `construct` value in a query, forgiving how it was typed; null when there is none. */
function constructIn(query: string): string | null {
  const plain = (s: string) => s.replace(/^[\s/]+|[\s/]+$/g, "").toLowerCase();
  for (const [name, value] of new URLSearchParams(query)) if (plain(name) === "construct") return plain(value);
  return null;
}

/**
 * The flag from the address's query (`search`, else the part of `hash`
 * after a "?") and the tab's store: `?construct` (or `=on`, `=1`, `=true`)
 * turns it on and remembers it, `?construct=off` (or `=0`, `=false`) turns it
 * off and forgets it, any other value is ignored; no `construct` in the
 * address keeps what the store says. A store that throws counts as empty.
 */
export function readConstructFlag(search: string, store: FlagStore | null, hash = ""): boolean {
  const asked = hash.indexOf("?");
  const value = constructIn(search) ?? (asked < 0 ? null : constructIn(hash.slice(asked + 1)));
  const on = value === null ? null : ["", "on", "1", "true"].includes(value) ? true : ["off", "0", "false"].includes(value) ? false : null;
  try {
    if (on === true) store?.setItem(CONSTRUCT_KEY, "on");
    if (on === false) store?.removeItem(CONSTRUCT_KEY);
    if (on !== null) return on;
    return store?.getItem(CONSTRUCT_KEY) === "on";
  } catch {
    return on ?? false;
  }
}

let flag: boolean | null = null;

/** Whether Construct shows in this tab, read once (none outside a browser: the journeys and unit tests, unless `setConstructShown`). */
export function constructShown(): boolean {
  if (flag === null) {
    let store: FlagStore | null = null;
    try {
      store = globalThis.sessionStorage ?? null;
    } catch {
      store = null;
    }
    flag = readConstructFlag(globalThis.location?.search ?? "", store, globalThis.location?.hash ?? "") || previews().all;
  }
  return flag;
}

/** For tests: the flag as if the address had said so (null: read it again next time). */
export function setConstructShown(on: boolean | null): void {
  flag = on;
}
