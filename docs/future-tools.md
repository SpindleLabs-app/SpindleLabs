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
