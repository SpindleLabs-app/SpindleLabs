// The ?offline switch (Ben, 2026-11-13: his school's web filter sometimes blocks the site, so he wants the app kept on
// his laptop). Offline mode is off for everyone until it is released (offline.config.mjs), but a person can turn it on
// for their own browser: `?offline` (or `?offline=on`) asks, and once they press Keep this browser keeps the app for
// offline use from then on, remembered in localStorage (so an installed app, which opens without the switch in its
// address, keeps it too); `?offline=off` asks to stop, and Remove forgets it and offline.ts removes what was kept.
// The address alone never changes anything (security hunt 2026-11-13 G2: another site's link or pop-up switched it on
// for good): only a press in the app does, which another site can't make. Kept apart from offline.ts so it is tested
// without a browser.

export const OFFLINE_SWITCH = "offline";
export const OFFLINE_KEY = "spindlelabs.offline";

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** What the page asks: whether to keep the app for offline use, whether to stop, or nothing. */
export type OfflineAsk = "keep" | "remove" | null;

function remembered(store?: Store): boolean {
  try {
    return store?.getItem(OFFLINE_KEY) === "on";
  } catch {
    return false; // storage blocked: nothing can be remembered
  }
}

/** Whether this browser keeps the app for offline use (only what a press remembered), and what the address asks. Writes nothing. */
export function offlineSwitch(search: string, store?: Store): { chosen: boolean; ask: OfflineAsk } {
  const p = new URLSearchParams(search);
  const chosen = remembered(store);
  if (!p.has(OFFLINE_SWITCH)) return { chosen, ask: null };
  const on = (p.get(OFFLINE_SWITCH) ?? "").toLowerCase() !== "off";
  return { chosen, ask: on === chosen ? null : on ? "keep" : "remove" };
}

/** The person pressed Keep: remember it. False when this browser can't remember it (storage blocked). */
export function keepOffline(store?: Store): boolean {
  try {
    if (!store) return false;
    store.setItem(OFFLINE_KEY, "on");
    return store.getItem(OFFLINE_KEY) === "on";
  } catch {
    return false;
  }
}

/** The person pressed Remove: forget it. */
export function forgetOffline(store?: Store): void {
  try {
    store?.removeItem(OFFLINE_KEY);
  } catch {
    // storage blocked: nothing was remembered
  }
}

/** This page's local storage, or undefined where it is blocked. */
export function pageStore(): Store | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The same as offlineSwitch, read from this page. */
export function pageOfflineSwitch() {
  return offlineSwitch(location.search, pageStore());
}
