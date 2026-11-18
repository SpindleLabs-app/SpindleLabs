// The print log (account features 5): File ▾ > Print log…, a line for each print file saved from Slice for printing,
// newest first, with when it was saved, the slicer's choices, the weight and time, and what the person says about
// it: Printed well or Failed (what went wrong, from a short list, and a note), or nothing said yet. Delete asks in the
// row. The log itself is @fission/print print-log.ts; the app (apps/fission src/print-log.ts) hands this dialog its
// parts and fills `account` (the box that keeps the log in the account) when signed in. Styles: styles/print-log.css.

import { savedWhen } from "./project-list.ts";

export type PrintLogResult = "waiting" | "well" | "failed";

/** One print as the dialog shows it. */
export interface PrintLogRow {
  id: string;
  name: string;
  madeAt: Date;
  settings: string;
  grams: number | null;
  minutes: number | null;
  result: PrintLogResult;
  problem: string | null;
  note: string;
}

export interface PrintLogParts {
  /** The prints, newest made first. */
  list(): PrintLogRow[];
  /** The counts in words ("4 prints: 2 printed well…"). */
  summary(): string;
  /** What can go wrong, in the list's order. */
  problems: readonly { id: string; words: string }[];
  /** Changes print `id`; false when it couldn't be kept (storage full or blocked), which the dialog says. */
  change(id: string, change: { result?: PrintLogResult; problem?: string | null; note?: string }): boolean;
  /** Deletes print `id`; false when it couldn't be. */
  remove(id: string): boolean;
  /** The longest note, in characters. */
  noteMax: number;
  now?: () => Date;
}

export interface PrintLogDialog {
  show(): void;
  /** Draws the prints again (another tab or device changed them), keeping a note being typed. */
  refresh(): void;
  close(): void;
  readonly open: boolean;
  readonly element: HTMLDialogElement;
  /** The account's line at the top, filled by the app (empty when signed out). */
  readonly account: HTMLElement;
}

export const PRINT_LOG_TITLE = "Print log";
export const PRINT_LOG_NOTE = "Each print file you save from Slice for printing is added here. Say how each one printed, so you can see what worked next time.";
export const NO_PRINTS = "No prints yet. Each time you save a print file from Slice for printing, it is added here.";
export const PRINT_NOT_KEPT = "That change couldn't be kept: this browser's storage is full or blocked.";
export const RESULT_WORDS: Readonly<Record<PrintLogResult, string>> = { waiting: "Not said", well: "Printed well", failed: "Failed" };
export const removePrintQuestion = (name: string) => `Delete this print of “${name}” from the log? This can't be undone.`;

/** The weight and time in words: "About 12.3 g, 1 h 21 min", or "" when the slicer gave neither. */
export function amountWords(grams: number | null, minutes: number | null): string {
  const parts: string[] = [];
  if (grams !== null) parts.push(`${grams < 0.1 ? "under 0.1" : grams.toFixed(1).replace(/\.0$/, "")} g`);
  if (minutes !== null) parts.push(minutes < 1 ? "under a minute" : minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`);
  return parts.length ? `About ${parts.join(", ")}` : "";
}

/** The dialog, appended to `doc`'s body (id `print-log`). */
export function printLogDialog(doc: Document, parts: PrintLogParts): PrintLogDialog {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) => Object.assign(doc.createElement(tag), props);
  const dialog = el("dialog", { id: "print-log", className: "print-log" });
  dialog.setAttribute("aria-labelledby", "print-log-title");
  const head = el("div", { className: "print-log-head" });
  const close = el("button", { type: "button", id: "print-log-close", className: "print-log-button", textContent: "Close" });
  head.append(el("h2", { id: "print-log-title", textContent: PRINT_LOG_TITLE }), close);
  const note = el("p", { className: "print-log-note", textContent: PRINT_LOG_NOTE });
  const account = el("div", { id: "print-log-account", className: "print-log-account" });
  const summary = el("p", { id: "print-log-summary", className: "print-log-summary" });
  const status = el("p", { id: "print-log-status", className: "print-log-status" });
  status.setAttribute("role", "status");
  const items = el("ul", { id: "print-log-items", className: "print-log-items" });
  const body = el("div", { className: "print-log-body" });
  body.append(note, account, summary, status, items);
  dialog.append(head, body);
  doc.body.append(dialog);
  const now = () => (parts.now ?? (() => new Date()))();
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };
  const kept = (ok: boolean) => (ok ? say("") : say(PRINT_NOT_KEPT, true));
  /** A redraw asked while a note is being typed waits until it is left, so the typing is never lost. */
  let waiting = false;

  function fill(): void {
    const rows = parts.list();
    summary.textContent = rows.length ? parts.summary() : NO_PRINTS;
    items.replaceChildren(...rows.map(rowFor));
  }

  function rowFor(row: PrintLogRow): HTMLLIElement {
    const li = el("li", { className: "print-log-item" });
    li.dataset.id = row.id;
    li.dataset.result = row.result;
    const words = el("div", { className: "print-log-words" });
    words.append(el("span", { className: "print-log-name", textContent: row.name }), el("span", { className: "print-log-when", textContent: savedWhen(row.madeAt, now()) }), el("span", { className: "print-log-settings", textContent: row.settings }));
    const amount = amountWords(row.grams, row.minutes);
    if (amount) words.append(el("span", { className: "print-log-amount", textContent: amount }));
    const choice = el("div", { className: "print-log-results" });
    choice.setAttribute("role", "group");
    choice.setAttribute("aria-label", `How “${row.name}” printed`);
    for (const r of ["well", "failed", "waiting"] as const) {
      const b = el("button", { type: "button", className: `print-log-button print-log-result print-log-${r}`, textContent: RESULT_WORDS[r] });
      b.setAttribute("aria-pressed", String(row.result === r));
      b.addEventListener("click", () => {
        if (row.result === r) return;
        kept(parts.change(row.id, { result: r }));
        fill();
        dialog.querySelector<HTMLButtonElement>(`.print-log-item[data-id="${row.id}"] .print-log-${r}`)?.focus();
      });
      choice.append(b);
    }
    const failed = el("div", { className: "print-log-more" });
    if (row.result === "failed") {
      const problemLabel: HTMLLabelElement = doc.createElement("label");
      problemLabel.className = "print-log-field";
      const problem: HTMLSelectElement = doc.createElement("select");
      problem.className = "print-log-problem";
      const option = (value: string, words: string) => {
        const o: HTMLOptionElement = doc.createElement("option");
        o.value = value;
        o.textContent = words;
        return o;
      };
      problem.append(option("", "What went wrong?"), ...parts.problems.map((p) => option(p.id, p.words)));
      problem.value = row.problem ?? "";
      problem.addEventListener("change", () => kept(parts.change(row.id, { problem: problem.value || null })));
      problemLabel.append(el("span", { className: "print-log-field-name", textContent: "What went wrong" }), problem);
      failed.append(problemLabel);
    }
    const noteLabel: HTMLLabelElement = doc.createElement("label");
    noteLabel.className = "print-log-field print-log-note-field";
    const noteBox: HTMLTextAreaElement = doc.createElement("textarea");
    Object.assign(noteBox, { className: "print-log-note-box", rows: 2, maxLength: parts.noteMax, value: row.note, placeholder: row.result === "failed" ? "What happened, and what you'd change" : "Anything to remember about this print" });
    noteBox.addEventListener("change", () => kept(parts.change(row.id, { note: noteBox.value })));
    noteLabel.append(el("span", { className: "print-log-field-name", textContent: "Note" }), noteBox);
    failed.append(noteLabel);
    const actions = el("div", { className: "print-log-actions" });
    const plain = () => {
      const del = el("button", { type: "button", className: "print-log-button print-log-delete", textContent: "Delete", title: `Delete this print of “${row.name}” from the log (asks first)` });
      del.addEventListener("click", asking);
      actions.replaceChildren(del);
    };
    const asking = () => {
      const q = el("span", { className: "print-log-question", textContent: removePrintQuestion(row.name) });
      const no = el("button", { type: "button", className: "print-log-button print-log-keep", textContent: "Keep it" });
      const sure = el("button", { type: "button", className: "print-log-button print-log-delete-sure", textContent: "Delete" });
      no.addEventListener("click", () => (plain(), actions.querySelector<HTMLButtonElement>(".print-log-delete")?.focus()));
      sure.addEventListener("click", () => {
        kept(parts.remove(row.id));
        fill();
        close.focus();
      });
      actions.replaceChildren(q, no, sure);
      no.focus();
    };
    plain();
    li.append(words, choice, failed, actions);
    return li;
  }

  /** Whether a note in the list is being typed in. */
  const typing = () => {
    const a = doc.activeElement;
    return !!a && items.contains(a) && a.tagName === "TEXTAREA";
  };
  dialog.addEventListener("focusout", () => {
    // After the change event, so a note left is kept before the redraw reads it.
    if (waiting) setTimeout(() => {
      if (!waiting || typing()) return;
      waiting = false;
      fill();
    });
  });
  close.addEventListener("click", () => dialog.close());
  // Its keys stay in it: a tool key can't act behind the dialog.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  return {
    show() {
      say("");
      fill();
      if (!dialog.open) dialog.showModal();
      close.focus();
    },
    refresh() {
      if (!dialog.open) return;
      if (typing()) {
        waiting = true;
        return;
      }
      fill();
    },
    close: () => dialog.close(),
    get open() {
      return dialog.open;
    },
    element: dialog,
    account,
  };
}
