fix

- Big designs: hovering and selecting pick through a box tree with exactly three.js's answers, and colouring a body after a hover no longer makes new graphics buffers each time (they were never freed).
- Big projects: a save reads back the state it replaces only when it could be kept as an earlier version.
- A seeded 200-item project generator and browser checks for saving and opening big projects.

public:
- Hovering over and selecting parts of big designs is smoother.
- Saving big designs is quicker.
