// The undo steps of a kept project, kept in this browser beside it (step 89), so after a reload, or the project opened
// again from File > Projects in this browser, the History panel and Undo carry on where they were. Never in the project
// file, a shared copy or the account: only this browser's store holds them. Two entries per project:
//   steps/<id>     the steps as text (encodeSteps), at most STEPS_CHAR_LIMIT characters of snapshots
//   steps-at/<id>  when they were last written (ms), so only the STEPS_PROJECTS projects written most recently keep theirs
// Steps are an extra and never cost a save: a write that fails is given up (and that project's steps forgotten), and a
// project save refused for want of room forgets every project's steps first (versions.ts). Steps that no longer end
// at the project as it opens (changed in another tab, or a save the steps never saw) are not put back: the history
// starts afresh, as History.load refuses them.

import type { SavedHistory } from "@fission/core";
import type { KeyValue } from "./key-value.ts";

/**
 * Characters of snapshots kept per project: 8 million, about 16 MB as a browser keeps text. A snapshot of today's
 * parts is a few kilobytes, so 100 steps are well under 1 MB; a big part's oldest steps go first past this.
 */
export const STEPS_CHAR_LIMIT = 8_000_000;
/** Projects whose steps are kept: the ten written most recently (at most 160 MB, and far less for real parts). */
export const STEPS_PROJECTS = 10;
/** The layout of `encodeSteps`' text; a store holding another (a newer SpindleLabs) is read as none. */
export const STEPS_FORMAT = 1;

const STEPS = "steps/";
const STEPS_AT = "steps-at/";

type Kept = SavedHistory["kept"][number];

/**
 * `saved` as text for the store, its snapshots at most `limit` characters in all: past that the oldest steps go first
 * (the present is kept, as the history drops its oldest), then the steps furthest from the present that could be
 * redone. Null when the present alone is over `limit`, or `saved` is not a history (nothing worth keeping).
 */
export function encodeSteps(saved: SavedHistory, limit = STEPS_CHAR_LIMIT): string | null {
  if (!Number.isInteger(saved.index) || saved.index < 0 || saved.index >= saved.kept.length) return null;
  let kept = saved.kept.slice();
  let index = saved.index;
  let chars = kept.reduce((n, e) => n + e.snapshot.length, 0);
  while (chars > limit && index > 0) {
    chars -= kept[0].snapshot.length;
    kept = kept.slice(1);
    index--;
  }
  while (chars > limit && kept.length > index + 1) {
    chars -= kept[kept.length - 1].snapshot.length;
    kept = kept.slice(0, -1);
  }
  if (chars > limit) return null;
  return JSON.stringify({ format: STEPS_FORMAT, index, kept: kept.map((e) => ({ snapshot: e.snapshot, label: e.label, mergeKey: e.mergeKey ?? null, at: e.at })) });
}

/** The steps `encodeSteps` wrote, or null for anything else (damaged, another layout, not a history). Never throws. */
export function decodeSteps(text: string | undefined): SavedHistory | null {
  if (text === undefined) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { format, index, kept } = data as { format?: unknown; index?: unknown; kept?: unknown };
  if (format !== STEPS_FORMAT || !Array.isArray(kept) || kept.length === 0) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= kept.length) return null;
  const out: Kept[] = [];
  for (const e of kept as unknown[]) {
    if (typeof e !== "object" || e === null) return null;
    const { snapshot, label, mergeKey, at } = e as Record<string, unknown>;
    if (typeof snapshot !== "string" || typeof label !== "string" || typeof at !== "number" || !Number.isFinite(at)) return null;
    if (mergeKey !== null && typeof mergeKey !== "string") return null;
    out.push({ snapshot, label, mergeKey: mergeKey ?? undefined, at });
  }
  return { kept: out, index };
}

/**
 * `saved` ending at `present` (the project as it opened): as kept when its present is `present`; else moved back to
 * its last step that is `present`, the later ones a redo away (the page went while the project's last save was still
 * on its way, but the steps had been written); null when no step is `present` (the steps can't be put back).
 */
export function alignSteps(saved: SavedHistory, present: string): SavedHistory | null {
  if (saved.kept[saved.index]?.snapshot === present) return saved;
  for (let i = saved.kept.length - 1; i >= 0; i--) if (saved.kept[i].snapshot === present) return { kept: saved.kept, index: i };
  return null;
}

/** Undo steps kept per project in `kv`. */
export interface StepsStore {
  /** The steps kept for `id`, or null when there are none to read (none written, damaged, or the store failing). Never throws. */
  read(id: string): Promise<SavedHistory | null>;
  /**
   * Keeps `saved` as `id`'s steps, written at `at` (ms), past STEPS_CHAR_LIMIT trimmed (`encodeSteps`); then forgets the
   * steps of all but the STEPS_PROJECTS projects written most recently. Never throws: a write that fails forgets `id`'s
   * steps instead, so older ones can't come back.
   */
  write(id: string, saved: SavedHistory, at: number): Promise<void>;
  /** Forgets `id`'s steps (the project deleted). Never throws. */
  forget(id: string): Promise<void>;
  /** Forgets every project's steps (no room for a save). Never throws. */
  forgetAll(): Promise<void>;
  /** Whether `id` has steps kept. Never throws. */
  has(id: string): Promise<boolean>;
  /** Whether any project has steps kept (so forgetting them could make room). Never throws. */
  any(): Promise<boolean>;
}

export function stepsStore(kv: KeyValue, { charLimit = STEPS_CHAR_LIMIT, projects = STEPS_PROJECTS } = {}): StepsStore {
  const forget = async (id: string) => {
    try {
      await kv.delete(STEPS + id);
      await kv.delete(STEPS_AT + id);
    } catch {
      // a store failing: what is left can only be read back over the very project state it ends at
    }
  };
  return {
    async read(id) {
      try {
        return decodeSteps(await kv.get(STEPS + id));
      } catch {
        return null;
      }
    },
    async write(id, saved, at) {
      const text = encodeSteps(saved, charLimit);
      if (text === null) return forget(id);
      try {
        await kv.update([], () => ({ [STEPS + id]: text, [STEPS_AT + id]: String(at) }));
      } catch {
        return forget(id);
      }
      try {
        const written: [string, number][] = [];
        for (const key of await kv.keys(STEPS_AT)) {
          const t = Number(await kv.get(key));
          written.push([key.slice(STEPS_AT.length), Number.isFinite(t) ? t : -Infinity]);
        }
        // The project just written always stays, whatever the clock says (save/load hunt C8: a clock set back made its
        // steps the oldest and forgot them as soon as written); the others newest first.
        written.sort((a, b) => (a[0] === id ? -1 : b[0] === id ? 1 : b[1] - a[1]));
        for (const [old] of written.slice(projects)) await forget(old);
      } catch {
        // the steps are written; trimming the others waits for the next write
      }
    },
    forget,
    async forgetAll() {
      try {
        for (const key of await kv.keys(STEPS_AT)) await forget(key.slice(STEPS_AT.length));
        for (const key of await kv.keys(STEPS)) await kv.delete(key);
      } catch {
        // nothing more can be done
      }
    },
    async has(id) {
      try {
        return (await kv.get(STEPS_AT + id)) !== undefined;
      } catch {
        return false;
      }
    },
    async any() {
      try {
        return (await kv.keys(STEPS)).length > 0;
      } catch {
        return false;
      }
    },
  };
}
