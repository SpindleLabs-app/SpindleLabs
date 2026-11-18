// The one switch for the Slice page (Slice as its own page, so a slicer job can be a tab). ON since 2026-11-18 (Ben's go):
// DESIGN ▾ > Slice shows the Slice page. File ▾ > Slice for printing still opens the older dialog until it is dropped
// (docs/progress/slice.md, SP5b). SPINDLE_SLICE_PAGE=0 at build time turns the page off again (the dialog route as before).
export const SLICE_PAGE = process.env.SPINDLE_SLICE_PAGE !== "0";
