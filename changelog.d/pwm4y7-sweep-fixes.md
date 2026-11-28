fix

- SliceLab: after the design changes, the last slice's layers, plastic and time are replaced by a note to slice again, and the cost line goes with them; Preview and picking a preset clear them too.
- SliceLab: with the P1S's file chosen, Slice now gives the same answer as Slice and download, so a part too tall for the printer is refused by both and the minutes and grams agree.
- A part too thin to slice is described with its height rounded, in a full sentence.
- TestLab: the safety factor shown never rounds up past its band's edge, so it never says 2 beside "aim for 2 or more".
- The command search runs a command on the design as it is now, even after a file was opened while the search was open.
- Pattern (still behind its switch): a click on a copy picks that copy; Chamfer and Shell no longer hold an edge or face of a copy that later edits could break; editing a Pattern, Chamfer or Shell asks first when it would break a later step; a Pattern's "only touch along a line" refusal names the copy and rounds its points.
- Tests: an account request without its own clock gets the default time limit.

public:
- SliceLab no longer shows the old slice's numbers after the design or the preset changes: it asks you to slice again.
- SliceLab's Slice button now refuses a part too tall for the P1S, as Slice and download does, and both give the same print time and weight.
- A part too thin to slice is now described with a rounded height.
