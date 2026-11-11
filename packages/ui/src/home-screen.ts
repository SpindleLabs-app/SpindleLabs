// The home screen (U6b): what the app can open on, over the project it has open. A "Carry on with …" card for the
// project last worked on, New, Open file and Upload STL, a search by name, the projects kept in this browser with a
// workspace filter, and the guide. It is behind the shell's HOME_SCREEN switch (apps/fission/home.config.mjs), off
// until released. The shell (apps/fission main.ts) does the opening, renaming, deleting and starting; this file is
// the screen, its words, and the pure rules for search, filter and the card (tested by hand in test/home-screen.test.ts).
// Styles: src/styles/home-screen.css.
import { savedWhen } from "./project-list.ts";

/** What the screen needs of a kept project (@fission/storage ProjectSummary). */
export interface HomeProject {
  id: string;
  name: string;
  modified: Date;
  /** When it was last opened or saved. */
  touched?: Date;
  /** The workspaces with work in them. */
  works?: readonly string[];
  /** Set when its summary can't be read (the project may still open). */
  problem?: string;
}

export interface HomeRow {
  id: string;
  name: string;
  when: string;
  works: readonly string[];
  open: boolean;
  problem: boolean;
}

/** The last time a project was used: opened or saved, else its save time. */
export const usedAt = (p: HomeProject): Date => p.touched ?? p.modified;

/** The rows, most recently used first (ties keep the store's order). Pure. */
export function homeRows(kept: readonly HomeProject[], openId: string | null, now: Date): HomeRow[] {
  const at = (p: HomeProject) => (Number.isNaN(usedAt(p).getTime()) ? 0 : usedAt(p).getTime());
  return kept
    .map((p, i) => ({ p, i }))
    .sort((a, b) => at(b.p) - at(a.p) || a.i - b.i)
    .map(({ p }) => {
      const problem = p.problem !== undefined;
      const when = problem ? "Its details can't be read; it may still open" : savedWhen(usedAt(p), now).replace(/^Saved/, "Last used");
      return { id: p.id, name: problem ? "A project whose name can't be read" : p.name || "Untitled", when, works: problem ? [] : [...(p.works ?? [])], open: p.id === openId, problem };
    });
}

/**
 * The rows whose name holds `query` (case-insensitive, trimmed; empty means all) and, when `workspace` is set, that
 * have work in it. A project whose details can't be read matches no search (its name is unknown) but shows in the filter-free list.
 */
export function filterRows(rows: readonly HomeRow[], query: string, workspace: string | null): HomeRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (q === "" || (!r.problem && r.name.toLowerCase().includes(q))) && (workspace === null || r.works.includes(workspace)));
}

/** The workspaces any row has work in, in first-seen order: the filter's choices. */
export const workspacesIn = (rows: readonly HomeRow[]): string[] => [...new Set(rows.flatMap((r) => r.works))];

/** The project the card offers: the most recently used one that can be read (rows come most recent first). */
export const carryOnRow = (rows: readonly HomeRow[]): HomeRow | null => rows.find((r) => !r.problem) ?? null;

export const HOME_NO_PROJECTS = "Nothing is kept in this browser yet. Start a new project, or open a file.";
export const HOME_NO_MATCH = "No project matches. Clear the search or the workspace filter.";
export const MAX_NAME = 100;

export interface HomeParts {
  list(): Promise<HomeProject[]>;
  openId(): string | null;
  open(id: string, modified: Date | null): Promise<void>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  newProject(): Promise<void> | void;
  /** Clicks the shell's file chooser (the Open button's). */
  chooseFile(): void;
  showGuide(): void;
  workspaceTitle(id: string): string;
  now?: () => Date;
}

export interface HomeScreen {
  show(): Promise<void>;
  hide(): void;
  readonly shown: boolean;
  readonly element: HTMLElement;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The screen, appended to `doc`'s body (id `home`), hidden until `show`. */
export function homeScreen(doc: Document, parts: HomeParts): HomeScreen {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}): HTMLElementTagNameMap[K] => Object.assign(doc.createElement(tag), props);
  const root = el("section", { id: "home", className: "home-screen", hidden: true });
  root.setAttribute("aria-labelledby", "home-title");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  const title = el("h1", { id: "home-title", className: "home-title", textContent: "SpindleLabs" });
  const card = el("div", { id: "home-card", className: "home-card" });
  const actions = el("div", { className: "home-actions" });
  const button = (id: string, text: string, run: () => void, extra = "") => {
    const b = el("button", { type: "button", id, className: `home-button ${extra}`.trim(), textContent: text });
    b.addEventListener("click", run);
    return b;
  };
  const search = el("input", { id: "home-search", className: "home-search", type: "search", placeholder: "Search by name", maxLength: 100 });
  search.setAttribute("aria-label", "Search projects by name");
  const filter = el("select", { id: "home-filter", className: "home-filter" });
  filter.setAttribute("aria-label", "Show projects with work in");
  const status = el("p", { id: "home-status", className: "home-status" });
  status.setAttribute("role", "status"); // read out as it changes
  status.setAttribute("role", "status");
  const items = el("ul", { id: "home-items", className: "home-items" });
  const find = el("div", { className: "home-find" });
  find.append(search, filter);
  const links = el("p", { className: "home-links" });
  links.append(button("home-guide", "How SpindleLabs works (the guide)", () => (hide(), parts.showGuide()), "home-link"));
  const close = button("home-close", "Back to my project", () => hide(), "home-close");
  root.append(el("div", { className: "home-head" }), title, card, actions, find, status, items, links);
  root.querySelector(".home-head")!.append(close);
  doc.body.append(root);

  let rows: HomeRow[] = [];
  let kept: HomeProject[] = [];
  let ticket = 0;
  let busy = false;
  const say = (words: string, bad = false) => {
    status.textContent = words;
    status.classList.toggle("bad", bad);
  };
  const chips = (r: HomeRow) => {
    const s = el("span", { className: "home-row-works" });
    s.append(...r.works.map((w) => el("span", { className: "home-chip", textContent: parts.workspaceTitle(w) })));
    return s;
  };

  function paintCard() {
    const r = carryOnRow(rows);
    card.replaceChildren();
    card.hidden = r === null;
    if (r === null) return;
    const go = button("home-carry-on", r.open ? "Carry on" : "Open and carry on", () => void act(() => (r.open ? Promise.resolve() : parts.open(r.id, modifiedOf(r.id))), true), "home-primary");
    const words = el("div", { className: "home-card-words" });
    words.append(el("span", { className: "home-card-label", textContent: "Carry on with" }), el("strong", { className: "home-card-name", textContent: r.name }), el("span", { className: "home-row-when", textContent: r.when }), chips(r));
    card.append(words, go);
  }
  const modifiedOf = (id: string) => kept.find((p) => p.id === id)?.modified ?? null;

  function paintList() {
    const shown = filterRows(rows, search.value, filter.value === "" ? null : filter.value);
    items.replaceChildren(...shown.map(rowFor));
    if (!status.classList.contains("bad")) say(rows.length === 0 ? HOME_NO_PROJECTS : shown.length === 0 ? HOME_NO_MATCH : "");
  }

  function paintFilter() {
    const chosen = filter.value;
    const ids = workspacesIn(rows);
    filter.replaceChildren(el("option", { value: "", textContent: "All workspaces" }), ...ids.map((id) => el("option", { value: id, textContent: parts.workspaceTitle(id) })));
    filter.value = ids.includes(chosen) ? chosen : "";
    filter.hidden = ids.length === 0;
  }

  async function fill(): Promise<void> {
    const mine = ++ticket;
    let list: HomeProject[];
    try {
      list = await parts.list();
    } catch (e) {
      if (mine !== ticket) return;
      rows = [];
      kept = [];
      paintCard();
      paintFilter();
      items.replaceChildren();
      return say(`The projects in this browser can't be listed (${message(e)}). Open file still works.`, true);
    }
    if (mine !== ticket) return;
    kept = list;
    rows = homeRows(list, parts.openId(), (parts.now ?? (() => new Date()))());
    paintCard();
    paintFilter();
    paintList();
  }

  function rowFor(r: HomeRow): HTMLLIElement {
    const li = el("li", { className: "home-row" });
    li.dataset.id = r.id;
    if (r.open) li.dataset.open = "true";
    const words = el("div", { className: "home-row-words" });
    words.append(el("span", { className: "home-row-name", textContent: r.name }), el("span", { className: "home-row-when", textContent: r.open ? `${r.when} · open now` : r.when }), chips(r));
    const acts = el("div", { className: "home-row-actions" });
    const plain = () => {
      acts.replaceChildren();
      const open = button("", r.open ? "Carry on" : "Open", () => void act(() => (r.open ? Promise.resolve() : parts.open(r.id, r.problem ? null : modifiedOf(r.id))), true), "home-small home-open");
      open.removeAttribute("id");
      acts.append(open);
      if (r.open || r.problem) return; // the open project is renamed and kept by the app itself; one unreadable can't be renamed
      const ren = button("", "Rename", renaming, "home-small home-rename");
      const del = button("", "Delete", asking, "home-small home-delete");
      for (const b of [ren, del]) b.removeAttribute("id");
      ren.title = `Rename “${r.name}”`;
      del.title = `Delete “${r.name}” from this browser (asks first)`;
      acts.append(ren, del);
    };
    const renaming = () => {
      const box = el("input", { className: "home-rename-box", type: "text", value: r.name, maxLength: MAX_NAME });
      box.setAttribute("aria-label", `New name for ${r.name}`);
      const ok = button("", "Save name", () => void act(() => parts.rename(r.id, box.value), false), "home-small home-rename-ok");
      const no = button("", "Cancel", () => (plain(), acts.querySelector<HTMLButtonElement>(".home-rename")?.focus()), "home-small home-rename-cancel");
      ok.removeAttribute("id");
      no.removeAttribute("id");
      box.addEventListener("keydown", (e) => {
        if (e.key === "Enter") ok.click();
        if (e.key === "Escape") (e.stopPropagation(), no.click());
      });
      acts.replaceChildren(box, ok, no);
      box.focus();
      box.select();
    };
    const asking = () => {
      const q = el("span", { className: "home-row-question", textContent: `Delete “${r.name}” from this browser? This can't be undone.` });
      const keep = button("", "Keep it", () => (plain(), acts.querySelector<HTMLButtonElement>(".home-delete")?.focus()), "home-small home-keep");
      const sure = button("", "Delete", () => void act(() => parts.remove(r.id), false), "home-small home-delete-sure");
      keep.removeAttribute("id");
      sure.removeAttribute("id");
      acts.replaceChildren(q, keep, sure);
      keep.focus();
    };
    plain();
    li.append(words, acts);
    return li;
  }

  /** One action at a time; an Open (or carrying on) closes the screen, a rename or delete fills the list again. */
  async function act(run: () => Promise<void> | void, closes: boolean) {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    say("");
    try {
      await run();
      if (closes) hide();
      else await fill();
    } catch (e) {
      await fill();
      say(message(e).replace(/^./, (c) => c.toUpperCase()), true); // after the list is read again, which would clear it
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
  }

  actions.append(
    button("home-new", "New project", () => void act(() => parts.newProject(), true), "home-primary"),
    button("home-open-file", "Open file…", () => (hide(), parts.chooseFile())),
    button("home-upload-stl", "Upload STL…", () => (hide(), parts.chooseFile())),
  );
  search.addEventListener("input", () => paintList());
  filter.addEventListener("change", () => paintList());
  // The app's shortcuts listen on the document: keys typed here stay here. Escape goes back to the project.
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
    }
    e.stopPropagation();
  });

  /** What this screen made inert while it is up (the page behind it: Tab and screen readers stay on the screen). */
  let inerted: Element[] = [];
  const release = () => {
    for (const e of inerted) e.removeAttribute("inert");
    inerted = [];
  };
  function hide() {
    ticket++; // a list still being read is not put in a hidden screen
    root.hidden = true;
    release();
  }
  return {
    async show() {
      say("");
      release(); // shown again while up: take only what is there now
      inerted = [...doc.body.children].filter((e) => e !== root && !e.hasAttribute("inert"));
      for (const e of inerted) e.setAttribute("inert", "");
      root.hidden = false;
      search.value = "";
      (root.querySelector<HTMLButtonElement>("#home-carry-on") ?? root.querySelector<HTMLButtonElement>("#home-new"))?.focus();
      await fill();
      (root.querySelector<HTMLButtonElement>("#home-carry-on") ?? root.querySelector<HTMLButtonElement>("#home-new"))?.focus();
    },
    hide,
    get shown() {
      return !root.hidden;
    },
    element: root,
  };
}
