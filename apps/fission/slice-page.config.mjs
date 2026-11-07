// The one switch for the Slice page (Slice as its own page, so a slicer job can be a tab): while it is off, DESIGN ▾ > Slice
// opens Slice for printing over Design as before and the Slice workspace is the placeholder page. Flip SLICE_PAGE to true when
// the page does everything the dialog does; SPINDLE_SLICE_PAGE=1 at build time turns it on without editing this file (its
// browser check builds that way: `npm run e2e:slice-page`).
export const SLICE_PAGE = process.env.SPINDLE_SLICE_PAGE === "1" || false;
