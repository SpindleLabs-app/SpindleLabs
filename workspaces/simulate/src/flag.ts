// Whether the TestLab page shows (step T1): off until Ben says it goes public.
// Opening the app with `?testlab` in its address turns it on for the tab (kept
// in sessionStorage, so it survives reloads); `?testlab=off` turns it off.
// Written after the "#" too (`#simulate?testlab`), it works the same, the part
// before the "#" winning; slashes, spaces and capitals round it are forgiven,
// as Design's `?combine` is. Without it, the workspace is the Simulate placeholder it was.

/** sessionStorage's key for the flag. */
export const TESTLAB_KEY = "spindle-testlab";

type FlagStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function testlabIn(query: string): string | null {
  const plain = (s: string) => s.replace(/^[\s/]+|[\s/]+$/g, "").toLowerCase();
  for (const [name, value] of new URLSearchParams(query)) if (plain(name) === "testlab") return plain(value);
  return null;
}

/** The flag from the address and the tab's store: `?testlab` (or =on, =1, =true) turns it on and remembers it, `?testlab=off` (=0, =false) forgets it, anything else is ignored. A store that throws counts as empty. */
export function readTestLabFlag(search: string, store: FlagStore | null, hash = ""): boolean {
  const asked = hash.indexOf("?");
  const value = testlabIn(search) ?? (asked < 0 ? null : testlabIn(hash.slice(asked + 1)));
  const on = value === null ? null : ["", "on", "1", "true"].includes(value) ? true : ["off", "0", "false"].includes(value) ? false : null;
  try {
    if (on === true) store?.setItem(TESTLAB_KEY, "on");
    if (on === false) store?.removeItem(TESTLAB_KEY);
    if (on !== null) return on;
    return store?.getItem(TESTLAB_KEY) === "on";
  } catch {
    return on ?? false;
  }
}

let flag: boolean | null = null;

/** Whether the TestLab page shows in this tab, read once (off outside a browser unless `setTestLabShown`). */
export function testlabShown(): boolean {
  if (flag === null) {
    let store: FlagStore | null = null;
    try {
      store = globalThis.sessionStorage ?? null;
    } catch {
      store = null;
    }
    flag = readTestLabFlag(globalThis.location?.search ?? "", store, globalThis.location?.hash ?? "");
  }
  return flag;
}

/** For tests: the flag as if the address had said so (null: read it again next time). */
export function setTestLabShown(on: boolean | null): void {
  flag = on;
}
