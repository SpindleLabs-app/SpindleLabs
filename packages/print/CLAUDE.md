# Print

Contents of `packages/print`; the rules are in packages/CLAUDE.md and the root CLAUDE.md. Keep this list current when you add or change a file here. Shared by Design and Slice, which may not import each other (Slice page step 2).

- `print-check.ts`: the print check's maths on display meshes (supports needed, thin walls, bridges, the weakest neck); `test/print-check.test.ts`. Design's `print-check-view.ts` draws it.
- `build-area.ts`: the P1S's build area and the first-layer extras (warm-up loop, Better grip); `test/build-area.test.ts`.
- `overhang.ts`: the overhang area and the supports hint; `test/overhang.test.ts`.
- `print-cost.ts`: the weight and cost words, the remembered price; `test/print-cost.test.ts`.
