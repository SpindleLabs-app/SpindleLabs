# Job queue (Q…)

A side feature (Ben, 2026-11-13: "add the print and laser queue as a side feature of SpindleLabs and then continue with what we are doing"): a queue for a school makerspace. A student sends a 3D print or laser job, the file is checked automatically, the teacher approves it or sends it back with a reason, and approved jobs wait in a queue per machine, with material and machine time kept. It never slows the kernel roadmap or curved booleans: app files only, no kernel files, inside the 3-pull-requests-per-area rule. Later it may be sold as a school licence (about A$500 a school a year, `docs/plans/business.md` in the kernel repo); nothing here takes money.

First machines: Ben's school laser (VEVOR KH1490, 130 W CO2, 1400 × 900 mm bed, Ruida controller) and a Bambu P1S printer.

Rules for this workstream:
- Behind the `?queue` switch until Ben releases it. Nothing about it is public until the legal items (Q4) are checked.
- Minors use it, so personal data is the least that works: a display name the teacher types (for example "Sam K."), the class, and the jobs. No student email, photo, birthday or school ID is stored by the queue, none is shown to other students, and job files are deleted a set time after the job ends.
- It reuses what exists and never copies it: the print check, build area and slicer from `packages/print`, the laser layers and bed from the Laser workspace (`docs/progress/laser.md`), accounts from `packages/account`, and machine sending from the shared machine library (I15). Anything it needs from them is asked of that workstream, not built a second time.
- It never starts a machine by itself. A job is sent only when a person at the machine presses Start, with the same rules as Laser's L4 and Slice's H3.
- A check that cannot be done yet says so ("no time estimate yet"); it never shows a made-up number.
- Supabase SQL is pasted by Ben in the dashboard (his school laptop has no terminal); an applied migration is never edited; the server switch starts off.

## Steps

- [ ] Q1. The queue's rules as plain code, `packages/jobqueue` (no page, no network, no personal data beyond the display name): a job (print or laser, file name and size, machine, material, the check's answers, estimated time and material), its states (sent, checked, waiting for the teacher, approved and queued, running, done, failed, sent back with a reason, withdrawn), which moves are allowed and by whom (student, teacher), the queue's order per machine (approval time, the teacher may move a job up or down), and the totals per machine and per student (time, material). Tests: hand-worked cases with the working shown, a refusal for every move not allowed, and seeded random sessions against a simple model.
- [ ] Q2. The automatic file check, through what exists: a print job's file read as a mesh, checked against the P1S's build area and the print check (supports, thin walls), with time and filament from the slicer; a laser job's SVG or DXF checked against the 1400 × 900 bed and its colours read as the Laser layers (cut red, score blue, engrave black), with the time left as "not yet" until Laser's L3a gives one. Every refusal said in plain words.
- [ ] Q3. A demo page behind `?queue`, kept in this browser only: a student view (send a job, see its state and place) and a teacher view (approve, send back, order, mark running and done, totals), so Ben can show his D&T teacher with no accounts and no student data leaving the computer. Browser test with screenshots.
- [ ] Q4. The legal and privacy list, added to `docs/plans/legal.md` in the kernel repo: minors' personal information under the Privacy Act and the Australian Privacy Principles, the WA Department of Education's rules for online services in schools, parent consent, where the data is kept (Supabase region), how long it is kept, a school agreement, and who holds it (Ben's dad). Nothing reaches real students before these are checked.
- [ ] Q5. The server side in Supabase (new migration, SQL for Ben to paste): schools, classes with a join code, teacher and student roles, jobs and their history, row rules so a student sees only their own jobs and their place in the queue, a private bucket for job files with automatic deletion, and a server switch that starts off. Tested like the other migrations (`supabase/test`).
- [ ] Q6. The page on the server: a teacher makes a class and gets a code; a student joins with it and sends jobs; the teacher's view updates. Same tests as Q3 against a fake service.
- [ ] Q7. From queue to machine: an approved print job becomes the print file and Send of Slice (H3); an approved laser job opens in Laser with its layers set, ready for Laser's own sending (L5). Nothing new reaches a machine from here.
- [ ] Q8. Reports for the teacher: material and machine hours per class and per term, saved as a CSV file.
- [ ] Q9. A pilot at Ben's school (planned Term 1 2027), after Q4 is checked and Ben's teacher agrees.

Next: Q1, from a fresh `main`. Files: `packages/jobqueue/` (new package, `package.json` like `packages/print`), a line in `packages/CLAUDE.md`'s package list, this file's tick.
