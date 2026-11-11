# Laser workspace (L…)

The laser cutter built into SpindleLabs (Ben, 2026-11-11: "a built in laser cutter"). Behind `?laser` until Ben releases it. No kernel files: shapes come from Design through the representation registry, 2D curve maths stays in the kernel (offsets for kerf come with K1, step 52).

Ben has no laser of his own; he uses his school's ("a big red one"). Until its make and controller are known, the files (SVG, DXF) are the way to the machine, and the machine output stays generic.

## Steps

- [x] L1a. The Laser page: Design's sketches and profiles listed (Design's `design:outlines` lister), laid out in rows on the bed (size, gap, sheet thickness kept in the project), drawn from above with the kernel's own extrude, saved as SVG and DXF at true size with exact arcs. Verified: hand-worked unit tests (layout, moves, the SVG and DXF text, bulge decimals), deliberate breaks each caught (bulge sign, open polyline, right-edge gap, spacing, a stale view drawn, bulge rounding, a suppressed sketch listed), the browser check `apps/fission/e2e/laser-page.mjs`, and an outside reader: ezdxf 1.4.5 reads the DXF as R12 in mm with no audit errors, and the areas from its own arcs match the hand-worked ones (slot 800 + 100π = 1114.159265359, quarter-arc triangle 2 + π/2 − 1 = 2.570796327, to 9 decimals); svgelements reads the SVG's paths closed at the right places.
- [ ] L1b. Layers: cut, engrave and score, each with speed, power and passes, a colour per layer (as laser programs map colours to layers) in the SVG and a DXF layer each; a part's layer chosen in its row.
- [ ] L1c. Flat faces of bodies as parts (a Design producer for a planar face's outline), and parts dragged and turned on the bed.
- [ ] L1d. Kerf: each cut moved out by half the beam width (holes in), from the kernel's 2D offsets (K1 with step 52); refused in words where a gap is narrower than the kerf.
- [ ] L3a. The beam's path in order (inner loops before outer, nearest next), shown as a preview, with the job's time from speeds and travel.
- [ ] L3b. G-code for GRBL lasers (M4 dynamic power, S from power and the machine's maximum), behind a machine profile; other controllers once Ben's school machine is known.
- [ ] L4a. Sending to the machine over Web Serial, only if it can be made safe: never starts by itself, a start the person presses, a stop always on screen, the machine's own interlocks never bypassed.

Later ideas, not planned yet: nesting parts to save sheet, finger-jointed boxes from a solid (X13), engraving pictures from Image, sheet-metal flat patterns (step 87).
