// Whether the Combine tool shows (step 35f1c): hidden until step 35f5,
// when Ben says it goes public. Opening the app with `?combine` in its
// address turns it on for the tab (kept in sessionStorage, so it stays on
// across reloads and moves between workspaces); `?combine=off` turns it off
// again. Written after the "#" too (`#design?combine`, as the app's own
// address ends in "#design": Ben's first try, 11-08), it works the same,
// the part before the "#" winning when both say. Read once, when the Design workspace first asks: a flag changed
// later takes effect on the next load. Without it, Modify ▾ shows Combine
// greyed as coming soon (coming-soon.ts), as before.

/** sessionStorage's key for the flag. */
export const COMBINE_KEY = "spindle-combine";

type FlagStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The flag from the address's query (`search`, as location.search gives
 * it, else the part of its `hash` after a "?") and the tab's store: `?combine` (or `=on`, `=1`, `=true`) turns it on
 * and remembers it, `?combine=off` (or `=0`, `=false`) turns it off and
 * forgets it, any other value is ignored; no `combine` in the address
 * keeps what the store says. A store that throws (a private window, blocked
 * storage) counts as empty, and the address alone decides.
 */
export function readCombineFlag(search: string, store: FlagStore | null, hash = ""): boolean {
  const asked = hash.indexOf("?");
  const value = new URLSearchParams(search).get("combine") ?? (asked < 0 ? null : new URLSearchParams(hash.slice(asked + 1)).get("combine"));
  const on = value === null ? null : ["", "on", "1", "true"].includes(value) ? true : ["off", "0", "false"].includes(value) ? false : null;
  try {
    if (on === true) store?.setItem(COMBINE_KEY, "on");
    if (on === false) store?.removeItem(COMBINE_KEY);
    if (on !== null) return on;
    return store?.getItem(COMBINE_KEY) === "on";
  } catch {
    return on ?? false;
  }
}

let flag: boolean | null = null;

/** Whether Combine shows in this tab, read once (none outside a browser: the journeys and unit tests, unless `setCombineShown`). */
export function combineShown(): boolean {
  if (flag === null) {
    let store: FlagStore | null = null;
    try {
      store = globalThis.sessionStorage ?? null;
    } catch {
      store = null;
    }
    flag = readCombineFlag(globalThis.location?.search ?? "", store, globalThis.location?.hash ?? "");
  }
  return flag;
}

/** For tests and the simulated users: the flag as if the address had said so (null: read it again next time). */
export function setCombineShown(on: boolean | null): void {
  flag = on;
}
