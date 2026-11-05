// Settings that follow you in the app (account features 3): while someone is signed in with keeping settings on, the
// settings listed here are kept in their account and the same on every device they sign in on (@fission/account
// settings.ts merges them). Loaded with the account code only. Nothing here is ever needed: signed out, offline or with
// the account service down, every setting works in this browser exactly as before.
//
// Only these follow you. A new setting that should follow you is added here (and to the privacy page's list, which
// e2e/privacy.test.mjs checks against this one). Never an AI key, a sign-in, a project, or something about one device
// only (a view left open, the window's layout): those keep their own keys outside this list.

import { type AuthClient, forgetSettingsBase, type SettingSpec, settingsApi, type SettingsReport, settingsSync, type SmallStore } from "@fission/account";

/** The settings that follow you, with what each is in plain words (for the privacy page's list). */
export const SYNCED_SETTINGS: readonly (SettingSpec & { readonly words: string })[] = [
  // The Settings page's own (packages/ui settings.ts SETTINGS_KEY): the theme and its custom colours, the units.
  { key: "spindlelabs-settings", kind: "map", words: "the Settings page's choices: the theme, its custom colours and the units" },
  // Slice for printing (workspaces/design slice-presets.ts and slice-print.ts).
  { key: "spindlelabs.slice.presets", kind: "list-by-id", words: "your slicer presets" },
  { key: "spindlelabs.slice.preset", kind: "text", words: "the preset you picked last" },
  { key: "spindlelabs.slice.nozzle", kind: "text", words: "the nozzle you chose" },
  { key: "spindlelabs.slice.warm-up", kind: "text", words: "the warm-up loop's setting" },
  { key: "spindlelabs.slice.better-grip", kind: "text", words: "Better grip's setting" },
];

/** A round waits this long after a change here, so a run of changes goes as one. */
export const SETTINGS_SEND_AFTER_MS = 4000;
/** How often this browser looks for a changed setting (only reads this browser's storage; sends nothing unless one changed). */
export const SETTINGS_LOOK_MS = 5000;
/** Coming back to the tab asks the account for other devices' changes, at most this often. */
export const SETTINGS_PULL_MS = 60_000;

export interface SettingsHost {
  /** Settings were just brought from the account into this browser's storage: show them now (theme, units…). */
  applied(keys: readonly string[]): void;
}

export function startSettings(client: AuthClient, store: SmallStore, host: SettingsHost) {
  const api = settingsApi(client);
  const userId = () => {
    const s = client.state();
    return s.kind === "signed-in" ? s.user.id : null;
  };
  const syncFor = (user: string) =>
    settingsSync({
      api,
      userId: user,
      store,
      specs: SYNCED_SETTINGS,
      lock: (fn) => (globalThis.navigator?.locks ? navigator.locks.request("spindle-settings-sync", fn) : fn()),
    });

  let last: SettingsReport | null = null;
  let lastPull = 0;
  let running: Promise<void> | null = null;
  let off = false; // turned off (on any device): nothing is sent until it is turned on here or a read says it's on
  async function now(): Promise<void> {
    const user = userId();
    if (!user) return;
    if (running) return running.then(now);
    running = (async () => {
      try {
        lastPull = Date.now();
        last = await syncFor(user).round();
        off = last.kind === "off";
        if (last.kind === "done" && last.changed.length) host.applied(last.changed);
      } catch {
        last = { kind: "failed", reason: "storage" };
      } finally {
        running = null;
      }
    })();
    return running;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  function look(): void {
    const user = userId();
    if (!user || off || timer || running) return;
    let changed = false;
    try {
      changed = syncFor(user).changedHere();
    } catch {
      return;
    }
    if (!changed) return;
    timer = setTimeout(() => {
      timer = null;
      void now();
    }, SETTINGS_SEND_AFTER_MS);
  }
  setInterval(look, SETTINGS_LOOK_MS);
  addEventListener("online", () => void now());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastPull >= SETTINGS_PULL_MS) void now();
    // Leaving the tab: a change made just now goes before the tab may be closed.
    if (document.visibilityState === "hidden" && timer) {
      clearTimeout(timer);
      timer = null;
      void now();
    }
  });

  return {
    /** A round now (signing in, starting signed in). */
    now,
    /** The words about the last round, for the account dialog. "" when there is nothing to say. */
    words(): string {
      if (last === null || last.kind === "off" || last.kind === "signed-out") return "";
      if (last.kind === "done") return last.tooBig ? "Your settings are too big to keep in your account (over 256 KB), so your latest changes stay only in this browser." : "";
      if (last.kind === "failed" && last.reason === "rejected") return ""; // the account service doesn't keep settings yet
      return last.reason === "offline" ? "Your account couldn't be reached, so your settings will follow you once you're back online." : "Your settings couldn't be brought up to date with your account just now. They will be tried again soon.";
    },
    /** Whether keeping settings is on, or null when the account can't say (offline, or it doesn't keep settings yet). */
    async keeping(): Promise<boolean | null> {
      const r = await api.read();
      return r.kind === "ok" ? r.value.keep : null;
    },
    /** Turns keeping settings on or off on every device; off deletes them from the account. Throws the words when it can't. */
    async setKeeping(on: boolean, failed: (r: Exclude<Awaited<ReturnType<typeof api.setKeeping>>, { kind: "ok" }>) => string): Promise<void> {
      const user = userId();
      const r = await api.setKeeping(on);
      if (r.kind !== "ok") throw new Error(failed(r));
      if (user) forgetSettingsBase(store, user);
      off = !on;
      if (on) await now();
    },
    /** Signing out or deleting the account: what this browser and the account last agreed on goes; settings here stay. */
    forget(user: string): void {
      if (timer) clearTimeout(timer);
      timer = null;
      forgetSettingsBase(store, user);
    },
  };
}

export type Settings = ReturnType<typeof startSettings>;
