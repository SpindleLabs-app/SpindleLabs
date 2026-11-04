// My designs in the app (account features 1): while someone is signed in with keeping designs on, each project kept in
// this browser is sent to their account a few seconds after it is saved (@fission/account sync.ts), with a small
// picture of the open one; File > My designs… and the account dialog open the list (@fission/ui my-designs.ts).
// Loaded with the account code only. Nothing here is ever needed for CAD or saving: signed out, offline or with the
// account service down, projects are kept in the browser exactly as before, and are sent once it can be done.

import { type AuthClient, type DataResult, designSync, designsApi, FAILURE_WORDS, forgetLinks, isSource, LIMITS, type SmallStore, type Source, type SyncReport } from "@fission/account";
import { myDesigns, type MyDesigns } from "@fission/ui";

/** What the shell lends the account code (main.ts). */
export interface DesignsHost {
  /** The projects kept in this browser (store.list). */
  list(): Promise<readonly { id: string; name: string; modified: Date; problem?: string }[]>;
  /** A kept project's file text, or null when it is gone or can't be read. */
  text(id: string): Promise<string | null>;
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

/** The words about a sending round, for the My designs dialog. "" when there is nothing to say. */
export function reportWords(r: SyncReport | null): string {
  if (r === null) return "";
  switch (r.kind) {
    case "done": {
      const words: string[] = [];
      for (const name of r.copies) words.push(`“${name}” was changed on another device too, so this browser's version is kept beside it as “${name} (copy)”.`);
      if (r.tooBig.length) words.push(`${r.tooBig.map((n) => `“${n}”`).join(", ")} ${r.tooBig.length === 1 ? "is" : "are"} too big to keep in your account (over 5 MB each), so ${r.tooBig.length === 1 ? "it stays" : "they stay"} only in this browser.`);
      return words.join(" ");
    }
    case "full":
      return "Your account's space is full, so your latest changes are kept only in this browser. Delete designs you don't need to make room.";
    case "off":
      return "";
    case "signed-out":
      return "";
    case "failed":
      return r.reason === "offline" ? "Your account couldn't be reached, so your latest changes will be sent when you're back online." : `Your latest changes couldn't be sent to your account. ${FAILURE_WORDS[r.reason]}`;
  }
}

/** The words for a request that didn't work, thrown for the dialog to say. */
function failure(r: Exclude<DataResult<unknown>, { kind: "ok" }>): Error {
  return new Error(r.kind === "signed-out" ? "You're signed out. Sign in again to see your designs." : FAILURE_WORDS[r.reason]);
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
  function syncFor(user: string) {
    return designSync({
      api,
      userId: user,
      store,
      local: {
        list: async () => (await host.list()).filter((p) => p.problem === undefined),
        text: (id) => host.text(id),
        put: (id, text, name, savedAt) => host.put(id, text, name, savedAt),
      },
      hash: sha256,
      source: (id) => sourceOf(id),
      picture: (id) => (id === host.openId() ? host.picture() : null),
      lock: (fn) => (globalThis.navigator?.locks ? navigator.locks.request("spindle-design-sync", fn) : fn()),
    });
  }

  let last: SyncReport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
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
    /** Signing out or deleting the account: links and remembered tags go, and nothing more is sent. */
    forget(user: string) {
      if (timer) clearTimeout(timer);
      timer = null;
      forgetLinks(store, user);
      dialog?.close();
    },
  };
}

export type Designs = ReturnType<typeof startDesigns>;
