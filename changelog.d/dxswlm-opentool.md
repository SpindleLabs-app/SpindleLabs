fix

- Export STL, Slice for printing and its preview no longer save a body at its old place while a tool is still open (SL #639 item 1): with Insert's Move (or Move, Rotate, Scale, Extrude, Edit feature, Combine or a sketch) still open, every export route (the toolbar's STL, File ▾ Export STL, a body's Download STL, the command search, File ▾ and DESIGN ▾ Slice for printing, Preview) saves nothing and says in the tool's own panel which tool is open and how to finish it; once OK is pressed the file is what the view showed.

public:
- Exporting or slicing while a tool such as Move is still open now asks you to press OK or Cancel first, instead of saving the part where it was before the change you were making.
