fix

- Save after Save As: an Undo back to a design the old file was saved at no longer brings the old file back, so Save writes the file last saved to and never writes over the copy left behind without asking (app-wide hunt 2026-11-14, R-3). Check G of `e2e/save-picker.mjs`.
- OK, then Open of a file, Projects in this browser > Open or a shared link's copy while the kernel still checks the OK: Open waits for the OK, so the step is kept in the project left behind (S-1). New browser check `e2e/ok-then-open.mjs`.

public:
- Save after Save As and Undo now writes the file you last saved to, never the older one.
- Opening another project straight after pressing OK no longer drops that last step.
