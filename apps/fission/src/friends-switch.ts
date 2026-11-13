// The ?friends switch for Friends (account features 6), kept apart from friends.ts so the account code can read it
// without loading the dialog. `?friends` turns Friends on for this tab (remembered in sessionStorage, so it survives
// the trip to the sign-in page and back); `?friends=off` forgets it. Off by default until the lawyer has checked the
// sharing items (legal items 17, 18, 19, 21 and 29) Friends depends on.

export const FRIENDS_SWITCH = "friends";
export const FRIENDS_TAB_KEY = "spindlelabs.friends.on";

interface Tab {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Whether Friends is on: the address has the switch, or this tab had it and the address doesn't say off. */
export function friendsSwitch(search: string, tab?: Tab): boolean {
  const p = new URLSearchParams(search);
  const v = p.get(FRIENDS_SWITCH);
  try {
    if (v === "off") {
      tab?.removeItem(FRIENDS_TAB_KEY);
      return false;
    }
    if (v !== null) {
      tab?.setItem(FRIENDS_TAB_KEY, "1");
      return true;
    }
    return tab?.getItem(FRIENDS_TAB_KEY) === "1";
  } catch {
    // Storage blocked: the switch then lasts only as long as the address has it.
    return v !== null && v !== "off";
  }
}

/** The same, read from this page. */
export function pageFriendsSwitch(): boolean {
  let tab: Tab | undefined;
  try {
    tab = window.sessionStorage;
  } catch {
    tab = undefined;
  }
  return friendsSwitch(location.search, tab);
}
