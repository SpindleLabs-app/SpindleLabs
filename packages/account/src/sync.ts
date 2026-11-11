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
// The links live in this browser's storage, per person (LINKS_PREFIX + user id), never sent anywhere.

import type { SmallStore } from "./auth.ts";
import type { DataResult } from "./data.ts";
import type { DesignRow, DesignsApi, SaveAnswer, SaveDesign, Source } from "./designs.ts";

export const LINKS_PREFIX = "spindle.account.designs/";

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
    /** Keeps `text` as project `id` (null: a new one), named `name`; gives its id. */
    put(id: string | null, text: string, name: string, savedAt: Date): Promise<string>;
  };
  hash(text: string): Promise<string>;
  /** The workspace a project comes from. */
  source(id: string, text: string): Source;
  /** A fresh picture of project `id`, when this tab can take one. */
  picture(id: string): string | null;
  /** Runs `fn` while no other tab of this browser is syncing. */
  lock<T>(fn: () => Promise<T>): Promise<T>;
}

export type SyncReport =
  | { readonly kind: "done"; readonly sent: number; readonly copies: readonly string[]; readonly tooBig: readonly string[]; readonly waiting?: true; readonly refused?: readonly string[] }
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

function writeLinks(store: SmallStore, userId: string, links: Map<string, Link>): boolean {
  try {
    store.setItem(LINKS_PREFIX + userId, JSON.stringify(Object.fromEntries(links)));
    return true;
  } catch {
    return false;
  }
}

/** Forgets every link of `userId` in this browser (signing out, deleting the account, turning keeping off). */
export function forgetLinks(store: SmallStore, userId: string): void {
  try {
    store.removeItem(LINKS_PREFIX + userId);
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
      let sent = 0;
      let full = false;
      const copies: string[] = [];
      const tooBig: string[] = [];
      const refused: string[] = [];
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
          if (got.value !== null && (await deps.hash(got.value.body)) === hash) {
            links.set(p.id, { remote: live.remote, revision: got.value.revision, hash, ...(live.copy ? { copy: true as const } : {}) });
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
          return done(r); // offline, the service down, an answer not understood: an add stays noted, the rest go next round
        }
        const a = r.value;
        if (a.status === "saved") {
          links.set(p.id, { remote: a.id, revision: a.revision, hash, ...(copy ? { copy: true as const } : {}) });
          sent++;
          if (!keep()) return storage;
        } else if (a.status === "gone") {
          links.set(p.id, { remote: live?.remote ?? "", revision: live?.revision ?? 1, hash, skip: "gone" });
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
      return done(full ? { kind: "full", sent } : { kind: "done", sent, copies, tooBig, ...(refused.length ? { refused } : {}) });
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

  /** The design in the account a project in this browser is kept as, if any. */
  function remoteOf(localId: string): string | null {
    const l = readLinks(store, userId).get(localId);
    return l && l.skip === undefined && l.remote !== "" ? l.remote : null;
  }

  return { syncAll, bring, remoteOf, firstTime, firstChoice, leftCount, includeLeft };
}

export type DesignSync = ReturnType<typeof designSync>;
