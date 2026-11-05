// Settings that follow you (account features 3): the settings this browser keeps (the theme, units, slicer presets
// and choices…) kept in the person's account too, so every device they sign in on uses the same ones
// (supabase/migrations/20261106000000_settings.sql). The app says which settings follow (`SettingSpec`): never an AI
// key, a sign-in or a project.
//
// Two devices can each change settings while apart, so a round merges three copies of each setting: what this browser
// and the account last agreed on (the "base", kept here per person), what this browser has now and what the account
// has now. A setting changed on one side only takes that side's value. Changed on both sides:
//   - "map" settings (a JSON object, such as the Settings page's own) are merged entry by entry the same way;
//   - "list-by-id" settings (the slicer presets: {"version", "presets": [{id, updatedAt, …}]}) are merged preset by
//     preset, the one changed later winning, and a preset deleted on one side but changed on the other kept;
//   - anything else, or an entry changed on both sides: this browser's value, except the first time this person syncs
//     in this browser, when the account's wins (that is what "follows you" means on a new device). A value changed on
//     one side and deleted on the other is kept: a change is never lost to a deletion.
// The save names the revision it merged against, so a save that crossed another device's is refused and the round
// starts again from the account's newer copy. Settings this app doesn't know (a newer app's) are kept as they are.

import type { SmallStore } from "./auth.ts";
import type { DataResult } from "./data.ts";
import type { AuthClient } from "./auth.ts";

/** The limits, as the database keeps them (settings_limits()). Checked there; here to say them in words and to test against. */
export const SETTINGS_LIMITS = { maxSettings: 64, maxBytes: 256 * 1024, maxName: 100 } as const;

/** Where this browser keeps, per person, the copy it and the account last agreed on (never sent anywhere). */
export const SETTINGS_BASE_PREFIX = "spindle.account.settings/";

/** A name the account takes: "spindlelabs" then letters, digits and . - / _ (the database checks the same). */
export const SETTING_NAME = /^spindlelabs[A-Za-z0-9./_-]*$/;

export type SettingKind = "text" | "map" | "list-by-id";
export interface SettingSpec {
  /** The browser storage key. */
  readonly key: string;
  readonly kind: SettingKind;
}

export type Values = Readonly<Record<string, string>>;

export interface AccountSettings {
  readonly keep: boolean;
  readonly revision: number;
  readonly settings: Values;
}

export type SaveSettingsAnswer = { readonly status: "saved" | "changed"; readonly revision: number } | { readonly status: "too-big" | "invalid" | "off" };

const malformed = { kind: "failed", reason: "malformed" } as const;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function valuesFrom(v: unknown): Record<string, string> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== "string") return null;
    out[k] = x;
  }
  return out;
}

export function accountSettingsFrom(v: unknown): AccountSettings | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const settings = valuesFrom(r.settings);
  return typeof r.keep === "boolean" && isCount(r.revision) && settings ? { keep: r.keep, revision: r.revision, settings } : null;
}

export function saveSettingsAnswerFrom(v: unknown): SaveSettingsAnswer | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (r.status === "saved") return isCount(r.revision) && r.revision >= 1 ? { status: "saved", revision: r.revision } : null;
  if (r.status === "changed") return isCount(r.revision) ? { status: "changed", revision: r.revision } : null;
  if (r.status === "too-big" || r.status === "invalid" || r.status === "off") return { status: r.status };
  return null;
}

export function settingsApi(client: AuthClient) {
  return {
    /** The settings kept in the account, its revision (0 before the first save) and whether keeping them is on. */
    async read(): Promise<DataResult<AccountSettings>> {
      const r = await client.asPerson("POST", "rpc/my_settings");
      if (r.kind !== "ok") return r;
      const s = accountSettingsFrom(r.body);
      return s ? { kind: "ok", value: s } : malformed;
    },
    /** Replaces the account's settings with `settings`, if the account is still at revision `expected`. */
    async save(settings: Values, expected: number): Promise<DataResult<SaveSettingsAnswer>> {
      const r = await client.asPerson("POST", "rpc/save_settings", { p_settings: settings, p_expected: expected });
      if (r.kind !== "ok") return r;
      const a = saveSettingsAnswerFrom(r.body);
      return a ? { kind: "ok", value: a } : malformed;
    },
    /** Turns keeping settings on or off on every device; off deletes the ones kept in the account. */
    async setKeeping(on: boolean): Promise<DataResult<boolean>> {
      const r = await client.asPerson("POST", "rpc/set_keep_settings", { p_on: on === true });
      if (r.kind !== "ok") return r;
      return typeof r.body === "boolean" ? { kind: "ok", value: r.body } : malformed;
    },
  };
}

export type SettingsApi = ReturnType<typeof settingsApi>;

// The merge

type Prefer = "local" | "remote";
type Json = unknown;
const same = (a: Json, b: Json) => a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

/**
 * One value merged from base `b`, this browser's `l` and the account's `r` (undefined: not there). `both` settles a
 * value changed on both sides to different values, given both (either may be undefined: deleted on that side).
 */
function three<T>(b: T | undefined, l: T | undefined, r: T | undefined, both: (l: T | undefined, r: T | undefined) => T | undefined): T | undefined {
  if (same(l, r)) return l;
  if (same(l, b)) return r;
  if (same(r, b)) return l;
  // Changed on both sides: a change beats a deletion.
  if (l === undefined) return r;
  if (r === undefined) return l;
  return both(l, r);
}

const parse = (text: string | undefined): Json | undefined => {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A "map" setting changed on both sides: entry by entry; null when one side isn't a JSON object (then it is plain text). */
function mergeMap(b: string | undefined, l: string, r: string, prefer: Prefer): string | null {
  const [pb, pl, pr] = [b === undefined ? {} : parse(b), parse(l), parse(r)];
  if (!isObject(pl) || !isObject(pr)) return null;
  const base = isObject(pb) ? pb : {};
  const out: Record<string, Json> = {};
  for (const k of new Set([...Object.keys(pl), ...Object.keys(pr)])) {
    const v = three(base[k], pl[k], pr[k], (x, y) => (prefer === "local" ? x : y));
    if (v !== undefined) out[k] = v;
  }
  return JSON.stringify(out);
}

interface Listed {
  readonly id: string;
  readonly updatedAt: number;
}
const isListed = (v: Json): v is Listed & Record<string, Json> => isObject(v) && typeof v.id === "string" && v.id !== "";
const stamp = (v: Json) => (isObject(v) && typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : 0);

/**
 * A "list-by-id" setting changed on both sides: entry by entry by id, an entry changed on both sides going to the
 * later `updatedAt` (the same time: `prefer`). Entries without an id are kept from both sides, once each. Null when
 * the sides aren't the same shape and version (then it is plain text).
 */
function mergeList(b: string | undefined, l: string, r: string, prefer: Prefer): string | null {
  const [pb, pl, pr] = [parse(b), parse(l), parse(r)];
  if (!isObject(pl) || !isObject(pr) || !Array.isArray(pl.presets) || !Array.isArray(pr.presets) || pl.version !== pr.version) return null;
  const byId = (list: Json[]) => {
    const m = new Map<string, Json>();
    for (const e of list) if (isListed(e) && !m.has(e.id)) m.set(e.id, e);
    return m;
  };
  const base = byId(isObject(pb) && pb.version === pl.version && Array.isArray(pb.presets) ? pb.presets : []);
  const [ml, mr] = [byId(pl.presets), byId(pr.presets)];
  const order = [...ml.keys(), ...[...mr.keys()].filter((id) => !ml.has(id))];
  const merged: Json[] = [];
  for (const id of order) {
    const v = three(base.get(id), ml.get(id), mr.get(id), (x, y) => (stamp(x) > stamp(y) ? x : stamp(y) > stamp(x) ? y : prefer === "local" ? x : y));
    if (v !== undefined) merged.push(v);
  }
  // Entries with no id, or a second with an id already listed: kept, never matched (the presets code keeps them too).
  const firsts = new Set([...ml.values(), ...mr.values()]);
  const loose: Json[] = [];
  for (const e of [...pl.presets, ...pr.presets]) if (!firsts.has(e) && !loose.some((x) => same(x, e))) loose.push(e);
  return JSON.stringify({ ...pr, ...pl, presets: [...merged, ...loose] });
}

/**
 * The three copies merged, setting by setting (see the top of this file). `prefer` settles a value changed on both
 * sides that can't be merged further: "local" normally, "remote" the first time a person syncs in a browser. Settings
 * not in `specs` take the account's value (this app neither shows nor changes them).
 */
export function mergeSettings(specs: readonly SettingSpec[], base: Values, local: Values, remote: Values, prefer: Prefer): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Map(specs.map((s) => [s.key, s.kind]));
  for (const [k, v] of Object.entries(remote)) if (!known.has(k)) out[k] = v;
  for (const [key, kind] of known) {
    const v = three(base[key], local[key], remote[key], (l, r) => {
      const deeper = kind === "map" ? mergeMap(base[key], l!, r!, prefer) : kind === "list-by-id" ? mergeList(base[key], l!, r!, prefer) : null;
      return deeper ?? (prefer === "local" ? l : r);
    });
    if (v !== undefined) out[key] = v;
  }
  return out;
}

// The rounds

interface Base {
  readonly revision: number;
  readonly settings: Values;
  /** This browser's settings the account refused as too big: not sent again until they change. */
  readonly held?: Values;
}

function readBase(store: SmallStore, userId: string): Base | null {
  try {
    const raw = store.getItem(SETTINGS_BASE_PREFIX + userId);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    const settings = valuesFrom(v?.settings);
    const held = v?.held === undefined ? undefined : valuesFrom(v.held);
    return isCount(v?.revision) && settings && held !== null ? { revision: v.revision, settings, ...(held ? { held } : {}) } : null;
  } catch {
    return null; // damaged: start again as if new here, which never loses a setting
  }
}

/** Forgets what this browser and `userId`'s account last agreed on (signing out, turning it off, deleting the account). */
export function forgetSettingsBase(store: SmallStore, userId: string): void {
  try {
    store.removeItem(SETTINGS_BASE_PREFIX + userId);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

export interface SettingsSyncDeps {
  readonly api: Pick<SettingsApi, "read" | "save">;
  readonly userId: string;
  /** This browser's storage: the settings themselves and the base. */
  readonly store: SmallStore;
  readonly specs: readonly SettingSpec[];
  /** Runs `fn` while no other tab of this browser is syncing settings. */
  lock<T>(fn: () => Promise<T>): Promise<T>;
}

export type SettingsReport =
  /** `changed`: the settings this browser took from the account (to apply now). `tooBig`: this browser's weren't kept. */
  | { readonly kind: "done"; readonly changed: readonly string[]; readonly sent: boolean; readonly tooBig?: true }
  | { readonly kind: "off" }
  | Exclude<DataResult<never>, { kind: "ok" }>;

/** A save that crossed another device's is tried again this many times in one round (each from the newer copy). */
export const SETTINGS_TRIES = 3;

export function settingsSync(deps: SettingsSyncDeps) {
  const { api, store, userId, specs } = deps;

  function localNow(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of specs) {
      const v = store.getItem(s.key);
      if (v !== null) out[s.key] = v;
    }
    return out;
  }

  /** True when a setting here differs from what this browser and the account last agreed on (or they never have). */
  function changedHere(): boolean {
    const base = readBase(store, userId);
    if (!base) return true;
    try {
      const now = localNow();
      if (base.held && specs.every((s) => now[s.key] === base.held![s.key])) return false; // refused as too big, unchanged since
      return specs.some((s) => now[s.key] !== base.settings[s.key]);
    } catch {
      return false; // storage blocked: nothing to send
    }
  }

  /** One round: take the account's changes, send this browser's, and put the merged settings here. */
  function round(): Promise<SettingsReport> {
    return deps.lock(async () => {
      let local: Record<string, string>;
      try {
        local = localNow();
      } catch {
        return { kind: "failed", reason: "storage" };
      }
      const base = readBase(store, userId);
      for (let attempt = 0; attempt < SETTINGS_TRIES; attempt++) {
        const got = await api.read();
        if (got.kind !== "ok") return got;
        const remote = got.value;
        if (!remote.keep) {
          forgetSettingsBase(store, userId);
          return { kind: "off" };
        }
        // The first time here (no base), or the account emptied since (turned off and on, a newer revision gone): no
        // shared past, so the account's value wins where both have one.
        const fresh = base === null || remote.revision < base.revision;
        const merged = mergeSettings(specs, fresh ? {} : base.settings, local, remote.settings, fresh ? "remote" : "local");
        let kept: Base = { revision: remote.revision, settings: remote.settings };
        let sent = false;
        let tooBig = false;
        const heldStill = base !== null && !fresh && base.held !== undefined && base.revision === remote.revision && same(sortKeys(base.held), sortKeys(merged));
        if (heldStill) tooBig = true; // refused before and nothing changed on either side: not sent again
        else if (!same(sortKeys(merged), sortKeys(remote.settings))) {
          const s = await api.save(merged, remote.revision);
          if (s.kind !== "ok") return s;
          const a = s.value;
          if (a.status === "changed") continue; // another device saved meanwhile: merge again from its copy
          if (a.status === "off") {
            forgetSettingsBase(store, userId);
            return { kind: "off" };
          }
          if (a.status === "invalid") return malformed;
          if (a.status === "saved") {
            kept = { revision: a.revision, settings: merged };
            sent = true;
          } else tooBig = true; // the account keeps what it had; this browser's changes stay here and are tried again when they change
        }
        // Put the merged settings here, except one changed here while the round ran: that newer change stays, and goes next round.
        const changed: string[] = [];
        try {
          for (const s of specs) {
            const want = merged[s.key];
            const now = store.getItem(s.key) ?? undefined;
            if (now !== local[s.key] || now === want) continue;
            if (want === undefined) store.removeItem(s.key);
            else store.setItem(s.key, want);
            changed.push(s.key);
          }
          store.setItem(SETTINGS_BASE_PREFIX + userId, JSON.stringify(tooBig ? { ...kept, held: merged } : kept));
        } catch {
          return { kind: "failed", reason: "storage" };
        }
        return { kind: "done", changed, sent, ...(tooBig ? { tooBig: true as const } : {}) };
      }
      return { kind: "failed", reason: "unavailable" }; // the account kept changing under every try: next round
    });
  }

  return { round, changedHere };
}

const sortKeys = (v: Values) => Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export type SettingsSync = ReturnType<typeof settingsSync>;
