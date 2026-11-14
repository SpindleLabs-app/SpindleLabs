fix

- Copy as SVG takes a sketch that is one shape with holes, such as a plate with a hole; it was refused as having no closed outline though Extrude took the same sketch.
- Export STL, 3MF and OBJ and Slice for printing pressed while the design is still rebuilding (after Undo, Redo or opening a file) wait for the rebuild; before, a Combine that had just failed was taken as built, so a body was left out and the file was called "Checked solid".
- Export 3MF and OBJ refuse while a Move or another tool is still open, as Export STL does; they saved the part where it was before the Move.

public:
- A plate with holes can be copied as SVG.
- An export pressed straight after Undo, Redo or opening a file no longer leaves a body out.
- Export 3MF and OBJ wait for an open tool, as Export STL does.
