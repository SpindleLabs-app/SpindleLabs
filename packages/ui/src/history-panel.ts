// The History panel: every step kept by the undo history (@fission/core `History.steps`), newest first, each a button
// that puts the project back as it was at that step (`jumpTo`). For beginners: "Undo" one step at a time is slow and
// blind, a list says what each step was and lets a person go back to the one they want, and forward again. The panel
// is the shell's, one for the whole project like Undo and Redo. A dropdown under its button on a wide screen; at phone
// width a bottom sheet of at most 45 % of the screen (one tap never covers most of the view), with Close always in it.
// Styles: styles/history-panel.css (the button, in the Undo and Redo group, in styles/undo-redo.css).
import { UNDO_LIMIT, type HistoryStepInfo } from "@fission/core";

export interface HistoryPanelParts {
  steps(): HistoryStepInfo[];
  /** Go to step `step` of `steps()`. */
  jump(step: number): void;
  /** The clock the steps' times are read against (ms). */
  now(): number;
  /** Phone width: the panel is a sheet, and closes after a jump so the part can be seen. */
  isPhone(): boolean;
}

/** How long ago, in words a person says: "just now", "20 s ago", "3 min ago", "2 h ago", "over a day ago". A time in the future is "just now". */
export function agoWords(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return "over a day ago";
}

/**
 * The words for step `i` of the list: its label, or "Before these steps" for the first. The history keeps the last
 * UNDO_LIMIT steps (kept in this browser across a reload, step 89, but never in the file, so a file opened elsewhere
 * starts afresh), so the first row is the project as it was before the steps listed, which is the project's real start
 * only for a new one.
 */
export const stepWords = (i: number, label: string): string => (i === 0 ? "Before these steps" : label);

export interface HistoryPanel {
  button: HTMLButtonElement;
  panel: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Redraws the list when the history changed. */
  refresh(): void;
}

/** The clock icon: a ring with two hands, drawn like the bar's other icons (a 24 px grid, the text colour). */
function clock(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const ring = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("cx", "12");
  ring.setAttribute("cy", "12");
  ring.setAttribute("r", "9");
  const hands = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  hands.setAttribute("d", "M12 7v5l3 2");
  svg.append(ring, hands);
  return svg;
}

export function historyPanel(doc: Document, parts: HistoryPanelParts): HistoryPanel {
  const button = doc.createElement("button");
  button.id = "history";
  button.className = "history-button";
  button.type = "button";
  button.setAttribute("aria-label", "History");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "history-panel");
  button.title = "History: every step you have taken, to go back to any of them";
  button.append(clock(doc));

  const panel = doc.createElement("section");
  panel.id = "history-panel";
  panel.className = "history-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "History");
  panel.hidden = true;
  const head = doc.createElement("header");
  const title = doc.createElement("h2");
  title.textContent = "History";
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "history-close";
  close.textContent = "Close";
  head.append(title, close);
  const hint = doc.createElement("p");
  hint.className = "history-hint";
  hint.textContent = `The steps since this project was opened (the last ${UNDO_LIMIT}). The timeline at the bottom keeps the whole design. Tap a step to go back to it. The steps after it stay here, dimmed, until you make a new change.`;
  const list = doc.createElement("ol");
  list.className = "history-list";
  const empty = doc.createElement("p");
  empty.className = "history-empty";
  empty.textContent = "Nothing has been done yet. Each thing you do appears here.";
  panel.append(head, hint, empty, list);

  let isOpen = false;

  const refresh = () => {
    const steps = parts.steps();
    const now = parts.now();
    empty.hidden = steps.length > 1;
    // Newest first, as a feed: the present is wherever "current" is, with the undone steps above it.
    const rows = steps.map((s, i) => {
      const li = doc.createElement("li");
      li.dataset.state = s.state;
      const b = doc.createElement("button");
      b.type = "button";
      b.dataset.step = String(i);
      if (s.state === "current") b.setAttribute("aria-current", "step");
      const name = doc.createElement("span");
      name.className = "history-name";
      name.textContent = stepWords(i, s.label);
      const note = doc.createElement("span");
      note.className = "history-when";
      note.textContent = s.state === "current" ? `now, ${i === 0 ? "at the start" : agoWords(now - s.at)}` : s.state === "undone" ? `undone, ${agoWords(now - s.at)}` : agoWords(now - s.at);
      b.append(name, note);
      b.title = s.state === "current" ? "You are here" : s.state === "undone" ? `Go forward to: ${stepWords(i, s.label)}` : `Go back to: ${stepWords(i, s.label)}`;
      li.append(b);
      return li;
    });
    list.replaceChildren(...rows.reverse());
  };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    refresh();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    // The present step is where the eye starts, and where the keyboard starts.
    list.querySelector<HTMLElement>('[aria-current="step"]')?.focus();
    list.querySelector('[aria-current="step"]')?.scrollIntoView?.({ block: "nearest" });
  };
  const closePanel = (back = true) => {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (back) button.focus();
  };

  button.addEventListener("click", () => (isOpen ? closePanel() : open()));
  close.addEventListener("click", () => closePanel());
  list.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button[data-step]");
    if (!b) return;
    parts.jump(Number(b.dataset.step));
    if (parts.isPhone()) closePanel();
    else if (isOpen) refresh();
  });
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      closePanel();
    }
  });
  // A press anywhere else puts the panel away (it is not modal: the part stays reachable).
  doc.addEventListener("pointerdown", (e) => {
    if (isOpen && !panel.contains(e.target as Node) && !button.contains(e.target as Node)) closePanel(false);
  });

  // The button comes with the first step: on a new project there is nothing to go back to, and (at phone width) the
  // docked column of buttons stays short enough for the start card to clear it.
  const sync = () => {
    button.hidden = parts.steps().length <= 1 && !isOpen;
  };
  sync();

  return {
    button,
    panel,
    open,
    close: () => closePanel(),
    isOpen: () => isOpen,
    refresh: () => {
      sync();
      if (isOpen) refresh();
    },
  };
}
