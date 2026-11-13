// The ?offline switch (Ben, 2026-11-13: his school's web filter sometimes blocks the site, so he wants the app kept on
// his laptop). Offline mode is off for everyone until it is released (offline.config.mjs), but a person can turn it on
// for their own browser: `?offline` (or `?offline=on`) once, and this browser keeps the app for offline use from then on,
// remembered in localStorage (so an installed app, which opens without the switch in its address, keeps it too);
// `?offline=off` turns it off again and offline.ts removes what was kept. Kept apart from offline.ts so it is tested
// without a browser.

export const OFFLINE_SWITCH = "offline";
export const OFFLINE_KEY = "spindlelabs.offline";

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** Whether this browser keeps the app for offline use: the address's switch (remembered in `store`), else what was remembered. */
export function offlineChosen(search: string, store?: Store): boolean {
  const p = new URLSearchParams(search);
  const value = p.has(OFFLINE_SWITCH) ? (p.get(OFFLINE_SWITCH) ?? "").toLowerCase() : null;
  const here = value === null ? null : value !== "off";
  try {
    if (here === true) store?.setItem(OFFLINE_KEY, "on");
    else if (here === false) store?.removeItem(OFFLINE_KEY);
    else return store?.getItem(OFFLINE_KEY) === "on";
  } catch {
    // Storage blocked: the switch then lasts only as long as the address has it.
  }
  return here === true;
}

/** The same, read from this page. */
export function pageOfflineChosen(): boolean {
  let store: Store | undefined;
  try {
    store = window.localStorage;
  } catch {
    store = undefined;
  }
  return offlineChosen(location.search, store);
}
