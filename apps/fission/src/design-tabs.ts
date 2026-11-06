// The shell's side of the design tabs (@fission/ui design-tabs.ts): which projects are open as tabs, kept for the next
// visit, and what a click, a "+" or a "×" does. The tabs are kept projects (each autosaves as before); switching opens
// the project through the shell's `open` (the old one is finished, i.e. kept as it is), so nothing of a tab is lost by
// leaving it. Only the project on screen can have unsaved changes, so only closing it can ask. A tab is the project's
// name and the workspace it was last showing (a slicer job reads SLICE, a design DESIGN).

import { activateTab, addTab, confirmClose, designTabs, NO_TABS, removeTab, restoredTabs, storedTabs, updateTab, type DesignTabsStrip, type TabsState } from "@fission/ui";

/** Where the open tabs are kept for the next visit. */
export const TABS_KEY = "spindlelabs.tabs";

export interface ShellTabsParts {
  /** The tab strip goes after this element (the top bar). */
  after: HTMLElement;
  /** The kept id of the project on screen; null while a new one waits for its first change. */
  keptId(): string | null;
  projectName(): string;
  /** The page on screen (a workspace id, or another page's name). */
  workspace(): string;
  titles(): Record<string, string>;
  /** Opens kept project `id` in place of the one on screen. Rejects, changing nothing, when it can't be read. */
  open(id: string): Promise<void>;
  /** Starts a new, empty project in place of the one on screen. */
  start(): Promise<void>;
  /** Shows workspace `id` next (the tab remembered it) when the next project lands. */
  preselect(id: string): void;
  /** True while the project on screen has changes not stored yet. */
  unsaved(): boolean;
  /** Says why something failed (the top bar's message line). */
  report(message: string): void;
  /** Ids of the projects kept in this browser. */
  kept(): Promise<string[]>;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

export interface ShellTabs {
  strip: DesignTabsStrip;
  state(): TabsState;
  /** Call first in anything that replaces the project on screen: `key` is the kept project it will open, null for a new or a file. */
  expect(key: string | null): void;
  /** Call once the project has been replaced on screen. */
  landed(): void;
  /** Call when the project on screen, its name or the page may have changed (cheap). */
  sync(): void;
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
  let busy = false;

  const strip = designTabs(doc, {
    titles: parts.titles,
    activate: (key) =>
      void go(() => {
        const tab = state.tabs.find((t) => t.key === key);
        if (tab) parts.preselect(tab.workspace);
        return parts.open(key);
      }),
    close: (key) => void close(key),
    add: () => void go(() => parts.start()),
  });
  parts.after.after(strip.element);

  const save = () => {
    try {
      parts.storage?.setItem(TABS_KEY, storedTabs(state, (k) => !isTemporary(k)));
    } catch {
      // storage off or full: the tabs just don't come back
    }
  };
  const set = (next: TabsState) => {
    state = next;
    strip.render(state);
    save();
  };
  /** Runs an opening, one at a time, and says why if it fails. */
  async function go(run: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (e) {
      expected = null;
      parts.report(e instanceof Error ? e.message : String(e));
      strip.render(state);
    } finally {
      busy = false;
    }
  }
  async function close(key: string) {
    if (busy) return;
    const tab = state.tabs.find((t) => t.key === key);
    if (!tab) return;
    if (key === state.active && parts.unsaved() && !(await confirmClose(doc, tab.name))) return;
    const before = state;
    const { state: after, next } = removeTab(state, key);
    set(after);
    if (key !== before.active) return; // another tab: it is kept, and only leaves the strip
    await go(async () => {
      try {
        const tab = state.tabs.find((t) => t.key === next);
        if (tab) parts.preselect(tab.workspace);
        await (next === null ? parts.start() : parts.open(next));
      } catch (e) {
        set(before); // it could not be left: the tab stays
        throw e;
      }
    });
  }

  return {
    strip,
    state: () => state,
    expect(key) {
      expected = { key, wasKept: parts.keptId() !== null };
    },
    landed() {
      const was = expected ?? { key: null, wasKept: parts.keptId() !== null };
      expected = null;
      let next = state;
      const old = next.active;
      // A project that was never kept (a new one nothing was done in) is not worth a tab of its own.
      if (old !== null && !was.wasKept && isTemporary(old)) next = removeTab(next, old).state;
      const key = was.key ?? parts.keptId() ?? temporary();
      const existing = next.tabs.find((t) => t.key === key);
      next = addTab(next, { key, name: parts.projectName(), workspace: existing?.workspace ?? parts.workspace() });
      set(next);
    },
    sync() {
      if (state.active === null || expected !== null) return; // a project is being replaced: the tab on screen is not the one that shows yet
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
    },
    async restore() {
      const saved = restoredTabs(parts.storage?.getItem(TABS_KEY) ?? null);
      let kept: Set<string>;
      try {
        kept = new Set(await parts.kept());
      } catch {
        kept = new Set();
      }
      const here = parts.keptId();
      const tabs = saved.tabs.filter((t) => t.key === here || kept.has(t.key));
      let next: TabsState = { tabs, active: here !== null && tabs.some((t) => t.key === here) ? here : null };
      next = addTab(next, { key: here ?? temporary(), name: parts.projectName(), workspace: tabs.find((t) => t.key === here)?.workspace ?? parts.workspace() });
      set(next);
    },
  };
}
