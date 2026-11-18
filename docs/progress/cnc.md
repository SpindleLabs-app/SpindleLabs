# CNCLab: the CAM workstream (M…)

Progress file for one workstream (rules: root CLAUDE.md, "Workstreams and where progress lives"). Only threads working on CNCLab edit this file. The steps M0–M12 are listed in the Manufacture section of `docs/roadmap.md`; their substeps, the design decisions behind them and each substep's test plan are here. Tick a substep here when it lands, and tick its step in the roadmap when the last substep does. Step 86 ("CAM: 2.5D toolpaths, G-code") is M0–M4 below.

Owner's ask (Ben, 2026-11-13): "add CAM to the plan". CAM here means CNC toolpath generation: from a design body, the paths a spinning cutter follows to carve it out of a block, written as G-code for a machine. Plan only so far: nothing is built.

## Where it sits in the order (decision 1)

CAM never delays curved booleans (37–43), fillets (44–46) or the launch-critical headline features (H1–H5). It starts after the public launch work (fillets, chamfers and the slicer), alongside the "lots of features" phase, in the "everything else" pull request slot, and never takes a kernel slot from a primary roadmap step. Reasons:
- Its exact cuts need what those steps build: round pocket corners and holes need curved booleans (37–43) and 2D offsets of arcs (K1 with 52); a toolpath that stays on the right pocket after an edit needs full topological naming (40); drilling from a hole needs the hole feature (54); 3D finishing needs real curved surfaces to finish (fillets 44–46, then NURBS 67–73).
- The test harness (M0) touches nothing else and may start earlier only when a pull request slot is genuinely spare, as the slicer's harness did; it never holds up a primary step.

## Decisions (made 2026-11-13, logged to the coordinator)

1. Order as above.
2. Our own CAM engine, built on our own exact kernel. No open-source CAM library is linked or read: OpenCAMLib is LGPL, and FreeCAD's Path, PyCAM and CAMotics are GPL-family, so their source is never opened (root CLAUDE.md, "When stuck"). Published papers and any project's written documentation are fine. A copyleft program may be run separately as a checker of our answers, never read, the way OpenCascade judges the booleans.
3. The CAM engine is private, like the kernel and the slicing engine, and ships inside the same compiled module. CNCLab's screens and the thin adapter are public. How the engine works is written only in the kernel repo's notes; this file says what each step does for the person and how it is checked.
4. Toolpaths are worked out from the exact solid, never from its display mesh, and every toolpath is checked against the exact solid before it is shown (the gouge check, below). This is the opposite of the slicer's mesh-first start, because a CNC cut cannot be undone: material taken off is gone.
5. The file first. CNCLab writes a G-code file to run with the machine's own program. Sending a job straight from the browser (GRBL over Web Serial, sharing Laser's driver layer and the shared machine library, I15) comes last (M11), behind the shared confirmation screen, with Stop always on screen, and the machine's own limits and emergency stop never worked round. The AI assistant may suggest tools and feeds and explain G-code, and never sends a job.
6. GRBL first for the G-code dialect (most hobby routers: 3018s, Shapeoko, X-Carve, Onefinity and the like), then LinuxCNC, then a plain Fanuc-style dialect that most industrial controllers read, each written from the controller's own published documentation.
7. Millimetres inside, always. Inch machines get G20 output from the post-processor only, rounded once at the end.
8. Never cutting into the part: the gouge limit is the G-code's own rounding (half a micrometre at 3 decimals in mm) on top of the kernel's 10 nm tolerance. A toolpath that would go deeper anywhere is refused in words, never quietly shifted. The user's "stock to leave" (material left on for a finishing pass) is a separate setting and is checked the same way. This is a new rule, not a loosened one; changing it needs the owner.
9. Every number shown (cycle time, feed, spindle speed, chip load, material removed) is checked against a hand-worked value, and a time is labelled an estimate.

## Steps

- [ ] M0. Test harness before any toolpath code.
  - [ ] M0a. A milling G-code reader that replays our output and checks it: every move inside the machine's travel, no rapid move (G0) through stock or the part, no cut below the table or into a clamp, spindle on before any cut and off at the end, feeds within the machine's and tool's limits, arcs (G2/G3) that close exactly. Public, beside the slicer's replayer in `packages/testing`.
  - [ ] M0b. A stock simulator that is independent of the toolpath code: the block is cut by sweeping each tool along the replayed G-code, giving what is left. It is the judge, not the generator, so it shares no code with the engine.
  - [ ] M0c. The gouge and leftover checks: what is left after simulation compared with the exact solid. No point of the part is cut deeper than the gouge limit (decision 8), and no material is left thicker than the step's own promise (stock to leave, plus the scallop height for ball cutters, plus the corners a round tool cannot reach, worked out independently).
  - [ ] M0d. Hand-worked parts with every number worked out in comments: a 100 × 60 mm face, a 40 × 20 × 5 mm pocket, a pocket with a round island, a 30 mm disc cut out with tabs, a row of drilled holes, a 20 mm hemisphere (for 3D). A separate open-source CNC simulator, run as a program only, as a second judge (decision 2).
- [ ] M1. Setups, stock, tools and feeds.
  - [ ] M1a. A setup: which DesignLab bodies are machined (by stable id), the stock (a box with margins, or a cylinder), the work origin (a stock corner or centre, top or bottom), and which way the tool comes in from (Z down first). Saved in the project as a new data version with its reader. A design change marks the setup out of date, never silently moves it.
  - [ ] M1b. The tool library, shared across projects: flat end mill, ball end mill, bull nose (corner radius), drill, chamfer or V-bit, engraving bit, face mill; diameter, flutes, cutting length, overall stick-out, holder size. Kept in the browser, like Slice's presets.
  - [ ] M1c. Feeds and speeds from the one materials library (I3, roadmap I15 for machines): spindle speed from cutting speed and diameter, feed from chip load × flutes × speed, plunge and ramp feeds, the depth and width of cut, all shown with where each number comes from and capped by the machine's limits. Starter materials: softwood, plywood, MDF, acrylic, HDPE, aluminium 6061. Hand-worked: a 6 mm 2-flute cutter at 200 m/min gives 10,610 rpm (200,000 / (π × 6)), and at 0.05 mm a tooth 1,061 mm/min.
  - [ ] M1d. A machine profile in the shared machine library: travel, spindle speed range, top feeds, its dialect (decision 6), with a "my machine" form.
- [ ] M2. 2.5D strategies (cuts at fixed depths, the first useful CAM), each on picked faces and edges by stable id.
  - [ ] M2a. Facing: flattening the top of the stock to the part's top, in passes at the user's step-over, entering and leaving off the stock.
  - [ ] M2b. 2D contour: cutting round an outline (outside, inside or on the line), with the tool's radius allowed for by CAM (so the machine needs no compensation), climb or conventional, depth in steps, gentle lead-in and lead-out arcs, a finishing pass. Arcs in the part come out as true arcs (G2/G3).
  - [ ] M2c. Tabs: small bridges left on a cut-out so the part does not come loose, placed evenly or by hand, with their height and width, shown on the preview.
  - [ ] M2d. Drilling: from a hole feature's intent (I11, step 54) or picked round holes; plain, peck (pecks of a set depth, back out to clear chips) and chip-break cycles; holes visited in a short order.
  - [ ] M2e. Pockets: clearing the inside of a closed outline down to its floor, islands kept, by rings that follow the outline, with the corners a round tool cannot reach reported, never cut into. Ramping or helical entry, never a straight plunge with a flat end mill unless the tool says it can.
  - [ ] M2f. Adaptive clearing: roughing where the tool's engagement (how much of it is in the material) stays nearly constant, so it can cut deep at full flute length without overloading in corners; the modern way to rough, and the one users of established CAM programs expect.
  - [ ] M2g. Chamfer and engrave: a V-bit or chamfer tool along edges (deburring, and text from sketch text, 52e).
  - [ ] M2h. Rest machining in 2.5D: a smaller tool clearing only what a bigger tool left, judged from M0b's simulated stock.
- [ ] M3. Simulation and checks on screen: the stock cut away move by move in the shared viewport (play, pause, speed 1× to 1,000×, scrub, like the print preview's time-lapse), the tool and holder drawn, collisions of the holder or a rapid with the stock shown in red, the cycle time (an estimate, with acceleration), and gouges marked where they would be (there should be none: decision 8).
- [ ] M4. G-code out through post-processors: GRBL first (decision 6), then LinuxCNC, then a Fanuc-style dialect; units, a safe start (G17 G21 G90, safe height, spindle and its warm-up wait), tool changes with a pause and message, and a safe end. Each dialect is replayed by M0a, and checked by running the controller's own free simulator or interpreter as a separate program where one exists.
- [ ] M5. 3D roughing: z-level (waterline) roughing of any accepted body to a stock to leave, with adaptive passes in each level (M2f's), rest roughing between levels.
- [ ] M6. 3D finishing: parallel passes with a ball or bull nose cutter for shallow areas, waterline passes for steep walls, the two blended by wall angle; the scallop height (the ridge between passes) chosen by the user and the step-over worked from it; pencil passes along inside corners later.
- [ ] M7. Toolpaths that follow the design: every operation refers to faces and edges by stable id (40), so an edit regenerates the toolpaths; a face that vanishes or splits gives a plain warning, never a guess (as Slice's P11).
- [ ] M8. A machinability overlay in DesignLab (integration map row 3): inside corners sharper than the smallest tool in the library, pockets deeper than the longest tool reaches, and walls too thin to hold, painted live like the print check (H1).
- [ ] M9. Workholding: clamps, a vice and fixture plates as keep-out shapes the toolpaths avoid and the simulator checks; a second setup flipped over for two-sided parts, lined up by dowel holes.
- [ ] M10. Circuit board milling from CircuitLab (integration map row 23): isolation routing round copper, drilling and the board outline, once CircuitLab exists (E2).
- [ ] M11. Send from the browser (decision 5): GRBL over Web Serial through the shared connection layer (I15) and Laser's driver pattern (one job, one driver per controller family, a made-up machine for tests), with the confirmation screen, Stop always shown, a lost connection said at once with what the machine does by itself, homing and probing only on the person's press.
- [ ] M12. Later, each as its own piece without a rewrite: 3+2 (indexed) machining, a fourth axis, simultaneous five-axis, a lathe, tool wear, and machining feature recognition (finding pockets and holes on an imported STEP part, after STEP import).

## The test plan (every step)

What every M step must have before its box is ticked, on top of the root CLAUDE.md's definition of done:
- Hand-worked cases with the working in comments: the M0d parts give each strategy exact numbers to hit (for example, a 6 mm cutter cutting round a 30 mm disc on the outside follows a circle of radius 18 mm, written as G2 arcs; a 40 × 20 mm pocket with a 6 mm cutter at 50 % step-over has its ring count and lengths worked out by hand; a peck cycle at 2 mm pecks to 9 mm depth gives pecks to 2, 4, 6, 8 and 9).
- Boundaries at 0.9× and 1.1×: a corner radius just bigger and just smaller than the tool (reached against reported), step-over at its limit, tab height, the gouge limit itself (a planted path 0.9× of it passes, 1.1× is caught), arc closure, the machine's travel.
- Seeded random parts against a simple model: thousands of seeded 2.5D parts (pockets with islands, bosses, holes at random sizes and places), each toolpath replayed (M0a) and simulated (M0b), then judged (M0c): no gouge, no leftover beyond the promise, no rapid through material, no move off the machine. Seeds and the smallest failing part kept in `tests/regressions/` and replayed forever. 3D strategies the same on seeded bodies made from boxes, cylinders, spheres and fillets.
- Gouge checks against the exact solid: the judge measures the swept tool against the kernel's exact body, not against a mesh, so a toolpath that looks right on screen but nicks a fillet by 2 µm is caught.
- Deliberate breaks proving the tests fail: the tool's radius allowance flipped (inside for outside), step-over doubled, a tab dropped, a peck skipped, a rapid sent at cutting depth, an arc's direction swapped, each planted and caught (added to the kernel's planted bugs). Mutation testing of every changed line, as for the kernel.
- An outside judge: a separate free CNC simulator and each controller's own simulator or interpreter run as programs on our G-code (decision 2), agreeing on what is cut and that every line is valid.
- Browser checks at 1280 and 375 px for every visible piece (setup, tool library, toolpath preview, simulation).
- A real cut before CNCLab is turned on for everyone: a test part in foam, wax or MDF on a real router, checked against the design, its result written here.

## Next

Nothing until the order allows (decision 1). The first thread starts M0a from a fresh `main`, splitting it into substeps here before any code.
