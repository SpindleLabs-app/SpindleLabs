fix

- Editing a sketch that comes before a Move, the bodies are shown and snapped to where they are at that sketch's place in the timeline, so a click on a corner lands where it looks.
- With a Move before a sketch suppressed, clicking in the sketch no longer throws a point snapped to a corner to where the Move would have put it.
- Editing a Move, the preview now shows a later copy or mirror of the moved body where OK will put it.
- A sketch on a scaled body's face stays in the same place on the body when the scale changes, and keeps its sizes.
- A sketch on a copy's face stays on it when a cut or join is put on the copied body before the copy.
- Old projects: a sketch on a face now moves with its body when a Move is put before it, a hole drawn into an old extruded sketch is cut, and an old part gets its proper name ("Cylinder 1") and is renamed when its shape changes.
- Resizing a body no longer turns an arc pinned to it inside out without a word; a sketch a body's change left unsolved keeps its warning, and its other curves can still be constrained and dragged.

public:
- Snapping to a corner while editing an earlier sketch now lands where the corner is shown.
- Editing a Move now previews later copies and mirrors of the moved body in the right place.
- A sketch on a scaled body's face keeps its place on the body when the scale changes.
- A sketch on a copied body's face no longer gets lost when the original body is cut or joined.
- Older projects now behave like new ones when you keep editing them: sketches follow moved faces, new holes are cut and parts keep proper names.
- Resizing a body no longer silently flips an arc in a sketch attached to it, and a sketch that can't follow a change keeps warning while its other lines stay editable.
