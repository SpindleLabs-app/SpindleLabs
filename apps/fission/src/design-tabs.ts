// The shell's side of the design tabs (@fission/ui design-tabs.ts): which projects are open as tabs, kept for the next
// visit, and what a click, a "+" or a "×" does. The tabs are kept projects (each autosaves as before); switching opens
// the project through the shell's `open` (the old one is finished, i.e. kept as it is), so nothing of a tab is lost by
// leaving it. Only the project on screen can have unsaved changes, so only closing it can ask. A tab is the project's
// name and the workspace it was last showing (a slicer job reads SLICE, a design DESIGN).

import { activateTab, addTab, confirmClose, designTabs, NO_TABS, removeTab, restoredTabs, storedTabs, tabName, updateTab, type DesignTab, type DesignTabsStrip, type TabsState } from "@fission/ui";
import { STEPS_CHAR_LIMIT } from "@fission/storage";
import type { SavedHistory } from "@fission/core";

/** Where the open tabs are kept for the next visit. */
export const TABS_KEY = "spindlelabs.tabs";

/**
 * Most characters of undo snapshots held in memory for the tabs not on screen, all together (tabs hunt D2): the same
 * budget step 89 keeps for one project in storage. Past it the tab left longest ago loses its view, which costs little:
 * its steps come back from storage as after a reload, only its selection and camera start afresh.
 */
export const VIEWS_CHAR_BUDGET = STEPS_CHAR_LIMIT;

/** What a tab keeps in memory while it is not on screen: its undo steps, and whatever else the shell takes with them. */
export interface TabView {
  history?: SavedHistory;
  [more: string]: unknown;
}

/** The characters of a view's undo snapshots (snapshots of one history share text, so this is the most it can hold). */
export const viewChars = (view: TabView): number => (view.history?.kept ?? []).reduce((n, step) => n + step.snapshot.length, 0);

/**
 * Drops from `views` (in the order the tabs were left, oldest first) every view whose tab is not in `tabs`, then the
 * oldest until the rest hold at most `budget` characters (tabs hunt C6, D1: a tab pushed off the strip kept its whole
 * history for the visit; D2: twelve big designs had no limit at all).
 */
export function trimViews(views: Map<string, TabView>, tabs: Iterable<string>, budget = VIEWS_CHAR_BUDGET): void {
  const keep = new Set(tabs);
  for (const key of [...views.keys()]) if (!keep.has(key)) views.delete(key);
  let total = 0;
  for (const view of views.values()) total += viewChars(view);
  for (const [key, view] of views) {
    if (total <= budget) break;
    views.delete(key);
    total -= viewChars(view);
  }
}

/** The project of a tab is no longer kept in this browser (deleted here or in another window): `open` rejects with it. */
export class ProjectGone extends Error {
  constructor(id: string) {
    super(`there is no project "${id}" kept in this browser`);
    this.name = "ProjectGone";
  }
}

export interface ShellTabsParts {
  /** The tab strip goes after this element (the top bar). */
  after: HTMLElement;
  /** The phone's count button goes in the top bar just before this element (Menu); at the bar's end without it (tabs T3a). */
  countBefore?: Element | null;
  /** The kept id of the project on screen; null while a new one waits for its first change. */
  keptId(): string | null;
  projectName(): string;
  /** The page on screen (a workspace id, or another page's name). */
  workspace(): string;
  titles(): Record<string, string>;
  /** Opens kept project `id` in place of the one on screen. Rejects, changing nothing, when it can't be read; with ProjectGone when it is not kept here any more. */
  open(id: string): Promise<void>;
  /** Starts a new, empty project in place of the one on screen. */
  start(): Promise<void>;
  /** Settles once work still being finished on the project on screen (an OK the kernel still checks) has landed. */
  idle(): Promise<void>;
  /** Shows workspace `id` next (the tab remembered it) when the next project lands. */
  preselect(id: string): void;
  /** True while the project on screen has changes not stored yet. */
  unsaved(): boolean;
  /** Says why something failed (the top bar's message line). */
  report(message: string): void;
  /** The projects kept in this browser, with their names as kept (null: unreadable); a tab takes its name from here after a reload (tabs hunt C5). */
  kept(): Promise<{ id: string; name: string | null }[]>;
  /** True when project `id` is kept only in the journal (storage was full): it opens, so its tab stays. */
  held(id: string): boolean;
  /** What a tab keeps while it is not on screen besides its project (undo steps, selection, camera): taken when it is left. */
  capture(): TabView;
  /** Puts back what `capture` took, once the tab's project is on screen again. */
  apply(view: TabView): void;
  /** The 3D view: the phone's list of tabs never covers more than half of it (tabs hunt E3). */
  view?(): HTMLElement | null;
  /** Where every window keeps the tabs for a new window (the last list written). */
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** Where this window keeps its own tabs for a reload (tabs hunt C4: two windows took each other's). */
  session: Pick<Storage, "getItem" | "setItem"> | null;
}

export interface ShellTabs {
  strip: DesignTabsStrip;
  state(): TabsState;
  /**
   * True from the moment a tab, + or × is pressed until the project has landed or the switch failed. Undo, Redo and the
   * History ignore a press meanwhile: it was meant for the design being left (tabs hunt A1).
   */
  switching(): boolean;
  /** Call first in anything that replaces the project on screen: `key` is the kept project it will open, null for a new or a file. */
  expect(key: string | null): void;
  /** Call once the project has been replaced on screen. */
  landed(): void;
  /** Call when the project on screen, its name or the page may have changed (cheap). */
  sync(): void;
  /** Kept project `key` was deleted: its tab and view go. The project on screen can't be deleted, so its tab stays. */
  forget(key: string): void;
  /** Kept project `key` was renamed somewhere else (the home screen): its tab takes the name (tabs hunt C5). */
  rename(key: string, name: string): void;
  /** Reads the tabs of the last visit once the project on screen is known. */
  restore(): Promise<void>;
}

export function shellTabs(doc: Document, parts: ShellTabsParts): ShellTabs {
  let state: TabsState = NO_TABS;
  let counter = 0;
  /** A key for a project not kept yet: never the same as a kept id, never stored. */
  const temporary = () => `~${++counter}`;
  const isTemporary = (key: string) => key.startsWith("~");
  let expected: { key: string | null; wasKept: boolean } | null = null;
  let switching = false;
  /** The tab on screen being closed: it leaves the strip only once the next one has landed (tabs hunt A3, C3). */
  let closing: string | null = null;
  /** Set by landed(): the switch under way has replaced the project. */
  let arrived = false;
  /** What each tab left behind when it was left, oldest first (memory only: after a reload a tab's steps come from the store). */
  const views = new Map<string, TabView>();

  const strip = designTabs(doc, {
    titles: parts.titles,
    activate: (key) => {
      const tab = state.tabs.find((t) => t.key === key);
      if (tab) void go(tab);
    },
    close: (key) => void close(key),
    add: () => void go(null),
    view: parts.view,
  });
  parts.after.after(strip.element);
  // On a phone the tabs take no row of their own: their count button sits in the top bar (tabs T3a), which is marked so
  // the narrowest phones make room for it (@fission/ui styles/design-tabs-bar.css).
  parts.after.insertBefore(strip.count, parts.countBefore?.parentElement === parts.after ? parts.countBefore : null);
  parts.after.classList.add("design-tabs-bar");

  const save = () => {
    const text = storedTabs(state, (k) => !isTemporary(k));
    for (const place of [parts.session, parts.storage]) {
      try {
        place?.setItem(TABS_KEY, text);
      } catch {
        // storage off or full: the tabs just don't come back
      }
    }
  };
  const set = (next: TabsState) => {
    state = next;
    strip.render(state);
    save();
    trimViews(views, state.tabs.map((t) => t.key));
  };
  const drop = (key: string) => {
    views.delete(key);
    if (state.tabs.some((t) => t.key === key)) set(removeTab(state, key).state);
  };
  /**
   * Opens `tab` (null: a new design), one at a time. "landed" once it is on screen; "gone" when its project is no longer
   * kept here (its tab is closed and that is said); "failed" when it couldn't be opened (said, nothing changed).
   */
  async function go(tab: DesignTab | null): Promise<"landed" | "gone" | "failed"> {
    if (switching) return "failed";
    switching = true;
    arrived = false;
    const before = parts.workspace();
    try {
      // An OK the kernel still checks lands in its own design first: switched away from, it was dropped (tabs hunt A4).
      await parts.idle();
      if (tab) parts.preselect(tab.workspace);
      await (tab === null ? parts.start() : parts.open(tab.key));
      return "landed";
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (arrived) {
        parts.report(why); // it is on screen: only what came after failed
        return "landed";
      }
      expected = null;
      parts.preselect(before); // the page on screen stays as it was (tabs hunt B1)
      if (tab && e instanceof ProjectGone) {
        drop(tab.key);
        parts.report(`${tabName(tab.name)} is no longer in this browser (deleted here or in another window), so its tab is closed.`);
        return "gone";
      }
      parts.report(tab ? `Couldn't open ${tabName(tab.name)}: ${why}` : `Couldn't start a new design: ${why}`);
      strip.render(state);
      return "failed";
    } finally {
      switching = false;
      sync(); // the kept id, the name or the page may have changed while the switch held the strip still
    }
  }
  async function close(key: string) {
    if (switching) return;
    const tab = state.tabs.find((t) => t.key === key);
    if (!tab) return;
    if (key === state.active && parts.unsaved() && !(await confirmClose(doc, tab.name))) return;
    if (switching || !state.tabs.some((t) => t.key === key)) return; // something else started while it asked
    if (key !== state.active) return drop(key); // another tab: it is kept, and only leaves the strip
    // The tab on screen stays on the strip until the next one has landed (landed() takes it off): closed first, an edit
    // meanwhile brought it back and the strip named another design than the screen (tabs hunt A3). A neighbour whose
    // project is gone is closed too, and the next one tried.
    closing = key;
    try {
      for (;;) {
        const next = removeTab(state, key).next;
        const result = await go(next === null ? null : (state.tabs.find((t) => t.key === next) ?? null));
        if (result !== "gone") return;
      }
    } finally {
      closing = null;
    }
  }
  function sync() {
    // While a switch runs, or a project is being replaced, the tab on screen is not the one that shows yet (tabs hunt A3).
    if (state.active === null || expected !== null || switching) return;
    const active = state.tabs.find((t) => t.key === state.active);
    if (!active) return;
    const kept = parts.keptId();
    let next = state;
    if (kept !== null && kept !== active.key) {
      if (next.tabs.some((t) => t.key === kept)) next = activateTab(removeTab(next, active.key).state, kept); // the same project is already a tab
      else next = updateTab(next, active.key, { key: kept });
    }
    next = updateTab(next, next.active ?? "", { name: parts.projectName(), workspace: parts.workspace() });
    if (next !== state) set(next);
  }

  return {
    strip,
    state: () => state,
    switching: () => switching,
    expect(key) {
      expected = { key, wasKept: parts.keptId() !== null };
      // The tab being left keeps its view, put last as the one left most recently. A tab being closed keeps nothing:
      // its view went to the tab that came up (tabs hunt C3).
      const left = state.active;
      if (left === null) return;
      views.delete(left);
      if (left !== closing) views.set(left, parts.capture());
      trimViews(views, state.tabs.map((t) => t.key));
    },
    landed() {
      arrived = true;
      const was = expected ?? { key: null, wasKept: parts.keptId() !== null };
      expected = null;
      let next = state;
      const old = next.active;
      if (closing !== null) next = removeTab(next, closing).state; // the closed tab leaves now that the next one has landed
      // A project that was never kept (a new one nothing was done in) is not worth a tab of its own.
      else if (old !== null && !was.wasKept && isTemporary(old)) next = removeTab(next, old).state;
      const key = was.key ?? parts.keptId() ?? temporary();
      const existing = next.tabs.find((t) => t.key === key);
      next = addTab(next, { key, name: parts.projectName(), workspace: existing?.workspace ?? parts.workspace() });
      const view = views.get(key);
      views.delete(key); // on screen now: taken again when it is left
      set(next);
      if (view !== undefined) parts.apply(view);
    },
    sync,
    forget(key) {
      if (key === state.active) return;
      drop(key);
    },
    rename(key, name) {
      if (key === state.active) return sync(); // the project on screen has its own name box: the tab follows it
      const next = updateTab(state, key, { name });
      if (next !== state) set(next);
    },
    async restore() {
      // This window's own list after a reload; a new window starts from the last list any window wrote (tabs hunt C4).
      const read = (place: Pick<Storage, "getItem"> | null) => {
        try {
          return place?.getItem(TABS_KEY) ?? null;
        } catch {
          return null;
        }
      };
      const saved = restoredTabs(read(parts.session) ?? read(parts.storage));
      let kept: Map<string, string | null>;
      try {
        kept = new Map((await parts.kept()).map((p) => [p.id, p.name]));
      } catch {
        kept = new Map();
      }
      const here = parts.keptId();
      // A project kept only in the journal (storage full) still opens, so its tab stays (tabs hunt B2). Each tab takes
      // its name as kept: one renamed on the home screen, or in another window, kept its old name (tabs hunt C5).
      const tabs = saved.tabs.filter((t) => t.key === here || kept.has(t.key) || parts.held(t.key)).map((t) => ({ ...t, name: kept.get(t.key) ?? t.name }));
      let next: TabsState = { tabs, active: here !== null && tabs.some((t) => t.key === here) ? here : null };
      next = addTab(next, { key: here ?? temporary(), name: parts.projectName(), workspace: tabs.find((t) => t.key === here)?.workspace ?? parts.workspace() });
      set(next);
    },
  };
}
