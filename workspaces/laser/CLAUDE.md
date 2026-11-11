# The Laser workspace

Contents of `workspaces/laser`; the rules are in packages/CLAUDE.md and the root CLAUDE.md. The steps are in `docs/progress/laser.md`. Keep this list current when you add or change a file here.

- `src/index.ts`: the plugin. With `?laser` (flag.ts) it mounts the page; without it, the placeholder it was.
- `src/flag.ts`: the `?laser` switch (as Design's `?combine`: kept for the tab, `?laser=off` clears it), off until Ben releases it.
- `src/page.ts`: the Laser page (L1a). Lists Design's flat shapes through the registry (`objectsOf("design:outlines")`, Design's representations.ts `DESIGN_OUTLINES`) and delivers each as an exact outline; never reads Design's code or copies its shapes into the project. The project keeps only `LaserData` (bed, gap, sheet thickness, parts turned off). The view is the bed with each part as the kernel's `make_extrude` draws it (no arc maths here), framed from the top. Save SVG / Save DXF. Styles: `src/styles/laser-page.css`.
- `src/sheet.ts`: the bed and the layout (rows from the lower-left corner, `gap` between parts and from the edges, a part that doesn't fit left off with why), exact moves of outlines, and the sheet's SVG (the page is the bed in mm; the path data from core `svg.ts` `outlinePath`, imported by its own path).
- `src/dxf.ts`: the sheet as R12 DXF in mm: closed POLYLINEs with bulges (arcs exact), CIRCLEs, on layer CUT.
- Tests: `test/sheet.test.ts`, `test/dxf.test.ts`, `test/page.test.ts` (happy-dom), `test/flag.test.ts`. Browser check: `apps/fission/e2e/laser-page.mjs` (in `npm run e2e`).
