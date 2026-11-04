// File > Earlier versions… (missing basics 3b): the open project's earlier versions kept in this browser
// (@fission/storage versions.ts: one every ten minutes or so as you work, the newest twenty), newest first, each with
// when it was saved; Restore puts one in place of the project as it is now, as ONE undo step, so Undo takes it back
// and nothing asks first. The shell does the restoring (apps/fission main.ts `restoreVersion`). The dialog wears the
// project list's look (styles/project-list.css).

import { savedWhen } from "./project-list.ts";

export const VERSIONS_TITLE = "Earlier versions";
export const VERSIONS_NOTE = "Kept in this browser as you work, one every ten minutes or so, the newest 20. Restore puts one in place of what you have now, and Undo takes it back.";
export const NO_VERSIONS = "No earlier versions yet: one is kept once you have worked on this project for ten minutes or so.";
export const NOT_KEPT = "This project isn't kept in this browser yet, so it has no earlier versions: it is kept once you change something.";

/** The time of day, and the day too when it isn't `now`'s, in the reader's own way ("14:05", "3 Nov, 14:05"). */
export function versionTime(at: Date, now: Date): string {
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

export interface VersionRow {
  at: Date;
  /** "Saved 25 minutes ago". */
  when: string;
  /** "14:05". */
  time: string;
}

/** The rows, in the order given (newest first). Pure, so it is tested by hand. */
export function versionRows(times: readonly Date[], now: Date, time: (at: Date, now: Date) => string = versionTime): VersionRow[] {
  return times.map((at) => ({ at, when: savedWhen(at, now), time: time(at, now) }));
}

export interface VersionListParts {
  /** The open project's name, and its versions newest first; null when the open project isn't kept yet. May refuse. */
  list(): Promise<{ name: string; times: Date[] } | null>;
  /** Puts version `at` in place of the project as it is now (one undo step); a refusal is said in the dialog, which stays. */
  restore(at: Date): Promise<void>;
  now?: () => Date;
}

export interface VersionList {
  show(): Promise<void>;
  close(): void;
  readonly open: boolean;
  readonly element: HTMLDialogElement;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The dialog, appended to `doc`'s body (id `versions`). */
export function versionList(doc: Document, parts: VersionListParts): VersionList {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) => Object.assign(doc.createElement(tag), props);
  const dialog = el("dialog", { id: "versions", className: "project-list version-list" });
  dialog.setAttribute("aria-labelledby", "versions-title");
  const head = el("div", { className: "project-list-head" });
  const title = el("h2", { id: "versions-title", textContent: VERSIONS_TITLE });
  const close = el("button", { type: "button", id: "versions-close", className: "project-list-button", textContent: "Close" });
  head.append(title, close);
  const note = el("p", { className: "project-list-note", textContent: VERSIONS_NOTE });
  const status = el("p", { id: "versions-status", className: "project-list-status" });
  status.setAttribute("role", "status");
  const items = el("ul", { id: "versions-items", className: "project-list-items" });
  const body = el("div", { className: "project-list-body" });
  body.append(note, status, items);
  dialog.append(head, body);
  doc.body.append(dialog);

  let filling = 0;
  let busy = false;
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };

  async function fill() {
    const ticket = ++filling;
    let found: Awaited<ReturnType<VersionListParts["list"]>>;
    try {
      found = await parts.list();
    } catch (e) {
      if (ticket === filling) say(`The earlier versions can't be listed (${message(e)}).`, true);
      return;
    }
    if (ticket !== filling) return;
    title.textContent = found === null ? VERSIONS_TITLE : `${VERSIONS_TITLE} of “${found.name || "Untitled"}”`;
    const now = (parts.now ?? (() => new Date()))();
    const rows = found === null ? [] : versionRows(found.times, now);
    items.replaceChildren(...rows.map(rowFor));
    if (found === null) say(NOT_KEPT);
    else if (rows.length === 0) say(NO_VERSIONS);
  }

  function rowFor(row: VersionRow): HTMLLIElement {
    const li = el("li", { className: "project-row" });
    li.dataset.at = String(row.at.getTime());
    const words = el("div", { className: "project-row-words" });
    words.append(el("span", { className: "project-row-name", textContent: row.time }), el("span", { className: "project-row-when", textContent: row.when }));
    const actions = el("div", { className: "project-row-actions" });
    const restore = el("button", { type: "button", className: "project-list-button version-restore", textContent: "Restore", title: `Put the version from ${row.time} in place of what you have now (Undo takes it back)` });
    restore.addEventListener("click", () => void act(row.at));
    actions.append(restore);
    li.append(words, actions);
    return li;
  }

  async function act(at: Date) {
    if (busy) return;
    busy = true;
    dialog.setAttribute("aria-busy", "true");
    say("");
    try {
      await parts.restore(at);
      finish();
    } catch (e) {
      say(message(e).replace(/^./, (c) => c.toUpperCase()), true);
    } finally {
      busy = false;
      dialog.removeAttribute("aria-busy");
    }
  }

  const finish = () => {
    filling++;
    if (dialog.open) dialog.close();
  };
  close.addEventListener("click", finish);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    finish();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const { clientX: x, clientY: y } = e as MouseEvent;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) finish();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    }
    e.stopPropagation(); // the app's shortcuts listen on the document: keys pressed here stay here
  });

  return {
    async show() {
      say("");
      items.replaceChildren();
      title.textContent = VERSIONS_TITLE;
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      close.focus();
      await fill();
    },
    close: finish,
    get open() {
      return dialog.open;
    },
    element: dialog,
  };
}
