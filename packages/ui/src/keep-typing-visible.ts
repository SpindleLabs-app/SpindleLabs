// The box being typed in stays on the screen when the phone's keyboard
// opens (clumsy-human hunt 11-04). Android makes the window shorter and
// iOS the visual viewport; either way a box in the lower half of a
// Properties sheet or card ended up under the keyboard, the person typing
// blind. On every change of the window's or the visual viewport's size, the
// box with the focus, if it takes typing and no longer shows whole, is
// scrolled to the middle of what still shows. Nothing moves otherwise: a
// resize with the box already in sight, or with a button or nothing focused.

/** A box's top and bottom and the visible area's, in the same px (the layout viewport's). */
export interface Span {
  top: number;
  bottom: number;
}

/** Whether `box` is not wholly inside `shown`: its top above or its bottom below. Pure, so it is tested by hand. */
export function typingHidden(box: Span, shown: Span): boolean {
  return box.top < shown.top || box.bottom > shown.bottom;
}

/** Input types that bring up a keyboard (a checkbox, range or button never does). */
const TYPED = new Set(["", "text", "number", "search", "email", "url", "tel", "password"]);

/** Whether `el` is something a person types in: a text-like input, a text area or editable text. */
export function takesTyping(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return TYPED.has(((el as HTMLInputElement).getAttribute("type") ?? "").toLowerCase());
  return (el as HTMLElement).isContentEditable === true;
}

/** Starts keeping the focused box in sight in `win`; returns a function that stops it. */
export function keepTypingVisible(win: Window): () => void {
  const doc = win.document;
  let frame = 0;
  const check = () => {
    frame = 0;
    const el = doc.activeElement;
    if (!takesTyping(el)) return;
    const r = el.getBoundingClientRect();
    const v = win.visualViewport;
    // The visual viewport's offsetTop is where it starts in the layout viewport, as getBoundingClientRect measures.
    const shown = v ? { top: v.offsetTop, bottom: v.offsetTop + v.height } : { top: 0, bottom: win.innerHeight };
    if (typingHidden(r, shown)) el.scrollIntoView({ block: "center", inline: "nearest" });
  };
  // After the layout has followed the new size.
  const later = () => {
    if (!frame) frame = win.requestAnimationFrame(check);
  };
  win.addEventListener("resize", later);
  win.visualViewport?.addEventListener("resize", later);
  return () => {
    win.removeEventListener("resize", later);
    win.visualViewport?.removeEventListener("resize", later);
    if (frame) win.cancelAnimationFrame(frame);
  };
}
