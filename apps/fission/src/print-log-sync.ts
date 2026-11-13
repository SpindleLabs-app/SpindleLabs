// The print log kept in the account (account features 5; account chunk only). While someone is signed in with
// "Keep my print log in my account" on, the prints they make are theirs (PRINT_LOG_OWNER_KEY names them, so
// Design's logPrint marks each print), and rounds of @fission/account print-log.ts keep this browser's and the
// account's logs the same: on start and sign-in, `PRINT_SEND_AFTER_MS` after a print is saved or changed, when going
// online, and on coming back to the tab (at most every `PRINT_PULL_MS`). The print log dialog's account line holds the
// switch and, for prints made here while signed out, Keep these in my account (on a shared computer they may be
// someone else's, so never sent without asking).

import { type AuthClient, forgetPrintLogSeen, type LocalPrints, type LoggedPrint, printLogApi, type PrintLogReport, printLogSync, SESSION_KEY, type SmallStore } from "@fission/account";
import { claimPrints, PRINT_LOG_OWNER_KEY, PRINT_LOGGED_EVENT, printFrom, readLog, writeLog, type PrintEntry } from "@fission/print";
import { currentPrintLog } from "./print-log.ts";

export const PRINT_SEND_AFTER_MS = 4000;
export const PRINT_PULL_MS = 60_000;

/** This browser's log as a round needs it, over @fission/print's store. */
export function localPrints(storage: Storage | null): LocalPrints {
  return {
    read: () => {
      const log = readLog(storage);
      return log.writable ? log.prints : null;
    },
    apply(put, drop) {
      const log = readLog(storage);
      if (!log.writable) return false;
      const byId = new Map(log.prints.map((p) => [p.id, p]));
      for (const d of drop) {
        const p = byId.get(d.id);
        // Changed here while the round ran: kept, and it goes back to the account next round.
        if (p && p.updatedAt === d.asOf) byId.delete(d.id);
      }
      for (const raw of put) {
        const p = printFrom(raw as unknown) as PrintEntry | null;
        if (!p) continue; // a print this app can't keep (a newer app's): left in the account
        const had = byId.get(p.id);
        if (had && (had.owner !== p.owner || Date.parse(had.updatedAt) > Date.parse(p.updatedAt))) continue;
        byId.set(p.id, p);
      }
      return writeLog(storage, { ...log, prints: [...byId.values()] });
    },
  };
}

/** The words about the last round for the log's account line; "" when there is nothing to say. */
export function reportWords(r: PrintLogReport | null): string {
  if (r === null || r.kind === "off" || r.kind === "signed-out") return "";
  if (r.kind === "done") return r.full ? `Your account's print log is full (500 prints), so ${r.full === 1 ? "1 print stays" : `${r.full} prints stay`} only in this browser. Delete old prints to make room.` : "";
  if (r.kind === "failed" && r.reason === "rejected") return ""; // the account service doesn't keep print logs yet
  return r.kind === "failed" && r.reason === "offline" ? "Your account couldn't be reached, so your print log will catch up once you're back online." : "Your print log couldn't be brought up to date with your account just now. It will be tried again soon.";
}

export function startPrintLogSync(client: AuthClient, store: SmallStore, storage: Storage | null) {
  const api = printLogApi(client);
  const local = localPrints(storage);
  const userId = () => {
    const s = client.state();
    return s.kind === "signed-in" ? s.user.id : null;
  };
  /** Keeping is on (true), off (false), or not known yet / not offered by the service (null). */
  let keep: boolean | null = null;
  let last: PrintLogReport | null = null;
  let generation = 0;
  let running: Promise<void> | null = null;
  let lastPull = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Names the person the prints made now belong to: only while signed in with keeping on. */
  function owner(): void {
    const user = userId();
    try {
      if (user && keep === true) storage?.setItem(PRINT_LOG_OWNER_KEY, user);
      else storage?.removeItem(PRINT_LOG_OWNER_KEY);
    } catch {
      // Storage blocked: no print can be made here either.
    }
  }

  async function now(): Promise<void> {
    const user = userId();
    if (!user) return (owner(), render());
    if (running) return running.then(now);
    const started = generation;
    running = (async () => {
      try {
        lastPull = Date.now();
        last = await printLogSync({
          api,
          userId: user,
          store,
          local,
          lock: (fn) => (globalThis.navigator?.locks ? navigator.locks.request("spindle-print-log-sync", fn) : fn()),
          current: () => generation === started && userId() === user,
        }).round();
        if (last.kind === "done") keep = true;
        else if (last.kind === "off") keep = false;
        else if (last.kind === "failed" && last.reason === "rejected") keep = null;
        if (last.kind === "done" && (last.brought || last.deleted)) currentPrintLog()?.refresh();
      } catch {
        last = { kind: "failed", reason: "storage" };
      } finally {
        running = null;
        owner();
        render();
      }
    })();
    return running;
  }

  function soon(): void {
    if (!userId() || keep === false) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void now();
    }, PRINT_SEND_AFTER_MS);
  }

  /** The prints in this browser of no account. */
  const unowned = () => readLog(storage).prints.filter((p: LoggedPrint) => p.owner === null).length;

  /** The account line at the top of the print log. */
  function render(): void {
    const view = currentPrintLog();
    if (!view) return;
    const line = view.dialog.account;
    const doc = line.ownerDocument;
    const user = userId();
    if (!user || keep === null) return void line.replaceChildren(...(user && last ? wordsLine(doc, reportWords(last)) : []));
    const label = doc.createElement("label");
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.id = "print-log-keep";
    box.checked = keep;
    const words = doc.createElement("span");
    words.textContent = "Keep my print log in my account, so it is the same on every device you sign in on";
    label.append(box, words);
    box.addEventListener("change", async () => {
      const on = box.checked;
      box.disabled = true;
      const r = await api.setKeeping(on);
      if (r.kind !== "ok") {
        box.checked = !on;
        box.disabled = false;
        return void line.append(...wordsLine(doc, "That couldn't be changed just now. Try again in a moment."));
      }
      forgetPrintLogSeen(store, user);
      keep = on;
      owner();
      if (on) await now();
      else render();
    });
    const parts: HTMLElement[] = [label, ...wordsLine(doc, reportWords(last))];
    const n = keep ? unowned() : 0;
    if (n > 0) {
      const p = doc.createElement("p");
      p.id = "print-log-others";
      p.textContent = `${n === 1 ? "1 print in this browser was" : `${n} prints in this browser were`} made while signed out, so ${n === 1 ? "it is" : "they are"} kept only here. On a shared computer ${n === 1 ? "it" : "they"} may be someone else's. `;
      const claim = doc.createElement("button");
      claim.type = "button";
      claim.id = "print-log-claim";
      claim.className = "print-log-button";
      claim.textContent = "Keep these in my account";
      claim.addEventListener("click", () => {
        claimPrints(storage, user, new Date());
        view.refresh();
        void now();
      });
      p.append(claim);
      parts.push(p);
    }
    line.replaceChildren(...parts);
  }

  function wordsLine(doc: Document, words: string): HTMLElement[] {
    if (!words) return [];
    const p = doc.createElement("p");
    p.className = "print-log-account-words";
    p.textContent = words;
    return [p];
  }

  document.addEventListener(PRINT_LOGGED_EVENT, soon);
  currentPrintLog()?.onChange(soon);
  currentPrintLog()?.dialog.element.addEventListener("toggle", render);
  addEventListener("online", () => void now());
  addEventListener("storage", (e) => {
    if (e.key === SESSION_KEY || e.key === null) {
      generation++;
      keep = null;
      owner();
      void now();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastPull >= PRINT_PULL_MS) void now();
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
    /** Signing out or deleting the account: prints made from now on are nobody's, a round running writes nothing,
     * and deleting the account forgets what this browser saw of it. The prints here stay. */
    forget(user: string, deleted: boolean): void {
      if (timer) clearTimeout(timer);
      timer = null;
      generation++;
      keep = null;
      try {
        storage?.removeItem(PRINT_LOG_OWNER_KEY);
      } catch {
        // Storage blocked.
      }
      if (deleted) forgetPrintLogSeen(store, user);
      render();
    },
  };
}

export type PrintLogSyncHandle = ReturnType<typeof startPrintLogSync>;
