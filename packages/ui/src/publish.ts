// The public library's dialogs (community C3c; behind the ?share switch until the legal check): File ▾ > Publish to the
// library… puts a copy of the open design in the library with a title, description, licence, tags and a picture; My
// library (from the account dialog) lists the person's published designs with Take down, asking first. The requests are
// the account side's (apps/fission src/library.ts, @fission/account library.ts); this file is the two dialogs and their
// words. Built on the sharing dialogs' card and look (share.ts, styles/share.css); its own bits in styles/publish.css.
// Every word about terms here is a PLACEHOLDER until a lawyer has checked it.

import { savedWhen } from "./project-list.ts";
import type { Dialog } from "./share.ts";
import { shareCard } from "./share.ts";

export const PUBLISH_TITLE = "Publish to the library";
export const PUBLISH_NOTE = "Publishing puts a copy of this design, as it is now, in the public library. Anyone can find it without an account, and anyone signed in can download their own copy. Your display name is shown with it, never your account or email. Later changes you make are not in it. You can take it down at any time.";
/** PLACEHOLDER words until a lawyer has checked the library's terms. */
export const PUBLISH_TERMS_PLACEHOLDER = "Placeholder terms, not yet checked by a lawyer: only publish designs that are yours or that you may share under the licence you pick. Designs can be reported and taken down.";
export const SIGN_IN_TO_PUBLISH = "Sign in to publish a design to the library. Browsing it doesn't need an account.";
export const PUBLISHED_WORDS = "Published. It's in the library now, under the licence you picked. My library (under your account) lists it, with Take down.";
export const TAGS_HINT = "Up to 8, separated by commas or spaces: lowercase letters, digits and dashes.";

export const MY_LIBRARY_TITLE = "My library";
export const MY_LIBRARY_NOTE = "The designs you have published. Take one down and nobody can find or download it again.";
export const NO_ENTRIES = "You haven't published any designs yet. File > Publish to the library… puts one in.";
export const takeDownQuestion = (title: string) => `Take “${title}” out of the library? Nobody can find or download it again, and its file is deleted. This can't be undone.`;

/** A licence as the dialog offers it. */
export interface LicenceChoice {
  readonly id: string;
  readonly name: string;
  readonly says: string;
}

/** What the person filled in. */
export interface PublishForm {
  readonly title: string;
  readonly description: string;
  readonly licence: string;
  readonly tags: readonly string[];
  readonly picture: string | null;
}

export interface PublishParts {
  /** The name of the design open now (the title to start from). */
  name(): string;
  /** A small picture of what is on screen as a data: address, or null; taken once when the dialog opens. */
  picture(): string | null;
  /** The licences, the default first. */
  readonly licences: readonly LicenceChoice[];
  /** What the library would refuse in the form, in words, or null when it is fine. Asks nothing. */
  problem(form: PublishForm): string | null;
  /** Publishes the open design with the form; throws the words to say when it can't. */
  publish(form: PublishForm): Promise<void>;
}

/** The tags as typed ("Desk, cable  clip") as the library keeps them: lowercase, split on commas and spaces, no blanks. */
export function tagsFrom(typed: string): string[] {
  return typed
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t !== "");
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const capital = (s: string) => s.replace(/^./, (ch) => ch.toUpperCase());

/** The Publish dialog (id `publish`). */
export function publishDialog(doc: Document, parts: PublishParts): Dialog {
  const c = shareCard(doc, "publish", PUBLISH_TITLE);
  c.dialog.classList.add("publish");
  const { el } = c;
  const label = (forId: string, words: string) => {
    const l = el("label", { className: "publish-label", textContent: words });
    l.htmlFor = forId;
    return l;
  };
  const note = el("p", { className: "share-note", textContent: PUBLISH_NOTE });
  const picture = el("img", { id: "publish-picture", className: "share-picture", alt: "" });
  Object.assign(picture, { width: 192, height: 128 });
  const title = el("input", { type: "text", id: "publish-name", className: "share-field", autocomplete: "off" });
  const description = el("textarea", { id: "publish-description", className: "share-field", rows: 3, placeholder: "What it is, how to print or use it (optional)" });
  const licence = el("select", { id: "publish-licence", className: "share-field dark-select" });
  licence.append(...parts.licences.map((l) => Object.assign(el("option"), { value: l.id, textContent: l.name })));
  const says = el("p", { id: "publish-licence-says", className: "share-note" });
  const tags = el("input", { type: "text", id: "publish-tags", className: "share-field", autocomplete: "off", placeholder: "desk, clip" });
  const hint = el("p", { className: "share-note", textContent: TAGS_HINT });
  const problem = el("p", { id: "publish-problem", className: "share-status bad" });
  const terms = el("p", { className: "share-note share-terms", id: "publish-terms", textContent: PUBLISH_TERMS_PLACEHOLDER });
  const go = el("button", { type: "button", id: "publish-go", className: "share-button share-primary", textContent: "Publish" });
  const status = el("p", { id: "publish-status", className: "share-status" });
  status.setAttribute("role", "status");
  const form = el("div", { id: "publish-form", className: "publish-form" });
  form.append(picture, label("publish-name", "Title"), title, label("publish-description", "Description"), description, label("publish-licence", "Licence"), licence, says, label("publish-tags", "Tags"), tags, hint, problem, terms, go);
  c.body.append(note, form, status);

  let shot: string | null = null;
  let busy = false;
  const read = (): PublishForm => ({ title: title.value, description: description.value, licence: licence.value, tags: tagsFrom(tags.value), picture: shot });
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };
  /** The licence's sentence, and the first thing wrong (Publish is off while there is one). */
  const check = () => {
    says.textContent = parts.licences.find((l) => l.id === licence.value)?.says ?? "";
    const wrong = parts.problem(read());
    problem.textContent = wrong ?? "";
    go.disabled = wrong !== null || busy;
  };
  for (const field of [title, description, tags]) field.addEventListener("input", check);
  licence.addEventListener("change", check);
  go.addEventListener("click", async () => {
    if (busy || parts.problem(read()) !== null) return;
    busy = true;
    go.disabled = true;
    c.dialog.setAttribute("aria-busy", "true");
    say("Publishing…");
    try {
      await parts.publish(read());
      form.hidden = true;
      say(PUBLISHED_WORDS);
    } catch (e) {
      say(capital(message(e)), true);
    } finally {
      busy = false;
      c.dialog.removeAttribute("aria-busy");
      check();
    }
  });

  return {
    async show() {
      shot = parts.picture();
      picture.hidden = shot === null;
      if (shot) picture.src = shot;
      else picture.removeAttribute("src");
      title.value = parts.name().trim().slice(0, 100);
      description.value = "";
      tags.value = "";
      licence.value = parts.licences[0]?.id ?? "";
      form.hidden = false;
      say("");
      check();
      c.open();
      title.focus();
    },
    close: c.finish,
    get open() {
      return c.dialog.open;
    },
    element: c.dialog,
  };
}

/** One of the person's published designs, as My library shows it. */
export interface LibraryRow {
  readonly id: string;
  readonly title: string;
  readonly picture: string | null;
  /** live: in the library; removed: taken down after a report; waiting: still being published (or never finished). */
  readonly state: "live" | "removed" | "waiting";
  /** When it was published (or started, while waiting). */
  readonly at: Date;
}

export interface MyLibraryParts {
  /** The person's designs; throws the words to say when it can't. */
  list(): Promise<LibraryRow[]>;
  /** Takes one down and deletes its file; throws the words to say when it can't. */
  takeDown(id: string): Promise<void>;
  now?: () => Date;
}

/** The words under a design's title in My library. */
export function rowWhen(row: LibraryRow, now: Date): string {
  const when = savedWhen(row.at, now).replace(/^Saved /, "");
  if (row.state === "removed") return `Taken down after a report · ${when}`;
  if (row.state === "waiting") return `Not finished publishing · ${when}`;
  return `In the library · published ${when === "just now" || when.endsWith(" ago") ? when : `on ${when}`}`;
}

/** The My library dialog (id `my-library`). */
export function myLibraryDialog(doc: Document, parts: MyLibraryParts): Dialog {
  const c = shareCard(doc, "my-library", MY_LIBRARY_TITLE);
  c.dialog.classList.add("publish");
  const { el } = c;
  const note = el("p", { className: "share-note", textContent: MY_LIBRARY_NOTE });
  const status = el("p", { id: "my-library-status", className: "share-status" });
  status.setAttribute("role", "status");
  const items = el("ul", { id: "my-library-items", className: "share-items" });
  c.body.append(note, status, items);
  let busy = false;
  let filling = 0;
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };

  async function fill(): Promise<void> {
    const ticket = ++filling;
    let rows: LibraryRow[];
    try {
      rows = await parts.list();
    } catch (e) {
      if (ticket === filling) say(`Your designs can't be listed right now. ${message(e)}`, true);
      return;
    }
    if (ticket !== filling) return;
    items.replaceChildren(...rows.map(rowFor));
    if (!status.classList.contains("bad")) say(rows.length === 0 ? NO_ENTRIES : "");
  }

  function rowFor(row: LibraryRow): HTMLLIElement {
    const li = el("li", { className: "share-item" });
    li.dataset.id = row.id;
    if (row.picture) li.append(Object.assign(el("img", { className: "publish-thumb", src: row.picture, alt: "" }), { width: 48, height: 32 }));
    const words = el("div", { className: "share-item-words" });
    words.append(el("span", { className: "share-item-name", textContent: row.title }), el("span", { className: "share-item-when", textContent: rowWhen(row, (parts.now ?? (() => new Date()))()) }));
    const actions = el("div", { className: "share-item-actions" });
    const plain = () => {
      const down = el("button", { type: "button", className: "share-button publish-take-down", textContent: "Take down", title: `Take “${row.title}” out of the library (asks first)` });
      down.addEventListener("click", asking);
      actions.replaceChildren(down);
    };
    const asking = () => {
      const q = el("span", { className: "share-item-question", textContent: takeDownQuestion(row.title) });
      const keep = el("button", { type: "button", className: "share-button publish-keep", textContent: "Keep it" });
      const sure = el("button", { type: "button", className: "share-button share-item-off-sure publish-take-down-sure", textContent: "Take down" });
      keep.addEventListener("click", () => (plain(), actions.querySelector<HTMLButtonElement>(".publish-take-down")?.focus()));
      sure.addEventListener("click", () => void act(() => parts.takeDown(row.id)));
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
      say(capital(message(e)), true);
    } finally {
      busy = false;
      c.dialog.removeAttribute("aria-busy");
    }
    await fill();
  }

  return {
    async show() {
      say("");
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
