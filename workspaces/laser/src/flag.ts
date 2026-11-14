// Whether the Laser page shows (step L1a): off until Ben says it goes public.
// Opening the app with `?laser` in its address turns it on for the tab (kept
// in sessionStorage, so it survives reloads); `?laser=off` turns it off.
// Written after the "#" too (`#laser?laser`), it works the same, the part
// before the "#" winning; slashes, spaces and capitals round it are forgiven,
// as Design's `?combine` is. Without it, Laser is the placeholder it was.

/** sessionStorage's key for the flag. */
export const LASER_KEY = "spindle-laser";

type FlagStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function laserIn(query: string): string | null {
  const plain = (s: string) => s.replace(/^[\s/]+|[\s/]+$/g, "").toLowerCase();
  for (const [name, value] of new URLSearchParams(query)) if (plain(name) === "laser") return plain(value);
  return null;
}

/** The flag from the address and the tab's store: `?laser` (or =on, =1, =true) turns it on and remembers it, `?laser=off` (=0, =false) forgets it, anything else is ignored. A store that throws counts as empty. */
export function readLaserFlag(search: string, store: FlagStore | null, hash = ""): boolean {
  const asked = hash.indexOf("?");
  const value = laserIn(search) ?? (asked < 0 ? null : laserIn(hash.slice(asked + 1)));
  const on = value === null ? null : ["", "on", "1", "true"].includes(value) ? true : ["off", "0", "false"].includes(value) ? false : null;
  try {
    if (on === true) store?.setItem(LASER_KEY, "on");
    if (on === false) store?.removeItem(LASER_KEY);
    if (on !== null) return on;
    return store?.getItem(LASER_KEY) === "on";
  } catch {
    return on ?? false;
  }
}

let flag: boolean | null = null;

/** Whether the Laser page shows in this tab, read once (off outside a browser unless `setLaserShown`). */
export function laserShown(): boolean {
  if (flag === null) {
    let store: FlagStore | null = null;
    try {
      store = globalThis.sessionStorage ?? null;
    } catch {
      store = null;
    }
    flag = readLaserFlag(globalThis.location?.search ?? "", store, globalThis.location?.hash ?? "");
  }
  return flag;
}

/** For tests: the flag as if the address had said so (null: read it again next time). */
export function setLaserShown(on: boolean | null): void {
  flag = on;
}
