// Sharing links (community C2c, C2d; behind the ?share switch until the legal check): File ▾ > Share… makes a link to a
// frozen copy of the open design, lists the person's links with Turn off; and a link opened (`?share=<id>`) shows the
// shared design with "Open my own copy" and a Report button. The requests are the account side's (apps/fission
// src/share.ts, @fission/account shares.ts); this file is the two dialogs and their words. Styles: styles/share.css.
// Every word about terms here is a PLACEHOLDER until a lawyer has checked it.

import { savedWhen } from "./project-list.ts";

export const SHARE_TITLE = "Share this design";
export const SHARE_NOTE = "A link opens a frozen copy of the design as it is now. Anyone with the link can look at it and open their own copy, without an account. Later changes you make are not in the link; make a new link for those. You can turn a link off at any time.";
/** PLACEHOLDER words until a lawyer has checked the sharing terms. */
export const SHARE_TERMS_PLACEHOLDER = "Placeholder terms, not yet checked by a lawyer: only share designs that are yours or that you may share. Anyone with the link can copy the design. Links can be reported and taken down.";
export const SIGN_IN_TO_SHARE = "Sign in to make a sharing link. People opening a link don't need an account.";
export const NO_LINKS = "You have no sharing links on.";
export const turnOffQuestion = (name: string) => `Turn off the link to “${name}”? Nobody can open it again, and its copy is deleted. This can't be undone.`;

/** PLACEHOLDER wording for an account that moderation has put on hold. */
export const HELD_WORDS = "Your account can't share or report right now.";

/** PLACEHOLDER wording while sharing is switched off at the service (until the legal check). */
export const OFF_WORDS = "Sharing links aren't switched on yet.";

/** The words for each answer to making a link that is not "shared". */
export const SHARE_REFUSALS: Readonly<Record<string, string>> = {
  "too-big": "This design is too big to share (over 5 MB).",
  full: "You have as many links on, or as much shared, as your account allows (50 links, 20 MB). Turn one off to make room.",
  held: HELD_WORDS,
  off: OFF_WORDS,
  daily: "You have made 20 links in the last day, the most a day allows. Try again tomorrow.",
};

export interface ShareLinkRow {
  id: string;
  name: string;
  picture: string | null;
  createdAt: Date;
  removedAt: Date | null;
}

export interface ShareParts {
  /** The name of the design open now. */
  name(): string;
  /** Makes a link to a frozen copy of the open design; gives its address. Throws the words to say when it can't. */
  make(): Promise<string>;
  /** The person's links that are on; throws the words to say when it can't. */
  list(): Promise<ShareLinkRow[]>;
  /** The address of a link. */
  addressOf(id: string): string;
  /** Turns a link off. */
  turnOff(id: string): Promise<void>;
  /** Copies text to the clipboard; false when the browser refuses. */
  copy(text: string): Promise<boolean>;
  now?: () => Date;
}

export interface Dialog {
  show(): Promise<void>;
  close(): void;
  readonly open: boolean;
  readonly element: HTMLDialogElement;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Doc = Document;
const make = (doc: Doc) => <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => {
  const e = doc.createElement(tag);
  Object.assign(e, props);
  return e;
};

/** A modal card with a title and Close; `body` is what the caller fills. Escape and a click outside close it. */
function card(doc: Doc, id: string, title: string) {
  const el = make(doc);
  const dialog = el("dialog", { id, className: "share" });
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  const head = el("div", { className: "share-head" });
  const close = el("button", { type: "button", id: `${id}-close`, className: "share-button", textContent: "Close" });
  head.append(el("h2", { id: `${id}-title`, textContent: title }), close);
  const body = el("div", { className: "share-body" });
  dialog.append(head, body);
  doc.body.append(dialog);
  const finish = () => {
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
    e.stopPropagation();
  });
  const open = () => {
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    close.focus();
  };
  return { el, dialog, body, finish, open, close };
}

/** The Share dialog (id `share`): make a link, copy it, and the links already on. */
export function shareDialog(doc: Doc, parts: ShareParts): Dialog {
  const c = card(doc, "share", SHARE_TITLE);
  const { el } = c;
  const note = el("p", { className: "share-note", textContent: SHARE_NOTE });
  const terms = el("p", { className: "share-note share-terms", id: "share-terms", textContent: SHARE_TERMS_PLACEHOLDER });
  const makeButton = el("button", { type: "button", id: "share-make", className: "share-button share-primary", textContent: "Make a link" });
  const result = el("div", { id: "share-result", className: "share-result" });
  const status = el("p", { id: "share-status", className: "share-status" });
  status.setAttribute("role", "status");
  const items = el("ul", { id: "share-items", className: "share-items" });
  c.body.append(note, terms, makeButton, result, status, items);
  let busy = false;
  let filling = 0;
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };

  async function fill(): Promise<void> {
    const ticket = ++filling;
    let rows: ShareLinkRow[];
    try {
      rows = await parts.list();
    } catch (e) {
      if (ticket === filling) say(`Your links can't be listed right now. ${message(e)}`, true);
      return;
    }
    if (ticket !== filling) return;
    items.replaceChildren(...rows.map(rowFor));
    if (!status.classList.contains("bad")) say(rows.length === 0 ? NO_LINKS : "");
  }

  function rowFor(row: ShareLinkRow): HTMLLIElement {
    const li = el("li", { className: "share-item" });
    li.dataset.id = row.id;
    const words = el("div", { className: "share-item-words" });
    const when = savedWhen(row.createdAt, (parts.now ?? (() => new Date()))());
    words.append(el("span", { className: "share-item-name", textContent: row.name || "Untitled" }), el("span", { className: "share-item-when", textContent: row.removedAt ? `${when} · taken down after a report` : when }));
    const actions = el("div", { className: "share-item-actions" });
    const plain = () => {
      actions.replaceChildren();
      if (!row.removedAt) {
        const copy = el("button", { type: "button", className: "share-button share-item-copy", textContent: "Copy link" });
        copy.addEventListener("click", () => void parts.copy(parts.addressOf(row.id)).then((ok) => say(ok ? "Link copied." : "Your browser wouldn't copy it. Select the link and copy it by hand.", !ok)));
        actions.append(copy);
      }
      const off = el("button", { type: "button", className: "share-button share-item-off", textContent: "Turn off", title: `Turn off the link to “${row.name}” (asks first)` });
      off.addEventListener("click", asking);
      actions.append(off);
    };
    const asking = () => {
      const q = el("span", { className: "share-item-question", textContent: turnOffQuestion(row.name || "Untitled") });
      const keep = el("button", { type: "button", className: "share-button share-item-keep", textContent: "Keep it on" });
      const sure = el("button", { type: "button", className: "share-button share-item-off-sure", textContent: "Turn off" });
      keep.addEventListener("click", () => (plain(), actions.querySelector<HTMLButtonElement>(".share-item-off")?.focus()));
      sure.addEventListener("click", () => void act(() => parts.turnOff(row.id)));
      actions.replaceChildren(q, keep, sure);
      keep.focus();
    };
    plain();
    li.append(words, actions);
    return li;
  }

  async function act(run: () => Promise<void>) {
    if (busy) return;
    busy = true;
    c.dialog.setAttribute("aria-busy", "true");
    say("");
    try {
      await run();
    } catch (e) {
      say(message(e).replace(/^./, (ch) => ch.toUpperCase()), true);
    } finally {
      busy = false;
      c.dialog.removeAttribute("aria-busy");
    }
    await fill();
  }

  makeButton.addEventListener("click", () =>
    void act(async () => {
      const address = await parts.make();
      const input = el("input", { type: "text", readOnly: true, value: address, id: "share-address", className: "share-address" });
      input.setAttribute("aria-label", "Sharing link");
      const copy = el("button", { type: "button", id: "share-copy", className: "share-button", textContent: "Copy link" });
      copy.addEventListener("click", () => void parts.copy(address).then((ok) => say(ok ? "Link copied." : "Your browser wouldn't copy it. Select the link and copy it by hand.", !ok)));
      result.replaceChildren(el("p", { className: "share-note", textContent: "Your link is on. It shows the design as it is now:" }), input, copy);
      input.select();
    }),
  );

  return {
    async show() {
      say("");
      result.replaceChildren();
      items.replaceChildren();
      c.open();
      await fill();
    },
    close: c.finish,
    get open() {
      return c.dialog.open;
    },
    element: c.dialog,
  };
}

/** What the shared view needs of an opened link (never who shared it). */
export interface SharedCopy {
  name: string;
  picture: string | null;
  createdAt: Date;
}

export const REPORT_KIND_WORDS: readonly (readonly [string, string])[] = [
  ["copied", "It copies someone else's work"],
  ["weapon", "It is a weapon or part of one"],
  ["sexual", "Sexual content"],
  ["hateful", "Hateful or harassing"],
  ["illegal", "Something illegal"],
  ["not-a-design", "Not a design (spam or a joke)"],
  ["personal-info", "Shows someone's personal information"],
  ["other", "Something else"],
];

export const REPORT_ANSWERS: Readonly<Record<string, string>> = {
  kept: "Thanks. Your report was sent for review.",
  gone: "That link has been turned off already, so there is nothing to report.",
  enough: "You have already reported this as often as is allowed. It is waiting for review.",
  held: HELD_WORDS,
  off: OFF_WORDS,
  own: "This is your link: turn it off instead.",
  bad: "That report wasn't accepted. Pick a reason, and keep the details under 1,000 characters.",
};

export interface SharedParts {
  /** Opens the shared copy as a new project in this browser; throws the words to say when it can't (damaged, newer). */
  openCopy(): Promise<void>;
  /** Reports the link; gives the report's answer ("kept", "gone", "enough", "bad"); throws the words to say when it can't. */
  report(kind: string, reason: string): Promise<string>;
  /** Called when the view closes, with or without opening the copy (the app takes the link out of the address). */
  closed(): void;
  now?: () => Date;
}

/** The shared view (id `shared`): the frozen copy's name and picture, Open my own copy, Report. */
export function sharedView(doc: Doc, copy: SharedCopy, parts: SharedParts): Dialog {
  const c = card(doc, "shared", "A shared design");
  const { el } = c;
  const name = el("p", { className: "share-shared-name", id: "shared-name", textContent: copy.name || "Untitled" });
  const picture = copy.picture ? Object.assign(el("img", { className: "share-picture", src: copy.picture, alt: "" }), { width: 192, height: 128 }) : null;
  const when = el("p", { className: "share-note", textContent: `A frozen copy, shared ${savedWhen(copy.createdAt, (parts.now ?? (() => new Date()))())}. Opening it makes your own copy in this browser; the link and the person who shared it are never changed.` });
  const openButton = el("button", { type: "button", id: "shared-open", className: "share-button share-primary", textContent: "Open my own copy" });
  const reportButton = el("button", { type: "button", id: "shared-report", className: "share-button", textContent: "Report this design" });
  const status = el("p", { id: "shared-status", className: "share-status" });
  status.setAttribute("role", "status");
  const form = el("div", { id: "shared-report-form", className: "share-report" });
  form.hidden = true;
  const select = el("select", { id: "shared-report-kind", className: "share-field dark-select" });
  select.setAttribute("aria-label", "Why report it?");
  select.append(...REPORT_KIND_WORDS.map(([value, words]) => Object.assign(el("option"), { value, textContent: words })));
  const reason = el("textarea", { id: "shared-report-reason", className: "share-field", maxLength: 1000, rows: 3, placeholder: "Details (optional, up to 1,000 characters)" });
  reason.setAttribute("aria-label", "Details");
  const send = el("button", { type: "button", id: "shared-report-send", className: "share-button", textContent: "Send report" });
  form.append(select, reason, send);
  c.body.append(name, ...(picture ? [picture] : []), when, openButton, reportButton, form, status, el("p", { className: "share-note share-terms", textContent: SHARE_TERMS_PLACEHOLDER }));
  let busy = false;
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };
  const guard = async (run: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    c.dialog.setAttribute("aria-busy", "true");
    say("");
    try {
      await run();
    } catch (e) {
      say(message(e).replace(/^./, (ch) => ch.toUpperCase()), true);
    } finally {
      busy = false;
      c.dialog.removeAttribute("aria-busy");
    }
  };
  openButton.addEventListener("click", () =>
    void guard(async () => {
      await parts.openCopy();
      c.finish();
    }),
  );
  reportButton.addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden) select.focus();
  });
  send.addEventListener("click", () =>
    void guard(async () => {
      const answer = await parts.report(select.value, reason.value.slice(0, 1000));
      say(REPORT_ANSWERS[answer] ?? REPORT_ANSWERS.bad ?? "", answer !== "kept");
      if (answer === "kept") {
        form.hidden = true;
        reason.value = "";
      }
    }),
  );
  c.dialog.addEventListener("close", () => parts.closed());
  return {
    async show() {
      c.open();
    },
    close: c.finish,
    get open() {
      return c.dialog.open;
    },
    element: c.dialog,
  };
}
