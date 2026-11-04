// Instant, themed tooltips (Ben, 2026-11-04). The browser's own tooltip waits
// about a second and is a plain white box that ignores the theme. This
// replaces it for every element with a `title`, without any caller changing:
// on hover the title moves into `data-tip` (so the browser stays quiet),
// a small box in the app's look shows at once, and the title goes back when
// the pointer leaves. A right-click (a long press on a phone) on a button
// opens the quick info: the whole title, as long as it is, plus the key if
// the button names one (`data-key`). Right-clicks something else handles
// itself (the view's menu, the browser rows, the timeline) are left alone.
// Styles: src/styles/tooltip.css.

/** What the hover box says and what the quick info says, from one title. */
export interface TipWords {
  /** The hover box: the name before the first ": ", else the first sentence, else all of it, at most 80 characters. */
  short: string;
  /** The quick info: the whole title. */
  full: string;
}

/** The longest hover box in characters; a longer one is cut at a word with an ellipsis. */
export const TIP_SHORT_MAX = 80;

/** Splits a title into the hover words and the quick-info words. */
export function tipWords(title: string): TipWords {
  const full = title.trim();
  let short = full;
  const colon = full.indexOf(": ");
  const stop = full.search(/[.!?](\s|$)/);
  if (colon > 0 && colon <= TIP_SHORT_MAX) short = full.slice(0, colon);
  else if (stop > 0 && stop < full.length - 1) short = full.slice(0, stop + 1);
  if (short.length > TIP_SHORT_MAX) {
    const cut = short.slice(0, TIP_SHORT_MAX - 1);
    short = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1))}…`;
  }
  return { short, full };
}

/** Whether a right-click on `target` should open quick info: a button that has words, outside a field, a canvas or an element that took the click already. */
export function quickInfoFor(target: Element | null): HTMLElement | null {
  if (!target) return null;
  if (target.closest("input, textarea, select, canvas, [contenteditable=true], [contenteditable='']")) return null;
  const button = target.closest<HTMLElement>("button, [role=button], [role=menuitem]");
  if (!button) return null;
  return button.dataset.tip || button.getAttribute("title") ? button : null;
}

export interface Tooltips {
  /** Hides the box and puts the title back. */
  hide(): void;
  /** Stops listening. */
  stop(): void;
}

const GAP = 8;
const EDGE = 6;

/** Starts the tooltips on `doc`. Returns a handle to hide the box or stop. */
export function startTooltips(doc: Document): Tooltips {
  const win = doc.defaultView;
  if (!win) return { hide() {}, stop() {} };
  const box = doc.createElement("div");
  box.className = "tooltip";
  box.id = "tooltip";
  box.setAttribute("role", "tooltip");
  box.hidden = true;
  const words = doc.createElement("div");
  words.className = "words";
  const key = doc.createElement("kbd");
  key.className = "key";
  key.hidden = true;
  const hint = doc.createElement("div");
  hint.className = "hint";
  box.append(words, key, hint);
  (doc.body ?? doc.documentElement).append(box);

  let on: HTMLElement | null = null;
  let pinned = false;

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    box.style.left = "0px";
    box.style.top = "0px";
    const b = box.getBoundingClientRect();
    let top = r.bottom + GAP;
    if (top + b.height > vh - EDGE) top = Math.max(EDGE, r.top - GAP - b.height);
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - b.width / 2), Math.max(EDGE, vw - EDGE - b.width));
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  };

  const restore = () => {
    if (on && on.dataset.tip !== undefined && on.dataset.tipHeld === "1") {
      on.setAttribute("title", on.dataset.tip);
      delete on.dataset.tipHeld;
      delete on.dataset.tip;
    }
    on?.removeAttribute("aria-describedby");
  };

  const hide = () => {
    restore();
    on = null;
    pinned = false;
    box.hidden = true;
    box.classList.remove("pinned");
  };

  const show = (el: HTMLElement, text: string, full: boolean) => {
    const w = tipWords(text);
    words.textContent = full ? w.full : w.short;
    const k = el.dataset.key ?? el.getAttribute("aria-keyshortcuts");
    key.hidden = !(full && k);
    key.textContent = k ?? "";
    hint.hidden = full || w.short === w.full;
    hint.textContent = hint.hidden ? "" : "Right-click for how to use it";
    box.classList.toggle("pinned", full);
    box.hidden = false;
    el.setAttribute("aria-describedby", box.id);
    place(el);
  };

  const hold = (el: HTMLElement): string => {
    const t = el.getAttribute("title");
    if (t !== null && t.trim() !== "") {
      // The title would show as the browser's own box: keep its words, and give the
      // element its name from them when it has none.
      if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t.split(": ")[0] ?? t);
      el.dataset.tip = t;
      el.dataset.tipHeld = "1";
      el.removeAttribute("title");
    }
    return el.dataset.tip ?? "";
  };

  const onOver = (e: Event) => {
    const pe = e as PointerEvent;
    if (pinned || pe.pointerType === "touch") return;
    const target = (e.target as Element | null)?.closest?.("[title], [data-tip]") as HTMLElement | null;
    if (!target || target === on) return;
    if (on) hide();
    const text = hold(target);
    if (!text) return;
    on = target;
    show(target, text, false);
  };
  const onOut = (e: Event) => {
    if (pinned || !on) return;
    const to = (e as MouseEvent).relatedTarget as Node | null;
    if (to && on.contains(to)) return;
    hide();
  };
  const onMenu = (e: Event) => {
    if (e.defaultPrevented) return; // something else took this right-click
    const button = quickInfoFor(e.target as Element | null);
    if (!button) return;
    e.preventDefault();
    if (on && on !== button) hide();
    const text = hold(button);
    if (!text) return;
    on = button;
    pinned = true;
    show(button, text, true);
  };
  const dismiss = (e: Event) => {
    if (box.hidden) return;
    if (e.type === "pointerdown" && box.contains(e.target as Node)) return;
    hide();
  };
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === "Escape") dismiss(e); // never stopped: Escape still reaches whoever else uses it
  };

  doc.addEventListener("pointerover", onOver);
  doc.addEventListener("pointerout", onOut);
  doc.addEventListener("contextmenu", onMenu);
  doc.addEventListener("pointerdown", dismiss, true);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("scroll", dismiss, true);
  win.addEventListener("blur", hide);
  win.addEventListener("resize", hide);
  return {
    hide,
    stop() {
      hide();
      doc.removeEventListener("pointerover", onOver);
      doc.removeEventListener("pointerout", onOut);
      doc.removeEventListener("contextmenu", onMenu);
      doc.removeEventListener("pointerdown", dismiss, true);
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("scroll", dismiss, true);
      win.removeEventListener("blur", hide);
      win.removeEventListener("resize", hide);
      box.remove();
    },
  };
}
