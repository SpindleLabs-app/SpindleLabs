// My designs in the app (account features 1): while someone is signed in with keeping designs on, each project kept in
// this browser is sent to their account a few seconds after it is saved (@fission/account sync.ts), with a small
// picture of the open one; File > My designs… and the account dialog open the list (@fission/ui my-designs.ts).
// Loaded with the account code only. Nothing here is ever needed for CAD or saving: signed out, offline or with the
// account service down, projects are kept in the browser exactly as before, and are sent once it can be done.

import { type AuthClient, type DataResult, designSync, designsApi, forgetLinks, isSource, LIMITS, type SmallStore, type Source, type SyncReport } from "@fission/account";
import { type AccountVersions, myDesigns, type MyDesigns } from "@fission/ui";

/** What the shell lends the account code (main.ts). */
export interface DesignsHost {
  /** The projects kept in this browser (store.list). */
  list(): Promise<readonly { id: string; name: string; modified: Date; problem?: string }[]>;
  /** A kept project's file text, or null when it is gone or can't be read. */
  text(id: string): Promise<string | null>;
  /** The same text exactly as stored, not brought up to date (store.text); and a design's text as today's readers write it (null: unreadable). Both for #628 item 1. */
  stored?(id: string): Promise<string | null>;
  asRead?(text: string): string | null;
  /** Keeps a project's file text under `id` (null: a new id), saved at `savedAt`; gives the id. Throws when it can't. */
  put(id: string | null, text: string, name: string, savedAt: Date): Promise<string>;
  /** The kept project open now, or null. */
  openId(): string | null;
  /** Opens a kept project in place of the open one (openStored). */
  open(id: string, modified: Date | null): Promise<void>;
  /** The workspace on screen. */
  workspace(): string;
  /** A small picture of what is on screen as a data: address, or null when there is nothing to take one of. */
  picture(): string | null;
}

/** Waits this long after a save before sending, so a run of edits goes as one. */
export const SEND_AFTER_MS = 4000;
/** Where the workspace each kept project was last saved from is remembered (this browser only), for its tag. */
export const SOURCES_KEY = "spindle.account.design-sources";

/** After a round that couldn't reach the account (or the service had trouble), the next one starts by itself this long after, doubling each time up to RETRY_MAX_MS. */
export const RETRY_FIRST_MS = 30_000;
export const RETRY_MAX_MS = 10 * 60_000;

type RequestFailure = Extract<DataResult<never>, { kind: "failed" }>["reason"];

/** What My designs says when a request to the account fails (never the sign-in words: the person is signed in). */
export const REQUEST_WORDS: Readonly<Record<RequestFailure, string>> = {
  offline: "Couldn't reach your account. Check your internet connection and try again.",
  unavailable: "The account service is having trouble right now. Please try again in a few minutes.",
  rejected: "Your account can't do this yet: the account service refused the request. Please try again later.",
  malformed: "The account service gave an answer SpindleLabs didn't understand. Please try again later.",
  storage: "This browser's storage is full or turned off, so it can't keep track of what is in your account. Free some space (close other tabs of SpindleLabs, or delete old projects) and try again.",
};

/** The same for a sending round, which tries again by itself (RETRY_FIRST_MS) except when storage is the trouble. */
const ROUND_WORDS: Readonly<Record<RequestFailure, string>> = {
  offline: "Your account couldn't be reached, so your latest changes will be sent when you're back online.",
  unavailable: "Your latest changes couldn't be sent to your account: the account service is having trouble right now. They'll be sent by themselves once it works again.",
  rejected: "Your latest changes couldn't be sent to your account: it can't keep designs yet. They'll be sent by themselves once it can.",
  malformed: "Your latest changes couldn't be sent to your account: the account service gave an answer SpindleLabs didn't understand. SpindleLabs will try again by itself.",
  storage: "Your latest changes couldn't be sent to your account: this browser's storage is full or turned off, so it can't keep track of what was sent. Free some space (close other tabs of SpindleLabs, or delete old projects); they're sent at your next change.",
};

/** The session ended under the app (the service's time limit, the account's sessions ended elsewhere): said at the foot of the page by account.ts, and by a round that found nobody signed in (#628 item 4). */
export const SIGNED_OUT_WORDS = "You're signed out, so your changes are no longer kept in your account. Sign in again to keep them.";

/** The words about a sending round, for the My designs dialog. "" when there is nothing to say. */
export function reportWords(r: SyncReport | null): string {
  if (r === null) return "";
  switch (r.kind) {
    case "done": {
      const words: string[] = [];
      for (const name of r.copies) words.push(`“${name}” was changed on another device too, so this browser's version is kept beside it as “${name} (copy)”.`);
      if (r.tooBig.length) words.push(`${r.tooBig.map((n) => `“${n}”`).join(", ")} ${r.tooBig.length === 1 ? "is" : "are"} too big to keep in your account (over 5 MB each), so ${r.tooBig.length === 1 ? "it stays" : "they stay"} only in this browser.`);
      const refused = r.refused ?? [];
      if (refused.length) words.push(`The account service refused ${refused.map((n) => `“${n}”`).join(", ")}, so ${refused.length === 1 ? "it stays" : "they stay"} only in this browser until ${refused.length === 1 ? "it changes" : "they change"}. Your other designs are still kept.`);
      const gone = r.gone ?? [];
      if (gone.length) words.push(`${gone.map((n) => `“${n}”`).join(", ")} ${gone.length === 1 ? "was" : "were"} deleted from your account, so the changes made here since are kept only in this browser. Use Save to keep a file of ${gone.length === 1 ? "it" : "them"}.`);
      return words.join(" ");
    }
    case "full":
      return "Your account's space is full, so your latest changes are kept only in this browser. Delete designs you don't need to make room.";
    case "off":
      return "";
    case "signed-out":
      return SIGNED_OUT_WORDS;
    case "failed":
      return ROUND_WORDS[r.reason];
  }
}

/** The words for a request that didn't work, thrown for the dialog to say. */
function failure(r: Exclude<DataResult<unknown>, { kind: "ok" }>): Error {
  return new Error(r.kind === "signed-out" ? "You're signed out. Sign in again to see your designs." : REQUEST_WORDS[r.reason]);
}

/** Where a tab holds the right to send while the browser has no navigator.locks (see storageLock). */
export const LEASE_KEY = "spindle.account.design-sync-lease";
/** A lease not renewed for this long (a tab closed mid-round) is free again; the holder renews it every third of it. */
export const LEASE_MS = 60_000;
/** How long a tab waits after writing its lease before reading it back; far longer than its own read-then-write takes. */
export const LEASE_SETTLE_MS = 50;
/** How often a tab waiting for the lease looks again. */
export const LEASE_RETRY_MS = 250;

export interface LeaseDeps {
  readonly now: () => number;
  readonly wait: (ms: number) => Promise<void>;
  /** A new id for one holder, unique among this browser's tabs. */
  readonly id: () => string;
}

const realLease: LeaseDeps = {
  now: () => Date.now(),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  id: () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join(""),
};

/**
 * A lock across this browser's tabs kept in localStorage, for browsers without navigator.locks. Fischer's mutual
 * exclusion: a tab that finds the lease free (or run out) writes its own id straight away, in the same turn of the event
 * loop as the read, waits LEASE_SETTLE_MS, and holds the lock only if its id is still there. Two tabs that both found it
 * free wrote within that read-then-write, well inside the wait, so the later write is what both read back: only one
 * goes on. The holder renews the lease while it runs and removes it when done. When storage can't keep the lease, `fn`
 * runs anyway: then the links can't be kept either, so a round sends nothing new (sync.ts notes an add before sending).
 */
export function storageLock(store: SmallStore, deps: LeaseDeps = realLease) {
  const read = (): { id: string; until: number } | null => {
    const v = JSON.parse(store.getItem(LEASE_KEY) ?? "null") as unknown;
    if (typeof v !== "object" || v === null) return null;
    const l = v as Record<string, unknown>;
    return typeof l.id === "string" && typeof l.until === "number" ? { id: l.id, until: l.until } : null;
  };
  const held = (me: string) => {
    try {
      return read()?.id === me;
    } catch {
      return false;
    }
  };
  return async function lock<T>(fn: () => Promise<T>): Promise<T> {
    const me = deps.id();
    for (;;) {
      try {
        const now = deps.now();
        const cur = read();
        if (cur && cur.id !== me && cur.until > now) {
          await deps.wait(LEASE_RETRY_MS);
          continue;
        }
        store.setItem(LEASE_KEY, JSON.stringify({ id: me, until: now + LEASE_MS }));
      } catch {
        return fn(); // storage blocked or full: see above
      }
      await deps.wait(LEASE_SETTLE_MS);
      if (held(me)) break;
    }
    const renew = setInterval(() => {
      try {
        if (held(me)) store.setItem(LEASE_KEY, JSON.stringify({ id: me, until: deps.now() + LEASE_MS }));
      } catch {
        // Can't renew: another tab may take it once it runs out; the links are read fresh inside every round anyway.
      }
    }, LEASE_MS / 3);
    try {
      return await fn();
    } finally {
      clearInterval(renew);
      try {
        if (held(me)) store.removeItem(LEASE_KEY);
      } catch {
        // It runs out by itself.
      }
    }
  };
}

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function startDesigns(client: AuthClient, host: DesignsHost, store: SmallStore) {
  const api = designsApi(client);
  const userId = () => {
    const s = client.state();
    return s.kind === "signed-in" ? s.user.id : null;
  };
  const sources = (): Record<string, string> => {
    try {
      const v = JSON.parse(store.getItem(SOURCES_KEY) ?? "{}");
      return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  };
  function sourceOf(id: string): Source {
    const all = sources();
    if (id === host.openId()) {
      const now = host.workspace();
      if (isSource(now) && all[id] !== now) {
        all[id] = now;
        try {
          store.setItem(SOURCES_KEY, JSON.stringify(all));
        } catch {
          // Storage blocked: the tag is worked out again next time.
        }
      }
      if (isSource(now)) return now;
    }
    const kept = all[id];
    return isSource(kept) ? kept : "design";
  }
  const leaseLock = storageLock(store);
  function syncFor(user: string) {
    return designSync({
      api,
      userId: user,
      who: userId,
      store,
      local: {
        list: () => host.list(), // a project with a problem keeps its link, and isn't sent
        text: (id) => host.text(id),
        ...(host.stored ? { stored: (id: string) => host.stored!(id) } : {}),
        put: (id, text, name, savedAt) => host.put(id, text, name, savedAt),
      },
      hash: sha256,
      ...(host.asRead ? { asRead: (text: string) => host.asRead!(text) } : {}),
      source: (id) => sourceOf(id),
      picture: (id) => (id === host.openId() ? host.picture() : null),
      lock: (fn) => (globalThis.navigator?.locks ? navigator.locks.request("spindle-design-sync", fn) : leaseLock(fn)),
    });
  }

  let last: SyncReport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryMs = 0;
  /** After a round that couldn't reach the account: the next one by itself, later each time (bounded); none otherwise. */
  function retryAfter(r: SyncReport): void {
    if (retry) clearTimeout(retry);
    retry = null;
    if (r.kind !== "failed" || r.reason === "storage") {
      retryMs = 0;
      return;
    }
    retryMs = Math.min(RETRY_MAX_MS, retryMs === 0 ? RETRY_FIRST_MS : retryMs * 2);
    retry = setTimeout(() => {
      retry = null;
      void sendNow();
    }, retryMs);
  }
  async function sendNow(): Promise<void> {
    const user = userId();
    if (!user) return;
    if (running) return running.then(sendNow); // one round at a time in this tab; the next one sees every change
    running = (async () => {
      try {
        last = await syncFor(user).syncAll();
      } catch {
        last = { kind: "failed", reason: "storage" };
      } finally {
        running = null;
      }
      retryAfter(last);
    })();
    return running;
  }
  /** After a save: send a few seconds later, once, however many saves came meanwhile. */
  function saved(): void {
    if (!userId()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void sendNow();
    }, SEND_AFTER_MS);
  }
  addEventListener("online", () => void sendNow());

  /** Projects from before this person first signed in here (see sync.ts firstTime), as the dialog shows them. */
  let others: { state: "ask" | "left"; count: number } | null = null;
  async function refreshOthers(): Promise<{ state: "ask" | "left"; count: number } | null> {
    const user = userId();
    if (!user) return (others = null);
    const s = syncFor(user);
    if (s.firstTime()) {
      const count = (await host.list()).length;
      // Nothing here yet: nothing to ask, and everything from now on is this person's.
      if (count === 0) {
        await s.firstChoice(true);
        return (others = null);
      }
      return (others = { state: "ask", count });
    }
    const left = s.leftCount();
    return (others = left > 0 ? { state: "left", count: left } : null);
  }

  let dialog: MyDesigns | null = null;
  function show(): Promise<void> {
    dialog ??= myDesigns(document, {
      list: async () => {
        await refreshOthers();
        void sendNow(); // anything not sent yet goes now, and the list shows it next time
        const r = await api.list();
        if (r.kind !== "ok") throw failure(r);
        return r.value;
      },
      openRemote: () => {
        const user = userId();
        const id = host.openId();
        return user && id ? syncFor(user).remoteOf(id) : null;
      },
      open: async (remote) => {
        const user = userId();
        if (!user) throw failure({ kind: "signed-out" });
        await sendNow(); // a change made here goes up first, so bringing the design in never overwrites it
        const r = await syncFor(user).bring(remote);
        if (r.kind !== "ok") throw failure(r);
        if (r.value === null) throw new Error("That design was deleted from your account, maybe on another device.");
        const kept = (await host.list()).find((p) => p.id === r.value);
        await host.open(r.value, kept && kept.problem === undefined ? kept.modified : null);
      },
      remove: async (id) => {
        const r = await api.remove(id);
        if (r.kind !== "ok") throw failure(r);
      },
      space: async () => {
        const r = await api.space();
        return r.kind === "ok" ? r.value : null;
      },
      limits: LIMITS,
      keeping: async () => {
        const r = await api.keeping();
        return r.kind === "ok" ? r.value : null;
      },
      setKeeping: async (yes) => {
        const r = await api.setKeeping(yes);
        if (r.kind !== "ok") throw failure(r);
        if (yes) void sendNow();
      },
      syncWords: () => reportWords(last),
      others: () => others,
      keepOthers: async (keep) => {
        const user = userId();
        if (!user) throw failure({ kind: "signed-out" });
        const s = syncFor(user);
        const ok = s.firstTime() ? await s.firstChoice(keep) : keep ? await s.includeLeft() : true;
        if (!ok) throw failure({ kind: "failed", reason: "storage" });
        await sendNow();
      },
    });
    return dialog.show();
  }

  return {
    saved,
    sendNow,
    show,
    /** After signing in: when projects already in this browser need the person's answer, My designs opens to ask. */
    async askIfNeeded(): Promise<void> {
      if ((await refreshOthers())?.state === "ask") await show();
      else void sendNow();
    },
    /**
     * The account's earlier versions of kept project `localId` (account features 2), for File > Earlier versions…:
     * null when there is no account side (signed out, the project not in the account, or an account service that
     * doesn't keep versions yet), or why they can't be listed now.
     */
    async versionsOf(localId: string): Promise<AccountVersions | null> {
      const user = userId();
      const remote = user ? syncFor(user).remoteOf(localId) : null;
      if (!remote) return null;
      const r = await api.versions(remote);
      if (r.kind === "ok") return { times: r.value };
      if (r.kind === "signed-out" || r.reason === "rejected") return null;
      return { problem: REQUEST_WORDS[r.reason] };
    },
    /** The file text of the account's version of `localId` saved `at`; throws the words to say when it can't. */
    async versionText(localId: string, at: Date): Promise<string> {
      const user = userId();
      if (!user) throw failure({ kind: "signed-out" });
      const remote = syncFor(user).remoteOf(localId);
      if (!remote) throw new Error("This project isn't kept in your account, so its versions there can't be read.");
      const r = await api.version(remote, at);
      if (r.kind !== "ok") throw failure(r);
      if (r.value === null) throw new Error("That version is no longer kept in your account: the oldest are given up when your space is full.");
      return r.value;
    },
    /** Signing out or deleting the account: links and remembered tags go, and nothing more is sent. */
    forget(user: string) {
      if (timer) clearTimeout(timer);
      timer = null;
      if (retry) clearTimeout(retry);
      retry = null;
      forgetLinks(store, user);
      dialog?.close();
    },
  };
}

export type Designs = ReturnType<typeof startDesigns>;
