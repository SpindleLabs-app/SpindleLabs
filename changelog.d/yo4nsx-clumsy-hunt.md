fix

- A huge angle typed into Rotate (like 100000000000000000000°) now turns the body to the right place, in the preview and in the result.
- A cylinder or sphere less than 0.002 mm across is refused in the Parameters panel in plain words, instead of failing and being kept as a broken part.
- A slot typed narrower than (or as wide as) it is deep is refused in plain words, instead of failing with a confusing message and being kept as a broken part.
- Two tabs open on the same project, each closed or left straight after a change, no longer lose the first tab's change: both are kept, one as a separate "(from another tab)" project, with a message saying so.
- Pressing Undo straight after OK on an Extrude, Move or Edit feature, while it is still being worked out, now undoes that operation once it finishes, instead of silently dropping it and undoing the step before.
- Double-clicking a timeline item right after clicking another one now opens Edit for it, instead of its options menu.
- Downloading an STL of many moved bodies, or slicing them, is much faster: 14 moved bodies went from about 23 seconds to about 3.
