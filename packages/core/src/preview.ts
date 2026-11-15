// The preview switches (Ben, 2026-11-15: "release all features needing legal verification on a different url like
// ?community to try them out … make ?all do everything"). Two address switches, remembered for the tab in
// sessionStorage like `?combine` (so they survive reloads, the trip to the sign-in page and moving between workspaces):
//
// - `?community` turns on the app's side of every community feature still waiting for its legal check: sharing links,
//   publishing to and browsing the library, likes, and Friends (the `?share` and `?friends` switches). It opens nothing
//   by itself: the server keeps all of them off for everyone except the accounts on its testers list
//   (supabase/migrations/20261115120000_community_testers.sql), so a stranger typing the switch sees the features but
//   every one answers "not open yet", and nothing a tester shares can be opened by anyone off the list.
// - `?all` turns on every unreleased switch: `?community`, Combine, Laser, TestLab, every workspace listed with Split,
//   and the build-time ones (the Slice page, the design tabs and the home screen) for this tab. Offline mode is left
//   out on purpose: it installs the app in the browser, which a preview should never do behind the person's back.
//
// `?all=off` and `?community=off` forget them. Like `?combine`, a switch written after the "#" (`#design?all`) works the
// same, slashes, spaces and capitals typed round it are forgiven, and the part before the "#" wins when both say. Read
// once per page load: a switch changed later takes effect on the next load.

/** The address switches and the tab's keys for them. */
export const PREVIEW_ALL = "all";
export const PREVIEW_COMMUNITY = "community";
export const PREVIEW_ALL_KEY = "spindle-preview-all";
export const PREVIEW_COMMUNITY_KEY = "spindle-preview-community";

/** What the preview switches turn on. `community` is true whenever `all` is. */
export interface Previews {
  all: boolean;
  community: boolean;
}

type PreviewStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const plain = (s: string) => s.replace(/^[\s/]+|[\s/]+$/g, "").toLowerCase();

/** The value of switch `name` in a query, forgiving how it was typed; null when there is none. */
function valueIn(query: string, name: string): string | null {
  for (const [n, v] of new URLSearchParams(query)) if (plain(n) === name) return plain(v);
  return null;
}

/** One switch: on (and remembered) for "", on, 1, true; off (and forgotten) for off, 0, false; else what the store says. */
function readOne(search: string, hash: string, name: string, key: string, store: PreviewStore | null): boolean {
  const asked = hash.indexOf("?");
  const value = valueIn(search, name) ?? (asked < 0 ? null : valueIn(hash.slice(asked + 1), name));
  const on = value === null ? null : ["", "on", "1", "true"].includes(value) ? true : ["off", "0", "false"].includes(value) ? false : null;
  try {
    if (on === true) store?.setItem(key, "on");
    if (on === false) store?.removeItem(key);
    if (on !== null) return on;
    return store?.getItem(key) === "on";
  } catch {
    // Storage blocked (a private window): the switch lasts only as long as the address has it.
    return on ?? false;
  }
}

/** The preview switches from an address (`search` as location.search gives it, `hash` as location.hash) and the tab's store. */
export function readPreviews(search: string, store: PreviewStore | null, hash = ""): Previews {
  const all = readOne(search, hash, PREVIEW_ALL, PREVIEW_ALL_KEY, store);
  const community = readOne(search, hash, PREVIEW_COMMUNITY, PREVIEW_COMMUNITY_KEY, store);
  return { all, community: community || all };
}

let shown: Previews | null = null;

/** The preview switches of this page, read once (both off outside a browser: unit tests and journeys, unless `setPreviews`). */
export function previews(): Previews {
  if (shown === null) {
    let store: PreviewStore | null = null;
    try {
      store = globalThis.sessionStorage ?? null;
    } catch {
      store = null;
    }
    shown = readPreviews(globalThis.location?.search ?? "", store, globalThis.location?.hash ?? "");
  }
  return shown;
}

/** For tests: the switches as if the address had said so (null: read them again next time). */
export function setPreviews(p: Previews | null): void {
  shown = p;
}
