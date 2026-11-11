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
// starts again from the account's newer copy. Settings this app doesn't know (a newer app's) are kept as they are, and so
// is a preset an older app wrote back without the parts it doesn't know (same id and `updatedAt`: not edited here).
//
// Three more things keep a person's settings theirs (account bug hunt 2026-11-11):
//   - the account's copy carries a history id given when it is made (SETTINGS_HISTORY), so a copy deleted and made again
//     (keeping turned off and on) is never mistaken for the one a device last agreed with, whose settings it lacks;
//   - this browser remembers a code for the last account that synced here (SETTINGS_LAST_KEY, `personTag`): someone
//     else's first round here takes their account's settings and sends none of what the browser has that their account
//     lacks (a shared computer: it may be the last person's); that stays here, set aside in the base, never sent;
//   - signing out notes the settings changed here and not sent yet (SETTINGS_UNSENT_PREFIX), so they are sent on the
//     same person's next sign-in here, and a round still running when they sign out writes nothing (`current`).

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
 * A "list-by-id" value here with every entry that wasn't edited here put back as the base had it: an entry with the
 * base's id and the same `updatedAt` (the presets code stamps every save, rename and update) was only read and written
 * back, perhaps by an older app that drops what it doesn't know (a newer app's choice in a preset), which must not count
 * as a change here. Anything else is left as it is.
 */
function unedited(b: string | undefined, l: string | undefined): string | undefined {
  if (b === undefined || l === undefined) return l;
  const [pb, pl] = [parse(b), parse(l)];
  if (!isObject(pb) || !isObject(pl) || !Array.isArray(pb.presets) || !Array.isArray(pl.presets) || pb.version !== pl.version) return l;
  const before = new Map<string, Json>();
  for (const e of pb.presets) if (isListed(e) && typeof e.updatedAt === "number" && !before.has(e.id)) before.set(e.id, e);
  let swapped = false;
  const seen = new Set<string>();
  const presets = pl.presets.map((e) => {
    if (!isListed(e) || seen.has(e.id)) return e;
    seen.add(e.id);
    const was = before.get(e.id);
    if (was === undefined || stamp(was) !== e.updatedAt || same(was, e)) return e;
    swapped = true;
    return was;
  });
  if (!swapped) return l;
  const out = JSON.stringify({ ...pl, presets });
  return same(parse(out), pb) ? b : out;
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
    const here = kind === "list-by-id" ? unedited(base[key], local[key]) : local[key];
    const v = three(base[key], here, remote[key], (l, r) => {
      const deeper = kind === "map" ? mergeMap(base[key], l!, r!, prefer) : kind === "list-by-id" ? mergeList(base[key], l!, r!, prefer) : null;
      return deeper ?? (prefer === "local" ? l : r);
    });
    if (v !== undefined) out[key] = v;
  }
  return out;
}


// The rounds

/** A setting the account keeps for itself: a random id given when its copy is first made, so a device can tell a copy
 * made again (keeping turned off and on, which deletes it and starts the revisions again at 1) from the one it knew.
 * Never in this browser's storage, never shown. */
export const SETTINGS_HISTORY = "spindlelabs.account.history";

/** Where this browser keeps a code for the last account it synced settings with (see `personTag`); it stays on sign out. */
export const SETTINGS_LAST_KEY = "spindle.account.settings-last";

/** Where this browser keeps, per person, the settings changed here but not yet sent when they signed out. */
export const SETTINGS_UNSENT_PREFIX = "spindle.account.settings-unsent/";

/**
 * A short code for an account id (two 32-bit FNV-1a hashes with different starting values), so this browser can tell
 * whether the account syncing now is the one that synced last without keeping the id itself.
 */
export function personTag(userId: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < userId.length; i++) {
    const c = userId.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return a.toString(36) + "." + b.toString(36);
}

function newHistory(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof c?.randomUUID === "function" ? c.randomUUID() : `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

interface Base {
  readonly revision: number;
  /** What this browser and the account agreed on at `revision` (a setting changed here while that round ran keeps the
   * value agreed before it, so the next round still merges it three ways). */
  readonly settings: Values;
  /** This browser's settings the account refused as too big: not sent again until they change. */
  readonly held?: Values;
  /** Settings, or parts of them, left in this browser by someone else (see `notIn`): kept here, never sent. */
  readonly aside?: Values;
}

function readBase(store: SmallStore, userId: string): Base | null {
  try {
    const raw = store.getItem(SETTINGS_BASE_PREFIX + userId);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    const settings = valuesFrom(v?.settings);
    const held = v?.held === undefined ? undefined : valuesFrom(v.held);
    const aside = v?.aside === undefined ? undefined : valuesFrom(v.aside);
    return isCount(v?.revision) && settings && held !== null && aside !== null ? { revision: v.revision, settings, ...(held ? { held } : {}), ...(aside ? { aside } : {}) } : null;
  } catch {
    return null; // damaged: start again as if new here, which never loses a setting
  }
}

/** Per setting: [the value agreed before, the value here] when signing out (null: none). */
type Unsent = Map<string, readonly [string | undefined, string | undefined]>;

function readUnsent(store: SmallStore, userId: string): Unsent {
  const out: Unsent = new Map();
  try {
    const v = JSON.parse(store.getItem(SETTINGS_UNSENT_PREFIX + userId) ?? "null") as unknown;
    if (!isObject(v)) return out;
    const text = (x: unknown) => (typeof x === "string" ? x : undefined);
    for (const [k, pair] of Object.entries(v)) if (Array.isArray(pair) && pair.length === 2 && pair.every((x) => x === null || typeof x === "string")) out.set(k, [text(pair[0]), text(pair[1])]);
  } catch {
    // Damaged or blocked: nothing noted.
  }
  return out;
}

/** Forgets what this browser and `userId`'s account last agreed on (signing out, turning it off, deleting the account). */
export function forgetSettingsBase(store: SmallStore, userId: string): void {
  try {
    store.removeItem(SETTINGS_BASE_PREFIX + userId);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

// Someone else's settings left in this browser. A part of a setting is an entry of a "map" setting (by name) or of a
// "list-by-id" one (by id); a "text" setting is one part.

type Parts = { kind: "map"; obj: Record<string, Json> } | { kind: "list"; obj: Record<string, Json>; list: Json[] };
function partsOf(kind: SettingKind, v: string): Parts | null {
  const p = parse(v);
  if (kind === "map" && isObject(p)) return { kind: "map", obj: p };
  if (kind === "list-by-id" && isObject(p) && Array.isArray(p.presets)) return { kind: "list", obj: p, list: p.presets };
  return null;
}
const ids = (list: Json[]) => new Set(list.filter(isListed).map((e) => e.id));
const listText = (obj: Record<string, Json>, list: Json[]) => JSON.stringify({ ...obj, presets: list });

/** The parts of `x` that `y` doesn't have (an entry of the same name or id), or undefined when there are none. */
function notIn(kind: SettingKind, x: string | undefined, y: string | undefined): string | undefined {
  if (x === undefined || y === undefined) return x;
  const [px, py] = [partsOf(kind, x), partsOf(kind, y)];
  if (px?.kind === "map" && py?.kind === "map") {
    const rest = Object.entries(px.obj).filter(([k]) => !(k in py.obj));
    return rest.length ? JSON.stringify(Object.fromEntries(rest)) : undefined;
  }
  if (px?.kind === "list" && py?.kind === "list") {
    const have = ids(py.list);
    const rest = px.list.filter((e) => (isListed(e) ? !have.has(e.id) : !py.list.some((f) => same(e, f))));
    return rest.length ? listText(px.obj, rest) : undefined;
  }
  return undefined; // text, or not the same shape: the one value is y's
}

/** `l` without the parts of `a` it still has unchanged (undefined when nothing else is left). */
function strip(kind: SettingKind, l: string | undefined, a: string | undefined): string | undefined {
  if (l === undefined || a === undefined) return l;
  if (l === a) return undefined;
  const [pl, pa] = [partsOf(kind, l), partsOf(kind, a)];
  if (pl?.kind === "map" && pa?.kind === "map") {
    const rest = Object.entries(pl.obj).filter(([k, v]) => !(k in pa.obj && same(v, pa.obj[k])));
    if (rest.length === Object.keys(pl.obj).length) return l;
    return rest.length ? JSON.stringify(Object.fromEntries(rest)) : undefined;
  }
  if (pl?.kind === "list" && pa?.kind === "list") {
    const rest = pl.list.filter((e) => !pa.list.some((f) => same(e, f)));
    if (rest.length === pl.list.length) return l;
    return rest.length ? listText(pl.obj, rest) : undefined;
  }
  return l;
}

/** What this browser keeps: `w` (the merged value) with the parts of `a` set aside that `w` doesn't have. */
function withAside(kind: SettingKind, w: string | undefined, a: string | undefined): string | undefined {
  const rest = notIn(kind, a, w);
  if (rest === undefined || w === undefined) return w ?? rest;
  const [pw, pr] = [partsOf(kind, w), partsOf(kind, rest)];
  if (pw?.kind === "map" && pr?.kind === "map") return JSON.stringify({ ...pw.obj, ...pr.obj });
  if (pw?.kind === "list" && pr?.kind === "list") return listText(pw.obj, [...pw.list, ...pr.list]);
  return w;
}

export interface SettingsSyncDeps {
  readonly api: Pick<SettingsApi, "read" | "save">;
  readonly userId: string;
  /** This browser's storage: the settings themselves and the base. */
  readonly store: SmallStore;
  readonly specs: readonly SettingSpec[];
  /** Runs `fn` while no other tab of this browser is syncing settings. */
  lock<T>(fn: () => Promise<T>): Promise<T>;
  /** False once this person signed out here (or the account was deleted): a round still running then writes nothing. */
  current?(): boolean;
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
  const current = () => deps.current?.() ?? true;
  const tag = personTag(userId);

  function localNow(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of specs) {
      const v = store.getItem(s.key);
      if (v !== null) out[s.key] = v;
    }
    return out;
  }

  /** This browser's settings without the parts set aside as someone else's. */
  function own(local: Values, aside: Values | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of specs) {
      const v = strip(s.kind, local[s.key], aside?.[s.key]);
      if (v !== undefined) out[s.key] = v;
    }
    return out;
  }

  /** True when a setting here differs from what this browser and the account last agreed on (or they never have). */
  function changedHere(): boolean {
    const base = readBase(store, userId);
    if (!base) return true;
    try {
      const now = own(localNow(), base.aside);
      if (base.held && specs.every((s) => now[s.key] === base.held![s.key])) return false; // refused as too big, unchanged since
      return specs.some((s) => now[s.key] !== base.settings[s.key]);
    } catch {
      return false; // storage blocked: nothing to send
    }
  }

  /** The base's copy and the account's are not the same history: the account's copy was deleted and made again since. */
  function madeAgain(base: Base, remote: AccountSettings): boolean {
    if (remote.revision < base.revision) return true;
    // A copy gets its history id only when it is made, so a different one (or one where there was none) is another copy.
    return base.revision > 0 && remote.revision > 0 && base.settings[SETTINGS_HISTORY] !== remote.settings[SETTINGS_HISTORY];
  }

  /** One round: take the account's changes, send this browser's, and put the merged settings here. */
  function round(): Promise<SettingsReport> {
    return deps.lock(async () => {
      let local: Record<string, string>;
      let lastHere: string | null;
      try {
        local = localNow();
        lastHere = store.getItem(SETTINGS_LAST_KEY);
      } catch {
        return { kind: "failed", reason: "storage" };
      }
      const base = readBase(store, userId);
      const unsent = base === null ? readUnsent(store, userId) : new Map() as Unsent;
      // Settings changed here and not sent when this person signed out, still as they left them: theirs.
      const theirs = new Set([...unsent].filter(([k, [, here]]) => local[k] === here).map(([k]) => k));
      // The first round here for someone who isn't the last person who synced settings in this browser: what this browser
      // has that their account doesn't may be someone else's (a shared computer), so it stays here and isn't sent.
      const stranger = base === null && lastHere !== null && lastHere !== tag;
      const stillHere = () => current() && (base === null || readBase(store, userId) !== null);
      const markHere = () => {
        try {
          store.setItem(SETTINGS_LAST_KEY, tag);
        } catch {
          // Storage blocked: nothing kept.
        }
      };
      for (let attempt = 0; attempt < SETTINGS_TRIES; attempt++) {
        const got = await api.read();
        if (got.kind !== "ok") return got;
        const remote = got.value;
        if (!stillHere()) return { kind: "signed-out" }; // signed out (or turned off) while the account answered
        if (!remote.keep) {
          forgetSettingsBase(store, userId);
          markHere();
          return { kind: "off" };
        }
        // The first time here (no base), or the account's copy made again since (turned off and on): no shared past, so
        // the account's value wins where both have one.
        const fresh = base === null || madeAgain(base, remote);
        const aside: Record<string, string> = { ...(base?.aside ?? {}) };
        if (stranger) for (const s of specs) {
          const v = theirs.has(s.key) ? undefined : notIn(s.kind, local[s.key], remote.settings[s.key]);
          if (v !== undefined) aside[s.key] = v;
        }
        const mine = own(local, aside);
        const merged = mergeSettings(specs, fresh ? {} : base.settings, mine, remote.settings, fresh ? "remote" : "local");
        for (const s of specs) {
          if (!theirs.has(s.key)) continue;
          const [was] = unsent.get(s.key)!;
          const v = mergeSettings([s], was === undefined ? {} : { [s.key]: was }, local, remote.settings, "local")[s.key];
          if (v === undefined) delete merged[s.key];
          else merged[s.key] = v;
        }
        let kept: Base = { revision: remote.revision, settings: remote.settings };
        let sent = false;
        let tooBig = false;
        const heldStill = base !== null && !fresh && base.held !== undefined && base.revision === remote.revision && same(sortKeys(base.held), sortKeys(merged));
        if (heldStill) tooBig = true; // refused before and nothing changed on either side: not sent again
        else if (!same(sortKeys(merged), sortKeys(remote.settings))) {
          // A copy made now gets its history id (see SETTINGS_HISTORY).
          const send = remote.revision === 0 ? { ...merged, [SETTINGS_HISTORY]: newHistory() } : merged;
          const s = await api.save(send, remote.revision);
          if (s.kind !== "ok") return s;
          const a = s.value;
          if (a.status === "changed") continue; // another device saved meanwhile: merge again from its copy
          if (!stillHere()) return { kind: "signed-out" };
          if (a.status === "off") {
            forgetSettingsBase(store, userId);
            markHere();
            return { kind: "off" };
          }
          if (a.status === "invalid") return malformed;
          if (a.status === "saved") {
            kept = { revision: a.revision, settings: send };
            sent = true;
          } else tooBig = true; // the account keeps what it had; this browser's changes stay here and are tried again when they change
        }
        // Put the merged settings here, except one changed here while the round ran: that newer change stays, and goes
        // next round, merged against what was agreed before (so the other entries it holds still count as unchanged).
        const changed: string[] = [];
        const agreed: Record<string, string> = { ...kept.settings };
        const asideNow: Record<string, string> = {};
        try {
          for (const s of specs) {
            const now = store.getItem(s.key) ?? undefined;
            if (now !== local[s.key]) {
              const before = fresh ? undefined : base.settings[s.key];
              if (before === undefined) delete agreed[s.key];
              else agreed[s.key] = before;
              if (aside[s.key] !== undefined) asideNow[s.key] = aside[s.key]!;
              continue;
            }
            const left = notIn(s.kind, aside[s.key], merged[s.key]);
            if (left !== undefined) asideNow[s.key] = left;
            const want = withAside(s.kind, merged[s.key], left);
            if (now === want) continue;
            if (want === undefined) store.removeItem(s.key);
            else store.setItem(s.key, want);
            changed.push(s.key);
          }
          const next: Base = { revision: kept.revision, settings: agreed, ...(tooBig ? { held: merged } : {}), ...(Object.keys(asideNow).length ? { aside: asideNow } : {}) };
          store.setItem(SETTINGS_BASE_PREFIX + userId, JSON.stringify(next));
          store.removeItem(SETTINGS_UNSENT_PREFIX + userId);
          store.setItem(SETTINGS_LAST_KEY, tag);
        } catch {
          return { kind: "failed", reason: "storage" };
        }
        return { kind: "done", changed, sent, ...(tooBig ? { tooBig: true as const } : {}) };
      }
      return { kind: "failed", reason: "unavailable" }; // the account kept changing under every try: next round
    });
  }

  /**
   * Signing out: what this browser and the account last agreed on goes, but a setting changed here and not sent yet (in
   * the seconds before a round, or offline) is noted with the value agreed before it, so the next time this person
   * signs in here it is sent instead of being replaced by the account's older one. Settings here stay.
   */
  function signOut(): void {
    const base = readBase(store, userId);
    if (base !== null) {
      try {
        const now = own(localNow(), base.aside);
        const raw = localNow();
        const unsent: Record<string, [string | null, string | null]> = {};
        const refused = base.held !== undefined && specs.every((s) => now[s.key] === base.held![s.key]);
        if (!refused) for (const s of specs) if (now[s.key] !== base.settings[s.key]) unsent[s.key] = [base.settings[s.key] ?? null, raw[s.key] ?? null];
        if (Object.keys(unsent).length) store.setItem(SETTINGS_UNSENT_PREFIX + userId, JSON.stringify(unsent));
      } catch {
        // Storage blocked: nothing noted.
      }
    }
    forgetSettingsBase(store, userId);
  }

  /** Deleting the account: everything this browser keeps for this person's settings goes, the unsent ones too. */
  function forgetAll(): void {
    forgetSettingsBase(store, userId);
    try {
      store.removeItem(SETTINGS_UNSENT_PREFIX + userId);
    } catch {
      // Storage blocked: nothing was kept.
    }
  }

  return { round, changedHere, signOut, forgetAll };
}

const sortKeys = (v: Values) => Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export type SettingsSync = ReturnType<typeof settingsSync>;
