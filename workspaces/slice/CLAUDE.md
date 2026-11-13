# Slice (SliceLab)

Contents of `workspaces/slice`; the rules are in packages/CLAUDE.md and the root CLAUDE.md. Keep this list current when you add or change a file here. Progress: `docs/progress/slice.md`, "Slice as its own page". The workspace may not import another workspace: what it shares with Design is in `packages/print`, and Design's bodies come through the representation registry.

- `src/index.ts`: the placeholder `sliceWorkspace` (what the app shows until the page is switched on) and the exports below.
- `src/page.ts`: the page (`slicePageWorkspace`, `mountSlicePage`; app switch `SLICE_PAGE`, `apps/fission/slice-page.config.mjs`): the design's bodies on the plate (their meshes through the registry: `plateMesh`, `readPlate`) listed in the browser, the print panel in the properties.
- `src/print-panel.ts`: the print choices and the Slice button (`printPanel`): the bodies' exact STL as registry data (`plateFiles`), the engine calls from `@fission/print`, the result in words (`sliceWords`).
- `src/styles/slice-page.css`: every selector under `.slice-page`.
- Tests: `test/page.test.ts` (the mesh worked by hand, reading through a registry, the page and the panel in happy-dom), `test/placeholder.test.ts`; the browser check is `apps/fission/e2e/slice-page.mjs`.
- Slice and download (SP4b2): `print-panel.ts` `download` slices into the P1S's print file for the Build plate and Nozzle chosen and saves it through the page's `save` (`saveFile`), named by `printFileName`; the panel's `file()` says the plate and nozzle. Tested in `test/page.test.ts` and `apps/fission/e2e/slice-page.mjs`.
- Preview (SP4b3b): `print-panel.ts` `preview` slices as the download would, and the page's `openPreview` shows `@fission/print`'s `openPrintPreview` with the viewport's `printView`. Tested in `test/page.test.ts` and `apps/fission/e2e/slice-page.mjs`.
- Extras (SP5a1): `print-panel.ts` has the Warm-up loop and Better grip ticks (`WARM_UP_KEY`, `GRIP_KEY`), the cost line with the price per kg (`costWords`, `PRICE_KEY`) and the print log (`parts.log`, the page's `logPrint`; `PRINT_LOGGED_WORDS`).
- File and progress (SP5a2a): `print-panel.ts` `File` choice (`FORMAT_OPTIONS`; `file()` gives format, plate, nozzle) and the bar (`parts.onProgress`, `progressWords`, `fileCrawl`).
