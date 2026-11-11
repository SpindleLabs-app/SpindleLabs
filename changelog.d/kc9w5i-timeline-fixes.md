fix

- An extrude that keeps its last shape no longer loses it, or goes back to an older shape, after a new region is picked in Edit feature or a constraint or dimension spoils its sketch.
- A sketch side deleted and drawn again in place is found again after the sketch was reshaped.
- Undo or Redo pressed straight after an edit, or straight after a timeline Delete, takes back exactly that step and never brings back a design nobody made.
- Editing a Move, Rotate or Scale no longer throws the body elsewhere after Centre of the bodies and a click on a body.
- Edit feature on a Copy or a Mirror is greyed with the reason instead of closing the open tool.
- After Edit feature moves from an extrude's regions to another item, the extrude's body is drawn again.
- Undo and Redo no longer keep every earlier copy of the Design workspace in memory (a leak since the Body facts toggle).

public:
- An extrude that keeps its last shape no longer vanishes or goes back to an older shape after a region pick or a constraint.
- Undo pressed straight after an edit or a delete always takes back exactly that step.
- Editing a Move, Rotate or Scale keeps its pivot where it was.
- Edit feature on a copy or mirror image is greyed out with the reason, instead of closing what was open.
- Long sessions with many undos use less memory.
