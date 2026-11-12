// Undo and Redo above an open sheet on a phone (SL #623 item 6, Undo hunt 2026-11-12 F2). At phone width main.ts
// `placeUndoRedo` docks the pair in the view's bottom-right corner, which is where the Browser, Properties and AI sheets
// rise from (styles/phone-sheet.css), so a size mistyped in the open Properties sheet could not be undone until the sheet
// was shut, and a phone has no Ctrl+Z. While a sheet is open and would cover the pair, the pair turns to a row and rises
// to sit `GAP` above the sheet's top edge; shut, it goes back to its corner (its own CSS bottom). A sheet is at most 45% of the workspace
// (60% for the AI panel), so the pair always has room above it.

/** Space between the pair and the sheet's top edge: the 8 px the pair keeps from the screen's corner. */
export const GAP = 8;

const SHEETS = ["browser", "properties", "assistant"] as const;

/** Where the sheet's top is in the window, from its layout (offsetTop), not its drawn place: a sheet sliding in or
 * dragged by its handle is drawn lower than it will sit, and the pair should go where the sheet ends up. */
function layoutTop(sheet: HTMLElement): number | null {
  if (sheet.offsetHeight === 0 || getComputedStyle(sheet).position !== "absolute") return null;
  const parent = sheet.offsetParent;
  return parent ? parent.getBoundingClientRect().top + sheet.offsetTop : null;
}

/** The pair's CSS bottom (px from its container's bottom) that puts it `GAP` above a sheet whose top is at `sheetTop`, or
 * null to leave it in its corner (no sheet, or the pair's own place is already clear of it). Never above the container's
 * top, so a very tall sheet leaves the pair at the top of the view rather than off it. */
export function liftedBottom(pairBottom: number, pairHeight: number, containerTop: number, containerBottom: number, sheetTop: number | null): number | null {
  if (sheetTop === null || pairBottom <= sheetTop - GAP) return null;
  const highest = containerBottom - containerTop - pairHeight - GAP;
  return Math.max(0, Math.min(containerBottom - sheetTop + GAP, highest));
}

/** Keeps the docked pair clear of whichever sheet is open, as sheets open, shut, grow and the window changes. The sheets
 * are looked up by id each time: each workspace has slot elements of its own, swapped into the page while it is shown. */
export function liftOverSheets(document: Document, pair: HTMLElement, phone: MediaQueryList): void {
  const view = document.defaultView;
  const sizes = view && "ResizeObserver" in view ? new view.ResizeObserver(() => place()) : null;
  const watched = new Set<Element>();
  const place = () => {
    const sheets = SHEETS.map((id) => document.getElementById(id)).filter((s): s is HTMLElement => s !== null);
    for (const s of sheets) if (!watched.has(s)) (watched.add(s), sizes?.observe(s));
    pair.style.removeProperty("bottom");
    pair.classList.remove("undo-lift");
    const container = pair.offsetParent;
    if (!phone.matches || !pair.classList.contains("docked") || !container) return;
    const tops = sheets.map(layoutTop).filter((t): t is number => t !== null);
    const sheetTop = tops.length ? Math.min(...tops) : null;
    const room = container.getBoundingClientRect();
    if (liftedBottom(pair.getBoundingClientRect().bottom, 0, room.top, room.bottom, sheetTop) === null) return;
    // Covered: a row (styles/undo-lift.css) along the sheet's edge, placed by its own height.
    pair.classList.add("undo-lift");
    const box = pair.getBoundingClientRect();
    const bottom = liftedBottom(Number.POSITIVE_INFINITY, box.height, room.top, room.bottom, sheetTop);
    if (bottom !== null) pair.style.bottom = `${bottom}px`;
  };
  // A sheet opens and shuts by the workspace's data-browser / data-properties and the AI panel's hidden, and a workspace
  // switch swaps the slots in: watch the workspace's subtree for those, never the pair's own style (place sets it).
  const watch = view && "MutationObserver" in view ? new view.MutationObserver(() => place()) : null;
  const workspace = document.getElementById("workspace");
  if (workspace) watch?.observe(workspace, { attributes: true, attributeFilter: ["data-browser", "data-properties", "hidden"], childList: true, subtree: true });
  const assistant = document.getElementById("assistant");
  if (assistant && !workspace?.contains(assistant)) watch?.observe(assistant, { attributes: true, attributeFilter: ["hidden"] });
  // Not the pair itself: place changes its class and style, and placeUndoRedo docks it on the same phone change heard here.
  phone.addEventListener("change", place);
  view?.addEventListener("resize", place);
  place();
}
