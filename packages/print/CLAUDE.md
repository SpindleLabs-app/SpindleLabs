# Print

Contents of `packages/print`; the rules are in packages/CLAUDE.md and the root CLAUDE.md. Keep this list current when you add or change a file here. Shared by Design and Slice, which may not import each other (Slice page step 2).

- `print-check.ts`: the print check's maths on display meshes (supports needed, thin walls, bridges, the weakest neck); `test/print-check.test.ts`. Design's `print-check-view.ts` draws it.
- `build-area.ts`: the P1S's build area and the first-layer extras (warm-up loop, Better grip); `test/build-area.test.ts`.
- `overhang.ts`: the overhang area and the supports hint; `test/overhang.test.ts`.
- `print-cost.ts`: the weight and cost words, the remembered price; `test/print-cost.test.ts`.
- `choices.ts`: `PrintChoices`, `FileChoices`, the option lists (quality, walls, infill, supports, file, plate, nozzle), their defaults, the remembered switches (`rememberedNozzle`, `rememberedWarmUp`, `rememberedBetterGrip`) and `presetSettingsOf` (stored settings checked against the lists).
- `slice-presets.ts`: the printer presets (`readPresets`, `writePresets`, `presetBar`: the Preset list in the dialog's heading line); `fits.ts`, `fit-piece.ts`, `fit-calibration.ts`: Printer fits (the model, the test piece, the measures dialog); `test/fit-piece.test.ts`. The dialog's own tests (`slice-presets.test.ts`, `fit-calibration.test.ts`) stay in Design, which owns the dialog until Slice page step 4.
