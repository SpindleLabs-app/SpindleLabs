// Keeping designs in the account: each project kept in this browser is linked to one design in the account, and
// a project whose file text changed since it was last sent is sent again. Rules that keep anyone's work safe:
//   - A save names the revision this browser last saw, so it never replaces a copy another device changed since:
//     then this browser's version is added as a separate design, "<name> (copy)", and the project follows that one.
//   - A design deleted from the account (here or on another device) is never sent back: the project in this browser
//     stays, and is no longer kept in the account.
//   - A design too big for the account waits until it changes; a full account stops the round and says so.
//   - Only one tab of a browser sends at a time (`lock`), reading the links fresh inside it, so two tabs never send
//     the same project twice.
// The links live in this browser's storage, per person (LINKS_PREFIX + user id), never sent anywhere.

import type { SmallStore } from "./auth.ts";
import type { DataResult } from "./data.ts";
import type { DesignsApi, Source } from "./designs.ts";

export const LINKS_PREFIX = "spindle.account.designs/";

/** A project kept in this browser, as the project list gives it. */
export interface LocalProject {
  readonly id: string;
  readonly name: string;
  readonly modified: Date;
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
   * account (on a shared computer it may be someone else's), until they choose to.
   */
  readonly skip?: "gone" | "too-big" | "left";
  /** Set when the design is this browser's copy kept beside another device's change: it keeps the "(copy)" name. */
  readonly copy?: true;
}

export interface SyncDeps {
  readonly api: Pick<DesignsApi, "save" | "get">;
  readonly userId: string;
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
  | { readonly kind: "done"; readonly sent: number; readonly copies: readonly string[]; readonly tooBig: readonly string[]; readonly waiting?: true }
  | { readonly kind: "full"; readonly sent: number }
  | { readonly kind: "off" }
  | Exclude<DataResult<never>, { kind: "ok" }>;

const COPY = " (copy)";
export const copyName = (name: string) => (name.endsWith(COPY) ? name : name + COPY);

function isLink(v: unknown): v is Link {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return typeof l.remote === "string" && typeof l.revision === "number" && Number.isSafeInteger(l.revision) && l.revision >= 1 && typeof l.hash === "string" && (l.skip === undefined || l.skip === "gone" || l.skip === "too-big" || l.skip === "left") && (l.copy === undefined || l.copy === true);
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
  for (const [id, l] of Object.entries(raw)) if (isLink(l)) links.set(id, { remote: l.remote, revision: l.revision, hash: l.hash, ...(l.skip ? { skip: l.skip } : {}), ...(l.copy ? { copy: true as const } : {}) });
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

  /** Sends every project in this browser that changed since it was last sent. */
  async function syncAll(): Promise<SyncReport> {
    return deps.lock(async () => {
      if (firstTime()) return { kind: "done", sent: 0, copies: [], tooBig: [], waiting: true };
      const links = readLinks(store, userId);
      const projects = await deps.local.list();
      // Links to projects no longer in this browser go: deleting here never deletes from the account.
      for (const id of [...links.keys()]) if (!projects.some((p) => p.id === id)) links.delete(id);
      let sent = 0;
      const copies: string[] = [];
      const tooBig: string[] = [];
      const done = (r: SyncReport): SyncReport => (writeLinks(store, userId, links) || r.kind !== "done" ? r : { kind: "failed", reason: "storage" });
      for (const p of projects) {
        const text = await deps.local.text(p.id);
        if (text === null) continue;
        const hash = await deps.hash(text);
        const link = links.get(p.id);
        if (link && link.hash === hash) continue; // unchanged since sent or fetched (whatever skip says)
        if (link?.skip === "gone" || link?.skip === "left") continue; // deleted from the account, or left out: never sent
        const base = { name: link?.copy ? copyName(p.name) : p.name, source: deps.source(p.id, text), body: text, picture: deps.picture(p.id), savedAt: p.modified };
        // The design to save over: the linked one, also when it was too big before (it goes back over its own design).
        const live = link !== undefined && (link.skip === undefined || link.skip === "too-big") && link.remote !== "" ? link : null;
        let r = await api.save({ ...base, id: live ? live.remote : null, expected: live ? live.revision : null });
        if (r.kind !== "ok") return done(r);
        let copy = live?.copy === true;
        if (r.value.status === "changed") {
          copy = true;
          // Another device saved over it since: keep both, this browser's as a separate design.
          r = await api.save({ ...base, name: copyName(p.name), id: null, expected: null });
          if (r.kind !== "ok") return done(r);
          if (r.value.status === "saved") copies.push(p.name);
        }
        const a = r.value;
        if (a.status === "saved") {
          links.set(p.id, { remote: a.id, revision: a.revision, hash, ...(copy ? { copy: true as const } : {}) });
          sent++;
        } else if (a.status === "gone") links.set(p.id, { remote: live?.remote ?? "", revision: live?.revision ?? 1, hash, skip: "gone" });
        else if (a.status === "too-big") {
          links.set(p.id, { remote: live?.remote ?? "", revision: live?.revision ?? 1, hash, skip: "too-big", ...(live?.copy ? { copy: true as const } : {}) });
          tooBig.push(p.name);
        } else if (a.status === "full") return done({ kind: "full", sent });
        else if (a.status === "off") return done({ kind: "off" });
        // "changed" again on a brand new design can't happen; anything else is left for the next round.
      }
      return done({ kind: "done", sent, copies, tooBig });
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
      if (firstTime() && !(await leaveAll())) return { kind: "failed", reason: "storage" };
      const got = await api.get(remote);
      if (got.kind !== "ok") return got;
      const d = got.value;
      if (d === null) return { kind: "ok", value: null }; // deleted from the account meanwhile
      const links = readLinks(store, userId);
      const projects = await deps.local.list();
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
      return writeLinks(store, userId, links) ? { kind: "ok", value: id } : { kind: "failed", reason: "storage" };
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
      const text = await deps.local.text(p.id);
      if (text !== null && !links.has(p.id)) links.set(p.id, { remote: "", revision: 1, hash: await deps.hash(text), skip: "left" });
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
    return l && l.skip === undefined ? l.remote : null;
  }

  return { syncAll, bring, remoteOf, firstTime, firstChoice, leftCount, includeLeft };
}

export type DesignSync = ReturnType<typeof designSync>;
