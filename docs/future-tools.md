# Future tools

Tools an established CAD offers that are not on the roadmap (`docs/roadmap.md`), because a beginner or a 3D-printing user does not reach for them. Kept here so they are not forgotten: when the roadmap is done, or a user asks, one moves to the roadmap as a step. From the check of Fusion's Create, Modify, Configure, Construct, Inspect, Sketch and Insert menus (owner's screenshots, 2026-11-06). Behaviour is copied, never names, icons or looks.

Solid modelling
- Free-form modelling (T-spline boxes pushed and pulled into smooth shapes), converted to exact B-rep faces. Needs NURBS surfaces (68).
- Rib and web: a thin wall grown from a sketch line up to the part. An extrude with "to body" (53) gets close.
- Thicken a surface into a solid; boundary fill (a solid from the cells closed off by faces and planes). Need surface modelling first.
- Replace face (swap a face for another surface) and silhouette split (split a body along where its outline is seen from a direction). Mould-making tools.
- Base feature (a non-parametric block in the timeline) and derive (a part made from another design, updated when it changes). Derive is close to recipes and lineage (X12).
- Automated modelling (the computer suggests shapes joining chosen faces) and volumetric lattices. Generative tools, after everything else.
- Simplify (remove fillets, holes and small faces from an imported part for simulation). Useful once STEP import (75) and Simulate are real.

Sketching
- Conic curves and blend curves (a smooth curve joining two others). Need K1's Béziers.
- Sketch scale (scale chosen curves about a point). Move/copy of sketch curves is 52d.
- The curvature constraint (two curves meet with the same bend) and the polygon constraint. Need splines (69).
- AutoConstrain (guess constraints for freshly drawn curves). We snap and infer horizontal/vertical as you draw instead.

Parametric and data
- Configurations (one design with a table of variants: sizes, features on or off, materials). After parameters (55) and presets (the Onshape-style parameter table).
- Bill of materials. After components (78).
- User coordinate systems (a named origin and axes to sketch and measure from). Construction planes (59) cover most of it.
- Compute all (force a full rebuild). Our rebuild is always exact.

Inspection
- Curvature comb, curvature map, zebra, isocurve and environment-map analyses: ways of seeing whether smooth surfaces are smooth. Need NURBS surfaces (68).
- Draft analysis (colour faces by their angle to a pull direction) and accessibility analysis: mould-making. Draft itself is 63.
- Minimum radius analysis (the tightest inside corner, for a cutter). Useful for Manufacture (M2); for printing the nozzle check (H1) covers it.
- Sustainability insights.

Insert
- Supplier parts (McMaster-Carr, TraceParts) and fastener libraries. A community parts library (88) is the free version.
- Decals (a picture wrapped onto a face). Render's job (R1); V3 covers logos.
- Duplicate with joints. After joints (79).

## Dream features

Ideas none of the big CAD tools have, picked by the owner on 2026-11-06 from a list of ten, to come back to once the roadmap's core is built. Each plays to what SpindleLabs is for: a kernel you can trust, and a CAD that knows your printer.

- Fits guaranteed: say "this lid snaps onto this box" and the app works out the clearances for your exact printer and filament, then proves the fit before you print. Needs the calibration step (P13), the per-feature intent (I11, P10) and a tolerance model for the print, after the fit tags (FK2).
- Live print-aware modelling: as you sketch, overhangs, thin walls and weak layer directions glow, and one tap fixes each one without changing what you meant. Grows out of the print check toggle (H1) and the live feedback (P12, I17); the one-tap fix needs fillets (45), draft (63) and parameters (55).
- Strength in plain words: tap a part and it says "this hook holds about 4 kg, and it would snap here first", with a fix offered. The strength check (H4) with words instead of colours; the fix needs the same tools as the line above and the materials library (I15).
- Undo across time: scrub a slider through every version you have ever made and pull any old feature back into today's design. Builds on the earlier-versions restore (File > Earlier versions) and the timeline; pulling a feature across versions needs stable ids that survive versions (40, X12's lineage).
- Repair any STL: drop in any broken mesh from the internet and get back a clean, exact, editable solid. Mesh bodies (X10), healing (76) and fitting exact surfaces to a mesh (X18); the editable part is the hard half, after NURBS (68).
- Teach mode: a beginner tries a tool, and when it fails the app explains why and shows the one move that would work, like a patient tutor. Builds on the refusal messages the kernel already gives, the checked big-text tutorials and beginner mode; the "one move that would work" needs the solver (47) and the hole/fillet steps to have something to suggest.

Print-first ones, picked the same day from a second list:
- Failure replay: before printing, the app simulates the print and shows where it would go wrong (the layer where a tall thin part starts to wobble, the edge the nozzle would catch, the bridge that sags), then offers the fix. Needs the print preview (H2), the G-code replay harness (P0) and a simple physics model per layer; the fix needs the same tools as live print-aware modelling.
- Ghost of the real print, a toggle in the print preview (H2): the preview shows what the printer will really make (elephant's foot, rounded corners, holes 0.2 mm small, seam marks) instead of the perfect CAD shape, and designed holes are already compensated. Needs the calibration step (P13) and the hole compensation (P10).
- Break it before you print it: drag on a part with a finger to push, twist or drop it and watch it bend and snap along the real layer lines, then tap "make it survive that" and only the weak spots thicken. The strength check (H4, S3) run live with layer-direction weakness; the fix needs fillets (45) and parameters (55).
- Auto-split for your bed: a part too big for the printer is cut into pieces with built-in alignment pegs, at the spots where the joins are hidden and strongest. Split body (35h) and the strength check (H4) pick the cuts; the pegs are a hole (54) and a boss with the fit tags (FK2).
