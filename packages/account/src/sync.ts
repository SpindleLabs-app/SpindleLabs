// Keeping designs in the account: each project kept in this browser is linked to one design in the account, and
// a project whose file text changed since it was last sent is sent again. Rules that keep anyone's work safe:
//   - A save names the revision this browser last saw, so it never replaces a copy another device changed since:
//     then this browser's version is added as a separate design, "<name> (copy)", and the project follows that one.
//   - A design deleted from the account (here or on another device) is never sent back: the project in this browser
//     stays, and is no longer kept in the account.
//   - A design too big for the account waits until it changes, and so does one the service refuses on its own (the
//     rest still go). A full account doesn't stop the round: edits to designs already there may still fit; it is said
//     at the end.
//   - Only one tab of a browser sends at a time (`lock`), reading the links fresh inside it, so two tabs never send
//     the same project twice.
//   - A round is for one person: it stops, sending and bringing nothing more, as soon as someone else is signed in
//     (another tab signed out and in again), so nothing of one person's ever goes to another's account.
//   - Each link is written as soon as its save is answered, and a new design is noted ("adding") before it is sent: a
//     browser that can't keep the links sends nothing new, and a save whose answer was lost is recognised next round
//     (the account's copy is the very text sent) instead of becoming a duplicate or a "(copy)".
//   - Signing out notes the projects then in this browser (AWAY_PREFIX + user id): one made while nobody was signed in
//     (on a shared computer, maybe by someone else) is never sent at this person's next sign-in until they say it is
//     theirs, as the first time (issue #628 item 5).
//   - A big design whose save ran out of time doesn't hold up the rest: the round goes on with the others, and stops at
//     the next request that fails (issue #628 item 7).
// The links live in this browser's storage, per person (LINKS_PREFIX + user id), never sent anywhere.

import type { SmallStore } from "./auth.ts";
import type { DataResult } from "./data.ts";
import type { DesignRow, DesignsApi, SaveAnswer, SaveDesign, Source } from "./designs.ts";

export const LINKS_PREFIX = "spindle.account.designs/";
/** Where signing out notes, per person, the ids of the projects then in this browser (a JSON list); see `away`. */
export const AWAY_PREFIX = "spindle.account.designs-away/";
/**
 * A design's text this long or longer whose save didn't answer in time ("offline") is passed over for this round and the
 * others still go: its own request was given longer (auth.ts `requestMs`), and a slow upload, not a lost connection, is
 * the likely cause. 64 KiB is about a second at 0.5 Mbit/s: a smaller one failing means the connection is the trouble.
 */
export const SLOW_SAVE_BYTES = 64 * 1024;

/** A project kept in this browser, as the project list gives it. */
export interface LocalProject {
  readonly id: string;
  readonly name: string;
  readonly modified: Date;
  /** Set when the project is in this browser but can't be read this round: its link is kept, and it isn't sent. */
  readonly problem?: string;
}

export interface Link {
  /** The account's id for the design. */
  readonly remote: string;
  /** Its revision when this browser last sent or fetched it. */
  readonly revision: number;
  /** SHA-256 of the file text last sent or fetched: the project changed when its text no longer has this hash. */
  readonly hash: string;
  /**
   * Set when the project must not be sent: its design was deleted from the account; too big (until the text changes);
   * or "left": it was in this browser before this person first signed in here and they chose not to keep it in their
   * account (on a shared computer it may be someone else's), until they choose to; or "refused": the service refused
   * this design alone (until the text changes).
   */
  readonly skip?: "gone" | "too-big" | "left" | "refused";
  /** Set when the design is this browser's copy kept beside another device's change: it keeps the "(copy)" name. */
  readonly copy?: true;
  /**
   * Set while this browser's text (`hash`) is being added as a new design, to the save time it was sent with (ISO):
   * the answer may have been lost, so the next round first looks for it in the account. `remote` is "" meanwhile.
   */
  readonly adding?: string;
}

export interface SyncDeps {
  readonly api: Pick<DesignsApi, "save" | "get" | "list" | "space">;
  readonly userId: string;
  /** Who is signed in now (another tab may have changed it), or null; read just before every request. */
  who(): string | null;
  readonly store: SmallStore;
  readonly local: {
    list(): Promise<readonly LocalProject[]>;
    /** The project's file text as kept, or null when it is gone. */
    text(id: string): Promise<string | null>;
    /**
     * The project's text exactly as this browser stores it, read without bringing it up to date (null when gone).
     * `text` gives it as today's readers write it, which an app update changes with no change made here: the link's
     * hash, made by the build before, then matches only this one (lost-work hunt 2026-11-12, issue #628 item 1).
     */
    stored?(id: string): Promise<string | null>;
    /** Keeps `text` as project `id` (null: a new one), named `name`; gives its id. */
    put(id: string | null, text: string, name: string, savedAt: Date): Promise<string>;
  };
  hash(text: string): Promise<string>;
  /** A design's text as today's readers write it, or null when they can't read it: the account's text may be an older build's (#628 item 1). */
  asRead?(text: string): string | null;
  /** The workspace a project comes from. */
  source(id: string, text: string): Source;
  /** A fresh picture of project `id`, when this tab can take one. */
  picture(id: string): string | null;
  /** Runs `fn` while no other tab of this browser is syncing. */
  lock<T>(fn: () => Promise<T>): Promise<T>;
}

export type SyncReport =
  | { readonly kind: "done"; readonly sent: number; readonly copies: readonly string[]; readonly tooBig: readonly string[]; readonly waiting?: true; readonly refused?: readonly string[]; /** Changed here, but deleted from the account: not kept there (#628 item 2). */ readonly gone?: readonly string[] }
  | { readonly kind: "full"; readonly sent: number }
  | { readonly kind: "off" }
  | Exclude<DataResult<never>, { kind: "ok" }>;

const COPY = " (copy)";
export const copyName = (name: string) => (name.endsWith(COPY) ? name : name + COPY);

function isLink(v: unknown): v is Link {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return typeof l.remote === "string" && typeof l.revision === "number" && Number.isSafeInteger(l.revision) && l.revision >= 1 && typeof l.hash === "string" && (l.skip === undefined || l.skip === "gone" || l.skip === "too-big" || l.skip === "left" || l.skip === "refused") && (l.copy === undefined || l.copy === true) && (l.adding === undefined || (typeof l.adding === "string" && Number.isFinite(Date.parse(l.adding))));
}

/** The links of `userId` in this browser; a damaged entry is dropped (its project is then sent as a new design, never lost). */
export function readLinks(store: SmallStore, userId: string): Map<string, Link> {
  const links = new Map<string, Link>();
  let raw: unknown;
  try {
    raw = JSON.parse(store.getItem(LINKS_PREFIX + userId) ?? "{}");
  } catch {
    return links;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return links;
  for (const [id, l] of Object.entries(raw)) if (isLink(l)) links.set(id, { remote: l.remote, revision: l.revision, hash: l.hash, ...(l.skip ? { skip: l.skip } : {}), ...(l.copy ? { copy: true as const } : {}), ...(typeof l.adding === "string" ? { adding: l.adding } : {}) });
  return links;
}

/** The ids noted when `userId` last signed out here, or null when there is no note (an empty note stands for a damaged one: everything unlinked is asked about). */
function readAway(store: SmallStore, userId: string): Set<string> | null {
  let raw: string | null;
  try {
    raw = store.getItem(AWAY_PREFIX + userId);
  } catch {
    return null; // storage blocked: nothing can be sent anyway (the links can't be kept)
  }
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeLinks(store: SmallStore, userId: string, links: Map<string, Link>): boolean {
  try {
    store.setItem(LINKS_PREFIX + userId, JSON.stringify(Object.fromEntries(links)));
    return true;
  } catch {
    return false;
  }
}

/** Forgets every link of `userId` in this browser (deleting the account), and the note made when they signed out. */
export function forgetLinks(store: SmallStore, userId: string): void {
  try {
    store.removeItem(LINKS_PREFIX + userId);
    store.removeItem(AWAY_PREFIX + userId);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

export function designSync(deps: SyncDeps) {
  const { api, store, userId } = deps;

  /**
   * Whether the person signed in is still the one this round is for. Checked right before every request: the request
   * reads the session in the same turn of the event loop (asPerson reads it before its first wait), so it goes as
   * whoever this saw.
   */
  function stillMine(): boolean {
    try {
      return deps.who() === userId;
    } catch {
      return false;
    }
  }
  const elsewhere = { kind: "signed-out" } as const;
  const storage = { kind: "failed", reason: "storage" } as const;

  /** Sends every project in this browser that changed since it was last sent. */
  async function syncAll(): Promise<SyncReport> {
    return deps.lock(async () => {
      if (!stillMine()) return elsewhere;
      if (firstTime()) return { kind: "done", sent: 0, copies: [], tooBig: [], waiting: true };
      const links = readLinks(store, userId);
      const listed = await deps.local.list();
      // Links to projects no longer in this browser go: deleting here never deletes from the account. A project
      // listed but unreadable this round keeps its link (its "left out" or "deleted" mark above all).
      for (const id of [...links.keys()]) if (!listed.some((p) => p.id === id)) links.delete(id);
      const projects = listed.filter((p) => p.problem === undefined);
      // Made while this person was signed out (no link, not here when they signed out): not sent until they say so.
      const away = readAway(store, userId);
      const arrived = away === null ? new Set<string>() : new Set(listed.filter((p) => !links.has(p.id) && !away.has(p.id)).map((p) => p.id));
      if (away !== null && arrived.size === 0) {
        try {
          store.removeItem(AWAY_PREFIX + userId);
        } catch {
          return storage;
        }
      }
      let sent = 0;
      /** A big design's save that ran out of time, passed over so the others still go (said at the end of the round). */
      let slow: DataResult<never> | null = null;
      let full = false;
      const copies: string[] = [];
      const tooBig: string[] = [];
      const refused: string[] = [];
      const gone: string[] = [];
      const keep = () => writeLinks(store, userId, links);
      const done = (r: SyncReport): SyncReport => (keep() || (r.kind !== "done" && r.kind !== "full") ? r : storage);

      // The account's designs, read once a round, only when an add whose answer was lost has to be looked for.
      let rows: readonly DesignRow[] | null = null;
      /** The design an earlier round added this text as, when it reached the account; null when it didn't. */
      async function findAdded(l: Link): Promise<DataResult<{ remote: string; revision: number } | null>> {
        if (rows === null) {
          if (!stillMine()) return elsewhere;
          const r = await api.list();
          if (r.kind !== "ok") return r;
          rows = r.value;
        }
        const at = Date.parse(l.adding ?? "");
        for (const row of rows) {
          if (row.savedAt.getTime() !== at) continue;
          if (!stillMine()) return elsewhere;
          const got = await api.get(row.id);
          if (got.kind !== "ok") return got;
          if (got.value !== null && (await deps.hash(got.value.body)) === l.hash) return { kind: "ok", value: { remote: row.id, revision: got.value.revision } };
        }
        return { kind: "ok", value: null };
      }

      for (const p of projects) {
        if (arrived.has(p.id)) continue;
        const text = await deps.local.text(p.id);
        if (text === null) continue;
        const hash = await deps.hash(text);
        let link = links.get(p.id);
        if (link?.adding !== undefined) {
          const found = await findAdded(link);
          if (found.kind !== "ok") return done(found);
          if (found.value !== null) {
            link = { remote: found.value.remote, revision: found.value.revision, hash: link.hash, ...(link.copy ? { copy: true as const } : {}) };
            links.set(p.id, link);
            if (!keep()) return storage;
          }
        }
        // What the link goes back to when a save is definitely not made (refused, full, turned off).
        const before = link;
        const restore = () => (before ? links.set(p.id, before) : links.delete(p.id));
        const pendingCopy = link?.adding !== undefined && link.copy === true; // an add of a "(copy)" not found: added again as one
        if (link?.adding !== undefined) link = undefined;
        if (link && link.hash === hash) continue; // unchanged since sent or fetched (whatever skip says)
        // Unchanged here, though today's readers write it another way than the build that made the link (an app update):
        // the text as stored is still the one linked. Sent as a change, every device's every project went up again after
        // an update, a device merely behind made a "(copy)", and one merely started took the revision from another
        // device's real edit (#628 item 1). The link takes today's hash; nothing is sent.
        if (link && deps.local.stored) {
          const kept = await deps.local.stored(p.id);
          if (kept !== null && kept !== text && (await deps.hash(kept)) === link.hash) {
            links.set(p.id, { ...link, hash });
            if (!keep()) return storage;
            continue;
          }
        }
        if (link?.skip === "gone") gone.push(p.name); // changed here since: said every round, never sent
        if (link?.skip === "gone" || link?.skip === "left") continue; // deleted from the account, or left out: never sent
        const asCopy = link?.copy === true || pendingCopy;
        const base = { name: asCopy ? copyName(p.name) : p.name, source: deps.source(p.id, text), body: text, picture: deps.picture(p.id), savedAt: p.modified };
        // The design to save over: the linked one, also when it was too big or refused before (it goes back over its own design).
        const live = link !== undefined && link.remote !== "" ? link : null; // (gone and left were passed over above)
        const send = (d: SaveDesign): Promise<DataResult<SaveAnswer>> => (stillMine() ? api.save(d) : Promise.resolve(elsewhere));
        /** Adds this text as a new design, noted first so a lost answer is found next round; null when the note can't be kept (nothing sent). */
        const add = (name: string, copy: boolean): Promise<DataResult<SaveAnswer>> | null => {
          links.set(p.id, { remote: "", revision: 1, hash, ...(copy ? { copy: true as const } : {}), adding: p.modified.toISOString() });
          return keep() ? send({ ...base, name, id: null, expected: null }) : null;
        };
        let copy = asCopy;
        let r: DataResult<SaveAnswer> | null = live ? await send({ ...base, id: live.remote, expected: live.revision }) : await add(base.name, asCopy);
        if (r?.kind === "ok" && r.value.status === "changed" && live) {
          // Saved over since this browser last saw it. Its text may be this very text: a save whose answer was lost.
          if (!stillMine()) return done(elsewhere);
          const got = await api.get(live.remote);
          if (got.kind !== "ok") return done(got);
          // (or that text as an older build wrote it: the same design once read)
          const theirs = got.value === null ? null : got.value.body;
          const asRead = theirs === null ? null : (deps.asRead?.(theirs) ?? null);
          if (theirs !== null && ((await deps.hash(theirs)) === hash || (asRead !== null && (await deps.hash(asRead)) === hash))) {
            links.set(p.id, { remote: live.remote, revision: got.value!.revision, hash, ...(live.copy ? { copy: true as const } : {}) });
            sent++;
            if (!keep()) return storage;
            continue;
          }
          // Another device saved over it: keep both, this browser's as a separate design.
          copy = true;
          r = await add(copyName(p.name), true);
          if (r?.kind === "ok" && r.value.status === "saved") copies.push(p.name);
        }
        if (r === null) {
          restore();
          return storage; // the links can't be kept: nothing more is sent
        }
        if (r.kind !== "ok") {
          if (r.kind === "signed-out" || r.reason === "rejected") restore(); // definitely not saved
          if (r.kind === "failed" && r.reason === "rejected") {
            // Refused: this design alone (its name or text, say), or every request (the service not ready for this)?
            if (!stillMine()) return done(elsewhere);
            const probe = await api.space();
            if (probe.kind !== "ok") return done(r);
            links.set(p.id, { remote: live?.remote ?? "", revision: live?.revision ?? 1, hash, skip: "refused", ...(live?.copy ? { copy: true as const } : {}) });
            refused.push(p.name);
            if (!keep()) return storage;
            continue;
          }
          // A big design that ran out of time: the rest still go, unless one of them fails too (#628 item 7).
          if (r.kind === "failed" && r.reason === "offline" && text.length >= SLOW_SAVE_BYTES && slow === null) {
            slow = r;
            continue;
          }
          return done(r); // offline, the service down, an answer not understood: an add stays noted, the rest go next round
        }
        const a = r.value;
        if (a.status === "saved") {
          links.set(p.id, { remote: a.id, revision: a.revision, hash, ...(copy ? { copy: true as const } : {}) });
          sent++;
          if (!keep()) return storage;
        } else if (a.status === "gone") {
          links.set(p.id, { remote: live?.remote ?? "", revision: live?.revision ?? 1, hash, skip: "gone" });
          gone.push(p.name);
          if (!keep()) return storage;
        } else if (a.status === "too-big") {
          links.set(p.id, { remote: live?.remote ?? "", revision: live?.revision ?? 1, hash, skip: "too-big", ...(live?.copy ? { copy: true as const } : {}) });
          tooBig.push(p.name);
          if (!keep()) return storage;
        } else if (a.status === "full") {
          restore(); // not added; edits to designs already there may still fit
          full = true;
        } else if (a.status === "off") {
          restore();
          return done({ kind: "off" });
        } else restore(); // "changed" on a brand new design can't happen; left for the next round
      }
      if (slow !== null) return done(slow); // said and tried again later, as any request that couldn't reach the account
      return done(full ? { kind: "full", sent } : { kind: "done", sent, copies, tooBig, ...(arrived.size ? { waiting: true as const } : {}), ...(refused.length ? { refused } : {}), ...(gone.length ? { gone } : {}) });
    });
  }

  /**
   * Brings design `remote` from the account into this browser and gives the project to open: the linked project when
   * it already holds that revision; the linked project put up to date when it hasn't changed here since; otherwise a
   * new project, so a change made here is never overwritten (the old one is then sent as its own design next round).
   */
  async function bring(remote: string): Promise<DataResult<string | null>> {
    return deps.lock(async () => {
      // Not answered yet whether the projects already here are this person's: they are left out until they say so.
      if (!stillMine()) return elsewhere;
      if (firstTime() && !(await leaveAll())) return storage;
      const got = await api.get(remote);
      if (got.kind !== "ok") return got;
      // Someone else signed in meanwhile: this answer is the other person's design, never put here as theirs.
      if (!stillMine()) return elsewhere;
      const d = got.value;
      if (d === null) return { kind: "ok", value: null }; // deleted from the account meanwhile
      const links = readLinks(store, userId);
      const projects = (await deps.local.list()).filter((p) => p.problem === undefined);
      const linked = [...links.entries()].find(([id, l]) => l.remote === remote && l.skip === undefined && projects.some((p) => p.id === id));
      const hash = await deps.hash(d.body);
      let id: string;
      if (linked && linked[1].revision === d.revision) id = linked[0];
      else {
        const here = linked ? await deps.local.text(linked[0]) : null;
        const unchangedHere = linked !== undefined && here !== null && (await deps.hash(here)) === linked[1].hash;
        if (linked && !unchangedHere) links.delete(linked[0]); // changed here too: it goes up as its own design
        id = await deps.local.put(unchangedHere ? linked![0] : null, d.body, d.name, d.savedAt);
        // The hash of the text as kept here (opening may tidy a file's text), so it isn't taken for a change and sent back.
        const kept = await deps.local.text(id);
        links.set(id, { remote, revision: d.revision, hash: kept === null ? hash : await deps.hash(kept), ...(unchangedHere && linked![1].copy ? { copy: true as const } : {}) });
      }
      return writeLinks(store, userId, links) ? { kind: "ok", value: id } : storage;
    });
  }

  /**
   * True before this person's first sending round in this browser: nothing is sent until they say whether the
   * projects already here are theirs to keep in their account (`firstChoice`).
   */
  function firstTime(): boolean {
    try {
      return store.getItem(LINKS_PREFIX + userId) === null;
    } catch {
      return false; // storage blocked: nothing can be sent anyway (the links can't be kept)
    }
  }

  /**
   * The answer to the first-time question: `keep` sends every project in this browser from now on; otherwise each one
   * here now is left out (never sent until `includeLeft`), and only projects made or opened from now on are kept.
   */
  async function firstChoice(keep: boolean): Promise<boolean> {
    return deps.lock(() => (keep ? Promise.resolve(writeLinks(store, userId, readLinks(store, userId))) : leaveAll()));
  }

  /** Marks every project in this browser with no link as left out (inside the lock). */
  async function leaveAll(): Promise<boolean> {
    const links = readLinks(store, userId);
    for (const p of await deps.local.list()) {
      if (links.has(p.id)) continue;
      // One that can't be read now is left out too (no hash matches ""), so it isn't sent once it can be read.
      const text = p.problem === undefined ? await deps.local.text(p.id) : null;
      if (text !== null || p.problem !== undefined) links.set(p.id, { remote: "", revision: 1, hash: text === null ? "" : await deps.hash(text), skip: "left" });
    }
    return writeLinks(store, userId, links);
  }

  /** How many projects in this browser are left out of the account. */
  function leftCount(): number {
    let n = 0;
    for (const l of readLinks(store, userId).values()) if (l.skip === "left") n++;
    return n;
  }

  /** Keeps the projects left out in the account after all: the next round sends them. */
  async function includeLeft(): Promise<boolean> {
    return deps.lock(async () => {
      const links = readLinks(store, userId);
      for (const [id, l] of [...links]) if (l.skip === "left") links.delete(id);
      return writeLinks(store, userId, links);
    });
  }

  /**
   * Signing out (or the session ending under the app): notes the projects in this browser now, so one made before this
   * person signs in here again is asked about first (#628 item 5). Their links stay, so nothing is sent twice.
   */
  async function away(): Promise<boolean> {
    // Not inside the lock: a round still running (a slow upload) would hold it, and a project made meanwhile would be
    // noted as here before. That round stops at its next request (`stillMine`), and never removes a note it didn't read.
    if (firstTime()) return true; // never answered the first-time question: asked anyway
    // Noted already (signed out twice with no round between, say): the projects made since are not theirs to keep yet.
    if (readAway(store, userId) !== null) return true;
    const ids = (await deps.local.list()).map((p) => p.id);
    try {
      store.setItem(AWAY_PREFIX + userId, JSON.stringify(ids));
      return true;
    } catch {
      return false;
    }
  }

  /** How many projects were made in this browser while this person was signed out, waiting for them to say they are theirs. */
  async function arrivedCount(): Promise<number> {
    const away = readAway(store, userId);
    if (away === null) return 0;
    const links = readLinks(store, userId);
    return (await deps.local.list()).filter((p) => !links.has(p.id) && !away.has(p.id)).length;
  }

  /** The answer about those projects: `keep` sends them from now on; otherwise they are left out as "left" (`includeLeft` later). */
  async function arrivedChoice(keep: boolean): Promise<boolean> {
    return deps.lock(async () => {
      const away = readAway(store, userId);
      if (away === null) return true;
      if (!keep) {
        // Only those made while signed out: a project of theirs from before signing out that wasn't sent yet still goes.
        const links = readLinks(store, userId);
        for (const p of await deps.local.list()) {
          if (links.has(p.id) || away.has(p.id)) continue;
          const text = p.problem === undefined ? await deps.local.text(p.id) : null;
          links.set(p.id, { remote: "", revision: 1, hash: text === null ? "" : await deps.hash(text), skip: "left" });
        }
        if (!writeLinks(store, userId, links)) return false;
      }
      try {
        store.removeItem(AWAY_PREFIX + userId);
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Projects changed here whose designs were deleted from the account (#628 item 2): how many, read from this browser
   * only. A link is marked "gone" only by a save of a change, so each one is a project changed since; one deleted from
   * the account and never changed here keeps its plain link and is never sent (deleting it there was the person's choice).
   */
  function goneHere(): number {
    let n = 0;
    for (const l of readLinks(store, userId).values()) if (l.skip === "gone") n++;
    return n;
  }

  /** Keeps those projects in the account again: each is sent as a new design next round (#628 item 2). */
  async function keepGone(): Promise<boolean> {
    return deps.lock(async () => {
      const links = readLinks(store, userId);
      const again: string[] = [];
      for (const [id, l] of [...links]) {
        if (l.skip !== "gone") continue;
        links.delete(id);
        again.push(id);
      }
      // With no link they would look made while signed out, when that note is waiting: they were here, and theirs.
      const away = readAway(store, userId);
      if (away !== null && again.length) {
        try {
          store.setItem(AWAY_PREFIX + userId, JSON.stringify([...away, ...again]));
        } catch {
          return false;
        }
      }
      return writeLinks(store, userId, links);
    });
  }

  /** The design in the account a project in this browser is kept as, if any. */
  function remoteOf(localId: string): string | null {
    const l = readLinks(store, userId).get(localId);
    return l && l.skip === undefined && l.remote !== "" ? l.remote : null;
  }

  return { syncAll, bring, remoteOf, firstTime, firstChoice, leftCount, includeLeft, away, arrivedCount, arrivedChoice, goneHere, keepGone };
}

export type DesignSync = ReturnType<typeof designSync>;
