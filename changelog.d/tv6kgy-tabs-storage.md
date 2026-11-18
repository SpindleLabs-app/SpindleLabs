fix

- Two browser tabs on one design: opening the file one tab just saved no longer stops the other tab saving; a tab whose saves are refused keeps every change at once (a crash lost them), is told as soon as it is shown again that another tab changed the design, and no longer says "Saved" after Undo; two tabs started together make one kept copy, not two.
- Browser storage full: a project can be deleted to make room; a failed save shows its words on a sideways phone; the change survives opening another project and coming back; saving is tried again by itself once there is room; site data cleared while the app is open no longer loses the design on a reload; every storage failure says to use Save.
- Project files: Open asks before replacing a design that a browser unable to keep projects holds nowhere else; a project never named takes its file's name; Save pressed twice asks once; a failed write says why; a picked file is kept only for its own project.

public:
- With the app open in two tabs, your changes are kept and you are told when the other tab changed the design.
- When browser storage is full you can delete a project to make room, and saving starts again by itself.
- A project opened from a file takes the file's name, and Save to a file says clearly when it could not write.
