// Design tabs (tabs step 1, as Fusion's document tabs): a strip under the top bar with one tab for every project open
// at once, the one on screen marked. Each tab says what it is for in words, not just colour: the project's name and,
// after it, a chip naming the workspace it shows (DESIGN, SLICE…), so a tab holding a slicer job reads differently from
// a design. "+" opens a new design; × closes a tab (asking first when the project it holds has unsaved changes).
// This file is the pure rules (the list, which tab comes up when one closes, what is stored for the next visit) and
// the strip; the shell (apps/fission/src/design-tabs.ts) does the opening and closing. Styles: styles/design-tabs.css.

/** One open project. `key` is its kept id, or a temporary key while it has not been kept yet. */
export interface DesignTab {
  key: string;
  name: string;
  /** The workspace the tab shows (a workspace id). */
  workspace: string;
}

export interface TabsState {
  tabs: DesignTab[];
  /** The key of the tab on screen (null only when there are no tabs). */
  active: string | null;
}

/** Most tabs open at once: the strip and the memory both stay small. */
export const MAX_TABS = 12;
/** The longest name a tab shows before "…" (the full name is its tooltip). */
export const TAB_NAME_SHOWN = 24;

export const NO_TABS: TabsState = { tabs: [], active: null };

/**
 * When the strip is the phone's one switcher button (styles/design-tabs.css uses this same query; a unit test holds the
 * two together): narrow screens, and also touch screens and short windows, so a phone held sideways (667 x 375) never
 * gets the wide row with its 33 px tabs and × beside each (tabs hunt E2).
 */
export const TABS_PHONE_QUERY = "(max-width: 640px), (pointer: coarse), (max-height: 500px)";

/** The tab's words for a name: an empty name reads "Untitled". */
export const tabName = (name: string): string => (name.trim() === "" ? "Untitled" : name.trim());

/** The name as the tab shows it (cut with "…" past TAB_NAME_SHOWN characters). Pure. */
export function shortName(name: string): string {
  const n = [...tabName(name)];
  return n.length > TAB_NAME_SHOWN ? n.slice(0, TAB_NAME_SHOWN - 1).join("") + "…" : n.join("");
}

/** The workspace chip's words: its title in capitals (DESIGN, SLICE), as the workspace button writes it. */
export const workspaceChip = (workspace: string, titles: Record<string, string> = {}): string => (titles[workspace] ?? workspace).toUpperCase();

/** True when another tab can be opened. */
export const canAdd = (s: TabsState): boolean => s.tabs.length < MAX_TABS;

/** Puts `tab` in the list (replacing the one with its key) and makes it the one on screen. Past MAX_TABS the oldest tab that is not active goes. Pure. */
export function addTab(s: TabsState, tab: DesignTab): TabsState {
  const at = s.tabs.findIndex((t) => t.key === tab.key);
  let tabs = at >= 0 ? s.tabs.map((t, i) => (i === at ? tab : t)) : [...s.tabs, tab];
  while (tabs.length > MAX_TABS) {
    const drop = tabs.findIndex((t) => t.key !== tab.key);
    tabs = tabs.filter((_, i) => i !== drop);
  }
  return { tabs, active: tab.key };
}

/** Makes `key` the one on screen; unchanged when no tab has it. Pure. */
export const activate = (s: TabsState, key: string): TabsState => (s.tabs.some((t) => t.key === key) ? { ...s, active: key } : s);

/** Changes the tab `key` (its name, workspace, or its key itself); unchanged when no tab has it. Pure. */
export function update(s: TabsState, key: string, change: Partial<DesignTab>): TabsState {
  if (!s.tabs.some((t) => t.key === key)) return s;
  if (change.key !== undefined && change.key !== key && s.tabs.some((t) => t.key === change.key)) return s; // two tabs never share a key
  const tabs = s.tabs.map((t) => (t.key === key ? { ...t, ...change } : t));
  const same = tabs.every((t, i) => t.key === s.tabs[i].key && t.name === s.tabs[i].name && t.workspace === s.tabs[i].workspace);
  return same ? s : { tabs, active: s.active === key ? (change.key ?? key) : s.active };
}

/**
 * Takes the tab `key` out. When it was the one on screen, the tab that took its place (the one to its right, else the
 * left) is `next`: the shell opens it. Closing a tab that is not on screen changes `next` to null. Pure.
 */
export function removeTab(s: TabsState, key: string): { state: TabsState; next: string | null } {
  const at = s.tabs.findIndex((t) => t.key === key);
  if (at < 0) return { state: s, next: null };
  const tabs = s.tabs.filter((_, i) => i !== at);
  if (s.active !== key) return { state: { tabs, active: s.active }, next: null };
  const next = tabs[at]?.key ?? tabs[at - 1]?.key ?? null;
  return { state: { tabs, active: next }, next };
}

/** What is kept for the next visit: the tabs `keep` accepts (kept projects), in order, and which was on screen. */
export function stored(s: TabsState, keep: (key: string) => boolean): string {
  const tabs = s.tabs.filter((t) => keep(t.key));
  return JSON.stringify({ v: 1, tabs, active: tabs.some((t) => t.key === s.active) ? s.active : null });
}

/** Reads what `stored` wrote; anything wrong with it (not JSON, wrong shape, duplicate keys) gives no tabs, never an error. */
export function restored(text: string | null): TabsState {
  if (text === null) return NO_TABS;
  try {
    const o = JSON.parse(text) as { v?: unknown; tabs?: unknown; active?: unknown };
    if (o.v !== 1 || !Array.isArray(o.tabs)) return NO_TABS;
    const seen = new Set<string>();
    const tabs: DesignTab[] = [];
    for (const t of o.tabs.slice(0, MAX_TABS)) {
      const { key, name, workspace } = (t ?? {}) as Record<string, unknown>;
      if (typeof key !== "string" || key === "" || typeof name !== "string" || typeof workspace !== "string" || seen.has(key)) return NO_TABS;
      seen.add(key);
      tabs.push({ key, name: name.slice(0, 200), workspace });
    }
    return { tabs, active: typeof o.active === "string" && seen.has(o.active) ? o.active : null };
  } catch {
    return NO_TABS;
  }
}

export interface DesignTabsParts {
  /** The tab was chosen (a tab already on screen is not reported). */
  activate(key: string): void;
  /** × on a tab. */
  close(key: string): void;
  /** + */
  add(): void;
  /** The workspace titles, for the chips (id → title). */
  titles(): Record<string, string>;
  /** The 3D view: the phone's open list never covers more than half of it (tabs hunt E3). */
  view?(): HTMLElement | null;
}

export interface DesignTabsStrip {
  element: HTMLElement;
  /**
   * The phone's count button (tabs T3a): the shell puts it in the top bar, so on a phone the tabs take no row of their
   * own. Pressing it opens the list under the top bar. Hidden on wide screens (the strip shows) and with no tabs.
   */
  count: HTMLElement;
  render(s: TabsState): void;
}

/**
 * The strip. Tabs are buttons in a tablist (the chosen one aria-selected, arrow keys move between them); × and + are
 * buttons of their own, as tall as the strip. Every tab carries data-key and data-workspace for the browser test.
 */
export function designTabs(doc: Document, parts: DesignTabsParts): DesignTabsStrip {
  const element = doc.createElement("nav");
  element.id = "design-tabs";
  element.className = "design-tabs";
  element.setAttribute("aria-label", "Open designs");
  element.hidden = true;
  const list = doc.createElement("div");
  list.className = "design-tabs-list";
  list.setAttribute("role", "tablist");
  const plus = doc.createElement("button");
  plus.type = "button";
  plus.className = "design-tabs-add";
  plus.id = "design-tabs-add";
  plus.setAttribute("aria-label", "New design in a new tab");
  plus.title = "New design in a new tab";
  plus.textContent = "+";
  plus.addEventListener("click", () => parts.add());
  // On a phone the open designs are one small button in the top bar with their count, as phone browsers have (tabs T3a:
  // a row of its own under the top bar took 47 px from the 3D view); it opens a short list under the top bar, so one tap
  // never covers most of the view (styles/design-tabs.css shows the button or the strip by TABS_PHONE_QUERY).
  const switcher = doc.createElement("button");
  switcher.type = "button";
  switcher.className = "design-tabs-switch";
  switcher.hidden = true;
  switcher.id = "design-tabs-switch";
  switcher.setAttribute("aria-haspopup", "true");
  switcher.setAttribute("aria-expanded", "false");
  const menu = doc.createElement("div");
  menu.className = "design-tabs-menu";
  menu.id = "design-tabs-menu";
  menu.hidden = true;
  element.append(list, plus, menu);
  let shown: TabsState = NO_TABS;
  const isOpen = () => !menu.hidden;
  // + New design is the list's first row, so it is in sight without scrolling however many tabs are open (tabs T3a).
  const newRow = (): HTMLElement => {
    const row = doc.createElement("div");
    row.className = "design-tabs-new";
    const add = doc.createElement("button");
    add.type = "button";
    add.id = "design-tabs-menu-add";
    add.className = "design-tabs-new-button";
    add.textContent = "+ New design";
    add.disabled = !canAdd(shown);
    add.title = canAdd(shown) ? "New design in a new tab" : `${MAX_TABS} designs are open: close one to open another`;
    add.addEventListener("click", () => {
      openMenu(false);
      parts.add();
    });
    row.append(add);
    return row;
  };
  const fillMenu = () => menu.replaceChildren(newRow(), ...shown.tabs.map((t) => tabRow(t, t.key === shown.active, parts.titles(), true))); // only while open: the strip alone holds the tabs otherwise
  const openMenu = (open: boolean) => {
    menu.hidden = !open;
    if (open) {
      // At most half the 3D view (the stylesheet's cap is of the window, which at 320 x 568 left 59% of the view
      // covered, tabs hunt E3), and never less than one row.
      const view = parts.view?.()?.getBoundingClientRect().height ?? 0;
      if (view > 0) menu.style.setProperty("--design-tabs-view-half", `${Math.max(44, Math.floor(view / 2))}px`);
      fillMenu();
    }
    else menu.replaceChildren();
    switcher.setAttribute("aria-expanded", String(open));
    element.dataset.open = String(open);
  };
  switcher.addEventListener("click", () => openMenu(!isOpen()));
  doc.addEventListener("pointerdown", (e) => {
    // The count button is outside the strip (in the top bar): its own press toggles the list, never a press outside it.
    const t = e.target as Node | null;
    if (isOpen() && typeof t?.nodeType === "number" && !element.contains(t) && !switcher.contains(t)) openMenu(false);
  });
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      openMenu(false);
      switcher.focus();
    }
  });

  list.addEventListener("keydown", (e) => {
    const all = [...list.querySelectorAll<HTMLElement>(".design-tabs-main")];
    const at = all.indexOf(doc.activeElement as HTMLElement);
    if (at < 0) return;
    // Delete closes the focused tab: × beside each tab is for the mouse and taps, kept out of the tablist (tabs hunt E6).
    if (e.key === "Delete") {
      e.preventDefault();
      const key = all[at].closest<HTMLElement>(".design-tabs-tab")?.dataset.key;
      if (key !== undefined) parts.close(key);
      return;
    }
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    all[(at + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length].focus();
  });

  /** One tab's two buttons (its name with the workspace chip, and ×), for the strip and for the phone's list. */
  const tabRow = (t: DesignTab, on: boolean, titles: Record<string, string>, inMenu: boolean): HTMLElement => {
    const tab = doc.createElement("div");
    tab.className = "design-tabs-tab";
    tab.dataset.key = t.key;
    tab.dataset.workspace = t.workspace;
    tab.dataset.active = String(on);
    const main = doc.createElement("button");
    main.type = "button";
    main.className = "design-tabs-main";
    if (!inMenu) {
      main.setAttribute("role", "tab");
      main.setAttribute("aria-selected", String(on));
      main.setAttribute("aria-keyshortcuts", "Delete");
      main.tabIndex = on ? 0 : -1;
    } else if (on) main.setAttribute("aria-current", "true");
    const chip = workspaceChip(t.workspace, titles);
    main.title = `${tabName(t.name)} (${chip.toLowerCase()})`;
    // Read as "Untitled, DesignLab": the name and chip ran together as "UntitledDESIGNLAB" (tabs hunt E6).
    main.setAttribute("aria-label", tabLabel(t, titles));
    const name = doc.createElement("span");
    name.className = "design-tabs-name";
    name.textContent = shortName(t.name);
    const kind = doc.createElement("span");
    kind.className = "design-tabs-kind";
    kind.textContent = chip;
    main.append(name, kind);
    main.addEventListener("click", () => {
      openMenu(false);
      if (t.key !== shown.active) parts.activate(t.key);
    });
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "design-tabs-close";
    close.setAttribute("aria-label", `Close ${tabName(t.name)}`);
    close.title = `Close ${tabName(t.name)}`;
    close.textContent = "×";
    if (!inMenu) {
      // Only tabs belong in a tablist: on the strip × is for the mouse and taps, and the keyboard closes a tab with Delete
      // (tabs hunt E6). In the phone's list (no tablist) × stays a button of its own.
      close.tabIndex = -1;
      close.setAttribute("aria-hidden", "true");
    }
    close.addEventListener("click", () => {
      openMenu(false);
      parts.close(t.key);
    });
    tab.append(main, close);
    return tab;
  };

  return {
    element,
    count: switcher,
    render(s) {
      shown = s;
      // One tab means nothing to switch between: Fusion shows its strip then too, and so do we, so "+" is always there.
      element.hidden = s.tabs.length === 0;
      switcher.hidden = s.tabs.length === 0;
      if (s.tabs.length === 0) openMenu(false);
      const titles = parts.titles();
      plus.disabled = !canAdd(s);
      plus.title = canAdd(s) ? "New design in a new tab" : `${MAX_TABS} designs are open: close one to open another`;
      // Only the number, in a rounded square; the words are its name for a screen reader and its tooltip.
      const count = doc.createElement("span");
      count.className = "design-tabs-count";
      count.textContent = String(s.tabs.length);
      switcher.replaceChildren(count);
      switcher.setAttribute("aria-label", switcherLabel(s));
      switcher.title = switcherLabel(s);
      // The tabs are made afresh, so a focused one would leave the focus on <body>: it goes to the tab on screen, which
      // after Enter or Space is the one just chosen (tabs hunt E6).
      const focused = list.contains(doc.activeElement);
      list.replaceChildren(...s.tabs.map((t) => tabRow(t, t.key === s.active, titles, false)));
      if (focused) list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
      if (isOpen()) fillMenu();
    },
  };
}

/** The phone's count button's words: "3 designs open, Bracket on screen: choose another" ("1 design" for one). Pure. */
export function switcherLabel(s: TabsState): string {
  const active = s.tabs.find((t) => t.key === s.active);
  const n = s.tabs.length;
  return `${n} design${n === 1 ? "" : "s"} open, ${active ? tabName(active.name) : "none"} on screen: choose another`;
}

/** A tab's name for a screen reader: the design's name, then its workspace's title ("Bracket, Design"). */
export const tabLabel = (t: DesignTab, titles: Record<string, string> = {}): string => `${tabName(t.name)}, ${titles[t.workspace] ?? t.workspace}`;

/**
 * The question when the tab on screen is closed while its changes are still being stored. Closing never throws them
 * away (the shell finishes storing them as the next tab opens, or keeps them aside when it can't), so the words say so;
 * they used to say the changes were "not saved" as if closing lost them (tabs hunt A5).
 */
export const closeQuestion = (name: string): string =>
  `"${tabName(name)}" has changes this browser hasn't finished storing. Closing the tab doesn't lose them: they stay kept here, and File > Projects in this browser opens it again. Close the tab?`;

/** A small dialog asking `closeQuestion`: resolves true for "Close the tab", false for "Keep it open" or Escape. */
export function confirmClose(doc: Document, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = doc.createElement("dialog");
    dialog.className = "design-tabs-ask";
    dialog.setAttribute("aria-label", "Close design");
    const words = doc.createElement("p");
    words.textContent = closeQuestion(name);
    const row = doc.createElement("div");
    row.className = "design-tabs-ask-row";
    const keep = doc.createElement("button");
    keep.type = "button";
    keep.id = "design-tabs-keep";
    keep.textContent = "Keep it open";
    const go = doc.createElement("button");
    go.type = "button";
    go.id = "design-tabs-close-anyway";
    go.textContent = "Close the tab";
    row.append(keep, go);
    dialog.append(words, row);
    let answered = false;
    const done = (yes: boolean) => {
      if (answered) return;
      answered = true;
      dialog.close?.();
      dialog.remove();
      resolve(yes);
    };
    keep.addEventListener("click", () => done(false));
    go.addEventListener("click", () => done(true));
    dialog.addEventListener("cancel", () => done(false));
    (doc.querySelector(".design-tabs") ?? doc.body).append(dialog); // inside the strip: its styles are the strip's
    if (typeof dialog.showModal === "function") dialog.showModal();
    keep.focus();
  });
}
