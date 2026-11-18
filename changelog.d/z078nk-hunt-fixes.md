fix

- Size boxes (Properties, Extrude, Edit feature, Move) read a typed unit (mm, cm, m, in, ") and a decimal comma instead of silently dropping them; text that could mean thousands is refused in words. A refused size goes back to the size before the edit, not a half-typed one.
- The command search no longer gets stuck open after a click on a dimmed command; Mirror, Undo, Redo, Settings and the File menu can be found; Duplicate shows its key; Export STL is dimmed on an empty design.
- Print check words follow the chosen unit (in² with inches).
- On sideways phones and touch tablets, a selection, a new body or a sketch no longer opens the Properties card over most of the view; Browser buttons are finger-sized on every touch screen.
- Undo inside a sketch reopened with Edit Sketch covers only that sketch's steps; Undo with a tool open (Edit feature, Move, Extrude...) cancels just that tool and Redo waits; File > New then Undo gets the file name back.

public:
- Typing a size with a unit ("2.5 cm", "1in") or a decimal comma ("1,5") now works instead of building the wrong size.
- A size that's too big now goes back to the size you had before.
- The command search no longer gets stuck open, and finds Mirror, Undo, Redo, Settings and the File menu.
- Print check shows areas in inches when inches are chosen.
- On sideways phones and tablets the panels no longer cover most of the design, and Browser buttons are easier to tap.
- Undo while a tool is open now cancels just that tool, and Undo inside a reopened sketch no longer takes back steps from outside it.
