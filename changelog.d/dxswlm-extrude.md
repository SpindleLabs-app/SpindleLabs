fix

- Extrude of several profiles works when a profile has a circle or an arc: profiles that don't touch become separate bodies, and the regions of one sketch picked side by side (a plate and its hole, a ring and its middle, a circle split by a line) make the whole shape; overlapping curved profiles that can't be joined yet are refused in plain words before OK records anything.
- Two profiles touching only at a corner extrude as two bodies instead of failing.
- Edit feature no longer lets an extrude take one of its other profiles a second time (which halved the solid and saved a design that would not open again).
- A second or later profile now follows its sketch after a side is deleted and drawn again.
- After OK every sketch the profiles came from is hidden, and deleting an extrude leaves nothing of it behind in the file.

public:
- Extruding several profiles at once now works with circles and arcs, and with shapes that touch only at a corner.
- Editing an extrude of several profiles can no longer break the design file.
- Every sketch used by an extrude of several profiles is hidden after OK.
