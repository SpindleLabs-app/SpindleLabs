// Instant, themed tooltips (Ben, 2026-11-04). The browser's own tooltip waits
// about a second and is a plain white box that ignores the theme. This
// replaces it for every element with a `title`, without any caller changing:
// on hover the title is kept from the browser (which stays quiet; the element still answers for it),
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
  return button.getAttribute("title") ? button : null;
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

  // While the box is up the title is kept from the browser (else its own box shows too) but not from the app: the element answers `.title`,
  // getAttribute("title") and the setters as if it were still there, so an Undo button's words still follow the last step and anything that reads
  // them sees the real words. The title goes back as a real attribute when the pointer leaves.
  let held: string | null = null;
  let shownFull = false;
  const SHADOWED = ["title", "getAttribute", "hasAttribute", "setAttribute", "removeAttribute"] as const;
  const unshadow = (el: HTMLElement) => {
    for (const name of SHADOWED) Reflect.deleteProperty(el, name);
    delete el.dataset.tooltipHeld;
  };
  const shadow = (el: HTMLElement) => {
    const real = { get: el.getAttribute, has: el.hasAttribute, set: el.setAttribute, remove: el.removeAttribute };
    const isTitle = (name: string) => String(name).toLowerCase() === "title";
    const changed = () => {
      if (on === el && !box.hidden) words.textContent = tipWords(held ?? "")[shownFull ? "full" : "short"];
    };
    const define = (name: string, value: unknown) => Object.defineProperty(el, name, { configurable: true, writable: true, value });
    Object.defineProperty(el, "title", {
      configurable: true,
      get: () => held ?? "",
      set: (v: unknown) => {
        held = String(v);
        changed();
      },
    });
    define("getAttribute", (name: string) => (isTitle(name) ? held : real.get.call(el, name)));
    define("hasAttribute", (name: string) => (isTitle(name) ? held !== null : real.has.call(el, name)));
    define("setAttribute", (name: string, value: string) => {
      if (!isTitle(name)) return real.set.call(el, name, value);
      held = String(value);
      changed();
    });
    define("removeAttribute", (name: string) => {
      if (!isTitle(name)) return real.remove.call(el, name);
      held = null;
      changed();
    });
    el.dataset.tooltipHeld = "1";
    real.remove.call(el, "title");
  };
  const restore = () => {
    if (on && on.dataset.tooltipHeld === "1") {
      const words = held;
      unshadow(on);
      if (words !== null) on.setAttribute("title", words);
    }
    held = null;
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
    shownFull = full;
    box.hidden = false;
    el.setAttribute("aria-describedby", box.id);
    place(el);
  };

  const hold = (el: HTMLElement): string => {
    if (on === el && held !== null) return held;
    const t = el.getAttribute("title");
    if (t === null || t.trim() === "") return "";
    // Give the element its name from the title when it has none (an icon button).
    if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t.split(": ")[0] ?? t);
    held = t;
    on = el;
    shadow(el);
    return t;
  };

  const onOver = (e: Event) => {
    const pe = e as PointerEvent;
    if (pinned || pe.pointerType === "touch") return;
    const target = (e.target as Element | null)?.closest?.("[title], [data-tooltip-held]") as HTMLElement | null;
    if (!target || target === on) return;
    if (on) hide();
    const text = hold(target);
    if (!text) return;
    // An element that draws its own card (`data-own-tip`: the timeline's items) keeps its title from the browser but gets no box.
    if (target.hasAttribute("data-own-tip")) return;
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
