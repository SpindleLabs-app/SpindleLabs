// File > Projects in this browser… (U6a; round 2 hunt A2, A3): every project kept in this browser, newest first,
// each with when it was last saved, the open one marked. Open puts one in place of the open project (the shell's
// `open`, which keeps the open one as it is first); Delete asks first, in the row, and is never offered for the open
// project. Until this list, opening a file left the project before it in the browser with no way back to it, and a
// stale tab's work kept "(from another tab)" could never be opened. The shell (apps/fission main.ts) does the opening
// and the deleting (@fission/storage bringForward, forget); this file is the dialog and its words.
// Styles: src/styles/project-list.css.

/** What the list needs of a kept project (@fission/storage ProjectSummary). */
export interface KeptProject {
  id: string;
  name: string;
  modified: Date;
  /** Set when its summary can't be read (the project may still open). */
  problem?: string;
}

export interface ProjectListRow {
  id: string;
  name: string;
  /** "Saved 5 minutes ago", and " · open now" for the open one. */
  when: string;
  open: boolean;
  /** A summary that can't be read: its name is its id, and Open may still work. */
  problem: boolean;
  modified: Date;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The day of a save more than a day ago, in the reader's own way ("4 Nov 2026"). */
const day = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * When `modified` was, seen at `now`, in plain words: under a minute (or a save time ahead of this clock, another
 * device's) "just now", then whole minutes, then whole hours, then the day (`date`).
 */
export function savedWhen(modified: Date, now: Date, date: (d: Date) => string = day): string {
  const ms = now.getTime() - modified.getTime();
  if (!(ms >= 60_000)) return "Saved just now"; // also NaN: a time that can't be read is never "NaN minutes ago"
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `Saved ${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Saved ${plural(hours, "hour")} ago`;
  return `Saved ${date(modified)}`;
}

/** The rows, in the order given (the store's: most recently saved first). Pure, so it is tested by hand. */
export function projectRows(kept: readonly KeptProject[], openId: string | null, now: Date, date: (d: Date) => string = day): ProjectListRow[] {
  return kept.map((k) => {
    const open = k.id === openId;
    const problem = k.problem !== undefined;
    const saved = problem ? "Its details can't be read; it may still open" : savedWhen(k.modified, now, date);
    return { id: k.id, name: problem ? "A project whose name can't be read" : k.name || "Untitled", when: open ? `${saved} · open now` : saved, open, problem, modified: k.modified };
  });
}

export const PROJECTS_TITLE = "Projects in this browser";
export const PROJECTS_NOTE = "Kept only in this browser, newest first. To keep one anywhere else, open it and use Save.";
export const NO_PROJECTS = "No projects are kept in this browser yet. Your work is kept here once you change something.";
export const deleteQuestion = (name: string) => `Delete “${name}” from this browser? This can't be undone.`;

export interface ProjectListParts {
  /** Every kept project, most recently saved first; may refuse (storage off), which the dialog says. */
  list(): Promise<KeptProject[]>;
  /** The id of the project open now, or null when it isn't kept yet. */
  openId(): string | null;
  /** Opens a kept project in place of the open one; a refusal (it can't be read) is said in the dialog, which stays. */
  open(id: string, modified: Date | null): Promise<void>;
  /** Deletes a kept project (never the open one); a refusal is said in the dialog. */
  remove(id: string): Promise<void>;
  now?: () => Date;
}

export interface ProjectList {
  /** Shows the dialog with the list read afresh; settles once it is filled. */
  show(): Promise<void>;
  close(): void;
  readonly open: boolean;
  readonly element: HTMLDialogElement;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The dialog, appended to `doc`'s body (id `projects`). */
export function projectList(doc: Document, parts: ProjectListParts): ProjectList {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) => Object.assign(doc.createElement(tag), props);
  const dialog = el("dialog", { id: "projects", className: "project-list" });
  dialog.setAttribute("aria-labelledby", "projects-title");
  const head = el("div", { className: "project-list-head" });
  const close = el("button", { type: "button", id: "projects-close", className: "project-list-button", textContent: "Close" });
  head.append(el("h2", { id: "projects-title", textContent: PROJECTS_TITLE }), close);
  const note = el("p", { className: "project-list-note", textContent: PROJECTS_NOTE });
  const status = el("p", { id: "projects-status", className: "project-list-status" });
  status.setAttribute("role", "status");
  const items = el("ul", { id: "projects-items", className: "project-list-items" });
  const body = el("div", { className: "project-list-body" });
  body.append(note, status, items);
  dialog.append(head, body);
  doc.body.append(dialog);

  /** Counts fillings: a list read before a newer filling began is dropped. */
  let filling = 0;
  let busy = false;
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };

  async function fill(): Promise<void> {
    const ticket = ++filling;
    let kept: KeptProject[];
    try {
      kept = await parts.list();
    } catch (e) {
      if (ticket !== filling) return;
      items.replaceChildren();
      return say(`The projects in this browser can't be listed (${message(e)}). Save keeps your work as a file.`, true);
    }
    if (ticket !== filling) return;
    const rows = projectRows(kept, parts.openId(), (parts.now ?? (() => new Date()))());
    items.replaceChildren(...rows.map(rowFor));
    if (rows.length === 0) say(NO_PROJECTS);
    else if (status.classList.contains("bad") === false) say("");
  }

  function rowFor(row: ProjectListRow): HTMLLIElement {
    const li = el("li", { className: "project-row" });
    li.dataset.id = row.id;
    if (row.open) li.dataset.open = "true";
    const words = el("div", { className: "project-row-words" });
    words.append(el("span", { className: "project-row-name", textContent: row.name }), el("span", { className: "project-row-when", textContent: row.when }));
    const actions = el("div", { className: "project-row-actions" });
    const plain = () => {
      actions.replaceChildren();
      if (row.open) return;
      const open = el("button", { type: "button", className: "project-list-button project-open", textContent: "Open", title: `Open “${row.name}” in place of the open project, which stays kept here` });
      const del = el("button", { type: "button", className: "project-list-button project-delete", textContent: "Delete", title: `Delete “${row.name}” from this browser (asks first)` });
      open.addEventListener("click", () => void act(() => parts.open(row.id, row.problem ? null : row.modified), true));
      del.addEventListener("click", asking);
      actions.append(open, del);
    };
    const asking = () => {
      const q = el("span", { className: "project-row-question", textContent: deleteQuestion(row.name) });
      const keep = el("button", { type: "button", className: "project-list-button project-keep", textContent: "Keep it" });
      const sure = el("button", { type: "button", className: "project-list-button project-delete-sure", textContent: "Delete" });
      keep.addEventListener("click", () => (plain(), actions.querySelector<HTMLButtonElement>(".project-delete")?.focus()));
      sure.addEventListener("click", () => void act(() => parts.remove(row.id), false));
      actions.replaceChildren(q, keep, sure);
      keep.focus(); // the safe answer has the focus: Enter keeps it
    };
    plain();
    li.append(words, actions);
    return li;
  }

  /** Runs an Open or a Delete, one at a time; an Open that worked closes the dialog, a Delete fills the list again. */
  async function act(run: () => Promise<void>, closes: boolean) {
    if (busy) return;
    busy = true;
    dialog.setAttribute("aria-busy", "true");
    say("");
    try {
      await run();
      if (closes) finish();
      else await fill();
    } catch (e) {
      say(message(e).replace(/^./, (c) => c.toUpperCase()), true);
      await fill();
    } finally {
      busy = false;
      dialog.removeAttribute("aria-busy");
    }
  }

  const finish = () => {
    filling++; // a list still being read is not put in a closed dialog
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
  // The app's shortcuts listen on the document: keys pressed here stay here.
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    }
    e.stopPropagation();
  });

  return {
    async show() {
      say("");
      items.replaceChildren();
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
