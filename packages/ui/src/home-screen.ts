// The home screen (U6b): what the app can open on, over the project it has open. A "Carry on with …" card for the
// project last worked on, New and Open file (no Upload STL until STL files can really be opened), a search by name, the projects kept in this browser with a
// workspace filter, and the guide. It is behind the shell's HOME_SCREEN switch (apps/fission/home.config.mjs), off
// until released. The shell (apps/fission main.ts) does the opening, renaming, deleting and starting; this file is
// the screen, its words, and the pure rules for search, filter and the card (tested by hand in test/home-screen.test.ts).
// Styles: src/styles/home-screen.css.
import { savedWhen } from "./project-list.ts";
import { homeBackdrop, motionChoiceOf, type MotionChoice, type Surface } from "./home-backdrop.ts";
import { iconSvg, type IconName } from "./icons.ts";

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
  /**
   * The open project's edges as pairs of x y z points, for the turning picture behind the screen. Asked about once a second
   * while the screen is up, only when the "Carry on with" project is the open one (the others are not loaded). Null: a
   * neutral shape.
   */
  outline?(): ArrayLike<number> | null;
  /** The open project's triangles, for painting the picture solid (asked with `outline`). Null or left out: lines only. */
  surface?(): Surface | null;
  /**
   * Settles once the open project is shown (built and drawn, or found to have no body): the picture waits for it, at most
   * SHAPE_WAIT_MS, so it never shows the simple parts and then jumps to the design. Left out: no wait.
   */
  shown?(): Promise<void>;
  /**
   * Where the picture's motion choice is kept (the browser's settings, shared with Settings > General): read each time the
   * screen shows, written on Pause, Play and the suggested gentle motion. Left out: it follows the computer each time.
   */
  motion?: { read(): unknown; keep(choice: MotionChoice): void };
  now?: () => Date;
}

/** The longest the picture waits for the open project before it shows the simple parts (the design follows when it comes). */
export const SHAPE_WAIT_MS = 4000;

/** The fold icon's names (for screen readers and its tooltip): folding the screen away, and bringing it back. */
export const FOLD_WORDS = { fold: "Fold the screen away to watch the background", unfold: "Bring the screen back" } as const;

export interface HomeScreen {
  show(): Promise<void>;
  hide(): void;
  readonly shown: boolean;
  readonly element: HTMLElement;
  /**
   * For browser checks only (the shell's `?test-hooks`): turns these edges behind the screen in place of the open
   * project's, for a design the app can't open yet (an STL); null goes back to the project's.
   */
  showStandIn(lines: ArrayLike<number> | null, surface?: Surface | null): void;
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
  const links = el("div", { className: "home-links" });
  /** Shows icon `icon` alone on `b`, `name` its name for screen readers and its tooltip. */
  const setIcon = (b: HTMLButtonElement, icon: IconName, name: string) => {
    if (b.dataset.icon === icon && b.getAttribute("aria-label") === name) return;
    b.replaceChildren(iconSvg(doc, icon, 20));
    b.dataset.icon = icon;
    b.setAttribute("aria-label", name);
    b.title = name;
  };
  const iconButton = (id: string, icon: IconName, name: string, run: () => void) => {
    const b = button(id, "", run, "home-icon");
    setIcon(b, icon, name);
    return b;
  };
  // Small icons under the list (Ben, 2026-11-16: smaller): the guide as a book, and the picture's Pause or Play beside it
  // (WCAG 2.2.2: anything moving for more than 5 seconds can be paused). Full and gentle motion are Settings' choices; gentle
  // motion is suggested here only where drawing the picture has been too slow.
  const guide = iconButton("home-guide", "guide", "How SpindleLabs works (the guide)", () => (hide(), parts.showGuide()));
  const motionButton = iconButton("home-motion", "pause", "Pause the background", () => pressMotion());
  const tip = el("span", { id: "home-motion-tip", className: "home-motion-tip" });
  tip.setAttribute("role", "status");
  tip.append(
    el("span", { textContent: "The background is slowing this computer down." }),
    button("home-gentle", "Use gentle motion", () => useGentle(), "home-link"),
    button("home-gentle-no", "Not now", () => ((tipDismissed = true), paintMotion()), "home-link"),
  );
  // Fold (Ben, 2026-11-16: "a little fold button for the UI next to the pause and book so if you want you can observe the
  // background"): everything but the picture and the icons fades away, the icons staying where they were; the same icon,
  // Escape or a press anywhere else brings it back.
  const foldButton = iconButton("home-fold", "fold", FOLD_WORDS.fold, () => setFolded(!folded));
  motionButton.hidden = foldButton.hidden = tip.hidden = true;
  links.append(guide, motionButton, foldButton, tip);
  const close = button("home-close", "Back to my project", () => hide(), "home-close");
  const backdropCanvas = el("canvas", { className: "home-backdrop" });
  backdropCanvas.setAttribute("aria-hidden", "true");
  const scrim = el("div", { className: "home-scrim" });
  scrim.setAttribute("aria-hidden", "true");
  const win = doc.defaultView as Window & typeof globalThis;
  /** The screen folded away, the picture alone with the icons. */
  let folded = false;
  // It waits (draws nothing) until the list is painted and the design is here, then fades in already in place. Folded, the
  // whole window is its room, so the design glides to the middle.
  const backdrop = homeBackdrop(backdropCanvas, { win, doc, room: () => (folded ? 0 : links.getBoundingClientRect().bottom), waits: true, changed: () => paintMotion() });
  function setFolded(next: boolean) {
    if (next === folded) return;
    folded = next;
    root.classList.toggle("home-folded", folded);
    setIcon(foldButton, folded ? "unfold" : "fold", folded ? FOLD_WORDS.unfold : FOLD_WORDS.fold);
    backdrop.redraw(); // a still picture is drawn again in its new room (a moving one glides there)
  }
  /** The motion it had before it was paused, so Play brings that back. */
  let beforePause: MotionChoice = "system";
  /** Not now was pressed on the gentle motion suggestion (until the page closes). */
  let tipDismissed = false;
  /** The controls follow the picture: shown once it is (never while it waits or where it can't be drawn), saying what a press does. */
  function paintMotion() {
    const up = backdropCanvas.dataset.ready === "yes" && backdrop.mode !== "off";
    const moving = backdrop.mode === "live";
    motionButton.hidden = foldButton.hidden = !up;
    if (!up) setFolded(false); // nothing to watch
    setIcon(motionButton, moving ? "pause" : "play", moving ? "Pause the background" : "Play the background");
    // Gentle motion is suggested only where drawing the picture has been too slow, and never when it is already what
    // the person wants (chosen, or asked for by the computer) or paused.
    const gentleWanted = backdrop.choice === "gentle" || (backdrop.choice === "system" && backdrop.lessMotion);
    tip.hidden = !(up && backdrop.slowed && !tipDismissed && !gentleWanted && backdrop.choice !== "still");
  }
  const keep = () => {
    try {
      parts.motion?.keep(backdrop.choice);
    } catch {
      // not kept (storage refused): it still holds until the page closes
    }
  };
  function pressMotion() {
    if (backdrop.mode === "live") {
      beforePause = backdrop.choice === "still" ? beforePause : backdrop.choice;
      backdrop.choose("still");
    } else {
      // Moving again as it moved before; following the computer, as it asks (and kept moving, even where it was too slow).
      backdrop.choose(beforePause === "full" || beforePause === "gentle" ? beforePause : backdrop.lessMotion ? "gentle" : "full");
    }
    keep();
  }
  /** The suggestion taken: gentle motion, lighter to draw, kept moving however slow (and kept as the choice). */
  function useGentle() {
    backdrop.choose("gentle");
    keep();
  }
  root.append(backdropCanvas, scrim, el("div", { className: "home-head" }), title, card, actions, find, status, items, links);
  root.querySelector(".home-head")!.append(close);
  doc.body.append(root);

  let rows: HomeRow[] = [];
  /** Edges (and triangles) a browser check shows in place of the open project's (`showStandIn`), else null. */
  let standIn: ArrayLike<number> | null = null;
  let standInFaces: Surface | null = null;
  /** Whether the card's project is the open one, whose body the picture shows. */
  const carryingOpen = () => {
    const carry = carryOnRow(rows);
    return carry !== null && carry.id === parts.openId();
  };
  /** The turning picture: the open project's body when it is the one to carry on with (asked again as it reopens). */
  const picture = () => standIn ?? (carryingOpen() ? (parts.outline?.() ?? null) : null);
  const pictureFaces = () => (standIn ? standInFaces : carryingOpen() ? (parts.surface?.() ?? null) : null);
  /** Shows the picture once the list is painted and the open project's body is here (or has not come in SHAPE_WAIT_MS). */
  async function reveal(mine: number) {
    if (standIn === null && carryingOpen() && parts.shown) {
      let wait = 0;
      await Promise.race([parts.shown().catch(() => {}), new Promise<void>((done) => (wait = win.setTimeout(done, SHAPE_WAIT_MS)))]);
      win.clearTimeout(wait);
    }
    if (mine !== ticket) return; // hidden, or filled again since
    backdrop.setSource(picture, pictureFaces);
    backdrop.reveal();
  }
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
    backdrop.redraw();
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
      say(`The projects in this browser can't be listed (${message(e)}). Open file still works.`, true);
      void reveal(mine);
      return;
    }
    if (mine !== ticket) return;
    kept = list;
    rows = homeRows(list, parts.openId(), (parts.now ?? (() => new Date()))());
    paintCard();
    paintFilter();
    paintList();
    void reveal(mine); // not waited for: the screen is ready to use at once
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
  );
  root.addEventListener("scroll", () => backdrop.redraw(), { passive: true });
  search.addEventListener("input", () => paintList());
  filter.addEventListener("change", () => paintList());
  // The app's shortcuts listen on the document: keys typed here stay here. Escape goes back to the project.
  const keyHere = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (folded) unfold();
      else hide();
    }
    e.stopPropagation();
  };
  root.addEventListener("keydown", keyHere);
  // A press on the picture or an empty part of the screen leaves the focus on the page's body, so the next key is aimed
  // outside the screen and would reach the design behind it (Ctrl+Z undoing a step unseen, Delete deleting a body). While
  // the screen is up, a key aimed at the body or at the inert page is heard first, on the window, and kept here too.
  const view = doc.defaultView;
  view?.addEventListener(
    "keydown",
    (e) => {
      if (root.hidden) return;
      const t = e.target as Element | null;
      if (t && root.contains(t)) return; // heard by the screen itself
      const behind = !t || t === doc.body || t === doc.documentElement || (t as Node) === doc || !!t.closest?.("[inert]");
      if (behind) keyHere(e);
    },
    { capture: true },
  );
  /** Back from folded, the focus on the icon that folds it again (a press on the picture leaves it nowhere). */
  const unfold = () => (setFolded(false), foldButton.focus());
  // Folded, a press anywhere but on a button brings the screen back (the picture itself takes no press: it lands here).
  // Heard on its way down, before any button acts: a press on an icon's drawing swaps that drawing out of its button.
  root.addEventListener(
    "click",
    (e) => {
      if (folded && !(e.target as Element | null)?.closest?.("button")) unfold();
    },
    { capture: true },
  );

  /** What this screen made inert while it is up (the page behind it: Tab and screen readers stay on the screen). */
  let inerted: Element[] = [];
  const release = () => {
    for (const e of inerted) e.removeAttribute("inert");
    inerted = [];
  };
  function hide() {
    ticket++; // a list still being read is not put in a hidden screen
    setFolded(false); // it opens unfolded next time
    root.hidden = true;
    backdrop.stop();
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
      let stored: unknown = null;
      try {
        stored = parts.motion?.read();
      } catch {
        // can't be read: it follows the computer
      }
      backdrop.choose(motionChoiceOf(stored)); // chosen in Settings, or by a press here last time
      beforePause = "system";
      backdrop.start();
      (root.querySelector<HTMLButtonElement>("#home-carry-on") ?? root.querySelector<HTMLButtonElement>("#home-new"))?.focus();
      await fill();
      (root.querySelector<HTMLButtonElement>("#home-carry-on") ?? root.querySelector<HTMLButtonElement>("#home-new"))?.focus();
    },
    hide,
    showStandIn(lines, surface = null) {
      standIn = lines;
      standInFaces = lines ? surface : null;
      backdrop.setSource(picture, pictureFaces);
    },
    get shown() {
      return !root.hidden;
    },
    element: root,
  };
}
