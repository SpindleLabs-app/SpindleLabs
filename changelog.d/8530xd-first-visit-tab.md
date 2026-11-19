fix

- A first visit's empty design is now kept from its first change, like every other new design. It was kept at once, so New project on the home screen or a file opened left it behind as a second, empty "Untitled" design tab that came back after a reload (app bug hunt 2026-11-18, D-4).

public:
- On your first visit, an empty design you never changed is no longer kept in Projects in this browser.
