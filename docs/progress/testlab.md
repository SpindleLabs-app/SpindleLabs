# TestLab (the Simulate workspace)

TestLab is the Simulate workspace's name for people; its id stays `simulate`. The plan is T0–T7 in `docs/roadmap.md`. The solver and mesher are built in the private kernel; this file says only what the app does.

- [x] T0: the plan (roadmap PR #602).
- [x] T1: the live link, no solver, behind `?testlab`: a study on a Design body, held and pushed faces kept by stable name and found again after every design edit, a lost face said in words, out of date with a change note after an edit, Run checking the set-up and saying solving comes later. Tests: workspaces/simulate (unit, happy-dom), packages/testing `journeys/testlab-link.journey.ts` (real kernel), `apps/fission/e2e/testlab-page.mjs` (browser, 1280 and 375 px). Branch `claude/project-thread-mbndh6`.
- [ ] T2: materials: the one materials library made real for PLA, PETG, ABS, aluminium 6061 and steel with their mechanical numbers and where each came from; a study's material, already set from the body's when it has one. Start from `packages/core/src/model/material.ts` (DRAFT) and `workspaces/simulate/src/study.ts` (a study has no material yet; data version 2 adds it, version 1 read as "not chosen").
- [ ] T3–T5: the solver, the mesher, and results in the shared view (kernel work first).
- [ ] T6: benchmarks nightly.
- [ ] T7: back into Design (stress paint, "Test strength in TestLab", the zero-exports journey).

Not yet, noted in T1: the workspace's title stays "Simulate" until Ben says whether workspaces are renamed in the app (the page calls itself TestLab only in its words); at phone width the picking hint is in the Properties sheet, not over the view.
