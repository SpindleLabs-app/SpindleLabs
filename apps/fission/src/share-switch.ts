// The ?share switch for sharing links (community C2), kept apart from share.ts so the shell can read it without loading
// the account code. `?share` turns sharing links on for this tab (remembered in sessionStorage, so it survives the trip
// to the sign-in page and back); `?share=<id>` also opens that link. Off by default until the lawyer has checked the
// sharing terms.

export const SHARE_SWITCH = "share";
export const SHARE_TAB_KEY = "spindle.share.on";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Tab {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Whether sharing is on (the address has the switch, or this tab had it) and the link the address names, if any. */
export function shareSwitch(search: string, tab?: Tab): { on: boolean; id: string | null } {
  const p = new URLSearchParams(search);
  const here = p.has(SHARE_SWITCH);
  let remembered = false;
  try {
    if (here) tab?.setItem(SHARE_TAB_KEY, "1");
    else remembered = tab?.getItem(SHARE_TAB_KEY) === "1";
  } catch {
    // Storage blocked: the switch then lasts only as long as the address has it.
  }
  const v = p.get(SHARE_SWITCH) ?? "";
  return { on: here || remembered, id: here && UUID.test(v) ? v : null };
}

/** The same, read from this page. */
export function pageShareSwitch(): { on: boolean; id: string | null } {
  let tab: Tab | undefined;
  try {
    tab = window.sessionStorage;
  } catch {
    tab = undefined;
  }
  return shareSwitch(location.search, tab);
}
