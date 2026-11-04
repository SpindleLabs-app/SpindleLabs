// My designs (account features 1): the designs kept in the signed-in person's account, newest first, each with a
// small picture, its name, the workspace it came from and when it was saved. Open brings one into this browser (the
// shell's `open`), Delete removes it from the account after asking in the row; the copy in this browser, if any,
// stays. At the top: how much of the account's space is used, and the switch that keeps designs in the account.
// The account side (apps/fission src/my-designs.ts, @fission/account designs.ts and sync.ts) does the requests; this
// file is the dialog and its words. Styles: src/styles/my-designs.css.

import { savedWhen } from "./project-list.ts";

/** What the dialog needs of a design in the account (@fission/account DesignRow). */
export interface AccountDesign {
  id: string;
  name: string;
  source: string;
  picture: string | null;
  savedAt: Date;
}

export interface DesignRowWords {
  id: string;
  name: string;
  /** The workspace's name: the tag. */
  tag: string;
  when: string;
  picture: string | null;
  /** The one open in this browser now. */
  open: boolean;
}

/** The workspaces' names as tags ("Slice"); a tag this build doesn't know shows as it is, capitalised. */
const TAGS: Readonly<Record<string, string>> = { design: "Design", render: "Render", simulate: "Simulate", manufacture: "Manufacture", laser: "Laser", slice: "Slice", circuit: "Circuit", vector: "Vector", image: "Image", layout: "Layout" };
export const tagOf = (source: string) => TAGS[source] ?? source.replace(/^./, (c) => c.toUpperCase());

/** The rows, in the order given (the account's: newest first). Pure, so it is tested by hand. */
export function designRows(designs: readonly AccountDesign[], openRemote: string | null, now: Date, date?: (d: Date) => string): DesignRowWords[] {
  return designs.map((d) => {
    const open = d.id === openRemote;
    const saved = savedWhen(d.savedAt, now, date);
    return { id: d.id, name: d.name || "Untitled", tag: tagOf(d.source), when: open ? `${saved} · open now` : saved, picture: d.picture, open };
  });
}

/** Sizes as people read them: whole kB under 1 MB (at least 1 kB for anything), then MB to one decimal place. */
export function sizeWords(bytes: number): string {
  if (bytes <= 0) return "0 kB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(Math.floor((bytes / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`;
}

/** "3 of 200 designs · 1.2 MB of 20 MB used". */
export function spaceWords(used: { designs: number; bytes: number }, limits: { maxDesigns: number; maxBytes: number }): string {
  return `${used.designs} of ${limits.maxDesigns} designs · ${sizeWords(used.bytes)} of ${sizeWords(limits.maxBytes)} used`;
}

export const MY_DESIGNS_TITLE = "My designs";
export const MY_DESIGNS_NOTE = "Kept in your account, so you can open them on any device you sign in on. Every project you work on in this browser is kept here as you save, unless you turn it off.";
export const NO_DESIGNS = "No designs are kept in your account yet. Projects you change in this browser appear here within a few seconds.";
export const KEEPING_OFF_NOTE = "Keeping designs in your account is off. Nothing is sent; the designs already here stay until you delete them.";
export const removeQuestion = (name: string) => `Delete “${name}” from your account? The copy in this browser, if there is one, stays. This can't be undone.`;

export interface MyDesignsParts {
  /** The account's designs, newest first; a refusal (offline, signed out) is said in the dialog. */
  list(): Promise<AccountDesign[]>;
  /** The account's id for the design open in this browser now, if it is kept there. */
  openRemote(): string | null;
  /** Brings design `id` into this browser and opens it; a refusal is said in the dialog, which stays. */
  open(id: string): Promise<void>;
  /** Deletes design `id` from the account. */
  remove(id: string): Promise<void>;
  /** Space used, or null when it can't be read (the line is then left out). */
  space(): Promise<{ designs: number; bytes: number } | null>;
  limits: { maxDesigns: number; maxBytes: number };
  /** Whether keeping designs in the account is on; null when it can't be read. */
  keeping(): Promise<boolean | null>;
  /** Turns keeping designs on or off for this account, on every device; a refusal is said in the dialog. */
  setKeeping(yes: boolean): Promise<void>;
  /** Words about the last sending round ("Your account's space is full…"), or "" when there is nothing to say. */
  syncWords(): string;
  now?: () => Date;
}

export interface MyDesigns {
  show(): Promise<void>;
  close(): void;
  readonly open: boolean;
  readonly element: HTMLDialogElement;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The dialog, appended to `doc`'s body (id `my-designs`). */
export function myDesigns(doc: Document, parts: MyDesignsParts): MyDesigns {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) => Object.assign(doc.createElement(tag), props);
  const dialog = el("dialog", { id: "my-designs", className: "my-designs" });
  dialog.setAttribute("aria-labelledby", "my-designs-title");
  const head = el("div", { className: "my-designs-head" });
  const close = el("button", { type: "button", id: "my-designs-close", className: "my-designs-button", textContent: "Close" });
  head.append(el("h2", { id: "my-designs-title", textContent: MY_DESIGNS_TITLE }), close);
  const note = el("p", { className: "my-designs-note", textContent: MY_DESIGNS_NOTE });
  const keepRow = el("label", { className: "my-designs-keep" });
  const keep = el("input", { type: "checkbox", id: "my-designs-keep", disabled: true });
  keepRow.append(keep, el("span", { textContent: "Keep my designs in my account" }));
  const space = el("p", { id: "my-designs-space", className: "my-designs-space" });
  const status = el("p", { id: "my-designs-status", className: "my-designs-status" });
  status.setAttribute("role", "status");
  const items = el("ul", { id: "my-designs-items", className: "my-designs-items" });
  const body = el("div", { className: "my-designs-body" });
  body.append(note, keepRow, space, status, items);
  dialog.append(head, body);
  doc.body.append(dialog);

  let filling = 0;
  let busy = false;
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };

  async function fill(): Promise<void> {
    const ticket = ++filling;
    const [listed, used, on] = await Promise.all([parts.list().then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e })), parts.space().catch(() => null), parts.keeping().catch(() => null)]);
    if (ticket !== filling) return;
    keep.disabled = on === null;
    keep.checked = on === true;
    space.textContent = used ? spaceWords(used, parts.limits) : "";
    if (!listed.ok) {
      items.replaceChildren();
      return say(`Your designs can't be listed right now. ${message(listed.e)}`, true);
    }
    const rows = designRows(listed.v, parts.openRemote(), (parts.now ?? (() => new Date()))());
    items.replaceChildren(...rows.map(rowFor));
    if (status.classList.contains("bad")) return;
    say(on === false ? KEEPING_OFF_NOTE : rows.length === 0 ? NO_DESIGNS : parts.syncWords(), false);
  }

  function rowFor(row: DesignRowWords): HTMLLIElement {
    const li = el("li", { className: "my-design" });
    li.dataset.id = row.id;
    if (row.open) li.dataset.open = "true";
    const picture = row.picture ? el("img", { className: "my-design-picture", src: row.picture, alt: "" }) : el("span", { className: "my-design-picture my-design-no-picture" });
    if (row.picture) {
      (picture as HTMLImageElement).width = 96;
      (picture as HTMLImageElement).height = 64;
    }
    const words = el("div", { className: "my-design-words" });
    words.append(el("span", { className: "my-design-name", textContent: row.name }), el("span", { className: "my-design-tag", textContent: row.tag }), el("span", { className: "my-design-when", textContent: row.when }));
    const actions = el("div", { className: "my-design-actions" });
    const plain = () => {
      actions.replaceChildren();
      const open = el("button", { type: "button", className: "my-designs-button my-design-open", textContent: "Open", title: `Open “${row.name}” in this browser` });
      const del = el("button", { type: "button", className: "my-designs-button my-design-delete", textContent: "Delete", title: `Delete “${row.name}” from your account (asks first)` });
      open.addEventListener("click", () => void act(() => parts.open(row.id), true));
      del.addEventListener("click", asking);
      if (!row.open) actions.append(open);
      actions.append(del);
    };
    const asking = () => {
      const q = el("span", { className: "my-design-question", textContent: removeQuestion(row.name) });
      const no = el("button", { type: "button", className: "my-designs-button my-design-keep", textContent: "Keep it" });
      const sure = el("button", { type: "button", className: "my-designs-button my-design-delete-sure", textContent: "Delete" });
      no.addEventListener("click", () => (plain(), actions.querySelector<HTMLButtonElement>(".my-design-delete")?.focus()));
      sure.addEventListener("click", () => void act(() => parts.remove(row.id), false));
      actions.replaceChildren(q, no, sure);
      no.focus();
    };
    plain();
    li.append(picture, words, actions);
    return li;
  }

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

  keep.addEventListener("change", () => {
    const want = keep.checked;
    void act(async () => {
      try {
        await parts.setKeeping(want);
      } catch (e) {
        keep.checked = !want;
        throw e;
      }
    }, false);
  });

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
