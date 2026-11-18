// A row that scrolls sideways says so (UI review 2026-11-18, finding 12): at phone width the workspace's toolbar is one
// row you swipe (theme.css; the sketch row too, SL #672), and cut off at the screen's edge ("MODIF…") it gave no sign
// that more lay past it. `watchScrollMore` keeps `data-more` on the row: "left", "right", both or empty, for the sides
// with tools out of sight; styles/scroll-more.css fades the right edge while more lies past it (the left keeps the
// pinned Search). The row itself is not changed.

/** Pixels of slack: a row scrolled to within this of its end counts as at the end (fractional scroll positions at zoom). */
export const SLACK = 1;

/** The sides of a sideways-scrolling row with more out of sight, from its three widths: hand-checked in the tests. */
export function moreSides(scrollLeft: number, clientWidth: number, scrollWidth: number): string {
  const sides: string[] = [];
  if (scrollLeft > SLACK) sides.push("left");
  if (scrollLeft + clientWidth < scrollWidth - SLACK) sides.push("right");
  return sides.join(" ");
}

/** Keeps `data-more` on `row` current as it scrolls, resizes or its tools change; returns a function that stops it. */
export function watchScrollMore(row: HTMLElement): () => void {
  row.classList.add("scroll-more");
  const update = () => {
    const sides = moreSides(row.scrollLeft, row.clientWidth, row.scrollWidth);
    if (row.dataset.more !== sides) row.dataset.more = sides;
  };
  const view = row.ownerDocument.defaultView;
  const sizes = view && "ResizeObserver" in view ? new view.ResizeObserver(update) : null;
  sizes?.observe(row);
  const tools = view && "MutationObserver" in view ? new view.MutationObserver(update) : null;
  tools?.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
  row.addEventListener("scroll", update, { passive: true });
  update();
  return () => {
    sizes?.disconnect();
    tools?.disconnect();
    row.removeEventListener("scroll", update);
  };
}
