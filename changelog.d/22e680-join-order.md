fix

- A box can no longer be dragged in front of the box a Combine joined it to (or the other way round): after a later cut split the joined body, "Body 1" quietly became the other piece. The drag is refused in words, as it already was under an Extrude Join.
- Duplicate, Mirror, a size typed in the Size boxes and the Shape choice wait for an OK that is still being checked, so pressing one right after OK no longer drops the Combine, extrude or edit without a word.

public:
- Dragging a box in the timeline past a box it was joined to with Combine is now refused with a reason, so a body can no longer silently swap for another piece.
- Pressing Duplicate or typing a size right after OK no longer loses the step you just made.
